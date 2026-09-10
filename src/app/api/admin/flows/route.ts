/**
 * GET /api/admin/flows — what the switches in «Письма» are actually holding:
 * how many carts are waiting for a reminder, how many addresses are waiting
 * for a «снова в наличии», how many birthdays fall in the next seven days —
 * and, since 10.09.2026, when each flow last ran and what it sent
 * (`runs`, from `settings.flow_runs`: the cron's run and the panel's own
 * «Запустить сейчас» alike).
 *
 * Read-only. The switches themselves are still written through
 * `PUT /api/admin/settings`; a run by hand is `POST /api/admin/flows/run/`.
 */
import { requireAdmin } from "@/lib/auth";
import { flowCounters, getFlowRuns, getFlows } from "@/lib/flows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const [counters, flows, runs] = await Promise.all([flowCounters(), getFlows(), getFlowRuns()]);
    return Response.json({ ok: true, counters, flows, runs }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/flows] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
