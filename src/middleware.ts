/**
 * The Shopify → shop redirects. See src/lib/legacy-redirects.ts for the rules
 * and docs/audit/2026-09-07-seo.md for the numbers behind them.
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
 * It deliberately does nothing else: no auth, no geo, no rewriting. Anything
 * outside the matcher never loads it.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { legacyTarget } from "@/lib/legacy-redirects";

export function middleware(req: NextRequest) {
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

/* Only the shapes the Shopify storefront served. `:path*` matches the bare
   path too, so "/collections/:path*" covers "/collections" as well as
   "/collections/system-4". The five language prefixes are matched with and
   without a tail: Shopify published /ru, /et, /en-lv, /en-lt and /en-fi, and
   Search Console has impressions for all five. */
export const config = {
  matcher: [
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
