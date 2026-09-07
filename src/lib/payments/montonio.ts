import { randomUUID } from "node:crypto";
import { signHs256, verifyHs256, JwtError } from "./jwt";
import type {
  RefundNotification,
  RefundRequest,
  RefundResult,
  RefundStatus,
  RefundingProvider,
} from "./refund";
import {
  PaymentError,
  type CreatePaymentOptions,
  type CreatePaymentResult,
  type PaymentLang,
  type PaymentOrder,
  type PaymentProvider,
  type PaymentStatus,
  type VerifyResult,
} from "./types";

/**
 * Montonio Orders API (Stargate v2).
 *
 * Every field name below is copied from Montonio's own docs, verified
 * 03.09.2026 against https://docs.montonio.com/api/stargate/guides/orders —
 * see docs/payments.md for the list and for the two places we made a choice
 * rather than a copy.
 *
 * Shape of the integration:
 *   1. build the order payload, sign it HS256 with MONTONIO_SECRET_KEY
 *   2. POST { data: <jwt> } to <base>/orders
 *   3. redirect the shopper to the returned `paymentUrl`
 *   4. they come back to returnUrl?order-token=<jwt>, and a webhook POSTs
 *      { orderToken: <jwt> } to notificationUrl — both are verified with the
 *      same secret and both carry `paymentStatus`.
 */

const SANDBOX_BASE = "https://sandbox-stargate.montonio.com/api";
const LIVE_BASE = "https://stargate.montonio.com/api";

/** JWT lifetime on the order token. Montonio's docs say 10 minutes. */
const TOKEN_TTL_SECONDS = 600;
const REQUEST_TIMEOUT_MS = 15_000;

/** locale values Montonio accepts (docs: Order data structure → locale). */
const LOCALES: Record<PaymentLang, string> = { RU: "ru", ET: "et", EN: "en" };

/** preferredCountry values Montonio accepts for the bank list. */
const BANK_COUNTRIES = new Set(["EE", "LV", "LT", "FI", "PL"]);

export interface MontonioConfig {
  accessKey: string;
  secretKey: string;
  env: "sandbox" | "live";
}

export function montonioConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MontonioConfig | null {
  const accessKey = env.MONTONIO_ACCESS_KEY?.trim();
  const secretKey = env.MONTONIO_SECRET_KEY?.trim();
  if (!accessKey || !secretKey) return null;
  return {
    accessKey,
    secretKey,
    env: env.MONTONIO_ENV?.trim() === "live" ? "live" : "sandbox",
  };
}

export function montonioBaseUrl(env: "sandbox" | "live"): string {
  return env === "live" ? LIVE_BASE : SANDBOX_BASE;
}

/** EUR with 2 decimals — JSON floats otherwise ship 99.98999999999999. */
function money(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Montonio's paymentStatus → our three outcomes.
 *
 * PENDING/AUTHORIZED are still in flight. VOIDED is a PAID order the bank later
 * rejected; it is a genuine failure, but the notify route refuses to downgrade
 * an order that is already paid, so a voided payment surfaces as a mismatch for
 * a human rather than an automatic cancellation (Montonio also emails the
 * merchant). Anything unknown stays `pending`: never mark an order failed on a
 * status this code has not been taught.
 *
 * REFUNDED and PARTIALLY_REFUNDED stay `paid` on purpose: they say the payment
 * itself succeeded, and the money going back is a *second* movement, carried by
 * `VerifyResult.refunded` below and settled by src/lib/payments/refund.ts. A
 * refund is not a payment that failed.
 */
export function mapMontonioStatus(raw: unknown): PaymentStatus {
  switch (String(raw ?? "").toUpperCase()) {
    case "PAID":
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
      return "paid";
    case "PENDING":
    case "AUTHORIZED":
      return "pending";
    case "VOIDED":
    case "ABANDONED":
    case "CANCELLED":
    case "CANCELED":
    case "FAILED":
      return "failed";
    default:
      return "pending";
  }
}

/** Whether an order token says the money has already gone back, and how much of it. */
export function montonioRefundKind(raw: unknown): "full" | "partial" | undefined {
  const s = String(raw ?? "").toUpperCase();
  if (s === "REFUNDED") return "full";
  if (s === "PARTIALLY_REFUNDED") return "partial";
  return undefined;
}

/**
 * Montonio's five refund states → our three.
 *
 * Docs (https://docs.montonio.com/api/stargate/guides/refunds, checked
 * 07.09.2026): PENDING, PROCESSING, SUCCESSFUL, REJECTED, CANCELED. A refund
 * with no balance behind it sits at PENDING for up to ten days and is then
 * cancelled — which is exactly why `pending` counts as money on its way out
 * (src/lib/payments/refund.ts) and why REJECTED/CANCELED frees it again.
 * Anything unknown stays `pending`: never call a refund finished on a word
 * this code has not been taught.
 */
export function mapMontonioRefundStatus(raw: unknown): RefundStatus {
  switch (String(raw ?? "").toUpperCase()) {
    case "SUCCESSFUL":
    case "SUCCEEDED":
    case "COMPLETED":
      return "done";
    case "REJECTED":
    case "CANCELED":
    case "CANCELLED":
    case "FAILED":
      return "failed";
    default:
      return "pending";
  }
}

interface OrderTokenClaims {
  uuid?: string;
  accessKey?: string;
  merchantReference?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  paymentProviderName?: string | null;
  grandTotal?: number;
  currency?: string;
  [k: string]: unknown;
}

function splitName(full: string | undefined): { firstName?: string; lastName?: string } {
  const parts = String(full ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

interface RefundTokenClaims {
  refundUuid?: string;
  refundStatus?: string;
  refundStatusDescription?: string;
  accessKey?: string;
  refundAmount?: number | string;
  orderUuid?: string;
  [k: string]: unknown;
}

export class MontonioProvider implements PaymentProvider, RefundingProvider {
  readonly name = "montonio";

  constructor(private readonly config: MontonioConfig) {}

  private get base(): string {
    return montonioBaseUrl(this.config.env);
  }

  async createPayment(
    order: PaymentOrder,
    opts: CreatePaymentOptions,
  ): Promise<CreatePaymentResult> {
    const currency = (order.currency ?? "EUR").toUpperCase();
    const grandTotal = money(order.total);
    if (!(grandTotal > 0)) throw new PaymentError("bad_amount");
    if (!order.number) throw new PaymentError("bad_order");

    const locale = LOCALES[opts.lang] ?? "et";
    /* Apple Pay and Google Pay are not a Montonio method of their own: they
       are the express buttons on its card page (docs/payments.md §9), so a
       wallet is asked for as cardPayments — never as a bank link, which is
       where `opts.method === "card" ? … : paymentInitiation` used to send it. */
    const method = opts.method === "card" || opts.method === "wallet" ? "cardPayments" : "paymentInitiation";
    const country = String(opts.country ?? order.address?.country ?? "").toUpperCase();

    /* `preferredMethod` decides which half of that one card page opens first.
       Montonio's own words (orders guide, checked 07.09.2026): it "enables to
       choose which payment method is shown first by default in the UI — Card
       payments or Wallets", allowed values `"card"` and `"wallet"`, default
       `"wallet"`. We sent `"card"` for both, so the shopper who tapped
       «Apple Pay / Google Pay» arrived at the card form with the wallet
       buttons pushed below it — the right page, opened at the wrong half. */
    const methodOptions: Record<string, unknown> =
      method === "cardPayments"
        ? { preferredMethod: opts.method === "wallet" ? "wallet" : "card" }
        : {
            paymentDescription: `REMPIRE ${order.number}`,
            preferredLocale: locale,
            ...(BANK_COUNTRIES.has(country) ? { preferredCountry: country } : {}),
            ...(opts.bank ? { preferredProvider: opts.bank } : {}),
          };

    const name = splitName(
      [order.address?.firstName, order.address?.lastName].filter(Boolean).join(" "),
    );
    const address =
      order.address && (order.address.email || order.email)
        ? {
            firstName: order.address.firstName ?? name.firstName,
            lastName: order.address.lastName ?? name.lastName,
            email: order.address.email ?? order.email ?? undefined,
            phoneNumber: order.address.phoneNumber,
            addressLine1: order.address.addressLine1,
            locality: order.address.locality,
            postalCode: order.address.postalCode,
            country: order.address.country,
          }
        : undefined;

    const payload: Record<string, unknown> = {
      accessKey: this.config.accessKey,
      merchantReference: order.number,
      returnUrl: opts.returnUrl,
      notificationUrl: opts.notificationUrl,
      currency,
      grandTotal,
      locale,
      payment: {
        method,
        methodDisplay: method === "cardPayments" ? "Card payment" : "Pay with your bank",
        amount: grandTotal,
        currency,
        methodOptions,
      },
    };
    if (address) {
      payload.billingAddress = address;
      payload.shippingAddress = address;
    }
    if (order.items?.length) {
      payload.lineItems = order.items.map((i) => ({
        name: String(i.name).slice(0, 255),
        quantity: Math.max(1, Math.round(i.quantity)),
        finalPrice: money(i.finalPrice),
      }));
    }

    const token = signHs256(payload, this.config.secretKey, {
      expiresInSeconds: TOKEN_TTL_SECONDS,
    });

    let res: Response;
    try {
      res = await fetch(`${this.base}/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: token }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new PaymentError("provider_unreachable");
    }

    const text = await res.text();
    if (!res.ok) {
      console.error("montonio create failed", res.status, text.slice(0, 500));
      throw new PaymentError("provider_rejected");
    }

    let body: { uuid?: string; paymentUrl?: string };
    try {
      body = JSON.parse(text) as { uuid?: string; paymentUrl?: string };
    } catch {
      throw new PaymentError("provider_bad_response");
    }
    if (!body.paymentUrl) throw new PaymentError("provider_bad_response");

    return { redirectUrl: body.paymentUrl, ref: body.uuid ?? order.number };
  }

  /**
   * POST /refunds — the money back, in full or in part.
   *
   * Same envelope as POST /orders: the whole request IS the signed token, sent
   * as `{ "data": "<jwt>" }`. Claims, verbatim from Montonio's refunds guide
   * (checked 07.09.2026): `accessKey`, `orderUuid` (their id for the payment,
   * which is what we store as `orders.payment.ref`), `amount` (2 decimals),
   * `idempotencyKey` — a V4 UUID, and the reason a retried «Вернуть деньги»
   * cannot pay the customer twice — plus `iat`/`exp` from signHs256().
   *
   * The answer is a refund that has only *started*: `status` is PENDING until
   * Montonio has the balance to send it. That is not a failure and must not be
   * shown as one — see mapMontonioRefundStatus() above.
   */
  async refundPayment(req: RefundRequest): Promise<RefundResult> {
    const amount = money(req.amount);
    if (!(amount > 0)) throw new PaymentError("bad_amount");
    if (!req.providerRef) throw new PaymentError("no_provider_ref");

    const token = signHs256(
      {
        accessKey: this.config.accessKey,
        orderUuid: req.providerRef,
        amount,
        idempotencyKey: req.idempotencyKey || randomUUID(),
      },
      this.config.secretKey,
      { expiresInSeconds: TOKEN_TTL_SECONDS },
    );

    let res: Response;
    try {
      res = await fetch(`${this.base}/refunds`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: token }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new PaymentError("provider_unreachable");
    }

    const text = await res.text();
    if (!res.ok) {
      console.error("montonio refund failed", res.status, text.slice(0, 500));
      throw new PaymentError("provider_rejected");
    }

    let body: { uuid?: string; amount?: number | string; status?: string; currency?: string; type?: string };
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      throw new PaymentError("provider_bad_response");
    }
    if (!body.uuid) throw new PaymentError("provider_bad_response");

    return {
      ref: String(body.uuid),
      amount: typeof body.amount === "number" || typeof body.amount === "string" ? money(Number(body.amount)) : amount,
      status: mapMontonioRefundStatus(body.status),
      currency: typeof body.currency === "string" ? body.currency : (req.currency ?? "EUR"),
      detail: [body.type, body.status].filter(Boolean).join(" · ") || undefined,
    };
  }

  /**
   * The refund webhook — `{ "refundToken": "<jwt>" }` at the same
   * notificationUrl as an order token, and valid for seven days rather than
   * ten minutes. It names the order by Montonio's `orderUuid`, never by our
   * merchantReference, which is why the notify route looks the order up by
   * `orders.payment.ref` for this one.
   */
  async verifyRefundNotification(req: Request): Promise<RefundNotification> {
    let body: { refundToken?: unknown };
    try {
      body = (await req.json()) as { refundToken?: unknown };
    } catch {
      throw new PaymentError("bad_body");
    }
    const token = body?.refundToken;
    if (typeof token !== "string" || !token) throw new PaymentError("missing_token");

    let claims: RefundTokenClaims;
    try {
      claims = verifyHs256<RefundTokenClaims>(token, this.config.secretKey);
    } catch (err) {
      throw new PaymentError(
        err instanceof JwtError ? `token_${err.code.replace("jwt_", "")}` : "token_invalid",
      );
    }
    if (claims.accessKey && claims.accessKey !== this.config.accessKey) {
      throw new PaymentError("token_foreign");
    }
    if (!claims.orderUuid || !claims.refundUuid) throw new PaymentError("token_no_reference");

    return {
      refundRef: String(claims.refundUuid),
      providerOrderRef: String(claims.orderUuid),
      status: mapMontonioRefundStatus(claims.refundStatus),
      amount: money(Number(claims.refundAmount ?? 0)),
      detail:
        [claims.refundStatus, claims.refundStatusDescription].filter(Boolean).join(" · ") || undefined,
    };
  }

  async verifyReturn(params: URLSearchParams): Promise<VerifyResult> {
    // documented name is `order-token`; the snake_case twin is accepted
    // because some Montonio plugins still send it
    const token = params.get("order-token") ?? params.get("order_token");
    if (!token) throw new PaymentError("missing_token");
    return this.verifyToken(token);
  }

  async verifyNotification(req: Request): Promise<VerifyResult> {
    let body: { orderToken?: unknown; refundToken?: unknown };
    try {
      body = (await req.json()) as { orderToken?: unknown; refundToken?: unknown };
    } catch {
      throw new PaymentError("bad_body");
    }
    const token = body?.orderToken;
    if (typeof token !== "string" || !token) {
      // refundToken webhooks arrive at the same URL; they are not ours to act on
      throw new PaymentError(body?.refundToken ? "not_order_webhook" : "missing_token");
    }
    return this.verifyToken(token);
  }

  /** Verify a signed token from either channel and read the order out of it. */
  verifyToken(token: string): VerifyResult {
    let claims: OrderTokenClaims;
    try {
      claims = verifyHs256<OrderTokenClaims>(token, this.config.secretKey);
    } catch (err) {
      throw new PaymentError(
        err instanceof JwtError ? `token_${err.code.replace("jwt_", "")}` : "token_invalid",
      );
    }
    // A valid signature from *another* Montonio store is still not ours.
    if (claims.accessKey && claims.accessKey !== this.config.accessKey) {
      throw new PaymentError("token_foreign");
    }
    const orderRef = claims.merchantReference;
    if (!orderRef) throw new PaymentError("token_no_reference");

    return {
      orderRef: String(orderRef),
      status: mapMontonioStatus(claims.paymentStatus),
      providerRef: String(claims.uuid ?? ""),
      amount: typeof claims.grandTotal === "number" ? money(claims.grandTotal) : undefined,
      currency: typeof claims.currency === "string" ? claims.currency : undefined,
      detail:
        [claims.paymentMethod, claims.paymentProviderName].filter(Boolean).join(" · ") ||
        undefined,
      refunded: montonioRefundKind(claims.paymentStatus),
    };
  }
}

export function createMontonioProvider(
  env: NodeJS.ProcessEnv = process.env,
): MontonioProvider | null {
  const config = montonioConfigFromEnv(env);
  return config ? new MontonioProvider(config) : null;
}
