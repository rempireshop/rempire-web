/**
 * The old Shopify addresses → the new shop's paths.
 *
 * Every URL Google has of rempireshop.com today is a Shopify one:
 * `/products/<handle>`, `/collections/<handle>`, `/pages/<slug>`,
 * `/policies/<slug>`, `/blogs/<blog>/<slug>`, each of them also under the five
 * storefront prefixes Shopify published (`/ru`, `/et`, `/en-lv`, `/en-lt`,
 * `/en-fi`). The Search Console export of 07.09.2026 has 473 such URLs with
 * impressions in one week (docs/audit/2026-09-07-seo.md). The new shop serves
 * `/shop2/p/<id>/`, `/shop2/c/<cat>/`, `/shop2/et/…`. Without this file every
 * one of those 473 addresses 404s the day the DNS moves.
 *
 * ---- why a table and a function, not 1 638 rules -------------------------
 * `docs/redirect-map.csv` has 1 638 rows. Turning them into 1 638 entries of
 * `next.config.ts`'s `redirects()` would put 1 638 path-to-regexp matchers in
 * the routes manifest, evaluated in order on *every* request to the site —
 * next to the ~250 rewrites `prerenderedRewrites()` already generates, and
 * inside Vercel's per-deployment route budget. It also could not do the one
 * thing the job actually needs: a *lookup*. So the shapes are matched here in
 * code and the ids are looked up in the catalogue the shop already ships.
 *
 * The map itself is a poor source of truth and is not read at run time: 1 447
 * of its 1 638 rows point at `/shop/` (the home page) — including every single
 * `/ru/products/…` and `/et/products/…` row, which is exactly the traffic
 * worth keeping. `tests/legacy-redirects.test.ts` walks the CSV and asserts
 * this function does at least as well as the map on every row, and strictly
 * better on the 1 447.
 *
 * ---- the rules -----------------------------------------------------------
 * 1. The language a searcher picked is preserved. `/ru/…` → the unprefixed
 *    path (Russian is the default and the x-default — going to `/shop2/ru/…`
 *    would only be 301ed again by next.config.ts), `/et/…` → `/shop2/et/…`,
 *    and the three regional English storefronts (`/en-lv`, `/en-lt`,
 *    `/en-fi`) collapse onto the one `/shop2/en/…` the shop has.
 * 2. Query strings are dropped. Shopify's product feed published every
 *    product as `?variant=…&country=AE&currency=EUR&utm_source=google&
 *    utm_medium=product_sync&utm_content=sag_organic&utm_campaign=sag_organic`
 *    — 121 of the 473 ranking URLs, and 61 paths indexed under more than one
 *    address because of it. `variant` names a Shopify variant id that means
 *    nothing here; `country`/`currency` would be read as a shop setting;
 *    the `utm_` set describes a Shopify feed that stops existing at the
 *    switch, so carrying it over would credit new traffic to a dead channel.
 *    `/search`'s `q` is the one parameter that survives, because it is the
 *    shopper's own words.
 * 3. Nothing 404s. An unknown product handle goes to its brand's page when
 *    the handle names a brand we carry, else to «Все товары»; an unknown
 *    collection to «Все товары»; an unknown page or policy to «Контакты».
 *    A 301 onto a page that is not the same thing is how you tell Google a
 *    product is gone — it drops the old address after a while, which is the
 *    right outcome — and a shopper on a stale link lands somewhere they can
 *    still buy from instead of on «Страница не найдена».
 * 4. All of it is 301. These addresses are not coming back.
 */
import catalogueMin from "@/data/catalogue.min.json";

/** Same rule as slugify() in src/lib/seo-head.mjs — brand slugs must match. */
export const slugify = (s: string): string =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const PRODUCT_IDS: ReadonlySet<string> = new Set(
  (catalogueMin as Array<{ id: string }>).map((p) => p.id),
);
const BRAND_SLUGS: ReadonlySet<string> = new Set(
  (catalogueMin as Array<{ b: string }>).map((p) => slugify(p.b)),
);

/** Shopify's storefront prefix → the shop's path segment. "" is Russian. */
const LANG_SEG: Readonly<Record<string, string>> = {
  ru: "",
  et: "et",
  en: "en",
  "en-lv": "en",
  "en-lt": "en",
  "en-fi": "en",
};
export const LEGACY_LANG_PREFIXES = Object.keys(LANG_SEG);

/** The shop's own sections, so a collection can be mapped onto one. */
const CATS = ["hair", "styling", "beard", "face", "body", "perfume", "merch"] as const;
type Cat = (typeof CATS)[number];

/* The 105 Shopify collection handles that exist in the map or in the Search
   Console export, in four languages' worth of spelling, onto the shop's seven
   sections. A handle that is a brand slug (`system-4`, `kevin-murphy`,
   `davines`, `captain-fawcett`, `lumin-skin`) is answered by the brand page
   without being listed here — that is checked before this table.

   Two judgement calls, written down because they are guesses about what a
   2019 Shopify merchandiser meant: bare `palsamid` is read as hair
   conditioners (Estonian «palsam» on its own is a hair conditioner;
   `habemepalsamid` is the beard one and is listed separately), and the
   shaving handles (`shaving`, `raseerimine`, `aftershave`, …) go to «Уход за
   бородой», which is where the shop keeps Proraso. */
const COLLECTION_CAT: Readonly<Record<string, Cat | "all" | "brands">> = {
  /* hair */
  "hair-care": "hair", juuksehooldus: "hair", "uhod-za-volosami": "hair",
  shampoo: "hair", shampoonid: "hair", "shampuni-dlya-volos": "hair",
  conditioner: "hair", "konditsionery-dlya-volos": "hair", palsamid: "hair",
  "hair-mask": "hair", juuksemaskid: "hair", "maski-dlya-volos": "hair",
  "hair-lotion": "hair", "losony-dlya-volos": "hair", juuksekreemid: "hair",
  "scalp-treatment": "hair", "peanaha-hooldus": "hair", "skraby-dlya-golovy": "hair",
  /* styling */
  "hair-styling": "styling", "stayling-dlya-volos": "styling", viimistlus: "styling",
  "hair-wax": "styling", juuksevaha: "styling", "vosk-dlya-volos": "styling",
  "hair-spray": "styling", juuksespreid: "styling", "laki-dlya-volos": "styling",
  /* beard and shaving */
  "beard-care": "beard", habemehooldus: "beard", "uhod-za-borodoy": "beard",
  "beard-oil": "beard", habemeolid: "beard", "maslo-dlya-borody": "beard",
  "beard-balm": "beard", habemepalsamid: "beard", "balzam-dlya-borody": "beard",
  "beard-and-mustache-wax": "beard", "habeme-vuntsivahad": "beard",
  "vosk-dlya-borody-i-usov": "beard", "beard-styling": "beard",
  shaving: "beard", raseerimine: "beard", habeajamine: "beard",
  "sredstva-dlya-britya": "beard", "sredstva-dlya-britya-1": "beard",
  aftershave: "beard", "raseerimisjargne-hooldus": "beard", "losony-posle-britya": "beard",
  /* face */
  "face-care": "face", naohooldus: "face", "uhod-za-litsom": "face",
  "skin-care": "face", nahahooldus: "face", "uhod-za-kozhey": "face",
  cosmetics: "face", "korean-cosmetics": "face",
  "face-sheet-masks": "face", naomaskid: "face", "maski-dlya-litsa": "face",
  "eye-care": "face", silmahooldus: "face", "uhod-za-kozhey-glaz": "face",
  moisturizer: "face", "uvlazhnyayushchie-kremy": "face", "lotions-and-toners": "face",
  /* body */
  "body-care": "body", kehahooldus: "body", "uhod-za-telom": "body",
  soap: "body", "seebid-dusigeelid": "body", "mylo-geli-dlya-dusha": "body",
  "soap-and-body-wash": "body", "kehakreemid-toonikud": "body", kehaniisutajad: "body",
  "losony-toniki-dlya-tela": "body",
  /* fragrance and merch */
  perfume: "perfume", parfuumid: "perfume", parfyumeriya: "perfume",
  merch: "merch", "rempire-merch": "merch", "rempire-merch-1": "merch",
  /* the whole catalogue, under every name Shopify's themes used for it */
  all: "all", "all-products": "all", "all-products-est": "all", "koik-tooted": "all",
  "vse-tovary": "all", "all-prioducts-rus": "all", "shop-all": "all", "shop-all-1": "all",
  "popular-products": "all", "latest-arrivals": "all", "new-products": "all",
  "black-friday": "all", "black-friday-1": "all", "winter-deals": "all",
  /* the brands hub */
  brands: "brands", "top-brands": "brands", "top-brandid": "brands", "top-brendy": "brands",
};

/* A collection whose handle is a brand we carry but does not slugify to the
   brand's own slug. `cbd-daily-haircare` is the only one today. */
const COLLECTION_BRAND: Readonly<Record<string, string>> = {
  "cbd-daily-haircare": "cbd-daily",
};

/** `/pages/<slug>` and `/policies/<slug>` → the shop's five policy pages. */
const INFO_SLUG: Readonly<Record<string, string>> = {
  /* Shopify's own auto-generated /policies/ pages */
  "refund-policy": "returns",
  "privacy-policy": "privacy",
  "terms-of-service": "terms",
  "shipping-policy": "shipping",
  "legal-notice": "terms",
  "contact-information": "contact",
  "subscription-policy": "terms",
  /* the hand-made /pages/ ones the map names */
  contact: "contact",
  "right-to-return": "returns",
  "data-sharing-opt-out": "privacy",
  /* the handles a Shopify theme commonly ships, in case one was ever indexed */
  "contact-us": "contact",
  delivery: "shipping",
  shipping: "shipping",
  returns: "returns",
  terms: "terms",
  privacy: "privacy",
};

/* A product handle whose product is gone but whose line is not. Two entries,
   both from the Search Console export: Kevin.Murphy's BLOW.DRY EVER.THICKEN
   and EVER.BOUNCE were dropped, EVER.SMOOTH is the one the shop still sells,
   and «kevin murphy blow dry ever thicken» is a query that still earns a
   click at position 3.8. Anything else unknown falls through to the brand
   rule below. */
const PRODUCT_ALIAS: Readonly<Record<string, string>> = {
  "blow-dry-ever-thicken": "blow-dry-ever-smooth",
  "blow-dry-ever-bounce": "blow-dry-ever-smooth",
};

export interface LegacyRedirect {
  /** Where to send it — always absolute-from-root and trailing-slashed. */
  path: string;
  /** Why, for the tests and for docs/audit/2026-09-07-seo.md. */
  reason:
    | "product"
    | "product-alias"
    | "product-brand"
    | "product-unknown"
    | "collection-brand"
    | "collection-cat"
    | "collection-unknown"
    | "info"
    | "info-unknown"
    | "blog"
    | "screen"
    | "home";
}

const shopPath = (seg: string, rest: string): string => "/shop2" + (seg ? "/" + seg : "") + rest;

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

/**
 * The new path for one old Shopify URL, or null when the path is not one of
 * the shapes Shopify served (in which case nothing here should touch it).
 *
 * `pathname` is the request path with no query and no origin; `search` is the
 * query string including the `?`, and is used only by `/search`.
 */
export function legacyTarget(pathname: string, search = ""): LegacyRedirect | null {
  const raw = String(pathname || "").split("?")[0];
  const segments = raw.split("/").filter(Boolean);
  if (!segments.length) return null;

  /* The language prefix, if any. Case-folded: Google has indexed /ET/ before. */
  let seg = "";
  let langed = false;
  const first = segments[0].toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LANG_SEG, first)) {
    seg = LANG_SEG[first];
    langed = true;
    segments.shift();
  }

  /* A bare prefix — `/ru`, `/et`, `/en-fi` — is that language's home page. */
  if (!segments.length) return langed ? { path: shopPath(seg, "/"), reason: "home" } : null;

  const kind = segments[0].toLowerCase();
  const rest = segments.slice(1);

  if (kind === "products") {
    if (!rest.length) return { path: shopPath(seg, "/c/all/"), reason: "collection-cat" };
    const handle = normHandle(rest[0]);
    if (PRODUCT_IDS.has(handle)) return { path: shopPath(seg, "/p/" + handle + "/"), reason: "product" };
    const alias = PRODUCT_ALIAS[handle];
    if (alias && PRODUCT_IDS.has(alias)) {
      return { path: shopPath(seg, "/p/" + alias + "/"), reason: "product-alias" };
    }
    const brand = brandOf(handle);
    if (brand) return { path: shopPath(seg, "/b/" + brand + "/"), reason: "product-brand" };
    return { path: shopPath(seg, "/c/all/"), reason: "product-unknown" };
  }

  if (kind === "collections") {
    if (!rest.length) return { path: shopPath(seg, "/c/all/"), reason: "collection-cat" };
    const handle = slugify(safeDecode(rest[0]));
    /* `/collections/<brand>/products/<handle>` — Shopify's other product URL. */
    if (rest.length >= 3 && rest[1].toLowerCase() === "products") {
      return legacyTarget("/" + (langed ? first + "/" : "") + "products/" + rest[2], "");
    }
    if (BRAND_SLUGS.has(handle)) return { path: shopPath(seg, "/b/" + handle + "/"), reason: "collection-brand" };
    const asBrand = COLLECTION_BRAND[handle];
    if (asBrand) return { path: shopPath(seg, "/b/" + asBrand + "/"), reason: "collection-brand" };
    const cat = COLLECTION_CAT[handle];
    if (cat === "brands") return { path: shopPath(seg, "/brands/"), reason: "collection-cat" };
    if (cat) return { path: shopPath(seg, "/c/" + cat + "/"), reason: "collection-cat" };
    return { path: shopPath(seg, "/c/all/"), reason: "collection-unknown" };
  }

  if (kind === "pages" || kind === "policies") {
    const slug = INFO_SLUG[slugify(safeDecode(rest[0] || ""))];
    if (slug) return { path: shopPath(seg, "/info/" + slug + "/"), reason: "info" };
    return { path: shopPath(seg, "/info/contact/"), reason: "info-unknown" };
  }

  /* Every article the old blog had is gone; the listing is the honest target. */
  if (kind === "blogs") return { path: shopPath(seg, "/blog/"), reason: "blog" };

  if (kind === "search") {
    const q = new URLSearchParams(search.replace(/^\?/, "")).get("q");
    return { path: shopPath(seg, "/search/") + (q ? "?q=" + encodeURIComponent(q) : ""), reason: "screen" };
  }
  if (kind === "account") return { path: shopPath(seg, "/account/"), reason: "screen" };
  /* The basket is a drawer here, not an address (`/shop2/cart/` is a 404 by
     design — docs/seo.md), and the checkout is robots-disallowed, so a stale
     /cart link lands on the catalogue rather than on a page Google is told to
     forget. */
  if (kind === "cart" || kind === "checkout") return { path: shopPath(seg, "/c/all/"), reason: "screen" };
  /* Shopify's app proxies — a link from an installed app, never a real page. */
  if (kind === "apps" || kind === "a" || kind === "tools") return { path: shopPath(seg, "/"), reason: "home" };

  /* A language prefix with something unrecognised behind it is still a
     language the searcher picked — send them to that shop, not to a 404. */
  return langed ? { path: shopPath(seg, "/"), reason: "home" } : null;
}
