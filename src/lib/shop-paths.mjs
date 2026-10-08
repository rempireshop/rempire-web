/* The shop's public addresses — Shopify's, exactly (Dim, 08.10.2026).

   «There was no shop2 on the site — the URLs need to be as they were
   previously: rempireshop.com/ and everything else as previously.» Until
   that night every page lived under /shop2/ with Russian unprefixed; from
   then on the shop answers at the addresses the Shopify store published for
   years and Google still holds (tools/harvest/old-urls.txt, its sitemap):

     home         /                     /ru                  /et
     product      /products/<id>        /ru/products/<id>    /et/products/<id>
     section      /collections/hair-care  /ru/collections/uhod-za-volosami  /et/collections/juuksehooldus
     subcollection /collections/beard-oil /ru/collections/maslo-dlya-borody /et/collections/habemeolid
     brand        /collections/<brand>  (the same handle in every language)
     policy       /policies/shipping-policy · refund-policy · privacy-policy · terms-of-service
     contact      /pages/contact
     blog         /blogs/news · /blogs/news/<slug>
     sets         /collections/sets · /collections/sets/<id>
     gift card    /products/gift-card
     screens      /search · /account · /cart · /checkout · /checkout/done
     the owner's  /admin · /admin/scan   (no language prefix)

   English is unprefixed (it was on Shopify), Russian is /ru, Estonian /et; no
   page address ends in a slash. docs/seo.md § «URL move 2026-10 (Shopify
   scheme)» has every decision behind the table and its evidence.

   ---- one vocabulary, two spellings --------------------------------------
   Everything that builds or reads an address inside the shop still speaks the
   short internal ROUTE the /shop2/ scheme had — "/p/<id>/", "/c/hair/",
   "/c/beard/oi/" (a subcollection, since 09.10.2026), "/b/<brand>/", "/info/shipping/", "/sets/", "/set/<id>/", "/gift/",
   "/brands/", "/blog/", "/blog/<slug>/", "/search/", "/account/",
   "/checkout/", "/done/", "/cart/", "/admin/", "/scan/", "/" — and this file
   is the one place that turns a route into the public address
   (publicPath) and back (parseShopPath). The prerender, the request-time
   pages, the sitemaps, the feeds, the letters and the middleware all go
   through here; public/shop2/app.js carries the same two functions in ES5
   (shopPathFor / shopRouteOf), pinned to this file by tests/shop-paths.test.ts.

   Plain ESM with no imports, like src/lib/seo-head.mjs: the bare-`node`
   prerender, the Next routes and the edge middleware all import it. */

/** The three storefront languages, in the order every list on a page uses. */
export const SHOP_LANG_CODES = ["RU", "ET", "EN"];

/** The path prefix of each language. English is the default and has none. */
export const LANG_PREFIX = Object.freeze({ EN: "", RU: "/ru", ET: "/et" });

/** The cookie the language switcher writes (`ru` / `et` / `en`) — the saved
    choice the edge reads before Accept-Language (src/middleware.ts). */
export const LANG_COOKIE = "rempire_lang";

/* The seven sections and «Все товары», onto the collection Shopify used for
   each, per language. The sections are the six links of Shopify's header menu
   (Hair Care · Hair Styling · Beard Care · Face Care · Body Care · Merch —
   docs/shopify/LIVE-PAGES-AUDIT.md) plus Perfume; the per-language handles are
   Shopify's own translations, read off its sitemap, where the 47 collections
   are listed in the same order in every language. «Все товары» is the
   all-products family — more Search Console impressions than both
   alternatives (see docs/seo.md). */
export const CAT_HANDLES = Object.freeze({
  hair: Object.freeze({ EN: "hair-care", ET: "juuksehooldus", RU: "uhod-za-volosami" }),
  styling: Object.freeze({ EN: "hair-styling", ET: "viimistlus", RU: "stayling-dlya-volos" }),
  beard: Object.freeze({ EN: "beard-care", ET: "habemehooldus", RU: "uhod-za-borodoy" }),
  face: Object.freeze({ EN: "face-care", ET: "naohooldus", RU: "uhod-za-litsom" }),
  body: Object.freeze({ EN: "body-care", ET: "kehahooldus", RU: "uhod-za-telom" }),
  perfume: Object.freeze({ EN: "perfume", ET: "parfuumid", RU: "parfyumeriya" }),
  merch: Object.freeze({ EN: "merch", ET: "merch", RU: "merch" }),
  all: Object.freeze({ EN: "all-products", ET: "koik-tooted", RU: "vse-tovary" }),
});

/* The subcollections that have a page of their own (Dim, 09.10.2026 — SEO
   audit 08.10, §7.1 and T6): a section's subtype — the chip under the
   section's heading — at the handle Shopify had for it, per language, so the
   history Google keeps for those addresses carries over. Keyed by the
   internal route's "<section>/<subtype>" (route "/c/beard/oi/"); the subtype
   ids are the chips' own (SUBCATS in public/shop2/app.js, which also holds
   who belongs where and each page's words). A subtype listed here is
   PUBLISHED: it needs at least SUBCOLLECTION_MIN products and an intro in all
   three languages — tests/subcollections.test.ts holds both, and the
   prerender refuses to run without them. A subtype that is not listed stays a
   filter chip and its old Shopify handles go to the section
   (src/lib/legacy-redirects.ts). Every handle below is in Shopify's sitemap
   (tools/harvest/old-urls.txt); `korean-cosmetics` was the same in all three. */
export const SUB_HANDLES = Object.freeze({
  "beard/oi": Object.freeze({ EN: "beard-oil", ET: "habemeolid", RU: "maslo-dlya-borody" }),
  "beard/ba": Object.freeze({ EN: "beard-balm", ET: "habemepalsamid", RU: "balzam-dlya-borody" }),
  "beard/af": Object.freeze({ EN: "shaving", ET: "raseerimine", RU: "sredstva-dlya-britya" }),
  "hair/sh": Object.freeze({ EN: "shampoo", ET: "shampoonid", RU: "shampuni-dlya-volos" }),
  "hair/co": Object.freeze({ EN: "conditioner", ET: "palsamid", RU: "konditsionery-dlya-volos" }),
  "hair/sc": Object.freeze({ EN: "scalp-treatment", ET: "peanaha-hooldus", RU: "skraby-dlya-golovy" }),
  "styling/pw": Object.freeze({ EN: "hair-wax", ET: "juuksevaha", RU: "vosk-dlya-volos" }),
  "face/kr": Object.freeze({ EN: "korean-cosmetics", ET: "korean-cosmetics", RU: "korean-cosmetics" }),
});

/** The fewest products a subcollection may have and still be a page. */
export const SUBCOLLECTION_MIN = 6;

/* A brand whose Shopify collection was not spelled like the brand's own slug.
   Every other brand page is /collections/<slugify(brand)>, in all languages. */
export const BRAND_HANDLES = Object.freeze({ "cbd-daily": "cbd-daily-haircare" });

/* The five policy pages, at Shopify's own addresses: the four auto-generated
   /policies/ pages and the hand-made /pages/contact. */
export const INFO_PATHS = Object.freeze({
  shipping: "/policies/shipping-policy",
  returns: "/policies/refund-policy",
  privacy: "/policies/privacy-policy",
  terms: "/policies/terms-of-service",
  contact: "/pages/contact",
});

/** Collection handles that are pages of their own, never a brand. */
export const RESERVED_COLLECTIONS = Object.freeze(["brands", "sets"]);
export const GIFT_HANDLE = "gift-card";
export const BLOG_PATH = "/blogs/news";
export const ADMIN_PATH = "/admin";
export const SCAN_PATH = "/admin/scan";

/** The route the address of the owner's panel and scanner stands for — never prefixed. */
export const OWNER_RESTS = Object.freeze(["/admin/", "/scan/"]);

const CAT_OF_HANDLE = (() => {
  const out = Object.create(null);
  for (const cat of Object.keys(CAT_HANDLES)) for (const h of Object.values(CAT_HANDLES[cat])) out[h] = cat;
  return out;
})();
const SUB_OF_HANDLE = (() => {
  const out = Object.create(null);
  for (const key of Object.keys(SUB_HANDLES)) for (const h of Object.values(SUB_HANDLES[key])) out[h] = key;
  return out;
})();
const BRAND_OF_HANDLE = (() => {
  const out = Object.create(null);
  for (const [slug, h] of Object.entries(BRAND_HANDLES)) out[h] = slug;
  return out;
})();
const INFO_OF_PATH = (() => {
  const out = Object.create(null);
  for (const [slug, p] of Object.entries(INFO_PATHS)) out[p] = slug;
  return out;
})();

/** "RU" | "ET" | "EN" from a code, a prefix or a tag — English for anything else. */
export function langCode(lang) {
  const c = String(lang == null ? "" : lang).replace(/^\/+|\/+$/g, "").toUpperCase();
  return c === "RU" || c === "ET" ? c : "EN";
}

/** Is this the section key of a collection handle, in any language? */
export function catOfHandle(handle) {
  return CAT_OF_HANDLE[String(handle || "")] || null;
}

/** The published subcollection behind a collection handle, in any language — "beard/oi" — or null. */
export function subOfHandle(handle) {
  return SUB_OF_HANDLE[String(handle || "")] || null;
}

/** Is "/c/<cat>/<sub>/" a page — a published subcollection? */
export function isSubcollection(cat, sub) {
  return Object.prototype.hasOwnProperty.call(SUB_HANDLES, cat + "/" + sub);
}

/** The collection handle of a brand page — Shopify's own where it differed. */
export function brandHandle(slug) {
  return BRAND_HANDLES[slug] || slug;
}

/** The brand slug behind a collection handle (the inverse of brandHandle). */
export function brandOfHandle(handle) {
  return BRAND_OF_HANDLE[handle] || handle;
}

/**
 * The public address of a route in one language.
 *
 *   publicPath("RU", "/p/x/")       → "/ru/products/x"
 *   publicPath("EN", "/c/hair/")    → "/collections/hair-care"
 *   publicPath("ET", "/c/beard/oi/")→ "/et/collections/habemeolid"   (SUB_HANDLES)
 *   publicPath("ET", "/")           → "/et"
 *   publicPath("EN", "/")           → "/"
 *   publicPath("RU", "/admin/")     → "/admin"            (the owner's: no prefix)
 *   publicPath("ET", "/search/?q=x")→ "/et/search?q=x"     (a query rides along)
 *
 * A route this file does not know (an address the shop has no page for — the
 * 404's own canonical) keeps its segments under the language's prefix.
 */
export function publicPath(lang, rest) {
  const L = langCode(lang);
  const pre = LANG_PREFIX[L];
  const raw = String(rest == null || rest === "" ? "/" : rest);
  const qi = raw.indexOf("?");
  const pathPart = qi >= 0 ? raw.slice(0, qi) : raw;
  const query = qi >= 0 ? raw.slice(qi) : "";
  const segs = pathPart.split("/").filter(Boolean);
  const n = segs.length;
  const kind = segs[0];
  const id = segs[1];
  let p;
  if (!n) p = "";
  else if (kind === "p" && n === 2) p = "/products/" + id;
  else if (kind === "c" && n === 2) p = "/collections/" + ((CAT_HANDLES[id] && CAT_HANDLES[id][L]) || id);
  else if (kind === "c" && n === 3 && isSubcollection(id, segs[2])) p = "/collections/" + SUB_HANDLES[id + "/" + segs[2]][L];
  else if (kind === "b" && n === 2) p = "/collections/" + brandHandle(id);
  else if (kind === "brands" && n === 1) p = "/collections/brands";
  else if (kind === "sets" && n === 1) p = "/collections/sets";
  else if (kind === "set" && n === 2) p = "/collections/sets/" + id;
  else if (kind === "gift" && n === 1) p = "/products/" + GIFT_HANDLE;
  else if (kind === "info" && n === 2) p = INFO_PATHS[id] || "/pages/" + id;
  else if (kind === "blog" && n === 1) p = BLOG_PATH;
  else if (kind === "blog" && n === 2) p = BLOG_PATH + "/" + id;
  else if (kind === "done" && n === 1) p = "/checkout/done";
  else if (kind === "admin" && n === 1) return ADMIN_PATH + query;
  else if (kind === "scan" && n === 1) return SCAN_PATH + query;
  else if ((kind === "search" || kind === "account" || kind === "checkout" || kind === "cart") && n === 1) p = "/" + kind;
  else p = "/" + segs.join("/");
  return (pre + p || "/") + query;
}

/**
 * The route behind a public address, or null when the address is not one of
 * the shop's page shapes.
 *
 *   "/ru/collections/uhod-za-volosami" → { lang: "RU", prefixed: true,  rest: "/c/hair/" }
 *   "/collections/kevin-murphy"        → { lang: "EN", prefixed: false, rest: "/b/kevin-murphy/" }
 *   "/et/products/gift-card"           → { lang: "ET", prefixed: true,  rest: "/gift/" }
 *
 * A collection handle that is neither a section, a published subcollection
 * (`/et/collections/habemeolid` → "/c/beard/oi/"), `brands` nor `sets` comes
 * back as a brand route — whether that brand exists is the caller's question
 * (the catalogue, or the owner's own products). A section handle spelled in
 * another language's form is still the section: `canonical` (publicPath of
 * the result) is what tells the caller the address should move. Ids keep
 * their percent-escapes; nothing here decodes.
 */
export function parseShopPath(pathname) {
  const clean = String(pathname == null ? "/" : pathname).split(/[?#]/)[0];
  let segs = clean.split("/").filter(Boolean);
  let lang = "EN";
  let prefixed = false;
  const first = (segs[0] || "").toLowerCase();
  if (first === "ru" || first === "et") {
    lang = first.toUpperCase();
    prefixed = true;
    segs = segs.slice(1);
  }
  const n = segs.length;
  const k = segs[0];
  const a = segs[1];
  let rest = null;
  if (!n) rest = "/";
  else if (k === "products" && n === 2) rest = a === GIFT_HANDLE ? "/gift/" : "/p/" + a + "/";
  else if (k === "collections" && n === 2) {
    if (a === "brands") rest = "/brands/";
    else if (a === "sets") rest = "/sets/";
    else if (CAT_OF_HANDLE[a]) rest = "/c/" + CAT_OF_HANDLE[a] + "/";
    else if (SUB_OF_HANDLE[a]) rest = "/c/" + SUB_OF_HANDLE[a] + "/";
    else rest = "/b/" + brandOfHandle(a) + "/";
  } else if (k === "collections" && n === 3 && a === "sets") rest = "/set/" + segs[2] + "/";
  else if ((k === "policies" || k === "pages") && n === 2) {
    const slug = INFO_OF_PATH["/" + k + "/" + a];
    if (slug) rest = "/info/" + slug + "/";
  } else if (k === "blogs" && a === "news" && n === 2) rest = "/blog/";
  else if (k === "blogs" && a === "news" && n === 3) rest = "/blog/" + segs[2] + "/";
  else if (n === 1 && (k === "search" || k === "account" || k === "checkout" || k === "cart" || k === "admin")) rest = "/" + k + "/";
  else if (k === "checkout" && a === "done" && n === 2) rest = "/done/";
  else if (k === "admin" && a === "scan" && n === 2) rest = "/scan/";
  if (rest === null) return null;
  return { lang, prefixed, rest, canonical: publicPath(lang, rest) };
}

/** Is this route one of the owner's (the panel, the scanner) — no language, no index? */
export function isOwnerRest(rest) {
  return OWNER_RESTS.includes(String(rest || ""));
}

/** The screens that need state to mean anything — robots-disallowed, never in a sitemap. */
export const STATE_RESTS = Object.freeze(["/search/", "/account/", "/checkout/", "/done/", "/cart/", "/admin/", "/scan/"]);

/**
 * The language a browser asks for first, of the three the shop has — by `q`,
 * then by order — or "" when it names none of them (or sends no header at
 * all, which is what Googlebot does).
 */
export function langFromAcceptLanguage(header) {
  const tags = String(header || "")
    .split(",")
    .map((part, i) => {
      const bits = part.trim().split(";");
      const q = bits.slice(1).map((s) => s.trim()).find((s) => s.startsWith("q="));
      return { lang: bits[0].trim().toLowerCase().split("-")[0], q: q ? Number(q.slice(2)) || 0 : 1, i };
    })
    .filter((t) => t.lang && t.q > 0)
    .sort((x, y) => y.q - x.q || x.i - y.i);
  for (const t of tags) {
    if (t.lang === "ru") return "RU";
    if (t.lang === "et") return "ET";
    if (t.lang === "en") return "EN";
  }
  return "";
}

/* ---------- the /shop2/ addresses, 25.08 – 08.10.2026 ----------------------

   The shop went live on 08.10.2026 at 22:55 under /shop2/ and moved to the
   scheme above the same night. Those few hours and the weeks of staging before
   them left /shop2/ addresses in sent letters (order, unpaid, abandoned
   basket, back in stock), in Montonio's return trip of an order still being
   paid, in Renat's home-screen panel (/shop2/admin/) and in whatever anybody
   copied — so every one of them answers with ONE 301 to its new address, the
   query kept (it is ours: ?n=&s= on a receipt, ?resume= on a basket,
   ?order= on the panel, ?q= on a search, ?size= on a product).

   In that scheme the UNPREFIXED path was Russian, /shop2/et/… Estonian and
   /shop2/en/… English — so /shop2/p/x/ is /ru/products/x and /shop2/en/p/x/ is
   /products/x. The pre-launch prototype's /shop/… pages used the same
   convention and go straight to the same targets. */

/**
 * A link written into stored text (an article body, a newsletter) while the
 * shop lived under /shop2/ — relative, or absolute on one of the shop's own
 * hosts — as the address it has now; any other link exactly as it was. Every
 * renderer of stored HTML runs its hrefs through this, so an article written
 * in September links to the page and not to a redirect.
 */
const OWN_ORIGIN = /^https?:\/\/(?:www\.)?(?:rempireshop\.com|rempireshop\.diipsolutions\.eu)(?=[/?#]|$)/i;
export function modernShopHref(href) {
  const s = String(href == null ? "" : href);
  const m = OWN_ORIGIN.exec(s);
  const origin = m ? m[0] : "";
  const rel = m ? s.slice(origin.length) || "/" : s;
  if (!rel.startsWith("/") || rel.startsWith("//")) return s;
  const cut = rel.search(/[?#]/);
  const moved = legacyShopTarget(cut >= 0 ? rel.slice(0, cut) : rel);
  return moved === null ? s : origin + moved + (cut >= 0 ? rel.slice(cut) : "");
}

/**
 * Every link into one of the shop's own pages inside a piece of stored HTML
 * (a policy text, an article), spelled in `lang` — so a policy page read in
 * Estonian links to the Estonian refund policy, whichever language the text
 * was written with. External links, assets and the panel are left alone; an
 * old /shop2/ link is first moved to the page it became.
 */
export function respellShopLinks(html, lang) {
  return String(html == null ? "" : html).replace(/href="([^"]*)"/g, (whole, href) => {
    const moved = modernShopHref(href);
    if (!moved.startsWith("/") || moved.startsWith("//")) return moved === href ? whole : 'href="' + moved + '"';
    const cut = moved.search(/[?#]/);
    const route = parseShopPath(cut >= 0 ? moved.slice(0, cut) : moved);
    if (!route || isOwnerRest(route.rest)) return moved === href ? whole : 'href="' + moved + '"';
    return 'href="' + publicPath(lang, route.rest) + (cut >= 0 ? moved.slice(cut) : "") + '"';
  });
}

/**
 * The new address of a /shop2/… or /shop/… page, without its query; null for
 * anything else, and for an asset under those folders (a file name with an
 * extension), which never moves.
 */
export function legacyShopTarget(pathname) {
  const clean = String(pathname || "").split(/[?#]/)[0];
  const m = /^\/(shop2|shop)(?=\/|$)(.*)$/i.exec(clean);
  if (!m) return null;
  const tail = m[2];
  if (/\.[A-Za-z0-9]+$/.test(tail)) return null;
  let segs = tail.split("/").filter(Boolean);
  let lang = "RU";
  const first = (segs[0] || "").toLowerCase();
  if (first === "et" || first === "en" || first === "ru") {
    lang = first === "et" ? "ET" : first === "en" ? "EN" : "RU";
    segs = segs.slice(1);
  }
  return publicPath(lang, "/" + segs.join("/") + (segs.length ? "/" : ""));
}
