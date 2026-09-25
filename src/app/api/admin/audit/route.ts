/**
 * GET /api/admin/audit?limit= — who changed what, newest first.
 * Feeds «Настройки → Журнал» in the admin. Each row that recorded what it
 * replaced carries `undo` (the fields to put back, src/lib/audit-undo.ts) and
 * each row a later one took back carries `undone` — «Вернуть» from any device
 * (Dim, 25.09.2026, q7).
 */
import { requireAdmin } from "@/lib/auth";
import { listAudit } from "@/lib/orders";
import { journalRows } from "@/lib/audit-undo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const limit = Number(new URL(req.url).searchParams.get("limit")) || 100;
  try {
    return Response.json({ ok: true, audit: journalRows(await listAudit(limit)) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/audit] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
