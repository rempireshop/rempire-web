import { NextResponse } from "next/server";
import { getPoints, isCarrier, seedGeneratedAt, type ParcelPoint } from "@/lib/parcel-points";
import { allow, clientIp } from "@/lib/payments/ratelimit";

/**
 * GET /api/shipping/points/?country=EE&carrier=omniva|dpd|smartpost
 *   → { ok: true, points: [{ id, carrier, name, address, city, zip, lat, lng }] }
 *
 * The checkout's parcel-machine picker. Cached hard at the edge (an hour) and
 * for six hours in the instance, because a carrier's machine list changes a
 * few times a month, not a few times a minute.
 *
 * `source` says where the answer came from — "live", "cache" or "seed" — so a
 * carrier feed that has quietly died is visible without reading the logs.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;
const COUNTRY_RE = /^[A-Z]{2}$/;

/** The wire shape stays small — this list can be 3000 rows long. */
function slim(p: ParcelPoint) {
  return {
    id: p.id,
    carrier: p.carrier,
    name: p.name,
    address: p.address,
    city: p.city,
    zip: p.zip,
    lat: p.lat,
    lng: p.lng,
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
  if (!isCarrier(carrierParam)) {
    return NextResponse.json({ ok: false, error: "bad_carrier" }, { status: 400 });
  }

  const { points, source } = await getPoints(carrierParam, country);

  return NextResponse.json(
    {
      ok: true,
      country,
      carrier: carrierParam,
      source,
      seedAt: source === "seed" ? seedGeneratedAt() : undefined,
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
