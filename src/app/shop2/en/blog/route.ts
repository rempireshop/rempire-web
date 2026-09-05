/** GET /shop2/en/blog/ — the English listing when the build wrote none. See ../../blog/route.ts. */
import { blogListPageResponse } from "@/lib/blog-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return blogListPageResponse("en");
}
