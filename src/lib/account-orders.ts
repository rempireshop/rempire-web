/**
 * «Мой кабинет → Мои заказы» — what one order row tells its own customer
 * beyond the number, the date, the total and the status (Dim, 28.09.2026):
 *
 *   · the PARCEL in words — carrier, the machine (or «Курьер» and the city),
 *     and where Montonio says the parcel is;
 *   · the order's DETAILS behind a tap — the items at the prices stored with
 *     the order, the delivery, the codes, the points, how it was paid, the
 *     refunds;
 *   · whether the order gets a RECEIPT («Скачать чек (PDF)») at all.
 *
 * Pure: it reads the order row that src/lib/customers.ts listCustomerOrders()
 * has already fetched and answers small, whitelisted shapes. Nothing here
 * copies a field across wholesale — every value that reaches the browser is
 * named below, because the row also holds what must never leave the server:
 * the pickup point's id, the shipment id, the drop-off PIN, the label link,
 * the payment reference, the full gift-card code, the owner's notes.
 *
 * It imports nothing but promos.ts (for the one rule that tells a gift card
 * from a promo code, which itself imports only the database): customers.ts
 * is loaded by every signed-in route, the checkout's among them, and must
 * stay the leaf it has always been.
 */
import { looksLikeGiftCode } from "@/lib/promos";

/* ---------- small readers -------------------------------------------------- */

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}

/** Printable, single-line, trimmed, capped — or null. */
function clip(v: unknown, max = 160): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
  return s || null;
}

function money(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 100) / 100 || 0 : 0;
}

/* ---------- carriers -------------------------------------------------------- */

/**
 * The carrier as the shop names it to customers — the checkout's chips, the
 * «Заказ отправлен» letter and the order card all say «Omniva», «DPD»,
 * «SmartPosti», «Unisend», «Nova Post». Both spellings a parcel can carry are
 * read: the order's own `shipping.carrier` (omniva | smartpost | dpd |
 * unisend | novapost, and venipak on orders from before 14.09.2026) and
 * Montonio's `carrierCode` on the booked shipment, which says «itella» for
 * SmartPosti. A word that is none of them is shown capitalised if it is a
 * plain word, and not at all otherwise — a code is not a name.
 */
const CARRIERS: Array<[RegExp, string]> = [
  [/^omniva/, "Omniva"],
  [/^dpd/, "DPD"],
  [/^(smart ?post|itella|posti)/, "SmartPosti"],
  [/^(unisend|lp ?express)/, "Unisend"],
  [/^nova ?post/, "Nova Post"],
  [/^venipak/, "Venipak"],
];

export function carrierDisplayName(raw: unknown): string | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase().replace(/[_-]+/g, " ") : "";
  if (!s) return null;
  for (const [rx, name] of CARRIERS) if (rx.test(s)) return name;
  return /^[a-z][a-z ]{1,20}$/.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : null;
}

/* ---------- the parcel ------------------------------------------------------ */

export type ParcelState = "inTransit" | "awaitingCollection" | "delivered" | "returned";

/** Where the parcel ends up: a machine, a manned counter (or post office), or a door. */
export type ParcelPlace = "locker" | "counter" | "courier";

export interface CustomerParcel {
  /** «Omniva», «DPD», «SmartPosti», «Unisend», «Nova Post» — or null when the order names none. */
  carrier: string | null;
  place: ParcelPlace;
  /** The machine's or the counter's name (`shipping.pointName`); null for a courier. */
  point: string | null;
  /** The city a courier parcel goes to; null for a machine. */
  city: string | null;
  /** Where Montonio says it is, or null for a word this does not know. */
  state: ParcelState | null;
}

/**
 * Montonio's shipment status → one of the four states the account can put
 * into words, or null.
 *
 * Montonio documents `pending | registered | registrationFailed | labelsCreated
 * | inTransit | awaitingCollection | delivered | returned` (shipping v2,
 * «Shipments»). The first four are the shop's side of the counter and say
 * nothing to a customer. For «delivered» and «returned» this accepts exactly
 * the spellings the nightly delivery check does — looksDelivered() and
 * looksReturned() in src/lib/delivery.ts — so the account never calls a
 * parcel received that the shop itself would not; tests/account-order-
 * details.test.ts runs the two side by side. Not imported: delivery.ts pulls
 * in orders.ts, which the account's module graph must not carry.
 */
export function parcelStateOf(raw: unknown): ParcelState | null {
  const s = String(raw ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!s) return null;
  if (s === "intransit") return "inTransit";
  if (s === "awaitingcollection") return "awaitingCollection";
  // returned first: «returned_to_sender» must never read as delivered
  if (s === "returned" || s === "return" || s === "returning" || s.startsWith("returned") || s.startsWith("returnto")) return "returned";
  if (
    s === "delivered" || s.startsWith("delivered") ||
    s === "completed" || s === "finished" || s === "pickedup" || s === "collected" || s === "handedover"
  ) return "delivered";
  return null;
}

const SHIP_METHODS = ["parcel", "courier", "pickup", "digital"] as const;
export type DeliveryMethod = (typeof SHIP_METHODS)[number];

function shipMethod(ship: Obj): DeliveryMethod | null {
  const m = typeof ship.method === "string" ? ship.method.trim().toLowerCase() : "";
  return (SHIP_METHODS as readonly string[]).includes(m) ? (m as DeliveryMethod) : null;
}

/** A counter and a post office are both «a place with a person»; null / anything else is a machine. */
function pointPlace(ship: Obj): "locker" | "counter" | "post_office" {
  const t = typeof ship.pointType === "string" ? ship.pointType.trim().toLowerCase() : "";
  return t === "pickup_point" ? "counter" : t === "post_office" ? "post_office" : "locker";
}

/**
 * The parcel line under an order that is «Отправлен» or «Доставлен» — the two
 * statuses the «Отследить» link and the «Заказ отправлен» letter follow. A
 * label on the shelf is not a parcel on its way (a `paid` order shows none),
 * and a label the journal's undo set aside is no Montonio parcel at all: its
 * status is not read, but the order's own carrier and machine still are — a
 * parcel handed over some other way went to the same place.
 */
export function parcelOf(status: unknown, shipping: unknown): CustomerParcel | null {
  if (status !== "shipped" && status !== "delivered") return null;
  const ship = obj(shipping);
  const method = shipMethod(ship);
  if (method === "pickup" || method === "digital") return null;
  const raw = obj(ship.montonio);
  const mont = Object.keys(raw).length && !raw.dismissed ? raw : null;
  const courier = method === "courier" || (!method && mont?.method === "courier");
  const carrier = carrierDisplayName(mont?.carrier) ?? carrierDisplayName(ship.carrier);
  const point = courier ? null : clip(ship.pointName);
  const city = courier ? clip(obj(ship.address).city, 80) : null;
  if (!carrier && !point && !city) return null;
  return {
    carrier,
    place: courier ? "courier" : pointPlace(ship) === "locker" ? "locker" : "counter",
    point,
    city,
    state: mont ? parcelStateOf(mont.status) : null,
  };
}

/* ---------- the details ----------------------------------------------------- */

export interface CustomerOrderItem {
  title: string;
  variant: string | null;
  qty: number;
  /** Per unit, as charged — the order line's `price`, never today's catalogue. */
  price: number;
  /** The line's total as charged (`sum`, or price × qty on a row written before it existed). */
  sum: number;
}

/** One line of «Мои заказы», read off the stored order line. */
export function orderItemOf(raw: unknown): CustomerOrderItem {
  const it = obj(raw);
  const qty = Math.max(1, Math.round(Number(it.qty) || 1));
  const price = money(it.price);
  const stored = Number(it.sum);
  return {
    title: [it.brand, it.title ?? it.name].filter(Boolean).join(" ").trim() || "—",
    variant: it.variant == null ? null : String(it.variant),
    qty,
    price,
    sum: Number.isFinite(stored) && it.sum != null && it.sum !== "" ? money(stored) : money(price * qty),
  };
}

export interface CustomerDelivery {
  method: DeliveryMethod | null;
  /** Parcel orders only: a machine, a counter, a post office. */
  place: "locker" | "counter" | "post_office" | null;
  carrier: string | null;
  /** The machine's or the counter's name — parcel orders only. */
  point: string | null;
  /** Where a courier took it — the customer's own address, as the order card spells it. */
  address: string | null;
  /** What the delivery cost on this order (`orders.shipping_price`). */
  price: number;
}

/** «Testitänav 1, 10111, Tallinn» — street, index, city, the way the order card prints it. */
function addressText(v: unknown): string | null {
  const a = obj(v);
  const parts = [clip(a.addr) ?? clip(a.street), clip(a.zip, 20), clip(a.city, 80)].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function deliveryOf(shipping: unknown, price: unknown): CustomerDelivery {
  const ship = obj(shipping);
  const method = shipMethod(ship);
  const parcel = method === "parcel";
  const courier = method === "courier";
  return {
    method,
    place: parcel ? pointPlace(ship) : null,
    carrier: parcel || courier ? carrierDisplayName(ship.carrier) : null,
    point: parcel ? clip(ship.pointName) : null,
    address: courier ? addressText(ship.address) : null,
    price: money(price),
  };
}

/**
 * «RMP-••••-4679». A gift card's code is the card: while it holds money,
 * whoever reads it can spend it, and the account session lives ninety days
 * on whatever device signed in. The last four are enough to tell two cards
 * apart; the customer has the whole code in the card's own letter.
 */
export function maskGiftCode(code: string): string {
  const s = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `RMP-••••-${s.slice(-4)}`;
}

/** How it was paid, as a word the storefront has in its dictionaries. */
const PAY_METHODS = ["bank", "card", "wallet", "invoice", "giftcard", "points", "promo", "cash", "terminal"] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

export interface CustomerPayment {
  method: PayMethod;
  /**
   * A bank link only: the bank this payment went through — Montonio's own
   * name for it when the payment carries one («paymentInitiation · Revolut
   * Poland» → «Revolut Poland»), else its BIC, which the storefront names
   * from its bank list (bankNameOf in public/shop2/app.js).
   */
  bank: string | null;
}

const PAID_STATUSES = new Set(["paid", "shipped", "delivered", "refunded"]);

/**
 * How the order was paid — null while it was not (a card payment that was
 * only ever started says nothing about how it was paid), except «По счёту»,
 * which is how the order WILL be paid from the moment it is placed and is
 * what the invoice link beside it is about.
 */
export function paymentOf(status: unknown, payment: unknown): CustomerPayment | null {
  const p = obj(payment);
  const method = typeof p.method === "string" ? p.method.trim().toLowerCase() : "";
  if (!(PAY_METHODS as readonly string[]).includes(method)) return null;
  if (method !== "invoice" && !PAID_STATUSES.has(String(status))) return null;
  let bank: string | null = null;
  if (method === "bank") {
    const parts = typeof p.detail === "string" ? p.detail.split(" · ") : [];
    const own = parts.length === 2 && parts[0].trim() === "paymentInitiation" ? clip(parts[1], 60) : null;
    const bic = typeof p.bank === "string" ? p.bank.trim().toUpperCase() : "";
    bank = own ?? (/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic) ? bic : null);
  }
  return { method: method as PayMethod, bank };
}

export interface CustomerRefund {
  amount: number;
  /** `done` — the bank (or the card ledger) confirmed it; `pending` — sent, not yet confirmed. */
  status: "done" | "pending";
  /** Went back onto the gift card that paid, as balance — not to a bank account. */
  toGiftCard: boolean;
  /** When it was confirmed (`doneAt`), else when it was made. */
  at: string | null;
}

/** The refunds that went out or are on their way, oldest first. A failed one is no money moved. */
export function refundsOf(payment: unknown): CustomerRefund[] {
  const raw = obj(payment).refunds;
  if (!Array.isArray(raw)) return [];
  const out: CustomerRefund[] = [];
  for (const r of raw) {
    const e = obj(r);
    const status = e.status === "done" ? "done" : e.status === "failed" ? "failed" : "pending";
    if (status === "failed") continue;
    const amount = money(e.amount);
    if (!(amount > 0)) continue;
    const when = clip(e.doneAt, 40) ?? clip(e.at, 40);
    out.push({ amount, status, toGiftCard: e.to === "giftcard", at: when && !Number.isNaN(Date.parse(when)) ? when : null });
  }
  return out;
}

export interface CustomerOrderDetails {
  delivery: CustomerDelivery;
  /** A promo code (or the till's percent, which has no code) and what it took off. */
  promo: { code: string | null; amount: number } | null;
  /** A gift card that paid part or all of it — masked, see maskGiftCode(). */
  giftCard: { code: string; amount: number } | null;
  /** Euro «Использовать баллы» took off. */
  points: number;
  payment: CustomerPayment | null;
  refunds: CustomerRefund[];
}

export interface OrderDetailsRow {
  status: string;
  shipping_price: unknown;
  discount: unknown;
  discount_code: unknown;
  loyalty_discount: unknown;
}

/**
 * What the opened row shows. The promo code and the gift card share
 * `discount_code` on the order (src/lib/orders.ts codeDiscount — one box at
 * the checkout takes either), and the card is told apart by its shape, the
 * same rule the checkout and the order card use (promos.ts looksLikeGiftCode).
 */
export function orderDetailsOf(r: OrderDetailsRow, shipping: unknown, payment: unknown): CustomerOrderDetails {
  const discount = money(r.discount);
  const code = clip(r.discount_code, 40);
  const gift = discount > 0 && !!code && looksLikeGiftCode(code);
  return {
    delivery: deliveryOf(shipping, r.shipping_price),
    promo: discount > 0 && !gift ? { code, amount: discount } : null,
    giftCard: gift ? { code: maskGiftCode(code!), amount: discount } : null,
    points: money(r.loyalty_discount),
    payment: paymentOf(r.status, payment),
    refunds: refundsOf(payment),
  };
}

/* ---------- the receipt ----------------------------------------------------- */

/**
 * «Скачать чек (PDF)» — on every order whose money arrived: paid, shipped,
 * delivered, and refunded (the receipt then lists the refunds under the sale;
 * src/lib/receipt-pdf.ts). A partly refunded order keeps its status, so it is
 * in the first three.
 *
 * Not on an order paid «По счёту»: its document is the invoice the customer
 * already downloads beside it, which carries everything a receipt would —
 * the lines, the VAT, the seller's registry and KMKR numbers — and a second
 * VAT document for the same sale, under a second reference, is exactly what
 * a company's bookkeeper would enter twice.
 *
 * One rule for the list (the link) and the route (the file), so the link
 * never promises a file the route then refuses.
 */
export function receiptAllowed(order: { status: unknown; invoice?: unknown }): boolean {
  if (!PAID_STATUSES.has(String(order.status))) return false;
  let inv: unknown = order.invoice;
  if (typeof inv === "string") {
    try {
      inv = JSON.parse(inv);
    } catch {
      inv = null;
    }
  }
  return !clip(obj(inv).number, 40);
}
