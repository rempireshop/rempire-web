import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variantData from "@/data/catalogue.variants.json";
import {
  byEan,
  deriveState,
  getLevel,
  getLevels,
  InventoryError,
  listMoves,
  move,
  productStockStates,
  setLevel,
  setQty,
} from "@/lib/inventory";
import { createOrder, getOverrides, setOrderStatus, upsertOverride } from "@/lib/orders";
import { applyPaymentResult, type ApplyDeps, type OrderLike } from "@/lib/payments/apply";
import { setupDb, teardownDb, truncateAll } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const VARIANTS = variantData as Record<string, { sizes: string[]; prices: number[] }>;

const plain = CATALOGUE.find((p) => !VARIANTS[p.id])!;
const sized = CATALOGUE.find((p) => VARIANTS[p.id] && VARIANTS[p.id].sizes.length > 1)!;

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
  });

  describe("byEan", () => {
    it("finds a level by its EAN and carries the catalogue product with it", async () => {
      await setLevel(plain.id, "", { ean: "4006381333931" });
      const hit = await byEan("4006381333931");
      expect(hit?.productId).toBe(plain.id);
      expect(hit?.product?.id).toBe(plain.id);
      expect(hit?.product?.brand).toBe(plain.b);
    });

    it("is null for an unknown code", async () => {
      expect(await byEan("0000000000000")).toBeNull();
    });

    it("ignores whitespace around a scanned code", async () => {
      await setLevel(plain.id, "", { ean: "12345678" });
      expect((await byEan(" 12345678 "))?.productId).toBe(plain.id);
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

    it("aggregates variants: out only when every tracked variant is out", async () => {
      const sizes = VARIANTS[sized.id].sizes;
      await move({ productId: sized.id, variant: sizes[0], delta: 3, reason: "goods_in" });
      await move({ productId: sized.id, variant: sizes[1], delta: 0 === 0 ? 1 : 0, reason: "goods_in" });
      // size 0 has 3 (in), size 1 has 1 (low) — the product overall reads low
      expect((await productStockStates([sized.id]))[sized.id]).toBe("low");
      await move({ productId: sized.id, variant: sizes[0], delta: -3, reason: "sale_web" });
      // size 0 now out, size 1 still low(1) — still sellable overall
      expect((await productStockStates([sized.id]))[sized.id]).toBe("low");
      await move({ productId: sized.id, variant: sizes[1], delta: -1, reason: "sale_web" });
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
  });

  describe("getLevels() — the admin table's full catalogue×variant universe", () => {
    it("includes an untracked variant at qty 0, not just rows that exist in the database", async () => {
      const rows = await getLevels({ q: plain.b });
      const row = rows.find((r) => r.productId === plain.id && r.variant === "");
      expect(row).toBeTruthy();
      expect(row?.tracked).toBe(false);
      expect(row?.qty).toBe(0);
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
      const order = await payOrder();
      await setOrderStatus(order.id, "refunded", "test");
      const level = await getLevel(plain.id, "");
      expect(level?.qty).toBe(3);
      const moves = await listMoves({ productId: plain.id, reason: "return" });
      expect(moves).toHaveLength(1);
      expect(moves[0].ref).toBe(order.number);
    });

    it("cancelled after paid also returns stock", async () => {
      const order = await payOrder();
      await setOrderStatus(order.id, "cancelled", "test");
      expect((await getLevel(plain.id, ""))?.qty).toBe(3);
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

    it("skips gift and bundle lines — no product to decrement", async () => {
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
