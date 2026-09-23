/**
 * GET /feed/google-en.xml — the Google Merchant Center feed in English
 * GET /feed/google-et.xml — in Estonian
 * GET /feed/google-ru.xml — in Russian
 *
 * RSS 2.0 with the `g:` namespace, built on every request from the live
 * catalogue: the owner's prices, sizes, stock and «Показывать в магазине»,
 * the counted shelf, the shipping rules the checkout bills with. What each
 * field is and where it comes from: src/lib/merchant-feed.ts. What the owner
 * does with these three addresses in Merchant Center: docs/merchant-feed.md.
 *
 * `trailingSlash: true` leaves a path with an extension alone, so this
 * answers at the exact address, like /sitemap-products.xml and /shop2/og/…
 * do. Any other file name under /feed/ is a 404 — including the old static
 * google-shopping.xml, which was never submitted anywhere and is gone.
 *
 * Cached at the edge for an hour and no longer. Merchant Center fetches once
 * a day, so a longer or stale-while-revalidate cache would hand it the
 * previous day's copy every time — the one stale answer a stock feed must not
 * give. An hour is what a hidden product or a sold-out size may lag by.
 */
import { buildFeed, feedBase, feedLangOf, loadFeedInput, type FeedInput } from "@/lib/merchant-feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ file: string }> };

const XML = "application/xml; charset=utf-8";
const CACHE = "public, max-age=0, s-maxage=3600";

export async function GET(_req: Request, ctx: Ctx) {
  const { file } = await ctx.params;
  const lang = feedLangOf(file);
  if (!lang) {
    return Response.json({ ok: false, error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  let input: FeedInput;
  try {
    input = await loadFeedInput();
  } catch (err) {
    /* A 503, not a feed from the files alone — see loadFeedInput(). Merchant
       Center keeps yesterday's items and fetches again. */
    console.error("[feed] live catalogue unavailable:", err);
    return Response.json(
      { ok: false, error: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store", "retry-after": "600" } },
    );
  }
  const { xml } = buildFeed({ ...input, lang, base: feedBase(process.env.PUBLIC_BASE_URL) });
  return new Response(xml, { headers: { "content-type": XML, "cache-control": CACHE } });
}
