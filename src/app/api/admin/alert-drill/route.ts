import { clientIp, rateLimit, requireAdmin } from "@/lib/auth";
import { runAlertDrill } from "@/lib/build-watch";
import { mailConfigured } from "@/lib/mail";

/**
 * POST /api/admin/alert-drill/ — one test letter to DEV_ALERT_TO
 * (info@diipsolutions.eu), down the road a real build alert takes, with what
 * the build watch sees on this build (src/lib/build-watch.ts). Admin only, a
 * few a day at most; no button in the panel — Dim runs it when he wants proof.
 */

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  if (rateLimit("alert-drill", clientIp(req), 5, 3_600_000)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  if (!mailConfigured()) return Response.json({ ok: false, error: "no_api_key" }, { status: 503 });
  try {
    const out = await runAlertDrill();
    return Response.json({ ok: out.sent, ...out }, { status: out.sent ? 200 : 502 });
  } catch (err) {
    console.error("[alert-drill]", err);
    return Response.json({ ok: false, error: "failed" }, { status: 500 });
  }
}
