/**
 * GET /api/admin/audit?limit= — who changed what, newest first.
 * Feeds the «Журнал изменений» panel in the admin.
 */
import { requireAdmin } from "@/lib/auth";
import { listAudit } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const limit = Number(new URL(req.url).searchParams.get("limit")) || 100;
  try {
    return Response.json({ ok: true, audit: await listAudit(limit) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/audit] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
