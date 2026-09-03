/**
 * Sales + traffic analytics for the admin's «Аналитика» tab and for
 * analyticsForAI() (the compact summary the admin assistant reads).
 *
 * Money — revenue, AOV, revenue by day, top products/brands by revenue —
 * is computed from the `orders` table directly (status = 'paid'), never from
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
     where status = 'paid' and created_at >= $3 and created_at < $2`,
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
     where status = 'paid' and created_at >= $1 and created_at < $2
     group by 1 order by 1`,
    [from, to],
  );
  return rows.map((r) => ({ day: isoDay(r.day), revenue: money(r.revenue), orders: int(r.orders) }));
}

async function qTopProductsByRevenue(from: Date, to: Date) {
  const rows = await query<{ product_id: string; revenue: string }>(
    `select item->>'id' as product_id, sum((item->>'sum')::numeric) as revenue
     from orders, jsonb_array_elements(items) as item
     where status = 'paid' and created_at >= $1 and created_at < $2 and item->>'id' is not null
     group by 1 order by revenue desc limit 10`,
    [from, to],
  );
  return rows.map((r) => ({ ...productInfo(r.product_id), revenue: money(r.revenue) }));
}

async function qBrandRevenue(from: Date, to: Date) {
  const rows = await query<{ brand: string; revenue: string; orders: string }>(
    `select item->>'brand' as brand, sum((item->>'sum')::numeric) as revenue, count(distinct id) as orders
     from orders, jsonb_array_elements(items) as item
     where status = 'paid' and created_at >= $1 and created_at < $2 and coalesce(item->>'brand','') <> ''
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
 *  purchase (of a paid order containing that item) in the same range. */
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
       where status = 'paid' and created_at >= $1 and created_at < $2
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
