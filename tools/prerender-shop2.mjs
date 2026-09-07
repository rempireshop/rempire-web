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

   Also writes the sitemap — public/sitemap.xml, an index over
   public/sitemap-N.xml (the pages above, with xhtml:link alternates) and
   sitemap-custom.xml, which the app serves for the owner's own products —
   and the two robots policies; public/robots.txt is written to match
   $PUBLIC_BASE_URL, so staging and production cannot disagree. Base URL:
   $PUBLIC_BASE_URL, default the live domain. See docs/seo.md.

   The head builders themselves live in src/lib/seo-head.mjs: a product the
   owner creates in the panel (custom_products) has no file here — its page
   is written at request time by src/lib/product-page.ts from the same
   functions, so the two never disagree. */

import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// blog: published posts come straight out of Postgres, when there is one to
// read — see tools/lib/blog-export.mjs for why this is a separate module.
import { fetchPublishedPosts, pickLang, renderPostBody } from "./lib/blog-export.mjs";
import { fetchSettings } from "./lib/settings-export.mjs";
/* The head builders, the copy table and the sitemap row are shared with the
   request-time page of a custom product (src/lib/product-page.ts, a row of
   custom_products that did not exist when this ran) — one module, so the
   page the owner created in the panel carries the head a catalogue product
   does. This file keeps what is build-only: the catalogue, the content, the
   OG cards, the writing. */
import {
  LANGS, esc, eur, stripTags, slugify, clip, fitTitle, langPath, T,
  OG_W, OG_H, OG_DEFAULT, OG_FALLBACK,
  headBlock as sharedHeadBlock, href, langNav, crumbs, breadcrumbLD as sharedBreadcrumbLD,
  productSpec, patchShell, HEAD_MARK, PRE_MARK,
  sitemapUrlEntry, SITEMAP_OPEN, SITEMAP_CLOSE, SITEMAP_CUSTOM,
  baseFrom, isLiveBase, ROBOTS_OPEN, ROBOTS_CLOSED
} from "../src/lib/seo-head.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "public");
const SHOP2 = path.join(PUB, "shop2");
const SHOP = path.join(PUB, "shop");

const BASE_ENV = process.env.PUBLIC_BASE_URL;
const BASE = baseFrom(BASE_ENV);

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
   robots.txt against the host in the sitemap and fails on exactly that.
   isLiveBase() is the one place the rule is spelled out — the request-time
   product page (src/lib/product-page.ts) asks it the same question. */
const LIVE = isLiveBase(BASE_ENV);
const ROBOTS = LIVE ? ROBOTS_OPEN : ROBOTS_CLOSED;
if (!BASE_ENV) {
  console.warn("! PUBLIC_BASE_URL is not set — using " + BASE + " for absolute URLs but writing " +
    "noindex and the closed robots.txt. Set it explicitly, at the switch too.");
}

/* LANGS, esc, eur, stripTags, slugify, clip and fitTitle come from
   src/lib/seo-head.mjs — see the import above. */

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
/* the checkout's payment marks (Visa, Mastercard, Apple Pay, Google Pay, the
   bank glyph) — «Доставка и оплата» prints the same ones */
const PAYLOGOS = await loadObj("paylogos.js", "PAYLOGOS");

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

/* blog: [] silently when DATABASE_URL is not set, or when the database could
   not be reached — this run then simply writes no /blog/ pages, exactly like
   an empty BUNDLES writes no /sets/ pages. Publishing a post needs a redeploy
   to show up here; docs/blog.md says so for Renat. */
const BLOG_POSTS = await fetchPublishedPosts();
if (!BLOG_POSTS.length) {
  console.log(process.env.DATABASE_URL
    ? "  (no published posts — no /blog/ pages this run)"
    : "  (DATABASE_URL not set — no /blog/ pages this run)");
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

/* ---------- «Доставка и оплата»: the builder, lifted the same way ---------

   deliveryPageHTML() and the four declarations it reads — SHIP_RULES (the
   defaults the checkout bills with), CARRIER_NAMES, CARRIERS_BY_COUNTRY and
   DELIVERY_ROWS — live in app.js and only there, next to the checkout that
   uses them. Lifted here, so the static /info/shipping/ page and the one the
   shop draws live are the same function over the same tables; the builder
   is written as a pure function of its `ctx` for exactly this reason (see
   its comment in app.js). If the slices stop coming out, the page falls back
   to the policy text and the tool says so. */
let DELIVERY = null;
try {
  const pieces = [
    sliceFrom(/^ {2}var SHIP_RULES = \{$/, DECL_END),
    sliceFrom(/^ {2}var CARRIER_NAMES = \{$/, DECL_END),
    sliceFrom(/^ {2}var CARRIERS_BY_COUNTRY = \{$/, DECL_END),
    sliceFrom(/^ {2}var DELIVERY_ROWS = \[$/, DECL_END),
    sliceFrom(/^ {2}function deliveryPageHTML\(ctx\) \{$/, FN_END)
  ];
  if (pieces.some(p => !p)) throw new Error("could not lift the delivery page (deliveryPageHTML & co) out of app.js");
  DELIVERY = new Function(pieces.join("\n") +
    "\nreturn { rules: SHIP_RULES, carrierNames: CARRIER_NAMES, carriers: CARRIERS_BY_COUNTRY, rows: DELIVERY_ROWS, page: deliveryPageHTML };")();
  if (typeof DELIVERY.page !== "function" || !DELIVERY.rules.methods) throw new Error("the lifted delivery page has the wrong shape");
} catch (e) {
  console.warn("! " + e.message + "\n! /info/shipping/ is written from the policy text alone");
  DELIVERY = null;
}

/* The live rules, when the database is there — the same merge over the
   defaults that app.js applyShipRules() does (key by key, a bad number
   ignored), so the page prints what the checkout will bill. Without
   DATABASE_URL these are the defaults src/lib/shipping.ts carries too. */
const LIVE_SETTINGS = await fetchSettings(["shipping_rules", "pricing", "gift_amounts"]);
function mergeShipRules(defaults, raw) {
  const out = JSON.parse(JSON.stringify(defaults));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  if (raw.freeFrom === null || typeof raw.freeFrom === "number") out.freeFrom = raw.freeFrom;
  if (raw.freeFromByCountry && typeof raw.freeFromByCountry === "object") out.freeFromByCountry = raw.freeFromByCountry;
  if (raw.methods && typeof raw.methods === "object") {
    for (const m of ["parcel", "courier", "pickup"]) {
      if (!raw.methods[m] || typeof raw.methods[m] !== "object") continue;
      for (const c of Object.keys(raw.methods[m])) {
        const v = Number(raw.methods[m][c]);
        if (Number.isFinite(v) && v >= 0) out.methods[m][c] = v;
      }
    }
  }
  if (raw.carriers && typeof raw.carriers === "object") out.carriers = raw.carriers;
  return out;
}
const SHIP_RULES_LIVE = DELIVERY ? mergeShipRules(DELIVERY.rules, LIVE_SETTINGS.shipping_rules) : null;
const LOYALTY_LIVE = (() => {
  const l = LIVE_SETTINGS.pricing && LIVE_SETTINGS.pricing.loyalty;
  if (!l || typeof l !== "object") return { enabled: true, earnPct: 5 };
  const pct = Number(l.earnPct);
  return { enabled: l.enabled !== false, earnPct: Number.isFinite(pct) && pct >= 0 ? pct : 5 };
})();
if (DELIVERY) {
  console.log("  delivery page: " + (LIVE_SETTINGS.shipping_rules ? "live tariffs from settings.shipping_rules" : "built-in tariff defaults") +
    " · EE parcel " + SHIP_RULES_LIVE.methods.parcel.EE + " € · free from " + SHIP_RULES_LIVE.freeFrom + " €");
}
/* app.js eur(): «12,90 €» for RU/ET, «€12.90» for EN, whole euros without
   decimals — so the static English page prints the price the live one does. */
function eurFor(n, code) {
  const v = (Math.round(n * 100) / 100).toFixed(2);
  return code === "EN" ? "€" + v.replace(".00", "") : v.replace(".", ",").replace(",00", "") + " €";
}

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
// HEAD_MARK / PRE_MARK — the two marker pairs — are shared with the
// request-time page, which patches the very same shell (src/lib/seo-head.mjs)
/* The copy starts at the first favicon <link>. It is matched on a copy of the
   shell with its HTML comments removed: a comment that merely *mentions* the
   tag once made the copy start inside the comment, and the orphaned comment
   tail became visible text at the top of every ET/EN page (the browser closes
   <head> at the first text node). The generated pages carry no comments. */
const shellNoComments = shell.replace(/<!--[\s\S]*?-->/g, "");
const headAssets = (shellNoComments.match(/<link rel="icon"[\s\S]*?(?=<\/head>)/) || [])[0];
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

/* ---------- copy, one table per language --------------------------------

   T — the strings setHead() in app.js uses, one table per language — lives
   in src/lib/seo-head.mjs now, next to the head builder that prints them,
   so the request-time product page says the same words. */

/* ---------- URLs -------------------------------------------------------- */

const abs = u => BASE + u;

/* ---------- the page --------------------------------------------------- */

/* Everything a crawler reads, in one block — headBlock() in
   src/lib/seo-head.mjs, bound here to this run's base URL and robots value.
   It is written between the markers in index.html and inlined verbatim into
   every generated page, so the Russian home page and the other 809 are
   built by the same code as a custom product's page at request time. */
const headBlock = spec => sharedHeadBlock({ base: BASE, robots: ROBOTS, ...spec });

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
<div id="app"><!-- prerender:start --><div id="prerender">${spec.content}${blogDataScript(spec.lang.code)}</div><!-- prerender:end --></div>
${bodyScripts}</body>
</html>
`;
}

/* patchShell() replaces between the two marker pairs with replacement
   functions, not strings — a description containing $& or $1 would otherwise
   be spliced by String.replace's own substitution rules. The Russian home
   page keeps its <html lang="ru"> (no fourth argument). */
function patchedShell(spec) {
  return patchShell(shell, headBlock(spec), spec.content + blogDataScript(spec.lang.code));
}

/* ---------- shared blocks ----------------------------------------------
   href(), langNav(), crumbs() and breadcrumbLD() are the shared ones from
   src/lib/seo-head.mjs — the request-time product page draws the same
   breadcrumbs and the same three-language nav. */

const breadcrumbLD = items => sharedBreadcrumbLD(BASE, items);

function stockLabel(p, t) {
  return p.stock === "out" ? t.out : p.stock === "low" ? t.low : t.inStock;
}
function priceLabel(p, t) {
  return (p.priceFrom ? t.from : "") + eur(p.price);
}
function imgUrl(p) { return abs(String(p.img).split("?")[0]) + "?v=" + encodeURIComponent(String(p.img).split("?v=")[1] || "1"); }

/* How the i-th picture of a list loads. A page's first row is on screen
   before app.js has even arrived, and the shop's own render then paints the
   very same files as CSS backgrounds — so the first four (two phone rows)
   are asked for at once and only the rest lazily: `loading="lazy"` on the
   first picture is what Lighthouse calls out as the LCP image being
   lazy-loaded, and with every picture lazy Chrome's first paint of the
   static page waited for the scripts (home FCP 5.2 s → 0.9 s, mobile
   Lighthouse, once the first row loaded eagerly). No fetchpriority="high"
   on them: the shop paints nothing until every script has arrived, so the
   scripts are the ones that must not queue behind pictures — a hint on the
   scripts themselves measured worse still. `i` undefined (a shelf under a
   product or a post, below the fold) = lazy. The home grid's first row is
   eager too, which the shell every other route falls back to pays for with
   four small revalidated pictures on a cold load. */
function imgLoad(i) {
  return i < 4 ? "" : ' loading="lazy"';
}

/* One product tile. An <a>, not a button: this is the only path a crawler has
   from a category to the 220 product pages. */
function card(p, seg, code, t, i) {
  const name = tr(p.name, code, true);
  return '<li><a class="pre__card" href="' + href(seg, "/p/" + encodeURIComponent(p.id) + "/") + '">' +
    '<img class="pre__img" src="' + esc(p.img) + '" alt="' + esc(p.brand + " " + name) + '"' + imgLoad(i) + ' width="400" height="400">' +
    '<span class="pre__brand">' + esc(p.brand) + "</span>" +
    '<span class="pre__nm">' + esc(name) + "</span>" +
    '<span class="pre__pr num">' + esc(priceLabel(p, t)) + "</span>" +
    "</a></li>";
}

/* `eager`: this grid is the page's first screen (a category or brand page),
   so its first row loads at once — see imgLoad(). */
function grid(list, seg, code, t, eager) {
  return '<ul class="grid" style="list-style:none;padding:0">' + list.map((p, i) => card(p, seg, code, t, eager ? i : undefined)).join("") + "</ul>";
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
/* One node, named, so the WebSite block on every home page can point at it
   instead of describing the shop a second time. */
const ORG_ID = abs("/shop2/") + "#organization";
/* «rempire» is the shop's biggest query — 141 impressions in the week of
   29.08–05.09.2026 — and it ranks 3.79th for its own name. A brand ranks for
   its name on the strength of what the site says the brand IS: the names it
   also goes by, the company behind it, where to reach it. Until 07.09 this
   block was five keys and none of them was a name (docs/audit/2026-09-07-seo.md).
   Every value below comes from src/data/content.default.json — the same place
   the footer and the invoices take them from — so there is nothing here to
   contradict or to keep in step by hand.
   `Store`, not only `Organization`: there is a counter at Mardi 1 and the
   checkout offers pickup from it, so the physical shop is a fact, not a
   flourish. */
const ORG_LD = {
  "@context": "https://schema.org", "@type": ["Organization", "Store"],
  "@id": ORG_ID,
  name: "REMPIRE",
  alternateName: ["Rempire", "Rempire Shop", "rempireshop", IDENTITY.legalName].filter(Boolean),
  legalName: IDENTITY.legalName,
  url: abs("/shop2/"),
  logo: abs("/brand/rempire-tower.svg"),
  image: abs(OG_FALLBACK),
  email: IDENTITY.email || undefined,
  telephone: IDENTITY.phone || undefined,
  vatID: IDENTITY.vatNumber || undefined,
  taxID: IDENTITY.regCode || undefined,
  address: postalAddress(IDENTITY.address),
  areaServed: ["EE", "LV", "LT", "FI"],
  sameAs: SOCIAL_ORDER.map(k => SHOP_CONTENT.social[k]).filter(Boolean)
};
/* JSON.stringify drops an undefined value, so an empty setting leaves the key
   out rather than publishing "" — but a reader of this file should not have to
   know that. */
for (const k of Object.keys(ORG_LD)) if (ORG_LD[k] === undefined) delete ORG_LD[k];

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
// OG_W × OG_H, OG_DEFAULT (tower on the ground, for pages with no product) and
// OG_FALLBACK (shipped, 1200×630 — used when sharp is missing) are imported
const OG_GROUND = { r: 0xed, g: 0xea, b: 0xe1 };

let sharp = null;
try { ({ default: sharp } = await import("sharp")); }
catch { console.warn("! sharp did not load — no OG cards generated this run"); }

let cardsMade = 0;

/* currentColor rasterises as black; the brand ink is #1c1a00. The vector is
   the source rather than brand/tower-email-ink.png, which is 72×112 (the tower alone, for the letters) and would be
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

/* blog: the cover is usually a photo the owner uploaded to R2
   (docs/media.md), not a local file, so there is nothing on disk to
   composite — it is downloaded once and cropped to the card size instead.
   A root-relative cover (the sample posts use a catalogue photo under
   /shop/img/) is read off disk instead: fetch() has no origin to resolve it
   against in a build script. "attention" picks the most detailed region
   rather than a plain centre crop, which matters for a cover shot at an odd
   aspect ratio. */
async function drawBlogCard(file, coverUrl) {
  let buf;
  if (coverUrl.startsWith("/")) {
    buf = await readFile(path.join(PUB, coverUrl.replace(/^\/+/, "").split("?")[0]));
  } else {
    const res = await fetch(coverUrl);
    if (!res.ok) throw new Error("fetch " + res.status);
    buf = Buffer.from(await res.arrayBuffer());
  }
  await mkdir(path.dirname(file), { recursive: true });
  await sharp(buf).resize(OG_W, OG_H, { fit: "cover", position: "attention" }).jpeg({ quality: 84 }).toFile(file);
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
  for (const post of BLOG_POSTS) {
    if (!post.coverUrl) continue;
    const f = path.join(OGDIR, "blog-" + post.slug + ".jpg");
    if (existsSync(f)) continue;
    try { await drawBlogCard(f, post.coverUrl); }
    catch (e) { console.warn("! og card for blog/" + post.slug + ": " + e.message); }
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
const blogCard1200 = post => (OG_CARDS.has("blog-" + post.slug + ".jpg") ? "/shop/og/blog-" + post.slug + ".jpg" : null);

function productPage(p, lang) {
  const { code, seg } = { code: lang.code, seg: lang.seg };
  const t = T[code];
  const name = tr(p.name, code, true);
  const catName = tr(CAT_NAMES[p.cat] || "", code, false);

  /* Title ladder, description, breadcrumb and the Product JSON-LD: the shared
     productSpec() (src/lib/seo-head.mjs), which the request-time page of a
     custom product calls with the owner's own texts. The catalogue's static
     English pair — title and description exported from the old shop — is the
     English page's when there is one. */
  const spec = productSpec({
    base: BASE, lang,
    id: p.id, cat: p.cat, catName, brand: p.brand, name,
    price: p.price, priceFrom: p.priceFrom, stock: p.stock,
    seoTitle: code === "EN" && p.seo && p.seo.t ? p.seo.t : "",
    seoDesc: "",
    body: code === "EN" && p.seo && p.seo.d ? p.seo.d : descFor(p, code),
    /* Its own 1 200×630 card, drawn above if the old shop had not left one. The
       square .webp cutout is never offered to a scraper: half of them refuse
       the format outright and the rest crop it through the middle. */
    image: ogPick(productCard(p)),
    imageUrls: [imgUrl(p)]
  });
  const { rest, core, priceText: price, crumbItems } = spec;

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
        // the product photo is the page's LCP: asked for first, at high priority
        '<img class="pre__img" src="' + esc(p.img) + '" alt="' + esc(core) + '" fetchpriority="high" width="800" height="800">' +
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
    spec: { ...spec, content }
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
      grid(list, seg, code, t, true) +
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

/* ---------- /brands/ -----------------------------------------------------

   The one shopper-facing screen that had no page of its own. Every language
   fell through to the Russian shell, so /shop2/et/brands/ and
   /shop2/en/brands/ were served the home page's title, the home page's
   description and a canonical pointing at /shop2/ — and it was absent from
   the sitemap while being perfectly crawlable. `f8a3926` taught setHead() to
   fix the head once the script runs, which is half the fix; this is the other
   half, the one a crawler that does not run JS reads. Dim, 07.09.2026: give
   it a real page.

   Mirrors screenBrands() in public/shop2/app.js — the same crumb, the same
   <h1>, the same opening sentence (which is also the description, from the
   same dictionary), and the brand list as real links, which is a second
   crawlable path from here to all 26 brand pages. */

const BRANDS_INTRO = "Марки, с которыми работает салон Rempire. Нажмите на бренд — покажем всё, что есть в наличии.";
const BRAND_COUNT = new Map(BRANDS.map(b => [b, CATALOGUE.filter(p => p.brand === b).length]));

function brandsPage(lang) {
  const { code, seg } = lang;
  const t = T[code];
  const rest = "/brands/";
  const heading = t.brands;
  const crumbItems = [[t.home, langPath(seg, "/")], [heading, null]];
  const desc = tr(BRANDS_INTRO, code, false);

  const content = '<div class="wrap">' +
    crumbs(crumbItems.map(([l, u]) => [l, u ? esc(u) : null])) +
    '<section class="sec">' +
      '<h1 class="display h1">' + esc(heading) + "</h1>" +
      '<p class="sec__intro">' + esc(desc) + "</p>" +
      /* The count is a bare number on purpose: «12 товаров» would need a
         plural rule per language for a figure app.js repaints a moment
         later anyway. */
      '<ul class="pre__list">' + BRANDS.map(b =>
        '<li><a href="' + href(seg, "/b/" + BRAND_SLUG.get(b) + "/") + '">' + esc(b) +
        ' <span class="num">' + BRAND_COUNT.get(b) + "</span></a></li>").join("") + "</ul>" +
    "</section>" +
    langNav(seg, rest, t) +
    "</div>";

  return {
    file: path.join(SHOP2, seg, "brands", "index.html"),
    spec: {
      lang, seg, rest,
      title: fitTitle(heading, heading + " — REMPIRE"),
      desc: clip(desc, 158),
      image: ogPick(OG_DEFAULT), imageAlt: heading, ogType: "website",
      jsonld: [
        ORG_LD,
        breadcrumbLD(crumbItems.map(([l, u]) => [l, u])),
        {
          "@context": "https://schema.org", "@type": "ItemList",
          name: heading, numberOfItems: BRANDS.length,
          itemListElement: BRANDS.map((b, i) => ({
            "@type": "ListItem", position: i + 1,
            url: abs(langPath(seg, "/b/" + BRAND_SLUG.get(b) + "/")),
            name: b
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
      grid(featured, seg, code, t, true) +
    "</section>" +
    langNav(seg, rest, t) +
    "</div>";
  return {
    file: path.join(SHOP2, seg, "index.html"),
    spec: {
      lang, seg, rest,
      title: t.base, desc: t.homeDesc,
      image: ogPick(OG_FALLBACK), imageAlt: "REMPIRE", ogType: "website",
      /* The WebSite block names the site the way a searcher types it and
         hands the publisher back to the Organization node above rather than
         repeating it — one entity, three language home pages. No
         `potentialAction`/SearchAction: Google retired the sitelinks
         searchbox it fed, so it would be markup nobody reads. */
      jsonld: [ORG_LD, {
        "@context": "https://schema.org", "@type": "WebSite",
        "@id": abs(langPath(seg, "/")) + "#website",
        name: "REMPIRE",
        alternateName: ["Rempire", "Rempire Shop", "rempireshop.com"],
        url: abs(langPath(seg, "/")),
        inLanguage: lang.tag,
        publisher: { "@id": ORG_ID }
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

  /* «Доставка и оплата» is not a policy text first: the page a customer
     reads — prices from the rules, times, payment marks, the returns
     summary, the contacts — with the policy folded under «Полные условия
     доставки» at the bottom. The same builder app.js's screenDelivery()
     calls, over the same rules, with the same words. */
  if (slug === "shipping" && DELIVERY) {
    const c = IDENTITY;
    const phoneHTML = c.phone ? '<a href="tel:' + esc(c.phone.replace(/[^\d+]/g, "")) + '">' + esc(c.phone) + "</a>" : "";
    const mailHTML = c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a>" : "";
    const pageHtml = DELIVERY.page({
      lang: code,
      tr: s => tr(s, code, false),
      esc, eur: n => eurFor(n, code), title: heading,
      rules: SHIP_RULES_LIVE, carriers: DELIVERY.carriers, carrierNames: DELIVERY.carrierNames, rows: DELIVERY.rows,
      address: c.address, hoursHTML: contactHours(code), phoneHTML, mailHTML,
      logos: PAYLOGOS, banks: null, loyalty: LOYALTY_LIVE,
      link: (s, label) => '<a href="' + href(seg, infoRest(s)) + '">' + esc(label) + "</a>",
      legalHtml: body, legalNote: true
    });
    return {
      file: path.join(SHOP2, seg, "info", slug, "index.html"),
      spec: {
        lang, seg, rest,
        title: fitTitle(heading, heading + " — REMPIRE"),
        desc: clip(t.infoDesc(heading), 158),
        image: ogPick(OG_DEFAULT), imageAlt: heading, ogType: "article",
        jsonld: [ORG_LD, breadcrumbLD(crumbItems.map(([l, u]) => [l, u]))],
        content: '<div class="wrap wrap--mid">' +
          crumbs(crumbItems.map(([l, u]) => [l, u ? esc(u) : null])) +
          '<section class="sec dlv">' + pageHtml + "</section>" +
          '<ul class="pre__list">' + others + "</ul>" +
          langNav(seg, rest, t) +
          "</div>"
      }
    };
  }

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
      (i ? ' loading="lazy"' : ' fetchpriority="high"') + ' width="400" height="400" style="max-width:220px">').join("");
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

  const cards = BUNDLES.map((b, i) => {
    const title = bundleText(b, "title", code);
    return '<li><a class="pre__card" href="' + href(seg, "/set/" + encodeURIComponent(b.id) + "/") + '">' +
      '<img class="pre__img" src="' + esc((b.images || [])[0] || "") + '" alt="' + esc(title) +
        '"' + imgLoad(i) + ' width="400" height="400">' +
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

/* The gift-card denominations actually on sale. It used to be a fixed three
   here (and, worse, the four the SERVER accepts a few lines down), while
   «Маркетинг → Подарочные карты» decided what the /gift/ page really offered
   — so a build after the owner switched 25 off wrote a page naming a card
   nobody could buy. Dim, 07.09.2026: the page comes from the setting.
   Same sanitiser as cleanGiftAmounts() in src/lib/giftcards.ts — the four the
   server will accept, sorted, de-duplicated, falling back to the three the
   shop has always sold rather than leaving the page with no amount on it. */
const GIFT_AMOUNTS_ALLOWED = [25, 50, 75, 100];
const GIFT_AMOUNTS_DEFAULT = [25, 50, 100];
const GIFT_AMOUNTS = (() => {
  const raw = LIVE_SETTINGS.gift_amounts;
  if (!Array.isArray(raw)) return [...GIFT_AMOUNTS_DEFAULT];
  const out = [...new Set(raw.map(Number).filter(n => GIFT_AMOUNTS_ALLOWED.includes(n)))].sort((x, y) => x - y);
  return out.length ? out : [...GIFT_AMOUNTS_DEFAULT];
})();
/** «25 €, 50 €, 100 €» / «€25, €50, €100» — giftAmountsPhrase() in app.js. */
const giftAmountsPhrase = code => GIFT_AMOUNTS.map(a => eurFor(a, code)).join(", ");

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
      '<ul class="pre__sizes">' + GIFT_AMOUNTS.map(a => "<li><span class=\"num\">" + esc(eurFor(a, code)) + "</span></li>").join("") + "</ul>" +
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
      desc: clip(t.giftDesc(giftAmountsPhrase(code)), 158),
      image: ogPick(OG_DEFAULT), imageAlt: heading, ogType: "website",
      jsonld: [ORG_LD, breadcrumbLD(crumbItems.map(([l, u]) => [l, u]))],
      content
    }
  };
}

/* ---------- blog ---------------------------------------------------------
   Posts live in Postgres (BLOG_POSTS, read by tools/lib/blog-export.mjs) —
   the only screen in this file whose content is not one of the generated
   JS files under public/shop/. Publishing a post needs a redeploy to reach
   this static page (docs/blog.md); the SPA renders it live off the API the
   moment it is published, redeploy or not. */

const dmy = iso => String(iso || "").slice(0, 10).split("-").reverse().join(".");

function blogTile(post, seg, code, t, i) {
  const title = pickLang(post.title, code) || post.slug;
  const excerpt = pickLang(post.excerpt, code);
  const rest = "/blog/" + encodeURIComponent(post.slug) + "/";
  return '<li><a class="pre__card blog__tile" href="' + href(seg, rest) + '">' +
    (post.coverUrl
      ? '<img class="pre__img" src="' + esc(post.coverUrl) + '" alt="' + esc(pickLang(post.coverAlt, code) || title) + '"' + imgLoad(i) + ' width="400" height="400">'
      : "") +
    '<span class="pre__nm">' + esc(title) + "</span>" +
    (post.publishedAt ? '<span class="muted blog__date">' + dmy(post.publishedAt) + "</span>" : "") +
    (excerpt ? "<p>" + esc(clip(excerpt, 140)) + "</p>" : "") +
    "</a></li>";
}

/* Every page carries the blog list for its language (#blogdata — a few
   hundred bytes: titles, excerpts and covers, never a body), and an article
   page carries the article as well (#blogpost) — see hydrateBlog() in
   app.js: the first render then shows the posts at once, whichever page
   the visit started on and wherever it goes next, instead of an empty
   state that the API fills in a second later. Same shapes as /api/blog/
   and /api/blog/<slug>/, plus `stamp` — the newest edit the snapshot knows
   of, so app.js can tell whether a copy the tab fetched itself is newer.
   "</" is escaped so a body containing "</script>" cannot end the block
   early. */
function blogJsonScript(id, obj) {
  return '<script type="application/json" id="' + id + '">' +
    JSON.stringify(obj).replace(/<\//g, "<\\/") + "</script>";
}
function blogListItem(p, code) {
  return {
    slug: p.slug, title: pickLang(p.title, code), excerpt: pickLang(p.excerpt, code),
    coverUrl: p.coverUrl, coverAlt: pickLang(p.coverAlt, code), tags: p.tags, publishedAt: p.publishedAt
  };
}
const blogStamp = post => Date.parse(post.updatedAt || post.publishedAt || "") || 0;
const BLOG_STAMP = BLOG_POSTS.reduce((m, p) => Math.max(m, blogStamp(p)), 0);
function blogDataScript(code) {
  if (!BLOG_POSTS.length) return "";
  return blogJsonScript("blogdata", {
    lang: code, stamp: BLOG_STAMP,
    posts: BLOG_POSTS.slice(0, 10).map(p => blogListItem(p, code)), total: BLOG_POSTS.length, perPage: 10
  });
}
function blogListPage(lang) {
  const { code, seg } = lang;
  const t = T[code];
  const rest = "/blog/";
  const heading = tr("Блог", code, false);
  const content = '<div class="wrap">' +
    crumbs([[t.home, langPath(seg, "/")], [heading, null]]) +
    '<section class="sec">' +
      '<h1 class="display h1">' + esc(heading) + "</h1>" +
      (BLOG_POSTS.length
        ? '<ul class="grid blog__grid" style="list-style:none;padding:0">' + BLOG_POSTS.map((p, i) => blogTile(p, seg, code, t, i)).join("") + "</ul>"
        : '<p class="muted">' + esc(t.blogEmpty) + "</p>") +
    "</section>" +
    langNav(seg, rest, t) +
    "</div>";   // #blogdata rides on every page — fullPage()/patchedShell() add it

  return {
    file: path.join(SHOP2, seg, "blog", "index.html"),
    spec: {
      lang, seg, rest,
      title: fitTitle(heading, heading + " — REMPIRE"),
      desc: clip(t.blogDesc, 158),
      image: ogPick(BLOG_POSTS[0] ? blogCard1200(BLOG_POSTS[0]) : null, OG_DEFAULT),
      imageAlt: heading, ogType: "website",
      jsonld: [
        ORG_LD,
        breadcrumbLD([[t.home, langPath(seg, "/")], [heading, null]]),
        {
          "@context": "https://schema.org", "@type": "ItemList",
          name: heading, numberOfItems: BLOG_POSTS.length,
          itemListElement: BLOG_POSTS.slice(0, 50).map((p, i) => ({
            "@type": "ListItem", position: i + 1,
            url: abs(langPath(seg, "/blog/" + encodeURIComponent(p.slug) + "/")),
            name: pickLang(p.title, code) || p.slug
          }))
        }
      ],
      content
    }
  };
}

function blogPostPage(post, lang) {
  const { code, seg } = lang;
  const t = T[code];
  const rest = "/blog/" + encodeURIComponent(post.slug) + "/";
  const title = pickLang(post.title, code) || post.slug;
  const excerpt = pickLang(post.excerpt, code);
  const bodyHtml = renderPostBody(pickLang(post.body, code));
  const bodyText = stripTags(bodyHtml);
  // the Google pair is per language (pickLang: this language, else Russian),
  // and the excerpt, then the text, stand in only when neither was written —
  // the same ladder setHead() in app.js runs once the SPA takes the page over
  const desc = clip(pickLang(post.seoDesc, code) || excerpt || bodyText, 158);
  const seoTitleRaw = pickLang(post.seoTitle, code);
  const pageTitle = fitTitle(title, (seoTitleRaw || title) + " — REMPIRE");
  const blogLabel = tr("Блог", code, false);
  const crumbItems = [[t.home, langPath(seg, "/")], [blogLabel, langPath(seg, "/blog/")], [title, null]];

  const featured = (post.products || [])
    .map(id => CATALOGUE.find(p => p.id === id))
    .filter(Boolean)
    .slice(0, 8);

  const tagsHtml = post.tags && post.tags.length
    ? '<ul class="blog__tags">' + post.tags.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>"
    : "";

  const others = BLOG_POSTS.filter(p => p.slug !== post.slug).slice(0, 3);

  // the same shape screenBlogPost() in app.js paints, so the swap at boot
  // moves nothing: crumbs in the ordinary .wrap, the article in a reading
  // column (.blog__read), the products and the other articles at full width
  const content = '<div class="wrap">' +
    crumbs(crumbItems.map(([l, u]) => [l, u ? esc(u) : null])) +
    '<article class="sec blog__post blog__read">' +
      (post.coverUrl
        ? '<img class="pre__img blog__cover" src="' + esc(post.coverUrl) + '" alt="' + esc(pickLang(post.coverAlt, code) || title) + '" fetchpriority="high" width="1200" height="630">'
        : "") +
      '<h1 class="display h1">' + esc(title) + "</h1>" +
      (post.publishedAt ? '<p class="muted blog__date">' + dmy(post.publishedAt) + "</p>" : "") +
      tagsHtml +
      '<div class="acc__rich blog__body">' + bodyHtml + "</div>" +
    "</article>" +
    (featured.length
      ? '<section class="sec blog__shelf"><h2 class="display h1 blog__h2">' + esc(tr("Товары из статьи", code, false)) + "</h2>" + grid(featured, seg, code, t) + "</section>"
      : "") +
    (others.length
      ? '<section class="sec blog__shelf"><h2 class="display h1 blog__h2">' + esc(t.otherPosts) + "</h2>" +
        '<ul class="grid blog__grid" style="list-style:none;padding:0">' + others.map(p => blogTile(p, seg, code, t)).join("") + "</ul></section>"
      : "") +
    langNav(seg, rest, t) +
    blogJsonScript("blogpost", { lang: code, stamp: blogStamp(post), post: {
      slug: post.slug, title, excerpt, bodyHtml, coverUrl: post.coverUrl, coverAlt: pickLang(post.coverAlt, code),
      tags: post.tags, products: post.products, seoTitle: seoTitleRaw, seoDesc: pickLang(post.seoDesc, code),
      author: post.author, publishedAt: post.publishedAt
    } }) +
    "</div>";

  return {
    file: path.join(SHOP2, seg, "blog", post.slug, "index.html"),
    spec: {
      lang, seg, rest,
      title: pageTitle, desc,
      image: ogPick(blogCard1200(post)), imageAlt: title, ogType: "article",
      jsonld: [
        {
          "@context": "https://schema.org", "@type": "BlogPosting",
          headline: title,
          image: [ogPick(blogCard1200(post))],
          datePublished: post.publishedAt || post.updatedAt,
          dateModified: post.updatedAt || post.publishedAt,
          author: { "@type": "Organization", name: post.author || "Rempire" },
          publisher: {
            "@type": "Organization", name: "REMPIRE",
            logo: { "@type": "ImageObject", url: abs("/brand/rempire-tower.svg") }
          },
          description: desc,
          mainEntityOfPage: { "@type": "WebPage", "@id": abs(langPath(seg, rest)) },
          url: abs(langPath(seg, rest))
        },
        breadcrumbLD(crumbItems.map(([l, u]) => [l, u]))
      ],
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
  pages.push(brandsPage(lang));
  pages.push(giftPage(lang));
  // blog: [] when there is no database at build time — no /blog/ pages then,
  // same as an empty BUNDLES writing no /sets/ pages
  if (BLOG_POSTS.length) {
    pages.push(blogListPage(lang));
    for (const post of BLOG_POSTS) pages.push(blogPostPage(post, lang));
  }
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
const OWNED = ["p", "c", "b", "info", "set", "sets", "gift", "blog", "et", "en"];
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

/* blog: which posts got a static page this run — src/data/blog.prerendered.json,
   bundled into the app by the `next build` that follows (prebuild). The
   sitemap the app serves (src/app/sitemap-custom.xml/route.ts) lists the
   published posts that are NOT in here, so a post published after this
   build is in a sitemap the same minute, and one the build wrote is not
   named twice. The request-time blog page (src/lib/blog-page.ts) needs no
   such list: it only ever answers a slug the static layer has no file for. */
await writeFile(path.join(ROOT, "src", "data", "blog.prerendered.json"),
  JSON.stringify({ slugs: BLOG_POSTS.map(p => p.slug) }, null, 2) + "\n", "utf8");

/* ---------- sitemap ----------------------------------------------------- */

const today = new Date().toISOString().slice(0, 10);

/* Every language of a page is its own <url>, and each one lists the whole
   cluster — that is what the protocol asks for, and it is what lets Google
   swap in the Estonian result for an Estonian searcher. sitemapUrlEntry()
   in src/lib/seo-head.mjs is the row; the custom products' sitemap route
   writes the same one. */
const urlEntry = (rest, seg, priority) => sitemapUrlEntry(BASE, rest, seg, priority, today);

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
  /* A product with nothing on the shelf stays in the sitemap and stays
     indexable — its page still answers the question the searcher asked, still
     carries «Сообщить о наличии», and dropping it would throw away a ranking
     that has to be earned again when the stock comes back (the Gatsby Grunge
     Mat is exactly this case: 100 impressions in one week, out of stock).
     What it does not keep is the same claim on the crawler's time as a
     product somebody can buy today, and its Product block says OutOfStock, so
     Google leaves it out of the merchant surfaces by itself. */
  for (const p of CATALOGUE) {
    entries.push(urlEntry("/p/" + encodeURIComponent(p.id) + "/", lang.seg, p.stock === "out" ? "0.4" : "0.7"));
  }
  for (const slug of LEGAL_SLUGS) entries.push(urlEntry(infoRest(slug), lang.seg, "0.4"));
  if (BUNDLES.length) {
    entries.push(urlEntry("/sets/", lang.seg, "0.8"));
    for (const b of BUNDLES) entries.push(urlEntry("/set/" + encodeURIComponent(b.id) + "/", lang.seg, "0.7"));
  }
  /* /brands/ is in the sitemap now that it is a page rather than the shell.
     It is a hub, not a leaf: 0.5, below the category and brand pages it
     links to. */
  entries.push(urlEntry("/brands/", lang.seg, "0.5"));
  entries.push(urlEntry("/gift/", lang.seg, "0.6"));
  if (BLOG_POSTS.length) {
    entries.push(urlEntry("/blog/", lang.seg, "0.7"));
    for (const post of BLOG_POSTS) entries.push(urlEntry("/blog/" + encodeURIComponent(post.slug) + "/", lang.seg, "0.6"));
  }
}

/* Belt and braces: if one of these ever appears in the list, a page was
   generated for a screen that must not be indexed. */
const NEVER = /^\/shop2(?:\/(?:et|en))?\/(?:checkout|cart|account|admin|scan|done|search)\/$/;
for (const e of entries) {
  const loc = (e.match(/<loc>([^<]+)<\/loc>/) || [])[1] || "";
  const p = loc.replace(/^https?:\/\/[^/]+/, "");
  if (NEVER.test(p)) throw new Error("sitemap would contain a screen that must never be indexed: " + p);
}

const CHUNK = 1000;   // the protocol allows 50 000; small files are easier to read and to diff
const sitemapFiles = [];

for (let i = 0; i * CHUNK < entries.length; i++) {
  const name = `sitemap-${i + 1}.xml`;
  await writeFile(path.join(PUB, name),
    SITEMAP_OPEN + entries.slice(i * CHUNK, (i + 1) * CHUNK).join("\n") + "\n" + SITEMAP_CLOSE, "utf8");
  sitemapFiles.push(name);
}
// a leftover chunk from a larger catalogue would keep pointing at pages we no longer write
for (let i = sitemapFiles.length + 1; i <= 20; i++) {
  const f = path.join(PUB, `sitemap-${i}.xml`);
  if (existsSync(f)) await rm(f);
}

/* public/sitemap.xml is always a sitemapindex: the pages written above, in
   sitemap-N.xml, plus sitemap-custom.xml — which is not a file at all but a
   route (src/app/sitemap-custom.xml/route.ts) answering at request time with
   the owner's own products (custom_products, ids `c-…`). Those rows do not
   exist when this runs, and an index is the one shape that lets a static
   file point at a dynamic one. It used to be a plain urlset below 1 000
   URLs; robots.txt names only the index, so nothing else moved. */
await writeFile(path.join(PUB, "sitemap.xml"),
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  [...sitemapFiles, SITEMAP_CUSTOM].map(f => `  <sitemap><loc>${abs("/" + f)}</loc><lastmod>${today}</lastmod></sitemap>`).join("\n") +
  "\n</sitemapindex>\n", "utf8");

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

/* /shop2/scan/ is the admin's standalone barcode scanner (docs/inventory.md),
   admin-only and useless without a session — it belongs on this list next to
   /shop2/admin/ for exactly the same reason. */
const NO_INDEX_PATHS = [
  "/shop2/admin", "/shop2/scan", "/shop2/checkout", "/shop2/cart", "/shop2/account", "/shop2/done", "/shop2/search",
  "/shop2/*/admin", "/shop2/*/scan", "/shop2/*/checkout", "/shop2/*/cart", "/shop2/*/account", "/shop2/*/done", "/shop2/*/search",
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
  LEGAL_SLUGS.length + (BUNDLES.length ? BUNDLES.length + 1 : 0) + 1 + 1 +
  (BLOG_POSTS.length ? BLOG_POSTS.length + 1 : 0);

console.log(
  `prerender: ${pages.length} pages (${written} written, ${same} unchanged, ${removed} stale removed)\n` +
  `           ${LANGS.length} languages × ${perLang}: ${CATALOGUE.length} products + ${CATS.length + 1} categories + ` +
    `${BRANDS.length} brands + 1 brands landing + 1 home + ${LEGAL_SLUGS.length} info + ${BUNDLES.length ? BUNDLES.length + 1 : 0} sets + 1 gift + ` +
    `${BLOG_POSTS.length ? BLOG_POSTS.length + 1 : 0} blog\n` +
  `           base ${BASE}  robots "${ROBOTS}"  robots.txt = ${LIVE ? "production" : "staging"}  assets ?v=${ASSET_V}\n` +
  `           og cards: ${OG_CARDS.size} on disk (${cardsMade} drawn this run)  every og:image ${OG_W}×${OG_H}\n` +
  `           sitemap: ${entries.length} urls in ${sitemapFiles.length} file(s) + ${SITEMAP_CUSTOM} (the app's, custom products) behind the index`
);
