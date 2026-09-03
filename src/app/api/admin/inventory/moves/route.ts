/**
 * GET  /api/admin/inventory/moves/?productId=&reason=&since=&limit= — the ledger
 * POST /api/admin/inventory/moves/ — one stock change, always through here
 *
 * Two request shapes, both admin-only:
 *   { productId, variant?, delta, reason, ref? }  — a relative move: the
 *     scanner's «+1 приход» / «−1 продажа», goods-in, a return.
 *   { productId, variant?, qty, reason?, ref? }   — an absolute set: «останется
 *     N штук» after a physical count. reason defaults to 'adjust'.
 * `actor` is always "admin" here — the assistant's stock_adjust/stock_set
 * actions write "assistant" instead, straight through src/lib/inventory.ts.
 */
import { requireAdmin } from "@/lib/auth";
import { InventoryError, MOVE_REASONS, listMoves, move, setQty, type MoveReason } from "@/lib/inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const reasonRaw = url.searchParams.get("reason");
  const reason = reasonRaw && (MOVE_REASONS as readonly string[]).includes(reasonRaw) ? (reasonRaw as MoveReason) : undefined;

  try {
    const moves = await listMoves({
      productId: url.searchParams.get("productId") || undefined,
      reason,
      since: url.searchParams.get("since") || undefined,
      limit: Number(url.searchParams.get("limit")) || undefined,
    });
    return Response.json({ ok: true, moves }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/inventory/moves] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}

export async function POST(req: Request) {
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
  const ref = typeof body.ref === "string" && body.ref.trim() ? body.ref.trim().slice(0, 200) : null;

  try {
    if (body.qty !== undefined) {
      const reason =
        typeof body.reason === "string" && (MOVE_REASONS as readonly string[]).includes(body.reason)
          ? (body.reason as MoveReason)
          : "adjust";
      const result = await setQty(productId, variant, Number(body.qty), { reason, ref, actor: "admin" });
      return Response.json({ ok: true, result }, { headers: { "cache-control": "no-store" } });
    }

    if (body.delta === undefined) {
      return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
    }
    if (typeof body.reason !== "string" || !(MOVE_REASONS as readonly string[]).includes(body.reason)) {
      return Response.json({ ok: false, error: "bad_reason" }, { status: 400 });
    }
    const result = await move({
      productId,
      variant,
      delta: Number(body.delta),
      reason: body.reason as MoveReason,
      ref,
      actor: "admin",
    });
    return Response.json({ ok: true, result }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    if (err instanceof InventoryError) {
      return Response.json({ ok: false, error: err.code, detail: err.detail }, { status: 400 });
    }
    console.error("[api/admin/inventory/moves] write failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
