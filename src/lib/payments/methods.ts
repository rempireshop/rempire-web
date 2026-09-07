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

/* ---------- «слишком много банков» — settings.payment_banks --------------- */

/**
 * Which of Montonio's banks the checkout may show.
 *
 * Dim, 07.09.2026: «There are too many banks to choose from — can we edit it
 * somehow?» Montonio has no answer to that. `GET /stores/payment-methods`
 * returns every bank the store has enabled, keyed by country, and its guide
 * documents no way to hide one — the only lever on its side is which
 * *countries* the store is signed up for. `preferredProvider` picks the bank a
 * shopper is sent to; it does not shorten the list. So the list is ours to
 * shorten, and this is the setting that does it:
 *
 *   settings.payment_banks = ["HABAEE2X", "EEUHEE2X", "LHVBEE22", …]
 *
 * Empty (the default) means "show them all" — a shop that has not chosen must
 * not silently lose a bank when Montonio adds one.
 *
 * Codes are stored as Montonio returns them and compared case-insensitively;
 * a code Montonio does not have is simply never matched, so a bank that
 * disappears from the store cannot empty the checkout.
 */
export function cleanBankFilter(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    const code = str(raw).toUpperCase();
    if (!code || code.length > 32 || !/^[A-Z0-9_.-]+$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
    if (out.length >= 40) break;
  }
  return out;
}

/**
 * The list minus the banks the owner switched off — **per country**.
 *
 * A country none of whose banks are named is left exactly as it was. Without
 * that rule an owner trimming the Estonian list to five would take every
 * Latvian bank away from a Latvian shopper too: the checkout falls back to the
 * whole array when the delivery country has no banks of its own
 * (`banksForCountry()` in public/shop2/app.js), and he would have been offered
 * Estonian banks for a parcel to Riga.
 *
 * An empty filter, or one that names nothing Montonio actually has, returns
 * the list untouched. The checkout must never end up with no chip at all.
 */
export function filterBanks(banks: PaymentBank[], allowed: string[]): PaymentBank[] {
  if (!allowed.length || !banks.length) return banks;
  const keep = new Set(allowed);
  const byCountry = new Map<string, PaymentBank[]>();
  for (const b of banks) {
    const c = b.country.toUpperCase();
    const group = byCountry.get(c);
    if (group) group.push(b);
    else byCountry.set(c, [b]);
  }
  const out: PaymentBank[] = [];
  for (const group of byCountry.values()) {
    const chosen = group.filter((b) => keep.has(b.code.toUpperCase()));
    out.push(...(chosen.length ? chosen : group));
  }
  return out;
}

type CacheEntry = { at: number; data: PaymentMethods };
/* On globalThis like shipping/montonio.ts's point cache: a warm serverless
   instance (or Next's dev reload) keeps the list instead of re-signing a JWT
   and calling Montonio on every checkout that reaches the payment step. */
const g = globalThis as unknown as { __rempirePayMethods?: CacheEntry };

/* `resetPaymentMethodsCache()` existed so a test could clear the entry above;
   no test ever called it (they set the clock or a fresh env instead). Removed
   07.09.2026 (docs/audit/2026-09-07-cleanup.md) — it was one assignment to
   `g.__rempirePayMethods`, and is in git at 448cbd7. */

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
