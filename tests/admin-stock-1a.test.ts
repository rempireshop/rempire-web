/**
 * Direction 1a — «Склад» (README § 5; Dim, 25.09.2026, q24–q26, q41).
 *
 *   · a burst of − / + taps is ONE move, sent STOCK_BURST_MS after the last
 *     tap: one ledger line, one journal entry, one «Вернуть» (q25) — and a «+»
 *     taken back with «−» before it went sends nothing at all, so nobody on
 *     the back-in-stock list is written to for a slip of the thumb;
 *   · «Причина» rides with the row's next change as its `ref`;
 *   · a code another bottle holds is refused UNDER the box, in the route's
 *     words, and the header neither says «Сохранено ✓» nor «проверьте
 *     интернет» (admAutosaveDone's `refused`);
 *   · the list is grouped by product, the most urgent product first, a
 *     product taken off sale last — and that order holds while the owner
 *     stays on the list (q24);
 *   · «История склада» has six chips counted over the lines already loaded,
 *     and «Списание» as a seventh only once there is one (q26, q41).
 *
 * The real functions are cut out of public/shop2/app.js by source text and run
 * over stubs; the timers are vitest's fake ones.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
function decl(name: string): string {
  const m = new RegExp(`^  var ${name} = .*;$`, "m").exec(app);
  if (!m) throw new Error(`public/shop2/app.js no longer declares ${name} on one line`);
  return m[0].trim();
}
/** `var NAME = [ … ];` over several lines. */
function block(name: string): string {
  const head = app.indexOf(`  var ${name} = `);
  if (head < 0) throw new Error(`public/shop2/app.js no longer declares ${name}`);
  const open = app.slice(head).search(/[[{]/) + head;
  const close = app[open] === "[" ? "]" : "}";
  let depth = 0;
  for (let i = open; i < app.length; i++) {
    if (app[i] === app[open]) depth++;
    else if (app[i] === close && --depth === 0) return app.slice(head, i + 1) + ";";
  }
  throw new Error(`unterminated ${name}`);
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

type Row = { productId: string; variant: string; brand: string; name: string; qty: number; tracked: boolean;
  lowThreshold: number; ean: string | null; state?: string; offSale?: boolean };
type Move = Record<string, unknown>;

const AUTOSAVE = [
  "admAutosavePolicy", "admAutosaveSpec", "admAutosave", "admAutosaveSend", "admAutosaveOk", "admAutosaveDone",
  "admSaveFailedN", "admAutosaveFlush", "admSaveBegin", "admSaveEnd", "admSaveSet",
];
const STOCK = [
  "stockKey", "stockFindRow", "stockBurstDelta", "stockShownQty", "stockShownTracked", "stockShownState",
  "stockMoveToastText", "stockWhyFor", "stockWhyUse", "stockWhyDrop", "stockBurstSpec", "stockBurstTap",
  "stockBurstSend", "stockLanded", "stockEanNorm", "stockEanProblem", "stockEanCommit", "stockQtyValue",
];

function shelf(rows: Row[], answer: (m: Move) => unknown = (m) => ({ appliedDelta: m.delta, qtyAfter: 0 })) {
  const moves: Move[] = [];
  const puts: Move[] = [];
  const toasts: Array<{ msg: string; undo: unknown }> = [];
  const marks: Array<[string, string]> = [];
  const log: unknown[] = [];
  const S: Record<string, unknown> = { lang: "RU", screen: "admin", stockLevels: rows, stockMoves: [], stockEdit: "" };
  let putAnswer: Record<string, unknown> = { ok: true };
  const body = `
    ${decl("ADM_SAVE_POLICY")}
    ${decl("ADM_SAVE_IDLE_MS")}
    ${decl("ADM_SAVE_SHOWN_MS")}
    ${decl("STOCK_BURST_MS")}
    var ADM_AS = {}, ADM_AS_SPEC = {}, ADM_TYPED = {};
    var ADM_SAVE = { state: "idle", busy: 0, fade: 0, refused: false };
    var STOCK_BURST = {}, STOCK_WHY = {}, STOCK_WHY_USED = {};
    var STOCK = { movesAsked: true };
    var STOCK_SAVE_ERRS = { bad_ean: "BAD_EAN" };
    var DEMO = { log: LOG };
    function demoSave() {}
    function journalStamp() { return "25.09 12:00"; }
    function actionText(a) { return a.type + ":" + (a.delta != null ? a.delta : a.value); }
    function admProdName(s) { return s; }
    function admSavePaint() {}
    function admAutosaveMark(k, h) { onMark(k, h); }
    function toast(m, u) { onToast(m, u); }
    function render() {}
    function reloadStock() {}
    function scanStockChanged() {}
    function stockMoveFailText(f) { return f; }
    function stockSaveErrText(res) { return res.error === "ean_taken" ? "TAKEN BY " + res.takenBy : ""; }
    function stockMoveSend(b) { onMove(b); return Promise.resolve(ANSWER(b)); }
    function stockLevelSaveDetailed(b) { onPut(b); return Promise.resolve(PUT()); }
    ${AUTOSAVE.map(fn).join("\n")}
    ${STOCK.map(fn).join("\n")}
    return { tap: stockBurstTap, ean: stockEanCommit, why: STOCK_WHY, flush: admAutosaveFlush, SAVE: ADM_SAVE,
      shown: stockShownQty, state: stockShownState, AS: ADM_AS };
  `;
  const api = new Function("S", "LOG", "onMove", "onPut", "onToast", "onMark", "ANSWER", "PUT", body)(
    S, log, (m: Move) => moves.push(m), (m: Move) => puts.push(m),
    (msg: string, undo: unknown) => toasts.push({ msg, undo }), (k: string, h: string) => marks.push([k, h]),
    answer, () => putAnswer,
  ) as {
    tap: (key: string, d: number) => boolean;
    ean: (key: string, raw: string, how: string) => Promise<unknown>;
    why: Record<string, string>;
    flush: () => number;
    SAVE: { state: string; busy: number; refused: boolean };
    shown: (r: Row) => number;
    state: (r: Row) => string;
    AS: Record<string, { err: string; failed: boolean }>;
  };
  return { ...api, S, moves, puts, toasts, marks, log, setPut: (a: Record<string, unknown>) => { putAnswer = a; } };
}

const row = (over: Partial<Row> = {}): Row => Object.assign({
  productId: "shampoo", variant: "250 мл", brand: "System 4", name: "Bio Botanical Shampoo",
  qty: 3, tracked: true, lowThreshold: 2, ean: null, state: "in",
}, over);
const KEY = "shampoo 250 мл";

describe("«Склад»: a burst of taps is one move (q25)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("three «+» send ONE move of +3 after the pause — one journal line, one «Вернуть»", async () => {
    const r = row();
    const s = shelf([r], (m) => ({ appliedDelta: m.delta, qtyAfter: 3 + Number(m.delta) }));
    s.tap(KEY, 1); s.tap(KEY, 1); s.tap(KEY, 1);
    expect(s.shown(r), "the row shows the taps at once").toBe(6);
    expect(s.moves, "a move went before the burst was over").toHaveLength(0);
    vi.advanceTimersByTime(799);
    expect(s.moves).toHaveLength(0);
    vi.advanceTimersByTime(1);
    await flush();
    expect(s.moves).toEqual([{ productId: "shampoo", variant: "250 мл", delta: 3, reason: "adjust", ref: "панель" }]);
    expect(s.log, "one journal line per burst").toHaveLength(1);
    expect(s.toasts).toHaveLength(1);
    expect(s.toasts[0].msg).toBe("Bio Botanical Shampoo 250 мл: 3 → 6");
    // «Вернуть» is the opposite of what the shelf really took
    expect((s.toasts[0].undo as { prev: Move }).prev).toMatchObject({ type: "stock_adjust", delta: -3 });
    expect(s.SAVE.state).toBe("saved");
    expect(s.shown(r)).toBe(6);
  });

  it("«+» taken back with «−» before it went sends nothing — no line, no letter to the waiting list", async () => {
    const r = row({ qty: 0, state: "out" });
    const s = shelf([r]);
    s.tap(KEY, 1); s.tap(KEY, -1);
    vi.advanceTimersByTime(900);
    await flush();
    expect(s.moves).toEqual([]);
    expect(s.log).toEqual([]);
    expect(s.shown(r)).toBe(0);
  });

  it("the typed «Причина» rides with the burst as its ref, once", async () => {
    const r = row();
    const s = shelf([r]);
    s.why[KEY] = "пересчёт на полке";
    s.tap(KEY, -1);
    vi.advanceTimersByTime(800);
    await flush();
    expect(s.moves[0]).toMatchObject({ delta: -1, ref: "пересчёт на полке" });
  });

  it("«−» on an empty shelf does nothing at all", () => {
    const s = shelf([row({ qty: 0, state: "out" })]);
    expect(s.tap(KEY, -1)).toBe(false);
  });

  it("leaving the screen sends the burst at once — it does not wait for the pause", async () => {
    const s = shelf([row()]);
    s.tap(KEY, 1); s.tap(KEY, 1);
    s.flush();                                   // Back, the nav, the page going away
    await flush();
    expect(s.moves).toHaveLength(1);
    expect(s.moves[0]).toMatchObject({ delta: 2 });
    vi.advanceTimersByTime(1000);
    await flush();
    expect(s.moves, "the timer sent the same burst a second time").toHaveLength(1);
  });

  it("the tag follows the shown count against the row's OWN «мало ≤»", () => {
    const r = row({ qty: 5, lowThreshold: 5 });
    const s = shelf([r]);
    expect(s.state(r)).toBe("low");
    s.tap(KEY, 1);
    expect(s.state(r)).toBe("in");
    expect(s.state(row({ productId: "other", tracked: false, qty: 0 }))).toBe("none");
  });
});

describe("«Склад»: the barcode box — a refusal is explained under the box, not as «проверьте интернет»", () => {
  it("a code another bottle holds: the route's words, no «Сохранено ✓», nothing owed", async () => {
    const r = row();
    const s = shelf([r]);
    s.setPut({ ok: false, error: "ean_taken", takenBy: "Proraso — Azur Lime" });
    const answer = await s.ean(KEY, "4750323781389", "typed");
    expect(answer).toEqual({ refused: "TAKEN BY Proraso — Azur Lime" });
    expect(r.ean, "the row claimed a code it was refused").toBeNull();
  });

  it("own codes like RMP-0042 are codes; «abc» and a 5-digit number are not", () => {
    const s = shelf([row()]);
    const body = `${fn("stockEanNorm")}\n${fn("stockEanProblem")}\nvar STOCK_SAVE_ERRS = { bad_ean: "BAD" };\nreturn stockEanProblem;`;
    const problem = new Function(body)() as (v: string) => string;
    expect(problem("RMP-0042")).toBe("");
    expect(problem("rmp-0042")).toBe("");
    expect(problem("4750323781389")).toBe("");
    expect(problem("")).toBe("");            // emptying the box unbinds
    expect(problem("abc")).toBe("BAD");
    expect(problem("12345")).toBe("BAD");
    expect(s.moves).toEqual([]);
  });

  it("a code bound: the size keeps it, and «Вернуть» puts the old one back", async () => {
    const r = row({ ean: "1111111111116" });
    const s = shelf([r]);
    expect(await s.ean(KEY, " rmp-0042 ", "typed")).toBe(true);
    expect(s.puts).toEqual([{ productId: "shampoo", variant: "250 мл", ean: "RMP-0042" }]);
    expect(r.ean).toBe("RMP-0042");
    expect(s.toasts[0].msg).toBe("Код привязан ✓");
    expect((s.toasts[0].undo as { prev: Move }).prev).toEqual({ type: "stock_ean", product_id: "shampoo", variant: "250 мл", value: "1111111111116" });
  });

  it("the scheduler: a `refused` answer leaves the header quiet and the words under the box", async () => {
    const body = `
      ${decl("ADM_SAVE_POLICY")}
      ${decl("ADM_SAVE_IDLE_MS")}
      ${decl("ADM_SAVE_SHOWN_MS")}
      var ADM_AS = {}, ADM_AS_SPEC = {};
      var ADM_SAVE = { state: "idle", busy: 0, fade: 0, refused: false };
      var SRV = { admin: true }, S = {};
      function admSavePaint() {}
      function admAutosaveMark(k, h) { MARKS.push([k, h]); }
      function toast() {}
      function render() {}
      ${AUTOSAVE.map(fn).join("\n")}
      return { save: admAutosave, SAVE: ADM_SAVE, AS: ADM_AS };
    `;
    const marks: Array<[string, string]> = [];
    const p = new Function("MARKS", body)(marks) as {
      save: (k: string, v: unknown, ev: string, spec: unknown) => boolean; SAVE: { state: string }; AS: Record<string, { failed: boolean; dirty: boolean }>;
    };
    const spec = { kind: "code", send: () => Promise.resolve({ refused: "Этот штрихкод уже привязан к другому товару." }) };
    p.save("stockean:k", "4750323781389", "input", spec);
    p.save("stockean:k", undefined, "blur", spec);
    await flush();
    /* neither «Сохранено ✓» nor «проверьте интернет»: the rust «Не сохранено —
       проверьте поле» (integration 25.09.2026 — a refused box is not saved, and
       the header says so while the box stands on the page; here there is no
       page, so the box counts as shown) */
    expect(p.SAVE.state, "a refusal is neither «Сохранено ✓» nor «проверьте интернет»").toBe("invalid");
    expect(p.AS["stockean:k"].failed).toBe(false);
    expect(p.AS["stockean:k"].dirty).toBe(false);
    expect(marks.at(-1)).toEqual(["stockean:k", "Этот штрихкод уже привязан к другому товару."]);
  });
});

describe("«Склад»: grouped by product, the most urgent first (q24)", () => {
  function groups(rows: Row[], S: Record<string, unknown> = {}) {
    const body = `
      var S = Object.assign({ stockLevels: ROWS, stockFilter: "all", stockQ: "" }, STATE);
      var STOCK = { epoch: 0, rank: null, rankFor: "" };
      function shopHidden() { return false; }
      ${fn("scanFold")}
      ${fn("stockKey")}
      ${fn("stockGroupOff")}
      ${fn("stockGroups")}
      return { run: function () { return stockGroups(S.stockLevels).map(function (g) { return g.id + ":" + g.rows.map(function (r) { return r.variant; }).join(","); }); }, S: S, STOCK: STOCK };
    `;
    return new Function("ROWS", "STATE", body)(rows, S) as { run: () => string[]; S: Record<string, unknown>; STOCK: { epoch: number } };
  }
  const list = [
    row({ productId: "a", variant: "75 мл", qty: 9 }), row({ productId: "a", variant: "250 мл", qty: 7 }),
    row({ productId: "b", variant: "50 мл", qty: 4 }), row({ productId: "b", variant: "150 мл", qty: 0 }),
    row({ productId: "c", variant: "", qty: 0, offSale: true }),
    row({ productId: "d", variant: "40 мл", tracked: false, qty: 0 }),
  ];

  it("the product with the emptiest size comes first, sizes in the ladder's order; off sale last", () => {
    expect(groups(list).run()).toEqual(["b:50 мл,150 мл", "a:75 мл,250 мл", "d:40 мл", "c:"]);
  });

  it("the order holds while the owner stays — a count raised under his thumb does not jump the product away", () => {
    const g = groups(list);
    expect(g.run()[0]).toBe("b:50 мл,150 мл");
    (g.S.stockLevels as Row[])[2].qty = 20;      // «b» filled up by two bursts
    (g.S.stockLevels as Row[])[3].qty = 12;
    expect(g.run()[0], "the product jumped while he was on it").toBe("b:50 мл,150 мл");
    g.STOCK.epoch++;                              // he comes back to «Склад»
    expect(g.run()[0]).toBe("a:75 мл,250 мл");
  });
});

describe("«История склада»: six chips, and «Списание» once there is one (q26, q41)", () => {
  function hist(moves: Move[], reason = "") {
    const body = `
      var S = { stockMoves: MOVES, stockMovesReason: REASON, stockMovesErr: "", stockMovesBusy: false };
      ${block("STOCK_MOVE_WORD")}
      ${block("STOCK_HIST_CHIPS")}
      function esc(s) { return String(s); }
      function loadStockMoves() {}
      function admProdName(s) { return s; }
      function admBackHTML() { return ""; }
      function auditWhen(s) { return s; }
      ${fn("stockHistMatch")}
      ${fn("stockHistRowHTML")}
      ${fn("admStockMovesHTML")}
      return admStockMovesHTML();
    `;
    return new Function("MOVES", "REASON", body)(moves, reason) as string;
  }
  const m = (reason: string, delta: number): Move => ({ at: "t", productId: "p", brand: "B", name: "N", variant: "", delta, reason, ref: "" });
  const ledger = [m("goods_in", 5), m("sale_web", -1), m("sale_pos", -1), m("adjust", 2), m("return", 1), m("edit", 0)];

  it("counts every chip over the lines on screen — «Продажи» is the web and the salon together", () => {
    const html = hist(ledger);
    const chips = (html.match(/data-stockmovesreason="[^"]*"[^>]*>[^<]*</g) || []).map((c) => c.replace(/^.*>/, "").replace(/<$/, ""));
    expect(chips).toEqual(["Все 6", "Приход 1", "Продажи 2", "Вручную 1", "Возврат 1", "Правка карточки 1"]);
  });

  it("«Списание» is a chip only once the ledger has one — or while it is the chip picked", () => {
    expect(hist(ledger)).not.toContain('data-stockmovesreason="writeoff"');
    expect(hist(ledger.concat(m("writeoff", -2)))).toContain('data-stockmovesreason="writeoff"');
    expect(hist(ledger, "writeoff")).toContain('data-stockmovesreason="writeoff"');
  });

  it("a chip filters the list it counts, and a write-off reads «списание»", () => {
    const html = hist(ledger.concat(m("writeoff", -2)), "writeoff");
    expect(html.match(/class="adm-row adm-hrow"/g)).toHaveLength(1);
    expect(html).toContain("списание");
    const sales = hist(ledger, "sale");
    expect(sales.match(/class="adm-row adm-hrow"/g)).toHaveLength(2);
  });
});

describe("the scanner's «Списать» is a write-off, and the scanner goes back to the camera (q41, 1a)", () => {
  function commit(sign: number, result: Record<string, unknown>) {
    const body = `
      var out = { sent: null, landed: null, toasts: [] };
      var S = { scanBusy: false, scanQty: 2, scanReady: false,
                scanHit: { product: { id: "p", name: "Shampoo" }, productId: "p", variant: "250 мл", code: "4750323781389", tracked: true, qty: 9 } };
      var SCAN = { lastCode: "", lastAt: 0 };
      var SCANEL = null;
      ${decl("SCAN_SAME_AFTER_MOVE_MS")}
      function stockMoveSend(b) { out.sent = b; return Promise.resolve(RESULT); }
      function stockMoveFailText(f) { return f; }
      function scanRenderPanel() {}
      function toast(m) { out.toasts.push(m); }
      function scanStockChanged() {}
      function stockFindRow() { return null; }
      function stockKey(p, v) { return p + " " + v; }
      function stockLanded(row, res, how) { out.landed = how; }
      ${fn("scanQtyNow")}
      ${fn("scanMoveToast")}
      ${fn("scanCommitMove")}
      scanCommitMove(SIGN);
      return Promise.resolve().then(function () {}).then(function () {}).then(function () { out.S = S; out.SCAN = SCAN; return out; });
    `;
    return new Function("SIGN", "RESULT", body)(sign, result) as Promise<{
      sent: Record<string, unknown>; landed: Record<string, unknown> | null; toasts: string[];
      S: Record<string, unknown>; SCAN: { lastCode: string; lastAt: number };
    }>;
  }

  it("«Списать −2» goes as 'writeoff' — not as a salon sale — and its toast says what is left", async () => {
    const out = await commit(-1, { appliedDelta: -2, qtyAfter: 7 });
    expect(out.sent).toMatchObject({ productId: "p", variant: "250 мл", delta: -2, reason: "writeoff", ref: "сканер" });
    expect(out.landed).toMatchObject({ reason: "writeoff", toast: "Списано −2 · теперь 7 шт" });
  });

  it("«Принять +2» is goods in", async () => {
    const out = await commit(1, { appliedDelta: 2, qtyAfter: 11 });
    expect(out.sent).toMatchObject({ delta: 2, reason: "goods_in" });
    expect(out.landed).toMatchObject({ toast: "Принято +2 · теперь 11 шт" });
  });

  it("after a move the card goes and the camera is back; the same bottle waits its turn", async () => {
    const out = await commit(1, { appliedDelta: 2, qtyAfter: 11 });
    expect(out.S.scanHit).toBeNull();
    expect(out.S.scanReady).toBe(true);
    expect(out.S.scanQty).toBe(1);
    expect(out.SCAN.lastCode).toBe("4750323781389");
    expect(out.SCAN.lastAt).toBeGreaterThan(Date.now());
  });

  it("a move that moved nothing is not journalled — it only says so", async () => {
    const out = await commit(-1, { appliedDelta: 0, skipped: true });
    expect(out.landed).toBeNull();
    expect(out.toasts).toEqual(["Этот объём ещё не считали — впишите остаток на «Складе»."]);
  });
});
