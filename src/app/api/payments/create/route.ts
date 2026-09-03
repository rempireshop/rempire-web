import { NextResponse } from "next/server";
import { getOrder, setOrderPayment } from "@/lib/orders";
import { getProvider, publicBaseUrl } from "@/lib/payments";
import { toPaymentOrder, orderLang } from "@/lib/payments/order";
import { allow, clientIp } from "@/lib/payments/ratelimit";
import { PaymentError, type PaymentLang, type PaymentMethodKind } from "@/lib/payments/types";

/**
 * POST /api/payments/create/  { orderId, method?, bank?, lang? }
 *   → { ok: true, redirectUrl, provider, ref }
 *
 * The order already exists (POST /api/orders made it); this turns it into a
 * payment and hands back somewhere to send the shopper. Note the trailing
 * slash — next.config has trailingSlash: true, and a POST to the bare path
 * 308s.
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

  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!orderId) return bad("missing_order");

  const method: PaymentMethodKind = body.method === "card" ? "card" : "bank";
  const bank = typeof body.bank === "string" && body.bank.trim() ? body.bank.trim() : undefined;

  let row: unknown;
  try {
    row = await getOrder(orderId);
  } catch (err) {
    console.error("payments/create: getOrder failed", err);
    return bad("db_unavailable", 503);
  }
  if (!row) return bad("not_found", 404);

  const status = (row as { status?: unknown }).status;
  if (status === "paid" || status === "shipped") return bad("already_paid", 409);
  if (status === "cancelled" || status === "refunded") return bad("order_closed", 409);

  const order = toPaymentOrder(row);
  if (!order) return bad("bad_order", 422);
  if (!(order.total > 0)) return bad("bad_amount", 422);

  const lang: PaymentLang =
    body.lang === "RU" || body.lang === "ET" || body.lang === "EN"
      ? body.lang
      : orderLang(row);

  const base = publicBaseUrl(req);
  if (!base) return bad("no_base_url", 500);

  let provider;
  try {
    provider = getProvider();
  } catch (err) {
    console.error("payments/create: no provider", err);
    return bad("provider_unconfigured", 503);
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
    // still sees which provider holds this order and under what reference.
    try {
      await setOrderPayment(order.id, {
        provider: provider.name,
        ref: result.ref,
        status: "pending",
        method,
        bank,
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
