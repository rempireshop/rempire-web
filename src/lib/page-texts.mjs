/* settings.page_texts — the owner's own words for the section and brand
   pages (Dim, 26.10.2026: «he needs to be able to manage it from somewhere»):
   per page and language, the Google title and description and the line under
   the heading.

     { cat:   { hair: { RU: { title, desc, intro }, ET: { … }, EN: { … } }, … },
       brand: { "System 4": { RU: { … } }, … } }

   Only what the owner wrote is stored; a field left out is the approved copy
   in src/lib/seo-copy.mjs (or the shop's own line under a heading,
   catIntro() in public/shop2/app.js). The shared block there reads this
   document (seoOwnSet / seoOwn): the prerender sets it from the database
   before it writes a page, the shop from /api/overrides at boot.

   Written through PUT /api/admin/settings — «Настройки → Тексты страниц» and
   Renat's Claude (save_page_text in src/lib/mcp/tools.ts) — and cleaned here
   on the way in, so neither door can store more than the pages print. */

export const PAGE_TEXT_LANGS = ["RU", "ET", "EN"];
export const PAGE_TEXT_FIELDS = ["title", "desc", "intro"];
/* A title Google shows about 60 characters of, a description about 155 —
   the same 70/170 the product «Для Google» boxes allow (src/lib/product-seo.ts).
   The intro is one paragraph under the heading. */
export const PAGE_TEXT_LIMITS = { title: 70, desc: 170, intro: 1200 };
/** The section pages: the seven sections and «Все товары». */
export const PAGE_TEXT_CATS = ["all", "hair", "styling", "beard", "face", "body", "perfume", "merch"];
const MAX_BRANDS = 300;
const MAX_BRAND_NAME = 60;
/* keys a JSON body may carry that an object literal must never take as its own */
const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

/** One line: control and format characters out, spaces collapsed, cut at `max`. */
function line(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** @typedef {{ title?: string, desc?: string, intro?: string }} PageTextFields */
/** @typedef {Partial<Record<"RU" | "ET" | "EN", PageTextFields>>} PageTextPage */
/** @typedef {{ cat: Record<string, PageTextPage>, brand: Record<string, PageTextPage> }} PageTexts */

/**
 * The document as it may be stored — anything else dropped, never refused.
 * @param {unknown} raw
 * @returns {PageTexts}
 */
export function cleanPageTexts(raw) {
  /** @type {PageTexts} */
  const out = { cat: {}, brand: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const kind of ["cat", "brand"]) {
    const src = raw[kind];
    if (!src || typeof src !== "object" || Array.isArray(src)) continue;
    let n = 0;
    for (const rawKey of Object.keys(src)) {
      const key = kind === "brand" ? line(rawKey, MAX_BRAND_NAME) : rawKey;
      if (!key || RESERVED.has(key)) continue;
      if (kind === "cat" && !PAGE_TEXT_CATS.includes(key)) continue;
      if (n >= MAX_BRANDS) break;
      const page = src[rawKey];
      if (!page || typeof page !== "object" || Array.isArray(page)) continue;
      const langs = {};
      for (const L of PAGE_TEXT_LANGS) {
        const f = page[L];
        if (!f || typeof f !== "object" || Array.isArray(f)) continue;
        const one = {};
        for (const field of PAGE_TEXT_FIELDS) {
          const v = line(f[field], PAGE_TEXT_LIMITS[field]);
          if (v) one[field] = v;
        }
        if (Object.keys(one).length) langs[L] = one;
      }
      if (Object.keys(langs).length) {
        out[kind][key] = langs;
        n++;
      }
    }
  }
  return out;
}
