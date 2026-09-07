import { NextResponse } from "next/server";
import { getOrder, getOrderByNumber, getOrderByPaymentRef } from "@/lib/orders";
import { getProvider } from "@/lib/payments";
import { allow, clientIp } from "@/lib/payments/ratelimit";
import { canRefund, refundableAmount, type RefundNotification } from "@/lib/payments/refund";
import { settlePayment, settleRefund } from "@/lib/payments/settle";
import { PaymentError, type PaymentProvider } from "@/lib/payments/types";

/**
 * POST /api/payments/notify/ — the provider's webhook. This, not the shopper's
 * browser, is what the shop believes about money: it arrives even when the
 * customer closes the tab on the bank's page.
 *
 * Montonio retries a failed delivery for 48 hours and expects 200/201, so this
 * route answers 200 for anything it has understood — including a duplicate and
 * including a token for an order we have already settled. It only answers 4xx
 * when the token itself is unusable, which retrying cannot fix.
 *
 * Idempotency lives in applyPaymentResult(): paid is a floor, and a repeat of
 * the same status is a no-op.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Generous — Montonio retries for 48 hours and a busy day is a few dozen
   webhooks — but finite: the signed token is the security boundary, the
   limiter is what stops a replay loop from becoming a bill (audit H4). */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

export async function POST(req: Request) {
  if (!allow(`pay:notify:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  let provider;
  try {
    provider = getProvider();
  } catch (err) {
    // No payment provider configured ⇒ nothing here can be believed (C1).
    console.error("payments/notify: no provider", err);
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  /* The body can be read once, and which reader wants it is only known after
     the first one has looked. Cloned before anything touches it. */
  const refundBody = req.clone();

  let result;
  try {
    result = await provider.verifyNotification(req);
  } catch (err) {
    /* Montonio sends refund webhooks (`refundToken`) to the same URL. Until
       07.09.2026 they were understood and thrown away, so a refund Renat made
       in Montonio's own portal left the order here reading «Оплачен» for ever.
       Now they land on the order — idempotently, by the refund's own id. */
    if (err instanceof PaymentError && err.code === "not_order_webhook") {
      return refund(provider, refundBody);
    }
    console.error("payments/notify: token rejected", err);
    // Never retryable, and never something to act on: refuse it and say so.
    return NextResponse.json({ ok: false, error: "bad_token" }, { status: 400 });
  }

  let order;
  try {
    order = await getOrderByNumber(result.orderRef);
  } catch (err) {
    // A database blip IS retryable — ask for the redelivery.
    console.error("payments/notify: lookup failed", err);
    return NextResponse.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
  if (!order) {
    // Nothing to update and nothing to fix by retrying.
    console.error("payments/notify: unknown order", result.orderRef);
    return NextResponse.json({ ok: true, ignored: "unknown_order" });
  }

  let outcome;
  try {
    // Only the transition into paid sends mail. A replayed webhook — Montonio's
    // 48-hour retry, or someone re-posting the same body — must not ping Renat
    // or write to the customer again (audit H4). The gift cards bought in the
    // order are the exception: issuing them is idempotent, and if the first
    // pass died between the status write and the hook, this retry is the only
    // thing that will ever mint them. settlePayment() is that rule, shared
    // with the shopper's return and with a 0 € order.
    outcome = await settlePayment(order, result, provider.name);
  } catch (err) {
    console.error("payments/notify: apply failed", err);
    return NextResponse.json({ ok: false, error: "apply_failed" }, { status: 503 });
  }

  if (outcome.keptPaid) {
    console.error(
      `payments/notify: refused to downgrade paid order ${order.number} to ${result.status}`,
    );
  }

  /* The order token itself can say the payment has already been sent back —
     Montonio's REFUNDED / PARTIALLY_REFUNDED. It carries no refund id and no
     refunded amount, so a full refund is recorded for the order's total under
     the payment's own id, and a partial one is left to the refund webhook that
     knows the figure: a guessed amount on the order card would be worse than
     none. Either way the order stops claiming the money is still the shop's. */
  if (result.refunded === "full") {
    try {
      await settleRefund(await reread(order), {
        ref: `montonio-order:${result.providerRef || order.number}`,
        amount: Number(order.total) || 0,
        status: "done",
        at: new Date().toISOString(),
        by: "webhook",
        detail: "возврат отмечен в Montonio",
      });
    } catch (err) {
      console.error("payments/notify: recording a refunded order token failed", err);
    }
  }

  return NextResponse.json({ ok: true, status: outcome.status, keptPaid: outcome.keptPaid });
}

/** The order as it stands after settlePayment() has written to it. */
async function reread<T extends { id: string }>(order: T): Promise<T> {
  return ((await getOrder(order.id)) as unknown as T) ?? order;
}

/**
 * A refund webhook — Montonio's `refundToken`, and the only way a refund made
 * in its portal reaches this shop.
 *
 * It names the order by the PROVIDER's id (`orderUuid`), not by our number, so
 * the lookup goes through `orders.payment.ref`. Everything else is
 * settleRefund()'s: the same refund id twice folds into one entry, the order
 * turns «возврат» only when the refunds cover it, and the customer's letter
 * goes out once. 200 for everything understood — including a repeat and an
 * order we cannot find — because a 4xx buys 48 hours of retries and fixes
 * nothing.
 */
async function refund(provider: PaymentProvider, req: Request) {
  if (!canRefund(provider)) {
    return NextResponse.json({ ok: true, ignored: "refund_webhook" });
  }

  let note: RefundNotification;
  try {
    note = await provider.verifyRefundNotification(req);
  } catch (err) {
    console.error("payments/notify: refund token rejected", err);
    return NextResponse.json({ ok: false, error: "bad_token" }, { status: 400 });
  }

  let order;
  try {
    order = await getOrderByPaymentRef(note.providerOrderRef);
  } catch (err) {
    console.error("payments/notify: refund lookup failed", err);
    return NextResponse.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
  if (!order) {
    console.error("payments/notify: refund for an unknown order", note.providerOrderRef);
    return NextResponse.json({ ok: true, ignored: "unknown_order" });
  }

  /* Montonio may report a refund larger than what is left to refund — a
     second portal refund racing this one, or a figure we already recorded
     under another id. Clamped so the ledger can never say more went back than
     the order was worth; the audit row keeps what was actually reported. */
  const amount = Math.min(note.amount, refundableAmount(Number(order.total) || 0, order.payment));

  try {
    const out = await settleRefund(order, {
      ref: note.refundRef,
      amount: amount > 0 ? amount : note.amount,
      status: note.status,
      at: new Date().toISOString(),
      by: "webhook",
      detail: note.detail,
    });
    return NextResponse.json({
      ok: true,
      refund: note.status,
      applied: out.applied,
      refundedTotal: out.refundedTotal,
      status: out.status,
    });
  } catch (err) {
    console.error("payments/notify: refund apply failed", err);
    return NextResponse.json({ ok: false, error: "apply_failed" }, { status: 503 });
  }
}

export function GET() {
  return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
