/**
 * POST /api/admin/orders/<id>/refund/  { amount? }
 *
 * «Вернуть деньги» on a paid order card. Before this existed the panel could
 * only say the truth out loud — «Деньги клиенту переводятся отдельно — в банке
 * или в Montonio, не отсюда» — and Renat had to go and do it in Montonio's
 * portal, after which this shop went on showing the order as «Оплачен» for
 * ever (docs/payments.md § 11).
 *
 * `amount` is optional: without one the whole remaining amount goes back.
 * With one it must be between a cent and what is left (order total minus what
 * has already gone back), so two partial refunds can never add up to more than
 * the order was worth.
 *
 * Everything after the provider's answer is settleRefund() — the same door the
 * refund webhook comes through, so the two cannot drift: the ledger on
 * `orders.payment`, the audit row, the move to «возврат» once the refunds
 * cover the order (which is what puts a counted shelf back), and the
 * customer's letter, once.
 *
 * Error codes, all plain for the panel to translate into one Russian sentence:
 *   not_configured   — no Montonio keys, or a provider that cannot refund
 *   not_paid         — nothing has arrived for this order yet
 *   no_provider_ref  — the order carries no provider id (marked paid by hand,
 *                      or covered entirely by a gift card): there is nothing
 *                      to send money back through
 *   already_refunded — the order is fully refunded already
 *   bad_amount       — 0, negative, or more than is left
 *   provider_unreachable / provider_rejected — Montonio said no
 */
import { requireAdmin } from "@/lib/auth";
import { getOrder, getOrderByNumber, PAID_ORDER_STATUSES, type Order } from "@/lib/orders";
import { getProvider } from "@/lib/payments";
import { canRefund, refundableAmount, refundedTotal } from "@/lib/payments/refund";
import { notifyOrderClosed } from "@/lib/payments/mail-hook";
import { settleRefund } from "@/lib/payments/settle";
import { PaymentError } from "@/lib/payments/types";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function bad(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, error, ...extra }, { status });
}

function money(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Whether the money for this order ever arrived — the same test the card uses. */
function settled(order: Order): boolean {
  if ((PAID_ORDER_STATUSES as readonly string[]).includes(order.status)) return true;
  const p = order.payment as { status?: unknown } | null | undefined;
  return !!p && typeof p === "object" && p.status === "paid";
}

export async function POST(req: Request, ctx: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;

  let body: { amount?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};

  let order: Order | null;
  try {
    order = (await getOrder(id)) ?? (await getOrderByNumber(id));
  } catch (err) {
    console.error("[api/admin/orders/:id/refund] read failed:", err);
    return bad("db_unavailable", 503);
  }
  if (!order) return bad("not_found", 404);
  if (!settled(order)) return bad("not_paid", 409);

  const total = Number(order.total) || 0;
  const left = refundableAmount(total, order.payment);
  if (!(left > 0)) {
    return bad("already_refunded", 409, { refundedTotal: refundedTotal(order.payment) });
  }

  const asked = body.amount === undefined || body.amount === null || body.amount === "" ? left : Number(body.amount);
  if (!Number.isFinite(asked)) return bad("bad_amount");
  const amount = money(asked);
  if (!(amount >= 0.01) || amount > left + 0.005) return bad("bad_amount", 400, { left });

  const payment = (order.payment ?? {}) as Record<string, unknown>;
  const providerRef = typeof payment.ref === "string" ? payment.ref.trim() : "";
  if (!providerRef) return bad("no_provider_ref", 409);

  let provider;
  try {
    provider = getProvider();
  } catch (err) {
    console.error("[api/admin/orders/:id/refund] no provider:", err);
    return bad("not_configured", 503);
  }
  if (!canRefund(provider)) return bad("not_configured", 503);
  /* The order was taken by a different provider from the one configured now
     (a shop that switched, or an order settled by hand). Sending a refund
     through the wrong gateway would be a request about somebody else's id. */
  const took = typeof payment.provider === "string" ? payment.provider : "";
  if (took && took !== provider.name) return bad("not_configured", 503, { detail: took });

  let result;
  try {
    result = await provider.refundPayment({
      providerRef,
      amount,
      currency: order.currency || "EUR",
      // one per attempt: Montonio must not send the money twice if this
      // request is retried, and it is what makes a double tap harmless
      idempotencyKey: randomUUID(),
      orderNumber: order.number,
    });
  } catch (err) {
    const code = err instanceof PaymentError ? err.code : "refund_failed";
    console.error("[api/admin/orders/:id/refund] provider refused:", code, err);
    return bad(code, code === "provider_unreachable" ? 502 : 502);
  }

  try {
    const out = await settleRefund(
      order,
      {
        ref: result.ref,
        amount: money(result.amount || amount),
        status: result.status,
        at: new Date().toISOString(),
        by: "admin",
        detail: result.detail,
      },
      // the letter goes below, where the amount and the language are already in hand
      { notify: false },
    );

    if (result.status !== "failed") {
      await notifyOrderClosed(
        { ...order, status: out.status },
        { kind: "refunded", amount: money(result.amount || amount) },
      );
    }

    const fresh = (await getOrder(order.id)) ?? order;
    return Response.json(
      {
        ok: true,
        amount: money(result.amount || amount),
        refundedTotal: out.refundedTotal,
        left: refundableAmount(total, fresh.payment),
        refundStatus: result.status,
        fully: out.fully,
        status: out.status,
        order: fresh,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    /* The money HAS left Montonio by now — this is the record of it that
       failed. Loud in the log and honest to the panel: the owner must look at
       Montonio rather than press the button again. */
    console.error("[api/admin/orders/:id/refund] recording the refund failed:", err);
    return bad("recorded_failed", 503, { ref: result.ref, amount: money(result.amount || amount) });
  }
}
