/* What the owner has done to a catalogue product's price, and which products
   he has switched off, straight out of Postgres, for tools/prerender-shop2.mjs.

   The prerendered blog pages are the reason this exists. «Товары из статьи»
   and the product cards inside the text were built from the generated file
   (public/shop/catalogue2.js) and from nothing else, so a static article
   carried the prices of the day of the deploy and went on linking to a
   product the owner had since hidden — a /p/ address the middleware now
   answers 404 noindex for (docs/seo.md, "The one thing that runs before the
   file"). That is not a small window: Vercel's static layer answers a
   prerendered index.html before any route runs, so for every post that
   existed at the last deploy the STATIC copy is the one that gets served,
   and src/lib/blog-page.ts — which has read both columns correctly since
   17.09.2026 — is the path that almost never runs.

   Only the blog reads this. The static PRODUCT pages deliberately do not:
   setHead() in app.js rewrites the head of a product page from the live feed
   on every render, so the page a crawler indexes is corrected in the browser
   (docs/seo.md, "The static file is a build-time snapshot"). An article's
   shelf has no such second pass — nothing rebuilds «Товары из статьи» after
   the paint — which is why it is the one place the build has to be right.

   Same contract as ./bundles-export.mjs, ./settings-export.mjs and
   ./blog-export.mjs, and the same reason for talking to `pg` directly rather
   than through src/lib/db.ts: `{}` without DATABASE_URL, `{}` when the
   database cannot be reached or the package is not installed, one warning
   line, and the prerender goes on with the file's own numbers — which is
   exactly what it did before this module existed. A local `npm run prerender`
   has no DATABASE_URL, writes no /blog/ pages at all, and never reaches any
   of this. */

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
    console.warn("! overrides-export: the 'pg' package is not installed — the file's prices this run");
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
    console.warn("! overrides-export: could not read the price overrides (" + (err && err.message) + ") — the file's prices this run");
    return {};
  } finally {
    await client.end().catch(() => {});
  }
}
