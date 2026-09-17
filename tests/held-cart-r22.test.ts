/**
 * Coming back from the bank without a receipt — Dim, 17.09.2026.
 *
 * payNow() empties the basket before the redirect and parks it against the
 * order (holdCart() in public/shop2/app.js). A receipt gives it back when the
 * order was not paid, and a receipt is the ONLY thing that ever did: a shopper
 * who pressed «Назад» at the bank, or closed that tab, came back to an empty
 * shop with the basket sitting in localStorage for a day.
 *
 * The obvious fix is forbidden and this file is mostly here to keep it that
 * way: restoring at boot «because no paid receipt was seen» hands a shopper
 * who PAID and closed the bank's tab the goods they already own, and invites
 * them to buy the lot a second time. Nothing in the browser can tell the two
 * apart, so the shop asks the shop — one bit, POST /api/orders/status/ — and
 * restores on a definite «не оплачен» and on nothing else.
 *
 * Two halves, and both matter:
 *
 *   · the endpoint. It must tell a stranger holding an order id NOTHING: not
 *     the status, not the number, not even that the order exists.
 *   · the shop. Paid → the basket stays gone. Not paid → it comes back. No
 *     answer, an offline page, an answer of the wrong shape, no token → it is
 *     left exactly where it is.
 *
 * The browser half is **sliced out of app.js by source text** and run against
 * stubs, like tests/checkout-payonce.test.ts and tests/blog-panel-shop.test.ts:
 * retyping it would test this file instead of the shop, and the slice fails
 * loudly the day app.js renames one of these functions.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { resetRateLimits } from "@/lib/auth";
import { query } from "@/lib/db";
import { orderStatusToken, verifyOrderStatusToken } from "@/lib/payments/order-status";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

/* ======================================================================== *
 * the endpoint
 * ======================================================================== */

type Min = { id: string; p: number; s: string };
const product = (catalogueMin as Min[]).find((p) => p.s === "in")!;

const ORIGIN = "https://rempireshop.com";

const goodOrder = {
  lang: "RU",
  items: [{ id: product.id, qty: 1 }],
  customer: { name: "Test Ostja", email: "test@example.com", phone: "+372 5555 5555" },
  shipping: { method: "parcel", country: "EE", pointId: "1234", pointName: "Kristiine keskus" },
};

let ip = 0;
function post(path: string, body: unknown): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${(ip++ % 200) + 1}` },
    body: JSON.stringify(body),
  });
}
/** A body this route cannot parse at all — not even valid JSON. */
function postRaw(path: string, raw: string): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${(ip++ % 200) + 1}` },
    body: raw,
  });
}

/** One order, through the real checkout route, with the token it answers. */
async function placeOrder(): Promise<{ id: string; token: string }> {
  const { POST } = await import("@/app/api/orders/route");
  const res = await POST(post("/api/orders/", goodOrder));
  const body = await res.json();
  expect(res.status, JSON.stringify(body)).toBe(201);
  return { id: body.orderId as string, token: body.statusToken as string };
}

async function ask(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import("@/app/api/orders/status/route");
  const res = await POST(post("/api/orders/status/", body));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  await setupDb();
});
afterAll(teardownDb);
beforeEach(async () => {
  resetRateLimits();
  await truncateAll();
  await query("delete from idempotency_keys");
});

describe("the token: the same shape the receipt's gift-card link already uses", () => {
  it("is an HMAC of the id, not the id — and a different order gets a different one", () => {
    const a = orderStatusToken("11111111-1111-4111-8111-111111111111");
    const b = orderStatusToken("22222222-2222-4222-8222-222222222222");
    expect(a).toHaveLength(32);
    expect(a).not.toContain("1111");
    expect(a).not.toBe(b);
    expect(verifyOrderStatusToken("11111111-1111-4111-8111-111111111111", a)).toBe(true);
    expect(verifyOrderStatusToken("22222222-2222-4222-8222-222222222222", a)).toBe(false);
  });

  /* Without a key there is nothing to sign, so nothing may be believed either
     — the shop then simply never asks and never restores. Closed is the safe
     direction: an empty basket is recoverable, a double payment is not. */
  it("refuses everything when the shop has no SESSION_SECRET", () => {
    const was = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = "";
    try {
      expect(orderStatusToken("some-order")).toBe("");
      expect(verifyOrderStatusToken("some-order", "")).toBe(false);
      expect(verifyOrderStatusToken("some-order", orderStatusToken("some-order"))).toBe(false);
    } finally {
      process.env.SESSION_SECRET = was;
    }
  });
});

describe("POST /api/orders/status/: one bit, and only to the browser that bought", () => {
  it("POST /api/orders/ hands the browser a token for the order it just made", async () => {
    const order = await placeOrder();
    expect(order.token).toHaveLength(32);
    expect(verifyOrderStatusToken(order.id, order.token)).toBe(true);
    // it is not the id in disguise, and not a second id
    expect(order.token).not.toContain(order.id.slice(0, 8));
  });

  it("answers `paid: false` for an order that has not been paid for", async () => {
    const order = await placeOrder();
    const res = await ask({ orderId: order.id, token: order.token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, paid: false });
  });

  it("answers `paid: true` the moment the money is in", async () => {
    const order = await placeOrder();
    for (const status of ["paid", "shipped", "delivered"]) {
      await query("update orders set status = $2 where id = $1", [order.id, status]);
      expect((await ask({ orderId: order.id, token: order.token })).body, status)
        .toEqual({ ok: true, paid: true });
    }
  });

  /* A payment the bank refused is the case this whole thing exists for: the
     order is open, the money never arrived, the basket must come back. */
  it("answers `paid: false` for a refused payment, and `true` once it is closed", async () => {
    const order = await placeOrder();
    await query("update orders set status = 'failed' where id = $1", [order.id]);
    expect((await ask({ orderId: order.id, token: order.token })).body).toEqual({ ok: true, paid: false });

    /* Cancelled and refunded are NOT «не оплачен». Neither says the money is
       in the till today; both say this shop cannot promise it never was, and
       the answer to the shop's question on a maybe is «leave the basket». */
    for (const status of ["cancelled", "refunded"]) {
      await query("update orders set status = $2 where id = $1", [order.id, status]);
      expect((await ask({ orderId: order.id, token: order.token })).body, status)
        .toEqual({ ok: true, paid: true });
    }
  });

  /* ---- what a stranger learns: nothing ---------------------------------- */

  it("tells a stranger holding a real order id exactly what it tells one holding a fake", async () => {
    const order = await placeOrder();
    const madeUp = "99999999-9999-4999-8999-999999999999";
    const refusal = { ok: false, error: "not_found" };

    const withoutToken = await ask({ orderId: order.id });
    const wrongToken = await ask({ orderId: order.id, token: "x".repeat(32) });
    const rightShapeWrongOrder = await ask({ orderId: madeUp, token: orderStatusToken(order.id) });
    const fakeAltogether = await ask({ orderId: madeUp, token: "x".repeat(32) });

    for (const r of [withoutToken, wrongToken, rightShapeWrongOrder, fakeAltogether]) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual(refusal);
    }
    // …and a real id with a real token of ANOTHER order is no better
    const other = await placeOrder();
    const crossed = await ask({ orderId: order.id, token: other.token });
    expect(crossed.status).toBe(404);
    expect(crossed.body).toEqual(refusal);
  });

  it("never says anything about the order beyond the one bit", async () => {
    const order = await placeOrder();
    const res = await ask({ orderId: order.id, token: order.token });
    expect(Object.keys(res.body).sort()).toEqual(["ok", "paid"]);
    const printed = JSON.stringify(res.body);
    expect(printed).not.toContain("R-");                 // the order number
    expect(printed).not.toContain("test@example.com");   // the customer
    expect(printed).not.toContain(product.id);           // what is in it
  });

  it("gives a malformed body the same answer as a wrong token", async () => {
    const { POST } = await import("@/app/api/orders/status/route");
    for (const raw of ["", "null", "[]", '"hello"', "12", "{", '{"orderId":123}']) {
      const res = await POST(postRaw("/api/orders/status/", raw));
      expect(res.status, raw).toBe(404);
      expect(await res.json(), raw).toEqual({ ok: false, error: "not_found" });
    }
  });

  it("is not a GET, and is never cached", async () => {
    const { GET, POST } = await import("@/app/api/orders/status/route");
    expect(GET().status).toBe(405);
    const order = await placeOrder();
    const res = await POST(post("/api/orders/status/", { orderId: order.id, token: order.token }));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("stops somebody working through ids", async () => {
    const one = "198.51.100.7";
    const req = () =>
      new Request(`${ORIGIN}/api/orders/status/`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": one },
        body: JSON.stringify({ orderId: "no-such-order", token: "x".repeat(32) }),
      });
    const { POST } = await import("@/app/api/orders/status/route");
    let limited = 0;
    for (let i = 0; i < 40; i++) if ((await POST(req())).status === 429) limited++;
    expect(limited).toBeGreaterThan(0);
  });
});

/* ======================================================================== *
 * the shop
 * ======================================================================== */

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const appSrc = readFileSync(APP_JS, "utf8");

/** `function <name>(…) { … }` out of app.js, by brace matching. */
function slice(name: string): string {
  const start = appSrc.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = appSrc.indexOf("{", start); i < appSrc.length; i++) {
    if (appSrc[i] === "{") depth++;
    else if (appSrc[i] === "}" && --depth === 0) return appSrc.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

/** `var <name> = …;` out of app.js. */
function sliceVar(name: string): string {
  const start = appSrc.indexOf(`var ${name} = `);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  for (let i = start; i < appSrc.length; i++) if (appSrc[i] === ";") return appSrc.slice(start, i + 1);
  throw new Error(`no terminating ; for var ${name} in app.js`);
}

interface Answer {
  offline?: boolean;
  lost?: boolean;
  body?: unknown;
}

interface Shop {
  /** The page has loaded: firstPaint() calls heldAsk() here. */
  boot(): Promise<void>;
  /** «Оплатить» parking the basket on the way to the bank. */
  hold(orderId: string, token?: string): void;
  /** The receipt's own path — doneState() on a «не оплачен» receipt. */
  restore(orderId: string): void;
  /** The shopper empties the basket by hand. */
  emptyCart(): void;
  cart(): Array<{ id: string; size: number; qty: number }>;
  /** The parked record as localStorage holds it, or null. */
  parked(): { order: string; token: string; cart: unknown[]; back?: number } | null;
  calls: Array<{ url: string; body: Record<string, unknown> }>;
  toasts: string[];
  renders(): number;
}

const LINE = { id: "p1", size: 0, qty: 2 };

/**
 * heldAsk() and everything it leans on, with localStorage, the cart and the
 * one POST stubbed. `answer` is what POST /api/orders/status/ comes back
 * with — or a thrown error, for a connection that simply dies.
 */
function shop(opts: {
  answer?: Answer | "throw";
  /** What is already parked when the page loads. */
  parked?: { order: string; token?: string; cart?: unknown[]; at?: number; promo?: string } | null;
  /** The shopper has started a new basket since. */
  cart?: Array<{ id: string; size: number; qty: number }>;
} = {}): Shop {
  const body = `
    var calls = [], toasts = [], renders = 0;
    var store = {};
    if (PARKED) store["rmp-held-cart"] = JSON.stringify(PARKED);
    var localStorage = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function (k, v) { store[k] = String(v); },
      removeItem: function (k) { delete store[k]; }
    };
    var S = { cart: CART.slice(), promo: "" };
    var CATALOGUE = [{ id: "p1" }, { id: "p2" }];
    var GIFT_AMOUNTS = [25, 50, 100];
    function giftAmount() { return 0; }
    function persist() {}
    function render() { renders++; }
    function toast(t) { toasts.push(t); }
    function clearOrderState() { S.cart = []; S.promo = ""; }
    function postJSON(url, b) {
      calls.push({ url: url, body: b });
      if (ANSWER === "throw") return Promise.reject(new Error("network"));
      return Promise.resolve(ANSWER || { offline: true });
    }

    ${sliceVar("HELD_LS")}
    ${sliceVar("HELD_MAX_AGE_MS")}
    ${slice("holdCart")}
    ${slice("dropHeldCart")}
    ${slice("heldRead")}
    ${slice("doneDropHeld")}
    ${slice("heldAsk")}
    ${slice("restoreHeldCart")}

    return {
      boot: function () {
        heldAsk();
        // three turns of the microtask queue is plenty for one then()
        return Promise.resolve().then(function () {}).then(function () {}).then(function () {});
      },
      hold: function (id, token) { holdCart(id, token); },
      restore: function (id) { restoreHeldCart(id); },
      emptyCart: function () { S.cart = []; },
      cart: function () { return S.cart; },
      parked: function () { return store["rmp-held-cart"] ? JSON.parse(store["rmp-held-cart"]) : null; },
      calls: calls,
      toasts: toasts,
      renders: function () { return renders; }
    };
  `;
  const parked = opts.parked === undefined
    ? { order: ORDER, token: TOKEN, at: Date.now(), cart: [LINE], promo: "" }
    : opts.parked && { at: Date.now(), cart: [LINE], promo: "", token: "", ...opts.parked };
  return (new Function("ANSWER", "PARKED", "CART", body) as (
    a: unknown, p: unknown, c: unknown[],
  ) => Shop)(opts.answer ?? { offline: true }, parked ?? null, opts.cart ?? []);
}

const ORDER = "44444444-4444-4444-8444-444444444444";
const TOKEN = "held-cart-token-0123456789abcdef";
const PAID = { body: { ok: true, paid: true } };
const UNPAID = { body: { ok: true, paid: false } };

describe("the shop at boot, holding a basket it never heard the end of", () => {
  it("asks about the parked order, with the token that was parked with it", async () => {
    const s = shop({ answer: UNPAID });
    await s.boot();
    expect(s.calls).toEqual([{ url: "/api/orders/status/", body: { orderId: ORDER, token: TOKEN } }]);
  });

  /* The whole reason this is a question and not a rule. */
  it("does NOT give the basket back when the order was paid — and lets it go", async () => {
    const s = shop({ answer: PAID });
    await s.boot();
    expect(s.cart()).toEqual([]);
    expect(s.parked()).toBeNull();   // asked and answered: nothing to keep
    expect(s.toasts).toEqual([]);
  });

  it("gives it back when the order was not paid", async () => {
    const s = shop({ answer: UNPAID });
    await s.boot();
    expect(s.cart()).toEqual([LINE]);
    expect(s.toasts).toEqual(["Корзина восстановлена ✓"]);
    expect(s.renders()).toBe(1);
  });

  /* Every way of NOT getting a definite answer, one by one. Each of them must
     leave the basket where it is: it expires by itself in a day, and the
     receipt in the letter still restores it. */
  it("leaves the basket alone when the shop does not answer", async () => {
    for (const answer of [
      "throw" as const,                                     // the connection died
      { offline: true, lost: true },                        // the answer was lost
      { offline: true },                                    // no API behind this page
      { body: { ok: false, error: "not_found" } },          // refused
      { body: { ok: false, error: "db_unavailable" } },     // the shop cannot say
      { body: { ok: true } },                               // ok, but no answer in it
      { body: { ok: true, paid: "no" } },                   // …or one of the wrong shape
      { body: null },
      {},
    ]) {
      const s = shop({ answer });
      await s.boot();
      expect(s.cart(), JSON.stringify(answer)).toEqual([]);
      expect(s.parked(), JSON.stringify(answer)).not.toBeNull();
      expect(s.toasts, JSON.stringify(answer)).toEqual([]);
    }
  });

  it("does not ask at all when there is nothing parked, or nothing to ask with", async () => {
    for (const parked of [
      null,
      { order: ORDER, token: "" },                 // an old record, or a shop with no secret
      { order: "", token: TOKEN },
      { order: ORDER, token: TOKEN, cart: [] },    // an empty basket is not worth restoring
    ]) {
      const s = shop({ answer: UNPAID, parked });
      await s.boot();
      expect(s.calls, JSON.stringify(parked)).toEqual([]);
      expect(s.cart(), JSON.stringify(parked)).toEqual([]);
    }
  });

  it("does not ask when the shopper has already started a new basket", async () => {
    const s = shop({ answer: UNPAID, cart: [{ id: "p2", size: 0, qty: 1 }] });
    await s.boot();
    expect(s.calls).toEqual([]);
    expect(s.cart()).toEqual([{ id: "p2", size: 0, qty: 1 }]);
  });

  it("forgets a basket parked more than a day ago rather than asking about it", async () => {
    const s = shop({ answer: UNPAID, parked: { order: ORDER, token: TOKEN, at: Date.now() - 864e5 - 1 } });
    await s.boot();
    expect(s.calls).toEqual([]);
    expect(s.parked()).toBeNull();
  });

  /* A line whose product has left the catalogue in the meantime is dropped,
     the way the saved cart's own lines are — and if that leaves nothing, the
     shopper is not told a basket came back. */
  /* A basket is offered back ONCE. A shopper who got it back and then emptied
     it by hand has said what they want, and a reload that filled it up again
     would read as the shop arguing with them. */
  it("does not offer the same basket a second time", async () => {
    const s = shop({ answer: UNPAID });
    await s.boot();
    expect(s.cart()).toEqual([LINE]);
    expect(s.parked()).toMatchObject({ back: 1, token: TOKEN });   // …but the token is kept

    s.emptyCart();
    await s.boot();
    expect(s.calls).toHaveLength(1);
    expect(s.cart()).toEqual([]);
  });

  it("does not ask about a basket a receipt has already given back", async () => {
    const s = shop({ answer: UNPAID });
    s.restore(ORDER);                      // doneState() on a «не оплачен» receipt
    expect(s.cart()).toEqual([LINE]);
    s.emptyCart();
    await s.boot();
    expect(s.calls).toEqual([]);
  });

  it("asks again once the basket has gone to a bank a second time", async () => {
    const s = shop({ answer: UNPAID });
    s.restore(ORDER);
    s.hold(ORDER);                         // «Оплатить ещё раз» parks it afresh
    expect(s.parked()).toMatchObject({ order: ORDER, token: TOKEN });
    expect(s.parked()!.back).toBeFalsy();
    s.emptyCart();
    await s.boot();
    expect(s.calls).toHaveLength(1);
    expect(s.cart()).toEqual([LINE]);
  });

  /* The answer lands a moment after the page drew, and the shopper may have
     put something in the basket in between. That basket is theirs: the parked
     one must not be poured over it, and — the one that would really hurt — a
     `paid` answer must not EMPTY it. Only the receipt, which is the screen
     for the order itself, may clear a cart. */
  it("never touches a basket the shopper started while the answer was in flight", async () => {
    for (const answer of [PAID, UNPAID]) {
      const s = shop({ answer });
      const started = s.boot();
      s.emptyCart();                                  // …and then, in the same tick:
      s.cart().push({ id: "p2", size: 0, qty: 1 });   // the shopper adds something
      await started;
      expect(s.cart(), JSON.stringify(answer)).toEqual([{ id: "p2", size: 0, qty: 1 }]);
      expect(s.toasts, JSON.stringify(answer)).toEqual([]);
      expect(s.renders(), JSON.stringify(answer)).toBe(0);
    }
  });

  it("says nothing when every line of the parked basket has left the shop", async () => {
    const s = shop({ answer: UNPAID, parked: { order: ORDER, token: TOKEN, cart: [{ id: "gone", size: 0, qty: 1 }] } });
    await s.boot();
    expect(s.cart()).toEqual([]);
    expect(s.toasts).toEqual([]);
  });
});

describe("holdCart(): the token is parked with the basket", () => {
  it("keeps the token POST /api/orders/ answered with", () => {
    const s = shop({ parked: null, cart: [LINE] });
    s.hold(ORDER, TOKEN);
    expect(s.parked()).toMatchObject({ order: ORDER, token: TOKEN });
  });

  /* «Оплатить ещё раз» on the receipt re-pays an order this page load did not
     place, so it has no token of its own — the one already parked against
     THAT order is carried over rather than thrown away. */
  it("carries the parked token over when the same order is held again without one", () => {
    const s = shop({ cart: [LINE] });
    s.hold(ORDER);
    expect(s.parked()).toMatchObject({ order: ORDER, token: TOKEN });
  });

  it("does not lend one order's token to another", () => {
    const s = shop({ cart: [LINE] });
    s.hold("55555555-5555-4555-8555-555555555555");
    expect(s.parked()).toMatchObject({ order: "55555555-5555-4555-8555-555555555555", token: "" });
  });
});
