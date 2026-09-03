/**
 * Where a parcel can be picked up.
 *
 * Three carriers, three very different realities (checked 03.09.2026, written
 * up in docs/shipping.md):
 *
 *   omniva     one public JSON file with EE, LV and LT in it. Fetched live and
 *              cached for six hours — this is the only carrier with a feed we
 *              can hit at request time.
 *   smartpost  no bulk endpoint at all: the site lists slugs, then charges one
 *              ~60 KB request per point. That is a build job, so these come
 *              from the committed seed (tools/fetch-parcel-points.mjs).
 *   dpd        no public feed of any kind. Live lookups need a DPD Baltics
 *              contract (DPD_API_USER / DPD_API_PASS); without those the seed
 *              is empty and the checkout offers DPD as a courier only.
 *
 * Every path ends at the seed rather than at an error: a carrier's website
 * being down must not stop someone choosing a parcel machine.
 */

import seed from "@/data/parcel-points.seed.json";

export interface ParcelPoint {
  id: string;
  carrier: string;
  name: string;
  address: string;
  city: string;
  zip: string;
  country: string;
  lat: number;
  lng: number;
  /** "machine" — a locker; "office"/"counter" — served over a counter. */
  type?: string;
}

export type Carrier = "omniva" | "dpd" | "smartpost";
export const CARRIERS: Carrier[] = ["omniva", "dpd", "smartpost"];

export function isCarrier(v: unknown): v is Carrier {
  return typeof v === "string" && (CARRIERS as string[]).includes(v);
}

const OMNIVA_URL = "https://www.omniva.ee/locations.json";
const DPD_HOSTS: Record<string, string> = {
  EE: "integration.dpd.ee",
  LV: "integration.dpd.lv",
  LT: "integracijos.dpd.lt",
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;

type CacheEntry = { at: number; points: ParcelPoint[] };
/* Cached on globalThis so Next's dev-mode module reloads don't re-download the
   feed on every edit, and a warm serverless instance keeps its copy. */
const g = globalThis as unknown as { __rempirePoints?: Map<string, CacheEntry> };
const cache: Map<string, CacheEntry> = (g.__rempirePoints ??= new Map());

export function resetPointsCache(): void {
  cache.clear();
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v);
}

function coord(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? Math.round(n * 1e6) / 1e6 : null;
}

/**
 * Omniva rows → points. X_COORDINATE is the longitude and Y_COORDINATE the
 * latitude (verified against the live file — the names read backwards), and
 * ZIP is an internal terminal code, not a postcode, so it becomes the id.
 */
export function mapOmnivaRows(rows: unknown): ParcelPoint[] {
  if (!Array.isArray(rows)) return [];
  const out: ParcelPoint[] = [];
  for (const raw of rows) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const country = str(r.A0_NAME).toUpperCase();
    const name = str(r.NAME);
    if (!country || !name || /ettevõttesisene|picapac/i.test(name)) continue;
    const lat = coord(r.Y_COORDINATE);
    const lng = coord(r.X_COORDINATE);
    if (lat === null || lng === null) continue;
    const isOffice = str(r.TYPE) === "1";
    out.push({
      id: `omniva-${str(r.ZIP)}`,
      carrier: "omniva",
      name,
      address: [str(r.A5_NAME), str(r.A7_NAME)].filter(Boolean).join(" "),
      city:
        country === "EE"
          ? str(r.A2_NAME) || str(r.A3_NAME)
          : str(r.A3_NAME) || str(r.A2_NAME) || str(r.A1_NAME),
      zip: isOffice ? str(r.ZIP) : "",
      country,
      lat,
      lng,
      type: isOffice ? "office" : "machine",
    });
  }
  return out;
}

export function mapDpdRows(rows: unknown): ParcelPoint[] {
  if (!Array.isArray(rows)) return [];
  const out: ParcelPoint[] = [];
  for (const raw of rows) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const lat = coord(r.latitude);
    const lng = coord(r.longitude);
    if (lat === null || lng === null) continue;
    out.push({
      id: `dpd-${str(r.parcelshop_id)}`,
      carrier: "dpd",
      name: str(r.company),
      address: str(r.street),
      city: str(r.city),
      zip: str(r.pcode),
      country: str(r.country).toUpperCase(),
      lat,
      lng,
      type: "machine",
    });
  }
  return out;
}

/** The committed fallback, filtered. */
export function seedPoints(carrier?: Carrier, country?: string): ParcelPoint[] {
  const all = (seed as { points?: ParcelPoint[] }).points ?? [];
  return all.filter(
    (p) =>
      (!carrier || p.carrier === carrier) &&
      (!country || p.country === country.toUpperCase()),
  );
}

export function seedGeneratedAt(): string {
  return (seed as { generatedAt?: string }).generatedAt ?? "";
}

async function fetchOmniva(): Promise<ParcelPoint[]> {
  const res = await fetch(OMNIVA_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    // Next would otherwise cache the 850 KB body in its own data cache
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`omniva ${res.status}`);
  return mapOmnivaRows(await res.json());
}

async function fetchDpd(country: string): Promise<ParcelPoint[]> {
  const user = process.env.DPD_API_USER;
  const pass = process.env.DPD_API_PASS;
  const host = DPD_HOSTS[country.toUpperCase()];
  if (!user || !pass || !host) throw new Error("dpd_unconfigured");
  const url =
    `https://${host}/ws-mapper-rest/parcelShopSearch_` +
    `?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}` +
    `&country=${encodeURIComponent(country.toUpperCase())}&fetchGsPUDOpoint=1`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`dpd ${res.status}`);
  const body = (await res.json()) as { parcelshops?: unknown };
  return mapDpdRows(body?.parcelshops);
}

export interface PointsResult {
  points: ParcelPoint[];
  source: "live" | "cache" | "seed";
}

/**
 * Points for one carrier and country. Live where a live feed exists, cached for
 * six hours, and always falling back to the seed rather than to an error.
 */
export async function getPoints(carrier: Carrier, country: string): Promise<PointsResult> {
  const cc = country.toUpperCase();
  const key = `${carrier}:${cc}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { points: hit.points, source: "cache" };
  }

  try {
    let live: ParcelPoint[] | null = null;
    if (carrier === "omniva") {
      // one file holds every country, so cache the whole thing under each key
      live = (await fetchOmniva()).filter((p) => p.country === cc);
    } else if (carrier === "dpd") {
      live = await fetchDpd(cc);
    }
    // smartpost has no request-time feed at all — the seed is its source
    if (live && live.length) {
      cache.set(key, { at: Date.now(), points: live });
      return { points: live, source: "live" };
    }
  } catch (err) {
    console.error(`parcel points: ${key} live fetch failed —`, err);
  }

  const fallback = seedPoints(carrier, cc);
  // A stale-but-real list beats an empty one; cache it so a dead feed is not
  // re-tried on every keystroke of the shopper's search.
  cache.set(key, { at: Date.now(), points: fallback });
  return { points: fallback, source: "seed" };
}
