/** POST /api/admin/pos-orders/ and its receipt — the in-salon quick sale. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { getLevel, listMoves, move } from "@/lib/inventory";
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
