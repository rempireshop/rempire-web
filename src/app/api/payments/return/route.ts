import { NextResponse } from "next/server";
import { getOrderByNumber, setOrderPayment, setOrderStatus } from "@/lib/orders";
import { getProvider, publicBaseUrl } from "@/lib/payments";
import { applyPaymentResult } from "@/lib/payments/apply";
import { issueOrderGiftCards, notifyOrderPaid } from "@/lib/payments/mail-hook";
import { allow, clientIp } from "@/lib/payments/ratelimit";

/**
 * GET /api/payments/return/ — where the provider sends the shopper back.
 *
 * Verifies the signed token, moves the order, and lands the shopper on the
 * receipt: /shop2/done/?n=<number>&s=paid|failed|pending.
 *
 * This is a redirect endpoint, never an error page: whatever goes wrong, the
 * shopper ends up on a screen that tells them where they stand. The webhook is
 * the authority on money — if this route cannot reach the database, the
 * notification will do the same work a moment later.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * `total` (analytics agent) rides along only on a paid receipt — it is what
 * lets the done screen's client-side `track("purchase", …)` beacon report a
 * total without app.js having to remember anything across the redirect to
 * the bank and back. It is a funnel signal only: the euro amount that
 * actually counts as revenue is written server-side, here, by
 * applyPaymentResult → src/lib/events.ts recordPurchaseEvent — see
 * db/migrations/080_events.sql for the full "which is used where".
 */
function done(base: string, number: string | null, state: string, total?: number, gift?: string) {
  const params = new URLSearchParams();
  if (number) params.set("n", number);
  params.set("s", state);
  if (total != null && Number.isFinite(total)) params.set("t", total.toFixed(2));
  /* `g` is how the receipt screen learns it can offer «Скачать подарочную
     карту (PDF)». It carries `<code>~<token>` per card, because the token is an
     HMAC the browser cannot compute (src/lib/giftcard-pdf.ts) and the receipt
     is a static page with no order of its own to ask about. Only ever on the
     buyer's own return from the bank, only for the order just paid. */
  if (gift) params.set("g", gift);
  return NextResponse.redirect(`${base}/shop2/done/?${params.toString()}`, 303);
}

/**
 * `RMP-ACDE-4679~<token>,…` for the cards this order bought — "" for an order
 * with none, and "" for anything that goes wrong. The receipt must never fail
 * to render because a gift-card lookup did.
 */
async function giftLinks(orderId: string): Promise<string> {
  try {
    const [{ orderGiftCards }, { giftPdfToken }] = await Promise.all([
      import("@/lib/giftcards"),
      import("@/lib/giftcard-pdf"),
    ]);
    const cards = await orderGiftCards(orderId);
    return cards
      .slice(0, 10)
      .map((c) => `${c.code}~${giftPdfToken(c.code)}`)
      .join(",");
  } catch (err) {
    console.error("payments/return: gift-card links unavailable", err);
    return "";
  }
}

export async function GET(req: Request) {
  return handle(req, new URL(req.url).searchParams);
}

/**
 * A provider can be configured to POST the customer back rather than GET.
 * Merge the form body into the query and run the same path, so a partner-system
 * misconfiguration is a working receipt rather than a 405 in the shopper's face.
 */
export async function POST(req: Request) {
  const params = new URL(req.url).searchParams;
  try {
    const form = await req.formData();
    for (const [k, v] of form.entries()) {
      if (typeof v === "string" && !params.has(k)) params.set(k, v);
    }
  } catch {
    /* not a form post — the query is all we have */
  }
  return handle(req, params);
}

/* A shopper comes back once or twice; a refresh loop is not a shopper. Kept
   loose enough that reloading the receipt never locks anyone out (audit H4). */
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

async function handle(req: Request, params: URLSearchParams) {
  const base = publicBaseUrl(req);

  if (!allow(`pay:return:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return done(base, params.get("n"), "pending");
  }

  let provider;
  try {
    // No provider configured ⇒ refuse: nothing signed can be verified (C1).
    provider = getProvider();
  } catch (err) {
    console.error("payments/return: no provider", err);
    return done(base, null, "failed");
  }

  let result;
  try {
    result = await provider.verifyReturn(params);
  } catch (err) {
    // A bad or missing token is either a cancelled payment or someone poking
    // at the URL. Neither deserves a stack trace on the shopper's screen.
    console.error("payments/return: token rejected", err);
    return done(base, params.get("n"), "failed");
  }

  let order;
  try {
    order = await getOrderByNumber(result.orderRef);
  } catch (err) {
    console.error("payments/return: lookup failed", err);
    // the webhook will finish the job; show the shopper what the token said
    return done(base, result.orderRef, result.status);
  }
  if (!order) return done(base, result.orderRef, "failed");

  let outcome;
  try {
    outcome = await applyPaymentResult(order, result, provider.name, {
      setOrderPayment,
      setOrderStatus,
    });
  } catch (err) {
    console.error("payments/return: apply failed", err);
    return done(base, order.number, result.status);
  }

  if (outcome.status === "paid") {
    // The confirmation e-mail must not hold up the redirect, and must not be
    // able to break it either. Only the first arrival sends it: this route and
    // the webhook race by design, and refreshing it is free (audit H4). The
    // gift cards bought in the order are made sure of on every arrival —
    // issuing is idempotent, and a paid order whose first pass died before the
    // hook has no other way of getting them.
    // wholesale/loyalty: loyaltyEarned rides along only on the first arrival
    // (undefined on a retry — settleLoyalty() in apply.ts only ever runs once
    // per order) so the confirmation e-mail can mention points earned.
    const paid = { ...order, status: "paid", payment: outcome.payment, loyaltyEarned: outcome.pointsEarned };
    if (outcome.alreadyPaid) await issueOrderGiftCards(paid);
    else await notifyOrderPaid(paid);
  }

  const state =
    outcome.keptPaid || outcome.status === "paid"
      ? "paid"
      : outcome.status === "failed"
        ? "failed"
        : result.status;
  // The cards exist by now: issueOrderGiftCards / notifyOrderPaid above are
  // awaited, and both mint before they mail.
  const gift = state === "paid" ? await giftLinks(order.id) : "";
  return done(base, order.number, state, state === "paid" ? Number(order.total) : undefined, gift);
}
