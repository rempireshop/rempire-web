/**
 * Security re-audit, 04.09.2026 — the owner's own products
 * (src/lib/custom-products.ts, the /api/admin/products routes, the public
 * feed, priceItems() in src/lib/orders.ts) and the admin overrides route,
 * whose every row is public.
 *
 * The server is the price authority. What is pinned: a cart line's own
 * price/sum/total are ignored; a size the product does not have — the way a
 * tampered cart asks for the big bottle at the small bottle's price — is
 * refused, not priced at the base; a hidden or unknown `c-…` id cannot be
 * bought; a prototype-pollution body reaches no field; the overrides route
 * caps and types what it stores.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { cleanCustomProductInput, createCustomProduct, setCustomProductActive } from "@/lib/custom-products";
import { exec } from "@/lib/db";
import { getOrder } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
let admin = "";
let ipN = 0;
const freshIp = () => `203.0.113.${(ipN++ % 200) + 1}`;

function req(path: string, method: string, body?: unknown, cookie: string | null = admin) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": freshIp() };
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const customer = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };
const shipping = { method: "pickup", country: "EE" };
const BALM = { brand: "Proraso", name: "Beard Balm", cat: "beard", sizes: ["100 мл", "250 мл"], prices: [14.9, 24.9] };
/** A catalogue product with a size ladder of its own (src/data/catalogue.variants.json). */
const SIZED = { id: "system-4-bio-botanical-shampoo", sizes: ["75 мл", "250 мл", "500 мл"], prices: [9, 16, 25] };

async function order(items: unknown[]): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import("@/app/api/orders/route");
  const res = await POST(req("/api/orders/", "POST", { lang: "RU", items, customer, shipping }, null));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
  await setupDb();
  admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
});
afterAll(teardownDb);
beforeEach(async () => {
  resetRateLimits();
  vi.spyOn(console, "error").mockImplementation(() => {});
  await truncateAll();
  await exec("truncate custom_products");
});
afterEach(() => vi.restoreAllMocks());

/* ---------- the checkout ---------------------------------------------------- */

describe("POST /api/orders — the server is the price authority for a custom product", () => {
  it("the browser's price, sum and total are ignored: the line costs what the row says", async () => {
    const p = await createCustomProduct(BALM);
    const { status, body } = await order([{ id: p.id, variant: "250 мл", qty: 2, price: 0.01, sum: 0.02, total: 0.02 }]);
    expect(status).toBe(201);
    const o = await getOrder(String(body.orderId));
    expect(o?.items[0]).toMatchObject({ id: p.id, variant: "250 мл", qty: 2, price: 24.9, sum: 49.8 });
    expect(o?.subtotal).toBe(49.8);
    expect(o?.total).toBeGreaterThanOrEqual(49.8);
    expect(body.total).toBe(o?.total);
  });

  it("a size the product does not have is refused, not priced at the base — custom and catalogue alike", async () => {
    const p = await createCustomProduct(BALM);
    for (const variant of ["250 ml", "250 мл ", " 250 мл", "250мл", 7, -1, "2", "500 мл", "<script>", "999999999999999999999"]) {
      const { status, body } = await order([{ id: p.id, variant, qty: 1 }]);
      expect(status, String(variant)).toBe(400);
      expect(body.error, String(variant)).toBe("bad_variant");
      const cat = await order([{ id: SIZED.id, variant, qty: 1 }]);
      if (variant === "500 мл" || variant === "2") continue; // real sizes of the catalogue product
      expect(cat.status, `catalogue ${String(variant)}`).toBe(400);
      expect(cat.body.error, `catalogue ${String(variant)}`).toBe("bad_variant");
    }
    // the honest spellings still work: the label, and its index
    for (const [variant, price] of [["250 мл", 24.9], [1, 24.9], ["1", 24.9], [0, 14.9]] as const) {
      const { status, body } = await order([{ id: p.id, variant, qty: 1 }]);
      expect(status, String(variant)).toBe(201);
      expect((await getOrder(String(body.orderId)))?.items[0]).toMatchObject({ variant: "250 мл".replace("250", price === 14.9 ? "100" : "250"), price });
    }
    const big = await order([{ id: SIZED.id, variant: "500 мл", qty: 1 }]);
    expect((await getOrder(String(big.body.orderId)))?.items[0]).toMatchObject({ variant: "500 мл", price: 25 });
  });

  it("a hidden product, an id nobody has, and an id in the wrong case cannot be bought", async () => {
    const p = await createCustomProduct(BALM);
    await setCustomProductActive(p.id, false);
    expect((await order([{ id: p.id, qty: 1 }])).body.error).toBe("out_of_stock");
    for (const id of ["c-never-made", p.id.toUpperCase(), "c-x/../y", "c-", "c-" + "a".repeat(200), "c-x\u0000"]) {
      const { status, body } = await order([{ id, qty: 1 }]);
      expect(status, id).toBe(400);
      expect(body.error, id).toBe("unknown_item");
    }
    // and a hidden product cannot hide inside a bigger basket either
    const ok = await createCustomProduct({ brand: "Acme", name: "Wax", cat: "styling", price: 9 });
    expect((await order([{ id: ok.id, qty: 1 }, { id: p.id, qty: 1 }])).body.error).toBe("out_of_stock");
  });
});

/* ---------- the input ------------------------------------------------------- */

describe("cleanCustomProductInput", () => {
  it("a prototype-pollution body reaches no field and leaves Object.prototype alone", () => {
    const raw = JSON.parse('{"__proto__":{"brand":"Evil","price":9},"name":"n","cat":"hair"}');
    expect(() => cleanCustomProductInput(raw)).toThrow(/brand_required/);
    expect(({} as Record<string, unknown>).brand).toBeUndefined();
    expect(({} as Record<string, unknown>).price).toBeUndefined();
    const sizes = JSON.parse('{"brand":"A","name":"B","cat":"hair","price":9,"sizes":[{"__proto__":{"price":1},"size":"75 мл"}]}');
    expect(cleanCustomProductInput(sizes)).toMatchObject({ sizes: ["75 мл"], prices: [9] });
  });

  it("refuses a size list past the cap before it reads a single label", () => {
    const sizes = Array.from({ length: 100_000 }, (_, i) => `${i} мл`);
    const t0 = Date.now();
    expect(() => cleanCustomProductInput({ brand: "A", name: "B", cat: "hair", price: 9, sizes })).toThrow(/too_many_sizes/);
    expect(Date.now() - t0).toBeLessThan(500);
  });

  it("through the route: the same refusal, as a 400 naming the field", async () => {
    const { POST } = await import("@/app/api/admin/products/route");
    const res = await POST(req("/api/admin/products/", "POST", JSON.parse('{"__proto__":{"brand":"Evil"},"name":"n","cat":"hair","price":9}')));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "brand_required", field: "brand" });
  });
});

/* ---------- the admin routes ------------------------------------------------ */

describe("the admin routes", () => {
  it("/api/admin/products/[id] answers 404 to anything that is not a `c-` slug", async () => {
    const one = await import("@/app/api/admin/products/[id]/route");
    for (const id of ["../../etc/passwd", "c-x/../y", "C-X", "c-", "touchable", "c-" + "a".repeat(200), "c-x\u0000"]) {
      expect((await one.GET(req(`/api/admin/products/x/`, "GET"), ctx(id))).status, id).toBe(404);
      expect((await one.PUT(req(`/api/admin/products/x/`, "PUT", { price: 9 }), ctx(id))).status, id).toBe(404);
      expect((await one.DELETE(req(`/api/admin/products/x/`, "DELETE"), ctx(id))).status, id).toBe(404);
    }
  });

  it("PUT /api/admin/overrides caps and types what it stores — every row is public", async () => {
    const { PUT } = await import("@/app/api/admin/overrides/route");
    const put = async (body: unknown) => {
      const res = await PUT(req("/api/admin/overrides/", "PUT", body));
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    // the id: a slug of at most 120 characters, never whitespace or a control character
    for (const id of ["x".repeat(300), "a b", "a\nb", "a\u0000b", " "]) {
      const r = await put({ id, price: 1 });
      expect(r.status, JSON.stringify(id)).toBe(400);
      expect(r.body.error, JSON.stringify(id)).toBe("bad_id");
    }
    // the legacy Russian pair: strings, one line, 70/170 like the per-language pair
    const long = await put({ id: "touchable", seoTitle: " T\n" + "T".repeat(1000), seoDesc: "D".repeat(1000) });
    expect(long.status).toBe(200);
    const saved = (long.body.overrides as Record<string, Record<string, unknown>>).touchable;
    expect(saved.seoTitle).toHaveLength(70);
    expect(saved.seoDesc).toHaveLength(170);
    expect(String(saved.seoTitle).startsWith("T T")).toBe(true);
    for (const bad of [{ seoTitle: { a: 1 } }, { seoDesc: ["x"] }, { seoTitle: 5 }, { subcat: "x".repeat(100) }, { subcat: {} }, { varImg: { a: { a: 1 } } }, { varImg: [0, "x"] }, { varImg: [0.5] }, { varImg: Array(100).fill(0) }, { varImg: [1e9] }, { videoUrl: {} }]) {
      const r = await put({ id: "touchable", ...bad });
      expect(r.status, JSON.stringify(bad)).toBe(400);
      expect(typeof r.body.error, JSON.stringify(bad)).toBe("string");
    }
    // what the panel actually sends still lands
    const ok = await put({ id: "touchable", subcat: "sh", varImg: [0, 2, 1], seoTitle: null, seoDesc: "" });
    expect(ok.status).toBe(200);
    expect((ok.body.overrides as Record<string, Record<string, unknown>>).touchable).toMatchObject({ subcat: "sh", varImg: [0, 2, 1], seoTitle: null });

    const feed = await (await (await import("@/app/api/overrides/route")).GET()).json();
    expect(feed.overrides.touchable).toMatchObject({ subcat: "sh", varImg: [0, 2, 1] });
    expect(feed.overrides.touchable.seoTitle).toBeNull();
  });
});
