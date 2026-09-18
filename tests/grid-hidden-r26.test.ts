/**
 * A prerendered tile must not link into a 404 — Dim, 18.09.2026.
 *
 * «Показывать в магазине» (product_overrides.hidden, db/migrations/147) takes
 * a product off sale without a deploy: src/middleware.ts answers its /p/
 * address 404 with a noindex shell, and src/app/sitemap-products.xml/route.ts
 * stops naming it, both within the minute. Nothing told the BUILD. Every page
 * tools/prerender-shop2.mjs writes with a grid on it — 3 home pages, 27
 * category pages, 78 brand pages and the shelf under each of 660 product
 * pages — went on carrying an <a href> into that address, and Vercel's static
 * layer answers those files before any route runs. A crawler and a reader
 * without scripts followed a tile into a dead page of our own making, and the
 * grid offered a product the sitemap beside it had already withdrawn.
 *
 * Reproduced before it was fixed by running the build with the two Postgres
 * readers stubbed and one product hidden: 813 pages written, 0 of them
 * changed, /shop2/c/hair/, /shop2/b/system-4/ and /shop2/index.html all still
 * carrying href="/shop2/p/system-4-bio-botanical-serum/".
 *
 * What is NOT the fix: a product page correcting its own head. setHead() in
 * public/shop2/app.js rewrites the head from the live feed on every render
 * (docs/seo.md), which is why a hidden product KEEPS its static page — the
 * middleware withholds it, and the file is there again the moment the owner
 * switches it back on. That second pass covers the page it runs on. A grid on
 * another page linking into it has no second pass at all.
 *
 * The rule itself is forSale() in src/lib/seo-head.mjs, one function for the
 * build and for every request-time reader, because the two decisions — does
 * this address answer, and does anything link to it — are the ones that must
 * not disagree.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { forSale, onlyForSale } from "@/lib/seo-head.mjs";
import { fetchProductOverrides, overrideRow } from "../tools/lib/overrides-export.mjs";

type Row = { price: number | null; sizes: Array<{ size: string; price: number }> | null; hidden: boolean };
type Product = { id: string; brand: string; name: string; cat: string; stock: string; price: number };

const row = (over: Partial<Row> = {}): Row => ({ price: null, sizes: null, hidden: false, ...over });

const SERUM = "system-4-bio-botanical-serum";
const SHAMPOO = "system-4-bio-botanical-shampoo";
const SOAP = "handmade-soap-666";
const CATALOGUE: Product[] = [
  { id: SERUM, brand: "System 4", name: "Bio Botanical Serum", cat: "hair", stock: "in", price: 8 },
  { id: SHAMPOO, brand: "System 4", name: "Bio Botanical Shampoo", cat: "hair", stock: "in", price: 9 },
  { id: SOAP, brand: "Rempire", name: "Чёрное мыло 666", cat: "body", stock: "out", price: 9 },
];
const ids = (list: Product[]) => list.map((p) => p.id);

/* ---------- the rule, shared by the build and every page ----------------- */

describe("forSale — «Показывать в магазине», asked once", () => {
  it("is true for a product the owner has never touched", () => {
    expect(forSale(undefined)).toBe(true);
    expect(forSale(null)).toBe(true);
    expect(forSale(row())).toBe(true);
  });

  it("is false only for the boolean the column really is", () => {
    expect(forSale(row({ hidden: true }))).toBe(false);
    expect(forSale(row({ hidden: false }))).toBe(true);
    /* mapOverride() in src/lib/orders.ts and overrideRow() in
       tools/lib/overrides-export.mjs both write `hidden: r.hidden === true`,
       so nothing else ever reaches here — and if something did, showing the
       product is the direction that matches what a shop with no database
       does. */
    expect(forSale({ hidden: "yes" })).toBe(true);
    expect(forSale({ hidden: 1 })).toBe(true);
  });

  it("reads the row the build makes of a Postgres row", () => {
    expect(forSale(overrideRow({ price: null, sizes: null, hidden: true }))).toBe(false);
    expect(forSale(overrideRow({ price: null, sizes: null, hidden: null }))).toBe(true);
    expect(forSale(overrideRow({ price: "14.50", sizes: null }))).toBe(true);
  });
});

describe("onlyForSale — the catalogue a shopper may be shown", () => {
  it("drops what the owner has switched off and keeps the order of the rest", () => {
    expect(ids(onlyForSale(CATALOGUE, { [SHAMPOO]: row({ hidden: true }) }))).toEqual([SERUM, SOAP]);
  });

  it("keeps a sold-out product: it is still for sale tomorrow and its page still answers", () => {
    expect(ids(onlyForSale(CATALOGUE, {}))).toEqual([SERUM, SHAMPOO, SOAP]);
  });

  it("shows everything when there is no table to ask — a build with no database", async () => {
    const was = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      await expect(fetchProductOverrides()).resolves.toEqual({});
      expect(ids(onlyForSale(CATALOGUE, await fetchProductOverrides()))).toEqual(ids(CATALOGUE));
    } finally {
      if (was !== undefined) process.env.DATABASE_URL = was;
    }
  });
});

/* ---------- the build's own lines, run ----------------------------------- */

/* Newlines normalised: this repo is checked out with core.autocrlf on
   Windows, so the file on disk has CRLF and the `;\n` below would otherwise
   never match — see the same note in tests/blog-prerender-prices.test.ts. */
const prerender = readFileSync(fileURLToPath(new URL("../tools/prerender-shop2.mjs", import.meta.url)), "utf8")
  .replace(/\r\n?/g, "\n");

/** The right-hand side of one `const <name> = …;` in the build script, found
    after `anchor` — the real line, not a re-reading of it. The script is a
    top-level-await program that writes 813 files and cannot be imported, the
    same reason tests/blog-prerender-prices.test.ts lifts a function out. */
function rhs(anchor: string, name: string): string {
  const from = prerender.indexOf(anchor);
  if (from < 0) throw new Error(`tools/prerender-shop2.mjs no longer has ${anchor}`);
  const head = `const ${name} = `;
  const start = prerender.indexOf(head, from);
  if (start < 0) throw new Error(`tools/prerender-shop2.mjs no longer has ${head}after ${anchor}`);
  const end = prerender.indexOf(";\n", start);
  if (end < 0) throw new Error(`unterminated ${head}in tools/prerender-shop2.mjs`);
  return prerender.slice(start + head.length, end);
}

/** That expression, over the values this test hands it. Both CATALOGUE and
    ON_SALE are in scope on purpose: a line that goes back to reading the
    whole catalogue runs perfectly well here and fails on what it returns,
    which is the failure worth reading. */
function run<T>(expr: string, scope: Record<string, unknown>): T {
  const keys = Object.keys(scope);
  return new Function(...keys, `return (${expr});`)(...keys.map((k) => scope[k])) as T;
}

const HIDDEN = { [SERUM]: row({ hidden: true }) };
const ON_SALE = onlyForSale(CATALOGUE, HIDDEN) as Product[];

describe("tools/prerender-shop2.mjs — the lists every grid is drawn from", () => {
  it("leaves a hidden product out of its category page, and out of /c/all/", () => {
    const expr = rhs('for (const c of ["all", ...CATS]) {', "list");
    expect(ids(run<Product[]>(expr, { CATALOGUE, ON_SALE, CATS: ["hair", "body"], c: "hair" }))).toEqual([SHAMPOO]);
    expect(ids(run<Product[]>(expr, { CATALOGUE, ON_SALE, CATS: ["hair", "body"], c: "all" }))).toEqual([SHAMPOO, SOAP]);
  });

  it("leaves it out of its brand page", () => {
    const expr = rhs("for (const b of BRANDS) {", "list");
    expect(ids(run<Product[]>(expr, { CATALOGUE, ON_SALE, b: "System 4" }))).toEqual([SHAMPOO]);
  });

  it("leaves it out of the home page's shelf", () => {
    const expr = rhs("function homePage(lang) {", "featured");
    expect(ids(run<Product[]>(expr, { CATALOGUE, ON_SALE }))).toEqual([SHAMPOO]);
  });

  it("leaves it out of the shelf under another product of its category", () => {
    const expr = rhs("function productPage(p, lang) {", "others");
    expect(ids(run<Product[]>(expr, { CATALOGUE, ON_SALE, p: CATALOGUE[1] }))).toEqual([]);
  });

  /* The shelf under the hidden product's OWN page, which is still written.
     Nothing on it may point at the withdrawn address either — and here the
     page being written for a product that is off sale is the whole point. */
  it("still draws a shelf on the hidden product's own page, without itself on it", () => {
    const expr = rhs("function productPage(p, lang) {", "others");
    expect(ids(run<Product[]>(expr, { CATALOGUE, ON_SALE, p: CATALOGUE[0] }))).toEqual([SHAMPOO]);
  });

  it("counts a brand on /brands/ by what the brand page will actually show", () => {
    const expr = rhs("const BRAND_COUNT = ", "BRAND_COUNT");
    const counts = run<Map<string, number>>(expr, { CATALOGUE, ON_SALE, BRANDS: ["System 4", "Rempire"] });
    expect(counts.get("System 4")).toBe(1);
    expect(counts.get("Rempire")).toBe(1);
  });

  /* A набор the owner has left on sale can hold a product he has switched
     off. The row stays — the box does contain it, and its share of the price
     is what the shopper is being asked to pay — but the link goes. */
  it("prints a hidden item of a набор as words, with no link out", () => {
    const expr = rhs("function setPage(b, lang) {", "shown");
    const scope = {
      forSale,
      PRODUCT_OVERRIDES: HIDDEN,
      href: (seg: string, rest: string) => "/shop2" + (seg ? "/" + seg : "") + rest,
      esc: (s: string) => String(s),
      seg: "",
      nm: "System 4 Bio Botanical Serum",
    };
    expect(run<string>(expr, { ...scope, it: { id: SERUM } })).toBe("System 4 Bio Botanical Serum");
    expect(run<string>(expr, { ...scope, it: { id: SHAMPOO } }))
      .toBe('<a href="/shop2/p/' + SHAMPOO + '/">System 4 Bio Botanical Serum</a>');
    /* An id the catalogue has never heard of — a product the owner made in
       the panel — is not hidden, it is simply not in this table, and it
       keeps the link it has always had. */
    expect(run<string>(expr, { ...scope, it: { id: "c-own-product" } })).toContain("<a href=");
  });
});

/* ---------- and the state that filtering makes possible ------------------ */

/* Until 18.09.2026 a category or brand list was a slice of the catalogue file
   and could not come out empty. It can now: the shop stocks one Gummy product,
   and switching it off empties /shop2/b/gummy/ in all three languages. Found
   by running the build that way — check-prerender answered six failures, «no
   <img> with a non-empty alt» and «ItemList has no itemListElement», which is
   a deploy that stops because the owner used the switch he was given. */
describe("a section with nothing for sale in it right now", () => {
  const checker = readFileSync(fileURLToPath(new URL("../tools/check-prerender.mjs", import.meta.url)), "utf8")
    .replace(/\r\n?/g, "\n");
  const appJs = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
    .replace(/\r\n?/g, "\n");

  it("keeps its page: a brand slug with no file behind it is a soft 404", () => {
    expect(prerender).toContain('for (const b of BRANDS) {');
    expect(prerender).toContain("const empty = !list.length;");
  });

  it("says so in one marker, which the checker looks for by the same name", () => {
    expect(prerender).toContain('<p class="muted sec__empty">');
    expect(checker).toContain("sec__empty");
  });

  /* The words come from app.js's own dictionary through the lift, so the
     static page and the SPA do not word one state twice. Nothing else in
     app.js uses this entry, so nothing else would notice it being deleted —
     and a missing entry is not an error, it is the Russian sentence on an
     Estonian page, which check-prerender only catches for category names. */
  it("says it in Estonian and in English, not in Russian", () => {
    expect(prerender).toContain('tr("Здесь пусто.", code, false)');
    expect(appJs).toContain('"Здесь пусто.": "Siin pole midagi."');
    expect(appJs).toContain('"Здесь пусто.": "Nothing here."');
  });
});

describe("tools/prerender-shop2.mjs — wiring", () => {
  it("reads product_overrides on every run, not only when there are articles", () => {
    expect(prerender).toContain('from "./lib/overrides-export.mjs"');
    expect(prerender).toContain("const PRODUCT_OVERRIDES = await fetchProductOverrides();");
    expect(prerender).toContain("const ON_SALE = onlyForSale(CATALOGUE, PRODUCT_OVERRIDES);");
  });

  /* The page itself is not a link, and withholding it is the middleware's
     job, not the build's — a file that stops being written cannot come back
     when the owner flips the switch, and the whole point of the column is
     that he can flip it without a deploy. */
  it("still writes a static page for every catalogue product, hidden or not", () => {
    expect(prerender).toContain("for (const p of CATALOGUE) pages.push(productPage(p, lang));");
  });
});

/* ---------- the grids and the sitemap, one answer ------------------------ */

/* src/app/sitemap-products.xml/route.ts drops exactly what forSale() drops.
   Before 18.09.2026 the two disagreed by construction: the route asked the
   table and the build never did, so the shop offered Google a grid full of
   links to addresses its own sitemap had already withdrawn. */
describe("what the sitemap names and what a grid links to", () => {
  const sitemapIds = (all: Record<string, Row>) => CATALOGUE.filter((p) => forSale(all[p.id])).map((p) => p.id);

  it("agree, product for product, once the owner hides one", () => {
    expect(sitemapIds(HIDDEN)).toEqual(ids(ON_SALE));
    expect(sitemapIds(HIDDEN)).not.toContain(SERUM);
  });

  it("read the route and the build from the same function", () => {
    const route = readFileSync(fileURLToPath(new URL("../src/app/sitemap-products.xml/route.ts", import.meta.url)), "utf8");
    expect(route).toContain("if (!forSale(o)) continue;");
    expect(route).toContain('from "@/lib/seo-head.mjs"');
  });
});
