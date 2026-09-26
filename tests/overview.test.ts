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
import { getOverviewSummary, startOfShopDay } from "@/lib/analytics";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { exec, query } from "@/lib/db";
import { move } from "@/lib/inventory";
import { createOrder, getOverrides, upsertOverride } from "@/lib/orders";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const inStock = CATALOGUE.filter((p) => p.s === "in");
const productA = inStock[0];
const productB = inStock.find((p) => p.b !== productA.b)!;
/* The catalogue file's own «мало» / «нет» — what the shop prints on those
   cards until the owner says otherwise. «Заканчиваются» counts them since
   26.09.2026 (src/lib/stock-word.ts): the row said 12 over a «Кончаются» chip
   of ~78 because it did not. */
const FILE_LOW = CATALOGUE.filter((p) => p.s === "low");
const FILE_OUT = CATALOGUE.filter((p) => p.s === "out");
/** The file's words set to «в наличии» by hand, so a case starts from an empty list. */
async function quietFile() {
  const ids = [...FILE_LOW, ...FILE_OUT].map((p) => p.id);
  await query(
    `insert into product_overrides (product_id, stock) values ${ids.map((_, i) => `($${i + 1}, 'in')`).join(", ")}`,
    ids,
  );
}

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
    /* …but for the stock row, which is not invented: the catalogue file's own
       «мало» and «нет», which the shop prints on those cards and «Каталог →
       Кончаются» lists — the row opens that list and says its length. */
    expect(o.lowStock).toMatchObject({ total: FILE_LOW.length + FILE_OUT.length, low: FILE_LOW.length, out: FILE_OUT.length, hidden: 0 });
    expect(o.lowStock.items).toHaveLength(Math.min(20, o.lowStock.total));
    expect(o.lowStock.items.slice(0, FILE_OUT.length).map((i) => i.stock)).toEqual(FILE_OUT.map(() => "out"));
    await quietFile();
    expect((await getOverviewSummary(NOW)).lowStock).toEqual({ total: 0, low: 0, out: 0, hidden: 0, items: [], hiddenItems: [] });
    // `hidden` and `hiddenItems` are one statement in two halves (Dim, 19.09.2026):
    // how many are waiting behind the switch, and which ones. A fresh shop has to
    // pin both, or the card can go back to saying «2 скрытых товара заканчиваются»
    // with nothing behind the number — the same invented figure as «вчера — 5»,
    // one row further down. The list has to BE there and be empty: the panel reads
    // it to decide whether to draw the row at all.
    expect(o.lowStock.hiddenItems).toEqual([]);
    expect(o.lowStock.hiddenItems).toHaveLength(o.lowStock.hidden);
    expect(o.attention).toEqual({
      ordersToShip: 0,
      proRequests: 0,
      reviewsPending: 0,
      stockAlerts: 0,
      returnRequests: 0,
    });
    expect(o.now).toBe(NOW.toISOString());
  });

  /* ---------- orders today / yesterday ------------------------------------- */

  it("counts paid orders by the day they were placed, today apart from yesterday", async () => {
    await orderAt(at("2026-06-15T09:00:00Z"));               // 12:00 Tallinn — today
    await orderAt(at("2026-06-14T21:00:01Z"));               // 00:00:01 Tallinn — today, one second in
    await orderAt(at("2026-06-14T20:59:59Z"));               // 23:59:59 Tallinn — yesterday, one second earlier
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

  it("puts the day boundary at TALLINN midnight, the same place rangeBounds(\"today\") does", () => {
    // 21:00 UTC on the 14th is midnight on the 15th where the shop is. It used
    // to be UTC midnight, which handed the shop's last three evening hours to
    // the day before — see tests/shop-day.test.ts for the whole rule.
    expect(startOfShopDay(NOW).toISOString()).toBe("2026-06-14T21:00:00.000Z");
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
    await quietFile();
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

  it("a real count beats the owner's «мало» for the same product", async () => {
    await quietFile();
    await upsertOverride(productA.id, { stock: "low" });
    // Ten in the box: the badge follows the count, so it is not «заканчивается»
    await move({ productId: productA.id, delta: 10, reason: "goods_in", actor: "test" });

    const o = await getOverviewSummary(NOW);
    expect(o.lowStock.total).toBe(0);
  });

  /* …but not a hand-set «Нет в наличии»: since r19 no count may talk the
     storefront past it, so the shop says «нет», the catalogue badges it «Нет»
     and lists it under «Кончаются» — the chip that took the place of «Нет в
     наличии» (q17). This card used to be the one place that looked past it
     («ten in the box is not running out»), and so said a number no list in
     the panel held (Dim, 26.09.2026). One rule now, the list's. */
  it("a hand-set «Нет в наличии» over ten in the box is on the list, as the shop says «нет»", async () => {
    await quietFile();
    await upsertOverride(productA.id, { stock: "out" });
    await move({ productId: productA.id, delta: 10, reason: "goods_in", actor: "test" });

    expect((await getOverrides([productA.id]))[productA.id]?.stock).toBe("out");
    const low = (await getOverviewSummary(NOW)).lowStock;
    expect(low.total).toBe(1);
    expect(low.items).toEqual([{ id: productA.id, name: productA.n, brand: productA.b, stock: "out" }]);
  });

  it("a size counted out on a product whose other sizes are full: on the list, once", async () => {
    await quietFile();
    const sizes = ["75 мл", "250 мл", "500 мл"];
    const p = CATALOGUE.find((m) => m.id === "system-4-bio-botanical-shampoo")!;
    await move({ productId: p.id, variant: sizes[0], delta: 1, reason: "goods_in", actor: "test" });
    await move({ productId: p.id, variant: sizes[0], delta: -1, reason: "adjust", actor: "test" });
    for (const v of sizes.slice(1)) await move({ productId: p.id, variant: v, delta: 10, reason: "goods_in", actor: "test" });
    // the shop still sells it — the product's word is «в наличии» — but a size is gone
    expect((await getOverrides([p.id]))[p.id]?.stock).toBe("in");
    const low = (await getOverviewSummary(NOW)).lowStock;
    expect(low.total).toBe(1);
    expect(low.items).toEqual([{ id: p.id, name: p.n, brand: p.b, stock: "low" }]);
  });

  it("ignores an override row for a product the catalogue no longer carries", async () => {
    await quietFile();
    await upsertOverride("a-product-that-was-discontinued", { stock: "out" });
    const o = await getOverviewSummary(NOW);
    expect(o.lowStock.total).toBe(0);
  });

  /* ---------- «Требует внимания» -------------------------------------------- */

  it("counts the five queues only the owner can empty", async () => {
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

    /* returns: the tick a customer put on a delivered order — «Хочу вернуть
       заказ», src/lib/returns.ts. The second one is the same tick on an order
       that has since been refunded: the money went back, the queue is
       answered, and only the delivered one is still waiting for the owner. */
    const asked = await orderAt(at("2026-06-10T09:00:00Z"), "delivered");
    const answered = await orderAt(at("2026-06-09T09:00:00Z"), "refunded");
    for (const o of [asked, answered]) {
      await query(
        `update orders set shipping = shipping || jsonb_build_object('returnRequest', jsonb_build_object('at', $2::text))
          where id = $1`,
        [o.id, at("2026-06-12T09:00:00Z").toISOString()],
      );
    }

    const o = await getOverviewSummary(NOW);
    expect(o.attention).toEqual({
      ordersToShip: 1,
      proRequests: 1,
      reviewsPending: 1,
      stockAlerts: 1,
      returnRequests: 1,
    });
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
