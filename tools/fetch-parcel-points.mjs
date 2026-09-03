#!/usr/bin/env node
/**
 * Builds src/data/parcel-points.seed.json — the pickup points the checkout
 * shows when a carrier's own feed is unreachable.
 *
 *   node tools/fetch-parcel-points.mjs                 # every carrier it can reach
 *   node tools/fetch-parcel-points.mjs --carrier omniva
 *   node tools/fetch-parcel-points.mjs --dry           # print counts, write nothing
 *
 * What each carrier actually offers (checked 03.09.2026 — see docs/shipping.md):
 *
 *   Omniva     one public JSON file with EE, LV and LT in it. No key, no
 *              limits, CORS open. This is also the live source the API route
 *              uses at request time.
 *   Smartposti no bulk endpoint. The site lists slug → code, then one request
 *              per point (~60 KB each), so it is a seed job and never a
 *              request-time fetch. EE only by default; FI has 3333 points,
 *              which is a download, not a lookup — use a Posti API key for
 *              those (POSTI_API_KEY, see docs/shipping.md).
 *   DPD        no public feed exists. The real endpoint needs a DPD Baltics
 *              contract; set DPD_API_USER / DPD_API_PASS and it is included.
 *
 * The seed is committed on purpose: the checkout must be able to offer a parcel
 * machine on a day when a carrier's website is down.
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "data", "parcel-points.seed.json");

const OMNIVA_URL = "https://www.omniva.ee/locations.json";
const SMARTPOSTI_HOST = "https://www.smartposti.ee";
const DPD_HOSTS = { EE: "integration.dpd.ee", LV: "integration.dpd.lv", LT: "integracijos.dpd.lt" };

const args = process.argv.slice(2);
const only = args.includes("--carrier") ? args[args.indexOf("--carrier") + 1] : null;
const dry = args.includes("--dry");
/* Smartposti is one request per point, so which countries to walk is a choice —
   and only EE actually yields anything. The .ee host serves the identifier list
   for all four countries, but the detail page exists only for Estonian slugs:
   FI's 3333 identifiers all 404 there (measured), and LV/LT need a localised
   path that has not been found yet. Hence the EE-only default; see
   docs/shipping.md for the Posti API route to Finland. */
const SMARTPOSTI_COUNTRIES = (
  args.includes("--countries") ? args[args.indexOf("--countries") + 1] : "ee"
)
  .split(",")
  .map((c) => c.trim().toLowerCase())
  .filter(Boolean);

const log = (...a) => console.log(...a);

async function getJson(url, init) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

function clean(v) {
  return String(v ?? "").trim();
}

function coord(v) {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? Math.round(n * 1e6) / 1e6 : null;
}

/* ---------- Omniva ------------------------------------------------------- */
/**
 * Flat array of string-valued records. Two traps, both verified against the
 * live file: X_COORDINATE is the LONGITUDE and Y_COORDINATE the latitude, and
 * ZIP is Omniva's internal terminal code — unique per machine and NOT a
 * mailable postcode — so it is used as the id and never as the zip.
 * The city sits in a different A*_NAME column per country.
 */
export function mapOmniva(rows) {
  const out = [];
  for (const r of rows) {
    const country = clean(r.A0_NAME).toUpperCase();
    if (!country) continue;
    const name = clean(r.NAME);
    // Omniva's own internal and test machines are not places to send a parcel
    if (!name || /ettevõttesisene|picapac/i.test(name)) continue;
    const lat = coord(r.Y_COORDINATE);
    const lng = coord(r.X_COORDINATE);
    if (lat === null || lng === null) continue;

    const street = [clean(r.A5_NAME), clean(r.A7_NAME)].filter(Boolean).join(" ");
    const city =
      country === "EE"
        ? clean(r.A2_NAME) || clean(r.A3_NAME)
        : clean(r.A3_NAME) || clean(r.A2_NAME) || clean(r.A1_NAME);
    const isOffice = clean(r.TYPE) === "1";

    out.push({
      id: `omniva-${clean(r.ZIP)}`,
      carrier: "omniva",
      name,
      address: street,
      city,
      // real postcodes exist only on the post offices; machines carry the
      // internal code, which must never be printed on a label
      zip: isOffice ? clean(r.ZIP) : "",
      country,
      lat,
      lng,
      type: isOffice ? "office" : "machine",
    });
  }
  return out;
}

async function fetchOmniva() {
  log("omniva: fetching", OMNIVA_URL);
  const rows = await getJson(OMNIVA_URL);
  const points = mapOmniva(rows);
  log(`omniva: ${points.length} points from ${rows.length} rows`);
  return points;
}

/* ---------- Smartposti --------------------------------------------------- */
/** The build id changes on every site deploy, so it is read, never hardcoded. */
async function smartpostiBuildId() {
  const res = await fetch(`${SMARTPOSTI_HOST}/pakiautomaadid`, {
    signal: AbortSignal.timeout(60_000),
  });
  const html = await res.text();
  const m = html.match(/"buildId"\s*:\s*"([^"]+)"/);
  if (!m) throw new Error("smartposti: no buildId on the listing page");
  return m[1];
}

export function mapSmartposti(slug, data) {
  const sp = data?.pageProps?.servicePointData;
  const a = sp?.addresses?.[0];
  if (!sp || !a) return null;
  const lat = coord(sp.coordinates?.latitude);
  const lng = coord(sp.coordinates?.longitude);
  if (lat === null || lng === null) return null;
  return {
    id: `smartpost-${clean(sp.pupCode) || slug}`,
    carrier: "smartpost",
    name: clean(a.publicName),
    address: clean(a.streetAddress),
    city: clean(a.city),
    zip: clean(a.postcode),
    country: clean(a.countryCode).toUpperCase(),
    lat,
    lng,
    type: sp.parcelLocker === false ? "counter" : "machine",
  };
}

/** Runs `worker` over `items`, `limit` at a time. */
async function pool(items, limit, worker) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        try {
          const value = await worker(items[idx], idx);
          if (value) out.push(value);
        } catch (err) {
          console.error("  skipped", items[idx], String(err?.message || err));
        }
      }
    }),
  );
  return out;
}

async function fetchSmartposti() {
  const buildId = await smartpostiBuildId();
  log("smartposti: buildId", buildId);
  const points = [];
  for (const cc of SMARTPOSTI_COUNTRIES) {
    const ids = await getJson(`${SMARTPOSTI_HOST}/api/location/identifiers?countryCode=${cc}`);
    const slugs = Object.keys(ids);
    log(`smartposti: ${cc.toUpperCase()} — ${slugs.length} points, fetching details…`);
    const got = await pool(slugs, 6, async (slug) => {
      const data = await getJson(
        `${SMARTPOSTI_HOST}/_next/data/${buildId}/pakiautomaadid/${slug}.json`,
      );
      return mapSmartposti(slug, data);
    });
    log(`smartposti: ${cc.toUpperCase()} — ${got.length} mapped`);
    points.push(...got);
  }
  return points;
}

/* ---------- DPD ---------------------------------------------------------- */
/**
 * No public feed. This runs only when a DPD Baltics contract's credentials are
 * in the environment; the endpoint is the one the official WooCommerce plugin
 * uses. Without the keys the seed simply has no DPD points, and the checkout
 * offers DPD as a courier only.
 */
export function mapDpd(rows) {
  const out = [];
  for (const r of rows ?? []) {
    const lat = coord(r.latitude);
    const lng = coord(r.longitude);
    if (lat === null || lng === null) continue;
    out.push({
      id: `dpd-${clean(r.parcelshop_id)}`,
      carrier: "dpd",
      name: clean(r.company),
      address: clean(r.street),
      city: clean(r.city),
      zip: clean(r.pcode),
      country: clean(r.country).toUpperCase(),
      lat,
      lng,
      type: "machine",
    });
  }
  return out;
}

async function fetchDpd() {
  const user = process.env.DPD_API_USER;
  const pass = process.env.DPD_API_PASS;
  if (!user || !pass) {
    log("dpd: skipped — set DPD_API_USER and DPD_API_PASS (a DPD Baltics contract)");
    return [];
  }
  const points = [];
  for (const [country, host] of Object.entries(DPD_HOSTS)) {
    const url =
      `https://${host}/ws-mapper-rest/parcelShopSearch_` +
      `?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}` +
      `&country=${country}&fetchGsPUDOpoint=1`;
    try {
      const body = await getJson(url);
      const got = mapDpd(body?.parcelshops);
      log(`dpd: ${country} — ${got.length} points`);
      points.push(...got);
    } catch (err) {
      console.error(`dpd: ${country} failed —`, String(err?.message || err));
    }
  }
  return points;
}

/* ---------- main --------------------------------------------------------- */
const CARRIERS = { omniva: fetchOmniva, smartpost: fetchSmartposti, dpd: fetchDpd };

async function main() {
  const wanted = only ? [only] : Object.keys(CARRIERS);
  const points = [];
  const sources = {};

  for (const carrier of wanted) {
    const fn = CARRIERS[carrier];
    if (!fn) {
      console.error(`unknown carrier "${carrier}" — one of ${Object.keys(CARRIERS).join(", ")}`);
      process.exitCode = 1;
      return;
    }
    try {
      const got = await fn();
      points.push(...got);
      sources[carrier] = { count: got.length, at: new Date().toISOString() };
    } catch (err) {
      console.error(`${carrier}: FAILED —`, String(err?.message || err));
      sources[carrier] = { count: 0, error: String(err?.message || err) };
      process.exitCode = 1;
    }
  }

  points.sort((a, b) =>
    a.carrier === b.carrier
      ? a.country === b.country
        ? a.name.localeCompare(b.name, "et")
        : a.country.localeCompare(b.country)
      : a.carrier.localeCompare(b.carrier),
  );

  const byCountry = {};
  for (const p of points) {
    byCountry[p.country] = (byCountry[p.country] || 0) + 1;
  }
  log("\ntotal", points.length, "points —", JSON.stringify(byCountry));

  if (dry) {
    log("--dry: nothing written");
    return;
  }
  const seed = { generatedAt: new Date().toISOString(), sources, byCountry, points };
  await writeFile(OUT, `${JSON.stringify(seed, null, 0)}\n`, "utf8");
  log("wrote", path.relative(ROOT, OUT));
}

if (process.argv[1] && import.meta.url.startsWith("file:")) {
  const invoked = path.resolve(process.argv[1]);
  if (invoked === fileURLToPath(import.meta.url)) await main();
}
