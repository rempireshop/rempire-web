/* Static pages for the shop2 storefront — one per screen per language.
   `npm run prerender`

   The shop is a vanilla-JS SPA: one shell, every screen drawn by app.js. That
   is fine for a shopper and useless for a search engine, which indexes what
   the HTML says before any script runs. This writes that HTML out:

     public/shop2/{,et/,en/}index.html          three home pages
     public/shop2/{,et/,en/}c/<cat>/index.html  category pages
     public/shop2/{,et/,en/}b/<brand>/index.html brand pages
     public/shop2/{,et/,en/}p/<id>/index.html   product pages

   Each carries a full head (title, description, canonical, the hreflang
   cluster, OpenGraph/Twitter, JSON-LD) and, inside #app, the screen's real
   content — name, brand, price, sizes, description, image with alt, and
   crawlable links to everything next to it. app.js finds that block under
   `#prerender`, leaves it alone until its own first render has painted, and
   then drops it, so nothing ever blanks or flashes.

   Nothing here is hand-written twice: the asset tags come out of
   public/shop2/index.html (including its ?v= token) and the translation
   tables come out of public/shop2/app.js, so a prerendered title and the one
   app.js sets a moment later are the same string.

   Also writes public/sitemap.xml (with xhtml:link alternates) and
   public/robots.production.txt. Base URL: $PUBLIC_BASE_URL, default the live
   domain. See docs/seo.md. */

import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "public");
const SHOP2 = path.join(PUB, "shop2");
const SHOP = path.join(PUB, "shop");

const BASE = String(process.env.PUBLIC_BASE_URL || "https://rempireshop.com").replace(/\/+$/, "");
/* Staging must not be indexed even if the X-Robots-Tag header is ever lost,
   so the robots meta follows the base URL rather than a separate switch. */
const LIVE = /(^|\.)rempireshop\.com$/i.test(new URL(BASE).hostname);
const ROBOTS = LIVE ? "index, follow, max-image-preview:large" : "noindex, nofollow";

const LANGS = [
  { code: "RU", seg: "", tag: "ru", htmlLang: "ru", ogLocale: "ru_RU" },
  { code: "ET", seg: "et", tag: "et", htmlLang: "et", ogLocale: "et_EE" },
  { code: "EN", seg: "en", tag: "en", htmlLang: "en", ogLocale: "en_US" }
];

const esc = s => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const eur = n => (Math.round(n * 100) / 100).toFixed(2).replace(".", ",").replace(",00", "") + " €";
const stripTags = h => String(h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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
      `${price} · ${cat} · ${stock}. Магазин Rempire, Таллинн — доставка Omniva, SmartPosti и DPD, самовывоз на Mardi 1.`
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
      `${price} · ${cat} · ${stock}. Rempire'i pood, Tallinn — tarne Omniva, SmartPosti ja DPD-ga, järeletulek Mardi 1.`
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
      `${price} · ${cat} · ${stock}. Rempire shop, Tallinn — Omniva, SmartPosti and DPD delivery, pickup at Mardi 1.`
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
function headBlock({ lang, seg, rest, title, desc, image, imageAlt, ogType, wide, jsonld }) {
  const canonical = abs(langPath(seg, rest));
  const ld = (Array.isArray(jsonld) ? jsonld : [jsonld]).filter(Boolean);
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
${wide ? '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n' : ""}<meta name="twitter:card" content="${wide ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${esc(title)}" data-seo="twitter:title">
<meta name="twitter:description" content="${esc(desc)}" data-seo="twitter:description">
<meta name="twitter:image" content="${esc(image)}" data-seo="twitter:image">
<style id="prestyle">${PRE_CSS}</style>
${ld.map(o => '<script type="application/ld+json"' +
    /* app.js writes the Product block into #ldjson, so handing it this one
       means it rewrites it in place rather than adding a second Product. The
       rest describe the page this file was generated for and are dropped by
       app.js the moment the shopper navigates somewhere else. */
    (o["@type"] === "Product" ? ' id="ldjson"' : ' data-seo="ldjson-page"') +
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

const ORG_LD = {
  "@context": "https://schema.org", "@type": "Organization",
  name: "REMPIRE", url: abs("/shop2/"),
  logo: abs("/brand/rempire-tower.svg"),
  address: {
    "@type": "PostalAddress", streetAddress: "Mardi 1",
    addressLocality: "Tallinn", addressCountry: "EE"
  },
  sameAs: ["https://www.instagram.com/rempireshop/", "https://www.facebook.com/rempireshop/"]
};

/* ---------- screens ----------------------------------------------------- */

const BRANDS = [...new Set(CATALOGUE.map(p => p.brand))].sort((a, b) => a.localeCompare(b, "en"));
const BRAND_SLUG = new Map(BRANDS.map(b => [b, slugify(b)]));
const CATS = Object.keys(CAT_NAMES);
const OG_CARDS = new Set(existsSync(path.join(SHOP, "og")) ? await readdir(path.join(SHOP, "og")) : []);

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

  /* The 1200×630 cards exist for the ninety-five products the old shop had.
     Everything else shares its own cutout, which is square — so the card type
     follows the image rather than promising a wide crop that is not there. */
  const hasCard = OG_CARDS.has(p.id + ".jpg");
  const image = hasCard ? abs("/shop/og/" + p.id + ".jpg") : imgUrl(p);

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
      ogType: "product", wide: hasCard,
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
      image: first ? imgUrl(first) : abs("/og-shop.png"),
      imageAlt: heading, ogType: "website", wide: !first,
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
      image: abs("/og-shop.png"), imageAlt: "REMPIRE", ogType: "website", wide: true,
      jsonld: [ORG_LD, {
        "@context": "https://schema.org", "@type": "WebSite",
        name: "REMPIRE", url: abs(langPath(seg, "/")), inLanguage: lang.tag
      }],
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
const OWNED = ["p", "c", "b", "et", "en"];
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

const entries = [];
for (const lang of LANGS) {
  entries.push(urlEntry("/", lang.seg, "1.0"));
  for (const c of ["all", ...CATS]) entries.push(urlEntry("/c/" + c + "/", lang.seg, "0.8"));
  for (const b of BRANDS) entries.push(urlEntry("/b/" + BRAND_SLUG.get(b) + "/", lang.seg, "0.6"));
  for (const p of CATALOGUE) entries.push(urlEntry("/p/" + encodeURIComponent(p.id) + "/", lang.seg, "0.7"));
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
   public/robots.txt is the staging policy (everything closed to general
   crawlers, link-preview bots named). It is not overwritten here — the file
   the site switches to is written beside it, and docs/seo.md says to swap
   them. */
await writeFile(path.join(PUB, "robots.production.txt"),
  "# REMPIRE — production robots.txt.\n" +
  "# Generated by tools/prerender-shop2.mjs. At the switch this file replaces\n" +
  "# public/robots.txt (see docs/seo.md); regenerate it with\n" +
  "#   PUBLIC_BASE_URL=https://rempireshop.com npm run prerender\n" +
  "\n" +
  "User-agent: *\n" +
  "Allow: /\n" +
  "\n" +
  "# Nothing behind a cart, a payment form or a login belongs in an index.\n" +
  "Disallow: /shop2/admin\n" +
  "Disallow: /shop2/checkout\n" +
  "Disallow: /shop2/cart\n" +
  "Disallow: /shop2/*/admin\n" +
  "Disallow: /shop2/*/checkout\n" +
  "Disallow: /shop2/*/cart\n" +
  "Disallow: /api/\n" +
  "\n" +
  `Sitemap: ${abs("/sitemap.xml")}\n`, "utf8");

console.log(
  `prerender: ${pages.length} pages (${written} written, ${same} unchanged, ${removed} stale removed)\n` +
  `           ${LANGS.length} languages × ${CATALOGUE.length} products + ${CATS.length + 1} categories + ${BRANDS.length} brands + 1 home\n` +
  `           base ${BASE}  robots "${ROBOTS}"  assets ?v=${ASSET_V}\n` +
  `           sitemap: ${entries.length} urls in ${sitemapFiles.length || 1} file(s)`
);
