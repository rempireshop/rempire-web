/* What the owner has done to a catalogue product — his price, his size ladder,
   and whether he has taken it off sale — straight out of Postgres, for
   tools/prerender-shop2.mjs.

   The prerendered blog pages came first. «Товары из статьи» and the product
   cards inside the text were built from the generated file
   (public/shop/catalogue2.js) and from nothing else, so a static article
   carried the prices of the day of the deploy and went on linking to a product
   the owner had since hidden — a /p/ address the middleware answers 404
   noindex for (docs/seo.md, "The one thing that runs before the file"). That
   is not a small window: Vercel's static layer answers a prerendered
   index.html before any route runs, so for every post that existed at the last
   deploy the STATIC copy is the one that gets served, and src/lib/blog-page.ts
   — which has read both columns correctly since 17.09.2026 — is the path that
   almost never runs.

   The storefront's own grids turned out to have the same hole, on a far bigger
   surface (18.09.2026). Every page the prerender writes with a list of
   products on it — 3 home pages, 27 category pages, 78 brand pages, the shelf
   under each of 660 product pages, the «Что внутри» list of every набор and
   the counts on /brands/ — was built from the file alone, so a grid tile went
   on linking into that same 404 and offered a product
   src/app/sitemap-products.xml/route.ts had already withdrawn. So this module
   is read on every run, not only when there are articles.

   Note what is NOT a reason. A hidden product's OWN page corrects itself:
   setHead() in app.js rewrites the head of a product page from the live feed
   on every render, so the page a crawler indexes is corrected in the browser
   (docs/seo.md, "The static file is a build-time snapshot"). That is why the
   static product pages are still written for all 220 and why the sitemap, not
   the build, decides which of them are offered. It covers the page it runs on
   and nothing else — an article's shelf has no second pass, and neither has a
   grid on another page linking in. Those are the places the build has to be
   right.

   The rules themselves are not here. They live in src/lib/seo-head.mjs —
   overriddenPrice() for the price on top of the file's, forSale() for
   «Показывать в магазине» — because the request-time pages answer the same two
   questions about the same products and the two sides must not drift apart.
   This module is the query, and the row as the build reads it.

   Same contract as ./bundles-export.mjs, ./settings-export.mjs and
   ./blog-export.mjs, and the same reason for talking to `pg` directly rather
   than through src/lib/db.ts: `{}` without DATABASE_URL, `{}` when the
   database cannot be reached or the package is not installed, one warning
   line, and the prerender goes on with the file's own products and prices —
   which is exactly what it did before this module existed. A local
   `npm run prerender` has no DATABASE_URL, hides nothing and writes no /blog/
   pages at all, so the committed pages come out byte for byte the same. */

import { sslFor } from "../migrate.mjs";

const MAX_SIZES = 20;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* The ladder as src/lib/orders.ts cleanSizes() reads it — a row the panel
   wrote is trusted no further here than it is there, since a rung with no
   usable price would otherwise become the article's «от». */
function cleanSizes(value) {
  const raw = typeof value === "string" ? safeParse(value) : value;
  if (!Array.isArray(raw)) return null;
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    const o = item && typeof item === "object" ? item : {};
    const label = typeof o.size === "string" ? o.size.replace(/\s+/g, " ").trim().slice(0, 30) : "";
    const price = Number(o.price);
    if (!Number.isFinite(price) || price < 0 || price > 100000) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ size: label, price: round2(price) });
    if (out.length >= MAX_SIZES) break;
  }
  return out.length ? out : null;
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * One `product_overrides` row as the build reads it — the same three fields
 * mapOverride() in src/lib/orders.ts hands the live page, and pure, so the
 * two can be held to the same answer by a test rather than by care.
 */
export function overrideRow(r) {
  const price = r.price == null ? null : round2(r.price);
  const sizes = cleanSizes(r.sizes);
  return {
    price,
    /* The ladder and the first rung's price are one fact stored twice —
       `price` predates `sizes` and everything older reads it — so the ladder
       that leaves here agrees with it, exactly as sizesWithPrice() in
       src/lib/orders.ts makes it agree for the live page. */
    sizes: sizes && price != null ? sizes.map((s, i) => (i === 0 ? { size: s.size, price } : s)) : sizes,
    hidden: r.hidden === true,
  };
}

/** `{ id: { price, sizes, hidden } }` for the rows that exist. */
export async function fetchProductOverrides() {
  const url = process.env.DATABASE_URL;
  if (!url) return {};

  let pg;
  try {
    ({ default: pg } = await import("pg"));
  } catch {
    console.warn("! overrides-export: the 'pg' package is not installed — the file's own products and prices this run");
    return {};
  }

  const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });
  try {
    await client.connect();
    const res = await client.query("select product_id, price, sizes, hidden from product_overrides");
    const out = {};
    for (const r of res.rows) out[r.product_id] = overrideRow(r);
    return out;
  } catch (err) {
    console.warn("! overrides-export: could not read the overrides (" + (err && err.message) + ") — the file's own products and prices this run");
    return {};
  } finally {
    await client.end().catch(() => {});
  }
}
