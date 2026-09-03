/**
 * GET /api/admin/inventory/?q=&filter=all|low|out|untracked
 * PUT /api/admin/inventory/ — { productId, variant?, ean?, lowThreshold? }
 *
 * The «Склад» table: every catalogue product×variant, whether or not it has
 * ever been counted (src/lib/inventory.ts getLevels()). PUT only ever touches
 * the static fields — EAN and the low-stock threshold; quantities change
 * through POST /api/admin/inventory/moves/ so every qty change is a ledger
 * row, never a silent UPDATE.
 */
import { requireAdmin } from "@/lib/auth";
import { getLevels, InventoryError, setLevel, type LevelFilter } from "@/lib/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILTERS = new Set<LevelFilter>(["all", "low", "out", "untracked"]);

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const filterRaw = url.searchParams.get("filter") ?? "all";
  const filter = FILTERS.has(filterRaw as LevelFilter) ? (filterRaw as LevelFilter) : "all";

  try {
    const levels = await getLevels({
      q: url.searchParams.get("q") || undefined,
      filter,
      limit: Number(url.searchParams.get("limit")) || undefined,
    });
    return Response.json({ ok: true, levels }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/inventory] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}

export async function PUT(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const productId = String(body.productId ?? body.product_id ?? "").trim();
  if (!productId) return Response.json({ ok: false, error: "bad_id" }, { status: 400 });
  const variant = body.variant == null ? "" : String(body.variant);

  const patch: { ean?: string | null; lowThreshold?: number } = {};
  if ("ean" in body) patch.ean = body.ean == null ? null : String(body.ean);
  if ("lowThreshold" in body || "low_threshold" in body) {
    patch.lowThreshold = Number(body.lowThreshold ?? body.low_threshold);
  }

  try {
    const level = await setLevel(productId, variant, patch);
    return Response.json({ ok: true, level }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof InventoryError) {
      return Response.json({ ok: false, error: err.code, detail: err.detail }, { status: 400 });
    }
    console.error("[api/admin/inventory] write failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
