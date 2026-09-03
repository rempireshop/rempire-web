#!/usr/bin/env node
/* build-merchant-feed.mjs — generates public/feed/google-shopping.xml
   (Google Merchant Center product feed, RSS 2.0 + g: namespace)
   from public/shop/catalogue2.js + public/shop/content.js.
   Run: node tools/build-merchant-feed.mjs */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://rempireshop.diipsolutions.eu";

/* ---- load shop data (plain script files, evaluated) ---- */
const catSrc = readFileSync(join(ROOT, "public/shop/catalogue2.js"), "utf8");
const CATALOGUE = new Function(catSrc + ";return CATALOGUE")();
const contentSrc = readFileSync(join(ROOT, "public/shop/content.js"), "utf8");
const CONTENT = new Function(contentSrc + ";return CONTENT")();

/* ---- helpers ---- */
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/* decode the handful of HTML entities that appear in CONTENT, so we never
   emit double-escaped text (esc() re-escapes afterwards) */
const decodeEntities = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&rdquo;/g, "”")
    .replace(/&ldquo;/g, "“")
    .replace(/&hellip;/g, "…")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/* strip HTML to plain text: an INLINE tag vanishes, a block tag becomes a
   space, entities decoded, whitespace collapsed. Same rule as stripTags() in
   public/shop2/app.js and tools/prerender-shop2.mjs — turning every tag into a
   space split words that carry markup inside them, and Google Merchant read
   «s trong durable hold» in the Davines clay's description. */
const INLINE_TAGS = /^(?:span|b|i|strong|em|a|u|sup|sub)$/i;
const stripHtml = (html) =>
  decodeEntities(
    String(html)
      .replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (_, tag) => (INLINE_TAGS.test(tag) ? "" : " "))
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();

/* drop the Russian type tail (" — шампунь" etc.) for the EN feed */
const CYRILLIC = /[Ѐ-ӿ]/;
const enName = (name) => {
  const parts = String(name).split(" — ");
  while (parts.length > 1 && CYRILLIC.test(parts[parts.length - 1])) parts.pop();
  return parts.join(" — ").trim();
};

const clip = (s, max) => (s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s);

/* cat -> Google product category (plain text; esc() handles & and >) */
const HAIR = "Health & Beauty > Personal Care > Hair Care";
const GOOGLE_CATEGORY = {
  hair: HAIR,
  styling: HAIR,
  beard: "Health & Beauty > Personal Care > Shaving & Grooming",
  face: "Health & Beauty > Personal Care > Cosmetics > Skin Care",
  body: "Health & Beauty > Personal Care > Cosmetics > Skin Care",
  perfume: "Health & Beauty > Personal Care > Cosmetics > Fragrances",
  merch: "Apparel & Accessories > Clothing",
};

/* ---- build items ---- */
const items = [];
let skippedOut = 0;

for (const p of CATALOGUE) {
  if (p.stock === "out" || !(p.price > 0)) {
    skippedOut++;
    continue;
  }

  const title = clip(`${p.brand} ${enName(p.name)}`.trim(), 150);
  const description = clip(stripHtml(CONTENT[p.id] || "") || title, 5000);
  const availability = p.stock === "in" || p.stock === "low" ? "in stock" : "out of stock";
  const price = `${Number(p.price).toFixed(2)} EUR`;
  const category = GOOGLE_CATEGORY[p.cat];

  const fields = [
    ["g:id", p.id],
    ["g:title", title],
    ["g:description", description],
    ["g:link", `${BASE}/shop2/p/${p.id}/`],
    ["g:image_link", `${BASE}${p.img}`],
    ["g:availability", availability],
    ["g:price", price],
    ["g:brand", p.brand],
    ["g:condition", "new"],
  ];
  if (category) fields.push(["g:google_product_category", category]);

  items.push(
    "  <item>\n" +
      fields.map(([tag, val]) => `   <${tag}>${esc(val)}</${tag}>`).join("\n") +
      "\n  </item>"
  );
}

/* ---- assemble feed ---- */
const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
 <channel>
  <title>REMPIRE Tower Shop</title>
  <link>${esc(`${BASE}/shop2/`)}</link>
  <description>REMPIRE Tower Shop — barbershop-grade hair, beard, skin care and fragrances in Tallinn.</description>
${items.join("\n")}
 </channel>
</rss>
`;

const outDir = join(ROOT, "public/feed");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, "google-shopping.xml");
writeFileSync(outFile, xml, "utf8");

console.log(JSON.stringify({ items: items.length, skippedOut, bytes: Buffer.byteLength(xml, "utf8") }));
