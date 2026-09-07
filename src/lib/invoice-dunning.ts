/**
 * «Напоминание и автоотмена» — what happens to a company invoice nobody pays.
 *
 * Until now an unpaid invoice hung forever: the admin card said «Просрочен на
 * N дней» and that was the whole story. Dim's answer was two sentences long —
 * remind, then cancel and tell them — so this is two steps on two intervals,
 * both of them settings («Настройки → О компании → Счета для компаний»,
 * src/lib/invoices.ts InvoiceSettings), never constants:
 *
 *   remindBeforeDays  2 by default. One reminder letter, once, while the due
 *                     date is that close (or already past, if a run was
 *                     missed and caught up late — the letter says which).
 *                     0 turns it off.
 *   cancelAfterDays   7 by default. That many whole days past the due date the
 *                     order is cancelled, exactly the way the owner cancels
 *                     one by hand, and the company is told. 0 turns it off.
 *
 * Run once a day from GET /api/cron/flows (src/lib/flows.ts runFlows), which
 * is where the other three automatic letters live. Its rules are the ones
 * that file already established, for the same reasons:
 *
 *   · **the row remembers.** `invoice.remindedAt` and `invoice.cancelledAt`
 *     are stamped BEFORE the letter leaves, so a crash between the two costs
 *     one letter rather than sending the same one every hour forever.
 *   · **nothing throws.** A flow that fails is a flow that did not run; the
 *     shop keeps selling.
 *
 * And one rule of its own, because this step spends money rather than just
 * mailing about it: **a paid invoice is never touched.** The selection asks
 * the database for open orders only, and every candidate is re-read
 * immediately before it is cancelled — «Отметить оплаченным» pressed while
 * this loop was walking must win, and it does.
 */
import { query } from "@/lib/db";
import {
  cleanInvoiceSettings,
  companyOf,
  invoiceDaysLeft,
  invoiceLines,
  invoiceOf,
  invoiceOverdueDays,
  invoiceSeller,
  saveInvoiceRecord,
  tallinnDate,
  addDays,
  type InvoiceRecord,
  type InvoiceSettings,
} from "@/lib/invoices";
import { getOrder, getSettings, mapOrder, setOrderStatus, writeAuditSafe, type Order } from "@/lib/orders";

/* `OrderRow` is private to src/lib/orders.ts and stays that way — the shape
   the shared file already hands mapOrder() is the shape this file asks for. */
type OrderRow = Parameters<typeof mapOrder>[0];

/** The same shape src/lib/flows.ts reports for its own three letters. */
export interface DunningRun {
  /** Reminder letters that really went out. */
  reminded: number;
  /** Orders cancelled by this run. */
  cancelled: number;
  /** Candidates that were looked at and left alone. */
  skipped: number;
  /** `disabled` when both intervals are off, `error` when the walk itself failed. */
  reason?: string;
}

/* A day's invoices, not a year's: this shop takes a handful of company orders
   a month, and a cron step that could walk ten thousand rows is a cron step
   that times out on the one day it matters. */
const BATCH = 200;

/**
 * Every order that still carries an unpaid invoice.
 *
 * `status in ('new','failed')` is the same door the admin's «По счёту» chip
 * uses (public/shop2/app.js admOrderVM: an invoice order is «unpaid» while it
 * is new or failed). Paid, shipped, delivered, cancelled and refunded orders
 * are all out — and `invoice->>'paidAt' is null` says the same thing a second
 * way, from the invoice's own side, because the two are written by different
 * code paths and only one of them may ever have run.
 *
 * Matches the partial index db/migrations/145_invoice_dunning.sql creates.
 */
async function openInvoices(): Promise<Order[]> {
  const rows = await query<OrderRow>(
    `select * from orders
      where invoice is not null
        and status in ('new', 'failed')
        and coalesce(invoice->>'paidAt', '') = ''
        and coalesce(payment->>'status', '') <> 'paid'
      order by invoice->>'dueAt'
      limit ${BATCH}`,
  );
  return rows.map(mapOrder);
}

/**
 * The reminder, once per invoice.
 *
 * Sent while the due date is `remindBeforeDays` away or nearer — including
 * already past, which is what a cron that was down for a week produces; the
 * letter has a second lead for that case rather than telling a bookkeeper to
 * pay by a date in the past. Never on the issue day itself: a term shorter
 * than the interval would otherwise turn the invoice into two letters in one
 * morning.
 */
async function sendReminder(order: Order, invoice: InvoiceRecord, conf: InvoiceSettings, now: Date): Promise<boolean> {
  const stamped: InvoiceRecord = { ...invoice, remindedAt: now.toISOString() };
  await saveInvoiceRecord(order.id, stamped);

  let sent = false;
  try {
    const [{ loadBrand }, { sendRendered }, { renderInvoiceReminder }, { normalizeLang }] = await Promise.all([
      import("@/lib/mail-hooks"),
      import("@/lib/mail"),
      import("@/emails/invoice-reminder"),
      import("@/emails/layout"),
    ]);
    await loadBrand();
    const seller = await invoiceSeller();
    const lang = normalizeLang(order.lang);
    const totals = invoiceLines(order, invoice.vatRate, lang);
    const mail = renderInvoiceReminder(
      order,
      {
        invoice: { number: invoice.number, dueAt: invoice.dueAt },
        seller: { name: seller.name, iban: seller.iban, bankName: seller.bankName },
        totals: { total: totals.total },
        cancelAt: conf.cancelAfterDays > 0 ? addDays(invoice.dueAt, conf.cancelAfterDays) : null,
        overdue: invoiceOverdueDays(invoice, now) > 0,
      },
      lang,
    );

    /* The same PDF again, best effort — a bookkeeper who lost the first
       letter should not have to ask for the file, and a missing font must
       not cost the reminder itself. */
    let attachments;
    try {
      const { buildInvoicePdf, invoicePdfFilename } = await import("@/lib/invoice-pdf");
      const bytes = await buildInvoicePdf(order, invoice, { seller, totals, lang });
      attachments = [{ filename: invoicePdfFilename(invoice.number), content: bytes, contentType: "application/pdf" }];
    } catch (err) {
      console.error("[invoice-dunning] reminder PDF failed, sending without it:", err);
    }

    const res = await sendRendered(invoice.email, mail, {
      tags: { template: "invoice-reminder", lang: lang.toLowerCase() },
      idempotencyKey: `invoice-reminder:${invoice.number}`,
      attachments,
    });
    sent = res.ok && !res.skipped;
  } catch (err) {
    console.error("[invoice-dunning] reminder failed:", err);
  }

  await writeAuditSafe("system", "invoice.reminded", {
    orderId: order.id,
    number: order.number,
    invoice: invoice.number,
    email: invoice.email,
    dueAt: invoice.dueAt,
    sent,
  });
  return sent;
}

/**
 * The cancellation.
 *
 * setOrderStatus(…, 'cancelled') is the very function «Отменён» on the order
 * card calls, so the stock is returned by exactly the same rule (src/lib/
 * orders.ts: a 'return' move only for an order that had been paid — an unpaid
 * invoice never took stock, so there is nothing to give back, and an invoice
 * that WAS paid never reaches this line at all).
 */
async function cancelOrder(order: Order, invoice: InvoiceRecord, now: Date): Promise<boolean> {
  /* Re-read: «Отметить оплаченным» may have been pressed since the selection
     query, and a paid order must never be cancelled by a robot. */
  const fresh = await getOrder(order.id);
  if (!fresh || fresh.status !== order.status || fresh.status === "paid") return false;
  const current = invoiceOf(fresh);
  if (!current || current.paidAt || current.cancelledAt) return false;

  await saveInvoiceRecord(order.id, { ...current, cancelledAt: now.toISOString() });
  await setOrderStatus(order.id, "cancelled", "system:invoice");

  let sent = false;
  try {
    const [{ loadBrand }, { sendRendered }, { renderInvoiceCancelled }, { normalizeLang }] = await Promise.all([
      import("@/lib/mail-hooks"),
      import("@/lib/mail"),
      import("@/emails/invoice-cancelled"),
      import("@/emails/layout"),
    ]);
    await loadBrand();
    const lang = normalizeLang(fresh.lang);
    const totals = invoiceLines(fresh, current.vatRate, lang);
    const mail = renderInvoiceCancelled(
      fresh,
      { invoice: { number: current.number, dueAt: current.dueAt }, totals: { total: totals.total } },
      lang,
    );
    const res = await sendRendered(current.email, mail, {
      tags: { template: "invoice-cancelled", lang: lang.toLowerCase() },
      idempotencyKey: `invoice-cancelled:${current.number}`,
    });
    sent = res.ok && !res.skipped;
  } catch (err) {
    console.error("[invoice-dunning] cancellation letter failed:", err);
  }

  await writeAuditSafe("system", "invoice.cancelled", {
    orderId: fresh.id,
    number: fresh.number,
    invoice: current.number,
    company: companyOf(fresh.company)?.name ?? null,
    email: current.email,
    overdueDays: invoiceOverdueDays(current, now),
    amount: Number(fresh.total) || 0,
    sent,
  });
  return true;
}

/**
 * One pass over the open invoices: remind what is nearly due, cancel what is
 * long overdue. Called once a day by src/lib/flows.ts runFlows(); safe to run
 * more often, and safe to miss a day.
 */
export async function runInvoiceDunning(now: number = Date.now()): Promise<DunningRun> {
  const at = new Date(now);
  const out: DunningRun = { reminded: 0, cancelled: 0, skipped: 0 };

  const conf = cleanInvoiceSettings((await getSettings()).invoice);
  if (conf.remindBeforeDays <= 0 && conf.cancelAfterDays <= 0) return { ...out, reason: "disabled" };

  const orders = await openInvoices();
  const today = tallinnDate(at);
  for (const order of orders) {
    const invoice = invoiceOf(order);
    if (!invoice || invoice.paidAt) {
      out.skipped += 1;
      continue;
    }
    try {
      const overdue = invoiceOverdueDays(invoice, at);
      if (conf.cancelAfterDays > 0 && overdue >= conf.cancelAfterDays) {
        if (await cancelOrder(order, invoice, at)) out.cancelled += 1;
        else out.skipped += 1;
        continue;
      }
      const left = invoiceDaysLeft(invoice, at);
      const dueSoon = Number.isFinite(left) && left <= conf.remindBeforeDays;
      if (conf.remindBeforeDays > 0 && dueSoon && !invoice.remindedAt && invoice.issueDate !== today) {
        if (await sendReminder(order, invoice, conf, at)) out.reminded += 1;
        else out.skipped += 1;
        continue;
      }
      out.skipped += 1;
    } catch (err) {
      console.error(`[invoice-dunning] ${order.number} failed:`, err);
      out.skipped += 1;
    }
  }
  return out;
}
