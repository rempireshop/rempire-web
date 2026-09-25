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
  /**
   * When this refund was FIRST written down — the clock Montonio's ten days
   * run on, and the one `at` cannot be.
   *
   * `at` is the last thing we HEARD, and a PENDING→PENDING webhook (Montonio
   * retries an under-funded refund, and every notice carries a fresh stamp)
   * moves it forward. The countdown in src/lib/payments/pending-refunds.ts was
   * therefore measuring «ten days since the last notice» rather than «ten days
   * since the refund» — a refund Montonio nudges every few days could never
   * become overdue at all, which is the one case the flag was built for.
   *
   * Set by foldRefund() the first time a `ref` is seen and never moved after
   * that. Absent on every entry written before 19.09.2026, so every reader
   * falls back to `at` the way it always did.
   */
  since?: string;
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
      since: typeof r.since === "string" && r.since ? r.since : undefined,
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

/** What a gift card paid for one order — src/lib/giftcards.ts GiftPaid. */
export interface GiftPaidOnOrder {
  code: string;
  /** The positive rows of the card's ledger for this order. Never shrinks. */
  amount: number;
}

/**
 * What each card that paid for an order is still owed — READ OFF
 * `orders.payment` AND NOTHING ELSE.
 *
 * This is the whole of the 18.09.2026 «возврат дважды» finding. The split
 * between the card and the bank used to be clamped by the CARD LEDGER's own
 * answer as well (`giftPaidByOrder().left`, gift_card_uses net of refunds),
 * on the reasoning that the smaller of two ledgers can never over-credit a
 * card. It is a sound reason and the wrong ledger, because the two are written
 * in separate transactions: creditGiftCard() commits, and the line in
 * `orders.payment` is a LATER statement. Between the two the card ledger has
 * moved and the payment blob has not — and that is exactly the state a retry
 * arrives in.
 *
 * Read from the card ledger, the retry of a 30 € card credit sees 0 € still
 * owed to the card and quietly re-splits the SAME refund as 30 € of real money
 * through Montonio, under a key derived from a sequence that has not moved
 * either. 100 € order, 100 € refunded, 130 € out.
 *
 * Read from `orders.payment`, every input the reference is derived from —
 * `refundsOf().length` for the sequence, this for the split — comes from ONE
 * blob, written in ONE statement. Either the whole refund is recorded or none
 * of it is, so a retry derives the same split, the same money key and the same
 * card ref, whatever happened in between. The card cannot be credited twice
 * because that ref is refused by the card ledger (191_gift_loyalty_once.sql),
 * and it cannot be credited past its face value either (creditGiftCard's own
 * conditional UPDATE) — the two guards that were doing the work all along.
 *
 * Per card rather than in one lump: one code per order in practice, and a
 * `giftcard` entry that names no card (nothing in this shop writes one, but
 * the ledger is jsonb and old rows are forever) comes off the tab all the
 * same, oldest card first.
 */
export function giftOwedByCard<T extends GiftPaidOnOrder>(
  paid: readonly T[],
  payment: unknown,
): Array<{ code: string; amount: number; owed: number }> {
  const byCode = new Map<string, number>();
  let loose = 0;
  for (const r of refundsOf(payment)) {
    if (r.status === "failed" || r.to !== "giftcard") continue;
    if (r.code) byCode.set(r.code, money((byCode.get(r.code) ?? 0) + r.amount));
    else loose = money(loose + r.amount);
  }
  const out = paid.map((g) => {
    const amount = money(g.amount);
    return { code: g.code, amount, owed: Math.max(0, money(amount - (byCode.get(g.code) ?? 0))) };
  });
  for (const row of out) {
    if (!(loose > 0)) break;
    const take = Math.min(row.owed, loose);
    row.owed = money(row.owed - take);
    loose = money(loose - take);
  }
  return out;
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
  /* `since` is set once and never moved again: it is the only stamp on the
     entry that a repeat notice cannot push forward, and the ten-day countdown
     has to run on it (see RefundEntry.since). Written last so that a caller
     passing `since: undefined` — every caller does, it is not theirs to set —
     cannot spread it over the one the first notice left. */
  const since = at < 0 ? entry.since || entry.at : list[at].since || list[at].at || entry.since || entry.at;
  const next =
    at < 0
      ? [...list, { ...entry, since }]
      : list.map((r, i) => (i === at ? { ...r, ...entry, since } : r));
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
 * That holds only while `amount` moves with `seq`, and until 19.09.2026 it did
 * not: the split feeding `amount` was clamped by the card ledger, which the
 * first attempt HAD already moved. Same order, same tap, different amount,
 * different ref — and on a mixed card + bank order the remainder went to
 * Montonio as real money. `amount` now comes off `orders.payment` too
 * (giftOwedByCard above), so both halves of the derivation read one blob.
 *
 * Kept behind the `gc:` prefix it has always had, so the ledger, the order
 * card and docs/payments.md § 11 go on reading the way they did.
 */
export function giftRefundRef(orderId: string, seq: number, amount: number): string {
  const h = createHash("sha256").update(`rempire-gift-refund|${orderId}|${seq}|${money(amount).toFixed(2)}`).digest("hex");
  return `gc:${h.slice(0, 32)}`;
}

/* ---------- one refund per look at the order ------------------------------
 *
 * The two keys above make a retry of ONE refund safe — the retry derives the
 * same key and the same card ref, so Montonio and the card ledger refuse the
 * copy. What they cannot do is tell a retry from a second refund once the
 * first has been written down: the sequence has moved, the next key is a new
 * key, and a new key is a new refund. That is correct for a partial refund the
 * owner really means, and it is exactly how a gift-card order paid 9 € was
 * given 8 € back from two presses of «Вернуть деньги» for 4 € (staging,
 * R-100086, 25.09.2026): the second press was answered as a second, deliberate
 * refund. The Montonio half is no different — on the sandbox it only looked
 * safe because Montonio refused every bank-link refund there.
 *
 * So the request now says which ledger it was made from: `refundsSeen`, the
 * number of refund lines the order card showed when «Вернуть деньги» was
 * opened. The route refuses a request whose count is not the ledger's own
 * (refundSeenOf, `refund_stale`) and runs at most one refund per count at a
 * time (refundIntentKey, src/lib/idempotency.ts). A double tap, a second
 * device holding the same card, a retry from a screen that never heard the
 * answer — all of them were made from the ledger BEFORE the first refund, and
 * none of them can be a second refund. A second partial refund is still one
 * tap away, from a card opened after the first: that card prints «По заказу
 * уже возвращено …» and carries the new count.
 */

/**
 * The count a request says it was made from.
 *
 * Absent is 0, not «no check»: a caller that says nothing about the ledger
 * can only make the FIRST refund of an order. Anything that is not a whole
 * number ≥ 0 is -1, which no ledger ever has — a count nobody could have seen
 * must not match by accident and let a stale card through.
 */
export function refundSeenOf(v: unknown): number {
  if (v === undefined || v === null || v === "") return 0;
  const n = typeof v === "string" ? Number(v.trim()) : typeof v === "number" ? v : NaN;
  return Number.isInteger(n) && n >= 0 ? n : -1;
}

/**
 * The inbound idempotency key for one refund intention: this order, as it
 * stood at `seen` refund lines. Server-made from the order, never from a
 * header the client could forget to send — src/lib/idempotency.ts runOnce()
 * then lets exactly one request per look at the ledger run, and answers a
 * twin that arrives while it runs with `in_progress`.
 */
export function refundIntentKey(orderId: string, seen: number): string {
  return `refund:${orderId}:${Math.max(0, Math.trunc(seen))}`;
}

/** «12,90 €» — the panel's own spelling, in all three languages. */
function eurText(n: number): string {
  const v = money(n);
  return (Number.isInteger(v) ? String(v) : v.toFixed(2).replace(".", ",")) + " €";
}

/**
 * What the owner reads when the refund he confirmed was made from an order
 * card that no longer matches the ledger — `refund_stale`. It has to say two
 * things plainly: nothing went out this time, and how to make a second refund
 * if that is what he meant. The button's name is the one his panel shows in
 * that language («Tagasta raha», «Refund» — the UI dictionaries in
 * public/shop2/app.js).
 */
export function refundStaleText(refunded: number): { RU: string; ET: string; EN: string } {
  const back = money(refunded) > 0;
  const sum = eurText(refunded);
  return {
    RU:
      (back ? "По этому заказу уже вернули " + sum + "." : "Возвраты по этому заказу изменились.") +
      " Этот возврат не отправлен — второй раз деньги не ушли." +
      " Если нужен ещё один возврат, откройте «Вернуть деньги» заново: окошко покажет, сколько осталось.",
    ET:
      (back ? "Selle tellimuse eest on juba tagastatud " + sum + "." : "Selle tellimuse tagastused on muutunud.") +
      " Seda tagastust ei saadetud — raha teist korda ei läinud." +
      " Kui on vaja veel üht tagastust, avage «Tagasta raha» uuesti: aken näitab, kui palju on jäänud.",
    EN:
      (back ? sum + " has already been refunded on this order." : "The refunds on this order have changed.") +
      " This refund was not sent — the money did not go out twice." +
      " If you need another refund, open «Refund» again: the box will show what is left.",
  };
}

/** `in_progress` — the same refund is being made right now, from another tap or another device. */
export function refundBusyText(): { RU: string; ET: string; EN: string } {
  return {
    RU: "Возврат по этому заказу уже оформляется — второй раз деньги не уйдут. Подождите минуту и откройте заказ заново.",
    ET: "Selle tellimuse tagastust juba vormistatakse — raha teist korda ei lähe. Oodake minut ja avage tellimus uuesti.",
    EN: "A refund on this order is already being made — the money will not go out twice. Wait a minute and open the order again.",
  };
}

/** True once the refunds cover the order — the moment it becomes «возврат». */
export function fullyRefunded(total: number, refunded: number): boolean {
  return num(total) > 0 ? refunded >= num(total) - 0.005 : refunded > 0;
}

/**
 * True while a refund of this order is PENDING and, once confirmed, would
 * cover the order — the state in which settleRefund() has not voided the gift
 * cards the order sold yet, but will the moment Montonio says SUCCESSFUL.
 *
 * It is settleRefund()'s own `fully` asked one step early: there the pending
 * lines are left out of the sum (a refund Montonio has only accepted voids
 * nothing), here they are counted as if they had gone through. A partial
 * refund of the goods that is still pending answers false — confirming it
 * voids nothing, so there is nothing to hold. A pending line that turns
 * `failed` drops out of refundedTotal() and the answer goes back to false by
 * itself.
 *
 * `value` is what the customer gave for the order (refundValue() in
 * src/lib/payments/settle.ts): the money plus what a gift card paid.
 * src/lib/giftcards.ts giftHoldsByOrder() is the reader.
 */
export function refundPendingInFull(value: number, payment: unknown): boolean {
  if (!refundsOf(payment).some((r) => r.status === "pending")) return false;
  return fullyRefunded(value, refundedTotal(payment));
}
