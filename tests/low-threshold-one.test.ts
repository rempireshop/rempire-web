/**
 * «мало» only on the LAST unit (Dim, 26.09.2026).
 *
 * On go-live day the real per-size counts come over from Shopify, and the
 * shelf is thin: 65 sizes hold one bottle and 103 hold two. With the old
 * default threshold of 2 all 168 of them would have read «мало» on the first
 * morning — the word would have stopped meaning anything. So the default is
 * now 1: 0 = «нет», 1 = «мало», 2 or more = «в наличии». The threshold stays
 * the owner's to change per size on «Склад» → «Править»; only the DEFAULT
 * moved, and a size whose threshold he set himself keeps it.
 *
 * Every place a fresh size gets its threshold is held here: the column
 * default (db/migrations/215_low_threshold_one.sql), the row move() creates on
 * a first count, the row «Склад» draws for a size with no row yet, the
 * fallback in deriveState(), the panel's own copy of that fallback in
 * public/shop2/app.js, and the two tools that write thresholds or words
 * without the server (tools/seed-stock.mjs, tools/build-catalogue-full.mjs).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variantData from "@/data/catalogue.variants.json";
import { deriveState, getLevel, getLevels, move, setLevel } from "@/lib/inventory";
import { exec, query } from "@/lib/db";
import { setupDb, teardownDb, truncateAll } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const VARIANTS = variantData as Record<string, { sizes: string[]; prices: number[] }>;
/* Two products with no size ladder, so their shelf row is the unlabelled one. */
const plains = CATALOGUE.filter((p) => !VARIANTS[p.id]);
const ONE = plains[0].id;
const TWO = plains[1].id;

const MIGRATION = "215_low_threshold_one.sql";

describe("«мало» only on the last unit — the server", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(truncateAll);

  it("a fresh size counted at 1 reads «мало», counted at 2 reads «в наличии»", async () => {
    await move({ productId: ONE, delta: 1, reason: "goods_in", actor: "test" });
    await move({ productId: TWO, delta: 2, reason: "goods_in", actor: "test" });
    expect(await getLevel(ONE, "")).toMatchObject({ qty: 1, lowThreshold: 1, state: "low" });
    expect(await getLevel(TWO, "")).toMatchObject({ qty: 2, lowThreshold: 1, state: "in" });
  });

  it("a size that only got a barcode takes the column default, 1", async () => {
    const row = await setLevel(ONE, "", { ean: "77778888" });
    expect(row.lowThreshold).toBe(1);
  });

  it("«Склад» draws a size with no row yet at threshold 1", async () => {
    const rows = await getLevels({ q: ONE, filter: "all" });
    const row = rows.find((r) => r.productId === ONE && r.variant === "");
    expect(row, `«Склад» has no row for ${ONE}`).toBeTruthy();
    expect(row!.lowThreshold).toBe(1);
  });

  it("a threshold the owner set himself is kept: 3 still warns at 3", async () => {
    await setLevel(ONE, "", { lowThreshold: 3 });
    await move({ productId: ONE, delta: 3, reason: "goods_in", actor: "test" });
    expect(await getLevel(ONE, "")).toMatchObject({ qty: 3, lowThreshold: 3, state: "low" });
  });

  it("deriveState falls back to 1 when the threshold is missing", () => {
    expect(deriveState(0, NaN)).toBe("out");
    expect(deriveState(1, NaN)).toBe("low");
    expect(deriveState(2, NaN)).toBe("in");
    expect(deriveState(2, -1)).toBe("in");
  });
});

/* The runner skips a file recorded in _migrations, so to replay 215 against
   hand-shaped rows the test forgets that one record and runs setupDb() again —
   what a production database goes through on its next deploy. */
describe(MIGRATION, () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate stock_levels, stock_moves restart identity cascade");
  });

  it("moves every 2 (the only default there ever was) to 1 and leaves every other threshold alone", async () => {
    const seed = [
      [ONE, "", 2],
      [ONE, "50 мл", 3],
      [TWO, "", 0],
      [TWO, "100 мл", 5],
    ] as const;
    for (const [pid, v, low] of seed) {
      await query("insert into stock_levels (product_id, variant, qty, low_threshold) values ($1, $2, 1, $3)", [pid, v, low]);
    }
    await query("delete from _migrations where name = $1", [MIGRATION]);
    const applied = await setupDb();
    expect(applied, "215 did not replay").toContain(MIGRATION);

    const rows = await query<{ product_id: string; variant: string; low_threshold: number }>(
      "select product_id, variant, low_threshold::int as low_threshold from stock_levels order by product_id, variant",
    );
    const by = new Map(rows.map((r) => [r.product_id + "|" + r.variant, r.low_threshold]));
    expect(by.get(ONE + "|")).toBe(1);
    expect(by.get(ONE + "|50 мл")).toBe(3);
    expect(by.get(TWO + "|")).toBe(0);
    expect(by.get(TWO + "|100 мл")).toBe(5);
  });

  it("makes 1 the column default for a row inserted without one", async () => {
    await query("insert into stock_levels (product_id, variant) values ($1, '')", [ONE]);
    const [row] = await query<{ low_threshold: number }>(
      "select low_threshold::int as low_threshold from stock_levels where product_id = $1",
      [ONE],
    );
    expect(row.low_threshold).toBe(1);
  });
});

/* ---- the panel's own copy of the rule (public/shop2/app.js) -------------- */

const app = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(/\r\n?/g, "\n");
function fn(name: string): string {
  const head = app.indexOf(`function ${name}(`);
  if (head < 0) throw new Error(`public/shop2/app.js no longer has function ${name}`);
  let depth = 0;
  for (let i = app.indexOf("{", head); i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}" && --depth === 0) return app.slice(head, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

type Row = { productId: string; variant: string; qty: number; tracked: boolean; lowThreshold?: unknown; state?: string };

function panel(rows: Row[]) {
  const puts: Array<Record<string, unknown>> = [];
  const S: Record<string, unknown> = { stockLevels: rows, stockMoves: [] };
  const body = `
    var STOCK_BURST = {}, STOCK_WHY = {}, STOCK_WHY_USED = {};
    var STOCK = { movesAsked: true };
    var DEMO = { log: [] };
    function demoSave() {}
    function journalStamp() { return ""; }
    function actionText() { return ""; }
    function toast() {}
    function reloadStock() {}
    function stockMoveToastText() { return ""; }
    function stockWhyFor(key) { return STOCK_WHY[key] || ""; }
    function stockWhyDrop() {}
    function stockSaveErrText() { return ""; }
    function stockFindRow(key) {
      var list = S.stockLevels;
      for (var i = 0; i < list.length; i++) if (stockKey(list[i].productId, list[i].variant) === key) return list[i];
      return null;
    }
    function stockLevelSaveDetailed(b) { onPut(b); return Promise.resolve({ ok: true }); }
    ${["stockKey", "stockBurstDelta", "stockShownQty", "stockShownTracked", "stockShownState", "stockLanded", "stockWhySpec"].map(fn).join("\n")}
    return { state: stockShownState, landed: stockLanded, whySpec: stockWhySpec, WHY: STOCK_WHY };
  `;
  const api = new Function("S", "onPut", body)(S, (b: Record<string, unknown>) => puts.push(b)) as {
    state: (r: Row) => string;
    landed: (r: Row, res: unknown, how: Record<string, unknown>) => unknown;
    whySpec: (key: string) => { send: () => Promise<unknown> };
    WHY: Record<string, string>;
  };
  return { ...api, puts };
}

describe("«мало» only on the last unit — the panel", () => {
  it("a row that came without a threshold reads 1 as «мало» and 2 as «в наличии»", () => {
    const p = panel([]);
    const r = (qty: number): Row => ({ productId: "p", variant: "", qty, tracked: true });
    expect(p.state(r(0))).toBe("out");
    expect(p.state(r(1))).toBe("low");
    expect(p.state(r(2))).toBe("in");
  });

  it("a count that lands on a row without a threshold draws its tag by the same rule", () => {
    const p = panel([]);
    const one: Row = { productId: "p", variant: "", qty: 0, tracked: false };
    p.landed(one, { appliedDelta: 1, qtyAfter: 1 }, { type: "stock_set", qty: 1 });
    expect(one.state).toBe("low");
    const two: Row = { productId: "q", variant: "", qty: 0, tracked: false };
    p.landed(two, { appliedDelta: 2, qtyAfter: 2 }, { type: "stock_set", qty: 2 });
    expect(two.state).toBe("in");
  });

  it("a reason sent on its own never writes the old 2 back as the row's threshold", async () => {
    const row: Row = { productId: "p", variant: "", qty: 4, tracked: true };
    const p = panel([row]);
    p.WHY["p "] = "пересчёт полки";
    await p.whySpec("p ").send();
    expect(p.puts).toEqual([{ productId: "p", variant: "", lowThreshold: 1, ref: "пересчёт полки" }]);
  });

  it("a row whose owner set 3 keeps warning at 3", () => {
    const p = panel([]);
    expect(p.state({ productId: "p", variant: "", qty: 3, tracked: true, lowThreshold: 3 })).toBe("low");
    expect(p.state({ productId: "p", variant: "", qty: 4, tracked: true, lowThreshold: 3 })).toBe("in");
  });
});

/* ---- the tools that write a threshold or a word without the server ------- */

describe("«мало» only on the last unit — the tools", () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

  it("tools/seed-stock.mjs seeds a new row at threshold 1", () => {
    const src = read("../tools/seed-stock.mjs");
    expect(src).toMatch(/values \(\$1, \$2, 0, 1, \$3, now\(\)\)/);
    expect(src).not.toMatch(/values \(\$1, \$2, 0, 2, \$3, now\(\)\)/);
  });

  it("tools/build-catalogue-full.mjs words a product 0 out / 1 low / 2+ in", () => {
    const src = read("../tools/build-catalogue-full.mjs");
    const rules = src.match(/<= 0 \? "out" : \w+ <= (\d+) \? "low" : "in"/g) ?? [];
    expect(rules.length, "the catalogue build no longer has its stock rule where this test looks").toBe(2);
    for (const r of rules) expect(r).toMatch(/<= 1 \? "low"/);
  });
});
