/**
 * «Скачать мои данные» and «Удалить аккаунт» — the two GDPR rights a shopper
 * could until 28.09.2026 exercise only by writing to the shop (access and
 * portability, art. 15 and 20; erasure, art. 17). Dim's decision of that day:
 * both go into «Кабинет», at the bottom, under the customer's own session.
 *
 * ---- the export ------------------------------------------------------------
 *
 * exportCustomerData() is everything the shop keeps ABOUT THE ACCOUNT, as the
 * account shows it, in one readable JSON document: the profile, the orders
 * (number, date, status, lines, totals, delivery, payment in words, and the
 * messages exchanged about each), the points lines, the «сообщить о наличии»
 * subscriptions, the reviews, the return requests, the saved basket, the
 * newsletters sent and the stop-list row. English keys and
 * English words for the few coded values; nothing internal — no uuids, no
 * payment references, no session or login secrets, no gift-card codes (a code
 * is a bearer credential, and a file lying in Downloads is no place for one),
 * no gift recipient's data (somebody else's), and not the owner's private
 * notes on the customer card, which the account never shows either.
 *
 * ---- the deletion ----------------------------------------------------------
 *
 * eraseCustomerAccount() in ONE transaction:
 *
 *   deleted      the customers row (and with it, by its foreign key, every
 *                loyalty_ledger line — the points are gone, and the dialog
 *                says so), login_codes, carts, cart_writes, stock_alerts and
 *                newsletter_sends for the address. Each of these exists only
 *                because of the account or its consent.
 *   kept         every order, with the buyer data it carries: the Accounting
 *                Act keeps source documents for seven years. Detached instead
 *                — customer_id → null and `account_erased_at` stamped (223),
 *                so no account screen shows them again, not even a new
 *                account on the same mailbox. Gift cards are bearer codes and
 *                are not touched. order_messages belong to their order.
 *   anonymised   the journal rows the customer wrote themselves (actor = the
 *                address — only «Хочу вернуть заказ» does that) now read
 *                «customer»; the owner's own rows are his record and stay.
 *                And the reviews the account wrote (reviews.email = the address):
 *                the text and the stars stay on the product page, the name
 *                becomes «Покупатель» — the storefront's dictionary already
 *                translates that word — and the address and the rate-limit
 *                hash are cleared. Deleting them would take other shoppers'
 *                reading and the product's rating with it, for text that is
 *                about a product, not a person; the name is the personal part.
 *   written      a mail_optouts row, kind 'account_deleted' (consent.ts keeps
 *                that kind and its date through a later click on an old
 *                letter's link), so no marketing letter, birthday letter or
 *                cart reminder ever goes to the address again. It is also the
 *                deletion's date, which is what tells a session signed in
 *                BEFORE it — another device, still holding its cookie — from
 *                a new one (isErasedSession). Signing in again later makes a
 *                new, empty account with marketing off; the stop list stays
 *                until the person ticks the box again themselves.
 *
 * OPEN ORDERS BLOCK IT. An order that is paid and not yet delivered, or one
 * waiting to be paid by invoice, is a contract still being performed: the
 * customer needs its status and tracking in «Мои заказы», the invoice PDF
 * is only downloadable there, and the shop may need to reach them about it.
 * Deleting the account in the middle of that would leave the customer blind
 * and would not even end the processing (art. 17(3)(b) — the data is still
 * needed for the contract). So the deletion is refused with the order numbers,
 * and the dialog says «когда заказ доставят, удалить можно будет здесь же».
 * Only online orders count (a sale at the counter is handed over there), and
 * only for OPEN_ORDER_DAYS: a parcel that nobody marked «Доставлен» for two
 * months is a record nobody closed, not a delivery in progress, and must not
 * keep somebody's account alive against their will.
 *
 * Nothing in the deletion sends a letter or pings the owner. The owner's
 * journal gets one row, «Покупатель удалил аккаунт», with the numbers of the
 * orders it detached and three counts — never the address (the route writes
 * it after the transaction commits).
 */
import { normalizeEmail, productsForAlerts, type AlertProduct } from "@/lib/customers";
import { query, withTx, type Querier } from "@/lib/db";
import { shopDay } from "@/lib/day";
import { pointsLineOf } from "@/lib/loyalty-lines";
import { returnRequestedAt } from "@/lib/returns";
import { reviewsByCustomer } from "@/lib/reviews";

/** mail_optouts.kind of a deleted account's address — see the header. */
export const ERASED_OPTOUT_KIND = "account_deleted";

/** The name an anonymised review is signed with — a dictionary word on the storefront. */
export const ANON_REVIEW_NAME = "Покупатель";

/** How long an unfinished online order blocks the deletion — see the header. */
export const OPEN_ORDER_DAYS = 60;

/* ---------- open orders ----------------------------------------------------- */

/** One statement for both callers: the preflight read and the check inside the deletion. */
const OPEN_ORDERS_SQL = `
  select number from orders
   where lower(email) = $1
     and account_erased_at is null
     and channel = 'web'
     and created_at > now() - interval '${OPEN_ORDER_DAYS} days'
     and (status in ('paid', 'shipped') or (status = 'new' and invoice is not null))
   order by created_at asc
   limit 20`;

async function openOrdersWith(q: Querier, addr: string): Promise<string[]> {
  const rows = await q<{ number: string }>(OPEN_ORDERS_SQL, [addr]);
  return rows.map((r) => r.number);
}

/**
 * The numbers of the orders that stop this address's account from being
 * deleted today — paid and not delivered, or waiting for an invoice to be
 * paid — oldest first. Empty when nothing does. Throws what the database throws.
 */
export async function openOrdersBlockingErasure(email: string): Promise<string[]> {
  const addr = normalizeEmail(email);
  if (!addr) return [];
  return openOrdersWith(query, addr);
}

/**
 * Was this order detached from its account by a deletion? The account's two
 * per-order doors — the invoice PDF and «Хочу вернуть заказ» — look an order
 * up by number and match its e-mail, so without this a new account on the
 * same mailbox could still reach an order «Мои заказы» no longer lists.
 * They answer `not_found` for it, the same as for a number that does not exist.
 */
export async function isOrderDetached(orderId: string): Promise<boolean> {
  if (!orderId) return false;
  const rows = await query<{ id: string }>(
    "select id from orders where id = $1 and account_erased_at is not null",
    [orderId],
  );
  return rows.length > 0;
}

/* ---------- sessions from before a deletion --------------------------------- */

/**
 * Was this address's account deleted AFTER the session in hand was signed
 * in? True means the cookie is a leftover from before the deletion — the
 * phone deleted the account and the laptop still holds its 90-day token, which
 * nothing on the server can revoke (the token is stateless, src/lib/
 * customers.ts). The account routes then answer 401 and clear the cookie
 * instead of quietly re-creating the row the customer just deleted.
 *
 * Only worth asking when there is NO customers row: a sign-in after the
 * deletion creates one (recordLogin), so a missing row plus a newer deletion
 * can only be a session older than it. `issuedAt` null (no token) is false.
 */
export async function isErasedSession(email: string, issuedAt: number | null): Promise<boolean> {
  const addr = normalizeEmail(email);
  if (!addr || issuedAt == null || !Number.isFinite(issuedAt)) return false;
  const rows = await query<{ at: string | Date }>(
    "select at from mail_optouts where email = $1 and kind = $2",
    [addr, ERASED_OPTOUT_KIND],
  );
  if (!rows.length) return false;
  const at = new Date(rows[0].at as string).getTime();
  return Number.isFinite(at) && at >= issuedAt;
}

/* ---------- the deletion ---------------------------------------------------- */

export type EraseOutcome =
  | {
      ok: true;
      already: false;
      /** The numbers of the orders detached from the account — kept, never deleted. */
      orders: string[];
      /** Reviews that now read «Покупатель». */
      reviews: number;
      /** The points balance that went with the account. */
      points: number;
      /** «Сообщить о наличии» subscriptions removed. */
      alerts: number;
      /** False when there was no customers row to delete (the rest still ran). */
      hadAccount: boolean;
    }
  /** Asked again by a session from before a deletion that already happened — nothing to do. */
  | { ok: true; already: true }
  | { ok: false; error: "open_orders"; orders: string[] };

export interface EraseOptions {
  /** When the caller's session was signed in (sessionIssuedAt) — for the idempotent repeat. */
  sessionIssuedAt?: number | null;
}

/**
 * Deletes the account of `email` — see the header for what goes, what stays
 * and why. One transaction: either all of it happened or none of it did.
 * Refuses (`open_orders`) while an order is still being performed, and answers
 * `already` to a repeat from a session older than a deletion that has happened.
 * Throws what the database throws; the route answers 503.
 */
export async function eraseCustomerAccount(email: string, opts: EraseOptions = {}): Promise<EraseOutcome> {
  const addr = normalizeEmail(email);
  if (!addr) return { ok: true, already: true };
  return withTx<EraseOutcome>(async (q) => {
    /* The row first, locked: two taps of «Удалить» from two tabs queue here
       rather than interleave, and the second one finds no row. */
    const cust = await q<{ id: string }>("select id from customers where email = $1 for update", [addr]);
    const customerId = cust[0]?.id ?? null;

    if (!customerId && opts.sessionIssuedAt != null) {
      const tomb = await q<{ at: string | Date }>(
        "select at from mail_optouts where email = $1 and kind = $2",
        [addr, ERASED_OPTOUT_KIND],
      );
      const at = tomb.length ? new Date(tomb[0].at as string).getTime() : NaN;
      if (Number.isFinite(at) && at >= opts.sessionIssuedAt) return { ok: true, already: true };
    }

    const open = await openOrdersWith(q, addr);
    if (open.length) return { ok: false, error: "open_orders", orders: open };

    let points = 0;
    if (customerId) {
      const bal = await q<{ sum: string | number | null }>(
        "select coalesce(sum(delta), 0) as sum from loyalty_ledger where customer_id = $1",
        [customerId],
      );
      points = Math.trunc(Number(bal[0]?.sum) || 0);
    }

    /* KEPT, detached. By e-mail — that is how the account finds them — and,
       for an order a signed-in customer placed under ANOTHER address, by the
       id alone: that order is not this mailbox's to hide, so it keeps showing
       in the other address's account and only loses its link to this one
       (which the foreign key would drop anyway when the row goes). */
    const detached = await q<{ number: string }>(
      `update orders set account_erased_at = now(), customer_id = null
        where lower(email) = $1 and account_erased_at is null
        returning number`,
      [addr],
    );
    if (customerId) await q("update orders set customer_id = null where customer_id = $1", [customerId]);

    const reviews = await q<{ id: string }>(
      "update reviews set email = null, name = $2, ip_hash = null where email = $1 returning id",
      [addr, ANON_REVIEW_NAME],
    );
    const alerts = await q<{ id: string }>("delete from stock_alerts where email = $1 returning id", [addr]);
    await q("delete from carts where email = $1", [addr]);
    await q("delete from cart_writes where email = $1", [addr]);
    await q("delete from login_codes where email = $1", [addr]);
    await q("delete from newsletter_sends where email = $1", [addr]);
    /* The one kind of journal row the customer wrote themselves — «Хочу
       вернуть заказ», actor = their address (return-request route). The row
       stays, with its order number; the address in it becomes the word. */
    await q("update admin_audit set actor = 'customer' where actor = $1", [addr]);
    // the ledger goes with it — loyalty_ledger.customer_id is `on delete cascade` (100)
    if (customerId) await q("delete from customers where id = $1", [customerId]);

    await q(
      `insert into mail_optouts (email, at, kind, source) values ($1, now(), $2, 'account')
       on conflict (email) do update set at = now(), kind = $2, source = 'account'`,
      [addr, ERASED_OPTOUT_KIND],
    );

    return {
      ok: true,
      already: false,
      orders: detached.map((r) => r.number).sort(),
      reviews: reviews.length,
      points,
      alerts: alerts.length,
      hadAccount: !!customerId,
    };
  });
}

/**
 * The owner's journal row for a deletion — no address, the detached orders'
 * numbers as the line's «what» (auditTextHTML in app.js prints `number`), the
 * counts beside them. Five numbers at most in the line; all of them in `orders`.
 */
export function erasureAuditPayload(out: Extract<EraseOutcome, { already: false }>): Record<string, unknown> {
  const shown = out.orders.slice(0, 5).join(", ");
  const more = out.orders.length > 5 ? ` +${out.orders.length - 5}` : "";
  return {
    ...(out.orders.length ? { number: shown + more } : {}),
    orders: out.orders,
    reviews: out.reviews,
    points: out.points,
    alerts: out.alerts,
  };
}

/* ---------- the export ------------------------------------------------------ */

export interface ExportOrder {
  number: string;
  date: string | null;
  status: string;
  placed: "online" | "in the salon";
  items: Array<{ product: string; variant: string | null; quantity: number; unitPrice: number; total: number }>;
  subtotal: number;
  delivery: {
    method: string;
    country: string | null;
    carrier: string | null;
    pickupPoint: string | null;
    address: { street: string; postcode: string; city: string } | null;
    price: number;
    tracking: string | null;
  };
  discount: number;
  discountCode: string | null;
  pointsDiscount: number;
  total: number;
  currency: string;
  payment: string | null;
  refunded: number;
  refundPending: number;
  buyer: { name: string; email: string; phone: string };
  company: Record<string, string> | null;
  invoiceNumber: string | null;
  returnRequestedAt: string | null;
  /** The correspondence about this order the owner keeps under it — the customer's words and the shop's replies. */
  messages: Array<{ from: "you" | "the shop"; subject: string | null; text: string; date: string | null }>;
}

export interface AccountExport {
  format: "rempire-account-data";
  version: 1;
  exportedAt: string;
  email: string;
  profile: Record<string, unknown> | null;
  orders: ExportOrder[];
  loyaltyPoints: {
    balance: number;
    history: Array<{ date: string; points: number; reason: string; order: string | null; note: string | null }>;
  };
  stockAlerts: Array<{ product: string; productId: string; language: string; requestedAt: string | null; notifiedAt: string | null }>;
  reviews: Array<{ product: string; productId: string; name: string; rating: number; text: string; language: string; status: string; writtenAt: string | null }>;
  returnRequests: Array<{ order: string; requestedAt: string }>;
  savedCart: { items: Array<{ product: string; variant: string | null; quantity: number; price: number }>; total: number; updatedAt: string | null } | null;
  newsletters: Array<{ subject: string; status: string; sentAt: string | null }>;
  marketingOptOut: { since: string | null; how: string } | null;
}

/** The file's name: `rempire-mydata-<Tallinn day>.json`. */
export function exportFilename(now: Date = new Date()): string {
  return `rempire-mydata-${shopDay(now) || now.toISOString().slice(0, 10)}.json`;
}

const STATUS_WORDS: Record<string, string> = {
  new: "awaiting payment",
  paid: "paid",
  failed: "payment failed",
  shipped: "shipped",
  delivered: "delivered",
  cancelled: "cancelled",
  refunded: "refunded",
};

const METHOD_WORDS: Record<string, string> = {
  parcel: "parcel machine",
  courier: "courier",
  pickup: "pickup",
  none: "electronic (nothing to ship)",
  digital: "electronic (nothing to ship)",
};

const LOYALTY_WORDS: Record<string, string> = {
  earn: "earned",
  redeem: "spent",
  adjust: "adjustment",
  expire: "expired",
};

const LINE_WORDS: Record<string, string> = {
  back: "points spent on a refunded order, given back",
  revoke: "points earned by a refunded order, taken back",
  undo: "refund of points undone",
};

/** How an order was paid, in words — never the provider's reference. */
export function paymentWords(payment: unknown, invoice: unknown): string | null {
  const p = (payment && typeof payment === "object" && !Array.isArray(payment) ? payment : {}) as Record<string, unknown>;
  const provider = String(p.provider ?? "");
  const method = String(p.method ?? "");
  if (provider === "invoice" || method === "invoice" || (invoice != null && !provider)) return "invoice (bank transfer)";
  if (provider === "pos") return method === "cash" ? "cash, in the salon" : "card terminal, in the salon";
  if (provider === "none") {
    if (method === "giftcard") return "gift card";
    if (method === "points") return "loyalty points";
    if (method === "promo") return "promo code";
    return "nothing to pay";
  }
  if (method === "bank") return "bank link";
  if (method === "card") return "card";
  if (method === "wallet") return "Apple Pay / Google Pay";
  return provider ? "online payment" : null;
}

function obj(v: unknown): Record<string, unknown> {
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): Array<Record<string, unknown>> {
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Array<Record<string, unknown>>) : [];
}

function iso(v: unknown): string | null {
  if (v == null || v === "") return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function money(v: unknown): number {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function str(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s || null;
}

/** The refunds on one payment blob in one status, summed — the account's own reading. */
function refundSum(payment: Record<string, unknown>, status: "done" | "pending"): number {
  const raw = payment.refunds;
  if (!Array.isArray(raw)) return 0;
  let sum = 0;
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    if (String(row.status ?? "") !== status) continue;
    const n = Number(row.amount);
    if (Number.isFinite(n)) sum += n;
  }
  return money(sum);
}

/** The parcel number the account's «Отследить» shows — the Montonio one from «Отправлен» on, else the typed one. */
function trackingOf(status: string, payment: Record<string, unknown>, shipping: Record<string, unknown>): string | null {
  const tr = payment.tracking;
  const typed = typeof tr === "string" ? tr : tr && typeof tr === "object" ? String((tr as Record<string, unknown>).code ?? "") : "";
  if (typed.trim()) return typed.trim();
  if (status !== "shipped" && status !== "delivered") return null;
  const mont = obj(shipping.montonio);
  if (mont.dismissed) return null;
  return str(mont.trackingCode);
}

type OrderDbRow = {
  number: string;
  status: string;
  currency: string | null;
  email: string | null;
  phone: string | null;
  name: string | null;
  shipping: unknown;
  items: unknown;
  subtotal: string | number;
  shipping_price: string | number;
  discount: string | number;
  discount_code: string | null;
  loyalty_discount: string | number | null;
  total: string | number;
  payment: unknown;
  company: unknown;
  invoice: unknown;
  channel: string | null;
  created_at: string | Date;
};

function exportOrder(r: OrderDbRow): ExportOrder {
  const shipping = obj(r.shipping);
  const payment = obj(r.payment);
  const company = obj(r.company);
  const invoice = r.invoice == null ? null : obj(r.invoice);
  const addr = obj(shipping.address);
  const street = str(addr.addr);
  const method = String(shipping.method ?? "");
  const companyOut: Record<string, string> = {};
  for (const [k, label] of [
    ["name", "name"],
    ["regCode", "registryCode"],
    ["vatNumber", "vatNumber"],
    ["address", "address"],
    ["email", "email"],
  ] as const) {
    const v = str(company[k]);
    if (v) companyOut[label] = v;
  }
  return {
    number: r.number,
    date: iso(r.created_at),
    status: STATUS_WORDS[r.status] ?? r.status,
    placed: r.channel === "pos" ? "in the salon" : "online",
    items: arr(r.items).map((it) => ({
      product: [it.brand, it.title ?? it.name].filter((x) => typeof x === "string" && x.trim()).join(" ").trim() || "—",
      variant: it.variant == null || it.variant === "" ? null : String(it.variant),
      quantity: Math.max(1, Math.round(Number(it.qty) || 1)),
      unitPrice: money(it.price),
      total: money(it.sum ?? (Number(it.price) || 0) * (Number(it.qty) || 1)),
    })),
    subtotal: money(r.subtotal),
    delivery: {
      method: METHOD_WORDS[method] ?? (method || "—"),
      country: str(shipping.country),
      carrier: str(shipping.carrier),
      pickupPoint: str(shipping.pointName),
      address: street ? { street, postcode: str(addr.zip) ?? "", city: str(addr.city) ?? "" } : null,
      price: money(r.shipping_price),
      tracking: trackingOf(r.status, payment, shipping),
    },
    discount: money(r.discount),
    discountCode: str(r.discount_code),
    pointsDiscount: money(r.loyalty_discount),
    total: money(r.total),
    currency: r.currency || "EUR",
    payment: paymentWords(r.payment, r.invoice),
    refunded: refundSum(payment, "done"),
    refundPending: refundSum(payment, "pending"),
    buyer: { name: r.name ?? "", email: r.email ?? "", phone: r.phone ?? "" },
    company: Object.keys(companyOut).length ? companyOut : null,
    invoiceNumber: invoice ? str(invoice.number) : null,
    returnRequestedAt: returnRequestedAt({ shipping }),
    messages: [],
  };
}

function productName(p: AlertProduct | undefined, id: string): string {
  return p ? [p.brand, p.name].filter(Boolean).join(" ").trim() || id : id;
}

type CustomerDbRow = {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  lang: string | null;
  birthday: string | null;
  marketing: boolean | string | null;
  marketing_at: string | Date | null;
  marketing_source: string | null;
  marketing_off_at: string | Date | null;
  ship_pref: unknown;
  tier: string | null;
  company: string | null;
  reg_code: string | null;
  pro_requested_at: string | Date | null;
  pro_approved_at: string | Date | null;
  created_at: string | Date | null;
  last_login_at: string | Date | null;
};

function exportProfile(c: CustomerDbRow): Record<string, unknown> {
  const pref = obj(c.ship_pref);
  const method = String(pref.method ?? "");
  const address = obj(pref.address);
  const marketing = c.marketing === true || c.marketing === "t" || c.marketing === "true";
  return {
    email: c.email,
    name: c.name ?? "",
    phone: c.phone ?? "",
    birthday: c.birthday ?? null,
    language: String(c.lang ?? "RU").toUpperCase(),
    marketingConsent: {
      given: marketing,
      givenAt: iso(c.marketing_at),
      where: c.marketing_source ?? null,
      withdrawnAt: iso(c.marketing_off_at),
    },
    defaultDelivery: method
      ? {
          country: str(pref.country),
          method: METHOD_WORDS[method] ?? method,
          carrier: str(pref.carrier),
          parcelMachine: str(pref.machine),
          address: str(address.addr)
            ? { street: str(address.addr), postcode: str(address.zip) ?? "", city: str(address.city) ?? "" }
            : null,
        }
      : null,
    partner: {
      status: c.tier === "pro" ? "partner" : c.pro_requested_at ? "requested" : "retail",
      company: c.company ?? null,
      registryCode: c.reg_code ?? null,
      requestedAt: iso(c.pro_requested_at),
      approvedAt: iso(c.pro_approved_at),
    },
    accountCreatedAt: iso(c.created_at),
    lastSignInAt: iso(c.last_login_at),
  };
}

/** Upper bounds, so a request can never become a table dump. */
const MAX_ORDERS = 1000;
const MAX_LEDGER = 5000;

/**
 * Everything the shop keeps about the account of `email` — see the header.
 * Orders are the account's own (by e-mail, not detached by an earlier
 * deletion). Throws what the database throws.
 */
export async function exportCustomerData(email: string, now: Date = new Date()): Promise<AccountExport> {
  const addr = normalizeEmail(email);
  const [custRows, orderRows, ledgerRows, alertRows, reviews, cartRows, optRows, msgRows, newsRows] = await Promise.all([
    query<CustomerDbRow>(
      `select id, email, name, phone, lang, to_char(birthday, 'YYYY-MM-DD') as birthday, marketing,
              marketing_at, marketing_source, marketing_off_at, ship_pref, tier, company, reg_code,
              pro_requested_at, pro_approved_at, created_at, last_login_at
         from customers where email = $1`,
      [addr],
    ),
    query<OrderDbRow>(
      `select number, status, currency, email, phone, name, shipping, items, subtotal, shipping_price,
              discount, discount_code, loyalty_discount, total, payment, company, invoice, channel, created_at
         from orders where lower(email) = $1 and account_erased_at is null
        order by created_at desc limit ${MAX_ORDERS}`,
      [addr],
    ),
    query<{ at: string | Date; delta: number | string; reason: string; note: string | null; ref: string | null; order_id: string | null; number: string | null }>(
      `select l.at, l.delta, l.reason, l.note, l.ref, l.order_id, o.number
         from loyalty_ledger l left join orders o on o.id = l.order_id
        where l.customer_id = (select id from customers where email = $1)
        order by l.at desc, l.id desc limit ${MAX_LEDGER}`,
      [addr],
    ),
    query<{ product_id: string; lang: string; created_at: string | Date; sent_at: string | Date | null }>(
      "select product_id, lang, created_at, sent_at from stock_alerts where email = $1 order by created_at desc",
      [addr],
    ),
    reviewsByCustomer(addr, 100),
    query<{ items: unknown; total: string | number; updated_at: string | Date }>(
      "select items, total, updated_at from carts where email = $1",
      [addr],
    ),
    query<{ at: string | Date; kind: string; source: string }>(
      "select at, kind, source from mail_optouts where email = $1",
      [addr],
    ),
    // the thread under each order: what the customer wrote (pasted in by the owner) and what was sent back
    query<{ number: string; direction: string; body: string; subject: string | null; created_at: string | Date }>(
      `select o.number, m.direction, m.body, m.meta->>'subject' as subject, m.created_at
         from order_messages m join orders o on o.id = m.order_id
        where lower(o.email) = $1 and o.account_erased_at is null
        order by m.created_at, m.id`,
      [addr],
    ),
    // the owner's newsletters this address was sent — the subject in the language it went out in
    query<{ subject: string | null; status: string; sent_at: string | Date | null }>(
      `select coalesce(n.subject->>s.lang, n.subject->>'RU') as subject, s.status, s.sent_at
         from newsletter_sends s join newsletters n on n.id = s.newsletter_id
        where s.email = $1
        order by s.sent_at desc nulls last`,
      [addr],
    ),
  ]);

  const names = await productsForAlerts([...alertRows.map((a) => a.product_id), ...reviews.map((r) => r.productId)]);

  const orders = orderRows.map(exportOrder);
  const byNumber = new Map(orders.map((o) => [o.number, o]));
  for (const m of msgRows) {
    byNumber.get(m.number)?.messages.push({
      from: m.direction === "in" ? "you" : "the shop",
      subject: str(m.subject),
      text: m.body,
      date: iso(m.created_at),
    });
  }
  let balance = 0;
  for (const l of ledgerRows) balance += Math.trunc(Number(l.delta) || 0);
  const opt = optRows[0];
  const cart = cartRows[0];

  return {
    format: "rempire-account-data",
    version: 1,
    exportedAt: now.toISOString(),
    email: addr,
    profile: custRows.length ? exportProfile(custRows[0]) : null,
    orders,
    loyaltyPoints: {
      balance,
      history: ledgerRows.map((l) => {
        const delta = Math.trunc(Number(l.delta) || 0);
        const line = pointsLineOf({ reason: l.reason, orderId: l.order_id, ref: l.ref, delta });
        return {
          date: iso(l.at) ?? "",
          points: delta,
          reason: (line && LINE_WORDS[line]) || LOYALTY_WORDS[l.reason] || l.reason,
          order: l.number ?? null,
          note: line ? null : l.note ?? null,
        };
      }),
    },
    stockAlerts: alertRows.map((a) => ({
      product: productName(names.get(a.product_id), a.product_id),
      productId: a.product_id,
      language: String(a.lang || "RU").toUpperCase(),
      requestedAt: iso(a.created_at),
      notifiedAt: iso(a.sent_at),
    })),
    reviews: reviews.map((r) => ({
      product: productName(names.get(r.productId), r.productId),
      productId: r.productId,
      name: r.name,
      rating: r.rating,
      text: r.text,
      language: String(r.lang || "RU").toUpperCase(),
      status: r.status,
      writtenAt: iso(r.createdAt),
    })),
    returnRequests: orders
      .filter((o) => o.returnRequestedAt)
      .map((o) => ({ order: o.number, requestedAt: o.returnRequestedAt as string })),
    savedCart: cart
      ? {
          items: arr(cart.items).map((it) => ({
            product: [it.brand, it.title].filter((x) => typeof x === "string" && x.trim()).join(" ").trim() || String(it.id ?? "—"),
            variant: it.variant == null || it.variant === "" ? null : String(it.variant),
            quantity: Math.max(1, Math.round(Number(it.qty) || 1)),
            price: money(it.price),
          })),
          total: money(cart.total),
          updatedAt: iso(cart.updated_at),
        }
      : null,
    newsletters: newsRows.map((n) => ({ subject: n.subject ?? "", status: n.status, sentAt: iso(n.sent_at) })),
    marketingOptOut: opt
      ? {
          since: iso(opt.at),
          how: opt.kind === ERASED_OPTOUT_KIND ? "account deleted" : opt.source === "one-click" ? "unsubscribe button in the mail app" : "unsubscribe link in a letter",
        }
      : null,
  };
}
