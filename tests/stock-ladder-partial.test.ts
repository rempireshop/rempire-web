/**
 * A HALF-counted ladder may not condemn the whole product.
 *
 * stockStates() folded a product's word out of the variants that are TRACKED
 * and nothing else, so one size counted to 0 — on a product whose other sizes
 * nobody has ever counted — made `states.every(out)` true and wrote «out» onto
 * the product. getOverrides() put that on the override, priceItems() threw
 * out_of_stock for EVERY size including the full ones, and the storefront said
 * «нет в наличии» about a shelf that was not empty. Renat lost the sale with
 * nothing on any screen to explain it (audit 14.09.2026, deferred; fixed here).
 *
 * The rule these tests pin down: a count may only speak for the product as a
 * whole once it covers the whole LADDER. Short of that the product keeps the
 * manual word (product_overrides.stock), which is the same thing a product
 * nobody has counted at all does — see the module doc in src/lib/inventory.ts.
 * The per-SIZE map is untouched: the size that really is at zero stays
 * unbuyable, here as everywhere.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variantData from "@/data/catalogue.variants.json";
import { move, productStockStates } from "@/lib/inventory";
import { createOrder, getOverrides, upsertOverride } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const VARIANTS = variantData as Record<string, { sizes: string[]; prices: number[] }>;

/** A catalogue product on sale with a real size ladder, and one with none. */
const sized = CATALOGUE.find((p) => p.s === "in" && (VARIANTS[p.id]?.sizes.length ?? 0) > 1)!;
const plain = CATALOGUE.find((p) => p.s === "in" && !VARIANTS[p.id])!;

const buyer = { name: "Т", email: "ladder@example.com", phone: "+372 5555 5555" } as const;
const ship = { method: "pickup", country: "EE" } as const;

function order(id: string, variant: string | undefined, email: string) {
  return {
    items: [variant == null ? { id, qty: 1 } : { id, variant, qty: 1 }],
    customer: { ...buyer, email },
    shipping: ship,
  } as Parameters<typeof createOrder>[0];
}

/** Counts `variant` in and straight back out again: tracked, and at zero. */
async function countToZero(productId: string, variant?: string) {
  await move({ productId, variant, delta: 1, reason: "goods_in" });
  await move({ productId, variant, delta: -1, reason: "sale_web" });
}

describe("a partly counted size ladder", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(truncateAll);

  describe("one size counted to zero, the rest never counted", () => {
    it("does not read «нет в наличии» on the feed", async () => {
      const [first] = VARIANTS[sized.id].sizes;
      await countToZero(sized.id, first);

      const ov = (await getOverrides([sized.id]))[sized.id];
      expect(ov?.stock ?? null).not.toBe("out");
    });

    it("leaves the product's word to the manual override, as an uncounted product does", async () => {
      const [first] = VARIANTS[sized.id].sizes;
      await upsertOverride(sized.id, { stock: "in" });
      await countToZero(sized.id, first);

      expect((await productStockStates([sized.id]))[sized.id]).toBeUndefined();
      expect((await getOverrides([sized.id]))[sized.id]?.stock).toBe("in");
    });

    it("still sells a size nobody has counted", async () => {
      const [first, second] = VARIANTS[sized.id].sizes;
      await countToZero(sized.id, first);

      const ok = await createOrder(order(sized.id, second, "uncounted-size@example.com"));
      expect(ok.items[0].variant).toBe(second);
    });

    it("…and still refuses the size that is actually at zero", async () => {
      const [first] = VARIANTS[sized.id].sizes;
      await countToZero(sized.id, first);

      await expect(createOrder(order(sized.id, first, "zero-size@example.com"))).rejects.toMatchObject({
        code: "out_of_stock",
      });
    });

    it("keeps shipping the per-size map, so the storefront can grey that size out", async () => {
      const [first, second] = VARIANTS[sized.id].sizes;
      await countToZero(sized.id, first);

      const ov = (await getOverrides([sized.id]))[sized.id];
      expect(ov?.stockByVariant?.[first]).toBe("out");
      expect(ov?.stockByVariant?.[second]).toBeUndefined();
    });
  });

  describe("the count still condemns a product once it covers the whole ladder", () => {
    it("every size counted and at zero reads «out»", async () => {
      for (const size of VARIANTS[sized.id].sizes) await countToZero(sized.id, size);
      expect((await productStockStates([sized.id]))[sized.id]).toBe("out");
      expect((await getOverrides([sized.id]))[sized.id]?.stock).toBe("out");
    });

    it("a product with no sizes at all is covered by its one unlabelled row", async () => {
      await countToZero(plain.id);
      expect((await productStockStates([plain.id]))[plain.id]).toBe("out");
      await expect(createOrder(order(plain.id, undefined, "plain-zero@example.com"))).rejects.toMatchObject({
        code: "out_of_stock",
      });
    });

    it("counts the ladder the OWNER saved, not the catalogue file's", async () => {
      /* «+ Размер»/«×» in the editor is the whole truth about a product's
         sizes everywhere else (overrideLadder() in src/lib/orders.ts); the
         coverage test has to read the same list or it would either condemn a
         product on a rung the shop no longer sells, or refuse to condemn one
         over a rung it no longer has. */
      await upsertOverride(sized.id, { sizes: [{ size: "75 мл", price: 10 }] });
      await countToZero(sized.id, "75 мл");
      expect((await productStockStates([sized.id]))[sized.id]).toBe("out");
    });
  });

  describe("what the rule may not change", () => {
    it("a manual «нет в наличии» still wins over a half-counted ladder", async () => {
      const [first] = VARIANTS[sized.id].sizes;
      await upsertOverride(sized.id, { stock: "out" });
      await countToZero(sized.id, first);
      expect((await getOverrides([sized.id]))[sized.id]?.stock).toBe("out");
    });

    it("«мало» on one counted size still speaks for the product", async () => {
      /* Only the «out» verdict needs the whole ladder behind it. A size that
         is running low is news the badge should carry at once — saying so
         costs no sale, and waiting for every other size to be counted would
         mean the badge never moved on a shop that counts one shelf at a time. */
      const [first] = VARIANTS[sized.id].sizes;
      await move({ productId: sized.id, variant: first, delta: 1, reason: "goods_in" });
      expect((await productStockStates([sized.id]))[sized.id]).toBe("low");
    });
  });
});
