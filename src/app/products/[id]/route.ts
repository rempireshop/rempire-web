/**
 * GET /products/<id> — the English (unprefixed, x-default) product page for
 * an id the build did not prerender: a custom product (`c-…`, created in the
 * panel) gets its SEO head and content from its row, anything else the shell.
 * See src/lib/product-page.ts; /ru/products/… and /et/products/… are the two
 * routes beside this one. next.config.ts sends prerendered ids at their static
 * files before this route is reached, and src/middleware.ts has already moved
 * a handle the catalogue does not have (Shopify's) to the page it became.
 */
import { productPageResponse } from "@/lib/product-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return productPageResponse(id, "");
}
