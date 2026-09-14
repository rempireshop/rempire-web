/**
 * The customer card's GET — what is behind «Заказов: 2 · Потратил: …».
 *
 * Dim, 10.09.2026: the card said two orders and a sum and showed no orders,
 * no analytics, nothing else. GET /api/admin/customers/<id> now carries the
 * orders under that e-mail, four facts drawn from them and the customer's
 * reviews (src/lib/loyalty.ts customerOrdersAdmin, src/lib/reviews.ts
 * reviewsByCustomer). Runs on PGlite, no server needed.
 *
 * What this file exists to catch: a guest order that does not show on the
 * account it belongs to; a cancelled order counted as a purchase; a first
 * order that is really the last; a namesake reading another customer's
 * reviews off their card (13.09.2026, the block at the end of this file); an
 * e-mail id that answers differently from the uuid one.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { CUSTOMER_COOKIE, makeCustomerToken, recordLogin, updateCustomer } from "@/lib/customers";
import { exec, query } from "@/lib/db";
import { customerOrdersAdmin, listCustomersAdmin } from "@/lib/loyalty";
import { createOrder, setOrderStatus } from "@/lib/orders";
import { addReview, reviewsByCustomer, setReviewStatus } from "@/lib/reviews";
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

    const { orders } = await customerOrdersAdmin(EMAIL);
    expect(orders.map((o) => o.number)).toEqual([fresh.number, mid.number, old.number]);
    expect(orders[0]).toMatchObject({
      id: fresh.id, status: "new", channel: "web", labeled: false, invoice: null, itemsCount: 2,
      firstItem: `${first.b} — ${first.n}`, total: fresh.total,
    });
    expect(orders[2].itemsCount).toBe(2);
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

  /* 14.09.2026. «Потратил» said money the shop does not have. The rule was
     "anything but cancelled or failed", so an order still in `new` — the
     insert default, moved only by a provider verdict, and nothing ever sweeps
     the abandoned ones — counted as spend, and so did one the owner had
     refunded in full. The tiles and these facts now count what «Аналитика»
     counts: paid, shipped, delivered. */
  it("counts neither an abandoned `new` basket nor a refunded order as money spent", async () => {
    await recordLogin(EMAIL, "RU");
    const paid = await order(EMAIL, NAME, [{ id: first.id, qty: 1 }], 30);
    const refunded = await order(EMAIL, NAME, [{ id: second.id, qty: 3 }], 20);
    await order(EMAIL, NAME, [{ id: first.id, qty: 7 }], 2); // never paid, still `new`
    await setOrderStatus(paid.id, "paid");
    await setOrderStatus(refunded.id, "paid");
    await setOrderStatus(refunded.id, "refunded");

    const { orders, stats } = await customerOrdersAdmin(EMAIL);
    // the history still shows all three — it is what the owner is reading
    expect(orders).toHaveLength(3);
    expect(orders.map((o) => o.status)).toEqual(["new", "refunded", "paid"]);
    // …but only the one purchase is a purchase
    expect(stats.avgOrder).toBe(Math.round(paid.total * 100) / 100);
    expect(stats.firstOrderAt).toBe(orders[2].createdAt);
    expect(stats.lastOrderAt).toBe(orders[2].createdAt);
    expect(stats.topBrands).toEqual([{ brand: first.b, spent: Math.round(paid.items[0].sum * 100) / 100 }]);

    // and the tiles above them read the same rule
    const [mine] = await listCustomersAdmin({ q: EMAIL });
    expect(mine.ordersCount).toBe(1);
    expect(mine.revenue).toBe(Math.round(paid.total * 100) / 100);
  });

  it("answers empty, not a throw, for an address with no orders", async () => {
    expect(await customerOrdersAdmin("nobody@example.com")).toEqual({
      orders: [],
      stats: { firstOrderAt: null, lastOrderAt: null, avgOrder: 0, topBrands: [] },
    });
  });
});

describe("reviewsByCustomer — the customer's reviews, by the address that wrote them", () => {
  const MINE = "Беру третий раз, пенится хорошо и запах не бьёт в нос.";

  it("finds every review written from the address, newest first, whatever each was signed", async () => {
    // one mailbox, three signatures — hers all the same
    const one = await addReview({ productId: first.id, name: NAME, rating: 5, text: MINE, lang: "RU" }, null, EMAIL);
    const two = await addReview({ productId: second.id, name: "мария тамм", rating: 4, text: "Хороший продукт, но флакон маловат для такой цены.", lang: "RU" }, null, "MARIA.TAMM@Example.com ");
    const three = await addReview({ productId: first.id, name: "Maria Tamm", rating: 3, text: "Normaalne toode, aga lõhn on minu jaoks liiga tugev.", lang: "ET" }, null, EMAIL);
    // a namesake with her own mailbox, and a stranger signed the same way with none
    await addReview({ productId: first.id, name: NAME, rating: 1, text: "Совсем не подошло, кожа головы чесалась неделю.", lang: "RU" }, null, "maria.tamm@elsewhere.example.com");
    await addReview({ productId: first.id, name: NAME, rating: 2, text: "Ожидала большего от этого бренда, честно говоря.", lang: "RU" });
    // three inserts in one millisecond tie on created_at — date them apart, oldest first
    for (const [i, r] of [one, two, three].entries()) {
      await query("update reviews set created_at = $2 where id = $1", [r.id, new Date(Date.now() - (3 - i) * 86_400_000).toISOString()]);
    }

    const found = await reviewsByCustomer(EMAIL);
    expect(found.map((r) => r.id)).toEqual([three.id, two.id, one.id]);
    // the address is keyed the way customers.email is stored — case and spaces are not an identity
    expect((await reviewsByCustomer("  Maria.Tamm@EXAMPLE.com ")).map((r) => r.id)).toEqual(found.map((r) => r.id));
  });

  it("finds nothing for no address, and never reaches a review that has none", async () => {
    await addReview({ productId: first.id, name: NAME, rating: 5, text: MINE, lang: "RU" });
    expect(await reviewsByCustomer(EMAIL)).toEqual([]);
    expect(await reviewsByCustomer("")).toEqual([]);
    expect(await reviewsByCustomer(null)).toEqual([]);
    expect(await reviewsByCustomer(undefined)).toEqual([]);
    // not an address, and above all not a name
    expect(await reviewsByCustomer(NAME)).toEqual([]);
  });
});

describe("GET /api/admin/customers/<id> — the card carries what is behind the numbers", () => {
  it("orders, stats and reviews, the same by uuid and by e-mail", async () => {
    const me = await recordLogin(EMAIL, "RU");
    await updateCustomer(EMAIL, { name: NAME });
    const paid = await order(EMAIL, NAME, [{ id: first.id, qty: 1 }], 12, me.id);
    await setOrderStatus(paid.id, "paid");
    // a guest order, signed a little differently — still hers: the tiles key on the address
    const guest = await order(EMAIL, "Maria Tamm", [{ id: second.id, qty: 2 }], 3);
    // …and paid, because the tiles count purchases: a basket still sitting in
    // `new` is one that opened a payment page and never came back
    await setOrderStatus(guest.id, "paid");
    const review = await addReview({ productId: second.id, name: "Maria Tamm", rating: 5, text: "Отличный продукт, проверено на себе не один раз.", lang: "RU" }, null, EMAIL);
    await setReviewStatus(review.id, "approved");
    await addReview({ productId: first.id, name: "Кто-то другой", rating: 1, text: "Мне не понравилось, отправлю обратно как только смогу.", lang: "RU" }, null, "странник@example.com");

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

/**
 * Dim, 13.09.2026 — the leak this file was reopened for: «dim.novare@gmail.com
 * and info@diipsolutions.eu seem to be able to see same reviews». Two of his
 * own addresses, one display name on both, and each card showed the other's
 * reviews.
 *
 * The reproduction goes through the real write path, POST /api/reviews/, with
 * each address's own signed `rmp_cust` cookie on the request — proof that the
 * shop knew who was writing and the card matched on the name anyway.
 */
describe("a review belongs to the person who wrote it, not to a namesake", () => {
  const MINE = "dim.novare@example.com";
  const THEIRS = "info@diipsolutions.example.com";
  /* one name, two mailboxes — what the shop owner had, and what any two
     «Мария Тамм» in a real customer list have */
  const SHARED = "Dim Novare";

  const MINE_TEXT = "Мой отзыв: беру третий раз, пенится хорошо и запах не бьёт в нос.";
  const THEIRS_TEXT = "Чужой отзыв: флакон маловат для такой цены, но продукт хороший.";
  const GUEST_TEXT = "Отзыв гостя: заказывал без кабинета, доставили быстро и целым.";

  /** Files a review the way the storefront does; `email` null = a guest, no session. */
  async function file(email: string | null, productId: string, text: string, ip: string) {
    const route = await import("@/app/api/reviews/route");
    const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": ip };
    if (email) headers.cookie = `${CUSTOMER_COOKIE}=${makeCustomerToken(email)}`;
    const res = await route.POST(
      new Request(`${BASE}/api/reviews/`, {
        method: "POST",
        headers,
        body: JSON.stringify({ product: productId, name: SHARED, rating: 5, text, lang: "RU", consent: true }),
      }),
    );
    const body = (await res.json()) as { ok: boolean; id?: string };
    expect(body.ok, `the review from ${email ?? "a guest"} was refused`).toBe(true);
    return body.id ?? "";
  }

  async function twoCustomersOneName() {
    const mine = await recordLogin(MINE, "RU");
    const theirs = await recordLogin(THEIRS, "RU");
    await updateCustomer(MINE, { name: SHARED });
    await updateCustomer(THEIRS, { name: SHARED });
    return { mine, theirs };
  }

  it("does not put one customer's review on another customer's card", async () => {
    const { mine, theirs } = await twoCustomersOneName();
    await file(MINE, first.id, MINE_TEXT, "203.0.113.21");
    await file(THEIRS, second.id, THEIRS_TEXT, "203.0.113.22");

    const ours = await card(mine.id);
    expect(ours.status).toBe(200);
    expect(ours.body.reviews.map((r) => r.text)).toEqual([MINE_TEXT]);

    const other = await card(theirs.id);
    expect(other.body.reviews.map((r) => r.text)).toEqual([THEIRS_TEXT]);
  });

  it("keeps a guest review off every card that shares its name", async () => {
    const { mine, theirs } = await twoCustomersOneName();
    await file(null, first.id, GUEST_TEXT, "203.0.113.23");

    expect((await card(mine.id)).body.reviews).toEqual([]);
    expect((await card(theirs.id)).body.reviews).toEqual([]);
  });
});
