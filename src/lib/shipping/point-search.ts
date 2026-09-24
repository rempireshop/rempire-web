/**
 * «Ближайший к моему адресу» without a map.
 *
 * Montonio returns no coordinates for a pickup point — not one of Poland's
 * 33 603 DPD points or 45 791 Nova Post ones, not Germany's, not even
 * Estonia's DPD machines (checked on staging, 22.09.2026). So there are no pins
 * to draw and no distance to measure. What every point DOES carry is a
 * postcode, and postcodes are geographic by their leading digits: the same
 * code is the same street, the same first three digits the same town, the same
 * first two the same district. Дим, 22.09.2026: «when choosing the point
 * client can choose by his address/closest to his address».
 *
 * So a search that is a postcode — `91-433`, `91433`, `914`, `LV-1010` — is not
 * a filter but an ORDER: every point, nearest postcode first. Anything else is
 * the old word filter over name, address, town and postcode.
 *
 * Two quirks this exists to absorb:
 *   · Polish DPD stores `91433` where a Pole types `91-433`, so the old
 *     substring match found nothing for the way people actually write it;
 *   · Nova Post's names carry the postcode (`(InPost) 32-065, Polska, …`)
 *     while its `zip` may be empty, so the name is read when the field is.
 *
 * The storefront runs the same rules on lists small enough to hold whole —
 * pointsByPostcode() in public/shop2/app.js — and tests/point-search.test.ts
 * holds the two to the same order.
 */

import postcodeGeoData from "@/data/postcode-geo.json";

export interface SearchablePoint {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
  carrier?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/**
 * Where a postcode is, roughly: the middle of the committed points whose
 * postcode starts with these two or three digits — `{ EE: { "101": [lat,
 * lng] } }`, built by tools/postcode-geo.mjs from the parcel-point seed.
 * Estonia only: no committed row gives a Latvian or Lithuanian postcode a
 * place.
 */
const POSTCODE_GEO = postcodeGeoData as unknown as Record<string, Record<string, [number, number]>>;

/** `LV-1010` → `1010`, `91-433` → `91433`, ` 00 950 ` → `00950`. */
export function normZip(s: unknown): string {
  return String(s ?? "")
    .toUpperCase()
    .replace(/^[A-Z]{2}(?=[-\s]?\d)/, "")
    .replace(/[^0-9A-Z]/g, "");
}

/** Is what the shopper typed a postcode (or the start of one)? */
export function isPostcodeQuery(q: string): boolean {
  return /^\d{2,}$/.test(normZip(q));
}

/**
 * Is this point's `zip` a postcode at all?
 *
 * Not at Omniva. Montonio's `postalCode` for an Omniva point is the machine's
 * own terminal code — 96001 for Tallinn's Balti Jaam, 9908 for a Riga Rimi,
 * 99615 for a Vilnius one — exactly as Omniva's public feed says of its ZIP
 * (docs/shipping.md, «Две ловушки Omniva»). Read as postcodes, they put
 * Kihnu, Vormsi and Ruhnu (88999, 91999, 93999) first for Tallinn's 10120
 * (Дим, /test 24.09.2026: «does not find "nearest" or almost anything close
 * to»). Omniva's points are placed by their coordinates instead —
 * rankByPostcode() below.
 */
export function zipIsPostcode(p: SearchablePoint): boolean {
  return String(p.carrier ?? "").toLowerCase() !== "omniva";
}

/** The point's postcode, from its own field or, failing that, from its name. */
export function pointZip(p: SearchablePoint): string {
  if (!zipIsPostcode(p)) return "";
  const own = normZip(p.zip);
  if (own) return own;
  const m = String(p.name ?? "").match(/\b(\d{2}-\d{3}|\d{4,5})\b/);
  return m ? normZip(m[1]) : "";
}

/** Where the typed postcode is, by its longest known prefix, or null. */
export function postcodeAnchor(country: string, q: string): [number, number] | null {
  const table = POSTCODE_GEO[String(country ?? "").toUpperCase()];
  if (!table) return null;
  const want = normZip(q);
  for (let n = Math.min(3, want.length); n >= 2; n--) {
    const at = table[want.slice(0, n)];
    if (at) return at;
  }
  return null;
}

/** Squared distance, in degrees of latitude, from `a` to the point — or Infinity without coordinates. */
function geoGap(a: [number, number], p: SearchablePoint): number {
  if (typeof p.lat !== "number" || typeof p.lng !== "number" || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) {
    return Number.POSITIVE_INFINITY;
  }
  const k = Math.cos((a[0] * Math.PI) / 180);
  const dy = p.lat - a[0];
  const dx = (p.lng - a[1]) * k;
  return dy * dy + dx * dx;
}

/**
 * Every point, nearest postcode first: the longest shared leading run of
 * digits wins, then the smallest numeric gap over the digits typed, then the
 * postcode itself so equal ones sit together.
 *
 * A point with no postcode but with coordinates — every Omniva machine —
 * comes after those, nearest to where the typed postcode is
 * (postcodeAnchor) first; in an Omniva list that is the whole order, so
 * 10120 opens on Stockmann, Viru Keskus and Solaris. Points with neither go
 * last rather than disappearing.
 */
export function rankByPostcode<T extends SearchablePoint>(points: readonly T[], q: string, country = ""): T[] {
  const want = normZip(q);
  const n = want.length;
  const target = Number.parseInt(want, 10);
  const anchor = postcodeAnchor(country, want);
  const scored = points.map((p, i) => {
    const zip = pointZip(p);
    if (zip) {
      let shared = 0;
      while (shared < n && shared < zip.length && zip[shared] === want[shared]) shared++;
      const head = Number.parseInt(zip.slice(0, n), 10);
      const gap = Number.isFinite(head) ? Math.abs(head - target) : Number.POSITIVE_INFINITY;
      return { p, i, zip, tier: 0, shared, gap };
    }
    const far = anchor ? geoGap(anchor, p) : Number.POSITIVE_INFINITY;
    return { p, i, zip, tier: Number.isFinite(far) ? 1 : 2, shared: 0, gap: far };
  });
  scored.sort(
    (a, b) =>
      a.tier - b.tier ||
      b.shared - a.shared ||
      a.gap - b.gap ||
      (a.zip < b.zip ? -1 : a.zip > b.zip ? 1 : 0) ||
      a.i - b.i,
  );
  return scored.map((s) => s.p);
}

/** Every word typed appears somewhere in the row — postcode read either way. */
export function matchesWords(p: SearchablePoint, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const own = zipIsPostcode(p) ? (p.zip ?? "") : "";
  const hay = `${p.name ?? ""} ${p.address ?? ""} ${p.city ?? ""} ${own} ${pointZip(p)}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * The one entry point: a postcode orders, anything else filters.
 *
 * `country` is the list's — it says where a postcode is (postcodeAnchor).
 * A postcode over a list with nothing to measure it by — a Latvian or
 * Lithuanian Omniva list: terminal codes and no known place for the code —
 * is searched as words instead, which finds nothing and says so («Ничего не
 * нашли. Попробуйте название города или улицы.») rather than handing back
 * the whole country in an order that only looks like an answer.
 */
export function searchPoints<T extends SearchablePoint>(points: readonly T[], q: string, country = ""): T[] {
  const query = q.trim();
  if (isPostcodeQuery(query)) {
    const anchor = postcodeAnchor(country, query);
    if (points.some((p) => pointZip(p) || (anchor && Number.isFinite(geoGap(anchor, p))))) {
      return rankByPostcode(points, query, country);
    }
  }
  return points.filter((p) => matchesWords(p, query));
}
