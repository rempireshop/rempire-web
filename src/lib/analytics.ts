/**
 * Sales + traffic analytics for the admin's «Аналитика» tab and for
 * analyticsForAI() (the compact summary the admin assistant reads).
 *
 * Money — revenue, AOV, revenue by day, top products/brands by revenue —
 * is computed from the `orders` table directly (status in PAID_STATUSES —
 * paid or shipped, see the constant below), never from
 * `events`. That is deliberate: orders already carries the euro amounts and
 * the full line-item breakdown, and it is never affected by a blocked
 * analytics beacon. `events` (db/migrations/080_events.sql) drives everything
 * that is inherently about BROWSER BEHAVIOUR — the funnel, views, search,
 * traffic split, chat opens — including its own 'purchase' rows, which feed
 * only the funnel's last, session-shaped bar (client-fired, real sid) and are
 * never summed for revenue. See the migration file's header for the full
 * "which is used where" note and docs/analytics.md for the admin-facing one.
 *
 * Every number here comes from one GET /api/admin/analytics call, fired as
 * one Promise.all of small, independently-indexed queries (see the migration
 * for the indexes) rather than one giant statement — easier to keep each one
 * under the 100 ms budget, easier to test in isolation.
 */
import catalogueMin from "@/data/catalogue.min.json";
import { query } from "@/lib/db";
/* The Overview's «Заканчиваются» reads the same merged in/low/out the shop
   itself renders — numeric stock over the manual override — instead of
   re-deriving it here. See getOverviewSummary() at the bottom of this file. */
import { getOverrides, type OrderStatus } from "@/lib/orders";

/* ---------- catalogue lookups (name/brand for an id out of events/orders) */

type MinProduct = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as MinProduct[];
const BY_ID = new Map<string, MinProduct>(CATALOGUE.map((p) => [p.id, p]));

function productInfo(id: string): { id: string; name: string; brand: string } {
  const p = BY_ID.get(id);
  return { id, name: p ? p.n : id, brand: p ? p.b : "" };
}

function money(n: unknown): number {
  const v = typeof n === "number" ? n : parseFloat(String(n ?? 0));
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}
function int(n: unknown): number {
  const v = typeof n === "number" ? n : parseInt(String(n ?? 0), 10);
  return Number.isFinite(v) ? v : 0;
}

/* ---------- which orders are money ---------------------------------------
 * One rule for both tabs («Аналитика» here, «Обзор» at the bottom of this
 * file): an order counts once its money arrived and stayed — `paid`, and
 * `shipped`, which is only `paid` after the owner pressed «Отправлен»
 * (setOrderStatus in src/lib/orders.ts). A strict `status = 'paid'` made
 * every figure on «Аналитика» drop the moment an order went out, which in a
 * shop that ships the same day meant under-reporting nearly everything.
 * `new`/`failed` never had the money; `cancelled`/`refunded` had it and gave
 * it back. (src/lib/reports.ts's REPORTABLE_STATUSES keeps `refunded` in on
 * purpose — an accounting export wants the refund visible; a sales figure
 * does not.)
 * The partial index these queries lean on, orders_sales_created_idx
 * (db/migrations/081_orders_sales_idx.sql), spells out the same two statuses
 * in its `where` — Postgres only uses a partial index whose predicate the
 * query's implies, which is why 080's `status = 'paid'` one had to go. Widen
 * this constant and the index must follow, in a new 080–089 migration;
 * tests/analytics.test.ts pins the two together.
 * ------------------------------------------------------------------------ */

/** Money arrived and stayed. Exported for the overview, the tests, and anyone
 *  else who needs "which orders are sales" to mean one thing. */
export const PAID_STATUSES = ["paid", "shipped"] as const satisfies readonly OrderStatus[];
/** Interpolated, never parameterised — the values are compile-time constants. */
const PAID_SQL = PAID_STATUSES.map((s) => `'${s}'`).join(", ");

/* ---------- ranges --------------------------------------------------------
 * Trailing windows, not calendar-aligned ("30d" = the last 30×24h, not the
 * calendar month) — simplest to reason about and to compare against the
 * immediately preceding window of the same length for the KPI deltas.
 * "today" is the one calendar exception: since UTC midnight. */

export const ANALYTICS_RANGES = ["today", "7d", "30d", "90d"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

const RANGE_DAYS: Record<AnalyticsRange, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90 };

export type RangeBounds = { from: Date; to: Date; prevFrom: Date; prevTo: Date };

export function rangeBounds(range: AnalyticsRange, now: Date = new Date()): RangeBounds {
  const to = now;
  const from =
    range === "today"
      ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      : new Date(to.getTime() - RANGE_DAYS[range] * 86_400_000);
  const spanMs = Math.max(1, to.getTime() - from.getTime());
  return { from, to, prevFrom: new Date(from.getTime() - spanMs), prevTo: from };
}

function isoDay(v: unknown): string {
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/* ---------- KPI cards with a delta vs. the previous period ---------------- */

export type Kpi = { value: number; prevValue: number; deltaPct: number | null };
function kpi(value: number, prevValue: number): Kpi {
  return { value, prevValue, deltaPct: prevValue > 0 ? Math.round(((value - prevValue) / prevValue) * 1000) / 10 : null };
}

/* ---------- the shape the route hands back --------------------------------- */

export type AnalyticsSummary = {
  range: AnalyticsRange;
  from: string;
  to: string;
  kpi: { revenue: Kpi; orders: Kpi; aov: Kpi; conversion: Kpi };
  funnel: { sessions: number; product: number; addToCart: number; checkout: number; purchase: number };
  revenueByDay: Array<{ day: string; revenue: number; orders: number }>;
  topProductsByRevenue: Array<{ id: string; name: string; brand: string; revenue: number }>;
  topProductsByViews: Array<{ id: string; name: string; brand: string; views: number }>;
  viewedNotBought: Array<{ id: string; name: string; brand: string; views: number }>;
  brandRevenue: Array<{ brand: string; revenue: number; orders: number }>;
  searchTerms: Array<{ term: string; count: number }>;
  zeroResultTerms: Array<{ term: string; count: number }>;
  promoUsage: Array<{ code: string; kind: string | null; value: number | null; uses: number; amount: number }>;
  giftCards: { sold: { count: number; amount: number }; redeemed: { count: number; amount: number } };
  abandonedCarts: number;
  lowStock: Array<{ id: string; name: string; brand: string; stock: string }>;
  traffic: {
    device: { mobile: number; desktop: number };
    countries: Array<{ country: string; sessions: number }>;
    referrers: Array<{ host: string; sessions: number }>;
  };
  chatOpens: number;
};

/* ---------- individual queries --------------------------------------------
 * Each takes {from, to, prevFrom} as Date objects (pg accepts a Date param
 * directly for a timestamptz column) and reads only what it needs. */

async function qOrdersSummary(from: Date, to: Date, prevFrom: Date) {
  const rows = await query<{ revenue: string; orders: string; prev_revenue: string; prev_orders: string }>(
    `select
       coalesce(sum(total) filter (where created_at >= $1 and created_at < $2), 0) as revenue,
       count(*) filter (where created_at >= $1 and created_at < $2) as orders,
       coalesce(sum(total) filter (where created_at >= $3 and created_at < $1), 0) as prev_revenue,
       count(*) filter (where created_at >= $3 and created_at < $1) as prev_orders
     from orders
     where status in (${PAID_SQL}) and created_at >= $3 and created_at < $2`,
    [from, to, prevFrom],
  );
  const r = rows[0];
  return {
    revenue: money(r?.revenue), orders: int(r?.orders),
    prevRevenue: money(r?.prev_revenue), prevOrders: int(r?.prev_orders),
  };
}

async function qRevenueByDay(from: Date, to: Date) {
  const rows = await query<{ day: string | Date; revenue: string; orders: string }>(
    `select date_trunc('day', created_at) as day, sum(total) as revenue, count(*) as orders
     from orders
     where status in (${PAID_SQL}) and created_at >= $1 and created_at < $2
     group by 1 order by 1`,
    [from, to],
  );
  return rows.map((r) => ({ day: isoDay(r.day), revenue: money(r.revenue), orders: int(r.orders) }));
}

async function qTopProductsByRevenue(from: Date, to: Date) {
  const rows = await query<{ product_id: string; revenue: string }>(
    `select item->>'id' as product_id, sum((item->>'sum')::numeric) as revenue
     from orders, jsonb_array_elements(items) as item
     where status in (${PAID_SQL}) and created_at >= $1 and created_at < $2 and item->>'id' is not null
     group by 1 order by revenue desc limit 10`,
    [from, to],
  );
  return rows.map((r) => ({ ...productInfo(r.product_id), revenue: money(r.revenue) }));
}

async function qBrandRevenue(from: Date, to: Date) {
  const rows = await query<{ brand: string; revenue: string; orders: string }>(
    `select item->>'brand' as brand, sum((item->>'sum')::numeric) as revenue, count(distinct id) as orders
     from orders, jsonb_array_elements(items) as item
     where status in (${PAID_SQL}) and created_at >= $1 and created_at < $2 and coalesce(item->>'brand','') <> ''
     group by 1 order by revenue desc limit 20`,
    [from, to],
  );
  return rows.map((r) => ({ brand: r.brand, revenue: money(r.revenue), orders: int(r.orders) }));
}

async function qFunnel(from: Date, to: Date, prevFrom: Date) {
  const rows = await query<{
    sessions: string; viewed_product: string; added_to_cart: string; opened_checkout: string;
    purchased_sessions: string; prev_sessions: string;
  }>(
    `select
       count(distinct sid) filter (where type = 'view' and at >= $1 and at < $2) as sessions,
       count(distinct sid) filter (where type = 'product' and at >= $1 and at < $2) as viewed_product,
       count(distinct sid) filter (where type = 'add_to_cart' and at >= $1 and at < $2) as added_to_cart,
       count(distinct sid) filter (where type = 'checkout' and at >= $1 and at < $2) as opened_checkout,
       count(distinct sid) filter (where type = 'purchase' and sid <> 'server' and at >= $1 and at < $2) as purchased_sessions,
       count(distinct sid) filter (where type = 'view' and at >= $3 and at < $1) as prev_sessions
     from events
     where at >= $3 and at < $2 and sid is not null
       and type in ('view','product','add_to_cart','checkout','purchase')`,
    [from, to, prevFrom],
  );
  const r = rows[0];
  return {
    sessions: int(r?.sessions), product: int(r?.viewed_product), addToCart: int(r?.added_to_cart),
    checkout: int(r?.opened_checkout), purchase: int(r?.purchased_sessions), prevSessions: int(r?.prev_sessions),
  };
}

async function qTopProductsByViews(from: Date, to: Date) {
  const rows = await query<{ product_id: string; views: string }>(
    `select product_id, count(*) as views
     from events
     where type = 'product' and at >= $1 and at < $2 and product_id is not null
     group by 1 order by views desc limit 10`,
    [from, to],
  );
  return rows.map((r) => ({ ...productInfo(r.product_id), views: int(r.views) }));
}

/** «Смотрят, но не покупают» — viewed in range, zero add-to-cart AND zero
 *  purchase (an order in PAID_STATUSES containing that item) in the same range. */
async function qViewedNotBought(from: Date, to: Date) {
  const rows = await query<{ product_id: string; views: string }>(
    `with viewed as (
       select product_id, count(*) as views
       from events
       where type = 'product' and at >= $1 and at < $2 and product_id is not null
       group by 1
     ), carted as (
       select distinct product_id from events
       where type = 'add_to_cart' and at >= $1 and at < $2 and product_id is not null
     ), purchased as (
       select distinct item->>'id' as product_id
       from orders, jsonb_array_elements(items) as item
       where status in (${PAID_SQL}) and created_at >= $1 and created_at < $2
     )
     select v.product_id, v.views
     from viewed v
     left join carted c on c.product_id = v.product_id
     left join purchased p on p.product_id = v.product_id
     where c.product_id is null and p.product_id is null
     order by v.views desc limit 10`,
    [from, to],
  );
  return rows.map((r) => ({ ...productInfo(r.product_id), views: int(r.views) }));
}

/** One grouped query; top overall and zero-result are two views of the same
 *  rows, split in JS — see the migration header for why `path` holds the
 *  query text and `value` the result count for type='search'. */
async function qSearchTerms(from: Date, to: Date) {
  const rows = await query<{ term: string; searches: string; zero_results: string }>(
    `select path as term, count(*) as searches, count(*) filter (where value = 0) as zero_results
     from events
     where type = 'search' and at >= $1 and at < $2 and path is not null
     group by 1 order by searches desc limit 200`,
    [from, to],
  );
  const top = rows.slice(0, 10).map((r) => ({ term: r.term, count: int(r.searches) }));
  const zero = rows
    .filter((r) => int(r.zero_results) > 0)
    .sort((a, b) => int(b.zero_results) - int(a.zero_results))
    .slice(0, 10)
    .map((r) => ({ term: r.term, count: int(r.zero_results) }));
  return { top, zero };
}

async function qPromoUsage(from: Date, to: Date) {
  const rows = await query<{ code: string; kind: string | null; value: string | null; uses: string; amount: string }>(
    `select u.code, p.kind, p.value, count(*) as uses, coalesce(sum(u.amount), 0) as amount
     from promo_code_uses u
     left join promo_codes p on p.code = u.code
     where u.created_at >= $1 and u.created_at < $2
     group by u.code, p.kind, p.value
     order by amount desc limit 20`,
    [from, to],
  );
  return rows.map((r) => ({ code: r.code, kind: r.kind, value: r.value == null ? null : money(r.value), uses: int(r.uses), amount: money(r.amount) }));
}

async function qGiftCards(from: Date, to: Date) {
  const rows = await query<{ sold_count: string; sold_amount: string; redeemed_count: string; redeemed_amount: string }>(
    `select
       (select count(*) from gift_cards where created_at >= $1 and created_at < $2) as sold_count,
       (select coalesce(sum(amount), 0) from gift_cards where created_at >= $1 and created_at < $2) as sold_amount,
       (select count(*) from gift_card_uses where created_at >= $1 and created_at < $2) as redeemed_count,
       (select coalesce(sum(amount), 0) from gift_card_uses where created_at >= $1 and created_at < $2) as redeemed_amount`,
    [from, to],
  );
  const r = rows[0];
  return {
    sold: { count: int(r?.sold_count), amount: money(r?.sold_amount) },
    redeemed: { count: int(r?.redeemed_count), amount: money(r?.redeemed_amount) },
  };
}

async function qAbandonedCarts(from: Date, to: Date) {
  const rows = await query<{ n: string }>(
    "select count(*) as n from carts where updated_at >= $1 and updated_at < $2 and recovered_at is null",
    [from, to],
  );
  return int(rows[0]?.n);
}

async function qLowStock() {
  const rows = await query<{ product_id: string; stock: string }>(
    `select product_id, stock from product_overrides where stock in ('low', 'out')
     order by (stock = 'out') desc, updated_at desc limit 50`,
  );
  return rows.map((r) => ({ ...productInfo(r.product_id), stock: r.stock }));
}

async function qTrafficDevice(from: Date, to: Date) {
  const rows = await query<{ ua_class: string; sessions: string }>(
    `select ua_class, count(distinct sid) as sessions
     from events
     where type = 'view' and at >= $1 and at < $2 and ua_class is not null
     group by 1`,
    [from, to],
  );
  const out = { mobile: 0, desktop: 0 };
  for (const r of rows) if (r.ua_class === "mobile" || r.ua_class === "desktop") out[r.ua_class] = int(r.sessions);
  return out;
}

async function qTrafficCountry(from: Date, to: Date) {
  const rows = await query<{ country: string; sessions: string }>(
    `select country, count(distinct sid) as sessions
     from events
     where type = 'view' and at >= $1 and at < $2 and country is not null
     group by 1 order by sessions desc limit 10`,
    [from, to],
  );
  return rows.map((r) => ({ country: r.country, sessions: int(r.sessions) }));
}

async function qTopReferrers(from: Date, to: Date) {
  const rows = await query<{ ref: string; sessions: string }>(
    `select ref, count(distinct sid) as sessions
     from events
     where type = 'view' and at >= $1 and at < $2 and ref is not null
     group by 1 order by sessions desc limit 10`,
    [from, to],
  );
  return rows.map((r) => ({ host: r.ref, sessions: int(r.sessions) }));
}

async function qChatOpens(from: Date, to: Date) {
  const rows = await query<{ n: string }>(
    "select count(*) as n from events where type = 'chat' and at >= $1 and at < $2",
    [from, to],
  );
  return int(rows[0]?.n);
}

/* ---------- the whole answer, one Promise.all ------------------------------ */

export async function getAnalyticsSummary(range: AnalyticsRange, now: Date = new Date()): Promise<AnalyticsSummary> {
  const { from, to, prevFrom } = rangeBounds(range, now);

  const [
    ordersSummary, revenueByDay, topProductsByRevenue, brandRevenue, funnel, topProductsByViews,
    viewedNotBought, search, promoUsage, giftCards, abandonedCarts, lowStock,
    device, countries, referrers, chatOpens,
  ] = await Promise.all([
    qOrdersSummary(from, to, prevFrom),
    qRevenueByDay(from, to),
    qTopProductsByRevenue(from, to),
    qBrandRevenue(from, to),
    qFunnel(from, to, prevFrom),
    qTopProductsByViews(from, to),
    qViewedNotBought(from, to),
    qSearchTerms(from, to),
    qPromoUsage(from, to),
    qGiftCards(from, to),
    qAbandonedCarts(from, to),
    qLowStock(),
    qTrafficDevice(from, to),
    qTrafficCountry(from, to),
    qTopReferrers(from, to),
    qChatOpens(from, to),
  ]);

  const aov = ordersSummary.orders > 0 ? money(ordersSummary.revenue / ordersSummary.orders) : 0;
  const prevAov = ordersSummary.prevOrders > 0 ? money(ordersSummary.prevRevenue / ordersSummary.prevOrders) : 0;
  const conversion = funnel.sessions > 0 ? ordersSummary.orders / funnel.sessions : 0;
  const prevConversion = funnel.prevSessions > 0 ? ordersSummary.prevOrders / funnel.prevSessions : 0;

  return {
    range, from: from.toISOString(), to: to.toISOString(),
    kpi: {
      revenue: kpi(ordersSummary.revenue, ordersSummary.prevRevenue),
      orders: kpi(ordersSummary.orders, ordersSummary.prevOrders),
      aov: kpi(aov, prevAov),
      // stored as a fraction (0.022) — the UI multiplies by 100 for «2,2 %»
      conversion: kpi(conversion, prevConversion),
    },
    funnel: {
      sessions: funnel.sessions, product: funnel.product, addToCart: funnel.addToCart,
      checkout: funnel.checkout, purchase: funnel.purchase,
    },
    revenueByDay,
    topProductsByRevenue,
    topProductsByViews,
    viewedNotBought,
    brandRevenue,
    searchTerms: search.top,
    zeroResultTerms: search.zero,
    promoUsage,
    giftCards,
    abandonedCarts,
    lowStock,
    traffic: { device, countries, referrers },
    chatOpens,
  };
}

/* The admin assistant's compact context (analyticsForAI() in app.js, sent
   alongside the owner's question) is built from THIS shape client-side and
   re-trimmed server-side in src/app/api/assistant/actions.ts (briefAnalytics)
   exactly like heroForAI()/briefHero() — see that file, not this one: the
   trimming function belongs beside the prompt it feeds, not beside the SQL. */

/* ==========================================================================
 * The «Обзор» tab — GET /api/admin/overview
 *
 * A different question from «Аналитика» above: not "how is the shop doing
 * over a trailing window" but "what happened today, and what is sitting there
 * waiting for me". Same tables and the same money rule, four small queries.
 *
 * Three decisions worth writing down, because all three are visible on screen
 * and every one of them used to be a made-up number:
 *
 * · **Which date.** `orders` has no `paid_at` column (001_core.sql) — only
 *   `created_at` and `updated_at`, and `updated_at` moves again on every note
 *   and status change. So "заказы сегодня" is orders PLACED today that have
 *   been paid, never "orders whose payment landed today". The card says so
 *   rather than leaving the owner to guess: «оплаченные, по дате заказа».
 * · **Which statuses count as paid.** PAID_STATUSES (top of this file):
 *   `paid` AND `shipped`. Pressing «Отправлен» must not make today's count
 *   and today's revenue drop in front of the owner, which is exactly what a
 *   strict `status = 'paid'` does in a shop that ships the same day.
 *   `cancelled`/`refunded` stay out — that money left again. «Аналитика»
 *   above reads the same constant, so the two tabs agree by construction.
 * · **Which stock.** Not a separate query: getOverrides() already merges the
 *   numeric levels over the manual в наличии/мало/нет override, tracked
 *   variants only (src/lib/inventory.ts's module doc). Reading it here is what
 *   makes «Заканчиваются» agree with the badge in the shop, by construction.
 * ========================================================================== */

/** UTC midnight of the day `now` falls in — the same convention rangeBounds("today") uses. */
export function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export type OverviewLowStockItem = { id: string; name: string; brand: string; stock: "low" | "out" };

export type OverviewSummary = {
  now: string;
  /** Paid orders placed in each calendar day (UTC). */
  orders: { today: number; yesterday: number };
  /** Paid orders of the last 7×24 hours. `perDay` is total ÷ 7, not ÷ days-with-a-sale. */
  revenue7d: { total: number; perDay: number; orders: number };
  lowStock: { total: number; low: number; out: number; items: OverviewLowStockItem[] };
  /** The four queues the owner is the only one who can empty. */
  attention: { ordersToShip: number; proRequests: number; reviewsPending: number; stockAlerts: number };
};

async function qOrdersToday(dayStart: Date, dayEnd: Date, prevStart: Date) {
  const rows = await query<{ today: string; yesterday: string }>(
    `select
       count(*) filter (where created_at >= $1 and created_at < $2) as today,
       count(*) filter (where created_at >= $3 and created_at < $1) as yesterday
     from orders
     where status in (${PAID_SQL}) and created_at >= $3 and created_at < $2`,
    [dayStart, dayEnd, prevStart],
  );
  return { today: int(rows[0]?.today), yesterday: int(rows[0]?.yesterday) };
}

async function qRevenue7d(from: Date, to: Date) {
  const rows = await query<{ revenue: string; orders: string }>(
    `select coalesce(sum(total), 0) as revenue, count(*) as orders
     from orders
     where status in (${PAID_SQL}) and created_at >= $1 and created_at < $2`,
    [from, to],
  );
  const total = money(rows[0]?.revenue);
  return { total, orders: int(rows[0]?.orders), perDay: money(total / 7) };
}

/**
 * «Заканчиваются» — the same in/low/out the shop itself shows: a counted
 * (tracked) variant's real quantity where there is one, the owner's manual
 * override everywhere else. getOverrides() does that merge already, so this
 * reads it rather than re-deriving it and drifting from the badge.
 * Ids the catalogue no longer carries are dropped — a leftover override row
 * for a discontinued product is not something to go and re-order.
 */
async function qOverviewLowStock(): Promise<OverviewSummary["lowStock"]> {
  const overrides = await getOverrides();
  const items: OverviewLowStockItem[] = [];
  for (const [id, o] of Object.entries(overrides)) {
    if ((o.stock !== "low" && o.stock !== "out") || !BY_ID.has(id)) continue;
    items.push({ ...productInfo(id), stock: o.stock });
  }
  items.sort((a, b) =>
    a.stock === b.stock ? a.name.localeCompare(b.name, "ru") : a.stock === "out" ? -1 : 1,
  );
  return {
    total: items.length,
    out: items.filter((i) => i.stock === "out").length,
    low: items.filter((i) => i.stock === "low").length,
    items: items.slice(0, 20),
  };
}

/**
 * The four queues. One statement of four subselects rather than four round
 * trips — each is a count over an index this schema already carries
 * (orders_status_idx, customers_pro_pending_idx, reviews_status_idx,
 * stock_alerts_pending_idx).
 *
 * `to_ship` leaves out the salon channel: a sale rung up at the counter is
 * created paid and handed over on the spot (POST /api/admin/pos-orders), so
 * it stays «paid» for good and is never a parcel — counting it made the
 * «Отправить N» badge grow with every salon sale, and disagree with the
 * orders list, which has always filtered those out (admLiveToShip in app.js).
 */
async function qAttention(): Promise<OverviewSummary["attention"]> {
  const rows = await query<{ to_ship: string; pro: string; reviews: string; alerts: string }>(
    `select
       (select count(*) from orders where status = 'paid' and channel <> 'pos') as to_ship,
       (select count(*) from customers where pro_requested_at is not null and tier = 'retail') as pro,
       (select count(*) from reviews where status = 'pending') as reviews,
       (select count(*) from stock_alerts where sent_at is null) as alerts`,
  );
  const r = rows[0];
  return {
    ordersToShip: int(r?.to_ship),
    proRequests: int(r?.pro),
    reviewsPending: int(r?.reviews),
    stockAlerts: int(r?.alerts),
  };
}

export async function getOverviewSummary(now: Date = new Date()): Promise<OverviewSummary> {
  const dayStart = startOfUtcDay(now);
  const prevStart = new Date(dayStart.getTime() - 86_400_000);
  const weekFrom = new Date(now.getTime() - 7 * 86_400_000);

  const [orders, revenue7d, lowStock, attention] = await Promise.all([
    qOrdersToday(dayStart, now, prevStart),
    qRevenue7d(weekFrom, now),
    qOverviewLowStock(),
    qAttention(),
  ]);

  return { now: now.toISOString(), orders, revenue7d, lowStock, attention };
}
