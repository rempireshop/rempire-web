/**
 * GET /api/overrides/hidden — the catalogue ids «Показывать в магазине» is
 * switched off for (product_overrides.hidden, db/migrations/147), and nothing
 * else.
 *
 * Why a route of its own, next to the feed that already carries the same
 * fact: src/middleware.ts asks this question on every product page, and it
 * runs on the edge, where there is no Postgres client. The full
 * /api/overrides/ answer is the whole shop — every override, every custom
 * product, the settings — which is the right payload for a storefront booting
 * once and the wrong one for a lookup that happens per page view. This one is
 * a list of ids, usually empty.
 *
 * **Never cached.** The point of the middleware's question is that hiding a
 * product takes effect without a deploy and without a wait (Dim, 08.09.2026:
 * «if the item is hidden, it should be hidden without any deploys or
 * rebuilds»), and every second of `s-maxage` here is a second in which the
 * hidden product's page is still served. The query it costs is the one the
 * partial index in migration 147 was created for — `where hidden` over a
 * table whose hidden rows are the few the owner has switched off — so this
 * is a cheap question honestly asked rather than a cached guess.
 *
 * Public, like the feed beside it: /api/overrides/ has always published
 * `hidden` per product, because the storefront has to know which products to
 * drop from its own list. Nothing new leaves the server here.
 */
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await query<{ product_id: string }>(
      "select product_id from product_overrides where hidden order by product_id",
    );
    return Response.json(
      { ok: true, ids: rows.map((r) => r.product_id) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    /* No database, or a migration that has not run yet. 503 rather than an
       empty list, so the caller can tell "nothing is hidden" from "I could not
       find out" — src/middleware.ts serves the page on the second, which is
       the older behaviour and the safer direction for a shop. */
    console.error("[api/overrides/hidden] unavailable:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
