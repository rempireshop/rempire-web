/**
 * GET /api/admin/analytics/gsc — Google Search Console, last 28 days.
 * requireAdmin. See src/lib/gsc.ts for the service-account setup this needs
 * and the 24 h cache; docs/analytics.md for the owner-facing setup steps.
 */
import { requireAdmin } from "@/lib/auth";
import { getSearchConsoleSummary } from "@/lib/gsc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const summary = await getSearchConsoleSummary();
  // not_configured is an ordinary, expected state (nobody has set the env
  // yet) — not an error the admin screen should retry or alarm about.
  const status = summary.ok || summary.error === "not_configured" || summary.error === "bad_key" ? 200 : 502;
  return Response.json(summary, { status, headers: { "cache-control": "no-store" } });
}
