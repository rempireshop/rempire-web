/**
 * GET /shop2/p/<id>/ — the Russian (unprefixed, x-default) product page for
 * an id the build did not prerender: a custom product (`c-…`, created in
 * the panel) gets its SEO head and content from its row, anything else the
 * shell. See src/lib/product-page.ts; /shop2/et/… and /shop2/en/… are the
 * two files beside this one. next.config.ts sends prerendered ids at their
 * static files before this route is reached and everything else under
 * /shop2/ at the shell after it.
 */
import { productPageResponse } from "@/lib/product-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return productPageResponse(id, "");
}
