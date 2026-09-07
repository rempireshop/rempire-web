/**
 * The product editor's three controls that used to be dead — «+ Размер», «×»
 * and «Показывать в магазине» (db/migrations/147_override_sizes_hidden.sql).
 *
 * What is proven here is the half a browser cannot: that the size ladder the
 * owner saves is the ladder the shop CHARGES from (a volume the generated
 * catalogue file has never heard of included), that removing a rung really
 * removes it, and that a hidden product can no longer be bought or indexed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variants from "@/data/catalogue.variants.json";
import { query } from "@/lib/db";
import { cleanSizes, createOrder, getOverrides, OrderError, overrideLadder, upsertOverride } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const VARIANTS = variants as Record<string, { sizes: string[]; prices: number[] }>;

const plain = CATALOGUE.find((p) => p.s === "in" && !VARIANTS[p.id])!;
const sized = CATALOGUE.find((p) => p.s === "in" && VARIANTS[p.id])!;

const customer = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };
const ship = { method: "parcel", country: "EE" };

function order(items: Array<Record<string, unknown>>) {
  return { lang: "ru", items, customer, shipping: ship } as Parameters<typeof createOrder>[0];
}

describe("product_overrides.sizes / .hidden", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(truncateAll);

  it("has both columns", async () => {
    const cols = await query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'product_overrides'",
    );
    const names = cols.map((c) => c.column_name);
    expect(names).toContain("sizes");
    expect(names).toContain("hidden");
  });

  it("defaults to «not hidden, the catalogue's own volumes»", async () => {
    await upsertOverride(plain.id, { price: 9 });
    const o = (await getOverrides([plain.id]))[plain.id];
    expect(o.hidden).toBe(false);
    expect(o.sizes).toBeNull();
  });

  /* ---- «+ Размер» ------------------------------------------------------- */

  it("stores the whole ladder and hands the first rung's price to `price`", async () => {
    await upsertOverride(plain.id, { sizes: [{ size: "100 мл", price: 12.5 }, { size: "250 мл", price: 22 }] });
    const o = (await getOverrides([plain.id]))[plain.id];
    expect(o.sizes).toEqual([{ size: "100 мл", price: 12.5 }, { size: "250 мл", price: 22 }]);
    // everything older than migration 147 reads `price` alone — it must agree
    expect(o.price).toBe(12.5);
  });

  it("lets a shopper buy a volume the catalogue file has never heard of", async () => {
    expect(VARIANTS[plain.id]).toBeUndefined();
    await upsertOverride(plain.id, { sizes: [{ size: "100 мл", price: 12.5 }, { size: "250 мл", price: 22 }] });
    const made = await createOrder(order([{ id: plain.id, variant: "250 мл", qty: 2 }]));
    expect(made.items[0].variant).toBe("250 мл");
    expect(made.items[0].price).toBe(22);
    expect(made.items[0].sum).toBe(44);
  });

  it("prices every rung from the ladder, not from a premium over the file", async () => {
    await upsertOverride(sized.id, { sizes: [{ size: "A", price: 5 }, { size: "B", price: 6 }] });
    const made = await createOrder(order([{ id: sized.id, variant: "B", qty: 1 }]));
    expect(made.items[0].price).toBe(6);
  });

  /* ---- «×» -------------------------------------------------------------- */

  it("refuses a volume the owner removed", async () => {
    const gone = VARIANTS[sized.id].sizes[VARIANTS[sized.id].sizes.length - 1];
    await upsertOverride(sized.id, { sizes: [{ size: "только эта", price: 10 }] });
    await expect(createOrder(order([{ id: sized.id, variant: gone, qty: 1 }]))).rejects.toMatchObject({
      code: "bad_variant",
    });
  });

  it("null gives the volumes back to the catalogue file", async () => {
    await upsertOverride(sized.id, { sizes: [{ size: "только эта", price: 10 }] });
    await upsertOverride(sized.id, { sizes: null });
    expect((await getOverrides([sized.id]))[sized.id].sizes).toBeNull();
    const keep = VARIANTS[sized.id].sizes[0];
    const made = await createOrder(order([{ id: sized.id, variant: keep, qty: 1 }]));
    expect(made.items[0].variant).toBe(keep);
  });

  /* ---- «Показывать в магазине» ------------------------------------------ */

  it("refuses to sell a hidden product", async () => {
    await upsertOverride(plain.id, { hidden: true });
    await expect(createOrder(order([{ id: plain.id, qty: 1 }]))).rejects.toBeInstanceOf(OrderError);
    await expect(createOrder(order([{ id: plain.id, qty: 1 }]))).rejects.toMatchObject({ code: "out_of_stock" });
  });

  it("sells it again the moment the switch goes back on", async () => {
    await upsertOverride(plain.id, { hidden: true });
    await upsertOverride(plain.id, { hidden: false });
    const made = await createOrder(order([{ id: plain.id, qty: 1 }]));
    expect(made.items).toHaveLength(1);
  });

  it("hiding does not touch the volumes and vice versa", async () => {
    await upsertOverride(plain.id, { sizes: [{ size: "50 мл", price: 7 }, { size: "90 мл", price: 9 }] });
    await upsertOverride(plain.id, { hidden: true });
    const o = (await getOverrides([plain.id]))[plain.id];
    expect(o.hidden).toBe(true);
    expect(o.sizes).toHaveLength(2);
  });

  /* ---- the sanitiser ---------------------------------------------------- */

  it("drops rungs that are not rungs, and duplicate labels", () => {
    expect(cleanSizes([{ size: "A", price: 1 }, { size: "A", price: 2 }, { size: "B", price: "x" }, { size: "C", price: 3 }]))
      .toEqual([{ size: "A", price: 1 }, { size: "C", price: 3 }]);
    expect(cleanSizes("нет")).toBeNull();
    expect(cleanSizes([])).toBeNull();
    expect(cleanSizes(null)).toBeNull();
    expect(cleanSizes([{ size: "x", price: -1 }])).toBeNull();
  });

  it("keeps at most twelve rungs and one short line per label", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ size: `s${i}`, price: 1 }));
    expect(cleanSizes(many)).toHaveLength(12);
    expect(cleanSizes([{ size: "x".repeat(90), price: 1 }])![0].size).toHaveLength(30);
  });

  it("a single unlabelled rung is «один объём», not a ladder", () => {
    expect(overrideLadder({ sizes: [{ size: "", price: 9 }] } as never)).toBeNull();
    expect(overrideLadder({ sizes: [{ size: "100 мл", price: 9 }] } as never))
      .toEqual({ sizes: ["100 мл"], prices: [9] });
    expect(overrideLadder(null)).toBeNull();
  });
});
