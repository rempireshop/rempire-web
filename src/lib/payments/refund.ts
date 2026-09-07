/**
 * Money going back — the shop's refund port, and the ledger it keeps.
 *
 * Until 07.09.2026 a refund was something that happened *elsewhere*: Renat
 * pressed a button in Montonio's own portal, Montonio sent us a refund webhook
 * that we answered 200 and threw away, and the order in this shop went on
 * reading «Оплачен» for ever. Two doors are open now, and both come through
 * this file:
 *
 *   · «Вернуть деньги» on the paid order card — POST /api/admin/orders/<id>/
 *     refund/ asks the provider for the money back and records what it said;
 *   · the provider's refund webhook — including a refund Renat made in
 *     Montonio's portal, which is the case this shop could not see at all.
 *
 * The rules, in one place because both doors must agree:
 *   · a refund is identified by the provider's own id (`ref`). The same id
 *     arriving twice updates the entry — PENDING → SUCCESSFUL — and never
 *     adds the amount a second time. Montonio retries a webhook for 48 hours;
 *     this is what makes that free.
 *   · `refundedTotal` is the sum of every entry that has not failed. A
 *     rejected or cancelled refund is money that stayed in the shop, so it
 *     frees the amount up to be refunded again.
 *   · an order is «возврат» once the refunds cover its total. A smaller one
 *     leaves the order where it is: we do not know which items came back, so
 *     putting the whole order's stock on the shelf would be a lie (see
 *     setOrderStatus() in src/lib/orders.ts, which does exactly that on the
 *     move into `refunded`).
 *   · a refund the provider later rejects does NOT move the order back. It is
 *     recorded, audited and shown on the order card with a warning — the same
 *     shape as `payment.rejected` for a payment the bank took back. Something
 *     a human must look at is never something this code decides alone.
 */

import type { PaymentProvider } from "./types";

/** Montonio's five refund states, boiled down to three outcomes. */
export type RefundStatus = "pending" | "done" | "failed";

export interface RefundResult {
  /** The provider's own id for this refund — `uuid` at Montonio. */
  ref: string;
  amount: number;
  status: RefundStatus;
  currency?: string;
  /** Free-form provider detail for the order journal. */
  detail?: string;
}

export interface RefundRequest {
  /** The provider's id for the *payment* — `orders.payment.ref`. */
  providerRef: string;
  amount: number;
  currency?: string;
  /** One per attempt; the provider must not charge the same key twice. */
  idempotencyKey: string;
  /** Our own order number, for the provider's logs where it takes one. */
  orderNumber?: string;
}

/** A refund webhook, verified. Note it names the order by the PROVIDER's id. */
export interface RefundNotification {
  refundRef: string;
  /** Montonio's `orderUuid` — matches `orders.payment.ref`, not our number. */
  providerOrderRef: string;
  status: RefundStatus;
  amount: number;
  detail?: string;
}

/** A provider that can send money back. Montonio and the mock bank can. */
export interface RefundingProvider extends PaymentProvider {
  refundPayment(req: RefundRequest): Promise<RefundResult>;
  verifyRefundNotification(req: Request): Promise<RefundNotification>;
}

export function canRefund(p: PaymentProvider | null | undefined): p is RefundingProvider {
  return (
    !!p &&
    typeof (p as RefundingProvider).refundPayment === "function" &&
    typeof (p as RefundingProvider).verifyRefundNotification === "function"
  );
}

/* ---------- the ledger on orders.payment --------------------------------- */

export interface RefundEntry {
  ref: string;
  amount: number;
  status: RefundStatus;
  /** ISO timestamp of the last thing we heard about this refund. */
  at: string;
  /** `admin` for the order card, `webhook` for one made in Montonio's portal. */
  by?: string;
  detail?: string;
}

function money(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

function refundStatus(v: unknown): RefundStatus {
  return v === "done" || v === "failed" ? v : "pending";
}

/** Every refund recorded on an order, oldest first. Never throws. */
export function refundsOf(payment: unknown): RefundEntry[] {
  const raw = (payment as { refunds?: unknown } | null | undefined)?.refunds;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r))
    .map((r) => ({
      ref: String(r.ref ?? ""),
      amount: money(num(r.amount)),
      status: refundStatus(r.status),
      at: typeof r.at === "string" ? r.at : "",
      by: typeof r.by === "string" ? r.by : undefined,
      detail: typeof r.detail === "string" ? r.detail : undefined,
    }))
    .filter((r) => !!r.ref);
}

/** What has actually gone back — a rejected refund is not money that left. */
export function refundedTotal(payment: unknown): number {
  return money(
    refundsOf(payment)
      .filter((r) => r.status !== "failed")
      .reduce((sum, r) => sum + r.amount, 0),
  );
}

/** What is still refundable on an order of `total`. Never below 0. */
export function refundableAmount(total: number, payment: unknown): number {
  return Math.max(0, money(num(total) - refundedTotal(payment)));
}

/**
 * The ledger after one refund is folded in — pure, so both doors and the tests
 * agree about what "the same refund twice" means.
 *
 * `applied` is true only the first time a `ref` is seen: that is what the
 * caller hangs the customer's letter off, exactly the way `alreadyPaid` gates
 * the confirmation letter in applyPaymentResult().
 */
export function foldRefund(
  payment: unknown,
  entry: RefundEntry,
): { refunds: RefundEntry[]; refundedTotal: number; applied: boolean } {
  const list = refundsOf(payment);
  const at = list.findIndex((r) => r.ref === entry.ref);
  const next = at < 0 ? [...list, entry] : list.map((r, i) => (i === at ? { ...r, ...entry } : r));
  const folded = { refunds: next, refundedTotal: refundedTotal({ refunds: next }), applied: at < 0 };
  return folded;
}

/** True once the refunds cover the order — the moment it becomes «возврат». */
export function fullyRefunded(total: number, refunded: number): boolean {
  return num(total) > 0 ? refunded >= num(total) - 0.005 : refunded > 0;
}
