import { NextResponse } from "next/server";
import { getOrderByNumber } from "@/lib/orders";
import { getProvider, publicBaseUrl } from "@/lib/payments";
import { allow, clientIp } from "@/lib/payments/ratelimit";
import { giftLinks, receiptUrl, type ReceiptState } from "@/lib/payments/receipt";
import { settlePayment } from "@/lib/payments/settle";
import { guardTokenChecks } from "@/lib/payments/token-guard";

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
  extra: {
    total?: number;
    gift?: string;
    orderId?: string;
    method?: string;
    bank?: string;
    country?: string;
  } = {},
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

  /* The same two documented checks the webhook runs, on the same door — the
     shopper's browser is the easier of the two to replay a token at, because
     `order-token` travels in a URL and lands in history, in a Referer and in
     any log that keeps query strings (src/lib/payments/token-guard.ts). */
  try {
    const guard = await guardTokenChecks(order, result, provider);
    if (guard.verdict === "unknown") {
      /* Nothing settled, and the shopper is told the truth: the shop is
         checking. The webhook is the authority on money and is still coming. */
      return done(base, order.number, "pending", { orderId: order.id, ...retry(order) });
    }
    if (guard.verdict === "refused") {
      return done(base, order.number, "failed", { orderId: order.id, ...retry(order) });
    }
    result = guard.result;
  } catch (err) {
    console.error("payments/return: token checks failed to run", err);
    return done(base, order.number, "pending", { orderId: order.id, ...retry(order) });
  }

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
    return done(base, order.number, result.status, {
      orderId: order.id,
      method: methodOf(order),
      bank: bankOf(order),
      country: countryOf(order),
    });
  }

  /* A held order is one the money did NOT settle: less arrived than the order
     is worth, so nothing was fulfilled and Renat has to look at it
     (src/lib/payments/apply.ts shortPayment). The token still says «paid», so
     without this line the shopper would be shown a paid receipt for an order
     that has no gift cards, no parcel coming and a total they did not pay.
     «Платёж обрабатывается» is the honest screen: the money is here, the shop
     has not accepted it yet. */
  const state: ReceiptState =
    outcome.keptPaid || outcome.status === "paid"
      ? "paid"
      : outcome.payment.held
        ? "pending"
        : outcome.status === "failed"
          ? "failed"
          : result.status;
  // The cards exist by now: settlePayment() awaited the hook, and it mints
  // before it mails.
  const gift = state === "paid" ? await giftLinks(order.id) : "";
  return done(base, order.number, state, {
    total: state === "paid" ? Number(order.total) : undefined,
    gift,
    /* A payment that did not go through keeps the order: «Оплатить ещё раз»
       posts this id back. It rides on a `pending` receipt as well as a
       `failed` one, because that is what Montonio's token says when the
       shopper pressed «Отменить» at the bank — the payment was started and
       never completed, so the order is still PENDING and will only become
       ABANDONED when it expires. Renat's acceptance run landed exactly there:
       «Платёж обрабатывается», empty basket, nothing to press.
       receiptUrl() drops it on a paid receipt. */
    orderId: order.id,
    // …and the method it was sent out with, so the retry screen starts on the
    // way the shopper already chose rather than proposing a different one
    method: methodOf(order),
    bank: bankOf(order),
    /* …and where the parcel is going, which is what decides the bank chips.
       The screen cannot work this out for itself: it is a cold page load
       after the redirect, and its own checkout state has reset to Estonia. */
    country: countryOf(order),
  });
}

/**
 * What «Оплатить ещё раз» needs to start where the shopper left off — the way
 * they chose, the bank they picked and the country whose banks to offer. The
 * three fields the receipt already carries on every non-paid screen, gathered
 * so the early returns above spell them once rather than four times.
 */
function retry(order: { payment?: unknown; shipping?: unknown }) {
  return { method: methodOf(order), bank: bankOf(order), country: countryOf(order) };
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

/** The order's delivery country — which country's banks the retry may offer. */
function countryOf(order: { shipping?: unknown }): string | undefined {
  const s = order.shipping as { country?: unknown } | null | undefined;
  const c = s && typeof s === "object" ? s.country : undefined;
  return typeof c === "string" && c ? c : undefined;
}
