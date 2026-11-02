/**
 * The panel's product search, in every language the panel is drawn in.
 *
 * Owner report, 02.11.2026: Renat runs the panel in English or Estonian, where
 * a row reads «ANGEL.WASH — shampoo» or «… — šampoon» (trName), but every
 * product box searched the brand, the RAW Russian name, the id and the sizes
 * only. «Shampoo» found 27 of the 40 shampoos, «Conditioner» 13 of 27, and
 * «шампуни», «shampoos», «šampoon» or «palsam» nothing at all. Eight boxes,
 * eight copies of that rule — three of them a plain substring.
 *
 * Now all eight ask one search (admProdMatch, public/shop2/app.js): the name
 * as each of the three panels draws it, the product's own subsection, the
 * accents off, every typed word one ending shorter (srchStem), a number still
 * a whole size. Here it runs, cut out of app.js by source text, over the real
 * catalogue file (public/shop/catalogue2.js) — the subsections are the file's
 * own `sub`, so «every shampoo» means every product under «Шампуни».
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ADM_SEARCH_FNS, appFn, appLineVar } from "./adm-search-lift";

const APP = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const LINES = APP.split("\n");
/** A many-line `var <name> = { … };` / `[ … ];` at the file's own indent. */
function appBlockVar(name: string): string {
  const start = LINES.findIndex((l) => l === `  var ${name} = {` || l === `  var ${name} = [`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer declares ${name}`);
  const end = LINES.findIndex((l, i) => i > start && /^ {2}[}\]];$/.test(l));
  return LINES.slice(start, end + 1).join("\n");
}

type Product = { id: string; brand: string; name: string; cat: string; sub?: string; sizes?: string[]; custom?: boolean; subcatBase?: string };
const CAT_SRC = readFileSync(fileURLToPath(new URL("../public/shop/catalogue2.js", import.meta.url)), "utf8");
const FILE = (new Function(`${CAT_SRC}\nreturn CATALOGUE;`)() as Product[]);

const UI_ALL = new Function(`${appBlockVar("UI")}\nreturn UI;`)() as Record<string, Record<string, string>>;

type Panel = {
  words: (q: string) => string[];
  match: (p: Product, words: string[], more?: string, onSize?: string[]) => boolean;
  row: (r: Record<string, unknown>, words: string[], ix: Record<string, Product>) => boolean;
  index: () => Record<string, Product>;
  heroFind: (q: string, keep?: (p: Product) => boolean) => Product[] & { total: number };
  more: (shown: number, total: number) => string;
  find: (q: string) => string[];
};

/** The panel's search as it runs: `dicts` are the ET/EN dictionaries loaded
    (the panel's own language always is; a search fetches none). */
function panel(dicts: string[], catalogue: Product[] = FILE): Panel {
  const UI: Record<string, Record<string, string>> = {};
  for (const l of dicts) UI[l] = UI_ALL[l];
  const body = `
    var DEMO = { subcat: {} };
    function spread(n) { return CATALOGUE.slice(0, n); }
    ${appFn("scanFold")}
    ${appFn("scanWordHas")}
    ${appLineVar("SRCH_SUFFIX_RU")}
    ${appLineVar("SRCH_SUFFIX_LAT")}
    ${appFn("srchStem")}
    ${appBlockVar("NAME_TAILS")}
    ${appBlockVar("NAME_FRAGS")}
    ${appBlockVar("TAIL_EXACT")}
    ${appFn("trName")}
    ${appBlockVar("UI_RX")}
    ${appFn("trText")}
    ${appLineVar("UI_FILES")}
    ${appFn("uiHas")}
    ${appBlockVar("SUBCATS")}
    ${appFn("subcatsAuto")}
    ${appFn("subcatsWith")}
    ${appFn("subcatOf")}
    ${appFn("subcatNow")}
    var ADM_HAY = {};
    ${ADM_SEARCH_FNS.map(appFn).join("\n")}
    ${appFn("heroFind")}
    return {
      words: admQueryWords, match: admProdMatch, row: admStockRowMatch, index: admProdIndex, heroFind: heroFind, more: admPickMoreHTML,
      find: function (q) { var w = admQueryWords(q); return CATALOGUE.filter(function (p) { return admProdMatch(p, w); }).map(function (p) { return p.id; }); }
    };
  `;
  return new Function("CATALOGUE", "FILE_PRODUCTS", "UI", body)(catalogue, catalogue, UI) as Panel;
}

const RU = panel([]);              // the Russian panel: no ET/EN dictionary at all
const EN = panel(["EN"]);          // the English panel
const BOTH = panel(["ET", "EN"]);  // after the blog tab fetched both
const under = (sub: string) => FILE.filter((p) => p.sub === sub).map((p) => p.id);
const SHAMPOOS = under("hair/sh");
const CONDITIONERS = under("hair/co");

describe("every shampoo, whatever the panel's language and however it is typed", () => {
  it("the catalogue file has the two subsections to measure against", () => {
    expect(SHAMPOOS.length).toBeGreaterThanOrEqual(30);
    expect(CONDITIONERS.length).toBeGreaterThanOrEqual(20);
  });

  for (const q of ["Shampoo", "Shampoos", "šampoon", "sampoon", "шампунь", "шампуни", "шампуня"]) {
    it(`«${q}» finds all of «Шампуни»`, () => {
      for (const ui of [RU, EN, BOTH]) {
        const got = new Set(ui.find(q));
        expect(SHAMPOOS.filter((id) => !got.has(id)), `«${q}» missed`).toEqual([]);
      }
    });
  }

  for (const q of ["Conditioner", "conditioners", "кондиционер", "кондиционеры"]) {
    it(`«${q}» finds all of «Кондиционеры»`, () => {
      for (const ui of [RU, EN, BOTH]) {
        const got = new Set(ui.find(q));
        expect(CONDITIONERS.filter((id) => !got.has(id)), `«${q}» missed`).toEqual([]);
      }
    });
  }

  it("«palsam» — the Estonian word — finds all of «Кондиционеры» on any panel", () => {
    for (const ui of [RU, EN, BOTH]) {
      const got = new Set(ui.find("palsam"));
      expect(CONDITIONERS.filter((id) => !got.has(id))).toEqual([]);
    }
  });

  it("a product whose name says nothing is found by its subsection — in the languages whose dictionary is in", () => {
    const wash = [{ id: "x-daily", brand: "X", name: "Daily", cat: "hair", sub: "hair/sh" }];
    const [ru, en, both] = [panel([], wash), panel(["EN"], wash), panel(["ET", "EN"], wash)];
    expect(ru.find("шампуни")).toEqual(["x-daily"]);            // «Шампуни», the chip's own name
    expect(en.find("shampoos")).toEqual(["x-daily"]);           // «Shampoos» on the English panel
    expect(both.find("šampoonid")).toEqual(["x-daily"]);        // «Šampoonid»
    expect(ru.find("shampoos"), "no dictionary is fetched for a search").toEqual([]);
    // moved to «Без подраздела» by the owner: the chip's words go with it
    const own = panel([], [{ id: "x-daily", brand: "X", name: "Daily", cat: "hair", sub: "hair/sh", subcatBase: "-" }]);
    expect(own.find("шампуни")).toEqual([]);
  });

  it("the two the owner named: Kevin.Murphy ANGEL.WASH and ANGEL.RINSE", () => {
    expect(EN.find("Shampoo")).toContain("kevin-murphy-angel-wash");
    expect(RU.find("шампуни")).toContain("kevin-murphy-angel-wash");
    expect(BOTH.find("šampoon")).toContain("kevin-murphy-angel-wash");
    expect(EN.find("Conditioner")).toContain("kevin-murphy-angel-rinse");
    expect(RU.find("кондиционеры")).toContain("kevin-murphy-angel-rinse");
    expect(BOTH.find("palsam")).toContain("kevin-murphy-angel-rinse");
  });
});

describe("what already worked still does", () => {
  it("«kevin murphy» is every Kevin.Murphy product, «Kevin.Murphy» the same", () => {
    const km = FILE.filter((p) => p.brand === "Kevin.Murphy").map((p) => p.id);
    expect(km.length).toBeGreaterThan(20);
    expect(RU.find("kevin murphy")).toEqual(km);
    expect(RU.find("Kevin.Murphy")).toEqual(km);
  });

  it("every word has to be there: «kevin shampoo» is Kevin.Murphy's shampoos only", () => {
    const got = EN.find("kevin shampoo");
    expect(got).toContain("kevin-murphy-angel-wash");
    expect(got.every((id) => FILE.find((p) => p.id === id)!.brand === "Kevin.Murphy")).toBe(true);
    expect(got.every((id) => SHAMPOOS.includes(id))).toBe(true);
  });

  it("a number is a whole size: «40» is the 40 мл bottle, not the 140", () => {
    const own = panel([], [
      { id: "a", brand: "X", name: "Spray — спрей", cat: "hair", sizes: ["40 мл", "150 мл"] },
      { id: "b", brand: "X", name: "Spray — спрей", cat: "hair", sizes: ["140 мл"] },
    ]);
    expect(own.find("40")).toEqual(["a"]);
    expect(own.find("spray 140")).toEqual(["b"]);
    // the real one
    expect(RU.find("un tangled 40")).toEqual(["kevin-murphy-un-tangled-spray"]);
    expect(RU.find("un tangled 300")).toEqual([]);
  });

  it("«300 ml» is «300 мл», «150мл» is «150 мл»", () => {
    const own = panel([], [{ id: "a", brand: "X", name: "Wash", cat: "hair", sizes: ["300 мл"] }]);
    expect(own.find("300 ml")).toEqual(["a"]);
    expect(own.find("300мл")).toEqual(["a"]);
  });

  it("a barcode narrows from its start — on «Склад»'s rows and at the till", () => {
    const words = RU.words("4750");
    const ix = RU.index();
    const r = { productId: "kevin-murphy-angel-wash", variant: "250 мл", brand: "Kevin.Murphy", name: "ANGEL.WASH — шампунь", ean: "4750323781389" };
    expect(RU.row(r, words, ix)).toBe(true);
    expect(RU.row(r, RU.words("4751"), ix)).toBe(false);
    // «Салон»: the product's codes ride beside its haystack
    const p = FILE.find((x) => x.id === "kevin-murphy-angel-wash")!;
    expect(RU.match(p, words, "4750323781389")).toBe(true);
    expect(RU.match(p, words, "")).toBe(false);
  });

  it("a «Склад» row answers in every language too, and by its own size", () => {
    const ix = EN.index();
    const r = { productId: "kevin-murphy-angel-wash", variant: "250 мл", brand: "Kevin.Murphy", name: "ANGEL.WASH — шампунь", ean: null };
    for (const q of ["Shampoo", "шампуни", "šampoon", "angel 250"]) expect(EN.row(r, EN.words(q), ix), q).toBe(true);
    expect(EN.row(r, EN.words("angel 1000"), ix)).toBe(false);
  });

  it("the scanner learns which words only a size carried — those pick its rows", () => {
    const p = FILE.find((x) => x.id === "kevin-murphy-un-tangled-spray")!;
    const onSize: string[] = [];
    expect(RU.match(p, RU.words("un tangled 150"), "", onSize)).toBe(true);
    expect(onSize).toEqual(["150"]);
  });

  it("a stem is the start of its word, so it never finds less than the word did", () => {
    expect(RU.words("Shampoos")).toEqual(["shampoo"]);
    expect(RU.words("шампуни")).toEqual(["шампун"]);
    expect(RU.words("šampoon")).toEqual(["sampoon"]);
    expect(RU.words("un-tangled 150")).toEqual(["un", "tangl", "150"]);
    expect(RU.words("  ")).toEqual([]);
  });
});

describe("the pickers that stop at a few say how many there were", () => {
  it("«показаны 8 из 40», and nothing when every match is shown", () => {
    expect(RU.more(8, 40)).toContain("показаны 8 из 40");
    expect(RU.more(8, 8)).toBe("");
    expect(RU.more(3, 3)).toBe("");
  });

  it("the set picker drops own products BEFORE the eight are cut, not after", () => {
    const own = Array.from({ length: 10 }, (_, i) => ({ id: `c-own-${i}`, brand: "Rempire", name: "Shampoo — шампунь", cat: "hair", custom: true }));
    const file = FILE.filter((p) => SHAMPOOS.includes(p.id)).slice(0, 3);
    const ui = panel([], [...own, ...file]);
    const all = ui.heroFind("shampoo");
    expect(all.length).toBe(8);
    expect(all.total).toBe(13);
    const kept = ui.heroFind("shampoo", (p) => !p.custom);
    expect(kept.map((p) => p.id)).toEqual(file.map((p) => p.id));
    expect(kept.total).toBe(3);
  });
});

describe("all eight boxes ask that one search", () => {
  const body = (name: string) => appFn(name);
  const HANDLER = APP.slice(APP.indexOf('t.matches("[data-admblogq]")'), APP.indexOf('t.matches("[data-admblogq]")') + 600);

  it.each([
    ["admCatalogRows", "admProdMatch(p, words)"],              // «Товары»
    ["stockFiltered", "admStockRowMatch(r, words, ix)"],       // «Склад»
    ["posSearchResultsHTML", "admProdMatch(p, words, "],       // «Салон»
    ["scanAssignResultsHTML", "admProdMatch(p, words, "],      // the scanner's «привязать код»
    ["heroFind", "admProdMatch(p, words)"],                    // banner picture and link, sets, newsletter
    ["blogToolMatches", "admProdMatch(p, words)"],             // the blog's «Товар» tool
    ["admBlogMatches", "admProdMatch(p, words)"],              // «Товары в статье»
    ["promoProductMatches", "admProdMatch(p, words)"],         // the promo's «Товар»
  ])("%s", (name, call) => {
    const src = body(name);
    expect(src).toContain(call);
    expect(src).toMatch(/admQueryWords\(S\.\w+\)|admQueryWords\(q\)/);
    expect(src, "a raw substring is back").not.toMatch(/toLowerCase\(\)\.indexOf\(/);
    expect(src, "a haystack of its own is back").not.toMatch(/scanFold\(p\.brand|scanFold\(r\.brand/);
  });

  it("the blog editor's screen and its box's keystroke are one helper, not two copies", () => {
    expect(body("admBlogEditorScreen")).toContain("admBlogMatches(d, S.adminBlogQ)");
    expect(HANDLER).toContain("admBlogPicksHTML(admBlogMatches(S.adminBlogEdit, S.adminBlogQ))");
    expect(HANDLER).not.toMatch(/toLowerCase\(\)\.indexOf\(/);
    expect(APP.match(/data-admblogproductadd="/g)!.length, "the row markup is written once").toBe(1);
  });

  it("heroFind's callers go through it — the set picker with its `keep`", () => {
    expect(body("heroImgRows")).toContain("heroFind(S.heroImgQ)");
    expect(body("heroGoRows")).toContain("heroFind(S.heroGoQ)");
    expect(body("bundlePickRows")).toContain("heroFind(S.bundleQ, function (p) { return !p.custom; })");
    expect(body("newsPickRows")).toContain('heroFind(q || "")');
  });

  it.each([
    "heroImgRows", "heroGoRows", "bundlePickRows", "newsPickRows", "blogToolMatches",
    "admBlogPicksHTML", "promoPicksHTML", "posSearchResultsHTML", "scanAssignResultsHTML",
  ])("%s says «показаны N из M» when it stops short", (name) => {
    expect(body(name)).toContain("admPickMoreHTML(");
  });

  it("the haystack is the name in all three languages, the id, the sizes and the subsection — not the search cards", () => {
    const hay = body("admHay");
    expect(hay).toContain('trName(name, "ET"), trName(name, "EN"), id');
    expect(hay).toContain('trText(d.name, "ET")');
    expect(hay).toContain("subcatNow(p)");
    expect(hay).not.toMatch(/SEARCH_CARDS|searchCards|srchCard/i);
    // cached: rebuilt only when what it is made of moves
    expect(hay).toContain("if (c && c.key === key) return c;");
  });
});
