/**
 * GET /api/admin/orders?status=&q=&limit=
 *
 * status — one of new/paid/failed/shipped/cancelled/refunded
 * q      — matches order number, e-mail, name or phone
 * limit  — 1…200, default 50
 */
import { requireAdmin } from "@/lib/auth";
import { attachGiftCards } from "@/lib/giftcard-links";
import { listOrders } from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const url = new URL(req.url);
  try {
    const orders = await listOrders({
      status: url.searchParams.get("status") || undefined,
      q: url.searchParams.get("q") || undefined,
      limit: Number(url.searchParams.get("limit")) || undefined,
    });
    /* The order card offers «Подарочная карта (PDF)» straight off the list the
       panel already loads — one extra query for the whole page, and only when
       some order on it actually bought a card. */
    return Response.json(
      { ok: true, orders: await attachGiftCards(orders) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    console.error("[api/admin/orders] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
