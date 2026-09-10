/**
 * POST /api/admin/flows/run/  { flow: "abandoned" | "birthday" }
 *   → { ok: true, flow, sent, skipped, reason?, at, runs }
 *
 * «Запустить сейчас» under «Брошенная корзина» and «Скидка ко дню рождения»
 * in «Маркетинг → Письма». Until 10.09.2026 the only way to make either
 * letter go out before the daily cron was to call the cron by hand with the
 * server's secret — the test plan literally said «Попросить Дима запустить
 * расписание вручную — из панели это не делается». This is the door from the
 * panel: it runs the SAME function the cron runs (src/lib/flows.ts
 * runFlowByHand), so the switch still decides, every send still stamps its
 * row first, and pressing the button twice sends nothing twice.
 *
 * Admin only — it mails customers. The two flows here are the two whose
 * moment is a matter of time rather than of an event: «снова в наличии»
 * fires from the stock switch itself, and an unpaid order's reminder is
 * counted in days the owner set, not something to hurry.
 *
 * The run is remembered in `settings.flow_runs` (recordFlowRun) and the
 * whole map comes back as `runs`, so the panel can redraw «Последний запуск»
 * without a second request.
 */
import { requireAdmin } from "@/lib/auth";
import { getFlowRuns, runFlowByHand } from "@/lib/flows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/* A run walks at most 100 carts or 100 birthdays; the default 10 s is not
   enough for a hundred round trips to Resend — same ceiling as the cron. */
export const maxDuration = 60;

const NO_STORE = { "cache-control": "no-store" };

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let body: { flow?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400, headers: NO_STORE });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400, headers: NO_STORE });
  }
  const flow = body.flow;
  if (flow !== "abandoned" && flow !== "birthday") {
    return Response.json({ ok: false, error: "bad_flow" }, { status: 400, headers: NO_STORE });
  }

  try {
    const run = await runFlowByHand(flow);
    const runs = await getFlowRuns();
    return Response.json({ ok: true, flow, ...run, runs }, { headers: NO_STORE });
  } catch (err) {
    console.error("[api/admin/flows/run] failed:", err);
    return Response.json({ ok: false, error: "server_error" }, { status: 500, headers: NO_STORE });
  }
}
