import {
  PaymentError,
  type CreatePaymentOptions,
  type CreatePaymentResult,
  type PaymentOrder,
  type PaymentProvider,
  type VerifyResult,
} from "./types";

/**
 * MakeCommerce (Maksekeskus) — placeholder.
 *
 * Renat has not chosen between Montonio and MakeCommerce yet; this file exists
 * so the choice stays a one-file job rather than a refactor. Every method
 * throws `not_implemented`, and getProvider() never selects it by accident:
 * PAYMENT_PROVIDER=makecommerce has to be set by hand.
 *
 * When the decision lands, the work is:
 *   - POST /v1/transactions with Basic auth (shop id + secret key), not a JWT
 *   - read `payment_methods.banklinks[]` / `.cards[]` from the response and
 *     redirect to the chosen method's `url`
 *   - verify the return/notification `json` + `mac` (SHA-512 of the message and
 *     the secret key), not a signature header
 * i.e. the same three operations, a different envelope — which is why the port
 * is shaped the way it is.
 */
export class MakeCommerceProvider implements PaymentProvider {
  readonly name = "makecommerce";

  async createPayment(
    _order: PaymentOrder,
    _opts: CreatePaymentOptions,
  ): Promise<CreatePaymentResult> {
    throw new PaymentError("not_implemented", "MakeCommerce is not wired up yet");
  }

  async verifyReturn(_params: URLSearchParams): Promise<VerifyResult> {
    throw new PaymentError("not_implemented", "MakeCommerce is not wired up yet");
  }

  async verifyNotification(_req: Request): Promise<VerifyResult> {
    throw new PaymentError("not_implemented", "MakeCommerce is not wired up yet");
  }
}
