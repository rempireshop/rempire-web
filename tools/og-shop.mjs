#!/usr/bin/env node
/**
 * The shop's own link-preview cards — the picture Telegram, WhatsApp and
 * Facebook show for rempireshop.com, a section, a brand page and every page
 * that has no card of its own (product pages draw theirs in
 * tools/prerender-shop2.mjs).
 *
 *   node tools/og-shop.mjs            → public/og-shop-{en,et,ru}.png + public/og-shop.png (= en)
 *
 * Until 08.10.2026 /og-shop.png was a hand-made picture from 27.08 reading
 * «НОВЫЙ МАГАЗИН … 95 ТОВАРОВ … ЧЕРНОВИК ДЛЯ РЕНАТА», with no generator
 * behind it, so it was still what every shared link showed after the launch
 * (Dim, 08.10.2026). This is that generator. Every number on the card is read
 * from the data (the product count from src/data/catalogue.min.json), never
 * typed here, so it cannot drift the way «95 товаров» did.
 *
 * Rendered by Chromium (Playwright, already a devDependency for e2e) from an
 * HTML page, not by sharp's SVG text: the card is set in the shop's own
 * Oswald and Golos Text, which are files in public/fonts/ and not installed
 * fonts, and only a browser loads a @font-face from a file. The layout is the
 * one the 27.08 card used (public/shop/_og.html): cream ground, the tower
 * lockup, an uppercase Oswald headline, outlined chips, real product
 * cut-outs on the right, the ink rule along the foot.
 *
 * The output is committed, like the other OG images: a link preview must work
 * on a fresh clone with no build.
 */
import { readFile, writeFile, copyFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "public");
/* OG_OUT=<dir> draws the cards somewhere else — a draft to look at before it
   replaces the committed files. */
const OUT = process.env.OG_OUT ? path.resolve(process.env.OG_OUT) : PUB;
const W = 1200, H = 630;

const catalogue = JSON.parse(await readFile(path.join(ROOT, "src/data/catalogue.min.json"), "utf8"));
const PRODUCTS = (Array.isArray(catalogue) ? catalogue : catalogue.items).length;
/* Rounded down to a ten: «220+» stays true while products come and go by a
   few, and the card is regenerated when the catalogue moves by more. */
const COUNT = Math.floor(PRODUCTS / 10) * 10;

/** Russian plural for a count. */
function ruPlural(n, one, few, many) {
  const t = n % 100, u = n % 10;
  if (t >= 11 && t <= 14) return many;
  if (u === 1) return one;
  if (u >= 2 && u <= 4) return few;
  return many;
}

/* The words. Headline in two lines, one sentence under it, three chips.
   The headline is Dim's line, 08.10.2026: «JUUKSED. HABE. STIIL.», mirrored
   in the other two languages. The sentence under it carries the category
   words people actually search for (Search Console: «habemehooldus»,
   «habemeõli»). */
const CARDS = {
  en: {
    lang: "en",
    head: ["Hair. Beard.", "Style."],
    sub: "Hair and beard care, skin care and niche perfume in Tallinn. Kevin.Murphy, System 4, Davines, Proraso and more.",
    chips: [`${COUNT}+ products`, "Pickup · Mardi 1", "Delivery EE · LV · LT · FI"],
  },
  et: {
    lang: "et",
    head: ["Juuksed. Habe.", "Stiil."],
    sub: "Juukse- ja habemehooldus, habemeõlid, nahahooldus ja nišiparfüümid Tallinnas. Kevin.Murphy, System 4, Davines, Proraso jt.",
    chips: [`${COUNT}+ toodet`, "Järeletulek · Mardi 1", "Tarne EE · LV · LT · FI"],
  },
  ru: {
    lang: "ru",
    head: ["Волосы. Борода.", "Стиль."],
    sub: "Уход за волосами, бородой и кожей, нишевая парфюмерия в Таллинне. Kevin.Murphy, System 4, Davines, Proraso и другие.",
    chips: [`${COUNT}+ ${ruPlural(COUNT, "товар", "товара", "товаров")}`, "Самовывоз · Mardi 1", "Доставка EE · LV · LT · FI"],
  },
};

/* The cut-outs: one per line the shop is known for — scalp care, styling,
   beard, perfume, and Rempire's own soap. */
const SHOTS = [
  "system-4-bio-botanical-shampoo-0.webp",
  "night-rider-0.webp",
  "captain-fawcett-beard-oil-cf-332-private-stock-0.webp",
  "xerjoff-tony-iommi-monkey-special-50ml-0.webp",
  "handmade-soap-666-0.webp",
];

const fileUrl = (p) => pathToFileURL(p).href;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const towerSvg = await readFile(path.join(PUB, "brand", "rempire-tower.svg"), "utf8");

function page(c) {
  const img = (i) => fileUrl(path.join(PUB, "shop", "img", SHOTS[i]));
  return `<!doctype html><html lang="${c.lang}"><head><meta charset="utf-8"><style>
@font-face{font-family:Oswald;src:url("${fileUrl(path.join(PUB, "fonts", "Oswald-Medium.ttf"))}")}
@font-face{font-family:"Golos Text";src:url("${fileUrl(path.join(PUB, "fonts", "GolosText-Regular.ttf"))}")}
*{box-sizing:border-box;margin:0}
body{width:${W}px;height:${H}px;background:#edeae1;color:#1c1a00;font-family:"Golos Text",sans-serif;overflow:hidden;position:relative}
.wrap{position:absolute;inset:0;display:flex;align-items:center;padding:0 0 0 72px}
.left{flex:0 0 600px;min-width:0}
.lockup{display:flex;align-items:center;gap:14px;margin-bottom:38px}
.lockup svg{height:56px;width:auto;color:#1c1a00}
.word{font-family:Oswald,sans-serif;font-size:26px;letter-spacing:.3em;text-transform:uppercase}
h1{font-family:Oswald,sans-serif;font-weight:500;font-size:70px;line-height:1;text-transform:uppercase;letter-spacing:.01em;margin-bottom:24px}
.sub{font-size:23px;line-height:1.45;color:#4f4c3c;max-width:25ch;margin-bottom:32px}
.meta{display:flex;gap:10px;flex-wrap:wrap;max-width:560px}
.chip{font-family:Oswald,sans-serif;font-size:14px;letter-spacing:.12em;text-transform:uppercase;border:1px solid rgba(28,26,0,.4);padding:8px 12px;white-space:nowrap}
.right{position:absolute;right:0;top:0;width:560px;height:100%}
/* The product photos are shot on white; multiply lets the cream ground show
   through the white instead of a pale rectangle around every bottle. */
.p{position:absolute;background-size:contain;background-position:center bottom;background-repeat:no-repeat;mix-blend-mode:multiply}
.p0{width:290px;height:390px;right:150px;top:95px;z-index:1}
.p1{width:210px;height:140px;right:330px;top:120px;z-index:2}
.p2{width:150px;height:250px;right:350px;top:300px;z-index:3}
.p3{width:170px;height:260px;right:24px;top:190px;z-index:2}
.p4{width:170px;height:130px;right:170px;top:445px;z-index:4}
.rule{position:absolute;left:0;right:0;bottom:0;height:10px;background:#1c1a00}
</style></head><body>
<div class="wrap"><div class="left">
<div class="lockup">${towerSvg.replace(/<\?xml[^>]*>/, "")}<span class="word">Rempire</span></div>
<h1>${c.head.map(esc).join("<br>")}</h1>
<p class="sub">${esc(c.sub)}</p>
<div class="meta">${c.chips.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>
</div></div>
<div class="right">${SHOTS.map((_, i) => `<div class="p p${i}" style="background-image:url('${img(i)}')"></div>`).join("")}</div>
<div class="rule"></div>
</body></html>`;
}

const browser = await chromium.launch();
try {
  const tab = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  for (const [code, c] of Object.entries(CARDS)) {
    const html = path.join(os.tmpdir(), `rempire-og-shop-${code}.html`);
    await writeFile(html, page(c));
    await tab.goto(fileUrl(html));
    await tab.evaluate(() => document.fonts.ready);
    const out = path.join(OUT, `og-shop-${code}.png`);
    await tab.screenshot({ path: out, clip: { x: 0, y: 0, width: W, height: H } });
    await rm(html, { force: true });
    console.log("✓", out);
  }
} finally {
  await browser.close();
}
/* The unsuffixed file stays as the fallback every older page and
   OG_FALLBACK in src/lib/seo-head.mjs point at — the English card, English
   being the language without a prefix. */
await copyFile(path.join(OUT, "og-shop-en.png"), path.join(OUT, "og-shop.png"));
console.log("✓", path.join(OUT, "og-shop.png"), "(= en)");
