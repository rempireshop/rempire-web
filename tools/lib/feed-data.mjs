/* The half of a Merchant Center item the server has no copy of — built from
   the files the storefront itself runs on.

   The Google feed (src/lib/merchant-feed.ts, behind /feed/google-<lang>.xml)
   is answered at request time, because stock, prices and «Показывать в
   магазине» change while the deployment stands still. Everything it needs
   that moves is in the database or in src/data already: the product row
   (catalogue.min.json), the size ladder (catalogue.variants.json), the
   owner's overrides. Two things are not. The photos and the product texts
   live only in public/shop/catalogue2.js and public/shop/content*.js — plain
   scripts the browser loads, which a Vercel function cannot read (everything
   under public/ goes to the static layer; see outputFileTracingIncludes in
   next.config.ts and docs/merchant-feed.md).

   So this cuts those two things out, once, into src/data/catalogue.feed.json,
   which the route imports like the other catalogue files. `npm run build`
   regenerates it in `prebuild` (tools/pack-feed.mjs), and
   tests/merchant-feed.test.ts fails the moment the committed copy stops being
   what these files would give — the same arrangement catalogue.variants.json
   has with catalogue2.js.

   Per product:
     img  the photos, in the storefront's order — `gallery`, or `img`/`img2`
          where the file has no gallery — site-relative, exactly as written;
     vi   the per-size photo map (`varImg`), when the file has one;
     d    the description per language, already plain text: RU from
          content.ru.js, ET from content.et.js, EN from content.js (which is
          the shop's own English source text). A language with no text is
          simply absent, and the feed falls back the way descFor() in
          public/shop2/app.js does. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { merchantText } from "../../src/lib/seo-head.mjs";

/** A generated storefront script's one global, evaluated — the prerender reads these files the same way. */
function loadGlobal(root, file, name) {
  const src = readFileSync(path.join(root, "public", "shop", file), "utf8");
  return new Function(src + "\nreturn " + name + ";")();
}

/** `{ id: { img, vi?, d } }` for every product in public/shop/catalogue2.js, in its order. */
export function buildFeedData(root) {
  const catalogue = loadGlobal(root, "catalogue2.js", "CATALOGUE");
  const texts = [
    ["EN", loadGlobal(root, "content.js", "CONTENT")],
    ["RU", loadGlobal(root, "content.ru.js", "CONTENT_RU")],
    ["ET", loadGlobal(root, "content.et.js", "CONTENT_ET")],
  ];
  const out = {};
  for (const p of catalogue) {
    const photos = Array.isArray(p.gallery) && p.gallery.length ? p.gallery : [p.img, p.img2];
    const img = [...new Set(photos.filter((u) => typeof u === "string" && u.trim()).map((u) => u.trim()))];
    const row = { img };
    if (Array.isArray(p.varImg) && p.varImg.length) row.vi = p.varImg.map((n) => Number(n) || 0);
    const d = {};
    for (const [code, table] of texts) {
      const text = merchantText(table[p.id] || "");
      if (text) d[code] = text;
    }
    row.d = d;
    out[p.id] = row;
  }
  return out;
}

/** The file as it is committed: one-space indent like catalogue.variants.json, LF, a final newline. */
export function serialiseFeedData(data) {
  return JSON.stringify(data, null, 1) + "\n";
}
