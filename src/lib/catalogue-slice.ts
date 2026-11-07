/**
 * A slice of the catalogue that fits one question or one topic.
 *
 * The full catalogue is ~9k tokens of noise for a single question — the mini
 * model follows instructions far better on a short, relevant slice. Cheap
 * keyword scoring against the text; a generous fallback keeps variety.
 *
 * Grown out of src/app/api/assistant/route.ts (the shop chat's CATALOGUE
 * block) so the article generator (POST /api/admin/ai/text, task post_full)
 * can offer the model the same few products that fit the topic — it may
 * only mention what is listed, so the list has to be the right one.
 *
 * Pure: the catalogue file and nothing else. The owner's own products
 * (custom_products) live in the database and are read by the callers that
 * need them.
 */
import catalogue from "@/data/catalogue.min.json";

export type CatRow = { id: string; b: string; n: string; c: string; p: number; s: string };
const CAT = catalogue as CatRow[];

export function rowLine(p: CatRow): string {
  return `${p.id}|${p.b}|${p.n}|${p.c}|${p.p}€|${p.s}`;
}
export function catalogueLines(): string {
  return CAT.map(rowLine).join("\n");
}

const CAT_KW: Array<[RegExp, string]> = [
  [/бород|habe|beard|усы|moustache|брить|raseer|shav/i, "beard"],
  [/волос|шампун|кондиционер|маск|juuks|šampoon|palsam|hair|shampoo|conditioner|scalp|перхот/i, "hair"],
  [/стайлинг|уклад|паст|воск|гел|пудр|лак|viimistl|soeng|styling|wax|paste|clay|pomade|gel/i, "styling"],
  [/лиц|кож[аеиу]|тоник|крем|сыворот|nägu|näo|nahk|face|skin|toner|serum|patch/i, "face"],
  [/тел|мыл|keha|seep|body|soap|лосьон/i, "body"],
  [/парфюм|аромат|духи|parfüüm|lõhn|perfume|fragrance|cologne|edp|edt/i, "perfume"],
  [/футболк|мерч|särk|merch|shirt|tee|декор|decor/i, "merch"],
];

/* What a shopper's word means in a product's name. The names carry the
   brand's own English words («Tattoo Balm», «Killer.Curls», «HYDRATE-ME») and
   a Russian type tail («— бальзам»), so a question asked in Russian or
   Estonian about the topic matches neither: «уход после татуировки» scored
   every Yumain product 1 and the chat told the shopper the shop had nothing
   for tattoos while four were in stock (07.11.2026). Each entry: the words a
   question may use → the words the names use. Every target word is in at
   least one name in the catalogue file (checked 07.11.2026). Keep in step
   with TOPIC_KW in public/shop2/chat.js. */
export const TOPIC_KW: Array<[RegExp, string[]]> = [
  [/тату|татуир|tätov|tattoo/i, ["tattoo"]],
  [/обезбол|онемен|numb|pain relief/i, ["numb"]],
  [/солнц|загар|päike|sunscreen|\bsun\b|\bspf\b/i, ["sun"]],
  [/кудр|локон|вьющ|lokk|curl/i, ["curl"]],
  [/блонд|осветл|blond/i, ["blond"]],
  [/объ[её]м|тонк(ие|их) волос|kohev|maht|volume|fine hair|thin hair/i, ["plump", "thick"]],
  [/восстан|поврежд|taast|kahjust|repair|damage/i, ["repair"]],
  [/окраш|цвет|värvi|colou?r/i, ["colour", "color"]],
  [/пушат|пушист|гладк|выпрям|sile|frizz|smooth|straight/i, ["smooth"]],
  [/морщин|возраст|korts|wrinkle|anti-?age/i, ["wrinkle"]],
  [/увлажн|сух|niisut|kuiv|hydrat|moistur|\bdry\b/i, ["hydrat", "moist"]],
  [/глаз|под глаз|silm|\beyes?\b/i, ["eye"]],
  [/чувствит|раздраж|tundlik|sensitive/i, ["sensitive"]],
];
/** The shop sections a question is about (CAT_KW), in table order. */
export function questionCats(text: string): string[] {
  const q = String(text || "").toLowerCase();
  return CAT_KW.filter(([re]) => re.test(q)).map(([, c]) => c);
}
/** The name words a question's topic stands for (TOPIC_KW), once each. */
export function topicWords(text: string): string[] {
  const q = String(text || "");
  return [...new Set(TOPIC_KW.filter(([re]) => re.test(q)).flatMap(([, w]) => w))];
}

/**
 * The rows that fit `text`, best first. `limit` caps the strong matches;
 * `fill` is how many rows come back at least, padded with the next-best
 * ones so a thin question still sees a few products.
 */
export function relevantProducts(text: string, opts: { limit?: number; fill?: number } = {}): CatRow[] {
  const limit = opts.limit ?? 60;
  const fill = opts.fill ?? 24;
  const q = String(text || "").toLowerCase();
  const cats = new Set(CAT_KW.filter(([re]) => re.test(q)).map(([, c]) => c));
  const toks = q.split(/[^a-zа-яёõäöüšž0-9.]+/i).filter((w) => w.length > 2);
  /* the topic's own name words (TOPIC_KW) count a little more than a word the
     shopper typed: «после» in «уход после татуировки» is in every «лосьон после
     бритья», «tattoo» is only in what the question is about */
  const topic = topicWords(q).filter((w) => !toks.includes(w));
  const scored = CAT.map((p) => {
    let s = 0;
    if (cats.has(p.c)) s += 2;
    const hay = (p.b + " " + p.n + " " + p.id).toLowerCase();
    for (const t of toks) if (hay.includes(t)) s += 3;
    for (const t of topic) if (hay.includes(t)) s += 4;
    if (p.s !== "out") s += 1;
    return [s, p] as const;
  }).sort((a, b) => b[0] - a[0]);
  const top = scored.filter(([s]) => s > 1).slice(0, limit).map(([, p]) => p);
  if (top.length < 12) {
    for (const [, p] of scored) {
      if (top.length >= fill) break;
      if (!top.includes(p)) top.push(p);
    }
  }
  return top;
}

/* The products a text names, in the order it names them — the list an
   article edit may link (post_edit, src/app/api/admin/ai/text/route.ts).
   relevantProducts() scores a topic and an article about one brand ties
   every product of that brand; this looks for each product's own name — the
   part before « — » — with dots, hyphens and case not counting, so
   «Angel.Wash», «ANGEL.WASH» and «Angel Wash» are the same product, and a
   comma or a bracket after a name does not hide it. Where two names overlap
   («Blonde.Angel.Wash» contains «Angel.Wash») the longer one owns those
   words, and the shorter counts only where it stands alone. */
const mentionKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}&]+/gu, " ").trim();

export function mentionedProducts(text: string, max = 40): CatRow[] {
  const hay = " " + mentionKey(String(text || "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&")) + " ";
  const rows = CAT.map((p) => ({ p, key: mentionKey(p.n.split(" — ")[0]) }))
    .filter((r) => r.key.length >= 4)
    .sort((a, b) => b.key.length - a.key.length);
  const taken: Array<[number, number]> = [];
  const found: Array<[number, CatRow]> = [];
  for (const { p, key } of rows) {
    const needle = " " + key + " ";
    let first = -1;
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) {
      // the words themselves, not the spaces around them: two names side by side share a space
      const start = at + 1, end = at + needle.length - 1;
      if (taken.some(([s, e]) => start < e && end > s)) continue;
      taken.push([start, end]);
      if (first < 0) first = start;
    }
    if (first >= 0) found.push([first, p]);
  }
  return found.sort((a, b) => a[0] - b[0]).slice(0, max).map(([, p]) => p);
}

/** The slice as prompt lines — what the shop chat inlines. */
export function relevantLines(text: string): string {
  return relevantProducts(text).map(rowLine).join("\n");
}

/** Every brand the catalogue file knows, once each. */
export function catalogueBrands(): string[] {
  return [...new Set(CAT.map((p) => p.b))];
}

/** Every id the catalogue file knows. */
export function catalogueIds(): Set<string> {
  return new Set(CAT.map((p) => p.id));
}

/** One row by id, or null for an id the file does not know (the owner's own products live in the database). */
export function catalogueRow(id: string): CatRow | null {
  return CAT.find((p) => p.id === id) ?? null;
}
