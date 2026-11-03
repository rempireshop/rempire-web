/**
 * Everything that has to happen before a page is served — the one layer that
 * runs before Vercel's static files answer.
 *
 * Since 08.10.2026 the shop lives at Shopify's own addresses
 * (src/lib/shop-paths.mjs): English unprefixed, `/ru/…`, `/et/…`, no
 * trailing slash. This file does four things, in this order, and nothing
 * else (no auth, no geo):
 *
 * 1. **Moves an address that is not the page** — the old `/shop2/…` and
 *    `/shop/…` scheme, Shopify's other spellings, a trailing slash, a Shopify
 *    `?variant=` the shop knows the size of — with ONE 301 to the page, the
 *    campaign's utm_* kept (src/lib/legacy-redirects.ts). Merchant Center's
 *    «Checkout» link, `/cart/<item id>:<qty>`, is the one `/cart/…` shape let
 *    through to its own route (src/lib/cart-permalink.ts) — our item ids and
 *    Shopify's alike (src/lib/merchant-cart.ts).
 * 2. **Picks the language of an unprefixed page** for a browser that asked
 *    for another one: the switcher's saved choice (the `rempire_lang`
 *    cookie), else the first of ru/et/en in Accept-Language — a 302 to the
 *    `/ru/…` or `/et/…` twin, `Vary: Accept-Language, Cookie`. A client that
 *    sends neither (Googlebot) gets the English page, which is the x-default.
 * 3. **Withholds a product the owner has hidden** («Показывать в магазине»
 *    off): 404 with the noindex shell, before the static file can answer.
 * 4. Lets everything else through untouched.
 *
 * Middleware rather than `next.config.ts`'s `redirects()` because 1 and 3
 * are lookups (is this handle a product? is it hidden right now?) and 2 reads
 * a header and a cookie — none of which a config rule can do — and because
 * Next's own trailing-slash redirect is a 308 that would put a second hop in
 * front of every one of them (`skipTrailingSlashRedirect` in next.config.ts
 * hands that job to this file). `/api/…`, `/_next/…` and every file with an
 * extension are left out by the matcher at the bottom: an API route answers
 * both spellings of its address with no redirect at all, because Montonio
 * POSTs to `/api/payments/notify/` and a redirect loses a POST.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isCartPermalink } from "@/lib/cart-permalink";
import { legacyTarget, PRODUCT_IDS } from "@/lib/legacy-redirects";
import {
  LANG_COOKIE,
  langFromAcceptLanguage,
  isOwnerRest,
  parseShopPath,
  publicPath,
} from "@/lib/shop-paths.mjs";

/* ---------- «Показывать в магазине», without a deploy ---------------------
 *
 * Switching a catalogue product off already removes it everywhere the server
 * decides — the listing, search, the sets, the cart, the request-time product
 * route (src/lib/product-page.ts). It did NOT remove the one address that
 * matters most: a catalogue product has a static page written at build by
 * tools/prerender-shop2.mjs, and the static layer answers a file before any
 * route runs. Dim, 08.09.2026: «if the item is hidden, it should be hidden
 * without any deploys or rebuilds». Middleware is the only layer that runs
 * before that file is served, so the check is here. Nothing is memoised in
 * this file; the list itself is kept by the CDN and dropped the moment a
 * product's switch is saved (src/lib/hidden-cache.ts, 30.10.2026 — the
 * uncached lookup was one function call per product page view).
 *
 * A hidden product's address answers 404 and does NOT redirect to its brand,
 * even though it is a Shopify address too: the switch is a toggle the owner
 * flips back, and a 301 is cached by every browser that ever saw it — the
 * product would stay a brand page for them after it came back.
 */

/** How long the shop is willing to wait to be told. Past this it serves the
    page: a slow database must not be able to hang a product page, and "served
    when we could not find out" is the behaviour this file inherited. */
const LOOKUP_MS = 2500;

/** The ids «Показывать в магазине» is off for, or null for "could not find out". */
async function hiddenIds(origin: string): Promise<Set<string> | null> {
  try {
    const res = await fetch(new URL("/api/overrides/hidden/", origin), {
      cache: "no-store",
      signal: AbortSignal.timeout(LOOKUP_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; ids?: unknown };
    if (!body || body.ok !== true || !Array.isArray(body.ids)) return null;
    return new Set(body.ids.map(String));
  } catch (err) {
    console.error("[middleware] hidden products unavailable:", err);
    return null;
  }
}

/**
 * The answer a hidden product's address gets: 404, and a shell that says
 * `noindex, nofollow` — exactly what src/lib/product-page.ts answers for a
 * hidden custom product, so the two kinds of product behave identically once
 * they are off sale. app.js boots from it and settles on «Страница не
 * найдена». The shell is fetched rather than read: this runs on the edge,
 * where there is no filesystem. Only a hidden product ever pays for it.
 */
async function gone(origin: string): Promise<NextResponse | null> {
  try {
    const res = await fetch(new URL("/shop2/index.html", origin), { signal: AbortSignal.timeout(LOOKUP_MS) });
    if (!res.ok) return null;
    /* loaded here, not at the top: seo-head is ~80 KB that every cold start
       of this middleware used to evaluate for the rare hidden product
       (30.10.2026, Vercel's CPU allowance) */
    const { noindexShell } = await import("@/lib/seo-head.mjs");
    return new NextResponse(noindexShell(await res.text()), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (err) {
    console.error("[middleware] shell unavailable:", err);
    return null;
  }
}

/** The language a visitor of an unprefixed page wants, if it is not English. */
function wantedLang(req: NextRequest): "RU" | "ET" | null {
  const saved = (req.cookies.get(LANG_COOKIE)?.value || "").toLowerCase();
  if (saved === "ru") return "RU";
  if (saved === "et") return "ET";
  if (saved === "en") return null;
  const asked = langFromAcceptLanguage(req.headers.get("accept-language"));
  return asked === "RU" || asked === "ET" ? asked : null;
}

/** Both of the things the language decision reads — on the redirect and on the page. */
const VARY = "Accept-Language, Cookie";

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  /* Merchant Center's «Checkout» link — a live door, not a stale page:
     src/app/cart/[...path]/route.ts answers it with the product in the
     basket. Checked before the redirects, which would fold it into /cart. */
  if (isCartPermalink(pathname)) return NextResponse.next();

  /* 1. an address that is not the page */
  const hit = legacyTarget(pathname, search);
  if (hit) {
    /* Built from the request's own origin, so a preview deployment redirects
       to itself; hit.path carries whatever query the rule decided to keep. */
    const res = NextResponse.redirect(new URL(hit.path, req.nextUrl.origin), 301);
    /* Which rule fired, for reading a `curl -I` and for the e2e assertions.
       Harmless to a browser and to a crawler; it is not a robots directive. */
    res.headers.set("X-Rempire-Redirect", hit.reason);
    return res;
  }

  const route = parseShopPath(pathname);
  if (!route) return NextResponse.next();
  const storefront = !isOwnerRest(route.rest);

  /* 2. an unprefixed page, for a browser that asked for Russian or Estonian */
  if (storefront && !route.prefixed && (req.method === "GET" || req.method === "HEAD")) {
    const want = wantedLang(req);
    if (want) {
      const res = NextResponse.redirect(new URL(publicPath(want, route.rest) + search, req.nextUrl.origin), 302);
      res.headers.set("Vary", VARY);
      res.headers.set("Cache-Control", "private, no-store");
      res.headers.set("X-Rempire-Redirect", "lang");
      return res;
    }
  }

  /* 3. a catalogue product the owner has switched off */
  const product = /^\/p\/([^/]+)\/$/.exec(route.rest);
  if (product) {
    let id = product[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      /* a malformed escape is not an id anything can hide */
    }
    if (PRODUCT_IDS.has(id)) {
      const hidden = await hiddenIds(req.nextUrl.origin);
      if (hidden?.has(id)) {
        const res = (await gone(req.nextUrl.origin)) ?? NextResponse.next();
        if (storefront && !route.prefixed) res.headers.set("Vary", VARY);
        return res;
      }
    }
  }

  /* 4. the page. An unprefixed one says what it was chosen by, so no cache
     between here and the browser hands a Russian visitor's redirect to a
     crawler, or the crawler's English page to a Russian visitor. */
  const res = NextResponse.next();
  if (storefront && !route.prefixed) res.headers.set("Vary", VARY);
  return res;
}

/* Which requests run this file — src/lib/middleware-matcher.ts works the
   list out and says why; tests/middleware-matcher.test.ts holds this copy
   to it (Next reads the matcher as literals and cannot import it). Left
   out: the API (both spellings of every endpoint answer with no redirect,
   see the top of this file), Next's own files, any path whose last segment
   has an extension — and, since 03.11.2026 (Vercel's CPU allowance), every
   page at its own canonical address, unless the visitor's cookie or
   Accept-Language asks for Russian or Estonian on an unprefixed one.
   Products, and every address that moves, still run it; so do Shopify's
   sitemap names, its agents file and its Atom feeds, which carry a dot. */
export const config = {
  matcher: [
    "/collections/((?!.*\\.[A-Za-z0-9]+$|(?!(?:all|all-prioducts-rus|all-products-est|balzam-dlya-borody|beard-styling|black-friday|black-friday-1|cbd-daily|cosmetics|habeajamine|habeme-vuntsivahad|habemehooldus|habemeolid|habemepalsamid|hair-mask|hair-spray|juuksehooldus|juuksekreemid|juuksemaskid|juuksespreid|juuksevaha|kehahooldus|kehakreemid-toonikud|kehaniisutajad|koik-tooted|konditsionery-dlya-volos|korean-cosmetics|laki-dlya-volos|latest-arrivals|losony-dlya-volos|losony-posle-britya|losony-toniki-dlya-tela|lotions-and-toners|maski-dlya-litsa|maski-dlya-volos|maslo-dlya-borody|moisturizer|mylo-geli-dlya-dusha|nahahooldus|naohooldus|naomaskid|new-products|palsamid|parfuumid|parfyumeriya|peanaha-hooldus|popular-products|raseerimine|raseerimisjargne-hooldus|rempire-merch|rempire-merch-1|scalp-treatment|seebid-dusigeelid|shampoonid|shampuni-dlya-volos|shaving|shop-all|shop-all-1|silmahooldus|skin-care|skraby-dlya-golovy|soap|soap-and-body-wash|sredstva-dlya-britya|sredstva-dlya-britya-1|stayling-dlya-volos|top-brandid|top-brands|top-brendy|uhod-za-borodoy|uhod-za-kozhey|uhod-za-kozhey-glaz|uhod-za-litsom|uhod-za-telom|uhod-za-volosami|uvlazhnyayushchie-kremy|vendors|viimistlus|vosk-dlya-borody-i-usov|vosk-dlya-volos|vse-tovary|winter-deals)$)[a-z0-9]+(?:-[a-z0-9]+)*$).*)",
    "/ru/collections/((?!.*\\.[A-Za-z0-9]+$|(?!(?:aftershave|all|all-prioducts-rus|all-products|all-products-est|beard-and-mustache-wax|beard-balm|beard-care|beard-oil|beard-styling|black-friday|black-friday-1|body-care|cbd-daily|conditioner|cosmetics|eye-care|face-care|face-sheet-masks|habeajamine|habeme-vuntsivahad|habemehooldus|habemeolid|habemepalsamid|hair-care|hair-lotion|hair-mask|hair-spray|hair-styling|hair-wax|juuksehooldus|juuksekreemid|juuksemaskid|juuksespreid|juuksevaha|kehahooldus|kehakreemid-toonikud|kehaniisutajad|koik-tooted|korean-cosmetics|laki-dlya-volos|latest-arrivals|losony-toniki-dlya-tela|lotions-and-toners|maski-dlya-volos|moisturizer|mylo-geli-dlya-dusha|nahahooldus|naohooldus|naomaskid|new-products|palsamid|parfuumid|peanaha-hooldus|perfume|popular-products|raseerimine|raseerimisjargne-hooldus|rempire-merch|rempire-merch-1|scalp-treatment|seebid-dusigeelid|shampoo|shampoonid|shaving|shop-all|shop-all-1|silmahooldus|skin-care|skraby-dlya-golovy|soap|soap-and-body-wash|sredstva-dlya-britya|sredstva-dlya-britya-1|top-brandid|top-brands|top-brendy|uhod-za-kozhey|uvlazhnyayushchie-kremy|vendors|viimistlus|winter-deals)$)[a-z0-9]+(?:-[a-z0-9]+)*$).*)",
    "/et/collections/((?!.*\\.[A-Za-z0-9]+$|(?!(?:aftershave|all|all-prioducts-rus|all-products|all-products-est|balzam-dlya-borody|beard-and-mustache-wax|beard-balm|beard-care|beard-oil|beard-styling|black-friday|black-friday-1|body-care|cbd-daily|conditioner|cosmetics|eye-care|face-care|face-sheet-masks|habeajamine|hair-care|hair-lotion|hair-mask|hair-spray|hair-styling|hair-wax|juuksemaskid|juuksespreid|kehakreemid-toonikud|kehaniisutajad|konditsionery-dlya-volos|korean-cosmetics|laki-dlya-volos|latest-arrivals|losony-dlya-volos|losony-posle-britya|losony-toniki-dlya-tela|lotions-and-toners|maski-dlya-litsa|maski-dlya-volos|maslo-dlya-borody|moisturizer|mylo-geli-dlya-dusha|nahahooldus|new-products|parfyumeriya|peanaha-hooldus|perfume|popular-products|raseerimine|rempire-merch|rempire-merch-1|scalp-treatment|seebid-dusigeelid|shampoo|shampuni-dlya-volos|shaving|shop-all|shop-all-1|skin-care|skraby-dlya-golovy|soap|soap-and-body-wash|sredstva-dlya-britya|sredstva-dlya-britya-1|stayling-dlya-volos|top-brandid|top-brands|top-brendy|uhod-za-borodoy|uhod-za-kozhey|uhod-za-kozhey-glaz|uhod-za-litsom|uhod-za-telom|uhod-za-volosami|uvlazhnyayushchie-kremy|vendors|vosk-dlya-borody-i-usov|vosk-dlya-volos|vse-tovary|winter-deals)$)[a-z0-9]+(?:-[a-z0-9]+)*$).*)",
    "/((?!api(?:/|$)|_next/|.*\\.[A-Za-z0-9]+$|(?:ru/|et/)?collections/|(?:(?:ru|et)?|(?:ru/|et/)?(?:pages/contact|policies/privacy-policy|policies/refund-policy|policies/shipping-policy|policies/terms-of-service)|(?:ru/|et/)?blogs/news(?:/(?!(?:the-ultimate-guide-on-how-to-moisturize-your-skin-for-a-healthy-glow)$)[a-z0-9]+(?:-[a-z0-9]+)*)?|(?:ru/|et/)?(?:search|account|cart|checkout(?:/done)?)|admin(?:/scan)?|cards|golive|handover)$).*)",
    {"source":"/((?!api(?:/|$)|_next/|.*\\.[A-Za-z0-9]+$|ru(?:/|$)|et(?:/|$)|admin(?:/|$)|(?:cards|golive|handover)$).*)","has":[{"type":"cookie","key":"rempire_lang","value":"(?:[rR][uU]|[eE][tT])"}]},
    {"source":"/((?!api(?:/|$)|_next/|.*\\.[A-Za-z0-9]+$|ru(?:/|$)|et(?:/|$)|admin(?:/|$)|(?:cards|golive|handover)$).*)","has":[{"type":"header","key":"accept-language","value":".*(?:[rR][uU]|[eE][tT]).*"}],"missing":[{"type":"cookie","key":"rempire_lang"}]},
    {"source":"/((?!api(?:/|$)|_next/|.*\\.[A-Za-z0-9]+$|ru(?:/|$)|et(?:/|$)|admin(?:/|$)|(?:cards|golive|handover)$).*)","has":[{"type":"header","key":"accept-language","value":".*(?:[rR][uU]|[eE][tT]).*"},{"type":"cookie","key":"rempire_lang","value":"(?!(?:[rR][uU]|[eE][tT]|[eE][nN])$).*"}]},
    "/(sitemap_.*)",
    "/agents.md",
    "/(.*\\.atom)",
  ],
};
