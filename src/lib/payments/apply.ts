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
  /**
   * 'web' | 'pos'. A salon sale has no code box — see redeemQuotedGiftCard().
   * Absent reads as 'web', which is every order written before this mattered.
   */
  channel?: string | null;
  /* ---- wholesale/loyalty: db/migrations/100_tiers_loyalty.sql ------------ */
  /** Set only for a signed-in customer's order — see settleLoyalty() below. */
  customerId?: string | null;
  /** Goods subtotal, excluding shipping — what points are earned on. */
  subtotal?: number | string | null;
  /** Quoted at checkout by «Использовать баллы», spent here. */
  loyaltyDiscount?: number | string | null;
  /* ---- inventory: migration 090_inventory.sql ---------------------------- */
  /** The order's priced lines — what decrementStock() below walks, and what
   *  earnableSubtotal()/earnBase() below read the gift-card face values off. */
  items?: Array<{
    id: string;
    kind?: string;
    variant?: string | null;
    qty: number;
    /** line total — read by earnableSubtotal() to take the gift cards back out */
    sum?: number | string | null;
    price?: number | string | null;
    /** Set lines: the products the set was sold as — src/lib/orders.ts. */
    parts?: Array<{ id: string; variant: string; qty: number }> | null;
  }>;
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
  /**
   * A SECOND payment that arrived for an order already paid by another one —
   * the shopper paid twice. Kept beside the first payment instead of on top of
   * it; see applyPaymentResult() below.
   */
  repeat?: PaymentBlob;
};

export interface ApplyDeps {
  /** Merges into the stored blob — top-level keys only (src/lib/orders.ts). */
  setOrderPayment(id: string, payment: Record<string, unknown>): Promise<unknown>;
  /**
   * Only ever called with the two statuses a payment can produce. `unless`
   * makes the move conditional inside the UPDATE; a falsy answer means another
   * arrival won the race and this one must settle nothing.
   *
   * This one option is the whole claim mechanism: settlePayment() — the door
   * the webhook and the shopper's return race each other through — routes the
   * paid move to claimOrderPaid(), which is the same conditional UPDATE under
   * its own name. The callers that cannot race (the admin's «оплачен» button,
   * an invoice marked paid by hand) pass no `unless` and keep the
   * unconditional move.
   */
  setOrderStatus(
    id: string,
    status: "paid" | "failed",
    actor: string,
    opts?: { unless?: readonly string[] },
  ): Promise<unknown>;
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
  /**
   * The one authoritative revenue row (analytics agent, migration 080):
   * written once, right here, on the single transition into `paid` — never
   * from the browser, never blocked by an ad blocker. Injected by the tests;
   * production leaves it out and gets @/lib/events by dynamic import. Best
   * effort: a tracking row must never be the reason a payment fails to save.
   */
  recordPurchaseEvent?(order: { id: string; total?: number | string | null }): Promise<unknown>;
  /**
   * Credit points for a paid order. Injected by the tests; production leaves
   * it out and gets @/lib/loyalty by dynamic import — same story as the gift
   * card and the promo code above.
   */
  earnLoyaltyPoints?(
    customerId: string,
    orderId: string,
    paidSubtotalExclShipping: number,
  ): Promise<{ ok?: boolean; points?: number; already?: boolean } | null>;
  /** Spend the points quoted at checkout (order.loyaltyDiscount). Same story. */
  redeemLoyaltyPoints?(
    customerId: string,
    orderId: string,
    points: number,
    note?: string,
  ): Promise<{ ok?: boolean; taken?: number; already?: boolean; error?: string } | null>;
  /**
   * Take the order's product lines out of stock, once, on the paid
   * transition — inventory agent, migration 090. Injected by the tests;
   * production leaves it out and loops @/lib/inventory's move() itself (see
   * decrementStock() below). Never below 0 — move() clamps and logs, it does
   * not throw — so a stock shortfall can never be the reason a confirmed
   * payment fails to save.
   */
  decrementStock?(order: {
    id: string;
    number: string;
    items: NonNullable<OrderLike["items"]>;
  }): Promise<unknown>;
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
  /**
   * Same idea as giftShortfall, for «Использовать баллы»: the balance shrank
   * between checkout and payment (another order redeemed some in between —
   * rare), so less than the quoted amount was taken. See the audit row
   * (`loyalty_redeem_failed`).
   */
  loyaltyShortfall?: { amount: number; taken: number; error?: string };
  /**
   * Points credited to the customer on THIS transition — 0/undefined for a
   * guest order, a disabled programme, or an order worth nothing after
   * discounts. Read by the caller to put one line in the confirmation e-mail
   * (src/emails/order-confirmed.ts).
   */
  pointsEarned?: number;
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

  /* A salon sale has no code box at all. The cashier types a percent, and
     createOrder folds it into the same column as a label — «POS -15%», not a
     code (src/lib/orders.ts). Sent down the promo branch below it normalises
     to nothing (the «%» is not a code character), so every discounted sale
     wrote a `promo_consume_failed` row about a code nobody had typed. A POS
     order can carry neither a card nor a promo, so there is nothing here to
     settle either way. */
  if (order.channel === "pos") return undefined;

  /* The same checkout box takes a gift card and a promo code, so the order's
     `discount_code` can be either. A promo handed to redeemGiftCard() would
     come back "not_found" and write a giftcard_redeem_failed row about a card
     that never existed — tell them apart by shape first. A free-shipping promo
     carries a discount of 0 on a free basket, so the promo branch runs on the
     code alone; only the card needs money to redeem. */
  const kind = await codeKind(code);
  if (kind === "promo") {
    /* …but a code that took NOTHING off this order must not spend one of its
       uses. createOrder stores whatever was typed whether the quote worked or
       not (src/lib/orders.ts), so an order whose code had expired between the
       checkout and the bank, or whose basket fell under the code's floor, was
       charged full price and then burned a use of a live campaign — one fewer
       «первым двадцати» for somebody who actually gets the discount. Free
       delivery on a basket that already ships free is the one code that
       honestly discounts nothing, and it is asked for by name. */
    if (!(amount > 0) && !(await promoPaysDelivery(code))) return undefined;
    return consumeQuotedPromo(order, deps, code, amount);
  }
  /* «POS -15 %» is a LABEL, not a code: the till has no promo box, and
     src/lib/orders.ts folds the cashier's percent into `discount_code` so the
     order card and the receipt show it with no extra rendering. It matches no
     promo and no card, so settling it could only ever fail — and it did, on
     every discounted salon sale, as an English `promo_consume_failed` row in
     the owner's journal about money that was never at risk.

     This and the `channel === "pos"` line above are two answers to the same
     audit finding, kept as two because neither contains the other: the channel
     is the whole truth about a salon sale (its code is never worth reading at
     all, whatever shape it has), and the kind is the whole truth about a web
     order that arrived with something in `discount_code` that is neither a
     card nor a code. Both are plain early returns — nothing is settled twice
     by passing through both. */
  if (kind === "label") return undefined;
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
 * What is stored in `discount_code`: `RMP-XXXX-XXXX` is a gift card, anything
 * the promo rules can normalise is a promo code, and anything else is a
 * `label` — a note the shop wrote there itself, with nothing to settle.
 *
 * Asked of src/lib/promos.ts so the shapes live in one file; if that module is
 * missing the answer is "gift card", and the old path runs exactly as before.
 */
type CodeKind = "gift" | "promo" | "label";

async function codeKind(code: string): Promise<CodeKind> {
  try {
    const mod = await import("@/lib/promos");
    if (mod.looksLikeGiftCode(code)) return "gift";
    return mod.normalisePromoCode(code) ? "promo" : "label";
  } catch {
    return "gift";
  }
}

/**
 * Does this code pay for the delivery rather than for goods?
 *
 * Asked only of an order whose discount came to nothing, to tell «бесплатная
 * доставка on a basket that already ships free» — a code that worked and took
 * 0 € off — from a code that did not apply at all. When the answer cannot be
 * had (no module, no table) the old behaviour stands and the use is counted:
 * missing a use the shop already gave away is worse than counting one twice.
 */
async function promoPaysDelivery(code: string): Promise<boolean> {
  try {
    const mod = await import("@/lib/promos");
    const promo = await mod.getPromo(code);
    return promo ? promo.kind === "free_shipping" : false;
  } catch (err) {
    console.error("[payments] promo kind could not be read", err);
    return true;
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

/**
 * Loyalty points — spent and earned on the single transition into `paid`,
 * exactly like the gift card and the promo code above: quoted (or, for
 * earning, simply not yet possible) at checkout, settled here exactly once.
 * Only ever does anything for a signed-in customer's order — createOrder()
 * only ever fills in customerId when one was signed in at checkout.
 *
 * Redeeming and earning are independent: a shortfall on the redeem side (the
 * balance shrank between checkout and payment — rare) must not cancel the
 * earn, and vice versa.
 */
async function settleLoyalty(
  order: OrderLike,
  deps: ApplyDeps,
): Promise<{ shortfall?: ApplyOutcome["loyaltyShortfall"]; pointsEarned?: number }> {
  const customerId = typeof order.customerId === "string" ? order.customerId : "";
  if (!customerId) return {};

  let shortfall: ApplyOutcome["loyaltyShortfall"];
  const loyaltyDiscount = toNumber(order.loyaltyDiscount) ?? 0;
  if (loyaltyDiscount > 0) {
    let redeem = deps.redeemLoyaltyPoints;
    if (!redeem) {
      try {
        const mod = await import("@/lib/loyalty");
        redeem = mod.redeemLoyaltyPoints as ApplyDeps["redeemLoyaltyPoints"];
      } catch (err) {
        console.error("[payments] loyalty module not available", err);
      }
    }
    const points = Math.round(loyaltyDiscount);
    let taken = 0;
    let error: string | undefined = "unavailable";
    try {
      const out = redeem ? await redeem(customerId, order.id, points, `списание на заказ ${order.number}`) : null;
      taken = out?.taken ?? 0;
      if (out?.ok && taken >= points) {
        taken = points; // full redemption — nothing to report
      } else {
        error = out?.error ?? error;
      }
    } catch (err) {
      console.error(`[payments] redeemLoyaltyPoints failed on ${order.number}`, err);
      error = "exception";
    }
    if (taken < points) {
      shortfall = { amount: loyaltyDiscount, taken, error };
      try {
        const write =
          deps.writeAudit ??
          ((await import("@/lib/orders")).writeAuditSafe as ApplyDeps["writeAudit"]);
        await write?.("system", "loyalty_redeem_failed", {
          orderId: order.id,
          number: order.number,
          ...shortfall,
        });
      } catch (err) {
        console.error("[payments] loyalty_redeem_failed not audited", err);
      }
    }
  }

  let earn = deps.earnLoyaltyPoints;
  if (!earn) {
    try {
      const mod = await import("@/lib/loyalty");
      earn = mod.earnLoyaltyPoints as ApplyDeps["earnLoyaltyPoints"];
    } catch (err) {
      console.error("[payments] loyalty module not available", err);
    }
  }
  let pointsEarned: number | undefined;
  try {
    const out = earn ? await earn(customerId, order.id, earnBase(order)) : null;
    if (out?.ok && out.points) pointsEarned = out.points;
  } catch (err) {
    console.error(`[payments] earnLoyaltyPoints failed on ${order.number}`, err);
  }

  return { shortfall, pointsEarned };
}

/**
 * What the points are earned on — «the paid goods subtotal», which is what
 * LoyaltySettings.earnPct has always promised and what this passed until
 * 14.09.2026, when it passed `order.subtotal` instead. That is the goods
 * subtotal BEFORE discount and loyaltyDiscount come off (src/lib/orders.ts
 * createOrder: total = subtotal + shipping − discount − loyaltyDiscount), and
 * it prices gift-card lines at face value. Two consequences, both money:
 *
 *   · a basket paid for with points earned points back on the part the points
 *     had already paid — a discount that partly refunds itself;
 *   · a 100 € gift card earned 5 points when it was bought AND 5 more when it
 *     paid for a basket (a card is redeemed through `discount`, see
 *     codeDiscount() in src/lib/orders.ts), so the shop paid the bonus twice
 *     on one hundred euro.
 *
 * Gift-card lines are left out of the base entirely: a card is not goods, it
 * is money changing shape, and it earns where it is spent. `discount` is
 * booked against the goods — with a `free_shipping` promo (src/lib/promos.ts)
 * it really came off the delivery line, and the order row does not keep the
 * promo's kind, so such a basket earns on a few euro less than it paid. At
 * this shop's 5 % that is under half a point, and it errs towards not paying a
 * bonus that was never earned.
 *
 * The gift-card half of that sum is earnableSubtotal() above, which the audit
 * found from the other end («подарочные карты», the same day) and which is
 * unit-tested on its own; this adds what the basket did not actually pay for
 * in money. Pure arithmetic over one order row; tests/loyalty.test.ts drives
 * the whole of it through applyPaymentResult() with a stubbed
 * earnLoyaltyPoints, which is the only way it is reached in production.
 */
function earnBase(order: OrderLike): number {
  const goods = earnableSubtotal(order);
  const off = (toNumber(order.discount) ?? 0) + (toNumber(order.loyaltyDiscount) ?? 0);
  return Math.max(0, Math.round((goods - Math.max(0, off)) * 100) / 100);
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** The provider reference already stored on the order, if any. */
function storedRef(order: OrderLike): string {
  const p = order.payment;
  if (typeof p !== "object" || p === null) return "";
  const ref = (p as { ref?: unknown }).ref;
  return typeof ref === "string" ? ref.trim() : "";
}

/**
 * What this order may earn points on: its subtotal, minus the gift cards in it.
 *
 * `orders.subtotal` holds every line, gift cards included (src/lib/orders.ts),
 * so buying a 100 € card earned a hundred euro of points and then spending
 * that card on shampoo earned them all over again — the same euro twice, and a
 * card bought with a card earned on every lap at no cost at all (audit
 * 14.09.2026). The card's own purchase is worth nothing; what it buys is worth
 * exactly what any other basket of goods is worth, once.
 */
export function earnableSubtotal(order: OrderLike): number {
  const total = toNumber(order.subtotal) ?? 0;
  const items = Array.isArray(order.items) ? order.items : [];
  let gift = 0;
  for (const it of items) {
    if (!it || it.kind !== "gift") continue;
    const sum = toNumber(it.sum);
    gift += sum ?? (toNumber(it.price) ?? 0) * (toNumber(it.qty) ?? 0);
  }
  if (!(gift > 0)) return total;
  return Math.max(0, Math.round((total - gift) * 100) / 100);
}

function paymentSaysPaid(order: OrderLike): boolean {
  const p = order.payment;
  return (
    typeof p === "object" &&
    p !== null &&
    (p as { status?: unknown }).status === "paid"
  );
}

function alreadyPaid(order: OrderLike): boolean {
  // paid, and the two fulfilment steps after it (src/lib/orders.ts ORDER_STATUSES)
  if (order.status === "paid" || order.status === "shipped" || order.status === "delivered") return true;
  return paymentSaysPaid(order);
}

/**
 * The payment blob says paid and the order never moved — what a crash between
 * the two writes below leaves behind (setOrderPayment, then setOrderStatus).
 * Nothing after the status write can have run, so this order has no stock
 * taken, no gift card spent, no purchase row and no letter, and every retry
 * used to stop at `alreadyPaid` and leave it that way for ever.
 *
 * Only 'new' and 'failed': an order somebody has since cancelled or refunded
 * is not half-settled, it is finished, and a webhook Montonio is still
 * retrying must never drag it back into paid.
 */
function halfSettled(order: OrderLike): boolean {
  const s = String(order.status ?? "");
  return (s === "new" || s === "failed") && paymentSaysPaid(order);
}

/**
 * The one authoritative revenue row — see ApplyDeps.recordPurchaseEvent above
 * and db/migrations/080_events.sql. Written once, right here, on the single
 * transition into paid; never re-run on a webhook retry because the caller
 * only reaches this from the `!wasPaid` branch. Best effort, same shape as
 * the audit writer just above: a tracking row must never be the reason a
 * confirmed payment fails to save.
 */
async function recordPurchase(order: OrderLike, deps: ApplyDeps): Promise<void> {
  let record = deps.recordPurchaseEvent;
  if (!record) {
    try {
      const mod = await import("@/lib/events");
      record = mod.recordPurchaseEvent as ApplyDeps["recordPurchaseEvent"];
    } catch (err) {
      console.error("[payments] events module not available", err);
    }
  }
  try {
    await record?.({ id: order.id, total: order.total });
  } catch (err) {
    console.error(`[payments] recordPurchaseEvent failed on ${order.number}`, err);
  }
}

/**
 * Take the goods out of stock, once, on the transition into paid — inventory
 * agent, migration 090. A product line is itself; a set line («bundle:<id>»)
 * is the parts it was sold as, which the line carries (stockUnitsOf() in
 * src/lib/inventory.ts, and the same boundary the matching 'return' move
 * draws in src/lib/orders.ts setOrderStatus). A gift card moves nothing. Best
 * effort per row: one product's stock hiccup must never stop the rest of the
 * order — or the payment itself — from saving.
 */
async function decrementStock(order: OrderLike, deps: ApplyDeps): Promise<void> {
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) return;

  if (deps.decrementStock) {
    try {
      await deps.decrementStock({ id: order.id, number: order.number, items });
    } catch (err) {
      console.error(`[payments] decrementStock failed on ${order.number}`, err);
    }
    return;
  }

  let move: (input: {
    productId: string;
    variant?: string | null;
    delta: number;
    reason: string;
    ref?: string | null;
    actor?: string | null;
  }) => Promise<unknown>;
  let stockUnitsOf: (line: unknown) => Array<{ productId: string; variant: string; qty: number }>;
  try {
    const inv = await import("@/lib/inventory");
    move = inv.move as typeof move;
    stockUnitsOf = inv.stockUnitsOf as typeof stockUnitsOf;
  } catch (err) {
    console.error("[payments] inventory module not available", err);
    return;
  }
  for (const item of items) {
    for (const unit of stockUnitsOf(item)) {
      try {
        await move({
          productId: unit.productId,
          variant: unit.variant,
          delta: -unit.qty,
          reason: "sale_web",
          ref: order.number,
          actor: "system",
        });
      } catch (err) {
        console.error(`[payments] stock decrement failed on ${order.number} (${unit.productId}):`, err);
      }
    }
  }
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

  /* A SECOND payment, not a retry of the first: the order is paid and this
     token carries a different provider reference.

     With Montonio this cannot happen, and the claim that once stood here —
     «POST /api/payments/create/ will start a fresh payment … so a shopper CAN
     pay twice» — was wrong. `merchantReference` is our order number, and
     Montonio's orders guide says it «must be unique for each order of a store.
     If you use the same value for multiple orders, the existing order will be
     updated»; its help centre adds that an unpaid order is replaced and given a
     new payment URL, and that «if an order with this merchantReference has
     already been paid for, the API will throw an error». So a second create
     returns the SAME uuid, and there is no second payment to take.

     The branch stays for a provider that does not behave that way, and because
     the consequence if one ever did is the worst kind. setOrderPayment() merges
     top-level keys, so writing the blob would put this reference over the first
     one's —
     and `payment.ref` is the only id «Вернуть деньги» can send money back
     through (src/app/api/admin/orders/[id]/refund/). The payment that actually
     took the money would become unrefundable and untraceable. So the second
     one is recorded BESIDE the first, under `repeat`, and never on top of it;
     the admin order card shows a warning about it. */
  const first = wasPaid ? storedRef(order) : "";
  const isRepeat = !!first && !!payment.ref && payment.ref !== first;
  const record = (blob: PaymentBlob) =>
    deps.setOrderPayment(order.id, isRepeat ? { status: "paid", repeat: blob } : blob);

  if (wasPaid && result.status !== "paid") {
    payment.status = "paid";
    payment.rejected = { status: result.status, at: now, detail: result.detail };
    await record(payment);
    return { status: "unchanged", keptPaid: true, alreadyPaid: true, payment };
  }

  await record(payment);

  if (result.status === "paid") {
    // Already paid: a retry, not a payment. Write the blob, touch nothing else
    // — no status change, no gift-card redeem, and the caller sends no mail
    // (H4); it only makes sure the order's own gift cards exist. The one
    // exception is an order the blob calls paid while its status never moved:
    // that is a settlement that died half-way (halfSettled above), and the
    // claim below finishes it rather than leaving it stranded.
    if (wasPaid && !halfSettled(order)) return { status: "paid", keptPaid: false, alreadyPaid: true, payment };

    /* The single transition into paid, claimed rather than written, and the
       lock is the row itself: the shopper's return and the webhook race by
       design, both got here from a snapshot that said «не оплачен», and only
       the one whose UPDATE actually moved the row settles what hangs off the
       transition — otherwise the gift card is spent twice, the points are
       spent twice, the stock comes off twice and the revenue row is written
       twice, and the order's own cards go out as two sets of codes in two
       letters. The loser reports `alreadyPaid`, exactly as if it had read the
       order a moment later.

       Conditional on both doors: `unless` makes the UPDATE itself refuse an
       order that is already paid (src/lib/orders.ts setOrderStatus), and the
       production wiring in settle.ts sends this same move through
       claimOrderPaid(), which is the same conditional UPDATE under its own
       name. A dep that honours neither — a test stand-in — is the only way
       `moved` comes back for a second caller. */
    const moved = await deps.setOrderStatus(order.id, "paid", `payment:${providerName}`, {
      unless: ["paid", "shipped", "delivered"],
    });
    if (!moved) return { status: "paid", keptPaid: false, alreadyPaid: true, payment };

    const giftShortfall = await redeemQuotedGiftCard(order, deps);
    const loyalty = await settleLoyalty(order, deps);
    await recordPurchase(order, deps);
    await decrementStock(order, deps);
    return {
      status: "paid",
      keptPaid: false,
      alreadyPaid: false,
      giftShortfall,
      loyaltyShortfall: loyalty.shortfall,
      pointsEarned: loyalty.pointsEarned,
      payment,
    };
  }
  if (result.status === "failed") {
    /* A finished order is not an unpaid one. Montonio's ABANDONED/EXPIRED
       ticket for an order the owner (or the unpaid cron) has since cancelled
       used to move it to `failed` — and `failed` is one of the two statuses
       the unpaid loop selects (src/lib/flows.ts UNPAID_STATUSES), so the shop
       then wrote «Заказ ждёт оплаты» to a customer it had already told the
       order was cancelled, and the order came back to life on the card as
       «не оплачен». The token is kept on the payment blob either way — the
       record of what the bank said is not the same thing as the order's own
       state. (A refunded order never reaches this line: its blob says paid,
       so the `wasPaid` branch above holds it.) */
    if (order.status === "cancelled" || order.status === "refunded") {
      return { status: "unchanged", keptPaid: false, alreadyPaid: false, payment };
    }
    if (order.status !== "failed") {
      await deps.setOrderStatus(order.id, "failed", `payment:${providerName}`);
    }
    return { status: "failed", keptPaid: false, alreadyPaid: false, payment };
  }
  return { status: "unchanged", keptPaid: false, alreadyPaid: false, payment };
}
