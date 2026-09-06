import { NextResponse } from "next/server";
import { getOrderByNumber } from "@/lib/orders";
import { getProvider } from "@/lib/payments";
import { allow, clientIp } from "@/lib/payments/ratelimit";
import { settlePayment } from "@/lib/payments/settle";
import { PaymentError } from "@/lib/payments/types";

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

  let result;
  try {
    result = await provider.verifyNotification(req);
  } catch (err) {
    /* Montonio sends refund webhooks (`refundToken`) to the same URL. They
       are understood — and not ours to act on: a refund is recorded by hand
       in the admin, never from a webhook — so they get the 200 that stops
       the 48-hour retry, not the 400 that would earn it. */
    if (err instanceof PaymentError && err.code === "not_order_webhook") {
      return NextResponse.json({ ok: true, ignored: "refund_webhook" });
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

  return NextResponse.json({ ok: true, status: outcome.status, keptPaid: outcome.keptPaid });
}

export function GET() {
  return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
