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
import type { ParcelPoint } from "@/lib/parcel-points";
import type { Order } from "@/lib/orders";

/* ---------- constants ---------------------------------------------------- */

const LIVE_BASE = "https://shipping.montonio.com/api/v2";
const SANDBOX_BASE = "https://sandbox-shipping.montonio.com/api/v2";

/** The docs recommend an hour on the auth token. */
const TOKEN_TTL_SECONDS = 3600;
const REQUEST_TIMEOUT_MS = 10_000;
/** Same six hours the carrier feeds are cached for — machine lists barely move. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** Carriers Montonio can resell to us. Codes are Montonio's own `carrierCode`. */
export const MONTONIO_CARRIERS = ["omniva", "smartpost", "dpd", "venipak", "unisend"] as const;

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
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "MontonioShippingError";
  }
}

export interface CreateShipmentOptions {
  /** Parcel weight in kg. Default: estimated from the line count. */
  weight?: number;
  /** Metres, two decimals. Only sent when given — some carriers demand them. */
  length?: number;
  width?: number;
  height?: number;
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
  labelUrl?: string;
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
  if (res.status === 404) throw new MontonioShippingError("not_found", path);
  if (!res.ok) {
    console.error("[montonio shipping]", init?.method ?? "GET", path, res.status, text.slice(0, 400));
    throw new MontonioShippingError("rejected", `${res.status} ${text.slice(0, 300)}`);
  }
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new MontonioShippingError("bad_response", path);
  }
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
    `/shipping-methods/pickup-points?carrierCode=${encodeURIComponent(carrier)}` +
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
  price: number;
  currency: string;
}

/**
 * `POST /shipping-methods/rates` — reference § "Calculate shipping costs",
 * confirmed to exist 03.09.2026 (see docs/shipping.md § «Тарифы Montonio»).
 * One call prices every carrier and method this store has active for a single
 * destination country against one parcel shape; there is no per-carrier or
 * per-method request. `null` — never a throw — when there are no keys or
 * Montonio would not answer, exactly like the pickup-point reader, so a caller
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
          const price = Number(sub.rate);
          if (!Number.isFinite(price) || price < 0) continue;
          out.push({
            carrier,
            methodType,
            subtype: str(sub.code) || "standard",
            price: Math.round(price * 100) / 100,
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

/* ---------- shipments ---------------------------------------------------- */

const PHONE_PREFIX: Record<string, string> = { EE: "372", LV: "371", LT: "370", FI: "358" };

/**
 * Montonio wants the country code and the rest of the number in two fields.
 * A local number ("58107505") keeps the delivery country's prefix; a prefixed
 * one ("+372 5810 7505") is split. The six-digit floor stops a short landline
 * that merely starts with "372" from losing its first three digits.
 */
export function splitPhone(raw: unknown, country: string): {
  phoneCountryCode: string;
  phoneNumber: string;
} {
  const digits = String(raw ?? "")
    .replace(/\D+/g, "")
    .replace(/^00/, "");
  for (const cc of Object.values(PHONE_PREFIX)) {
    if (digits.startsWith(cc) && digits.length - cc.length >= 6) {
      return { phoneCountryCode: cc, phoneNumber: digits.slice(cc.length) };
    }
  }
  return {
    phoneCountryCode: PHONE_PREFIX[String(country || "").toUpperCase()] ?? "372",
    phoneNumber: digits,
  };
}

function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * A weight, because Montonio requires one and the catalogue has none. Roughly a
 * bottle of shampoo per line plus the box; Renat can correct it in the carrier
 * portal, and the shipment registers either way.
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
    `/shipping-methods/courier-services?carrierCode=${encodeURIComponent(carrier)}` +
      `&countryCode=${encodeURIComponent(country)}`,
  );
  const services = body.courierServices ?? [];
  const standard = services.find((s) => str(s?.type) === "standard") ?? services[0];
  return str(standard?.id);
}

/**
 * A standard courier service. The checkout never asks which carrier should
 * drive — it offers "курьер до двери" and nothing else — so when nothing on the
 * order names one, whichever carrier the store has activated for couriers in
 * that country is used. The admin can force one by posting `carrier`.
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

  for (const carrier of candidates) {
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
  if (/venipak/i.test(String(ship.method ?? ""))) return "venipak";
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
  const config = montonioShippingConfig();
  if (!config) throw new MontonioShippingError("not_configured");

  const ship = order.shipping ?? { method: "", country: "EE", price: 0 };
  const country = String(ship.country || "EE").toUpperCase();
  const method = normalizeMethod(ship.method);
  if (method === "pickup") throw new MontonioShippingError("not_shippable", "pickup");
  if ((order.items ?? []).every((i) => i.kind === "gift")) {
    throw new MontonioShippingError("not_shippable", "gift_only");
  }

  const hint = carrierHint(order, opts);
  let carrier = hint;
  let shippingMethod: { type: "pickupPoint" | "courier"; id: string };
  if (method === "parcel") {
    shippingMethod = { type: "pickupPoint", id: await resolvePickupPointId(order, hint) };
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

  const parcel: Record<string, number> = {
    weight: round2(opts.weight && opts.weight > 0 ? opts.weight : estimateWeightKg(order)),
  };
  for (const dim of ["length", "width", "height"] as const) {
    const v = opts[dim];
    if (typeof v === "number" && v > 0) parcel[dim] = round2(v);
  }

  const products = (order.items ?? [])
    .filter((i) => i.kind !== "gift")
    .slice(0, 100)
    .map((i) => ({
      sku: String(i.id).slice(0, 100),
      name: String(i.title || i.id).slice(0, 255),
      quantity: Math.max(1, Math.round(Number(i.qty) || 1)),
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
    trackingCode: str(first?.carrierParcelId),
    trackingUrl: str(first?.trackingLink),
    dropOffPin: str(first?.dropOffPin),
    createdAt: str(body.createdAt) || new Date().toISOString(),
  };
}

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

/** A label file that was created earlier, by id. */
export async function fetchMontonioLabelFile(labelFileId: string): Promise<MontonioLabelFile> {
  const config = montonioShippingConfig();
  if (!config) throw new MontonioShippingError("not_configured");
  const body = await call<{ id?: string; status?: string; labelFileUrl?: string | null }>(
    config,
    `/label-files/${encodeURIComponent(labelFileId)}`,
  );
  const url = str(body.labelFileUrl);
  if (str(body.status) !== "ready" || !url) {
    throw new MontonioShippingError("label_not_ready", labelFileId);
  }
  return { labelFileId: str(body.id) || labelFileId, status: "ready", url };
}

/** The PDF itself. The URL is a pre-signed S3 link — no Authorization header. */
export async function fetchLabelPdf(url: string): Promise<ArrayBuffer> {
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

/** What we stored earlier for this order, if anything. */
export function shipmentOnOrder(order: Order): (MontonioShipment & Record<string, unknown>) | null {
  const raw = (order.shipping as unknown as { montonio?: unknown } | null)?.montonio;
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  return typeof s.shipmentId === "string" && s.shipmentId
    ? (s as unknown as MontonioShipment & Record<string, unknown>)
    : null;
}
