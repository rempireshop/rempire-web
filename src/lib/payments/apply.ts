import type { PaymentStatus, VerifyResult } from "./types";

/**
 * Turning a verified provider result into an order state change.
 *
 * Shared by the return route (the shopper came back) and the notify route (the
 * webhook arrived). They race by design — Montonio fires both, and retries the
 * webhook for 48 hours — so the rules here are written to be safe when run
 * twice, in either order:
 *
 *   - paid is a floor. Once an order is paid, nothing this code sees can take
 *     that away. A late "failed" is recorded in the payment blob for a human,
 *     never applied. (That includes Montonio's VOIDED, the rare case of a bank
 *     rejecting a settled payment; Montonio emails the merchant about those,
 *     and the admin sees the note.)
 *   - a repeat of the same status writes the same payment blob and no journal
 *     entry, so retries stay quiet.
 *   - pending never changes the order's status; it only records the attempt.
 */

export interface OrderLike {
  id: string;
  number: string;
  status?: string | null;
  total?: number | string | null;
  payment?: unknown;
}

/* A type alias, not an interface: setOrderPayment() takes a
   Record<string, unknown>, and only aliases get the implicit index signature
   that makes them assignable to one. */
export type PaymentBlob = {
  provider: string;
  ref: string;
  status: PaymentStatus;
  amount?: number;
  currency?: string;
  detail?: string;
  at: string;
  /** Set when the provider's amount disagrees with the order total. */
  amountMismatch?: { expected: number; got: number };
  /** A status the order refused to take, kept for the admin to look at. */
  rejected?: { status: PaymentStatus; at: string; detail?: string };
};

export interface ApplyDeps {
  setOrderPayment(id: string, payment: PaymentBlob): Promise<unknown>;
  /** Only ever called with the two statuses a payment can produce. */
  setOrderStatus(id: string, status: "paid" | "failed", actor: string): Promise<unknown>;
}

export interface ApplyOutcome {
  /** The order's status after this call. */
  status: "paid" | "failed" | "unchanged";
  /** True when a later, worse status was refused because the order is paid. */
  keptPaid: boolean;
  payment: PaymentBlob;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function alreadyPaid(order: OrderLike): boolean {
  if (order.status === "paid" || order.status === "shipped") return true;
  const p = order.payment;
  return (
    typeof p === "object" &&
    p !== null &&
    (p as { status?: unknown }).status === "paid"
  );
}

export async function applyPaymentResult(
  order: OrderLike,
  result: VerifyResult,
  providerName: string,
  deps: ApplyDeps,
): Promise<ApplyOutcome> {
  const now = new Date().toISOString();
  const wasPaid = alreadyPaid(order);
  const expected = toNumber(order.total);

  const payment: PaymentBlob = {
    provider: providerName,
    ref: result.providerRef || "",
    status: result.status,
    amount: result.amount,
    currency: result.currency ?? "EUR",
    detail: result.detail,
    at: now,
  };

  if (
    result.status === "paid" &&
    expected !== null &&
    typeof result.amount === "number" &&
    Math.abs(result.amount - expected) > 0.009
  ) {
    // The money did arrive — the provider's signed token says so — but not the
    // amount we asked for. Take the payment, flag the difference loudly.
    payment.amountMismatch = { expected, got: result.amount };
    console.error(
      `payment amount mismatch on ${order.number}: expected ${expected}, got ${result.amount}`,
    );
  }

  if (wasPaid && result.status !== "paid") {
    payment.status = "paid";
    payment.rejected = { status: result.status, at: now, detail: result.detail };
    await deps.setOrderPayment(order.id, payment);
    return { status: "unchanged", keptPaid: true, payment };
  }

  await deps.setOrderPayment(order.id, payment);

  if (result.status === "paid") {
    if (!wasPaid) await deps.setOrderStatus(order.id, "paid", `payment:${providerName}`);
    return { status: "paid", keptPaid: false, payment };
  }
  if (result.status === "failed") {
    if (order.status !== "failed") {
      await deps.setOrderStatus(order.id, "failed", `payment:${providerName}`);
    }
    return { status: "failed", keptPaid: false, payment };
  }
  return { status: "unchanged", keptPaid: false, payment };
}
