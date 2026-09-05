/* Reads a handful of `settings` rows straight out of Postgres, for
   tools/prerender-shop2.mjs — the static «Доставка и оплата» page prints the
   live tariff table (settings.shipping_rules) and the loyalty earn rate
   (settings.pricing.loyalty), so a deploy after the owner changed a price in
   «Настройки → Доставка» writes that price into the page a crawler reads.
   The live shop re-renders the same page from /api/overrides at boot, so the
   two only ever differ between a tariff change and the next deploy.

   Same contract as fetchPublishedPosts() in ./blog-export.mjs, and the same
   reasons for talking to `pg` directly: `{}` without DATABASE_URL, `{}` when
   the database cannot be reached or the package is not installed, one
   warning line, and the prerender goes on with the built-in defaults. */

import { sslFor } from "../migrate.mjs";

/**
 * `{ key: value }` for the rows that exist. jsonb comes back parsed; a row
 * written by hand as a JSON string is parsed here so the caller never has to
 * ask which it got.
 */
export async function fetchSettings(keys) {
  const url = process.env.DATABASE_URL;
  if (!url || !Array.isArray(keys) || !keys.length) return {};

  let pg;
  try {
    ({ default: pg } = await import("pg"));
  } catch {
    console.warn("! settings-export: the 'pg' package is not installed — built-in delivery defaults this run");
    return {};
  }

  const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });
  try {
    await client.connect();
    const res = await client.query("select key, value from settings where key = any($1::text[])", [keys]);
    const out = {};
    for (const r of res.rows) {
      let v = r.value;
      if (typeof v === "string") {
        try { v = JSON.parse(v); } catch { continue; }
      }
      out[r.key] = v;
    }
    return out;
  } catch (err) {
    console.warn("! settings-export: could not read settings (" + (err && err.message) + ") — built-in delivery defaults this run");
    return {};
  } finally {
    await client.end().catch(() => {});
  }
}
