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
  setOrderPayment,
  setOrderStatus,
  type OrderStatus,
} from "@/lib/orders";
import { applyPaymentResult } from "@/lib/payments/apply";
import { notifyOrderPaid } from "@/lib/payments/mail-hook";

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

  /* `null` is valid JSON and `typeof null === "object"`, so the parse above
     lets it through and every field read below throws — a 500 from a
     two-byte body. Same door for a bare number, string or array. */
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ ok: false, error: "bad_body" }, { status: 400 });
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
    if (status === "paid") {
      /* Marking an order paid by hand (a bank transfer that arrived, a cash
         sale that was keyed in later) is the same event as a provider's
         "paid" ticket, and it must settle the same things exactly once: the
         gift card and loyalty points the customer spent, the promo's usage
         counter, the purchase on the customer's account, the stock
         decrement, the order's own gift cards, and the confirmation mail.
         applyPaymentResult() is the one door for that — a bare
         setOrderStatus() here left the order "paid" with the gift card
         unredeemed and the shelf count untouched. Already-paid orders are a
         no-op inside it (paid is a floor), so a second click changes nothing. */
      const outcome = await applyPaymentResult(
        order,
        {
          orderRef: order.number,
          status: "paid",
          providerRef: "manual",
          amount: Number(order.total),
          currency: "EUR",
          detail: "отмечено оплаченным в админке",
        },
        "manual",
        { setOrderPayment, setOrderStatus },
      );
      if (outcome.status === "paid" && !outcome.alreadyPaid) {
        await notifyOrderPaid({ ...order, status: "paid", payment: outcome.payment, loyaltyEarned: outcome.pointsEarned });
      }
      order = (await getOrder(found.id)) ?? order;
    } else if (status) {
      order = (await setOrderStatus(found.id, status as OrderStatus, "admin")) ?? order;
    }

    return Response.json({ ok: true, order }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/orders/:id] write failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
