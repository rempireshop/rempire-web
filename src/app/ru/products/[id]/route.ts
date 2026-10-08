/** GET /ru/products/<id> — the Russian product page for an id the build did not prerender. See ../../../products/[id]/route.ts. */
import { productPageResponse } from "@/lib/product-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  return productPageResponse(id, "ru");
}
