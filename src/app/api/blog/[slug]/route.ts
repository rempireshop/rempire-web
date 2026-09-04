/**
 * GET /api/blog/<slug>/?lang=RU — one published article.
 *
 * `{ ok, post: {slug,title,excerpt,bodyHtml,coverUrl,coverAlt,tags,products,
 *    seoTitle,seoDesc,author,publishedAt} }`. `bodyHtml` is the stored body
 * rendered to safe HTML server-side (@/lib/blog renderPostBody — the visual
 * editor's HTML through the allowlist, an older markdown body through
 * markdownToHtml) — the storefront injects it, it never renders a body itself.
 *
 * A draft, or a slug nobody has, both answer `404 {ok:false,error:"not_found"}`
 * — the storefront must not be able to tell "does not exist" from "not
 * published yet" apart, or a slug becomes a way to probe drafts.
 *
 * NB: call with the trailing slash — next.config has trailingSlash: true.
 */
import { getPublishedBySlug, pickLang, renderPostBody } from "@/lib/blog";

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = await params;
  const slug = String(raw || "").trim();
  const url = new URL(req.url);
  const lang = url.searchParams.get("lang") || "RU";
  if (!slug) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

  try {
    const post = await getPublishedBySlug(slug);
    if (!post) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

    return Response.json(
      {
        ok: true,
        post: {
          slug: post.slug,
          title: pickLang(post.title, lang),
          excerpt: pickLang(post.excerpt, lang),
          bodyHtml: renderPostBody(pickLang(post.body, lang)),
          coverUrl: post.coverUrl,
          coverAlt: pickLang(post.coverAlt, lang),
          tags: post.tags,
          products: post.products,
          seoTitle: pickLang(post.seoTitle, lang),
          seoDesc: pickLang(post.seoDesc, lang),
          author: post.author,
          publishedAt: post.publishedAt,
        },
      },
      { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=600" } },
    );
  } catch (err) {
    console.error("blog/[slug] GET failed", err);
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
