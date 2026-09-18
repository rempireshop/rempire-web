import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variantData from "@/data/catalogue.variants.json";
import {
  byEan,
  deriveState,
  getLevel,
  getLevels,
  InventoryError,
  isTracked,
  listMoves,
  move,
  productStockStates,
  setLevel,
  setQty,
} from "@/lib/inventory";
import { createCustomProduct } from "@/lib/custom-products";
import { createOrder, getOverrides, setOrderStatus, upsertOverride } from "@/lib/orders";
import { applyPaymentResult, type ApplyDeps, type OrderLike } from "@/lib/payments/apply";
import { setupDb, teardownDb, truncateAll } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const VARIANTS = variantData as Record<string, { sizes: string[]; prices: number[] }>;

/* No size ladder — its shelf row is the unlabelled one — and something the
   shop will still sell: two of the tests below put it through createOrder(),
   which refuses an `s: "out"` product. Spelled out rather than left to the
   catalogue's order: the pick used to land on a «low» product by luck, and
   on 18.09.2026 the variants table gained the 29 one-size products and moved
   it onto a sold-out wax, where the failure read «out_of_stock» and said
   nothing about the fixture. */
const plain = CATALOGUE.find((p) => p.s !== "out" && !VARIANTS[p.id])!;
const sized = CATALOGUE.find((p) => VARIANTS[p.id] && VARIANTS[p.id].sizes.length > 1)!;

/* A set made of two real products — one with no volumes, one bought at its
   second volume, two of it — for the «a paid set moves its parts» tests.
   `bundles` is seeded by the migration and survives truncateAll(), so this
   one is written fresh by each test that needs it and never leaks a price. */
const SET_ID = "test-stock-set";
const setPartA = CATALOGUE.find((p) => p.s === "in" && !VARIANTS[p.id])!;
const setPartB = CATALOGUE.find((p) => p.s === "in" && (VARIANTS[p.id]?.sizes.length ?? 0) > 1)!;
const setPartBSize = VARIANTS[setPartB.id].sizes[1];
async function seedTestSet() {
  const { upsertBundle } = await import("@/lib/bundles");
  await upsertBundle({
    id: SET_ID,
    cat: "beard",
    title: { RU: "Тестовый набор", ET: "", EN: "" },
    desc: { RU: "", ET: "", EN: "" },
    items: [
      { productId: setPartA.id, variant: 0, qty: 1 },
      { productId: setPartB.id, variant: 1, qty: 2 },
    ],
    price: 5,
    discountPct: null,
    image: null,
    active: true,
    sort: 900,
  });
}

describe("inventory", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(truncateAll);

  describe("deriveState", () => {
    it("0 is always out, regardless of threshold", () => {
      expect(deriveState(0, 2)).toBe("out");
      expect(deriveState(0, 0)).toBe("out");
    });
    it("at or under the threshold, above 0, is low", () => {
      expect(deriveState(1, 2)).toBe("low");
      expect(deriveState(2, 2)).toBe("low");
    });
    it("above the threshold is in", () => {
      expect(deriveState(3, 2)).toBe("in");
    });
    it("a missing/invalid threshold falls back to 2", () => {
      expect(deriveState(2, NaN)).toBe("low");
      expect(deriveState(3, -1)).toBe("in");
    });
  });

  describe("move() — atomicity and the 0 floor", () => {
    it("creates a row on the first move and writes a ledger entry", async () => {
      const r = await move({ productId: plain.id, delta: 5, reason: "goods_in", actor: "test" });
      expect(r.qtyBefore).toBe(0);
      expect(r.qtyAfter).toBe(5);
      expect(r.appliedDelta).toBe(5);
      expect(r.clampedNegative).toBe(false);

      const level = await getLevel(plain.id, "");
      expect(level?.qty).toBe(5);

      const moves = await listMoves({ productId: plain.id });
      expect(moves).toHaveLength(1);
      expect(moves[0]).toMatchObject({ delta: 5, reason: "goods_in", productId: plain.id, actor: "test" });
    });

    it("accumulates across several moves", async () => {
      await move({ productId: plain.id, delta: 10, reason: "goods_in" });
      await move({ productId: plain.id, delta: -3, reason: "sale_web" });
      await move({ productId: plain.id, delta: -2, reason: "sale_pos" });
      const level = await getLevel(plain.id, "");
      expect(level?.qty).toBe(5);
      expect(await listMoves({ productId: plain.id })).toHaveLength(3);
    });

    it("never goes below 0 — a big enough sale clamps at the floor and says so", async () => {
      await move({ productId: plain.id, delta: 3, reason: "goods_in" });
      const r = await move({ productId: plain.id, delta: -10, reason: "sale_web" });
      expect(r.qtyBefore).toBe(3);
      expect(r.qtyAfter).toBe(0);
      expect(r.appliedDelta).toBe(-3);
      expect(r.clampedNegative).toBe(true);
      // the clamped amount is what actually got written to the ledger, not the
      // wish that would have gone negative
      const moves = await listMoves({ productId: plain.id });
      expect(moves[0].delta).toBe(-3);
    });

    it("is variant-aware — two sizes of the same product never share a row", async () => {
      const sizes = VARIANTS[sized.id].sizes;
      await move({ productId: sized.id, variant: sizes[0], delta: 5, reason: "goods_in" });
      await move({ productId: sized.id, variant: sizes[1], delta: 2, reason: "goods_in" });
      expect((await getLevel(sized.id, sizes[0]))?.qty).toBe(5);
      expect((await getLevel(sized.id, sizes[1]))?.qty).toBe(2);
    });

    it("rejects a zero delta, an unknown reason and a missing product id", async () => {
      await expect(move({ productId: plain.id, delta: 0, reason: "adjust" })).rejects.toBeInstanceOf(InventoryError);
      await expect(
        move({ productId: plain.id, delta: 1, reason: "made_up" as never }),
      ).rejects.toBeInstanceOf(InventoryError);
      await expect(move({ productId: "", delta: 1, reason: "adjust" })).rejects.toBeInstanceOf(InventoryError);
    });
  });

  describe("setQty() — the absolute set", () => {
    it("computes the delta from the current qty and writes one move", async () => {
      await move({ productId: plain.id, delta: 4, reason: "goods_in" });
      const r = await setQty(plain.id, "", 10);
      expect(r.qtyBefore).toBe(4);
      expect(r.qtyAfter).toBe(10);
      expect(r.appliedDelta).toBe(6);
      const moves = await listMoves({ productId: plain.id, reason: "adjust" });
      expect(moves).toHaveLength(1);
    });

    it("refuses a negative target", async () => {
      await expect(setQty(plain.id, "", -1)).rejects.toBeInstanceOf(InventoryError);
    });

    /* «Шкаф пустой» is a count like any other, and it is the one the shop most
       needs to hear: until the size is tracked the badge keeps coming from the
       manual override, so an empty shelf goes on being advertised. Setting it
       to 0 has to TRACK it, not be treated as «nothing happened». */
    it("a first count of zero tracks the size and takes it out of stock", async () => {
      expect(await isTracked(plain.id, "")).toBe(false);
      const r = await setQty(plain.id, "", 0);
      expect(r.qtyAfter).toBe(0);
      expect(await isTracked(plain.id, "")).toBe(true);
      expect((await productStockStates([plain.id]))[plain.id]).toBe("out");
    });
  });

  describe("byEan", () => {
    it("finds a level by its EAN and carries the catalogue product with it", async () => {
      await setLevel(plain.id, "", { ean: "4006381333931" });
      const hit = await byEan("4006381333931");
      expect(hit?.productId).toBe(plain.id);
      expect(hit?.product?.id).toBe(plain.id);
      expect(hit?.product?.brand).toBe(plain.b);
    });

    /* Binding a barcode makes a row at qty 0 with no ledger line at all
       (setLevel never touches qty), so «qty» alone cannot tell «шкаф пустой»
       from «ещё ни разу не считали». The scanner card has to be told which
       one it is looking at, or a full cupboard reads as «на складе 0». */
    it("says whether the size has ever actually been counted", async () => {
      await setLevel(plain.id, "", { ean: "4006381333931" });
      expect((await byEan("4006381333931"))?.tracked).toBe(false);
      await move({ productId: plain.id, delta: 6, reason: "goods_in" });
      expect((await byEan("4006381333931"))?.tracked).toBe(true);
    });

    it("is null for an unknown code", async () => {
      expect(await byEan("0000000000000")).toBeNull();
    });

    it("ignores whitespace around a scanned code", async () => {
      await setLevel(plain.id, "", { ean: "12345678" });
      expect((await byEan(" 12345678 "))?.productId).toBe(plain.id);
    });

    /* The owner's own products are rows in custom_products, never entries in
       the catalogue FILE that BY_ID is built from — so a code bound to one of
       them came back with `product: null`, and the scanner reads that as «Код
       не привязан». On «Салон» that is worse than a wrong label: scanToCart()
       (public/shop2/app.js) needs a product and silently does nothing without
       one, which is «I had a product with scanned code, then I went to salon
       -> scan, scanned the same product and it did not find it» (Renat,
       acceptance run 13.09.2026). */
    it("names the owner's OWN product behind a code, not just the catalogue's", async () => {
      const own = await createCustomProduct({ brand: "Kevin.Murphy", name: "Beard balm", cat: "beard", price: 24 });
      await setLevel(own.id, "", { ean: "4820000000017" });
      const hit = await byEan("4820000000017");
      expect(hit?.productId).toBe(own.id);
      expect(hit?.product).toMatchObject({ id: own.id, brand: "Kevin.Murphy", name: "Beard balm", price: 24 });
    });

    it("the history names the owner's own product too, instead of printing its id", async () => {
      const own = await createCustomProduct({ brand: "Kevin.Murphy", name: "Beard balm", cat: "beard", price: 24 });
      await move({ productId: own.id, delta: 5, reason: "goods_in", actor: "test" });
      const moves = await listMoves({ productId: own.id });
      expect(moves[0]).toMatchObject({ brand: "Kevin.Murphy", name: "Beard balm" });
    });
  });

  describe("setLevel — EAN and threshold, never qty", () => {
    it("creates a row without touching qty, then only patches what is given", async () => {
      const a = await setLevel(plain.id, "", { ean: "11112222" });
      expect(a.qty).toBe(0);
      expect(a.ean).toBe("11112222");
      expect(a.lowThreshold).toBe(2); // the column default, untouched

      const b = await setLevel(plain.id, "", { lowThreshold: 5 });
      expect(b.ean).toBe("11112222"); // untouched by a patch that didn't mention it
      expect(b.lowThreshold).toBe(5);
    });

    it("clears the EAN with null", async () => {
      await setLevel(plain.id, "", { ean: "33334444" });
      const cleared = await setLevel(plain.id, "", { ean: null });
      expect(cleared.ean).toBeNull();
    });

    it("refuses to hand the same EAN to two different products", async () => {
      await setLevel(plain.id, "", { ean: "55556666" });
      const other = CATALOGUE.find((p) => p.id !== plain.id)!;
      await expect(setLevel(other.id, "", { ean: "55556666" })).rejects.toMatchObject({ code: "ean_taken" });
    });

    it("rejects a garbage EAN", async () => {
      await expect(setLevel(plain.id, "", { ean: "x" })).rejects.toBeInstanceOf(InventoryError);
    });

    /* The number the product editor now says out loud. Its «Размеры и цены»
       grid used to redden a remainder at a flat «3 или меньше» in the code
       and in words, while «Склад» next door filtered on the row's own
       threshold — one warehouse, two ideas of «мало». Dim settled it: the
       per-row threshold, default 2. That default lives in this column, so it
       is worth one test that says the whole sentence rather than only the
       number (`db/migrations/090_inventory.sql`, `deriveState` above). */
    it("a size nobody has set a threshold on warns at 2, so 3 is «in» and 2 is «low»", async () => {
      const row = await setLevel(plain.id, "", { ean: "77778888" });
      expect(row.lowThreshold).toBe(2);
      expect(deriveState(3, row.lowThreshold)).toBe("in");
      expect(deriveState(2, row.lowThreshold)).toBe("low");
    });

    /* «Причина (видна в истории)» is what the box under it promises, and a
       card change used to write no ledger row at all — so the sentence typed
       beside a corrected «мало» threshold was read, sent nowhere and lost
       under a «Сохранено ✓»: «Reason is not stored» (Renat). Migration 092
       gave it a line of its own. */
    it("keeps the reason typed beside a threshold change, as an 'edit' line", async () => {
      await setLevel(plain.id, "", { lowThreshold: 6 }, { note: "порог поднял, зима", actor: "admin" });
      const moves = await listMoves({ productId: plain.id });
      expect(moves).toHaveLength(1);
      expect(moves[0]).toMatchObject({ reason: "edit", delta: 0, ref: "порог поднял, зима", actor: "admin" });
      expect((await getLevel(plain.id, ""))?.lowThreshold).toBe(6);
    });

    it("writes nothing when no reason was typed — seeding hundreds of barcodes is not a history", async () => {
      await setLevel(plain.id, "", { ean: "12341234" });
      expect(await listMoves({ productId: plain.id })).toHaveLength(0);
    });

    it("…and nothing when a reason is given but the patch changes nothing", async () => {
      await setLevel(plain.id, "", {}, { note: "передумал" });
      expect(await listMoves({ productId: plain.id })).toHaveLength(0);
    });

    /* The load-bearing half. An 'edit' row must never count as "somebody has
       counted this shelf": binding a barcode is not a stocktake, and a
       variant turned tracked at 0 by it would tell the shop «нет в наличии»
       about a product the owner has a box of — the same trap the module doc
       explains for a sale. */
    it("an 'edit' line never makes a variant tracked", async () => {
      await setLevel(plain.id, "", { ean: "43214321", lowThreshold: 4 }, { note: "наклеил свой код" });
      expect(await isTracked(plain.id, "")).toBe(false);
      expect((await productStockStates([plain.id]))[plain.id]).toBeUndefined();
      const row = (await getLevels({ q: plain.b })).find((r) => r.productId === plain.id && r.variant === "");
      expect(row?.tracked).toBe(false);
    });

    it("the ledger's own filter can ask for card changes alone", async () => {
      await move({ productId: plain.id, delta: 3, reason: "goods_in" });
      await setLevel(plain.id, "", { lowThreshold: 9 }, { note: "зима" });
      expect(await listMoves({ productId: plain.id, reason: "edit" })).toHaveLength(1);
      expect(await listMoves({ productId: plain.id, reason: "goods_in" })).toHaveLength(1);
      expect(await listMoves({ productId: plain.id })).toHaveLength(2);
    });
  });

  describe("productStockStates — the /api/overrides merge", () => {
    it("a product with no move at all is absent from the map (manual override stays in charge)", async () => {
      await setLevel(plain.id, "", { ean: "99998888" }); // seeded, never moved
      const states = await productStockStates([plain.id]);
      expect(states[plain.id]).toBeUndefined();
    });

    it("becomes tracked the moment it has moved, and reads qty honestly", async () => {
      await move({ productId: plain.id, delta: 1, reason: "goods_in" });
      expect((await productStockStates([plain.id]))[plain.id]).toBe("low"); // default threshold 2, qty 1
      await move({ productId: plain.id, delta: 5, reason: "goods_in" });
      expect((await productStockStates([plain.id]))[plain.id]).toBe("in");
      await move({ productId: plain.id, delta: -6, reason: "sale_web" });
      expect((await productStockStates([plain.id]))[plain.id]).toBe("out");
    });

    it("aggregates variants: out only when every size on the LADDER is counted and out", async () => {
      const sizes = VARIANTS[sized.id].sizes;
      await move({ productId: sized.id, variant: sizes[0], delta: 3, reason: "goods_in" });
      await move({ productId: sized.id, variant: sizes[1], delta: 0 === 0 ? 1 : 0, reason: "goods_in" });
      // size 0 has 3 (in), size 1 has 1 (low) — the product overall reads low
      expect((await productStockStates([sized.id]))[sized.id]).toBe("low");
      await move({ productId: sized.id, variant: sizes[0], delta: -3, reason: "sale_web" });
      // size 0 now out, size 1 still low(1) — still sellable overall
      expect((await productStockStates([sized.id]))[sized.id]).toBe("low");
      await move({ productId: sized.id, variant: sizes[1], delta: -1, reason: "sale_web" });
      /* Two of this product's three volumes are at zero now and nobody has
         ever counted the third — not enough to tell the shop the product is
         gone, so it has no word here and keeps the manual one. Counting one
         size of a ladder to zero used to refuse the whole product at every
         size, the full ones included (tests/stock-ladder-partial.test.ts). */
      expect((await productStockStates([sized.id]))[sized.id]).toBeUndefined();
      for (const size of sizes.slice(2)) {
        await move({ productId: sized.id, variant: size, delta: 1, reason: "goods_in" });
        await move({ productId: sized.id, variant: size, delta: -1, reason: "sale_web" });
      }
      // …and with the whole ladder counted and empty, it really is out
      expect((await productStockStates([sized.id]))[sized.id]).toBe("out");
    });
  });

  describe("getOverrides() — numeric stock wins over the manual override once tracked", () => {
    it("falls back to the manual override for an untouched product", async () => {
      await upsertOverride(plain.id, { stock: "low" });
      const ov = await getOverrides([plain.id]);
      expect(ov[plain.id]?.stock).toBe("low");
    });

    it("a tracked product's derived state overrides the manual value", async () => {
      await upsertOverride(plain.id, { stock: "low" }); // the owner's old manual guess
      await move({ productId: plain.id, delta: 8, reason: "goods_in" }); // now really counted
      const ov = await getOverrides([plain.id]);
      expect(ov[plain.id]?.stock).toBe("in");
    });

    it("adds an entry even for a product with no override row at all, once tracked", async () => {
      await move({ productId: plain.id, delta: 0 - 0, reason: "adjust" }).catch(() => {});
      await move({ productId: plain.id, delta: 1, reason: "goods_in" });
      const ov = await getOverrides([plain.id]);
      expect(ov[plain.id]?.stock).toBe("low");
      expect(ov[plain.id]?.price).toBeNull();
    });

    /* «Снять с продажи» — the editor's «Наличие» select and the destructive
       slot of the product card — writes exactly this override and nothing
       else. The count used to overwrite it, so the panel toasted «Снято с
       продажи ✓» and the shop went on selling the product: the badge came
       back on the very next feed. A count may say a product is gone; it may
       not say it is on sale again. */
    it("a manual «нет в наличии» beats the count — it is a decision, not a guess at a number", async () => {
      await move({ productId: plain.id, delta: 8, reason: "goods_in" }); // counted, plenty on the shelf
      await upsertOverride(plain.id, { stock: "out" }); // …and pulled from sale anyway
      expect((await getOverrides([plain.id]))[plain.id]?.stock).toBe("out");
    });

    it("and the till refuses it while it is pulled", async () => {
      await move({ productId: plain.id, delta: 8, reason: "goods_in" });
      await upsertOverride(plain.id, { stock: "out" });
      await expect(
        createOrder({
          items: [{ id: plain.id, qty: 1 }],
          customer: { name: "Т", email: "pulled@example.com", phone: "+372 5555 5555" },
          shipping: { method: "pickup", country: "EE" },
        }),
      ).rejects.toMatchObject({ code: "out_of_stock" });
    });

    it("«в наличии» and «мало» still defer to the count, which knows better", async () => {
      await upsertOverride(plain.id, { stock: "in" });
      await move({ productId: plain.id, delta: 1, reason: "goods_in" }); // one left
      expect((await getOverrides([plain.id]))[plain.id]?.stock).toBe("low");
    });
  });

  /* The product's one word says «in» while ANY size is left — right for a
     card, and until 14.09.2026 the only thing createOrder() looked at. A
     sold-out 500 ml on a product whose 75 ml was on the shelf went into the
     basket, through the checkout and onto a paid order, and the owner was
     left to explain it. The order gate reads the ordered size's own state. */
  describe("a sold-out SIZE is refused even while the product reads in stock", () => {
    const buyer = { name: "Т", email: "t@example.com", phone: "+372 5555 5555" } as const;
    const ship = { method: "pickup", country: "EE" } as const;

    /** First size counted and on the shelf, second size counted and sold out. */
    async function shelf() {
      const [first, second] = VARIANTS[sized.id].sizes;
      await move({ productId: sized.id, variant: first, delta: 5, reason: "goods_in" });
      await move({ productId: sized.id, variant: second, delta: 1, reason: "goods_in" });
      await move({ productId: sized.id, variant: second, delta: -1, reason: "sale_web" });
      return { first, second };
    }

    it("ships the per-size states on the feed while the product's word stays «in»", async () => {
      const { first, second } = await shelf();
      const ov = (await getOverrides([sized.id]))[sized.id];
      // the trap in one line: the word a card shows says the product is sellable
      expect(ov?.stock).toBe("in");
      expect(ov?.stockByVariant?.[first]).toBe("in");
      expect(ov?.stockByVariant?.[second]).toBe("out");
    });

    it("refuses an order for the size that is out", async () => {
      const { second } = await shelf();
      await expect(
        createOrder({ items: [{ id: sized.id, variant: second, qty: 1 }], customer: buyer, shipping: ship as never }),
      ).rejects.toMatchObject({ code: "out_of_stock" });
    });

    it("…and still sells the size that is on the shelf", async () => {
      const { first } = await shelf();
      const order = await createOrder({
        items: [{ id: sized.id, variant: first, qty: 1 }],
        customer: buyer,
        shipping: ship as never,
      });
      expect(order.items[0].variant).toBe(first);
    });

    it("leaves a product nobody has counted to its manual word, as before", async () => {
      const [, second] = VARIANTS[sized.id].sizes;
      await upsertOverride(sized.id, { stock: "in" });
      const ov = (await getOverrides([sized.id]))[sized.id];
      expect(ov?.stockByVariant ?? null).toBeNull();
      const order = await createOrder({
        items: [{ id: sized.id, variant: second, qty: 1 }],
        customer: buyer,
        shipping: ship as never,
      });
      expect(order.items[0].variant).toBe(second);
    });
  });

  describe("getLevels() — the admin table's full catalogue×variant universe", () => {
    it("includes an untracked variant at qty 0, not just rows that exist in the database", async () => {
      const rows = await getLevels({ q: plain.b });
      const row = rows.find((r) => r.productId === plain.id && r.variant === "");
      expect(row).toBeTruthy();
      expect(row?.tracked).toBe(false);
      expect(row?.qty).toBe(0);
    });

    /* Twenty-nine products are sold in exactly ONE named volume — Touchable is
       «250 мл», and its product page has always printed it. Until 18.09.2026
       tools/build-catalogue-variants.mjs dropped every ladder shorter than two
       rungs, so catalogueUniverse() gave each of them an unlabelled «один
       объём» row while the panel bound barcodes and wrote counts under the
       label. Both rows were drawn — the empty one from the universe, the real
       one from the orphan rescue below — which is where 351 rows for 322
       barcodes came from. One product, one volume, one row. */
    it("gives a product sold in one named volume that volume's row, and only it", async () => {
      const single = CATALOGUE.find((p) => VARIANTS[p.id]?.sizes.length === 1)!;
      expect(single, "no one-volume product in the catalogue — the check would be vacuous").toBeTruthy();
      const label = VARIANTS[single.id].sizes[0];

      /* Written the way the panel writes it: against the label the browser's
         catalogue shows, which is the whole point of the pair agreeing. */
      await move({ productId: single.id, variant: label, delta: 3, reason: "goods_in" });

      const mine = (await getLevels({ q: single.id })).filter((r) => r.productId === single.id);
      expect(mine.map((r) => r.variant)).toEqual([label]);
      expect(mine[0].qty).toBe(3);
      expect(mine[0].tracked).toBe(true);
    });

    it("filters to low/out/untracked", async () => {
      await move({ productId: plain.id, delta: 1, reason: "goods_in" }); // low
      const low = await getLevels({ filter: "low" });
      expect(low.some((r) => r.productId === plain.id)).toBe(true);
      expect(low.every((r) => r.state === "low")).toBe(true);

      const untracked = await getLevels({ filter: "untracked" });
      expect(untracked.some((r) => r.productId === plain.id)).toBe(false); // it just became tracked
      expect(untracked.length).toBeGreaterThan(0);
    });

    /* «Склад» built its universe from the generated catalogue file alone, so
       a volume the owner ADDED in the product editor had no row to count —
       and a volume he RENAMED left its old row behind, invisible here and
       still counted by productStockStates(). The editor, the cart and the
       till all read product_overrides.sizes first; the shelf has to too. */
    it("counts a volume the owner added in the editor, which the catalogue file has never heard of", async () => {
      expect(VARIANTS[plain.id]).toBeUndefined();
      await upsertOverride(plain.id, { sizes: [{ size: "100 мл", price: 12 }, { size: "250 мл", price: 20 }] });
      const rows = await getLevels({ q: plain.b });
      const mine = rows.filter((r) => r.productId === plain.id).map((r) => r.variant).sort();
      expect(mine).toEqual(["100 мл", "250 мл"]);
    });

    it("shows the leftover row of a renamed volume, so it can be found and written off", async () => {
      await upsertOverride(plain.id, { sizes: [{ size: "100 мл", price: 12 }] });
      await move({ productId: plain.id, variant: "100 мл", delta: 5, reason: "goods_in" });
      await upsertOverride(plain.id, { sizes: [{ size: "150 мл", price: 12 }] }); // renamed in the editor

      // the orphan is still what holds the product at «в наличии»…
      expect((await productStockStates([plain.id]))[plain.id]).toBe("in");
      // …so «Склад» has to show it: it is the only screen that can zero it
      const rows = await getLevels({ q: plain.b });
      const orphan = rows.find((r) => r.productId === plain.id && r.variant === "100 мл");
      expect(orphan?.qty).toBe(5);
      expect(orphan?.tracked).toBe(true);
      expect(rows.some((r) => r.productId === plain.id && r.variant === "150 мл")).toBe(true);
    });
  });

  describe("setOrderStatus — a refund/cancel after paid returns stock", () => {
    async function payOrder() {
      const order = await createOrder({
        items: [{ id: plain.id, qty: 3 }],
        customer: { name: "Т", email: "t@example.com", phone: "+372 5555 5555" },
        shipping: { method: "pickup", country: "EE" },
      });
      await setOrderStatus(order.id, "paid", "test");
      return order;
    }

    it("refunded after paid puts the quantity back with a 'return' move", async () => {
      await move({ productId: plain.id, delta: 10, reason: "goods_in", actor: "test" });   // counted
      const order = await payOrder();
      await setOrderStatus(order.id, "refunded", "test");
      const level = await getLevel(plain.id, "");
      expect(level?.qty).toBe(13);
      const moves = await listMoves({ productId: plain.id, reason: "return" });
      expect(moves).toHaveLength(1);
      expect(moves[0].ref).toBe(order.number);
    });

    it("cancelled after paid also returns stock", async () => {
      await move({ productId: plain.id, delta: 10, reason: "goods_in", actor: "test" });
      const order = await payOrder();
      await setOrderStatus(order.id, "cancelled", "test");
      expect((await getLevel(plain.id, ""))?.qty).toBe(13);
    });

    /* …and the way back. «Отменён» pressed by mistake and put right again
       returned the goods and never took them off the shelf a second time —
       the only decrement lives in the payment transition and had already
       run. Every cancel/uncancel cycle therefore inflated the shelf by the
       order's quantities, and «Склад» ended up saying «в наличии» about
       bottles that had been shipped. */
    it("putting a cancelled order back on sale takes the goods off the shelf again", async () => {
      await move({ productId: plain.id, delta: 10, reason: "goods_in", actor: "test" });
      const order = await payOrder();
      await setOrderStatus(order.id, "cancelled", "test");
      expect((await getLevel(plain.id, ""))?.qty).toBe(13);

      await setOrderStatus(order.id, "paid", "test");
      expect((await getLevel(plain.id, ""))?.qty).toBe(10);

      // …however many times the owner changes his mind
      await setOrderStatus(order.id, "cancelled", "test");
      await setOrderStatus(order.id, "shipped", "test");
      expect((await getLevel(plain.id, ""))?.qty).toBe(10);
    });

    /* The guard on that mirror: an order cancelled BEFORE it was ever paid
       returned nothing, and it is exactly the one that can still be paid from
       a stale tab — applyPaymentResult() moves it to paid and decrements it
       itself, so a decrement here as well would take the quantity off twice. */
    it("an order cancelled before it was ever paid is decremented once, by the payment", async () => {
      await move({ productId: plain.id, delta: 10, reason: "goods_in", actor: "test" });
      const order = await createOrder({
        items: [{ id: plain.id, qty: 3 }],
        customer: { name: "Т", email: "stale@example.com", phone: "+372 5555 5555" },
        shipping: { method: "pickup", country: "EE" },
      });
      await setOrderStatus(order.id, "cancelled", "test");
      expect((await getLevel(plain.id, ""))?.qty).toBe(10); // nothing returned — nothing was taken
      await setOrderStatus(order.id, "paid", "test");
      expect((await getLevel(plain.id, ""))?.qty).toBe(10); // and nothing taken here either
    });

    /* The sale of an uncounted variant is skipped (move() — "tracked"), so its
       return has to be skipped too: a +1 'return' on a shelf nobody has
       counted made the variant tracked at 1, and the shop started saying
       «мало» — then «нет в наличии» after the next sale — about a product the
       owner has a box of. Symmetric with the sale: nothing was taken, nothing
       comes back, and the variant stays uncounted. */
    it("refunding or cancelling an order of an UNCOUNTED variant returns nothing and leaves it uncounted", async () => {
      for (const away of ["refunded", "cancelled"] as const) {
        const order = await payOrder();
        await setOrderStatus(order.id, away, "test");
        expect(await getLevel(plain.id, ""), `«${away}» wrote a shelf row for an uncounted variant`).toBeNull();
        expect(await listMoves({ productId: plain.id, reason: "return" })).toHaveLength(0);
        const untracked = await getLevels({ filter: "untracked" });
        expect(untracked.some((r) => r.productId === plain.id)).toBe(true);
      }
    });

    /* The undo of «Отменить заказ» (the card's «Изменить статус вручную →
       оплачен» on an order whose money is already in) is a bare status write,
       so until 14.09.2026 the +3 'return' the cancellation wrote had no
       inverse anywhere: every cancel/undo cycle handed the shelf the whole
       order again, and after two of them the shop thought it had six bottles
       it did not have. */
    it("the undo of a cancellation takes the returned stock off the shelf again", async () => {
      await move({ productId: plain.id, delta: 10, reason: "goods_in", actor: "test" });
      const order = await payOrder();
      await setOrderStatus(order.id, "cancelled", "test");
      expect((await getLevel(plain.id, ""))?.qty).toBe(13);

      await setOrderStatus(order.id, "paid", "admin");
      expect((await getLevel(plain.id, ""))?.qty).toBe(10);

      // …and a second cycle is not a second gift either
      await setOrderStatus(order.id, "cancelled", "test");
      await setOrderStatus(order.id, "paid", "admin");
      expect((await getLevel(plain.id, ""))?.qty).toBe(10);
    });

    it("the undo of a refund takes it back too", async () => {
      await move({ productId: plain.id, delta: 10, reason: "goods_in", actor: "test" });
      const order = await payOrder();
      await setOrderStatus(order.id, "refunded", "test");
      expect((await getLevel(plain.id, ""))?.qty).toBe(13);
      await setOrderStatus(order.id, "paid", "admin");
      expect((await getLevel(plain.id, ""))?.qty).toBe(10);
    });

    /* The other half of the same rule: an order that never took stock has
       nothing to take again. A cancelled invoice the company pays afterwards
       is settled through applyPaymentResult(), which does its own decrement —
       a second one here would sell the shelf twice on one order. */
    it("marking a cancelled order that never paid takes the stock exactly once", async () => {
      await move({ productId: plain.id, delta: 10, reason: "goods_in", actor: "test" });
      const order = await createOrder({
        items: [{ id: plain.id, qty: 3 }],
        customer: { name: "Т", email: "t3@example.com", phone: "+372 5555 5555" },
        shipping: { method: "pickup", country: "EE" },
      });
      await setOrderStatus(order.id, "cancelled", "test");
      expect((await getLevel(plain.id, ""))?.qty).toBe(10);

      const { setOrderPayment, setOrderStatus: realSetStatus } = await import("@/lib/orders");
      await applyPaymentResult(
        { ...order, status: "cancelled" } as unknown as OrderLike,
        { orderRef: order.number, status: "paid", providerRef: "manual", amount: Number(order.total), currency: "EUR" },
        "manual",
        { setOrderPayment, setOrderStatus: realSetStatus },
      );
      expect((await getLevel(plain.id, ""))?.qty).toBe(7);
      expect(await listMoves({ productId: plain.id, reason: "sale_web" })).toHaveLength(1);
    });

    /* A set's parts left the shop when it was paid, so a refund brings the
       same parts back — and only the ones the sale actually took. */
    it("refunding an order with a set in it returns each of its parts", async () => {
      await seedTestSet();
      await move({ productId: setPartA.id, delta: 10, reason: "goods_in" });
      await move({ productId: setPartB.id, variant: setPartBSize, delta: 10, reason: "goods_in" });
      const order = await createOrder({
        items: [{ id: `bundle:${SET_ID}`, qty: 2 }],
        customer: { name: "Т", email: "set@example.com", phone: "+372 5555 5555" },
        shipping: { method: "pickup", country: "EE" },
      });
      await setOrderStatus(order.id, "paid", "test");
      await setOrderStatus(order.id, "refunded", "test");
      expect((await getLevel(setPartA.id, ""))?.qty).toBe(12); // 10 + 1×2
      expect((await getLevel(setPartB.id, setPartBSize))?.qty).toBe(14); // 10 + 2×2
    });

    it("cancelling a NEW order (never paid) returns nothing — it never took stock", async () => {
      const order = await createOrder({
        items: [{ id: plain.id, qty: 2 }],
        customer: { name: "Т", email: "t2@example.com", phone: "+372 5555 5555" },
        shipping: { method: "pickup", country: "EE" },
      });
      await setOrderStatus(order.id, "cancelled", "test");
      expect(await getLevel(plain.id, "")).toBeNull();
    });
  });

  /* The checkout asked productStockStates(), which aggregates a product's
     sizes as «out only if EVERY tracked size is out» — the right answer for a
     badge and the wrong one for a till. A 500 мл counted down to zero went on
     being sold and paid for as long as the 75 мл still had bottles, and the
     sale move was then clamped to 0 with only a console line to record it. */
  describe("priceItems — the shelf is checked per SIZE, not per product", () => {
    const sizedIn = CATALOGUE.find((p) => p.s === "in" && VARIANTS[p.id] && VARIANTS[p.id].sizes.length > 1)!;

    function order(variant: string, email: string) {
      return {
        items: [{ id: sizedIn.id, variant, qty: 1 }],
        customer: { name: "Т", email, phone: "+372 5555 5555" },
        shipping: { method: "pickup", country: "EE" },
      } as Parameters<typeof createOrder>[0];
    }

    it("refuses the size that is at zero and sells the one that is not", async () => {
      const sizes = VARIANTS[sizedIn.id].sizes;
      await move({ productId: sizedIn.id, variant: sizes[0], delta: 5, reason: "goods_in" });
      await move({ productId: sizedIn.id, variant: sizes[1], delta: 2, reason: "goods_in" });
      await move({ productId: sizedIn.id, variant: sizes[1], delta: -2, reason: "sale_web" });

      // the product as a whole is still «в наличии» — the first size has five
      expect((await productStockStates([sizedIn.id]))[sizedIn.id]).toBe("in");

      await expect(createOrder(order(sizes[1], "zero@example.com"))).rejects.toMatchObject({
        code: "out_of_stock",
      });
      const ok = await createOrder(order(sizes[0], "five@example.com"));
      expect(ok.items[0].variant).toBe(sizes[0]);
    });

    it("leaves a size nobody has counted alone", async () => {
      const sizes = VARIANTS[sizedIn.id].sizes;
      await move({ productId: sizedIn.id, variant: sizes[0], delta: 5, reason: "goods_in" });
      const ok = await createOrder(order(sizes[1], "uncounted@example.com"));
      expect(ok.items[0].variant).toBe(sizes[1]);
    });

    /* …but never at the register. «Продажа в салоне» is the owner with the
       bottle already in his hand: his count is what lags, not the shelf, and
       a refusal there is a sale that cannot be rung up at all. The clamp at 0
       inside move() is what keeps the ledger honest for that one. */
    it("still rings up that size in the salon, where somebody can see the shelf", async () => {
      const sizes = VARIANTS[sizedIn.id].sizes;
      await move({ productId: sizedIn.id, variant: sizes[0], delta: 5, reason: "goods_in" });
      await move({ productId: sizedIn.id, variant: sizes[1], delta: 2, reason: "goods_in" });
      await move({ productId: sizedIn.id, variant: sizes[1], delta: -2, reason: "sale_web" });
      const till = await createOrder({
        ...order(sizes[1], "till@example.com"),
        channel: "pos",
      } as Parameters<typeof createOrder>[0]);
      expect(till.items[0].variant).toBe(sizes[1]);
    });
  });

  describe("applyPaymentResult — the real (non-injected) paid-transition decrement", () => {
    function deps(): ApplyDeps {
      return {
        setOrderPayment: async () => ({}),
        setOrderStatus: async () => ({}),
      };
    }

    it("decrements stock through @/lib/inventory when no decrementStock dep is injected", async () => {
      await move({ productId: plain.id, delta: 10, reason: "goods_in" });
      const order: OrderLike = {
        id: "3f7c0d3e-1111-4444-8888-aaaaaaaaaaaa",
        number: "R-900001",
        status: "new",
        total: 99,
        items: [{ id: plain.id, kind: "product", variant: null, qty: 4 }],
      };
      const out = await applyPaymentResult(
        order,
        { orderRef: order.number, status: "paid", providerRef: "x", amount: 99, currency: "EUR" },
        "mock",
        deps(),
      );
      expect(out.status).toBe("paid");
      expect((await getLevel(plain.id, ""))?.qty).toBe(6);
      const moves = await listMoves({ productId: plain.id, reason: "sale_web" });
      expect(moves).toHaveLength(1);
      expect(moves[0].delta).toBe(-4);
    });

    /* A set is real goods leaving the room: three bottles off the shelf, not
       one line the decrement skips because «bundle:<id>» is not a catalogue
       id. The parts ride on the order line (priceItems), so what is written
       off is what was sold, whatever the set holds by now. */
    it("takes a paid set's parts off the shelf, each at its own size and quantity", async () => {
      await seedTestSet();
      await move({ productId: setPartA.id, delta: 10, reason: "goods_in" });
      await move({ productId: setPartB.id, variant: setPartBSize, delta: 10, reason: "goods_in" });
      const order = await createOrder({
        items: [{ id: `bundle:${SET_ID}`, qty: 2 }],
        customer: { name: "Т", email: "set@example.com", phone: "+372 5555 5555" },
        shipping: { method: "pickup", country: "EE" },
      });
      await applyPaymentResult(
        { id: order.id, number: order.number, status: "new", total: order.total, items: order.items },
        { orderRef: order.number, status: "paid", providerRef: "x", amount: Number(order.total), currency: "EUR" },
        "mock",
        deps(),
      );
      expect((await getLevel(setPartA.id, ""))?.qty).toBe(8); // 10 − 1×2
      expect((await getLevel(setPartB.id, setPartBSize))?.qty).toBe(6); // 10 − 2×2
      const moves = await listMoves({ productId: setPartB.id, reason: "sale_web" });
      expect(moves).toHaveLength(1);
      expect(moves[0].delta).toBe(-4);
      expect(moves[0].ref).toBe(order.number);
    });

    /* A gift card is not goods, and a set line from before the parts were
       recorded on it has nothing to resolve — both move nothing rather than
       trying to write off a product id that does not exist. */
    it("skips a gift line, and a set line that carries no parts", async () => {
      const order: OrderLike = {
        id: "3f7c0d3e-2222-4444-8888-aaaaaaaaaaaa",
        number: "R-900002",
        status: "new",
        total: 50,
        items: [
          { id: "gift:50", kind: "gift", variant: null, qty: 1 },
          { id: "bundle:beard-kit", kind: "bundle", variant: null, qty: 1 },
        ],
      };
      await expect(
        applyPaymentResult(
          order,
          { orderRef: order.number, status: "paid", providerRef: "x", amount: 50, currency: "EUR" },
          "mock",
          deps(),
        ),
      ).resolves.toMatchObject({ status: "paid" });
      // nothing to assert on stock — the point is that it did not throw trying
      // to move a fake "gift:50"/"bundle:beard-kit" product id
      expect(await getLevel("gift:50", "")).toBeNull();
      expect(await getLevel("bundle:beard-kit", "")).toBeNull();
    });

    it("a real webhook retry (order already paid) does not decrement twice", async () => {
      await move({ productId: plain.id, delta: 10, reason: "goods_in" });
      const order: OrderLike = {
        id: "3f7c0d3e-3333-4444-8888-aaaaaaaaaaaa",
        number: "R-900003",
        status: "new",
        total: 20,
        items: [{ id: plain.id, kind: "product", variant: null, qty: 2 }],
      };
      const d = deps();
      await applyPaymentResult(
        order,
        { orderRef: order.number, status: "paid", providerRef: "x", amount: 20, currency: "EUR" },
        "mock",
        d,
      );
      await applyPaymentResult(
        { ...order, status: "paid" },
        { orderRef: order.number, status: "paid", providerRef: "x", amount: 20, currency: "EUR" },
        "mock",
        d,
      );
      expect((await getLevel(plain.id, ""))?.qty).toBe(8); // 10 − 2, not 10 − 4
    });
  });
});
