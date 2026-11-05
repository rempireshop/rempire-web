/**
 * The shop's two public feeds on Vercel's CDN — /api/overrides/ and
 * /api/bundles/ — kept, and dropped the moment the data behind them changes.
 *
 * 03.11.2026, Vercel: «used 90% of the included free tier usage for Fluid
 * Active CPU (4 hours)». Every page of the shop asks both feeds at boot, and
 * both answered `s-maxage=30`: the CDN ran the function again after every
 * half minute of traffic. Over 12 hours that was 266 calls and 39 s of CPU
 * for /api/overrides/ — the most expensive route of the shop — and 264 calls,
 * 16 s, for /api/bundles/.
 *
 * Now both are filed under one tag, and src/lib/db.ts drops the tag after
 * any statement that writes one of its FEED_TABLES — the owner's panel,
 * «Помощник», the Claude connector, a sale taking stock off the shelf,
 * whichever door the write leaves by; POST /api/admin/migrate drops it after
 * a migration, which writes through exec() and not query(). Same mechanism
 * as src/lib/hidden-cache.ts and src/lib/blog-cache.ts (which says how the
 * tag works on Vercel). FEED_CACHE_MAX_S bounds the one case the tag cannot
 * see — a script that writes the database from outside the app
 * (tools/go-live-reset.mjs, tools/seed-stock.mjs) — and a purge that failed;
 * a deploy starts every CDN copy afresh as well.
 *
 * Kept for a day since 05.11.2026, ten minutes before that. The shop has a
 * visitor every few minutes, spread over several CDN regions, each with its
 * own copy: ten minutes ran out between two visitors, so almost every boot
 * still ran the function (2,100 calls and 6 min of CPU a week for
 * /api/overrides/ alone, the shop's most expensive route). Freshness never
 * came from the clock — it comes from the tag.
 *
 * The browser's side is unchanged: no max-age, the same 120-second
 * stale-while-revalidate, and app.js asks with `cache: "no-store"`
 * (FEED_FETCH) — the owner's own tab overlays his saves (OV_LOCAL) anyway.
 */
import { revalidateTag } from "next/cache";

export const FEED_CACHE_TAG = "shop-feed";
export const FEED_CACHE_MAX_S = 86400;

/** The headers /api/overrides/ and /api/bundles/ answer a good feed with. */
export const FEED_CACHE_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": `public, s-maxage=${FEED_CACHE_MAX_S}, stale-while-revalidate=120`,
  "Vercel-Cache-Tag": FEED_CACHE_TAG,
};

/** Drop the CDN's copies of both feeds. Never throws — the row is already saved. */
export function refreshFeedCache(): void {
  try {
    revalidateTag(FEED_CACHE_TAG);
  } catch (err) {
    /* outside a request (a script, a test calling a write directly)
       next/cache has no store and says so; there is no CDN there either */
    if (!/store missing/.test(String((err as Error)?.message))) {
      console.error("[feed-cache] could not refresh the shop feeds:", err);
    }
  }
}
