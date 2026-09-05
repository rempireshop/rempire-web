/**
 * GET /shop2/og/c-<id>.png              — a custom product's link-preview card
 * GET /shop2/og/blog-<slug>[.et|.en].png — a blog post's, per language
 *
 * A 1 200×630 PNG drawn at request time from the row (src/lib/og-card.ts):
 * the pages that point at it are the request-time product page
 * (src/lib/product-page.ts) and the request-time blog page
 * (src/lib/blog-page.ts), whose photos are WebP uploads no link scraper
 * reads. A hidden product, a draft, an unknown slug → 404. Cached hard: the
 * ETag and the page's `?v=` stamp both move with updated_at, so an edit is a
 * new URL and an unchanged card is served from the edge for a day.
 *
 * `trailingSlash: true` leaves a path with an extension alone, so this
 * answers at the exact address, like /sitemap-custom.xml does.
 */
import { blogPostCard, customProductCard, type Card } from "@/lib/og-card";
import { baseFrom } from "@/lib/seo-head.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ file: string }> };

const CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
const FILE_RE = /^(?:(c-[a-z0-9][a-z0-9-]*)|blog-([a-z0-9-]+?)(?:\.(et|en))?)\.png$/;

function notFound() {
  return Response.json({ ok: false, error: "not_found" }, { status: 404, headers: { "cache-control": "no-store" } });
}

export async function GET(req: Request, ctx: Ctx) {
  const { file } = await ctx.params;
  const m = FILE_RE.exec(String(file || ""));
  if (!m) return notFound();
  const base = baseFrom(process.env.PUBLIC_BASE_URL);

  let card: Card | null;
  try {
    card = m[1] ? await customProductCard(m[1], base) : await blogPostCard(m[2], (m[3] || "ru").toUpperCase(), base);
  } catch (err) {
    console.error("[shop2/og] card unavailable:", err);
    return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  if (!card) return notFound();

  const etag = `"${card.key}"`;
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { etag, "cache-control": CACHE } });
  }
  let png: Buffer;
  try {
    png = await card.png();
  } catch (err) {
    console.error("[shop2/og] card not drawn:", err);
    return Response.json({ ok: false, error: "unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  return new Response(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      "content-length": String(png.length),
      etag,
      "cache-control": CACHE,
    },
  });
}
