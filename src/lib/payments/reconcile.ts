import { query } from "@/lib/db";
import { getOrder, writeAuditSafe, type Order } from "@/lib/orders";
import { getProvider } from "@/lib/payments";
import { mapMontonioStatus, montonioRefundKind } from "./montonio";
import { settlePayment } from "./settle";
import { canAskProvider } from "./token-guard";
import type { PaymentProvider, VerifyResult } from "./types";

/**
 * «Заказ ждёт оплаты», for ever, on money that was actually taken.
 *
 * Everything this shop believes about a payment arrives pushed at it — the
 * shopper's return, or the webhook. Both are reliable until one of them is
 * not: a notification lost in a deploy, a function killed mid-flight, a
 * webhook Montonio gave up on after 48 hours. Nothing then ever asks. The
 * customer's money is gone, the order sits at «не оплачен», and the first
 * anybody hears of it is the customer.
 *
 * Dim's decision of 18.09.2026: a scheduled sweep. At three to five orders a
 * month it costs almost nothing, and it is the only one of the options that
 * works while he is asleep.
 *
 * The shape of it, and the parts that matter:
 *
 *   · it asks, it does not decide. `GET /orders/:orderUuid` is Montonio's own
 *     («You can use it to double-check the status of the order and its
 *     payment»), and only `PAID` — mapped by the same mapMontonioStatus() the
 *     webhook token goes through — settles anything;
 *   · it settles through settlePayment(), the SAME door the webhook and the
 *     shopper's return use. There is no second settlement path in this shop
 *     and this must not become one: the claim on the row, the gift cards, the
 *     points, the stock, the letter and the short-payment hold are all that
 *     door's, and a sweep that reimplemented any of them would drift from it;
 *   · it is idempotent, because that door is. A sweep that runs twice, or
 *     crosses a webhook that arrives mid-sweep, settles once;
 *   · it is NOT the «письмо об ожидании оплаты» flow and shares nothing with
 *     it. `flows.unpaid` — the seven-day cancel in src/lib/flows.ts — is a
 *     separate feature, currently switched off, and nothing here reads or
 *     writes its settings.
 *
 * Age, not days: the window is measured in minutes against `created_at`, so
 * there is no calendar in it and therefore no timezone in it either (the
 * Tallinn-day rule of src/lib/day.ts is about days, and this has none).
 */

/**
 * How old an unpaid order must be before it is worth asking about.
 *
 * Montonio's default `expiresIn` is 30 minutes, and its webhook retries run
 * for 48 hours; an order younger than that is simply a shopper still standing
 * at the bank. 45 minutes is past the expiry with room to spare, and the cron
 * this hangs off runs once a day anyway.
 */
export const MIN_AGE_MINUTES = 45;

/**
 * …and old enough to stop asking. An order nobody paid is the ordinary case,
 * and there is no reason to ask Montonio about last spring's abandoned carts
 * every night for ever. Two weeks is well past the 48 hours of webhook retries
 * and past the ten days a stuck refund can take.
 */
export const MAX_AGE_DAYS = 14;

/** Nothing here should ever be a long job. A month is 3–5 orders. */
export const SWEEP_LIMIT = 50;

export interface ReconcileReport {
  /** Orders looked at. */
  checked: number;
  /** Orders Montonio said were paid, and that this sweep settled. */
  settled: number;
  /** Order numbers of those, for the cron's answer and the logs. */
  numbers: string[];
  /** Orders Montonio answered about, still not paid. The ordinary case. */
  unpaid: number;
  /** Orders Montonio did not answer about at all — asked again next run. */
  unknown: number;
  /** Orders whose answer needs a human rather than a settlement. */
  odd: number;
  /** Set when there is no provider configured, or it cannot be asked. */
  skipped?: string;
}

const EMPTY: ReconcileReport = {
  checked: 0,
  settled: 0,
  numbers: [],
  unpaid: 0,
  unknown: 0,
  odd: 0,
};

/**
 * The orders worth asking about: still unpaid, old enough to have finished one
 * way or the other, and carrying the Montonio uuid `POST /orders` gave us —
 * without that uuid there is nothing to ask with.
 *
 * `new` and `failed` are the two unpaid statuses (src/lib/payments/order-status.ts
 * UNPAID_ORDER_STATUSES). `failed` is in deliberately: an ABANDONED ticket for
 * an order the shopper then paid on a second attempt lands exactly there.
 * `cancelled` is not: an order Renat has finished with must not be dragged back
 * into paid by a sweep, which is the same rule applyPaymentResult() draws.
 *
 * An order already holding a short payment (`payment.held`) is left alone: it
 * is not waiting for news from Montonio, it is waiting for Renat.
 */
export async function ordersToAsk(limit = SWEEP_LIMIT): Promise<string[]> {
  const rows = await query<{ id: string }>(
    `select id from orders
      where status in ('new', 'failed')
        and coalesce(payment->>'ref', '') <> ''
        and payment->'held' is null
        and created_at < now() - ($1 || ' minutes')::interval
        and created_at > now() - ($2 || ' days')::interval
      order by created_at asc
      limit $3`,
    [String(MIN_AGE_MINUTES), String(MAX_AGE_DAYS), Math.min(Math.max(limit, 1), 200)],
  );
  return rows.map((r) => String(r.id));
}

/**
 * Ask Montonio about every order that is still unpaid, and settle the ones
 * that turn out to have been paid all along.
 *
 * `provider` is injected by the tests; production leaves it out and takes the
 * configured one. A shop with no provider, or with one that cannot be asked
 * (the mock bank has no `fetchOrder`), sweeps nothing and says so — it is not
 * an error, it is a shop this job does not apply to.
 */
export async function reconcileUnpaidOrders(
  opts: { provider?: PaymentProvider | null; limit?: number } = {},
): Promise<ReconcileReport> {
  let provider = opts.provider ?? null;
  if (!provider) {
    try {
      provider = getProvider();
    } catch {
      return { ...EMPTY, skipped: "not_configured" };
    }
  }
  if (!canAskProvider(provider)) return { ...EMPTY, skipped: "provider_cannot_ask" };

  const ids = await ordersToAsk(opts.limit ?? SWEEP_LIMIT);
  const report: ReconcileReport = { ...EMPTY, numbers: [], checked: ids.length };

  for (const id of ids) {
    /* Re-read rather than carry the row from the select: the webhook this
       sweep exists to replace may well arrive in the middle of it, and the
       order it settles must not then be settled again from a stale snapshot.
       (settlePayment() would refuse it anyway — this simply saves the round
       trip to Montonio.) */
    const order = await getOrder(id);
    if (!order) continue;
    const ref = refOf(order);
    if (!ref) continue;
    if (order.payment && typeof order.payment === "object" && order.payment.held) continue;
    if (order.status !== "new" && order.status !== "failed") continue;

    let snapshot;
    try {
      snapshot = await provider.fetchOrder(ref);
    } catch (err) {
      /* fetchOrder() is documented never to throw; if it ever does, one
         order's bad day must not stop the rest of the sweep. */
      console.error(`[payments] reconcile: asking about ${order.number} threw`, err);
      snapshot = null;
    }
    if (!snapshot) {
      report.unknown += 1;
      continue;
    }

    const says = mapMontonioStatus(snapshot.paymentStatus);
    if (says !== "paid") {
      report.unpaid += 1;
      continue;
    }

    /* Paid AND already sent back — REFUNDED / PARTIALLY_REFUNDED — on an order
       this shop never even marked paid. That is not a settlement, it is a
       story, and guessing at it would write a refund ledger out of thin air.
       One journal row and a human. */
    if (montonioRefundKind(snapshot.paymentStatus)) {
      report.odd += 1;
      console.error(
        `[payments] reconcile: ${order.number} is ${snapshot.paymentStatus} at Montonio but unpaid here`,
      );
      await writeAuditSafe("system", "order.payment_odd", {
        orderId: order.id,
        number: order.number,
        ref,
        montonioStatus: snapshot.paymentStatus,
      });
      continue;
    }

    /* Montonio's own `grandTotal`, not `orders.total`: it is what was actually
       charged, and its help centre's warning is precisely that reusing an
       order can lower it. Handing it to the same door means an order that was
       paid short and whose webhook was lost is HELD when the sweep finds it,
       exactly as it would have been had the webhook arrived. */
    const result: VerifyResult = {
      orderRef: order.number,
      status: "paid",
      providerRef: snapshot.uuid || ref,
      amount: snapshot.grandTotal,
      currency: snapshot.currency || order.currency || "EUR",
      detail: `сверка с Montonio · ${snapshot.paymentStatus}`,
    };

    try {
      const outcome = await settlePayment(order, result, provider.name);
      if (outcome.status === "paid" && !outcome.alreadyPaid) {
        report.settled += 1;
        report.numbers.push(order.number);
        await writeAuditSafe("system", "order.payment_recovered", {
          orderId: order.id,
          number: order.number,
          ref,
          amount: snapshot.grandTotal,
          currency: result.currency,
          montonioStatus: snapshot.paymentStatus,
        });
      } else if (outcome.payment.held) {
        /* apply.ts has already written its own `order.payment_held` row. */
        report.odd += 1;
      }
    } catch (err) {
      console.error(`[payments] reconcile: settling ${order.number} failed`, err);
      report.unknown += 1;
    }
  }

  if (report.settled) {
    console.error(`[payments] reconcile settled ${report.numbers.join(", ")}`);
  }
  return report;
}

function refOf(order: Order): string {
  const p = order.payment;
  if (!p || typeof p !== "object") return "";
  const ref = (p as { ref?: unknown }).ref;
  return typeof ref === "string" ? ref.trim() : "";
}
