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
 *   - everything that may happen only once per order — the gift-card redeem
 *     and the promo-code use here, the owner ping and the customer letter in
 *     the caller — hangs off the single transition into `paid`, reported as
 *     `alreadyPaid: false`.
 */

export interface OrderLike {
  id: string;
  number: string;
  status?: string | null;
  total?: number | string | null;
  payment?: unknown;
  /** Quoted at checkout, spent here — see redeemQuotedGiftCard() below. */
  discount?: number | string | null;
  discountCode?: string | null;
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
  /**
   * Spend the gift card the order was quoted against. Injected by the tests;
   * production leaves it out and gets @/lib/giftcards by dynamic import.
   */
  redeemGiftCard?(
    code: string,
    amount: number,
    orderId: string,
  ): Promise<{ ok?: boolean; error?: string } | null>;
  /**
   * Count the promo code the order was quoted against. Same story as the gift
   * card: quoted at checkout, spent here, exactly once per order.
   */
  consumePromo?(
    code: string,
    orderId: string,
    amount: number,
  ): Promise<{ ok?: boolean; error?: string; already?: boolean } | null>;
  /** Same story: the audit writer, so a failed redeem is visible to Renat. */
  writeAudit?(actor: string, action: string, payload?: unknown): Promise<unknown>;
}

export interface ApplyOutcome {
  /** The order's status after this call. */
  status: "paid" | "failed" | "unchanged";
  /** True when a later, worse status was refused because the order is paid. */
  keptPaid: boolean;
  /**
   * True when the order was ALREADY paid before this call — a webhook retry, a
   * refreshed return URL, the return and the notification racing. The caller
   * must not re-run the side effects of payment (owner ping, customer letter)
   * when this is set (audit H4). Issuing the gift cards bought in the order is
   * the one thing the caller re-runs regardless: it is idempotent, and a retry
   * is the only chance to mint them if the first pass died before the hook.
   */
  alreadyPaid: boolean;
  /**
   * Set when the order's discount code could not be settled — a gift card that
   * emptied, or a promo code that ran out of uses, between checkout and
   * payment. See the audit row (`giftcard_redeem_failed` / `promo_consume_failed`).
   */
  giftShortfall?: { code: string; amount: number; error?: string };
  payment: PaymentBlob;
}

/**
 * The gift card is spent HERE, not at checkout (audit H3).
 *
 * createOrder only quotes the discount and stores the code: a checkout that is
 * abandoned on the bank's page, or that fails, must cost the customer nothing.
 * This runs exactly once per order — on the transition into `paid` — so a
 * webhook retry cannot double-spend.
 *
 * If the card has emptied in the meantime the order stays paid: the money
 * arrived, and the shop settling a few euro with a customer by hand is a far
 * better failure than an unpaid-looking paid order. The mismatch is written to
 * admin_audit as `giftcard_redeem_failed` so Renat sees it.
 */
async function redeemQuotedGiftCard(
  order: OrderLike,
  deps: ApplyDeps,
): Promise<ApplyOutcome["giftShortfall"]> {
  const code = typeof order.discountCode === "string" ? order.discountCode.trim() : "";
  const amount = toNumber(order.discount) ?? 0;
  if (!code) return undefined;

  /* The same checkout box takes a gift card and a promo code, so the order's
     `discount_code` can be either. A promo handed to redeemGiftCard() would
     come back "not_found" and write a giftcard_redeem_failed row about a card
     that never existed — tell them apart by shape first. A free-shipping promo
     carries a discount of 0 on a free basket, so the promo branch runs on the
     code alone; only the card needs money to redeem. */
  if (await isPromoCode(code)) return consumeQuotedPromo(order, deps, code, amount);
  if (!(amount > 0)) return undefined;

  let redeem = deps.redeemGiftCard;
  if (!redeem) {
    try {
      const mod = await import("@/lib/giftcards");
      redeem = mod.redeemGiftCard as ApplyDeps["redeemGiftCard"];
    } catch (err) {
      console.error("[payments] gift cards module not available", err);
    }
  }

  let error: string | undefined = "unavailable";
  try {
    const out = redeem ? await redeem(code, amount, order.id) : null;
    if (out?.ok) return undefined;
    error = out?.error ?? error;
  } catch (err) {
    console.error(`[payments] redeemGiftCard failed on ${order.number}`, err);
    error = "exception";
  }

  const shortfall = { code, amount, error };
  try {
    const write =
      deps.writeAudit ??
      ((await import("@/lib/orders")).writeAuditSafe as ApplyDeps["writeAudit"]);
    await write?.("system", "giftcard_redeem_failed", {
      orderId: order.id,
      number: order.number,
      ...shortfall,
    });
  } catch (err) {
    console.error("[payments] giftcard_redeem_failed not audited", err);
  }
  return shortfall;
}

/**
 * `RMP-XXXX-XXXX` is a gift card; anything else the checkout accepted is a
 * promo code. Asked of src/lib/promos.ts so the shape lives in one file; if
 * that module is missing the answer is "not a promo", and the old gift-card
 * path runs exactly as before.
 */
async function isPromoCode(code: string): Promise<boolean> {
  try {
    const mod = await import("@/lib/promos");
    return !mod.looksLikeGiftCode(code);
  } catch {
    return false;
  }
}

/**
 * Count the promo code's use, once, on the paid transition.
 *
 * Failure is not fatal for the same reason the gift card's is not: the money
 * arrived. A code that ran out of uses between checkout and payment leaves the
 * order paid and an audit row `promo_consume_failed` for Renat.
 */
async function consumeQuotedPromo(
  order: OrderLike,
  deps: ApplyDeps,
  code: string,
  amount: number,
): Promise<ApplyOutcome["giftShortfall"]> {
  let consume = deps.consumePromo;
  if (!consume) {
    try {
      const mod = await import("@/lib/promos");
      consume = mod.consumePromo as ApplyDeps["consumePromo"];
    } catch (err) {
      console.error("[payments] promo codes module not available", err);
    }
  }

  let error: string | undefined = "unavailable";
  try {
    const out = consume ? await consume(code, order.id, amount) : null;
    if (out?.ok) return undefined;
    error = out?.error ?? error;
  } catch (err) {
    console.error(`[payments] consumePromo failed on ${order.number}`, err);
    error = "exception";
  }

  const shortfall = { code, amount, error };
  try {
    const write =
      deps.writeAudit ??
      ((await import("@/lib/orders")).writeAuditSafe as ApplyDeps["writeAudit"]);
    await write?.("system", "promo_consume_failed", {
      orderId: order.id,
      number: order.number,
      ...shortfall,
    });
  } catch (err) {
    console.error("[payments] promo_consume_failed not audited", err);
  }
  return shortfall;
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
    return { status: "unchanged", keptPaid: true, alreadyPaid: true, payment };
  }

  await deps.setOrderPayment(order.id, payment);

  if (result.status === "paid") {
    // Already paid: a retry, not a payment. Write the blob, touch nothing else
    // — no status change, no gift-card redeem, and the caller sends no mail
    // (H4); it only makes sure the order's own gift cards exist.
    if (wasPaid) return { status: "paid", keptPaid: false, alreadyPaid: true, payment };

    await deps.setOrderStatus(order.id, "paid", `payment:${providerName}`);
    const giftShortfall = await redeemQuotedGiftCard(order, deps);
    return { status: "paid", keptPaid: false, alreadyPaid: false, giftShortfall, payment };
  }
  if (result.status === "failed") {
    if (order.status !== "failed") {
      await deps.setOrderStatus(order.id, "failed", `payment:${providerName}`);
    }
    return { status: "failed", keptPaid: false, alreadyPaid: false, payment };
  }
  return { status: "unchanged", keptPaid: false, alreadyPaid: false, payment };
}
