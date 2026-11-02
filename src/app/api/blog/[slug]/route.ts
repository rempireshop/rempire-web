/**
 * GET /api/blog/<slug>/?lang=RU — one published article.
 *
 * `{ ok, post: {slug,title,excerpt,bodyHtml,coverUrl,coverAlt,coverFocus,tags,products,
 *    seoTitle,seoDesc,author,publishedAt,topic,minutes,coverW,coverH,sources} }` — `sources`
 * stays empty unless the owner switched «Показать в статье, из чего она
 * написана» on (names only, never a file). `bodyHtml` is the stored body
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
import { publicPost } from "@/lib/blog-magazine.mjs";
import { BLOG_CACHE_HEADERS } from "@/lib/blog-cache";

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
        /* src/lib/blog-magazine.mjs publicPost — the very shape #blogpost
           embeds in the prerendered page, so app.js repaints only on a real
           difference. */
        post: publicPost(post, lang, renderPostBody(pickLang(post.body, lang))),
      },
      /* the tag lets a save in the panel drop this copy in every language at
         once — src/lib/blog-cache.ts */
      { headers: { "cache-control": "public, max-age=60, s-maxage=86400, stale-while-revalidate=600", ...BLOG_CACHE_HEADERS } },
    );
  } catch (err) {
    console.error("blog/[slug] GET failed", err);
    return Response.json({ ok: false, error: "unavailable" }, { status: 503 });
  }
}
