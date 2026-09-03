/**
 * GET /api/admin/analytics?range=today|7d|30d|90d — the owner's «Аналитика»
 * tab. requireAdmin; everything else is read-only. See src/lib/analytics.ts
 * for what each number means and where it comes from.
 */
import { requireAdmin } from "@/lib/auth";
import { ANALYTICS_RANGES, type AnalyticsRange, getAnalyticsSummary } from "@/lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

function rangeOf(req: Request): AnalyticsRange | null {
  const raw = new URL(req.url).searchParams.get("range") ?? "7d";
  return (ANALYTICS_RANGES as readonly string[]).includes(raw) ? (raw as AnalyticsRange) : null;
}

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const range = rangeOf(req);
  if (!range) return Response.json({ ok: false, error: "bad_range" }, { status: 400, headers: NO_STORE });

  try {
    const data = await getAnalyticsSummary(range);
    return Response.json({ ok: true, ...data }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/analytics] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
