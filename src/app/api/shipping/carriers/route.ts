import { NextResponse } from "next/server";
import { allow, clientIp } from "@/lib/payments/ratelimit";
import { fetchMontonioCarriers } from "@/lib/shipping/montonio";

/**
 * GET /api/shipping/carriers/
 *   → { ok: true, carriers: [{ code, name, logoUrl }] }
 *
 * The brand mark for each parcel-machine carrier in the delivery step. Dim,
 * 08.09.2026: show the mark and the name, the way the bank list already does
 * it — «это ровно та же картинка, что покупатель увидит на почте».
 *
 * Deliberately the twin of GET /api/payments/methods/, down to the shape of
 * this comment: Montonio hands the logos out of `GET /carriers`, that reader
 * holds them for six hours in the instance
 * (fetchMontonioCarriers(), src/lib/shipping/montonio.ts), and this route only
 * answers when Montonio is configured. Without keys there is no list to give,
 * and the checkout already knows what to do with anything that is not a 200:
 * it keeps the coloured dots it has drawn since the beginning.
 *
 * Nothing here decides anything. Which carriers the checkout offers is still
 * CARRIERS_BY_COUNTRY plus whichever machine lists came back non-empty
 * (public/shop2/app.js); this route only changes the picture on the chip.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60_000;

export async function GET(req: Request) {
  if (!allow(`carriers:${clientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

  const carriers = await fetchMontonioCarriers();
  if (!carriers) {
    return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  }

  return NextResponse.json(
    { ok: true, carriers },
    {
      headers: {
        /* Six hours at the shared cache, unlike the five minutes on the bank
           list: there is no owner-facing switch behind this one, so nothing a
           person can change is waiting on it to expire. A day of
           stale-while-revalidate so a slow Montonio never holds up the
           delivery step. */
        "cache-control": "public, s-maxage=21600, stale-while-revalidate=86400",
      },
    },
  );
}
