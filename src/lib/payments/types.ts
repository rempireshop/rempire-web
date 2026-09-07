/**
 * The shop's payment port.
 *
 * One interface, three implementations: Montonio (real), MakeCommerce (a stub
 * until that decision is made) and a mock that lets the whole checkout be
 * walked through with no keys at all. Routes talk to this and never to a
 * provider directly, so swapping providers is an env var, not a rewrite.
 */

/** What the shop does with a payment, boiled down to three outcomes. */
export type PaymentStatus = "paid" | "failed" | "pending";

/** Customer-facing languages of the shop, mapped to provider locales. */
export type PaymentLang = "RU" | "ET" | "EN";

/**
 * How the shopper chose to pay, as the checkout's radio has it: `bank` = a
 * bank link, `card` = Visa/Mastercard, `wallet` = Apple Pay / Google Pay.
 *
 * `wallet` is its own value even though Montonio has no separate method for
 * it — the wallets are express buttons on its card page (cardPayments), so
 * the provider is asked for a card payment either way. Kept apart so the
 * order remembers what the shopper actually tapped (the admin order card
 * shows it) and so a wallet can never be mistaken for the bank list, which
 * is exactly what happened when this type had two values.
 */
export type PaymentMethodKind = "bank" | "card" | "wallet";

export const PAYMENT_METHOD_KINDS: readonly PaymentMethodKind[] = ["bank", "card", "wallet"];

/** Narrow whatever the body or a stored payment blob carries, or nothing. */
export function paymentMethodKind(v: unknown): PaymentMethodKind | undefined {
  return typeof v === "string" && (PAYMENT_METHOD_KINDS as readonly string[]).includes(v)
    ? (v as PaymentMethodKind)
    : undefined;
}

export interface PaymentLineItem {
  name: string;
  quantity: number;
  /** Unit price incl. VAT, EUR. */
  finalPrice: number;
}

export interface PaymentAddress {
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  addressLine1?: string;
  locality?: string;
  postalCode?: string;
  /** ISO-3166 alpha-2, e.g. "EE". */
  country?: string;
}

/**
 * The slice of an order a payment provider needs.
 *
 * Deliberately structural rather than an import of the `Order` type from
 * `@/lib/orders` — payments must not break when that shape grows a column.
 * `@/lib/payments/order.ts` maps a database row onto this.
 */
export interface PaymentOrder {
  id: string;
  /** Human order number, e.g. "R-100042". Becomes merchantReference. */
  number: string;
  /** Grand total incl. shipping and VAT, EUR, 2 decimals. */
  total: number;
  currency?: string;
  email?: string | null;
  items?: PaymentLineItem[];
  address?: PaymentAddress | null;
}

export interface CreatePaymentOptions {
  /** Absolute URL the shopper comes back to. */
  returnUrl: string;
  /** Absolute URL the provider POSTs the webhook to. */
  notificationUrl: string;
  lang: PaymentLang;
  /** Bank link, card or wallet. Defaults to a bank link — the Baltic norm. */
  method?: PaymentMethodKind;
  /**
   * Provider code of the bank picked in our checkout (Montonio:
   * `payment.methodOptions.preferredProvider`, e.g. "LHVBEE22"). Omitted, the
   * shopper picks the bank on the provider's own page.
   */
  bank?: string;
  /** Shipping country, used to pick the bank list. */
  country?: string;
}

export interface CreatePaymentResult {
  /** Where to send the shopper. */
  redirectUrl: string;
  /** The provider's own id for this payment, stored on the order. */
  ref: string;
}

export interface VerifyResult {
  /** Our order number, as handed to the provider. */
  orderRef: string;
  status: PaymentStatus;
  providerRef: string;
  /** Amount the provider says was paid, when it tells us. */
  amount?: number;
  currency?: string;
  /** Free-form provider detail for the order journal (bank name, card brand). */
  detail?: string;
  /**
   * Set when the provider's own token says this payment has already been sent
   * back — Montonio's REFUNDED / PARTIALLY_REFUNDED. The payment `status`
   * stays `paid` (the money did arrive); this is the second movement, and the
   * notify route hands it to src/lib/payments/refund.ts. Without it a refund
   * made inside Montonio's portal left the order reading «Оплачен» here for
   * ever (Dim, 07.09.2026).
   */
  refunded?: "full" | "partial";
}

export interface PaymentProvider {
  /** Machine name, stored on the order alongside the ref. */
  readonly name: string;
  createPayment(
    order: PaymentOrder,
    opts: CreatePaymentOptions,
  ): Promise<CreatePaymentResult>;
  /** Verify the query parameters the shopper came back with. */
  verifyReturn(params: URLSearchParams): Promise<VerifyResult>;
  /** Verify a webhook. Reads the body itself — pass the untouched Request. */
  verifyNotification(req: Request): Promise<VerifyResult>;
}

/** Thrown by providers; the code is what the API returns as `error`. */
export class PaymentError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "PaymentError";
  }
}
