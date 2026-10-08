/**
 * GET /blogs/news/<slug> — the English (unprefixed, x-default) page of a post
 * the build did not prerender: a post published after the last deploy gets
 * its SEO head and the article from its row (src/lib/blog-page.ts); a draft
 * or an unknown slug answers 404 with the noindex shell. A slug the build DID
 * write never reaches here — next.config.ts sends it at its static file
 * first. /ru/blogs/news/… and /et/blogs/news/… are the two routes beside it.
 */
import { blogPostPageResponse } from "@/lib/blog-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return blogPostPageResponse(slug, "");
}
