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
/* Which day an instant belongs to — the Tallinn calendar, said out loud in the
   SQL and in the JS alike, so the database's own timezone setting cannot move
   a figure. See src/lib/day.ts for the rule and for why it is not date_trunc. */
import { shopDay, shopDaySql, startOfShopDay } from "@/lib/day";
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

/* product creation: an id the file does not carry may be one of the owner's
   own rows (src/lib/custom-products.ts, `c-…`, db/migrations/131). Looked up
   at call time the way src/lib/orders.ts does it, once per summary, for the
   handful of ids the lists actually name — never for a catalogue id. */
type Named = { id: string; name: string; brand: string };
/* …with the row's «Показывать в магазине» (`active`) beside the name: the
   owner's own product is switched off THERE, not on an override row. */
async function customNames(ids: string[]): Promise<Map<string, { name: string; brand: string; active: boolean }>> {
  const want = [...new Set(ids.filter((id) => id.startsWith("c-") && !BY_ID.has(id)))];
  const out = new Map<string, { name: string; brand: string; active: boolean }>();
  if (!want.length) return out;
  try {
    const { customLabelsByIds } = await import("@/lib/custom-products");
    for (const [id, own] of await customLabelsByIds(want)) out.set(id, own);
  } catch (err) {
    console.error("[analytics] custom products not loaded:", err);
  }
  return out;
}

/** Fills in, in place, the name and brand productInfo() could not — the custom products. */
async function nameCustom(...lists: Named[][]): Promise<void> {
  const names = await customNames(lists.flatMap((l) => l.map((r) => r.id)));
  if (!names.size) return;
  for (const list of lists) {
    for (const row of list) {
      const n = names.get(row.id);
      if (n) {
        row.name = n.name;
        row.brand = n.brand;
      }
    }
  }
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
 * file): an order counts once its money arrived and stayed — `paid`, then
 * `shipped` and `delivered`, which are only `paid` after the owner pressed
 * «Отправлен» and «Доставлен» on the order card (setOrderStatus in
 * src/lib/orders.ts). A strict `status = 'paid'` made every figure on
 * «Аналитика» drop the moment an order went out, which in a shop that ships
 * the same day meant under-reporting nearly everything. `new`/`failed` never
 * had the money; `cancelled`/`refunded` had it and gave it back.
 * (src/lib/reports.ts's REPORTABLE_STATUSES keeps `refunded` in on purpose —
 * an accounting export wants the refund visible; a sales figure does not.)
 * The partial index these queries lean on, orders_sales_created_idx (made in
 * db/migrations/081_orders_sales_idx.sql, rebuilt with the third status in
 * 140_order_delivered.sql), spells out the same statuses in its `where` —
 * Postgres only uses a partial index whose predicate the query's implies,
 * which is why 080's `status = 'paid'` one had to go. Widen this constant and
 * the index must follow, in a new migration; tests/analytics.test.ts pins the
 * two together.
 * ------------------------------------------------------------------------ */

/** Money arrived and stayed. Exported for the overview, the tests, and anyone
 *  else who needs "which orders are sales" to mean one thing. The same list
 *  as PAID_ORDER_STATUSES in src/lib/orders.ts, kept here under the name the
 *  analytics have always used. */
export const PAID_STATUSES = ["paid", "shipped", "delivered"] as const satisfies readonly OrderStatus[];
/** Interpolated, never parameterised — the values are compile-time constants. */
const PAID_SQL = PAID_STATUSES.map((s) => `'${s}'`).join(", ");

/* ---------- ranges --------------------------------------------------------
 * Trailing windows, not calendar-aligned ("30d" = the last 30×24h, not the
 * calendar month) — simplest to reason about and to compare against the
 * immediately preceding window of the same length for the KPI deltas.
 * "today" is the one calendar exception: since Tallinn midnight — the day the
 * owner is having, not the day UTC is having (src/lib/day.ts). */

export const ANALYTICS_RANGES = ["today", "7d", "30d", "90d"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

const RANGE_DAYS: Record<AnalyticsRange, number> = { today: 1, "7d": 7, "30d": 30, "90d": 90 };

export type RangeBounds = { from: Date; to: Date; prevFrom: Date; prevTo: Date };

export function rangeBounds(range: AnalyticsRange, now: Date = new Date()): RangeBounds {
  const to = now;
  const from =
    range === "today" ? startOfShopDay(now) : new Date(to.getTime() - RANGE_DAYS[range] * 86_400_000);
  const spanMs = Math.max(1, to.getTime() - from.getTime());
  return { from, to, prevFrom: new Date(from.getTime() - spanMs), prevTo: from };
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
  /** `names`: a set's own name in each language (a set is a basket line too, «bundle:<id>»). */
  topProductsByRevenue: Array<{ id: string; name: string; brand: string; revenue: number; names?: LineNames }>;
  topProductsByViews: Array<{ id: string; name: string; brand: string; views: number }>;
  viewedNotBought: Array<{ id: string; name: string; brand: string; views: number }>;
  brandRevenue: Array<{ brand: string; revenue: number; orders: number }>;
  searchTerms: Array<{ term: string; count: number }>;
  zeroResultTerms: Array<{ term: string; count: number }>;
  promoUsage: Array<{ code: string; kind: string | null; value: number | null; uses: number; amount: number }>;
  giftCards: { sold: { count: number; amount: number }; redeemed: { count: number; amount: number } };
  abandonedCarts: number;
  /** Orders placed after the abandoned-cart letter — «Вернулись по письму».
      `null` when the count could not be read (the table not migrated yet). */
  cartsReturned: number | null;
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

/**
 * Takings per day, named on the Tallinn calendar.
 *
 * Not `date_trunc('day', created_at)`: that cuts the day in whatever zone the
 * database session is set to and hands back an instant, which then has to be
 * re-read in the SAME zone to mean anything. It was not — isoDay() formatted
 * it in UTC — so on a database at UTC+3 an order placed at 21:02 was reported
 * under the previous day, silently, with nothing on screen to say so. The
 * group key is the Tallinn day as TEXT instead: the zone is written into the
 * statement, and no driver can parse a string back into a Date and shift it.
 */
async function qRevenueByDay(from: Date, to: Date) {
  const rows = await query<{ day: string; revenue: string; orders: string }>(
    `select ${shopDaySql("created_at")} as day, sum(total) as revenue, count(*) as orders
     from orders
     where status in (${PAID_SQL}) and created_at >= $1 and created_at < $2
     group by 1 order by 1`,
    [from, to],
  );
  return rows.map((r) => ({ day: String(r.day ?? ""), revenue: money(r.revenue), orders: int(r.orders) }));
}

async function qTopProductsByRevenue(from: Date, to: Date) {
  const rows = await query<{ product_id: string; revenue: string; title: string | null }>(
    `select item->>'id' as product_id, sum((item->>'sum')::numeric) as revenue, max(item->>'title') as title
     from orders, jsonb_array_elements(items) as item
     where status in (${PAID_SQL}) and created_at >= $1 and created_at < $2 and item->>'id' is not null
     group by 1 order by revenue desc limit 10`,
    [from, to],
  );
  const out: Array<Named & { revenue: number; names?: LineNames }> =
    rows.map((r) => ({ ...productInfo(r.product_id), revenue: money(r.revenue) }));
  await nameSetsAndCards(out, new Map(rows.map((r) => [r.product_id, r.title ?? ""])));
  return out;
}

/* ---------- a basket line that is not a product --------------------------
   A set is sold as ONE line, «bundle:<id>», and a gift card as «gift:<amount>»
   (src/lib/orders.ts createOrder). Neither is in the catalogue, so
   productInfo() handed the id back as the name and «Топ товаров» read
   «bundle:beard» and «gift:50» (verification pass 25.09.2026, stats-ranges).
   A gift card is «Подарочная карта 50 €» — the panel's dictionary says it in
   ET and EN (a UI_RX rule in public/shop2/app.js). A set is its own name, in
   the three languages it was written in (`names`, which the panel picks by
   its language); a set deleted since keeps the title its order line was sold
   under. */
type LineNames = { RU: string; ET: string; EN: string };
async function nameSetsAndCards(list: Array<Named & { names?: LineNames }>, soldAs: Map<string, string>): Promise<void> {
  let sets: Record<string, { title: Record<string, string> }> = {};
  if (list.some((r) => r.id.startsWith("bundle:"))) {
    try {
      const { bundleDefsForOrders } = await import("@/lib/bundles");
      sets = await bundleDefsForOrders();
    } catch (err) {
      console.error("[analytics] sets not loaded:", err);
    }
  }
  for (const row of list) {
    const gift = /^gift:(\d+(?:\.\d+)?)$/.exec(row.id);
    if (gift) {
      row.name = `Подарочная карта ${String(Number(gift[1])).replace(".", ",")} €`;
      row.brand = "";
      continue;
    }
    if (!row.id.startsWith("bundle:")) continue;
    const t = sets[row.id.slice("bundle:".length)]?.title;
    const ru = t?.RU || soldAs.get(row.id) || "";
    if (!ru) continue;
    row.name = ru;
    row.brand = "";
    if (t) row.names = { RU: ru, ET: t.ET || ru, EN: t.EN || ru };
  }
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

/**
 * The «Путь до покупки» bars, and the two numbers «Из корзины в заказ» is
 * divided from.
 *
 * `converted_sessions` / `prev_converted_sessions` are NOT the same as
 * `purchased_sessions`, and the difference is what keeps the KPI honest. Each
 * counts sessions that bought inside the window AND had also opened the shop
 * inside the same window — the `exists` clause. Without it, a session that
 * arrived at 23:55 and paid at 00:05 is counted in the numerator of a window
 * whose denominator never saw it, and on a shop with a handful of orders a
 * month one such session is enough to put the ratio over 100 %. With it the
 * numerator is a subset of `sessions` by construction, so the figure cannot
 * exceed 100 % — it is not clamped afterwards, it is simply never able to.
 *
 * `purchased_sessions` keeps its old meaning because the funnel bar it feeds
 * («Купили») is answering a different question — how many sessions bought,
 * full stop — and clipping the straddlers out of it would under-report sales.
 */
async function qFunnel(from: Date, to: Date, prevFrom: Date) {
  const rows = await query<{
    sessions: string; viewed_product: string; added_to_cart: string; opened_checkout: string;
    purchased_sessions: string; prev_sessions: string;
    converted_sessions: string; prev_converted_sessions: string;
  }>(
    `select
       count(distinct sid) filter (where type = 'view' and at >= $1 and at < $2) as sessions,
       count(distinct sid) filter (where type = 'product' and at >= $1 and at < $2) as viewed_product,
       count(distinct sid) filter (where type = 'add_to_cart' and at >= $1 and at < $2) as added_to_cart,
       count(distinct sid) filter (where type = 'checkout' and at >= $1 and at < $2) as opened_checkout,
       count(distinct sid) filter (where type = 'purchase' and sid <> 'server' and at >= $1 and at < $2) as purchased_sessions,
       count(distinct sid) filter (where type = 'view' and at >= $3 and at < $1) as prev_sessions,
       (select count(distinct p.sid) from events p
         where p.type = 'purchase' and p.sid is not null and p.sid <> 'server'
           and p.at >= $1 and p.at < $2
           and exists (select 1 from events v
                        where v.sid = p.sid and v.type = 'view' and v.at >= $1 and v.at < $2)
       ) as converted_sessions,
       (select count(distinct p.sid) from events p
         where p.type = 'purchase' and p.sid is not null and p.sid <> 'server'
           and p.at >= $3 and p.at < $1
           and exists (select 1 from events v
                        where v.sid = p.sid and v.type = 'view' and v.at >= $3 and v.at < $1)
       ) as prev_converted_sessions
     from events
     where at >= $3 and at < $2 and sid is not null
       and type in ('view','product','add_to_cart','checkout','purchase')`,
    [from, to, prevFrom],
  );
  const r = rows[0];
  return {
    sessions: int(r?.sessions), product: int(r?.viewed_product), addToCart: int(r?.added_to_cart),
    checkout: int(r?.opened_checkout), purchase: int(r?.purchased_sessions), prevSessions: int(r?.prev_sessions),
    converted: int(r?.converted_sessions), prevConverted: int(r?.prev_converted_sessions),
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
       (select count(*) from gift_card_uses where amount > 0 and created_at >= $1 and created_at < $2) as redeemed_count,
       (select coalesce(sum(amount), 0) from gift_card_uses where amount > 0 and created_at >= $1 and created_at < $2) as redeemed_amount`,
    [from, to],
  );
  const r = rows[0];
  return {
    sold: { count: int(r?.sold_count), amount: money(r?.sold_amount) },
    redeemed: { count: int(r?.redeemed_count), amount: money(r?.redeemed_amount) },
  };
}

/* The quiet period that makes a basket an ABANDONED one. Must stay equal to
   ABANDONED_AFTER_MS in src/lib/flows.ts — the reminder letter's own rule, and
   the reason «Брошенные корзины» and «Последний запуск: … пропущено» now count
   the same carts. Declared here rather than imported so that the analytics
   route does not pull the whole mail stack in behind it;
   tests/analytics-audit-r21.test.ts asserts the two never drift apart. */
const ABANDONED_QUIET_MS = 3 * 60 * 60 * 1000;

/**
 * Baskets left behind: saved, never ordered from, and untouched for three hours.
 *
 * The quiet period is the point. Without it this counted the basket a shopper
 * had put something in a minute ago — one somebody is standing in the middle of
 * — and the panel called it «Человек оставил почту и собрал корзину, но заказ
 * так и не оформил» (audit). Three hours is the same wait runAbandonedCarts()
 * makes before it writes to that address, so this figure and the letter's
 * «пропущено: корзине ещё нет трёх часов» are now about one set of carts.
 * Counted from `to`, not from the machine clock: for the ranges the panel asks
 * for, `to` IS now, and for a window that has closed the right question is
 * which carts were quiet by the end of it.
 */
async function qAbandonedCarts(from: Date, to: Date) {
  const rows = await query<{ n: string }>(
    `select count(*) as n from carts
     where updated_at >= $1 and updated_at < $2 and updated_at <= $3 and recovered_at is null`,
    [from, to, new Date(to.getTime() - ABANDONED_QUIET_MS)],
  );
  return int(rows[0]?.n);
}

/**
 * «Вернулись по письму»: orders that came from an address whose cart had been
 * sent the reminder — one row each in `cart_returns`, written by
 * markCartRecovered() at the moment it clears the reminder's stamp
 * (db/migrations/213_cart_returned_by_letter.sql). One index range read.
 * Fails soft to null: a figure the database cannot give must not take the
 * whole screen down with it.
 */
async function qCartsReturned(from: Date, to: Date): Promise<number | null> {
  try {
    const rows = await query<{ n: string }>(
      "select count(*) as n from cart_returns where at >= $1 and at < $2",
      [from, to],
    );
    return int(rows[0]?.n);
  } catch (err) {
    console.warn("[analytics] cart returns not counted:", (err as Error)?.message);
    return null;
  }
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
    device, countries, referrers, chatOpens, cartsReturned,
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
    qCartsReturned(from, to),
  ]);

  // the owner's own products: a name and a brand instead of a bare `c-…` id
  await nameCustom(topProductsByRevenue, topProductsByViews, viewedNotBought, lowStock);

  const aov = ordersSummary.orders > 0 ? money(ordersSummary.revenue / ordersSummary.orders) : 0;
  const prevAov = ordersSummary.prevOrders > 0 ? money(ordersSummary.prevRevenue / ordersSummary.prevOrders) : 0;
  /* «Из корзины в заказ», under the caption «Сколько человек из каждых 100
     зашедших в магазин что-то купили».

     Until 17.09.2026 this divided ordersSummary.orders — EVERY paid order —
     by funnel.sessions, and the two sides were not counting the same people:

       · the numerator had no channel filter, so a sale rung up on the salon
         till (channel 'pos', db/migrations/091_pos_channel.sql) counted as
         somebody who "came into the shop and bought", though that person
         never opened the site at all;
       · the denominator is distinct sids on 'view' events, and every 'view'
         is written by track() in public/shop2/app.js, which returns at its
         first line without analytics consent. A shopper who declines the
         banner, or never answers it, buys without ever being counted as
         having arrived.

     Both errors push the same way — numerator too big, denominator too small
     — so the figure read above the truth, and with a till sale or two in a
     quiet month it could read above 100 %, under a caption that says it is a
     count out of every hundred. Both sides now come from the same consent-
     gated event stream and the same session identity, which is what makes the
     caption true as written; the caption is therefore left exactly as it is.

     The number this reports is lower than the old one, and that is the point:
     it is the share of the people the shop can actually SEE arriving who went
     on to buy. It ignores salon sales, and it ignores anyone who declined
     analytics — neither is visible to it, and the honest response to not
     being able to see someone is not to count them on one side only. */
  const conversion = funnel.sessions > 0 ? funnel.converted / funnel.sessions : 0;
  const prevConversion = funnel.prevSessions > 0 ? funnel.prevConverted / funnel.prevSessions : 0;

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
    cartsReturned,
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
 *   `paid`, `shipped` AND `delivered`. Pressing «Отправлен» or «Доставлен»
 *   must not make today's count and today's revenue drop in front of the
 *   owner, which is exactly what a strict `status = 'paid'` does in a shop
 *   that ships the same day.
 *   `cancelled`/`refunded` stay out — that money left again. «Аналитика»
 *   above reads the same constant, so the two tabs agree by construction.
 * · **Which stock.** Not a separate query: getOverrides() already merges the
 *   numeric levels over the manual в наличии/мало/нет override, tracked
 *   variants only (src/lib/inventory.ts's module doc). Reading it here is what
 *   makes «Заканчиваются» agree with the badge in the shop, by construction.
 * ========================================================================== */

/**
 * Tallinn midnight of the day `now` falls in — the same convention
 * rangeBounds("today") uses, and the same one qRevenueByDay names its rows by.
 * Re-exported rather than re-implemented: one rule, one definition.
 *
 * It was UTC midnight (startOfUtcDay) until 13.09.2026, which meant «заказы
 * сегодня» ignored everything the shop sold after 21:00 until the clock passed
 * midnight in Greenwich — three hours of an Estonian evening, every evening,
 * counted under yesterday.
 */
export { startOfShopDay } from "@/lib/day";

export type OverviewLowStockItem = { id: string; name: string; brand: string; stock: "low" | "out" };

export type OverviewSummary = {
  now: string;
  /** Paid orders placed in each calendar day, Tallinn (src/lib/day.ts). */
  orders: { today: number; yesterday: number };
  /** Paid orders of the last 7×24 hours. `perDay` is total ÷ 7, not ÷ days-with-a-sale. */
  revenue7d: { total: number; perDay: number; orders: number };
  /**
   * The same seven bars «Обзор» draws under the week's takings, over the same
   * window revenue7d sums — qRevenueByDay(), the one «Аналитика» itself reads,
   * so the two screens still agree by construction.
   *
   * It lives here since 13.09.2026 because of what it cost where it used to
   * come from: the panel's first screen called GET /api/admin/analytics?range=7d
   * — sixteen queries, several of them jsonb_array_elements scans over every
   * order — to use ONE of its seventeen fields. «Обзор» now makes one request
   * and this one extra (indexed, grouped, seven rows) query instead.
   */
  revenueByDay: Array<{ day: string; revenue: number; orders: number }>;
  lowStock: {
    total: number;
    low: number;
    out: number;
    /** Low or out AND off sale — counted, but not in `total`. See qOverviewLowStock(). */
    hidden: number;
    items: OverviewLowStockItem[];
    /** The same products by name, so the row can say WHICH ones are waiting
        behind the switch — a bare count sent the owner to a list of every
        hidden product to go and find them (Dim, 19.09.2026). */
    hiddenItems: OverviewLowStockItem[];
  };
  /** The five queues the owner is the only one who can empty. */
  attention: {
    ordersToShip: number;
    proRequests: number;
    reviewsPending: number;
    stockAlerts: number;
    /** Delivered orders whose customer ticked «Хочу вернуть заказ» — src/lib/returns.ts. */
    returnRequests: number;
  };
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
 * Ids neither the catalogue nor the owner's own rows carry are dropped — a
 * leftover override row for a discontinued product is not something to go
 * and re-order.
 */
async function qOverviewLowStock(): Promise<OverviewSummary["lowStock"]> {
  const overrides = await getOverrides();
  /* …with one exception, and only on this card. Since r19 a manual «нет в
     наличии» survives the count in getOverrides(), because that setting is
     «Снять с продажи» and the shop has to stop selling the product. But this
     card is about the SHELF — «что заканчивается, закажите ещё» — and a
     product the owner pulled with ten in the box is not running out. Where
     there is a real count, it decides here, exactly as it did before that
     rule existed. Best effort: no inventory module, no exception. */
  let counted: Record<string, "in" | "low" | "out"> = {};
  try {
    const { productStockStates } = await import("@/lib/inventory");
    counted = await productStockStates();
  } catch (err) {
    console.error("[analytics] numeric stock unavailable for «Заканчиваются»:", err);
  }
  /* Hidden products are counted, but separately (Dim, 19.09.2026). The card
     asks «что заканчивается, закажите ещё», and a product he has taken off
     sale is not something to re-order today — it does not belong in the
     number he acts on. Dropping it outright is the other half of the trap
     though: a bottle hidden BECAUSE it ran out would vanish from the only
     list that would have reminded him to order it, and stay hidden for ever.
     So the main figure is clean and one line says how many are waiting
     behind the switch. */
  const running: Array<[string, "low" | "out", boolean]> = [];
  for (const [id, o] of Object.entries(overrides)) {
    const stock = counted[id] ?? o.stock;
    if (stock !== "low" && stock !== "out") continue;
    running.push([id, stock, !!o.hidden]);
  }
  /* One round trip for both lists: the hidden ones are named too, because a
     row that says «2 скрытых товара заканчиваются» and nothing else can only
     be answered by reading every hidden product in the shop. */
  const names = await customNames(running.map(([id]) => id));
  /* «Показывать в магазине» off is one switch in the panel and two places on
     the server: `hidden` on the override row for a catalogue product, `active`
     on the owner's own row (custom_products) — which this card never read,
     so his own product switched off stayed in the number he acts on and out
     of the hidden line (verification pass 25.09.2026, panel-overview). */
  const short: Array<[string, "low" | "out"]> = [];
  const hidden: Array<[string, "low" | "out"]> = [];
  for (const [id, stock, off] of running) {
    (off || names.get(id)?.active === false ? hidden : short).push([id, stock]);
  }
  const resolve = (rows: Array<[string, "low" | "out"]>): OverviewLowStockItem[] => {
    const out: OverviewLowStockItem[] = [];
    for (const [id, stock] of rows) {
      if (BY_ID.has(id)) out.push({ ...productInfo(id), stock });
      else {
        const n = names.get(id);
        if (n) out.push({ id, name: n.name, brand: n.brand, stock });
      }
    }
    out.sort((a, b) =>
      a.stock === b.stock ? a.name.localeCompare(b.name, "ru") : a.stock === "out" ? -1 : 1,
    );
    return out;
  };
  const items = resolve(short);
  return {
    total: items.length,
    out: items.filter((i) => i.stock === "out").length,
    low: items.filter((i) => i.stock === "low").length,
    hidden: hidden.length,
    items: items.slice(0, 20),
    hiddenItems: resolve(hidden).slice(0, 20),
  };
}

/**
 * The five queues. One statement of five subselects rather than five round
 * trips — each is a count over an index this schema already carries
 * (orders_status_idx, customers_pro_pending_idx, reviews_status_idx,
 * stock_alerts_pending_idx, orders_return_requested_idx).
 *
 * `to_ship` leaves out the salon channel: a sale rung up at the counter is
 * created paid and handed over on the spot (POST /api/admin/pos-orders), so
 * it stays «paid» for good and is never a parcel — counting it made the
 * «Отправить N» badge grow with every salon sale, and disagree with the
 * orders list, which has always filtered those out (admLiveToShip in app.js).
 *
 * It also leaves out `shipping.method = 'digital'` — an order whose basket was
 * nothing but gift cards. The card is e-mailed the moment the payment lands
 * (src/lib/payments/receipt.ts), the order card has hidden its parcel steps
 * since the day the method existed, and yet «Отправить» counted it: the owner
 * was told a parcel was waiting that nobody could ever hand over (Dim,
 * 07.09.2026). The same order still counts as paid everywhere money is
 * counted — revenue, refunds, the customer's history. It is the *queue* it
 * does not belong in. `admOrderVM.toShip` in app.js is the same rule.
 *
 * «To ship» = every paid web order with a parcel, label or no label. Since the order-flow
 * rework a Montonio label («Создать этикетку») no longer moves the status —
 * the parcel is registered, but it is still on the shelf until the owner
 * presses «Отправлен» — so a paid order with a label ready is as much
 * waiting to go out as one without, and both stay in this count. The list's
 * «Новые» / «Этикетка готова» chips split the same set in two; their sum is
 * this number (admWaitingCount in app.js reads the loaded list and lands on
 * the same total).
 *
 * `returns` is the tick a customer put on a delivered order — «Хочу вернуть
 * заказ», src/lib/returns.ts. It counts the orders still standing at
 * «доставлен» and NOT yet stamped «Обработано» by the owner.
 *
 * Until 17.09.2026 the stamp did not exist and this number could only ever
 * rise: a refund that covers the order moves it to «возврат» and out of the
 * count, but a refund is the answer to only some returns. The one he settled
 * on the phone and the one he looked at and turned down both stayed in it for
 * good, under the words «те, на которые вы ещё не ответили». `doneAt` is that
 * answer, written by «Обработано» on the order card (setReturnHandled).
 *
 * The first two conditions are spelled exactly as orders_return_requested_idx
 * spells them (db/migrations/150_order_return_request.sql); the third narrows
 * the same set further, so the query's `where` still implies the index's
 * predicate and the partial index is still the one Postgres reaches for.
 */
async function qAttention(): Promise<OverviewSummary["attention"]> {
  const rows = await query<{ to_ship: string; pro: string; reviews: string; alerts: string; returns: string }>(
    `select
       (select count(*) from orders
          where status = 'paid' and channel <> 'pos'
            and coalesce(shipping->>'method', '') <> 'digital') as to_ship,
       (select count(*) from customers where pro_requested_at is not null and tier = 'retail') as pro,
       (select count(*) from reviews where status = 'pending') as reviews,
       (select count(*) from stock_alerts where sent_at is null) as alerts,
       (select count(*) from orders
          where status = 'delivered' and (shipping -> 'returnRequest') is not null
            and (shipping -> 'returnRequest' ->> 'doneAt') is null) as returns`,
  );
  const r = rows[0];
  return {
    ordersToShip: int(r?.to_ship),
    proRequests: int(r?.pro),
    reviewsPending: int(r?.reviews),
    stockAlerts: int(r?.alerts),
    returnRequests: int(r?.returns),
  };
}

/* ---------- the parcels waiting to go out, by name ------------------------
 *
 * Renat's acceptance run, 13.09.2026: «I am asking in english which orders are
 * waiting to be shipped and get russian answer that such information is not
 * loaded» — while «Обзор», on the very same screen, was showing «N заказов
 * ждут отправки». The count was in the panel and in qAttention() above; it was
 * never in the admin assistant's prompt, which said in so many words that «the
 * orders waiting to be shipped are not in this prompt».
 *
 * So the assistant gets the same queue the overview counts, and it gets it by
 * name: he asks WHICH orders, not how many. Same predicate as `to_ship` above
 * — paid, not the salon counter, not an all-gift-card basket — spelled the
 * same way so the number the assistant says and the number «Обзор» shows can
 * never drift apart. Oldest first: the parcel that has waited longest is the
 * one he needs to hear about.
 *
 * `labeled` is the Montonio sticker, exactly as admOrderVM() in
 * public/shop2/app.js reads it: a registered shipment that the journal has not
 * taken back. A label is not a hand-over — a labelled order is still on the
 * shelf — so it stays in the queue, and the flag is only there so the reply
 * can tell the owner which ones are ready to drop off.
 */
export type ToShipRow = {
  number: string;
  who: string;
  at: string;
  total: number;
  labeled: boolean;
};

export async function toShipOrders(limit = 10): Promise<{ total: number; rows: ToShipRow[] }> {
  const cap = Math.min(Math.max(Math.trunc(limit) || 0, 1), 50);
  const rows = await query<{
    number: string;
    name: string | null;
    email: string | null;
    created_at: string | Date;
    total: string | number;
    labeled: boolean | null;
    over: string;
  }>(
    `select number, name, email, created_at, total,
            ((shipping -> 'montonio' ->> 'shipmentId') is not null
              and coalesce(shipping -> 'montonio' ->> 'dismissed', 'false') <> 'true') as labeled,
            count(*) over () as over
       from orders
      where status = 'paid' and channel <> 'pos'
        and coalesce(shipping->>'method', '') <> 'digital'
      order by created_at asc
      limit $1`,
    [cap],
  );
  return {
    total: rows.length ? int(rows[0].over) : 0,
    rows: rows.map((r) => ({
      number: String(r.number || ""),
      who: String(r.name || r.email || "").trim(),
      at: shopDay(r.created_at),
      total: Number(r.total) || 0,
      labeled: r.labeled === true,
    })),
  };
}

/* ---------- the week, for the admin assistant -----------------------------
 *
 * Renat, 14.09.2026: the assistant offers «Покажи аналитику за неделю» and
 * then answers that the analytics are not loaded — open the «Аналитика» tab.
 * It was telling the truth: its prompt carried one sales window, «SALES, last
 * 30 days», built from whatever the panel had already fetched, and nothing in
 * it was ever seven days long. A suggestion that promises a figure the prompt
 * cannot hold is the defect; this is the figure.
 *
 * The SAME WINDOW «Обзор» sums, out of the same two queries, so the two
 * screens cannot disagree:
 *   · the window is rangeBounds("7d") — `now` back 7×24 h — which is exactly
 *     the `weekFrom` getOverviewSummary() computes for revenue7d, and exactly
 *     the range «Аналитика» draws for "7d".
 *   · qOrdersSummary() is the statement getAnalyticsSummary("7d") reads its
 *     revenue/orders KPI from. Its current-window predicate is qRevenue7d()'s,
 *     word for word (`status in (PAID_SQL)` over `created_at >= from < to`),
 *     and it carries the previous seven days in the same round trip — which is
 *     where «на сколько это больше прошлой недели» comes from, free.
 *   · qRevenueByDay() is «Обзор»'s own sparkline, named on the Tallinn
 *     calendar (src/lib/day.ts). A trailing 7×24 h window touches eight
 *     Tallinn days: its first and last are part-days, and that is what the
 *     bars already show.
 *
 * Two indexed queries in one Promise.all — deliberately NOT getAnalyticsSummary(),
 * whose sixteen queries (several of them jsonb_array_elements scans over every
 * order) were taken off the panel's first screen for being slow. Nobody should
 * pay for the funnel, the referrers and the abandoned carts to be told what the
 * shop took this week.
 */
export type WeekSales = {
  /** ISO instants of the window, for anyone who has to say what was counted. */
  from: string;
  to: string;
  revenue: number;
  orders: number;
  /** Takings ÷ orders, 0 with no orders. */
  aov: number;
  /** Takings ÷ 7, like «Обзор»'s revenue7d.perDay — not ÷ days-with-a-sale. */
  perDay: number;
  prevRevenue: number;
  prevOrders: number;
  /** Takings against the previous seven days, per cent; null when there is nothing to compare with. */
  deltaPct: number | null;
  /** «Обзор»'s own bars: one row per Tallinn day that had a paid order. */
  byDay: Array<{ day: string; revenue: number; orders: number }>;
};

export async function weekSales(now: Date = new Date()): Promise<WeekSales> {
  const { from, to, prevFrom } = rangeBounds("7d", now);
  const [sum, byDay] = await Promise.all([qOrdersSummary(from, to, prevFrom), qRevenueByDay(from, to)]);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    revenue: sum.revenue,
    orders: sum.orders,
    aov: sum.orders > 0 ? money(sum.revenue / sum.orders) : 0,
    perDay: money(sum.revenue / 7),
    prevRevenue: sum.prevRevenue,
    prevOrders: sum.prevOrders,
    deltaPct: kpi(sum.revenue, sum.prevRevenue).deltaPct,
    byDay,
  };
}

export async function getOverviewSummary(now: Date = new Date()): Promise<OverviewSummary> {
  const dayStart = startOfShopDay(now);
  const prevStart = new Date(dayStart.getTime() - 86_400_000);
  const weekFrom = new Date(now.getTime() - 7 * 86_400_000);

  const [orders, revenue7d, revenueByDay, lowStock, attention] = await Promise.all([
    qOrdersToday(dayStart, now, prevStart),
    qRevenue7d(weekFrom, now),
    /* The sparkline's own rows, alongside the other four rather than behind a
       second request to /api/admin/analytics — see revenueByDay in
       OverviewSummary for what that request was costing the first screen of
       the panel. Same window as qRevenue7d above, same function «Аналитика»
       calls for its "7d" range, so the bars and the total cannot disagree. */
    qRevenueByDay(weekFrom, now),
    qOverviewLowStock(),
    qAttention(),
  ]);

  return { now: now.toISOString(), orders, revenue7d, revenueByDay, lowStock, attention };
}
