/**
 * GET /api/admin/orders/<id>/messages — the customer-reply thread for one
 * order (db/migrations/111_order_messages.sql), oldest first. `<id>` is the
 * uuid or the order number (R-100042), same lookup as GET /api/admin/orders/<id>.
 *
 * Read-only: rows are written by POST /api/admin/mail/send only, alongside
 * the actual send — see that route's own comment.
 */
import { requireAdmin } from "@/lib/auth";
import { getOrder, getOrderByNumber } from "@/lib/orders";
import { listMessages } from "@/lib/order-messages";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function findOrder(id: string) {
  return (await getOrder(id)) ?? (await getOrderByNumber(id));
}

export async function GET(req: Request, ctx: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;

  try {
    const order = await findOrder(id);
    if (!order) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    const messages = await listMessages(order.id);
    return Response.json({ ok: true, messages }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/orders/:id/messages] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
