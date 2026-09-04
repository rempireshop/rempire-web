/**
 * GET /sitemap-custom.xml — the owner's own products (custom_products,
 * ids `c-…`), every active one in the three languages with its hreflang
 * cluster, the same rows tools/prerender-shop2.mjs writes for the catalogue.
 *
 * public/sitemap.xml is a static file written at build and cannot know a
 * product created after it; it is a sitemapindex that names this route
 * beside its own chunks, so Google reaches both through the one address
 * robots.txt gives it (docs/seo.md). Hidden products are simply absent —
 * their page answers 404 with noindex (src/lib/product-page.ts).
 *
 * `trailingSlash: true` leaves a path with a file extension alone, so this
 * answers at /sitemap-custom.xml exactly, like the static files next to it.
 */
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
  const entries: string[] = [];
  for (const lang of LANGS as Array<{ seg: string }>) {
    for (const r of rows) {
      entries.push(sitemapUrlEntry(base, "/p/" + encodeURIComponent(r.id) + "/", lang.seg, "0.7", r.updatedAt.slice(0, 10)));
    }
  }
  return xml(
    SITEMAP_OPEN + entries.join("\n") + (entries.length ? "\n" : "") + SITEMAP_CLOSE,
    "public, s-maxage=300, stale-while-revalidate=3600",
  );
}
