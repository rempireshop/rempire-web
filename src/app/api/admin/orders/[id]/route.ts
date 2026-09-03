/**
 * GET   /api/admin/orders/<id>  — one order, whole
 * PATCH /api/admin/orders/<id>  — { status?, note? }
 *
 * The id is the uuid; an order number (R-100042) works too, so a link from a
 * letter opens the right order. Every status change lands in admin_audit.
 */
import { requireAdmin } from "@/lib/auth";
import {
  getOrder,
  getOrderByNumber,
  ORDER_STATUSES,
  setOrderNote,
  setOrderStatus,
  type OrderStatus,
} from "@/lib/orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function find(id: string) {
  return (await getOrder(id)) ?? (await getOrderByNumber(id));
}

export async function GET(req: Request, ctx: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    const order = await find(id);
    if (!order) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    return Response.json({ ok: true, order }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/orders/:id] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;

  let body: { status?: unknown; note?: unknown; notes?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const status = typeof body.status === "string" ? body.status : null;
  const note = typeof body.note === "string" ? body.note : typeof body.notes === "string" ? body.notes : null;
  if (!status && note == null) return Response.json({ ok: false, error: "nothing_to_do" }, { status: 400 });
  if (status && !ORDER_STATUSES.includes(status as OrderStatus)) {
    return Response.json({ ok: false, error: "bad_status", detail: status }, { status: 400 });
  }

  try {
    const found = await find(id);
    if (!found) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

    let order = found;
    if (note != null) order = (await setOrderNote(found.id, note)) ?? order;
    if (status) order = (await setOrderStatus(found.id, status as OrderStatus, "admin")) ?? order;

    return Response.json({ ok: true, order }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/orders/:id] write failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
