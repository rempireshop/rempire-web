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
/** …and 1 hour on a GET's Bearer token (API reference → Authentication). */
const GET_TOKEN_TTL_SECONDS = 3600;
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
 * What Montonio actually said when it refused — the HTTP status plus its own
 * message, as one short line for the order journal and the admin panel.
 *
 * Every refusal this file can meet is documented and every one of them names
 * itself. The refunds guide lists, verbatim:
 *
 *   400 Order uuid [...] already has a refund with same idempotency key
 *   400 Refund amount [1000] exceeds the total amount refundable [10]
 *   400 amount is under the min allowed amount: 0.05EUR
 *   401 STORE_NOT_FOUND - double check your access key
 *   403 INVALID_TOKEN - double check your secret key
 *
 * Until 18.09.2026 all five were collapsed into the bare code
 * `provider_rejected`, whose one Russian sentence in the panel told the owner
 * to check his BALANCE — the one cause that cannot produce any of them: a
 * refund with nothing behind it is answered 200 with `status: "PENDING"`, and
 * the reason follows later on the refund webhook as
 * `refundStatusDescription: "INSUFFICIENT_FUNDS"`. Never an HTTP error.
 *
 * Montonio's error bodies are not one shape, so try the usual keys and fall
 * back to the raw text. Truncated: this ends up in a log line and a JSON field,
 * not in a report.
 */
export function montonioErrorText(status: number, body: string): string {
  const raw = String(body ?? "").trim();
  let message = "";
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const key of ["message", "error", "detail", "description"]) {
        const v = parsed?.[key];
        if (typeof v === "string" && v.trim()) {
          message = v.trim();
          break;
        }
        if (Array.isArray(v) && typeof v[0] === "string") {
          message = v.join("; ");
          break;
        }
      }
    } catch {
      /* not JSON after all — the raw text below is all there is */
    }
  }
  if (!message) message = raw;
  return `HTTP ${status}${message ? ` · ${message.slice(0, 300)}` : ""}`;
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

/**
 * What `GET /orders/:orderUuid` says about a payment — the fields that decide
 * whether a refund can be asked for at all, and nothing else.
 */
export interface MontonioOrderSnapshot {
  uuid: string;
  /** PENDING | PAID | VOIDED | PARTIALLY_REFUNDED | REFUNDED | ABANDONED | AUTHORIZED */
  paymentStatus: string;
  grandTotal: number;
  currency: string;
  /** What may still be refunded right now. 0 until the funds have settled. */
  availableForRefund: number;
  /** `false` = refunds are not switched on for this method/store. Absent = not said. */
  isRefundableType?: boolean;
  refunds: Array<{ uuid: string; amount: number; status: string }>;
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
      const detail = montonioErrorText(res.status, text);
      console.error(`montonio create failed for ${order.number}: ${detail}`);
      throw new PaymentError("provider_rejected", detail);
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
   *
   * Two preconditions live on Montonio's side, and neither is anything this
   * code can arrange (refunds guide, checked 18.09.2026):
   *
   *   1. the payment method must support refunds. Cards, Apple Pay, Google
   *      Pay, MobilePay, BLIK, BNPL and Financing do by default; **Payment
   *      Initiation is EUR only and needs «Bank payment refunds» enabled in
   *      the Partner System** — which is the bank link, the method most of
   *      this shop's customers use;
   *   2. «the funds have arrived to the merchant's settlement account in
   *      Montonio. This typically takes 1 business day.»
   *
   * Until either holds, `GET /orders/:orderUuid` reports `availableForRefund:
   * 0` and this call is answered `400 Refund amount [X] exceeds the total
   * amount refundable [0]` — which is an HTTP refusal, thrown below as
   * `provider_rejected` with Montonio's own sentence attached.
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
      const detail = montonioErrorText(res.status, text);
      console.error(
        `montonio refund failed for order ${req.orderNumber ?? req.providerRef}: ${detail}`,
      );
      throw new PaymentError("provider_rejected", detail);
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
   * `GET /orders/:orderUuid` — what Montonio itself believes about a payment.
   *
   * The one endpoint this integration never called, and the one that answers
   * the question the panel could not: why a refund was refused. Its response
   * carries, by Montonio's own reference page:
   *
   *   · `availableForRefund` — what may still be sent back RIGHT NOW. It is 0
   *     until «the funds have arrived to the merchant's settlement account in
   *     Montonio», which its refunds guide says «typically takes 1 business
   *     day». A refund asked for before that is answered
   *     `400 Refund amount [X] exceeds the total amount refundable [0]`.
   *   · `isRefundableType` — «will be true if you enabled refunds in montonio
   *     (and the user paid with a refundable method)». False is the Partner
   *     System switch, not the code: Payment Initiation refunds are EUR-only
   *     and need «Bank payment refunds» turned on.
   *   · `paymentStatus`, `grandTotal` and the `refunds` array as Montonio has
   *     them — the authority our own ledger is a copy of.
   *
   * Read-only, and used ONLY to explain a refusal after the fact (see
   * src/app/api/admin/orders/[id]/refund/). It never gates a refund: an
   * answer this shop could not fetch must not be the reason a customer's
   * money stays here. `null` — never a throw — on anything at all.
   *
   * Auth is the Bearer JWT of `{ accessKey, exp }` the API reference
   * prescribes for GET endpoints («GET endpoints require a JWT in the
   * Authorization header»), the same recipe as GET /stores/payment-methods.
   */
  async fetchOrder(orderUuid: string): Promise<MontonioOrderSnapshot | null> {
    const uuid = String(orderUuid ?? "").trim();
    if (!uuid) return null;

    const token = signHs256({ accessKey: this.config.accessKey }, this.config.secretKey, {
      expiresInSeconds: GET_TOKEN_TTL_SECONDS,
    });

    let res: Response;
    try {
      res = await fetch(`${this.base}/orders/${encodeURIComponent(uuid)}`, {
        headers: { accept: "application/json", authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (err) {
      console.error(`[montonio] GET /orders/${uuid} unreachable —`, err);
      return null;
    }
    const text = await res.text();
    if (!res.ok) {
      console.error(`[montonio] GET /orders/${uuid}: ${montonioErrorText(res.status, text)}`);
      return null;
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (!body || typeof body !== "object") return null;

    const refunds = Array.isArray(body.refunds) ? body.refunds : [];
    return {
      uuid: typeof body.uuid === "string" ? body.uuid : uuid,
      paymentStatus: typeof body.paymentStatus === "string" ? body.paymentStatus : "",
      grandTotal: money(Number(body.grandTotal ?? 0)),
      currency: typeof body.currency === "string" ? body.currency : "EUR",
      availableForRefund: money(Number(body.availableForRefund ?? 0)),
      /* Absent is not false: a field this shop cannot see must not be reported
         as «refunds are switched off». Only an explicit `false` says that. */
      isRefundableType: typeof body.isRefundableType === "boolean" ? body.isRefundableType : undefined,
      refunds: refunds
        .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
        .map((r) => ({
          uuid: String(r.uuid ?? ""),
          amount: money(Number(r.amount ?? 0)),
          status: typeof r.status === "string" ? r.status : "",
        })),
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
