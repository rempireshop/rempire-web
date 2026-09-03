import { NextResponse } from "next/server";
import { getOrderByNumber, setOrderPayment, setOrderStatus } from "@/lib/orders";
import { getProvider, publicBaseUrl } from "@/lib/payments";
import { applyPaymentResult } from "@/lib/payments/apply";
import { notifyOrderPaid } from "@/lib/payments/mail-hook";

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

function done(base: string, number: string | null, state: string) {
  const params = new URLSearchParams();
  if (number) params.set("n", number);
  params.set("s", state);
  return NextResponse.redirect(`${base}/shop2/done/?${params.toString()}`, 303);
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

async function handle(req: Request, params: URLSearchParams) {
  const base = publicBaseUrl(req);

  let provider;
  try {
    provider = getProvider();
  } catch {
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
    // able to break it either.
    await notifyOrderPaid({ ...order, status: "paid", payment: outcome.payment });
  }

  const state =
    outcome.keptPaid || outcome.status === "paid"
      ? "paid"
      : outcome.status === "failed"
        ? "failed"
        : result.status;
  return done(base, order.number, state);
}
