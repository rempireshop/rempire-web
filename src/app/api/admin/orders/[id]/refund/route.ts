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
 */
import { requireAdmin } from "@/lib/auth";
import { creditGiftCard, getGiftCard, soldCardsUsage, type SoldCardUsage } from "@/lib/giftcards";
import { getOrder, getOrderByNumber, PAID_ORDER_STATUSES, writeAuditSafe, type Order } from "@/lib/orders";
import { getProvider } from "@/lib/payments";
import { notifyOrderClosed } from "@/lib/payments/mail-hook";
import { MontonioProvider } from "@/lib/payments/montonio";
import {
  canRefund,
  giftRefundedTotal,
  giftRefundRef,
  refundableAmount,
  refundedTotal,
  refundIdempotencyKey,
  refundsOf,
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
async function refundRefusalContext(
  provider: unknown,
  providerRef: string,
): Promise<Record<string, unknown>> {
  if (!(provider instanceof MontonioProvider) || !providerRef) return {};
  try {
    const snap = await provider.fetchOrder(providerRef);
    if (!snap) return {};
    return {
      montonioStatus: snap.paymentStatus,
      availableForRefund: snap.availableForRefund,
      isRefundableType: snap.isRefundableType,
      montonioRefunds: snap.refunds.length,
    };
  } catch (err) {
    console.error("[api/admin/orders/:id/refund] refusal lookup failed:", err);
    return {};
  }
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

  let body: { amount?: unknown };
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

  /* What the order was worth to the customer — the money plus what a gift
     card paid — and what of it has already gone back, to either place. */
  let value: number;
  let giftPaid: Array<{ code: string; amount: number; left: number }>;
  let sold: SoldCardUsage[];
  try {
    [value, giftPaid, sold] = await Promise.all([refundValue(order), giftPaidOf(order), soldCardsUsage(order.id)]);
  } catch (err) {
    console.error("[api/admin/orders/:id/refund] ledger read failed:", err);
    return bad("db_unavailable", 503);
  }
  const back = refundedTotal(order.payment);
  const left = refundableAmount(value, order.payment);
  if (!(left > 0)) return bad("already_refunded", 409, { refundedTotal: back });

  const asked = body.amount === undefined || body.amount === null || body.amount === "" ? left : Number(body.amount);
  if (!Number.isFinite(asked)) return bad("bad_amount");
  const amount = money(asked);
  if (!(amount >= 0.01) || amount > left + 0.005) return bad("bad_amount", 400, { left });
  const full = amount >= left - 0.005;

  /* The cards this order sold. Voided by settleRefund() once the order is
     fully refunded — so a full refund needs every one of them untouched, and
     a partial one must stay inside the goods and the delivery. */
  const live = sold.filter((c) => !c.voidedAt);
  if (live.length) {
    const used = live.find((c) => c.used > 0.004);
    if (full && used) return bad("gift_used", 409, { code: used.code, used: used.used, amount: used.amount });
    const goodsPart = money(Math.max(0, value - giftSoldValue(order)));
    if (!full && back + amount > goodsPart + 0.005) {
      return bad("gift_whole", 409, { goodsLeft: money(Math.max(0, goodsPart - back)), left });
    }
  }

  /* The split: the card first, the provider for the rest. `left` on each card
     is the ledger's own answer (what it paid minus what already went back to
     it), and the payment blob's giftcard entries are the same fact from the
     other side — the smaller of the two is what may still go to a card, so a
     ledger the two disagree on can never credit a card twice. One card per
     order in practice (the checkout takes one code): the first with anything
     left on the order's tab is the one credited. */
  const giftPaidTotal = money(giftPaid.reduce((sum, g) => sum + g.amount, 0));
  const giftLeftTotal = Math.min(
    money(giftPaid.reduce((sum, g) => sum + g.left, 0)),
    money(giftPaidTotal - giftRefundedTotal(order.payment)),
  );
  const split = splitRefund(amount, Math.max(0, giftLeftTotal));
  const giftCard = split.gift > 0 ? giftPaid.find((g) => g.left > 0.004) : undefined;
  if (split.gift > 0 && !giftCard) return bad("bad_amount", 400, { left });

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
      return bad("gift_credit_failed", 409, { code: giftCard.code, detail: why, moneyRefunded: 0 });
    }
  }

  const payment = (order.payment ?? {}) as Record<string, unknown>;
  const providerRef = typeof payment.ref === "string" ? payment.ref.trim() : "";

  let provider;
  let moneyResult: { ref: string; amount: number; status: RefundEntry["status"]; detail?: string } | null = null;
  if (split.money > 0) {
    if (!providerRef) return bad("no_provider_ref", 409, { gift: split.gift, money: split.money });
    try {
      provider = getProvider();
    } catch (err) {
      console.error("[api/admin/orders/:id/refund] no provider:", err);
      return bad("not_configured", 503);
    }
    if (!canRefund(provider)) return bad("not_configured", 503);
    /* The order was taken by a different provider from the one configured now
       (a shop that switched, or an order settled by hand). Sending a refund
       through the wrong gateway would be a request about somebody else's id. */
    const took = typeof payment.provider === "string" ? payment.provider : "";
    if (took && took !== provider.name) return bad("not_configured", 503, { detail: took });

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
      const montonio = await refundRefusalContext(provider, providerRef);
      await writeAuditSafe("admin", "order.refund_failed", {
        orderId: order.id,
        number: order.number,
        amount: split.money,
        error: code,
        detail,
        ...montonio,
      });
      return bad(code, 502, { detail, ...montonio });
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
        return bad("gift_credit_failed", 409, { code: giftCard.code, detail: credited.error, moneyRefunded: split.money });
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
      await notifyOrderClosed(
        { ...order, status: out.status },
        {
          kind: "refunded",
          amount: refundedNow,
          giftAmount: giftBack > 0 ? giftBack : undefined,
          giftCode: giftBack > 0 && giftCard ? giftCard.code : undefined,
        },
      );
    }

    const fresh = (await getOrder(order.id)) ?? current;
    return Response.json(
      {
        ok: true,
        amount: refundedNow,
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
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    /* The money HAS left Montonio by now — this is the record of it that
       failed. Loud in the log and honest to the panel: the owner must look at
       Montonio rather than press the button again. */
    console.error("[api/admin/orders/:id/refund] recording the refund failed:", err);
    return bad("recorded_failed", 503, {
      ref: moneyResult?.ref,
      amount: moneyResult ? money(moneyResult.amount || split.money) : split.gift,
    });
  }
}
