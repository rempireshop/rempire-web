/**
 * POST /api/admin/orders/<id>/refund/  { amount? }
 *
 * «Вернуть деньги» on a paid order card. Before this existed the panel could
 * only say the truth out loud — «Деньги клиенту переводятся отдельно — в банке
 * или в Montonio, не отсюда» — and Renat had to go and do it in Montonio's
 * portal, after which this shop went on showing the order as «Оплачен» for
 * ever (docs/payments.md § 11).
 *
 * `amount` is optional: without one the whole remaining amount goes back.
 * With one it must be between a cent and what is left (what the order was
 * worth minus what has already gone back), so two partial refunds can never
 * add up to more than the order was worth.
 *
 * Gift cards, both ways (Dim, 10.09.2026 — docs/payments.md § 11):
 *
 *   · an order PAID with a card: the card's part goes back onto the card as
 *     balance (src/lib/giftcards.ts creditGiftCard) and only the money part
 *     goes to the provider — card first, provider for the rest
 *     (splitRefund). So an order a card covered entirely, whose `total` is 0
 *     and which has no provider reference at all, is refundable: nothing is
 *     asked of Montonio and the card simply has its money back.
 *   · an order that BOUGHT cards: they are cancelled when the order is fully
 *     refunded (settleRefund → voidGiftCards). A card somebody has already
 *     spent part of blocks the refund — `gift_used`, with the amount — and a
 *     partial refund may only reach into the goods and the delivery, never
 *     into the cards' value: a card is refunded whole or not at all
 *     (`gift_whole`). The customer cannot keep a live 50 € card and have the
 *     50 € back.
 *
 * Everything after the provider's answer is settleRefund() — the same door the
 * refund webhook comes through, so the two cannot drift: the ledger on
 * `orders.payment`, the audit row, the move to «возврат» once the refunds
 * cover the order (which is what puts a counted shelf back and voids the cards
 * it sold), and the customer's letter, once.
 *
 * Error codes, all plain for the panel to translate into one Russian sentence:
 *   not_configured   — no Montonio keys, or a provider that cannot refund
 *   not_paid         — nothing has arrived for this order yet
 *   no_provider_ref  — money has to go to the bank but the order carries no
 *                      provider id (marked paid by hand): nothing to send it
 *                      back through
 *   already_refunded — the order is fully refunded already
 *   bad_amount       — 0, negative, or more than is left
 *   gift_used        — a card this order bought has been spent (in part)
 *   gift_whole       — a partial refund that reaches into the cards' value
 *   provider_unreachable / provider_rejected — Montonio said no
 *
 * A `provider_rejected` body carries Montonio's own words as `detail` («HTTP
 * 400 · Refund amount [30] exceeds the total amount refundable [0]») and, when
 * it can be read, what `GET /orders/:orderUuid` says right now:
 * `montonioStatus`, `availableForRefund`, `isRefundableType`. The same keys go
 * into an `order.refund_failed` audit row. The code alone is not actionable —
 * Montonio documents five distinct refusals and the panel's one sentence named
 * none of them (docs/montonio-payments-audit.md § A1).
 *
 * On top of the code, since 18.09.2026, the body carries `reason` and
 * `messages` (RU/ET/EN): each documented refusal has its own sentence saying
 * what the owner must do, and a refusal this shop has not been taught quotes
 * Montonio verbatim rather than inventing a cause — src/lib/montonio-problems.ts.
 * The panel prints `messages[<its language>]` and falls back to its own map.
 *
 * A refund that Montonio only *started* — `refundStatus: "pending"`, which is
 * what an under-funded refund looks like at the counter — says so in
 * `pendingMessages` and writes an `order.refund_pending` journal row. That
 * state used to be reported as «возврат ушёл», and it can sit for ten days
 * before Montonio cancels it (docs/montonio-untested.md, P6–P7). Both now ride
 * the `gift_credit_failed` 409 as well: the money can be in flight while the
 * card is the half that refused, and the owner must not read «карта не
 * приняла» as «ничего не ушло».
 *
 * PRESSING IT TWICE, which is the whole of the 18.09.2026 audit's F1 and F4.
 *
 * Every write this route makes is its own statement — Montonio's refund, the
 * line for it in `orders.payment`, the credit on the card, the line for THAT —
 * and the owner presses the button again whenever he is told it failed. The
 * second press is only safe while it derives the same references as the first,
 * and both derivations now read ONE ledger, `orders.payment`: the sequence
 * (refundIdempotencyKey, giftRefundRef) and the split between card and bank
 * (giftOwedByCard) move together or not at all. The card ledger is no longer
 * asked what the split should be — it had already moved when the retry read
 * it, and the answer was a re-split that sent the card's share to the bank as
 * real money. Its job is the one it does well: refusing the same `gc:` ref
 * twice (191_gift_loyalty_once.sql).
 *
 * And a refund whose answer was LOST is written down before the 502 goes back.
 * The catch block already asks `GET /orders/:orderUuid` to explain the
 * refusal, and that answer carries Montonio's own refund list; anything in it
 * this shop has no line for goes through settleRefund() as `by: "montonio"`.
 * Without that the money had left, nothing recorded it, the card offered the
 * whole amount again and the retry's refusal sent the owner to look for the
 * amount in a list that was empty because of the very failure he was retrying
 * — where a DIFFERENT amount was a second real refund. The 502 body carries
 * `recorded: [{ ref, amount, status }]` for what was written.
 *
 * AND PRESSING IT AGAIN AFTER IT WORKED (staging, 25.09.2026, R-100086).
 *
 * Everything above makes a retry of ONE refund land on the same references.
 * None of it could tell a retry from a second refund once the first was
 * written down: the sequence had moved, so the second press derived fresh
 * references — the design's own word for a deliberate partial refund — and a
 * 9 € gift-card order was given 4 € back twice. The Montonio half behaved the
 * same way; the sandbox only looked safe because Montonio refused every
 * bank-link refund there.
 *
 * So the body says which ledger the request was made from: `refundsSeen`, the
 * number of refund lines the order card showed when «Вернуть деньги» was
 * opened (absent = 0 — a caller that says nothing can only make the first).
 * A count that is not the ledger's own is `refund_stale` (409, with
 * `messages` RU/ET/EN and `refundedTotal`): nothing is asked of Montonio or
 * the card. And one request per count runs at a time — runOnce() under a key
 * made here from the order and the count (src/lib/idempotency.ts); a twin
 * that arrives while it runs is `in_progress`. Two devices holding the same
 * card used to be able to send two different sums at once, and the ledger's
 * read-modify-write then kept one line of the two while the card had been
 * credited both. A second partial refund is a card opened after the first,
 * which prints «По заказу уже возвращено …» and carries the new count.
 */
import { requireAdmin } from "@/lib/auth";
import { creditGiftCard, getGiftCard, soldCardsUsage, type SoldCardUsage } from "@/lib/giftcards";
import { fingerprintOf, runOnce, type IdempotentAnswer } from "@/lib/idempotency";
import { readRefundRefusal, refundPendingText } from "@/lib/montonio-problems";
import { getOrder, getOrderByNumber, PAID_ORDER_STATUSES, writeAuditSafe, type Order } from "@/lib/orders";
import { getProvider } from "@/lib/payments";
import { notifyOrderClosed } from "@/lib/payments/mail-hook";
import { MontonioProvider, mapMontonioRefundStatus, type MontonioOrderSnapshot } from "@/lib/payments/montonio";
import {
  canRefund,
  giftOwedByCard,
  giftRefundRef,
  refundableAmount,
  refundBusyText,
  refundedTotal,
  refundIdempotencyKey,
  refundIntentKey,
  refundSeenOf,
  refundsOf,
  refundStaleText,
  splitRefund,
  type RefundEntry,
} from "@/lib/payments/refund";
import { giftPaidOf, refundValue, settleRefund } from "@/lib/payments/settle";
import { PaymentError } from "@/lib/payments/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function bad(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, error, ...extra }, { status });
}

type Answer = IdempotentAnswer<Record<string, unknown>>;

/** The same refusal as bad(), as an answer runOnce() hands back rather than a Response. */
function no(error: string, status = 400, extra: Record<string, unknown> = {}): Answer {
  return { status, body: { ok: false, error, ...extra } };
}

/** Stored beside the intent key; never looked up by. */
const ROUTE = "POST /api/admin/orders/:id/refund";

/**
 * The ledger has moved since the card this request was made from: nothing
 * goes out, and the owner is told what is already back and how to make a
 * second refund if that is what he meant.
 */
function stale(order: Order): Answer {
  const back = refundedTotal(order.payment);
  console.warn(
    `[api/admin/orders/:id/refund] ${order.number}: a refund made from an older card was refused ` +
      `(${refundsOf(order.payment).length} lines, ${back} € back)`,
  );
  return no("refund_stale", 409, {
    refundedTotal: back,
    refunds: refundsOf(order.payment).length,
    messages: refundStaleText(back),
  });
}

function money(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * What Montonio itself says about the payment a refund was just refused for.
 *
 * `{}` for anything that is not the Montonio provider, and `{}` whenever the
 * lookup does not come back: this is an explanation, never a gate. The keys
 * ride on the 502 body and into the audit row, so the next time «Вернуть
 * деньги» is refused the answer is in the panel's own journal rather than in
 * a Vercel log nobody can open on a phone.
 */
async function refusalSnapshot(
  provider: unknown,
  providerRef: string,
): Promise<MontonioOrderSnapshot | null> {
  if (!(provider instanceof MontonioProvider) || !providerRef) return null;
  try {
    return await provider.fetchOrder(providerRef);
  } catch (err) {
    console.error("[api/admin/orders/:id/refund] refusal lookup failed:", err);
    return null;
  }
}

/** The snapshot's answer, flattened for the 502 body and the audit row. */
function refusalContext(snap: MontonioOrderSnapshot | null): Record<string, unknown> {
  if (!snap) return {};
  return {
    montonioStatus: snap.paymentStatus,
    availableForRefund: snap.availableForRefund,
    isRefundableType: snap.isRefundableType,
    montonioRefunds: snap.refunds.length,
  };
}

/**
 * Refunds Montonio HAS and this shop has never written down — recorded here,
 * in the catch block, before the 502 goes back.
 *
 * The case this exists for. `POST /refunds` is given fifteen seconds
 * (src/lib/payments/montonio.ts REQUEST_TIMEOUT_MS); the call is made, the
 * answer is lost, and the shop throws `provider_unreachable`. The money HAS
 * left. Until 19.09.2026 the catch wrote an audit row and a 502 and NO LEDGER
 * ENTRY, and everything downstream believed the refund had not happened: the
 * card offered the whole amount again, `pendingRefunds()` could not see it, no
 * letter went to the customer, and the retry — which correctly derived the
 * same key and was correctly refused — told the owner «сумма должна быть в
 * списке возвратов», where it was not. A *different* amount then derived a
 * different key off a sequence that had not moved: a second, real refund.
 *
 * The answer was already in this block. The lookup above reads
 * `GET /orders/:orderUuid`, whose `refunds` array carries every refund
 * Montonio holds for this payment with its `uuid`, `amount` and `status` — the
 * uuid being the same `ref` the refund webhook would eventually arrive with.
 * So: anything in that array we have no entry for is money that left and the
 * shop has not recorded, and it goes through settleRefund(), the one door both
 * this route and the webhook use. foldRefund() matches on `ref`, so the
 * webhook — whenever it turns up, PENDING or SUCCESSFUL — lands on this very
 * line instead of appending a twin.
 *
 * It also picks up a refund Renat made in Montonio's own portal whose webhook
 * was lost, which is the one refund this shop could never see at all. That is
 * the same fact from the same source, and the alternative is leaving it out of
 * a ledger the owner is about to be told to look at.
 *
 * Best effort and never a gate: the provider call has already failed and the
 * 502 goes back either way. A `done` refund gets the customer's letter (the
 * money really is back); a `pending` one does not — «Деньги возвращены» for
 * money Montonio has only accepted is the lie this shop spent September
 * removing.
 */
async function adoptMontonioRefunds(
  order: Order,
  snap: MontonioOrderSnapshot | null,
): Promise<Array<{ ref: string; amount: number; status: RefundEntry["status"] }>> {
  const adopted: Array<{ ref: string; amount: number; status: RefundEntry["status"] }> = [];
  if (!snap || !snap.refunds.length) return adopted;
  const at = new Date().toISOString();
  let current: Order = order;
  for (const r of snap.refunds) {
    const ref = String(r.uuid ?? "").trim();
    const amount = money(Number(r.amount) || 0);
    if (!ref || !(amount > 0)) continue;
    if (refundsOf(current.payment).some((e) => e.ref === ref)) continue;
    const status = mapMontonioRefundStatus(r.status);
    try {
      await settleRefund(
        current,
        {
          ref,
          amount,
          status,
          at,
          by: "montonio",
          detail: `Montonio уже принял этот возврат (${r.status || "?"}); записан при следующей попытке`,
        },
        { notify: status === "done" },
      );
      current = (await getOrder(order.id)) ?? current;
      adopted.push({ ref, amount, status });
    } catch (err) {
      console.error("[api/admin/orders/:id/refund] could not record Montonio's refund", ref, err);
      break;
    }
  }
  return adopted;
}

/** Whether the money for this order ever arrived — the same test the card uses. */
function settled(order: Order): boolean {
  if ((PAID_ORDER_STATUSES as readonly string[]).includes(order.status)) return true;
  const p = order.payment as { status?: unknown } | null | undefined;
  return !!p && typeof p === "object" && p.status === "paid";
}

/** What the gift lines of an order add up to — the cards it sold. */
function giftSoldValue(order: Order): number {
  return money(order.items.filter((l) => l.kind === "gift").reduce((sum, l) => sum + (Number(l.sum) || 0), 0));
}

export async function POST(req: Request, ctx: Ctx) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;

  let body: { amount?: unknown; refundsSeen?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) body = {};

  let order: Order | null;
  try {
    order = (await getOrder(id)) ?? (await getOrderByNumber(id));
  } catch (err) {
    console.error("[api/admin/orders/:id/refund] read failed:", err);
    return bad("db_unavailable", 503);
  }
  if (!order) return bad("not_found", 404);
  if (!settled(order)) return bad("not_paid", 409);
  /* «возврат» already, so there is nothing left to send back — whether the
     ledger below knows it or not. An order set to «возврат» by hand is one
     whose money «moved outside this shop» (that is what the status means, and
     the customer has already been mailed «Деньги возвращены» for the whole
     order — src/app/api/admin/orders/[id]/route.ts). Without this the payment
     blob still said `paid`, `left` was still the whole order, and the card
     would cheerfully send the money a second time, through Montonio. */
  if (order.status === "refunded") {
    return bad("already_refunded", 409, { refundedTotal: refundedTotal(order.payment) });
  }

  /* The card this request was made from must be the ledger as it stands —
     see the header, «AND PRESSING IT AGAIN AFTER IT WORKED». */
  const seen = refundSeenOf(body.refundsSeen);
  if (seen !== refundsOf(order.payment).length) {
    const refused = stale(order);
    return Response.json(refused.body, { status: refused.status });
  }

  const found: Order = order;
  let run;
  try {
    run = await runOnce(
      {
        key: refundIntentKey(found.id, seen),
        route: ROUTE,
        // the sum is the intention: the same key with another sum is another device, refused below
        fingerprint: fingerprintOf({ amount: body.amount ?? null }),
      },
      () => refundOnce(found, body),
    );
  } catch (err) {
    console.error("[api/admin/orders/:id/refund] refund failed:", err);
    return bad("db_unavailable", 503);
  }
  /* The same look at the ledger is being refunded right now — a double tap, or
     the same card open on a second device with a different sum. Nothing was
     run for this request. */
  if (run.outcome === "in_flight" || run.outcome === "mismatch") {
    return bad("in_progress", 409, { messages: refundBusyText() });
  }
  return Response.json(run.body, { status: run.status, headers: { "cache-control": "no-store" } });
}

/**
 * One refund, run at most once per look at the ledger (see POST above). Every
 * refusal is an answer, not a Response: runOnce() remembers a success and
 * releases the key on anything else, so a refused attempt can be made again
 * from the same card.
 */
async function refundOnce(seenOrder: Order, body: { amount?: unknown }): Promise<Answer> {
  /* Read again now that this request holds the key: a refund webhook (a
     refund Renat made in Montonio's portal) may have landed between the check
     in POST and the claim, and the references below are counted off this
     ledger. */
  let order: Order;
  try {
    order = (await getOrder(seenOrder.id)) ?? seenOrder;
  } catch (err) {
    console.error("[api/admin/orders/:id/refund] read failed:", err);
    return no("db_unavailable", 503);
  }
  if (refundsOf(order.payment).length !== refundsOf(seenOrder.payment).length) return stale(order);
  if (order.status === "refunded") {
    return no("already_refunded", 409, { refundedTotal: refundedTotal(order.payment) });
  }

  /* What the order was worth to the customer — the money plus what a gift
     card paid — and what of it has already gone back, to either place. */
  let value: number;
  let giftPaid: Array<{ code: string; amount: number; left: number }>;
  let sold: SoldCardUsage[];
  try {
    [value, giftPaid, sold] = await Promise.all([refundValue(order), giftPaidOf(order), soldCardsUsage(order.id)]);
  } catch (err) {
    console.error("[api/admin/orders/:id/refund] ledger read failed:", err);
    return no("db_unavailable", 503);
  }
  const back = refundedTotal(order.payment);
  const left = refundableAmount(value, order.payment);
  if (!(left > 0)) return no("already_refunded", 409, { refundedTotal: back });

  const asked = body.amount === undefined || body.amount === null || body.amount === "" ? left : Number(body.amount);
  if (!Number.isFinite(asked)) return no("bad_amount");
  const amount = money(asked);
  if (!(amount >= 0.01) || amount > left + 0.005) return no("bad_amount", 400, { left });
  const full = amount >= left - 0.005;

  /* The cards this order sold. Voided by settleRefund() once the order is
     fully refunded — so a full refund needs every one of them untouched, and
     a partial one must stay inside the goods and the delivery. */
  const live = sold.filter((c) => !c.voidedAt);
  if (live.length) {
    const used = live.find((c) => c.used > 0.004);
    if (full && used) return no("gift_used", 409, { code: used.code, used: used.used, amount: used.amount });
    const goodsPart = money(Math.max(0, value - giftSoldValue(order)));
    if (!full && back + amount > goodsPart + 0.005) {
      return no("gift_whole", 409, { goodsLeft: money(Math.max(0, goodsPart - back)), left });
    }
  }

  /* The split: the card first, the provider for the rest. What a card may
     still be handed back is what it paid for this order minus what
     `orders.payment` says has already gone back to it — the SAME blob the
     sequence below is counted from, and deliberately not the card's own
     ledger.

     Until 19.09.2026 it was the smaller of the two, on the reasoning that a
     ledger the two disagree on can never credit a card twice. The reasoning is
     sound and the ledgers are the wrong pair: creditGiftCard() commits in its
     own transaction and the line in `orders.payment` is a later statement, so
     between them the card ledger has moved and the payment blob has not. A
     retry landing in that window re-split the same refund — the card's share
     shrank by what had already been credited and the remainder went to
     Montonio as REAL MONEY under a fresh key, because `seq` had not moved
     either. 100 € = 30 € card + 70 € bank, refunded in full, the fold lost:
     130 € out (audit 18.09.2026, F1).

     One blob now feeds both halves of the derivation, so a retry asks for the
     same split whatever state the card ledger is in; the card ledger's job is
     the one it is good at — refusing the same `ref` twice
     (191_gift_loyalty_once.sql) and refusing a credit past face value.

     One card per order in practice (the checkout takes one code): the first
     with anything still owed on the order's tab is the one credited. */
  const giftOwed = giftOwedByCard(giftPaid, order.payment);
  const giftLeftTotal = money(giftOwed.reduce((sum, g) => sum + g.owed, 0));
  const split = splitRefund(amount, Math.max(0, giftLeftTotal));
  const giftCard = split.gift > 0 ? giftOwed.find((g) => g.owed > 0.004) : undefined;
  if (split.gift > 0 && !giftCard) return no("bad_amount", 400, { left });

  /* Ask the card whether it can take its share BEFORE a cent leaves the bank.
     creditGiftCard() refuses a voided card, and a card is voided the moment
     the order that SOLD it is fully refunded — including by a refund made in
     Montonio's own portal, which the `gift_used` guard above never sees. Until
     14.09.2026 that refusal arrived after provider.refundPayment() had already
     succeeded: the money half was gone, the card half could not be paid, and
     the 409 left the owner with half a refund and nothing to retry (audit
     14.09.2026). Read-only — the real credit is still the conditional UPDATE
     further down, which is what makes a double tap harmless. */
  if (giftCard && split.gift > 0) {
    const card = await getGiftCard(giftCard.code);
    const why = !card
      ? "not_found"
      : card.voidedAt
        ? "voided"
        : card.balance + split.gift > card.amount + 0.005
          ? "over_face_value"
          : null;
    if (why) {
      return no("gift_credit_failed", 409, { code: giftCard.code, detail: why, moneyRefunded: 0 });
    }
  }

  const payment = (order.payment ?? {}) as Record<string, unknown>;
  const providerRef = typeof payment.ref === "string" ? payment.ref.trim() : "";

  let provider;
  let moneyResult: { ref: string; amount: number; status: RefundEntry["status"]; detail?: string } | null = null;
  if (split.money > 0) {
    if (!providerRef) return no("no_provider_ref", 409, { gift: split.gift, money: split.money });
    try {
      provider = getProvider();
    } catch (err) {
      console.error("[api/admin/orders/:id/refund] no provider:", err);
      return no("not_configured", 503);
    }
    if (!canRefund(provider)) return no("not_configured", 503);
    /* The order was taken by a different provider from the one configured now
       (a shop that switched, or an order settled by hand). Sending a refund
       through the wrong gateway would be a request about somebody else's id. */
    const took = typeof payment.provider === "string" ? payment.provider : "";
    if (took && took !== provider.name) return no("not_configured", 503, { detail: took });

    try {
      moneyResult = await provider.refundPayment({
        providerRef,
        amount: split.money,
        currency: order.currency || "EUR",
        /* Derived from the order, never random: the whole point of the key is
           that a retry after a LOST answer — the one case where this shop
           cannot see that the money has already gone — asks Montonio about
           the refund it already made instead of making a second one. A fresh
           UUID per attempt deduplicated nothing at all (audit). */
        idempotencyKey: refundIdempotencyKey(order.id, refundsOf(order.payment).length, split.money),
        orderNumber: order.number,
      });
    } catch (err) {
      const code = err instanceof PaymentError ? err.code : "refund_failed";
      const detail = err instanceof PaymentError ? err.detail : undefined;
      console.error(
        `[api/admin/orders/:id/refund] provider refused ${order.number}: ${code}${detail ? ` · ${detail}` : ""}`,
        err,
      );
      /* Why this asks Montonio a second question after it has already said no.
         «Вернуть деньги» refused three times on 18.09.2026 and the owner was
         told to «проверьте баланс в его панели» — which, by Montonio's own
         refunds guide, is the one thing that cannot cause a refusal: a refund
         with no money behind it is answered 200 PENDING /
         INSUFFICIENT_FUNDS, never an HTTP error. The five refusals that DO
         exist are all about the request, and two of them are settings on
         Montonio's side that only GET /orders/:orderUuid can show — whether
         the funds have settled yet (`availableForRefund`) and whether refunds
         are switched on for this payment method at all (`isRefundableType`).
         Read-only, best effort, and after the fact: it cannot stop a refund
         that would have worked, and a lookup that fails changes nothing. */
      const snap = await refusalSnapshot(provider, providerRef);
      const montonio = refusalContext(snap);
      /* …and the same answer says whether the money went anyway. A refund
         Montonio holds that this shop has no line for is written down now —
         the fifteen-second timeout above is a LOST ANSWER, not a refusal, and
         a refund nobody records is one the owner is invited to make twice
         (F4). */
      const known = new Set(refundsOf(order.payment).map((e) => e.ref));
      const adopted = await adoptMontonioRefunds(order, snap);
      const inList =
        adopted.length > 0 || (snap?.refunds ?? []).some((r) => known.has(String(r.uuid ?? "").trim()));
      /* Montonio's own sentence → one of its five documented refusals → three
         sentences the owner can act on. An unrecognised refusal quotes
         Montonio rather than guessing: the whole point of this branch is that
         a confident wrong cause is worse than a foreign true one
         (src/lib/montonio-problems.ts). `inList` is what makes «сумма должна
         быть в списке возвратов» a statement about this order rather than a
         hope. Only `reason` goes into the journal — the three sentences belong
         on the screen, not in an audit row. */
      const refusal = code === "provider_rejected" ? readRefundRefusal(detail, { recorded: inList }) : null;
      await writeAuditSafe("admin", "order.refund_failed", {
        orderId: order.id,
        number: order.number,
        amount: split.money,
        error: code,
        reason: refusal?.reason,
        detail,
        ...montonio,
        ...(adopted.length ? { recorded: adopted } : {}),
      });
      return no(code, 502, {
        detail,
        ...(refusal ? { reason: refusal.reason, messages: refusal.messages } : {}),
        ...montonio,
        /* What the panel must put on the screen before the owner presses
           anything: these refunds are on the order now. */
        ...(adopted.length ? { recorded: adopted } : {}),
      });
    }
  }

  try {
    const at = new Date().toISOString();
    let current: Order = order;
    let out = { refundedTotal: back, fully: false, status: order.status as string, voided: [] as string[] };
    const voided: string[] = [];

    /* 1. the money, through the provider — recorded before the card is
          touched, because this is the half that has already happened. */
    if (moneyResult) {
      out = await settleRefund(
        current,
        {
          ref: moneyResult.ref,
          amount: money(moneyResult.amount || split.money),
          status: moneyResult.status,
          at,
          by: "admin",
          detail: moneyResult.detail,
        },
        // the letter goes below, where the amount and the language are already in hand
        { notify: false },
      );
      voided.push(...out.voided);
      current = (await getOrder(order.id)) ?? current;

      /* «Отправлено» is not «возвращено». Montonio answers 200 with
         `status: "PENDING"` for a refund it has only accepted — including the
         one case the panel used to blame out loud, a settlement account with
         nothing in it, whose real reason (`INSUFFICIENT_FUNDS`) arrives days
         later on the refund webhook. The guide gives that retry ten days and
         then cancels the refund, so a pending one that nobody looks at is
         money the customer never receives and the shop believes it has sent.
         The journal row is what makes it findable afterwards.

         Written HERE, with the entry it describes, rather than at the end of
         the happy path where it used to live: a card that refuses its share
         below returns 409 from the middle of this block, and a pending money
         half that had already gone out then left no row and no sentence at all
         (F29). The row belongs to the money, not to the route finishing. */
      if (moneyResult.status === "pending") {
        await writeAuditSafe("admin", "order.refund_pending", {
          orderId: order.id,
          number: order.number,
          amount: money(moneyResult.amount || split.money),
          ref: moneyResult.ref,
          detail: moneyResult.detail,
        });
      }
    }

    /* 2. the card's part, back onto the card. A card that cannot take it
          (voided since, or credited past its face value) is the one failure
          this route reports loudly rather than papering over: nothing was
          taken from anybody, and the owner must look at the card. */
    let giftBack = 0;
    if (giftCard && split.gift > 0) {
      /* Derived from the order and from the ledger AS IT STANDS RIGHT NOW —
         after the money half above has been recorded — so that a retry of this
         very refund lands on the same reference and a second, deliberate
         partial refund does not. It is one string doing both halves of the
         job, the same way the till sends one basket id as both its `ref` and
         its key (POST /api/admin/pos-orders): creditGiftCard() refuses to
         write it twice, so the card cannot be credited twice; and
         foldRefund() matches on it, so the retry updates the line the first
         attempt wrote instead of appending a second one to `refunds`. A fresh
         uuid per attempt, which is what stood here until 17.09.2026, did
         neither. */
      const giftRef = giftRefundRef(order.id, refundsOf(current.payment).length, split.gift);
      const credited = await creditGiftCard(giftCard.code, split.gift, order.id, { ref: giftRef });
      if (!credited.ok) {
        console.error("[api/admin/orders/:id/refund] card credit refused:", credited.error, giftCard.code);
        return no("gift_credit_failed", 409, {
          code: giftCard.code,
          detail: credited.error,
          moneyRefunded: split.money,
          /* The money half may already be on its way and merely accepted: the
             owner is being told the card refused, and must not read that as
             «ничего не ушло» (F29). */
          ...(moneyResult && moneyResult.status === "pending"
            ? { refundStatus: "pending" as const, pendingMessages: refundPendingText(0) }
            : {}),
        });
      }
      /* `already` is the retry arriving: the first attempt credited the card
         and died before it could write the line below. Not an error and not a
         second credit — the amount is the one that really went back, and the
         recording it never finished is finished here. */
      if (credited.already) {
        console.warn(`[api/admin/orders/:id/refund] card ${giftCard.code} was already credited under ${giftRef}`);
      }
      giftBack = credited.taken;
      out = await settleRefund(
        current,
        {
          ref: giftRef,
          amount: giftBack,
          status: "done",
          at,
          by: "admin",
          to: "giftcard",
          code: giftCard.code,
        },
        { notify: false },
      );
      voided.push(...out.voided);
      current = (await getOrder(order.id)) ?? current;
    }

    const refundedNow = money((moneyResult ? money(moneyResult.amount || split.money) : 0) + giftBack);
    if (!moneyResult || moneyResult.status !== "failed") {
      /* «Отправлен», not «возвращён», while Montonio has only ACCEPTED the
         money half — the owner's decision of 19.09.2026, and the same rule
         settleRefund() applies. A gift card is money already on the card, so
         a card-only refund is never pending; a MIXED one takes the pending
         wording, because the half that has not moved is the half the customer
         will be looking for on a statement. The gift lines still name the
         card and its amount inside that letter. */
      const letterKind = moneyResult && moneyResult.status === "pending" ? "refund_sent" : "refunded";
      await notifyOrderClosed(
        { ...order, status: out.status },
        {
          kind: letterKind,
          amount: refundedNow,
          giftAmount: giftBack > 0 ? giftBack : undefined,
          giftCode: giftBack > 0 && giftCard ? giftCard.code : undefined,
        },
      );
    }

    const fresh = (await getOrder(order.id)) ?? current;
    return {
      status: 200,
      body: {
        ok: true,
        amount: refundedNow,
        ...(moneyResult && moneyResult.status === "pending"
          ? { pendingMessages: refundPendingText(0) }
          : {}),
        gift: giftBack,
        money: moneyResult ? money(moneyResult.amount || split.money) : 0,
        giftCode: giftBack > 0 && giftCard ? giftCard.code : undefined,
        voided,
        refundedTotal: out.refundedTotal,
        left: refundableAmount(value, fresh.payment),
        refundStatus: moneyResult ? moneyResult.status : "done",
        fully: out.fully,
        status: out.status,
        order: fresh,
      },
    };
  } catch (err) {
    /* The money HAS left Montonio by now — this is the record of it that
       failed. Loud in the log and honest to the panel: the owner must look at
       Montonio rather than press the button again. */
    console.error("[api/admin/orders/:id/refund] recording the refund failed:", err);
    return no("recorded_failed", 503, {
      ref: moneyResult?.ref,
      amount: moneyResult ? money(moneyResult.amount || split.money) : split.gift,
    });
  }
}
