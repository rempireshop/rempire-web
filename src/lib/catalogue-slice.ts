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
  const scored = CAT.map((p) => {
    let s = 0;
    if (cats.has(p.c)) s += 2;
    const hay = (p.b + " " + p.n + " " + p.id).toLowerCase();
    for (const t of toks) if (hay.includes(t)) s += 3;
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

/** The slice as prompt lines — what the shop chat inlines. */
export function relevantLines(text: string): string {
  return relevantProducts(text).map(rowLine).join("\n");
}

/** Every id the catalogue file knows. */
export function catalogueIds(): Set<string> {
  return new Set(CAT.map((p) => p.id));
}

/** One row by id, or null for an id the file does not know (the owner's own products live in the database). */
export function catalogueRow(id: string): CatRow | null {
  return CAT.find((p) => p.id === id) ?? null;
}
