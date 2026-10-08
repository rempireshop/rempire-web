/**
 * GET <anything> no file and no other route answered — the shell for the
 * screens that live only in the browser, and the shop's 404 for the rest.
 *
 * Since 08.10.2026 the shop's pages are the whole site (Shopify's addresses,
 * src/lib/shop-paths.mjs), so the catch-all is at the root; until then it was
 * src/app/shop2/[...path]. Where it sits in the routing order is the point:
 * src/middleware.ts has already moved every address that is not the page
 * (one 301) and sent a browser that asked for another language to its twin
 * (302); next.config.ts's `afterFiles` rewrites have already answered every
 * prerendered page with its file; Next's more specific routes — the
 * request-time products (src/app/{,ru/,et/}products/[id]) and blog
 * (src/app/{,ru/,et/}blogs/news/…), the OG cards, the sitemaps, the feeds,
 * the API — have had their turn. What arrives here is either a screen the
 * shop draws only in the browser (/search, /account, /cart, /checkout,
 * /checkout/done, /admin, /admin/scan, and the pages of a tree that has not
 * been prerendered yet), which gets the shell at 200, or an address the shop
 * has no page for, which gets a real 404 in its own language — Dim,
 * 07.09.2026: «Make a page not found». src/lib/notfound-page.ts decides
 * which, on the same shapes app.js's own router accepts.
 *
 * A catch-all cannot match `/` itself (it needs a segment); the English home
 * page is the shell's own file (next.config.ts).
 */
import { notFoundPageResponse } from "@/lib/notfound-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* The request itself, and not just its path, since 14.09.2026: on a screen the
   shop does serve, notFoundPageResponse() reads the signed session cookie off
   it and writes the shopper's own e-mail into the shell, so the checkout's
   first field is filled in the first paint instead of a round trip later
   (Renat: «this needs to be instant (!!!)»). */
export async function GET(req: Request) {
  return notFoundPageResponse(new URL(req.url).pathname, req);
}
