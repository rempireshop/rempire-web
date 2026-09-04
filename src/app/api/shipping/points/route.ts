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
 * GET /api/shipping/points/?country=EE&carrier=omniva|dpd|smartpost|venipak|all
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

  return NextResponse.json(
    {
      ok: true,
      country,
      carrier: carrierParam,
      source,
      seedAt: sources.includes("seed") ? seedGeneratedAt() : undefined,
      count: points.length,
      points: points.map(slim),
    },
    {
      headers: {
        // shared caches hold it for an hour and may serve a stale copy for a
        // day while they refresh in the background
        "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
