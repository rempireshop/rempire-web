/** GET /ru/blogs/news — the Russian listing when the build wrote none. See ../../../blogs/news/route.ts. */
import { blogListPageResponse } from "@/lib/blog-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return blogListPageResponse("ru");
}
