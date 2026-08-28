/* Shareable product URLs with their own link preview.

   The shop is one static page driven by client-side state, so sharing any
   product shared /shop/ and produced the same generic card. This writes a
   real page per product at /shop/p/<id>/ carrying that product's OG tags,
   plus a 1200x630 card image with the cutout on the brand ground.

   The page loads the very same app (absolute /shop/... asset paths), so the
   URL survives — it is a deep link, not a redirect — and scrapers, which do
   not run JS, read the meta straight out of the HTML. */

import { writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const run = promisify(execFile);
const ROOT = "C:/Users/Dmitri.MARKIT/source/repos/rempire-web/public";
const SHOP = path.join(ROOT, "shop");
const OGDIR = path.join(SHOP, "og");
const PDIR = path.join(SHOP, "p");
const BASE = "https://rempireshop.diipsolutions.eu";

const SHELL = "#edeae1";
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = n => (Math.round(n * 100) / 100).toFixed(2).replace(".", ",").replace(",00", "") + " €";

const src = await readFile(path.join(SHOP, "catalogue.js"), "utf8");
const CATALOGUE = new Function(src + "\nreturn CATALOGUE;")();
const CAT_NAMES = new Function(src + "\nreturn CAT_NAMES;")();

await rm(PDIR, { recursive: true, force: true });
await mkdir(OGDIR, { recursive: true });
await mkdir(PDIR, { recursive: true });

const towerPng = path.join(OGDIR, "_tower.png");
await run("magick", [
  "-background", "none", path.join(ROOT, "brand", "rempire-tower.svg"),
  "-resize", "x64", "-fill", "#1c1a00", "-colorize", "100", towerPng
]);

let made = 0;
for (const p of CATALOGUE) {
  const imgFile = path.join(ROOT, p.img.replace(/^\//, ""));
  const og = path.join(OGDIR, p.id + ".jpg");

  /* Card: the cutout centred on the brand ground with the tower in the
     corner. No text drawn here — the title and price travel as OG text
     fields, which every platform renders in its own type. */
  await run("magick", [
    "-size", "1200x630", `xc:${SHELL}`,
    "(", imgFile, "-resize", "460x460", ")", "-gravity", "center", "-composite",
    "(", towerPng, ")", "-gravity", "northwest", "-geometry", "+56+48", "-composite",
    "-quality", "84", og
  ]);

  const title = `${p.brand} — ${p.name}`;
  const price = (p.priceFrom ? "от " : "") + eur(p.price);
  const stock = p.stock === "out" ? "Нет в наличии" : p.stock === "low" ? "Мало на складе" : "В наличии";
  const desc = `${price} · ${CAT_NAMES[p.cat]} · ${stock}. Магазин Rempire, Таллинн — доставка Omniva, SmartPosti и DPD, самовывоз на Mardi 1.`;
  const url = `${BASE}/shop/p/${p.id}/`;

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} — REMPIRE</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="noindex, nofollow">
<link rel="canonical" href="${url}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="REMPIRE">
<meta property="og:locale" content="ru_RU">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${BASE}/shop/og/${p.id}.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(title)}">
<meta property="product:price:amount" content="${p.price}">
<meta property="product:price:currency" content="EUR">
<meta property="product:availability" content="${p.stock === "out" ? "out of stock" : "in stock"}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${BASE}/shop/og/${p.id}.jpg">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600&family=Golos+Text:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/shop/styles.css">
</head>
<body>
<div id="app"></div>
<script src="/shop/catalogue.js"></script>
<script src="/shop/paylogos.js"></script>
<script src="/shop/shipping-data.js"></script>
<script src="/shop/app.js"></script>
<script src="/feedback.js" defer></script>
</body>
</html>
`;
  await mkdir(path.join(PDIR, p.id), { recursive: true });
  await writeFile(path.join(PDIR, p.id, "index.html"), html, "utf8");
  made++;
}

await rm(towerPng, { force: true });
console.log(`wrote ${made} product pages and ${made} OG cards`);
