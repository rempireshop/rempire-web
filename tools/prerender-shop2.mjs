/* Static pages for the shop2 storefront — one per screen per language.
   `npm run prerender`

   The shop is a vanilla-JS SPA: one shell, every screen drawn by app.js. That
   is fine for a shopper and useless for a search engine, which indexes what
   the HTML says before any script runs. This writes that HTML out:

     public/shop2/{,et/,en/}index.html            three home pages
     public/shop2/{,et/,en/}c/<cat>/index.html    category pages
     public/shop2/{,et/,en/}b/<brand>/index.html  brand pages
     public/shop2/{,et/,en/}p/<id>/index.html     product pages
     public/shop2/{,et/,en/}info/<slug>/index.html  the policy pages
     public/shop2/{,et/,en/}sets/index.html       the sets landing
     public/shop2/{,et/,en/}set/<id>/index.html   one set
     public/shop2/{,et/,en/}gift/index.html       the gift card

   Each carries a full head (title, description, canonical, the hreflang
   cluster, OpenGraph/Twitter, JSON-LD) and, inside #app, the screen's real
   content — name, brand, price, sizes, description, image with alt, and
   crawlable links to everything next to it. app.js finds that block under
   `#prerender`, leaves it alone until its own first render has painted, and
   then drops it, so nothing ever blanks or flashes.

   The paths are the ones app.js itself pushes to history (pathFor()), so a
   crawled URL and a clicked URL are the same address — including the
   singular /set/<id>/ for one set beside the plural /sets/ for the landing.

   Nothing here is hand-written twice: the asset tags come out of
   public/shop2/index.html (including its ?v= token) and the translation
   tables come out of public/shop2/app.js, so a prerendered title and the one
   app.js sets a moment later are the same string.

   Every page's og:image is a 1 200×630 asset that exists on disk — the cards
   for the products that had none are generated here with sharp, so the card
   type is `summary_large_image` everywhere and never a promise the image
   cannot keep. A .webp og:image, which is what the 125 card-less products
   used to advertise, renders no preview at all on Facebook, WhatsApp or
   LinkedIn.

   Also writes public/sitemap.xml (with xhtml:link alternates) and the two
   robots policies — public/robots.txt is written to match $PUBLIC_BASE_URL,
   so staging and production cannot disagree. Base URL: $PUBLIC_BASE_URL,
   default the live domain. See docs/seo.md. */

import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "public");
const SHOP2 = path.join(PUB, "shop2");
const SHOP = path.join(PUB, "shop");

const BASE_ENV = process.env.PUBLIC_BASE_URL;
const BASE = String(BASE_ENV || "https://rempireshop.com").replace(/\/+$/, "");

/* Staging must not be indexed even if the X-Robots-Tag header is ever lost,
   so the robots meta and public/robots.txt both follow the base URL rather
   than a separate switch — one fact, one decision.

   Opening the site takes an **explicit** PUBLIC_BASE_URL on the live domain,
   not merely the absence of the variable. The URL default stays what it has
   always been (docs assume it, so do the other tools), but a bare
   `npm run prerender` or a local `npm run build` — npm does not load
   .env.local for a lifecycle script — used to write "index, follow" into 810
   pages and replace robots.txt with the open policy, silently, in a working
   tree somebody might commit. It happened during this very build wave. The
   fail-safe direction is closed, and the mismatch it leaves (live URLs,
   noindex) is not shippable by accident: check-prerender.mjs compares
   robots.txt against the host in the sitemap and fails on exactly that. */
const LIVE = !!BASE_ENV && /(^|\.)rempireshop\.com$/i.test(new URL(BASE).hostname);
const ROBOTS = LIVE ? "index, follow, max-image-preview:large" : "noindex, nofollow";
if (!BASE_ENV) {
  console.warn("! PUBLIC_BASE_URL is not set — using " + BASE + " for absolute URLs but writing " +
    "noindex and the closed robots.txt. Set it explicitly, at the switch too.");
}

const LANGS = [
  { code: "RU", seg: "", tag: "ru", htmlLang: "ru", ogLocale: "ru_RU" },
  { code: "ET", seg: "et", tag: "et", htmlLang: "et", ogLocale: "et_EE" },
  { code: "EN", seg: "en", tag: "en", htmlLang: "en", ogLocale: "en_US" }
];

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const eur = n => (Math.round(n * 100) / 100).toFixed(2).replace(".", ",").replace(",00", "") + " €";
/* Same rule as stripTags() in public/shop2/app.js: an inline tag vanishes, a
   block tag becomes a space. Turning every tag into a space split words that
   carry markup inside them — «s<b>trong</b>» came out as «s trong». */
const INLINE_TAGS = /^(?:span|b|i|strong|em|a|u|sup|sub)$/i;
const stripTags = h => String(h || "")
  .replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (_, tag) => (INLINE_TAGS.test(tag) ? "" : " "))
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ")
  .trim();
const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* Cut at a word, not mid-word: a description that ends "…профессионал" reads
   as a broken page in a result listing. */
function clip(s, max) {
  const t = String(s || "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,;:·—–-]+$/, "") + "…";
}

/* ---------- catalogue + content ---------------------------------------- */

const catSrc = await readFile(path.join(SHOP, "catalogue2.js"), "utf8");
const CATALOGUE = new Function(catSrc + "\nreturn CATALOGUE;")();
const CAT_NAMES = new Function(catSrc + "\nreturn CAT_NAMES;")();

const loadObj = async (file, name) => {
  try { return new Function(await readFile(path.join(SHOP, file), "utf8") + "\nreturn " + name + ";")(); }
  catch { return {}; }
};
const CONTENT = await loadObj("content.js", "CONTENT");
const CONTENT_RU = await loadObj("content.ru.js", "CONTENT_RU");
const CONTENT_ET = await loadObj("content.et.js", "CONTENT_ET");

function descFor(p, code) {
  if (code === "RU" && CONTENT_RU[p.id]) return CONTENT_RU[p.id];
  if (code === "ET" && CONTENT_ET[p.id]) return CONTENT_ET[p.id];
  return CONTENT[p.id] || "";
}

/* ---------- policy pages and sets ---------------------------------------

   legalFor() mirrors the function of the same name in app.js exactly, plus
   one step app.js does not have yet: a LEGAL_EN, if public/shop/legal.en.js
   is ever written. Until it is, English falls back to LEGAL — whose bodies
   are English and whose *titles* are Russian (docs/audit item 14). The title
   is therefore taken through the interface dictionary rather than printed
   raw, so the English policy page does not carry a Russian <title>.

   BUNDLES is optional in app.js (`typeof BUNDLES === "undefined"` → no
   sets), so it is optional here: no file, no set pages, no sitemap rows. */

const LEGAL = await loadObj("legal.js", "LEGAL");
const LEGAL_RU = await loadObj("legal.ru.js", "LEGAL_RU");
const LEGAL_ET = await loadObj("legal.et.js", "LEGAL_ET");
const LEGAL_EN = await loadObj("legal.en.js", "LEGAL_EN");
if (!Object.keys(LEGAL_EN).length) {
  console.log("  (no public/shop/legal.en.js — English policy pages fall back to LEGAL)");
}

/* The router in app.js gates on LEGAL[slug], so that is the list of slugs
   that can be reached — a page only in a translation would 404 on a cold
   load. */
const LEGAL_SLUGS = Object.keys(LEGAL);

/* content: the policy texts no longer freeze a company identity — they carry
   {{legalName}} / {{regCode}} / {{address}} / {{email}} / {{phone}}, and
   public/shop2/app.js fills them in from settings.content when it renders
   (cResolve()). A prerendered page has no settings to read, so it prints the
   build-time defaults.

   Those defaults are not typed out here any more: tools/pack-content.mjs
   writes src/data/content.default.json straight out of DEFAULT_CONTENT in
   src/lib/content.ts, and this reads that. The two copies had already drifted
   — the Organization `sameAs` below used to publish instagram.com/rempireshop/
   while the shop links instagram.com/rempire.shop/ (docs/seo.md, "Known
   gaps"). `prebuild` regenerates the JSON before every build; a bare
   `npm run prerender` in a tree that has never built falls back to the values
   below and says so. */
const SHOP_CONTENT_FALLBACK = {
  company: {
    legalName: "Rempire Store OÜ",
    regCode: "12216136",
    vatNumber: "EE102723858",
    address: "Mardi 1, 10145 Tallinn",
    email: "info@rempireshop.com",
    phone: "+372 5623 7237",
    iban: "",
  },
  hours: { mon: "", tue: "", wed: "", thu: "", fri: "", sat: "", sun: "", note: { RU: "", ET: "", EN: "" } },
  social: {},
  contactPage: { RU: "", ET: "", EN: "" },
};
const SHOP_CONTENT = await (async () => {
  const file = path.join(ROOT, "src", "data", "content.default.json");
  if (!existsSync(file)) {
    console.log("  (no src/data/content.default.json — run `npm run pack:content`; using built-in defaults)");
    return SHOP_CONTENT_FALLBACK;
  }
  try {
    const j = JSON.parse(await readFile(file, "utf8"));
    return {
      company: { ...SHOP_CONTENT_FALLBACK.company, ...(j.company || {}) },
      hours: { ...SHOP_CONTENT_FALLBACK.hours, ...(j.hours || {}) },
      social: j.social && typeof j.social === "object" ? j.social : {},
      contactPage: { ...SHOP_CONTENT_FALLBACK.contactPage, ...(j.contactPage || {}) },
    };
  } catch (err) {
    console.log("  (src/data/content.default.json is unreadable: " + err.message + "; using built-in defaults)");
    return SHOP_CONTENT_FALLBACK;
  }
})();
const IDENTITY = SHOP_CONTENT.company;
function resolveIdentity(html) {
  if (!html || html.indexOf("{{") < 0) return html;
  return html.replace(/\{\{([a-zA-Z]{1,20})\}\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(IDENTITY, key) ? esc(IDENTITY[key]) : whole);
}

function legalFor(slug, code) {
  if (code === "RU" && LEGAL_RU[slug]) return LEGAL_RU[slug];
  if (code === "ET" && LEGAL_ET[slug]) return LEGAL_ET[slug];
  if (code === "EN" && LEGAL_EN[slug]) return LEGAL_EN[slug];
  return LEGAL[slug] || null;
}

const BUNDLES = await (async () => {
  try {
    return new Function(await readFile(path.join(SHOP, "bundles.js"), "utf8") + "\nreturn BUNDLES;")() || [];
  } catch { return []; }
})();
const bundleText = (b, field, code) => (b[field] && (b[field][code] || b[field].RU)) || "";

/* ---------- translation tables, borrowed from app.js -------------------

   The dictionaries live in app.js and only there. Rather than keep a second
   copy here that would quietly drift, lift the four declarations and the two
   functions that use them straight out of the source and evaluate them: they
   are plain literals and pure functions. If app.js is ever reshaped so the
   slices no longer come out, the tool says so and falls back to Russian for
   all three languages instead of writing wrong text. */

const appSrc = await readFile(path.join(SHOP2, "app.js"), "utf8");
// the file is CRLF on disk; the anchors below are end-of-line exact
const appLines = appSrc.replace(/\r\n?/g, "\n").split("\n");

function sliceFrom(startRx, endRx) {
  const i = appLines.findIndex(l => startRx.test(l));
  if (i < 0) return null;
  for (let j = i + 1; j < appLines.length; j++) {
    if (endRx.test(appLines[j])) return appLines.slice(i, j + 1).join("\n");
  }
  return null;
}
const DECL_END = /^ {2}[}\]];$/;
const FN_END = /^ {2}}$/;

let trText = s => s;
try {
  const pieces = [
    sliceFrom(/^ {2}var UI = \{$/, DECL_END),
    sliceFrom(/^ {2}var UI_RX = \[$/, DECL_END),
    sliceFrom(/^ {2}var NAME_TAILS = \{$/, DECL_END),
    sliceFrom(/^ {2}var NAME_FRAGS = \[$/, DECL_END),
    sliceFrom(/^ {2}var TAIL_EXACT = \{$/, DECL_END),
    sliceFrom(/^ {2}function trName\(s, lang\) \{$/, FN_END),
    sliceFrom(/^ {2}function trText\(s, lang, allowName\) \{$/, FN_END)
  ];
  if (pieces.some(p => !p)) throw new Error("could not lift the translation tables out of app.js");
  trText = new Function(pieces.join("\n") + "\nreturn trText;")();
  // smoke: the dictionary must actually answer, or the slices caught the wrong thing
  if (trText("Уход за волосами", "ET", false) === "Уход за волосами") {
    throw new Error("the lifted dictionary does not translate — check the app.js slices");
  }
} catch (e) {
  console.warn("! " + e.message + "\n! falling back to Russian text in every language");
  trText = s => s;
}
const tr = (s, code, allowName) => (code === "RU" ? String(s) : trText(String(s), code, !!allowName));

/* ---------- shell: the exact asset tags index.html uses ------------------

   public/shop2/index.html is two things at once: the shell every /shop2/ path
   falls back to, and the Russian home page — Vercel serves that file for
   /shop2/ and there is no way to put a different one there. So it is the one
   file the tool patches instead of writing: the SEO head and the #app content
   are replaced between their markers, and everything else — the asset tags
   with their ?v= token, the script list — stays hand-maintained and is read
   from there for every other page written here. */

const SHELL_FILE = path.join(SHOP2, "index.html");
const shell = (await readFile(SHELL_FILE, "utf8")).replace(/\r\n?/g, "\n");
const HEAD_MARK = /<!-- seo:start -->[\s\S]*?<!-- seo:end -->/;
const PRE_MARK = /<!-- prerender:start -->[\s\S]*?<!-- prerender:end -->/;
const headAssets = (shell.match(/<link rel="icon"[\s\S]*?(?=<\/head>)/) || [])[0];
// anchored on the marker, not on the first </div>: the block between them is
// full of divs of its own once a run has happened
const bodyScripts = (shell.match(/<!-- prerender:end -->\s*<\/div>\s*([\s\S]*?)<\/body>/) || [])[1];
const ASSET_V = (shell.match(/app\.js\?v=([^"']*)/) || [])[1] || "";
if (!headAssets || !bodyScripts || !HEAD_MARK.test(shell) || !PRE_MARK.test(shell)) {
  throw new Error("public/shop2/index.html no longer has the shape this tool reads. It needs, in " +
    "order: <!-- seo:start --> … <!-- seo:end -->, then <link rel=\"icon\"> … </head>, and a body " +
    "with <div id=\"app\"><!-- prerender:start --> … <!-- prerender:end --></div> followed by the " +
    "script tags. Restore those markers — do not let the tool guess.");
}

/* ---------- copy, one table per language -------------------------------- */

/* Mirrors the strings setHead() in app.js uses, so the tab title does not
   change under the shopper when the script takes over. */
const T = {
  RU: {
    base: "REMPIRE — магазин косметики в Таллинне",
    buy: "купить в Rempire",
    home: "Главная", catalogue: "Каталог", brands: "Бренды", all: "Все товары",
    homeIntro: "Профессиональный уход, стайлинг, парфюмерия и мерч из салона Rempire в Таллинне. " +
      "Доставка Omniva, SmartPosti и DPD по Эстонии, Латвии, Литве и Финляндии, самовывоз на Mardi 1.",
    homeDesc: "Магазин Rempire: уход за волосами и бородой, стайлинг, парфюмерия и мерч. " +
      "Доставка по Эстонии и Балтии, самовывоз в Таллинне на Mardi 1.",
    catsTitle: "Разделы", brandsTitle: "Бренды",
    sizes: "Размеры", description: "Описание",
    inStock: "В наличии", low: "мало", out: "нет в наличии",
    from: "от ",
    tax: "Налоги включены. Доставка рассчитается при оформлении.",
    lang: "Язык", loading: "Загружаем магазин…",
    catDesc: c => `${c} в магазине Rempire, Таллинн. Доставка Omniva, SmartPosti и DPD, самовывоз на Mardi 1.`,
    brandDesc: b => `${b} в наличии в Rempire, Таллинн — весь ассортимент бренда во всех разделах магазина.`,
    prodDesc: (price, cat, stock) =>
      `${price} · ${cat} · ${stock}. Магазин Rempire, Таллинн — доставка Omniva, SmartPosti и DPD, самовывоз на Mardi 1.`,
    /* the four screens added 03.09 — sets, one set, the gift card, the policy pages */
    save: "выгода", pieces: "товара в наборе",
    setsDesc: "Готовые наборы Rempire — уход, стайлинг и бритьё комплектом. Те же товары, что и поштучно, только дешевле. Таллинн, доставка по Балтии.",
    setDesc: (price, save, n) => `${price} вместо розницы, ${save} — ${n} в наборе. Магазин Rempire, Таллинн: доставка Omniva, SmartPosti и DPD, самовывоз на Mardi 1.`,
    giftDesc: "Подарочная карта Rempire на 25, 50 или 100 € — придёт письмом вам или сразу получателю. Действует год, остаток сохраняется.",
    infoDesc: title => `${title} — магазин Rempire, Таллинн. Доставка Omniva, SmartPosti и DPD по Эстонии и Балтии, самовывоз на Mardi 1.`
  },
  ET: {
    base: "REMPIRE — kosmeetikapood Tallinnas",
    buy: "osta Rempire'ist",
    home: "Avaleht", catalogue: "Kataloog", brands: "Brändid", all: "Kõik tooted",
    homeIntro: "Professionaalne juukse- ja habemehooldus, viimistlus, parfüümid ja merch Rempire'i salongist Tallinnas. " +
      "Tarne Omniva, SmartPosti ja DPD-ga Eestis, Lätis, Leedus ja Soomes, järeletulek Mardi 1.",
    homeDesc: "Rempire'i pood: juukse- ja habemehooldus, viimistlus, parfüümid ja merch. " +
      "Tarne üle Eesti ja Baltikumi, järeletulek Tallinnas Mardi 1.",
    catsTitle: "Osakonnad", brandsTitle: "Brändid",
    sizes: "Suurused", description: "Kirjeldus",
    inStock: "Laos", low: "vähe", out: "pole saadaval",
    from: "alates ",
    tax: "Hinnad sisaldavad makse. Tarne arvutatakse vormistamisel.",
    lang: "Keel", loading: "Laeme poodi…",
    catDesc: c => `${c} Rempire'i poes Tallinnas. Tarne Omniva, SmartPosti ja DPD-ga, järeletulek Mardi 1.`,
    brandDesc: b => `${b} laos Rempire'is, Tallinn — kogu brändi valik kõigist poe osakondadest.`,
    prodDesc: (price, cat, stock) =>
      `${price} · ${cat} · ${stock}. Rempire'i pood, Tallinn — tarne Omniva, SmartPosti ja DPD-ga, järeletulek Mardi 1.`,
    save: "sääst", pieces: "toodet komplektis",
    setsDesc: "Rempire'i valmiskomplektid — hooldus, viimistlus ja habemeajamine ühes pakis. Samad tooted mis eraldi, ainult soodsamalt. Tallinn, tarne üle Baltikumi.",
    setDesc: (price, save, n) => `${price} jaehinna asemel, ${save} — ${n}. Rempire'i pood, Tallinn: tarne Omniva, SmartPosti ja DPD-ga, järeletulek Mardi 1.`,
    giftDesc: "Rempire'i kinkekaart 25, 50 või 100 € — tuleb kirjaga sulle või kohe saajale. Kehtib aasta, jääk säilib.",
    infoDesc: title => `${title} — Rempire'i pood, Tallinn. Tarne Omniva, SmartPosti ja DPD-ga üle Eesti ja Baltikumi, järeletulek Mardi 1.`
  },
  EN: {
    base: "REMPIRE — grooming shop in Tallinn",
    buy: "buy at Rempire",
    home: "Home", catalogue: "Catalogue", brands: "Brands", all: "All products",
    homeIntro: "Professional hair and beard care, styling, fragrance and merch from the Rempire salon in Tallinn. " +
      "Omniva, SmartPosti and DPD delivery across Estonia, Latvia, Lithuania and Finland, pickup at Mardi 1.",
    homeDesc: "Rempire shop: hair and beard care, styling, fragrance and merch. " +
      "Delivery across Estonia and the Baltics, pickup in Tallinn at Mardi 1.",
    catsTitle: "Sections", brandsTitle: "Brands",
    sizes: "Sizes", description: "Description",
    inStock: "In stock", low: "low stock", out: "out of stock",
    from: "from ",
    tax: "Taxes included. Shipping is calculated at checkout.",
    lang: "Language", loading: "Loading the shop…",
    catDesc: c => `${c} at Rempire, Tallinn. Omniva, SmartPosti and DPD delivery, pickup at Mardi 1.`,
    brandDesc: b => `${b} in stock at Rempire, Tallinn — the brand's full range across every section of the shop.`,
    prodDesc: (price, cat, stock) =>
      `${price} · ${cat} · ${stock}. Rempire shop, Tallinn — Omniva, SmartPosti and DPD delivery, pickup at Mardi 1.`,
    save: "you save", pieces: "products in the set",
    setsDesc: "Rempire ready-made sets — care, styling and shaving in one box. The same products the shop sells separately, only cheaper. Tallinn, Baltic delivery.",
    setDesc: (price, save, n) => `${price} instead of retail, ${save} — ${n}. Rempire shop, Tallinn: Omniva, SmartPosti and DPD delivery, pickup at Mardi 1.`,
    giftDesc: "A Rempire gift card for €25, €50 or €100 — e-mailed to you or straight to the recipient. Valid for a year, the balance carries over.",
    infoDesc: title => `${title} — Rempire shop, Tallinn. Omniva, SmartPosti and DPD delivery across Estonia and the Baltics, pickup at Mardi 1.`
  }
};

/* A result listing shows about sixty characters of a title. Take the longest
   version that fits — app.js's fitTitle() runs the same ladder. */
function fitTitle(core, full) {
  if (full && full.length <= 60) return full;
  if (core.length + 10 <= 60) return core + " — REMPIRE";
  if (core.length <= 60) return core;
  return clip(core, 60);
}

/* ---------- URLs -------------------------------------------------------- */

const abs = u => BASE + u;
const langPath = (seg, rest) => "/shop2" + (seg ? "/" + seg : "") + rest;

/* One page's whole hreflang cluster: the three languages plus x-default, which
   is the unprefixed Russian path — the one every old link already points at.
   data-seo marks them so app.js rewrites these tags on client navigation
   instead of appending a second set. */
function headLinks(seg, rest) {
  const out = LANGS.map(l =>
    `<link rel="alternate" hreflang="${l.tag}" href="${esc(abs(langPath(l.seg, rest)))}" data-seo="alt-${l.tag}">`);
  out.push(`<link rel="alternate" hreflang="x-default" href="${esc(abs(langPath("", rest)))}" data-seo="alt-x">`);
  out.unshift(`<link rel="canonical" href="${esc(abs(langPath(seg, rest)))}" data-seo="canonical">`);
  return out.join("\n");
}

/* ---------- the page --------------------------------------------------- */

/* Prerender-only styling. The block is thrown away the moment app.js has
   painted, so these rules deliberately lean on styles.css (.wrap, .grid,
   .card, .pdp, .display, .chip, .acc__rich) and only fill the few gaps a
   script-less page has: a real <img> where the SPA paints a background, and
   anchors where it draws buttons. */
const PRE_CSS = `
#prerender .pre__img { width: 100%; height: auto; aspect-ratio: 1; object-fit: contain; background: var(--page); }
#prerender .pre__crumbs { font-size: 12.5px; color: var(--muted); padding-top: 16px; }
#prerender .pre__crumbs a:hover { text-decoration: underline; }
#prerender .pre__brand { font-family: Oswald, sans-serif; font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); display: block; margin-bottom: 6px; }
#prerender .pre__sizes { display: flex; gap: 8px; flex-wrap: wrap; list-style: none; padding: 0; margin: 0 0 18px; }
#prerender .pre__sizes li { border: 1px solid var(--rule); padding: 6px 12px; font-size: 13.5px; }
#prerender .pre__langs { margin: 32px 0 8px; font-size: 12.5px; color: var(--muted); display: flex; gap: 14px; flex-wrap: wrap; }
#prerender .pre__langs a { border-bottom: 1px solid var(--rule); }
#prerender .pre__list { list-style: none; padding: 0; margin: 0 0 24px; display: flex; gap: 8px 18px; flex-wrap: wrap; font-size: 13.5px; }
#prerender .pre__card { display: block; }
#prerender .pre__card .pre__img { margin-bottom: 6px; }
#prerender .pre__nm { display: block; font-size: 13.5px; }
#prerender .pre__pr { display: block; font-size: 13.5px; font-weight: 600; }
`.trim();

/* Everything a crawler reads, in one block. It is written between the markers
   in index.html and inlined verbatim into every generated page, so the Russian
   home page and the other 764 are built by the same code. */
function headBlock({ lang, seg, rest, title, desc, image, imageAlt, ogType, jsonld, ldMain }) {
  const canonical = abs(langPath(seg, rest));
  const ld = (Array.isArray(jsonld) ? jsonld : [jsonld]).filter(Boolean);
  const isMain = o => !!ldMain && o["@type"] === "Product";
  return `<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="${ROBOTS}">
${headLinks(seg, rest)}
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="REMPIRE">
<meta property="og:locale" content="${lang.ogLocale}" data-seo="og:locale">
<meta property="og:url" content="${esc(canonical)}" data-seo="og:url">
<meta property="og:title" content="${esc(title)}" data-seo="og:title">
<meta property="og:description" content="${esc(desc)}" data-seo="og:description">
<meta property="og:image" content="${esc(image)}" data-seo="og:image">
<meta property="og:image:alt" content="${esc(imageAlt)}">
<meta property="og:image:type" content="${/\.png(\?|$)/i.test(image) ? "image/png" : "image/jpeg"}">
<meta property="og:image:width" content="${OG_W}">
<meta property="og:image:height" content="${OG_H}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}" data-seo="twitter:title">
<meta name="twitter:description" content="${esc(desc)}" data-seo="twitter:description">
<meta name="twitter:image" content="${esc(image)}" data-seo="twitter:image">
<style id="prestyle">${PRE_CSS}</style>
${ld.map(o => '<script type="application/ld+json"' +
    /* On a catalogue product page app.js writes its own Product block into
       #ldjson, so handing it this one means it rewrites it in place rather
       than adding a second Product. Everywhere else the id would be a trap:
       setHead() *removes* #ldjson on any screen that is not `product`, so a
       set's Product block carrying that id would be deleted the moment the
       script booted — and Googlebot reads the rendered DOM. The rest are
       marked data-seo="ldjson-page": app.js drops those only once the shopper
       navigates away from the path the page was loaded on. */
    (isMain(o) ? ' id="ldjson"' : ' data-seo="ldjson-page"') +
    ">" + JSON.stringify(o) + "</script>").join("\n")}`;
}

function fullPage(spec) {
  return `<!doctype html>
<html lang="${spec.lang.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#ffffff">
<!-- Generated by tools/prerender-shop2.mjs (npm run prerender). Do not edit. -->
<!-- seo:start -->
${headBlock(spec)}
<!-- seo:end -->
${headAssets}</head>
<body>
<div id="app"><!-- prerender:start --><div id="prerender">${spec.content}</div><!-- prerender:end --></div>
${bodyScripts}</body>
</html>
`;
}

/* Replacement functions, not strings: a description containing $& or $1 would
   otherwise be spliced by String.replace's own substitution rules. */
function patchedShell(spec) {
  return shell
    .replace(HEAD_MARK, () => "<!-- seo:start -->\n" + headBlock(spec) + "\n<!-- seo:end -->")
    .replace(PRE_MARK, () =>
      '<!-- prerender:start --><div id="prerender">' + spec.content + '</div><!-- prerender:end -->');
}

/* ---------- shared blocks ---------------------------------------------- */

const href = (seg, rest) => esc(langPath(seg, rest));

function langNav(seg, rest, t) {
  return '<nav class="pre__langs" aria-label="' + esc(t.lang) + '">' +
    LANGS.map(l => '<a href="' + href(l.seg, rest) + '" hreflang="' + l.tag + '"' +
      (l.seg === seg ? ' aria-current="true"' : "") + ">" + l.code + "</a>").join("") +
    "</nav>";
}

function stockLabel(p, t) {
  return p.stock === "out" ? t.out : p.stock === "low" ? t.low : t.inStock;
}
function priceLabel(p, t) {
  return (p.priceFrom ? t.from : "") + eur(p.price);
}
function imgUrl(p) { return abs(String(p.img).split("?")[0]) + "?v=" + encodeURIComponent(String(p.img).split("?v=")[1] || "1"); }

/* One product tile. An <a>, not a button: this is the only path a crawler has
   from a category to the 220 product pages. */
function card(p, seg, code, t) {
  const name = tr(p.name, code, true);
  return '<li><a class="pre__card" href="' + href(seg, "/p/" + encodeURIComponent(p.id) + "/") + '">' +
    '<img class="pre__img" src="' + esc(p.img) + '" alt="' + esc(p.brand + " " + name) + '" loading="lazy" width="400" height="400">' +
    '<span class="pre__brand">' + esc(p.brand) + "</span>" +
    '<span class="pre__nm">' + esc(name) + "</span>" +
    '<span class="pre__pr num">' + esc(priceLabel(p, t)) + "</span>" +
    "</a></li>";
}

function grid(list, seg, code, t) {
  return '<ul class="grid" style="list-style:none;padding:0">' + list.map(p => card(p, seg, code, t)).join("") + "</ul>";
}

function crumbs(parts) {
  return '<div class="pre__crumbs">' + parts.map(([label, url]) =>
    url ? '<a href="' + url + '">' + esc(label) + "</a>" : esc(label)).join(" / ") + "</div>";
}

function breadcrumbLD(items) {
  return {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem", position: i + 1, name: it[0],
      ...(it[1] ? { item: abs(it[1]) } : {})
    }))
  };
}

/* «Mardi 1, 10145 Tallinn» → the three fields schema.org wants. One address
   is typed once, in src/lib/content.ts; if it is ever written in a shape this
   does not recognise the JSON-LD keeps the street line whole rather than
   inventing a town. */
function postalAddress(oneLine) {
  const parts = String(oneLine || "").split(/\s*,\s*/).filter(Boolean);
  const out = { "@type": "PostalAddress", streetAddress: parts[0] || "", addressCountry: "EE" };
  const tail = parts.slice(1).join(", ");
  const m = tail.match(/^(\d{4,6})\s+(.+)$/);
  if (m) { out.postalCode = m[1]; out.addressLocality = m[2]; }
  else if (tail) out.addressLocality = tail;
  return out;
}

/* sameAs is what Google reads to tie the shop to its accounts, so it comes
   from the same place the footer's icons do — the content defaults — in the
   order the shop shows them. */
const SOCIAL_ORDER = ["instagram", "facebook", "tiktok", "youtube"];
const ORG_LD = {
  "@context": "https://schema.org", "@type": "Organization",
  name: "REMPIRE", url: abs("/shop2/"),
  logo: abs("/brand/rempire-tower.svg"),
  address: postalAddress(IDENTITY.address),
  sameAs: SOCIAL_ORDER.map(k => SHOP_CONTENT.social[k]).filter(Boolean)
};

/* ---------- screens ----------------------------------------------------- */

const BRANDS = [...new Set(CATALOGUE.map(p => p.brand))].sort((a, b) => a.localeCompare(b, "en"));
const BRAND_SLUG = new Map(BRANDS.map(b => [b, slugify(b)]));
const CATS = Object.keys(CAT_NAMES);

/* ---------- OG cards ----------------------------------------------------

   A link preview is a 1 200×630 JPEG or it is nothing. Facebook, WhatsApp
   and LinkedIn will not read a .webp at all, and a square cutout declared as
   a wide card gets cropped straight through the middle of the bottle. The
   old shop had cards for the 95 products it used to sell; the other 125, all
   the sets, and every page with no product on it had to borrow the square
   .webp — which is why two thirds of the catalogue shared with no preview.

   So the missing cards are drawn here, once, with sharp, on the same recipe
   the ImageMagick script in tools/build-product-pages.mjs used: the cutout
   centred on the brand ground with the tower mark in the corner and no text
   — the title and the price travel as OG text fields and every platform
   sets those in its own type.

   A card that is already on disk is left alone, so a re-run costs one stat
   per product and `npm run prerender` stays idempotent. If sharp cannot be
   loaded the run still finishes: og:image then falls back to /og-shop.png,
   which is on disk and is 1 200×630, rather than to a .webp no scraper
   reads. Either way the invariant holds — **every og:image this tool writes
   is a 1 200×630 file that exists in public/**, which is what lets it always
   promise `summary_large_image` and always state width and height. */

const OGDIR = path.join(SHOP, "og");
const OG_W = 1200, OG_H = 630;
const OG_GROUND = { r: 0xed, g: 0xea, b: 0xe1 };
const OG_DEFAULT = "/brand/og-default.png";   // tower on the ground, for pages with no product
const OG_FALLBACK = "/og-shop.png";           // shipped, 1200×630 — used when sharp is missing

let sharp = null;
try { ({ default: sharp } = await import("sharp")); }
catch { console.warn("! sharp did not load — no OG cards generated this run"); }

let cardsMade = 0;

/* currentColor rasterises as black; the brand ink is #1c1a00. The vector is
   the source rather than brand/tower-email.png, which is 62×96 and would be
   a smear at card size. */
async function towerPng(height) {
  const svg = (await readFile(path.join(PUB, "brand", "rempire-tower.svg"), "utf8"))
    .replace(/currentColor/g, "#1c1a00");
  return sharp(Buffer.from(svg), { density: 600 }).resize({ height }).png().toBuffer();
}

/* Up to three cutouts in a row on the ground, tower in the top-left corner.
   One image is the product card; three is a set, and the row is what tells a
   reader at thumbnail size that the offer is more than one thing. */
async function drawCard(file, sources) {
  const box = sources.length > 1 ? { w: 300, h: 430 } : { w: 460, h: 460 };
  const gap = 36;
  const layers = [];
  for (const src of sources) {
    const buf = await sharp(path.join(PUB, src.replace(/^\//, "").split("?")[0]))
      .resize(box.w, box.h, { fit: "inside", withoutEnlargement: false })
      .png().toBuffer();
    const m = await sharp(buf).metadata();
    layers.push({ buf, w: m.width, h: m.height });
  }
  const total = layers.reduce((a, l) => a + l.w, 0) + gap * (layers.length - 1);
  let x = Math.round((OG_W - total) / 2);
  const composite = [];
  for (const l of layers) {
    composite.push({ input: l.buf, left: x, top: Math.round((OG_H - l.h) / 2) });
    x += l.w + gap;
  }
  composite.push({ input: await towerPng(64), left: 56, top: 48 });
  await mkdir(path.dirname(file), { recursive: true });
  await sharp({ create: { width: OG_W, height: OG_H, channels: 3, background: OG_GROUND } })
    .composite(composite).jpeg({ quality: 84 }).toFile(file);
  cardsMade++;
}

if (sharp) {
  await mkdir(OGDIR, { recursive: true });
  /* The last resort: the mark alone. Used by the policy pages, the gift card
     and anything else with no photograph of its own. */
  const dflt = path.join(PUB, OG_DEFAULT.replace(/^\//, ""));
  if (!existsSync(dflt)) {
    try {
      const mark = await towerPng(260);
      const m = await sharp(mark).metadata();
      await mkdir(path.dirname(dflt), { recursive: true });
      await sharp({ create: { width: OG_W, height: OG_H, channels: 3, background: OG_GROUND } })
        .composite([{ input: mark, left: Math.round((OG_W - m.width) / 2), top: Math.round((OG_H - m.height) / 2) }])
        .png().toFile(dflt);
      cardsMade++;
    } catch (e) { console.warn("! could not draw " + OG_DEFAULT + ": " + e.message); }
  }
  for (const p of CATALOGUE) {
    const f = path.join(OGDIR, p.id + ".jpg");
    if (existsSync(f)) continue;
    try { await drawCard(f, [p.img]); }
    catch (e) { console.warn("! og card for " + p.id + ": " + e.message); }
  }
  for (const b of BUNDLES) {
    const f = path.join(OGDIR, "set-" + b.id + ".jpg");
    if (existsSync(f)) continue;
    try { await drawCard(f, (b.images || []).slice(0, 3)); }
    catch (e) { console.warn("! og card for set " + b.id + ": " + e.message); }
  }
}

const OG_CARDS = new Set(existsSync(OGDIR) ? await readdir(OGDIR) : []);

/* Resolve one page's card: the first candidate that is actually on disk,
   absolute, and 1 200×630 by construction. */
function ogPick(...candidates) {
  for (const c of [...candidates, OG_DEFAULT, OG_FALLBACK]) {
    if (!c) continue;
    if (existsSync(path.join(PUB, c.replace(/^\//, "").split("?")[0]))) return abs(c);
  }
  return abs(OG_FALLBACK);
}
const productCard = p => (OG_CARDS.has(p.id + ".jpg") ? "/shop/og/" + p.id + ".jpg" : null);

function productPage(p, lang) {
  const { code, seg } = { code: lang.code, seg: lang.seg };
  const t = T[code];
  const rest = "/p/" + encodeURIComponent(p.id) + "/";
  const name = tr(p.name, code, true);
  const catName = tr(CAT_NAMES[p.cat] || "", code, false);
  const core = p.brand + " " + name;
  const price = priceLabel(p, t);
  const full = core + " — " + t.buy + " · " + price;
  let title = fitTitle(core, full);
  if (code === "EN" && p.seo && p.seo.t) title = fitTitle(p.seo.t, "");

  const body = stripTags(code === "EN" && p.seo && p.seo.d ? p.seo.d : descFor(p, code));
  const desc = clip(body || t.prodDesc(price, catName, stockLabel(p, t)), 158);

  /* Its own 1 200×630 card, drawn above if the old shop had not left one. The
     square .webp cutout is never offered to a scraper: half of them refuse
     the format outright and the rest crop it through the middle. */
  const image = ogPick(productCard(p));

  const crumbItems = [
    [t.home, langPath(seg, "/")],
    [catName, langPath(seg, "/c/" + p.cat + "/")],
    [core, null]
  ];

  const productLD = {
    "@context": "https://schema.org", "@type": "Product",
    name: core,
    brand: { "@type": "Brand", name: p.brand },
    image: [imgUrl(p)],
    description: clip(body, 500),
    category: catName,
    sku: p.id,
    url: abs(langPath(seg, rest)),
    offers: {
      "@type": "Offer",
      priceCurrency: "EUR",
      price: String(p.price),
      availability: "https://schema.org/" + (p.stock === "out" ? "OutOfStock" : "InStock"),
      itemCondition: "https://schema.org/NewCondition",
      url: abs(langPath(seg, rest)),
      seller: { "@type": "Organization", name: "REMPIRE" }
    }
  };

  const sizes = (p.sizes || []).length
    ? "<h2 class=\"display h1\" style=\"font-size:13px;letter-spacing:.18em\">" + esc(t.sizes) + "</h2>" +
      '<ul class="pre__sizes">' + p.sizes.map((s, i) =>
        "<li>" + esc(tr(s, code, false)) + " · <span class=\"num\">" + esc(eur(
          p.prices && p.prices.length ? p.prices[Math.min(i, p.prices.length - 1)] : p.price)) + "</span></li>").join("") + "</ul>"
    : "";

  const others = CATALOGUE.filter(x => x.cat === p.cat && x.id !== p.id).slice(0, 8);

  const content = '<div class="wrap">' +
    crumbs(crumbItems.map(([l, u]) => [l, u ? esc(u) : null])) +
    '<div class="pdp">' +
      "<div>" +
        '<img class="pre__img" src="' + esc(p.img) + '" alt="' + esc(core) + '" width="800" height="800">' +
      "</div>" +
      "<div>" +
        '<a class="pre__brand" href="' + href(seg, "/b/" + BRAND_SLUG.get(p.brand) + "/") + '">' + esc(p.brand) + "</a>" +
        '<h1 class="pdp__title">' + esc(name) + "</h1>" +
        '<div class="num pdp__price">' + esc(price) +
          (p.stock === "out" ? ' <span class="chip chip--out">' + esc(t.out) + "</span>"
            : p.stock === "low" ? ' <span class="chip chip--low">' + esc(t.low) + "</span>"
            : ' <span class="chip chip--ok">' + esc(t.inStock) + "</span>") + "</div>" +
        '<div class="pdp__tax">' + esc(t.tax) + "</div>" +
        sizes +
        (descFor(p, code)
          ? "<h2 class=\"display h1\" style=\"font-size:13px;letter-spacing:.18em\">" + esc(t.description) + "</h2>" +
            '<div class="acc__rich">' + descFor(p, code) + "</div>"
          : "") +
      "</div>" +
    "</div>" +
    (others.length
      ? '<section class="sec"><h2 class="display h1">' + esc(catName) + "</h2>" + grid(others, seg, code, t) + "</section>"
      : "") +
    langNav(seg, rest, t) +
    "</div>";

  return {
    file: path.join(SHOP2, seg, "p", p.id, "index.html"),
    spec: {
      lang, seg, rest, title, desc, image, imageAlt: core,
      ogType: "product", ldMain: true,
      jsonld: [productLD, breadcrumbLD(crumbItems.map(([l, u]) => [l, u]))],
      content
    }
  };
}

function listingPage({ lang, kind, id, heading, list, rest, desc, title }) {
  const { code, seg } = { code: lang.code, seg: lang.seg };
  const t = T[code];
  const crumbItems = [
    [t.home, langPath(seg, "/")],
    ...(kind === "b" ? [[t.brands, langPath(seg, "/c/all/")]] : []),
    [heading, null]
  ];
  const first = list[0];
  const content = '<div class="wrap">' +
    crumbs(crumbItems.map(([l, u]) => [l, u ? esc(u) : null])) +
    '<section class="sec">' +
      '<h1 class="display h1">' + esc(heading) + "</h1>" +
      '<p class="sec__intro">' + esc(desc) + "</p>" +
      grid(list, seg, code, t) +
    "</section>" +
    langNav(seg, rest, t) +
    "</div>";
  return {
    file: path.join(SHOP2, seg, kind, id, "index.html"),
    spec: {
      lang, seg, rest, title, desc,
      image: ogPick(first ? productCard(first) : null, OG_FALLBACK),
      imageAlt: heading, ogType: "website",
      jsonld: [
        breadcrumbLD(crumbItems.map(([l, u]) => [l, u])),
        {
          "@context": "https://schema.org", "@type": "ItemList",
          name: heading, numberOfItems: list.length,
          itemListElement: list.slice(0, 50).map((p, i) => ({
            "@type": "ListItem", position: i + 1,
            url: abs(langPath(seg, "/p/" + encodeURIComponent(p.id) + "/")),
            name: p.brand + " " + tr(p.name, code, true)
          }))
        }
      ],
      content
    }
  };
}

function homePage(lang) {
  const { code, seg } = { code: lang.code, seg: lang.seg };
  const t = T[code];
  const rest = "/";
  const featured = CATALOGUE.filter(p => p.stock !== "out").slice(0, 12);
  const content = '<div class="wrap">' +
    '<section class="sec">' +
      '<h1 class="display h1">' + esc(t.base) + "</h1>" +
      '<p class="sec__intro">' + esc(t.homeIntro) + "</p>" +
      '<h2 class="display h1" style="font-size:13px;letter-spacing:.18em">' + esc(t.catsTitle) + "</h2>" +
      '<ul class="pre__list">' +
        '<li><a href="' + href(seg, "/c/all/") + '">' + esc(t.all) + "</a></li>" +
        CATS.map(c => '<li><a href="' + href(seg, "/c/" + c + "/") + '">' +
          esc(tr(CAT_NAMES[c], code, false)) + "</a></li>").join("") +
      "</ul>" +
      '<h2 class="display h1" style="font-size:13px;letter-spacing:.18em">' + esc(t.brandsTitle) + "</h2>" +
      '<ul class="pre__list">' + BRANDS.map(b => '<li><a href="' + href(seg, "/b/" + BRAND_SLUG.get(b) + "/") + '">' +
        esc(b) + "</a></li>").join("") + "</ul>" +
      grid(featured, seg, code, t) +
    "</section>" +
    langNav(seg, rest, t) +
    "</div>";
  return {
    file: path.join(SHOP2, seg, "index.html"),
    spec: {
      lang, seg, rest,
      title: t.base, desc: t.homeDesc,
      image: ogPick(OG_FALLBACK), imageAlt: "REMPIRE", ogType: "website",
      jsonld: [ORG_LD, {
        "@context": "https://schema.org", "@type": "WebSite",
        name: "REMPIRE", url: abs(langPath(seg, "/")), inLanguage: lang.tag
      }],
      content
    }
  };
}

/* ---------- the four screens that used to be shell-only ------------------

   info/<slug>, sets, set/<id> and gift were client-side only: a shopper
   arriving on «Возврат товара» from a search got the home page's head and an
   empty #app until app.js booted, and a crawler got the home page and
   nothing else. They are the pages a shopper checks *before* paying, so they
   are the ones worth having.

   The paths are read off pathFor() in the router region of app.js, not
   invented here — note the singular /set/<id>/ beside the plural /sets/.
   Anything the router does not accept cold (search, cart, checkout, account,
   done, admin) is deliberately still absent: those need state, they are
   robots-disallowed, and a static copy of them would be a lie. */

const infoRest = slug => "/info/" + slug + "/";

/* «Контакты» is not a policy page. app.js intercepts the slug in screenInfo()
   and draws screenContact() from the content layer, so the LEGAL entry — a
   2019 Shopify page, complete with a stylesheet link to Shopify's CDN and a
   contact form that goes nowhere — was only ever seen by crawlers and by
   shoppers in the moment before app.js booted. This mirrors screenContact()
   from the same defaults: the same rows, the same order, the same labels
   through the same dictionary. The socials carry their name as link text
   where the shop draws an SVG icon; app.js replaces the block on hydration. */
const CONTENT_DAYS = [
  ["mon", "Понедельник"], ["tue", "Вторник"], ["wed", "Среда"], ["thu", "Четверг"],
  ["fri", "Пятница"], ["sat", "Суббота"], ["sun", "Воскресенье"]
];
const SOCIAL_NAMES = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", youtube: "YouTube" };

function contactCompany(code) {
  const c = IDENTITY;
  const codes = [];
  if (c.regCode) codes.push(esc(tr("Рег.", code, false)) + " " + esc(c.regCode));
  if (c.vatNumber) codes.push("KMKR " + esc(c.vatNumber));
  return [esc(c.legalName), codes.join(" · "), esc(c.address),
    c.iban ? "IBAN " + esc(c.iban) : ""].filter(Boolean).join("<br>");
}

function contactHours(code) {
  const h = SHOP_CONTENT.hours || {};
  const rows = [];
  for (const [key, ru] of CONTENT_DAYS) {
    const v = h[key];
    if (!v) continue;
    rows.push(esc(tr(ru, code, false)) + " — " +
      (v === "closed" ? esc(tr("выходной", code, false)) : esc(v)));
  }
  if (!rows.length) return "";
  const note = (h.note && (h.note[code] || h.note.RU)) || "";
  return rows.join("<br>") + (note ? '<br><span class="ftr__pay">' + esc(note) + "</span>" : "");
}

function contactSocials(code) {
  const out = SOCIAL_ORDER.map(key => {
    const url = SHOP_CONTENT.social[key];
    if (!url) return "";
    const name = SOCIAL_NAMES[key] || key;
    const label = tr("Rempire в " + name, code, false);
    return '<a class="social" href="' + esc(url) + '" aria-label="' + esc(label) +
      '" title="' + esc(name) + '" rel="noopener">' + esc(name) + "</a>";
  }).join("");
  return out ? '<span class="socials socials--contact">' + out + "</span>" : "";
}

function contactBody(code) {
  const c = IDENTITY;
  const intro = SHOP_CONTENT.contactPage[code] || SHOP_CONTENT.contactPage.RU || "";
  const rows = [];
  if (c.phone) {
    rows.push([tr("Телефон", code, false),
      '<a href="tel:' + esc(c.phone.replace(/[^\d+]/g, "")) + '">' + esc(c.phone) + "</a>"]);
  }
  if (c.email) {
    rows.push([tr("Эл. почта", code, false),
      '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a>"]);
  }
  if (c.address) rows.push([tr("Адрес", code, false), esc(c.address)]);
  const company = contactCompany(code);
  if (company) rows.push([tr("Реквизиты", code, false), company]);
  const hours = contactHours(code);
  return (intro ? '<p class="sec__intro">' + esc(intro) + "</p>" : "") +
    '<div class="legal">' +
      rows.map(([label, value]) => "<p><b>" + esc(label) + "</b><br>" + value + "</p>").join("") +
      (hours ? "<p><b>" + esc(tr("Часы работы", code, false)) + "</b><br>" + hours + "</p>" : "") +
    "</div>" +
    contactSocials(code);
}

function infoPage(slug, lang) {
  const { code, seg } = lang;
  const t = T[code];
  const pg = legalFor(slug, code);
  if (!pg) return null;
  /* A translated file gives its own heading. Where there is none — English,
     until legal.en.js lands — the Russian heading on LEGAL goes through the
     interface dictionary instead of being printed raw, which is what app.js's
     translateTree() does to the same string a moment later. */
  const native = code === "RU" ? !!LEGAL_RU[slug] : code === "ET" ? !!LEGAL_ET[slug] : !!LEGAL_EN[slug];
  const heading = native ? pg.title : tr((LEGAL[slug] || pg).title, code, false);
  const rest = infoRest(slug);
  const crumbItems = [[t.home, langPath(seg, "/")], [heading, null]];

  /* The policy bodies carry an <h1> of their own ("Shipping policy" under
     «Доставка и оплата»). Two h1s on one page is a smell a crawler reads and
     a shopper never sees, so the inner ones are demoted. «Контакты» is not a
     policy text at all — it is built from the shop's own details, as in
     screenContact(), and it needs no lawyer's note under it. */
  const isContact = slug === "contact";
  const body = isContact
    ? contactBody(code)
    : resolveIdentity(String(pg.html || "")).replace(/<(\/?)h1(\s|>)/gi, "<$1h2$2");

  const others = LEGAL_SLUGS.filter(s => s !== slug).map(s => {
    const o = legalFor(s, code);
    const oNative = code === "RU" ? !!LEGAL_RU[s] : code === "ET" ? !!LEGAL_ET[s] : !!LEGAL_EN[s];
    const label = o ? (oNative ? o.title : tr((LEGAL[s] || o).title, code, false)) : s;
    return '<li><a href="' + href(seg, infoRest(s)) + '">' + esc(label) + "</a></li>";
  }).join("");

  const content = '<div class="wrap wrap--mid">' +
    crumbs(crumbItems.map(([l, u]) => [l, u ? esc(u) : null])) +
    '<section class="sec">' +
      '<h1 class="display h1">' + esc(heading) + "</h1>" +
      (isContact ? body : '<div class="legal">' + body + "</div>" +
        '<p class="note" style="margin-top:22px">' +
          esc(tr("Текст перенесён с текущего сайта; перед запуском пройдёт проверку юристом.", code, false)) + "</p>") +
    "</section>" +
    '<ul class="pre__list">' + others + "</ul>" +
    langNav(seg, rest, t) +
    "</div>";

  return {
    file: path.join(SHOP2, seg, "info", slug, "index.html"),
    spec: {
      lang, seg, rest,
      title: fitTitle(heading, heading + " — REMPIRE"),
      desc: clip(t.infoDesc(heading), 158),
      image: ogPick(OG_DEFAULT), imageAlt: heading, ogType: "article",
      jsonld: [ORG_LD, breadcrumbLD(crumbItems.map(([l, u]) => [l, u]))],
      content
    }
  };
}

/* Three product photos and the price pair — what the set card shows in the
   shop, in markup a crawler can follow to the products inside it. */
function setThumbs(b, alt) {
  return (b.images || []).slice(0, 3).map((src, i) =>
    '<img class="pre__img" src="' + esc(src) + '" alt="' + esc(alt) + '"' +
      (i ? ' loading="lazy"' : "") + ' width="400" height="400" style="max-width:220px">').join("");
}

function setPrice(b, t) {
  return '<div class="num pdp__price">' + esc(eur(b.price)) +
    ' <s class="bwas">' + esc(eur(b.sum)) + "</s>" +
    ' <span class="chip chip--ok">' + esc(t.save) + " " + esc(eur(b.save)) + "</span>" +
    (b.stock === "out" ? ' <span class="chip chip--out">' + esc(t.out) + "</span>" : "") + "</div>";
}

function setPage(b, lang) {
  const { code, seg } = lang;
  const t = T[code];
  const rest = "/set/" + encodeURIComponent(b.id) + "/";
  const heading = bundleText(b, "title", code);
  const blurb = bundleText(b, "desc", code);
  const setsLabel = tr("Наборы", code, false);
  const crumbItems = [
    [t.home, langPath(seg, "/")],
    [setsLabel, langPath(seg, "/sets/")],
    [heading, null]
  ];

  const items = b.items.map(it => {
    const p = CATALOGUE.find(x => x.id === it.id);
    const nm = p ? p.brand + " " + tr(p.name, code, true) : (it.brand + " " + it.name).trim();
    return '<li><a href="' + href(seg, "/p/" + encodeURIComponent(it.id) + "/") + '">' +
      esc(nm) + '</a> <span class="num">' + esc(eur(it.price)) + "</span></li>";
  }).join("");

  const content = '<div class="wrap">' +
    crumbs(crumbItems.map(([l, u]) => [l, u ? esc(u) : null])) +
    '<div class="pdp">' +
      "<div>" + setThumbs(b, heading) + "</div>" +
      "<div>" +
        '<a class="pre__brand" href="' + href(seg, "/sets/") + '">' + esc(tr("Набор", code, false)) + "</a>" +
        '<h1 class="pdp__title">' + esc(heading) + "</h1>" +
        setPrice(b, t) +
        '<div class="pdp__tax">' + esc(t.tax) + "</div>" +
        '<p class="bdesc">' + esc(blurb) + "</p>" +
        '<h2 class="display h1" style="font-size:13px;letter-spacing:.18em">' +
          esc(tr("Что внутри", code, false)) + "</h2>" +
        '<ul class="pre__list">' + items + "</ul>" +
      "</div>" +
    "</div>" +
    langNav(seg, rest, t) +
    "</div>";

  return {
    file: path.join(SHOP2, seg, "set", b.id, "index.html"),
    spec: {
      lang, seg, rest,
      title: fitTitle(heading, heading + " — " + t.buy + " · " + eur(b.price)),
      desc: clip(blurb || t.setDesc(eur(b.price), eur(b.save), b.items.length + " " + t.pieces), 158),
      image: ogPick("/shop/og/set-" + b.id + ".jpg", productCard(CATALOGUE.find(x => x.id === b.items[0].id) || {})),
      imageAlt: heading, ogType: "product",
      jsonld: [
        {
          "@context": "https://schema.org", "@type": "Product",
          name: heading,
          brand: { "@type": "Brand", name: "REMPIRE" },
          image: (b.images || []).slice(0, 3).map(u => abs(String(u).split("?")[0])),
          description: clip(blurb, 500),
          sku: "set-" + b.id,
          url: abs(langPath(seg, rest)),
          isRelatedTo: b.items.map(it => ({
            "@type": "Product", name: (it.brand + " " + it.name).trim(),
            url: abs(langPath(seg, "/p/" + encodeURIComponent(it.id) + "/"))
          })),
          offers: {
            "@type": "Offer",
            priceCurrency: "EUR",
            price: String(b.price),
            availability: "https://schema.org/" + (b.stock === "out" ? "OutOfStock" : "InStock"),
            itemCondition: "https://schema.org/NewCondition",
            url: abs(langPath(seg, rest)),
            seller: { "@type": "Organization", name: "REMPIRE" }
          }
        },
        ORG_LD,
        breadcrumbLD(crumbItems.map(([l, u]) => [l, u]))
      ],
      content
    }
  };
}

function setsPage(lang) {
  const { code, seg } = lang;
  const t = T[code];
  const rest = "/sets/";
  const heading = tr("Наборы", code, false);
  const crumbItems = [[t.home, langPath(seg, "/")], [heading, null]];

  const cards = BUNDLES.map(b => {
    const title = bundleText(b, "title", code);
    return '<li><a class="pre__card" href="' + href(seg, "/set/" + encodeURIComponent(b.id) + "/") + '">' +
      '<img class="pre__img" src="' + esc((b.images || [])[0] || "") + '" alt="' + esc(title) +
        '" loading="lazy" width="400" height="400">' +
      '<span class="pre__brand">' + esc(tr("Набор", code, false)) + " · −" + b.pct + " %</span>" +
      '<span class="pre__nm">' + esc(title) + "</span>" +
      '<span class="pre__pr num">' + esc(eur(b.price)) + ' <s class="bwas">' + esc(eur(b.sum)) + "</s></span>" +
      "</a></li>";
  }).join("");

  const content = '<div class="wrap">' +
    crumbs(crumbItems.map(([l, u]) => [l, u ? esc(u) : null])) +
    '<section class="sec">' +
      '<h1 class="display h1">' + esc(heading) + "</h1>" +
      '<p class="sec__intro">' + esc(tr(
        "Готовые наборы из тех же товаров, что стоят в магазине по отдельности. Вместе — дешевле.", code, false)) + "</p>" +
      '<ul class="grid" style="list-style:none;padding:0">' + cards + "</ul>" +
      '<p><a href="' + href(seg, "/gift/") + '">' + esc(tr("Подарочная карта", code, false)) + "</a></p>" +
    "</section>" +
    langNav(seg, rest, t) +
    "</div>";

  return {
    file: path.join(SHOP2, seg, "sets", "index.html"),
    spec: {
      lang, seg, rest,
      title: fitTitle(heading, heading + " — " + t.buy),
      desc: clip(t.setsDesc, 158),
      image: ogPick(BUNDLES[0] ? "/shop/og/set-" + BUNDLES[0].id + ".jpg" : null, OG_DEFAULT),
      imageAlt: heading, ogType: "website",
      jsonld: [
        ORG_LD,
        breadcrumbLD(crumbItems.map(([l, u]) => [l, u])),
        {
          "@context": "https://schema.org", "@type": "ItemList",
          name: heading, numberOfItems: BUNDLES.length,
          itemListElement: BUNDLES.map((b, i) => ({
            "@type": "ListItem", position: i + 1,
            url: abs(langPath(seg, "/set/" + encodeURIComponent(b.id) + "/")),
            name: bundleText(b, "title", code)
          }))
        }
      ],
      content
    }
  };
}

const GIFT_AMOUNTS = [25, 50, 100];

function giftPage(lang) {
  const { code, seg } = lang;
  const t = T[code];
  const rest = "/gift/";
  const heading = tr("Подарочная карта", code, false);
  const setsLabel = tr("Наборы", code, false);
  const crumbItems = [
    [t.home, langPath(seg, "/")],
    ...(BUNDLES.length ? [[setsLabel, langPath(seg, "/sets/")]] : []),
    [heading, null]
  ];

  const content = '<div class="wrap wrap--mid">' +
    crumbs(crumbItems.map(([l, u]) => [l, u ? esc(u) : null])) +
    '<section class="sec">' +
      '<img class="pre__img" src="/brand/rempire-tower.svg" alt="REMPIRE" width="120" height="186" style="max-width:120px">' +
      '<h1 class="display h1">' + esc(heading) + "</h1>" +
      '<p class="sec__intro">' + esc(tr(
        "Работает на весь магазин и не сгорает. После оплаты придёт письмо с кодом — вам или сразу получателю.",
        code, false)) + "</p>" +
      '<h2 class="display h1" style="font-size:13px;letter-spacing:.18em">' +
        esc(tr("Сумма", code, false)) + "</h2>" +
      '<ul class="pre__sizes">' + GIFT_AMOUNTS.map(a => "<li><span class=\"num\">" + esc(eur(a)) + "</span></li>").join("") + "</ul>" +
      "<p>" + esc(tr(
        "Карта действует год со дня покупки. Остаток сохраняется: можно потратить за несколько заказов.",
        code, false)) + "</p>" +
      '<p><a href="' + href(seg, BUNDLES.length ? "/sets/" : "/c/all/") + '">' +
        esc(BUNDLES.length ? setsLabel : t.all) + "</a></p>" +
    "</section>" +
    langNav(seg, rest, t) +
    "</div>";

  return {
    file: path.join(SHOP2, seg, "gift", "index.html"),
    spec: {
      lang, seg, rest,
      title: fitTitle(heading, heading + " — REMPIRE"),
      desc: clip(t.giftDesc, 158),
      image: ogPick(OG_DEFAULT), imageAlt: heading, ogType: "website",
      jsonld: [ORG_LD, breadcrumbLD(crumbItems.map(([l, u]) => [l, u]))],
      content
    }
  };
}

/* ---------- build the set ----------------------------------------------- */

const pages = [];
for (const lang of LANGS) {
  const t = T[lang.code];
  pages.push(homePage(lang));

  for (const c of ["all", ...CATS]) {
    const list = c === "all" ? CATALOGUE : CATALOGUE.filter(p => p.cat === c);
    const heading = c === "all" ? t.all : tr(CAT_NAMES[c], lang.code, false);
    pages.push(listingPage({
      lang, kind: "c", id: c, heading, list,
      rest: "/c/" + c + "/",
      desc: clip(t.catDesc(heading), 158),
      title: fitTitle(heading, heading + " — " + t.buy)
    }));
  }

  for (const b of BRANDS) {
    const list = CATALOGUE.filter(p => p.brand === b);
    pages.push(listingPage({
      lang, kind: "b", id: BRAND_SLUG.get(b), heading: b, list,
      rest: "/b/" + BRAND_SLUG.get(b) + "/",
      desc: clip(t.brandDesc(b), 158),
      title: fitTitle(b, b + " — " + t.buy)
    }));
  }

  for (const p of CATALOGUE) pages.push(productPage(p, lang));

  for (const slug of LEGAL_SLUGS) {
    const page = infoPage(slug, lang);
    if (page) pages.push(page);
  }
  if (BUNDLES.length) {
    pages.push(setsPage(lang));
    for (const b of BUNDLES) pages.push(setPage(b, lang));
  }
  pages.push(giftPage(lang));
}

/* ---------- write, only what changed ------------------------------------ */

const wanted = new Set(pages.map(p => path.resolve(p.file)));
const SHELL_RESOLVED = path.resolve(SHELL_FILE);
let written = 0, same = 0;

for (const { file, spec } of pages) {
  // the Russian home page is index.html — patched between its markers, not overwritten
  const html = path.resolve(file) === SHELL_RESOLVED ? patchedShell(spec) : fullPage(spec);
  let prev = null;
  try { prev = (await readFile(file, "utf8")).replace(/\r\n?/g, "\n"); } catch { /* new file */ }
  if (prev === html) { same++; continue; }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html, "utf8");
  written++;
}

/* Anything left over under the directories this tool owns is a product,
   category or brand that no longer exists — a page Google would keep asking
   for. Sweep it. index.html, app.js, chat.js and styles.css are not ours. */
const OWNED = ["p", "c", "b", "info", "set", "sets", "gift", "et", "en"];
let removed = 0;
async function sweep(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await sweep(full);
    else if (e.name === "index.html" && !wanted.has(path.resolve(full))) {
      await rm(full); removed++;
    }
  }
  const left = await readdir(dir).catch(() => ["keep"]);
  if (!left.length) await rm(dir, { recursive: true, force: true });
}
for (const d of OWNED) await sweep(path.join(SHOP2, d));

/* ---------- sitemap ----------------------------------------------------- */

const today = new Date().toISOString().slice(0, 10);

/* Every language of a page is its own <url>, and each one lists the whole
   cluster — that is what the protocol asks for, and it is what lets Google
   swap in the Estonian result for an Estonian searcher. */
function urlEntry(rest, seg, priority) {
  const alts = LANGS.map(l =>
    `    <xhtml:link rel="alternate" hreflang="${l.tag}" href="${esc(abs(langPath(l.seg, rest)))}"/>`);
  alts.push(`    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(abs(langPath("", rest)))}"/>`);
  return "  <url>\n" +
    `    <loc>${esc(abs(langPath(seg, rest)))}</loc>\n` +
    alts.join("\n") + "\n" +
    `    <lastmod>${today}</lastmod>\n` +
    `    <priority>${priority}</priority>\n` +
    "  </url>";
}

/* The sitemap is exactly the set of pages written above — nothing that only
   exists client-side, and in particular nothing behind a basket. Asking
   Google to crawl /shop2/checkout/, /cart/, /account/, /admin/ or /done/
   would spend crawl budget on a screen that renders empty without state and
   is robots-disallowed anyway; those paths are never generated, so they
   cannot leak in here by accident. */
const entries = [];
for (const lang of LANGS) {
  entries.push(urlEntry("/", lang.seg, "1.0"));
  for (const c of ["all", ...CATS]) entries.push(urlEntry("/c/" + c + "/", lang.seg, "0.8"));
  for (const b of BRANDS) entries.push(urlEntry("/b/" + BRAND_SLUG.get(b) + "/", lang.seg, "0.6"));
  for (const p of CATALOGUE) entries.push(urlEntry("/p/" + encodeURIComponent(p.id) + "/", lang.seg, "0.7"));
  for (const slug of LEGAL_SLUGS) entries.push(urlEntry(infoRest(slug), lang.seg, "0.4"));
  if (BUNDLES.length) {
    entries.push(urlEntry("/sets/", lang.seg, "0.8"));
    for (const b of BUNDLES) entries.push(urlEntry("/set/" + encodeURIComponent(b.id) + "/", lang.seg, "0.7"));
  }
  entries.push(urlEntry("/gift/", lang.seg, "0.6"));
}

/* Belt and braces: if one of these ever appears in the list, a page was
   generated for a screen that must not be indexed. */
const NEVER = /^\/shop2(?:\/(?:et|en))?\/(?:checkout|cart|account|admin|done|search)\/$/;
for (const e of entries) {
  const loc = (e.match(/<loc>([^<]+)<\/loc>/) || [])[1] || "";
  const p = loc.replace(/^https?:\/\/[^/]+/, "");
  if (NEVER.test(p)) throw new Error("sitemap would contain a screen that must never be indexed: " + p);
}

const OPEN = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';
const CHUNK = 1000;   // the protocol allows 50 000; small files are easier to read and to diff
const sitemapFiles = [];

if (entries.length <= CHUNK) {
  await writeFile(path.join(PUB, "sitemap.xml"), OPEN + entries.join("\n") + "\n</urlset>\n", "utf8");
  sitemapFiles.push("sitemap.xml");
  // a leftover index from a larger catalogue would keep pointing at files we no longer write
  for (let i = 1; i <= 20; i++) {
    const f = path.join(PUB, `sitemap-${i}.xml`);
    if (existsSync(f)) await rm(f);
  }
} else {
  for (let i = 0; i * CHUNK < entries.length; i++) {
    const name = `sitemap-${i + 1}.xml`;
    await writeFile(path.join(PUB, name),
      OPEN + entries.slice(i * CHUNK, (i + 1) * CHUNK).join("\n") + "\n</urlset>\n", "utf8");
    sitemapFiles.push(name);
  }
  await writeFile(path.join(PUB, "sitemap.xml"),
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    sitemapFiles.map(f => `  <sitemap><loc>${abs("/" + f)}</loc><lastmod>${today}</lastmod></sitemap>`).join("\n") +
    "\n</sitemapindex>\n", "utf8");
}

/* ---------- robots ------------------------------------------------------

   One switch, not three. The robots meta in every page above, the
   X-Robots-Tag header in next.config.ts and this file all have to say the
   same thing, and the way to guarantee that is to derive all three from the
   same fact — the host in $PUBLIC_BASE_URL. So both policies are written out
   for reading, and public/robots.txt is written as a copy of whichever one
   matches the base this run was given:

     PUBLIC_BASE_URL=https://rempireshop.com          → the open policy
     anything else (staging, a preview, localhost)    → the closed policy

   Closed does not mean "Disallow: / and nothing else": Facebook, WhatsApp
   and LinkedIn honour robots.txt in their link scrapers, so a blanket
   disallow means a shared staging URL renders no card at all and the
   previews cannot be reviewed. The preview bots are therefore named and
   allowed on staging, and keeping staging out of an index is left to the
   robots meta and the header, which those bots do not act on. */

const NO_INDEX_PATHS = [
  "/shop2/admin", "/shop2/checkout", "/shop2/cart", "/shop2/account", "/shop2/done", "/shop2/search",
  "/shop2/*/admin", "/shop2/*/checkout", "/shop2/*/cart", "/shop2/*/account", "/shop2/*/done", "/shop2/*/search",
  "/api/"
];
const CLOSED_BOTS = ["facebookexternalhit", "meta-externalagent", "WhatsApp", "Twitterbot", "LinkedInBot",
  "TelegramBot", "Slackbot-LinkExpanding", "Slackbot", "Discordbot", "Applebot", "SkypeUriPreview", "vkShare"];

const GEN = "# Generated by tools/prerender-shop2.mjs (npm run prerender) — do not edit by hand.\n" +
  "# Which of the two policies lands in public/robots.txt is decided by\n" +
  "# $PUBLIC_BASE_URL; see docs/seo.md.\n";

/* The production policy names the live sitemap whatever base this run was
   given, so the file is never self-contradicting: it is the policy for
   rempireshop.com, and it says so. On a live run it is byte-identical to
   public/robots.txt, which is what the checker asserts. */
const LIVE_BASE = "https://rempireshop.com";
const robotsProduction = GEN +
  "# REMPIRE — production policy: open, minus everything behind a basket.\n" +
  "\nUser-agent: *\nAllow: /\n" +
  "\n# Nothing behind a cart, a payment form or a login belongs in an index.\n" +
  NO_INDEX_PATHS.map(p => "Disallow: " + p).join("\n") + "\n" +
  `\nSitemap: ${(LIVE ? BASE : LIVE_BASE) + "/sitemap.xml"}\n`;

const robotsStaging = GEN +
  "# REMPIRE — staging policy: closed to general crawlers, open to the link\n" +
  "# preview scrapers so a shared URL still renders a card. Keeping staging\n" +
  "# out of an index is done by the per-page robots meta and the X-Robots-Tag\n" +
  "# header, both of which are authoritative and neither of which these bots\n" +
  "# act on.\n" +
  "\nUser-agent: *\nDisallow: /\n" +
  "\n# --- link preview scrapers ---\n" +
  CLOSED_BOTS.map(b => `\nUser-agent: ${b}\nAllow: /\n`).join("") +
  "\n# --- what stays closed once the site opens ---\n" +
  "# Listed here so the rule is written down while staging is still shut, and\n" +
  "# so the preview bots above never wander into a cart.\n" +
  "User-agent: *\n" +
  NO_INDEX_PATHS.map(p => "Disallow: " + p).join("\n") + "\n" +
  `\nSitemap: ${abs("/sitemap.xml")}\n`;

await writeFile(path.join(PUB, "robots.production.txt"), robotsProduction, "utf8");
await writeFile(path.join(PUB, "robots.staging.txt"), robotsStaging, "utf8");
await writeFile(path.join(PUB, "robots.txt"), LIVE ? robotsProduction : robotsStaging, "utf8");

const perLang = CATALOGUE.length + CATS.length + 1 + BRANDS.length + 1 +
  LEGAL_SLUGS.length + (BUNDLES.length ? BUNDLES.length + 1 : 0) + 1;

console.log(
  `prerender: ${pages.length} pages (${written} written, ${same} unchanged, ${removed} stale removed)\n` +
  `           ${LANGS.length} languages × ${perLang}: ${CATALOGUE.length} products + ${CATS.length + 1} categories + ` +
    `${BRANDS.length} brands + 1 home + ${LEGAL_SLUGS.length} info + ${BUNDLES.length ? BUNDLES.length + 1 : 0} sets + 1 gift\n` +
  `           base ${BASE}  robots "${ROBOTS}"  robots.txt = ${LIVE ? "production" : "staging"}  assets ?v=${ASSET_V}\n` +
  `           og cards: ${OG_CARDS.size} on disk (${cardsMade} drawn this run)  every og:image ${OG_W}×${OG_H}\n` +
  `           sitemap: ${entries.length} urls in ${sitemapFiles.length || 1} file(s)`
);
