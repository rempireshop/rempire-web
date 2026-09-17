import { query, withTx } from "@/lib/db";
import { normalizeEmail, normalizeLangCode } from "@/lib/customers";
/* Type only — erased at build, so this module stays importable from
   src/lib/orders.ts (which imports it) without a runtime cycle. */
import type { OrderStatus } from "@/lib/orders";

/* The same shape src/lib/customers.ts isEmail() checks — repeated rather than
   imported so this file's only import from customers.ts stays the two
   normalisers (customers.ts is backend-core's; see docs/build-contracts.md). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/**
 * Wholesale (salon/pro) pricing and the loyalty points programme.
 *
 * Storage: db/migrations/100_tiers_loyalty.sql — customers.tier/company/
 * reg_code/pro_requested_at/pro_approved_at/notes, product_overrides.pro_price,
 * orders.customer_id/pricing_tier/loyalty_discount, and loyalty_ledger.
 *
 * Two independent things live in one file because they share the same
 * customer row and the same settings key (`pricing`):
 *
 *   pro pricing   a flat discount off the whole catalogue, or a per-product
 *     override, for customers the owner has approved as a salon/pro account.
 *     Quoted in src/lib/orders.ts priceItems()/createOrder(), never trusted
 *     from the browser — see docs/loyalty.md.
 *   loyalty points  every paid order from a signed-in customer earns points
 *     (earnPct of the goods subtotal, rounded to whole euro); points redeem
 *     1-for-1 as euro off a later order. loyalty_ledger is the only source of
 *     truth for a balance — sum(delta), never a running column that could
 *     drift from its own history.
 *
 * Who calls what
 *   · getPricingSettings() / cleanPricing()      — settings.pricing, read and
 *     validated. Called from priceItems()/createOrder(), from the account and
 *     admin routes, and from the public /api/overrides (redacted — see
 *     publicPricing()).
 *   · customerTier(id), proUnitPrice(...)        — the pro-pricing maths.
 *   · quoteLoyaltyRedeem(...)                    — read-only, from
 *     createOrder(): what this basket could redeem right now. Nothing is
 *     spent here, exactly like applyGiftCard()/quotePromo().
 *   · earnLoyaltyPoints(...) / redeemLoyaltyPoints(...) — from
 *     src/lib/payments/apply.ts, on the single transition into `paid`. Both
 *     are idempotent per order (the return route and the webhook race by
 *     design, same as the gift-card redeem and the promo consume).
 *   · adjustLoyaltyPoints(...)                   — the admin/assistant
 *     `adjust_points` action.
 *   · listCustomersAdmin/getCustomerAdmin/approveProCustomer/… — the admin
 *     «Клиенты» tab.
 */

/* ---------- pricing settings ---------------------------------------------- */

export interface LoyaltySettings {
  enabled: boolean;
  /** Per cent of the paid goods subtotal credited as points. */
  earnPct: number;
  /** The most a basket may redeem, as a per cent of its own goods subtotal. */
  redeemMaxPct: number;
  /** Balance (in points/euro) a customer needs before redeeming is offered. */
  minRedeem: number;
}

export interface PricingSettings {
  /**
   * «Партнёры и баллы» — the one switch above both programmes (Dim,
   * 07.09.2026: default OFF, «Renat said later»).
   *
   * Off means the shop has no wholesale tier and no points at all: no salon
   * price anywhere, no «Стать партнёром» in the cabinet, no points earned or
   * spent, and none of the five screens that showed them. It is not the same
   * as `loyalty.enabled` — that one is «points off, partners still on», which
   * is a shop that has partners. Everything keeps its stored value while the
   * switch is off, so turning it back on restores exactly what was there.
   */
  partnersOn: boolean;
  proDiscountPct: number;
  /** Goods subtotal (retail prices) a basket needs before pro pricing applies. 0 = always. */
  proMinOrder: number;
  loyalty: LoyaltySettings;
}

export const DEFAULT_LOYALTY: LoyaltySettings = { enabled: true, earnPct: 5, redeemMaxPct: 30, minRedeem: 5 };
export const DEFAULT_PRICING: PricingSettings = { partnersOn: false, proDiscountPct: 20, proMinOrder: 0, loyalty: DEFAULT_LOYALTY };

/**
 * Bounds for every number in `settings.pricing`. Mirrored — not imported —
 * into src/app/api/assistant/actions.ts, which stays free of database
 * imports on purpose (the same reasoning as PROMO_MAX_* there); tests/
 * loyalty.test.ts checks the two copies agree.
 */
export const PRICING_BOUNDS = {
  proDiscountPct: [0, 90] as const,
  proMinOrder: [0, 100_000] as const,
  earnPct: [0, 50] as const,
  redeemMaxPct: [0, 100] as const,
  minRedeem: [0, 10_000] as const,
};

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}
function clamp(n: number, bounds: readonly [number, number]): number {
  return Math.min(bounds[1], Math.max(bounds[0], n));
}
function money(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function cleanLoyalty(raw: unknown): LoyaltySettings {
  const x = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return {
    enabled: "enabled" in x ? x.enabled !== false : DEFAULT_LOYALTY.enabled,
    earnPct: clamp(num(x.earnPct, DEFAULT_LOYALTY.earnPct), PRICING_BOUNDS.earnPct),
    redeemMaxPct: clamp(num(x.redeemMaxPct, DEFAULT_LOYALTY.redeemMaxPct), PRICING_BOUNDS.redeemMaxPct),
    minRedeem: clamp(num(x.minRedeem, DEFAULT_LOYALTY.minRedeem), PRICING_BOUNDS.minRedeem),
  };
}

/** Fills in anything missing or malformed — a half-written settings row is never a crash. */
export function cleanPricing(raw: unknown): PricingSettings {
  const x = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return {
    // absent means off: a shop that has never been asked has no partners
    partnersOn: x.partnersOn === true,
    proDiscountPct: clamp(num(x.proDiscountPct, DEFAULT_PRICING.proDiscountPct), PRICING_BOUNDS.proDiscountPct),
    proMinOrder: money(clamp(num(x.proMinOrder, DEFAULT_PRICING.proMinOrder), PRICING_BOUNDS.proMinOrder)),
    loyalty: cleanLoyalty(x.loyalty),
  };
}

/** Are points on right now? Both switches have to be — «Партнёры и баллы»
    above and «Начислять баллы» inside it. One question, one place to ask it. */
export function loyaltyOn(p: PricingSettings): boolean {
  return p.partnersOn && p.loyalty.enabled;
}

/**
 * Reads `settings.pricing` directly (one row, not the whole settings table —
 * getSettings() in src/lib/orders.ts would work too, but this file
 * deliberately never imports orders.ts: orders.ts imports THIS file for the
 * pricing maths, and a two-way import is worth avoiding even though Node
 * would tolerate it).
 */
export async function getPricingSettings(): Promise<PricingSettings> {
  const rows = await query<{ value: unknown }>("select value from settings where key = 'pricing'", []);
  return cleanPricing(rows.length ? rows[0].value : null);
}

/** The subset the anonymous storefront may see — never the pro discount
    (docs/loyalty.md). `partnersOn` is public because the storefront has to
    know whether to draw «Стать партнёром» and the points block at all; the
    SIZE of the discount still never leaves the server. */
export function publicPricing(p: PricingSettings): { partnersOn: boolean; loyalty: { enabled: boolean; earnPct: number } } {
  return { partnersOn: p.partnersOn, loyalty: { enabled: loyaltyOn(p), earnPct: p.loyalty.earnPct } };
}

/* ---------- pro pricing: the maths ----------------------------------------- */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 'retail' | 'pro' for an existing customer id, null when there is no such row. */
export async function customerTier(customerId: string): Promise<"retail" | "pro" | null> {
  if (!UUID_RE.test(customerId)) return null;
  const rows = await query<{ tier: string | null }>("select tier from customers where id = $1", [customerId]);
  if (!rows.length) return null;
  return rows[0].tier === "pro" ? "pro" : "retail";
}

/**
 * The price a pro customer pays for one unit.
 *
 * Mirrors the retail-override rule in priceItems() exactly: a pro_price
 * override replaces the BASE price and the variant keeps its own premium over
 * that base, so a cheaper 75 ml pro price does not silently hand away the
 * markup on the 500 ml too. `baseRetail`/`unitRetail` are what this same line
 * would have charged at retail (already carrying any override/size premium);
 * for a product with no variant they are equal, and `unitRetail - baseRetail`
 * is simply 0.
 */
export function proUnitPrice(
  baseRetail: number,
  unitRetail: number,
  proPriceOverride: number | null | undefined,
  proDiscountPct: number,
): number {
  const premium = unitRetail - baseRetail;
  const proBase =
    proPriceOverride != null && Number.isFinite(proPriceOverride)
      ? proPriceOverride
      : baseRetail * (1 - proDiscountPct / 100);
  return money(Math.max(0, proBase + premium));
}

/* ---------- points ----------------------------------------------------------
   One point = one euro, rounded. Earning 5 % on a 118.40 € goods subtotal
   credits round(118.40 * 0.05) = round(5.92) = 6 points; redeeming 6 points
   takes 6.00 € off a later order. Whole numbers only — nobody needs to do
   fractional-point arithmetic in their head, least of all Renat. */

/** `points = round(cents / 100)` — a euro amount to a whole-point count. */
export function eurosToPoints(euros: number): number {
  const cents = Math.round((Number(euros) || 0) * 100);
  return Math.round(cents / 100);
}

/**
 * The most a basket of `subtotal` may redeem under «не больше N % от суммы
 * корзины» — whole points, always rounded DOWN.
 *
 * Rounding to the NEAREST point is right for earning (5 % of 118.40 € is 5.92,
 * and the customer gets 6) and wrong for a ceiling: an 11.70 € basket at 30 %
 * came out as round(3.51) = 4 points, so the shopper took 4 € — 34 % — off a
 * limit the account screen states in words. Half a euro at most, every time in
 * the shop's own pocket. A cap floors.
 *
 * Counted in whole cents, so a price that cannot be written exactly in binary
 * (11.70 * 30 / 100 is 3.5100000000000002) cannot push the floor either way.
 * public/shop2/app.js loyaltyMaxRedeem() draws the same line for the checkout
 * preview, and the two must not disagree about what a basket may spend.
 */
export function redeemCapPoints(subtotal: number, redeemMaxPct: number): number {
  const cents = Math.round(Math.max(0, num(subtotal)) * 100);
  const pct = Math.max(0, num(redeemMaxPct));
  return Math.max(0, Math.floor((cents * pct) / 10_000));
}

export interface LedgerEntry {
  id: number;
  at: string;
  delta: number;
  reason: "earn" | "redeem" | "adjust" | "expire";
  orderId: string | null;
  note: string | null;
}

interface LedgerDbRow {
  id: number | string;
  at: string | Date;
  delta: number | string;
  reason: string;
  order_id: string | null;
  note: string | null;
}

function toEntry(r: LedgerDbRow): LedgerEntry {
  return {
    id: Number(r.id),
    at: new Date(r.at as string).toISOString(),
    delta: Math.trunc(num(r.delta)),
    reason: (["earn", "redeem", "adjust", "expire"].includes(r.reason) ? r.reason : "adjust") as LedgerEntry["reason"],
    orderId: r.order_id,
    note: r.note,
  };
}

export async function getLoyaltyBalance(customerId: string): Promise<number> {
  if (!UUID_RE.test(customerId)) return 0;
  const rows = await query<{ sum: string | number | null }>(
    "select coalesce(sum(delta), 0) as sum from loyalty_ledger where customer_id = $1",
    [customerId],
  );
  return Math.trunc(num(rows[0]?.sum, 0));
}

export async function getLoyaltyHistory(customerId: string, limit = 20): Promise<LedgerEntry[]> {
  if (!UUID_RE.test(customerId)) return [];
  const rows = await query<LedgerDbRow>(
    `select id, at, delta, reason, order_id, note from loyalty_ledger
     where customer_id = $1 order by at desc, id desc limit $2`,
    [customerId, Math.min(Math.max(Math.trunc(Number(limit)) || 20, 1), 100)],
  );
  return rows.map(toEntry);
}

/** True unique-constraint violation (Postgres/PGlite error code 23505). */
function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: unknown }).code === "23505";
}

export interface LedgerWrite {
  ok: boolean;
  /** This order had already posted this reason — a webhook retry, not a new line. */
  already?: boolean;
  points?: number;
  error?: string;
}

/**
 * Credit points for a paid order: earnPct of `paidSubtotalExclShipping`
 * (the goods subtotal — orders.subtotal already excludes shipping). Only
 * ever called with a customerId, so "no account" is never a case here —
 * src/lib/payments/apply.ts skips the call entirely for a guest order.
 *
 * Idempotent: the select-then-insert runs inside one transaction, and the
 * partial unique index loyalty_ledger_earn_once_idx is the backstop if two
 * transactions ever raced past the select (the return route and the webhook
 * race by design) — a unique-violation on the insert is treated as
 * "already posted", not an error.
 */
export async function earnLoyaltyPoints(
  customerId: string,
  orderId: string,
  paidSubtotalExclShipping: number,
): Promise<LedgerWrite> {
  if (!UUID_RE.test(customerId)) return { ok: false, error: "bad_customer" };
  const pricing = await getPricingSettings();
  // «Партнёры и баллы» off = nothing is earned at all, whatever wrote the sale
  // (the web checkout, the salon till, a manual «оплачен» in the panel)
  if (!loyaltyOn(pricing)) return { ok: true, points: 0 };
  const points = eurosToPoints((Math.max(0, num(paidSubtotalExclShipping)) * pricing.loyalty.earnPct) / 100);
  if (!(points > 0)) return { ok: true, points: 0 };

  try {
    return await withTx(async (q) => {
      const seen = await q<{ id: number }>(
        "select id from loyalty_ledger where order_id = $1 and reason = 'earn'",
        [orderId],
      );
      if (seen.length) return { ok: true, already: true, points };
      await q(
        `insert into loyalty_ledger (customer_id, delta, reason, order_id, note)
         values ($1, $2, 'earn', $3, $4)`,
        [customerId, points, orderId, `${pricing.loyalty.earnPct}% от суммы заказа`],
      );
      return { ok: true, points };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: true, already: true, points };
    throw err;
  }
}

export interface RedeemResult extends LedgerWrite {
  /** How many points were actually taken — may be less than asked (see below). */
  taken: number;
}

/**
 * Spend up to `points` off this customer's balance, for `orderId`.
 *
 * Quoted at checkout (quoteLoyaltyRedeem, baked into orders.loyalty_discount)
 * and spent here, on the single transition into `paid` — the same shape as
 * the gift-card redeem and the promo consume just above in apply.ts. If the
 * balance has shrunk since the quote (another order redeemed some in
 * between — rare, and the only way it can happen at all) only what remains
 * is taken: the customer has already been charged the discounted total, so
 * asking for more is not an option — this is the same "money arrived, settle
 * the difference by hand" reasoning docs/backend.md gives for a gift card
 * that emptied between checkout and payment. `ok:false` only when literally
 * nothing could be taken.
 */
export async function redeemLoyaltyPoints(
  customerId: string,
  orderId: string,
  points: number,
  note = "",
): Promise<RedeemResult> {
  if (!UUID_RE.test(customerId)) return { ok: false, error: "bad_customer", taken: 0 };
  const want = Math.max(0, Math.trunc(Number(points) || 0));
  if (!(want > 0)) return { ok: true, taken: 0 };

  try {
    return await withTx(async (q) => {
      const seen = await q<{ id: number }>(
        "select id from loyalty_ledger where order_id = $1 and reason = 'redeem'",
        [orderId],
      );
      if (seen.length) return { ok: true, already: true, taken: want };

      const balRows = await q<{ sum: string | number | null }>(
        "select coalesce(sum(delta), 0) as sum from loyalty_ledger where customer_id = $1",
        [customerId],
      );
      const balance = Math.trunc(num(balRows[0]?.sum, 0));
      const take = Math.min(want, Math.max(0, balance));
      if (!(take > 0)) return { ok: false, error: "insufficient", taken: 0 };

      await q(
        `insert into loyalty_ledger (customer_id, delta, reason, order_id, note)
         values ($1, $2, 'redeem', $3, $4)`,
        [customerId, -take, orderId, note || null],
      );
      return { ok: true, taken: take };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: true, already: true, taken: want };
    throw err;
  }
}

/**
 * The money went back — so do the points, BOTH ways.
 *
 * Called on the move into `refunded` (src/lib/orders.ts setOrderStatus), next
 * to the stock going back on the shelf and the gift cards this order sold
 * being cancelled. Until 14.09.2026 a refund left both of an order's ledger
 * lines standing, and the audit found the two halves of that from opposite
 * ends on the same day:
 *
 *   · the points the order SPENT stayed spent. A customer who took 30 € off a
 *     100 € order with points and was then refunded got the money back and
 *     lost the points — a refund is measured in money (`orders.total` plus
 *     what a gift card paid), and points are not money, so no amount of it
 *     could ever have carried them back.
 *   · the points the order EARNED stayed credited — the shop went on paying a
 *     bonus for a sale it had un-made.
 *
 * What moves is what the ledger says HAPPENED, not what the order was quoted:
 * a redeem that fell short (the balance had shrunk in between — apply.ts
 * loyaltyShortfall) must not be handed back in full, and an order that earned
 * nothing has nothing to take off.
 *
 * ONE compensating row, carrying the net of the two. Not one row per line:
 * loyalty_ledger_refund_once_idx (101_loyalty_refund_once.sql) is unique on
 * order_id for reason='adjust', so an order that both earned and spent has
 * room for exactly one — and the net is what the balance has to move by
 * either way. 'adjust' because loyalty_ledger.reason's check constraint
 * (100_tiers_loyalty.sql) has no 'reverse', and a compensating entry is
 * exactly what an adjustment is; it reads as «Корректировка» with the order
 * number in the note on «Мои баллы».
 *
 * The balance may legitimately go negative: the points were earned and then
 * spent elsewhere. Redeeming already clamps at zero (redeemLoyaltyPoints /
 * quoteLoyaltyRedeem), so a negative balance simply buys nothing until it is
 * earned back.
 *
 * Idempotent per order — any existing 'adjust' row carrying this order id
 * means the reversal is posted (a second «возврат» on the card, a webhook
 * retry) — with the same select-then-insert in one transaction as earning and
 * redeeming, and the unique index behind it for two refund doors landing at
 * once: «Вернуть деньги» in the admin and Montonio's refund webhook.
 */
export async function refundLoyaltyPoints(orderId: string, note = ""): Promise<LedgerWrite> {
  if (!UUID_RE.test(orderId)) return { ok: false, error: "bad_order" };
  try {
    return await withTx(async (q) => {
      const rows = await q<{ customer_id: string; delta: number | string; reason: string }>(
        "select customer_id, delta, reason from loyalty_ledger where order_id = $1 order by id asc",
        [orderId],
      );
      if (rows.some((r) => r.reason === "adjust")) return { ok: true, already: true, points: 0 };

      let customerId = "";
      let net = 0;
      for (const r of rows) {
        if (r.reason !== "earn" && r.reason !== "redeem") continue;
        if (!customerId) customerId = r.customer_id;
        net -= Math.trunc(num(r.delta));
      }
      if (!customerId || !net) return { ok: true, points: 0 };

      await q(
        `insert into loyalty_ledger (customer_id, delta, reason, order_id, note)
         values ($1, $2, 'adjust', $3, $4)`,
        [customerId, net, orderId, note || null],
      );
      return { ok: true, points: net };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: true, already: true };
    throw err;
  }
}

/**
 * Admin/assistant `adjust_points` — a manual credit or correction, no order
 * attached.
 *
 * ONCE PER `ref`, when the caller names one. This was a bare insert, and it
 * was the one write in this file with nothing at all behind it: the three
 * unique indexes on loyalty_ledger (100_tiers_loyalty.sql for earn and redeem,
 * 101_loyalty_refund_once.sql for the refund reversal) all key on `order_id`,
 * and a manual adjustment carries none — 101 says so itself, in the line that
 * ends «so the partial index never sees them». So «+50 баллов» on a customer
 * card, pressed twice or answered late, was +100.
 *
 * Nothing is derived here, deliberately, and this is the one place in this
 * change where that is worth arguing. There is no column to derive an identity
 * from — a manual adjustment is a customer, a number and a sentence — so an
 * identity has to be INVENTED, and inventing one inside this helper would
 * quietly redefine what every existing caller means by calling it twice. The
 * request is where an intention exists, so the request names it: see
 * src/app/api/admin/customers/[id]/route.ts, which builds one out of the
 * customer, the delta, the note and the shop's own calendar day.
 *
 * Guarded the way earning and redeeming are guarded — select-then-insert in
 * one transaction for the common case, loyalty_ledger_ref_idx
 * (191_gift_loyalty_once.sql) behind it for two of them landing at once — and
 * a repeat comes back `already`, carrying the points the first one granted, so
 * the panel shows the balance that really exists.
 */
export async function adjustLoyaltyPoints(
  customerId: string,
  delta: number,
  note = "",
  opts: { ref?: string | null } = {},
): Promise<LedgerWrite> {
  if (!UUID_RE.test(customerId)) return { ok: false, error: "bad_customer" };
  const d = Math.trunc(Number(delta) || 0);
  // loyalty_ledger.delta is an integer column: anything past its range is
  // 22003 from Postgres, which the admin route reports as a 503.
  if (!d || !Number.isFinite(d) || Math.abs(d) > 1_000_000) return { ok: false, error: "bad_delta" };
  const ref = (opts.ref ?? "").trim().slice(0, 200) || null;

  if (!ref) {
    await query(
      "insert into loyalty_ledger (customer_id, delta, reason, note) values ($1, $2, 'adjust', $3)",
      [customerId, d, note ? note.slice(0, 300) : null],
    );
    return { ok: true, points: d };
  }

  try {
    return await withTx(async (q) => {
      const seen = await q<{ delta: number | string }>(
        "select delta from loyalty_ledger where ref = $1 limit 1",
        [ref],
      );
      if (seen.length) return { ok: true, already: true, points: Math.trunc(num(seen[0].delta)) };
      await q(
        "insert into loyalty_ledger (customer_id, delta, reason, note, ref) values ($1, $2, 'adjust', $3, $4)",
        [customerId, d, note ? note.slice(0, 300) : null, ref],
      );
      return { ok: true, points: d };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: true, already: true, points: d };
    throw err;
  }
}

/* ---------- checkout: what a basket could redeem right now ----------------- */

export interface LoyaltyQuote {
  enabled: boolean;
  balance: number;
  minRedeem: number;
  /** The most this basket could redeem right now — capped by the balance AND redeemMaxPct of its own subtotal. */
  maxRedeemable: number;
}

export async function quoteLoyaltyRedeem(
  customerId: string,
  subtotal: number,
  settings: LoyaltySettings,
): Promise<LoyaltyQuote> {
  const balance = await getLoyaltyBalance(customerId);
  const capFromSubtotal = redeemCapPoints(subtotal, settings.redeemMaxPct);
  const maxRedeemable = Math.max(0, Math.min(balance, capFromSubtotal));
  return { enabled: settings.enabled, balance, minRedeem: settings.minRedeem, maxRedeemable };
}

export interface AccountLoyalty {
  balance: number;
  history: LedgerEntry[];
  settings: { enabled: boolean; earnPct: number; redeemMaxPct: number; minRedeem: number };
}

/**
 * The account screen's / checkout's own loyalty block: balance, the last 30
 * ledger lines, and the rates this shopper is told about. Shared by
 * GET /api/account/me and POST /api/account/login so both answer the same
 * shape — `acctVerify()` in app.js applies a login response exactly like a
 * profile fetch, and must not lose the balance until the next reload.
 * `customerId` null (no row yet) is an empty, well-formed answer, not an error.
 */
export async function accountLoyaltySummary(customerId: string | null): Promise<AccountLoyalty> {
  /* All three at once. The settings row decides how the balance is PRESENTED,
     never what it is, so waiting for it before asking for the ledger only ever
     added a round trip to a route the checkout blocks on. */
  const [settings, balance, history] = await Promise.all([
    getPricingSettings(),
    customerId ? getLoyaltyBalance(customerId) : Promise.resolve(0),
    customerId ? getLoyaltyHistory(customerId, 30) : Promise.resolve([] as LedgerEntry[]),
  ]);
  return loyaltyAnswer(settings, balance, history);
}

/**
 * The same answer for a shopper named by ADDRESS rather than by id — so
 * GET /api/account/me can ask for it in the same breath as the profile
 * instead of after it.
 *
 * Renat, 13.09.2026: «the loading of the user data when you go to checkout».
 * The checkout's fields stay empty until that route answers, and the route
 * used to be two waits deep: read the customer row, and only then — because
 * the ledger is keyed on the row's id — ask what that customer's points are.
 * On the in-memory database the tests run against that is a millisecond; on
 * the shop's real Postgres it is a second trip across the network, inside the
 * one request a shopper is watching an empty form for. The id the ledger
 * needs is a sub-select away, and a sub-select costs the database nothing it
 * was not already going to do — so all four queries now leave at once and the
 * route is one wait deep.
 *
 * An address with no customer row is an empty, well-formed answer, exactly as
 * `customerId` null is above: the sub-select yields nothing, nothing matches.
 */
export async function accountLoyaltyByEmail(email: string): Promise<AccountLoyalty> {
  const addr = String(email || "").trim().toLowerCase();
  const [settings, balance, history] = await Promise.all([
    getPricingSettings(),
    balanceForEmail(addr),
    historyForEmail(addr, 30),
  ]);
  return loyaltyAnswer(settings, balance, history);
}

async function balanceForEmail(addr: string): Promise<number> {
  if (!addr) return 0;
  const rows = await query<{ sum: string | number | null }>(
    `select coalesce(sum(delta), 0) as sum from loyalty_ledger
      where customer_id = (select id from customers where email = $1)`,
    [addr],
  );
  return Math.trunc(num(rows[0]?.sum, 0));
}

async function historyForEmail(addr: string, limit: number): Promise<LedgerEntry[]> {
  if (!addr) return [];
  const rows = await query<LedgerDbRow>(
    `select id, at, delta, reason, order_id, note from loyalty_ledger
      where customer_id = (select id from customers where email = $1)
      order by at desc, id desc limit $2`,
    [addr, Math.min(Math.max(Math.trunc(Number(limit)) || 20, 1), 100)],
  );
  return rows.map(toEntry);
}

/** One shape for both readers above. */
function loyaltyAnswer(
  settings: Awaited<ReturnType<typeof getPricingSettings>>,
  balance: number,
  history: LedgerEntry[],
): AccountLoyalty {
  return {
    balance,
    history,
    settings: {
      // «Партнёры и баллы» off means points are off, whatever the inner
      // switch says — one answer for the cabinet and the checkout alike
      enabled: loyaltyOn(settings),
      earnPct: settings.loyalty.earnPct,
      redeemMaxPct: settings.loyalty.redeemMaxPct,
      minRedeem: settings.loyalty.minRedeem,
    },
  };
}

/* ---------- pro requests: the customer's side ------------------------------- */

function text(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return s || null;
}

export interface ProRequestInput {
  company: unknown;
  regCode: unknown;
  phone: unknown;
}

/**
 * «Стать партнёром (салон/мастер)». Stores the request and stamps
 * pro_requested_at; the tier itself only changes when the owner approves it
 * in «Клиенты». A customer already pro, or one who has not verified an
 * e-mail yet (no row), gets nothing written.
 */
export async function requestProTier(
  email: string,
  input: ProRequestInput,
): Promise<{ ok: boolean; error?: string }> {
  const company = text(input.company, 160);
  const regCode = text(input.regCode, 40);
  if (!company || !regCode) return { ok: false, error: "bad_company" };
  const phone = text(input.phone, 40);
  const rows = await query<{ id: string }>(
    `update customers set company = $2, reg_code = $3, phone = coalesce($4, phone), pro_requested_at = now()
     where email = $1 and tier <> 'pro'
     returning id`,
    [normalizeEmail(email), company, regCode, phone],
  );
  return { ok: rows.length > 0, error: rows.length ? undefined : "not_found" };
}

/* ---------- admin: «Клиенты» ------------------------------------------------ */

export interface AdminCustomerRow {
  id: string;
  email: string;
  name: string;
  phone: string;
  /** The language they signed in from — the language their letters are written in. */
  lang: "RU" | "ET" | "EN";
  tier: "retail" | "pro";
  /* «Хочу получать скидки и поздравление ко дню рождения» —
     customers.marketing. Ticked in the account screen, and, since 07.09.2026,
     at the checkout as well (the tick used to be collected and thrown away —
     QA sweep 06.09 §5.3). Carried here so «Клиенты» can show who consented and
     the CSV can be the subscriber list until there is a newsletter to send
     from. Since 10.09.2026 the tick is answerable (052_marketing_consent.sql,
     src/lib/consent.ts): when it went on, where, when it last went off — and
     whether the address pressed «Отписаться» in a letter, which is the one
     thing the tick alone could not say. ISO strings or null. */
  marketing: boolean;
  /** When the consent was switched on (the current stretch of it). */
  marketingAt: string | null;
  /** Where: "checkout" | "account" | "admin". */
  marketingSource: string | null;
  /** When it was last switched off — the account tick or the letter's link. */
  marketingOffAt: string | null;
  /** The address is on the stop list (`mail_optouts`): no cart reminder, no birthday letter. */
  optedOut: boolean;
  /** When the link took it out — `mail_optouts.at`, null when it is not on the
   *  list. Its own date: `marketingOffAt` only moves on a real on → off
   *  transition, so an account tick taken off last month leaves it standing
   *  when the letter's link is pressed today, and the card was dating the
   *  click with the untick. */
  optedOutAt: string | null;
  company: string | null;
  regCode: string | null;
  notes: string | null;
  proRequestedAt: string | null;
  proApprovedAt: string | null;
  createdAt: string | null;
  lastLoginAt: string | null;
  ordersCount: number;
  revenue: number;
  pointsBalance: number;
}

interface AdminCustomerDbRow {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  lang: string | null;
  tier: string;
  marketing: boolean | null;
  marketing_at: string | Date | null;
  marketing_source: string | null;
  marketing_off_at: string | Date | null;
  opted_out_at: string | Date | null;
  company: string | null;
  reg_code: string | null;
  notes: string | null;
  pro_requested_at: string | Date | null;
  pro_approved_at: string | Date | null;
  created_at: string | Date | null;
  last_login_at: string | Date | null;
  orders_count: string | number | null;
  revenue: string | number | null;
  points_balance: string | number | null;
}

function isoOrNull(v: unknown): string | null {
  if (v == null) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toAdminCustomer(r: AdminCustomerDbRow): AdminCustomerRow {
  return {
    id: String(r.id),
    email: r.email,
    name: r.name ?? "",
    phone: r.phone ?? "",
    lang: normalizeLangCode(r.lang),
    tier: r.tier === "pro" ? "pro" : "retail",
    marketing: r.marketing === true,
    marketingAt: isoOrNull(r.marketing_at),
    marketingSource: r.marketing_source ? String(r.marketing_source) : null,
    marketingOffAt: isoOrNull(r.marketing_off_at),
    // mail_optouts.at is `not null default now()` (052_marketing_consent.sql),
    // so a date IS the row and the two answers cannot drift apart
    optedOut: r.opted_out_at != null,
    optedOutAt: isoOrNull(r.opted_out_at),
    company: r.company,
    regCode: r.reg_code,
    notes: r.notes,
    proRequestedAt: isoOrNull(r.pro_requested_at),
    proApprovedAt: isoOrNull(r.pro_approved_at),
    createdAt: isoOrNull(r.created_at),
    lastLoginAt: isoOrNull(r.last_login_at),
    ordersCount: Math.trunc(num(r.orders_count)),
    revenue: money(num(r.revenue)),
    pointsBalance: Math.trunc(num(r.points_balance)),
  };
}

/* "ordersCount"/"revenue" on a row and on the card: the purchases under the
   customer's e-mail. Until 10.09.2026 they were joined on customer_id, so a
   guest checkout — most of this shop's orders — counted for nobody, and the
   card could say «Заказов: 0» above a list of three orders once the list
   (customerOrdersAdmin, matched by e-mail like the account's «Мои заказы»)
   was drawn beneath the tiles. Same key, same rule as the facts under them:
   a purchase is an order whose money arrived and stayed (PURCHASE_STATUSES).
   Until 14.09.2026 the rule was the other way round — "anything but cancelled
   or failed" — which counted a `new` order (the insert default: a basket that
   opened a payment page and never came back, and nothing ever sweeps them) and
   a `refunded` one as spend. «Потратил» then named money the shop does not
   have, on the same card whose «Аналитика» neighbour counts only paid.
   c.email is stored lower-cased (normalizeEmail); orders.email is whatever
   the checkout typed, hence lower() on that side — orders_email_idx covers it. */
/** The orders that are a purchase: money arrived and stayed. The same list as
 *  PAID_ORDER_STATUSES in src/lib/orders.ts and PAID_STATUSES in
 *  src/lib/analytics.ts — the type-only import keeps this file free of the
 *  runtime cycle a value import would make (orders.ts imports this module),
 *  while `satisfies readonly OrderStatus[]` still refuses a status that is not
 *  one. Widen one of the three and widen the others. */
const PURCHASE_STATUSES = ["paid", "shipped", "delivered"] as const satisfies readonly OrderStatus[];
/** Interpolated, never parameterised — the values are compile-time constants. */
const PURCHASE_SQL = PURCHASE_STATUSES.map((s) => `'${s}'`).join(", ");
const CUSTOMER_COLS = `
  c.id, c.email, c.name, c.phone, c.lang, c.tier, c.marketing, c.company, c.reg_code, c.notes,
  c.marketing_at, c.marketing_source, c.marketing_off_at,
  (select mo.at from mail_optouts mo where mo.email = c.email) as opted_out_at,
  c.pro_requested_at, c.pro_approved_at, c.created_at, c.last_login_at,
  coalesce(agg.orders_count, 0) as orders_count,
  coalesce(agg.revenue, 0) as revenue,
  coalesce(led.points_balance, 0) as points_balance`;
const CUSTOMER_JOIN = `
  from customers c
  left join (
    select lower(email) as email, count(*) as orders_count, sum(total) as revenue
    from orders where email is not null and status in (${PURCHASE_SQL})
    group by lower(email)
  ) agg on agg.email = c.email
  left join (
    select customer_id, sum(delta) as points_balance
    from loyalty_ledger group by customer_id
  ) led on led.customer_id = c.id`;

export interface AdminCustomerFilter {
  q?: string;
  /** "" = everyone, "pending" = asked for pro and not yet decided. */
  tier?: "retail" | "pro" | "pending" | "";
  limit?: number;
}

export async function listCustomersAdmin(filter: AdminCustomerFilter = {}): Promise<AdminCustomerRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const q = String(filter.q ?? "").trim().slice(0, 100).toLowerCase();
  if (q) {
    params.push(`%${q}%`);
    const i = params.length;
    where.push(
      `(lower(c.email) like $${i} or lower(coalesce(c.name,'')) like $${i} or lower(coalesce(c.phone,'')) like $${i} or lower(coalesce(c.company,'')) like $${i})`,
    );
  }
  if (filter.tier === "pro" || filter.tier === "retail") {
    params.push(filter.tier);
    where.push(`c.tier = $${params.length}`);
  } else if (filter.tier === "pending") {
    where.push(`c.pro_requested_at is not null and c.tier = 'retail'`);
  }
  params.push(Math.min(Math.max(Math.trunc(Number(filter.limit)) || 200, 1), 1000));
  const rows = await query<AdminCustomerDbRow>(
    `select ${CUSTOMER_COLS} ${CUSTOMER_JOIN}
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by c.created_at desc nulls last limit $${params.length}`,
    params,
  );
  return rows.map(toAdminCustomer);
}

export async function getCustomerAdmin(id: string): Promise<AdminCustomerRow | null> {
  if (!UUID_RE.test(id)) return null;
  const rows = await query<AdminCustomerDbRow>(`select ${CUSTOMER_COLS} ${CUSTOMER_JOIN} where c.id = $1`, [id]);
  return rows.length ? toAdminCustomer(rows[0]) : null;
}

/**
 * Same shape as getCustomerAdmin, keyed by e-mail instead of a uuid — lets an
 * admin caller (the assistant's adjust_points action, docs/loyalty.md) name a
 * customer by the one identifier a human/model can actually type. The
 * customers/[id] route resolves through this when its id segment is not a
 * uuid, then uses the resolved row's real id for every write that follows.
 */
export async function getCustomerAdminByEmail(email: string): Promise<AdminCustomerRow | null> {
  const e = normalizeEmail(email);
  if (!e) return null;
  const rows = await query<AdminCustomerDbRow>(`select ${CUSTOMER_COLS} ${CUSTOMER_JOIN} where lower(c.email) = $1`, [e]);
  return rows.length ? toAdminCustomer(rows[0]) : null;
}

/* ---------- admin: what one customer bought -------------------------------
   Dim, 10.09.2026: «the card says two orders and a sum, and shows no orders,
   no analytics, nothing else». The card's GET now carries the orders behind
   the tiles and four facts drawn from them — src/app/api/admin/customers/[id]. */

/** One order on the customer card: enough for a row and for the same status
    chip the orders list draws. The card itself is opened by id through
    GET /api/admin/orders/<id>, so nothing heavier travels here. */
export interface CustomerOrderRow {
  id: string;
  number: string;
  createdAt: string | null;
  total: number;
  status: string;
  /** "web" | "pos" — a salon sale wears its own chip. */
  channel: "web" | "pos";
  /** A Montonio label already made and not undone — «Этикетка готова». */
  labeled: boolean;
  /** «По счёту»: the invoice's number and due date, for the chip's overdue ink. */
  invoice: { number: string; dueAt: string | null } | null;
  /** Pieces, summed over the lines — the count the orders list shows. */
  itemsCount: number;
  /** «Brand — title» of the first line, "" on an order with none. */
  firstItem: string;
}

export interface CustomerStats {
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  /** Average order total over the counted orders, 0 when there are none. */
  avgOrder: number;
  /** Up to three brands, biggest spend first. */
  topBrands: Array<{ brand: string; spent: number }>;
}

interface CustomerOrderDbRow {
  id: string;
  number: string;
  status: string;
  total: string | number | null;
  created_at: string | Date | null;
  items: unknown;
  shipping: unknown;
  invoice: unknown;
  channel: string | null;
}

/** pg hands jsonb back parsed; a driver that hands back text is still honoured. */
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

/* Which orders the facts read: exactly the ones the tiles on the card count
   (CUSTOMER_JOIN above) — money that arrived and stayed. A failed payment is
   an unpaid basket the shopper walked away from, a `new` one is a basket that
   never even got a verdict, and a refunded one is money given back: none of
   the three is a purchase, or a date worth calling «first». */
const IS_A_PURCHASE = new Set<string>(PURCHASE_STATUSES);

/**
 * The orders behind a customer's card, and the facts drawn from them.
 *
 * Matched by e-mail, not by customer_id, for the reason the account's «Мои
 * заказы» is (listCustomerOrders in src/lib/customers.ts): a guest checkout
 * placed before the account existed — most of this shop's orders — belongs
 * to the person who owns the mailbox. `orders` is the last `limit` of them
 * in every status, the cancelled ones included, because a customer's history
 * is what the owner is reading; the stats read the whole history (up to two
 * hundred rows) and skip what never was a purchase.
 *
 * It used to hand back `names` too — every name this person had signed an
 * order with — and the card matched their reviews against that list. Two
 * customers under one display name then read each other's reviews
 * (13.09.2026); reviews are keyed on the author's own address now
 * (reviewsByCustomer in src/lib/reviews.ts) and nothing here is keyed on a
 * name any more. Do not bring the list back: a name is not an identity.
 */
export async function customerOrdersAdmin(
  email: string,
  limit = 20,
): Promise<{ orders: CustomerOrderRow[]; stats: CustomerStats }> {
  const addr = normalizeEmail(email);
  const empty = { orders: [], stats: { firstOrderAt: null, lastOrderAt: null, avgOrder: 0, topBrands: [] } };
  if (!addr) return empty;
  const rows = await query<CustomerOrderDbRow>(
    `select id, number, status, total, created_at, items, shipping, invoice, channel
       from orders where lower(email) = $1 order by created_at desc limit 200`,
    [addr],
  );
  if (!rows.length) return empty;

  const brands = new Map<string, number>();
  let counted = 0;
  let spent = 0;
  let first: string | null = null;
  let last: string | null = null;

  const orders = rows.map((r) => {
    const items = jsonOf<Array<Record<string, unknown>>>(r.items, []);
    const lines = Array.isArray(items) ? items : [];
    const ship = jsonOf<Record<string, unknown>>(r.shipping, {});
    const mont = ship && typeof ship.montonio === "object" && ship.montonio ? (ship.montonio as Record<string, unknown>) : null;
    const inv = jsonOf<Record<string, unknown> | null>(r.invoice, null);
    const at = isoOrNull(r.created_at);
    const total = money(num(r.total));

    if (IS_A_PURCHASE.has(r.status)) {
      counted += 1;
      spent += total;
      // newest first: the first row seen is the last order, the last row the first
      if (at) {
        if (!last) last = at;
        first = at;
      }
      for (const it of lines) {
        const brand = String(it?.brand ?? "").trim();
        if (!brand) continue;
        const sum = Number(it.sum);
        const lineSum = Number.isFinite(sum) ? sum : num(it.price) * Math.max(1, num(it.qty, 1));
        brands.set(brand, (brands.get(brand) ?? 0) + lineSum);
      }
    }

    const firstLine = lines[0];
    const title = firstLine ? String(firstLine.title ?? firstLine.name ?? firstLine.id ?? "").trim() : "";
    const brand = firstLine ? String(firstLine.brand ?? "").trim() : "";
    return {
      id: String(r.id),
      number: r.number,
      createdAt: at,
      total,
      status: r.status,
      channel: r.channel === "pos" ? ("pos" as const) : ("web" as const),
      labeled: !!(mont && mont.shipmentId && !mont.dismissed),
      invoice: inv && inv.number ? { number: String(inv.number), dueAt: inv.dueAt ? String(inv.dueAt) : null } : null,
      itemsCount: lines.reduce((n, it) => n + Math.max(0, Math.trunc(num(it?.qty, 1))), 0),
      firstItem: title ? (brand ? `${brand} — ${title}` : title) : "",
    };
  });

  const topBrands = [...brands.entries()]
    .map(([brand, sum]) => ({ brand, spent: money(sum) }))
    .filter((b) => b.spent > 0)
    .sort((a, b) => b.spent - a.spent || a.brand.localeCompare(b.brand))
    .slice(0, 3);

  return {
    orders: orders.slice(0, Math.min(Math.max(Math.trunc(limit) || 20, 1), 50)),
    stats: {
      firstOrderAt: first,
      lastOrderAt: last,
      avgOrder: counted ? money(spent / counted) : 0,
      topBrands,
    },
  };
}

/**
 * «Одобрить» — flips the tier, stamps when, and closes the request.
 *
 * The request is cleared by the approval itself, exactly as upsertPartner()
 * clears it when «+ Партнёр» promotes a row. Until 17.09.2026 it was left
 * standing, and `pro_requested_at is not null and tier = 'retail'` — the
 * pending predicate of listCustomersAdmin(), of the «Заявки Pro» badge and of
 * the panel's own counter — matched the row again the moment the owner
 * demoted that partner back to retail. The badge then said «Заявка Pro» for
 * ever over a request that was decided months ago, and the customer's own
 * account screen said «на рассмотрении · Заявку получили, скоро рассмотрим»
 * and would not offer the form again, so they could not even ask a second
 * time. A decision, either way, ends the request.
 */
export async function approveProCustomer(id: string): Promise<AdminCustomerRow | null> {
  if (!UUID_RE.test(id)) return null;
  await query(
    "update customers set tier = 'pro', pro_approved_at = now(), pro_requested_at = null where id = $1",
    [id],
  );
  return getCustomerAdmin(id);
}

/** «Отклонить» — clears the request so the customer can ask again later; tier stays retail. */
export async function rejectProCustomer(id: string): Promise<AdminCustomerRow | null> {
  if (!UUID_RE.test(id)) return null;
  await query("update customers set pro_requested_at = null where id = $1", [id]);
  return getCustomerAdmin(id);
}

/** Also how the owner demotes a pro account back to retail. The card's switch
 *  promotes exactly as «Одобрить» does, so it closes an open request the same
 *  way — see the note on approveProCustomer(). */
export async function setCustomerTier(id: string, tier: "retail" | "pro"): Promise<AdminCustomerRow | null> {
  if (!UUID_RE.test(id) || (tier !== "retail" && tier !== "pro")) return null;
  if (tier === "pro") {
    await query(
      "update customers set tier = 'pro', pro_approved_at = coalesce(pro_approved_at, now()), pro_requested_at = null where id = $1",
      [id],
    );
  } else {
    await query("update customers set tier = 'retail' where id = $1", [id]);
  }
  return getCustomerAdmin(id);
}

export async function setCustomerNotes(id: string, notes: string | null): Promise<AdminCustomerRow | null> {
  if (!UUID_RE.test(id)) return null;
  await query("update customers set notes = $2 where id = $1", [id, notes ? String(notes).slice(0, 2000) : null]);
  return getCustomerAdmin(id);
}

/* ---------- admin: «+ Партнёр» — create or promote by e-mail ---------------- */

export interface PartnerInput {
  email: string;
  name?: unknown;
  company?: unknown;
  regCode?: unknown;
  phone?: unknown;
  /** "RU" | "ET" | "EN" — the language the welcome letter is written in. */
  lang?: unknown;
  /** "pro" (default) makes a partner; "retail" only creates the row. */
  tier?: "pro" | "retail";
}

export interface PartnerResult {
  customer: AdminCustomerRow;
  /** The row did not exist before this call. */
  created: boolean;
  /** The tier actually flipped retail → pro here (a letter is due). */
  promoted: boolean;
  /**
   * This address had already been a partner before this call — it carries a
   * `pro_approved_at` stamp from an earlier promotion. The welcome letter has
   * gone to it once already, so `promoted` alone is not enough to send.
   */
  welcomed: boolean;
}

/**
 * «+ Партнёр» in the admin: a salon or a master the owner knows, added by
 * e-mail before they ever signed in. The row is created if there is none —
 * the same row recordLogin() would create at their first sign-in, so when
 * they do sign in they land straight on partner prices — and an existing
 * row (a shopper who already has orders, or a pending request) is promoted
 * in place. What the owner typed wins (he is correcting the record on
 * purpose); a field he left blank leaves the customer's own value alone,
 * and the customer's language is never touched — the letter follows it. An
 * open request is closed by the promotion itself.
 */
export async function upsertPartner(input: PartnerInput): Promise<PartnerResult | null> {
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email)) return null;
  const tier = input.tier === "retail" ? "retail" : "pro";
  const name = text(input.name, 120);
  const company = text(input.company, 160);
  const regCode = text(input.regCode, 40);
  const phone = text(input.phone, 40);
  const lang = normalizeLangCode(input.lang);

  const before = await getCustomerAdminByEmail(email);
  /* Whether the insert below is what put the row there. `on conflict do
     nothing` returns no row when somebody else got there first — recordLogin()
     at that customer's very first sign-in — and the audit line the route
     writes («customer.created») should not claim a row this call did not make. */
  let insertedHere = false;
  if (!before) {
    const back = await query<{ id: string }>(
      `insert into customers (email, lang, name, phone, company, reg_code, tier, pro_approved_at)
       values ($1, $2, $3, $4, $5, $6, $7, case when $7 = 'pro' then now() else null end)
       on conflict (email) do nothing
       returning id`,
      [email, lang, name, phone, company, regCode, tier],
    );
    insertedHere = back.length > 0;
  } else {
    await query(
      `update customers set
         name = coalesce($2, name), phone = coalesce($3, phone),
         company = coalesce($4, company), reg_code = coalesce($5, reg_code),
         tier = case when $6 = 'pro' then 'pro' else tier end,
         pro_approved_at = case when $6 = 'pro' then coalesce(pro_approved_at, now()) else pro_approved_at end,
         pro_requested_at = case when $6 = 'pro' then null else pro_requested_at end
       where id = $1`,
      [before.id, name, phone, company, regCode, tier],
    );
  }
  const customer = await getCustomerAdminByEmail(email);
  if (!customer) return null;
  return {
    customer,
    created: !before && insertedHere,
    /* Read off the row as it NOW is, not off the read that opened this call.
       recordLogin() creates the row at a customer's first sign-in, and one
       landing between that read and the insert above leaves `on conflict do
       nothing` with nothing to do — the tier stays 'retail'. Computed from
       `before` alone, this said «promoted» over a row that never moved, and
       the route posted «Цены для салонов включены» to somebody who is still
       paying retail prices. The window is microseconds; the letter is a
       promise to a customer, so it follows the tier that is really there. */
    promoted: tier === "pro" && customer.tier === "pro" && (!before || before.tier !== "pro"),
    /* Has this address been a partner before today? `pro_approved_at` is
       stamped on the first promotion and survives every demotion after it, so
       it is the shop's memory of having sent «Цены для салонов включены»
       once. Read off `before` — the row as it was when this call opened,
       because the write above stamps it. The route sends on `promoted &&
       !welcomed`: a partner who left and came back is greeted by hand (Dim,
       17.09.2026), never by a second copy of the same letter. */
    welcomed: !!before?.proApprovedAt,
  };
}

/* ---------- admin: the «Клиенты» export ------------------------------------- */

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

function csvCell(v: unknown): string {
  const s = defuseFormula(String(v ?? ""));
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** The numbers, as numbers — the three columns Excel should be able to sum. */
const NUMERIC_HEADS = new Set(["ordersCount", "revenue", "pointsBalance"]);

const CSV_HEAD = [
  "email",
  "name",
  "phone",
  "tier",
  // who may be written to — the list Renat exports until there is a sender —
  // and, since 10.09.2026, since when and from where (blank for a "no")
  "marketing",
  "marketing_at",
  "marketing_source",
  "company",
  "regCode",
  "ordersCount",
  "revenue",
  "pointsBalance",
  "createdAt",
  "lastLoginAt",
];

/** One customer as one row, in CSV_HEAD's order — both exports read this. */
function customerCells(r: AdminCustomerRow): Array<string | number> {
  return [
    r.email,
    r.name,
    r.phone,
    r.tier,
    r.marketing ? "yes" : "no",
    r.marketingAt ?? "",
    r.marketingSource ?? "",
    r.company ?? "",
    r.regCode ?? "",
    r.ordersCount,
    r.revenue,
    r.pointsBalance,
    r.createdAt ?? "",
    r.lastLoginAt ?? "",
  ];
}

/**
 * `;` between the cells, not `,`: Excel on an Estonian or Russian Windows —
 * this shop's own admin — splits a double-clicked .csv on the regional «list
 * separator», which is `;` in both, so a comma-separated file put every
 * column into cell A and read as one long line. Dim, 13.09.2026: «An excel
 * would be better, CSV hard to read» — that is what he was looking at. The
 * accountant's export next door has been `;` all along (ordersToCsv in
 * src/lib/reports.ts) and opens properly, which is what says this was the
 * difference.
 *
 * BOM first so Cyrillic names are not mojibake, \r\n line endings. Nothing
 * here is Excel-only: `;` is a legal delimiter, every other reader that is
 * told the separator (LibreOffice and Numbers ask on open, pandas/csv take a
 * `delimiter=";"`) reads the same file.
 */
export function customersToCsv(rows: AdminCustomerRow[]): string {
  const lines = [CSV_HEAD.map(csvCell).join(";")];
  for (const r of rows) lines.push(customerCells(r).map(csvCell).join(";"));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/**
 * The same table as a real .xlsx — «An excel would be better» (Dim,
 * 13.09.2026). No separator to get wrong, no locale to guess, Cyrillic by
 * construction, and the three number columns arrive as numbers so a sum works
 * without re-typing the column.
 *
 * No new dependency: the OOXML writer is the repo's own, the one the
 * accountant's report already uses (buildXlsx in src/lib/reports.ts). The CSV
 * above stays exactly where it was for anything that reads files rather than
 * opens them.
 */
export async function customersToXlsx(rows: AdminCustomerRow[]): Promise<Buffer> {
  /* Dynamic, like the other optional neighbours in this file: the pricing and
     loyalty maths is imported on hot paths (every basket priced) and has no
     business pulling node:zlib in with it for an export nobody asked for yet. */
  const { buildXlsx } = await import("@/lib/reports");
  const cells = rows.map((r) =>
    customerCells(r).map((v, i) => {
      if (!NUMERIC_HEADS.has(CSV_HEAD[i])) return defuseFormula(String(v ?? ""));
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }),
  );
  return buildXlsx("Клиенты", CSV_HEAD, cells);
}
