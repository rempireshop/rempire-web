/**
 * settings.gbp_store_code — the salon's store code in its Google Business
 * Profile, which switches on the local inventory feed (src/lib/local-inventory.ts,
 * docs/google-local-listings.md). Its own module, with no imports, so the
 * settings route can clean the value without pulling the feed code into its
 * function.
 */

/** The settings key that holds the salon's Business Profile store code — empty = the local feed is off. */
export const STORE_CODE_KEY = "gbp_store_code";

/** Google's limit for a store code. */
export const STORE_CODE_MAX = 64;

/**
 * A store code as it may be stored: text, trimmed, no control characters, at
 * most 64 characters (Google's limit) — anything else is "", which is «off».
 * Case is kept: Merchant Center matches it case-sensitively.
 */
export function cleanStoreCode(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  // eslint-disable-next-line no-control-regex
  const s = String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return s.length <= STORE_CODE_MAX ? s : "";
}
