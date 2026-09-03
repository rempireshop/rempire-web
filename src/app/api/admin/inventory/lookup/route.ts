/**
 * GET /api/admin/inventory/lookup/?ean=<code> — the scanner's one call.
 *
 * `hit: null` (still 200 OK) means the code matches nothing yet — the admin
 * screen then offers a product search so the owner can assign this EAN to a
 * product (PUT /api/admin/inventory/), exactly what docs/inventory.md and the
 * feasibility note before it call "assign mode".
 */
import { requireAdmin } from "@/lib/auth";
import { byEan } from "@/lib/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const ean = url.searchParams.get("ean") || "";
  if (!ean.trim()) return Response.json({ ok: false, error: "bad_ean" }, { status: 400 });

  try {
    const hit = await byEan(ean);
    return Response.json({ ok: true, hit }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/inventory/lookup] failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
