import { MockProvider, mockSecret } from "./mock";
import { createMontonioProvider } from "./montonio";
import { PaymentError, type PaymentProvider } from "./types";

export * from "./types";
export * from "./refund";
export { MontonioProvider, mapMontonioStatus, mapMontonioRefundStatus } from "./montonio";
export { MockProvider } from "./mock";

/**
 * Which provider this deployment pays through.
 *
 * PAYMENT_PROVIDER decides when it is set. When it is not — or when it is set
 * to something this file does not know — Montonio is used if its keys are
 * present, and if they are not, this **throws**. A shop with no payment
 * provider must refuse to take payments, never invent one: the mock provider
 * signs its own "this order is paid" tickets, so falling back to it silently
 * is the same as publishing a free-order endpoint (audit C1).
 *
 * The mock provider is therefore reachable one way only: PAYMENT_PROVIDER=mock,
 * typed by a human who meant it. See docs/payments.md.
 *
 * There were three providers until 07.09.2026: a MakeCommerce (Maksekeskus)
 * class every method of which threw `not_implemented`, kept while the choice
 * between the two Estonian gateways was open. Montonio is signed and live in
 * sandbox, so the stub was deleted (docs/audit/2026-09-07-cleanup.md); it is
 * in git at 448cbd7, and the port below is still shaped so that adding a
 * second gateway is one file — three operations in a different envelope.
 */
export function getProvider(env: NodeJS.ProcessEnv = process.env): PaymentProvider {
  const choice = env.PAYMENT_PROVIDER?.trim().toLowerCase();

  if (choice === "mock") return new MockProvider(mockSecret(env));
  if (choice === "montonio") {
    const montonio = createMontonioProvider(env);
    if (!montonio) throw new PaymentError("not_configured");
    return montonio;
  }
  const montonio = createMontonioProvider(env);
  if (montonio) return montonio;
  throw new PaymentError("not_configured");
}

/**
 * Absolute origin for the URLs handed to the provider.
 *
 * PUBLIC_BASE_URL is the answer whenever it is set — a payment gateway must be
 * told a stable public URL, not whatever host header a proxy passed on. Falling
 * back to the request's own origin keeps localhost and Vercel previews working.
 */
export function publicBaseUrl(
  req: Request,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  try {
    return new URL(req.url).origin;
  } catch {
    return "";
  }
}
