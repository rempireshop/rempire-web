/**
 * The last resort of the shop's search: turning a phrase the catalogue has no
 * words for into words it does have.
 *
 * The storefront searches names, then descriptions, then a curated table of
 * concerns (public/shop2/app.js, «search: what the shopper means»). All three
 * are free, instant and work with no server at all, and between them they
 * answer nine phrases in ten. This module is for the tenth: «cheveux gras»,
 * a misspelt brand, a language nobody wrote a table for. POST /api/search
 * asks the model for three to eight words that WOULD appear in a product
 * text, the storefront searches again with those, and the answer is
 * remembered so the same phrase is never paid for twice.
 *
 * Everything here is pure or in-memory — no network, no database — so the
 * prompt, the sanitiser and the cache are all testable without a model
 * (tests/search-terms.test.ts). The route owns the actual call, exactly as
 * src/lib/ai-prompts.ts and src/app/api/admin/ai/text/route.ts split the same
 * work.
 *
 * Nothing the model says is ever shown to the shopper. Its words are search
 * terms and only search terms: they can add products to a result list and
 * they can do nothing else, so a wrong answer costs a few odd cards on a page
 * that was otherwise empty — never a wrong sentence in the shop's voice.
 */

/** A query longer than this is not a query, it is a paste. */
export const SEARCH_QUERY_MAX = 80;
/** Fewer than this and there is nothing to work with. */
export const SEARCH_QUERY_MIN = 2;
/** More than this and the widened search stops meaning anything. */
export const SEARCH_TERMS_MAX = 8;
/** One term is one or two words — «split ends», «жирные волосы». */
export const SEARCH_TERM_MAX_CHARS = 24;

export const SEARCH_LANGS = ["RU", "ET", "EN"] as const;
export type SearchLang = (typeof SEARCH_LANGS)[number];

export function isSearchLang(v: unknown): v is SearchLang {
  return typeof v === "string" && (SEARCH_LANGS as readonly string[]).includes(v);
}

/**
 * The shopper's phrase, cleaned to what may go in a prompt: one line, control
 * characters gone, capped. `null` when there is nothing worth asking about —
 * the route answers 400 and the storefront keeps the page it already has.
 */
export function cleanSearchQuery(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, SEARCH_QUERY_MAX);
  if (q.length < SEARCH_QUERY_MIN) return null;
  // a query with no letter in it at all — a barcode, a price, a row of emoji —
  // has nothing for a model to translate
  if (!/\p{L}/u.test(q)) return null;
  return q;
}

/** The cache key: the same phrase in the same language, however it was typed. */
export function searchCacheKey(q: string, lang: string): string {
  return `${lang}|${q.toLowerCase().replace(/\s+/g, " ").trim()}`;
}

/**
 * What the shop sells, in the words its own texts use — the whole of the
 * model's world. Hard-coded rather than derived from the catalogue file on
 * purpose: it is the *vocabulary* that has to be stable, not the stock list,
 * and a prompt that grows with the catalogue is a prompt whose cost and
 * behaviour drift without anybody deciding they should.
 */
const SHOP_BRANDS =
  "Anua, Byredo, CBD Daily, Captain Fawcett, Christian Dior, Cosrx, Creed, Davines, Gatsby, Guerlain, " +
  "Gummy, Kevin.Murphy, Kilian, LANEIGE, Lumin Skin, Maison Francis Kurkdjian, Nature Republic, " +
  "Paul Mitchell, Proraso, Rempire, Roja, System 4, Tom Ford, Versace, Xerjoff, Yumain";
const SHOP_SECTIONS = "hair care, styling, beard care, face care, body care, fragrance, merch";

/**
 * The prompt. Two rules do all the work: answer with words that would be
 * PRINTED IN a product text, and answer with nothing else at all.
 */
export function buildSearchTermsPrompt(q: string, lang: SearchLang): { system: string; user: string } {
  const system = [
    "You turn a shopper's phrase into search words for a men's grooming shop in Tallinn.",
    `The shop sells: ${SHOP_SECTIONS}. Brands: ${SHOP_BRANDS}.`,
    "Product descriptions are written in Russian, Estonian and English, all three at once,",
    "so answer with the words those texts would actually PRINT — an ingredient, a hair or",
    "skin concern, a product type, a brand. Never a word the shopper used unless a text",
    `would use it too. Give ${SEARCH_TERMS_MAX} terms at most, best first, one or two words each,`,
    "in Russian or English (Estonian too when it is the obvious word).",
    "If the phrase is about something this shop does not sell — a laptop, a car, a person —",
    "answer with an empty list rather than guessing.",
    'Respond ONLY with JSON: {"terms":["…","…"]}',
  ].join(" ");
  const user = `Shopper's phrase (interface language ${lang}): ${q}`;
  return { system, user };
}

/**
 * The model's answer, rebuilt field by field — the discipline every sanitiser
 * in this repo follows. What comes back is a list of short plain-text terms
 * and nothing else: no markup, no punctuation the search would choke on, no
 * duplicates, never more than SEARCH_TERMS_MAX.
 */
export function cleanSearchTerms(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { terms?: unknown }).terms)
      ? ((raw as { terms: unknown[] }).terms)
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (typeof item !== "string") continue;
    const t = item
      .toLowerCase()
      .replace(/[^0-9a-zа-яёÀ-ɏ\s-]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, SEARCH_TERM_MAX_CHARS)
      .trim();
    if (t.length < 2 || !/\p{L}/u.test(t)) continue;
    if (t.split(" ").length > 2) continue;   // a sentence is not a search term
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= SEARCH_TERMS_MAX) break;
  }
  return out;
}

/* ---------- the cache ----------------------------------------------------
   One Map per serverless instance, gone on a cold start — the same
   best-effort posture as the rate limiter in src/lib/auth.ts, and enough:
   the phrases that reach this route at all are the handful the shop's own
   words cannot answer, and the shop is one small barbershop's, not Amazon's.
   An EMPTY answer is cached too, and that is the point — «what is my order
   number» must be paid for once, not once a visit. */
const CACHE_MAX = 500;
const CACHE_MS = 24 * 3600 * 1000;
const cache = new Map<string, { terms: string[]; at: number }>();

export function cachedTerms(key: string): string[] | null {
  const rec = cache.get(key);
  if (!rec) return null;
  if (Date.now() - rec.at > CACHE_MS) {
    cache.delete(key);
    return null;
  }
  return rec.terms;
}

export function rememberTerms(key: string, terms: string[]): void {
  if (cache.size >= CACHE_MAX) {
    // oldest first — Map keeps insertion order, and every entry is rewritten
    // on a refresh, so the first key is the least recently written one
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { terms, at: Date.now() });
}

/** Tests only — forget every answer. */
export function resetSearchTermsCache(): void {
  cache.clear();
}
