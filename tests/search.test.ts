/**
 * The storefront's search — the half that needs no model.
 *
 * The functions are **sliced out of public/shop2/app.js by source text** and
 * run for real (tools/search-bench.mjs does the cutting, the same idiom as
 * tests/checkout-parity.test.ts): retyping them here would test this file
 * instead of the shop, and the slice throws loudly if app.js drops or renames
 * one of them. The catalogue and all three description files are the real
 * ones, so what these tests assert is what a shopper actually gets.
 *
 * The load-bearing assertion is the last one: over 629 real phrases — the
 * Google Search Console export of 07.09.2026 and the concern phrases in three
 * languages — the new search NEVER returns fewer products than the six lines
 * it replaced. Everything else is an improvement; that one is a promise.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { buildSearch } from "../tools/search-bench.mjs";

type Row = { id: string; brand: string; name: string; cat: string };
type Ctx = {
  CATALOGUE: Row[];
  legacySearch: (q: string) => Row[];
  searchAll: (q: string, aiTerms?: string[]) => Row[];
  searchNames: (q: string) => Row[];
  srchNorm: (s: string) => string;
  srchStem: (w: string) => string;
  srchGroups: (q: string) => string[][];
  srchConcerns: (q: string) => unknown[];
  srchBlob: (p: Row) => string;
};
const S = buildSearch() as Ctx;

const QUERIES = JSON.parse(
  readFileSync(fileURLToPath(new URL("../tools/search-queries.json", import.meta.url)), "utf8"),
) as { concerns: string[]; gsc: string[] };

const ids = (rows: Row[]) => rows.map((p) => p.id);
const names = (rows: Row[]) => rows.map((p) => `${p.brand} ${p.name}`).join(" · ");

describe("normalising a query", () => {
  it("folds case, ё and the Estonian diacritics into one spelling", () => {
    expect(S.srchNorm("Жирные ВОЛОСЫ")).toBe(" жирные волосы ");
    expect(S.srchNorm("ёжик")).toBe(S.srchNorm("ежик"));
    expect(S.srchNorm("kõõm")).toBe(" koom ");
    expect(S.srchNorm("Rasvased Juuksed")).toBe(" rasvased juuksed ");
    expect(S.srchNorm("šampoon nägu õli")).toBe(" sampoon nagu oli ");
  });

  it("parts a number from a letter, both ways — «100ml» and «4system» are real queries", () => {
    expect(S.srchNorm("Creed Aventus 50ml")).toBe(" creed aventus 50 ml ");
    expect(S.srchNorm("4system")).toBe(" 4 system ");
    expect(S.srchNorm("Kevin.Murphy")).toBe(" kevin murphy ");
  });

  it("leaves nothing but letters, digits and single spaces", () => {
    expect(S.srchNorm("  «шампунь»,  2 шт.!  ")).toBe(" шампунь 2 шт ");
    expect(S.srchNorm("")).toBe("  ");
    expect(S.srchNorm(null as unknown as string)).toBe("  ");
  });
});

describe("stemming, three alphabets", () => {
  it("brings the Russian forms of one word together", () => {
    for (const w of ["жирный", "жирная", "жирные", "жирным", "жирности"]) {
      expect(S.srchStem(w), w).toMatch(/^жирн/);
    }
    expect(S.srchStem("волосы")).toBe("волос");
    expect(S.srchStem("перхоть")).toBe("перхот");
    expect(S.srchStem("гель")).toBe("гел");   // and «гел» still starts «гель»
    expect(S.srchStem("уход")).toBe("уход");  // three letters is the floor
  });

  it("brings the Estonian cases together, in the folded spelling", () => {
    // «rasvased» → «rasva», «rasvastele» → «rasvas»: each is a prefix of the
    // other's written form, which is all a prefix match needs
    expect("rasvased".startsWith(S.srchStem("rasvased"))).toBe(true);
    expect("rasvased".startsWith(S.srchStem("rasvastele"))).toBe(true);
    expect("juuksed".startsWith(S.srchStem("juuksed"))).toBe(true);
  });

  it("leaves a Latin word long enough to stay itself — «creed» is not «cre»", () => {
    expect(S.srchStem("creed")).toBe("creed");
    expect(S.srchStem("care")).toBe("care");
    expect(S.srchStem("cure")).toBe("cure");
    expect(S.srchStem("gel")).toBe("gel");
    expect(S.srchStem("davines")).toBe("davin");
    expect(S.srchStem("aventus")).toBe("aventu");
  });
});

describe("bridges — the same thing spelled three ways", () => {
  const alts = (q: string) => S.srchGroups(q).flat();

  it("carries a Russian product word to the English text", () => {
    expect(alts("шампунь")).toContain("shampoo");
    expect(alts("сыворотка")).toContain("serum");
    expect(alts("масло для бороды")).toEqual(expect.arrayContaining(["oil", "beard"]));
  });

  it("carries an Estonian one too", () => {
    expect(alts("juuksed")).toContain("hair");
    expect(alts("kõõm")).toContain("dandruff");
    expect(alts("rasvased juuksed")).toEqual(expect.arrayContaining(["oily", "hair"]));
  });

  it("spells a brand the way the catalogue does — «система 4» is «System 4»", () => {
    expect(alts("система 4")).toContain("system");
    expect(alts("наксос")).toContain("naxos");
    expect(alts("крид авентус")).toEqual(expect.arrayContaining(["creed", "aventus"]));
  });

  it("drops the words that say nothing about which product is wanted", () => {
    expect(S.srchGroups("шампунь купить цена")).toHaveLength(1);
    expect(S.srchGroups("официальный сайт system 4")).toEqual([["system"], ["4"]]);
    expect(S.srchGroups("how to use kevin murphy")).toEqual([["use"], ["kevin"], ["murphy"]]);
    // …unless small talk is all there is, in which case it is the query
    expect(S.srchGroups("купить").length).toBe(1);
  });
});

describe("what the shopper means", () => {
  it("«rasvased juuksed» finds the shampoos for oily hair, in every language", () => {
    const et = S.searchAll("rasvased juuksed");
    const ru = S.searchAll("жирные волосы");
    const en = S.searchAll("oily hair");
    expect(S.legacySearch("rasvased juuksed")).toHaveLength(0); // the shop before
    for (const [lang, res] of [["ET", et], ["RU", ru], ["EN", en]] as const) {
      expect(res.length, lang).toBeGreaterThan(5);
      expect(res.every((p) => p.cat === "hair" || p.cat === "styling"), `${lang}: ${names(res)}`).toBe(true);
    }
    // the three languages are asking the same question, so they answer alike
    const shared = ids(et).filter((id) => ids(ru).includes(id) && ids(en).includes(id));
    expect(shared.length).toBeGreaterThan(5);
  });

  it("answers the concerns Dim named, and stays on the right shelf", () => {
    const cases: Array<[string, RegExp, string[]]> = [
      ["перхоть", /System 4/, ["hair"]],
      ["kõõm", /System 4/, ["hair"]],
      ["dandruff", /System 4/, ["hair"]],
      ["выпадение волос", /Kevin\.Murphy|Davines|Paul Mitchell/, ["hair", "styling"]],
      ["сухая кожа головы", /System 4|Kevin\.Murphy/, ["hair"]],
      ["секущиеся кончики", /Repair|Keratin|HYDRATE/i, ["hair", "styling"]],
      ["объём волосам", /PLUMPING|BODY\.MASS|Extra-Body|Powder/i, ["hair", "styling"]],
      ["морщины", /Lumin|Anua|Cosrx|LANEIGE/i, ["face"]],
      ["раздражение после бритья", /Proraso|Pasta&Love|Captain Fawcett|Davines/i, ["beard", "face"]],
    ];
    for (const [q, expected, cats] of cases) {
      const res = S.searchAll(q);
      expect(res.length, q).toBeGreaterThan(0);
      expect(names(res.slice(0, 8)), q).toMatch(expected);
      expect(res.every((p) => cats.includes(p.cat)), `${q}: ${names(res)}`).toBe(true);
    }
  });

  it("finds a word that lives only in the description — no product is named «хитозан»", () => {
    for (const q of ["хитозан", "salicylic", "ментол", "ceramide", "пантенол"]) {
      expect(S.searchNames(q), q).toHaveLength(0);      // not in any name or brand
      expect(S.searchAll(q).length, q).toBeGreaterThan(0);
    }
  });

  it("reads a brand written in the other alphabet", () => {
    expect(S.legacySearch("система 4")).toHaveLength(0);
    const res = S.searchAll("система 4");
    expect(res.length).toBeGreaterThan(5);
    // the brand itself comes first; a stray «system» in somebody else's text
    // is allowed to trail behind it, never to lead
    expect(res.slice(0, 10).every((p) => p.brand === "System 4"), names(res)).toBe(true);
  });

  it("survives a pasted product title with a word the shop does not use", () => {
    const res = S.searchAll("system 4 nr. 2 climbazole shampoo 500 ml");
    expect(res.length).toBeGreaterThan(0);
    expect(names(res.slice(0, 3))).toMatch(/System 4/);
  });

  it("does not read a brand as a concern — «Mitchell» is not an itch (Renat, 03.11.2026)", () => {
    expect(S.srchConcerns("paul mitchell tea tree")).toHaveLength(0);
    expect(S.srchConcerns("paul mitchell green tea")).toHaveLength(0);
    // the concern itself still answers, in English and in Estonian
    expect(S.srchConcerns("itchy scalp").length).toBeGreaterThan(0);
    expect(S.srchConcerns("sügelev peanahk").length).toBeGreaterThan(0);
    // 52 products before, after-shave and face wash among them
    for (const q of ["paul mitchell tea tree", "paul mitchell green tea"]) {
      const res = S.searchAll(q);
      expect(res.length, q).toBeGreaterThan(0);
      expect(res.every((p) => p.brand === "Paul Mitchell"), `${q}: ${names(res)}`).toBe(true);
    }
  });
});

describe("the product type typed in English or Estonian", () => {
  const km = (rows: Row[]) => rows.filter((p) => /murphy/i.test(p.brand));

  it("«shampoo» finds the shampoos named only in Russian — Renat, 01.11.2026", () => {
    // 27 names say «Shampoo», which used to count as a full page; the
    // Kevin.Murphy washes say only «— шампунь» and were never on it
    const before = S.legacySearch("shampoo");
    const after = S.searchAll("shampoo");
    expect(km(before)).toHaveLength(0);
    expect(names(km(after))).toMatch(/ANGEL\.WASH — шампунь/);
    expect(km(after).length).toBeGreaterThanOrEqual(10);
    expect(after.every((p) => /шампун|shampoo/i.test(p.name)), names(after)).toBe(true);
    expect(ids(after).slice(0, before.length)).toEqual(ids(before));
  });

  it("works for the other tails and for Estonian", () => {
    expect(names(km(S.searchAll("conditioner")))).toMatch(/ANGEL\.RINSE — кондиционер/);
    expect(names(km(S.searchAll("šampoon")))).toMatch(/ANGEL\.WASH — шампунь/);
    expect(names(S.searchAll("beard oil"))).toMatch(/масло для бороды/);
    expect(names(S.searchAll("styling"))).toMatch(/Night\.Rider — паста для укладки/);
    expect(names(S.searchAll("curl"))).toMatch(/Motion\.Lotion — лосьон для локонов/);
  });

  it("splits an Estonian compound — «näoseerum» is face + serum, and asks for both", () => {
    const top = (q: string, n: number) => S.searchAll(q).slice(0, n);
    expect(top("näoseerum", 2).every((p) => /сыворотка для лица/.test(p.name)), names(top("näoseerum", 2))).toBe(true);
    expect(top("habemeõli", 5).every((p) => /масло для бороды/.test(p.name)), names(top("habemeõli", 5))).toBe(true);
    expect(top("viimistluspasta", 4).every((p) => /паста для укладки/.test(p.name)), names(top("viimistluspasta", 4))).toBe(true);
    expect(names(S.searchAll("kangasmask"))).toMatch(/тканевая маска/);
    expect(names(S.searchAll("kuumakaitsevaht"))).toMatch(/HEATED\.DEFENSE — термозащитная пенка/);
    expect(names(S.searchAll("plaastrid"))).toMatch(/— патчи/);
  });

  it("asks every word to be in the name — «kevin murphy shampoo» puts the washes first", () => {
    const top = S.searchAll("kevin murphy shampoo").slice(0, 10);
    expect(top.every((p) => /murphy/i.test(p.brand) && /шампун/.test(p.name)), names(top)).toBe(true);
  });

  it("does not read a concern as a product type — «oily hair» is not a request for oils", () => {
    const top = S.searchAll("oily hair").slice(0, 6);
    expect(top.some((p) => /— масло/.test(p.name)), names(top)).toBe(false);
  });
});

describe("the queries that already worked are left alone", () => {
  it("a brand or a product word is answered by pass 1, exactly as before", () => {
    for (const q of ["davines", "шампунь", "kevin murphy", "парфюм", "борода", "футболка"]) {
      const before = S.legacySearch(q);
      expect(before.length, q).toBeGreaterThanOrEqual(6);
      expect(ids(S.searchAll(q)), q).toEqual(ids(before));
    }
  });

  it("a thin answer keeps its own results first, in the catalogue's order", () => {
    const before = S.legacySearch("kevin murphy night rider");
    const after = S.searchAll("kevin murphy night rider");
    expect(before.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(before.length);
    expect(ids(after).slice(0, before.length)).toEqual(ids(before));
  });

  it("an empty query is still nothing at all", () => {
    expect(S.searchAll("")).toHaveLength(0);
    expect(S.searchAll("   ")).toHaveLength(0);
  });

  it("never returns fewer products than the search it replaced — 629 real phrases", () => {
    const all = [...QUERIES.concerns, ...QUERIES.gsc];
    expect(all.length).toBeGreaterThan(600);
    const lost = all.filter((q) => S.searchAll(q).length < S.legacySearch(q).length);
    expect(lost).toEqual([]);
  });

  it("and finds something far more often — the numbers in docs/audit/2026-09-07-search.md", () => {
    const hits = (list: string[], f: (q: string) => Row[]) => list.filter((q) => f(q).length > 0).length;
    // the concern phrases: 2 of 75 before
    expect(hits(QUERIES.concerns, S.legacySearch)).toBeLessThan(5);
    expect(hits(QUERIES.concerns, S.searchAll)).toBeGreaterThanOrEqual(70);
    // Search Console's 554: 291 before, 500 after
    expect(hits(QUERIES.gsc, S.legacySearch)).toBeLessThan(300);
    expect(hits(QUERIES.gsc, S.searchAll)).toBeGreaterThanOrEqual(480);
  });
});

describe("the shelf stays a shelf", () => {
  it("caps a concern that is honestly true of half the catalogue", () => {
    const res = S.searchAll("сухие волосы");
    expect(res.length).toBeLessThanOrEqual(48);
    expect(res.length).toBeGreaterThan(10);
  });

  it("does not answer a question this shop has nothing for", () => {
    for (const q of ["laptop", "стиральный порошок", "автомобильные шины"]) {
      expect(S.searchAll(q), q).toHaveLength(0);
    }
  });
});

describe("the model's terms, when there are any", () => {
  it("widen a query the shop's own words could not reach", () => {
    // French for oily hair: no bridge, no concern, no word in any description
    expect(S.searchAll("cheveux gras")).toHaveLength(0);
    const rescued = S.searchAll("cheveux gras", ["жирные волосы", "oily", "себорегулирующий"]);
    expect(rescued.length).toBeGreaterThan(3);
    const top = rescued.slice(0, 6);
    expect(top.every((p) => p.cat === "hair" || p.cat === "styling"), names(top)).toBe(true);
    expect(names(top)).toMatch(/System 4|Davines|Paul Mitchell|Kevin\.Murphy/);
  });

  it("need two of them, or one in the product's own name", () => {
    // one loose word that is nowhere in a name must not drag the shelf in…
    expect(S.searchAll("cheveux gras", ["oily"]).length).toBe(0);
    expect(S.searchAll("cheveux gras", ["sebum"]).length).toBe(0);
    // …two of them, or one the shop actually calls a product, may
    expect(S.searchAll("cheveux gras", ["oily", "sebum"]).length).toBeGreaterThan(0);
    expect(S.searchAll("cheveux gras", ["davines"]).length).toBeGreaterThan(0);
    expect(S.searchAll("cheveux gras", ["shampooing"]).length).toBeGreaterThan(0);
  });

  it("change nothing when the model said nothing", () => {
    expect(ids(S.searchAll("davines", []))).toEqual(ids(S.searchAll("davines")));
    expect(ids(S.searchAll("перхоть", []))).toEqual(ids(S.searchAll("перхоть")));
  });
});

/* ---------- with the search cards ---------------------------------------------

   What the shop does once its first search has fetched /shop/search-terms.json
   (tools/pack-search-cards.mjs, docs/plan-2026-11-01-search-cards.md): every
   product's type words, and the model's answers to the phrases people type.
   Measured on the snapshot in tests/fixtures (npm run cards:snapshot). */
describe("with the search cards", () => {
  const base = S as unknown as Record<string, unknown>;
  const C = buildSearch(
    vm.createContext({
      CATALOGUE: base.CATALOGUE, CAT_NAMES: base.CAT_NAMES,
      CONTENT: base.CONTENT, CONTENT_RU: base.CONTENT_RU, CONTENT_ET: base.CONTENT_ET,
    }),
    { cards: true },
  ) as Ctx;
  const INTENTS = JSON.parse(
    readFileSync(fileURLToPath(new URL("../tools/search-intents.json", import.meta.url)), "utf8"),
  ) as { intents: Array<{ q: string; top: number; min: number; match: string }> };
  const passes = (it: { q: string; top: number; min: number; match: string }) => {
    const re = new RegExp(it.match, "i");
    return C.searchAll(it.q).slice(0, it.top).filter((p) => re.test(`${p.brand} — ${p.name}`)).length >= it.min;
  };

  it("still never returns fewer products than the search it replaced — 629 real phrases", () => {
    const all = [...QUERIES.concerns, ...QUERIES.gsc];
    expect(all.filter((q) => C.searchAll(q).length < S.legacySearch(q).length)).toEqual([]);
  });

  it("keeps a phrase that names a full page of products first, exactly as before", () => {
    for (const q of ["davines", "шампунь", "kevin murphy", "парфюм"]) {
      const before = S.legacySearch(q);
      expect(ids(C.searchAll(q)).slice(0, before.length), q).toEqual(ids(before));
    }
  });

  it("«shampoo» has every Kevin.Murphy wash — Renat, 01.11.2026", () => {
    const km = C.searchAll("shampoo").filter((p) => /murphy/i.test(p.brand) && /шампунь/.test(p.name));
    expect(km.length).toBeGreaterThanOrEqual(13);
  });

  it("answers what the shopper means — the intents today's words could not", () => {
    for (const q of ["перхоть", "dandruff", "kõõm", "oily hair", "rasvased juuksed", "matte hold", "матовая фиксация",
      "volume for fine hair", "näoseerum", "habemeõli", "curly hair", "lokkis juuksed", "после бритья", "aftershave"]) {
      const it = INTENTS.intents.find((x) => x.q === q)!;
      expect(passes(it), `${q}: ${names(C.searchAll(q).slice(0, it.top))}`).toBe(true);
    }
  });

  it("does at least as well as the words alone on every intent, in total", () => {
    const words = INTENTS.intents.filter((it) => {
      const re = new RegExp(it.match, "i");
      return S.searchAll(it.q).slice(0, it.top).filter((p) => re.test(`${p.brand} — ${p.name}`)).length >= it.min;
    }).length;
    expect(INTENTS.intents.filter(passes).length).toBeGreaterThan(words);
  });

  it("«after shampoo» leads with what goes on after it, not with shampoos", () => {
    for (const q of ["after shampoo", "после шампуня"]) {
      const top = C.searchAll(q).slice(0, 6);
      expect(top.filter((p) => /шампунь/.test(p.name)), `${q}: ${names(top)}`).toEqual([]);
    }
  });
});
