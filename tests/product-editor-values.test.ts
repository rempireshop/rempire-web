/**
 * Three values the product editor showed the owner that were not the values
 * the shop was using.
 *
 *  1. «Салон, €» on every row below the first quoted price_i × (1 − скидка),
 *     while proUnitPrice() bills base × (1 − скидка) + (price_i − base). On a
 *     20 % discount and a 9 € / 16 € ladder the grid said 12.80 and the till
 *     charged 14.20 — a number the owner set his wholesale prices by.
 *  2. A product with «Показывать в магазине» off is out of CATALOGUE, and
 *     applyDemoOverrides() only ever walked CATALOGUE — so the editor, the
 *     one screen that can still open it, showed the generated file's price,
 *     volumes and description instead of the owner's saved ones. Typing a
 *     Russian description into those empty boxes wrote three empty strings
 *     over the stored Estonian and English text.
 *  3. The salon price is stripped from the public feed (it is commercial
 *     information) and the panel read no other one, so the box opened empty
 *     whatever had been saved and the override could never be cleared.
 *
 * The storefront is a vanilla-JS IIFE with no DOM here, so the functions are
 * **sliced out of public/shop2/app.js by source text** and run against stubs,
 * the same way tests/checkout-parity.test.ts does it — retyping them would
 * test this file instead of the shop, and the slice fails loudly if app.js
 * drops or renames one of them. The server half is imported for real.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { proUnitPrice } from "@/lib/loyalty";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

/** Cut `function <name>(…) { … }` out of app.js by brace matching. */
function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

/* ---------- 1. «Салон, €» ------------------------------------------------- */

/** What the grid puts in the read-only «Салон, €» cell of a row below the first. */
function gridSalon(pct: number, proPrice: number | null, first: number, price: number): number {
  const run = new Function(
    "S",
    "p",
    "first",
    "price",
    `${slice("edSalonPct")}
     ${slice("edSalonOf")}
     ${slice("edSalonRung")}
     return edSalonRung(p, first, price);`,
  ) as (S: unknown, p: unknown, first: number, price: number) => number;
  return run({ pricingLoaded: { proDiscountPct: pct } }, { proPrice }, first, price);
}

describe("the editor's «Салон, €» column", () => {
  it("shows what the shop really bills a salon — the audit's own 9 € / 16 € ladder", () => {
    // 20 % off the 9 € base is 7.20; the 500 ml keeps its 7 € premium ⇒ 14.20
    expect(gridSalon(20, null, 9, 16)).toBe(14.2);
    expect(proUnitPrice(9, 16, null, 20)).toBe(14.2);
  });

  it("agrees with proUnitPrice() on every ladder, discount and override", () => {
    const cases = [
      { pct: 20, pro: null, first: 9, price: 16 },
      { pct: 20, pro: null, first: 9, price: 9 },
      { pct: 15, pro: 6, first: 9, price: 16 },
      { pct: 0, pro: null, first: 12.5, price: 22 },
      { pct: 30, pro: 4, first: 12, price: 12 },
      { pct: 25, pro: null, first: 19.9, price: 34.5 },
      // a rung cheaper than the first one: the premium is negative and the
      // salon price follows it down, never below zero
      { pct: 50, pro: 2, first: 20, price: 5 },
    ];
    for (const c of cases) {
      expect(gridSalon(c.pct, c.pro, c.first, c.price), JSON.stringify(c)).toBe(
        proUnitPrice(c.first, c.price, c.pro, c.pct),
      );
    }
  });

  it("is what both size grids actually render below their first row", () => {
    for (const pane of ["edPaneSizesOwn", "edPaneSizes"]) {
      expect(slice(pane), pane).toContain("edSalonRung(");
    }
  });
});

/* ---------- 2. a hidden product's own values ------------------------------ */

type Product = Record<string, unknown> & { id: string };

/** Run the real applyDemoOverrides() over one hidden catalogue product. */
function applyOverTheHidden(demo: Record<string, unknown>): Product {
  const file: Product = {
    id: "touchable",
    brand: "Insight",
    name: "Touchable",
    price: 30,
    stock: "in",
    seo: null,
    img: "/file.webp",
    seoOv: null,
    descOv: null,
  };
  const base = { ...file, prices: null, sizes: null, priceFrom: false, varImg: null, gallery: null };
  const run = new Function(
    "CATALOGUE",
    "BASE",
    "FILE_PRODUCTS",
    "FILE_BASE",
    "DEMO",
    "shopHidden",
    "galleryUrls",
    `var SRCH_GEN = 0, SRCH_IX = {};
     ${slice("applyDemoOverrides")}
     applyDemoOverrides();`,
  );
  // hidden ⇒ rebuildCatalogue() has taken it out of CATALOGUE; only the
  // file list, which the editor falls back to, still holds it
  run([], [], [file], [base], demo, () => true, () => null);
  return file;
}

const DEMO_EMPTY = {
  price: {},
  stock: {},
  seo: {},
  subcat: {},
  varimg: {},
  video: {},
  desc: {},
  proPrice: {},
  sizes: {},
  gallery: {},
};

describe("a product with «Показывать в магазине» off", () => {
  it("opens in the editor on the owner's saved values, not the catalogue file's", () => {
    const p = applyOverTheHidden({
      ...DEMO_EMPTY,
      price: { touchable: 25 },
      proPrice: { touchable: 18 },
      desc: { touchable: { RU: "русский", ET: "eesti", EN: "english" } },
      sizes: { touchable: [{ size: "100 мл", price: 25 }, { size: "250 мл", price: 40 }] },
    });
    expect(p.price).toBe(25);
    expect(p.proPrice).toBe(18);
    expect(p.sizes).toEqual(["100 мл", "250 мл"]);
    expect(p.prices).toEqual([25, 40]);
    // the three description boxes are filled from this, and «Сохранить»
    // compares what was typed against it — an empty ET/EN here is what used
    // to travel back to the server as «this product has no Estonian text»
    expect(p.descOv).toEqual({ RU: "русский", ET: "eesti", EN: "english" });
  });

  it("falls back to the file's own values when there is no override", () => {
    const p = applyOverTheHidden({ ...DEMO_EMPTY });
    expect(p.price).toBe(30);
    expect(p.proPrice).toBeNull();
    expect(p.descOv).toBeNull();
  });
});

/* ---------- 3. the salon price coming back ------------------------------- */

describe("the salon price the panel could not see", () => {
  it("is fetched from the admin feed, which is the only one that carries it", async () => {
    const DEMO = { proPrice: { gone: 3, kept: 1 } as Record<string, number> };
    const asked: string[] = [];
    let applied = 0;
    const apiJson = (url: string) => {
      asked.push(url);
      return Promise.resolve({
        status: 200,
        body: {
          ok: true,
          overrides: {
            touchable: { price: 9, proPrice: 7.5 },
            gone: { price: 4, proPrice: null }, // the owner cleared it
          },
        },
      });
    };
    const run = new Function(
      "SRV",
      "DEMO",
      "apiJson",
      "applyDemoOverrides",
      "render",
      "S",
      "noop",
      `var PRO_OV = { asked: false };
       ${slice("loadProOverrides")}
       loadProOverrides(false);`,
    );
    run({ admin: true }, DEMO, apiJson, () => applied++, () => {}, { adminEdit: "" }, () => {});
    await new Promise((r) => setTimeout(r, 0));

    expect(asked).toEqual(["/api/admin/overrides/"]);
    expect(DEMO.proPrice.touchable).toBe(7.5);
    expect(DEMO.proPrice.gone).toBeUndefined(); // cleared on the server, cleared here
    expect(DEMO.proPrice.kept).toBe(1); // no row on the server, no opinion about it
    expect(applied).toBe(1); // the products carry the new value straight away
  });

  it("does not ask when nobody is signed in to the panel", async () => {
    const asked: string[] = [];
    const run = new Function(
      "SRV",
      "DEMO",
      "apiJson",
      "applyDemoOverrides",
      "render",
      "S",
      "noop",
      `var PRO_OV = { asked: false };
       ${slice("loadProOverrides")}
       loadProOverrides(false);`,
    );
    run({ admin: null }, { proPrice: {} }, (u: string) => { asked.push(u); return Promise.resolve({}); },
      () => {}, () => {}, { adminEdit: "" }, () => {});
    await new Promise((r) => setTimeout(r, 0));
    expect(asked).toEqual([]);
  });

  it("is asked for on the way into «Каталог»", () => {
    expect(src).toContain("loadProOverrides(false)");
  });
});
