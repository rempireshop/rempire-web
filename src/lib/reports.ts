/**
 * The accountant export — GET /api/admin/reports/orders.
 *
 * Three independent pieces, kept together because nothing here needs its own
 * file: the date-range/VAT math (pure, unit-tested directly), a hand-rolled
 * CSV writer (BOM + `;` delimiter — the Excel-friendly fallback the task
 * calls for) and a hand-rolled, dependency-free .xlsx writer (the `xlsx` npm
 * package is ~7.5 MB unpacked — far past the "≤ 1 MB or write CSV instead"
 * rule this task was given, so this writes the OOXML zip by hand instead:
 * `node:zlib` for deflate, a table-based CRC32, and the three-file ZIP
 * structure Excel expects — no new dependency).
 *
 * The row shape is deliberately flat (ReportOrderRow) so the CSV writer, the
 * xlsx writer and the JSON summary all consume exactly the same data.
 */
import { deflateRawSync } from "node:zlib";
import { query } from "@/lib/db";
/* What has actually gone back on an order — the same reader the refund route
   and src/lib/payments/settle.ts use, so the export cannot disagree with the
   order card about how much of a payment was reversed. A pure module: no db,
   no import back into this one. */
import { refundedTotal } from "@/lib/payments/refund";
/* Which day — and therefore which MONTH — an order belongs to: the Tallinn
   calendar, because the month this file exports is the month the accountant
   files. See src/lib/day.ts. */
import { shopDay, shopDayStart } from "@/lib/day";

/* ---------- VAT ------------------------------------------------------------
 * Estonia's standard VAT rate has been 24% since 1 July 2025 (raised from
 * 22%) — settings.vat_rate lets the owner correct this without a deploy if
 * the rate changes again; DEFAULT_VAT_RATE is only the fallback when that
 * setting has never been touched. */

export const DEFAULT_VAT_RATE = 24;

/** Clamped to a sane percentage; anything unusable falls back to the default. */
export function resolveVatRate(raw: unknown): number {
  // `raw == null` first: Number(null) is 0 (a valid rate!) in JS, so "not set
  // at all" has to be caught before the numeric coercion, not after.
  if (raw == null) return DEFAULT_VAT_RATE;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return DEFAULT_VAT_RATE;
  return Math.round(n * 100) / 100;
}

/**
 * Rempire's prices are VAT-inclusive (what the shopper pays is `total`), so
 * the net figure is backed out of it: net = total / (1 + rate/100).
 * Both figures are rounded to the cent independently, and vat is then
 * whatever makes them add back up to the (also rounded) total — the
 * common "the two parts must foot to the whole" rule for a VAT split.
 */
export function vatSplit(total: number, ratePercent: number): { net: number; vat: number } {
  const t = Math.round((Number(total) || 0) * 100) / 100;
  const net = Math.round((t / (1 + ratePercent / 100)) * 100) / 100;
  const vat = Math.round((t - net) * 100) / 100;
  return { net, vat };
}

/* ---------- date range ------------------------------------------------------ */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * "YYYY-MM" → the half-open range [first of month, first of next month), as
 * two `YYYY-MM-DD` days on the ESTONIAN calendar — listReportOrders() below
 * turns each into the instant Tallinn midnight happened.
 *
 * The two bounds used to reach Postgres as `$2::timestamptz`, which resolves
 * in whatever zone the database session is set to. On the UTC deployment that
 * put every month's window three hours late at both ends (two in winter), so
 * the first three hours of each month were filed under the month before: an
 * order placed at 01:00 on 1 September, Tallinn time, came out in AUGUST's
 * export, and one placed at 01:00 on 1 October came out in September's. The
 * row's own `date` column agreed with it, so nothing on the sheet said the
 * month had been cut anywhere but on the Estonian calendar.
 */
/* Years a shop's accounting export can plausibly ask for. Outside this the
   value is a typo or a probe, and Postgres would refuse it anyway. */
const MIN_YEAR = 1970;
const MAX_YEAR = 2999;

export function monthRange(month: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(month ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  const mon = Number(m[2]); // 1-12
  const from = `${year}-${pad2(mon)}-01`;
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMon = mon === 12 ? 1 : mon + 1;
  const to = `${nextYear}-${pad2(nextMon)}-01`;
  return { from, to };
}

/** Explicit `from`/`to` query params — `to` is treated as inclusive, so it is pushed one day out for the SQL `<` bound. */
export function explicitRange(fromRaw: string, toRaw: string): { from: string; to: string } | null {
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const from = String(fromRaw ?? "").trim();
  const to = String(toRaw ?? "").trim();
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) return null;
  const fromD = new Date(`${from}T00:00:00.000Z`);
  const toD = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime()) || toD < fromD) return null;
  /* `from` used to go into the SQL exactly as typed while only `to` was
     rebuilt from its Date. "2026-02-30" parses in JS (it rolls into March)
     but is "date/time field value out of range" to Postgres, and year 0000
     does not exist there at all — both arrived as a 503 rather than a 400.
     Round-tripping each date through its own Date is the check. */
  if (fromD.toISOString().slice(0, 10) !== from || toD.toISOString().slice(0, 10) !== to) return null;
  if (fromD.getUTCFullYear() < MIN_YEAR || toD.getUTCFullYear() > MAX_YEAR) return null;
  toD.setUTCDate(toD.getUTCDate() + 1);
  return { from, to: toD.toISOString().slice(0, 10) };
}

/* ---------- DB read ---------------------------------------------------------- */

export interface ReportOrderRow {
  number: string;
  date: string;
  customerName: string;
  customerEmail: string;
  country: string;
  channel: string;
  /** orders.shipping.method — parcel | courier | pickup | digital | "". */
  deliveryMethod: string;
  subtotal: number;
  shipping: number;
  discount: number;
  discountCode: string;
  /* orders.loyalty_discount (migration 100) — «Использовать баллы» at the
     checkout. Its own column in the table and its own column here, because
     total = subtotal + shipping − discount − loyalty_discount: without it the
     sheet's own arithmetic does not foot on any order that spent points. */
  loyaltyDiscount: number;
  total: number;
  /* What of this order's money has gone back — a partial refund recorded on
     the payment blob, or the whole total once the order is `refunded`. `total`
     is left exactly as invoiced; this is the reversal beside it, and what
     summarize() takes off the month's «Выручка» and «НДС». */
  refunded: number;
  vatRate: number;
  vatAmount: number;
  totalExclVat: number;
  paymentProvider: string;
  paymentRef: string;
  status: string;
  /* «По счёту — для компаний» (migration 141): the invoice number and the
     buyer's company, so the accountant can match the transfer to the order.
     Optional in the type — a row from before the column existed, or a test
     fixture, simply has none — and "" in the export. */
  invoiceNumber?: string;
  invoiceDue?: string;
  company?: string;
  companyRegCode?: string;
  companyVatNumber?: string;
}

type RawRow = {
  number: string;
  created_at: string | Date;
  name: string | null;
  email: string | null;
  shipping: unknown;
  subtotal: string | number;
  shipping_price: string | number;
  discount: string | number;
  discount_code: string | null;
  loyalty_discount?: string | number | null;
  total: string | number;
  payment: unknown;
  status: string;
  channel?: string | null;
  company?: unknown;
  invoice?: unknown;
};

/** "Paid" for accounting purposes: reached payment, whatever happened after
 *  (shipped, delivered — the two fulfilment steps of src/lib/orders.ts — or
 *  refunded, which is still worth a line so the accountant sees the reversal). */
const REPORTABLE_STATUSES = ["paid", "shipped", "delivered", "refunded"];

let channelColCache: { at: number; has: boolean } | null = null;
const CHANNEL_CACHE_MS = 5 * 60_000;

/**
 * Whether `orders.channel` exists yet. A plain information_schema lookup
 * rather than "run the query and catch the error" — an explicit existence
 * check cannot leave a failed statement's connection state to guess about,
 * and it means the very same SQL runs whether or not the inventory agent's
 * POS work has landed (docs/assistant-work.md has the full story).
 */
export async function ordersHasChannelColumn(): Promise<boolean> {
  const now = Date.now();
  if (channelColCache && now - channelColCache.at < CHANNEL_CACHE_MS) return channelColCache.has;
  let has = false;
  try {
    const rows = await query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_name = 'orders' and column_name = 'channel'`,
    );
    has = rows.length > 0;
  } catch {
    has = false;
  }
  channelColCache = { at: now, has };
  return has;
}

/** Tests only — the cache would otherwise survive across a migrate/drop in the same process. */
export function resetChannelColumnCache(): void {
  channelColCache = null;
}

function jsonOf<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/**
 * How much of this order's money went back, capped at what it invoiced.
 *
 * Two independent records, because the shop has two ways of giving money back
 * and until 14.09.2026 the export saw neither:
 *
 *   · a PARTIAL refund («Вернуть деньги» for less than the whole, or one made
 *     in Montonio's portal) is written only to payment.refunds — the order
 *     keeps status `paid` and its original total, so «Выручка» and «НДС» went
 *     on counting money the shop no longer had;
 *   · a FULL one moves the status to `refunded`, and REPORTABLE_STATUSES keeps
 *     the row deliberately (the accountant wants to see the reversal) — but
 *     nothing ever subtracted it. A refund handed over in cash and marked by
 *     hand writes no refund entry at all, so the status is the whole record.
 *
 * Capped at `total`: a refund paid back onto the gift card that bought the
 * order (refund.ts `to: "giftcard"`) can exceed the money line, which was
 * never revenue to begin with — it must not turn a month's takings negative.
 */
function refundedOf(payment: unknown, status: string, total: number): number {
  const recorded = refundedTotal(payment);
  const whole = status === "refunded" ? total : 0;
  return Math.min(total, Math.max(0, recorded, whole));
}

function toReportRow(r: RawRow, vatRate: number): ReportOrderRow {
  const shipping = jsonOf<{ country?: string; method?: string }>(r.shipping, {});
  const payment = jsonOf<{ provider?: string; ref?: string; refunds?: unknown }>(r.payment, {});
  const company = jsonOf<{ name?: string; regCode?: string; vatNumber?: string } | null>(r.company, null) ?? {};
  const invoice = jsonOf<{ number?: string; dueAt?: string } | null>(r.invoice, null) ?? {};
  const total = num(r.total);
  const { net, vat } = vatSplit(total, vatRate);
  return {
    number: r.number,
    // the day the shop had, not the day Greenwich had — an evening order must
    // not be dated to the day before on the accountant's line
    date: shopDay(r.created_at),
    customerName: r.name ?? "",
    customerEmail: r.email ?? "",
    country: shipping.country ?? "",
    channel: r.channel || "web",
    /* An all-gift-card order ships nothing and is billed no delivery
       («Электронная доставка» in the panel) — without this column a 0 in
       `Shipping` reads the same as free delivery on a real parcel, and the
       accountant cannot tell a posted order from an e-mailed one. */
    deliveryMethod: shipping.method ?? "",
    subtotal: num(r.subtotal),
    shipping: num(r.shipping_price),
    discount: num(r.discount),
    discountCode: r.discount_code ?? "",
    loyaltyDiscount: num(r.loyalty_discount),
    total,
    refunded: refundedOf(payment, r.status, total),
    vatRate,
    vatAmount: vat,
    totalExclVat: net,
    paymentProvider: payment.provider ?? "",
    paymentRef: payment.ref ?? "",
    status: r.status,
    invoiceNumber: typeof invoice.number === "string" ? invoice.number : "",
    invoiceDue: typeof invoice.dueAt === "string" ? invoice.dueAt : "",
    company: typeof company.name === "string" ? company.name : "",
    companyRegCode: typeof company.regCode === "string" ? company.regCode : "",
    companyVatNumber: typeof company.vatNumber === "string" ? company.vatNumber : "",
  };
}

/** The SELECT list, with or without `channel` — split out so the "does this
 *  code still work when the column is absent" question is a pure, DB-free
 *  test (tests/reports.test.ts) rather than one that has to drop a column
 *  `orders.ts`'s own createOrder() now hard-depends on existing. */
export function reportOrderColumns(hasChannel: boolean): string {
  return `number, created_at, name, email, shipping, subtotal, shipping_price, discount, discount_code, loyalty_discount, total, payment, status, company, invoice${hasChannel ? ", channel" : ""}`;
}

/**
 * `to` is an exclusive upper bound (YYYY-MM-DD) — see monthRange/explicitRange.
 *
 * Both bounds are bound as the INSTANT Tallinn midnight of that day happened,
 * not as a bare date string for `::timestamptz` to resolve against the
 * session's zone. That is what makes the window the owner's month whatever the
 * database is set to, and what makes `>= from` and `< to` mean the same thing
 * as the `date` column each row is reported under (shopDay, above).
 */
export async function listReportOrders(from: string, to: string, vatRate: number): Promise<ReportOrderRow[]> {
  const hasChannel = await ordersHasChannelColumn();
  const rows = await query<RawRow>(
    `select ${reportOrderColumns(hasChannel)} from orders
     where status = any($1) and created_at >= $2 and created_at < $3
     order by created_at asc, number asc`,
    [REPORTABLE_STATUSES, shopDayStart(from), shopDayStart(to)],
  );
  return rows.map((r) => toReportRow(r, vatRate));
}

/**
 * The «Заказы · Выручка · НДС» card above the download buttons.
 *
 * `revenue` and `vat` are NET OF REFUNDS — what the shop kept and what it owes
 * the tax office on it. Until 14.09.2026 they were the gross of every
 * reportable row, refunded ones included, so a month in which Renat gave an
 * order back still reported its money as takings and its VAT as due.
 * `refunded` is the reversal itself, so the card can name it instead of
 * leaving the owner to wonder why the figure moved.
 */
export function summarize(rows: ReportOrderRow[]): { orders: number; revenue: number; vat: number; refunded: number } {
  const cents = (n: number) => Math.round(n * 100) / 100;
  const refunded = cents(rows.reduce((s, r) => s + r.refunded, 0));
  const revenue = cents(rows.reduce((s, r) => s + r.total - r.refunded, 0));
  // the VAT goes back with the money it was charged on, at that row's own rate
  const vat = cents(rows.reduce((s, r) => s + r.vatAmount - vatSplit(r.refunded, r.vatRate).vat, 0));
  return { orders: rows.length, revenue, vat, refunded };
}

/* ---------- CSV --------------------------------------------------------------- */

export const REPORT_COLUMNS: Array<[key: keyof ReportOrderRow, header: string]> = [
  ["number", "Order"],
  ["date", "Date"],
  ["customerName", "Customer"],
  ["customerEmail", "E-mail"],
  ["country", "Country"],
  ["channel", "Channel"],
  ["deliveryMethod", "Delivery"],
  ["subtotal", "Subtotal"],
  ["shipping", "Shipping"],
  ["discount", "Discount"],
  ["discountCode", "Discount code"],
  ["loyaltyDiscount", "Points"],
  ["total", "Total"],
  ["refunded", "Refunded"],
  ["vatRate", "VAT %"],
  ["vatAmount", "VAT amount"],
  ["totalExclVat", "Total excl. VAT"],
  ["paymentProvider", "Payment provider"],
  ["paymentRef", "Payment ref"],
  ["status", "Status"],
  ["invoiceNumber", "Invoice"],
  ["invoiceDue", "Invoice due"],
  ["company", "Company"],
  ["companyRegCode", "Company reg. code"],
  ["companyVatNumber", "Company VAT no"],
];

const NUMERIC_COLUMNS = new Set<keyof ReportOrderRow>([
  "subtotal", "shipping", "discount", "loyaltyDiscount", "total", "refunded", "vatRate", "vatAmount", "totalExclVat",
]);

/**
 * Excel and LibreOffice treat a cell that opens with =, +, @, a tab or a CR as
 * a formula, and a "-" that is not a number the same way. Both exports below
 * carry text a customer typed (their own name, a company, an order note), so
 * without this a shopper could call themselves =HYPERLINK(...) and have the
 * owner's own spreadsheet run it on open. An apostrophe is the standard
 * defusing: Excel shows the text and evaluates nothing.
 */
function defuseFormula(s: string): string {
  if (!s) return s;
  if (/^[=+@\t\r]/.test(s)) return "'" + s;
  // a plain negative number is a number, not a formula
  if (s.startsWith("-") && !/^-\d+(\.\d+)?$/.test(s)) return "'" + s;
  return s;
}

function csvCell(v: string | number, delimiter: string): string {
  const s = typeof v === "number" ? v.toFixed(2) : defuseFormula(String(v ?? ""));
  if (s.includes(delimiter) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * `;` delimiter, not `,`: Excel on an Estonian or Russian Windows install
 * (this shop's own admin) opens a plain double-clicked .csv using the
 * regional "list separator", which is `;` in both locales — a comma-split
 * file would land every column in cell A. UTF-8 BOM so accented/Cyrillic
 * text (customer names) renders instead of mojibake-ing on open.
 */
export function ordersToCsv(rows: ReportOrderRow[], delimiter = ";"): string {
  const BOM = String.fromCharCode(0xfeff);
  const header = REPORT_COLUMNS.map(([, h]) => csvCell(h, delimiter)).join(delimiter);
  const lines = rows.map((r) =>
    REPORT_COLUMNS.map(([key]) => csvCell(r[key] as string | number, delimiter)).join(delimiter),
  );
  return BOM + [header, ...lines].join("\r\n") + "\r\n";
}

/* ---------- xlsx (hand-rolled, no dependency) --------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

function dosDateTime(d = new Date()): { time: number; date: number } {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

/** A minimal, correct ZIP (store-or-deflate, no zip64) — everything a small .xlsx needs. */
export function buildZip(entries: ZipEntry[]): Buffer {
  const { time, date } = dosDateTime();
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const deflated = deflateRawSync(entry.data);
    const useStore = deflated.length >= entry.data.length;
    const method = useStore ? 0 : 8;
    const payload = useStore ? entry.data : deflated;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, end]);
}

function colLetter(idx0: number): string {
  let n = idx0 + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const XML_CONTROL_CHARS_RE = new RegExp(
  "[" + String.fromCharCode(0) + "-" + String.fromCharCode(8) + String.fromCharCode(11) + String.fromCharCode(12) +
    String.fromCharCode(14) + "-" + String.fromCharCode(31) + "]",
  "g",
);

/** XML 1.0 forbids C0 control characters (even escaped) other than tab/LF/CR. */
function xmlEscape(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(XML_CONTROL_CHARS_RE, "");
}

function cellXml(colIdx: number, rowIdx: number, value: string | number): string {
  const ref = colLetter(colIdx) + rowIdx;
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`;
}

function sheetXml(headers: string[], rows: Array<Array<string | number>>): string {
  const body: string[] = [];
  body.push(`<row r="1">${headers.map((h, i) => cellXml(i, 1, h)).join("")}</row>`);
  rows.forEach((row, ri) => {
    body.push(`<row r="${ri + 2}">${row.map((v, ci) => cellXml(ci, ri + 2, v)).join("")}</row>`);
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body.join("")}</sheetData></worksheet>`;
}

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

/** Excel's own rules for a tab name: at most 31 characters, none of []*?/\ */
function workbookXml(sheetName: string): string {
  const name = xmlEscape(String(sheetName || "Sheet1").replace(/[[\]*?/\\:]/g, " ").trim().slice(0, 31) || "Sheet1");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${name}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

const WORKBOOK_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`;

/**
 * One sheet, a header row and the rows under it, as a real .xlsx — the whole
 * OOXML package, still without a dependency. Any export that has a flat table
 * can use it: the accountant's orders below, and «Клиенты» (customersToXlsx
 * in src/lib/loyalty.ts), which is what Dim asked for on 13.09.2026 — «an
 * excel would be better, CSV hard to read».
 *
 * A number in a cell is written as a number, so Excel sums it without anyone
 * re-typing the column; a string stays a string, which is why an order number
 * or a phone keeps its leading zero.
 */
export function buildXlsx(sheetName: string, headers: string[], rows: Array<Array<string | number>>): Buffer {
  return buildZip([
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES_XML, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(ROOT_RELS_XML, "utf8") },
    { name: "xl/workbook.xml", data: Buffer.from(workbookXml(sheetName), "utf8") },
    { name: "xl/_rels/workbook.xml.rels", data: Buffer.from(WORKBOOK_RELS_XML, "utf8") },
    { name: "xl/styles.xml", data: Buffer.from(STYLES_XML, "utf8") },
    { name: "xl/worksheets/sheet1.xml", data: Buffer.from(sheetXml(headers, rows), "utf8") },
  ]);
}

export function ordersToXlsx(rows: ReportOrderRow[]): Buffer {
  const headers = REPORT_COLUMNS.map(([, h]) => h);
  const dataRows = rows.map((r) =>
    REPORT_COLUMNS.map(([key]) => (NUMERIC_COLUMNS.has(key) ? Number(r[key]) : String(r[key] ?? ""))),
  );
  return buildXlsx("Orders", headers, dataRows);
}
