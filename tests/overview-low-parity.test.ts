/**
 * «Обзор → Сделать сегодня»: the number on the stock row is the number of
 * rows in the list that row opens.
 *
 * Dim, 26.09.2026 (panel-overview, «bad»): «Hidden product count in overview
 * is 1 — but when I open it's 2. Same for "products running out" shows in
 * overview 12, not sure if that is also correct.» Neither was. The server
 * counted with its own rule (qOverviewLowStock) and the panel filtered with
 * another (goodsStockWord / goodsRunsLow); the hidden row opened every hidden
 * product, and the ordinary one opened «Склад», which counts sizes, not
 * products. On staging the catalogue chip «Кончаются» held ~78 products under
 * a row that said 12: the catalogue file's own «мало», which the shop prints
 * on 69 product cards, never reached the server's count.
 *
 * Later the same day, looking at «Каталог»: «Why do we have "hidden - running
 * low" category?!» — and he decided a hidden product lives only under
 * «Скрытые». The hidden row on «Обзор» and its chip «Скрытые · кончаются» are
 * gone; a hidden product is still never in «Кончаются» or its row.
 *
 * Four proofs, all against public/shop2/app.js as it is (functions cut out by
 * source text, the tests/admin-goods-r26.test.ts technique):
 *   1. src/lib/stock-word.ts and the panel's two functions give the same word
 *      and the same «кончается» for every shape a product's shelf can take;
 *   2. over one real database — file words, counted sizes, a hand-set «нет»,
 *      hidden catalogue and own products — getOverviewSummary() counts exactly
 *      the products the «Кончаются» chip lists, names the same ones, and
 *      leaves every hidden product to «Скрытые»;
 *   3. the row opens that chip, and once the panel holds the shelf the row
 *      counts with the chip's own predicate;
 *   4. «Каталог» has its four chips and no fifth.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variantsFile from "@/data/catalogue.variants.json";
import { getOverviewSummary } from "@/lib/analytics";
import { createCustomProduct, listCustomProducts, setCustomProductActive, toCatalogueProduct } from "@/lib/custom-products";
import { exec, query } from "@/lib/db";
import { getLevels, move, setQty } from "@/lib/inventory";
import { getOverrides } from "@/lib/orders";
import { runsLow, shelfWord, type ShelfRow } from "@/lib/stock-word";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

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
function decl(name: string): string {
  const m = new RegExp(`^ {2}var ${name} = [\\s\\S]*?;$`, "m").exec(src);
  if (!m) throw new Error(`public/shop2/app.js no longer declares ${name}`);
  return m[0];
}

/** The browser's own catalogue file, read as tests/catalogue-variants.test.ts reads it. */
type FileProduct = { id: string; brand: string; name: string; stock: string; price: number; sizes?: string[] };
const FILE: FileProduct[] = (() => {
  const js = readFileSync(fileURLToPath(new URL("../public/shop/catalogue2.js", import.meta.url)), "utf8");
  const m = /const CATALOGUE = (\[[\s\S]*?\n\]);/.exec(js);
  if (!m) throw new Error("public/shop/catalogue2.js: no CATALOGUE array literal to read");
  return JSON.parse(m[1]) as FileProduct[];
})();

type Min = { id: string; b: string; n: string; s: string };
const MIN = catalogueMin as Min[];
const LADDERS = variantsFile as Record<string, { sizes: string[] }>;

/* ---------- 1. the two copies of the rule ------------------------------------ */

type Shelf = ShelfRow & { productId: string; variant: string };
const panelRule = new Function("P", "LEVELS", `
  var S = { stockLevels: LEVELS };
  ${slice("goodsStockWord")}
  ${slice("goodsRunsLow")}
  return { word: goodsStockWord(P), low: goodsRunsLow(P) };
`) as (p: { id: string; stock?: string }, levels: Shelf[]) => { word: string; low: boolean };

describe("src/lib/stock-word.ts is the panel's rule, line for line", () => {
  it("agrees with goodsStockWord / goodsRunsLow on every shelf shape up to three sizes", () => {
    const states: Array<ShelfRow["state"]> = ["in", "low", "out"];
    const sizeShapes: ShelfRow[] = [];
    for (const tracked of [true, false]) for (const state of states) sizeShapes.push({ tracked, state });
    let cases = 0;
    for (const word of [undefined, null, "in", "low", "out"]) {
      for (let n = 0; n <= 3; n++) {
        const combos: ShelfRow[][] = [[]];
        for (let k = 0; k < n; k++) {
          const next: ShelfRow[][] = [];
          for (const c of combos) for (const s of sizeShapes) next.push([...c, s]);
          combos.splice(0, combos.length, ...next);
        }
        for (const rows of combos) {
          const levels: Shelf[] = rows.map((r, i) => ({ ...r, productId: "p", variant: String(i) }));
          // a neighbour's rows must never leak into this product's word
          levels.push({ productId: "q", variant: "", tracked: true, state: "out" });
          const panel = panelRule({ id: "p", stock: word ?? undefined }, levels);
          expect({ word: shelfWord(word, rows), low: runsLow(word, rows) }, `${word} ${JSON.stringify(rows)}`)
            .toEqual({ word: panel.word, low: panel.low });
          cases++;
        }
      }
    }
    expect(cases).toBeGreaterThan(1000);
  });

  it("the file the panel reads and the file the server reads give every product the same word", () => {
    const server = new Map(MIN.map((p) => [p.id, p.s]));
    expect(FILE.length).toBe(MIN.length);
    for (const p of FILE) expect(server.get(p.id), p.id).toBe(p.stock);
  });
});

/* ---------- 2. one database, both ends ---------------------------------------- */

type ClientProduct = { id: string; brand: string; name: string; stock: string; custom?: boolean; active?: boolean };

/** «Каталог» as the panel builds it from the same four answers it loads:
    GET /api/overrides (stock words, hidden switches, the active own products),
    GET /api/admin/products (every own product), GET /api/admin/inventory (the
    shelf) and the catalogue file. rebuildCatalogue() and applyDemoOverrides()'s
    stock line are mirrored here; admCatalogList(), customProduct() and the
    chip predicates are app.js's own. */
async function panelCatalogue(): Promise<{ low: string[]; off: string[] }> {
  const [ov, levels, all] = await Promise.all([getOverrides(), getLevels({ filter: "all", limit: 1000 }), listCustomProducts()]);
  const DEMO = { stock: {} as Record<string, string>, hidden: {} as Record<string, boolean> };
  for (const [id, o] of Object.entries(ov)) {
    if (o.hidden === true) DEMO.hidden[id] = true;
    if (o.stock) DEMO.stock[id] = o.stock;
  }
  const customAll = all.map(toCatalogueProduct);
  const run = new Function("DEMO", "FILE", "CUSTOM_ACTIVE", "CUSTOM_ALL", "LEVELS", `
    var S = { stockLevels: LEVELS, customAll: CUSTOM_ALL };
    var CAT_NAMES = { hair: 1, styling: 1, beard: 1, face: 1, body: 1, perfume: 1, merch: 1 };
    var CUSTOM_PLACEHOLDER = "/brand/rempire-tower.svg";
    function seoNorm() { return null; }
    ${slice("shopHidden")}
    ${slice("customProduct")}
    var FILE_PRODUCTS = FILE.map(function (p) {
      return { id: p.id, brand: p.brand, name: p.name, price: p.price, stock: DEMO.stock[p.id] || p.stock };
    });
    var CATALOGUE = FILE_PRODUCTS.filter(function (p) { return !shopHidden(p.id); });
    CUSTOM_ACTIVE.forEach(function (c) {
      if (shopHidden(c.id)) return;
      var p = customProduct(c);
      if (DEMO.stock[p.id]) p.stock = DEMO.stock[p.id];
      CATALOGUE.push(p);
    });
    function byIdOrNull(id) { for (var i = 0; i < CATALOGUE.length; i++) if (CATALOGUE[i].id === id) return CATALOGUE[i]; return null; }
    ${slice("hiddenFileProducts")}
    ${slice("admCatalogList")}
    ${slice("goodsOffSale")}
    ${slice("goodsStockWord")}
    ${slice("goodsRunsLow")}
    ${slice("goodsMatchesFilter")}
    var list = admCatalogList();
    var ids = function (f) { return list.filter(function (p) { return goodsMatchesFilter(p, f); }).map(function (p) { return p.id; }); };
    return { low: ids("low"), off: ids("off") };
  `) as (...a: unknown[]) => { low: string[]; off: string[] };
  return run(DEMO, FILE, customAll.filter((c) => c.active !== false), customAll, levels);
}

const NOW = new Date("2026-06-15T12:00:00Z");
const fileWord = (s: string) => MIN.filter((p) => p.s === s);
/** A catalogue product with a ladder of at least `n` sizes and the file word `s`. */
function withLadder(s: string, n: number, skip: string[] = []): Min & { sizes: string[] } {
  const p = MIN.find((m) => m.s === s && !skip.includes(m.id) && (LADDERS[m.id]?.sizes?.length ?? 0) >= n);
  if (!p) throw new Error(`no catalogue product with file word ${s} and ${n}+ sizes`);
  return { ...p, sizes: LADDERS[p.id].sizes };
}
async function count(productId: string, variant: string, qty: number) {
  await move({ productId, variant, delta: 5, reason: "goods_in", actor: "test" });
  if (qty !== 5) await setQty(productId, variant, qty, { reason: "adjust", actor: "test" });
}

describe("one database: the row's number is the chip's list", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate orders, product_overrides, stock_levels, stock_moves, custom_products restart identity cascade");
  });

  it("a fresh shop: the file's own «мало» and «нет» are the list, on both ends", async () => {
    const ov = await getOverviewSummary(NOW);
    const panel = await panelCatalogue();
    const expected = MIN.filter((p) => p.s !== "in").length;
    expect(expected, "the catalogue file carries words of its own").toBeGreaterThan(0);
    expect(panel.low).toHaveLength(expected);
    expect(ov.lowStock.total, "before: 0 over a chip of 74 — the file's words never reached the server").toBe(expected);
    expect(panel.off).toEqual([]);
  });

  it("every kind of product at once: the same count and the same products; the hidden ones only under «Скрытые»", async () => {
    // a ladder with one size counted out and the rest full — «кончается» in the list
    const halfOut = withLadder("in", 2);
    await count(halfOut.id, halfOut.sizes[0], 0);
    for (const s of halfOut.sizes.slice(1)) await count(halfOut.id, s, 10);
    // two sizes counted low — ONE product, not two
    const twoLow = withLadder("in", 2, [halfOut.id]);
    await count(twoLow.id, twoLow.sizes[0], 1);
    await count(twoLow.id, twoLow.sizes[1], 1);
    // «Не продавать» over ten on the shelf — the shop says «нет», so does its badge
    const stopped = withLadder("in", 1, [halfOut.id, twoLow.id]);
    await query("insert into product_overrides (product_id, stock) values ($1, 'out')", [stopped.id]);
    for (const s of stopped.sizes) await count(stopped.id, s, 10);
    // the file says «мало», the owner said «в наличии» — not on the list
    const fixedByHand = fileWord("low")[0];
    await query("insert into product_overrides (product_id, stock) values ($1, 'in')", [fixedByHand.id]);
    // hidden catalogue products: one running low, one not — neither is «Кончаются»
    const hiddenLow = fileWord("in").find((p) => ![halfOut.id, twoLow.id, stopped.id].includes(p.id))!;
    const hiddenFull = fileWord("in").find((p) => ![halfOut.id, twoLow.id, stopped.id, hiddenLow.id].includes(p.id))!;
    await query("insert into product_overrides (product_id, stock, hidden) values ($1, 'low', true), ($2, null, true)", [hiddenLow.id, hiddenFull.id]);
    // own products: one on sale and counted out, one switched off with «мало», one switched off and fine
    const ownOn = await createCustomProduct({ brand: "Acme", name: "Wax", cat: "styling", price: 9 });
    await count(ownOn.id, "", 0);
    const ownOffLow = await createCustomProduct({ brand: "Acme", name: "Clay", cat: "styling", price: 9 });
    await setCustomProductActive(ownOffLow.id, false);
    await query("insert into product_overrides (product_id, stock) values ($1, 'low')", [ownOffLow.id]);
    const ownOffFine = await createCustomProduct({ brand: "Acme", name: "Paste", cat: "styling", price: 9 });
    await setCustomProductActive(ownOffFine.id, false);

    const ov = await getOverviewSummary(NOW);
    const panel = await panelCatalogue();

    // the ordinary row: every one of the cases above that is on sale and running low
    for (const id of [halfOut.id, twoLow.id, stopped.id, ownOn.id]) expect(panel.low, id).toContain(id);
    expect(panel.low).not.toContain(fixedByHand.id);
    expect(ov.lowStock.total).toBe(panel.low.length);
    expect(ov.lowStock.low + ov.lowStock.out).toBe(ov.lowStock.total);

    /* A hidden product running low is in neither list nor number (Dim,
       26.09.2026: a hidden product lives only under «Скрытые») — the
       catalogue one hidden on its override row and the owner's own one
       switched off alike. */
    for (const id of [hiddenLow.id, ownOffLow.id]) {
      expect(panel.low, id).not.toContain(id);
      expect(ov.lowStock.items.map((i) => i.id), id).not.toContain(id);
    }
    // …and the summary no longer carries a hidden count for a row that is gone
    expect(Object.keys(ov.lowStock).sort()).toEqual(["items", "low", "out", "total"]);
    // «Скрытые» holds every hidden product, running low or not
    expect(panel.off.sort()).toEqual([hiddenLow.id, hiddenFull.id, ownOffLow.id, ownOffFine.id].sort());
  });

  it("names the products the list holds — its first twenty, out-of-stock first", async () => {
    const halfOut = withLadder("in", 2);
    await count(halfOut.id, halfOut.sizes[0], 0);
    for (const s of halfOut.sizes.slice(1)) await count(halfOut.id, s, 10);
    const ov = await getOverviewSummary(NOW);
    const panel = await panelCatalogue();
    expect(ov.lowStock.items.length).toBe(Math.min(20, panel.low.length));
    for (const it of ov.lowStock.items) expect(panel.low, it.id).toContain(it.id);
    const firstIn = ov.lowStock.items.findIndex((i) => i.stock !== "out");
    const lastOut = ov.lowStock.items.map((i) => i.stock).lastIndexOf("out");
    if (firstIn >= 0 && lastOut >= 0) expect(lastOut).toBeLessThan(firstIn);
    // a product whose word is still «в наличии» but a size is gone is named, as «мало»
    const hit = (await getOverviewSummary(NOW)).lowStock;
    expect(hit.total).toBe(panel.low.length);
  });
});

/* ---------- 3. the rows open those chips ------------------------------------- */

describe("«Сделать сегодня»: the stock row opens the list it counts", () => {
  const overviewSrc = () => slice("admOverviewHTML");

  it("«N товаров заканчиваются» opens «Каталог → Кончаются», not «Склад» (which counts sizes)", () => {
    const overview = overviewSrc();
    const row = overview.slice(overview.indexOf('"товар заканчивается"'));
    expect(row.slice(0, 400)).toContain(`'data-admtab="goods" data-admfilter="low"'`);
  });

  it("there is no row for hidden products any more — they live under «Скрытые» (Dim, 26.09.2026)", () => {
    const overview = overviewSrc();
    expect(overview).not.toContain("скрытый товар заканчивается");
    expect(overview).not.toContain("скрытых товаров заканчиваются");
    expect(overview).not.toContain('data-admfilter="offlow"');
    expect(overview).not.toContain('data-admfilter="off"');
    // the only goods row «Сделать сегодня» has is the one above
    expect(overview.match(/data-admtab="goods"/g)).toHaveLength(1);
  });

  it("arriving from a row drops a search left in the box, so the list is the whole chip", () => {
    const goTab = slice("admGoTab");
    const line = goTab.split("\n").find((l) => l.includes('tab === "goods"') && l.includes("S.goodsFilter = go.filter"));
    expect(line, "the goods line of admGoTab").toBeTruthy();
    expect(line).toContain('S.goodsQ = ""');
  });

  /* The row reads the summary until the panel holds what the chips count;
     from then on it counts with the chips' own predicate, so an edit made
     since the summary was read cannot put the row and the list apart. */
  const rows = (o: unknown, levels: unknown, customAll: unknown, list: ClientProduct[]) => (new Function("SUMMARY", "LEVELS", "CUSTOM_ALL", "LIST", `
    var S = { stockLevels: LEVELS, customAll: CUSTOM_ALL };
    function admCatalogList() { return LIST; }
    function shopHidden(id) { return false; }
    ${slice("goodsOffSale")}
    ${slice("goodsStockWord")}
    ${slice("goodsRunsLow")}
    ${slice("goodsMatchesFilter")}
    ${slice("admLowRows")}
    return admLowRows(SUMMARY);
  `) as (o: unknown, levels: unknown, customAll: unknown, list: ClientProduct[]) => {
    n: number; items: Array<{ id: string }>;
  })(o, levels, customAll, list);
  const LIST: ClientProduct[] = [
    { id: "a", brand: "B", name: "Бета", stock: "low" },
    { id: "b", brand: "B", name: "Альфа", stock: "out" },
    { id: "c", brand: "B", name: "Гамма", stock: "in" },
    { id: "c-own", brand: "Acme", name: "Clay", stock: "low", custom: true, active: false },
  ];
  // an older server's answer, with the hidden figures it no longer sends — read by nobody
  const SUMMARY = { lowStock: { total: 7, low: 6, out: 1, hidden: 3, items: [{ id: "x" }], hiddenItems: [{ id: "y" }] } };

  it("with the summary alone, the summary's figures — and nothing about hidden products", () => {
    const r = rows(SUMMARY, null, null, LIST);
    expect(r).toEqual({ n: 7, items: [{ id: "x" }] });
  });

  it("with the shelf and the own products loaded, the chip's own count — sold-out first, the hidden one left out", () => {
    const r = rows(SUMMARY, [], [], LIST);
    expect(r.n).toBe(2);
    expect(r.items.map((i) => i.id)).toEqual(["b", "a"]);
    expect(Object.keys(r).sort()).toEqual(["items", "n"]);
  });

  it("no server at all (the demo panel): the same chip", () => {
    const r = rows(null, null, null, LIST);
    expect(r.n).toBe(2);
    expect(r.items.map((i) => i.id)).not.toContain("c-own");
  });
});

/* ---------- 4. «Каталог»: four chips ------------------------------------------ */

describe("«Каталог»: «Все · В магазине · Скрытые · Кончаются», and no fifth", () => {
  const html = new Function("LIST", "F", `
    var S = { goodsFilter: F, stockLevels: [] };
    function admCatalogList() { return LIST; }
    function admCatalogRows() { return ""; }
    function shopHidden() { return false; }
    ${decl("ADM_GOODS_FILTERS")}
    ${slice("goodsOffSale")}
    ${slice("goodsStockWord")}
    ${slice("goodsRunsLow")}
    ${slice("goodsFilterNow")}
    ${slice("goodsMatchesFilter")}
    ${slice("admCatalogHTML")}
    return admCatalogHTML();
  `) as (list: ClientProduct[], f: string) => string;
  const hiddenLow: ClientProduct = { id: "c-own", brand: "Acme", name: "Clay", stock: "low", custom: true, active: false };
  const hiddenFine: ClientProduct = { id: "c-2", brand: "Acme", name: "Paste", stock: "in", custom: true, active: false };
  const fine: ClientProduct = { id: "a", brand: "B", name: "Бета", stock: "in" };
  const low: ClientProduct = { id: "b", brand: "B", name: "Альфа", stock: "low" };
  const chip = (h: string, key: string) =>
    new RegExp(`data-goodsfilter="${key}" aria-current="(?:true|false)"><span>[^<]+</span> <b class="adm-chip__n">(\\d+)</b>`).exec(h)?.[1];

  it("the «Скрытые · кончаются» chip is gone, its key and its word with it", () => {
    // booleans, not toContain: a failing toContain over app.js prints all of it
    for (const s of ["ADM_GOODS_OFFLOW", '"offlow"', "Скрытые · кончаются"]) expect(src.includes(s), s).toBe(false);
    expect(decl("ADM_GOODS_FILTERS")).toContain('["off", "Скрытые"]');
  });

  it("a hidden product running low: four chips; it counts under «Скрытые», never under «Кончаются»", () => {
    const h = html([hiddenLow, hiddenFine, fine, low], "all");
    expect(h.match(/data-goodsfilter="/g)).toHaveLength(4);
    expect([chip(h, "all"), chip(h, "on"), chip(h, "off"), chip(h, "low")]).toEqual(["4", "2", "2", "1"]);
  });

  it("the three hidden-row strings are out of the dictionaries too", () => {
    for (const s of ["скрытый товар заканчивается", "скрытых товара заканчиваются", "скрытых товаров заканчиваются",
      "сняты с продажи — закажите, если вернёте в магазин"]) {
      expect(src.includes(`"${s}"`), s).toBe(false);
    }
  });
});
