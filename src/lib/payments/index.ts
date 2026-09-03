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
 * PAYMENT_PROVIDER decides when it is set. When it is not, Montonio wins if its
 * keys are present and the mock provider takes over if they are not — so a
 * fresh clone with an empty .env.local still has a checkout that completes.
 */
export function getProvider(env: NodeJS.ProcessEnv = process.env): PaymentProvider {
  const choice = env.PAYMENT_PROVIDER?.trim().toLowerCase();

  if (choice === "mock") return new MockProvider(mockSecret(env));
  if (choice === "makecommerce") return new MakeCommerceProvider();
  if (choice === "montonio") {
    const montonio = createMontonioProvider(env);
    if (!montonio) throw new PaymentError("provider_unconfigured");
    return montonio;
  }
  return createMontonioProvider(env) ?? new MockProvider(mockSecret(env));
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
