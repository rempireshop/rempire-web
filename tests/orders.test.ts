import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variants from "@/data/catalogue.variants.json";
import { query } from "@/lib/db";
import {
  createOrder,
  fallbackShipping,
  getOrder,
  getOrderByNumber,
  listOrders,
  OrderError,
  setOrderPayment,
  setOrderStatus,
  upsertOverride,
} from "@/lib/orders";
import { setupDb, teardownDb, truncateAll } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const VARIANTS = variants as Record<string, { sizes: string[]; prices: number[] }>;

const plain = CATALOGUE.find((p) => p.s === "in" && !VARIANTS[p.id])!;
const sized = CATALOGUE.find((p) => p.s === "in" && VARIANTS[p.id])!;
const outStock = CATALOGUE.find((p) => p.s === "out")!;

const customer = { name: "Мария Тамм", email: "Maria@Example.COM", phone: "+372 5555 5555" };
const ship = { method: "parcel", country: "EE" };

function order(extra: Record<string, unknown> = {}) {
  return {
    lang: "ru",
    items: [{ id: plain.id, qty: 2 }],
    customer,
    shipping: ship,
    ...extra,
  } as Parameters<typeof createOrder>[0];
}

describe("createOrder", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(truncateAll);

  it("prices from the catalogue, not from the request", async () => {
    // the client sends a price of its own — it must be ignored outright
    const o = await createOrder(
      order({ items: [{ id: plain.id, qty: 2, price: 0.01, sum: 0.02 } as never] }),
    );
    expect(o.subtotal).toBe(Math.round(plain.p * 2 * 100) / 100);
    expect(o.items[0].price).toBe(plain.p);
    expect(o.total).toBe(Math.round((o.subtotal + o.shippingPrice) * 100) / 100);
  });

  it("charges the price of the chosen size, by index or by label", async () => {
    const v = VARIANTS[sized.id];
    const byIndex = await createOrder(order({ items: [{ id: sized.id, variant: 2, qty: 1 }] }));
    const byLabel = await createOrder(order({ items: [{ id: sized.id, variant: v.sizes[2], qty: 1 }] }));
    expect(byIndex.items[0].price).toBe(v.prices[2]);
    expect(byIndex.items[0].variant).toBe(v.sizes[2]);
    expect(byLabel.items[0].price).toBe(v.prices[2]);
    expect(byIndex.items[0].price).not.toBe(sized.p);
  });

  it("uses the admin's price override and keeps the size premium", async () => {
    await upsertOverride(plain.id, { price: 1.5 });
    const o = await createOrder(order({ items: [{ id: plain.id, qty: 1 }] }));
    expect(o.items[0].price).toBe(1.5);

    const v = VARIANTS[sized.id];
    await upsertOverride(sized.id, { price: sized.p - 1 });
    const big = await createOrder(order({ items: [{ id: sized.id, variant: 2, qty: 1 }] }));
    expect(big.items[0].price).toBe(Math.round((v.prices[2] - 1) * 100) / 100);
  });

  it("refuses a product the catalogue calls out of stock", async () => {
    await expect(createOrder(order({ items: [{ id: outStock.id, qty: 1 }] }))).rejects.toMatchObject({
      code: "out_of_stock",
    });
  });

  it("refuses a product the admin has marked out of stock", async () => {
    await upsertOverride(plain.id, { stock: "out" });
    await expect(createOrder(order())).rejects.toMatchObject({ code: "out_of_stock" });
    await upsertOverride(plain.id, { stock: "in" });
    await expect(createOrder(order())).resolves.toBeTruthy();
  });

  it("refuses unknown products, silly quantities, empty carts and bad addresses", async () => {
    await expect(createOrder(order({ items: [{ id: "no-such-product", qty: 1 }] }))).rejects.toMatchObject({
      code: "unknown_item",
    });
    await expect(createOrder(order({ items: [{ id: plain.id, qty: 0 }] }))).rejects.toMatchObject({ code: "bad_qty" });
    await expect(createOrder(order({ items: [{ id: plain.id, qty: 1000 }] }))).rejects.toMatchObject({ code: "bad_qty" });
    await expect(createOrder(order({ items: [] }))).rejects.toMatchObject({ code: "empty_order" });
    await expect(createOrder(order({ customer: { ...customer, email: "nope" } }))).rejects.toMatchObject({
      code: "bad_email",
    });
    await expect(createOrder(order({ customer: { ...customer, name: "  " } }))).rejects.toMatchObject({
      code: "bad_name",
    });
    await expect(createOrder(order())).resolves.toBeTruthy(); // the valid one still passes
  });

  it("rejects a bundle it cannot find", async () => {
    const err = await createOrder(order({ items: [{ id: "bundle:definitely-not-a-bundle", qty: 1 }] })).catch((e) => e);
    expect(err).toBeInstanceOf(OrderError);
    expect(err.code).toBe("bundle_unknown");
  });

  it("prices a bundle from src/data/bundles.json when the features agent has one", async () => {
    const mod = (await import("@/data/bundles.json").catch(() => null)) as { default?: unknown } | null;
    if (!mod) return; // the file is optional; the test above covers its absence
    const list = ((mod.default ?? mod) as Array<Record<string, unknown>>) || [];
    const inStock = (id: unknown) => CATALOGUE.find((p) => p.id === id)?.s !== "out";
    const b = list.find(
      (x) =>
        x &&
        typeof x.id === "string" &&
        typeof x.price === "number" &&
        Array.isArray(x.items) &&
        (x.items as Array<{ id: string }>).every((i) => inStock(i.id)),
    );
    if (!b) return;
    const o = await createOrder(order({ items: [{ id: `bundle:${b.id}`, qty: 1 }] }));
    expect(o.items[0].kind).toBe("bundle");
    expect(o.items[0].price).toBe(b.price);
    expect(typeof o.items[0].title).toBe("string");
    expect(o.subtotal).toBe(b.price);
  });

  it("ignores a discount code that buys nothing", async () => {
    const o = await createOrder(order({ discountCode: "NOT-A-REAL-CARD" }));
    expect(o.discount).toBe(0);
    expect(o.discountCode).toBe("NOT-A-REAL-CARD");
    expect(o.total).toBe(Math.round((o.subtotal + o.shippingPrice) * 100) / 100);
  });

  it("prices shipping by country and method", async () => {
    const cheap = await createOrder(order({ items: [{ id: plain.id, qty: 1 }], shipping: { method: "parcel", country: "EE" } }));
    const courier = await createOrder(order({ items: [{ id: plain.id, qty: 1 }], shipping: { method: "courier", country: "EE" } }));
    const abroad = await createOrder(order({ items: [{ id: plain.id, qty: 1 }], shipping: { method: "courier", country: "LV" } }));
    const pickup = await createOrder(order({ items: [{ id: plain.id, qty: 1 }], shipping: { method: "pickup", country: "EE" } }));
    const free = await createOrder(order({ items: [{ id: plain.id, qty: 3 }], shipping: { method: "parcel", country: "EE" } }));
    expect(cheap.shippingPrice).toBe(5.47);
    expect(courier.shippingPrice).toBe(10.84);
    expect(abroad.shippingPrice).toBe(9.9);
    expect(pickup.shippingPrice).toBe(0);
    expect(free.subtotal).toBeGreaterThanOrEqual(59);
    expect(free.shippingPrice).toBe(0);
  });

  it("has a fallback table for when src/lib/shipping.ts is unavailable, mirroring DEFAULT_SHIPPING_RULES", () => {
    expect(fallbackShipping("EE", "parcel", 10)).toBe(5.47);
    expect(fallbackShipping("EE", "courier", 10)).toBe(10.84);
    expect(fallbackShipping("LV", "courier", 10)).toBe(9.9);
    expect(fallbackShipping("EE", "pickup", 10)).toBe(0);
    expect(fallbackShipping("EE", "parcel", 59)).toBe(0);
  });

  it("normalises the customer and stores the whole order", async () => {
    const o = await createOrder(order({ items: [{ id: plain.id, qty: 1 }] }));
    expect(o.email).toBe("maria@example.com");
    expect(o.lang).toBe("RU");
    expect(o.currency).toBe("EUR");
    expect(o.status).toBe("new");
    expect(o.number).toMatch(/^R-1\d{5}$/);
    expect(o.shipping.country).toBe("EE");
    expect(o.items[0].title).toBe(plain.n);

    const again = await getOrder(o.id);
    expect(again?.total).toBe(o.total);
    expect(await getOrderByNumber(o.number)).toMatchObject({ id: o.id });
    expect(await getOrderByNumber(o.number.replace("R-", ""))).toMatchObject({ id: o.id });
    expect(await getOrder("not-a-uuid")).toBeNull();
  });

  it("records status changes in admin_audit and merges payment payloads", async () => {
    const o = await createOrder(order());
    const paid = await setOrderStatus(o.id, "paid", "admin");
    expect(paid?.status).toBe("paid");
    await expect(setOrderStatus(o.id, "flying" as never)).rejects.toMatchObject({ code: "bad_status" });

    await setOrderPayment(o.id, { provider: "montonio", ref: "abc" });
    const merged = await setOrderPayment(o.id, { status: "ok" });
    expect(merged?.payment).toMatchObject({ provider: "montonio", ref: "abc", status: "ok" });

    const audit = await query<{ action: string; payload: { to: string } }>("select action, payload from admin_audit");
    expect(audit.some((a) => a.action === "order.status" && a.payload.to === "paid")).toBe(true);
  });

  it("knows the owner's last step, «delivered», and walks it back like any other", async () => {
    const o = await createOrder(order());
    await setOrderStatus(o.id, "paid", "admin");
    await setOrderStatus(o.id, "shipped", "admin");
    expect((await setOrderStatus(o.id, "delivered", "admin"))?.status).toBe("delivered");
    // the database's check constraint carries the value too (db/migrations/140_order_delivered.sql)
    expect((await getOrder(o.id))?.status).toBe("delivered");
    expect((await listOrders({ status: "delivered" })).map((x) => x.id)).toEqual([o.id]);
    // the journal's undo: back to shipped, then to paid
    expect((await setOrderStatus(o.id, "shipped", "admin"))?.status).toBe("shipped");
    expect((await setOrderStatus(o.id, "paid", "admin"))?.status).toBe("paid");
    const audit = await query<{ payload: { from: string; to: string } }>(
      "select payload from admin_audit where action = 'order.status' order by id",
    );
    expect(audit.map((a) => `${a.payload.from}>${a.payload.to}`)).toEqual([
      "new>paid", "paid>shipped", "shipped>delivered", "delivered>shipped", "shipped>paid",
    ]);
  });

  it("filters the admin list by status and search", async () => {
    const a = await createOrder(order({ customer: { ...customer, name: "Ааа Ааа" } }));
    await createOrder(order({ customer: { ...customer, name: "Ббб Ббб", email: "bbb@example.com" } }));
    await setOrderStatus(a.id, "shipped", "admin");

    expect((await listOrders({})).length).toBe(2);
    expect((await listOrders({ status: "shipped" })).map((o) => o.id)).toEqual([a.id]);
    expect((await listOrders({ q: "bbb@example" })).length).toBe(1);
    expect((await listOrders({ q: a.number })).map((o) => o.id)).toEqual([a.id]);
    expect((await listOrders({ status: "nonsense" })).length).toBe(2); // unknown status is ignored, not fatal
  });
});
