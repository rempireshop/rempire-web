/**
 * «Напоминание и автоотмена» — src/lib/invoice-dunning.ts.
 *
 * The whole clock on a real PGlite database: an invoice order is created the
 * way the checkout creates one, the calendar is moved by handing the run a
 * `now`, and every step is checked for what it did *and* for what it must
 * never do. The three rules that matter, in order of how much they would cost
 * if they broke:
 *
 *   1. a **paid** invoice is never reminded and never cancelled, however far
 *      past its due date it is;
 *   2. the reminder goes out **once** — a cron that runs hourly must not mail
 *      a bookkeeper twelve times before lunch;
 *   3. cancelling returns stock exactly the way «Отменён» on the order card
 *      does, which for an unpaid invoice means *nothing to return* (the stock
 *      was never taken) — and for one that was paid means it never happens.
 *
 * The e2e mail sink (src/lib/mail.ts, no RESEND_API_KEY) stands in for the
 * mailbox: it records what the shop asked to send, which is what these tests
 * are about.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variants from "@/data/catalogue.variants.json";
import { renderInvoiceCancelled, renderInvoiceReminder } from "@/emails";
import { query } from "@/lib/db";
import { runFlows } from "@/lib/flows";
import { runInvoiceDunning } from "@/lib/invoice-dunning";
import { addDays, invoiceOf, saveInvoiceRecord, tallinnDate } from "@/lib/invoices";
import { getLevel, listMoves, move } from "@/lib/inventory";
import { capturedMail } from "@/lib/mail";
import { createOrder, getOrder, setOrderPayment, setOrderStatus, setSetting } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

type Min = { id: string; p: number; s: string };
const VARIANTS = variants as Record<string, { sizes: string[]; prices: number[] }>;
const plain = (catalogueMin as Min[]).find((p) => p.s === "in" && !VARIANTS[p.id])!;

const COMPANY = {
  name: "Salong Näidis OÜ",
  regCode: "16123456",
  vatNumber: "EE101234567",
  address: "Pärnu mnt 10, 10148 Tallinn",
  email: "raamatupidaja@example.com",
};

const ENV_KEYS = ["RESEND_API_KEY", "E2E_BOOTSTRAP", "SESSION_SECRET", "MAIL_PENDING_PAYMENT"] as const;
const saved: Record<string, string | undefined> = {};

function invoiceOrderInput(over: Record<string, unknown> = {}) {
  return {
    lang: "RU",
    items: [{ id: plain.id, qty: 2 }],
    customer: { name: "Mari Tamm", email: "mari@example.com", phone: "+372 5555 5555" },
    shipping: { method: "courier", country: "EE", address: { addr: "Testitänav 1", zip: "10111", city: "Tallinn" } },
    payment: { method: "invoice" },
    company: COMPANY,
    ...over,
  } as Parameters<typeof createOrder>[0];
}

/**
 * Rewrite the invoice's dates so «today» is `daysAfterDue` days past the due
 * date — the calendar, moved. Deliberately re-reads the row first: the stamps
 * the run itself writes (`remindedAt`) live in the same blob, and rewriting
 * from a stale in-memory copy would quietly hand the job a clean slate.
 */
async function ageInvoice(id: string, daysAfterDue: number, dueDays = 7): Promise<void> {
  const inv = invoiceOf(await getOrder(id))!;
  const dueAt = addDays(tallinnDate(), -daysAfterDue);
  await saveInvoiceRecord(id, { ...inv, issueDate: addDays(dueAt, -dueDays), dueAt, dueDays });
}

function sinkClear(): void {
  (globalThis as unknown as { __rempireMailSink?: unknown[] }).__rempireMailSink = [];
}

function mailsOf(template: string) {
  return capturedMail().filter((m) => m.template === template);
}

describe("the reminder and the cancellation letters render", () => {
  const order = { number: "R-100042", customer_name: "Mari", lang: "ru" };

  it("the reminder names the invoice, the amount, the IBAN and the cancellation date", () => {
    const mail = renderInvoiceReminder(
      order,
      {
        invoice: { number: "A-2026-0007", dueAt: "2026-09-13" },
        seller: { name: "Rempire Store OÜ", iban: "EE38 2200 2210 2014 5685", bankName: "Swedbank" },
        totals: { total: 95 },
        cancelAt: "2026-09-20",
      },
      "ru",
    );
    expect(mail.subject).toContain("A-2026-0007");
    for (const needle of ["A-2026-0007", "R-100042", "13.09.2026", "EE38", "20.09.2026"]) {
      expect(mail.text).toContain(needle);
    }
    // the reference a bank statement is matched on: order number, invoice number
    expect(mail.text).toContain("R-100042, A-2026-0007");
  });

  it("the reminder changes its first line once the due date has passed, and drops the threat when auto-cancel is off", () => {
    const base = {
      invoice: { number: "A-2026-0007", dueAt: "2026-09-13" },
      seller: { name: "Rempire Store OÜ", iban: "EE38 2200 2210 2014 5685", bankName: "Swedbank" },
      totals: { total: 95 },
    };
    const soon = renderInvoiceReminder(order, { ...base, cancelAt: "2026-09-20" }, "ru");
    const late = renderInvoiceReminder(order, { ...base, cancelAt: null, overdue: true }, "ru");
    expect(soon.text).toContain("Срок оплаты — 13.09.2026");
    expect(late.text).toContain("уже прошёл");
    // nothing is threatened that the settings do not actually do
    expect(late.text).not.toContain("будет отменён");
  });

  it("the cancellation letter says it is cancelled, not that money is owed", () => {
    const mail = renderInvoiceCancelled(
      { ...order, status: "cancelled" },
      { invoice: { number: "A-2026-0007", dueAt: "2026-09-13" }, totals: { total: 95 } },
      "ru",
    );
    expect(mail.subject).toContain("R-100042");
    expect(mail.text).toContain("не был оплачен до 13.09.2026");
    expect(mail.text).toContain("вернулись в продажу");
    // the recovery path for a transfer that crossed the letter in the post
    expect(mail.text).toContain("ответьте на это письмо");
    // never a demand
    expect(mail.text).not.toContain("Оплатить до");
  });
});

describe("the daily walk", () => {
  beforeAll(async () => {
    await setupDb();
    for (const k of ENV_KEYS) saved[k] = process.env[k];
    delete process.env.RESEND_API_KEY; // every send is skipped and recorded by the sink
    process.env.E2E_BOOTSTRAP = "1";
    process.env.SESSION_SECRET = TEST_SECRET;
  });
  afterAll(async () => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    await teardownDb();
  });
  beforeEach(async () => {
    await truncateAll();
    await query("truncate invoice_counters");
    sinkClear();
    // an IBAN, or no invoice letter goes out at all (invoiceSendBlock)
    await setSetting("content", { company: { iban: "EE38 2200 2210 2014 5685", bankName: "Swedbank" } });
  });

  it("does nothing at all while both intervals are off", async () => {
    await setSetting("invoice", { remindBeforeDays: 0, cancelAfterDays: 0 });
    const order = await createOrder(invoiceOrderInput());
    await ageInvoice(order.id, 30);
    sinkClear();

    expect(await runInvoiceDunning()).toMatchObject({ reminded: 0, cancelled: 0, reason: "disabled" });
    expect((await getOrder(order.id))?.status).toBe("new");
    expect(capturedMail()).toHaveLength(0);
  });

  it("says nothing on the day the invoice was issued, then reminds once — and only once", async () => {
    const order = await createOrder(invoiceOrderInput());
    sinkClear();

    // day 0: five days still to go, and the invoice letter left this morning
    expect(await runInvoiceDunning()).toMatchObject({ reminded: 0, cancelled: 0, skipped: 1 });
    expect(mailsOf("invoice-reminder")).toHaveLength(0);

    // day 5 of 7 — the reminder's own window (remindBeforeDays = 2)
    await ageInvoice(order.id, -2);
    expect(await runInvoiceDunning()).toMatchObject({ reminded: 1, cancelled: 0 });
    const reminders = mailsOf("invoice-reminder");
    expect(reminders).toHaveLength(1);
    expect(reminders[0].to).toEqual([COMPANY.email]);
    const inv = invoiceOf(await getOrder(order.id))!;
    expect(inv.remindedAt).toBeTruthy();
    // the same PDF rides along, so a lost first letter costs nobody a phone call
    expect(reminders[0].attachments).toEqual([`rempire-invoice-${inv.number}.pdf`]);

    // the cron runs again an hour later, and the day after that
    await runInvoiceDunning();
    await ageInvoice(order.id, -1);
    await runInvoiceDunning();
    expect(mailsOf("invoice-reminder")).toHaveLength(1);

    // and the order has not moved
    expect((await getOrder(order.id))?.status).toBe("new");
  });

  it("cancels seven days past the due date, tells the company, and leaves an audit row", async () => {
    const order = await createOrder(invoiceOrderInput());
    const number = invoiceOf(order)!.number;

    // one day short of the interval: still open, still nobody's business
    await ageInvoice(order.id, 6);
    sinkClear();
    expect(await runInvoiceDunning()).toMatchObject({ cancelled: 0 });
    expect((await getOrder(order.id))?.status).toBe("new");

    await ageInvoice(order.id, 7);
    expect(await runInvoiceDunning()).toMatchObject({ reminded: 0, cancelled: 1 });

    const closed = (await getOrder(order.id))!;
    expect(closed.status).toBe("cancelled");
    expect(invoiceOf(closed)?.cancelledAt).toBeTruthy();
    // the number is kept: a cancelled order does not un-issue its invoice
    expect(invoiceOf(closed)?.number).toBe(number);

    const letters = mailsOf("invoice-cancelled");
    expect(letters).toHaveLength(1);
    expect(letters[0].to).toEqual([COMPANY.email]);
    expect(letters[0].subject).toContain(closed.number);

    const audit = await query<{ action: string }>("select action from admin_audit order by id");
    expect(audit.map((a) => a.action)).toContain("invoice.cancelled");
    // and a second run has nothing left to do
    expect(await runInvoiceDunning()).toMatchObject({ reminded: 0, cancelled: 0 });
  });

  it("never touches an invoice that was marked paid, however overdue it looks", async () => {
    const order = await createOrder(invoiceOrderInput());
    await move({ productId: plain.id, delta: 10, reason: "goods_in" });

    const { markInvoicePaid } = await import("@/lib/invoices");
    await markInvoicePaid((await getOrder(order.id))!, { setOrderPayment, setOrderStatus }, "admin");
    const paid = (await getOrder(order.id))!;
    expect(paid.status).toBe("paid");
    // paying took the stock, exactly as a card payment would
    expect((await getLevel(plain.id, ""))?.qty).toBe(8);

    // wind the calendar a month past the due date and run the job twice
    await ageInvoice(order.id, 30);
    sinkClear();
    await runInvoiceDunning();
    await runInvoiceDunning();

    const after = (await getOrder(order.id))!;
    expect(after.status).toBe("paid");
    expect(invoiceOf(after)?.cancelledAt).toBeNull();
    expect(invoiceOf(after)?.remindedAt).toBeNull();
    expect(mailsOf("invoice-reminder")).toHaveLength(0);
    expect(mailsOf("invoice-cancelled")).toHaveLength(0);
    // no stock came back — the goods are sold and on their way
    expect((await getLevel(plain.id, ""))?.qty).toBe(8);
  });

  it("returns stock exactly like «Отменён» does — which for an unpaid invoice is nothing", async () => {
    await move({ productId: plain.id, delta: 10, reason: "goods_in" });
    const order = await createOrder(invoiceOrderInput());
    // an unpaid invoice never took the shelf: that happens on the paid transition
    expect((await getLevel(plain.id, ""))?.qty).toBe(10);

    await ageInvoice(order.id, 9);
    await runInvoiceDunning();

    expect((await getOrder(order.id))?.status).toBe("cancelled");
    expect((await getLevel(plain.id, ""))?.qty).toBe(10);
    // and no phantom 'return' move was written for stock nobody had taken
    expect(await listMoves({ productId: plain.id, reason: "return" })).toHaveLength(0);
  });

  it("honours the owner's own intervals rather than the defaults", async () => {
    await setSetting("invoice", { prefix: "A-", dueDays: 14, remindBeforeDays: 7, cancelAfterDays: 30 });
    const order = await createOrder(invoiceOrderInput());
    expect(invoiceOf(order)?.dueDays).toBe(14);
    sinkClear();

    // ten days before the due date is outside a seven-day warning
    await ageInvoice(order.id, -10, 14);
    expect(await runInvoiceDunning()).toMatchObject({ reminded: 0 });
    await ageInvoice(order.id, -6, 14);
    expect(await runInvoiceDunning()).toMatchObject({ reminded: 1 });

    // a week overdue is nowhere near the owner's month
    await ageInvoice(order.id, 7, 14);
    expect(await runInvoiceDunning()).toMatchObject({ cancelled: 0 });
    await ageInvoice(order.id, 30, 14);
    expect(await runInvoiceDunning()).toMatchObject({ cancelled: 1 });
  });

  it("rides along in the cron's own report", async () => {
    const order = await createOrder(invoiceOrderInput());
    await ageInvoice(order.id, 10);
    sinkClear();

    const report = await runFlows();
    expect(report.invoices).toMatchObject({ cancelled: 1 });
    // the other three flows are untouched by this and stay off with no settings
    expect(report.abandoned.reason).toBe("disabled");
    expect((await getOrder(order.id))?.status).toBe("cancelled");
  });
});
