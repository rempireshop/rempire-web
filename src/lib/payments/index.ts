import { MakeCommerceProvider } from "./makecommerce";
import { MockProvider, mockSecret } from "./mock";
import { createMontonioProvider } from "./montonio";
import { PaymentError, type PaymentProvider } from "./types";

export * from "./types";
export { MontonioProvider, mapMontonioStatus } from "./montonio";
export { MockProvider } from "./mock";
export { MakeCommerceProvider } from "./makecommerce";

/**
 * Which provider this deployment pays through.
 *
 * PAYMENT_PROVIDER decides when it is set. When it is not, Montonio is used if
 * its keys are present — and if they are not, this **throws**. A shop with no
 * payment provider must refuse to take payments, never invent one: the mock
 * provider signs its own "this order is paid" tickets, so falling back to it
 * silently is the same as publishing a free-order endpoint (audit C1).
 *
 * The mock provider is therefore reachable one way only: PAYMENT_PROVIDER=mock,
 * typed by a human who meant it. See docs/payments.md.
 */
export function getProvider(env: NodeJS.ProcessEnv = process.env): PaymentProvider {
  const choice = env.PAYMENT_PROVIDER?.trim().toLowerCase();

  if (choice === "mock") return new MockProvider(mockSecret(env));
  if (choice === "makecommerce") return new MakeCommerceProvider();
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
