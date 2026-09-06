/**
 * GET   /api/admin/orders/<id>  — one order, whole
 * PATCH /api/admin/orders/<id>  — { status?, note?, labelStep? }
 *
 * The id is the uuid; an order number (R-100042) works too, so a link from a
 * letter opens the right order. Every status change lands in admin_audit.
 *
 * The order card's fulfilment steps all come through here (docs/shipping.md
 * § «Что видит Ренат в админке»):
 *
 *   status: "shipped"   «Отправлен» — the parcel left. This is the ONE place
 *                       the customer's «Заказ отправлен» letter goes out from,
 *                       with the tracking link when a Montonio shipment is on
 *                       the order; the label route itself never sends it.
 *   status: "delivered" «Доставлен» — the owner's last step. No letter.
 *   status: "paid"      on an order already shipped or delivered: the
 *                       journal's undo of one of those two — the step goes
 *                       back, and nothing about the money is touched. On any
 *                       other order it is «отметить оплаченным» by hand, which
 *                       settles the payment exactly like a provider's ticket.
 *   labelStep: false    the journal's undo of «Создать этикетку»: the shipment
 *                       stays on the order (Montonio cannot cancel it), the
 *                       card just shows the step as not done. `true` brings
 *                       it back.
 */
import { requireAdmin } from "@/lib/auth";
import { attachGiftCards } from "@/lib/giftcard-links";
import {
  getOrder,
  getOrderByNumber,
  ORDER_STATUSES,
  setOrderNote,
  setOrderPayment,
  setOrderStatus,
  writeAuditSafe,
  type Order,
  type OrderStatus,
} from "@/lib/orders";
import { applyPaymentResult } from "@/lib/payments/apply";
import { notifyOrderPaid } from "@/lib/payments/mail-hook";
import { saveShipmentOnOrder, shipmentOnOrder } from "@/lib/shipping/montonio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function find(id: string) {
  return (await getOrder(id)) ?? (await getOrderByNumber(id));
}

/** The two statuses after «Отправлен» — a step back from either is not a payment. */
function handedOver(status: string): boolean {
  return status === "shipped" || status === "delivered";
}

/**
 * Whether the order's money has already arrived and stayed — its payment
 * record says so, whatever the status column says now. A cancelled or
 * refunded order stepping back to «оплачен» (the journal's undo) is such an
 * order: settling it again would rewrite the provider's record as a "manual"
 * one and, since applyPaymentResult() treats paid as a floor, leave the
 * status exactly where it was — which is what used to happen.
 */
function settled(order: Order): boolean {
  if ((["paid", "shipped", "delivered"] as string[]).includes(order.status)) return true;
  const p = order.payment as { status?: unknown } | null | undefined;
  return !!p && typeof p === "object" && p.status === "paid";
}

/**
 * «Заказ отправлен», with the carrier's tracking code and link when the order
 * carries a Montonio shipment (src/lib/shipping/montonio.ts) — without one the
 * letter still goes, saying the number will follow. Loaded lazily by a
 * literal specifier (so the bundler traces it into the function) and never
 * allowed to throw: a status that already moved must not fail because Resend
 * had a bad day.
 */
async function sendShippedLetter(order: Order): Promise<void> {
  try {
    const { onOrderShipped } = await import("@/lib/mail-hooks");
    const shipment = shipmentOnOrder(order);
    await onOrderShipped(
      order,
      shipment && !shipment.dismissed
        ? { carrier: shipment.carrier, code: shipment.trackingCode, url: shipment.trackingUrl }
        : undefined,
    );
  } catch (err) {
    console.error("[api/admin/orders/:id] onOrderShipped failed:", err);
  }
}

export async function GET(req: Request, ctx: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  try {
    const order = await find(id);
    if (!order) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    // …plus `giftCards` (code + PDF link) when the order bought any.
    const [withCards] = await attachGiftCards([order]);
    return Response.json({ ok: true, order: withCards }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/orders/:id] read failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;

  let body: { status?: unknown; note?: unknown; notes?: unknown; labelStep?: unknown };
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
  const labelStep = typeof body.labelStep === "boolean" ? body.labelStep : null;
  if (!status && note == null && labelStep == null) {
    return Response.json({ ok: false, error: "nothing_to_do" }, { status: 400 });
  }
  if (status && !ORDER_STATUSES.includes(status as OrderStatus)) {
    return Response.json({ ok: false, error: "bad_status", detail: status }, { status: 400 });
  }

  try {
    const found = await find(id);
    if (!found) return Response.json({ ok: false, error: "not_found" }, { status: 404 });

    let order = found;
    if (note != null) order = (await setOrderNote(found.id, note)) ?? order;

    if (labelStep != null) {
      const shipment = shipmentOnOrder(found);
      if (!shipment) return Response.json({ ok: false, error: "no_shipment" }, { status: 409 });
      if (!!shipment.dismissed === labelStep) {
        await saveShipmentOnOrder(found.id, { dismissed: !labelStep });
        await writeAuditSafe("admin", "shipment.step", { orderId: found.id, number: found.number, labelStep });
      }
      order = (await getOrder(found.id)) ?? order;
    }

    if (status === "paid" && !handedOver(found.status) && !settled(found)) {
      /* Marking an order paid by hand (a bank transfer that arrived, a cash
         sale that was keyed in later) is the same event as a provider's
         "paid" ticket, and it must settle the same things exactly once: the
         gift card and loyalty points the customer spent, the promo's usage
         counter, the purchase on the customer's account, the stock
         decrement, the order's own gift cards, and the confirmation mail.
         applyPaymentResult() is the one door for that — a bare
         setOrderStatus() here left the order "paid" with the gift card
         unredeemed and the shelf count untouched. An order whose money is
         already in (settled) never comes through here: a second «оплачен» on
         a paid order changes nothing, and the journal's undo of a
         cancellation or a refund is the plain status move below. */
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
    } else if (status && status !== found.status) {
      /* A step forward or back on the card: shipped, delivered, back to paid
         from either, cancelled, refunded. The money was settled on the way
         into paid and is not looked at again here; applyPaymentResult()
         would in any case refuse to move an already-paid order, which is
         exactly why the undo of «Отправлен» must not go through it. */
      order = (await setOrderStatus(found.id, status as OrderStatus, "admin")) ?? order;
      // the letter goes with the first hand-over only — not when «Доставлен» is undone back to shipped
      if (status === "shipped" && !handedOver(found.status)) await sendShippedLetter(order);
    }

    return Response.json({ ok: true, order }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/admin/orders/:id] write failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
