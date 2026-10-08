/**
 * GET /blogs/news — the English blog listing when the build wrote none
 * (a build with no database writes no blog pages at all; a build that had
 * one serves its static file before this route is reached). Built from the
 * published rows at request time — src/lib/blog-page.ts. /blogs/news is
 * Shopify's own address for the blog, kept since 08.10.2026.
 */
import { blogListPageResponse } from "@/lib/blog-page";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return blogListPageResponse("");
}
