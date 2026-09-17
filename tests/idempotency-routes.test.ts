/**
 * «Сделать один раз» on the three routes that are wired to it — the checkout,
 * the till and the shelf. src/lib/idempotency.ts is proven on its own in
 * tests/idempotency.test.ts; this file is about the wiring, and it asks the
 * same three questions of each route:
 *
 *   1. the SAME key twice creates ONE thing, and the second request is handed
 *      the first answer back — the same status and the same body, because the
 *      client is going to treat the replay as the real answer;
 *   2. a DIFFERENT key with the very same body creates a SECOND thing. This is
 *      the half that matters most and the reason each route passes a
 *      `fingerprint` and never a content hash: two identical «+1 приход» in a
 *      row are two real bottles on the shelf, two identical baskets are two
 *      real sales, and anything that deduped by CONTENT would silently eat one
 *      of each. Whoever later reads «идемпотентность» as «одинаковые тела —
 *      один результат» has to break these three tests to do it;
 *   3. no key at all behaves exactly as the route did before it was wired, so
 *      a browser on a cached app.min.js is never worse off.
 *
 * Plus the two 409s: `in_progress` (the caller's own first request is still
 * running — nothing ran here) and `key_reused` (this key already carries a
 * different body — refused rather than answered with somebody else's result).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { query } from "@/lib/db";
import { IDEMPOTENCY_HEADER } from "@/lib/idempotency";
import { getLevel, listMoves, move } from "@/lib/inventory";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

type Min = { id: string; p: number; s: string };
const product = (catalogueMin as Min[]).find((p) => p.s === "in")!;

const ORIGIN = "https://rempireshop.com";

/* Keys are uuid-shaped, like the ones public/shop2/app.js mints. */
const KEY_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const KEY_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

let ip = 0;
/** One POST. `key` goes in the header the client sends it in, or nowhere. */
function post(path: string, body: unknown, opts: { key?: string; cookie?: string } = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `203.0.113.${(ip++ % 200) + 1}`,
  };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.key) headers[IDEMPOTENCY_HEADER] = opts.key;
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}

/** A 'running' row for this key, i.e. the first request is still in flight. */
async function holdKey(key: string, route: string): Promise<void> {
  await query("insert into idempotency_keys (key, route) values ($1, $2)", [key, route]);
}

async function orderCount(): Promise<number> {
  const rows = await query<{ n: string }>("select count(*)::text as n from orders");
  return Number(rows[0].n);
}

const goodOrder = {
  lang: "RU",
  items: [{ id: product.id, qty: 1 }],
  customer: { name: "Test Ostja", email: "test@example.com", phone: "+372 5555 5555" },
  shipping: { method: "parcel", country: "EE", pointId: "1234", pointName: "Kristiine keskus" },
};

let admin = "";

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
  await setupDb();
  admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
});
afterAll(teardownDb);
beforeEach(async () => {
  resetRateLimits();
  await truncateAll();
  await query("delete from idempotency_keys");
});

/* ------------------------------------------------------------------------ *
 * 1. POST /api/orders — the worst one
 * ------------------------------------------------------------------------ */

describe("POST /api/orders: one tap, one order", () => {
  /* The case the whole thing exists for: the order was created and the answer
     was lost on the way back, so the shopper taps «Оплатить» again. */
  it("the same key again creates nothing and replays the first answer", async () => {
    const { POST } = await import("@/app/api/orders/route");

    const first = await POST(post("/api/orders/", goodOrder, { key: KEY_A }));
    const one = await first.json();
    expect(first.status).toBe(201);
    expect(one.ok).toBe(true);

    const second = await POST(post("/api/orders/", goodOrder, { key: KEY_A }));
    const two = await second.json();

    expect(await orderCount()).toBe(1);
    // byte for byte: the checkout goes on to pay for exactly this order
    expect(second.status).toBe(201);
    expect(two).toEqual(one);
  });

  /* …and the other direction. Two people, or one person buying the same thing
     twice, are two orders — the bodies are identical and only the keys differ,
     so a dedupe that looked at the body would have lost one of them. */
  it("a DIFFERENT key with the same body creates a second order", async () => {
    const { POST } = await import("@/app/api/orders/route");

    const first = await (await POST(post("/api/orders/", goodOrder, { key: KEY_A }))).json();
    const second = await POST(post("/api/orders/", goodOrder, { key: KEY_B }));
    const two = await second.json();

    expect(second.status).toBe(201);
    expect(await orderCount()).toBe(2);
    expect(two.orderId).not.toBe(first.orderId);
    expect(two.number).not.toBe(first.number);
  });

  /* An older cached app.min.js sends no key at all, and must be no worse off
     than it was before this route was wired. */
  it("no key at all behaves exactly as before — two orders", async () => {
    const { POST } = await import("@/app/api/orders/route");
    await POST(post("/api/orders/", goodOrder));
    await POST(post("/api/orders/", goodOrder));
    expect(await orderCount()).toBe(2);
    expect(await query("select key from idempotency_keys")).toHaveLength(0);
  });

  it("says «in_progress», and runs nothing, while the first request is still going", async () => {
    const { POST } = await import("@/app/api/orders/route");
    await holdKey(KEY_A, "POST /api/orders");

    const res = await POST(post("/api/orders/", goodOrder, { key: KEY_A }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("in_progress");
    expect(await orderCount()).toBe(0);
  });

  it("refuses a key that has changed its body rather than making a second order", async () => {
    const { POST } = await import("@/app/api/orders/route");
    await POST(post("/api/orders/", goodOrder, { key: KEY_A }));

    const res = await POST(
      post("/api/orders/", { ...goodOrder, items: [{ id: product.id, qty: 5 }] }, { key: KEY_A }),
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("key_reused");
    expect(await orderCount()).toBe(1);
  });

  /* A refusal is not worth remembering: there is no first order to protect,
     and pinning it would hand the shopper the old complaint about the old
     address for two days. */
  it("does not pin a refusal: the corrected order goes through on the same key", async () => {
    const { POST } = await import("@/app/api/orders/route");

    const bad = await POST(post("/api/orders/", { ...goodOrder, items: [] }, { key: KEY_A }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("empty_order");
    expect(await query("select key from idempotency_keys")).toHaveLength(0);

    const fixed = await POST(post("/api/orders/", goodOrder, { key: KEY_A }));
    expect(fixed.status).toBe(201);
    expect(await orderCount()).toBe(1);
  });
});

/* ------------------------------------------------------------------------ *
 * 2. POST /api/admin/pos-orders — the till
 * ------------------------------------------------------------------------ */

const goodSale = {
  items: [{ id: product.id, qty: 2 }],
  payment: { method: "cash" },
};

describe("POST /api/admin/pos-orders: one sale, however many taps", () => {
  /* The register sends ONE id per basket and sends it both ways — as the
     body's `ref` and as the request's key — so that is what these send too. */
  const sale = (ref: string) => ({ ...goodSale, ref });

  it("the same key again rings nothing up and replays the first receipt", async () => {
    await move({ productId: product.id, delta: 10, reason: "goods_in" });
    const { POST } = await import("@/app/api/admin/pos-orders/route");

    const first = await POST(post("/api/admin/pos-orders/", sale("basket-one"), { key: KEY_A, cookie: admin }));
    const one = await first.json();
    expect(first.status).toBe(201);

    const second = await POST(post("/api/admin/pos-orders/", sale("basket-one"), { key: KEY_A, cookie: admin }));
    const two = await second.json();

    expect(await orderCount()).toBe(1);
    expect(second.status).toBe(201);
    expect(two).toEqual(one);
    // …and the shelf was written off once, not twice
    expect((await getLevel(product.id, ""))?.qty).toBe(8);
  });

  /* The cashier's next customer buys exactly the same bottle. Identical body
     bar the basket id; a different key, and it is a second real sale. */
  it("a DIFFERENT key rings up a second sale of the same basket", async () => {
    await move({ productId: product.id, delta: 10, reason: "goods_in" });
    const { POST } = await import("@/app/api/admin/pos-orders/route");

    const first = await (
      await POST(post("/api/admin/pos-orders/", sale("basket-one"), { key: KEY_A, cookie: admin }))
    ).json();
    const second = await POST(post("/api/admin/pos-orders/", sale("basket-two"), { key: KEY_B, cookie: admin }));
    const two = await second.json();

    expect(second.status).toBe(201);
    expect(await orderCount()).toBe(2);
    expect(two.number).not.toBe(first.number);
    expect((await getLevel(product.id, ""))?.qty).toBe(6); // 10 − 2 − 2
  });

  /* The key is the newer guard; `pos_ref` (093_pos_sale_ref.sql) is the older
     one and still does its own job. A repeat that lost its key — two register
     tabs, a reload — is still one order. */
  it("and with no key at all the basket id alone still keeps it to one order", async () => {
    await move({ productId: product.id, delta: 10, reason: "goods_in" });
    const { POST } = await import("@/app/api/admin/pos-orders/route");

    const first = await (await POST(post("/api/admin/pos-orders/", sale("basket-one"), { cookie: admin }))).json();
    const second = await (await POST(post("/api/admin/pos-orders/", sale("basket-one"), { cookie: admin }))).json();

    expect(await orderCount()).toBe(1);
    expect(second.number).toBe(first.number);
    expect(second.repeat).toBe(true);
  });

  it("says «in_progress», and rings nothing up, while the first tap is still going", async () => {
    const { POST } = await import("@/app/api/admin/pos-orders/route");
    await holdKey(KEY_A, "POST /api/admin/pos-orders");

    const res = await POST(post("/api/admin/pos-orders/", sale("basket-one"), { key: KEY_A, cookie: admin }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("in_progress");
    expect(await orderCount()).toBe(0);
  });

  it("refuses a key that has changed its basket", async () => {
    await move({ productId: product.id, delta: 10, reason: "goods_in" });
    const { POST } = await import("@/app/api/admin/pos-orders/route");
    await POST(post("/api/admin/pos-orders/", sale("basket-one"), { key: KEY_A, cookie: admin }));

    const res = await POST(
      post("/api/admin/pos-orders/", { ...sale("basket-one"), discountPercent: 50 }, { key: KEY_A, cookie: admin }),
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("key_reused");
    expect(await orderCount()).toBe(1);
  });

  it("the admin cookie is still checked before the key is looked at", async () => {
    const { POST } = await import("@/app/api/admin/pos-orders/route");
    const res = await POST(post("/api/admin/pos-orders/", sale("basket-one"), { key: KEY_A }));
    expect(res.status).toBe(401);
    expect(await query("select key from idempotency_keys")).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------ *
 * 3. POST /api/admin/inventory/moves — the shelf, and the case that decides
 *    the whole shape
 * ------------------------------------------------------------------------ */

const goodsIn = { productId: product.id, variant: "", delta: 1, reason: "goods_in", ref: "сканер" };

describe("POST /api/admin/inventory/moves: a retry is not a second bottle", () => {
  it("the same key again moves nothing and replays the first answer", async () => {
    const { POST } = await import("@/app/api/admin/inventory/moves/route");
    await move({ productId: product.id, delta: 5, reason: "goods_in" });

    const first = await POST(post("/api/admin/inventory/moves/", goodsIn, { key: KEY_A, cookie: admin }));
    const one = await first.json();
    expect(first.status).toBe(200);

    const second = await POST(post("/api/admin/inventory/moves/", goodsIn, { key: KEY_A, cookie: admin }));
    const two = await second.json();

    expect((await getLevel(product.id, ""))?.qty).toBe(6); // 5 + 1, once
    expect(second.status).toBe(200);
    expect(two).toEqual(one);
    // one ledger line, so «История» does not show a movement that never was
    expect(await listMoves({ productId: product.id, reason: "goods_in" })).toHaveLength(2); // the seed + one
  });

  /* THE ONE THAT DECIDES THE SHAPE. Two «+1 приход» bodies that are identical
     down to the byte, two keys, two real bottles on the shelf. A dedupe that
     hashed the body instead of trusting the key would apply one of them and
     silently lose the other — and the owner would find out at stocktake. */
  it("two identical «+1 приход» bodies with DIFFERENT keys BOTH apply", async () => {
    const { POST } = await import("@/app/api/admin/inventory/moves/route");
    await move({ productId: product.id, delta: 5, reason: "goods_in" });

    const first = await POST(post("/api/admin/inventory/moves/", goodsIn, { key: KEY_A, cookie: admin }));
    const second = await POST(post("/api/admin/inventory/moves/", goodsIn, { key: KEY_B, cookie: admin }));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await first.json()).ok).toBe(true);
    expect((await second.json()).ok).toBe(true);

    expect((await getLevel(product.id, ""))?.qty).toBe(7); // 5 + 1 + 1
    expect(await listMoves({ productId: product.id, reason: "goods_in" })).toHaveLength(3);
  });

  it("…and with no key at all they both apply too, exactly as before", async () => {
    const { POST } = await import("@/app/api/admin/inventory/moves/route");
    await move({ productId: product.id, delta: 5, reason: "goods_in" });

    await POST(post("/api/admin/inventory/moves/", goodsIn, { cookie: admin }));
    await POST(post("/api/admin/inventory/moves/", goodsIn, { cookie: admin }));

    expect((await getLevel(product.id, ""))?.qty).toBe(7);
    expect(await query("select key from idempotency_keys")).toHaveLength(0);
  });

  it("says «in_progress», and moves nothing, while the first tap is still going", async () => {
    const { POST } = await import("@/app/api/admin/inventory/moves/route");
    await move({ productId: product.id, delta: 5, reason: "goods_in" });
    await holdKey(KEY_A, "POST /api/admin/inventory/moves");

    const res = await POST(post("/api/admin/inventory/moves/", goodsIn, { key: KEY_A, cookie: admin }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("in_progress");
    expect((await getLevel(product.id, ""))?.qty).toBe(5);
  });

  /* The fingerprint doing the one job it has: the same key carrying a
     different delta is a panel that lost track of itself, and applying it
     would be writing a movement under a key that was supposed to stop exactly
     that. Refused, and the shelf does not move. */
  it("refuses a key whose delta has changed, and the shelf stays put", async () => {
    const { POST } = await import("@/app/api/admin/inventory/moves/route");
    await move({ productId: product.id, delta: 5, reason: "goods_in" });
    await POST(post("/api/admin/inventory/moves/", goodsIn, { key: KEY_A, cookie: admin }));

    const res = await POST(
      post("/api/admin/inventory/moves/", { ...goodsIn, delta: 99 }, { key: KEY_A, cookie: admin }),
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("key_reused");
    expect((await getLevel(product.id, ""))?.qty).toBe(6);
  });

  /* The route's other body shape — «останется N штук» after a physical count.
     A repeat of an absolute set is harmless by nature, but the answer still
     has to come back the same, because the panel reads the new remainder
     straight off it. */
  it("replays the absolute count too, and a different key runs it again", async () => {
    const { POST } = await import("@/app/api/admin/inventory/moves/route");
    const count = { productId: product.id, variant: "", qty: 12, reason: "adjust", ref: "панель" };

    const first = await POST(post("/api/admin/inventory/moves/", count, { key: KEY_A, cookie: admin }));
    const one = await first.json();
    const replay = await POST(post("/api/admin/inventory/moves/", count, { key: KEY_A, cookie: admin }));
    expect(await replay.json()).toEqual(one);

    await POST(post("/api/admin/inventory/moves/", { ...count, qty: 3 }, { key: KEY_B, cookie: admin }));
    expect((await getLevel(product.id, ""))?.qty).toBe(3);
  });

  it("the admin cookie is still checked before the key is looked at", async () => {
    const { POST } = await import("@/app/api/admin/inventory/moves/route");
    const res = await POST(post("/api/admin/inventory/moves/", goodsIn, { key: KEY_A }));
    expect(res.status).toBe(401);
    expect(await query("select key from idempotency_keys")).toHaveLength(0);
  });
});
