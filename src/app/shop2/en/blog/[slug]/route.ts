/** GET /shop2/en/blog/<slug>/ — the English page of a post the build did not prerender. See ../../../blog/[slug]/route.ts. */
import { blogPostPageResponse } from "@/lib/blog-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  return blogPostPageResponse(slug, "en");
}
