/**
 * GET /cart/<item id>:<qty> — Merchant Center's «Checkout» link.
 *
 * Merchant Center → Business info → Checkout holds Shopify's cart permalink,
 * `https://rempireshop.com/cart/{id}:1`, with {id} the feed item's id. On the
 * day rempireshop.com points at this shop, that address lands here:
 * src/middleware.ts lets exactly this shape through (every other `/cart/…`
 * keeps its legacy redirect to the catalogue), and src/lib/merchant-cart.ts
 * turns the id back into the product and the size the feed gave it.
 *
 * A 302 to the product page with `?size=…&buy=<qty>`, which puts it in the
 * basket and opens the checkout — never cached: stock and «Показывать в
 * магазине» change under the same address. If the live catalogue cannot be
 * read, the shopper still lands in the shop — its home page — rather than on
 * an error: a Google ad click is not the moment to show a 503.
 */
import { parseCartPermalink, segFromAcceptLanguage } from "@/lib/cart-permalink";
import { resolveCartLink } from "@/lib/merchant-cart";
import { loadFeedInput } from "@/lib/merchant-feed";
import { langPath } from "@/lib/seo-head.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function go(req: Request, path: string, reason: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location: new URL(path, new URL(req.url).origin).toString(),
      "cache-control": "no-store",
      "x-rempire-cart": reason,
    },
  });
}

export async function GET(req: Request) {
  const seg = segFromAcceptLanguage(req.headers.get("accept-language"));
  const lines = parseCartPermalink(new URL(req.url).pathname);
  /* Not a permalink — the middleware sends those elsewhere, so this is a
     direct hit on the route: the catalogue, as the legacy rule would. */
  if (!lines) return go(req, langPath(seg, "/c/all/"), "not-a-permalink");
  try {
    const target = resolveCartLink(lines, await loadFeedInput(), seg);
    return go(req, target.path, target.reason);
  } catch (err) {
    console.error("[cart-link] live catalogue unavailable:", err);
    return go(req, langPath(seg, "/"), "unavailable");
  }
}
