/**
 * «Товары → Каталог»: the «Нет в наличии» chip and the row's badge say the
 * same thing (map-defects #6, 24.09.2026).
 *
 * The chip counted by the counted shelf (goodsIsOut, 19.09.2026) while the
 * badge on each row still read only `p.stock`, so a row listed under «Нет в
 * наличии» could wear a green «В наличии». The comment over goodsIsOut named
 * the helper both were meant to share — goodsStockWord — and it did not exist.
 * It does now, and it answers in the order the shop sells by
 * (getOverrides in src/lib/orders.ts, stockStates in src/lib/inventory.ts):
 * a hand-set «Нет в наличии» first, then the counted shelf — every size of
 * it, not the first row — then the hand-set flag.
 *
 * The functions are cut out of public/shop2/app.js by source text and run
 * over stubs, the tests/admin-goods-r26.test.ts technique.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

type Product = { id: string; brand: string; name: string; stock?: string; price: number; sizes?: string[]; custom?: boolean; active?: boolean };
type Shelf = { productId: string; variant: string; tracked: boolean; state: "in" | "low" | "out" };

/** One product as «Каталог» shows it: what does its badge say, and is it under «Кончаются»? */
function catalogue(p: Product, levels: Shelf[]): { badge: string; runsLow: boolean } {
  // repository source plus fixed stub text — P and LEVELS are arguments
  const body = `
    var S = { stockLevels: LEVELS, lang: "RU", goodsFresh: null };
    var ADM_SW_TICK = "";
    function shopHidden() { return false; }
    function esc(s) { return String(s); }
    function eur(n) { return n + " €"; }
    function media() { return ""; }
    function customFresh() { return false; }
    ${src.match(/^ {2}var ADM_TAG_KIND = .*;$/m)![0]}
    ${slice("admTagHTML")}
    ${slice("admSwitchFace")}
    ${slice("admSwitch")}
    ${slice("goodsOffSale")}
    ${slice("goodsIsOut")}
    ${slice("goodsRunsLow")}
    ${slice("goodsMatchesFilter")}
    ${slice("goodsStockWord")}
    ${slice("admCatalogRow")}
    var row = admCatalogRow(P);
    var badge = /adm-badge adm-tag(?: adm-badge--(?:ok|warn|warnfill|quiet))?">([^<]+)</.exec(row);
    return { badge: badge ? badge[1] : "", runsLow: goodsMatchesFilter(P, "low") };
  `;
  return (new Function("P", "LEVELS", body) as (p: Product, l: Shelf[]) => { badge: string; runsLow: boolean })(p, levels);
}

const shelf = (productId: string, variant: string, state: Shelf["state"], tracked = true): Shelf => ({ productId, variant, tracked, state });

const ONE: Product = { id: "p1", brand: "Kevin.Murphy", name: "Un.Tangled", stock: "in", price: 25, sizes: ["150 мл"] };
const LADDER: Product = { id: "p2", brand: "Davines", name: "OI Shampoo", stock: "in", price: 12, sizes: ["75 мл", "250 мл", "500 мл"] };

/* 1a (Dim, 25.09.2026, q17): the chip is «Кончаются» now — every size that
   is low or out puts the product on the reorder list — while the badge keeps
   reading the product as a whole, goodsStockWord(). The promise that stays:
   a row that says «Нет» or «Мало» is always on that list. */
describe("the chip and the badge read one shelf", () => {
  it("a bottle the shelf counted to zero is «Нет» on its row, not a green «В наличии»", () => {
    // the defect as reported: the manual flag still says «in», the shelf says 0
    expect(catalogue(ONE, [shelf("p1", "150 мл", "out")])).toEqual({ badge: "Нет", runsLow: true });
  });

  it("a size still on the shelf keeps a half-empty ladder on sale — «В наличии», and on the reorder list", () => {
    /* The chip used to read the FIRST shelf row of a product: a 75 мл at zero
       put a product whose 250 мл and 500 мл were on the shelf under «Нет». */
    expect(catalogue(LADDER, [shelf("p2", "75 мл", "out"), shelf("p2", "250 мл", "in"), shelf("p2", "500 мл", "in")]))
      .toEqual({ badge: "В наличии", runsLow: true });
  });

  it("a counted size that is low says «Мало» — the shelf, not the flag", () => {
    expect(catalogue(LADDER, [shelf("p2", "75 мл", "low"), shelf("p2", "250 мл", "in"), shelf("p2", "500 мл", "in")]))
      .toEqual({ badge: "Мало", runsLow: true });
    expect(catalogue({ ...ONE, stock: "low" }, [shelf("p1", "150 мл", "in")])).toEqual({ badge: "В наличии", runsLow: false });
  });

  it("«Нет» needs every size counted — two uncounted sizes keep the owner's own word", () => {
    expect(catalogue(LADDER, [shelf("p2", "75 мл", "out"), shelf("p2", "250 мл", "out", false), shelf("p2", "500 мл", "out", false)]))
      .toEqual({ badge: "В наличии", runsLow: true });
  });

  it("a hand-set «Нет в наличии» stops the sale whatever the shelf says — and the row says so", () => {
    // getOverrides: «A count can say a product is gone; it may not say it is on sale again.»
    expect(catalogue({ ...ONE, stock: "out" }, [shelf("p1", "150 мл", "in")])).toEqual({ badge: "Нет", runsLow: true });
  });

  it("nothing counted: the hand-set flag, for the chip and the badge alike", () => {
    expect(catalogue(ONE, [])).toEqual({ badge: "В наличии", runsLow: false });
    expect(catalogue({ ...ONE, stock: "low" }, [])).toEqual({ badge: "Мало", runsLow: true });
    expect(catalogue({ ...ONE, stock: "out" }, [shelf("p1", "150 мл", "out", false)])).toEqual({ badge: "Нет", runsLow: true });
  });

  it("every row that says «Нет» or «Мало» is under «Кончаются»", () => {
    const cases: Array<[Product, Shelf[]]> = [
      [ONE, [shelf("p1", "150 мл", "out")]],
      [ONE, [shelf("p1", "150 мл", "low")]],
      [{ ...ONE, stock: "out" }, [shelf("p1", "150 мл", "in")]],
      [{ ...ONE, stock: "low" }, []],
      [LADDER, [shelf("p2", "75 мл", "out"), shelf("p2", "250 мл", "out"), shelf("p2", "500 мл", "out")]],
      [LADDER, [shelf("p2", "75 мл", "in"), shelf("p2", "250 мл", "out"), shelf("p2", "500 мл", "out")]],
      [{ ...LADDER, id: "c-own", custom: true }, [shelf("c-own", "", "out")]],
    ];
    for (const [p, levels] of cases) {
      const got = catalogue(p, levels);
      if (got.badge !== "В наличии") expect(got.runsLow, `${p.id} ${JSON.stringify(levels)}`).toBe(true);
    }
  });
});
