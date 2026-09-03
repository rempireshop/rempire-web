import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUNDLES, DISCOUNT } from "../tools/bundles.config.mjs";
import { buildBundles, loadCatalogue, sizePrice, to90 } from "../tools/build-bundles.mjs";

/**
 * The sets are generated, not hand-written, so what is worth testing is the
 * generator's promises: every product in a set really exists, the price is the
 * discounted sum rounded to «,90», and the two files in the repo are what the
 * current config produces.
 */

type Product = {
  id: string;
  price: number;
  prices?: number[];
  sizes?: string[];
  stock?: string;
  img: string;
};

const catalogue = loadCatalogue() as Product[];
const built = buildBundles(catalogue);
const root = new URL("../", import.meta.url);

describe("to90 — rounding to «,90»", () => {
  it("never rounds up past the value", () => {
    for (const v of [35.2, 28.16, 52.36, 25.52, 61.28, 9.99, 100]) {
      expect(to90(v)).toBeLessThanOrEqual(v);
    }
  });
  it("always lands on x,90", () => {
    for (const v of [35.2, 28.16, 52.36, 1.5, 999.99]) {
      expect(Math.abs((to90(v) % 1) - 0.9)).toBeLessThan(1e-9);
    }
  });
  it("keeps a value that is already x,90", () => {
    expect(to90(39.9)).toBe(39.9);
    expect(to90(0.9)).toBe(0.9);
  });
});

describe("bundles", () => {
  it("has 6–8 curated sets", () => {
    expect(built.length).toBeGreaterThanOrEqual(6);
    expect(built.length).toBeLessThanOrEqual(8);
  });

  it("only uses products that exist in the catalogue", () => {
    const ids = new Set(catalogue.map((p) => p.id));
    for (const b of built) {
      for (const it of b.items) expect(ids, `${b.id} → ${it.id}`).toContain(it.id);
    }
  });

  it("prices each item at the catalogue price for its size", () => {
    for (const b of built) {
      for (const it of b.items) {
        const p = catalogue.find((x) => x.id === it.id)!;
        expect(it.price).toBeCloseTo(sizePrice(p, it.size), 2);
      }
    }
  });

  it("charges the sum minus at least the advertised discount, ending in ,90", () => {
    for (const b of built) {
      expect(b.sum).toBeCloseTo(
        b.items.reduce((a: number, it: { price: number }) => a + it.price, 0),
        2,
      );
      expect(b.price).toBeLessThanOrEqual(b.sum * (1 - DISCOUNT) + 1e-9);
      expect(Math.abs((b.price % 1) - 0.9)).toBeLessThan(1e-9);
      expect(b.save).toBeCloseTo(b.sum - b.price, 2);
      expect(b.pct).toBeGreaterThanOrEqual(Math.round(DISCOUNT * 100));
    }
  });

  it("carries a title and a description in all three languages", () => {
    for (const b of built) {
      for (const lang of ["RU", "ET", "EN"] as const) {
        expect(b.title[lang], `${b.id} title.${lang}`).toBeTruthy();
        expect(b.desc[lang], `${b.id} desc.${lang}`).toBeTruthy();
      }
    }
  });

  it("gives every set a unique slug id and up to three stack images", () => {
    const seen = new Set<string>();
    for (const b of built) {
      expect(b.id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(seen.has(b.id)).toBe(false);
      seen.add(b.id);
      expect(b.images.length).toBeGreaterThan(0);
      expect(b.images.length).toBeLessThanOrEqual(3);
      for (const src of b.images) expect(src).toMatch(/^\/shop\/img\//);
    }
  });

  it("reports the worst stock of its parts", () => {
    for (const b of built) {
      const stocks = b.items.map((it: { id: string }) => catalogue.find((p) => p.id === it.id)!.stock || "in");
      const worst = stocks.includes("out") ? "out" : stocks.includes("low") ? "low" : "in";
      expect(b.stock).toBe(worst);
    }
  });

  it("refuses a set that names a product the catalogue does not have", () => {
    expect(() =>
      buildBundles(catalogue, [
        {
          id: "broken",
          cat: "beard",
          title: { RU: "a", ET: "a", EN: "a" },
          desc: { RU: "a", ET: "a", EN: "a" },
          items: [{ id: "no-such-product" }, { id: catalogue[0].id }],
        },
      ]),
    ).toThrow(/no such product/i);
  });

  it("refuses a set that lists the same product twice", () => {
    expect(() =>
      buildBundles(catalogue, [
        {
          id: "twice",
          cat: "beard",
          title: { RU: "a", ET: "a", EN: "a" },
          desc: { RU: "a", ET: "a", EN: "a" },
          items: [{ id: catalogue[0].id }, { id: catalogue[0].id }],
        },
      ]),
    ).toThrow(/twice/i);
  });

  it("refuses a set with a missing translation", () => {
    expect(() =>
      buildBundles(catalogue, [
        {
          id: "half",
          cat: "beard",
          title: { RU: "a", ET: "", EN: "a" },
          desc: { RU: "a", ET: "a", EN: "a" },
          items: [{ id: catalogue[0].id }, { id: catalogue[1].id }],
        },
      ]),
    ).toThrow(/title\.ET/);
  });

  it("the generated files in the repo are up to date with the config", () => {
    const json = JSON.parse(readFileSync(new URL("src/data/bundles.json", root), "utf8"));
    expect(json).toEqual(built);

    const js = readFileSync(new URL("public/shop/bundles.js", root), "utf8");
    expect(js).toContain("const BUNDLES =");
    // evaluate it the way a browser <script> would
    const fromBrowserFile = new Function(js + ";return BUNDLES")();
    expect(fromBrowserFile).toEqual(built);
  });

  it("the config and the build agree on how many sets there are", () => {
    expect(BUNDLES.length).toBe(built.length);
  });
});
