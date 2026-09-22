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

export interface SearchablePoint {
  name?: string | null;
  address?: string | null;
  city?: string | null;
  zip?: string | null;
}

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

/** The point's postcode, from its own field or, failing that, from its name. */
export function pointZip(p: SearchablePoint): string {
  const own = normZip(p.zip);
  if (own) return own;
  const m = String(p.name ?? "").match(/\b(\d{2}-\d{3}|\d{4,5})\b/);
  return m ? normZip(m[1]) : "";
}

/**
 * Every point, nearest postcode first: the longest shared leading run of
 * digits wins, then the smallest numeric gap over the digits typed, then the
 * postcode itself so equal ones sit together. Points with no postcode at all
 * go last rather than disappearing.
 */
export function rankByPostcode<T extends SearchablePoint>(points: readonly T[], q: string): T[] {
  const want = normZip(q);
  const n = want.length;
  const target = Number.parseInt(want, 10);
  const scored = points.map((p, i) => {
    const zip = pointZip(p);
    let shared = 0;
    while (shared < n && shared < zip.length && zip[shared] === want[shared]) shared++;
    const head = Number.parseInt(zip.slice(0, n), 10);
    const gap = zip && Number.isFinite(head) ? Math.abs(head - target) : Number.POSITIVE_INFINITY;
    return { p, i, zip, shared, gap };
  });
  scored.sort(
    (a, b) =>
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
  const hay = `${p.name ?? ""} ${p.address ?? ""} ${p.city ?? ""} ${p.zip ?? ""} ${pointZip(p)}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** The one entry point: a postcode orders, anything else filters. */
export function searchPoints<T extends SearchablePoint>(points: readonly T[], q: string): T[] {
  const query = q.trim();
  if (isPostcodeQuery(query)) return rankByPostcode(points, query);
  return points.filter((p) => matchesWords(p, query));
}
