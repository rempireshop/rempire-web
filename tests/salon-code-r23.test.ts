/**
 * One barcode, three screens: «Склад», the scanner, and the register.
 *
 * Renat, 13.09.2026 and again 18.09.2026: «I had a product with scanned code,
 * then I went to salon -> scan, scanned the same product and it did not find
 * it.» The scanner and «Склад» both answer through the warehouse — GET
 * /api/admin/inventory/lookup/ and the shelf rows — and both find such a code;
 * the register's own search box was the one that did not, because it walked
 * CATALOGUE and skipped every product the shop currently calls «нет в
 * наличии». The bottle was in his hand and the till said «Ничего не найдено».
 *
 * Same technique as tests/inventory-scanner.test.ts: the functions are sliced
 * out of public/shop2/app.js **by source text** and run against stubs, so this
 * tests the shop's own code and not a retyped copy that could drift from it.
 * The shelf rows are the real ones — src/lib/inventory.ts getLevels() over a
 * real database — so the two screens are compared over the same answer the
 * panel actually fetches.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variantData from "@/data/catalogue.variants.json";
import { getLevels, move, setLevel, type CatalogueLevelRow } from "@/lib/inventory";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

/** Cut `function <name>(…) { … }` out of app.js by brace matching. */
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
/** …and `var <NAME> = <literal>;`, so the test reads the shipped value. */
function constant(name: string): string {
  const m = new RegExp(`\\bvar ${name} = ([^;\\n]+);`).exec(src);
  if (!m) throw new Error(`public/shop2/app.js no longer declares ${name}`);
  return `var ${name} = ${m[1]};`;
}

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const VARIANTS = variantData as Record<string, { sizes: string[]; prices: number[] }>;
const sized = CATALOGUE.find((p) => VARIANTS[p.id] && VARIANTS[p.id].sizes.length > 2)!;
const plain = CATALOGUE.find((p) => !VARIANTS[p.id])!;

/** A product as the browser's own catalogue carries it (public/shop/catalogue2.js). */
type Shelf = { id: string; brand: string; name: string; cat: string; price: number; stock: string; sizes?: string[]; prices?: number[] };
function shelf(p: Min, stock = "in"): Shelf {
  const v = VARIANTS[p.id];
  return { id: p.id, brand: p.b, name: p.n, cat: p.c, price: p.p, stock, sizes: v?.sizes, prices: v?.prices };
}

type Asked = {
  /** the register's list, and which sizes it offers */
  salon: { found: boolean; chips: string[]; text: string };
  /** «Склад» — the same query against the same shelf rows */
  stock: number;
  /** what one tap on the first chip did */
  tap: { cart: Array<{ id: string; variant: string; qty: number }>; toasts: string[] };
};

/** Both screens, one query, the same shelf rows underneath. */
function ask(q: string, levels: CatalogueLevelRow[], cat: Shelf[]): Asked {
  const body = `
    var S = { posQ: Q, stockQ: Q, posCart: [], stockLevels: LEVELS, stockFilter: "all" };
    var CATALOGUE = CAT;
    var toasts = [];
    function toast(t) { toasts.push(t); }
    function render() {}
    function esc(s) { return String(s == null ? "" : s); }
    function eur(n) { return String(n); }
    var POS_GONE = "POS_GONE";
    ${constant("POS_EAN")}
    ${slice("scanFold")}
    ${slice("scanWordHas")}
    ${slice("byIdOrNull")}
    ${slice("edStockFor")}
    ${slice("posEanIndex")}
    ${slice("posCodeHit")}
    ${slice("posVariantPrice")}
    ${slice("posSearchResultsHTML")}
    ${slice("posAddProduct")}
    ${slice("stockFiltered")}
    var html = posSearchResultsHTML();
    var chips = (html.match(/data-posadd="[^"]+"/g) || []).map(function (m) { return m.slice(13, -1); });
    var stock = stockFiltered().length;
    if (chips.length) posAddProduct(chips[0]);
    return {
      salon: { found: chips.length > 0, chips: chips, text: html.replace(/<[^>]*>/g, " ").replace(/\\s+/g, " ").trim() },
      stock: stock,
      tap: { cart: S.posCart, toasts: toasts }
    };
  `;
  return new Function("Q", "LEVELS", "CAT", body)(q, levels, cat) as Asked;
}

const SIZES = () => VARIANTS[sized.id].sizes;
const CODE = "4006381333931";

describe("a barcode in «Салон»", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(truncateAll);

  it("finds the bottle «Склад» finds, even when the shop says «нет в наличии»", async () => {
    await setLevel(plain.id, "", { ean: CODE });
    const levels = await getLevels({ filter: "all", limit: 1000 });

    const inStock = ask(CODE, levels, [shelf(plain, "in")]);
    expect(inStock.stock, "«Склад» has to find the row it just wrote").toBe(1);
    expect(inStock.salon.found, "the register has to find it too").toBe(true);

    /* The badge the shop shows is not the question a barcode asks. A bottle
       counted down to zero — or marked «Нет в наличии» by hand — is still the
       bottle in the owner's hand, and «Ничего не найдено» is the one answer
       that tells him nothing. */
    const out = ask(CODE, levels, [shelf(plain, "out")]);
    expect(out.stock, "«Склад» still finds it").toBe(1);
    expect(out.salon.found, "and so must «Салон» — this is the reported bug").toBe(true);
    // …and it is refused in words at the chip, not with a silent nothing
    expect(out.tap.cart).toHaveLength(0);
    expect(out.tap.toasts).toEqual(["Нет на складе"]);
  });

  it("names the SIZE the code is bound to, not the whole product", async () => {
    const big = SIZES()[2];
    await setLevel(sized.id, big, { ean: CODE });
    await move({ productId: sized.id, variant: big, delta: 4, reason: "goods_in", actor: "test" });
    const levels = await getLevels({ filter: "all", limit: 1000 });

    /* A barcode is printed on one bottle and bound to one volume. Offering
       all three chips for it put a different bottle in the basket at a
       different price, on one tap, with nothing on screen to say so. */
    const r = ask(CODE, levels, [shelf(sized)]);
    expect(r.salon.chips).toEqual([`${sized.id}:2`]);
    expect(r.tap.cart).toEqual([{ id: sized.id, variant: big, qty: 1 }]);

    // the name still offers the whole ladder — only a code narrows it
    const byName = ask(sized.n, levels, [shelf(sized)]);
    expect(byName.salon.chips.length).toBe(SIZES().length);
  });

  it("says so in words when the code is bound to a bottle the shop took off sale", async () => {
    await setLevel(plain.id, "", { ean: CODE });
    const levels = await getLevels({ filter: "all", limit: 1000 });
    // «Показывать в магазине» off takes the product out of CATALOGUE entirely
    const r = ask(CODE, levels, []);
    expect(r.salon.found).toBe(false);
    expect(r.salon.text).toBe("POS_GONE");
  });

  it("a name search still leaves out what the shop is not selling", async () => {
    const levels = await getLevels({ filter: "all", limit: 1000 });
    expect(ask(plain.n, levels, [shelf(plain, "out")]).salon.found).toBe(false);
    expect(ask(plain.n, levels, [shelf(plain, "in")]).salon.found).toBe(true);
  });

  it("half a code still narrows by name, the way «Склад» does", async () => {
    await setLevel(plain.id, "", { ean: CODE });
    const levels = await getLevels({ filter: "all", limit: 1000 });
    // not a whole code: the fuzzy haystack answers, and it carries the codes
    const half = ask(CODE.slice(0, 8), levels, [shelf(plain)]);
    expect(half.salon.found).toBe(true);
    expect(half.stock).toBe(1);
  });
});
