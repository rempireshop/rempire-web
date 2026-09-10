import {
  PAID_ORDER_STATUSES,
  setOrderPayment,
  setOrderStatus,
  writeAuditSafe,
  type Order,
} from "@/lib/orders";
import { applyPaymentResult, type ApplyDeps, type ApplyOutcome, type OrderLike } from "./apply";
import { issueOrderGiftCards, notifyOrderClosed, notifyOrderPaid } from "./mail-hook";
import { foldRefund, fullyRefunded, type RefundEntry } from "./refund";
import { PaymentError, type VerifyResult } from "./types";

/**
 * A verified result → the order, plus everything that hangs off the single
 * transition into paid.
 *
 * applyPaymentResult() moves the order and settles what the customer spent
 * (gift card, points, promo), records the purchase and takes the stock; the
 * mail hook sends the letter and the owner's ping — on the first arrival
 * only — and mints the order's own gift cards on every arrival (idempotent,
 * and the one thing a retry must still do; audit H4). Three callers used to
 * spell those two steps out by hand: the webhook, the shopper's return and
 * an order with nothing left to pay (settleWithoutPayment below). Now they
 * share this one door, so none of them can drift.
 */
export async function settlePayment(
  order: OrderLike,
  result: VerifyResult,
  providerName: string,
  deps: Partial<ApplyDeps> = {},
): Promise<ApplyOutcome> {
  const outcome = await applyPaymentResult(order, result, providerName, {
    setOrderPayment,
    setOrderStatus,
    ...deps,
  });
  if (outcome.status === "paid") {
    // wholesale/loyalty: loyaltyEarned rides along only on the first arrival
    // (undefined on a retry — settleLoyalty() in apply.ts only ever runs once
    // per order) so the confirmation e-mail can mention points earned.
    const paid = { ...order, status: "paid", payment: outcome.payment, loyaltyEarned: outcome.pointsEarned };
    if (outcome.alreadyPaid) await issueOrderGiftCards(paid);
    else await notifyOrderPaid(paid);
  }
  return outcome;
}

/* ---------- money going back --------------------------------------------- */

export interface SettleRefundOutcome {
  /** False when this refund id had already been recorded — a webhook retry. */
  applied: boolean;
  /** Everything sent back on this order, after folding this refund in. */
  refundedTotal: number;
  /** True once the refunds cover the order and it moved to «возврат». */
  fully: boolean;
  /** The order's status after this call. */
  status: string;
}

/**
 * One refund → the order, and everything that hangs off it.
 *
 * The single door for both ways money goes back — «Вернуть деньги» in the
 * admin and the provider's refund webhook (which is how a refund made inside
 * Montonio's own portal reaches this shop at all). Written to be safe when run
 * twice, in either order, exactly like settlePayment() above:
 *
 *   · the same refund id folds into the existing entry rather than adding a
 *     second one (foldRefund), so Montonio's 48-hour retry costs nothing;
 *   · the customer's letter goes out on the first arrival only — a PENDING
 *     that later turns SUCCESSFUL updates the ledger and writes no second
 *     letter, the same rule `alreadyPaid` draws for the confirmation;
 *   · the order becomes «возврат» only once the refunds cover its total, and
 *     that move is what puts a counted shelf back (setOrderStatus).
 */
export async function settleRefund(
  order: OrderLike,
  entry: RefundEntry,
  opts: { notify?: boolean } = {},
): Promise<SettleRefundOutcome> {
  const folded = foldRefund(order.payment, entry);
  await setOrderPayment(order.id, {
    refunds: folded.refunds,
    refundedTotal: folded.refundedTotal,
  });
  await writeAuditSafe(entry.by || "system", "order.refund", {
    orderId: order.id,
    number: order.number,
    ref: entry.ref,
    amount: entry.amount,
    status: entry.status,
    to: entry.to ?? "provider",
    code: entry.code,
    refundedTotal: folded.refundedTotal,
    repeat: !folded.applied,
  });

  /* «Covered» is measured against what the customer gave, not against the
     money alone: an order a gift card paid for has a total of 0 and is fully
     refunded only once the card has its balance back (refundValue below). */
  const value = await refundValue(order);
  const fully = entry.status !== "failed" && fullyRefunded(value, folded.refundedTotal);
  /* The move into «возврат» is also what cancels the gift cards the order
     sold (setOrderStatus in src/lib/orders.ts): the money is back in full, so
     whoever holds the code must not keep the value the shop has just handed
     back. Both doors — the admin card has already refused a used card by now
     (docs/payments.md § 11); a refund made in Montonio's own portal cannot be
     refused, so the card dies with whatever was left on it. */
  let status = String(order.status ?? "");
  if (fully && (PAID_ORDER_STATUSES as readonly string[]).includes(status)) {
    const moved = await setOrderStatus(order.id, "refunded", entry.by || "system");
    status = moved?.status ?? "refunded";
  }

  /* The letter says what actually left the shop, so it waits for a refund that
     is not a failure — a rejected one is a warning for Renat, not news for the
     customer. `notify: false` is for the caller that sends its own (the admin
     route, which knows the language and the amount before this returns). */
  if (opts.notify !== false && folded.applied && entry.status !== "failed") {
    await notifyOrderClosed(
      { ...order, status },
      entry.to === "giftcard"
        ? { kind: "refunded", amount: entry.amount, giftAmount: entry.amount, giftCode: entry.code }
        : { kind: "refunded", amount: entry.amount },
    );
  }

  return { applied: folded.applied, refundedTotal: folded.refundedTotal, fully, status };
}

/**
 * What the customer gave for the order — the money (`orders.total`) plus what
 * a gift card paid. The amount a refund is measured against, on both doors
 * and on the order card; it does not shrink as refunds are made.
 *
 * Read off the card ledger (gift_card_uses, src/lib/giftcards.ts
 * giftPaidByOrder), never off `orders.discount`: a card that emptied between
 * the quote and the payment paid nothing, and there is nothing to return to
 * it. Best effort — with no gift-card module the value is the money.
 */
export async function refundValue(order: OrderLike): Promise<number> {
  const total = Number(order.total) || 0;
  const gift = (await giftPaidOf(order)).reduce((sum, g) => sum + g.amount, 0);
  return Math.round((total + gift + Number.EPSILON) * 100) / 100;
}

/** What gift cards paid for this order, and what of it may still go back to them. */
export async function giftPaidOf(order: OrderLike): Promise<Array<{ code: string; amount: number; left: number }>> {
  try {
    const { giftPaidByOrder } = await import("@/lib/giftcards");
    return await giftPaidByOrder(order.id);
  } catch (err) {
    console.error(`[payments] gift-card ledger unavailable for ${order.number}:`, err);
    return [];
  }
}

/** What paid for an order whose total came to 0 — for the order card. */
export type CoveredBy = "giftcard" | "points" | "promo" | "none";

export interface Coverage {
  method: CoveredBy;
  detail: string;
  /** The gift card and the euro it was quoted for, when one covered the order. */
  gift?: { code: string; amount: number };
  /** Whole points quoted at checkout, when «Использовать баллы» was on. */
  points: number;
}

/**
 * Which instrument covered a zero-total order, and a plain sentence for the
 * order journal. The gift card and the promo share `discount_code`; the card
 * is told apart by its shape (src/lib/promos.ts looksLikeGiftCode). When more
 * than one paid, the card is the method — it is money the customer had
 * already paid for — and the sentence names all of them.
 */
export async function coveredBy(order: Order): Promise<Coverage> {
  const code = typeof order.discountCode === "string" ? order.discountCode.trim() : "";
  const discount = Number(order.discount) || 0;
  let isGift = false;
  if (code && discount > 0) {
    try {
      isGift = (await import("@/lib/promos")).looksLikeGiftCode(code);
    } catch {
      isGift = /^RMP-/i.test(code);
    }
  }
  const gift = !!code && discount > 0 && isGift;
  const promo = !!code && discount > 0 && !isGift;
  const points = Math.round(Number(order.loyaltyDiscount) || 0);

  const parts: string[] = [];
  if (gift) parts.push("подарочной картой");
  if (points > 0) parts.push("баллами");
  if (promo) parts.push("промокодом");
  return {
    method: gift ? "giftcard" : points > 0 ? "points" : promo ? "promo" : "none",
    detail: parts.length ? `оплачено ${parts.join(" и ")}` : "к оплате 0 €",
    gift: gift ? { code, amount: discount } : undefined,
    points: points > 0 ? points : 0,
  };
}

/**
 * Take the money before saying "paid" — the one place this order differs
 * from a provider's ticket.
 *
 * Behind a bank payment, a gift card that emptied between the quote and the
 * webhook costs the shop a few euro and leaves an audit row (apply.ts,
 * `giftcard_redeem_failed`): the bank's money did arrive. Here nothing
 * arrives at all, so the same card applied in two tabs to two baskets would
 * have paid for both — the second one for free. The card is therefore
 * charged first, atomically (redeemGiftCard()'s conditional UPDATE), and a
 * refusal stops the order before anything else happens; the settle that
 * follows is told the card is already taken. Points are checked against the
 * live balance the same way — the ledger write itself is idempotent per
 * order, so apply.ts may take them again without taking them twice. A promo
 * that ran out of uses in between is left to apply.ts as before: the
 * discount is small, the audit row says so, and the order was honestly
 * quoted.
 */
async function takeCoverage(order: Order, cover: Coverage): Promise<Partial<ApplyDeps>> {
  if (cover.points > 0 && order.customerId) {
    const { getLoyaltyBalance } = await import("@/lib/loyalty");
    if ((await getLoyaltyBalance(order.customerId)) < cover.points) throw new PaymentError("not_covered");
  }
  if (!cover.gift) return {};
  const { redeemGiftCard } = await import("@/lib/giftcards");
  const taken = await redeemGiftCard(cover.gift.code, cover.gift.amount, order.id);
  if (!taken.ok) throw new PaymentError("not_covered");
  // already charged — apply.ts must not charge it a second time
  return { redeemGiftCard: async () => ({ ok: true }) };
}

/**
 * An order with nothing left to pay — a gift card, points or a promo covered
 * all of it — is settled here, without a provider.
 *
 * Until 06.09.2026 such an order was refused (`bad_amount`) and the checkout
 * said «Оплата пока недоступна» to a customer holding a 50 € card and a 32 €
 * basket. There is no money to collect, so the order takes exactly the same
 * paid transition a provider's ticket would — through settlePayment(), once:
 * the card is charged what it was quoted (a 50 € card paying 32 € keeps 18),
 * the points are taken, the promo's use is counted, the letter goes out —
 * and the shopper lands on the same receipt.
 *
 * The blob says `provider: "none"` and `method: giftcard | points | promo`
 * so the admin order card shows what paid, rather than the radio the shopper
 * happened to leave selected. The caller has already checked the order is
 * open and its total is 0. What IS re-checked is that the card and the
 * points still cover it — takeCoverage() above — and a `not_covered`
 * PaymentError leaves the order exactly as it was.
 */
export async function settleWithoutPayment(order: Order): Promise<ApplyOutcome> {
  const cover = await coveredBy(order);
  const deps = await takeCoverage(order, cover);
  const at = new Date().toISOString();
  // recorded first, like the provider path: the method survives the merge
  // applyPaymentResult() writes on top (setOrderPayment() is `||`, not `=`)
  await setOrderPayment(order.id, { method: cover.method, bank: null, at });
  return settlePayment(
    order,
    {
      orderRef: order.number,
      status: "paid",
      providerRef: "",
      amount: 0,
      currency: order.currency || "EUR",
      detail: cover.detail,
    },
    "none",
    deps,
  );
}
