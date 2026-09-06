import { NextResponse } from "next/server";
import { getOrder, setOrderPayment } from "@/lib/orders";
import { getProvider, publicBaseUrl } from "@/lib/payments";
import { toPaymentOrder, orderLang } from "@/lib/payments/order";
import { allow, clientIp } from "@/lib/payments/ratelimit";
import { giftLinks, receiptUrl } from "@/lib/payments/receipt";
import { settleWithoutPayment } from "@/lib/payments/settle";
import {
  PaymentError,
  paymentMethodKind,
  type PaymentLang,
  type PaymentMethodKind,
} from "@/lib/payments/types";

/**
 * POST /api/payments/create/  { orderId, method?, bank?, lang? }
 *   → { ok: true, redirectUrl, provider, ref }
 *   → { ok: true, redirectUrl, provider: "none", ref: "", paid: true }
 *     when there was nothing left to pay (see below)
 *
 * The order already exists (POST /api/orders made it); this turns it into a
 * payment and hands back somewhere to send the shopper. Note the trailing
 * slash — next.config has trailingSlash: true, and a POST to the bare path
 * 308s.
 *
 * `method` is the checkout's radio: bank | card | wallet (Apple Pay / Google
 * Pay — asked of the provider as a card payment, docs/payments.md). `bank`
 * is the chosen bank's code and only means anything with a bank link. Both
 * are optional: a body with nothing but the order id — «Оплатить ещё раз» on
 * the failed receipt — reuses what the order remembers from the first try.
 *
 * An order whose total is 0 — a gift card, points or a promo covered all of
 * it — is not sent anywhere: it is settled here and now, without a provider,
 * through the same paid transition a provider's ticket would take
 * (src/lib/payments/settle.ts), and the shopper goes straight to the paid
 * receipt. This does not need PAYMENT_PROVIDER or any keys.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;

function bad(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  if (!allow(`pay:create:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return bad("rate_limited", 429);
  }

  let body: { orderId?: unknown; method?: unknown; bank?: unknown; lang?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return bad("bad_body");
  }

  /* `null` is valid JSON and `typeof null === "object"`, so the parse above
     lets it through and every field read below throws — a 500 from a
     two-byte body. Same door for a bare number, string or array. */
  if (!body || typeof body !== "object" || Array.isArray(body)) return bad("bad_body");

  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId) return bad("missing_order");

  let row: unknown;
  try {
    row = await getOrder(orderId);
  } catch (err) {
    console.error("payments/create: getOrder failed", err);
    return bad("db_unavailable", 503);
  }
  if (!row) return bad("not_found", 404);

  const status = (row as { status?: unknown }).status;
  if (status === "paid" || status === "shipped" || status === "delivered") return bad("already_paid", 409);
  if (status === "cancelled" || status === "refunded") return bad("order_closed", 409);

  const order = toPaymentOrder(row);
  if (!order) return bad("bad_order", 422);

  /* The method: the body's, else the one this order was first sent out with
     (a retry from the failed receipt sends only the id), else a bank link —
     the Baltic norm and what the checkout preselects. A word this route has
     not been taught ("bitcoin") is a bank link too, as it always was. The
     bank code travels with a bank link alone: a wallet or a card must never
     carry the chip that happened to be highlighted, and the provider would
     not know what to do with it. */
  const stored = ((row as { payment?: Record<string, unknown> | null }).payment ?? {}) as Record<string, unknown>;
  const method: PaymentMethodKind =
    paymentMethodKind(body.method) ??
    (body.method === undefined ? paymentMethodKind(stored.method) : undefined) ??
    "bank";
  const bodyBank = typeof body.bank === "string" && body.bank.trim() ? body.bank.trim() : undefined;
  const storedBank = typeof stored.bank === "string" && stored.bank.trim() ? stored.bank.trim() : undefined;
  const bank =
    method !== "bank" ? undefined : (bodyBank ?? (body.method === undefined && body.bank === undefined ? storedBank : undefined));

  const lang: PaymentLang =
    body.lang === "RU" || body.lang === "ET" || body.lang === "EN"
      ? body.lang
      : orderLang(row);

  const base = publicBaseUrl(req);
  if (!base) return bad("no_base_url", 500);

  if (!(order.total > 0)) {
    /* Nothing left to pay. Settled here — before any provider is even
       looked for: a 0 € order needs none, and must complete on a shop whose
       keys are not in yet. The receipt is the same one a provider's return
       lands on, gift-card download links included. */
    try {
      await settleWithoutPayment(row as Parameters<typeof settleWithoutPayment>[0]);
    } catch (err) {
      /* not_covered: the card or the points quoted at checkout are no longer
         there (spent by another order in between). The order stays open and
         untouched; the checkout tells the shopper to look at the basket. */
      if (err instanceof PaymentError && err.code === "not_covered") return bad("not_covered", 409);
      console.error("payments/create: settling a zero-total order failed", err);
      return bad("db_unavailable", 503);
    }
    const gift = await giftLinks(order.id);
    return NextResponse.json({
      ok: true,
      paid: true,
      provider: "none",
      ref: "",
      redirectUrl: receiptUrl(base, { number: order.number, state: "paid", total: 0, gift }),
    });
  }

  let provider;
  try {
    provider = getProvider();
  } catch (err) {
    /* No PAYMENT_PROVIDER and no Montonio keys: the shop refuses to take the
       money rather than falling back to the mock gateway, which would mark the
       order paid for free (audit C1). Set the keys, or PAYMENT_PROVIDER=mock. */
    console.error("payments/create: no provider", err);
    return bad("not_configured", 503);
  }

  const country =
    (row as { shipping?: { country?: unknown } }).shipping?.country;

  try {
    const result = await provider.createPayment(order, {
      returnUrl: `${base}/api/payments/return/`,
      notificationUrl: `${base}/api/payments/notify/`,
      lang,
      method,
      bank,
      country: typeof country === "string" ? country : order.address?.country,
    });

    // Recorded before the redirect: if the shopper never comes back, the admin
    // still sees which provider holds this order, under what reference and
    // how the shopper meant to pay. `bank: null` on purpose — a retry that
    // switched from a bank link to a card must not keep the old bank around.
    try {
      await setOrderPayment(order.id, {
        provider: provider.name,
        ref: result.ref,
        status: "pending",
        method,
        bank: bank ?? null,
        at: new Date().toISOString(),
      });
    } catch (err) {
      console.error("payments/create: setOrderPayment failed", err);
    }

    return NextResponse.json({
      ok: true,
      provider: provider.name,
      ref: result.ref,
      redirectUrl: result.redirectUrl,
    });
  } catch (err) {
    const code = err instanceof PaymentError ? err.code : "payment_failed";
    console.error("payments/create failed", code, err);
    return bad(code, code === "not_implemented" ? 501 : 502);
  }
}

export function GET() {
  return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
