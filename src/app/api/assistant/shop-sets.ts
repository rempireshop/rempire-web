/**
 * The shop's sets in the CUSTOMER's chat (Dim, 07.11.2026).
 *
 * Until then the shop chat never saw a single set: asked «есть набор для
 * бороды?» it put two loose bottles together and called them «набор», while
 * the search box beside it listed seven real ones at a lower price. Dim's
 * rule, tried on the live chat before a line was written:
 *
 *   · a shopper who asks for a set or a gift is offered the shop's own sets;
 *   · an answer that offers products carries at least one set that fits them
 *     — the set holding most of them, else one from the same section — and
 *     none at all when nothing fits (no perfume set exists, so none is forced).
 *
 * The model is shown the sets that fit the question (setsForPrompt) and may
 * name them in `bundle_ids`; fittingSets() then keeps the rule whatever the
 * model chose — a prompt is only a request. Same list as the Sets page: the
 * active sets, none while «Наборы» is switched off, none that is sold out
 * (loadShopSets). Pure apart from loadShopSets().
 */
import { GIFT_ASK, questionCats } from "@/lib/catalogue-slice";

export { GIFT_ASK };

export type Lang3 = "RU" | "ET" | "EN";
export type ShopSet = {
  id: string;
  cat: string;
  title: { RU: string; ET: string; EN: string };
  /** the product ids inside, once each */
  items: string[];
  price: number;
  save: number;
};

/** «набор», «комплект», «kinkekomplekt», «kit», «set» — the shopper asks for a set. */
/* `\b` is an ASCII boundary — next to a Cyrillic letter it never matches —
   so the Russian whole words are fenced with look-arounds instead. */
export const SET_ASK = /набор|комплект|komplekt|\bkits?\b|\bsets?\b|bundle|(?<![а-яё])сет(?![а-яё])/i;
/** A gift for a woman: a set of beard care is not one. */
const WOMAN_ASK = /девушк|женщин|(?<![а-яё])жен[аеуы](?![а-яё])|(?<![а-яё])мам[аеуы]?(?![а-яё])|подруг|сестр|бабушк|naise|tüdruk|emale|\bema\b|sõbranna|\bwom[ae]n\b|\bgirl|\bwife\b|\bmother\b|\bmum\b|\bmom\b|\bher\b/i;
/** A set whose own name says it is a gift. */
const GIFT_TITLE = /подар|kink|gift/i;
/** A set whose name says it is for men («Подарок мужчине», «Gift for him»). */
const MEN_TITLE = /мужчин|mehe|\bmen\b|\bman\b|\bhim\b/i;
/* A set for a problem: thinning hair, dandruff, an oily or sensitive scalp,
   damaged hair. It is no gift unless the shopper names the problem: asked
   «что подарить жене до 60 €?», the live chat offered «Редеющие волосы»,
   and «kinkekomplektid?» got the dandruff set (07.11.2026). The same words
   in a question mean the shopper named it. */
const PROBLEM = /редеющ|редеют|выпад|лысе|перхот|жирн|чувствит|поврежд|hõren|kõõm|rasun|tundlik|kahjust|väljalang|thinning|hair loss|dandruff|oily|greasy|sensitive|damaged/i;
const STOP = new Set(["для", "что", "есть", "хочу", "нужен", "нужна", "нужно", "можно", "какой", "какие", "посоветуй", "посоветуйте", "подскажи", "after", "with", "something", "have", "what", "midagi", "mida", "jaoks", "kohta"]);

/** «до 50 €», «kuni 50», «under €50» → 50. */
export function budgetOf(text: string): number | null {
  const m = String(text || "").match(/(?:до|kuni|under|alla|below|up to)\s*[€$]?\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

/* The words of a question that may name a set, as stems: «бороды» → «бород»
   finds «Борода — стартовый набор», «татуировки» → «татуи» finds «Уход за
   татуировкой». The set words themselves never count — half the names say
   «набор» — and a glued Estonian «kinkekomplekt» keeps its «kinke». */
function nameStems(question: string): string[] {
  const out: string[] = [];
  for (let w of String(question || "").toLowerCase().split(/[^a-zа-яёõäöüšž0-9]+/i)) {
    const glued = w.match(/^([a-zõäöüšž]{3,})komplekt/);
    if (glued) w = glued[1];
    if (w.length < 4 || STOP.has(w) || SET_ASK.test(w)) continue;
    out.push(w.length > 5 ? w.slice(0, 5) : w);
  }
  return [...new Set(out)];
}

const norm = (s: string) => " " + String(s || "").toLowerCase().replace(/ё/g, "е") + " ";
function nameHits(set: ShopSet, stems: string[]): number {
  const hay = norm([set.title.RU, set.title.ET, set.title.EN].join(" "));
  return stems.filter((s) => hay.includes(s.replace(/ё/g, "е"))).length;
}

/** The section most of `ids` are in (≥ 60 % of them), else "". */
function mainCat(ids: string[], catOf: (id: string) => string | undefined): string {
  const n: Record<string, number> = {};
  for (const id of ids) {
    const c = catOf(id);
    if (c) n[c] = (n[c] || 0) + 1;
  }
  const top = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
  return top && ids.length && top[1] / ids.length >= 0.6 ? top[0] : "";
}

export type SetContext = {
  question: string;
  /** the products the answer offers (or, for the prompt, the slice it was built from) */
  productIds?: string[];
  /** each product's shop section — the catalogue's `c` */
  catOf?: (id: string) => string | undefined;
};

type Scored = { set: ShopSet; score: number; hold: number; extra: number };

const titles = (s: ShopSet) => s.title.RU + " " + s.title.ET + " " + s.title.EN;

/** Whether a set may be offered for this question at all — every path keeps
    it, the model's own picks included: within the budget; for a woman, no
    beard or men's set; for a gift, no set for a problem the shopper did not
    name. */
function allowedSet(s: ShopSet, q: string, catOf: (id: string) => string | undefined): boolean {
  const cap = budgetOf(q);
  if (cap !== null && s.price > cap) return false;
  if (WOMAN_ASK.test(q) && (s.cat === "beard" || mainCat(s.items, catOf) === "beard" || MEN_TITLE.test(titles(s)))) return false;
  if (GIFT_ASK.test(q) && PROBLEM.test(titles(s)) && !PROBLEM.test(q)) return false;
  return true;
}

/* How well one set fits: its name has the question's words (×3), it holds
   the offered products (×holdWeight each), it is a gift set and a gift was
   asked for (+3), it is in the section the question is about (+1). A set
   allowedSet() refuses does not fit at all. */
function scoreSets(sets: ShopSet[], ctx: SetContext, holdWeight: number): Scored[] {
  const q = ctx.question || "";
  const ids = ctx.productIds ?? [];
  const catOf = ctx.catOf ?? (() => undefined);
  const stems = nameStems(q);
  const cats = new Set(questionCats(q));
  const gift = GIFT_ASK.test(q);
  return sets
    .filter((s) => allowedSet(s, q, catOf))
    .map((set) => {
      const hold = set.items.filter((id) => ids.includes(id)).length;
      let score = nameHits(set, stems) * 3 + hold * holdWeight;
      if (gift && GIFT_TITLE.test(titles(set))) score += 3;
      if (cats.has(set.cat)) score += 1;
      return { set, score, hold, extra: set.items.length - hold };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.hold - a.hold || a.extra - b.extra || b.set.save - a.set.save);
}

/** The sets the model is shown for this question — at most `max`. A plain
    «наборы?» with nothing more to go on gets the shelf from the top. */
export function setsForPrompt(sets: ShopSet[], ctx: SetContext, max = 8): ShopSet[] {
  /* For a gift, the products of the slice say nothing about the person: the
     slice is the shop's gift shelf, and the sets that happened to hold one of
     its rows were offered as if they fit (07.11.2026). */
  const q = ctx.question || "";
  const ranked = scoreSets(sets, ctx, GIFT_ASK.test(q) ? 0 : 1).map((x) => x.set);
  if (!ranked.length && SET_ASK.test(q)) return sets.filter((s) => allowedSet(s, q, ctx.catOf ?? (() => undefined))).slice(0, max);
  return ranked.slice(0, max);
}

/** One line per set for the prompt: id|title in the shopper's language|section|price|the products inside. */
export function setLines(sets: ShopSet[], lang: Lang3): string {
  return sets.map((s) => `${s.id}|${s.title[lang] || s.title.RU}|${s.cat}|${s.price}€|${s.items.join(" + ")}`).join("\n");
}

/**
 * The sets the answer carries, Dim's rule kept here whatever the model chose:
 *   · asked for a set — up to 3 that fit (the model's first);
 *   · asked for a gift — up to 2: gift sets and sets holding the products;
 *   · products offered — the model's pick, else the one set holding most of
 *     them, else one from their own section; nothing when nothing fits.
 * Only ids from `sets` — the shop's own list — ever come back.
 */
export function fittingSets(sets: ShopSet[], ctx: SetContext & { modelIds?: unknown }): string[] {
  const q = ctx.question || "";
  const catOf = ctx.catOf ?? (() => undefined);
  // the model's picks pass the same rule as the rest: a prompt is only a request
  const known = new Set(sets.filter((s) => allowedSet(s, q, catOf)).map((s) => s.id));
  const chosen = (Array.isArray(ctx.modelIds) ? ctx.modelIds : [])
    .filter((id): id is string => typeof id === "string" && known.has(id));
  const ids = ctx.productIds ?? [];
  const want = SET_ASK.test(q) ? 3 : GIFT_ASK.test(q) ? 2 : ids.length ? 1 : 0;
  const out = [...new Set(chosen)].slice(0, Math.max(want, 2));
  if (out.length >= want) return out;
  const ranked = scoreSets(sets, ctx, 2);
  for (const x of ranked) {
    if (out.length >= want) break;
    if (out.includes(x.set.id)) continue;
    // a product answer takes a set that holds one of its products, or one from their section
    if (!SET_ASK.test(q) && !GIFT_ASK.test(q) && x.hold === 0) continue;
    out.push(x.set.id);
  }
  if (out.length < want && ids.length && !SET_ASK.test(q)) {
    const cat = mainCat(ids, catOf);
    const same = sets
      .filter((s) => cat && s.cat === cat && !out.includes(s.id) && allowedSet(s, q, catOf))
      .sort((a, b) => b.save - a.save);
    if (same[0]) out.push(same[0].id);
  }
  return out.slice(0, Math.max(want, 2));
}

/* ---- read -------------------------------------------------------------- */

let cache: { at: number; sets: ShopSet[] } | null = null;
const CACHE_MS = 60_000;

/** The sets a shopper can buy right now, as the Sets page shows them — a
    minute's cache like the live rows beside it, and [] on any trouble: the
    shop chat answers without a database too. */
export async function loadShopSets(): Promise<ShopSet[]> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.sets;
  let sets: ShopSet[] = [];
  try {
    const { getSettingRaw } = await import("@/lib/orders");
    const sw = await getSettingRaw("bundles");
    if (!(sw.found && sw.value === false)) {
      const { listBundles } = await import("@/lib/bundles");
      sets = (await listBundles({ activeOnly: true }))
        .filter((b) => b.stock !== "out")
        .map((b) => ({
          id: b.id,
          cat: b.cat,
          title: { RU: b.title.RU, ET: b.title.ET || b.title.RU, EN: b.title.EN || b.title.RU },
          items: [...new Set(b.items.map((i) => i.productId))],
          price: b.price,
          save: b.save,
        }));
    }
  } catch {
    sets = [];
  }
  cache = { at: now, sets };
  return sets;
}

/** Tests only: forget the cached list. */
export function resetShopSetsCache(): void {
  cache = null;
}
