import { NextResponse } from "next/server";
import { getOrderByNumber } from "@/lib/orders";
import { getProvider, publicBaseUrl } from "@/lib/payments";
import { allow, clientIp } from "@/lib/payments/ratelimit";
import { giftLinks, receiptUrl, type ReceiptState } from "@/lib/payments/receipt";
import { settlePayment } from "@/lib/payments/settle";

/**
 * GET /api/payments/return/ — where the provider sends the shopper back.
 *
 * Verifies the signed token, moves the order, and lands the shopper on the
 * receipt: /shop2/done/?n=<number>&s=paid|failed|pending — built by
 * src/lib/payments/receipt.ts, which also says what `t`, `g` and `o` are.
 *
 * This is a redirect endpoint, never an error page: whatever goes wrong, the
 * shopper ends up on a screen that tells them where they stand. The webhook is
 * the authority on money — if this route cannot reach the database, the
 * notification will do the same work a moment later.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function done(
  base: string,
  number: string | null,
  state: ReceiptState,
  extra: { total?: number; gift?: string; orderId?: string; method?: string; bank?: string } = {},
) {
  return NextResponse.redirect(receiptUrl(base, { number, state, ...extra }), 303);
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
    // The confirmation e-mail must not hold up the redirect, and must not be
    // able to break it either. Only the first arrival sends it: this route and
    // the webhook race by design, and refreshing it is free (audit H4). The
    // gift cards bought in the order are made sure of on every arrival —
    // issuing is idempotent, and a paid order whose first pass died before the
    // hook has no other way of getting them. All of that is settlePayment().
    outcome = await settlePayment(order, result, provider.name);
  } catch (err) {
    console.error("payments/return: apply failed", err);
    return done(base, order.number, result.status, { orderId: order.id, method: methodOf(order), bank: bankOf(order) });
  }

  const state: ReceiptState =
    outcome.keptPaid || outcome.status === "paid"
      ? "paid"
      : outcome.status === "failed"
        ? "failed"
        : result.status;
  // The cards exist by now: settlePayment() awaited the hook, and it mints
  // before it mails.
  const gift = state === "paid" ? await giftLinks(order.id) : "";
  return done(base, order.number, state, {
    total: state === "paid" ? Number(order.total) : undefined,
    gift,
    // a cancelled payment keeps the order: «Оплатить ещё раз» posts this id back
    orderId: order.id,
    // …and the method it was sent out with, so the retry screen starts on the
    // way the shopper already chose rather than proposing a different one
    method: methodOf(order),
    bank: bankOf(order),
  });
}

/** `bank` | `card` | `wallet` off the order's payment blob, or nothing. */
function methodOf(order: { payment?: unknown }): string | undefined {
  const p = order.payment as { method?: unknown } | null | undefined;
  const m = p && typeof p === "object" ? p.method : undefined;
  return typeof m === "string" ? m : undefined;
}

/** The BIC of the bank the shopper picked, so the retry screen highlights it. */
function bankOf(order: { payment?: unknown }): string | undefined {
  const p = order.payment as { bank?: unknown } | null | undefined;
  const b = p && typeof p === "object" ? p.bank : undefined;
  return typeof b === "string" && b ? b : undefined;
}
