/**
 * src/lib/analytics.ts getOverviewSummary() — every number on the admin's
 * «Обзор» tab, plus the route that serves it.
 *
 * The point of this file is the promise the tab now makes: a fresh shop shows
 * zeros, not invented numbers, and every figure that is not zero can be traced
 * back to a row somebody actually created. One fixed `now` so "сегодня" and
 * "вчера" are exact rather than "whatever today happens to be".
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { getOverviewSummary, startOfUtcDay } from "@/lib/analytics";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { exec, query } from "@/lib/db";
import { move } from "@/lib/inventory";
import { createOrder, upsertOverride } from "@/lib/orders";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const inStock = CATALOGUE.filter((p) => p.s === "in");
const productA = inStock[0];
const productB = inStock.find((p) => p.b !== productA.b)!;

/** Mid-afternoon UTC, so "today" and "yesterday" cannot straddle a boundary. */
const NOW = new Date("2026-06-15T14:00:00Z");
const at = (iso: string) => new Date(iso);

const customer = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };

/** A real order, priced by createOrder(), then backdated and marked paid —
 *  the same shape the paid transition leaves behind (src/lib/payments/apply.ts). */
async function orderAt(when: Date, status = "paid", items = [{ id: productA.id, qty: 1 }]) {
  const o = await createOrder({ lang: "ru", items, customer, shipping: { method: "parcel", country: "EE" } });
  await query("update orders set status = $2, created_at = $3, updated_at = $3 where id = $1", [
    o.id,
    status,
    when.toISOString(),
  ]);
  return o;
}

/** The same, for a basket that is nothing but a gift card — `shipping.method`
 *  comes back «digital» and there is no parcel to wait for. */
async function giftOrderAt(when: Date, status = "paid") {
  const o = await createOrder({
    lang: "ru",
    items: [{ id: "gift:50", qty: 1, meta: { name: "Mari", email: "mari@example.com" } }],
    customer,
    shipping: { method: "digital", country: "EE" },
  });
  await query("update orders set status = $2, created_at = $3, updated_at = $3 where id = $1", [
    o.id,
    status,
    when.toISOString(),
  ]);
  return o;
}

describe("getOverviewSummary", () => {
  beforeAll(async () => {
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec(
      "truncate orders, product_overrides, stock_levels, stock_moves, customers, reviews, stock_alerts restart identity cascade",
    );
  });

  /* ---------- the empty shop ----------------------------------------------- */

  it("a fresh database is all zeros — no invented «вчера — 5»", async () => {
    const o = await getOverviewSummary(NOW);
    expect(o.orders).toEqual({ today: 0, yesterday: 0 });
    expect(o.revenue7d).toEqual({ total: 0, perDay: 0, orders: 0 });
    expect(o.lowStock).toEqual({ total: 0, low: 0, out: 0, items: [] });
    expect(o.attention).toEqual({ ordersToShip: 0, proRequests: 0, reviewsPending: 0, stockAlerts: 0 });
    expect(o.now).toBe(NOW.toISOString());
  });

  /* ---------- orders today / yesterday ------------------------------------- */

  it("counts paid orders by the day they were placed, today apart from yesterday", async () => {
    await orderAt(at("2026-06-15T09:00:00Z"));               // today
    await orderAt(at("2026-06-15T00:00:01Z"));               // today, just after UTC midnight
    await orderAt(at("2026-06-14T23:59:59Z"));               // yesterday, one second earlier
    await orderAt(at("2026-06-13T12:00:00Z"));               // the day before — neither
    await orderAt(at("2026-06-15T10:00:00Z"), "new");        // never paid — not an order yet
    await orderAt(at("2026-06-15T10:00:00Z"), "cancelled");  // money left again

    const o = await getOverviewSummary(NOW);
    expect(o.orders).toEqual({ today: 2, yesterday: 1 });
  });

  it("keeps counting an order after it has been marked «Отправлен»", async () => {
    // The whole point of PAID_STATUSES: pressing «Отправлен» must not make
    // today's numbers fall over in front of the owner.
    await orderAt(at("2026-06-15T09:00:00Z"), "shipped");
    const o = await getOverviewSummary(NOW);
    expect(o.orders.today).toBe(1);
    expect(o.revenue7d.orders).toBe(1);
    expect(o.revenue7d.total).toBeGreaterThan(0);
  });

  it("puts the day boundary at UTC midnight, the same place rangeBounds(\"today\") does", () => {
    expect(startOfUtcDay(NOW).toISOString()).toBe("2026-06-15T00:00:00.000Z");
  });

  /* ---------- revenue over the last seven days ------------------------------ */

  it("sums seven days of paid orders and divides by seven, whatever the calendar did", async () => {
    const a = await orderAt(at("2026-06-15T09:00:00Z"));
    const b = await orderAt(at("2026-06-10T09:00:00Z"));
    await orderAt(at("2026-06-01T09:00:00Z")); // outside the window
    await orderAt(at("2026-06-12T09:00:00Z"), "failed");

    const o = await getOverviewSummary(NOW);
    expect(o.revenue7d.orders).toBe(2);
    expect(o.revenue7d.total).toBeCloseTo(a.total + b.total, 2);
    // per-day is the seven-day average, not "average of the days that had a sale"
    expect(o.revenue7d.perDay).toBeCloseTo((a.total + b.total) / 7, 2);
  });

  /* ---------- «Заканчиваются» ----------------------------------------------- */

  it("reads low stock from a real count where there is one, and from the manual override elsewhere", async () => {
    // productA: counted for real. One unit in, default threshold 2 → «мало».
    const res = await move({ productId: productA.id, delta: 1, reason: "goods_in", actor: "test" });
    expect(res.skipped).toBeFalsy();
    // productB: never counted — the owner's own «нет в наличии» still rules it.
    await upsertOverride(productB.id, { stock: "out" });

    const o = await getOverviewSummary(NOW);
    expect(o.lowStock.total).toBe(2);
    expect(o.lowStock.low).toBe(1);
    expect(o.lowStock.out).toBe(1);
    // sold out first — that is the one that is costing money right now
    expect(o.lowStock.items[0]).toMatchObject({ id: productB.id, stock: "out" });
    expect(o.lowStock.items.map((i) => i.id)).toContain(productA.id);
    expect(o.lowStock.items.find((i) => i.id === productA.id)).toMatchObject({
      stock: "low",
      name: productA.n,
      brand: productA.b,
    });
  });

  it("a real count beats the manual override for the same product", async () => {
    await upsertOverride(productA.id, { stock: "out" });
    // Ten in the box: the badge follows the count, so it is not «заканчивается»
    await move({ productId: productA.id, delta: 10, reason: "goods_in", actor: "test" });

    const o = await getOverviewSummary(NOW);
    expect(o.lowStock.total).toBe(0);
  });

  it("ignores an override row for a product the catalogue no longer carries", async () => {
    await upsertOverride("a-product-that-was-discontinued", { stock: "out" });
    const o = await getOverviewSummary(NOW);
    expect(o.lowStock.total).toBe(0);
  });

  /* ---------- «Требует внимания» -------------------------------------------- */

  it("counts the four queues only the owner can empty", async () => {
    await orderAt(at("2026-06-15T09:00:00Z"), "paid");     // waiting to be shipped
    await orderAt(at("2026-06-14T09:00:00Z"), "shipped");  // already gone — not waiting
    await orderAt(at("2026-06-14T09:00:00Z"), "new");      // never paid — not waiting either
    // a salon sale is created paid and handed over at the counter — never a
    // parcel, so never «ждёт отправки» (the list filters it out the same way)
    const salon = await orderAt(at("2026-06-15T10:00:00Z"), "paid");
    await query("update orders set channel = 'pos' where id = $1", [salon.id]);
    // an all-gift-card order is «digital»: the card was e-mailed when the
    // payment landed, so there is no parcel for the owner to hand over and it
    // must not sit in «Отправить» (Dim, 07.09.2026)
    await giftOrderAt(at("2026-06-15T11:00:00Z"));

    await query(
      "insert into customers (email, tier, pro_requested_at) values ($1, 'retail', now()), ($2, 'retail', null), ($3, 'pro', now())",
      ["salon@example.com", "shopper@example.com", "approved@example.com"],
    );
    await query(
      `insert into reviews (product_id, name, rating, text, status)
       values ($1, 'Ano', 5, 'ждёт проверки', 'pending'), ($1, 'Bno', 4, 'уже одобрен', 'approved')`,
      [productA.id],
    );
    await query(
      "insert into stock_alerts (email, product_id, sent_at) values ($1, $3, null), ($2, $3, now())",
      ["waiting@example.com", "already-told@example.com", productB.id],
    );

    const o = await getOverviewSummary(NOW);
    expect(o.attention).toEqual({ ordersToShip: 1, proRequests: 1, reviewsPending: 1, stockAlerts: 1 });
  });
});

/* ---------- the route ------------------------------------------------------ */

describe("GET /api/admin/overview", () => {
  const ORIGIN = "https://rempireshop.com";

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    resetRateLimits();
    await exec("truncate orders, product_overrides, stock_levels, stock_moves restart identity cascade");
  });

  const get = (cookie?: string) =>
    new Request(`${ORIGIN}/api/admin/overview/`, { headers: cookie ? { cookie } : {} });

  it("turns away anyone without the admin cookie", async () => {
    const { GET } = await import("@/app/api/admin/overview/route");
    expect((await GET(get())).status).toBe(401);
    expect((await GET(get(`${ADMIN_COOKIE}=v1.9999999999.deadbeef`))).status).toBe(401);
  });

  it("answers the signed-in owner with the whole summary and never caches it", async () => {
    const { GET } = await import("@/app/api/admin/overview/route");
    await orderAt(at("2026-06-15T09:00:00Z"));
    const res = await GET(get(`${ADMIN_COOKIE}=${makeSessionToken()}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.orders).toBeDefined();
    expect(body.revenue7d).toBeDefined();
    expect(body.lowStock).toBeDefined();
    expect(body.attention).toBeDefined();
  });
});
