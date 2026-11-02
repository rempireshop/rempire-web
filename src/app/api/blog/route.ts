/**
 * GET /api/blog/?lang=RU&page=1 — the published article list.
 *
 * `{ ok, posts: [{slug,title,excerpt,coverUrl,coverAlt,coverFocus,coverW,coverH,tags,publishedAt,
 *    topic,minutes,productCount}], featured: [same], total, page, perPage }`. `lang` picks which language's title/excerpt
 * come back (falling back to Russian, `pickLang()` in @/lib/blog); `page` is
 * 1-based, 10 posts per page. Cached for a minute, and dropped at once by a
 * save in the panel (src/lib/blog-cache.ts) — a new post needs a redeploy to
 * be prerendered anyway (docs/blog.md), so the API answer is never the only
 * place a shopper would see it.
 *
 * NB: call with the trailing slash — next.config has trailingSlash: true.
 */
import { listPublished } from "@/lib/blog";
import { publicListItem } from "@/lib/blog-magazine.mjs";
import { BLOG_CACHE_HEADERS } from "@/lib/blog-cache";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") || "RU";
  const page = Number(url.searchParams.get("page")) || 1;

  try {
    const { posts, total, perPage, featured } = await listPublished(page, 10);
    return Response.json(
      {
        ok: true,
        /* The shape lives in src/lib/blog-magazine.mjs (publicListItem): the
           prerender embeds the very same object in #blogdata, so app.js sees
           no difference where there is none. The tile crops its cover the way
           the article does (src/lib/blog-cover.mjs), carries this language's
           tags (pickTags) and, since 02.11.2026, the topic, the read time, the
           cover's own size and how many products the article names. */
        posts: posts.map((p) => publicListItem(p, lang)),
        // the carousel's articles, wherever they fall in the list
        featured: featured.map((p) => publicListItem(p, lang)),
        total,
        page,
        perPage,
      },
      // …and dropped by every save the public can see — src/lib/blog-cache.ts
      { headers: { "cache-control": "public, max-age=60, s-maxage=86400, stale-while-revalidate=600", ...BLOG_CACHE_HEADERS } },
    );
  } catch (err) {
    console.error("blog GET failed", err);
    /* An outage must look like one — the storefront shows «Блог временно
       недоступен» on ok:false (blog list loader in app.js) instead of an
       empty blog, and a 503 is what monitoring can see. */
    return Response.json({ ok: false, error: "unavailable", posts: [], featured: [], total: 0, page, perPage: 10 }, { status: 503 });
  }
}
