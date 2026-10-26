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
 * the tail away from the end of the string, so translate before appending —
 * and put the variant through translateVariant() below, which is the port of
 * the storefront's volume rules («250 мл» → «250 ml», «50 г» → «50 g»).
 */

/** «шампунь» → [Estonian, English]. */
export const NAME_TAILS: Readonly<Record<string, readonly [string, string]>> = {
  "шампунь": ["šampoon", "shampoo"], "кондиционер": ["palsam", "conditioner"],
  "маска": ["mask", "mask"], "сыворотка": ["seerum", "serum"],
  "тоник": ["toonik", "toner"], "тонер": ["toonik", "toner"], "спрей": ["sprei", "spray"],
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
  "термозащитная пенка": ["kuumakaitsevaht", "heat protection foam"],
  "лосьон для локонов": ["lokilosjoon", "curl lotion"],
  "спрей-воск": ["spreivaha", "spray wax"],
  "бальзам для бороды": ["habemepalsam", "beard balm"],
  "бальзам после бритья": ["raseerimisjärgne palsam", "aftershave balm"],
  "воск для укладки": ["juuksevaha", "styling wax"],
  "гель для бритья": ["raseerimisgeel", "shaving gel"],
  "гель для укладки": ["juuksegeel", "styling gel"],
  "гель для умывания": ["näopesugeel", "cleansing gel"],
  "глазурь для волос": ["juukseglasuur", "hair glaze"],
  "крем для век": ["silmakreem", "eye cream"],
  "крем для лица": ["näokreem", "face cream"],
  "лосьон после бритья": ["raseerimisjärgne losjoon", "aftershave lotion"],
  "маска для кожи головы": ["peanahamask", "scalp mask"],
  "масло для бороды": ["habemeõli", "beard oil"],
  "масло для лица": ["näoõli", "face oil"],
  "паста для укладки": ["viimistluspasta", "styling paste"],
  "пенка для умывания": ["näopesuvaht", "cleansing foam"],
  "пудра для волос": ["juuksepuuder", "hair powder"],
  "скраб для лица": ["näokoorija", "face scrub"],
  "спрей для волос": ["juuksesprei", "hair spray"],
  "сыворотка для волос": ["juukseseerum", "hair serum"],
  "сыворотка для кожи головы": ["peanahaseerum", "scalp serum"],
  "сыворотка для лица": ["näoseerum", "face serum"],
  "тканевая маска": ["kangasmask", "sheet mask"],
  "тоник для кожи головы": ["peanahatoonik", "scalp tonic"],
  "эссенция для лица": ["näoessents", "face essence"],
  "текстурирующий спрей": ["tekstuurisprei", "texture spray"],
  "глина для укладки": ["viimistlussavi", "styling clay"],
  "крем для локонов": ["lokikreem", "curl cream"],
  "крем против пушения": ["krässuvastane kreem", "anti-frizz cream"],
  "крем для кудрявых волос": ["lokkis juuste kreem", "curly hair cream"],
  "моделирующий гель": ["vormiv geel", "sculpting gel"],
  "мусс для объёма": ["kohevusvaht", "volumising mousse"],
  "уплотняющий лосьон": ["tihendav losjoon", "thickening lotion"],
  "пляжный текстурайзер": ["rannasoengu viimistlusvahend", "beach texturiser"],
  "восстанавливающий очищающий уход": ["taastav puhastav hooldus", "repairing cleansing treatment"],
  "несмываемый разглаживающий уход": ["silendav juustesse jäetav hooldus", "smoothing leave-in treatment"],
  "несмываемый восстанавливающий уход": ["taastav juustesse jäetav hooldus", "repairing leave-in treatment"],
  "лосьон для объёма": ["kohevuslosjoon", "volumising lotion"],
  "спрей для локонов": ["lokisprei", "curl spray"],
};

/**
 * Names that are Russian before the dash too — the shop's own soaps (Dim,
 * 06.10.2026). [Russian, Estonian, English]. In app.js this list sits inside
 * trName() itself (`var HEADS`), so every copy lifted from that file carries
 * it; tests/product-name.test.ts holds the two to the same answers.
 */
export const NAME_HEADS: ReadonlyArray<readonly [string, string, string]> = [
  ["Чёрное мыло 666", "Must seep 666", "Black soap 666"],
  ["Розовое мыло Rule Nr 1", "Roosa seep Rule Nr 1", "Pink soap Rule Nr 1"],
];

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
 * The two rules of UI_RX in public/shop2/app.js that turn a size label into
 * the site's language: «250 мл» → «250 ml», «50 г» → «50 g». The variant is
 * what the size buttons say and what the order row keeps, and it is appended
 * after the name on the invoice line and in every letter — «— shampoo ·
 * 215 мл» reached an English customer with the name already translated.
 * Sizes that are not a volume («white / M», «S-M») match neither rule and
 * pass through, in every language. tests/product-name.test.ts runs these
 * against the browser's own UI_RX over every variant in the catalogue.
 */
export const VARIANT_UNITS: ReadonlyArray<readonly [RegExp, { readonly ET: string; readonly EN: string }]> = [
  [/^(\d+(?:[.,]\d+)?) мл$/, { ET: "$1 ml", EN: "$1 ml" }],
  [/^(\d+(?:[.,]\d+)?) г$/, { ET: "$1 g", EN: "$1 g" }],
];

/**
 * A variant («215 мл») in the customer's language. Russian and anything
 * unrecognised return it as it is; so does a size the rules do not know.
 */
export function translateVariant(variant: string, lang: unknown): string {
  const L = tableLang(lang);
  if (!L) return variant;
  const s = String(variant).trim();
  for (const [rx, to] of VARIANT_UNITS) if (rx.test(s)) return s.replace(rx, to[L]);
  return variant;
}

/**
 * Can every language say this name? True when the Estonian and the English
 * name have no Russian word left — the line is Latin (or one of NAME_HEADS)
 * and the type after « — » is one the tables know. What the owner may type
 * into a product's name (src/app/api/admin/overrides/route.ts): a type the
 * tables do not know would stay Russian on the Estonian and English pages,
 * in their letters and in the Merchant Center feed.
 */
export function nameTranslatable(name: string): boolean {
  return !/[а-яё]/i.test(translateProductName(name, "ET")) && !/[а-яё]/i.test(translateProductName(name, "EN"));
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
  let s = String(name);
  for (const [ru, et, en] of NAME_HEADS) if (s.includes(ru)) s = s.split(ru).join(i === 0 ? et : en);
  return s.replace(/ — ([а-яё][а-яё \-]*)$/i, (m, tail: string) => {
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
