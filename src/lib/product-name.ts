/**
 * The product name in the customer's language — on the server.
 *
 * Catalogue names are written «<Latin line name> — <Russian type tail>»:
 * «Bio Botanical Shampoo — шампунь», «Чёрное мыло 666 — ручная работа». The
 * storefront turns the tail into Estonian or English in the browser —
 * trName() in public/shop2/app.js, with the tables NAME_TAILS, TAIL_EXACT and
 * NAME_FRAGS — so a shopper on the English site reads «— shampoo». Nothing
 * the server writes went through that function: the invoice PDF and every
 * order letter printed «Rempire Чёрное мыло 666 — ручная работа · 1 pc» to an
 * English customer (Dim's phone, 10.09.2026).
 *
 * This file is that function, ported line for line, and the same three
 * tables. Two copies of one rule set drift the day someone extends one of
 * them, so tests/product-name.test.ts slices trName() and its tables out of
 * app.js and runs both sides over every name in the catalogue: the copies
 * must agree on all of it, or CI says so. Extend a tail here AND in app.js.
 *
 * What the rule does, and does not, do — the same on both sides:
 *   · a name without « — <Cyrillic tail>» passes through untouched (Davines,
 *     Byredo, every line name is Latin);
 *   · a tail whose first word is unknown is left alone rather than mangled
 *     («— скраб для лица» stays Russian on every site);
 *   · a known head with an untranslatable remainder keeps the head only
 *     («— бальзам после бритья» → «— balm»);
 *   · Russian stays Russian.
 * Only the name is translated: a variant («250 мл») appended after it puts
 * the tail away from the end of the string, so translate before appending.
 */

/** «шампунь» → [Estonian, English]. */
export const NAME_TAILS: Readonly<Record<string, readonly [string, string]>> = {
  "шампунь": ["šampoon", "shampoo"], "кондиционер": ["palsam", "conditioner"],
  "маска": ["mask", "mask"], "сыворотка": ["seerum", "serum"],
  "тоник": ["toonik", "toner"], "спрей": ["sprei", "spray"],
  "футболка": ["T-särk", "T-shirt"], "худи": ["pusa", "hoodie"],
  "масло": ["õli", "oil"], "бальзам": ["palsam", "balm"],
  "паста": ["pasta", "paste"], "воск": ["vaha", "wax"],
  "пудра": ["puuder", "powder"], "гель": ["geel", "gel"],
  "крем": ["kreem", "cream"], "пенка": ["vaht", "foam"],
  "лосьон": ["losjoon", "lotion"], "патчи": ["plaastrid", "patches"],
  "глазурь": ["glasuur", "glaze"], "эссенция": ["essents", "essence"],
};

/** The words that may follow a head — « для волос» and the volume. */
export const NAME_FRAGS: ReadonlyArray<readonly [RegExp, { readonly ET: string; readonly EN: string }]> = [
  [/ для волос/g, { ET: " juustele", EN: " for hair" }],
  [/ для кожи головы/g, { ET: " peanahale", EN: " for scalp" }],
  [/ для укладки/g, { ET: " soengu jaoks", EN: " for styling" }],
  [/ для лица/g, { ET: " näole", EN: " for face" }],
  [/ для бороды/g, { ET: " habemele", EN: " for beard" }],
  [/ для бритья/g, { ET: " raseerimiseks", EN: " for shaving" }],
  [/(\d) мл(?![а-яё])/g, { ET: "$1 ml", EN: "$1 ml" }],
];

/** Whole tails that are not «head + fragment». */
export const TAIL_EXACT: Readonly<Record<string, readonly [string, string]>> = {
  "футболка оверсайз": ["oversize T-särk", "oversized tee"],
  "парфюм": ["parfüüm", "perfume"],
  "гидрофильное масло": ["hüdrofiilne õli", "cleansing oil"],
  "ручная работа": ["käsitöö", "handmade"],
};

/**
 * The tails the storefront can translate, in the order the tables list them
 * — what the assistant is told to choose from when it names a product
 * (src/lib/ai-prompts.ts), so it cannot be handed a word neither site knows.
 */
export const TRANSLATABLE_TAILS: readonly string[] = [...Object.keys(NAME_TAILS), ...Object.keys(TAIL_EXACT)];

/** «для волос», «для кожи головы», … — the fragments, without the volume rule. */
export const TRANSLATABLE_FRAGS: readonly string[] = NAME_FRAGS.map(([rx]) => rx.source)
  .filter((s) => s.startsWith(" для "))
  .map((s) => s.trim());

/** "ET" / "EN" the way app.js spells them, or null for Russian and anything unknown. */
function tableLang(lang: unknown): "ET" | "EN" | null {
  const s = String(lang ?? "").toLowerCase().slice(0, 2);
  return s === "et" ? "ET" : s === "en" ? "EN" : null;
}

/**
 * trName(s, lang) from public/shop2/app.js, on the server. `lang` is the
 * order's language in any spelling («et», «EN», «en-GB»); Russian and
 * anything unrecognised return the name as it is.
 */
export function translateProductName(name: string, lang: unknown): string {
  const L = tableLang(lang);
  if (!L) return name;
  const i = L === "ET" ? 0 : 1;
  return String(name).replace(/ — ([а-яё][а-яё \-]*)$/i, (m, tail: string) => {
    const low = tail.toLowerCase();
    if (Object.hasOwn(TAIL_EXACT, low)) return " — " + TAIL_EXACT[low][i];
    const parts = low.split(" ");
    const head = Object.hasOwn(NAME_TAILS, parts[0]) ? NAME_TAILS[parts[0]] : undefined;
    if (!head) return m;
    let rest = " " + parts.slice(1).join(" ");
    if (rest !== " ") {
      for (const [rx, to] of NAME_FRAGS) rest = rest.replace(rx, to[L]);
      if (/[а-яё]/.test(rest)) return " — " + head[i]; // untranslatable remainder — drop it
    } else rest = "";
    return " — " + head[i] + rest;
  });
}
