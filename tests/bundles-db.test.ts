/**
 * The sets, now that they live in the database (db/migrations/120_bundles.sql
 * + src/lib/bundles.ts). Runs on PGlite — a real Postgres, no server.
 *
 * tests/bundles.test.ts is the other half and stays: it guards the generator
 * (tools/build-bundles.mjs) that still produces the static fallback and the
 * seed this migration was written from. This file guards what happens after
 * the row exists: what validateBundle() refuses, what a set costs when the
 * order is priced, and that re-running the migration never touches an edit
 * the owner made.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variants from "@/data/catalogue.variants.json";
import { exec, query } from "@/lib/db";
import {
  BUNDLE_MAX_ITEMS,
  bundleDefsForOrders,
  deleteBundle,
  getBundle,
  listBundles,
  reorderBundles,
  setBundleActive,
  upsertBundle,
  validateBundle,
  type BundleInput,
} from "@/lib/bundles";
import { createOrder, OrderError, upsertOverride } from "@/lib/orders";
import { setupDb, teardownDb } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const VARIANTS = variants as Record<string, { sizes: string[]; prices: number[] }>;

const inStock = CATALOGUE.filter((p) => p.s === "in" && !VARIANTS[p.id]);
const A = inStock[0];
const B = inStock[1];
const C = inStock[2];
const SIZED = CATALOGUE.find((p) => p.s === "in" && (VARIANTS[p.id]?.sizes.length ?? 0) > 1)!;
const OUT = CATALOGUE.find((p) => p.s === "out")!;

const MIGRATION = readFileSync(new URL("../db/migrations/120_bundles.sql", import.meta.url), "utf8");

const customer = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };
const ship = { method: "parcel", country: "EE" };

/** A valid draft, so each test only says what it is changing. */
function draft(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "test-set",
    cat: "beard",
    title: { RU: "Тестовый набор", ET: "Testkomplekt", EN: "Test set" },
    desc: { RU: "Два товара вместе.", ET: "", EN: "" },
    items: [
      { productId: A.id, variant: 0, qty: 1 },
      { productId: B.id, variant: 0, qty: 1 },
    ],
    price: Math.round((A.p + B.p) * 0.8 * 100) / 100,
    active: true,
    sort: 10,
    ...over,
  };
}

function valid(over: Record<string, unknown> = {}): BundleInput {
  const check = validateBundle(draft(over));
  if (!check.ok) throw new Error("fixture is invalid: " + check.error);
  return check.value;
}

/** Everything this file made, without touching the seeded eight. */
async function dropTestSets(): Promise<void> {
  await query("delete from bundles where id like 'test-%' or id like 'e2e-%'");
}

describe("validateBundle", () => {
  it("accepts a plain two-product set and computes what the parts cost", () => {
    const check = validateBundle(draft());
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.sum).toBeCloseTo(A.p + B.p, 2);
    expect(check.price).toBeLessThan(check.sum);
    expect(check.value.items).toHaveLength(2);
  });

  it("refuses a set of fewer than two products", () => {
    expect(validateBundle(draft({ items: [{ productId: A.id }] }))).toMatchObject({ error: "few_items" });
    expect(validateBundle(draft({ items: [] }))).toMatchObject({ error: "few_items" });
    expect(validateBundle(draft({ items: "nope" }))).toMatchObject({ error: "few_items" });
  });

  it("refuses more than the ceiling", () => {
    const many = Array.from({ length: BUNDLE_MAX_ITEMS + 1 }, (_, i) => ({ productId: inStock[i].id }));
    expect(validateBundle(draft({ items: many }))).toMatchObject({ error: "too_many_items" });
  });

  it("refuses a product the catalogue does not have", () => {
    expect(validateBundle(draft({ items: [{ productId: "no-such-product" }, { productId: B.id }] }))).toMatchObject({
      error: "unknown_product",
    });
  });

  it("refuses the same product at the same size twice", () => {
    expect(validateBundle(draft({ items: [{ productId: A.id }, { productId: A.id }] }))).toMatchObject({
      error: "dup_item",
    });
  });

  it("allows the same product at two different sizes", () => {
    const prices = VARIANTS[SIZED.id].prices;
    const check = validateBundle(
      draft({
        items: [{ productId: SIZED.id, variant: 0 }, { productId: SIZED.id, variant: 1 }],
        price: Math.round((prices[0] + prices[1]) * 0.8 * 100) / 100,
      }),
    );
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    // each volume is priced at its own price, not twice at the base one
    expect(check.sum).toBeCloseTo(prices[0] + prices[1], 2);
  });

  it("refuses a size the product does not have", () => {
    expect(validateBundle(draft({ items: [{ productId: A.id, variant: 7 }, { productId: B.id }] }))).toMatchObject({
      error: "bad_variant",
    });
  });

  it("refuses a quantity that is not a sane whole number", () => {
    for (const qty of [0, -1, 1e9, "abc"]) {
      expect(validateBundle(draft({ items: [{ productId: A.id, qty }, { productId: B.id }] }))).toMatchObject({
        error: "bad_qty",
      });
    }
  });

  it("refuses a price that is not a price", () => {
    for (const price of [-1, 1e9, "abc"]) {
      expect(validateBundle(draft({ price }))).toMatchObject({ error: "bad_price" });
    }
  });

  /* The rule the owner is most likely to trip over, and the reason a set
     exists at all: it has to be cheaper than the same things bought apart. */
  it("refuses a price at or above the sum of the parts", () => {
    expect(validateBundle(draft({ price: A.p + B.p }))).toMatchObject({ error: "price_too_high" });
    expect(validateBundle(draft({ price: A.p + B.p + 10 }))).toMatchObject({ error: "price_too_high" });
    expect(validateBundle(draft({ price: null, discountPct: 0 }))).toMatchObject({ error: "price_too_high" });
    expect(validateBundle(draft({ price: null }))).toMatchObject({ error: "price_too_high" });
  });

  it("takes a percent instead of a price", () => {
    const check = validateBundle(draft({ price: null, discountPct: 20 }));
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.value.price).toBeNull();
    expect(check.value.discountPct).toBe(20);
    expect(check.price).toBeCloseTo((A.p + B.p) * 0.8, 2);
    expect(validateBundle(draft({ price: null, discountPct: 95 }))).toMatchObject({ error: "bad_discount" });
  });

  it("insists on a Russian name and a slug id", () => {
    expect(validateBundle(draft({ title: { RU: "", ET: "x", EN: "x" } }))).toMatchObject({ error: "bad_name" });
    for (const id of ["", "A", "с-кириллицей", "has space", "-leading", "x".repeat(80)]) {
      expect(validateBundle(draft({ id }))).toMatchObject({ error: "bad_id" });
    }
  });

  it("takes a product id or a URL as the photo, nothing else", () => {
    expect(validateBundle(draft({ image: A.id })).ok).toBe(true);
    expect(validateBundle(draft({ image: "/shop/img/x.webp" })).ok).toBe(true);
    expect(validateBundle(draft({ image: "javascript:alert(1)" }))).toMatchObject({ error: "bad_image" });
  });

  it("survives hostile shapes without throwing", () => {
    for (const raw of [null, undefined, 5, "x", [], { items: [null, 1] }]) {
      expect(() => validateBundle(raw)).not.toThrow();
      expect(validateBundle(raw).ok).toBe(false);
    }
  });

  it("checks the price against the owner's overridden prices, not the printed ones", () => {
    // the shop sells A for 1 € today, so a set of A+B at (A.p+B.p)*0.8 is no
    // longer a discount — it can be more than the parts actually cost
    const overrides = { [A.id]: { price: 1 } } as never;
    const check = validateBundle(draft({ price: A.p + B.p - 0.5 }), overrides);
    expect(check).toMatchObject({ error: "price_too_high" });
  });
});

describe("the bundles table", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(dropTestSets);

  it("is seeded with the sets the shop already sold, ids and prices intact", async () => {
    const seeded = await listBundles();
    const ids = seeded.map((b) => b.id);
    expect(ids).toContain("beard-start");
    expect(ids.length).toBeGreaterThanOrEqual(6);
    const beard = seeded.find((b) => b.id === "beard-start")!;
    // 34,90 € is what tools/bundles.config.mjs produced and what customers saw
    expect(beard.price).toBe(34.9);
    expect(beard.items.length).toBe(3);
    expect(beard.title.ET).toBeTruthy();
    expect(beard.title.EN).toBeTruthy();
    expect(beard.sum).toBeGreaterThan(beard.price);
    expect(beard.pct).toBeGreaterThan(0);
  });

  /* «on conflict do nothing»: a second run of the migration — a redeploy, a
     re-applied migration list — must never quietly undo an edit. */
  it("re-running the migration changes nothing that was edited", async () => {
    const before = await listBundles();
    await query("update bundles set price = 9.90, name_ru = 'Изменённое имя' where id = 'beard-start'");
    await exec(MIGRATION);
    const after = await getBundle("beard-start");
    expect(after?.price).toBe(9.9);
    expect(after?.title.RU).toBe("Изменённое имя");
    expect((await listBundles()).length).toBe(before.length);
    // put it back so the rest of the file sees the seeded shop
    await query("update bundles set price = 34.90, name_ru = $1 where id = 'beard-start'", [
      before.find((b) => b.id === "beard-start")!.title.RU,
    ]);
  });

  it("round-trips a set: create, read, edit, hide, delete", async () => {
    const made = await upsertBundle(valid());
    expect(made.id).toBe("test-set");
    expect(made.items.map((i) => i.productId)).toEqual([A.id, B.id]);
    expect(made.items[0].brand).toBe(A.b);
    expect(made.active).toBe(true);

    const edited = await upsertBundle(valid({ price: 5, items: [{ productId: A.id }, { productId: C.id }] }));
    expect(edited.price).toBe(5);
    expect(edited.items.map((i) => i.productId)).toEqual([A.id, C.id]);

    const hidden = await setBundleActive("test-set", false);
    expect(hidden?.active).toBe(false);
    expect((await listBundles({ activeOnly: true })).some((b) => b.id === "test-set")).toBe(false);
    expect((await listBundles()).some((b) => b.id === "test-set")).toBe(true);

    expect((await deleteBundle("test-set"))?.id).toBe("test-set");
    expect(await getBundle("test-set")).toBeNull();
    expect(await deleteBundle("test-set")).toBeNull();
  });

  it("prices the parts from the catalogue and follows a price override", async () => {
    await upsertBundle(valid());
    const before = (await getBundle("test-set"))!;
    expect(before.sum).toBeCloseTo(A.p + B.p, 2);

    await upsertOverride(A.id, { price: A.p + 10 });
    const after = (await getBundle("test-set"))!;
    expect(after.sum).toBeCloseTo(A.p + B.p + 10, 2);
    // the set price itself is the owner's number and does not move
    expect(after.price).toBe(before.price);
    expect(after.save).toBeCloseTo(after.sum - after.price, 2);
    await upsertOverride(A.id, { price: null });
  });

  it("reports the worst stock of its parts", async () => {
    await upsertBundle(valid({ items: [{ productId: A.id }, { productId: OUT.id }] }));
    expect((await getBundle("test-set"))!.stock).toBe("out");
  });

  it("reorders by the list it is given", async () => {
    await upsertBundle(valid({ id: "test-a", sort: 500 }));
    await upsertBundle(valid({ id: "test-b", sort: 600 }));
    const ids = (await listBundles()).map((b) => b.id);
    const wanted = ["test-b", "test-a", ...ids.filter((i) => !i.startsWith("test-"))];
    const after = (await reorderBundles(wanted)).map((b) => b.id);
    expect(after.indexOf("test-b")).toBeLessThan(after.indexOf("test-a"));
  });
});

describe("an order with a set in it", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(dropTestSets);

  it("charges the price in the table, never the one the browser sent", async () => {
    await upsertBundle(valid({ price: 12.5 }));
    const order = await createOrder({
      lang: "ru",
      // a tampered cart: the client claims this set costs 1 €
      items: [{ id: "bundle:test-set", qty: 1, price: 1 } as never],
      customer,
      shipping: ship,
    });
    const line = order.items.find((i) => i.kind === "bundle")!;
    expect(line.price).toBe(12.5);
    expect(line.sum).toBe(12.5);
    expect(line.title).toBe("Тестовый набор");
    expect(order.subtotal).toBe(12.5);
  });

  it("follows an edit made in the admin", async () => {
    await upsertBundle(valid({ price: 12.5 }));
    await upsertBundle(valid({ price: 9.9 }));
    const order = await createOrder({
      lang: "ru",
      items: [{ id: "bundle:test-set", qty: 1 }],
      customer,
      shipping: ship,
    });
    expect(order.items[0].price).toBe(9.9);
  });

  /* The switch and the «скрыт» toggle are shop-window decisions. A customer
     who already has the set in the cart must be able to finish paying. */
  it("still sells a set the owner has hidden", async () => {
    await upsertBundle(valid({ price: 12.5 }));
    await setBundleActive("test-set", false);
    const order = await createOrder({
      lang: "ru",
      items: [{ id: "bundle:test-set", qty: 1 }],
      customer,
      shipping: ship,
    });
    expect(order.items[0].price).toBe(12.5);
    expect((await bundleDefsForOrders())["test-set"]).toBeTruthy();
  });

  it("refuses a set that no longer exists", async () => {
    await expect(
      createOrder({ lang: "ru", items: [{ id: "bundle:gone-for-good", qty: 1 }], customer, shipping: ship }),
    ).rejects.toMatchObject({ code: "bundle_unknown" } as OrderError);
  });

  it("refuses a set whose part has run out", async () => {
    await upsertBundle(valid({ items: [{ productId: A.id }, { productId: OUT.id }], price: 5 }));
    await expect(
      createOrder({ lang: "ru", items: [{ id: "bundle:test-set", qty: 1 }], customer, shipping: ship }),
    ).rejects.toMatchObject({ code: "out_of_stock" } as OrderError);
  });

  it("names the line in the shopper's own language", async () => {
    await upsertBundle(valid({ price: 5 }));
    const et = await createOrder({
      lang: "ET",
      items: [{ id: "bundle:test-set", qty: 1 }],
      customer,
      shipping: ship,
    });
    expect(et.items[0].title).toBe("Testkomplekt");
  });
});
