/**
 * The assistant's two set actions — `propose_bundle` and `set_bundle`
 * (Dim, 07.09.2026: «he will make the sets himself but assistant needs to be
 * able to help there as well proposing items and adding them to sets»).
 *
 * Pure functions over a JSON blob, like the rest of the whitelist: what is
 * proven here is that a model cannot price a set on its own, cannot name a
 * product the shop does not sell, and cannot invent a set id.
 */
import { describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import {
  BUNDLE_CATS,
  BUNDLE_MAX_ITEMS,
  BUNDLE_MAX_QTY,
  BUNDLE_MIN_ITEMS,
  sanitizeAction,
} from "@/app/api/assistant/actions";
import * as bundlesLib from "@/lib/bundles";

const rows = catalogueMin as Array<{ id: string }>;
const known = new Set(rows.map((p) => p.id));
const a = rows[0].id;
const b = rows[1].id;
const c = rows[2].id;

const title = { RU: "Борода — набор", ET: "Habe — komplekt", EN: "Beard set" };

describe("propose_bundle — a suggestion, never a price", () => {
  it("takes products and a name and hands them back", () => {
    const out = sanitizeAction(
      { type: "propose_bundle", title, cat: "beard", items: [{ id: a, qty: 1 }, { id: b, variant: 1, qty: 2 }] },
      known, true,
    ) as { type: string; title: Record<string, string>; cat: string; items: Array<Record<string, number | string>> };
    expect(out.type).toBe("propose_bundle");
    expect(out.title.RU).toBe("Борода — набор");
    expect(out.cat).toBe("beard");
    expect(out.items).toEqual([{ productId: a, variant: 0, qty: 1 }, { productId: b, variant: 1, qty: 2 }]);
  });

  it("carries no price and no id, whatever the model sends", () => {
    const out = sanitizeAction(
      { type: "propose_bundle", title, items: [{ id: a }, { id: b }], price: 1, discountPct: 90, id: "borodá", active: false },
      known, true,
    ) as Record<string, unknown>;
    expect(out).toBeTruthy();
    expect(out.price, "the assistant set a price on a set").toBeUndefined();
    expect(out.discountPct).toBeUndefined();
    expect(out.id, "the proposal claimed to be an existing set").toBeUndefined();
    expect(out.active).toBeUndefined();
  });

  it("refuses a product the shop does not sell, and a set of one", () => {
    expect(sanitizeAction({ type: "propose_bundle", title, items: [{ id: a }, { id: "not-a-product" }] }, known, true)).toBeNull();
    expect(sanitizeAction({ type: "propose_bundle", title, items: [{ id: a }] }, known, true)).toBeNull();
    expect(sanitizeAction({ type: "propose_bundle", title, items: [] }, known, true)).toBeNull();
    expect(sanitizeAction({ type: "propose_bundle", title, items: "две штуки" }, known, true)).toBeNull();
  });

  it("needs a Russian name — that is the source language of every set", () => {
    expect(sanitizeAction({ type: "propose_bundle", title: { EN: "Beard set" }, items: [{ id: a }, { id: b }] }, known, true)).toBeNull();
  });

  it("refuses a quantity or a volume index outside what a set can hold", () => {
    expect(sanitizeAction({ type: "propose_bundle", title, items: [{ id: a, qty: 0 }, { id: b }] }, known, true)).toBeNull();
    expect(sanitizeAction({ type: "propose_bundle", title, items: [{ id: a, qty: BUNDLE_MAX_QTY + 1 }, { id: b }] }, known, true)).toBeNull();
    expect(sanitizeAction({ type: "propose_bundle", title, items: [{ id: a, variant: -1 }, { id: b }] }, known, true)).toBeNull();
  });

  it("keeps at most the eight products a set may hold, and one line per volume", () => {
    const many = rows.slice(0, 12).map((p) => ({ id: p.id }));
    const out = sanitizeAction({ type: "propose_bundle", title, items: many }, known, true) as { items: unknown[] };
    expect(out.items).toHaveLength(BUNDLE_MAX_ITEMS);
    const dup = sanitizeAction({ type: "propose_bundle", title, items: [{ id: a }, { id: a }, { id: b }] }, known, true) as { items: unknown[] };
    expect(dup.items).toHaveLength(2);
  });

  it("is admin-only, like every other change", () => {
    expect(sanitizeAction({ type: "propose_bundle", title, items: [{ id: a }, { id: b }] }, known, false)).toBeNull();
  });
});

describe("set_bundle — a set that exists, changed", () => {
  it("takes an id, the whole product list and a price", () => {
    const out = sanitizeAction(
      { type: "set_bundle", id: "beard-start", items: [{ id: a }, { id: b }, { id: c }], price: 39.9 },
      known, true,
    ) as { id: string; items: unknown[]; price: number };
    expect(out.id).toBe("beard-start");
    expect(out.items).toHaveLength(3);
    expect(out.price).toBe(39.9);
  });

  it("refuses an id that is not a set's id", () => {
    // the same slug shape src/lib/bundles.ts stores: lower-case Latin, digits
    // and dashes, 2–64 characters, never leading with a dash
    for (const bad of ["", "-nope", "НАБОР", "a", "x".repeat(70), "with space"]) {
      expect(sanitizeAction({ type: "set_bundle", id: bad, items: [{ id: a }, { id: b }] }, known, true),
        `${String(bad)} was accepted as a set id`).toBeNull();
    }
    // …and an id shouted in capitals is the same set, lower-cased on the way
    // in — the same rule validateBundle() applies on the server
    const shouted = sanitizeAction({ type: "set_bundle", id: "BEARD-START", items: [{ id: a }, { id: b }] }, known, true) as { id: string };
    expect(shouted.id).toBe("beard-start");
  });

  it("refuses a price that is not a price, and a discount out of range", () => {
    expect(sanitizeAction({ type: "set_bundle", id: "x1", items: [{ id: a }, { id: b }], price: 0 }, known, true)).toBeNull();
    expect(sanitizeAction({ type: "set_bundle", id: "x1", items: [{ id: a }, { id: b }], price: "дёшево" }, known, true)).toBeNull();
    expect(sanitizeAction({ type: "set_bundle", id: "x1", items: [{ id: a }, { id: b }], discountPct: 95 }, known, true)).toBeNull();
    const ok = sanitizeAction({ type: "set_bundle", id: "x1", items: [{ id: a }, { id: b }], discountPct: 15 }, known, true) as { discountPct: number };
    expect(ok.discountPct).toBe(15);
  });

  it("passes no price through when the owner named none", () => {
    const out = sanitizeAction({ type: "set_bundle", id: "x1", items: [{ id: a }, { id: b }] }, known, true) as Record<string, unknown>;
    expect(out.price).toBeUndefined();
    expect(out.discountPct).toBeUndefined();
  });

  it("is admin-only", () => {
    expect(sanitizeAction({ type: "set_bundle", id: "x1", items: [{ id: a }, { id: b }] }, known, false)).toBeNull();
  });
});

describe("the bounds are the same two copies", () => {
  /* actions.ts stays free of database imports on purpose (it is tested as a
     pure function; @/lib/bundles pulls in @/lib/db), so the limits are
     duplicated. This is the test that keeps the copies honest — the same
     posture PROMO_MAX_* and STOCK_ADJUST_REASONS already have. */
  it("mirrors src/lib/bundles.ts", () => {
    expect(BUNDLE_MIN_ITEMS).toBe(bundlesLib.BUNDLE_MIN_ITEMS);
    expect(BUNDLE_MAX_ITEMS).toBe(bundlesLib.BUNDLE_MAX_ITEMS);
    expect(BUNDLE_MAX_QTY).toBe(bundlesLib.BUNDLE_MAX_QTY);
    expect([...BUNDLE_CATS]).toEqual([...bundlesLib.BUNDLE_CATS]);
  });
});
