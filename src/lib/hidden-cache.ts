/**
 * The «Показывать в магазине» list on Vercel's CDN — kept, and dropped the
 * moment it changes.
 *
 * 30.10.2026, Vercel: «used 75% of the included free tier usage for Fluid
 * Active CPU (4 hours)» — and a Hobby team past 100% is paused, the shop
 * with it. src/middleware.ts asks /api/overrides/hidden/ before every
 * catalogue product page (a hidden product must answer 404 without a
 * deploy), so that one route ran about 2,000 times a day, one function call
 * for every product page anybody — Google, Meta's crawler, a shopper —
 * opened, each answering the same few ids.
 *
 * Now the answer is filed under one tag and the CDN keeps it; upsertOverride()
 * (src/lib/orders.ts) drops the tag whenever a product's `hidden` is
 * written, so the next product page asks the database again and a switch
 * flipped in the panel still takes effect on the next request — Dim's
 * «hidden without any deploys or rebuilds» (08.09.2026) holds. Same
 * mechanism as src/lib/blog-cache.ts, which says how the tag works.
 * HIDDEN_CACHE_MAX_S bounds the worst case: a purge that failed costs at
 * most that long.
 */
import { revalidateTag } from "next/cache";

export const HIDDEN_CACHE_TAG = "hidden-products";
export const HIDDEN_CACHE_MAX_S = 600;

/** The headers /api/overrides/hidden/ answers a good list with. */
export const HIDDEN_CACHE_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": `public, s-maxage=${HIDDEN_CACHE_MAX_S}`,
  "Vercel-Cache-Tag": HIDDEN_CACHE_TAG,
};

/** Drop the CDN's copy of the list. Never throws — the row is already saved. */
export function refreshHiddenCache(): void {
  try {
    revalidateTag(HIDDEN_CACHE_TAG);
  } catch (err) {
    /* outside a request (a script, a test calling the function directly)
       next/cache has no store and says so; there is no CDN there either */
    if (!/store missing/.test(String((err as Error)?.message))) {
      console.error("[hidden-cache] could not refresh the hidden-products list:", err);
    }
  }
}
