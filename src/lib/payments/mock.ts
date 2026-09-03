import { createHmac } from "node:crypto";
import { signHs256, verifyHs256 } from "./jwt";
import {
  PaymentError,
  type CreatePaymentOptions,
  type CreatePaymentResult,
  type PaymentOrder,
  type PaymentProvider,
  type PaymentStatus,
  type VerifyResult,
} from "./types";

/**
 * The keyless provider.
 *
 * Selected ONLY by PAYMENT_PROVIDER=mock, so the whole checkout — create order,
 * redirect, pay, come back, receipt — can be walked end to end on a laptop
 * before anyone has opened a Montonio account. It is never a fallback: see
 * getProvider() in ./index.ts. The "gateway" is /api/payments/mock/: one page,
 * two buttons.
 *
 * It is not a toy in one respect: the ticket it carries is a real signed JWT
 * with the same claim names Montonio uses, so the return and notify routes
 * exercise their actual verification path rather than a bypass.
 */

const TOKEN_TTL_SECONDS = 3600;

/**
 * The signing key for mock tickets.
 *
 * There is no fallback constant any more (audit C1): a published default key
 * means anyone can mint a "this order is paid" token. No SESSION_SECRET, no
 * mock provider — the caller gets `not_configured` and the route answers 503.
 *
 * The key is *derived* from SESSION_SECRET rather than being it (audit M5), so
 * a leaked payment ticket says nothing about the admin session HMAC and vice
 * versa. Two trust domains, two keys, one secret to rotate.
 */
export function mockSecret(env: NodeJS.ProcessEnv = process.env): string {
  const s = env.SESSION_SECRET?.trim();
  if (!s) throw new PaymentError("not_configured");
  return createHmac("sha256", s).update("mock-payments").digest("base64url");
}

export interface MockTicket {
  orderRef: string;
  ref: string;
  returnUrl: string;
  amount: number;
  status?: PaymentStatus;
  [k: string]: unknown;
}

export function signMockTicket(ticket: MockTicket, secret: string): string {
  return signHs256(ticket, secret, { expiresInSeconds: TOKEN_TTL_SECONDS });
}

export function readMockTicket(token: string, secret: string): MockTicket {
  const claims = verifyHs256<Record<string, unknown>>(token, secret);
  const orderRef = claims.orderRef;
  const returnUrl = claims.returnUrl;
  if (typeof orderRef !== "string" || typeof returnUrl !== "string") {
    throw new PaymentError("token_payload");
  }
  return {
    orderRef,
    returnUrl,
    ref: typeof claims.ref === "string" ? claims.ref : orderRef,
    amount: typeof claims.amount === "number" ? claims.amount : 0,
    status: claims.status === "paid" || claims.status === "failed" ? claims.status : undefined,
  };
}

export class MockProvider implements PaymentProvider {
  readonly name = "mock";

  constructor(private readonly secret: string = mockSecret()) {}

  async createPayment(
    order: PaymentOrder,
    opts: CreatePaymentOptions,
  ): Promise<CreatePaymentResult> {
    const ref = `mock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const token = signMockTicket(
      {
        orderRef: order.number,
        ref,
        returnUrl: opts.returnUrl,
        amount: Math.round(order.total * 100) / 100,
      },
      this.secret,
    );
    // same origin as the return URL, so this works on localhost and on Vercel
    const url = new URL(opts.returnUrl);
    url.pathname = "/api/payments/mock/";
    url.search = `?t=${encodeURIComponent(token)}`;
    return { redirectUrl: url.toString(), ref };
  }

  async verifyReturn(params: URLSearchParams): Promise<VerifyResult> {
    const token = params.get("mock-token");
    if (!token) throw new PaymentError("missing_token");
    return this.read(token);
  }

  async verifyNotification(req: Request): Promise<VerifyResult> {
    let body: { mockToken?: unknown };
    try {
      body = (await req.json()) as { mockToken?: unknown };
    } catch {
      throw new PaymentError("bad_body");
    }
    if (typeof body?.mockToken !== "string") throw new PaymentError("missing_token");
    return this.read(body.mockToken);
  }

  private read(token: string): VerifyResult {
    let ticket: MockTicket;
    try {
      ticket = readMockTicket(token, this.secret);
    } catch {
      throw new PaymentError("token_invalid");
    }
    return {
      orderRef: ticket.orderRef,
      status: ticket.status ?? "pending",
      providerRef: ticket.ref,
      amount: ticket.amount,
      currency: "EUR",
      detail: "тестовая оплата",
    };
  }
}
