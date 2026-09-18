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

/* Migration 147 — «Товары → Размеры и цены». Two ladders the owner could save
   over SIZED's generated one: the first drops a rung and re-prices both that
   are left, the second adds a volume the catalogue file has never heard of.
   Labels come from the file so a regenerated catalogue cannot break the test;
   the prices are deliberately far from anything the file carries. */
const OWN_LADDER = [
  { size: VARIANTS[SIZED.id].sizes[0], price: 4.5 },
  { size: VARIANTS[SIZED.id].sizes[VARIANTS[SIZED.id].sizes.length - 1], price: 41.2 },
];
const LONGER_LADDER = [
  ...VARIANTS[SIZED.id].sizes.map((size, i) => ({ size, price: VARIANTS[SIZED.id].prices[i] })),
  { size: "1 л", price: 60 },
];

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

  /* The «дешевле по отдельности» guard is only as honest as the sum it is
     checked against, and that sum has to come from the ladder the owner
     actually saved — src/lib/orders.ts has priced every other line that way
     since migration 147. */
  it("counts the parts at the size ladder the owner saved, not the generated one", () => {
    const overrides = { [SIZED.id]: { price: OWN_LADDER[0].price, sizes: OWN_LADDER } } as never;
    const items = [{ productId: SIZED.id, variant: 1 }, { productId: B.id }];
    const parts = OWN_LADDER[1].price + B.p;

    const check = validateBundle(draft({ items, price: parts - 5 }), overrides);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.sum).toBeCloseTo(parts, 2);
    // and the guard is checked against that same sum, not the file's
    expect(validateBundle(draft({ items, price: parts }), overrides)).toMatchObject({ error: "price_too_high" });
  });

  it("takes a volume the owner added that the catalogue file does not have", () => {
    const overrides = { [SIZED.id]: { price: LONGER_LADDER[0].price, sizes: LONGER_LADDER } } as never;
    const items = [{ productId: SIZED.id, variant: LONGER_LADDER.length - 1 }, { productId: B.id }];
    // with no ladder saved the rung does not exist, and the set is refused
    expect(validateBundle(draft({ items, price: 50 }))).toMatchObject({ error: "bad_variant" });

    const check = validateBundle(draft({ items, price: 50 }), overrides);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.sum).toBeCloseTo(LONGER_LADDER[LONGER_LADDER.length - 1].price + B.p, 2);
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

  /* The seed and the generator's own output are the same eight sets, so they
     must carry the same eight prices. They did not: styling-duo was seeded at
     24,90 (33,90 in the file) and hair-young-again at 39,90 — 90 € of
     Kevin.Murphy — because 120_bundles.sql was written the day before the
     per-volume price fix of 09.09 and was never regenerated with it. */
  it("charges for every seeded set what src/data/bundles.json says it costs", async () => {
    const file = JSON.parse(
      readFileSync(new URL("../src/data/bundles.json", import.meta.url), "utf8"),
    ) as Array<{ id: string; price: number }>;
    const seeded = await listBundles();
    for (const b of file) {
      const row = seeded.find((s) => s.id === b.id);
      expect(row, `${b.id} is missing from the bundles table`).toBeTruthy();
      expect(row!.price, `${b.id} is priced differently in the table`).toBeCloseTo(b.price, 2);
    }
  });

  /* The live database was seeded before the fix and `on conflict do nothing`
     can never correct it, so 121 carries the repair — guarded on the wrong
     number, so a price Renat set himself is his. */
  it("121 repairs a live row still at the wrong price and leaves an edited one alone", async () => {
    const FIX = readFileSync(new URL("../db/migrations/121_bundles_seed_price_fix.sql", import.meta.url), "utf8");
    await query("update bundles set price = 39.90 where id = 'hair-young-again'");
    await query("update bundles set price = 29.00 where id = 'styling-duo'");
    await exec(FIX);
    expect((await getBundle("hair-young-again"))?.price).toBe(78.9);
    expect((await getBundle("styling-duo"))?.price).toBe(29);
    await query("update bundles set price = 33.90 where id = 'styling-duo'");
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

  /* «Товары → Размеры и цены» (product_overrides.sizes, migration 147) is the
     whole truth about a product's volumes everywhere else in the shop. A set
     holding that product has to price its part from the same ladder, or
     «столько они стоят по отдельности» quotes the customer a volume at a
     price this shop no longer charges for it. */
  it("prices a part from the size ladder the owner saved, not the generated file", async () => {
    await upsertBundle(
      valid({ items: [{ productId: SIZED.id, variant: 1 }, { productId: B.id }], price: 9.9 }),
    );
    try {
      await upsertOverride(SIZED.id, { sizes: OWN_LADDER });
      const set = (await getBundle("test-set"))!;
      const part = set.items[0];
      expect(part.productId).toBe(SIZED.id);
      expect(part.price).toBeCloseTo(OWN_LADDER[1].price, 2);
      expect(part.sizeLabel).toBe(OWN_LADDER[1].size);
      expect(set.sum).toBeCloseTo(OWN_LADDER[1].price + B.p, 2);
      // the set's own price is the owner's number and does not move
      expect(set.price).toBe(9.9);
      expect(set.save).toBeCloseTo(set.sum - 9.9, 2);
      expect(set.pct).toBe(Math.round((set.save / set.sum) * 100));
    } finally {
      await upsertOverride(SIZED.id, { sizes: null, price: null });
    }
  });

  /* A product with no ladder of its own keeps the older behaviour: the single
     price override moves every volume by the same premium. */
  it("keeps the plain price override for a product with no ladder saved", async () => {
    await upsertBundle(
      valid({ items: [{ productId: SIZED.id, variant: 1 }, { productId: B.id }], price: 9.9 }),
    );
    try {
      await upsertOverride(SIZED.id, { price: SIZED.p + 10 });
      const set = (await getBundle("test-set"))!;
      const part = set.items[0];
      expect(part.productId).toBe(SIZED.id);
      expect(part.price).toBeCloseTo(VARIANTS[SIZED.id].prices[1] + 10, 2);
    } finally {
      await upsertOverride(SIZED.id, { price: null });
    }
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

  /* «Показывать в магазине» off is not a shop-window decision like «скрыт»
     above — it takes the bottle off sale. A set holding it used to show it and
     sell it anyway, so the one product the owner had pulled went on leaving
     the shelf inside every set that carried it. */
  it("refuses a set whose part the owner took off sale, and says the set is out", async () => {
    await upsertBundle(valid({ price: 5 }));
    await upsertOverride(B.id, { hidden: true });
    try {
      expect((await getBundle("test-set"))!.stock).toBe("out");
      await expect(
        createOrder({ lang: "ru", items: [{ id: "bundle:test-set", qty: 1 }], customer, shipping: ship }),
      ).rejects.toMatchObject({ code: "out_of_stock" } as OrderError);
    } finally {
      await upsertOverride(B.id, { hidden: false });
    }
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

/**
 * A set is not a side door onto a volume that has been counted to zero
 * (audit 18.09.2026, F2).
 *
 * The 17.09.2026 decision is «show the product, hide the empty size», and the
 * checkout has enforced it on a plain line since: createOrder() asks
 * variantStockStates() for the size the line actually names and refuses it
 * («a 500 мл counted down to zero was sold and paid for whenever the 75 мл
 * still had bottles»). A set went in through a different door. Its parts were
 * gated on the PRODUCT's one word — which says «в наличии» while any one size
 * is left — so the very same bottle was sold, inside a set, for as long as
 * some other volume of it was on the shelf. The set line carries the part's
 * rung, so the paid decrement then landed on the empty row, was clamped at 0
 * and wrote a «sale» of nothing; the order was paid, and the bottle was found
 * missing when the set was packed.
 *
 * Both halves are pinned here: what the shop is allowed to SHOW (expand(), so
 * the set card and the admin say «нет в наличии»), and what the checkout is
 * allowed to TAKE MONEY FOR, which is the one that protects the order.
 */
describe("a set whose part's own volume has been counted to zero", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);

  /** The second rung of a multi-volume product — the set points at this one. */
  const RUNG_IDX = 1;
  const RUNG = VARIANTS[SIZED.id].sizes[RUNG_IDX];

  beforeEach(async () => {
    await dropTestSets();
    await query("delete from stock_moves");
    await query("delete from stock_levels");
  });

  /** Counted in, then sold out: tracked, and at zero — the state the rule is about. */
  async function emptyTheRung(): Promise<void> {
    const { move } = await import("@/lib/inventory");
    await move({ productId: SIZED.id, variant: RUNG, delta: 1, reason: "goods_in", actor: "test" });
    await move({ productId: SIZED.id, variant: RUNG, delta: -1, reason: "sale_web", actor: "test" });
  }

  async function seedSet(): Promise<void> {
    await upsertBundle(
      valid({ items: [{ productId: A.id }, { productId: SIZED.id, variant: RUNG_IDX }], price: 5 }),
    );
  }

  it("the product's own word is still «в наличии» — which is why the set word must not be", async () => {
    await seedSet();
    await emptyTheRung();
    // the whole premise: only THIS volume is gone, so the aggregate stays «in»
    const { variantStockStates, productStockStates } = await import("@/lib/inventory");
    expect((await variantStockStates([SIZED.id]))[SIZED.id]?.[RUNG]).toBe("out");
    expect((await productStockStates([SIZED.id]))[SIZED.id]).not.toBe("out");

    const set = (await getBundle("test-set"))!;
    const part = set.items[1];
    expect(part.productId).toBe(SIZED.id);
    expect(part.sizeLabel).toBe(RUNG);
    expect(part.stock).toBe("out");
    expect(set.stock).toBe("out");
  });

  it("is refused at the checkout, exactly as a plain line of that volume is", async () => {
    await seedSet();
    await emptyTheRung();
    // the rule the set has to obey too, on the line the shop already refuses
    await expect(
      createOrder({ lang: "ru", items: [{ id: SIZED.id, variant: RUNG, qty: 1 }], customer, shipping: ship }),
    ).rejects.toMatchObject({ code: "out_of_stock" } as OrderError);
    await expect(
      createOrder({ lang: "ru", items: [{ id: "bundle:test-set", qty: 1 }], customer, shipping: ship }),
    ).rejects.toMatchObject({ code: "out_of_stock" } as OrderError);
  });

  it("still sells the set while that volume is merely low, or never counted", async () => {
    await seedSet();
    const { move } = await import("@/lib/inventory");
    await move({ productId: SIZED.id, variant: RUNG, delta: 1, reason: "goods_in", actor: "test" });
    // counted, and one left: «мало» is not «нет»
    expect((await getBundle("test-set"))!.stock).not.toBe("out");
    const order = await createOrder({
      lang: "ru",
      items: [{ id: "bundle:test-set", qty: 1 }],
      customer,
      shipping: ship,
    });
    expect(order.items[0].parts?.find((p) => p.id === SIZED.id)?.variant).toBe(RUNG);

    // and a volume nobody has counted is not «нет» either — absent is not empty
    await query("delete from stock_moves");
    await query("delete from stock_levels");
    expect((await getBundle("test-set"))!.stock).not.toBe("out");
    await expect(
      createOrder({ lang: "ru", items: [{ id: "bundle:test-set", qty: 1 }], customer: { ...customer, email: "b@example.com" }, shipping: ship }),
    ).resolves.toBeTruthy();
  });

  it("gates the OTHER volumes of the same product as before", async () => {
    // the set points at rung 1; rung 0 at zero says nothing about it
    await seedSet();
    const { move } = await import("@/lib/inventory");
    const other = VARIANTS[SIZED.id].sizes[0];
    await move({ productId: SIZED.id, variant: other, delta: 1, reason: "goods_in", actor: "test" });
    await move({ productId: SIZED.id, variant: other, delta: -1, reason: "sale_web", actor: "test" });
    expect((await getBundle("test-set"))!.stock).not.toBe("out");
    await expect(
      createOrder({ lang: "ru", items: [{ id: "bundle:test-set", qty: 1 }], customer, shipping: ship }),
    ).resolves.toBeTruthy();
  });
});

/**
 * The browser half of the same promise.
 *
 * A product the owner takes off sale with «Показывать в магазине» is REMOVED
 * from the storefront's catalogue (rebuildCatalogue in public/shop2/app.js),
 * so a set holding it had no p.stock to read and fell back to the snapshot
 * /api/bundles/ sent at boot — which still said «in». The set went on
 * offering «В корзину» for a bottle that was no longer for sale, in the same
 * session the owner had just pulled it in. Sliced out of app.js by source
 * text, the way tests/checkout-parity.test.ts does it.
 */
describe("what the shop shows for a set whose part was taken off sale", () => {
  const app = readFileSync(new URL("../public/shop2/app.js", import.meta.url), "utf8");

  function slice(name: string): string {
    const start = app.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
    let depth = 0;
    for (let i = app.indexOf("{", start); i < app.length; i++) {
      if (app[i] === "{") depth++;
      else if (app[i] === "}" && --depth === 0) return app.slice(start, i + 1);
    }
    throw new Error(`unbalanced braces around ${name}() in app.js`);
  }

  /** bundleItemStock() over one part, with the catalogue and the switch stubbed. */
  function shown(part: { id: string; stock?: string }, hidden: string[], inCatalogue: boolean): string {
    const body = `
      function bundleItemProduct(it) { return IN_CATALOGUE ? { id: it.id, stock: "in" } : null; }
      function shopHidden(id) { return HIDDEN.indexOf(id) >= 0; }
      ${slice("bundleItemStock")}
      return bundleItemStock(PART);
    `;
    // app.js's own source plus fixed stub text — nothing is interpolated in.
    return (new Function("PART", "HIDDEN", "IN_CATALOGUE", body) as (
      p: unknown,
      h: string[],
      c: boolean,
    ) => string)(part, hidden, inCatalogue);
  }

  it("says «нет в наличии» for a part the switch was turned off for", () => {
    expect(shown({ id: "a", stock: "in" }, ["a"], false)).toBe("out");
  });

  it("still trusts the boot snapshot for a part the catalogue simply does not carry", () => {
    expect(shown({ id: "a", stock: "low" }, [], false)).toBe("low");
    expect(shown({ id: "a" }, [], false)).toBe("in");
  });

  it("reads the live catalogue first while the product is on sale", () => {
    expect(shown({ id: "a", stock: "out" }, [], true)).toBe("in");
  });
});
