/**
 * src/lib/analytics.ts — the SQL behind the admin's «Аналитика» tab, run
 * against seeded orders (money) and events (behaviour). One fixed `now` so
 * every range/window in the assertions is exact, not "whatever today is".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { ADMIN_COOKIE, hashPassword, makeSessionToken } from "@/lib/auth";
import { getAnalyticsSummary, PAID_STATUSES, rangeBounds } from "@/lib/analytics";
import { exec, query } from "@/lib/db";
import { createOrder, type OrderStatus } from "@/lib/orders";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const inStock = CATALOGUE.filter((p) => p.s === "in");
const productA = inStock[0];
const productB = inStock.find((p) => p.b !== productA.b)!;

const NOW = new Date("2026-06-15T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const customer = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };

/** createOrder() always makes a fresh, unpaid, now-stamped order — this backdates
 *  it and marks it paid (or whatever `status` says: 'shipped' is what «Отправлен»
 *  leaves behind), exactly what would have happened on the real paid transition
 *  (src/lib/payments/apply.ts) plus the admin's status button, without
 *  re-implementing pricing here. Returns the order (id + its real total, which
 *  includes shipping — a test must compare against THIS, not against price × qty
 *  on its own). */
async function orderAt(items: Array<{ id: string; qty: number }>, at: Date, status: OrderStatus = "paid") {
  const o = await createOrder({ lang: "ru", items, customer, shipping: { method: "parcel", country: "EE" } });
  await query("update orders set status = $2, created_at = $3, updated_at = $3 where id = $1", [o.id, status, at.toISOString()]);
  return o;
}

async function event(row: {
  at: Date; sid?: string; type: string; path?: string; productId?: string; value?: number;
  ref?: string; uaClass?: string; country?: string;
}) {
  await query(
    `insert into events (at, sid, type, path, product_id, value, ref, ua_class, country)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [row.at.toISOString(), row.sid ?? null, row.type, row.path ?? null, row.productId ?? null, row.value ?? null, row.ref ?? null, row.uaClass ?? null, row.country ?? null],
  );
}

describe("getAnalyticsSummary", () => {
  beforeAll(async () => {
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec(
      "truncate events, orders, promo_codes, promo_code_uses, gift_cards, gift_card_uses, carts, product_overrides restart identity cascade",
    );
  });

  it("computes revenue, orders and AOV for paid orders in range only, with a previous-period delta", async () => {
    const o1 = await orderAt([{ id: productA.id, qty: 1 }], days(2));   // in the 7d window
    const o2 = await orderAt([{ id: productA.id, qty: 2 }], days(3));   // in the 7d window
    await orderAt([{ id: productA.id, qty: 1 }], days(20));  // well outside 7d and its previous period
    const o3 = await orderAt([{ id: productA.id, qty: 5 }], days(10)); // the PREVIOUS 7-day period (7..14 days back)
    const unpaid = await createOrder({ lang: "ru", items: [{ id: productA.id, qty: 9 }], customer, shipping: { method: "parcel", country: "EE" } });
    await query("update orders set created_at = $2 where id = $1", [unpaid.id, days(1).toISOString()]); // stays 'new'

    const a = await getAnalyticsSummary("7d", NOW);
    expect(a.kpi.orders.value).toBe(2);
    // real order totals (they include shipping) — not price × qty on its own
    expect(a.kpi.revenue.value).toBeCloseTo(o1.total + o2.total, 2);
    expect(a.kpi.aov.value).toBeCloseTo(a.kpi.revenue.value / 2, 2);
    // previous period (7-14 days back) held exactly the 5-unit order
    expect(a.kpi.orders.prevValue).toBe(1);
    expect(a.kpi.revenue.prevValue).toBeCloseTo(o3.total, 2);
    expect(a.kpi.revenue.deltaPct).not.toBeNull();
  });

  it("keeps counting an order after «Отправлен» — shipped is money that stayed; cancelled and refunded are not", async () => {
    // Same-day shipping is the norm here: if 'shipped' dropped out of the money
    // queries, every figure on the tab would fall over the moment the owner
    // pressed the button. PAID_STATUSES (src/lib/analytics.ts) is the one rule
    // both tabs share; this pins «Аналитика» to it.
    const shipped = await orderAt([{ id: productA.id, qty: 1 }], days(1), "shipped");
    await orderAt([{ id: productB.id, qty: 1 }], days(1), "cancelled"); // money left again
    await orderAt([{ id: productB.id, qty: 1 }], days(1), "refunded");  // and again
    await event({ at: days(1), sid: "s1", type: "product", productId: productA.id }); // viewed, then bought (shipped)

    const a = await getAnalyticsSummary("7d", NOW);
    expect(a.kpi.orders.value).toBe(1);
    expect(a.kpi.revenue.value).toBeCloseTo(shipped.total, 2);
    expect(a.revenueByDay).toHaveLength(1);
    expect(a.revenueByDay[0]).toMatchObject({ orders: 1 });
    expect(a.revenueByDay[0].revenue).toBeCloseTo(shipped.total, 2);
    expect(a.topProductsByRevenue.map((p) => p.id)).toEqual([productA.id]);
    expect(a.brandRevenue.map((b) => b.brand)).toEqual([productA.b]);
    // bought (in the shipped order) → not «смотрят, но не покупают»
    expect(a.viewedNotBought.map((p) => p.id)).not.toContain(productA.id);
  });

  it("keeps the partial index on orders literally in sync with PAID_STATUSES", async () => {
    // Postgres uses a partial index only when the query's predicate implies
    // the index's. The money queries filter `status in (PAID_SQL)`, so the
    // index in db/migrations/081_orders_sales_idx.sql must spell out exactly
    // the same statuses — widen one without the other and the index is dead
    // weight (which is what happened to 080's `status = 'paid'` one).
    const rows = await query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes
        where tablename = 'orders' and indexname in ('orders_sales_created_idx', 'orders_paid_created_idx')`,
    );
    expect(rows.map((r) => r.indexname)).toEqual(["orders_sales_created_idx"]); // and the 080 one is dropped
    const def = rows[0].indexdef;
    expect(def).toContain("(created_at)");
    // Postgres stores `in ('paid', 'shipped')` as `= ANY (ARRAY['paid'::text, 'shipped'::text])`
    const literals = [...def.matchAll(/'([a-z_]+)'::/g)].map((m) => m[1]).sort();
    expect(literals).toEqual([...PAID_STATUSES].sort());
  });

  it("bounds today/7d/30d/90d as trailing windows ending now, each one longer than the last", () => {
    const t = rangeBounds("today", NOW), d7 = rangeBounds("7d", NOW), d30 = rangeBounds("30d", NOW), d90 = rangeBounds("90d", NOW);
    expect(t.to.getTime()).toBe(NOW.getTime());
    // "from" 7 days back is a LATER (larger) timestamp than "from" 30 days back
    expect(d7.from.getTime()).toBeGreaterThan(d30.from.getTime());
    expect(d30.from.getTime()).toBeGreaterThan(d90.from.getTime());
    // previous period is exactly as long as the window and immediately before it
    expect(d7.prevTo.getTime()).toBe(d7.from.getTime());
    expect(d7.from.getTime() - d7.prevFrom.getTime()).toBe(d7.to.getTime() - d7.from.getTime());
  });

  it("breaks revenue down by product and by brand from the paid orders' own line items", async () => {
    await orderAt([{ id: productA.id, qty: 1 }], days(1));
    await orderAt([{ id: productB.id, qty: 1 }], days(1));
    const a = await getAnalyticsSummary("7d", NOW);

    const top = a.topProductsByRevenue.find((p) => p.id === productA.id);
    expect(top).toMatchObject({ id: productA.id, brand: productA.b, revenue: productA.p });

    const brandRow = a.brandRevenue.find((r) => r.brand === productA.b);
    expect(brandRow).toMatchObject({ brand: productA.b, orders: 1 });
    expect(brandRow!.revenue).toBeCloseTo(productA.p, 2);
  });

  it("builds the funnel from distinct sessions per stage, and excludes the server-authoritative purchase row", async () => {
    await event({ at: days(1), sid: "s1", type: "view", path: "/shop2/" });
    await event({ at: days(1), sid: "s2", type: "view", path: "/shop2/" });
    await event({ at: days(1), sid: "s1", type: "product", productId: productA.id });
    await event({ at: days(1), sid: "s1", type: "add_to_cart", productId: productA.id, value: productA.p });
    await event({ at: days(1), sid: "s1", type: "checkout", value: productA.p });
    await event({ at: days(1), sid: "s1", type: "purchase", value: productA.p }); // client, funnel-only
    await event({ at: days(1), sid: "server", type: "purchase", value: 999 });    // server-authoritative, not a session

    const a = await getAnalyticsSummary("7d", NOW);
    expect(a.funnel.sessions).toBe(2);
    expect(a.funnel.product).toBe(1);
    expect(a.funnel.addToCart).toBe(1);
    expect(a.funnel.checkout).toBe(1);
    expect(a.funnel.purchase).toBe(1); // NOT 2 — the server row must not count as a session
  });

  it("finds products that were viewed but never added to cart or bought, and excludes the rest", async () => {
    // productA: viewed and carted -> must NOT appear
    await event({ at: days(1), sid: "s1", type: "product", productId: productA.id });
    await event({ at: days(1), sid: "s1", type: "add_to_cart", productId: productA.id, value: productA.p });
    // productB: viewed only -> must appear
    await event({ at: days(1), sid: "s2", type: "product", productId: productB.id });
    await event({ at: days(1), sid: "s3", type: "product", productId: productB.id });

    const a = await getAnalyticsSummary("7d", NOW);
    expect(a.viewedNotBought.map((p) => p.id)).toEqual([productB.id]);
    expect(a.viewedNotBought[0].views).toBe(2);
    expect(a.topProductsByViews.find((p) => p.id === productA.id)).toBeTruthy();
  });

  it("splits search terms into the popular list and the zero-result list from one events shape", async () => {
    await event({ at: days(1), sid: "s1", type: "search", path: "davines", value: 4 });
    await event({ at: days(1), sid: "s2", type: "search", path: "davines", value: 6 });
    await event({ at: days(1), sid: "s3", type: "search", path: "асдасд", value: 0 });

    const a = await getAnalyticsSummary("7d", NOW);
    expect(a.searchTerms.find((s) => s.term === "davines")?.count).toBe(2);
    expect(a.zeroResultTerms).toEqual([{ term: "асдасд", count: 1 }]);
  });

  it("reads promo usage, gift cards, abandoned carts and low stock from their own tables", async () => {
    await query(
      "insert into promo_codes (code, kind, value) values ('SUVI10', 'percent', 10)",
    );
    await query(
      "insert into promo_code_uses (code, order_id, amount, created_at) values ('SUVI10', null, 5, $1)",
      [days(1).toISOString()],
    );
    await query(
      "insert into gift_cards (code, amount, balance, created_at) values ('RMP-AAAA-1111', 50, 50, $1)",
      [days(1).toISOString()],
    );
    await query(
      "insert into gift_card_uses (code, amount, created_at) values ('RMP-AAAA-1111', 20, $1)",
      [days(1).toISOString()],
    );
    await query(
      "insert into carts (email, items, total, updated_at) values ('abandoned@example.com', '[]'::jsonb, 30, $1)",
      [days(1).toISOString()],
    );
    await query(
      "insert into product_overrides (product_id, stock) values ($1, 'low')",
      [productA.id],
    );

    const a = await getAnalyticsSummary("7d", NOW);
    expect(a.promoUsage).toEqual([{ code: "SUVI10", kind: "percent", value: 10, uses: 1, amount: 5 }]);
    expect(a.giftCards).toEqual({ sold: { count: 1, amount: 50 }, redeemed: { count: 1, amount: 20 } });
    expect(a.abandonedCarts).toBe(1);
    expect(a.lowStock.find((p) => p.id === productA.id)).toMatchObject({ stock: "low" });
  });

  it("splits traffic by device, country and referrer host, counting sessions not raw events", async () => {
    await event({ at: days(1), sid: "s1", type: "view", uaClass: "mobile", country: "EE", ref: "google.com" });
    await event({ at: days(1), sid: "s1", type: "view", uaClass: "mobile", country: "EE", ref: "google.com" }); // same session again
    await event({ at: days(1), sid: "s2", type: "view", uaClass: "desktop", country: "LV", ref: "instagram.com" });

    const a = await getAnalyticsSummary("7d", NOW);
    expect(a.traffic.device).toEqual({ mobile: 1, desktop: 1 });
    expect(a.traffic.countries.sort((x, y) => x.country.localeCompare(y.country))).toEqual([
      { country: "EE", sessions: 1 }, { country: "LV", sessions: 1 },
    ]);
    expect(a.traffic.referrers.find((r) => r.host === "google.com")?.sessions).toBe(1);
  });

  it("counts chat opens in range", async () => {
    await event({ at: days(1), sid: "s1", type: "chat" });
    await event({ at: days(20), sid: "s1", type: "chat" }); // outside 7d
    const a = await getAnalyticsSummary("7d", NOW);
    expect(a.chatOpens).toBe(1);
  });
});

describe("GET /api/admin/analytics", () => {
  let adminCookie = "";
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    adminCookie = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate events, orders restart identity cascade");
  });

  it("401s without the admin cookie", async () => {
    const { GET } = await import("@/app/api/admin/analytics/route");
    const res = await GET(new Request("https://rempireshop.com/api/admin/analytics/?range=7d"));
    expect(res.status).toBe(401);
  });

  it("400s an unknown range and 200s a known one", async () => {
    const { GET } = await import("@/app/api/admin/analytics/route");
    const bad = await GET(new Request("https://rempireshop.com/api/admin/analytics/?range=nonsense", { headers: { cookie: adminCookie } }));
    expect(bad.status).toBe(400);
    const ok = await GET(new Request("https://rempireshop.com/api/admin/analytics/?range=30d", { headers: { cookie: adminCookie } }));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.ok).toBe(true);
    expect(body.range).toBe("30d");
  });
});
