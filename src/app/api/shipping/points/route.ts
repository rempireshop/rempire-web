import { NextResponse } from "next/server";
import { CARRIERS, getPoints, isCarrier, seedGeneratedAt } from "@/lib/parcel-points";
import {
  enrichCoordinates,
  fetchMontonioPickupPoints,
  fromParcelPoint,
  mergePoints,
  type MontonioPoint,
} from "@/lib/shipping/montonio";
import { allow, clientIp } from "@/lib/payments/ratelimit";

/**
 * GET /api/shipping/points/?country=EE&carrier=omniva|dpd|smartpost|unisend|novapost|all
 *   → { ok: true, points: [{ id, carrier, name, address, city, zip, lat, lng, type }] }
 *
 * The checkout's parcel-machine picker. Cached hard at the edge (an hour) and
 * for six hours in the instance, because a carrier's machine list changes a
 * few times a month, not a few times a minute.
 *
 * Two sources, in this order:
 *   1. **Montonio Shipping**, when MONTONIO_ACCESS_KEY / MONTONIO_SECRET_KEY are
 *      set. One key pair, every carrier Renat has activated — including DPD in
 *      EE/LV/LT and anything at all in Finland, neither of which has a public
 *      feed. Its ids are UUIDs, and only those can address a shipment later.
 *   2. the carriers' own feeds and the committed seed, for whatever Montonio
 *      did not answer for. A carrier Montonio covered is not merged from the
 *      feed at all — see mergePoints().
 *
 * `source` says which paths served the answer ("montonio", "montonio+seed",
 * "live", "cache", "seed"), so a feed — or a key — that has quietly died is
 * visible without reading the logs.
 *
 * An unknown carrier is not an error: it answers `{ ok: true, points: [] }`, and
 * the storefront drops that chip. A 400 there would leave the checkout showing
 * a carrier nobody can pick from.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const COUNTRY_RE = /^[A-Z]{2}$/;
const CARRIER_RE = /^[a-z][a-z0-9_-]{1,20}$/;

/**
 * How many rows one answer may carry, and why there is a ceiling at all.
 *
 * Until 19.09.2026 the checkout could only ask about four countries, and the
 * longest list in them is Finland's 1 768 SmartPost points. Then the lockers
 * of every country DPD serves were opened, and the lists stop being anything
 * a phone should download: Poland is 33 603 rows, Germany 10 106, Italy
 * 12 048 — several megabytes of JSON to choose one machine from.
 *
 * So the answer is capped, and the shopper's own typing does the narrowing on
 * this side instead: `?q=` filters by name, address, city and postcode before
 * the cap applies, over a list this instance already holds for six hours
 * (fetchMontonioPickupPoints caches it). `truncated` tells the storefront that
 * what it holds is not the whole country, so it can ask again as the shopper
 * types rather than pretend its own filter sees everything.
 */
const DEFAULT_LIMIT = 1500;
const MAX_LIMIT = 3000;
const MIN_QUERY = 2;

/** Every word typed has to appear somewhere in the row — the same rule the
    storefront's own typeahead uses (pointsMatching() in app.js). */
function matcher(q: string): (p: MontonioPoint) => boolean {
  const words = q.split(/\s+/).filter(Boolean);
  return (p) => {
    const hay = `${p.name ?? ""} ${p.address ?? ""} ${p.city ?? ""} ${p.zip ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };
}

/** The wire shape stays small — this list can be 3000 rows long. */
function slim(p: MontonioPoint) {
  return {
    id: p.id,
    carrier: p.carrier,
    name: p.name,
    address: p.address,
    city: p.city,
    zip: p.zip,
    lat: p.lat,
    lng: p.lng,
    type: p.type,
  };
}

export async function GET(req: Request) {
  if (!allow(`points:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const params = new URL(req.url).searchParams;
  const country = (params.get("country") ?? "EE").trim().toUpperCase();
  const carrierParam = (params.get("carrier") ?? "omniva").trim().toLowerCase();
  const q = (params.get("q") ?? "").trim().toLowerCase().slice(0, 60);
  const askedLimit = Number(params.get("limit"));
  const limit = Number.isFinite(askedLimit) && askedLimit > 0 ? Math.min(MAX_LIMIT, Math.floor(askedLimit)) : DEFAULT_LIMIT;

  if (!COUNTRY_RE.test(country)) {
    return NextResponse.json({ ok: false, error: "bad_country" }, { status: 400 });
  }
  if (carrierParam !== "all" && !CARRIER_RE.test(carrierParam)) {
    return NextResponse.json({ ok: false, error: "bad_carrier" }, { status: 400 });
  }

  const sources: string[] = [];
  let points: MontonioPoint[] = [];

  const montonio = await fetchMontonioPickupPoints({
    country,
    carrier: carrierParam === "all" ? undefined : carrierParam,
  });
  if (montonio && montonio.length) {
    points = montonio;
    sources.push("montonio");
  }

  /* Whatever Montonio did not cover, the public feeds still might — but only
     for the three carriers that have one at all, and only where Montonio has
     not already answered for that carrier. Skipping those saves the 850 KB
     Omniva download on every request once Montonio is live. */
  const feedCarriers = carrierParam === "all" ? CARRIERS : isCarrier(carrierParam) ? [carrierParam] : [];
  for (const carrier of feedCarriers) {
    if (points.some((p) => p.carrier === carrier)) {
      /* Montonio answered for this carrier, so its rows stay — but they have
         no coordinates, and without coordinates the map in the checkout is
         empty. The same feed lends them its lat/lng (enrichCoordinates), the
         feed's own rows are not merged in. */
      if (points.some((p) => p.carrier === carrier && p.lat === null)) {
        const feed = await getPoints(carrier, country);
        if (feed.points.length) {
          const enriched = enrichCoordinates(points, feed.points.map(fromParcelPoint));
          points = enriched.points;
          if (enriched.matched && !sources.includes("geo:" + feed.source)) sources.push("geo:" + feed.source);
        }
      }
      continue;
    }
    const feed = await getPoints(carrier, country);
    if (!feed.points.length) continue;
    points = mergePoints(points, feed.points.map(fromParcelPoint));
    if (!sources.includes(feed.source)) sources.push(feed.source);
  }

  const source = sources.length ? sources.join("+") : montonio ? "montonio" : "seed";

  /*
   * Did anybody actually answer?
   *
   * `fetchMontonioPickupPoints()` returns `null` — never a throw — when there
   * are no keys or when every carrier call failed, and `[]` when Montonio
   * answered and had nothing. The route cannot tell those apart from the list
   * alone, and the public feeds cover only omniva/dpd/smartpost in EE/LV/LT
   * (src/lib/parcel-points.ts), so a Finnish or Unisend/Nova Post lookup has
   * nothing else to fall back on.
   *
   * An empty list from a lookup that FAILED must not be cached: with
   * `s-maxage=3600` one slow minute at Montonio took the parcel-machine chips
   * off the checkout for an hour — and, with the stale window, up to a day —
   * for every shopper behind that edge. So the failure answers `no-store` and
   * the next shopper asks again. A real empty answer (Montonio replied, that
   * carrier has no machines there) keeps the hour, because it is the truth and
   * it does not change by the minute.
   */
  const answered = montonio !== null || sources.length > 0;

  /* A query shorter than two letters narrows nothing and would only make the
     edge cache hold a second copy of the same list, so it is ignored. */
  const matched = q.length >= MIN_QUERY ? points.filter(matcher(q)) : points;
  const shown = matched.slice(0, limit);

  return NextResponse.json(
    {
      ok: true,
      country,
      carrier: carrierParam,
      source,
      seedAt: sources.includes("seed") ? seedGeneratedAt() : undefined,
      /** How many rows are in `points` — unchanged, and still `points.length`. */
      count: shown.length,
      /** How many matched before the cap: what «показаны первые N из M» says. */
      total: matched.length,
      /** There is more of this country than the answer carries: ask again with `q`. */
      truncated: matched.length > shown.length,
      q: q.length >= MIN_QUERY ? q : undefined,
      points: shown.map(slim),
    },
    {
      headers: {
        // shared caches hold it for an hour and may serve a stale copy for a
        // day while they refresh in the background
        "cache-control": answered
          ? "public, s-maxage=3600, stale-while-revalidate=86400"
          : "no-store",
      },
    },
  );
}
