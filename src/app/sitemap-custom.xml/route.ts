/**
 * GET /sitemap-custom.xml — what exists only in the database and so is not
 * in the static sitemap the build wrote:
 *
 *   · the owner's own products (custom_products, ids `c-…`), every active
 *     one in the three languages with its hreflang cluster — the same rows
 *     tools/prerender-shop2.mjs writes for the catalogue;
 *   · the blog posts published AFTER the last build — the prerender records
 *     the slugs it wrote pages for in src/data/blog.prerendered.json, and
 *     the published posts not in that list are named here (plus the /blog/
 *     listing itself when the build wrote none), so a new article is in a
 *     sitemap the minute it goes live and an old one is not named twice.
 *
 * public/sitemap.xml is a static file written at build and cannot know a
 * row created after it; it is a sitemapindex that names this route beside
 * its own chunks, so Google reaches both through the one address robots.txt
 * gives it (docs/seo.md). Hidden products and drafts are simply absent —
 * their pages answer 404 with noindex (src/lib/product-page.ts,
 * src/lib/blog-page.ts).
 *
 * The catalogue's own product pages are not here: they have a sitemap of
 * their own beside this one (src/app/sitemap-products.xml/route.ts), served
 * by the app for the same reason — a product hidden after the build has to
 * leave the sitemap without waiting for the next one.
 *
 * `trailingSlash: true` leaves a path with a file extension alone, so this
 * answers at /sitemap-custom.xml exactly, like the static files next to it.
 */
import prerendered from "@/data/blog.prerendered.json";
import { listPublished, type PostSummary } from "@/lib/blog";
import { postsNotPrerendered } from "@/lib/blog-page";
import { listCustomSitemapRows } from "@/lib/custom-products";
import { baseFrom, LANGS, SITEMAP_CLOSE, SITEMAP_OPEN, sitemapUrlEntry } from "@/lib/seo-head.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XML = "application/xml; charset=utf-8";

function xml(body: string, cacheControl: string): Response {
  return new Response(body, { headers: { "content-type": XML, "cache-control": cacheControl } });
}

export async function GET() {
  const base = baseFrom(process.env.PUBLIC_BASE_URL);
  let rows: Array<{ id: string; updatedAt: string }>;
  try {
    rows = await listCustomSitemapRows();
  } catch (err) {
    /* No database, or the table is not there yet: an empty, valid sitemap
       rather than an error Google would count against the index. */
    console.error("[sitemap-custom] unavailable:", err);
    return xml(SITEMAP_OPEN + SITEMAP_CLOSE, "no-store");
  }
  let posts: PostSummary[] = [];
  try {
    posts = postsNotPrerendered((await listPublished(1, 50)).posts, prerendered.slugs);
  } catch (err) {
    // the products alone are still an honest sitemap
    console.error("[sitemap-custom] posts unavailable:", err);
  }
  const today = new Date().toISOString().slice(0, 10);
  const entries: string[] = [];
  for (const lang of LANGS as Array<{ seg: string }>) {
    for (const r of rows) {
      entries.push(sitemapUrlEntry(base, "/p/" + encodeURIComponent(r.id) + "/", lang.seg, "0.7", r.updatedAt.slice(0, 10)));
    }
    if (posts.length && !prerendered.slugs.length) entries.push(sitemapUrlEntry(base, "/blog/", lang.seg, "0.7", today));
    for (const p of posts) {
      entries.push(sitemapUrlEntry(base, "/blog/" + encodeURIComponent(p.slug) + "/", lang.seg, "0.6", (p.updatedAt || p.publishedAt || today).slice(0, 10)));
    }
  }
  return xml(
    SITEMAP_OPEN + entries.join("\n") + (entries.length ? "\n" : "") + SITEMAP_CLOSE,
    "public, s-maxage=300, stale-while-revalidate=3600",
  );
}
