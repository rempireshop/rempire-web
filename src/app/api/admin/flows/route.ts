/**
 * GET /api/admin/flows — what the three switches in «Письма» are actually
 * holding: how many carts are waiting for a reminder, how many addresses are
 * waiting for a «снова в наличии», and how many birthdays fall in the next
 * seven days.
 *
 * Read-only. The switches themselves are still written through
 * `PUT /api/admin/settings` — this route only counts.
 */
import { requireAdmin } from "@/lib/auth";
import { flowCounters, getFlows } from "@/lib/flows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const [counters, flows] = await Promise.all([flowCounters(), getFlows()]);
    return Response.json({ ok: true, counters, flows }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/flows] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
