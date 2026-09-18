/* What the owner has done to a catalogue product — his price, his size
   ladder, and whether he has taken it off sale — straight out of Postgres,
   for tools/prerender-shop2.mjs.

   The reason this exists is «Показывать в магазине» (product_overrides.hidden,
   db/migrations/147). A hidden product's page stops answering at once: the
   middleware 404s it with a noindex shell and sitemap-products.xml stops
   naming it, both without a deploy (docs/seo.md, "The one thing that runs
   before the file"). Nothing told the BUILD, so every prerendered page that
   shows a grid — 3 home pages, 27 category pages, 78 brand pages and the
   shelf under each of 660 product pages — went on carrying an <a href> into
   that address, and Vercel's static layer answers those files before any
   route runs. A crawler and a reader without scripts followed a tile into a
   404 of our own making.

   Note what is NOT a reason. A hidden product's OWN page corrects itself:
   setHead() in app.js rewrites the head from the live feed on every render
   (docs/seo.md, "The static file is a build-time snapshot"), which is why the
   static product pages are still written for all 220 and why the sitemap, not
   the build, decides which of them are offered. That second pass covers the
   page it runs on and nothing else — a grid on ANOTHER page linking into it
   has no such correction, and neither has «Товары из статьи» under an
   article. Those are the places the build has to be right.

   The whole row, not only `hidden`: this is the same three fields
   mapOverride() in src/lib/orders.ts hands the live page, and a reader of
   this file should get the product as the panel has it rather than one
   column of it. The rule for the price on top is not here — it belongs
   wherever the request-time page keeps it, so the two cannot answer
   differently; the visibility rule likewise lives in forSale() in
   src/lib/seo-head.mjs, which the build and the live pages both import.

   Same contract as ./bundles-export.mjs, ./settings-export.mjs and
   ./blog-export.mjs, and the same reason for talking to `pg` directly rather
   than through src/lib/db.ts: `{}` without DATABASE_URL, `{}` when the
   database cannot be reached or the package is not installed, one warning
   line, and the prerender goes on with the file's own products — which is
   exactly what it did before this module existed. A local `npm run prerender`
   has no DATABASE_URL and hides nothing, so the committed pages come out
   byte for byte the same. */

import { sslFor } from "../migrate.mjs";

const MAX_SIZES = 20;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* The ladder as src/lib/orders.ts cleanSizes() reads it — a row the panel
   wrote is trusted no further here than it is there. */
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
    console.warn("! overrides-export: the 'pg' package is not installed — every product shown this run");
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
    console.warn("! overrides-export: could not read the overrides (" + (err && err.message) + ") — every product shown this run");
    return {};
  } finally {
    await client.end().catch(() => {});
  }
}
