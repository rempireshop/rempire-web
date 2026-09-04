/**
 * GET /api/blog/?lang=RU&page=1 — the published article list.
 *
 * `{ ok, posts: [{slug,title,excerpt,coverUrl,coverAlt,tags,publishedAt}],
 *    total, page, perPage }`. `lang` picks which language's title/excerpt
 * come back (falling back to Russian, `pickLang()` in @/lib/blog); `page` is
 * 1-based, 10 posts per page. Cached for a minute — a new post needs a
 * redeploy to be prerendered anyway (docs/blog.md), so the API answer is
 * never the only place a shopper would see it.
 *
 * NB: call with the trailing slash — next.config has trailingSlash: true.
 */
import { listPublished, pickLang } from "@/lib/blog";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") || "RU";
  const page = Number(url.searchParams.get("page")) || 1;

  try {
    const { posts, total, perPage } = await listPublished(page, 10);
    return Response.json(
      {
        ok: true,
        posts: posts.map((p) => ({
          slug: p.slug,
          title: pickLang(p.title, lang),
          excerpt: pickLang(p.excerpt, lang),
          coverUrl: p.coverUrl,
          coverAlt: pickLang(p.coverAlt, lang),
          tags: p.tags,
          publishedAt: p.publishedAt,
        })),
        total,
        page,
        perPage,
      },
      { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=600" } },
    );
  } catch (err) {
    console.error("blog GET failed", err);
    /* An outage must look like one — the storefront shows «Блог временно
       недоступен» on ok:false (blog list loader in app.js) instead of an
       empty blog, and a 503 is what monitoring can see. */
    return Response.json({ ok: false, error: "unavailable", posts: [], total: 0, page, perPage: 10 }, { status: 503 });
  }
}
