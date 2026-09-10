/**
 * The customer card's GET — what is behind «Заказов: 2 · Потратил: …».
 *
 * Dim, 10.09.2026: the card said two orders and a sum and showed no orders,
 * no analytics, nothing else. GET /api/admin/customers/<id> now carries the
 * orders under that e-mail, four facts drawn from them and the customer's
 * reviews (src/lib/loyalty.ts customerOrdersAdmin, src/lib/reviews.ts
 * reviewsByAuthor). Runs on PGlite, no server needed.
 *
 * What this file exists to catch: a guest order that does not show on the
 * account it belongs to; a cancelled order counted as a purchase; a first
 * order that is really the last; a namesake matched by a half of a name; a
 * review lost because it was signed in lower case; an e-mail id that answers
 * differently from the uuid one.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { recordLogin, updateCustomer } from "@/lib/customers";
import { exec, query } from "@/lib/db";
import { customerOrdersAdmin } from "@/lib/loyalty";
import { createOrder, setOrderStatus } from "@/lib/orders";
import { addReview, reviewsByAuthor, setReviewStatus } from "@/lib/reviews";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];

/* Two in-stock products of two different brands, so «Любимые бренды» has an order to put them in. */
const first = CATALOGUE.find((p) => p.s === "in")!;
const second = CATALOGUE.find((p) => p.s === "in" && p.b !== first.b)!;

const EMAIL = "maria.tamm@example.com";
const NAME = "Мария Тамм";
const BASE = "https://test.rempireshop.com";
const ship = { method: "parcel", country: "EE" };

let admin = "";

function req(url: string): Request {
  return new Request(url, { headers: { cookie: admin, "x-forwarded-for": "203.0.113.9" } });
}

async function card(id: string) {
  const route = await import("@/app/api/admin/customers/[id]/route");
  const res = await route.GET(req(`${BASE}/api/admin/customers/${encodeURIComponent(id)}/`), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as CardBody };
}

interface CardBody {
  ok: boolean;
  customer: { id: string; email: string; ordersCount: number; revenue: number };
  orders: Array<{ id: string; number: string; createdAt: string; total: number; status: string; itemsCount: number; firstItem: string; channel: string; labeled: boolean; invoice: unknown }>;
  stats: { firstOrderAt: string | null; lastOrderAt: string | null; avgOrder: number; topBrands: Array<{ brand: string; spent: number }> };
  reviews: Array<{ id: string; productId: string; product: string; rating: number; text: string; status: string; createdAt: string; name: string }>;
}

/** An order under `email`, signed `name`, dated `daysAgo` — a guest checkout unless a customer id is given. */
async function order(email: string, name: string, items: Array<{ id: string; qty: number }>, daysAgo: number, customerId?: string) {
  const o = await createOrder(
    { lang: "ru", items, customer: { name, email, phone: "+372 5555 5555" }, shipping: ship },
    customerId ? { customerId } : {},
  );
  await query("update orders set created_at = $2 where id = $1", [o.id, new Date(Date.now() - daysAgo * 86_400_000).toISOString()]);
  return o;
}

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
  await setupDb();
  admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
});

afterAll(async () => {
  await teardownDb();
});

beforeEach(async () => {
  resetRateLimits();
  vi.spyOn(console, "error").mockImplementation(() => {});
  await exec(
    "truncate customers, loyalty_ledger, orders, reviews, product_overrides, settings, admin_audit, login_codes, carts, stock_alerts restart identity cascade",
  );
});

describe("customerOrdersAdmin — the orders behind the card", () => {
  it("lists every order under the e-mail, guest ones included, newest first", async () => {
    const me = await recordLogin(EMAIL, "RU");
    const old = await order(EMAIL, NAME, [{ id: first.id, qty: 2 }], 30);
    const mid = await order(EMAIL, NAME, [{ id: second.id, qty: 1 }], 10, me.id);
    const fresh = await order("MARIA.TAMM@example.com", "Maria Tamm", [{ id: first.id, qty: 1 }, { id: second.id, qty: 1 }], 1);
    await order("someone.else@example.com", "Кто-то другой", [{ id: first.id, qty: 1 }], 2);

    const { orders, names } = await customerOrdersAdmin(EMAIL);
    expect(orders.map((o) => o.number)).toEqual([fresh.number, mid.number, old.number]);
    expect(orders[0]).toMatchObject({
      id: fresh.id, status: "new", channel: "web", labeled: false, invoice: null, itemsCount: 2,
      firstItem: `${first.b} — ${first.n}`, total: fresh.total,
    });
    expect(orders[2].itemsCount).toBe(2);
    // the names this person signed with — what the review match is keyed on
    expect(names.sort()).toEqual(["Maria Tamm", NAME].sort());
  });

  it("draws the facts from purchases only — cancelled and failed do not count, and the dates are the right way round", async () => {
    const a = await order(EMAIL, NAME, [{ id: first.id, qty: 2 }], 40);
    const b = await order(EMAIL, NAME, [{ id: second.id, qty: 1 }], 20);
    const c = await order(EMAIL, NAME, [{ id: first.id, qty: 5 }], 5);
    const d = await order(EMAIL, NAME, [{ id: second.id, qty: 9 }], 1);
    await setOrderStatus(a.id, "paid");
    await setOrderStatus(b.id, "paid");
    await setOrderStatus(c.id, "cancelled");
    await setOrderStatus(d.id, "failed");

    const { orders, stats } = await customerOrdersAdmin(EMAIL);
    // the history still lists all four
    expect(orders).toHaveLength(4);
    expect(orders.map((o) => o.status)).toEqual(["failed", "cancelled", "paid", "paid"]);

    expect(stats.firstOrderAt).toBe(orders[3].createdAt);
    expect(stats.lastOrderAt).toBe(orders[2].createdAt);
    expect(stats.avgOrder).toBe(Math.round(((a.total + b.total) / 2) * 100) / 100);
    // brands by spend: two of `first` against one of `second` — and nothing from the cancelled five or the failed nine
    const spentFirst = Math.round(a.items[0].sum * 100) / 100;
    const spentSecond = Math.round(b.items[0].sum * 100) / 100;
    const want = [{ brand: first.b, spent: spentFirst }, { brand: second.b, spent: spentSecond }]
      .sort((x, y) => y.spent - x.spent || x.brand.localeCompare(y.brand));
    expect(stats.topBrands).toEqual(want);
  });

  it("answers empty, not a throw, for an address with no orders", async () => {
    expect(await customerOrdersAdmin("nobody@example.com")).toEqual({
      orders: [],
      stats: { firstOrderAt: null, lastOrderAt: null, avgOrder: 0, topBrands: [] },
      names: [],
    });
  });
});

describe("reviewsByAuthor — the customer's reviews, by name", () => {
  it("matches the whole name case-blind, across the names given, and never a part of one", async () => {
    const mine = await addReview({ productId: first.id, name: NAME, rating: 5, text: "Беру третий раз, пенится хорошо и запах не бьёт в нос.", lang: "RU" });
    const lower = await addReview({ productId: second.id, name: "мария тамм", rating: 4, text: "Хороший продукт, но флакон маловат для такой цены.", lang: "RU" });
    const latin = await addReview({ productId: first.id, name: "Maria Tamm", rating: 3, text: "Normaalne toode, aga lõhn on minu jaoks liiga tugev.", lang: "ET" });
    await addReview({ productId: first.id, name: "Мария", rating: 1, text: "Совсем не подошло, кожа головы чесалась неделю.", lang: "RU" });
    await addReview({ productId: first.id, name: "Мария Тамм-Саар", rating: 2, text: "Ожидала большего от этого бренда, честно говоря.", lang: "RU" });
    // three inserts in one millisecond tie on created_at — date them apart, oldest first
    for (const [i, r] of [mine, lower, latin].entries()) {
      await query("update reviews set created_at = $2 where id = $1", [r.id, new Date(Date.now() - (3 - i) * 86_400_000).toISOString()]);
    }

    const found = await reviewsByAuthor([NAME, "Maria Tamm", "", null, " "]);
    expect(found.map((r) => r.id).sort()).toEqual([mine.id, lower.id, latin.id].sort());
    // newest first, like the queue
    expect(found.map((r) => r.id)).toEqual([latin.id, lower.id, mine.id]);
  });

  it("finds nothing for no name at all", async () => {
    await addReview({ productId: first.id, name: NAME, rating: 5, text: "Беру третий раз, пенится хорошо и запах не бьёт в нос.", lang: "RU" });
    expect(await reviewsByAuthor([])).toEqual([]);
    expect(await reviewsByAuthor(["", null, undefined, "x"])).toEqual([]);
  });
});

describe("GET /api/admin/customers/<id> — the card carries what is behind the numbers", () => {
  it("orders, stats and reviews, the same by uuid and by e-mail", async () => {
    const me = await recordLogin(EMAIL, "RU");
    await updateCustomer(EMAIL, { name: NAME });
    const paid = await order(EMAIL, NAME, [{ id: first.id, qty: 1 }], 12, me.id);
    await setOrderStatus(paid.id, "paid");
    // a guest order, signed a little differently — still hers, and its name still counts for the reviews
    const guest = await order(EMAIL, "Maria Tamm", [{ id: second.id, qty: 2 }], 3);
    const review = await addReview({ productId: second.id, name: "Maria Tamm", rating: 5, text: "Отличный продукт, проверено на себе не один раз.", lang: "RU" });
    await setReviewStatus(review.id, "approved");
    await addReview({ productId: first.id, name: "Кто-то другой", rating: 1, text: "Мне не понравилось, отправлю обратно как только смогу.", lang: "RU" });

    const byId = await card(me.id);
    expect(byId.status).toBe(200);
    expect(byId.body.ok).toBe(true);
    // the tiles and the list read the same key — the address — so the guest order counts too
    expect(byId.body.customer.ordersCount).toBe(2);
    expect(byId.body.customer.revenue).toBe(Math.round((paid.total + guest.total) * 100) / 100);
    expect(byId.body.orders.map((o) => o.number)).toEqual([guest.number, paid.number]);
    expect(byId.body.orders[1]).toMatchObject({ status: "paid", itemsCount: 1, firstItem: `${first.b} — ${first.n}` });
    expect(byId.body.stats).toMatchObject({
      firstOrderAt: byId.body.orders[1].createdAt,
      lastOrderAt: byId.body.orders[0].createdAt,
      avgOrder: Math.round(((paid.total + guest.total) / 2) * 100) / 100,
    });
    expect(byId.body.stats.topBrands.map((b) => b.brand).sort()).toEqual([first.b, second.b].sort());
    expect(byId.body.reviews).toHaveLength(1);
    expect(byId.body.reviews[0]).toMatchObject({
      id: review.id, productId: second.id, product: `${second.b} — ${second.n}`,
      rating: 5, status: "approved", name: "Maria Tamm",
    });
    expect(byId.body.reviews[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const byEmail = await card(EMAIL);
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.orders).toEqual(byId.body.orders);
    expect(byEmail.body.stats).toEqual(byId.body.stats);
    expect(byEmail.body.reviews).toEqual(byId.body.reviews);
  });

  it("a customer who never bought anything gets empty lists, not an error", async () => {
    const me = await recordLogin("fresh@example.com", "ET");
    const { status, body } = await card(me.id);
    expect(status).toBe(200);
    expect(body.orders).toEqual([]);
    expect(body.stats).toEqual({ firstOrderAt: null, lastOrderAt: null, avgOrder: 0, topBrands: [] });
    expect(body.reviews).toEqual([]);
  });

  it("still refuses a caller with no admin cookie", async () => {
    const route = await import("@/app/api/admin/customers/[id]/route");
    const res = await route.GET(new Request(`${BASE}/api/admin/customers/${EMAIL}/`), { params: Promise.resolve({ id: EMAIL }) });
    expect(res.status).toBe(401);
  });
});
