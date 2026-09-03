/**
 * Montonio Stargate — GET /stores/payment-methods.
 *
 * Lists which payment methods this store has active: bank links per country
 * (each with its own logo), card payments, and MobilePay. Used only to put a
 * real logo next to each bank chip in checkout (UX fix 9) — the BIC code we
 * send as `preferredProvider` (public/shop2/app.js, BANK_CODES) travels
 * exactly as before either way; logoUrl is cosmetic, code is not.
 *
 * Field names below are read off Montonio's own docs, 03.09.2026:
 * https://docs.montonio.com/api/stargate/guides/payment-methods — see
 * docs/payments.md for the same list in prose, including the one place the
 * guide page and the reference page disagree with each other (the store-id
 * field: `uuid` on one, `id` on the other — we do not read either).
 *
 * Auth is a Bearer JWT of only `{ accessKey, exp }`, the same shape
 * src/lib/shipping/montonio.ts uses for the Shipping API — confirmed by
 * Montonio's own sample responses (a wrong/missing token comes back 401
 * `STORE_NOT_FOUND`), not by the Orders API's signed-body pattern.
 */

import { signHs256 } from "./jwt";
import { montonioBaseUrl, montonioConfigFromEnv, type MontonioConfig } from "./montonio";

const TOKEN_TTL_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 10_000;
/** The brief for this route asks for 6h; docs.montonio.com states no TTL of
    its own for this endpoint, so we set one rather than refetch per request. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface PaymentBank {
  code: string;
  name: string;
  country: string;
  logoUrl: string;
}

export interface PaymentMethods {
  banks: PaymentBank[];
  card: boolean;
  wallets: PaymentBank[];
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** `Authorization: Bearer <HS256 { accessKey, exp }>` — same recipe as Shipping. */
function authToken(config: MontonioConfig): string {
  return signHs256({ accessKey: config.accessKey }, config.secretKey, {
    expiresInSeconds: TOKEN_TTL_SECONDS,
  });
}

type RawBank = { code?: unknown; name?: unknown; logoUrl?: unknown };
type RawResponse = {
  paymentMethods?: {
    cardPayments?: { logoUrl?: unknown } | null;
    mobilePay?: { logoUrl?: unknown } | null;
    // keyed by country code (EE, LV, LT, FI, PL, …) — country is the object
    // key, there is no separate `country` field per Montonio's own example
    paymentInitiation?: { setup?: Record<string, { paymentMethods?: RawBank[] } | undefined> } | null;
  };
};

function mapBanks(raw: RawResponse): PaymentBank[] {
  const setup = raw.paymentMethods?.paymentInitiation?.setup;
  if (!setup || typeof setup !== "object") return [];
  const out: PaymentBank[] = [];
  for (const [country, group] of Object.entries(setup)) {
    for (const b of group?.paymentMethods ?? []) {
      const code = str(b.code);
      if (!code) continue;
      out.push({ code, name: str(b.name) || code, country: country.toUpperCase(), logoUrl: str(b.logoUrl) });
    }
  }
  return out;
}

/** Apple Pay / Google Pay are not a separate entry here — Montonio surfaces
    them as express buttons inside the card element itself, which is exactly
    why UX fix 10 is a static hint under "Банковская карта" rather than data
    from this route. MobilePay is the one genuinely separate wallet method. */
function normalize(raw: RawResponse): PaymentMethods {
  const wallets: PaymentBank[] = [];
  const mp = raw.paymentMethods?.mobilePay;
  if (mp) wallets.push({ code: "mobilepay", name: "MobilePay", country: "", logoUrl: str(mp.logoUrl) });
  return { banks: mapBanks(raw), card: !!raw.paymentMethods?.cardPayments, wallets };
}

type CacheEntry = { at: number; data: PaymentMethods };
/* On globalThis like shipping/montonio.ts's point cache: a warm serverless
   instance (or Next's dev reload) keeps the list instead of re-signing a JWT
   and calling Montonio on every checkout that reaches the payment step. */
const g = globalThis as unknown as { __rempirePayMethods?: CacheEntry };

export function resetPaymentMethodsCache(): void {
  g.__rempirePayMethods = undefined;
}

/**
 * `null` — never a throw — when there are no keys or Montonio would not
 * answer, same contract as fetchMontonioPickupPoints: the route falls back to
 * `not_configured`, and the checkout already knows how to draw plain-text
 * bank buttons when this is not there.
 */
export async function fetchPaymentMethods(
  env: NodeJS.ProcessEnv = process.env,
): Promise<PaymentMethods | null> {
  const config = montonioConfigFromEnv(env);
  if (!config) return null;

  const hit = g.__rempirePayMethods;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  let res: Response;
  try {
    res = await fetch(`${montonioBaseUrl(config.env)}/stores/payment-methods`, {
      headers: { accept: "application/json", authorization: `Bearer ${authToken(config)}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    console.error("[montonio payment-methods] unreachable —", err);
    return hit?.data ?? null;
  }
  if (!res.ok) {
    console.error("[montonio payment-methods]", res.status, (await res.text()).slice(0, 400));
    return hit?.data ?? null;
  }

  let raw: RawResponse;
  try {
    raw = (await res.json()) as RawResponse;
  } catch {
    return hit?.data ?? null;
  }

  const data = normalize(raw);
  g.__rempirePayMethods = { at: Date.now(), data };
  return data;
}
