/**
 * GET /api/admin/newsletters/audience/
 *   → { ok, audience: { RU, ET, EN, total }, budget, plan }
 *
 * Who a letter would go to right now: the addresses with the tick on and
 * not on the stop list (src/lib/newsletters.ts audienceRows — consent.ts is
 * the only writer of either), counted by the language their letter would be
 * in. What «Отправить N подписчикам» and the confirm card print. Admin only:
 * how many people are on the list is the shop's business.
 *
 * Since 21.09.2026 the same call answers the second question that card has to
 * ask — «и сколько это займёт». `budget` is the day as it stands
 * (src/lib/mail-budget.ts): «сегодня отправлено N из CAP · рассылке доступно
 * M». `plan` is that arithmetic applied to THIS audience — how many of them
 * go out today and how many days the rest will take, because a free plan of a
 * hundred letters a day means a list of three hundred is a three-day
 * campaign, and that is a thing to know before pressing «Отправить» rather
 * than after.
 */
import { requireAdmin } from "@/lib/auth";
import { campaignPlan, mailBudgetView } from "@/lib/mail-budget";
import { audienceCounts } from "@/lib/newsletters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const audience = await audienceCounts();
    const budget = await mailBudgetView();
    /* The whole audience, because nothing has been queued yet: this is the
       plan for a letter that has not started. Once it has, the same two
       fields come off GET /api/admin/newsletters/<id>/send/ with the
       addresses that are actually left. */
    return Response.json(
      { ok: true, audience, budget, plan: campaignPlan(audience.total, budget) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/admin/newsletters/audience] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
