/**
 * «Товары из статьи» on a PRERENDERED page — Dim, 18.09.2026.
 *
 * The static copy is the one that is actually served. Vercel's static layer
 * answers a prerendered index.html before any route runs, so for every post
 * that existed at the last deploy the page a reader and a crawler get is the
 * one `npm run prerender` wrote — and src/lib/blog-page.ts, which has read
 * `product_overrides` correctly since 17.09.2026, is the path that almost
 * never runs.
 *
 * The build wrote that shelf from public/shop/catalogue2.js and from nothing
 * else, so it carried two lies for as long as a deploy stood still:
 *
 *   · the prices of the day of the deploy, not the owner's own («Цена» in
 *     «Товары», product_overrides.price / .sizes);
 *   · a link to a product he has since switched off («Показывать в
 *     магазине»), whose /p/ address the middleware now answers 404 noindex
 *     for — a dead link for a reader and wasted crawl budget.
 *
 * tools/lib/overrides-export.mjs is the step that brings the table into the
 * build, the way tools/lib/bundles-export.mjs brings the set prices in. The
 * rule for turning a row plus the file into one price is shared outright —
 * overriddenPrice() in src/lib/seo-head.mjs — because the request-time page
 * answers the same question about the same article and the two must reach
 * the same number.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cleanSizes } from "@/lib/orders";
import { cheapestPrice, overriddenPrice } from "@/lib/seo-head.mjs";
import { fetchProductOverrides, overrideRow } from "../tools/lib/overrides-export.mjs";

/* ---------- the rule both renderers share ------------------------------- */

describe("overriddenPrice — what a catalogue product costs today", () => {
  it("takes the file's price when the owner has touched nothing", () => {
    expect(overriddenPrice(9, [9, 16, 25], undefined)).toEqual({ price: 9, from: true });
    expect(overriddenPrice(20, [], undefined)).toEqual({ price: 20, from: false });
  });

  it("takes the owner's «Цена» over the file's", () => {
    expect(overriddenPrice(12, [12], { price: 14, sizes: null })).toEqual({ price: 14, from: false });
  });

  it("takes the owner's whole ladder over the file's, «от» and all", () => {
    const row = { price: 11, sizes: [{ size: "75", price: 11 }, { size: "250", price: 18 }] };
    expect(overriddenPrice(9, [9, 16, 25], row)).toEqual({ price: 11, from: true });
  });

  /* The 29 products sold in ONE named size have a one-rung ladder in the
     file, and its rung IS the file's own price — reading it as a ladder
     would out-vote the owner's «Цена» and put the pre-override number under
     an article. Same rule as src/lib/blog-page.ts had on its own. */
  it("does not let a one-rung file ladder out-vote the owner's price", () => {
    expect(overriddenPrice(12, [12], { price: 14, sizes: null }).price).toBe(14);
    expect(overriddenPrice(12, [12], undefined)).toEqual({ price: 12, from: false });
  });

  /* «от» means «there is more than one price», not «there is a ladder». */
  it("says «от» only when the prices really differ", () => {
    expect(cheapestPrice([15, 15, 15], 9).from).toBe(false);
    expect(cheapestPrice([15, 22], 9)).toEqual({ price: 15, from: true });
    expect(cheapestPrice([], 9)).toEqual({ price: 9, from: false });
    expect(cheapestPrice([0, -3, null], 9)).toEqual({ price: 9, from: false });
  });
});

/* ---------- the row, read the same way on both sides -------------------- */

describe("overrideRow — the build reads a row as the live page does", () => {
  const rows = [
    { what: "nothing set", price: null, sizes: null, hidden: false },
    { what: "a price only", price: "14.50", sizes: null, hidden: false },
    { what: "a ladder only", price: null, sizes: [{ size: "75 мл", price: 11 }, { size: "250 мл", price: 18 }], hidden: false },
    { what: "both", price: "12.00", sizes: [{ size: "75 мл", price: 11 }, { size: "250 мл", price: 18 }], hidden: false },
    { what: "the ladder as stored json text", price: null, sizes: '[{"size":"75 мл","price":11}]', hidden: false },
    { what: "rungs that are not prices", price: null, sizes: [{ size: "a", price: "x" }, { size: "b", price: -1 }], hidden: false },
    { what: "two rungs with one label", price: null, sizes: [{ size: "75 мл", price: 11 }, { size: "75 мл", price: 18 }], hidden: false },
    { what: "hidden", price: null, sizes: null, hidden: true },
  ];

  /* The real drift risk: two readers of one table, one in TypeScript for the
     server and one in plain .mjs for the build. src/lib/blog-html.mjs's
     header is an essay about what «keep the copies in step by hand» cost
     the last time, so the cleaner is held to the real one row by row. */
  for (const r of rows) {
    it("agrees with src/lib/orders.ts cleanSizes() on " + r.what, () => {
      expect(overrideRow(r).sizes).toEqual(
        // the same "price wins on rung 0" src/lib/orders.ts applies
        (() => {
          const s = cleanSizes(r.sizes);
          const p = r.price == null ? null : Number(r.price);
          return s && p != null ? s.map((x, i) => (i === 0 ? { size: x.size, price: p } : x)) : s;
        })(),
      );
    });
  }

  it("reads «Показывать в магазине» as the one boolean it is", () => {
    expect(overrideRow({ price: null, sizes: null, hidden: true }).hidden).toBe(true);
    expect(overrideRow({ price: null, sizes: null, hidden: false }).hidden).toBe(false);
    expect(overrideRow({ price: null, sizes: null, hidden: null }).hidden).toBe(false);
    expect(overrideRow({ price: null, sizes: null }).hidden).toBe(false);
  });

  it("rounds a price the way money is rounded everywhere else", () => {
    expect(overrideRow({ price: "21.405", sizes: null, hidden: false }).price).toBe(21.41);
    expect(overrideRow({ price: null, sizes: null, hidden: false }).price).toBe(null);
  });
});

/* ---------- and it must still build with no database -------------------- */

describe("fetchProductOverrides — a build with no DATABASE_URL", () => {
  it("answers {} rather than throwing, so the prerender keeps the file's prices", async () => {
    const was = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(fetchProductOverrides()).resolves.toEqual({});
    } finally {
      if (was !== undefined) process.env.DATABASE_URL = was;
    }
  });
});

/* ---------- the build's own function, run ------------------------------- */

/* Newlines normalised: this repo is checked out with core.autocrlf on
   Windows, so the file on disk has CRLF and a multi-line expectation below
   would be asserting the checkout's settings rather than the code. */
const prerender = readFileSync(fileURLToPath(new URL("../tools/prerender-shop2.mjs", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

/** One function lifted out of the build script, which is a top-level-await
    program that writes 813 files and cannot be imported. The same trick
    tests/blog-card-price-r22.test.ts plays on public/shop2/app.js. */
function slice(name: string): string {
  const start = prerender.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`tools/prerender-shop2.mjs no longer has function ${name}()`);
  let depth = 0;
  for (let i = prerender.indexOf("{", start); i < prerender.length; i++) {
    if (prerender[i] === "{") depth++;
    else if (prerender[i] === "}" && --depth === 0) return prerender.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in tools/prerender-shop2.mjs`);
}

type CatProduct = { id: string; brand: string; name: string; price: number; prices?: number[] };
type Row = { price: number | null; sizes: Array<{ size: string; price: number }> | null; hidden: boolean };
type Shelf = (CatProduct & { priceFrom: boolean }) | null;

/** blogShelfProduct() as the build defines it, over a catalogue and a table
    the test hands it — the real lines, not a re-reading of them. */
function shelfProduct(catalogue: CatProduct[], overrides: Record<string, Row>, id: string): Shelf {
  const body = `
    ${slice("blogShelfProduct")}
    return blogShelfProduct(ID);
  `;
  return (new Function("CATALOGUE", "PRODUCT_OVERRIDES", "overriddenPrice", "ID", body) as
    (c: CatProduct[], o: Record<string, Row>, f: typeof overriddenPrice, id: string) => Shelf)(
    catalogue, overrides, overriddenPrice, id,
  );
}

/** blogOffSale() as the build defines it — the real lines, the same way. */
function offSale(catalogue: CatProduct[], overrides: Record<string, Row>, id: string): boolean {
  const body = `
    ${slice("blogOffSale")}
    return blogOffSale(ID);
  `;
  return (new Function("CATALOGUE", "PRODUCT_OVERRIDES", "ID", body) as
    (c: CatProduct[], o: Record<string, Row>, id: string) => boolean)(catalogue, overrides, id);
}

const SHAMPOO = "system-4-bio-botanical-shampoo";
const CAT: CatProduct[] = [
  { id: SHAMPOO, brand: "System 4", name: "Bio Botanical Shampoo — шампунь", price: 9, prices: [9, 16, 25] },
  { id: "one-size", brand: "Acme", name: "Wax", price: 12, prices: [12] },
];
const row = (over: Partial<Row> = {}): Row => ({ price: null, sizes: null, hidden: false, ...over });

describe("tools/prerender-shop2.mjs blogShelfProduct()", () => {
  it("keeps the file's price when the owner has touched nothing", () => {
    expect(shelfProduct(CAT, {}, SHAMPOO)).toMatchObject({ id: SHAMPOO, price: 9, priceFrom: true });
  });

  it("prints the owner's price, not the one the deploy was built with", () => {
    const solo = shelfProduct(CAT, { "one-size": row({ price: 14 }) }, "one-size");
    expect(solo).toMatchObject({ price: 14, priceFrom: false });
  });

  /* `price` alone is the OLD, single-value override and it speaks only where
     there is no ladder to speak instead: a product the file sells in three
     sizes shows «от 9 €» until the owner saves a whole ladder for it, since
     `price` says nothing about the other two rungs. The same rule the
     request-time page has had since 17.09.2026 — the point of sharing
     overriddenPrice() is that this is one decision, not two. */
  it("leaves the file's ladder standing when the owner has only set «Цена»", () => {
    expect(shelfProduct(CAT, { [SHAMPOO]: row({ price: 21.4 }) }, SHAMPOO))
      .toMatchObject({ price: 9, priceFrom: true });
  });

  it("takes the owner's whole ladder when he has saved one", () => {
    const out = shelfProduct(CAT, { [SHAMPOO]: row({ price: 11, sizes: [{ size: "75", price: 11 }, { size: "250", price: 18 }] }) }, SHAMPOO);
    expect(out).toMatchObject({ price: 11, priceFrom: true });
  });

  /* The defect this is all for: a hidden product's /p/ address answers 404
     with a noindex shell, so a static article must not link to it. */
  it("gives no card at all for a product switched off in «Товары»", () => {
    expect(shelfProduct(CAT, { [SHAMPOO]: row({ hidden: true }) }, SHAMPOO)).toBe(null);
  });

  it("gives no card for an id the catalogue does not have", () => {
    expect(shelfProduct(CAT, {}, "no-such-product")).toBe(null);
    expect(shelfProduct(CAT, {}, "c-own-product")).toBe(null);
  });

  it("keeps everything else about the product — the picture, the brand, the name", () => {
    const out = shelfProduct(CAT, { [SHAMPOO]: row({ price: 21.4 }) }, SHAMPOO);
    expect(out).toMatchObject({ brand: "System 4", name: "Bio Botanical Shampoo — шампунь" });
  });
});

/**
 * blogShelfProduct() says «no card» for two quite different reasons, and a
 * card INSIDE the text has to tell them apart: one of them means the address
 * answers 404 and the card must stop linking, the other means the build knows
 * nothing and must leave the link where the owner put it.
 */
describe("tools/prerender-shop2.mjs blogOffSale()", () => {
  it("says so for a product switched off in «Товары»", () => {
    expect(offSale(CAT, { [SHAMPOO]: row({ hidden: true }) }, SHAMPOO)).toBe(true);
  });

  it("says so for an id the shop has never had", () => {
    expect(offSale(CAT, {}, "no-such-product")).toBe(true);
  });

  /* The owner's own products have never had a static page and are not in the
     file; their address is answered by the route at request time, so their
     card keeps its link and the shop fills the rest in when app.js runs. */
  it("does not say so for one of the owner's own products", () => {
    expect(offSale(CAT, {}, "c-own-product")).toBe(false);
    expect(offSale(CAT, { "c-own-product": row({ price: 9 }) }, "c-own-product")).toBe(false);
  });

  it("does not say so for a product that is on sale, repriced or not", () => {
    expect(offSale(CAT, {}, SHAMPOO)).toBe(false);
    expect(offSale(CAT, { [SHAMPOO]: row({ price: 21.4 }) }, SHAMPOO)).toBe(false);
    expect(offSale(CAT, { [SHAMPOO]: row({ hidden: false }) }, SHAMPOO)).toBe(false);
  });

  /* A run that read no overrides at all — no DATABASE_URL, no `pg`, a database
     that did not answer (fetchProductOverrides answers {} for each) — knows
     nothing about «Показывать в магазине» and must not take a link off over
     it. The file's own prices are what such a run prints; the file's own links
     are what it leaves. */
  it("says nothing about hidden when the overrides came back empty", () => {
    expect(offSale(CAT, {}, SHAMPOO)).toBe(false);
    expect(offSale(CAT, {}, "one-size")).toBe(false);
  });
});

describe("tools/prerender-shop2.mjs wiring", () => {
  it("reads the overrides, and only when there is an article to read them for", () => {
    expect(prerender).toContain('from "./lib/overrides-export.mjs"');
    expect(prerender).toContain("BLOG_POSTS.length ? await fetchProductOverrides() : {}");
  });

  /* The eight are the first eight the owner PICKED and then whatever of those
     is still for sale, exactly as src/lib/blog-page.ts takes them — so the
     static shelf and the live one hold the same products in the same order. */
  it("puts «Товары из статьи» through that lookup, after the slice and not before", () => {
    expect(prerender).toContain(".slice(0, 8)\n    .map(id => blogShelfProduct(id))\n    .filter(Boolean)");
    expect(prerender).not.toContain(".map(id => CATALOGUE.find(p => p.id === id))");
  });

  it("prices the cards inside the text from the same lookup", () => {
    expect(prerender).toContain("const p = blogShelfProduct(id);\n      return p ? priceLabel(p, t) : \"\";");
  });

  /* …and tells them WHICH of the unpriced ones has no page to link to, which
     is the half a price alone cannot say. */
  it("hands the cards inside the text the off-sale rule as well", () => {
    expect(prerender).toContain("offSale: blogOffSale,");
  });
});
