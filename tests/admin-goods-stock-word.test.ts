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

/** One product as «Каталог» shows it: is it under «Нет в наличии», and what does its badge say? */
function catalogue(p: Product, levels: Shelf[]): { underOut: boolean; badge: string } {
  // repository source plus fixed stub text — P and LEVELS are arguments
  const body = `
    var S = { stockLevels: LEVELS, lang: "RU", goodsFresh: null };
    function shopHidden() { return false; }
    function esc(s) { return String(s); }
    function eur(n) { return n + " €"; }
    function media() { return ""; }
    function customFresh() { return false; }
    ${slice("goodsOffSale")}
    ${slice("goodsIsOut")}
    ${slice("goodsMatchesFilter")}
    ${src.includes("function goodsStockWord(") ? slice("goodsStockWord") : ""}
    ${src.includes("function goodsShelf(") ? slice("goodsShelf") : ""}
    ${slice("admCatalogRow")}
    var row = admCatalogRow(P);
    var badge = /adm-badge adm-badge--sm adm-badge--(?:ok|warn|warnfill|quiet)">([^<]+)</.exec(row);
    return { underOut: goodsMatchesFilter(P, "out"), badge: badge ? badge[1] : "" };
  `;
  return (new Function("P", "LEVELS", body) as (p: Product, l: Shelf[]) => { underOut: boolean; badge: string })(p, levels);
}

const shelf = (productId: string, variant: string, state: Shelf["state"], tracked = true): Shelf => ({ productId, variant, tracked, state });

const ONE: Product = { id: "p1", brand: "Kevin.Murphy", name: "Un.Tangled", stock: "in", price: 25, sizes: ["150 мл"] };
const LADDER: Product = { id: "p2", brand: "Davines", name: "OI Shampoo", stock: "in", price: 12, sizes: ["75 мл", "250 мл", "500 мл"] };

describe("the chip and the badge read one word", () => {
  it("a bottle the shelf counted to zero is «Нет» on its row, not a green «В наличии»", () => {
    // the defect as reported: the manual flag still says «in», the shelf says 0
    const got = catalogue(ONE, [shelf("p1", "150 мл", "out")]);
    expect(got).toEqual({ underOut: true, badge: "Нет" });
  });

  it("a size still on the shelf keeps a half-empty ladder on sale — «В наличии», not under «Нет»", () => {
    /* The chip used to read the FIRST shelf row of a product: a 75 мл at zero
       put a product whose 250 мл and 500 мл were on the shelf under «Нет». */
    const got = catalogue(LADDER, [shelf("p2", "75 мл", "out"), shelf("p2", "250 мл", "in"), shelf("p2", "500 мл", "in")]);
    expect(got).toEqual({ underOut: false, badge: "В наличии" });
  });

  it("a counted size that is low says «Мало» — the shelf, not the flag", () => {
    expect(catalogue(LADDER, [shelf("p2", "75 мл", "low"), shelf("p2", "250 мл", "in"), shelf("p2", "500 мл", "in")]))
      .toEqual({ underOut: false, badge: "Мало" });
    expect(catalogue({ ...ONE, stock: "low" }, [shelf("p1", "150 мл", "in")])).toEqual({ underOut: false, badge: "В наличии" });
  });

  it("«Нет» needs every size counted — two uncounted sizes keep the owner's own word", () => {
    const got = catalogue(LADDER, [shelf("p2", "75 мл", "out"), shelf("p2", "250 мл", "out", false), shelf("p2", "500 мл", "out", false)]);
    expect(got).toEqual({ underOut: false, badge: "В наличии" });
  });

  it("a hand-set «Нет в наличии» stops the sale whatever the shelf says — and the row says so", () => {
    // getOverrides: «A count can say a product is gone; it may not say it is on sale again.»
    expect(catalogue({ ...ONE, stock: "out" }, [shelf("p1", "150 мл", "in")])).toEqual({ underOut: true, badge: "Нет" });
  });

  it("nothing counted: the hand-set flag, for the chip and the badge alike", () => {
    expect(catalogue(ONE, [])).toEqual({ underOut: false, badge: "В наличии" });
    expect(catalogue({ ...ONE, stock: "low" }, [])).toEqual({ underOut: false, badge: "Мало" });
    expect(catalogue({ ...ONE, stock: "out" }, [shelf("p1", "150 мл", "out", false)])).toEqual({ underOut: true, badge: "Нет" });
  });

  it("every product under «Нет в наличии» wears «Нет», and none outside it does", () => {
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
      expect(got.underOut, `${p.id} ${JSON.stringify(levels)}`).toBe(got.badge === "Нет");
    }
  });
});
