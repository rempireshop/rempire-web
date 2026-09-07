/** POST /api/admin/pos-orders/ and its receipt — the in-salon quick sale. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { recordLogin } from "@/lib/customers";
import { query } from "@/lib/db";
import { getLevel, listMoves, move } from "@/lib/inventory";
import { getLoyaltyBalance } from "@/lib/loyalty";
import { capturedMail } from "@/lib/mail";
import { getOrder } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

type Min = { id: string; p: number; s: string };
const product = (catalogueMin as Min[]).find((p) => p.s === "in")!;

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
    const letters = capturedMail().filter((m) => m.template === "order-confirmed");
    expect(letters).toHaveLength(1);
    expect(letters[0].to).toEqual([email]);

    // and the one thing that must not change: the shelf reason
    expect((await getLevel(product.id, ""))?.qty).toBe(8);
    const moves = await listMoves({ productId: product.id, reason: "sale_pos" });
    expect(moves).toHaveLength(1);
    expect(moves[0].ref).toBe(order.number);
    expect(await listMoves({ productId: product.id, reason: "sale_web" })).toHaveLength(0);
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
    expect(capturedMail().filter((m) => m.template === "order-confirmed")).toHaveLength(0);
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
    expect(capturedMail().filter((m) => m.template === "order-confirmed")).toHaveLength(1);
  });
});
