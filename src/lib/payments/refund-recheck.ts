/**
 * A refund Montonio accepted, asked about again every night.
 *
 * Why (audit 27.09.2026, B9). A refund answered 200 PENDING — every bank-link
 * refund, and every one the store's Montonio balance cannot fund yet — is
 * moved on by exactly one thing: Montonio's refund webhook. If that webhook is
 * lost (a deploy, a function killed mid-flight, 48 hours of retries used up),
 * nothing in this shop ever asks again:
 *
 *   · the money reaches the customer, and the order goes on reading
 *     «оплачен» — the stock never comes back, the points never move, the
 *     cards it sold stay live, and the «Деньги возвращены» letter the first
 *     one promised never goes;
 *   · on day ten the panel says Montonio cancelled it, and «Вернуть деньги»
 *     answers `already_refunded`, because the pending line still counts as
 *     money on its way out.
 *
 * So: once a day, every refund still pending after REFUND_PENDING_WATCH_HOURS
 * is looked up in Montonio's own refund list — `GET /orders/:orderUuid`, the
 * same call the refund route already reads after a lost answer
 * (fetchOrder(), src/lib/payments/montonio.ts; the list carries each refund's
 * `uuid`, which is our `ref`, its `amount` and its `status`). A refund Montonio
 * calls SUCCESSFUL, REJECTED or CANCELED is recorded through
 * recordProviderRefund() — the SAME code the refund webhook runs — so the
 * letter, the stock, the points, the cards and the journal are exactly what
 * the webhook would have done. PENDING stays pending. A refund Montonio did
 * not answer about, or does not list, is left alone: this job asks, it does
 * not guess.
 *
 * Bounded (REFUND_RECHECK_LIMIT orders, REFUND_RECHECK_BUDGET_MS), newest
 * orders first so an old refund Montonio will never answer about cannot
 * crowd out this week's, idempotent (a second run finds nothing pending, and
 * a webhook that lands mid-run is folded by the ledger's conditional write in
 * settleRefund()), and it never throws: it rides the morning cron beside the
 * letters (src/app/api/cron/flows/route.ts), which must go out whatever
 * Montonio does.
 */
import { query } from "@/lib/db";
import { REFUND_PENDING_WATCH_HOURS } from "@/lib/montonio-problems";
import { getOrder, type Order } from "@/lib/orders";
import { getProvider } from "@/lib/payments";
import { mapMontonioRefundStatus } from "./montonio";
import { refundsOf, type RefundEntry } from "./refund";
import { recordProviderRefund } from "./settle";
import { canAskProvider } from "./token-guard";
import type { PaymentProvider } from "./types";

/** Orders asked about per run. A month is three to five orders. */
export const REFUND_RECHECK_LIMIT = 20;
/** No new question is started after this much of the run. One question may take 15 s. */
export const REFUND_RECHECK_BUDGET_MS = 20_000;

export interface RefundRecheckReport {
  /** Orders Montonio was asked about. */
  orders: number;
  /** Pending refunds looked up in Montonio's answers. */
  asked: number;
  /** …that Montonio calls SUCCESSFUL, and were recorded as done. */
  done: number;
  /** …that Montonio calls REJECTED / CANCELED, and were recorded as failed. */
  failed: number;
  /** …that Montonio still calls PENDING. */
  pending: number;
  /** …that are not in Montonio's list for that order at all. */
  missing: number;
  /** Pending refunds on orders Montonio did not answer about — asked again next run. */
  unknown: number;
  /** Refunds Montonio answered about whose recording failed. */
  errors: number;
  /** Orders with an old enough pending refund left for the next run (limit or time). */
  left: number;
  /** Order numbers whose refund moved this run. */
  numbers: string[];
  /** Set when nothing could be asked at all. */
  skipped?: string;
}

function empty(): RefundRecheckReport {
  return { orders: 0, asked: 0, done: 0, failed: 0, pending: 0, missing: 0, unknown: 0, errors: 0, left: 0, numbers: [] };
}

function refOf(order: Order): string {
  const p = order.payment;
  if (!p || typeof p !== "object") return "";
  const ref = (p as { ref?: unknown }).ref;
  return typeof ref === "string" ? ref.trim() : "";
}

function tookBy(order: Order): string {
  const p = order.payment;
  const v = p && typeof p === "object" ? (p as { provider?: unknown }).provider : undefined;
  return typeof v === "string" ? v : "";
}

/** The refunds on this order worth asking about: pending, through the provider, old enough. */
function stale(payment: unknown, now: number, minHours: number): RefundEntry[] {
  return refundsOf(payment).filter((r) => {
    if (r.status !== "pending" || r.to === "giftcard") return false;
    const t = Date.parse(r.since || r.at);
    return Number.isFinite(t) && now - t >= minHours * 3_600_000;
  });
}

/**
 * Ask Montonio about every refund still pending after a day, and record what
 * it says through the webhook's own code. `provider`, `now`, `limit` and
 * `budgetMs` are the tests' (and the cron's) doors; production leaves
 * `provider` out and takes the configured one. Never throws.
 */
export async function recheckPendingRefunds(
  opts: { provider?: PaymentProvider | null; now?: number; limit?: number; budgetMs?: number; minHours?: number } = {},
): Promise<RefundRecheckReport> {
  const report = empty();
  const started = Date.now();
  try {
    let provider = opts.provider ?? null;
    if (!provider) {
      try {
        provider = getProvider();
      } catch {
        return { ...report, skipped: "not_configured" };
      }
    }
    if (!canAskProvider(provider)) return { ...report, skipped: "provider_cannot_ask" };

    const now = opts.now ?? Date.now();
    const limit = Math.max(1, Math.min(100, Math.trunc(opts.limit ?? REFUND_RECHECK_LIMIT)));
    const budget = Math.max(0, opts.budgetMs ?? REFUND_RECHECK_BUDGET_MS);
    const minHours = Math.max(0, opts.minHours ?? REFUND_PENDING_WATCH_HOURS);

    /* The coarse cut in SQL — the same containment test pendingRefunds()
       uses; the age is read in code, where an unreadable stamp is «not old
       enough» rather than a cast that fails the whole query. Newest orders
       first: a refund from before the reset that Montonio will never know
       (sandbox keys then, live keys now) must not take this week's slot. */
    const rows = await query<{ id: string; payment: unknown }>(
      `select id, payment from orders
        where payment -> 'refunds' @> '[{"status":"pending"}]'::jsonb
        order by created_at desc
        limit 200`,
    );
    const due = rows.filter((row) => stale(row.payment, now, minHours).length > 0);

    for (let i = 0; i < due.length; i++) {
      // a budget of 0 is «no time left in this run» — the cron's minute is spent
      if (report.orders >= limit || Date.now() - started >= budget) {
        report.left = due.length - i;
        break;
      }
      const order = await getOrder(due[i].id);
      if (!order) continue;
      const waiting = stale(order.payment, now, minHours);
      if (!waiting.length) continue; // settled by a webhook since the select
      const ref = refOf(order);
      const took = tookBy(order);
      /* Nothing to ask with, or an order another provider took — asking
         Montonio about the mock bank's id is a 404 and a log line, nothing
         more. */
      if (!ref || (took && took !== provider.name)) continue;

      report.orders += 1;
      let snapshot;
      try {
        snapshot = await provider.fetchOrder(ref);
      } catch (err) {
        // fetchOrder() is documented never to throw; one order's bad day must not stop the rest
        console.error(`[payments] refund recheck: asking about ${order.number} threw`, err);
        snapshot = null;
      }
      if (!snapshot) {
        report.unknown += waiting.length;
        continue;
      }

      for (const entry of waiting) {
        report.asked += 1;
        const theirs = snapshot.refunds.find((r) => String(r.uuid ?? "").trim() === entry.ref);
        if (!theirs) {
          report.missing += 1;
          continue;
        }
        const status = mapMontonioRefundStatus(theirs.status);
        if (status === "pending") {
          report.pending += 1;
          continue;
        }
        try {
          /* Re-read for every refund: the one before may have moved the
             order to «возврат», and the clamp is measured on what is left. */
          const current = (await getOrder(order.id)) ?? order;
          const amount = Number(theirs.amount) > 0 ? Number(theirs.amount) : entry.amount;
          const out = await recordProviderRefund(
            current,
            {
              refundRef: entry.ref,
              amount,
              status,
              detail: `сверка с Montonio · ${theirs.status || "?"}`,
            },
            "system",
          );
          if (out.refundStatus === "done") report.done += 1;
          else if (out.refundStatus === "failed") report.failed += 1;
          if (!report.numbers.includes(order.number)) report.numbers.push(order.number);
        } catch (err) {
          console.error(`[payments] refund recheck: recording ${entry.ref} on ${order.number} failed`, err);
          report.errors += 1;
        }
      }
    }
  } catch (err) {
    console.error("[payments] refund recheck failed:", err);
    return { ...report, skipped: "error" };
  }

  if (report.orders) {
    console.info(
      `[payments] refund recheck: asked ${report.asked} on ${report.orders} orders · done ${report.done}, ` +
        `failed ${report.failed}, still pending ${report.pending}, not listed ${report.missing}, ` +
        `no answer ${report.unknown}, errors ${report.errors}, left ${report.left}` +
        (report.numbers.length ? ` · ${report.numbers.join(", ")}` : ""),
    );
  }
  return report;
}
