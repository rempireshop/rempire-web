/* The sets, straight out of Postgres, for tools/prerender-shop2.mjs.

   Until 07.11.2026 the /sets/ pages were written out of public/shop/bundles.js
   — a file tools/build-bundles.mjs generated in September, and one nothing
   regenerates when Renat edits a set in «Товары → Наборы». This module only
   moved the PRICE across from the table, and only onto the sets the file
   already had. So on the live shop, with 37 sets on sale:
     · the 30 Renat had made in the panel had no static page at all — Google,
       a link preview and the sitemap saw the shop's generic home text;
     · the 7 the file did know kept its September contents under the
       table's price: «Борода — стартовый набор» was described, listed and
       marked up as oil, balm and SOAP at 49,82 €, while the set Renat sells
       at that price is oil, aftershave lotion and balm.
   The live shop corrected itself (app.js reads GET /api/bundles/ at boot);
   the copy a search engine indexes did not.

   So the build now reads the whole set from the table — names, texts, parts,
   photo, order, price — and expands it against the build's own catalogue the
   way src/lib/bundles.ts expand() expands it for GET /api/bundles/.

   Same contract as ./settings-export.mjs and ./blog-export.mjs, and the same
   reason for talking to `pg` directly: no answer without DATABASE_URL, none
   when the database cannot be reached or the package is not installed, one
   warning line, and the prerender goes on with the file's own sets — which is
   exactly what a local run without a database has always done.

   «No answer» is `null`, and it is not the same thing as `[]`. `[]` is a
   database that answered «no sets» — the shop after the go-live reset — and
   writes no /sets/ pages, no sitemap rows and no «Наборы» link; `null` is one
   that was never asked, and only that falls back to the file. */

import { sslFor } from "../migrate.mjs";

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v, fallback = 0) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Every row of `bundles`, as `pg` returns them, or `null` when there was no
 * database to ask. `select *` rather than a column list, for the reason
 * fetchProductOverrides() gives: the build runs before the migrations, and a
 * column the deploy itself adds must not fail the whole query.
 */
export async function fetchBundleRows() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;

  let pg;
  try {
    ({ default: pg } = await import("pg"));
  } catch {
    console.warn("! bundles-export: the 'pg' package is not installed — the file's sets this run");
    return null;
  }

  const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });
  try {
    await client.connect();
    const res = await client.query("select * from bundles");
    return res.rows;
  } catch (err) {
    console.warn("! bundles-export: could not read the sets (" + (err && err.message) + ") — the file's sets this run");
    return null;
  } finally {
    await client.end().catch(() => {});
  }
}

/** parseItems() in src/lib/bundles.ts: jsonb arrives parsed on `pg`, a text column would not. */
function parseItems(raw) {
  let list = raw;
  if (typeof raw === "string") {
    try { list = JSON.parse(raw); } catch { list = null; }
  }
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const it of list) {
    if (!it || typeof it !== "object") continue;
    const productId = String(it.productId ?? it.id ?? "").trim();
    if (!productId) continue;
    out.push({
      productId,
      variant: Math.max(0, Math.trunc(num(it.variant ?? it.size, 0))),
      qty: Math.max(1, Math.trunc(num(it.qty, 1))),
    });
  }
  return out;
}

/**
 * What one part of a set costs at one volume, and what that volume is called
 * — partPrice() in src/lib/bundles.ts, read off the build's catalogue
 * (public/shop/catalogue2.js: `price`, `prices`, `sizes`) and one row of
 * fetchProductOverrides() (`price`, `sizes`).
 *
 * The ladder the owner saved decides both wherever it exists. Below it the
 * file decides the volumes, and a price override is set on the base volume
 * and moves the others by the same premium. A volume index the ladder does
 * not have reads as the first one, as it does on the server.
 */
export function setPartPrice(p, variant, row) {
  const own = row && Array.isArray(row.sizes) && row.sizes.length && !(row.sizes.length === 1 && !row.sizes[0].size)
    ? row.sizes : null;
  if (own) {
    const i = variant >= 0 && variant < own.length ? variant : 0;
    const at = num(own[i].price, NaN);
    return { label: String(own[i].size || ""), price: round2(Number.isFinite(at) ? at : num(own[0].price)) };
  }
  const sizes = p && Array.isArray(p.sizes) ? p.sizes : [];
  const prices = p && Array.isArray(p.prices) ? p.prices : [];
  const basePrice = p ? num(p.price) : 0;
  let label = "";
  let at = null;
  if (sizes.length) {
    const i = variant >= 0 && variant < sizes.length ? variant : 0;
    label = String(sizes[i]);
    const v = num(prices[i], NaN);
    at = Number.isFinite(v) ? v : null;
  }
  const base = at != null ? at : basePrice;
  const premium = at != null && p ? at - basePrice : 0;
  return { label, price: row && row.price != null ? round2(num(row.price) + premium) : round2(base) };
}

/** partStock() in src/lib/bundles.ts, minus the counted quantities the build does not have. */
function partStock(p, row) {
  if (row && row.hidden) return "out";
  const word = (row && row.stock) || (p && p.stock) || "in";
  return word === "out" || word === "low" ? word : "in";
}

const worst = (list) => (list.includes("out") ? "out" : list.includes("low") ? "low" : "in");

/**
 * The owner's chosen photo, if it is one the build may use: a web address, or
 * a path of the site's own that cannot climb out of public/ — no «..», no
 * backslash, neither one percent-encoded (unsafeSitePath() in
 * src/lib/bundles.ts refuses the same on save). drawCard() reads a site path
 * off the disk, so this is what keeps a row written around the panel from
 * pointing the build at a file outside public/. Anything else → null, and the
 * set falls back to its parts' photos.
 */
export function safeSetImage(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^(https?:)?\/\//i.test(s)) return /^(https?:)?\/\/[^\s"'<>]+$/i.test(s) ? s : null;
  if (!s.startsWith("/")) return null;
  if (/\\|%2e|%5c|%2f/i.test(s) || /(^|\/)\.\.(\/|$)/.test(s) || /[\s"'<>]/.test(s)) return null;
  return s;
}

/**
 * The sets on sale, in the panel's order, in the shape public/shop/bundles.js
 * has always had — which is the shape every set reader in the prerender (the
 * /sets/ grid, the /set/ page, its Offer, the sitemap, the og:image, #setsdata)
 * already takes.
 *
 * `catalogue` is the build's catalogue with the owner's names and stock word
 * already folded in (CATALOGUE in tools/prerender-shop2.mjs); `overrides` is
 * fetchProductOverrides(), for the owner's prices, ladders and «Показывать в
 * магазине». The numbers are expand()'s: what the parts cost separately, the
 * table's price (or its percent, or no discount at all), the saving and its
 * percent. The photos are app.js hydrateBundles()'s: the one the owner chose —
 * a product id or a URL — else the first three parts'.
 */
export function setsFromRows(rows, catalogue, overrides = {}) {
  if (!Array.isArray(rows)) return [];
  const byId = new Map((catalogue || []).map((p) => [p.id, p]));
  const ov = overrides || {};

  return rows
    .filter((r) => r && r.id && r.active !== false)
    .sort((a, b) => num(a.sort) - num(b.sort) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0))
    .map((r) => {
      const items = parseItems(r.items).map((it) => {
        const p = byId.get(it.productId);
        const o = ov[it.productId];
        const part = setPartPrice(p, it.variant, o);
        return {
          id: it.productId,
          size: it.variant,
          qty: it.qty,
          brand: p ? p.brand : "",
          name: p ? p.name : it.productId,
          sizeLabel: part.label,
          price: part.price,
          img: p ? p.img : "",
          stock: partStock(p, o),
        };
      });

      const sum = round2(items.reduce((a, it) => a + it.price * it.qty, 0));
      const pct = r.discount_pct == null ? null : round2(num(r.discount_pct));
      const stored = r.price == null ? null : round2(num(r.price));
      const price = stored != null ? stored : pct != null ? round2(sum * (1 - pct / 100)) : sum;
      const save = round2(Math.max(0, sum - price));

      const chosen = r.image
        ? (/^(https?:)?\/\/|^\//.test(String(r.image)) ? safeSetImage(r.image) : (byId.get(String(r.image)) || {}).img || null)
        : null;
      const images = chosen ? [chosen] : items.map((it) => it.img).filter(Boolean).slice(0, 3);

      return {
        id: String(r.id),
        cat: r.cat || "body",
        title: { RU: r.name_ru || String(r.id), ET: r.name_et || "", EN: r.name_en || "" },
        desc: { RU: r.desc_ru || "", ET: r.desc_et || "", EN: r.desc_en || "" },
        items,
        sum,
        price,
        save,
        pct: sum > 0 ? Math.round((save / sum) * 100) : 0,
        images,
        stock: items.length ? worst(items.map((it) => it.stock)) : "out",
      };
    })
    /* validateBundle() never stores a set with fewer than two parts; a row
       written some other way with none at all gets no page rather than one
       the set page cannot draw (it reads items[0] for its card). */
    .filter((b) => b.items.length);
}
