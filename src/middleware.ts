/**
 * Two jobs, both of which have to happen before Vercel's static layer answers.
 *
 * 1. The Shopify → shop redirects. See src/lib/legacy-redirects.ts for the
 *    rules and docs/audit/2026-09-07-seo.md for the numbers behind them.
 * 2. A catalogue product the owner has switched off with «Показывать в
 *    магазине» must stop having a page — see the second block below.
 *
 * Middleware rather than `next.config.ts`'s `redirects()`, for three reasons:
 *
 *  - It is a **lookup**, not a pattern. `/products/<handle>` is answered by
 *    asking the catalogue whether that handle is a product; a config rule can
 *    only rewrite one shape into another, so covering 1 638 map rows there
 *    would mean 1 638 literal rules.
 *  - Those rules would sit in the routes manifest and be matched, in order, on
 *    every request to the site — beside the ~250 rewrites
 *    `prerenderedRewrites()` already emits, and inside Vercel's route budget.
 *    This file runs only for the paths in `config.matcher` below, which are
 *    exactly the shapes Shopify served and nothing the new shop uses.
 *  - The query string has to be dropped rather than carried, and `/search`'s
 *    `q` kept — a decision per shape, which is code.
 *
 * It deliberately does nothing else: no auth, no geo, no rewriting beyond the
 * one 404 below. Anything outside the matcher never loads it.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { legacyTarget } from "@/lib/legacy-redirects";
import { noindexShell } from "@/lib/seo-head.mjs";

/* ---------- «Показывать в магазине», without a deploy ---------------------
 *
 * Switching a catalogue product off already removes it everywhere the server
 * decides — the storefront listing, search, the sets, the cart, and the
 * /shop2/{,et/,en/}p/[id] route (src/lib/product-page.ts). It did NOT remove
 * the one address that matters most: a catalogue product has a static page
 * written at build by tools/prerender-shop2.mjs, and the static layer answers
 * a file before any route runs — on Vercel by resolving the directory's
 * index.html itself, locally through `prerenderedRewrites()` in
 * next.config.ts. So the page Google holds, and the link a customer was sent,
 * went on working until the next deploy. Dim, 08.09.2026: «if the item is
 * hidden, it should be hidden without any deploys or rebuilds».
 *
 * Middleware is the only layer that runs before that file is served, so the
 * check has to be here. It is a lookup rather than a pattern for the same
 * reason the redirects above are: what is hidden is a row in Postgres and
 * changes while the deployment stands still.
 *
 * Nothing about the fast path changes. A product that is not hidden — which
 * is every product, almost always — gets NextResponse.next() and is served
 * from its static file exactly as before; the prerendering that makes the
 * shop fast and indexable (docs/seo.md) is untouched. What the check costs is
 * one small same-origin request per product page view, deliberately not
 * memoised: a cache here would be a window in which a hidden product is still
 * served, and that window is the whole thing being fixed.
 */

/** `/shop2/p/<id>/`, `/shop2/et/p/<id>/`, `/shop2/en/p/<id>/` — nothing else. */
const PRODUCT_PATH = /^\/shop2(?:\/(?:et|en))?\/p\/([^/]+)\/?$/;

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
 * `noindex, nofollow` so the address leaves the index rather than sitting in
 * it as a soft error. Exactly what src/lib/product-page.ts already answers for
 * a hidden custom product — same body, same status — so the two kinds of
 * product behave identically once they are off sale. app.js still boots from
 * it and settles on its own «Страница не найдена» screen.
 *
 * The shell is fetched rather than read: this runs on the edge, where there is
 * no filesystem, and /shop2/index.html is a static file the same layer serves
 * to everyone. Only a hidden product ever pays for it.
 */
async function gone(origin: string): Promise<NextResponse | null> {
  try {
    const res = await fetch(new URL("/shop2/index.html", origin), { signal: AbortSignal.timeout(LOOKUP_MS) });
    if (!res.ok) return null;
    return new NextResponse(noindexShell(await res.text()), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    });
  } catch (err) {
    console.error("[middleware] shell unavailable:", err);
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const product = PRODUCT_PATH.exec(req.nextUrl.pathname);
  if (product) {
    let id = product[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      /* a malformed escape is not an id anything can hide */
    }
    const hidden = await hiddenIds(req.nextUrl.origin);
    if (hidden?.has(id)) return (await gone(req.nextUrl.origin)) ?? NextResponse.next();
    return NextResponse.next();
  }

  const hit = legacyTarget(req.nextUrl.pathname, req.nextUrl.search);
  if (!hit) return NextResponse.next();

  /* Built from the request's own origin, so a preview deployment redirects to
     itself. `new URL(path, origin)` also drops the query string for us —
     everything the target needs is already in hit.path. */
  const url = new URL(hit.path, req.nextUrl.origin);
  const res = NextResponse.redirect(url, 301);
  /* Which rule fired, for reading a `curl -I` and for the e2e assertions.
     Harmless to a browser and to a crawler; it is not a robots directive. */
  res.headers.set("X-Rempire-Redirect", hit.reason);
  return res;
}

/* The shapes the Shopify storefront served, plus the shop's own product
   pages — the only addresses in the new shop this file looks at, and the only
   ones whose static file may have to be withheld. `:path*` matches the bare
   path too, so "/collections/:path*" covers "/collections" as well as
   "/collections/system-4". The five language prefixes are matched with and
   without a tail: Shopify published /ru, /et, /en-lv, /en-lt and /en-fi, and
   Search Console has impressions for all five. */
export const config = {
  matcher: [
    "/shop2/p/:id*",
    "/shop2/:lang(et|en)/p/:id*",
    "/products/:path*",
    "/collections/:path*",
    "/pages/:path*",
    "/policies/:path*",
    "/blogs/:path*",
    "/search/:path*",
    "/account/:path*",
    "/cart/:path*",
    "/checkout/:path*",
    "/apps/:path*",
    "/a/:path*",
    "/tools/:path*",
    "/:lang(ru|et|en|en-lv|en-lt|en-fi)/:path*",
  ],
};
