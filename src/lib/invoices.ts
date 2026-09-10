/**
 * «По счёту — для компаний» — the invoice behind an order paid by bank
 * transfer (docs/payments.md § «Оплата по счёту»).
 *
 * The shape of the flow, end to end:
 *
 *   checkout picks «По счёту» and types the company
 *     → createOrder() stores the company (cleanCompany below) and, instead of
 *       the pending-payment letter, calls issueInvoice():
 *         · a serial number from invoice_counters (nextInvoiceNumber — one
 *           SQL statement, so two orders in the same instant never share one),
 *         · the invoice record on orders.invoice and a pending `payment` blob
 *           {provider:"invoice", ref:<number>},
 *         · the PDF (src/lib/invoice-pdf.ts) attached to the «Счёт на оплату»
 *           letter (src/emails/invoice.ts) — best effort, like every letter;
 *     → the order sits in `new` until the owner presses «Отметить оплаченным»
 *       on the card, which is markInvoicePaid(): the same applyPaymentResult()
 *       door a bank's webhook goes through, so the gift card, the promo code,
 *       the points, the stock and the confirmation letter are settled exactly
 *       once, and never twice.
 *
 * What an Estonian invoice must carry (VAT Act §37, the minimum): seller name,
 * address, registry code and KMKR number; buyer name and address (VAT number
 * when given); a unique sequential number; issue and due dates; lines with
 * description, quantity, unit price, net, VAT rate and amount; net total,
 * VAT total, grand total in EUR; and how to pay. invoiceLines() does the
 * money, sellerGaps() says which seller field is still blank in
 * «Настройки → О компании», and the PDF prints all of it.
 *
 * Prices in the shop include VAT, so every figure here is backed out of the
 * gross line: net = gross / (1 + rate), rounded to the cent, VAT = the rest —
 * the same rule as the accountant export (src/lib/reports.ts vatSplit), so
 * the invoice and the month's report never disagree by a cent.
 */
import { jsonbParam, query } from "@/lib/db";
import { mergeContent, type ShopContent } from "@/lib/content";
import { getSettings, OrderError, writeAuditSafe, type Order } from "@/lib/orders";
import { applyPaymentResult, type ApplyDeps, type ApplyOutcome } from "@/lib/payments/apply";
import { notifyOrderPaid } from "@/lib/payments/mail-hook";
import { translateProductName } from "@/lib/product-name";
import { resolveVatRate } from "@/lib/reports";

/* ---------- settings ------------------------------------------------------ */

/** `settings.invoice` — the number prefix, the payment term and the two dunning intervals. */
export interface InvoiceSettings {
  /** «A-» → A-2026-0001. Letters, digits and dashes, up to 8 characters; may be empty. */
  prefix: string;
  /** Days from the issue date to the due date, 1–60. */
  dueDays: number;
  /**
   * Days BEFORE the due date the reminder letter goes out, 0–30; 0 turns the
   * reminder off. The letter is sent once per invoice (`remindedAt` stamps
   * the record) and never on the day the invoice was issued, so a term
   * shorter than this interval cannot turn the invoice itself into a nag.
   */
  remindBeforeDays: number;
  /**
   * Days PAST the due date after which an unpaid invoice order is cancelled
   * by itself, 0–90; 0 turns the auto-cancel off and the invoice hangs the
   * way it did before, for the owner to cancel by hand.
   */
  cancelAfterDays: number;
}

export const INVOICE_DEFAULTS: InvoiceSettings = { prefix: "A-", dueDays: 7, remindBeforeDays: 2, cancelAfterDays: 7 };

/** A whole number inside [min, max], or the default — the same clamp for every day count. */
function dayCount(raw: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

/** The one door for `settings.invoice`: anything unusable falls back to the default. */
export function cleanInvoiceSettings(raw: unknown): InvoiceSettings {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const prefix =
    typeof o.prefix === "string"
      ? o.prefix.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 8)
      : INVOICE_DEFAULTS.prefix;
  return {
    prefix,
    dueDays: dayCount(o.dueDays, 1, 60, INVOICE_DEFAULTS.dueDays),
    remindBeforeDays: dayCount(o.remindBeforeDays, 0, 30, INVOICE_DEFAULTS.remindBeforeDays),
    cancelAfterDays: dayCount(o.cancelAfterDays, 0, 90, INVOICE_DEFAULTS.cancelAfterDays),
  };
}

/* ---------- the buyer ------------------------------------------------------ */

/** What the checkout asks a company for, stored on orders.company. A type
 *  alias, not an interface: only aliases get the implicit index signature
 *  that lets one be handed to jsonbParam() / Order.company as a plain record. */
export type OrderCompany = {
  name: string;
  /** Registry code — digits only, 8 for an Estonian company, up to 12 elsewhere. */
  regCode: string;
  /** KMKR / VAT number, "" when the buyer has none or did not say. */
  vatNumber: string;
  /** The legal address the invoice is made out to — not where the parcel goes. */
  address: string;
  /** Where the invoice is sent; defaults to the order's e-mail. */
  email: string;
};

const REG_RE = /^[0-9]{8,12}$/;
const VAT_RE = /^[A-Z]{2}[0-9A-Z]{2,14}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** Printable, single-line, trimmed, capped. Control characters never survive. */
function text(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/**
 * Rebuilds the company block from the request, field by field, and refuses
 * what an invoice cannot be made out to. Every code is one the checkout can
 * show next to the field it belongs to.
 */
export function cleanCompany(raw: unknown, fallbackEmail = ""): OrderCompany {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const name = text(o.name, 120);
  if (name.length < 2) throw new OrderError("bad_company");
  const regCode = text(o.regCode, 24).replace(/[\s-]/g, "");
  if (!REG_RE.test(regCode)) throw new OrderError("bad_reg_code");
  const vatNumber = text(o.vatNumber, 24).replace(/[\s-]/g, "").toUpperCase();
  if (vatNumber && !VAT_RE.test(vatNumber)) throw new OrderError("bad_vat_number");
  const address = text(o.address, 300);
  if (address.length < 5) throw new OrderError("bad_company_address");
  const email = (text(o.email, 160) || text(fallbackEmail, 160)).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new OrderError("bad_invoice_email");
  return { name, regCode, vatNumber, address, email };
}

/** The stored block read back — never throws, null for a row without one. */
export function companyOf(v: unknown): OrderCompany | null {
  const o = typeof v === "string" ? safeParse(v) : v;
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const c = o as Record<string, unknown>;
  const name = text(c.name, 120);
  if (!name) return null;
  return {
    name,
    regCode: text(c.regCode, 24),
    vatNumber: text(c.vatNumber, 24),
    address: text(c.address, 300),
    email: text(c.email, 160).toLowerCase(),
  };
}

/** `payment.method === "invoice"` on the checkout's body, and nothing else. */
export function isInvoiceMethod(payment: unknown): boolean {
  return !!payment && typeof payment === "object" && (payment as { method?: unknown }).method === "invoice";
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* ---------- dates ---------------------------------------------------------- */

const TZ = "Europe/Tallinn";

/** The calendar date in Tallinn, `YYYY-MM-DD` — an invoice is dated where the shop is. */
export function tallinnDate(d: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** `YYYY-MM-DD` + n days, on the calendar (no daylight-saving arithmetic). */
export function addDays(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  if (!m) return ymd;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)).toISOString().slice(0, 10);
}

function dayNumber(ymd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  return m ? Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000) : NaN;
}

/* ---------- the number ----------------------------------------------------- */

/** «A-2026-0001»: prefix, the year, a dash, four digits (more when a year has 10 000). */
export function formatInvoiceNumber(prefix: string, year: number, seq: number): string {
  return `${prefix}${year}-${String(seq).padStart(4, "0")}`;
}

/**
 * The next serial number of the year, in one statement. Postgres takes the
 * row lock inside the `on conflict … do update`, so concurrent calls line up
 * and each gets its own number; PGlite is one connection and serialises
 * anyway. The counter never goes backwards — a cancelled order keeps its
 * number, which is what "sequential" means to an auditor.
 */
export async function nextInvoiceNumber(prefix: string, now: Date = new Date()): Promise<string> {
  const year = Number(tallinnDate(now).slice(0, 4));
  const rows = await query<{ last: number | string }>(
    `insert into invoice_counters (year, last) values ($1, 1)
     on conflict (year) do update set last = invoice_counters.last + 1
     returning last`,
    [year],
  );
  return formatInvoiceNumber(prefix, year, Number(rows[0].last));
}

/* ---------- the record ----------------------------------------------------- */

/** orders.invoice — everything about the invoice that is not the order itself.
 *  A type alias for the same index-signature reason as OrderCompany above. */
export type InvoiceRecord = {
  number: string;
  /** ISO timestamp of the allocation. */
  issuedAt: string;
  /** `YYYY-MM-DD`, the date printed on the invoice (Tallinn calendar). */
  issueDate: string;
  /** `YYYY-MM-DD`. */
  dueAt: string;
  dueDays: number;
  /** Percent, frozen at issue time — a rate change later must not reprint an old invoice differently. */
  vatRate: number;
  /** Where the letter went. */
  email: string;
  /** ISO timestamp of the last letter that really went out, null when none did. */
  sentAt: string | null;
  /** Why the last send did not go out (`no_iban`, `no_api_key`, …), "" when it did. */
  sendError: string;
  /** ISO timestamp of «Отметить оплаченным», null while waiting. */
  paidAt: string | null;
  /** ISO timestamp of the one reminder letter, null while none was due (src/lib/invoice-dunning.ts). */
  remindedAt: string | null;
  /** ISO timestamp of the automatic cancellation, null on an invoice nobody cancelled. */
  cancelledAt: string | null;
};

/** The stored record read back — null for an order that has none. */
export function invoiceOf(order: { invoice?: unknown } | null | undefined): InvoiceRecord | null {
  const raw = order?.invoice;
  const o = typeof raw === "string" ? safeParse(raw) : raw;
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  const number = text(r.number, 40);
  if (!number) return null;
  const issuedAt = text(r.issuedAt, 40);
  const dueDays = Math.round(Number(r.dueDays));
  return {
    number,
    issuedAt,
    issueDate: text(r.issueDate, 10) || issuedAt.slice(0, 10),
    dueAt: text(r.dueAt, 10),
    dueDays: Number.isFinite(dueDays) && dueDays > 0 ? dueDays : INVOICE_DEFAULTS.dueDays,
    vatRate: resolveVatRate(r.vatRate),
    email: text(r.email, 160).toLowerCase(),
    sentAt: text(r.sentAt, 40) || null,
    sendError: text(r.sendError, 80),
    paidAt: text(r.paidAt, 40) || null,
    remindedAt: text(r.remindedAt, 40) || null,
    cancelledAt: text(r.cancelledAt, 40) || null,
  };
}

/** Whole days past the due date, 0 while it is not yet due (or already paid). */
export function invoiceOverdueDays(invoice: InvoiceRecord | null | undefined, now: Date = new Date()): number {
  if (!invoice || invoice.paidAt) return 0;
  const diff = dayNumber(tallinnDate(now)) - dayNumber(invoice.dueAt);
  return Number.isFinite(diff) && diff > 0 ? diff : 0;
}

/**
 * Whole days still left to pay — negative once the due date has passed, NaN
 * for a record without a usable due date. The reminder's own clock; the
 * mirror of invoiceOverdueDays(), which the admin card reads.
 */
export function invoiceDaysLeft(invoice: InvoiceRecord | null | undefined, now: Date = new Date()): number {
  if (!invoice) return Number.NaN;
  return dayNumber(invoice.dueAt) - dayNumber(tallinnDate(now));
}

export async function saveInvoiceRecord(orderId: string, record: InvoiceRecord): Promise<void> {
  await query("update orders set invoice = $2::jsonb, updated_at = now() where id = $1", [orderId, jsonbParam(record)]);
}

/* ---------- the seller ----------------------------------------------------- */

/** Who issues the invoice — `settings.content.company`, «Настройки → О компании». */
export interface InvoiceSeller {
  name: string;
  regCode: string;
  vatNumber: string;
  address: string;
  email: string;
  phone: string;
  iban: string;
  bankName: string;
}

export function sellerFromContent(content: ShopContent): InvoiceSeller {
  const c = content.company;
  return {
    name: c.legalName,
    regCode: c.regCode,
    vatNumber: c.vatNumber,
    address: c.address,
    email: c.email,
    phone: c.phone,
    iban: c.iban,
    bankName: c.bankName,
  };
}

/** The live details. Best effort: a settings query that fails still gives the built-in Rempire ones. */
export async function invoiceSeller(): Promise<InvoiceSeller> {
  try {
    return sellerFromContent(mergeContent((await getSettings()).content));
  } catch {
    return sellerFromContent(mergeContent());
  }
}

/** The seller fields the law (or the bank) needs that are still blank — for the admin's own warning. */
export function sellerGaps(seller: InvoiceSeller): Array<keyof InvoiceSeller> {
  const out: Array<keyof InvoiceSeller> = [];
  for (const k of ["name", "address", "regCode", "vatNumber", "iban", "bankName"] as const) {
    if (!String(seller[k] || "").trim()) out.push(k);
  }
  return out;
}

/**
 * The one gap that stops a letter rather than merely warning about it.
 *
 * Every other blank field makes an invoice incomplete; a blank IBAN makes it
 * **unpayable** — a numbered demand for money with nowhere to send it, which
 * is worse than no letter at all, because the company believes it has been
 * invoiced and the shop believes it is waiting for a transfer. So the send is
 * refused here, at the one door every invoice letter goes through, and the
 * reason («no_iban») is written onto the record: the order card says the
 * letter did not go out and why, the admin's own «Сделать сегодня» says the
 * IBAN is missing, and «Отправить счёт ещё раз» sends it the moment Renat
 * fills the field in. The PDF is not blocked — «Скачать счёт» still renders
 * one, marked «— (не указан)», so the owner can see exactly what is missing.
 */
export function invoiceSendBlock(seller: InvoiceSeller): "" | "no_iban" {
  return String(seller.iban || "").trim() ? "" : "no_iban";
}

/* ---------- the money ------------------------------------------------------ */

export type InvoiceLineKind = "item" | "shipping" | "discount";

export interface InvoiceLine {
  kind: InvoiceLineKind;
  title: string;
  qty: number;
  /** Unit price as the shop shows it — VAT included. */
  unitGross: number;
  /** Line total, VAT included; negative on a discount line. */
  gross: number;
  net: number;
  vat: number;
}

export interface InvoiceTotals {
  lines: InvoiceLine[];
  net: number;
  vat: number;
  total: number;
  vatRate: number;
}

function money(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** gross → {net, vat} at the rate, both to the cent, footing to the gross. Sign-safe for a discount. */
export function splitGross(gross: number, ratePercent: number): { net: number; vat: number } {
  const g = money(gross);
  const net = money(g / (1 + ratePercent / 100));
  return { net, vat: money(g - net) };
}

type OrderMoney = Pick<Order, "items" | "subtotal" | "shippingPrice" | "discount" | "loyaltyDiscount" | "total"> & {
  discountCode?: string | null;
};

const LINE_WORDS = {
  shipping: { et: "Tarne", en: "Delivery", ru: "Доставка" },
  discount: { et: "Allahindlus", en: "Discount", ru: "Скидка" },
  points: { et: "Boonuspunktid", en: "Loyalty points", ru: "Баллы" },
} as const;

/** «Tarne / Delivery», plus « / Доставка» on a Russian order — the same rule the PDF headings follow. */
export function bilingual(word: { et: string; en: string; ru: string }, lang: string): string {
  const parts = [word.et, word.en];
  if (String(lang || "").toLowerCase().startsWith("ru")) parts.push(word.ru);
  return parts.join(" / ");
}

/**
 * The lines of the invoice, VAT backed out of every gross figure, and the
 * three totals — which foot exactly to the order's own total, because that
 * is the number the customer is asked to transfer. A discount is a negative
 * line rather than a footnote so the net and VAT totals stay right; it is
 * capped the way createOrder() caps it, at the goods plus delivery.
 */
export function invoiceLines(order: OrderMoney, vatRate: number, lang = "ru"): InvoiceTotals {
  const rate = resolveVatRate(vatRate);
  const lines: InvoiceLine[] = [];
  const items = Array.isArray(order.items) ? order.items : [];
  for (const it of items) {
    const qty = Math.max(1, Math.round(Number(it.qty) || 1));
    const gross = money(Number.isFinite(Number(it.sum)) ? Number(it.sum) : Number(it.price) * qty);
    const unit = money(Number.isFinite(Number(it.price)) ? Number(it.price) : gross / qty);
    // the name goes into the customer's language before the variant is added:
    // «— шампунь · 250 мл» has the tail away from the end, where the rule looks
    const name = typeof it.title === "string" ? translateProductName(it.title, lang) : "";
    const title = [it.brand, name].filter((s) => typeof s === "string" && s.trim()).join(" ") + (it.variant ? ` · ${it.variant}` : "");
    lines.push({ kind: "item", title: title || String(it.id || ""), qty, unitGross: unit, gross, ...splitGross(gross, rate) });
  }
  const shipping = money(Math.max(0, Number(order.shippingPrice) || 0));
  if (shipping > 0) {
    lines.push({ kind: "shipping", title: bilingual(LINE_WORDS.shipping, lang), qty: 1, unitGross: shipping, gross: shipping, ...splitGross(shipping, rate) });
  }
  const goods = money(lines.reduce((s, l) => s + l.gross, 0));
  const discount = money(Math.min(Math.max(0, Number(order.discount) || 0), goods));
  if (discount > 0) {
    const code = typeof order.discountCode === "string" && order.discountCode.trim() ? ` (${order.discountCode.trim()})` : "";
    lines.push({ kind: "discount", title: bilingual(LINE_WORDS.discount, lang) + code, qty: 1, unitGross: -discount, gross: -discount, ...splitGross(-discount, rate) });
  }
  const loyalty = money(Math.min(Math.max(0, Number(order.loyaltyDiscount) || 0), money(goods - discount)));
  if (loyalty > 0) {
    lines.push({ kind: "discount", title: bilingual(LINE_WORDS.points, lang), qty: 1, unitGross: -loyalty, gross: -loyalty, ...splitGross(-loyalty, rate) });
  }
  const net = money(lines.reduce((s, l) => s + l.net, 0));
  const vat = money(lines.reduce((s, l) => s + l.vat, 0));
  const total = money(lines.reduce((s, l) => s + l.gross, 0));
  return { lines, net, vat, total, vatRate: rate };
}

/* ---------- issuing -------------------------------------------------------- */

/** The pending payment record an invoice order carries until the owner marks it paid. */
export function invoicePaymentBlob(order: Pick<Order, "total" | "currency">, invoice: InvoiceRecord): Record<string, unknown> {
  return {
    provider: "invoice",
    method: "invoice",
    ref: invoice.number,
    status: "pending",
    amount: money(Number(order.total) || 0),
    currency: order.currency || "EUR",
    at: invoice.issuedAt,
  };
}

/**
 * Number the order, record the invoice, send it. Called by createOrder() for
 * an order whose payment method is «invoice», once, right after the row is
 * written. Throws only when the number cannot be allocated — an order that
 * exists without a number would be one the owner cannot invoice; the letter
 * and its PDF are best effort, and the card offers «Отправить счёт ещё раз».
 */
export async function issueInvoice(order: Order, now: Date = new Date()): Promise<Order> {
  const settings = await getSettings();
  const conf = cleanInvoiceSettings(settings.invoice);
  const vatRate = resolveVatRate(settings.vat_rate);
  const company = companyOf(order.company);
  const email = (company?.email || order.email || "").toLowerCase();

  const number = await nextInvoiceNumber(conf.prefix, now);
  const issueDate = tallinnDate(now);
  const record: InvoiceRecord = {
    number,
    issuedAt: now.toISOString(),
    issueDate,
    dueAt: addDays(issueDate, conf.dueDays),
    dueDays: conf.dueDays,
    vatRate,
    email,
    sentAt: null,
    sendError: "",
    paidAt: null,
    remindedAt: null,
    cancelledAt: null,
  };
  const payment = invoicePaymentBlob(order, record);
  await query(
    `update orders set invoice = $2::jsonb, payment = coalesce(payment, '{}'::jsonb) || $3::jsonb, updated_at = now()
     where id = $1`,
    [order.id, jsonbParam(record), jsonbParam(payment)],
  );
  let next: Order = { ...order, invoice: record, payment: { ...(order.payment ?? {}), ...payment } };

  const sent = await sendInvoiceMail(next, record);
  if (sent.ok) record.sentAt = new Date().toISOString();
  record.sendError = sent.ok ? "" : String(sent.error || "send_failed");
  try {
    await saveInvoiceRecord(order.id, record);
  } catch (err) {
    console.error("[invoices] sentAt not saved:", err);
  }
  next = { ...next, invoice: record };

  await writeAuditSafe("system", "invoice.issued", {
    orderId: order.id,
    number: order.number,
    invoice: number,
    email,
    sent: sent.ok,
    error: sent.ok ? undefined : sent.error,
  });
  return next;
}

/* ---------- the letter ----------------------------------------------------- */

export interface InvoiceSendResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
  id?: string;
  /** True when nothing was even attempted because the invoice is unpayable — see invoiceSendBlock(). */
  blocked?: boolean;
}

/**
 * «Счёт на оплату» with the PDF attached. Never throws: a Resend outage or a
 * missing font costs the customer the letter or its attachment, never the
 * order — the card shows the failure and offers to send again. A blank IBAN
 * stops it before anything is rendered (invoiceSendBlock above).
 */
export async function sendInvoiceMail(
  order: Order,
  invoice: InvoiceRecord,
  opts: { resend?: boolean } = {},
): Promise<InvoiceSendResult> {
  try {
    const [{ loadBrand }, { sendRendered }, { renderInvoice }, { normalizeLang }] = await Promise.all([
      import("@/lib/mail-hooks"),
      import("@/lib/mail"),
      import("@/emails/invoice"),
      import("@/emails/layout"),
    ]);
    await loadBrand();
    const seller = await invoiceSeller();
    const blocked = invoiceSendBlock(seller);
    if (blocked) return { ok: false, error: blocked, blocked: true };
    const lang = normalizeLang(order.lang);
    const totals = invoiceLines(order, invoice.vatRate, lang);
    const mail = renderInvoice(order, { invoice, seller, totals }, lang);

    let attachment: { filename: string; content: Uint8Array; contentType: string } | null = null;
    try {
      const { buildInvoicePdf, invoicePdfFilename } = await import("@/lib/invoice-pdf");
      const bytes = await buildInvoicePdf(order, invoice, { seller, totals, lang });
      attachment = { filename: invoicePdfFilename(invoice.number), content: bytes, contentType: "application/pdf" };
    } catch (err) {
      console.error("[invoices] PDF failed, sending the letter without it:", err);
    }

    const res = await sendRendered(invoice.email, mail, {
      tags: { template: "invoice", stage: opts.resend ? "resend" : "issued" },
      /* Resend de-duplicates on the key for a day: the first send is keyed on
         the number alone, a deliberate «ещё раз» on the moment it was pressed. */
      idempotencyKey: opts.resend ? `invoice:${invoice.number}:${Date.now()}` : `invoice:${invoice.number}`,
      attachments: attachment ? [attachment] : undefined,
    });
    return { ok: res.ok, skipped: res.skipped, error: res.error, id: res.id };
  } catch (err) {
    console.error("[invoices] sendInvoiceMail failed:", err);
    return { ok: false, error: "exception" };
  }
}

/** «Отправить счёт ещё раз» — the same letter again, the record updated either way. */
export async function resendInvoice(order: Order, actor = "admin"): Promise<{ invoice: InvoiceRecord; sent: InvoiceSendResult }> {
  const invoice = invoiceOf(order);
  if (!invoice) throw new OrderError("no_invoice");
  const sent = await sendInvoiceMail(order, invoice, { resend: true });
  const record: InvoiceRecord = {
    ...invoice,
    sentAt: sent.ok ? new Date().toISOString() : invoice.sentAt,
    sendError: sent.ok ? "" : String(sent.error || "send_failed"),
  };
  await saveInvoiceRecord(order.id, record);
  await writeAuditSafe(actor, "invoice.sent", { orderId: order.id, number: order.number, invoice: invoice.number, email: invoice.email, sent: sent.ok, error: sent.ok ? undefined : sent.error });
  return { invoice: record, sent };
}

/* ---------- «Отметить оплаченным» ----------------------------------------- */

export interface MarkPaidDeps extends Pick<ApplyDeps, "setOrderPayment" | "setOrderStatus"> {
  /** The paid-order side effects on the mail side (letter, ping, gift cards). Injected by the tests. */
  notify?: (order: unknown) => Promise<unknown>;
  writeAudit?: (actor: string, action: string, payload?: unknown) => Promise<unknown>;
  saveInvoice?: (orderId: string, invoice: InvoiceRecord) => Promise<unknown>;
  now?: () => Date;
}

export type MarkPaidOutcome = ApplyOutcome & { invoice: InvoiceRecord | null };

/**
 * The money arrived on the bank statement and the owner says so. Exactly the
 * same event as a provider's "paid" ticket, through the same door
 * (applyPaymentResult): paid is a floor there, so a second press is a no-op —
 * no second letter, no second stock decrement, no second promo use.
 */
export async function markInvoicePaid(
  order: Order,
  deps: MarkPaidDeps,
  actor = "admin",
): Promise<MarkPaidOutcome> {
  const invoice = invoiceOf(order);
  const outcome = await applyPaymentResult(
    order,
    {
      orderRef: order.number,
      status: "paid",
      providerRef: invoice?.number || "invoice",
      amount: money(Number(order.total) || 0),
      currency: order.currency || "EUR",
      detail: "оплата по счёту отмечена в админке",
    },
    "invoice",
    deps,
  );
  if (outcome.status !== "paid" || outcome.alreadyPaid) return { ...outcome, invoice };

  let paid: InvoiceRecord | null = invoice;
  if (invoice) {
    paid = { ...invoice, paidAt: (deps.now ?? (() => new Date()))().toISOString() };
    try {
      await (deps.saveInvoice ?? saveInvoiceRecord)(order.id, paid);
    } catch (err) {
      console.error("[invoices] paidAt not saved:", err);
    }
  }
  await (deps.notify ?? notifyOrderPaid)({
    ...order,
    status: "paid",
    payment: outcome.payment,
    invoice: paid,
    loyaltyEarned: outcome.pointsEarned,
  });
  await (deps.writeAudit ?? writeAuditSafe)(actor, "invoice.paid", {
    orderId: order.id,
    number: order.number,
    invoice: invoice?.number ?? null,
    amount: money(Number(order.total) || 0),
  });
  return { ...outcome, invoice: paid };
}
