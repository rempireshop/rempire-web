/**
 * «Склад» → «Править» → the reason, in «История приёмок и продаж».
 *
 * Renat on the /test pass of 23.09.2026, item stock-edit: «Reason is not
 * stored.» It is stored — the PUT carries it and the route writes an 'edit'
 * line with it (db/migrations/092_stock_move_edit.sql) — but the history the
 * owner opens to check was fetched ONCE per visit to the panel and never
 * again: loadStockMoves() returned early as soon as it had any list at all.
 * Whoever had opened «История» before — and the checklist opens it twice —
 * saw the old list, without the line he had just written, for as long as the
 * panel stayed open. A web sale made while the panel was open never showed
 * up there either.
 *
 * And the one place that did drop the copy (scanStockChanged — the scanner,
 * a till sale, «Отметить оплаченным») dropped only the list and not the
 * «already asked» mark, so the history then read «Пока пусто» instead.
 *
 * The loader and the handler are cut out of app.js by source text and run
 * against a network the test answers by hand.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

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

/** The click delegate's own `if (…) { … }` block for one data attribute. */
function branch(head: string): string {
  const start = src.indexOf(head);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has «${head}»`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in «${head}»`);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

type Move = { reason: string; ref: string | null };
type Call = { url: string; answer: (moves: Move[]) => void };

function history() {
  const calls: Call[] = [];
  const S: Record<string, unknown> = {
    stockMoves: null, stockMovesErr: "", stockMovesBusy: false, stockMovesOpen: false,
    stockMovesReason: "", stockLevels: [{}],
  };
  const STOCK = { asked: true, seq: 0, movesAsked: false, at: 0 };
  const apiJson = (url: string) =>
    new Promise((resolve) => {
      calls.push({ url, answer: (moves) => resolve({ status: 200, body: { ok: true, moves } }) });
    });
  const helpers = src.includes("function stockMovesOpen(") ? slice("stockMovesOpen") : "";
  const run = new Function(
    "S", "STOCK", "SRV", "apiJson", "reloadStock",
    `var d;
     var STOCK_HIST_LIMIT = 500;   // 1a: the newest lines of the whole ledger, filtered by the chips on screen
     function render() { if (S.stockMovesOpen) loadStockMoves(false); }   // what admStockMovesHTML() does
     ${slice("loadStockMoves")}
     ${slice("scanStockChanged")}
     ${helpers}
     function click(data) { d = data; ${branch("if (d.stockmovesopen !== undefined)")} }
     return { click: click, scanStockChanged: scanStockChanged, loadStockMoves: loadStockMoves };`,
  )(S, STOCK, { admin: true }, apiJson, () => {}) as {
    click: (d: Record<string, string>) => void;
    scanStockChanged: () => void;
    loadStockMoves: (force?: boolean) => void;
  };
  return { S, STOCK, calls, ...run };
}

const old: Move = { reason: "goods_in", ref: "поставка" };
const edit: Move = { reason: "edit", ref: "пересчёт на полке" };

describe("«История приёмок и продаж» shows what was just saved", () => {
  it("opening the history again reads it again — the reason typed a minute ago is in it", async () => {
    const h = history();
    h.click({ stockmovesopen: "1" });          // opened once, earlier in the visit
    expect(h.calls).toHaveLength(1);
    h.calls[0].answer([old]);
    await flush();
    h.click({ stockmovesopen: "" });           // «← Склад»

    // «Править» → the «мало» threshold and a reason → «Сохранить» (the PUT is not the point here)
    h.click({ stockmovesopen: "1" });          // «История приёмок и продаж →» once more
    expect(h.calls.length, "the history was drawn from the copy fetched before the save").toBe(2);
    h.calls[1].answer([edit, old]);
    await flush();
    expect((h.S.stockMoves as Move[]).map((m) => m.ref)).toEqual(["пересчёт на полке", "поставка"]);
  });

  it("the old lines stay on screen while the new answer is on its way — no grey bars", async () => {
    const h = history();
    h.click({ stockmovesopen: "1" });
    h.calls[0].answer([old]);
    await flush();
    h.click({ stockmovesopen: "" });
    h.click({ stockmovesopen: "1" });
    expect(h.S.stockMoves).toEqual([old]);
  });

  it("a stock change elsewhere (scanner, till, a paid order) is re-read, not «Пока пусто»", async () => {
    const h = history();
    h.click({ stockmovesopen: "1" });
    h.calls[0].answer([old]);
    await flush();
    h.scanStockChanged();                       // the copy is dropped…
    h.loadStockMoves(false);                    // …and the open history's next paint asks again
    expect(h.calls.length, "the history stayed empty: dropped, but still marked as asked").toBe(2);
    h.calls[1].answer([edit, old]);
    await flush();
    expect(h.S.stockMoves).toEqual([edit, old]);
  });

  it("a slow answer to an older question never replaces a newer one", async () => {
    const h = history();
    h.click({ stockmovesopen: "1" });
    h.click({ stockmovesopen: "" });
    h.click({ stockmovesopen: "1" });
    expect(h.calls).toHaveLength(2);
    h.calls[1].answer([edit, old]);
    await flush();
    h.calls[0].answer([old]);                   // the first ask, landing last
    await flush();
    expect(h.S.stockMoves).toEqual([edit, old]);
    expect(h.S.stockMovesBusy).toBe(false);
  });

  it("paints of an open history do not ask again and again", async () => {
    const h = history();
    h.click({ stockmovesopen: "1" });
    h.calls[0].answer([old]);
    await flush();
    h.loadStockMoves(false);
    h.loadStockMoves(false);
    expect(h.calls).toHaveLength(1);
  });
});
