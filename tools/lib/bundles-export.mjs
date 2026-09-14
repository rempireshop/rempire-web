/* What a set costs, straight out of Postgres, for tools/prerender-shop2.mjs.

   The /sets/ pages are written at build time out of public/shop/bundles.js —
   a file the generator produced, and one nothing regenerates when Renat edits
   a set price in «Товары → Наборы». The live shop corrects itself (app.js
   reads GET /api/bundles/ at boot and prefers it), but the прайс baked into
   the static HTML does not: the <title>, the meta description and above all
   the schema.org Offer kept the price the set had on the day of the last
   deploy. That Offer is what a search engine quotes, so a price edit meant a
   search result promising one number and a checkout charging another until
   somebody happened to redeploy.

   Same contract as ./settings-export.mjs and ./blog-export.mjs, and the same
   reason for talking to `pg` directly: `{}` without DATABASE_URL, `{}` when
   the database cannot be reached or the package is not installed, one warning
   line, and the prerender goes on with the file's own numbers — which is
   exactly what it did before this module existed. */

import { sslFor } from "../migrate.mjs";

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** `{ id: { price, discountPct } }` for the rows that exist. */
export async function fetchBundlePrices() {
  const url = process.env.DATABASE_URL;
  if (!url) return {};

  let pg;
  try {
    ({ default: pg } = await import("pg"));
  } catch {
    console.warn("! bundles-export: the 'pg' package is not installed — the file's set prices this run");
    return {};
  }

  const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });
  try {
    await client.connect();
    const res = await client.query("select id, price, discount_pct from bundles");
    const out = {};
    for (const r of res.rows) {
      out[r.id] = {
        price: r.price == null ? null : Number(r.price),
        discountPct: r.discount_pct == null ? null : Number(r.discount_pct),
      };
    }
    return out;
  } catch (err) {
    console.warn("! bundles-export: could not read the sets (" + (err && err.message) + ") — the file's set prices this run");
    return {};
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * The static list with the table's price on it. Mutates nothing: returns a new
 * list, so the caller decides what to write the pages from.
 *
 * `sum` — what the parts cost separately — stays the file's, because that is
 * the catalogue's arithmetic and the catalogue IS the file at build time. Only
 * what the owner sets moves: the price itself, and the «экономия» and percent
 * that are computed from it (the same two lines src/lib/bundles.ts expand()
 * computes, kept in step here).
 *
 * A set with no row (deleted, or a database that did not answer) keeps its own
 * numbers rather than losing them.
 */
export function applyBundlePrices(list, rows) {
  if (!Array.isArray(list) || !rows) return Array.isArray(list) ? list : [];
  return list.map((b) => {
    const row = b && rows[b.id];
    if (!row) return b;
    const sum = Number(b.sum) || 0;
    const price =
      row.price != null && Number.isFinite(row.price)
        ? round2(row.price)
        : row.discountPct != null && Number.isFinite(row.discountPct)
          ? round2(sum * (1 - row.discountPct / 100))
          : null;
    if (price == null || price < 0 || Math.abs(price - Number(b.price)) < 0.005) return b;
    const save = round2(Math.max(0, sum - price));
    return { ...b, price, save, pct: sum > 0 ? Math.round((save / sum) * 100) : 0 };
  });
}
