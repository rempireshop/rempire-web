/**
 * GET /sitemap-products.xml — the catalogue's 220 product pages, in the three
 * languages, minus the ones the owner has switched off with «Показывать в
 * магазине».
 *
 * These rows used to live in public/sitemap-N.xml with everything else the
 * build writes. They moved here on 08.09.2026 for one reason: a static file
 * cannot un-name a page. `product_overrides.hidden` (db/migrations/147)
 * changes while the deployment stands still, and Dim's answer was that a
 * hidden product should be hidden «without any deploys or rebuilds» — its
 * page 404s at once (src/middleware.ts), and a sitemap that went on offering
 * that address to Google until the next build would be the same promise half
 * kept. Everything the database cannot hide — the home pages, the categories,
 * the brands, the policy pages, the sets, the gift card, the blog — is still
 * written to disk by tools/prerender-shop2.mjs, because for those a file is
 * the cheaper and steadier answer.
 *
 * The pages themselves are still prerendered, one static file per product per
 * language: that is what makes the shop fast and indexable (docs/seo.md), and
 * nothing here changes it. This route only decides which of those files are
 * offered to a crawler.
 *
 * The rows are the same shape the prerender wrote — sitemapUrlEntry() in
 * src/lib/seo-head.mjs, the whole hreflang cluster on every language's <url>,
 * priority 0.7 for a product on the shelf and 0.4 for one that is out (a
 * sold-out product keeps its page and its ranking, it just stops asking for
 * the crawler's time — the reasoning is in the prerender, beside the rows
 * this replaces). `lastmod` is the owner's own edit when he has made one, and
 * today otherwise: the catalogue file carries no dates, and a build that used
 * to stamp its own day on every product is exactly what the override's
 * `updated_at` improves on.
 *
 * public/sitemap.xml is a sitemapindex naming this route beside its own static
 * chunks and sitemap-custom.xml, so Google reaches all of them through the one
 * address robots.txt gives it. `trailingSlash` leaves paths with an extension
 * alone, so this answers at /sitemap-products.xml exactly.
 */
import catalogueMin from "@/data/catalogue.min.json";
import { getOverrides } from "@/lib/orders";
import { baseFrom, LANGS, SITEMAP_CLOSE, SITEMAP_OPEN, sitemapUrlEntry } from "@/lib/seo-head.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XML = "application/xml; charset=utf-8";

type MinProduct = { id: string; s: string };
const CATALOGUE = catalogueMin as MinProduct[];

type Override = { stock?: string | null; hidden?: boolean; updatedAt?: string | null };

/**
 * The owner's overrides, or an empty map when there is no database. Empty is
 * the honest fallback here and not a dangerous one: it offers Google the same
 * list the static sitemap offered for months, and the pages themselves are
 * what decide who may read them.
 */
async function overrides(): Promise<Record<string, Override>> {
  try {
    return (await getOverrides()) as unknown as Record<string, Override>;
  } catch (err) {
    console.error("[sitemap-products] overrides unavailable:", err);
    return {};
  }
}

export async function GET(): Promise<Response> {
  const base = baseFrom(process.env.PUBLIC_BASE_URL);
  const all = await overrides();
  const today = new Date().toISOString().slice(0, 10);

  const entries: string[] = [];
  for (const lang of LANGS as Array<{ seg: string }>) {
    for (const p of CATALOGUE) {
      const o = all[p.id];
      if (o?.hidden) continue;
      const stock = o?.stock || p.s;
      const lastmod = o?.updatedAt ? String(o.updatedAt).slice(0, 10) : today;
      entries.push(sitemapUrlEntry(base, "/p/" + encodeURIComponent(p.id) + "/", lang.seg, stock === "out" ? "0.4" : "0.7", lastmod));
    }
  }

  return new Response(SITEMAP_OPEN + entries.join("\n") + (entries.length ? "\n" : "") + SITEMAP_CLOSE, {
    headers: {
      "content-type": XML,
      /* Five minutes, like sitemap-custom.xml beside it. A hidden product is
         gone from its own page immediately; the sitemap catching up within the
         next crawl is soon enough, and Google reads this file far less often
         than five minutes. */
      "cache-control": "public, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
