import { setOrderPayment, setOrderStatus, type Order } from "@/lib/orders";
import { applyPaymentResult, type ApplyDeps, type ApplyOutcome, type OrderLike } from "./apply";
import { issueOrderGiftCards, notifyOrderPaid } from "./mail-hook";
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
