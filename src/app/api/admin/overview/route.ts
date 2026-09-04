/**
 * GET /api/admin/overview — the owner's «Обзор» tab, first screen of the
 * panel. requireAdmin; read-only.
 *
 * Everything on that screen used to be a mixture: real products, invented
 * orders, a random «вчера — 5». Now every number comes from this one call —
 * see getOverviewSummary() in src/lib/analytics.ts for which date and which
 * statuses each one counts, and docs/analytics.md for the owner-facing
 * version of the same explanation.
 */
import { requireAdmin } from "@/lib/auth";
import { getOverviewSummary } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  try {
    const data = await getOverviewSummary();
    return Response.json({ ok: true, ...data }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/overview] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
