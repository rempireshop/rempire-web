import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { readRefundStatusDescription } from "@/lib/montonio-problems";
import { getOrder, getOrderByNumber, getOrderByPaymentRef, writeAuditSafe } from "@/lib/orders";
import { getProvider } from "@/lib/payments";
import { allow, clientIp } from "@/lib/payments/ratelimit";
import { canRefund, refundableAmount, refundsOf, type RefundNotification } from "@/lib/payments/refund";
import { refundValue, settlePayment, settleRefund } from "@/lib/payments/settle";
import { guardTokenChecks } from "@/lib/payments/token-guard";
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

  /* Montonio's own two extra checks — the store access key and the order uuid
     — run here rather than inside the token, because only this side holds the
     order they are supposed to match (src/lib/payments/token-guard.ts). A
     mismatch is a question for Montonio, never a refusal on its own: the
     answer decides, and the mismatch is journalled either way. */
  let guard;
  try {
    guard = await guardTokenChecks(order, result, provider);
  } catch (err) {
    console.error("payments/notify: token checks failed to run", err);
    return NextResponse.json({ ok: false, error: "guard_failed" }, { status: 503 });
  }
  if (guard.verdict === "unknown") {
    /* The shop does not know, and must not guess. 503 is the one answer that
       buys another attempt: Montonio retries for 48 hours, 13 times, and by
       then `GET /orders/:uuid` will almost certainly answer. */
    return NextResponse.json({ ok: false, error: "unconfirmed" }, { status: 503 });
  }
  if (guard.verdict === "refused") {
    // Montonio itself says this is not a paid order of ours. 200: a retry of
    // the same token would be refused for the same reason.
    return NextResponse.json({ ok: true, ignored: "token_mismatch" });
  }
  result = guard.result;

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
      const fresh = await reread(order);
      /* Only what is NOT on the ledger yet. The refund webhook for the very
         same refund arrives on this route too, under Montonio's own refund
         id, and «Вернуть деньги» may have recorded it before that — this
         entry has an id of its own, so foldRefund() cannot tell it is the
         same money and would count it a second time: the order would read as
         refunded twice over, a second letter would go to the customer, and
         nothing would be left refundable. Nothing left to record is the
         normal case, and it is recorded as nothing. */
      const amount = refundableAmount(await refundValue(fresh), fresh.payment);
      if (amount > 0) {
        await settleRefund(fresh, {
          ref: `montonio-order:${result.providerRef || order.number}`,
          amount,
          status: "done",
          at: new Date().toISOString(),
          by: "webhook",
          detail: "возврат отмечен в Montonio",
        });
      }
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
     the order was worth; the audit row keeps what was actually reported.
     Against what the customer GAVE — the money plus what a gift card paid
     (refundValue), the same figure every other refund calculation uses — and
     not against `orders.total` alone, which would shrink a 30 € bank refund to
     10 € on an order a 20 € card had already had back, and then tell the
     customer that 10 € in a letter.
     What is already recorded under THIS refund's own id does not narrow it:
     the admin route records the entry the moment Montonio answers and the
     webhook for the same refund follows (PENDING → SUCCESSFUL), and folding
     that in must leave the amount where it was rather than zero it. */
  const others = refundsOf(order.payment).filter((r) => r.ref !== note.refundRef);
  const amount = Math.min(note.amount, refundableAmount(await refundValue(order), { refunds: others }));

  /* The reason a refund did not reach the customer, and the only place it is
     ever said. `POST /refunds` answers 200 PENDING for a refund it cannot fund
     and explains nothing; days later this webhook arrives carrying
     `refundStatusDescription` — INSUFFICIENT_FUNDS, DECLINED,
     EXPIRED_OR_CANCELLED_CARD … — and until 18.09.2026 the word went into the
     ledger entry's `detail` and nowhere a human would look. Now it is a
     journal row of its own, with a code the panel can translate.
     Only when there IS something to explain: the guide prints `null` for a
     refund that simply worked, and a SUCCESSFUL refund with a description is
     still worth recording (a partial success has a story). */
  if (note.statusDescription) {
    const why = readRefundStatusDescription(note.statusDescription);
    console.error(
      `payments/notify: refund ${note.refundRef} on ${order.number} — ${note.status} · ${note.statusDescription}`,
    );
    /* Once per refund and reason, not once per delivery. This row is written
       BEFORE the settle below on purpose — the settle can throw, this answers
       503, and Montonio redelivers, and the one row that explains a stuck
       refund must survive that rather than depend on it. The cost was that
       every redelivery wrote it again (audit F19), so the owner opened a
       journal with «Возврат не дошёл до покупателя» three times over for one
       refund. Asked, then written; a read that fails writes anyway, because a
       duplicated explanation is better than a missing one. */
    let already = false;

    try {

      const [seen] = await query<{ n: number }>(

        "select count(*)::int as n from admin_audit where action = 'order.refund_stuck'" +

          " and payload->>'ref' = $1 and payload->>'code' = $2",

        [note.refundRef, note.statusDescription],

      );

      already = Number(seen?.n) > 0;

    } catch (err) {

      console.error("payments/notify: could not check for an earlier refund_stuck row", err);

    }

    if (!already) {
      await writeAuditSafe("system", "order.refund_stuck", {
        orderId: order.id,
        number: order.number,
        amount,
        ref: note.refundRef,
        code: note.statusDescription,
        reason: why.reason,
        status: note.status,
      });
    }
  }

  try {
    const out = await settleRefund(
      order,
      {
        ref: note.refundRef,
        amount,
        status: note.status,
        at: new Date().toISOString(),
        by: "webhook",
        detail: note.detail,
      },
      // nothing left to give back under this id means nothing to write about
      { notify: amount > 0 },
    );
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
