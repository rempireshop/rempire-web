/* Which of a topic's words can pick a page of a brand's catalogue — one list
   for the two places that pick (Dim, 02.11.2026: the real test of «article
   from materials» on Kevin.Murphy's 170-page Russian catalogue).

     · public/shop2/app.js pre-ticks the PDF's photo pages (bnewKeys,
       bnewOpener, bnewPreTick). It cannot import anything (no build step), so
       it carries a MIRROR of this file — BNEW_GENERIC, BNEW_BRAND_CYR,
       BNEW_LAT — and tests/blog-materials.test.ts holds the mirror to it,
       list for list and answer for answer.
     · src/lib/blog-materials.ts chooses the pages the writer reads
       (selectMaterialText), and imports this file.

   The test showed why: the topic «Сухие волосы зимой: … Hydrate от
   Kevin.Murphy — шампунь, кондиционер, маска и ночной уход» shares «kevin»,
   «волос» and «уход» with every page of the book, so every page matched it
   and the first ones won. A word every page says picks nothing.

   Plain ESM, like blog-magazine.mjs: the Next routes and the tests import it
   unchanged. */

/** Stems every page of a catalogue says. A topic stem that starts with one picks nothing. */
export const GENERIC_ROOTS = ["волос", "уход", "ухаж", "лини", "линей", "шампу", "конди", "маск", "масл", "спре", "крем", "гел", "паст", "воск",
  "средс", "проду", "товар", "косме", "бренд", "салон", "профе", "приме", "преим", "ингре", "основ", "испол", "польз", "выбра", "выбор",
  "нанес", "кожа", "кожи", "кожу", "голов", "hair", "care", "line", "shamp", "condi", "mask", "masqu", "wash", "rinse", "spray", "oil",
  "cream", "gel", "paste", "wax", "produ", "brand", "salon", "juuks", "hoold", "šampo", "palsa", "õli", "sprei", "kreem", "toode", "toote", "kasut"];

/** The shop's brands as Russian writes them, ё folded to е: «Кевина Мёрфи», «Мерфи», «Мэрфи». The Latin
    spellings come from the catalogue itself (brandStems); «Кевин» is caught both here and by LATIN_OF. */
export const BRAND_CYRILLIC = ["кевин", "мерфи", "мэрфи", "мурфи"];

/** Cyrillic → Latin, letter by letter, so «кевин» meets the catalogue's «kevin». ё is е. */
export const LATIN_OF = { "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i", "й": "i", "к": "k",
  "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "c", "ч": "ch",
  "ш": "sh", "щ": "sh", "ы": "y", "э": "e", "ю": "yu", "я": "ya" };

/** Lower case, ё as е — what both a key and the text it is looked for in are made into. */
export function foldWord(s) {
  return String(s || "").toLowerCase().replace(/ё/g, "е");
}

/**
 * Every word of the brands' names as a five-letter stem: «Kevin.Murphy» →
 * kevin, murph.
 * @param {Iterable<string>} brands
 * @returns {Set<string>}
 */
export function brandStems(brands) {
  const out = new Set();
  for (const b of brands) {
    for (const w of foldWord(b).split(/[^a-z0-9а-яёõäöüšž]+/)) if (w.length >= 3) out.add(w.length > 5 ? w.slice(0, 5) : w);
  }
  return out;
}

/**
 * The topic's stems (topicStems) that can pick a page, folded: no generic
 * word, no brand in either alphabet.
 * @param {string[]} stems
 * @param {Set<string>} brands  brandStems() of the shop's brands
 * @returns {string[]}
 */
export function topicKeys(stems, brands) {
  const out = [];
  for (const raw of stems || []) {
    const s = foldWord(raw);
    if (GENERIC_ROOTS.some((g) => s.startsWith(g)) || BRAND_CYRILLIC.some((b) => s.startsWith(b))) continue;
    const lat = s.replace(/[а-я]/g, (c) => LATIN_OF[c] || "").slice(0, 5);
    if (brands.has(s) || brands.has(lat) || out.includes(s)) continue;
    out.push(s);
  }
  return out;
}

/**
 * A line's own opening page — «HYDRATE», «REPAIR», «DETOX», «EVERLASTING.
 * COLOUR», «STYLE/CONTROL», or «CURL» printed on a picture: Latin capitals,
 * three words at most, and none of them joined by a dot or a hyphen the way
 * a product's name is («HYDRATE-ME.WASH», «NIGHT.SHIFT»). The line runs from
 * it to the next opener.
 * @param {string} heading
 */
export function isLineOpener(heading) {
  const h = String(heading || "").trim().replace(/[.:!?]+$/, "");
  return /^[A-Z]+(?:(?:\.? | ?[/&] ?)[A-Z]+){0,2}$/.test(h) && h.replace(/[^A-Z]/g, "").length >= 4;
}

/** How many of the keys a text says. */
export function keyHits(text, keys) {
  const low = foldWord(text);
  let n = 0;
  for (const k of keys) if (low.includes(k)) n++;
  return n;
}
