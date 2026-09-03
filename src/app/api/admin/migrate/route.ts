/**
 * GET  /api/admin/migrate — which migrations are applied / pending.
 * POST /api/admin/migrate — apply the pending ones.
 *
 * Normally unnecessary: `npm run build` runs `tools/migrate.mjs --if-configured`
 * after every deploy. This is the manual fallback for a database that was
 * connected after the build, or for checking state from the admin screen.
 */
import { requireAdmin } from "@/lib/auth";
import { migratePending, migrationStatus } from "@/lib/migrate";
import { writeAuditSafe } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    return Response.json({ ok: true, ...(await migrationStatus()) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/migrate] status failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const result = await migratePending();
    await writeAuditSafe("admin", "db.migrate", result);
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/migrate] failed:", err);
    return Response.json({ ok: false, error: "migrate_failed", detail: String((err as Error)?.message ?? err) }, { status: 500 });
  }
}
