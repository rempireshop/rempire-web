/**
 * Refunds Montonio has accepted but not yet paid out.
 *
 * Why this exists. `POST /refunds` answers **200 with `status: "PENDING"`** for
 * a refund it cannot fund — the refunds guide is explicit that an empty
 * settlement account produces no HTTP error at all — and the real outcome
 * arrives days later on the refund webhook as `refundStatusDescription:
 * "INSUFFICIENT_FUNDS"`. The help centre puts a clock on that:
 *
 *   «The refund will remain in this status for up to 10 days» … if the funds
 *   do not accumulate, «the refund will be canceled».
 *
 * So the worst case is a refund the panel reported as done, that the customer
 * never received, that nothing in this shop ever mentions again, and that
 * Montonio quietly cancels ten days later. `pendingRefunds()` is what makes it
 * findable: one query, read-only, admin-only, no writes and no decisions.
 *
 * The clock runs from the entry's `since` — when the refund was FIRST written
 * down. It used to run from `at`, the last thing the shop heard, and that is
 * the one stamp it cannot run on: Montonio retries an under-funded refund by
 * itself, every notice carries a fresh `at`, and «десять дней» measured that
 * way means «ten days since the last notice». A refund Montonio nudged every
 * few days could never become overdue — which is precisely the refund the flag
 * exists for. `at` is still what the panel shows as «последний ответ».
 *
 * Entries written before 19.09.2026 carry no `since` and fall back to `at`,
 * exactly as before.
 */
import { query } from "@/lib/db";
import { REFUND_PENDING_GIVEUP_DAYS, REFUND_PENDING_WATCH_HOURS } from "@/lib/montonio-problems";
import { refundsOf, type RefundEntry } from "./refund";

export interface PendingRefund {
  orderId: string;
  number: string;
  /** The provider's own id for the refund — searchable in Montonio's panel. */
  ref: string;
  amount: number;
  /** ISO stamp of the last thing we heard about it. */
  at: string;
  /** ISO stamp of when it was first recorded — what `hours` counts from. */
  since: string;
  /** Whole hours since `since`, for the panel's «висит N дней». */
  hours: number;
  /** Past Montonio's own ten days: it has given up, the money stayed here. */
  overdue: boolean;
  /** `giftcard` entries never reach Montonio and never pend — kept for shape. */
  to?: RefundEntry["to"];
  detail?: string;
}

/** Hours between `at` and now, floored; 0 for anything unreadable or future. */
function hoursSince(at: string, now: number): number {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 3_600_000));
}

/**
 * Every refund still sitting at `pending`, oldest first.
 *
 * `minHours` defaults to 0 so the caller decides what «stuck» means — the
 * readiness screen shows everything and marks what is past
 * REFUND_PENDING_WATCH_HOURS, because a refund pending for ten minutes is
 * normal and one pending for three days is not.
 *
 * The `@>` containment test is what keeps this off a full table scan on a
 * shop with a year of orders; jsonb_path/GIN indexing can follow if it ever
 * matters. `[]` — never a throw — when the database will not answer: this is
 * a warning list, and a warning list that takes the panel down is worse than
 * one that is briefly empty.
 */
export async function pendingRefunds(
  opts: { minHours?: number; limit?: number; now?: Date } = {},
): Promise<PendingRefund[]> {
  const now = (opts.now ?? new Date()).getTime();
  const minHours = Math.max(0, Number(opts.minHours ?? 0));
  const limit = Math.min(200, Math.max(1, Math.trunc(Number(opts.limit ?? 50))));

  let rows: Array<{ id: string; number: string; payment: unknown }>;
  try {
    rows = await query<{ id: string; number: string; payment: unknown }>(
      `select id, number, payment from orders
        where payment -> 'refunds' @> '[{"status":"pending"}]'::jsonb
        order by created_at desc
        limit $1`,
      [limit],
    );
  } catch (err) {
    console.error("[pending refunds] could not be read —", err);
    return [];
  }

  const out: PendingRefund[] = [];
  for (const row of rows) {
    for (const r of refundsOf(row.payment)) {
      if (r.status !== "pending") continue;
      const since = r.since || r.at;
      const hours = hoursSince(since, now);
      if (hours < minHours) continue;
      out.push({
        orderId: row.id,
        number: row.number,
        ref: r.ref,
        amount: r.amount,
        at: r.at,
        since,
        hours,
        overdue: hours >= REFUND_PENDING_GIVEUP_DAYS * 24,
        to: r.to,
        detail: r.detail,
      });
    }
  }
  out.sort((a, b) => b.hours - a.hours);
  return out;
}

/** Whether anything in the list has been waiting long enough to look at. */
export function refundsWorthLookingAt(list: PendingRefund[]): PendingRefund[] {
  return list.filter((r) => r.hours >= REFUND_PENDING_WATCH_HOURS);
}
