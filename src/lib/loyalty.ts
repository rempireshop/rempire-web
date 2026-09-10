import { query, withTx } from "@/lib/db";
import { normalizeEmail, normalizeLangCode } from "@/lib/customers";

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

/** Admin/assistant `adjust_points` — a manual credit or correction, no order attached. */
export async function adjustLoyaltyPoints(
  customerId: string,
  delta: number,
  note = "",
): Promise<LedgerWrite> {
  if (!UUID_RE.test(customerId)) return { ok: false, error: "bad_customer" };
  const d = Math.trunc(Number(delta) || 0);
  // loyalty_ledger.delta is an integer column: anything past its range is
  // 22003 from Postgres, which the admin route reports as a 503.
  if (!d || !Number.isFinite(d) || Math.abs(d) > 1_000_000) return { ok: false, error: "bad_delta" };
  await query(
    "insert into loyalty_ledger (customer_id, delta, reason, note) values ($1, $2, 'adjust', $3)",
    [customerId, d, note ? note.slice(0, 300) : null],
  );
  return { ok: true, points: d };
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
  const capFromSubtotal = eurosToPoints((Math.max(0, num(subtotal)) * settings.redeemMaxPct) / 100);
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
  const settings = await getPricingSettings();
  const [balance, history] = customerId
    ? await Promise.all([getLoyaltyBalance(customerId), getLoyaltyHistory(customerId, 30)])
    : [0, [] as LedgerEntry[]];
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
  opted_out: boolean | null;
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
    optedOut: r.opted_out === true,
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

/* orders placed as a guest (customer_id null) or later cancelled do not count
   toward "ordersCount"/"revenue" on a customer card — a cancelled order is
   not revenue, and a guest order belongs to nobody's account. */
const CUSTOMER_COLS = `
  c.id, c.email, c.name, c.phone, c.lang, c.tier, c.marketing, c.company, c.reg_code, c.notes,
  c.marketing_at, c.marketing_source, c.marketing_off_at,
  exists (select 1 from mail_optouts mo where mo.email = c.email) as opted_out,
  c.pro_requested_at, c.pro_approved_at, c.created_at, c.last_login_at,
  coalesce(agg.orders_count, 0) as orders_count,
  coalesce(agg.revenue, 0) as revenue,
  coalesce(led.points_balance, 0) as points_balance`;
const CUSTOMER_JOIN = `
  from customers c
  left join (
    select customer_id, count(*) as orders_count, sum(total) as revenue
    from orders where customer_id is not null and status <> 'cancelled'
    group by customer_id
  ) agg on agg.customer_id = c.id
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

/** «Одобрить» — flips the tier and stamps when. */
export async function approveProCustomer(id: string): Promise<AdminCustomerRow | null> {
  if (!UUID_RE.test(id)) return null;
  await query("update customers set tier = 'pro', pro_approved_at = now() where id = $1", [id]);
  return getCustomerAdmin(id);
}

/** «Отклонить» — clears the request so the customer can ask again later; tier stays retail. */
export async function rejectProCustomer(id: string): Promise<AdminCustomerRow | null> {
  if (!UUID_RE.test(id)) return null;
  await query("update customers set pro_requested_at = null where id = $1", [id]);
  return getCustomerAdmin(id);
}

/** Also how the owner demotes a pro account back to retail. */
export async function setCustomerTier(id: string, tier: "retail" | "pro"): Promise<AdminCustomerRow | null> {
  if (!UUID_RE.test(id) || (tier !== "retail" && tier !== "pro")) return null;
  if (tier === "pro") {
    await query("update customers set tier = 'pro', pro_approved_at = coalesce(pro_approved_at, now()) where id = $1", [id]);
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
  if (!before) {
    await query(
      `insert into customers (email, lang, name, phone, company, reg_code, tier, pro_approved_at)
       values ($1, $2, $3, $4, $5, $6, $7, case when $7 = 'pro' then now() else null end)
       on conflict (email) do nothing`,
      [email, lang, name, phone, company, regCode, tier],
    );
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
    created: !before,
    promoted: tier === "pro" && (!before || before.tier !== "pro"),
  };
}

/* ---------- admin: CSV export ----------------------------------------------- */

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

/** \r\n line endings and a leading BOM — Excel opens this correctly on the first try. */
export function customersToCsv(rows: AdminCustomerRow[]): string {
  const lines = [CSV_HEAD.join(",")];
  for (const r of rows) {
    lines.push(
      [
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
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
