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

import { createHash } from "node:crypto";
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
  /**
   * Montonio's `refundStatusDescription`, raw — `INSUFFICIENT_FUNDS`,
   * `DECLINED`, `EXPIRED_OR_CANCELLED_CARD`, … or `null` on a refund that
   * simply worked (refunds guide § Refund status descriptions).
   *
   * Kept beside `detail` rather than buried in it because this is the ONLY
   * place the real reason for a stuck refund ever appears: the create call
   * answered 200 PENDING and said nothing. src/lib/montonio-problems.ts turns
   * it into a sentence; the raw word is what goes into the journal.
   */
  statusDescription?: string;
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
  /**
   * Where the money went back to. Absent (or `provider`) — through Montonio,
   * to the account the payment came from. `giftcard` — onto the gift card
   * that paid for the order, as balance (src/lib/giftcards.ts
   * creditGiftCard); `code` says which card. Both kinds count towards
   * refundedTotal: a refund is the customer getting their value back,
   * whichever instrument carries it.
   */
  to?: "provider" | "giftcard";
  code?: string;
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
      to: r.to === "giftcard" ? ("giftcard" as const) : undefined,
      code: typeof r.code === "string" && r.code ? r.code : undefined,
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

/** The part of refundedTotal that went back onto a gift card. */
export function giftRefundedTotal(payment: unknown): number {
  return money(
    refundsOf(payment)
      .filter((r) => r.status !== "failed" && r.to === "giftcard")
      .reduce((sum, r) => sum + r.amount, 0),
  );
}

/**
 * What is still refundable on an order worth `value`. Never below 0.
 *
 * `value` is what the customer gave for the order — `orders.total` (the money)
 * plus what a gift card paid (src/lib/payments/settle.ts refundValue()). An
 * order a card covered entirely has a total of 0 and is still worth refunding.
 */
export function refundableAmount(value: number, payment: unknown): number {
  return Math.max(0, money(num(value) - refundedTotal(payment)));
}

/**
 * How one refund of `amount` is split between the gift card that paid for
 * the order and the payment provider: the card first, the provider for the
 * rest. Original tender first is what every till does, and it is the rule
 * that never turns a gift card into cash — a customer who paid 20 € with a
 * card and 30 € by bank and asks for 10 € back gets 10 € of card balance,
 * not 10 € of somebody else's money.
 *
 * `giftLeft` is what the card paid minus what has already gone back to it.
 */
export function splitRefund(amount: number, giftLeft: number): { gift: number; money: number } {
  const total = Math.max(0, money(amount));
  const gift = money(Math.min(total, Math.max(0, money(giftLeft))));
  return { gift, money: money(total - gift) };
}

/**
 * The ledger after one refund is folded in — pure, so both doors and the tests
 * agree about what "the same refund twice" means.
 *
 * `applied` is true only the first time a `ref` is seen: that is what the
 * caller hangs the customer's letter off, exactly the way `alreadyPaid` gates
 * the confirmation letter in applyPaymentResult().
 *
 * Read-modify-write, deliberately: the whole array is written back, so an
 * admin refund and a refund webhook landing in the same instant could lose
 * one entry. `setOrderPayment()` merges top-level keys, not array elements,
 * and a jsonb array append in SQL would buy real concurrency at the cost of
 * this file being testable without a database. At three to five orders a
 * month, with a human pressing the button, the window is not the risk worth
 * paying for — the amount is checked against the remainder before the
 * provider is called either way, so the failure mode is a missing line in the
 * ledger, never money leaving twice.
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

/**
 * The idempotency key for ONE refund attempt, derived from the order rather
 * than drawn fresh.
 *
 * A random key per attempt is the same as no key at all. Montonio sends the
 * money and this shop never hears the answer — the function timed out, the
 * gateway answered 502, the phone lost its signal on the way back — nothing
 * is written to `orders.payment`, so `refundableAmount()` still says the
 * whole amount is refundable and «Вернуть деньги» is pressable again. With a
 * fresh UUID that second press is a second, undeduplicable refund: the
 * customer gets the money twice.
 *
 * Same order, same amount, same ledger → same key, so the retry asks Montonio
 * about the refund it already has and gets that one back. `seq` is how many
 * refund entries the order already carries: a refund that is RECORDED (even a
 * failed one, which frees its amount to be refunded again) moves the sequence
 * on, so refunding the same amount a second time deliberately is a different
 * key and a different refund.
 *
 * Shaped as a v4 UUID because that is what Montonio's refunds guide
 * RECOMMENDS — its exact words are «How you generate the keys is up to you but
 * we recommend using V4 UUIDs», so the shape is a courtesy and the uniqueness
 * is the contract. The key is scoped to the order on Montonio's side too: a
 * repeat comes back as `400 Order uuid […] already has a refund with same
 * idempotency key`, which is a REFUSAL rather than a replay of the first
 * refund — so that message means «the first attempt worked, reload the order»,
 * not «it failed». (docs/payments.md § 11, docs/montonio-payments-audit.md A3.)
 */
export function refundIdempotencyKey(orderId: string, seq: number, amount: number): string {
  const h = createHash("sha256").update(`rempire-refund|${orderId}|${seq}|${money(amount).toFixed(2)}`).digest("hex");
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return [h.slice(0, 8), h.slice(8, 12), `4${h.slice(13, 16)}`, `${variant}${h.slice(17, 20)}`, h.slice(20, 32)].join("-");
}

/**
 * The reference for ONE credit back onto a gift card — the card half of what
 * refundIdempotencyKey() does for the money half, and derived the same way for
 * the same reason.
 *
 * It was `gc:${randomUUID()}` until 17.09.2026, which is the same as no
 * reference at all, and it did two jobs badly at once:
 *
 *   · foldRefund() matches an incoming entry to an existing one BY REF, so a
 *     fresh uuid always appended a second line to `orders.payment.refunds`
 *     instead of landing on the one the first attempt wrote — and
 *     refundedTotal() is the sum of those lines, so an order could show more
 *     refunded than it was ever worth;
 *   · creditGiftCard() now refuses a ref it has already written
 *     (191_gift_loyalty_once.sql), and a value drawn fresh on every attempt
 *     can never be refused.
 *
 * `seq` is how many refunds the order carries AT THE MOMENT THIS CREDIT IS
 * ABOUT TO BE WRITTEN — after the money half of the same refund has been
 * recorded, if there was one. That is what makes a retry agree with the
 * attempt it is retrying: whatever killed the first attempt, the ledger it
 * left behind is the one the retry counts, so the same tap twice derives the
 * same ref, and a SECOND, deliberate partial refund of the same amount counts
 * one line further and derives a different one.
 *
 * Kept behind the `gc:` prefix it has always had, so the ledger, the order
 * card and docs/payments.md § 11 go on reading the way they did.
 */
export function giftRefundRef(orderId: string, seq: number, amount: number): string {
  const h = createHash("sha256").update(`rempire-gift-refund|${orderId}|${seq}|${money(amount).toFixed(2)}`).digest("hex");
  return `gc:${h.slice(0, 32)}`;
}

/** True once the refunds cover the order — the moment it becomes «возврат». */
export function fullyRefunded(total: number, refunded: number): boolean {
  return num(total) > 0 ? refunded >= num(total) - 0.005 : refunded > 0;
}
