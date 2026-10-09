/**
 * Every address that has to MOVE, and where to — one 301, never a chain.
 *
 * Since 08.10.2026 the shop answers at Shopify's own addresses
 * (src/lib/shop-paths.mjs, Dim: «the URLs need to be as they were
 * previously»): `/products/<id>`, `/collections/<handle>`, `/pages/contact`,
 * `/policies/<slug>`, `/blogs/news/<slug>`, English unprefixed, `/ru/…` and
 * `/et/…`. So the bulk of what Google holds — 1 639 rows of Shopify's sitemap,
 * tools/harvest/old-urls.txt — is now simply the page, answered with a 200.
 * This file is what is left: the spellings that are NOT the page.
 *
 *  1. The shop's own previous scheme. `/shop2/…` (live 08.10.2026, 22:55 –
 *     the same night, and staging for weeks before) and the prototype's
 *     `/shop/…`: sent letters, Montonio's trip back from the bank, Renat's
 *     home-screen panel. Unprefixed was RUSSIAN there. The query is kept —
 *     it is ours (?n=&s= on a receipt, ?resume=, ?order=, ?q=, ?size=).
 *     (legacyShopTarget() in shop-paths.mjs.)
 *  2. Shopify's spellings that are not our canonical: the regional English
 *     storefronts (`/en-lv`, `/en-lt`, `/en-fi`) and `/en/…` → unprefixed; a
 *     section under another collection name (`/collections/shampoo`,
 *     `/et/collections/hair-care`) → the section in that language; a product
 *     handle the catalogue does not have → an alias, its brand, or «Все
 *     товары»; `/pages/right-to-return` and the other policy spellings →
 *     the five policy pages; `/blogs/blog` and the old articles → the blog;
 *     `/account/login`, `/checkouts/…`, `/<digits>/orders/…` → the account;
 *     `/discount/<code>?redirect=…`, `/gift_cards/…`, `/password`, the app
 *     proxies, `/collections/vendors?q=…`, `/products/delivery`, and
 *     Shopify's `/sitemap_*.xml`.
 *  3. A trailing slash on any page address (no page ends in one any more) —
 *     folded into the same single hop as 1 and 2.
 *
 * What is NOT here, on purpose: the query string of a Shopify product link
 * (`?variant=…&country=…&utm_…`) on an address that is already right. The
 * page is served as it is and its canonical names the clean address — no
 * redirect is needed for Google to fold them, and none is spent. With one
 * exception (4.). Nothing under `/api/` ever reaches this file (the
 * middleware's matcher leaves it out): Montonio POSTs to
 * `/api/payments/notify/`, and a redirect loses a POST.
 *
 *  4. A Shopify `?variant=<id>` that names a SIZE of the product the address
 *     lands on (src/data/shopify-variants.json — Merchant Center's Shopify
 *     product source links every size with it). The product page reads
 *     `?size=`, never `variant`: without this it opens on its first size, and
 *     Merchant Center's landing-page check reads a price the feed did not
 *     give. So the variant becomes `size` — in the same single hop when the
 *     address moves anyway, in a hop of its own (reason `variant`) when the
 *     address is already the page. A variant with no size here (a product
 *     sold in one size) still moves nothing.
 *
 * ---- the query a redirect carries -----------------------------------------
 * Ours where the address was ours or names the same page (`keep`), nothing
 * where it lands on another page (`drop`) — and, either way, a campaign's
 * own parameters (utm_*, gclid, srsltid …) survive, so the visit keeps its
 * source, and Shopify's storefront parameters (`variant`, `country`,
 * `currency`) do not: nothing here reads them (carry() below).
 *
 * ---- why code, not 1 639 rules ------------------------------------------
 * A config rule can only rewrite one shape into another; this is a lookup —
 * is the handle a product? which section is `palsamid`? — and the query has to
 * be decided per shape. `tests/legacy-redirects.test.ts` walks every row of
 * tools/harvest/old-urls.txt and docs/redirect-map.csv through it.
 */
import catalogueMin from "@/data/catalogue.min.json";
import { CAT_HANDLES, catOfHandle, legacyShopTarget, parseShopPath, publicPath } from "@/lib/shop-paths.mjs";
import { shopifyVariant } from "@/lib/shopify-variants";

/** Same rule as slugify() in src/lib/seo-head.mjs — brand slugs must match. */
export const slugify = (s: string): string =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export const PRODUCT_IDS: ReadonlySet<string> = new Set(
  (catalogueMin as Array<{ id: string }>).map((p) => p.id),
);
export const BRAND_SLUGS: ReadonlySet<string> = new Set(
  (catalogueMin as Array<{ b: string }>).map((p) => slugify(p.b)),
);

/** A language prefix Google may hold → the shop's language. Shopify published
    /ru, /et and three regional English storefronts; /en is the /shop2/en/ one. */
const LANG_PREFIXES: Readonly<Record<string, "RU" | "ET" | "EN">> = {
  ru: "RU",
  et: "ET",
  en: "EN",
  "en-lv": "EN",
  "en-lt": "EN",
  "en-fi": "EN",
};
export const LEGACY_LANG_PREFIXES = Object.keys(LANG_PREFIXES);

type Cat = keyof typeof CAT_HANDLES;

/* The Shopify collection handles that are NOT a section's own name, in four
   languages' worth of spelling, onto the shop's sections. A section's own
   handle in any language (hair-care, juuksehooldus, uhod-za-volosami …) and a
   brand slug (`system-4`, `kevin-murphy`) are recognised without being listed.

   Two judgement calls, written down because they are guesses about what a
   2019 Shopify merchandiser meant: bare `palsamid` is read as hair
   conditioners (Estonian «palsam» on its own is a hair conditioner;
   `habemepalsamid` is the beard one and is listed separately), and the
   shaving handles (`shaving`, `raseerimine`, `aftershave`, …) go to «Уход за
   бородой», which is where the shop keeps Proraso. */
const COLLECTION_CAT: Readonly<Record<string, Cat | "brands">> = {
  /* hair */
  shampoo: "hair", shampoonid: "hair", "shampuni-dlya-volos": "hair",
  conditioner: "hair", "konditsionery-dlya-volos": "hair", palsamid: "hair",
  "hair-mask": "hair", juuksemaskid: "hair", "maski-dlya-volos": "hair",
  "hair-lotion": "hair", "losony-dlya-volos": "hair", juuksekreemid: "hair",
  "scalp-treatment": "hair", "peanaha-hooldus": "hair", "skraby-dlya-golovy": "hair",
  /* styling */
  "hair-wax": "styling", juuksevaha: "styling", "vosk-dlya-volos": "styling",
  "hair-spray": "styling", juuksespreid: "styling", "laki-dlya-volos": "styling",
  /* beard and shaving */
  "beard-oil": "beard", habemeolid: "beard", "maslo-dlya-borody": "beard",
  "beard-balm": "beard", habemepalsamid: "beard", "balzam-dlya-borody": "beard",
  "beard-and-mustache-wax": "beard", "habeme-vuntsivahad": "beard",
  "vosk-dlya-borody-i-usov": "beard", "beard-styling": "beard",
  shaving: "beard", raseerimine: "beard", habeajamine: "beard",
  "sredstva-dlya-britya": "beard", "sredstva-dlya-britya-1": "beard",
  aftershave: "beard", "raseerimisjargne-hooldus": "beard", "losony-posle-britya": "beard",
  /* face */
  "skin-care": "face", nahahooldus: "face", "uhod-za-kozhey": "face",
  cosmetics: "face", "korean-cosmetics": "face",
  "face-sheet-masks": "face", naomaskid: "face", "maski-dlya-litsa": "face",
  "eye-care": "face", silmahooldus: "face", "uhod-za-kozhey-glaz": "face",
  moisturizer: "face", "uvlazhnyayushchie-kremy": "face", "lotions-and-toners": "face",
  /* body */
  soap: "body", "seebid-dusigeelid": "body", "mylo-geli-dlya-dusha": "body",
  "soap-and-body-wash": "body", "kehakreemid-toonikud": "body", kehaniisutajad: "body",
  "losony-toniki-dlya-tela": "body",
  /* merch */
  "rempire-merch": "merch", "rempire-merch-1": "merch",
  /* the whole catalogue, under every other name Shopify's themes used for it */
  all: "all", "all-products-est": "all", "all-prioducts-rus": "all", "shop-all": "all", "shop-all-1": "all",
  "popular-products": "all", "latest-arrivals": "all", "new-products": "all",
  "black-friday": "all", "black-friday-1": "all", "winter-deals": "all",
  /* the brands hub */
  "top-brands": "brands", "top-brandid": "brands", "top-brendy": "brands",
};

/** `/pages/<slug>` and `/policies/<slug>` spellings that are not the page's own address. */
const INFO_SLUG: Readonly<Record<string, string>> = {
  "refund-policy": "returns",
  "privacy-policy": "privacy",
  "terms-of-service": "terms",
  "shipping-policy": "shipping",
  "legal-notice": "terms",
  "contact-information": "contact",
  "subscription-policy": "terms",
  contact: "contact",
  "right-to-return": "returns",
  "data-sharing-opt-out": "privacy",
  "contact-us": "contact",
  delivery: "shipping",
  shipping: "shipping",
  returns: "returns",
  terms: "terms",
  privacy: "privacy",
};

/* A product handle whose product is gone but whose line is not. Both from the
   Search Console export: Kevin.Murphy's BLOW.DRY EVER.THICKEN and EVER.BOUNCE
   were dropped, EVER.SMOOTH is the one the shop still sells, and «kevin murphy
   blow dry ever thicken» still earns a click at position 3.8. */
const PRODUCT_ALIAS: Readonly<Record<string, string>> = {
  "blow-dry-ever-thicken": "blow-dry-ever-smooth",
  "blow-dry-ever-bounce": "blow-dry-ever-smooth",
};

/* Shopify's own blog articles. None survived the move; their address keeps
   answering — with the blog — instead of the article route's 404. */
const SHOPIFY_ARTICLES: ReadonlySet<string> = new Set([
  "the-ultimate-guide-on-how-to-moisturize-your-skin-for-a-healthy-glow",
]);

export interface LegacyRedirect {
  /** Where to send it — a same-origin path, its query already decided. */
  path: string;
  /** Why, for the X-Rempire-Redirect header and the tests. */
  reason:
    | "shop2"
    | "slash"
    | "lang"
    | "product-alias"
    | "product-brand"
    | "product-unknown"
    | "product-info"
    | "collection-cat"
    | "collection-brand"
    | "collection-canonical"
    | "collection-unknown"
    | "info"
    | "info-unknown"
    | "blog"
    | "screen"
    | "home"
    | "feed"
    | "sitemap"
    | "variant";
}

/** A percent-escape Google kept from Shopify («barberism%C2%AE») must not throw. */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The handle as the catalogue would spell it: decoded, lower-case, punctuation folded. */
function normHandle(raw: string): string {
  const decoded = safeDecode(raw).toLowerCase();
  return PRODUCT_IDS.has(decoded) ? decoded : slugify(decoded);
}

/** The longest brand slug the handle starts with — `lumin-skin-recovery-oil` → `lumin-skin`. */
function brandOf(handle: string): string | null {
  let best: string | null = null;
  for (const slug of BRAND_SLUGS) {
    if (handle === slug || handle.startsWith(slug + "-")) {
      if (!best || slug.length > best.length) best = slug;
    }
  }
  return best;
}

type Lang = "RU" | "ET" | "EN";
type Shape = { path: string; reason: LegacyRedirect["reason"]; query: "keep" | "drop" | string };

/** A product handle → its page, an alias, its brand, or «Все товары». */
function productShape(lang: Lang, raw: string): Shape {
  if (PRODUCT_IDS.has(raw) || raw.startsWith("c-") || raw === "gift-card") {
    return { path: publicPath(lang, "/p/" + raw + "/"), reason: "slash", query: "keep" };
  }
  const handle = normHandle(raw);
  /* Shopify's spelling of the same product («barberism%C2%AE»): the same
     page, so its query — the feed's variant and utm_* — comes along. */
  if (PRODUCT_IDS.has(handle)) return { path: publicPath(lang, "/p/" + handle + "/"), reason: "slash", query: "keep" };
  /* Shopify's «delivery» product was a page about delivery. */
  if (handle === "delivery") return { path: publicPath(lang, "/info/shipping/"), reason: "product-info", query: "drop" };
  const alias = PRODUCT_ALIAS[handle];
  if (alias && PRODUCT_IDS.has(alias)) return { path: publicPath(lang, "/p/" + alias + "/"), reason: "product-alias", query: "drop" };
  const brand = brandOf(handle);
  if (brand) return { path: publicPath(lang, "/b/" + brand + "/"), reason: "product-brand", query: "drop" };
  return { path: publicPath(lang, "/c/all/"), reason: "product-unknown", query: "drop" };
}

/** A collection handle that is not a section's own name or `brands`/`sets`. */
function collectionShape(lang: Lang, rawHandle: string, search: string): Shape | null {
  const handle = slugify(safeDecode(rawHandle));
  if (BRAND_SLUGS.has(handle)) return { path: publicPath(lang, "/b/" + handle + "/"), reason: "collection-brand", query: "drop" };
  const cat = COLLECTION_CAT[handle] || catOfHandle(handle);
  if (cat === "brands") return { path: publicPath(lang, "/brands/"), reason: "collection-cat", query: "drop" };
  if (cat) return { path: publicPath(lang, "/c/" + cat + "/"), reason: "collection-cat", query: "drop" };
  if (handle === "vendors") {
    /* Shopify's vendor listing: /collections/vendors?q=Kevin.Murphy */
    const q = new URLSearchParams(search.replace(/^\?/, "")).get("q");
    const slug = q ? slugify(q) : "";
    if (slug && BRAND_SLUGS.has(slug)) return { path: publicPath(lang, "/b/" + slug + "/"), reason: "collection-brand", query: "drop" };
    return { path: publicPath(lang, "/brands/"), reason: "collection-cat", query: "drop" };
  }
  return null;
}

/** A same-site path from `?redirect=` (Shopify's /discount/<code> links), or null. */
function sameSitePath(v: string | null): string | null {
  if (!v || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\")) return null;
  return v;
}

/* ---------- the query a redirect carries ---------------------------------- */

/** Shopify's storefront parameters — nothing here reads them, so no redirect carries them. */
const SHOPIFY_PARAMS: ReadonlySet<string> = new Set(["variant", "country", "currency"]);

/** A campaign's or a click's own parameters — they survive every redirect, so the visit keeps its source. */
const TRACKING = /^(?:utm_[a-z0-9_]+|gclid|gbraid|wbraid|gad_source|gad_campaignid|srsltid|fbclid|msclkid|_gl)$/;

/** The `name=value` pieces of a query, exactly as they came (nothing re-encoded). */
function queryPieces(query: string): string[] {
  return query.replace(/^\?/, "").split("&").filter(Boolean);
}

/** A piece's name, decoded and lower-cased. */
function pieceName(piece: string): string {
  const eq = piece.indexOf("=");
  return safeDecode((eq >= 0 ? piece.slice(0, eq) : piece).replace(/\+/g, " ")).toLowerCase();
}

/** The first value of `name` in a query, decoded, or null. */
function queryValue(query: string, name: string): string | null {
  const piece = queryPieces(query).find((p) => pieceName(p) === name);
  if (piece === undefined) return null;
  const eq = piece.indexOf("=");
  return eq >= 0 ? safeDecode(piece.slice(eq + 1).replace(/\+/g, " ")) : "";
}

/**
 * The `?size=` a Shopify `?variant=` stands for on the page `path` — only when
 * the variant is a size of THAT product; a variant of another product, or of
 * one the shop sells in one size, stands for none.
 */
function variantSize(path: string, query: string): string | null {
  const vid = queryValue(query, "variant");
  if (!vid) return null;
  const route = parseShopPath(path.split("?")[0]);
  const product = route && /^\/p\/([^/]+)\/$/.exec(route.rest);
  if (!product) return null;
  const v = shopifyVariant(vid);
  return v && v.s && v.p === safeDecode(product[1]) ? v.s : null;
}

/**
 * The query a redirect carries, from the request's own:
 *   keep — all of it (it is ours: ?size=, ?n=&s=, ?resume=, ?order=, ?q=);
 *   drop — none of it;
 *   a string — exactly that (a Shopify search keeps the shopper's words);
 * and in every case a campaign's own parameters (TRACKING), never Shopify's
 * storefront ones (SHOPIFY_PARAMS) — and `size=<size>` where the `variant`
 * was, when the variant names a size of the target product (variantSize)
 * and the query does not already carry one of its own.
 */
function carry(query: string, policy: Shape["query"], size: string | null): string {
  const out = policy === "keep" || policy === "drop" ? [] : queryPieces(policy);
  const pieces = queryPieces(query);
  let sizeDue = size !== null && !(policy === "keep" && pieces.some((p) => pieceName(p) === "size"));
  for (const piece of pieces) {
    const name = pieceName(piece);
    if (name === "variant" && sizeDue) {
      out.push("size=" + encodeURIComponent(size!));
      sizeDue = false;
    } else if (SHOPIFY_PARAMS.has(name)) continue;
    else if (policy === "keep" || TRACKING.test(name)) out.push(piece);
  }
  return out.length ? "?" + out.join("&") : "";
}

/**
 * Where an address has to go, or null when it is fine where it is (a page,
 * an asset, an API route, or an address the shop has no page for — which the
 * catch-all route answers with a 404, never a redirect).
 *
 * `pathname` is the request path as it arrived (percent-escapes and all, no
 * query); `search` its query string including the `?`.
 */
export function legacyTarget(pathname: string, search = ""): LegacyRedirect | null {
  const raw = String(pathname || "/").split("?")[0] || "/";
  const query = search && search !== "?" ? (search.startsWith("?") ? search : "?" + search) : "";
  const out = (path: string, reason: LegacyRedirect["reason"], q: Shape["query"]): LegacyRedirect | null => {
    const size = variantSize(path, query);
    if (path === raw && q === "keep") {
      /* The address is the page: served with its query as it came — unless
         that query is a Shopify variant naming a size of this product (4.),
         and the page's own `?size=` is not already there. */
      if (!size || queryValue(query, "size") !== null) return null;
      return { path: path + carry(query, "keep", size), reason: "variant" };
    }
    const tail = carry(query, q, size);
    /* `path` may carry a query of its own (a discount's ?redirect= target). */
    const target = tail && path.includes("?") ? path + "&" + tail.slice(1) : path + tail;
    return target === raw + query ? null : { path: target, reason };
  };

  /* Never the API (both spellings of an endpoint answer, with no redirect —
     a redirect loses a POST) and never Next's own files. The middleware's
     matcher already keeps them away; this is the same rule said twice. */
  if (/^\/(?:api|_next)(?:\/|$)/.test(raw)) return null;

  /* 1. the shop's own previous scheme */
  const shop = legacyShopTarget(raw);
  if (shop !== null) return out(shop, "shop2", "keep");

  /* Shopify's sitemaps, its agents file and its Atom feeds of a collection or
     the blog — the only shapes with a dot. A feed lands on the page it was a
     feed of (resolved the same way, so still one hop): Search Console had 60
     of them crawled-not-indexed on 09.10.2026. */
  if (/^\/sitemap_[^/]*\.xml$/i.test(raw)) return out("/sitemap.xml", "sitemap", "drop");
  if (/^\/agents\.md$/i.test(raw)) return out("/", "home", "drop");
  if (/^(?:\/[a-z-]{2,5})?\/(?:collections|blogs)\/.+\.atom$/i.test(raw)) {
    const page = raw.slice(0, -".atom".length);
    const hit = legacyTarget(page, "");
    let to = hit ? hit.path.split("?")[0] : page;
    /* A collection nobody mapped would be answered by the catch-all route —
       a brand of the owner's own products, else «Все товары». A feed is never
       a custom brand's, so it goes to «Все товары» directly: one hop. */
    const route = parseShopPath(to);
    const brand = route && /^\/b\/([^/]+)\/$/.exec(route.rest);
    if (brand && !BRAND_SLUGS.has(brand[1])) to = publicPath(route!.lang, "/c/all/");
    return out(to, "feed", "drop");
  }

  const segments = raw.split("/").filter(Boolean);

  /* The language prefix, case-folded: Google has indexed /ET/ before. */
  let lang: Lang = "EN";
  let prefixed = false;
  let foreignPrefix = false;   // /en, /en-lv … — never our own spelling
  const first = (segments[0] || "").toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LANG_PREFIXES, first)) {
    lang = LANG_PREFIXES[first];
    prefixed = true;
    foreignPrefix = first !== "ru" && first !== "et";
    segments.shift();
  }
  /* A query is kept on every spelling of a page — Shopify's regional
     storefronts' too, whose links carry the feed's utm_* and `variant`
     (carry() turns it into a size) — but a regional storefront's search
     keeps only the shopper's words. */
  const regional = first.startsWith("en-");
  const normal: LegacyRedirect["reason"] = foreignPrefix ? "lang" : "slash";
  const n = segments.length;
  const kind = (segments[0] || "").toLowerCase();
  const rest = segments.slice(1);
  const qOnly = (): Shape["query"] => {
    const q = new URLSearchParams(search.replace(/^\?/, "")).get("q");
    return q ? "?q=" + encodeURIComponent(q) : "drop";
  };

  /* The native shapes first: an address that parses is either the page or
     one normalisation away from it (the prefix, the slash). Products and
     collections are looked up below — their handle may be Shopify's and not
     ours. */
  const parsed = parseShopPath(LANG_PREFIXES_PATH[lang] + "/" + segments.join("/"));
  if (parsed && kind !== "collections" && kind !== "products") {
    if (parsed.rest === "/blog/" + rest[1] + "/" && SHOPIFY_ARTICLES.has(rest[1])) {
      return out(publicPath(lang, "/blog/"), "blog", "drop");
    }
    const q = parsed.rest === "/search/" && regional ? qOnly() : "keep";
    return out(parsed.canonical, normal, q);
  }

  if (!n) return prefixed ? out(publicPath(lang, "/"), normal, "keep") : null;

  if (kind === "products") {
    if (n === 1) return out(publicPath(lang, "/c/all/"), "collection-cat", "drop");
    const s = productShape(lang, rest[0]);
    return out(s.path, s.reason === "slash" ? normal : s.reason, s.query);
  }

  if (kind === "collections") {
    if (n === 1) return out(publicPath(lang, "/c/all/"), "collection-cat", "drop");
    /* `/collections/<x>/products/<handle>` — Shopify's other product URL. */
    if (n >= 4 && rest[1].toLowerCase() === "products") {
      const s = productShape(lang, rest[2]);
      return out(s.path, s.reason === "slash" ? "collection-canonical" : s.reason, s.query);
    }
    if (n === 3 && rest[0] === "sets") return out(publicPath(lang, "/set/" + rest[1] + "/"), normal, "keep");
    const handle = rest[0];
    /* The page itself: a section in any language's spelling (the canonical
       moves it to this language's), a catalogue brand, `brands`, `sets`. */
    if (parsed && n === 2) {
      const brand = /^\/b\/([^/]+)\/$/.exec(parsed.rest);
      if (!brand || BRAND_SLUGS.has(brand[1])) {
        const own = parsed.canonical.split("/").pop() === handle;
        return out(parsed.canonical, own ? normal : "collection-canonical", own ? "keep" : "drop");
      }
    }
    /* `/collections/<handle>/<tag>` — a Shopify tag filter on a collection: the collection. */
    const s = collectionShape(lang, handle, search);
    if (s) return out(s.path, s.reason, s.query);
    /* An unknown handle: possibly a brand only the owner's own products carry
       (custom_products) — the catch-all route asks the database and answers
       the page, or «Все товары». Only the prefix and the slash are
       normalised here; the handle is left exactly as it came. */
    if (n === 2) return out(publicPath(lang, "/b/" + handle + "/"), normal, "keep");
    /* Deeper than a handle (`/collections/<x>/<tag>`, `/collections/collections/all`)
       and still nothing known: never an owner's brand page, which has no
       deeper addresses — «Все товары» directly, one hop. */
    return out(publicPath(lang, "/c/all/"), "collection-unknown", "drop");
  }

  if (kind === "pages" || kind === "policies") {
    const slug = INFO_SLUG[slugify(safeDecode(rest[0] || ""))];
    if (slug) return out(publicPath(lang, "/info/" + slug + "/"), "info", "drop");
    return out(publicPath(lang, "/info/contact/"), "info-unknown", "drop");
  }

  /* Every article the old blog had is gone; the listing is the honest target. */
  if (kind === "blogs") return out(publicPath(lang, "/blog/"), "blog", "drop");

  if (kind === "account") return out(publicPath(lang, "/account/"), "screen", "drop");
  if (kind === "checkouts" || kind === "checkout") return out(publicPath(lang, "/account/"), "screen", "drop");
  /* `/12345678/orders/<token>`, `/12345678/checkouts/<token>/recover` — the
     order-status and abandoned-checkout links of Shopify's own letters. */
  if (/^\d+$/.test(kind) && n >= 2) return out(publicPath(lang, "/account/"), "screen", "drop");
  if (kind === "cart") return out(publicPath(lang, "/cart/"), "screen", "drop");
  if (kind === "search") return out(publicPath(lang, "/search/"), "screen", qOnly());
  if (kind === "discount") {
    const to = sameSitePath(new URLSearchParams(search.replace(/^\?/, "")).get("redirect"));
    if (to) {
      const [toPath, toQuery = ""] = to.split("?");
      const next = legacyTarget(toPath, toQuery ? "?" + toQuery : "");
      return out(next ? next.path : to, "home", "drop");
    }
    return out(publicPath(lang, "/"), "home", "drop");
  }
  if (kind === "gift_cards" || kind === "gift-cards") return out(publicPath(lang, "/gift/"), "screen", "drop");
  if (kind === "password") return out(publicPath(lang, "/"), "home", "drop");
  /* Shopify's app proxies — a link from an installed app, never a real page. */
  if (kind === "apps" || kind === "a" || kind === "tools") return out(publicPath(lang, "/"), "home", "drop");

  /* Nothing the shop knows. A trailing slash is still never an address here,
     and a foreign or upper-case prefix is still folded — the catch-all route
     then answers the one remaining address with its 404. */
  const bare = LANG_PREFIXES_PATH[lang] + "/" + segments.join("/");
  return out(bare === "/" ? "/" : bare.replace(/\/+$/, ""), normal, "keep");
}

const LANG_PREFIXES_PATH: Readonly<Record<Lang, string>> = { EN: "", RU: "/ru", ET: "/et" };

/** The language a request path stands for — "EN" unprefixed. */
export function pathLang(pathname: string): Lang {
  const first = String(pathname || "").split("/").filter(Boolean)[0] || "";
  return (LANG_PREFIXES[first.toLowerCase()] || "EN") as Lang;
}
