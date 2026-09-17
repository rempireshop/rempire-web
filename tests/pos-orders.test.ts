/** POST /api/admin/pos-orders/ and its receipt — the in-salon quick sale. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { recordLogin } from "@/lib/customers";
import { query } from "@/lib/db";
import { getLevel, listMoves, move } from "@/lib/inventory";
import { getLoyaltyBalance } from "@/lib/loyalty";
import { capturedMail } from "@/lib/mail";
import { cleanPosRef, getOrder } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

type Min = { id: string; p: number; s: string };
const product = (catalogueMin as Min[]).find((p) => p.s === "in")!;

/* The letter is still rendered and captured for real — the hook is only
   wrapped, so the test can look at the ORDER the receipt is rendered from
   (the mail sink keeps subjects and links, never the body). Same shape as
   tests/payments-create.test.ts. */
vi.mock("@/lib/mail-hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mail-hooks")>();
  return { ...actual, onOrderPaid: vi.fn(actual.onOrderPaid) };
});

const ORIGIN = "https://rempireshop.com";

function post(path: string, body: unknown, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
}
function get(path: string, cookie?: string) {
  return new Request(`${ORIGIN}${path}`, { headers: cookie ? { cookie } : {} });
}

const goodSale = {
  items: [{ id: product.id, qty: 2 }],
  payment: { method: "cash" },
};

describe("POST /api/admin/pos-orders", () => {
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
  });

  it("401s without the admin cookie", async () => {
    const { POST } = await import("@/app/api/admin/pos-orders/route");
    const res = await POST(post("/api/admin/pos-orders/", goodSale));
    expect(res.status).toBe(401);
  });

  it("creates a paid order with no e-mail, marks it channel:'pos', and decrements stock", async () => {
    await move({ productId: product.id, delta: 10, reason: "goods_in" });

    const { POST } = await import("@/app/api/admin/pos-orders/route");
    const res = await POST(post("/api/admin/pos-orders/", goodSale, admin));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.number).toMatch(/^R-1\d{5}$/);

    const order = await getOrder(body.orderId);
    expect(order?.status).toBe("paid");
    expect(order?.channel).toBe("pos");
    expect(order?.email).toBe("");
    expect(order?.payment).toMatchObject({ provider: "pos", method: "cash", status: "paid" });

    const level = await getLevel(product.id, "");
    expect(level?.qty).toBe(8); // 10 − 2
    const moves = await listMoves({ productId: product.id, reason: "sale_pos" });
    expect(moves).toHaveLength(1);
    expect(moves[0].ref).toBe(order?.number);
  });

  it("takes an optional customer e-mail and a discount percent", async () => {
    const { POST } = await import("@/app/api/admin/pos-orders/route");
    const res = await POST(
      post(
        "/api/admin/pos-orders/",
        {
          items: [{ id: product.id, qty: 1 }],
          customer: { email: "walk-in@example.com" },
          payment: { method: "terminal" },
          discountPercent: 10,
        },
        admin,
      ),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    const order = await getOrder(body.orderId);
    expect(order?.email).toBe("walk-in@example.com");
    expect(order?.discount).toBeCloseTo(product.p * 0.1, 2);
    expect(order?.discountCode).toBe("POS -10%");
  });

  it("refuses an unknown payment method", async () => {
    const { POST } = await import("@/app/api/admin/pos-orders/route");
    const res = await POST(post("/api/admin/pos-orders/", { ...goodSale, payment: { method: "crypto" } }, admin));
    expect(res.status).toBe(400);
  });

  it("refuses an empty basket", async () => {
    const { POST } = await import("@/app/api/admin/pos-orders/route");
    const res = await POST(post("/api/admin/pos-orders/", { items: [], payment: { method: "cash" } }, admin));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/pos-orders/<id>/receipt", () => {
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
  });

  async function makeSale() {
    const { POST } = await import("@/app/api/admin/pos-orders/route");
    const res = await POST(post("/api/admin/pos-orders/", goodSale, admin));
    return (await res.json()) as { orderId: string; number: string };
  }

  it("401s without the admin cookie", async () => {
    const { orderId } = await makeSale();
    const { GET } = await import("@/app/api/admin/pos-orders/[id]/receipt/route");
    const res = await GET(get(`/api/admin/pos-orders/${orderId}/receipt/`), {
      params: Promise.resolve({ id: orderId }),
    });
    expect(res.status).toBe(401);
  });

  it("renders a printable HTML receipt with the order number and total", async () => {
    const { orderId, number } = await makeSale();
    const { GET } = await import("@/app/api/admin/pos-orders/[id]/receipt/route");
    const res = await GET(get(`/api/admin/pos-orders/${orderId}/receipt/?lang=EN`, admin), {
      params: Promise.resolve({ id: orderId }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain(number);
    expect(html).toContain("Receipt"); // EN title
  });

  it("404s an unknown order", async () => {
    const { GET } = await import("@/app/api/admin/pos-orders/[id]/receipt/route");
    const res = await GET(get("/api/admin/pos-orders/R-999999/receipt/", admin), {
      params: Promise.resolve({ id: "R-999999" }),
    });
    expect(res.status).toBe(404);
  });

  /* The slip is dated on the shop's clock, not on the server's. Production is
     a Vercel Node function at UTC, so a sale rung up at half past midnight in
     Tallinn (21:30 the previous day in UTC) used to print YESTERDAY'S date on
     the document the customer takes home. TZ is forced here because the
     developer's own machine is already in Tallinn and would hide it. */
  it("dates the slip on the Tallinn clock even when the server runs at UTC", async () => {
    const { orderId } = await makeSale();
    // 15.07.2026 21:30 UTC is 16.07.2026 00:30 in Tallinn (EEST, +3)
    await query("update orders set created_at = $2 where id = $1", [orderId, "2026-07-15T21:30:00.000Z"]);

    const wasTz = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      const { GET } = await import("@/app/api/admin/pos-orders/[id]/receipt/route");
      const res = await GET(get(`/api/admin/pos-orders/${orderId}/receipt/`, admin), {
        params: Promise.resolve({ id: orderId }),
      });
      const html = await res.text();
      expect(html).toContain("16.07.2026, 00:30");
      expect(html).not.toContain("15.07.2026");
    } finally {
      if (wasTz === undefined) delete process.env.TZ;
      else process.env.TZ = wasTz;
    }
  });
});

/**
 * Since 07.09.2026 a salon sale is settled through the same door a card
 * payment goes through (src/lib/payments/settle.ts settlePayment), so
 * everything that used to be skipped now happens: the loyalty points, the
 * `purchase` row «Аналитика» counts, and the «Заказ принят» letter when the
 * cashier typed an address. What must NOT change is the shelf reason — a till
 * sale is 'sale_pos', never 'sale_web' — and the fact that a walk-in with no
 * e-mail and no customer card still goes through without a murmur.
 */
describe("a salon sale is settled, not just marked paid", () => {
  let admin = "";
  const savedEnv: Record<string, string | undefined> = {};
  const ENV = ["RESEND_API_KEY", "E2E_BOOTSTRAP"] as const;

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    for (const k of ENV) savedEnv[k] = process.env[k];
    delete process.env.RESEND_API_KEY; // every send is skipped and recorded by the sink
    process.env.E2E_BOOTSTRAP = "1";
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(async () => {
    for (const k of ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
    await teardownDb();
  });
  beforeEach(async () => {
    resetRateLimits();
    await truncateAll();
    (globalThis as unknown as { __rempireMailSink?: unknown[] }).__rempireMailSink = [];
  });

  async function sell(body: unknown) {
    const { POST } = await import("@/app/api/admin/pos-orders/route");
    const res = await POST(post("/api/admin/pos-orders/", body, admin));
    expect(res.status).toBe(201);
    return (await res.json()) as { orderId: string; number: string; total: number; mailed: boolean };
  }

  async function purchaseEvents(orderId: string) {
    return query<{ id: number }>("select id from events where type = 'purchase' and product_id = $1", [orderId]);
  }

  it("earns points, records the purchase and mails the customer who gave an address", async () => {
    /* «Партнёры и баллы» is OFF by default since 07.09.2026 (Dim: «Renat said
       later» — settings.pricing.partnersOn, docs/loyalty.md). A till sale
       earning points is therefore a shop where the owner switched it on; with
       the switch off the same sale settles exactly as below minus the points,
       which the next test pins. */
    await query(
      `insert into settings (key, value) values ('pricing', $1::jsonb)
       on conflict (key) do update set value = $1::jsonb`,
      [JSON.stringify({ partnersOn: true })],
    );
    const email = "salon-regular@example.com";
    const customer = await recordLogin(email, "RU");
    await move({ productId: product.id, delta: 10, reason: "goods_in" });

    const body = await sell({
      items: [{ id: product.id, qty: 2 }],
      customer: { email },
      payment: { method: "terminal" },
    });
    expect(body.mailed).toBe(true);

    const order = (await getOrder(body.orderId))!;
    expect(order.status).toBe("paid");
    expect(order.channel).toBe("pos");
    // the method the cashier pressed survives the settlement's own blob
    expect(order.payment).toMatchObject({ provider: "pos", method: "terminal", status: "paid" });
    // tied to the customer card, and charged retail — the register's own prices
    expect(order.customerId).toBe(customer.id);
    expect(order.pricingTier).toBe("retail");

    // the three things the old path skipped
    expect(await getLoyaltyBalance(customer.id)).toBeGreaterThan(0);
    expect(await purchaseEvents(order.id)).toHaveLength(1);
    /* The receipt, not «Заказ принят»: the goods left with the customer, so
       the letter that promises to write when the order is ready is the wrong
       one (Renat, 13.09.2026 — «The receipt should also land in the users
       e-mail»). This card is Russian, so the receipt is. */
    const letters = capturedMail().filter((m) => m.template === "pos-receipt");
    expect(letters).toHaveLength(1);
    expect(letters[0].to).toEqual([email]);
    expect(letters[0].subject).toMatch(/^Чек R-1\d{5} — Rempire$/);
    /* …and it can say HOW it was paid. The method is written before the
       settlement and merged into the row by setOrderPayment(), but the object
       the mail hook renders from used to be the snapshot from before that
       write — so the printable slip named the terminal and the customer's own
       receipt named only the amount (renderPosReceipt → posMethod). */
    const { onOrderPaid } = await import("@/lib/mail-hooks");
    const mailed = vi.mocked(onOrderPaid).mock.calls.at(-1)?.[0] as { payment?: { method?: string } };
    expect(mailed?.payment?.method).toBe("terminal");
    expect(capturedMail().filter((m) => m.template === "order-confirmed")).toHaveLength(0);

    // and the one thing that must not change: the shelf reason
    expect((await getLevel(product.id, ""))?.qty).toBe(8);
    const moves = await listMoves({ productId: product.id, reason: "sale_pos" });
    expect(moves).toHaveLength(1);
    expect(moves[0].ref).toBe(order.number);
    expect(await listMoves({ productId: product.id, reason: "sale_web" })).toHaveLength(0);
  });

  /* The route creates the order, takes the money and settles it in one
     request, and the register leaves the basket and both pay buttons alive
     when the answer does not come back. A phone that drops the salon's wi-fi
     mid-request therefore shows «Сервер не отвечает» over a sale that HAS gone
     through, and the cashier — with a customer standing there — taps again.
     The basket's own id (migration 093) is what makes the second tap the first
     sale's receipt instead of a second sale. */
  it("a sale sent twice with the same basket id is one order, one letter, one write-off", async () => {
    await query(
      `insert into settings (key, value) values ('pricing', $1::jsonb)
       on conflict (key) do update set value = $1::jsonb`,
      [JSON.stringify({ partnersOn: true })],
    );
    const email = "salon-regular@example.com";
    const customer = await recordLogin(email, "RU");
    await move({ productId: product.id, delta: 10, reason: "goods_in" });

    const sale = {
      items: [{ id: product.id, qty: 2 }],
      customer: { email },
      payment: { method: "terminal" },
      ref: "basket-0001-abcd",
    };
    const first = await sell(sale);
    const again = await sell(sale);

    expect(again.orderId).toBe(first.orderId);
    expect(again.number).toBe(first.number);
    expect(again.total).toBe(first.total);
    expect(await query("select id from orders")).toHaveLength(1);
    expect((await getLevel(product.id, ""))?.qty).toBe(8); // 10 − 2, once
    expect(await listMoves({ productId: product.id, reason: "sale_pos" })).toHaveLength(1);
    expect(capturedMail().filter((m) => m.template === "pos-receipt")).toHaveLength(1);
    expect(
      await query("select id from loyalty_ledger where customer_id = $1 and order_id = $2", [
        customer.id,
        first.orderId,
      ]),
    ).toHaveLength(1);
  });

  /* The first attempt can also die between the INSERT and the settlement —
     the order row exists and nothing else does. The repeat must FINISH that
     sale, not report it as done: «Продажа оформлена» over an unpaid order
     with no write-off and no receipt is the one answer worse than a second
     order. */
  it("finishes a sale whose first attempt wrote the order and then died", async () => {
    await move({ productId: product.id, delta: 10, reason: "goods_in" });
    const ref = "basket-half-done-01";
    // exactly what a killed request leaves behind: the row, nothing else
    const { createOrder } = await import("@/lib/orders");
    const half = await createOrder({
      channel: "pos",
      lang: "RU",
      items: [{ id: product.id, qty: 2 }],
      customer: {},
      shipping: { method: "pickup", country: "EE" },
      posRef: ref,
    });
    expect(half.status).toBe("new");

    const again = await sell({
      items: [{ id: product.id, qty: 2 }],
      payment: { method: "cash" },
      ref,
    });
    expect(again.orderId).toBe(half.id);
    expect(await query("select id from orders")).toHaveLength(1);
    const order = (await getOrder(half.id))!;
    expect(order.status).toBe("paid");
    expect(order.payment).toMatchObject({ provider: "pos", method: "cash", status: "paid" });
    expect((await getLevel(product.id, ""))?.qty).toBe(8);
  });

  it("a basket the cashier changed mints a new id and is a new sale", async () => {
    await move({ productId: product.id, delta: 10, reason: "goods_in" });
    const one = await sell({
      items: [{ id: product.id, qty: 1 }],
      payment: { method: "cash" },
      ref: "basket-aaaa-0001",
    });
    const two = await sell({
      items: [{ id: product.id, qty: 1 }],
      payment: { method: "cash" },
      ref: "basket-bbbb-0002",
    });
    expect(two.orderId).not.toBe(one.orderId);
    expect((await getLevel(product.id, ""))?.qty).toBe(8);
  });

  /* An old register (a tab open since before the deploy) sends no id at all,
     and must go on selling — it simply gets no protection. */
  it("still sells a sale that carries no basket id", async () => {
    await move({ productId: product.id, delta: 10, reason: "goods_in" });
    const one = await sell({ items: [{ id: product.id, qty: 1 }], payment: { method: "cash" } });
    const two = await sell({ items: [{ id: product.id, qty: 1 }], payment: { method: "cash" } });
    expect(two.orderId).not.toBe(one.orderId);
    expect((await getLevel(product.id, ""))?.qty).toBe(8);
  });

  it("settles a walk-in with no e-mail and no customer card just the same", async () => {
    await move({ productId: product.id, delta: 5, reason: "goods_in" });
    const body = await sell({ items: [{ id: product.id, qty: 1 }], payment: { method: "cash" } });
    expect(body.mailed).toBe(false);

    const order = (await getOrder(body.orderId))!;
    expect(order.status).toBe("paid");
    expect(order.email).toBe("");
    expect(order.customerId).toBeNull();
    // the revenue row is written for a walk-in too — it is the shop's takings
    expect(await purchaseEvents(order.id)).toHaveLength(1);
    expect(capturedMail()).toHaveLength(0);
    expect((await getLevel(product.id, ""))?.qty).toBe(4);
  });

  it("does not invent a customer card for an address nobody has signed up with", async () => {
    const body = await sell({
      items: [{ id: product.id, qty: 1 }],
      customer: { email: "never-seen-before@example.com" },
      payment: { method: "cash" },
    });
    const order = (await getOrder(body.orderId))!;
    expect(order.customerId).toBeNull();
    expect(await query("select id from customers where email = 'never-seen-before@example.com'")).toHaveLength(0);
    // the letter still goes — the address was typed for exactly that
    expect(body.mailed).toBe(true);
    expect(capturedMail().filter((m) => m.template === "pos-receipt")).toHaveLength(1);
  });

  /* ---------- whose language the receipt is in ---------------------------
     Renat, 13.09.2026: «I did a salon sale in English, but e-mail arrived in
     russian.» The till sent no language at all, so createOrder() stamped its
     RU default on every sale in the room. The rule now: the customer's own
     card first, the language the sale was rung up in for a walk-in who has
     none — and the panel's language reaches a letter nowhere else. */
  it("writes the receipt in the language the sale was rung up in", async () => {
    const body = await sell({
      items: [{ id: product.id, qty: 1 }],
      customer: { email: "english-walkin@example.com" },
      payment: { method: "cash" },
      lang: "EN",
    });
    expect((await getOrder(body.orderId))?.lang).toBe("EN");
    const [letter] = capturedMail().filter((m) => m.template === "pos-receipt");
    expect(letter.subject).toMatch(/^Receipt R-1\d{5} — Rempire$/);
  });

  it("prefers the customer's own language over the register's", async () => {
    const email = "eesti-klient@example.com";
    await recordLogin(email, "ET");
    const body = await sell({
      items: [{ id: product.id, qty: 1 }],
      customer: { email },
      payment: { method: "terminal" },
      lang: "EN",
    });
    expect((await getOrder(body.orderId))?.lang).toBe("ET");
    const [letter] = capturedMail().filter((m) => m.template === "pos-receipt");
    expect(letter.subject).toMatch(/^Kviitung R-1\d{5} — Rempire$/);
  });

  it("falls back to Russian when nobody said anything about a language", async () => {
    const body = await sell({
      items: [{ id: product.id, qty: 1 }],
      customer: { email: "quiet@example.com" },
      payment: { method: "cash" },
    });
    expect((await getOrder(body.orderId))?.lang).toBe("RU");
  });
});

/**
 * The register's half of the same promise. The route can only recognise a
 * repeated sale if the till sends the same id for the same basket — and only
 * if that id is one the route will accept at all (cleanPosRef). Both functions
 * are sliced out of public/shop2/app.js by source text rather than retyped,
 * the way tests/checkout-parity.test.ts does it, so a rename or a rewrite
 * fails here instead of quietly turning the guard off.
 */
describe("the basket id the register mints", () => {
  const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

  function slice(name: string): string {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
    let depth = 0;
    for (let i = src.indexOf("{", start); i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces around ${name}() in app.js`);
  }

  const basket = (over: Record<string, unknown> = {}) => ({
    items: [{ id: "night-rider", qty: 1 }],
    customer: { email: "", phone: "" },
    payment: { method: "cash" },
    discountPercent: 0,
    ...over,
  });

  /** posSaleRef() over a list of baskets, in order, on one register. */
  function refs(...baskets: unknown[]): string[] {
    const body = `
      var window = {};
      var POS_SALE = { key: "", ref: "" };
      ${slice("posNewRef")}
      ${slice("posSaleRef")}
      return BASKETS.map(posSaleRef);
    `;
    // app.js's own source plus fixed stub text — nothing is interpolated in.
    return (new Function("BASKETS", body) as (b: unknown[]) => string[])(baskets);
  }

  it("is the same id for the same basket sent again", () => {
    const [a, b] = refs(basket(), basket());
    expect(a).toBe(b);
  });

  it("is a new id once anything about the sale changes", () => {
    const [a, b, c, d] = refs(
      basket(),
      basket({ items: [{ id: "night-rider", qty: 2 }] }),
      basket({ discountPercent: 10 }),
      basket({ customer: { email: "someone@example.com", phone: "" } }),
    );
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it("is an id the route will accept", () => {
    const [a] = refs(basket());
    expect(cleanPosRef(a)).toBe(a);
  });
});
