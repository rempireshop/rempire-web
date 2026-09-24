/**
 * Montonio Shipping API v2 — pickup points, shipments and label files.
 *
 * Why this exists next to src/lib/parcel-points.ts: the carriers' own public
 * feeds cover Omniva (EE/LV/LT) and nothing else. DPD publishes no list at all
 * and Finland has none. Montonio resells Omniva, DPD, Itella SmartPosti and
 * Venipak behind **one** key pair — the same MONTONIO_ACCESS_KEY /
 * MONTONIO_SECRET_KEY the Orders API already uses — and it also registers
 * shipments and prints labels, so Renat stops retyping addresses into carrier
 * portals.
 *
 * Every field name below is copied from Montonio's own docs, read 03.09.2026:
 *   https://docs.montonio.com/api/shipping-v2/reference
 *   https://docs.montonio.com/api/shipping-v2/guides/shipping-methods
 *   https://docs.montonio.com/api/shipping-v2/guides/shipments
 *   https://docs.montonio.com/api/shipping-v2/guides/labels
 * See docs/shipping.md § «Montonio Shipping» for the same list in prose.
 *
 * Auth is a JWT, like the Orders API, but carried differently: Orders puts the
 * signed payload in the *body* (`{ data: <jwt> }`), Shipping puts a token whose
 * only claims are `accessKey` and `exp` in the **Authorization: Bearer** header
 * (reference § Authentication). Same HS256, same secret, same jwt.ts helper.
 *
 * Everything here fails soft. Without keys the pickup-point reader returns
 * `null` (the caller falls back to the public feeds) and the write calls throw
 * `not_configured`; a dead API never takes the checkout or the admin down.
 */

import { jsonbParam, query } from "@/lib/db";
import { signHs256 } from "@/lib/payments/jwt";
import { montonioConfigFromEnv, type MontonioConfig } from "@/lib/payments/montonio";
import { normalizeMethod, sniffCarrier } from "@/lib/shipping";
/* A leaf module (it imports the tariff mirror and nothing else), so this adds
   no cycle — see the header of src/lib/shipping/country-prices.ts. */
import { basisCost, withEstonianVat } from "@/lib/shipping/country-prices";
import {
  declaredWeightKg,
  getParcelSettings,
  parcelMetres,
  takesLockerSize,
  toLockerSize,
  type LockerSize,
} from "@/lib/shipping/parcel";
import type { ParcelPoint } from "@/lib/parcel-points";
import type { Order } from "@/lib/orders";
// SHIPPING_PROVIDER=mock — the e2e suite's carrier; see that file's header.
import { MOCK_LABEL_PREFIX, mockLabel, mockLabelPdf, mockShipment, shippingMockOn } from "./montonio-mock";

/* ---------- constants ---------------------------------------------------- */

const LIVE_BASE = "https://shipping.montonio.com/api/v2";
const SANDBOX_BASE = "https://sandbox-shipping.montonio.com/api/v2";

/** The docs recommend an hour on the auth token. */
const TOKEN_TTL_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 10_000;
/** Same six hours the carrier feeds are cached for — machine lists barely move. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Carriers Montonio can resell to us. Codes are Montonio's own `carrierCode`,
 * lowercased — Nova Post's is `novaPost` on the wire and `novapost` here, the
 * way every other code in this list is folded.
 *
 * Venipak left on 14.09.2026 (Ренат: «Venipak does not seem to be available,
 * so remove») and Nova Post joined the same day («From montonio page there is
 * Nova Post, so keep it actually»). Kept identical to SHOP_CARRIERS in
 * src/lib/shipping/country-prices.ts, asserted in
 * tests/shipping-country-prices.test.ts.
 */
export const MONTONIO_CARRIERS = ["omniva", "smartpost", "dpd", "unisend", "novapost"] as const;

/**
 * The spelling Montonio's own query strings want, which is not always ours.
 *
 * Every carrier code the shop has ever used was lowercase and identical on
 * both sides, so `carrierCode=${carrier}` was right by accident for four years
 * — and Nova Post is the first one where it is not. Montonio's enum is
 * **case-sensitive**: `carrierCode=novapost` answers HTTP 400 «carrierCode
 * must be one of the following values: smartpost, dpd, venipak, omniva,
 * unisend, latvian_post, inpost, orlen, novaPost, postnord», and only
 * `novaPost` answers 200. Lowercase is what the rest of the codebase stores
 * (orders.shipping.carrier, the rate table's keys, the chip ids), so the
 * translation happens here, at the wire, and nowhere else.
 *
 * An unknown carrier passes through unchanged: Montonio answering 400 for a
 * code nobody recognises is the right outcome, and better than guessing at a
 * capitalisation.
 */
const MONTONIO_WIRE_CODE: Record<string, string> = { novapost: "novaPost" };

/** Our lowercase carrier key as Montonio's `carrierCode` query parameter. */
export function montonioCarrierCode(carrier: string): string {
  const key = String(carrier || "").trim().toLowerCase();
  return MONTONIO_WIRE_CODE[key] ?? key;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* ---------- types -------------------------------------------------------- */

/** Our own vocabulary; Montonio says parcelMachine / parcelShop / postOffice. */
export type MontonioPointType = "parcel_machine" | "pickup_point" | "post_office";

export interface MontonioPoint {
  /** Montonio's pickup-point UUID — this is what a shipment is addressed to. */
  id: string;
  carrier: string;
  name: string;
  address: string;
  city: string;
  zip: string;
  country: string;
  /**
   * Montonio's pickup-point payload carries **no coordinates** (verified against
   * the reference response fields, 03.09.2026), so these are null on every
   * Montonio row and only the carrier feeds fill them in.
   */
  lat: number | null;
  lng: number | null;
  type: MontonioPointType;
}

export type MontonioShippingErrorCode =
  | "not_configured"
  | "unreachable"
  | "rejected"
  | "bad_response"
  | "not_found"
  | "no_courier_service"
  | "point_unresolved"
  | "not_shippable"
  | "label_not_ready";

export class MontonioShippingError extends Error {
  constructor(
    readonly code: MontonioShippingErrorCode,
    readonly detail?: string,
    /**
     * Montonio's own HTTP status, where there was one.
     *
     * It used to live only inside `detail` as text, which is fine for a
     * sentence and useless for a decision — and the decision that needed it is
     * «did Montonio refuse our keys». 401 `STORE_NOT_FOUND` and 403
     * `INVALID_TOKEN` are the two answers the owner gets on the Sunday he
     * pastes the live keys in by hand, and until 19.09.2026 every probe turned
     * them into `null`, i.e. «проверяем…» forever (audit 18.09.2026, F14).
     */
    readonly status?: number,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "MontonioShippingError";
  }
}

export interface CreateShipmentOptions {
  /**
   * Parcel weight in kg.
   *
   * Default: `declaredWeightKg()` — the ordinary parcel's real weight, 0.9 kg,
   * the same number whatever the order holds and whatever box is on the
   * card (Montonio prices the real weight, 24.09.2026). It is **not**
   * derived from the basket — see that function and F24.
   */
  weight?: number;
  /**
   * Metres, two decimals — `POST /shipments` is metric where
   * `POST /shipping-methods/rates` is centimetres, and both are right.
   *
   * Given explicitly, they always go out. Left out, they are filled from the
   * shop's declared carton (`settings.shipping_parcel`, src/lib/shipping/parcel.ts)
   * **only where Montonio says the route requires them** —
   * `constraints.parcelDimensionsRequired`. A route that does not require them
   * is still sent a parcel without them, exactly as before, so nothing this
   * adds can move a size tier on a booking that already worked.
   */
  length?: number;
  width?: number;
  height?: number;
  /**
   * `XS | S | M | L | XL` — the locker door, chosen at label time.
   *
   * Only ever sent for a `pickupPoint` shipment whose carrier takes it
   * (Unisend, Latvian Post, SmartPosti — `takesLockerSize()`). Omitted, the
   * contract's own `defaultLockerSize` applies; with neither, SmartPosti
   * issues no drop-off code at all, which is the blank line Renat reported on
   * 13.09.2026.
   */
  lockerSize?: string;
  /** Overrides the carrier stored on the order (see carrierHint). */
  carrier?: string;
  /** Montonio Payments order uuid, so Montonio links parcel ↔ payment. */
  montonioOrderUuid?: string | null;
  /** false leaves registration asynchronous (no tracking code in the reply). */
  synchronous?: boolean;
}

export interface MontonioShipment {
  provider: "montonio";
  shipmentId: string;
  /** pending | registered | registrationFailed | labelsCreated | … */
  status: string;
  carrier: string;
  country: string;
  method: "pickupPoint" | "courier";
  /** parcels[0].carrierParcelId — the carrier's own tracking number. */
  trackingCode: string;
  /** parcels[0].trackingLink — the carrier's public tracking page. */
  trackingUrl: string;
  /** parcels[0].dropOffPin — hand the parcel over without a printed label. */
  dropOffPin: string;
  /**
   * The door size actually SENT on `shippingMethod.lockerSize`, or undefined.
   *
   * Reported rather than re-derived, because the two sides disagreed. The
   * request sends a size only when the carrier HINT takes one; the route that
   * records the choice and teaches the suggestion asked the same question of
   * the carrier in Montonio's REPLY. An order whose stored carrier is empty
   * and whose point is a Montonio UUID books SmartPosti with no size at all
   * and was then recorded as having chosen one, in the audit row too (audit
   * F28.2). What was sent is knowable exactly here and nowhere else.
   */
  lockerSize?: LockerSize;
  labelUrl?: string;
  /** The page the stored labelUrl was made for — a request for the other
      size makes a new file rather than serving this one. */
  labelSize?: "A4" | "A6";
  /**
   * The journal's undo of «Создать этикетку». A registered parcel cannot be
   * taken back at Montonio, so undo does not delete anything: it sets this
   * flag, the card shows the «Этикетка» step as not done again, and the
   * next «Создать этикетку» clears it and reuses this same shipment instead
   * of booking a second one (POST /api/admin/shipments). Written by
   * PATCH /api/admin/orders/<id> { labelStep }.
   */
  dismissed?: boolean;
  createdAt: string;
}

export interface MontonioLabelFile {
  labelFileId: string;
  status: string;
  url: string;
}

/* ---------- configuration & transport ------------------------------------ */

export function montonioShippingBaseUrl(env: "sandbox" | "live"): string {
  return env === "live" ? LIVE_BASE : SANDBOX_BASE;
}

/** The Shipping API shares the Payments key pair, so it shares its reader. */
export function montonioShippingConfig(
  env: NodeJS.ProcessEnv = process.env,
): MontonioConfig | null {
  return montonioConfigFromEnv(env);
}

export function isMontonioShippingConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return montonioShippingConfig(env) !== null;
}

/** `Authorization: Bearer <HS256 { accessKey, exp }>` — reference § Authentication. */
export function shippingAuthToken(config: MontonioConfig): string {
  return signHs256({ accessKey: config.accessKey }, config.secretKey, {
    expiresInSeconds: TOKEN_TTL_SECONDS,
  });
}

async function call<T>(
  config: MontonioConfig,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const url = `${montonioShippingBaseUrl(config.env)}${path}`;
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${shippingAuthToken(config)}`,
  };
  if (init?.body !== undefined) headers["content-type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? "GET",
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new MontonioShippingError("unreachable", path);
  }

  const text = await res.text();
  if (res.status === 404) throw new MontonioShippingError("not_found", path, 404);
  if (!res.ok) {
    console.error("[montonio shipping]", init?.method ?? "GET", path, res.status, text.slice(0, 400));
    throw new MontonioShippingError("rejected", `${res.status} ${text.slice(0, 300)}`, res.status);
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new MontonioShippingError("bad_response", path);
  }
}

/* ---------- read-only probes: what a readiness screen may conclude -------- */

/**
 * The answer to one read-only question asked of Montonio, refusals included.
 *
 * Every probe on this screen «fails soft» — a section that could not be asked
 * must not take the screen down. But *failing* soft and *saying nothing* are
 * different things: until 19.09.2026 a 401 and a timeout both arrived as
 * `null`, and the panel printed «Проверяем…» to an owner whose keys Montonio
 * had just refused. So the failure carries its status, and the row that is
 * built from it can tell him which of the two happened.
 */
export type MontonioProbe<T> =
  | { ok: true; data: T }
  | { ok: false; status: number | null; code: MontonioShippingErrorCode };

function probeFailure(err: unknown): { ok: false; status: number | null; code: MontonioShippingErrorCode } {
  if (err instanceof MontonioShippingError) {
    return { ok: false, status: typeof err.status === "number" ? err.status : null, code: err.code };
  }
  return { ok: false, status: null, code: "unreachable" };
}

/* ---------- pickup points ------------------------------------------------ */

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v);
}

function pointType(raw: unknown): MontonioPointType {
  switch (str(raw)) {
    case "parcelMachine":
      return "parcel_machine";
    case "postOffice":
      return "post_office";
    default:
      // parcelShop, and anything Montonio adds later, is a counter
      return "pickup_point";
  }
}

/**
 * `{ pickupPoints: [...], countryCode }` → our shape. Field names are
 * Montonio's: id, name, type, streetAddress, locality, postalCode, carrierCode.
 */
export function mapMontonioPickupPoints(
  body: unknown,
  fallbackCarrier = "",
  fallbackCountry = "",
): MontonioPoint[] {
  const raw = (body as { pickupPoints?: unknown } | null)?.pickupPoints;
  if (!Array.isArray(raw)) return [];
  const country = (
    str((body as { countryCode?: unknown }).countryCode) || fallbackCountry
  ).toUpperCase();

  const out: MontonioPoint[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const id = str(r.id);
    const name = str(r.name);
    if (!id || !name) continue;
    out.push({
      id,
      carrier: (str(r.carrierCode) || fallbackCarrier).toLowerCase(),
      name,
      address: str(r.streetAddress),
      city: str(r.locality),
      zip: str(r.postalCode),
      country,
      lat: null,
      lng: null,
      type: pointType(r.type),
    });
  }
  return out;
}

type CacheEntry = { at: number; points: MontonioPoint[] };
/* Cached on globalThis so Next's dev reloads and warm serverless instances keep
   the list instead of re-downloading it for every keystroke of the search. */
const g = globalThis as unknown as { __rempireMontonioPoints?: Map<string, CacheEntry> };
const cache: Map<string, CacheEntry> = (g.__rempireMontonioPoints ??= new Map());

export function resetMontonioPointsCache(): void {
  cache.clear();
}

/* ---------- constraints: does this route demand a measured box? ------------
 *
 * `GET /shipping-methods` carries, on every carrier/method row, a
 * `constraints.parcelDimensionsRequired` boolean, and the reference's own Note
 * beside it is an instruction: *«Always check the flag in the API response for
 * accurate requirements … conditionally require dimension inputs»*. Where it
 * is true, `POST /shipments` without `length`/`width`/`height` is a 400 and
 * the parcel never books. Nothing here read it until 18.09.2026
 * (docs/montonio-shipping-audit.md § 1.6), so those routes simply did not work.
 *
 * The answer is one document for the whole store — every country, every
 * carrier — so it is cached whole rather than per route, on the same
 * globalThis and the same six hours as the pickup points above: what a
 * carrier requires changes when Montonio re-cuts a contract, not between two
 * labels.
 */
type MethodRow = {
  type?: string;
  constraints?: { parcelDimensionsRequired?: unknown };
};
type CountryRow = {
  countryCode?: string;
  carriers?: Array<{ carrierCode?: string; shippingMethods?: MethodRow[] }>;
};
type MethodsCache = { at: number; countries: CountryRow[] };
const mg = globalThis as unknown as { __rempireMontonioMethods?: MethodsCache };

/** Forgets the cached `/shipping-methods` document — the tests set another. */
export function resetMontonioMethodsCache(): void {
  mg.__rempireMontonioMethods = undefined;
}

async function shippingMethodRows(config: MontonioConfig): Promise<CountryRow[]> {
  const hit = mg.__rempireMontonioMethods;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.countries;
  const body = await call<{ countries?: CountryRow[] }>(config, "/shipping-methods");
  const countries = body.countries ?? [];
  mg.__rempireMontonioMethods = { at: Date.now(), countries };
  return countries;
}

/**
 * Must this carrier be given the box's measurements on this route?
 *
 * `null` — never a throw — when the question cannot be answered: no keys, a
 * carrier the store has not activated there, or Montonio not replying. The
 * caller treats `null` as «leave it out», which is exactly what the shop did
 * before this function existed, so a network blip cannot start sending
 * dimensions on a route that never had them and cannot move a size tier.
 */
export async function parcelDimensionsRequired(
  carrier: string,
  country: string,
  type: "pickupPoint" | "courier",
): Promise<boolean | null> {
  const config = montonioShippingConfig();
  if (!config) return null;
  const cc = String(country || "").toUpperCase();
  const code = String(carrier || "").trim().toLowerCase();
  if (!code) return null;
  try {
    const countries = await shippingMethodRows(config);
    const row = countries.find((c) => str(c?.countryCode).toUpperCase() === cc);
    if (!row) return null;
    /* Both sides lower-cased, which is how every other reader in this file
       compares a carrierCode: Montonio spells one of them `novaPost` on the
       wire and the shop spells it `novapost` everywhere else. */
    const carrierRow = (row.carriers ?? []).find(
      (c) => str(c?.carrierCode).toLowerCase() === code,
    );
    if (!carrierRow) return null;
    const method = (carrierRow.shippingMethods ?? []).find((m) => str(m?.type) === type);
    if (!method) return null;
    return method.constraints?.parcelDimensionsRequired === true;
  } catch (err) {
    console.error("[montonio shipping] shipping-methods constraints failed —", err);
    return null;
  }
}

/**
 * Which carriers this store has active in a country, from `GET /shipping-methods`.
 * Only carriers that actually offer a `pickupPoint` method come back.
 */
export async function fetchMontonioPickupCarriers(country: string): Promise<string[] | null> {
  const config = montonioShippingConfig();
  if (!config) return null;
  const cc = String(country || "").toUpperCase();
  try {
    const body = await call<{
      countries?: Array<{
        countryCode?: string;
        carriers?: Array<{ carrierCode?: string; shippingMethods?: Array<{ type?: string }> }>;
      }>;
    }>(config, "/shipping-methods");
    const row = (body.countries ?? []).find((c) => str(c?.countryCode).toUpperCase() === cc);
    if (!row) return [];
    return (row.carriers ?? [])
      .filter((c) => (c?.shippingMethods ?? []).some((m) => str(m?.type) === "pickupPoint"))
      .map((c) => str(c?.carrierCode).toLowerCase())
      .filter(Boolean);
  } catch (err) {
    console.error("[montonio shipping] shipping-methods failed —", err);
    return null;
  }
}

async function fetchOneCarrier(
  config: MontonioConfig,
  carrier: string,
  country: string,
): Promise<MontonioPoint[]> {
  const key = `${carrier}:${country}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.points;

  const body = await call<unknown>(
    config,
    `/shipping-methods/pickup-points?carrierCode=${encodeURIComponent(montonioCarrierCode(carrier))}` +
      `&countryCode=${encodeURIComponent(country)}`,
  );
  const points = mapMontonioPickupPoints(body, carrier, country);
  cache.set(key, { at: Date.now(), points });
  return points;
}

export interface PickupPointQuery {
  country: string;
  /** One carrier code; omitted means every carrier active in that country. */
  carrier?: string;
  /** Montonio's own filter: parcelMachine | parcelShop | postOffice. */
  type?: string;
}

/**
 * Pickup points for a country, normalised. `null` — and never a throw — when
 * there are no keys or Montonio would not answer, so the caller can fall back
 * to the carrier feeds. A carrier that fails on its own is skipped, not fatal.
 */
export async function fetchMontonioPickupPoints(
  opts: PickupPointQuery,
): Promise<MontonioPoint[] | null> {
  const config = montonioShippingConfig();
  if (!config) return null;

  const country = String(opts.country || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return null;

  let carriers: string[];
  if (opts.carrier) {
    carriers = [opts.carrier.toLowerCase()];
  } else {
    const active = await fetchMontonioPickupCarriers(country);
    if (active === null) return null;
    carriers = active;
  }
  if (!carriers.length) return [];

  const wanted = opts.type ? pointType(opts.type) : null;
  const out: MontonioPoint[] = [];
  let answered = false;
  for (const carrier of carriers) {
    try {
      const points = await fetchOneCarrier(config, carrier, country);
      answered = true;
      for (const p of points) if (!wanted || p.type === wanted) out.push(p);
    } catch (err) {
      console.error(`[montonio shipping] pickup points ${carrier}/${country} failed —`, err);
    }
  }
  return answered ? out : null;
}

/* ---------- rates (cost quote) -------------------------------------------- */

/** One parcel's measurements for a rate quote — Montonio wants cm and kg. */
export interface RateParcelItem {
  length: number;
  width: number;
  height: number;
  weight: number;
  quantity?: number;
}

export interface MontonioRate {
  carrier: string;
  /** "pickupPoint" maps to our "parcel"; "courier" to our "courier". */
  methodType: "pickupPoint" | "courier";
  /** Montonio's own subtype code — parcelMachine/postOffice/parcelShop, or standard/standardB2B for a courier. */
  subtype: string;
  /**
   * EUR **incl. Estonian VAT** — the quoted `rate` grossed up, not the raw
   * field. Montonio answers `rate` ex-VAT (confirmed 22.09.2026) and
   * everything downstream — the static mirror it is preferred over, the shelf
   * prices it is compared against — is gross, so the conversion happens here,
   * once, rather than in each of the callers. See `withEstonianVat()` in
   * ./country-prices.ts.
   */
  price: number;
  currency: string;
}

/**
 * `POST /shipping-methods/rates` — reference § "Calculate shipping costs",
 * confirmed to exist 03.09.2026 (see docs/shipping.md § «Тарифы Montonio»).
 * One call prices every carrier and method this store has active for a single
 * destination country against one parcel shape; there is no per-carrier or
 * per-method request. Every `price` it returns is gross: Montonio quotes
 * `rate` ex-VAT, and this is where that becomes a number the rest of the
 * shipping layer can compare with anything else. `null` — never a throw —
 * when there are no keys or Montonio would not answer, exactly like the
 * pickup-point reader, so a caller
 * (src/lib/shipping/tariffs.ts) can fall back to the static table without a
 * try/catch of its own.
 */
export async function fetchMontonioRates(
  destination: string,
  items: RateParcelItem[],
): Promise<MontonioRate[] | null> {
  const config = montonioShippingConfig();
  if (!config) return null;
  const cc = String(destination || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc) || !items.length) return null;

  try {
    const body = await call<{
      carriers?: Array<{
        carrierCode?: string;
        shippingMethods?: Array<{
          type?: string;
          subtypes?: Array<{ code?: string; rate?: string | number; currency?: string }>;
        }>;
      }>;
    }>(config, "/shipping-methods/rates", {
      method: "POST",
      body: {
        destination: cc,
        parcels: [
          {
            items: items.map((i) => ({
              length: i.length,
              width: i.width,
              height: i.height,
              dimensionUnit: "cm",
              weight: i.weight,
              weightUnit: "kg",
              quantity: i.quantity && i.quantity > 0 ? Math.round(i.quantity) : 1,
            })),
          },
        ],
      },
    });

    const out: MontonioRate[] = [];
    for (const carrierRow of body.carriers ?? []) {
      const carrier = str(carrierRow.carrierCode).toLowerCase();
      if (!carrier) continue;
      for (const method of carrierRow.shippingMethods ?? []) {
        const methodType: "pickupPoint" | "courier" =
          str(method.type) === "courier" ? "courier" : "pickupPoint";
        for (const sub of method.subtypes ?? []) {
          const net = Number(sub.rate);
          /* A rate of exactly 0 is not a free delivery, it is **no rate**.
             Montonio answers `"rate": "0"` for a carrier/method pair this
             store has no priced tier for — DPD's Estonian courier is one, and
             it is a route that really costs 6.82 €. Taken as a price it
             printed «тариф Montonio: €0 · DPD» in the panel, which would have
             told the owner that any number he typed was above cost, and it
             would have become the basis of a shelf price wherever the fill
             and the cost hints read the cheapest carrier. A courier that
             costs nothing does not exist; the row is dropped like a negative
             one and the caller falls back to the static mirror, which knows
             the route's real price (src/lib/shipping/tariffs.ts). */
          if (!Number.isFinite(net) || net <= 0) continue;
          out.push({
            carrier,
            methodType,
            subtype: str(sub.code) || "standard",
            /* `rate` is ex-VAT — Montonio confirmed it on 22.09.2026, and its
               reference still names no tax field either way. Stored raw, it
               was a live cost 24 % under the static row it replaces in
               src/lib/shipping/tariffs.ts, which is the number the admin's
               cost hints and every shelf price derived from a cost are built
               on. The gross-up belongs here, on the one line that turns
               Montonio's field into our `price`. */
            price: withEstonianVat(net),
            currency: str(sub.currency) || "EUR",
          });
        }
      }
    }
    return out;
  } catch (err) {
    console.error(`[montonio shipping] rates ${cc} failed —`, err);
    return null;
  }
}

/* ---------- carriers: the brand marks -------------------------------------- */

/** One carrier as `GET /carriers` reports it — the three fields a chip needs. */
export interface MontonioCarrier {
  /** Montonio's own `carrierCode`: omniva | smartpost | dpd | venipak | unisend. */
  code: string;
  name: string;
  /** An SVG on Montonio's public host, e.g. …/carrier_logos/smartpost.svg. */
  logoUrl: string;
}

type CarrierCacheEntry = { at: number; carriers: MontonioCarrier[] };
/* Same six hours and the same globalThis home as the pickup-point cache above:
   the list of carriers a store resells changes when Renat signs a contract,
   not between two checkouts. */
const gc = globalThis as unknown as { __rempireMontonioCarriers?: CarrierCacheEntry };

/** Forgets the cached list — the tests set a different answer per case. */
export function resetMontonioCarriersCache(): void {
  gc.__rempireMontonioCarriers = undefined;
}

/**
 * The carriers this store has, each with its brand mark — `GET /carriers`.
 *
 * Dim, 08.09.2026: «покажите фирменный знак и название, как уже сделано у
 * банков». This is the shipping half of that answer, and it is deliberately
 * built like the payments half (`fetchPaymentMethods()` in
 * src/lib/payments/methods.ts): the same Bearer-JWT auth, the same six-hour
 * cache, the same `null`-not-a-throw contract. `logoUrl` is the whole point of
 * this endpoint for us — none of the three `/shipping-methods` paths carries
 * one (reference, read 07.09.2026), which is why the chips were coloured dots
 * until today.
 *
 * `null` — never a throw — when there are no keys or Montonio would not
 * answer, exactly like every other reader here: the checkout keeps the dots.
 */
export async function fetchMontonioCarriers(): Promise<MontonioCarrier[] | null> {
  const config = montonioShippingConfig();
  if (!config) return null;

  const hit = gc.__rempireMontonioCarriers;
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.carriers;

  try {
    const body = await call<{
      carriers?: Array<{ code?: string; name?: string; logoUrl?: string | null }>;
    }>(config, "/carriers");
    const out: MontonioCarrier[] = [];
    for (const carrier of body.carriers ?? []) {
      const code = str(carrier?.code).toLowerCase();
      if (!code) continue;
      out.push({ code, name: str(carrier?.name) || code, logoUrl: str(carrier?.logoUrl) });
    }
    gc.__rempireMontonioCarriers = { at: Date.now(), carriers: out };
    return out;
  } catch (err) {
    console.error("[montonio shipping] carriers failed —", err);
    return hit?.carriers ?? null;
  }
}

/* ---------- returns: the one thing the API says about them ---------------- */

/** One carrier contract as `GET /carriers` reports it, returns fields only. */
export interface MontonioCarrierReturns {
  carrier: string;
  /** ISO country the contract covers. */
  country: string;
  /** true = the merchant's own carrier agreement, false = "by Montonio". */
  directContract: boolean;
  /** `contracts[].returnsAllowed` — "Whether returns are enabled for this contract". */
  returnsAllowed: boolean;
  /** `contracts[].daysAllowedForReturns` — "Number of days allowed for returns". */
  daysAllowedForReturns: number | null;
}

/**
 * Whether returns are switched on, per carrier contract — `GET /carriers`.
 *
 * This is the **whole** of Montonio's Shipping API v2 on the subject. There is
 * no return endpoint, no return shipment, no return label and no return
 * webhook (reference, read 07.09.2026: /carriers, /shipping-methods and its
 * three sub-paths, /shipments, /label-files, /webhooks — and nothing else).
 * Returns are a per-carrier checkbox in the Montonio partner portal
 * («Yes, send SMS return code»), the code goes to the customer by SMS and
 * «You as a merchant do not see the parcel return codes»
 * (help.montonio.com/en/articles/212957). So the most this shop can ever know
 * is what this function reads: is the switch on, and for how many days.
 *
 * `null` — never a throw — when there are no keys or Montonio would not
 * answer, like every other reader here.
 */
export async function fetchMontonioCarrierReturns(): Promise<MontonioCarrierReturns[] | null> {
  const config = montonioShippingConfig();
  if (!config) return null;
  try {
    const body = await call<{
      carriers?: Array<{
        code?: string;
        contracts?: Array<{
          country?: string;
          isDirectContract?: boolean;
          returnsAllowed?: boolean;
          daysAllowedForReturns?: number | null;
        }> | null;
      }>;
    }>(config, "/carriers");
    const out: MontonioCarrierReturns[] = [];
    for (const carrier of body.carriers ?? []) {
      const code = str(carrier?.code).toLowerCase();
      if (!code) continue;
      for (const contract of carrier.contracts ?? []) {
        const days = contract?.daysAllowedForReturns;
        out.push({
          carrier: code,
          country: str(contract?.country).toUpperCase(),
          directContract: contract?.isDirectContract === true,
          returnsAllowed: contract?.returnsAllowed === true,
          daysAllowedForReturns: typeof days === "number" && Number.isFinite(days) ? days : null,
        });
      }
    }
    return out;
  } catch (err) {
    console.error("[montonio shipping] carriers failed —", err);
    return null;
  }
}

/* ---------- merging with the public feeds -------------------------------- */

/** A carrier-feed point in Montonio vocabulary, so the two lists can be one. */
export function fromParcelPoint(p: ParcelPoint): MontonioPoint {
  return {
    id: p.id,
    carrier: p.carrier,
    name: p.name,
    address: p.address,
    city: p.city,
    zip: p.zip,
    country: p.country,
    lat: Number.isFinite(p.lat) ? p.lat : null,
    lng: Number.isFinite(p.lng) ? p.lng : null,
    type: p.type === "office" ? "post_office" : "parcel_machine",
  };
}

function pointKey(p: MontonioPoint): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return `${norm(p.carrier)}|${norm(p.zip)}|${norm(p.name)}`;
}

/**
 * Montonio first, the feeds behind it.
 *
 * Two rules, in this order:
 *   1. a carrier Montonio answered for is Montonio's — feed rows for it are
 *      dropped whole. Only Montonio's ids can address a shipment, and the two
 *      sources spell the same locker differently often enough that a per-row
 *      comparison would leave doubles behind.
 *   2. what is left is deduped by carrier + zip + name.
 */
export function mergePoints(primary: MontonioPoint[], extra: MontonioPoint[]): MontonioPoint[] {
  const carriers = new Set(primary.map((p) => p.carrier));
  const seen = new Set(primary.map(pointKey));
  const out = primary.slice();
  for (const p of extra) {
    if (carriers.has(p.carrier)) continue;
    const key = pointKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/* ---------- coordinates for Montonio's points ----------------------------- */

const STOP_WORDS = /\b(pakiautomaat|pakomat|pakomāts|paštomatas|parcel|machine|locker|terminal|postipunkt|post office|postkontor|automaat)\b/g;

/** "Tallinna Balti Jaama pakiautomaat" → "tallinna balti jaama" — the carrier
    word and punctuation differ between Montonio and the carriers' own lists,
    the place name does not. */
function placeName(s: string): string {
  return s
    .toLowerCase()
    .replace(STOP_WORDS, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function digits(s: string): string {
  return s.replace(/\D+/g, "");
}

/**
 * Montonio's list is the one that can address a shipment, but it carries no
 * coordinates (see MontonioPoint.lat), so on its own it cannot be drawn on
 * the map. The carriers' public feeds carry coordinates but ids the shipment
 * API cannot use. This copies lat/lng from a feed row onto the Montonio row
 * that is the same locker: first by normalised place name, then by zip +
 * street number, and as a last resort by a zip only one feed row has. A
 * Montonio point that already has coordinates, or that matches nothing, is
 * left as it is — a wrong pin would send someone to the wrong locker, a
 * missing pin just leaves that locker to the list.
 */
export function enrichCoordinates(points: MontonioPoint[], feed: MontonioPoint[]): { points: MontonioPoint[]; matched: number } {
  const byName = new Map<string, MontonioPoint>();
  const byZip = new Map<string, MontonioPoint[]>();
  for (const f of feed) {
    if (f.lat === null || f.lng === null) continue;
    const k = `${f.carrier}|${f.country}|${placeName(f.name)}`;
    if (!byName.has(k)) byName.set(k, f);
    const z = `${f.carrier}|${f.country}|${digits(f.zip)}`;
    const list = byZip.get(z);
    if (list) list.push(f);
    else byZip.set(z, [f]);
  }
  let matched = 0;
  const out = points.map((p) => {
    if (p.lat !== null && p.lng !== null) return p;
    let hit = byName.get(`${p.carrier}|${p.country}|${placeName(p.name)}`);
    if (!hit) {
      const sameZip = byZip.get(`${p.carrier}|${p.country}|${digits(p.zip)}`) ?? [];
      const house = digits(p.address);
      hit = sameZip.find((f) => house && digits(f.address) === house);
      if (!hit && sameZip.length === 1) hit = sameZip[0];
    }
    if (!hit) return p;
    matched += 1;
    return { ...p, lat: hit.lat, lng: hit.lng };
  });
  return { points: out, matched };
}

/* ---------- shipments ---------------------------------------------------- */

/**
 * Every destination the checkout can send a parcel to, with its calling code.
 *
 * `receiver.phoneCountryCode` is **required** on every shipment, pickup point
 * or courier (reference § Create Shipment → receiver), and the shipments guide
 * names the cost of getting it wrong: «A common issue causing
 * [registrationFailed] is an incorrect receiver phone number».
 *
 * Until 18.09.2026 this held four rows — EE, LV, LT, FI — and everything else
 * fell through to "372". The shop sells to thirty-two countries
 * (tools/fetch-montonio-tariffs.mjs DESTINATIONS), so a German customer was
 * booked as +372 with a German number, an Italian likewise. It had never been
 * noticed because **the sandbox does not check**: «The POST /shipments endpoint
 * skips phone number and address validation» (sandbox guide). Live does.
 */
const PHONE_PREFIX: Record<string, string> = {
  EE: "372", LV: "371", LT: "370", FI: "358",
  AT: "43", BE: "32", BG: "359", CH: "41", CY: "357", CZ: "420", DE: "49", DK: "45",
  ES: "34", FR: "33", GB: "44", GR: "30", HR: "385", HU: "36", IE: "353", IS: "354",
  IT: "39", LI: "423", LU: "352", MT: "356", NL: "31", NO: "47", PL: "48", PT: "351",
  RO: "40", SE: "46", SI: "386", SK: "421",
};

/** Estonia: the shop's own country, and the only sane guess for a country we do not serve. */
const DEFAULT_PHONE_PREFIX = "372";

/**
 * The four prefixes a **bare** number is scanned for.
 *
 * Deliberately not the whole table above. Scanning a plain digit string for
 * any of thirty-two calling codes starts eating real subscriber numbers: an
 * eight-digit Danish number may begin "45", an Italian mobile begins "39", and
 * both would be read as their own country code and truncated. The Baltic four
 * were safe to scan for and have been scanned for since this function was
 * written, so they stay exactly as they were; every other country is only
 * split when the customer actually wrote the number in international form.
 */
const BARE_PREFIXES = ["372", "371", "370", "358"];

/**
 * The calling codes an **explicitly international** number is split on.
 *
 * Wider than PHONE_PREFIX on purpose. That table is the thirty-two countries
 * the shop DELIVERS to, and until 19.09.2026 it was also the whole of what a
 * "+…" number was scanned for — so a Russian, Ukrainian or Belarusian mobile
 * typed by a customer standing in Tallinn found no match and was booked as
 * `372 79991234567`: the destination's code with the foreign one still inside
 * the subscriber number. Montonio answers that with `registrationFailed`, or
 * the carrier sends its collection SMS to nobody (audit F22). The shop sells
 * to Estonia; the people who live there do not all carry Estonian numbers.
 *
 * Still not exhaustive — there are some two hundred of these — and it does not
 * need to be: a country nobody here has ever dialled falls through to the
 * destination's code exactly as before, which is no worse than it was. What is
 * listed is everywhere a customer of this shop plausibly carries a number
 * from. Longest match wins, so "372" is never read as "37".
 */
const INTL_EXTRA_PREFIXES = [
  "7", "380", "375", "373", "995", "374", "994", "998", "996", "992", "993",
  "1", "90", "972", "971", "966", "20", "355", "376", "377", "378", "381",
  "382", "383", "387", "389", "212", "216", "234", "254", "27", "51", "52",
  "54", "55", "56", "57", "58", "60", "61", "62", "63", "64", "65", "66",
  "81", "82", "84", "86", "91", "92", "94", "98",
];

/**
 * Montonio wants the country code and the rest of the number in two fields.
 *
 * A number written internationally ("+49 151 23456789", "0049 151 …") is split
 * on the longest calling code it starts with. Anything else keeps the delivery
 * country's code, except for the four Baltic/Finnish prefixes, which are still
 * recognised bare ("372 5810 7505"). The digit floors — six for a bare prefix,
 * four after an explicit "+" — stop a short landline that merely starts with
 * "372" from losing its first three digits.
 *
 * What this deliberately does NOT do is touch a national trunk "0". Germany
 * drops it ("0151…" → "+49 151…"), Italy keeps it ("06…" → "+39 06…"), and
 * guessing per country is exactly the kind of invention that put "372" on a
 * German parcel in the first place.
 */
export function splitPhone(raw: unknown, country: string): {
  phoneCountryCode: string;
  phoneNumber: string;
} {
  const text = String(raw ?? "");
  const international = /^\s*(?:\+|00)/.test(text);
  const digits = text.replace(/\D+/g, "").replace(/^00/, "");

  if (international) {
    let best = "";
    for (const cc of [...Object.values(PHONE_PREFIX), ...INTL_EXTRA_PREFIXES]) {
      if (cc.length > best.length && digits.startsWith(cc) && digits.length - cc.length >= 4) best = cc;
    }
    if (best) return { phoneCountryCode: best, phoneNumber: digits.slice(best.length) };
  } else {
    for (const cc of BARE_PREFIXES) {
      if (digits.startsWith(cc) && digits.length - cc.length >= 6) {
        return { phoneCountryCode: cc, phoneNumber: digits.slice(cc.length) };
      }
    }
  }

  return {
    phoneCountryCode: PHONE_PREFIX[String(country || "").toUpperCase()] ?? DEFAULT_PHONE_PREFIX,
    phoneNumber: digits,
  };
}

function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * What a basket of this many units would really weigh — roughly a bottle of
 * shampoo per line plus the box.
 *
 * **Not what the shop declares any more.** It was `parcels[].weight` on every
 * `POST /shipments` until 19.09.2026, which quietly contradicted the owner's
 * «no weight modelling»: from three units on, the guess was higher than the
 * carton and therefore the thing Montonio billed (audit 18.09.2026, F24). The
 * declared figure is now `declaredWeightKg()` — the box, and only the box.
 *
 * It stays because a *price* question still needs it: `unitsToKg()` in
 * `tools/lib/delivery-pricing.mjs` asks «предположим, в заказе N банок» and
 * compares carrier bands at that weight, and a test holds the two formulas
 * equal. Estimating what a parcel weighs in order to study tariffs is a
 * different act from declaring it to a carrier.
 */
export function estimateWeightKg(order: Pick<Order, "items">): number {
  const units = (order.items ?? []).reduce(
    (n, i) => n + (i.kind === "gift" ? 0 : Math.max(1, Number(i.qty) || 1)),
    0,
  );
  return Math.min(30, Math.max(0.3, round2(0.4 * units + 0.2)));
}

function addressOf(order: Order): Record<string, unknown> {
  const a = (order.shipping?.address ?? {}) as Record<string, unknown>;
  return a;
}

function pick(a: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = a[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/**
 * The stored pointId is Montonio's UUID when the shopper picked from a Montonio
 * list, and a feed id ("omniva-96243") when they picked from a carrier feed.
 * The second case is matched back by name, which is what both lists agree on.
 */
async function resolvePickupPointId(order: Order, carrier: string): Promise<string> {
  const ship = order.shipping ?? { method: "", country: "EE", price: 0 };
  const stored = String(ship.pointId ?? "").trim();
  if (UUID_RE.test(stored)) return stored;

  const name = String(ship.pointName ?? "").trim().toLowerCase();
  if (!name) throw new MontonioShippingError("point_unresolved", stored || "no point on the order");

  const points = await fetchMontonioPickupPoints({
    country: ship.country,
    carrier: carrier || undefined,
  });
  if (!points) throw new MontonioShippingError("point_unresolved", "montonio has no list to match against");

  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const exact = points.find((p) => norm(p.name) === norm(name));
  if (exact) return exact.id;
  const loose = points.find((p) => norm(p.name).includes(norm(name)) || norm(name).includes(norm(p.name)));
  if (loose) return loose.id;
  throw new MontonioShippingError("point_unresolved", ship.pointName ?? stored);
}

async function courierServiceOf(
  config: MontonioConfig,
  carrier: string,
  country: string,
): Promise<string> {
  const body = await call<{
    courierServices?: Array<{ id?: string; type?: string }>;
  }>(
    config,
    `/shipping-methods/courier-services?carrierCode=${encodeURIComponent(montonioCarrierCode(carrier))}` +
      `&countryCode=${encodeURIComponent(country)}`,
  );
  const services = body.courierServices ?? [];
  const standard = services.find((s) => str(s?.type) === "standard") ?? services[0];
  return str(standard?.id);
}

/**
 * A standard courier service. The checkout never asks which carrier should
 * drive — it offers "курьер до двери" and nothing else — so when nothing on the
 * order names one, the cheapest carrier the store has activated for couriers
 * in that country is used: the one the shelf price was computed from. The
 * admin can force one by posting `carrier`.
 */
async function resolveCourierService(
  config: MontonioConfig,
  hint: string,
  country: string,
): Promise<{ id: string; carrier: string }> {
  if (hint) {
    const id = await courierServiceOf(config, hint, country);
    if (id) return { id, carrier: hint };
    throw new MontonioShippingError("no_courier_service", `${hint}/${country}`);
  }

  const body = await call<{
    countries?: Array<{
      countryCode?: string;
      carriers?: Array<{ carrierCode?: string; shippingMethods?: Array<{ type?: string }> }>;
    }>;
  }>(config, "/shipping-methods");
  const row = (body.countries ?? []).find((c) => str(c?.countryCode).toUpperCase() === country);
  const candidates = (row?.carriers ?? [])
    .filter((c) => (c?.shippingMethods ?? []).some((m) => str(m?.type) === "courier"))
    .map((c) => str(c?.carrierCode).toLowerCase())
    .filter(Boolean);

  /*
   * Cheapest first — and «cheapest» means the very number the ORDER was priced
   * from.
   *
   * A courier price is `costBasis()` → `cheapestCost()` (country-prices.ts):
   * nobody chooses the carrier for a courier, Renat does, at the label, so the
   * shelf price covers the cheapest carrier he CAN choose. This walk is where
   * he chooses, and until 17.09.2026 it took whatever order Montonio returned
   * — so the shop could charge Germany 22.29 € (SmartPosti, 22.23 €) and then
   * book DPD at 32.74 €, ten euro out of the margin of one parcel.
   *
   * A carrier the mirror has no basis row for keeps its place at the back
   * rather than being dropped: an unpriced candidate is still a parcel that
   * goes out, and this is the label, not the till. Nova Post is deliberately
   * one of them — it is the cheapest courier on most routes and is kept out of
   * every basis because it has no returns at all, so a label must not prefer
   * it either (CHIP_ONLY_CARRIERS).
   */
  const ordered = candidates
    .map((carrier, at) => ({ carrier, at, cost: basisCost(carrier, country, "courier") }))
    .sort((a, b) => {
      if (a.cost === null || b.cost === null) {
        if (a.cost === b.cost) return a.at - b.at;
        return a.cost === null ? 1 : -1;
      }
      return a.cost === b.cost ? a.at - b.at : a.cost - b.cost;
    })
    .map((x) => x.carrier);

  for (const carrier of ordered) {
    const id = await courierServiceOf(config, carrier, country);
    if (id) return { id, carrier };
  }
  throw new MontonioShippingError("no_courier_service", country);
}

/**
 * Which carrier this order belongs to.
 *
 * In order: what the admin asked for, then the `carrier` the checkout sent and
 * `createOrder()` stored in `orders.shipping` ("omniva" | "smartpost" | "dpd" |
 * "venipak"). Orders placed before that field was stored fall back to the
 * prefix of a carrier-feed point id ("omniva-96243"), and finally to the
 * carrier named inside an old free-text method label ("Пакомат Omniva").
 *
 * "" is a legitimate answer — the checkout stores no carrier for a courier —
 * and not a problem for a parcel: a Montonio pickup point id already implies
 * its carrier, and the shipment reply says which one it was.
 */
export function carrierHint(order: Order, opts: CreateShipmentOptions = {}): string {
  if (opts.carrier) return opts.carrier.trim().toLowerCase();
  const ship = order.shipping ?? { method: "", country: "EE", price: 0 };
  const stored = String(ship.carrier ?? "").trim().toLowerCase();
  if (stored) return stored;
  const pointId = String(ship.pointId ?? "").toLowerCase();
  const prefixed = MONTONIO_CARRIERS.find((c) => pointId.startsWith(`${c}-`));
  if (prefixed) return prefixed;
  /* Venipak stopped being offered on 14.09.2026 and is not in MONTONIO_CARRIERS
     any more, but orders placed before that are still in the database and this
     function's job is to read them. Reading history is not offering a carrier:
     nothing new can be tagged venipak, and the checkout draws no chip for it. */
  if (/venipak/i.test(String(ship.method ?? "")) || pointId.startsWith("venipak-")) return "venipak";
  if (/unisend/i.test(String(ship.method ?? ""))) return "unisend";
  return sniffCarrier(ship.method) ?? "";
}

/**
 * Register one order with a carrier through Montonio.
 *
 * Synchronous by default: the admin presses a button and wants the tracking
 * code on the screen, not a webhook twenty seconds later. Asynchronous mode
 * still works (`synchronous: false`), it just answers with status `pending` and
 * empty tracking fields — reference § Create Shipment.
 */
export async function createMontonioShipment(
  order: Order,
  opts: CreateShipmentOptions = {},
): Promise<MontonioShipment> {
  const mock = shippingMockOn();
  const config = mock ? null : montonioShippingConfig();
  if (!mock && !config) throw new MontonioShippingError("not_configured");

  const ship = order.shipping ?? { method: "", country: "EE", price: 0 };
  const country = String(ship.country || "EE").toUpperCase();
  const method = normalizeMethod(ship.method);
  if (method === "pickup") throw new MontonioShippingError("not_shippable", "pickup");
  if ((order.items ?? []).every((i) => i.kind === "gift")) {
    throw new MontonioShippingError("not_shippable", "gift_only");
  }

  const hint = carrierHint(order, opts);
  /* The e2e suite's carrier: the same refusals as above (a pickup order or a
     gift-only one is not a parcel for the mock either), then a registered
     parcel without a network in sight — src/lib/shipping/montonio-mock.ts. */
  if (mock || !config) {
    return mockShipment(order, { carrier: hint, method: method === "parcel" ? "pickupPoint" : "courier", country });
  }
  let carrier = hint;
  let shippingMethod: { type: "pickupPoint" | "courier"; id: string; lockerSize?: string };
  let sentLockerSize: LockerSize | undefined;
  if (method === "parcel") {
    shippingMethod = { type: "pickupPoint", id: await resolvePickupPointId(order, hint) };
    /* The door, chosen over the packed box rather than fixed in a constant —
       it is a price tier, so one default for every parcel is one tier paid for
       every parcel (Ренат, 18.09.2026). The panel pre-selects it and posts
       whatever is on screen; a carrier that does not know the field is sent
       without it, because an unknown field is a 400 and not a courtesy. */
    const size = toLockerSize(opts.lockerSize);
    if (size && takesLockerSize(carrier)) shippingMethod.lockerSize = size;
    sentLockerSize = shippingMethod.lockerSize ? size ?? undefined : undefined;
  } else {
    const service = await resolveCourierService(config, hint, country);
    shippingMethod = { type: "courier", id: service.id };
    carrier = service.carrier;
  }

  const addr = addressOf(order);
  const phone = splitPhone(order.phone || pick(addr, "phone", "phoneNumber"), country);
  const receiver: Record<string, unknown> = {
    name: (order.name || pick(addr, "name") || order.email || "Klient").slice(0, 120),
    email: order.email || undefined,
    ...phone,
  };
  if (method === "courier") {
    receiver.streetAddress = pick(addr, "addr", "street", "streetAddress", "addressLine1");
    receiver.locality = pick(addr, "city", "locality");
    receiver.postalCode = pick(addr, "zip", "postalCode", "postcode");
    receiver.country = country;
  }

  /* One read for both halves of the parcel: the weight below always, the
     dimensions only where Montonio asks for them. */
  const box = await getParcelSettings();

  let measured = false;
  const given: Record<string, number> = {};
  for (const dim of ["length", "width", "height"] as const) {
    const v = opts[dim];
    if (typeof v === "number" && v > 0) {
      given[dim] = round2(v);
      measured = true;
    }
  }

  /* The weight is ONE number, not the basket.
     Ренат, 18.09.2026: «one small default carton, no weight modelling». Until
     19.09.2026 this line sent `estimateWeightKg(order)` — 0.4 kg a unit plus
     0.2 — on every booking, so the shop's cost per parcel climbed with the
     line count while the customer paid one flat price (audit 18.09.2026,
     F24).
     Montonio prices the REAL weight (support, 24.09.2026: «our pricing for
     time being takes into account real weight»), so this number is the tier
     the parcel is billed in. Until that answer it was the volumetric weight
     of the box on the card — 0.9 kg for the default carton, and 6 kg for a
     40 × 30 × 20 «Другая коробка», i.e. the 6 kg tier for a parcel weighing
     one. `declaredWeightKg()` now answers `ORDINARY_PARCEL_KG` whatever the
     box; the box is still passed so that MONTONIO_PRICES_VOLUMETRIC, if it
     is ever switched on, can make the weight agree with the sides again.
     `opts` is metres, the settings are centimetres (parcel.ts § Units), so
     the override is converted back first.
     A weight typed into the label form still wins over both: a parcel he has
     actually put on a scale beats any default. */
  const declaredBox =
    given.length && given.width && given.height
      ? { length: given.length * 100, width: given.width * 100, height: given.height * 100 }
      : box;
  const parcel: Record<string, number> = {
    weight: round2(opts.weight && opts.weight > 0 ? opts.weight : declaredWeightKg(declaredBox)),
    ...given,
  };
  /* The declared carton, in **metres**, and only where Montonio says this
     route needs one.
     `constraints.parcelDimensionsRequired` is a per carrier/method/country
     flag on `GET /shipping-methods` with a Note beside it telling us to read
     it; we never did, so every route that has it set was a booking that 400s
     (docs/montonio-shipping-audit.md § 1.6). The catalogue has no dimensions
     and no weight for any of its 220 products, so there is nothing to measure
     and nothing to derive — Ренат's answer of 18.09.2026 was «one default
     parcel size, overridable», which is settings.shipping_parcel.
     Sent only when the flag is `true`, never when it is `false` and never
     when the question could not be answered. Dimensions are a size tier and a
     size tier is money: a route that books today without them has to keep
     booking without them, or a network blip could quietly reprice it.
     Sides matter to the price only where a route is priced by box category —
     DPD's lockers abroad, XS/S/M/L (Montonio, 24.09.2026; the 25 × 18 × 8
     carton is XS, docs/montonio-evidence-2026-09-24.txt). Weight-priced
     routes look up the REAL weight whatever the sides say, so the old
     reasoning here — «a declared box is a floor under the bill» — holds only
     if MONTONIO_PRICES_VOLUMETRIC is ever switched on. */
  if (!measured) {
    const needed = await parcelDimensionsRequired(carrier, country, shippingMethod.type);
    if (needed) {
      const metres = parcelMetres(box);
      parcel.length = metres.length;
      parcel.width = metres.width;
      parcel.height = metres.height;
    }
  }

  /* Every bound here is Montonio's own (reference § Create Shipment →
     products): sku 100, name 255, quantity «Max value is 999». The quantity
     ceiling was missing until 18.09.2026, and it is not cosmetic — one line
     over 999 makes Montonio answer 400 and **the whole shipment fails to
     book**. This array is pick-list and tracking-page metadata, not the
     carrier's declaration, so an absurd count losing its exact value is much
     cheaper than the parcel losing its booking. */
  const products = (order.items ?? [])
    .filter((i) => i.kind !== "gift")
    .slice(0, 100)
    .map((i) => ({
      sku: String(i.id).slice(0, 100),
      name: String(i.title || i.id).slice(0, 255),
      quantity: Math.min(999, Math.max(1, Math.round(Number(i.qty) || 1))),
      price: round2(Number(i.price) || 0),
      currency: order.currency || "EUR",
    }));

  const payload: Record<string, unknown> = {
    merchantReference: order.number,
    shippingMethod,
    parcels: [parcel],
    receiver,
    synchronous: opts.synchronous !== false,
  };
  if (products.length) payload.products = products;
  const linked =
    opts.montonioOrderUuid ??
    (typeof order.payment?.ref === "string" && UUID_RE.test(order.payment.ref)
      ? (order.payment.ref as string)
      : null);
  if (linked) payload.montonioOrderUuid = linked;
  if (order.notes) payload.orderComment = String(order.notes).slice(0, 500);

  const body = await call<{
    id?: string;
    status?: string;
    createdAt?: string;
    shippingMethod?: { carrierCode?: string; countryCode?: string };
    parcels?: Array<{ carrierParcelId?: string | null; trackingLink?: string | null; dropOffPin?: string | null }>;
  }>(config, "/shipments", { method: "POST", body: payload });

  const shipmentId = str(body.id);
  if (!shipmentId) throw new MontonioShippingError("bad_response", "no shipment id");
  const first = body.parcels?.[0];

  return {
    provider: "montonio",
    shipmentId,
    status: str(body.status) || "pending",
    carrier: str(body.shippingMethod?.carrierCode) || carrier,
    country: (str(body.shippingMethod?.countryCode) || country).toUpperCase(),
    method: shippingMethod.type,
    lockerSize: sentLockerSize,
    trackingCode: str(first?.carrierParcelId),
    trackingUrl: str(first?.trackingLink),
    dropOffPin: str(first?.dropOffPin),
    createdAt: str(body.createdAt) || new Date().toISOString(),
  };
}

/* This spot used to carry a note saying `GET /shipments/<id>` «was written and
   never called» and was «removed 07.09.2026». Both halves are false, and have
   been since the day after: the function is defined immediately below and has
   two callers — src/lib/delivery.ts (the nightly close asks whether the parcel
   came back) and src/app/api/admin/shipments/[id]/label/route.ts (filling in a
   drop-off pin the booking reply did not carry). The reference recommends this
   very endpoint for that second job: «Wait for the registered status (via the
   registration webhook or by polling GET /shipments/{id})». Corrected
   18.09.2026, docs/montonio-shipping-audit.md § 5.1. */

/** One shipment as Montonio currently has it — used to pick up a late tracking code. */
export async function getMontonioShipment(shipmentId: string): Promise<MontonioShipment> {
  const config = montonioShippingConfig();
  if (!config) throw new MontonioShippingError("not_configured");
  const body = await call<{
    id?: string;
    status?: string;
    createdAt?: string;
    shippingMethod?: { type?: string; carrierCode?: string; countryCode?: string };
    parcels?: Array<{ carrierParcelId?: string | null; trackingLink?: string | null; dropOffPin?: string | null }>;
  }>(config, `/shipments/${encodeURIComponent(shipmentId)}`);
  const first = body.parcels?.[0];
  return {
    provider: "montonio",
    shipmentId: str(body.id) || shipmentId,
    status: str(body.status),
    carrier: str(body.shippingMethod?.carrierCode),
    country: str(body.shippingMethod?.countryCode).toUpperCase(),
    method: str(body.shippingMethod?.type) === "courier" ? "courier" : "pickupPoint",
    trackingCode: str(first?.carrierParcelId),
    trackingUrl: str(first?.trackingLink),
    dropOffPin: str(first?.dropOffPin),
    createdAt: str(body.createdAt),
  };
}

/* ---------- labels ------------------------------------------------------- */

/**
 * A one-parcel label file, synchronously — the reply already carries the PDF
 * URL, so no webhook is needed for a shop that prints labels one at a time
 * (labels guide § Synchronous vs Asynchronous). A6 at one label per page is
 * what thermal printers want; A4/4-up is the office-printer fallback.
 *
 * `label_not_ready` means Montonio accepted the job but had not finished; the
 * file id comes back in `detail` so a retry can fetch it instead of making a
 * second one.
 */
export async function getMontonioLabel(
  shipmentId: string,
  opts: { pageSize?: "A4" | "A6"; labelsPerPage?: 1 | 4 | 6 | 8 } = {},
): Promise<MontonioLabelFile> {
  if (shippingMockOn()) return mockLabel(shipmentId, opts.pageSize ?? "A6");
  const config = montonioShippingConfig();
  if (!config) throw new MontonioShippingError("not_configured");

  const body = await call<{ id?: string; status?: string; labelFileUrl?: string | null }>(
    config,
    "/label-files",
    {
      method: "POST",
      body: {
        shipmentIds: [shipmentId],
        pageSize: opts.pageSize ?? "A6",
        labelsPerPage: opts.labelsPerPage ?? 1,
        orderLabelsBy: "createdAt",
        synchronous: true,
      },
    },
  );

  const labelFileId = str(body.id);
  const url = str(body.labelFileUrl);
  if (str(body.status) !== "ready" || !url) {
    throw new MontonioShippingError("label_not_ready", labelFileId || str(body.status));
  }
  return { labelFileId, status: "ready", url };
}

/* `GET /label-files/<id>` — fetching a label file made earlier — was the
   retry half of `label_not_ready` above and was never wired up: the panel
   simply asks for the label again. Removed 07.09.2026
   (docs/audit/2026-09-07-cleanup.md); in git at 448cbd7. */

/**
 * The PDF itself. The URL is a pre-signed S3 link — no Authorization header —
 * and it **lives five minutes**: «Once the label is created, the label URL will
 * last 5 minutes, after which it will no longer be accessible. To get a fresh
 * URL, make a new request» (reference § Create a label file). So the copy
 * stored on the order is a cache that is almost always stale; the label route
 * tries it, and falls through to a fresh POST /label-files on any failure.
 */
export async function fetchLabelPdf(url: string): Promise<ArrayBuffer> {
  if (url.startsWith(MOCK_LABEL_PREFIX)) {
    // a mock label can only have been stored by a mock run; outside one it is junk, not a fetch
    if (!shippingMockOn()) throw new MontonioShippingError("rejected", "mock label outside SHIPPING_PROVIDER=mock");
    const bytes = mockLabelPdf(url);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new MontonioShippingError("unreachable", "label file");
  }
  if (!res.ok) throw new MontonioShippingError("rejected", `label ${res.status}`);
  return res.arrayBuffer();
}

/* ---------- persistence -------------------------------------------------- */

/**
 * Merge the shipment into `orders.shipping.montonio`, keeping everything the
 * checkout stored there (method, country, pointId, pointName, address, price).
 * The nested `||` is a jsonb merge on both levels, so a later labelUrl patch
 * does not wipe the tracking code.
 */
export async function saveShipmentOnOrder(
  orderId: string,
  patch: Partial<MontonioShipment> & Record<string, unknown>,
): Promise<void> {
  await query(
    `update orders
        set shipping = coalesce(shipping, '{}'::jsonb)
                       || jsonb_build_object('montonio',
                            coalesce(shipping -> 'montonio', '{}'::jsonb) || $2::jsonb),
            updated_at = now()
      where id = $1`,
    [orderId, jsonbParam(patch)],
  );
}

/**
 * How long a booking claim below stays in the way. Long enough that a slow
 * Montonio is never overtaken by an impatient second press, short enough that
 * a request which died mid-call does not lock the button while the owner is
 * still looking at the card.
 */
export const SHIPMENT_CLAIM_MS = 120_000;

/**
 * Take the order's booking slot before Montonio is called — and say whether
 * it was free.
 *
 * POST /api/admin/shipments used to read the order, see no shipment, call
 * Montonio, and only then write the row. Between those two there is a booked,
 * paid-for parcel that nothing has recorded yet: a press that timed out on the
 * owner's phone and was pressed again booked a SECOND parcel (audit
 * 14.09.2026). One conditional UPDATE closes it — Postgres locks the row, so
 * of two presses exactly one sees the slot empty.
 *
 * The claim is the database's own clock, never the caller's: two serverless
 * instances do not share a wristwatch. It is dropped by releaseShipmentSlot()
 * when the call fails, overwritten by the shipment itself when it succeeds,
 * and ignored once SHIPMENT_CLAIM_MS has passed.
 */
export async function claimShipmentSlot(orderId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update orders
        set shipping = coalesce(shipping, '{}'::jsonb)
                       || jsonb_build_object('montonio',
                            coalesce(shipping -> 'montonio', '{}'::jsonb)
                            || jsonb_build_object('bookingAt', (extract(epoch from now()) * 1000)::bigint)),
            updated_at = now()
      where id = $1
        and coalesce(shipping -> 'montonio' ->> 'shipmentId', '') = ''
        and coalesce((shipping -> 'montonio' ->> 'bookingAt')::bigint, 0)
            < (extract(epoch from now()) * 1000)::bigint - $2::bigint
      returning id`,
    [orderId, SHIPMENT_CLAIM_MS],
  );
  return rows.length > 0;
}

/** Give the slot back — the booking failed, so the next press may try again. */
export async function releaseShipmentSlot(orderId: string): Promise<void> {
  await saveShipmentOnOrder(orderId, { bookingAt: null });
}

/* ---------- what this store is actually signed up for --------------------- */

/** One row of `GET /carriers`, reduced to what a readiness screen needs. */
export interface MontonioCarrierContract {
  code: string;
  name: string;
  /** «hasMontonioContract» — the carrier is available on Montonio's own deal. */
  montonioContract: boolean;
  /** Countries the shop has its OWN contract for — `contracts[].country`. */
  ownCountries: string[];
}

/**
 * `GET /carriers` — which carriers this store may actually book with.
 *
 * The same endpoint `fetchMontonioCarriers()` above reads for the checkout's
 * logos, and a separate function on purpose: this one is **uncached** (a
 * readiness screen wants today's answer, not one from six hours ago) and it
 * keeps the two fields the logo reader throws away — which is also why they
 * are not simply added to `MontonioCarrier`, whose shape is served to every
 * shopper by `GET /api/shipping/carriers/`. What this store is contracted for
 * is the owner's business, not the storefront's.
 *
 * Unlike the payments side, the shipping API *does* answer the activation
 * question, and it answers it twice over: `hasMontonioContract` says the
 * carrier is reachable on Montonio's own agreement, and `contracts[]` lists
 * the shop's own per-country deals. A carrier the checkout offers and this
 * list does not name is a booking that will fail on the first live order.
 *
 * Read-only, admin-only, and never a throw, like every other probe: a
 * readiness screen that cannot load must say «не смогли спросить», not take
 * the shop down. It says **which** «не смогли», though — see MontonioProbe.
 */
export async function fetchMontonioCarrierContracts(
  env: NodeJS.ProcessEnv = process.env,
): Promise<MontonioProbe<MontonioCarrierContract[]>> {
  const config = montonioShippingConfig(env);
  if (!config) return { ok: false, status: null, code: "not_configured" };
  try {
    const body = await call<{
      carriers?: Array<{
        code?: unknown;
        name?: unknown;
        hasMontonioContract?: unknown;
        contracts?: Array<{ country?: unknown }> | null;
      }>;
    }>(config, "/carriers");
    const rows = Array.isArray(body.carriers) ? body.carriers : [];
    return {
      ok: true,
      data: rows
        .map((c) => ({
          code: str(c.code).toLowerCase(),
          name: str(c.name) || str(c.code),
          montonioContract: c.hasMontonioContract === true,
          ownCountries: (Array.isArray(c.contracts) ? c.contracts : [])
            .map((x) => str(x?.country).toUpperCase())
            .filter(Boolean),
        }))
        .filter((c) => !!c.code),
    };
  } catch (err) {
    console.error("[montonio shipping] GET /carriers —", err);
    return probeFailure(err);
  }
}

/** One registered webhook — `GET /webhooks` returns them under `data`. */
export interface MontonioWebhook {
  id: string;
  url: string;
  events: string[];
}

/**
 * `GET /webhooks` — whether Montonio has been told where to send parcel events.
 *
 * This one is registered **by hand**, unlike the payment webhook whose
 * `notificationUrl` rides on every order (docs/shipping.md). Nothing in this
 * shop can tell that it was forgotten: parcels book, labels print, and the
 * orders simply never close by themselves. So the panel asks.
 *
 * `url` and `enabledEvents` are kept, not counted — see readWebhookSetup().
 * Never a throw.
 */
export async function fetchMontonioWebhooks(
  env: NodeJS.ProcessEnv = process.env,
): Promise<MontonioProbe<MontonioWebhook[]>> {
  const config = montonioShippingConfig(env);
  if (!config) return { ok: false, status: null, code: "not_configured" };
  try {
    const body = await call<{
      data?: Array<{ id?: unknown; url?: unknown; enabledEvents?: unknown }>;
    }>(config, "/webhooks");
    const rows = Array.isArray(body.data) ? body.data : [];
    return {
      ok: true,
      data: rows.map((w) => ({
        id: str(w.id),
        url: str(w.url),
        events: Array.isArray(w.enabledEvents) ? w.enabledEvents.map((e) => str(e)).filter(Boolean) : [],
      })),
    };
  } catch (err) {
    console.error("[montonio shipping] GET /webhooks —", err);
    return probeFailure(err);
  }
}

/* ---------- is the registered webhook OUR webhook? ------------------------ */

/**
 * The path Montonio must be given, trailing slash and all.
 *
 * `trailingSlash: true` in next.config.ts, so a POST to the same address
 * without the final slash is answered **308** and the event is never
 * processed. That one character is the difference between an order closing by
 * itself and an owner refreshing a screen that never changes.
 */
export const SHIPMENT_WEBHOOK_PATH = "/api/shipping/notify/";

/**
 * The events this shop actually acts on — no more, and no fewer.
 *
 * Three documents disagreed about this list (audit 18.09.2026, F13):
 * `docs/shipping.md:813` says tick one, `:1006` adds a second,
 * `docs/montonio-untested.md:101` asks for three. The route settles it,
 * because the route is what runs:
 *
 *   · `shipment.statusUpdated` — the only event that moves an order to
 *     «Доставлен» (src/app/api/shipping/notify/route.ts, `meaning ===
 *     "delivered"`);
 *   · `shipment.registrationFailed` — the only event that puts a carrier's
 *     refusal in the journal. Without it a parcel refused after an
 *     asynchronous booking is one word in a settings blob and nothing else;
 *   · `shipment.registered` — required since 24.09.2026. A refused parcel is
 *     now repaired in place with `PATCH /shipments/{id}` (Montonio's answer
 *     of that day), and a re-registration that does not finish inside the
 *     PATCH arrives only here, with its tracking code.
 *
 * `shipment.labelsCreated` is subscribed by tools/montonio-webhook.mjs (it
 * keeps the stored status current) but not required: nothing stops working
 * without it. Ticking more is harmless — the route answers 200, and the
 * `labelFile.*` pair is acknowledged and ignored — which is why this checks
 * for missing events and never complains about extra ones.
 */
export const REQUIRED_SHIPMENT_EVENTS: readonly string[] = [
  "shipment.statusUpdated",
  "shipment.registrationFailed",
  "shipment.registered",
];

/** Where Montonio has to send parcel events — «» when PUBLIC_BASE_URL is unset. */
export function shipmentWebhookUrl(env: NodeJS.ProcessEnv = process.env): string {
  const base = String(env.PUBLIC_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return base ? base + SHIPMENT_WEBHOOK_PATH : "";
}

/** Same address? Case and a `?query` do not matter; the trailing slash does. */
function sameWebhookUrl(a: string, b: string): boolean {
  const norm = (raw: string) => {
    try {
      const u = new URL(raw);
      /* Host and path only. The scheme is left out on purpose: `http` where we
         expect `https` is the same *address* wrongly spelt, and telling him to
         re-paste it is the same instruction either way. */
      return `${u.host.toLowerCase()}${u.pathname}`;
    } catch {
      return raw.trim().toLowerCase();
    }
  };
  return !!a && !!b && norm(a) === norm(b);
}

/** What `GET /webhooks` amounts to for the owner's screen. */
export interface WebhookSetup {
  /** `ok` · `none` · `wrong_url` · `missing_events` — never a bare boolean. */
  state: "ok" | "none" | "wrong_url" | "missing_events";
  /** The address he has to paste, so the row can print it. */
  expectedUrl: string;
  /** The addresses Montonio really holds, so the row can print those too. */
  urls: string[];
  /** Required events the matching webhook does not carry. */
  missingEvents: string[];
}

/**
 * Registered ≠ registered **here**.
 *
 * Until 19.09.2026 any webhook at all made this row green: `webhooks.length >
 * 0`, url and events discarded (audit 18.09.2026, F13). The likely day-one
 * state after the domain move is precisely the one that passed — a webhook
 * still pointing at the staging host — and the reference's own example
 * webhook, pinned as our test fixture, points at `partner.montonio` and
 * subscribes to one event we do not use. The test asserted it was fine.
 *
 * `expectedUrl` empty means PUBLIC_BASE_URL is not set, i.e. we do not know
 * what to compare against: then the answer is «есть вебхук, проверить не
 * можем» rather than a verdict — `missing_events` is still worth saying, the
 * url is not.
 */
export function readWebhookSetup(
  webhooks: readonly MontonioWebhook[],
  expectedUrl: string,
): WebhookSetup {
  const urls = webhooks.map((w) => w.url).filter(Boolean);
  if (!webhooks.length) return { state: "none", expectedUrl, urls, missingEvents: [] };

  /* With no expected url to match, the honest fallback is «any of them may be
     ours»: take the union of the events, so a complete set is not called
     incomplete on a shop whose base url simply is not configured. */
  const mine = expectedUrl ? webhooks.filter((w) => sameWebhookUrl(w.url, expectedUrl)) : [...webhooks];
  if (!mine.length) return { state: "wrong_url", expectedUrl, urls, missingEvents: [] };

  const have = new Set<string>();
  for (const w of mine) for (const e of w.events) have.add(e.trim().toLowerCase());
  const missingEvents = REQUIRED_SHIPMENT_EVENTS.filter((e) => !have.has(e.toLowerCase()));
  return {
    state: missingEvents.length ? "missing_events" : "ok",
    expectedUrl,
    urls,
    missingEvents,
  };
}

/** What we stored earlier for this order, if anything. */
export function shipmentOnOrder(order: Order): (MontonioShipment & Record<string, unknown>) | null {
  const raw = (order.shipping as unknown as { montonio?: unknown } | null)?.montonio;
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  return typeof s.shipmentId === "string" && s.shipmentId
    ? (s as unknown as MontonioShipment & Record<string, unknown>)
    : null;
}
