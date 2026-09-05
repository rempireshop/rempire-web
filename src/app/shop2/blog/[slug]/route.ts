/**
 * GET /shop2/blog/<slug>/ — the Russian (unprefixed, x-default) page of a
 * post the build did not prerender: a post published after the last deploy
 * gets its SEO head and the article from its row (src/lib/blog-page.ts);
 * a draft or an unknown slug answers 404 with the noindex shell. A slug
 * the build DID write never reaches here — next.config.ts sends it at its
 * static file first (and Vercel's static layer does the same on its own).
 * /shop2/et/… and /shop2/en/… are the two files beside this one.
 */
import { blogPostPageResponse } from "@/lib/blog-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return blogPostPageResponse(slug, "");
}
