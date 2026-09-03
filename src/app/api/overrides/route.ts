/**
 * GET /api/overrides — everything the storefront needs to render the owner's
 * edits: per-product overrides (price, stock, SEO, subcategory, variant photo
 * order, video) and the shop settings (chat bot on/off, mail flows, shipping
 * rules).
 *
 * Public and cached at the edge for half a minute — a price change is visible
 * within 30 s, and a burst of shoppers costs one query.
 *
 * When there is no database the shop must still work, so the answer is a plain
 * 503 with {ok:false}; public/shop2/app.js falls back to its localStorage copy.
 */
import { getOverrides, getSettings } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_SETTINGS: Record<string, unknown> = {
  chatbot: true,
  bundles: true,
  flows: { abandoned: false, birthday: false, backstock: true },
  shipping: {},
};

export async function GET() {
  try {
    const [overrides, stored] = await Promise.all([getOverrides(), getSettings()]);
    return Response.json(
      { ok: true, overrides, settings: { ...DEFAULT_SETTINGS, ...stored } },
      { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (err) {
    console.error("[api/overrides] unavailable:", err);
    return Response.json(
      { ok: false, error: "db_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
