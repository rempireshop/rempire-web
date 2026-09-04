/**
 * GET /api/bundles — the curated sets («Наборы») the shop is selling right now.
 *
 * Public and cached at the edge for half a minute, exactly like
 * /api/overrides/: an edit in the admin shows up in the shop within 30 s, and
 * a burst of shoppers costs one query.
 *
 * Active sets only. A set the owner switched off is not "hidden by CSS" — it
 * never leaves the server. (Order pricing is a different question and reads
 * every row, active or not: see the note on bundleDefsForOrders() in
 * src/lib/bundles.ts — a customer mid-checkout must not lose their cart.)
 *
 * With no database the shop must still work, so the answer is a plain 503
 * with {ok:false}; public/shop2/app.js keeps the static public/shop/bundles.js
 * it loaded with, which is the same list this table was seeded from.
 *
 * NB: the «Наборы на сайте» switch (settings.bundles) is NOT applied here.
 * It is a storefront switch, delivered with the rest of the settings by
 * /api/overrides/, and app.js hides every trace of sets when it is off —
 * including this list. Keeping the two apart is what lets a set line already
 * sitting in somebody's cart still be priced and paid for.
 */
import { listBundles } from "@/lib/bundles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const bundles = await listBundles({ activeOnly: true });
    return Response.json(
      { ok: true, bundles },
      { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=120" } },
    );
  } catch (err) {
    console.error("[api/bundles] unavailable:", err);
    return Response.json(
      { ok: false, error: "db_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
