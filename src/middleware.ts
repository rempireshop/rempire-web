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

/* Every page address — and nothing else. Left out: the API (both spellings of
   every endpoint answer with no redirect, see the top of this file), Next's
   own files, and any path whose last segment has an extension (the shop's
   assets under /shop2/ and /shop/, the sitemaps, the feeds, robots.txt) —
   except Shopify's own sitemap names, its agents file and its Atom feeds,
   which still have to move. */
export const config = {
  matcher: [
    "/((?!api(?:/|$)|_next/|.*\\.[A-Za-z0-9]+$).*)",
    "/sitemap_:name*",
    "/agents.md",
    "/(.*\\.atom)",
  ],
};
