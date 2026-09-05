/** GET /shop2/et/blog/ — the Estonian listing when the build wrote none. See ../../blog/route.ts. */
import { blogListPageResponse } from "@/lib/blog-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return blogListPageResponse("et");
}
