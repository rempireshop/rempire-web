/**
 * GET /api/admin/newsletters/audience/ → { ok, audience: { RU, ET, EN, total } }
 *
 * Who a letter would go to right now: the addresses with the tick on and
 * not on the stop list (src/lib/newsletters.ts audienceRows — consent.ts is
 * the only writer of either), counted by the language their letter would be
 * in. What «Отправить N подписчикам» and the confirm card print. Admin only:
 * how many people are on the list is the shop's business.
 */
import { requireAdmin } from "@/lib/auth";
import { audienceCounts } from "@/lib/newsletters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const audience = await audienceCounts();
    return Response.json({ ok: true, audience }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/newsletters/audience] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
