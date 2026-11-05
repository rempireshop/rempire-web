/**
 * The product pages' reviews on Vercel's CDN — kept, and dropped the moment
 * one of them changes.
 *
 * 05.11.2026, Vercel's CPU allowance: GET /api/reviews/?product=<id> was
 * kept for thirty seconds (`s-maxage=30`). That is one address per product,
 * on a shop with a visitor every few minutes, so practically every product
 * page anybody opened ran the function again — 2,700 calls in a week, for
 * answers that change a few times a month.
 *
 * Now every answer is filed under one tag and kept for a day, and
 * src/lib/db.ts drops the tag after any statement that writes `reviews` —
 * whichever door the write leaves by: a shopper's new review (addReview),
 * the owner's «Опубликовать» or «Отклонить» in «Отзывы» (setReviewStatus),
 * an account erasure renaming its author (src/lib/account-privacy.ts). Same
 * mechanism as src/lib/feed-cache.ts, and src/lib/blog-cache.ts says how the
 * tag works on Vercel. REVIEWS_CACHE_MAX_S bounds the one case the tag
 * cannot see — a script writing the database from outside the app — and a
 * purge that failed; a deploy starts every CDN copy afresh as well.
 *
 * The browser's side is unchanged: `max-age=0`, so a shopper's own tab never
 * keeps a copy, and the owner's tabs still ask with `&fresh=<time>` after a
 * change in the panel (shopPoke in public/shop2/app.js).
 */
import { revalidateTag } from "next/cache";

export const REVIEWS_CACHE_TAG = "reviews";
export const REVIEWS_CACHE_MAX_S = 86400;

/** The headers GET /api/reviews/ answers a good list with. */
export const REVIEWS_CACHE_HEADERS: Readonly<Record<string, string>> = {
  "cache-control": `public, max-age=0, s-maxage=${REVIEWS_CACHE_MAX_S}`,
  "Vercel-Cache-Tag": REVIEWS_CACHE_TAG,
};

/** Drop the CDN's copies of every product's reviews. Never throws — the row is already saved. */
export function refreshReviewsCache(): void {
  try {
    revalidateTag(REVIEWS_CACHE_TAG);
  } catch (err) {
    /* outside a request (a script, a test calling a write directly)
       next/cache has no store and says so; there is no CDN there either */
    if (!/store missing/.test(String((err as Error)?.message))) {
      console.error("[reviews-cache] could not refresh the cached reviews:", err);
    }
  }
}
