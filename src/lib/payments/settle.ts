import { jsonbParam, query } from "@/lib/db";
import { readRefundStatusDescription } from "@/lib/montonio-problems";
import {
  claimOrderPaid,
  getOrder,
  PAID_ORDER_STATUSES,
  setOrderPayment,
  setOrderStatus,
  writeAuditSafe,
  type Order,
} from "@/lib/orders";
import { applyPaymentResult, type ApplyDeps, type ApplyOutcome, type OrderLike } from "./apply";
import { issueOrderGiftCards, notifyOrderClosed, notifyOrderPaid } from "./mail-hook";
import {
  foldRefund,
  fullyRefunded,
  refundableAmount,
  refundedTotal,
  refundsOf,
  type FoldedRefund,
  type RefundEntry,
  type RefundNotification,
  type RefundStatus,
} from "./refund";
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
    /* The move into paid is a claim, not a write (claimOrderPaid): this is the
       door the webhook and the shopper's return race through, both having read
       the order before either wrote, and only the one whose UPDATE actually
       moved the row may run the once-per-order work below — mint the cards,
       earn the points, take the stock. Every other status this door writes is
       the plain one. */
    setOrderStatus: (id, status, actor) =>
      status === "paid" ? claimOrderPaid(id, actor) : setOrderStatus(id, status, actor),
    ...deps,
  });
  if (outcome.status === "paid") {
    // wholesale/loyalty: loyaltyEarned rides along only on the first arrival
    // (undefined on a retry — settleLoyalty() in apply.ts only ever runs once
    // per order) so the confirmation e-mail can mention points earned.
    /* `payment` is what the ROW now holds, which is the caller's blob with
       this settlement's on top — setOrderPayment() merges (`||`), it does not
       replace, and the letter must see the same thing the order card does.
       Replacing it wholesale dropped every key applyPaymentResult() does not
       write: `method` above all, which the till records before it settles
       (and settleWithoutPayment below does too), and which the in-salon
       receipt is supposed to name. */
    const stored = order.payment && typeof order.payment === "object" ? (order.payment as Record<string, unknown>) : {};
    const paid = {
      ...order,
      status: "paid",
      payment: { ...stored, ...outcome.payment },
      loyaltyEarned: outcome.pointsEarned,
    };
    if (outcome.alreadyPaid) await issueOrderGiftCards(paid);
    else await notifyOrderPaid(paid);
  }
  return outcome;
}

/* ---------- money going back --------------------------------------------- */

export interface SettleRefundOutcome {
  /** False when this refund id had already been recorded — a webhook retry. */
  applied: boolean;
  /**
   * True when THIS call moved the refund to done for the first time — the
   * moment «Деньги возвращены» goes (foldRefund, RefundEntry.doneAt).
   */
  becameDone: boolean;
  /** The refund's status as the ledger now holds it — a late PENDING leaves a DONE one done. */
  refundStatus: RefundStatus;
  /** Set when the notice was a step back from a finished refund and was not applied. */
  kept?: RefundStatus;
  /** Everything sent back on this order, after folding this refund in. */
  refundedTotal: number;
  /** True once the refunds cover the order and it moved to «возврат». */
  fully: boolean;
  /** The order's status after this call. */
  status: string;
  /** The gift cards this refund actually cancelled — codes, empty on a partial. */
  voided: string[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Write the folded ledger ONLY if `orders.payment.refunds` is still the array
 * it was folded from. False — nothing written — when somebody else wrote in
 * between, and the caller folds again from a fresh read.
 *
 * jsonb equality is by value (key order, `1` vs `1.0`), so the array as this
 * process read it compares equal to what is stored for as long as nobody has
 * written. Missing and JSON `null` are the same «no refunds yet».
 */
async function writeRefundLedgerIf(orderId: string, expected: unknown, folded: FoldedRefund): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update orders
        set payment = coalesce(payment, '{}'::jsonb) || $2::jsonb, updated_at = now()
      where id = $1 and coalesce(payment -> 'refunds', 'null'::jsonb) = $3::jsonb
      returning id`,
    [
      orderId,
      jsonbParam({ refunds: folded.refunds, refundedTotal: folded.refundedTotal }),
      jsonbParam(expected === undefined ? null : expected),
    ],
  );
  return rows.length > 0;
}

function storedRefunds(payment: unknown): unknown {
  return payment && typeof payment === "object" ? (payment as { refunds?: unknown }).refunds : undefined;
}

/**
 * One refund → the order, and everything that hangs off it.
 *
 * The single door for every way money goes back — «Вернуть деньги» in the
 * admin, the provider's refund webhook (which is how a refund made inside
 * Montonio's own portal reaches this shop at all), and the nightly re-check
 * of a refund whose webhook never came (src/lib/payments/refund-recheck.ts).
 * Written to be safe when run twice, in either order, exactly like
 * settlePayment() above:
 *
 *   · the same refund id folds into the existing entry rather than adding a
 *     second one (foldRefund), so Montonio's 48-hour retry costs nothing, and
 *     a finished refund is never moved back to pending (B10);
 *   · the ledger is written only over the array it was folded from; a door
 *     that lost the race folds again from what the winner wrote. So of two
 *     arrivals of the same SUCCESSFUL, exactly one sees the refund become
 *     done — and a line written in between is never lost;
 *   · the customer's letters: «Возврат отправлен» on the first sighting of a
 *     refund that is still pending, «Деньги возвращены» on the one fold that
 *     moves it to done — the first sighting, or PENDING → SUCCESSFUL later
 *     (audit 27.09.2026, B1). Never a second time for the same refund;
 *   · the order becomes «возврат» only once the refunds that are DONE cover
 *     its total, and that move — claimed, so two doors cannot both make it —
 *     is what puts a counted shelf back (setOrderStatus).
 */
export async function settleRefund(
  order: OrderLike,
  entry: RefundEntry,
  opts: { notify?: boolean } = {},
): Promise<SettleRefundOutcome> {
  let current: OrderLike = order;
  let folded = foldRefund(current.payment, entry);
  if (UUID_RE.test(String(order.id ?? ""))) {
    for (let attempt = 1; ; attempt++) {
      if (await writeRefundLedgerIf(order.id, storedRefunds(current.payment), folded)) break;
      const fresh = await getOrder(order.id);
      if (!fresh) {
        folded = { ...folded, applied: false, becameDone: false };
        break;
      }
      current = { ...order, payment: fresh.payment, status: fresh.status };
      folded = foldRefund(current.payment, entry);
      if (attempt >= 3) {
        /* Three writers in a row got there first — or the stored array cannot
           be compared the way it was read. Write the fold made from the
           freshest read, unconditionally: what the code did before the
           comparison existed, and never worse than that. */
        console.error(`[payments/settle] refund ${entry.ref} on ${order.number}: the ledger kept moving; written anyway`);
        await setOrderPayment(order.id, { refunds: folded.refunds, refundedTotal: folded.refundedTotal });
        break;
      }
    }
  } else {
    await setOrderPayment(order.id, { refunds: folded.refunds, refundedTotal: folded.refundedTotal });
  }
  const stored = folded.entry;
  if (folded.kept) {
    console.warn(
      `[payments/settle] refund ${entry.ref} on ${order.number}: a late «${entry.status}» after «${folded.kept}» was not applied`,
    );
  }
  await writeAuditSafe(entry.by || "system", "order.refund", {
    orderId: order.id,
    number: order.number,
    ref: entry.ref,
    amount: stored.amount,
    status: stored.status,
    to: stored.to ?? "provider",
    code: stored.code,
    refundedTotal: folded.refundedTotal,
    repeat: !folded.applied,
    ...(folded.becameDone && !folded.applied ? { confirmed: true } : {}),
    ...(folded.kept ? { kept: folded.kept, refused: entry.status } : {}),
  });

  /* «Covered» is measured against what the customer gave, not against the
     money alone: an order a gift card paid for has a total of 0 and is fully
     refunded only once the card has its balance back (refundValue below). */
  const value = await refundValue(current);
  /* Measured against the money that has actually gone back, not against every
     refund on the ledger. A refund Montonio has merely accepted sits at
     PENDING until it has the balance — up to ten days, and it may then be
     CANCELED (src/lib/payments/montonio.ts) — while the move into «возврат»
     below voids the gift cards this order sold and puts its stock back, and
     nothing undoes either of those. So a pending refund still counts towards
     refundedTotal, which is what stops the same money being sent twice while
     it is in flight, and simply does not close the order yet; the
     PENDING → SUCCESSFUL webhook arrives on this same door and closes it
     then. */
  const settledBack = refundedTotal({ refunds: folded.refunds.filter((r) => r.status === "done") });
  const fully = fullyRefunded(value, settledBack);
  /* A full refund cancels the gift cards the order sold: the money is back in
     full, so whoever holds the code must not keep the value the shop has just
     handed back. Both doors — the admin card has already refused a used card
     by now (docs/payments.md § 11); a refund made in Montonio's own portal
     cannot be refused, so the card dies with whatever was left on it.

     It hangs off the refund, not off the move into «возврат» below, which is
     where it used to live (setOrderStatus in src/lib/orders.ts). An order
     cancelled first and refunded afterwards («Отменить заказ», then «Вернуть
     деньги» — the order Renat does them in) cannot make that move, and kept
     its codes live on top of the money going back while the panel told him
     they had been cancelled. Voided here, before the move: this is the call
     that knows which codes were live, and the move's own void is then the
     no-op voidGiftCards() promises.

     `fully` is the settled measure above, so a refund Montonio has merely
     accepted (PENDING) voids nothing: it has not handed the money back yet,
     and voiding a card is not undoable. The PENDING → SUCCESSFUL webhook
     comes back through this same door and voids then. */
  const voided = fully ? await voidSoldCards(order, entry.by || "system") : [];

  /* The points go back on the same door, and for the same reason the cards do.
     The reversal lives in setOrderStatus() (src/lib/orders.ts, «loyalty
     (14.09.2026)»), hanging off the move into «возврат» — the move an order
     that was CANCELLED first can never make. So «Отменить заказ» and then
     «Вернуть деньги», the order Renat actually does them in, gave the money
     back and left the ledger untouched: the customer kept the points the order
     earned and never got back the points they spent on it, at 1 point = 1 €
     (audit 18.09.2026, § 9.4). Exactly the bug the card void was moved here to
     fix, still open for the points.
     Called here AND left where it was: refundLoyaltyPoints() is idempotent per
     order and answers `already`, so the move's own call is then a no-op, the
     same shape voidGiftCards() promises just above. Best effort either way — a
     points hiccup must never stop a refund being recorded. */
  if (fully) {
    try {
      const { refundLoyaltyPoints } = await import("@/lib/loyalty");
      const back = await refundLoyaltyPoints(order.id, `возврат заказа ${order.number}`);
      if (back.ok && (back.back || back.revoked) && !back.already) {
        await writeAuditSafe(entry.by || "system", "loyalty.refunded", {
          id: order.id,
          number: order.number,
          points: back.points,
          back: back.back,
          revoked: back.revoked,
        });
      }
    } catch (err) {
      console.error("[payments/settle] returning the points of a refunded order failed:", err);
    }
  }

  let status = String(current.status ?? "");
  if (fully && (PAID_ORDER_STATUSES as readonly string[]).includes(status)) {
    /* Claimed, not written: two doors finishing the same refund in the same
       second (the webhook and the nightly re-check) both read «оплачен», and
       only the one whose UPDATE moves the row puts the shelf back. */
    const moved = await setOrderStatus(order.id, "refunded", entry.by || "system", { unless: ["refunded"] });
    status = moved?.status ?? "refunded";
  }

  /* The letter says what actually left the shop, so it waits for a refund that
     is not a failure — a rejected one is a warning for Renat, not news for the
     customer. `notify: false` is for the caller that sends its own (the admin
     route, which knows the language and the amount before this returns). */
  if (opts.notify !== false && stored.status !== "failed") {
    /* PENDING is «отправлено», not «возвращено» (the owner's decision of
       19.09.2026). Montonio answers 200 PENDING for a refund it has merely
       accepted; it can still fail for want of balance and it cancels itself
       after ten days, so that letter promises nothing and says when to worry
       — and promises a second one: «Как только деньги будут у вас, мы напишем
       ещё раз». The second is `becameDone`: the fold that first moves this
       refund to done, whichever door it arrives through — the confirming
       webhook, the nightly re-check — and on no other (audit 27.09.2026, B1).
       A refund whose FIRST answer is already done gets only this one; if the
       door that recorded it sends its own (the admin route, `notify: false`),
       the webhook that follows finds it done and writes nothing.
       A gift card is money already back on the card, never pending. */
    const kind = folded.becameDone
      ? "refunded"
      : folded.applied && stored.status === "pending"
        ? stored.to === "giftcard"
          ? "refunded"
          : "refund_sent"
        : null;
    if (kind) {
      await notifyOrderClosed(
        { ...current, status },
        stored.to === "giftcard"
          ? { kind: "refunded", amount: stored.amount, giftAmount: stored.amount, giftCode: stored.code }
          : { kind, amount: stored.amount },
      );
    }
  }

  return {
    applied: folded.applied,
    becameDone: folded.becameDone,
    refundStatus: stored.status,
    ...(folded.kept ? { kept: folded.kept } : {}),
    refundedTotal: folded.refundedTotal,
    fully,
    status,
    voided,
  };
}

/**
 * A refund the PROVIDER reports — its webhook, or its own refund list read by
 * the nightly re-check — recorded exactly the same way whichever of the two
 * brought it. The notify route and src/lib/payments/refund-recheck.ts both
 * come through here, so a refund whose SUCCESSFUL webhook was lost and is
 * found the next morning gets the same clamp, the same journal rows, the same
 * letter, stock, points and cards as if the webhook had arrived.
 *
 * `by` is who is reporting it (`webhook`, or `system` for the re-check) — the
 * journal row's actor. The entry keeps who made the refund (foldRefund).
 */
export async function recordProviderRefund(
  order: Order,
  note: Pick<RefundNotification, "refundRef" | "amount" | "status" | "detail" | "statusDescription">,
  by: string,
): Promise<SettleRefundOutcome & { amount: number }> {
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
     and explains nothing; days later the webhook arrives carrying
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
       BEFORE the settle below on purpose — the settle can throw, the webhook
       answers 503, and Montonio redelivers, and the one row that explains a
       stuck refund must survive that rather than depend on it. The cost was
       that every redelivery wrote it again (audit F19), so the owner opened a
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

  const out = await settleRefund(
    order,
    {
      ref: note.refundRef,
      amount,
      status: note.status,
      at: new Date().toISOString(),
      by,
      detail: note.detail,
    },
    // nothing left to give back under this id means nothing to write about
    { notify: amount > 0 },
  );
  return { ...out, amount };
}

/**
 * Cancel the gift cards this order sold — balance 0, `voided_at` stamped, the
 * code buys nothing any more — and say which ones actually died. Idempotent
 * (voidGiftCards only touches cards that are still live) and best effort: a
 * gift-card hiccup must never be the reason a refund goes unrecorded.
 */
async function voidSoldCards(order: OrderLike, by: string): Promise<string[]> {
  try {
    const { voidGiftCards } = await import("@/lib/giftcards");
    const cards = await voidGiftCards(order.id);
    if (!cards.length) return [];
    await writeAuditSafe(by, "giftcards.voided", { id: order.id, number: order.number, cards });
    return cards.map((c) => c.code);
  } catch (err) {
    console.error(`[payments] voiding the gift cards of ${order.number} failed:`, err);
    return [];
  }
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
  /* `held`: the order that sold the card is being refunded (giftHoldsByOrder
     in src/lib/giftcards.ts). Its own code, because «уже потрачена» would be
     untrue — the money is all still on the card, it just cannot pay yet. */
  if (!taken.ok) throw new PaymentError(taken.error === "held" ? "gift_held" : "not_covered");
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
