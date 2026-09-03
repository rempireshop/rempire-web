import { NextResponse } from "next/server";
import { getOrderByNumber, setOrderPayment, setOrderStatus } from "@/lib/orders";
import { getProvider } from "@/lib/payments";
import { applyPaymentResult } from "@/lib/payments/apply";
import { notifyOrderPaid } from "@/lib/payments/mail-hook";

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

export async function POST(req: Request) {
  let provider;
  try {
    provider = getProvider();
  } catch (err) {
    console.error("payments/notify: no provider", err);
    return NextResponse.json({ ok: false, error: "provider_unconfigured" }, { status: 503 });
  }

  let result;
  try {
    result = await provider.verifyNotification(req);
  } catch (err) {
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
    outcome = await applyPaymentResult(order, result, provider.name, {
      setOrderPayment,
      setOrderStatus,
    });
  } catch (err) {
    console.error("payments/notify: apply failed", err);
    return NextResponse.json({ ok: false, error: "apply_failed" }, { status: 503 });
  }

  if (outcome.status === "paid") {
    await notifyOrderPaid({ ...order, status: "paid", payment: outcome.payment });
  }
  if (outcome.keptPaid) {
    console.error(
      `payments/notify: refused to downgrade paid order ${order.number} to ${result.status}`,
    );
  }

  return NextResponse.json({ ok: true, status: outcome.status, keptPaid: outcome.keptPaid });
}

export function GET() {
  return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
