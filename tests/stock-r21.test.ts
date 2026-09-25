/**
 * The shelf, the scanner and the till — the medium findings of the 14.09.2026
 * audit, pinned so a later tidy-up cannot put any of them back.
 *
 * Same technique as tests/inventory-scanner.test.ts and
 * tests/shop-lost-answer.test.ts: the functions are sliced out of
 * public/shop2/app.js **by source text** and run against stubs, so this tests
 * the shop's own code and not a retyped copy that could drift away from it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

/** …and `var <NAME> = { … };` spanning as many lines as it likes. */
function objectConst(name: string): string {
  const start = src.indexOf(`var ${name} = {`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer declares ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1) + ";";
  }
  throw new Error(`unbalanced braces around ${name} in app.js`);
}

/* ------------------------------------------------------------------------ *
 * «Склад»: the count typed into the row — the first count may be zero
 * (1a: the number between − and + saves itself on blur / Enter; it was the
 * «Остаток сейчас» box of «Править» → «Сохранить»)
 * ------------------------------------------------------------------------ */

type CommitOut = { landed: number; sent: unknown[]; answer: unknown };

/** Runs the real stockQtyCommit() against one shelf row and reports what it sent. */
async function commit(row: Record<string, unknown>, typed: string): Promise<CommitOut> {
  const body = `
    var out = { landed: 0, sent: [], answer: null };
    var STOCK_BURST = {}, STOCK_WHY = {}, STOCK_WHY_USED = {};
    function stockFindRow() { return ROW; }
    function stockMoveSend(b) { out.sent.push(b); return Promise.resolve({ appliedDelta: 0, qtyAfter: b.qty }); }
    function stockMoveFailText(f) { return f; }
    function toast() {}
    function stockLanded() { out.landed++; }
    ${slice("stockKey")}
    ${slice("stockBurstDelta")}
    ${slice("stockShownQty")}
    ${slice("stockShownTracked")}
    ${slice("stockQtyValue")}
    ${slice("stockWhyFor")}
    ${slice("stockWhyUse")}
    ${slice("stockWhyDrop")}
    ${slice("stockQtyCommit")}
    return stockQtyCommit("p ", TYPED).then(function (a) { out.answer = a; return out; });
  `;
  const fn = new Function("ROW", "TYPED", body) as (r: unknown, t: string) => Promise<CommitOut>;
  return fn(row, typed);
}

const untracked = { productId: "p", variant: "", ean: "", lowThreshold: 2, tracked: false, qty: 0 };
const tracked = { productId: "p", variant: "", ean: "", lowThreshold: 2, tracked: true, qty: 0 };

describe("a shelf counted as empty can be recorded as 0", () => {
  /* A row nobody has counted has no quantity at all — «не учтено», not «0» —
     so comparing it against 0 made «шкаф пустой» the one count the panel
     refused to take. The size stayed untracked, and the shop went on
     advertising the product from the manual override. */
  it("0 typed on an untracked row is the first count, not «nothing to save»", async () => {
    const out = await commit(untracked, "0");
    expect(out.answer).toBe(true);
    expect(out.landed).toBe(1);
    expect(out.sent).toEqual([{ productId: "p", variant: "", qty: 0, reason: "adjust", ref: "панель" }]);
  });

  it("…and a number still reaches the shelf as an absolute count", async () => {
    const out = await commit(untracked, "4");
    expect(out.sent).toEqual([{ productId: "p", variant: "", qty: 4, reason: "adjust", ref: "панель" }]);
  });

  /* The other half of the same rule: a row that IS counted and already stands
     at the typed number has not changed, and must not cost a ledger line. */
  it("a counted row already at 0 sends nothing — and the autosave hears «done», not «failed»", async () => {
    const out = await commit(tracked, "0");
    expect(out.sent).toEqual([]);
    expect(out.landed).toBe(0);
    expect(out.answer).toBe(true);
  });

  it("«abc» and «-1» are not counts: nothing is sent (the box is refused before the trip)", async () => {
    expect((await commit(tracked, "abc")).sent).toEqual([]);
    expect((await commit(tracked, "-1")).sent).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ *
 * The scanner card says «не учтено» when the bottle has never been counted
 * ------------------------------------------------------------------------ */

type Hit = { tracked?: boolean; qty?: number } | null;

/** Runs the real scanLookup() against one answer from the lookup route. */
async function lookup(hit: Record<string, unknown> | null): Promise<Hit> {
  const body = `
    var S = { scanHit: null, scanAssignQ: "x", scanAssignPick: "x", scanBindConfirm: "x" };
    var SRV = { admin: true };
    function apiJson() { return Promise.resolve({ status: 200, body: { ok: true, hit: HIT } }); }
    function scanLookupFailed() {}
    function scanBeep() {}
    function loadScanToday() {}
    function scanRenderPanel() {}
    function closeScanner() {}
    function render() {}
    ${slice("scanLookup")}
    scanLookup("4006381333931");
    return Promise.resolve().then(function () {}).then(function () { return S.scanHit; });
  `;
  const fn = new Function("HIT", body) as (h: unknown) => Promise<Hit>;
  return fn(hit);
}

describe("a bound but never-counted bottle is «не учтено», not «на складе 0»", () => {
  const base = { productId: "p", variant: "", qty: 0, lowThreshold: 2, ean: "4006381333931", state: "out", product: { id: "p" } };

  /* The card's «не учтено» branch was dead: the panel stored a literal
     `tracked: true` for every hit, so a barcode bound to a bottle nobody has
     counted read as an empty shelf. */
  it("keeps the route's answer when the size has never been counted", async () => {
    expect((await lookup({ ...base, tracked: false }))?.tracked).toBe(false);
  });

  it("…and when it has", async () => {
    expect((await lookup({ ...base, tracked: true, qty: 6, state: "in" }))?.tracked).toBe(true);
  });

  /* An older deployment whose route does not send the field at all must not
     start calling every counted bottle «не учтено». */
  it("treats a missing field as counted, as before", async () => {
    expect((await lookup({ ...base, qty: 6, state: "in" }))?.tracked).toBe(true);
  });
});

/* ------------------------------------------------------------------------ *
 * The scanner's confirm says what the shelf actually did
 * ------------------------------------------------------------------------ */

type MoveResult = { appliedDelta?: number; clampedNegative?: boolean; skipped?: boolean };

/** Runs the real scanCommitMove() against one server answer. */
async function scanCommit(sign: number, qty: number, result: MoveResult | null): Promise<string[]> {
  const body = `
    var out = [];
    var S = { scanBusy: false, scanQty: QTY, scanReady: false,
              scanHit: { product: { id: "p" }, productId: "p", variant: "", code: "123", tracked: true } };
    var SCAN = { lastCode: "123" };
    var SCANEL = null;
    ${constant("SCAN_SAME_AFTER_MOVE_MS")}
    function stockMoveSend() { return Promise.resolve(RESULT); }
    function stockMoveFailText(f) { return f; }
    function scanRenderPanel() {}
    function toast(m) { out.push(m); }
    function scanLookup() {}
    function scanStockChanged() {}
    function stockFindRow() { return null; }
    function stockKey(p, v) { return p + " " + v; }
    // 1a: a move that happened is journalled with «Вернуть» — its toast is the same sentence
    function stockLanded(row, res, how) { out.push(how.toast); }
    ${slice("scanQtyNow")}
    ${slice("scanMoveToast")}
    ${slice("scanCommitMove")}
    scanCommitMove(SIGN);
    return Promise.resolve().then(function () {}).then(function () {}).then(function () { return out; });
  `;
  const fn = new Function("SIGN", "QTY", "RESULT", body) as (s: number, q: number, r: unknown) => Promise<string[]>;
  return fn(sign, qty, result);
}

describe("the scanner's confirm never claims a move that did not happen", () => {
  it("a plain write-off still says how many left", async () => {
    expect(await scanCommit(-1, 3, { appliedDelta: -3, clampedNegative: false })).toEqual(["Списание −3 ✓"]);
  });

  it("goods in still say how many arrived", async () => {
    expect(await scanCommit(1, 2, { appliedDelta: 2, clampedNegative: false })).toEqual(["Приход +2 ✓"]);
  });

  /* move() clamps at zero rather than leaving the row negative, and reports
     what it really applied. The toast used to print the number that was ASKED
     for, so a −5 against a shelf holding 2 read «Списание −5 ✓». */
  it("a write-off clamped at zero reports the number that actually left", async () => {
    expect(await scanCommit(-1, 5, { appliedDelta: -2, clampedNegative: true })).toEqual(["Списание −2 ✓"]);
  });

  it("…and one clamped to nothing at all says so", async () => {
    expect(await scanCommit(-1, 5, { appliedDelta: 0, clampedNegative: true })).toEqual([
      "На складе уже 0 — списывать нечего.",
    ]);
  });

  /* «Списать» writes a 'writeoff' move ('sale_pos' until 25.09.2026), and like
     a sale it is skipped on a size nobody has counted — nothing is written and no
     ledger line appears. The route still answers ok, so the old toast said
     «Списание −2 ✓» over a shelf that had not moved. */
  it("a write-off on a size nobody has counted says it was not counted", async () => {
    expect(await scanCommit(-1, 2, { appliedDelta: 0, skipped: true })).toEqual([
      "Этот объём ещё не считали — впишите остаток на «Складе».",
    ]);
  });

  it("a refusal is still a refusal", async () => {
    expect(await scanCommit(-1, 2, null)).toEqual(["Не удалось сохранить"]);
  });
});

/* ------------------------------------------------------------------------ *
 * The shelf's clock is the one the owner is standing in
 * ------------------------------------------------------------------------ */

describe("the stock history is read on the shop's clock, not on UTC", () => {
  /* The ledger row printed the first sixteen characters of the ISO stamp, so
     a scan made at 22:40 in Tallinn read «19:40» — and one after midnight
     read under the previous day. */
  it("the history row formats the move's instant in the reader's browser", () => {
    const at = "2026-07-15T19:40:00.000Z";
    const body = `
      var S = { stockMoves: [{ at: AT, productId: "p", brand: "A", name: "B", variant: "", delta: -2, reason: "sale_pos", ref: "сканер" }],
                stockMovesReason: "", stockMovesErr: "", stockMovesBusy: false };
      var STOCK_MOVE_WORD = { sale_pos: "Продажа в салоне" };
      var STOCK_HIST_CHIPS = [["", "Все"]];
      function esc(s) { return String(s); }
      function loadStockMoves() {}
      function admProdName(s) { return String(s); }
      function admBackHTML() { return ""; }
      ${slice("auditWhen")}
      ${slice("stockHistMatch")}
      ${slice("stockHistRowHTML")}
      ${slice("admStockMovesHTML")}
      return admStockMovesHTML();
    `;
    const html = (new Function("AT", body) as (a: string) => string)(at);
    // 22:40 in Tallinn, 19:40 in UTC — whichever zone this machine is in, the
    // row must read the same as every other timestamp the panel prints
    const expected = new Date(at).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
    expect(html).toContain(expected);
    expect(html).not.toContain("2026-07-15 19:40");
  });

  /* «Сегодня» under the scanner asked the route for everything since UTC
     midnight, so an evening scan fell into tomorrow's list and a Tallinn
     morning still showed yesterday's. */
  it("«Сегодня» starts at midnight where the owner is standing", () => {
    const body = `
      var sinceSeen = "";
      function apiJson(url) { sinceSeen = decodeURIComponent(String(url).split("since=")[1] || ""); return { then: function () { return { catch: function () {} }; } }; }
      function noop() {}
      var SRV = { admin: true }, S = {};
      function scanRenderPanel() {}
      ${slice("loadScanToday")}
      loadScanToday();
      return sinceSeen;
    `;
    // pinned to a zone that is NOT UTC, or the two midnights would coincide
    // and the test would pass over the bug on a UTC build machine
    const wasTz = process.env.TZ;
    process.env.TZ = "Europe/Tallinn";
    try {
      const since = new Date((new Function(body) as () => string)());
      const local = new Date();
      local.setHours(0, 0, 0, 0);
      const utc = new Date();
      utc.setUTCHours(0, 0, 0, 0);
      expect(local.getTime()).not.toBe(utc.getTime());
      expect(since.getTime()).toBe(local.getTime());
    } finally {
      if (wasTz === undefined) delete process.env.TZ;
      else process.env.TZ = wasTz;
    }
  });
});

/* ------------------------------------------------------------------------ *
 * The register never puts a product it cannot name in the basket
 * ------------------------------------------------------------------------ */

type Cart = { cart: Array<{ id: string }>; toasts: string[] };

/** Runs a real door into S.posCart with a catalogue of exactly two products. */
function intoCart(door: "chip" | "scan", id: string): Cart {
  const body = `
    var out = { toasts: [] };
    var CATALOGUE = [{ id: "first", brand: "A", name: "First", price: 10, sizes: [] },
                     { id: "shelved", brand: "B", name: "Second", price: 20, sizes: [] }];
    var S = { posCart: [], posQ: "", scanQty: 1,
              scanHit: { product: { id: ID }, productId: ID, variant: "", code: "123" } };
    var SCANEL = null;
    function toast(m) { out.toasts.push(m); }
    function render() {}
    function closeScanner() {}
    function edStockFor() { return null; }
    ${slice("byId")}
    ${slice("byIdOrNull")}
    ${slice("scanQtyNow")}
    ${constant("POS_GONE")}
    ${slice("posAddProduct")}
    ${slice("scanToCart")}
    if (DOOR === "chip") posAddProduct(ID); else scanToCart();
    out.cart = S.posCart;
    return out;
  `;
  const fn = new Function("DOOR", "ID", body) as (d: string, i: string) => Cart;
  return fn(door, id);
}

describe("a product the shop is not offering cannot reach the till", () => {
  it("a chip still adds a product the shop carries", () => {
    expect(intoCart("chip", "shelved").cart).toEqual([{ id: "shelved", variant: "", qty: 1 }]);
  });

  it("the scanner still adds a product the shop carries", () => {
    expect(intoCart("scan", "shelved").cart).toEqual([{ id: "shelved", variant: "", qty: 1 }]);
  });

  /* byId() answers CATALOGUE[0] for an id the shop does not carry, so a bottle
     switched off «Показывать в магазине» put the FIRST catalogue product's
     name and price in the basket, the confirm card and the total — and the
     sale was then refused by the server with a generic message. */
  it("a chip for a product taken off sale refuses in words", () => {
    const out = intoCart("chip", "gone");
    expect(out.cart).toEqual([]);
    expect(out.toasts).toEqual(["Этот товар снят с продажи — верните его в «Товарах»."]);
  });

  it("…and so does the scanner", () => {
    const out = intoCart("scan", "gone");
    expect(out.cart).toEqual([]);
    expect(out.toasts).toEqual(["Этот товар снят с продажи — верните его в «Товарах»."]);
  });
});

/* ------------------------------------------------------------------------ *
 * A refused sale names the field to fix
 * ------------------------------------------------------------------------ */

describe("the till says what actually went wrong", () => {
  const err = (code: string | undefined): string => {
    const body = `
      ${objectConst("POS_SEND_ERRS")}
      ${slice("posSendErr")}
      return posSendErr(CODE);
    `;
    return (new Function("CODE", body) as (c: string | undefined) => string)(code);
  };

  /* A mistyped customer address is the one refusal that never succeeds on
     retry, and it was the one the cashier could not see: every code but two
     landed on «попробуйте ещё раз». */
  it("names the e-mail when the address is malformed", () => {
    expect(err("bad_email")).toBe("Проверьте e-mail покупателя — адрес набран с ошибкой.");
  });

  it("names the line when the product is off sale", () => {
    expect(err("out_of_stock")).toBe("Этот товар снят с продажи — уберите строку из чека.");
  });

  it("keeps the two it always knew", () => {
    expect(err("empty_order")).toBe("Добавьте хотя бы один товар.");
    expect(err("bad_payment_method")).toBe("Выберите способ оплаты.");
  });

  it("falls back to «попробуйте ещё раз» for a code it has no words for", () => {
    expect(err("server_error")).toBe("Не удалось оформить продажу — попробуйте ещё раз.");
    expect(err(undefined)).toBe("Не удалось оформить продажу — попробуйте ещё раз.");
  });
});

/* ------------------------------------------------------------------------ *
 * «Отменить» on a clamped write-off
 * ------------------------------------------------------------------------ */

type Entry = { a: unknown; prev: { type: string; delta?: number } | null };

/** Runs the real stockUndoApplied() over one journal entry. */
function undoAfter(requested: number, result: MoveResult): Entry["prev"] {
  const body = `
    var a = { type: "stock_adjust", product_id: "p", variant: "", delta: REQ, reason: "adjust" };
    var DEMO = { log: [{ a: a, prev: { type: "stock_adjust", product_id: "p", variant: "", delta: -REQ, reason: "adjust" } }] };
    function demoSave() {}
    ${slice("stockUndoApplied")}
    stockUndoApplied(a, RESULT);
    return DEMO.log[0].prev;
  `;
  const fn = new Function("REQ", "RESULT", body) as (r: number, res: unknown) => Entry["prev"];
  return fn(requested, result);
}

describe("undo puts back only what left the shelf", () => {
  it("an unclamped write-off keeps its mirror-image undo", () => {
    expect(undoAfter(-3, { appliedDelta: -3 })?.delta).toBe(3);
  });

  /* The journal line is written before the server answers, so its undo was
     built from the REQUESTED delta: undoing a −5 clamped to −2 put back five
     bottles, three of which never existed — and the shop then advertised and
     sold them. */
  it("a clamped write-off puts back only the clamped amount", () => {
    expect(undoAfter(-5, { appliedDelta: -2, clampedNegative: true })?.delta).toBe(2);
  });

  it("a move that applied nothing carries no undo at all", () => {
    expect(undoAfter(-5, { appliedDelta: 0, skipped: true })).toBeNull();
  });
});

/* ------------------------------------------------------------------------ *
 * «Сделать один раз»: the key stockMoveSend() puts on a movement
 *
 * A move is a RELATIVE delta, so the shop cannot tell a retry from a real
 * repeat by looking at the request — two «+1 приход» in a row are two real
 * bottles. Only the panel knows, and this is where it says so. The route half
 * is tests/idempotency-routes.test.ts.
 * ------------------------------------------------------------------------ */

interface MoveCall {
  body: Record<string, unknown>;
  key: string;
}

/** The real stockMoveSend(), called once per entry in `plan`. */
async function moves(
  plan: Array<{ body: Record<string, unknown>; answer: { status: number; body: Record<string, unknown> } | "dead" }>,
): Promise<{ sent: MoveCall[]; results: unknown[]; fail: string[] }> {
  const body = `
    var window = {};
    var out = { sent: [], results: [], fail: [] };
    var nth = 0;
    function noop() {}
    function apiSend(url, method, b, idemKey) {
      out.sent.push({ body: b, key: idemKey || "" });
      var next = PLAN[nth++].answer;
      return next === "dead" ? Promise.reject(new Error("no-api")) : Promise.resolve(next);
    }
    ${slice("idemNewKey")}
    ${slice("stockMoveFailText")}
    ${slice("stockMoveSend")}
    var chain = Promise.resolve();
    PLAN.forEach(function (step) {
      chain = chain.then(function () {
        return stockMoveSend(step.body).then(function (r) {
          out.results.push(r);
          if (!r) out.fail.push(stockMoveFailText("Не удалось сохранить"));
        }, function () { out.results.push("rejected"); });
      });
    });
    return chain.then(function () { return out; });
  `;
  // app.js's own source plus fixed stub text — nothing is interpolated in
  const fn = new Function("PLAN", `var STOCK_MOVE = { sig: "", key: "" }; var stockMoveWait = false; var stockMoveChain = Promise.resolve();` + body) as (
    p: unknown[],
  ) => Promise<{ sent: MoveCall[]; results: unknown[]; fail: string[] }>;
  return fn(plan);
}

const PLUS_ONE = { productId: "p", variant: "", delta: 1, reason: "goods_in", ref: "сканер" };
const MOVED = { status: 200, body: { ok: true, result: { appliedDelta: 1 } } };
const BUSY = { status: 409, body: { ok: false, error: "in_progress" } };

describe("the key a stock movement carries", () => {
  it("is sent, and is a key the shop will accept", async () => {
    const out = await moves([{ body: PLUS_ONE, answer: MOVED }]);
    expect(out.sent[0].key).toMatch(/^[A-Za-z0-9._:-]{8,200}$/);
  });

  /* THE ONE THAT MATTERS. The scanner's «+1 приход», then the very same
     «+1 приход» for the next bottle out of the box. Byte-identical
     bodies, and they MUST carry different keys — otherwise the shop replays
     the first answer and the second bottle never reaches the shelf. */
  it("two identical «+1 приход» after a good answer carry DIFFERENT keys", async () => {
    const out = await moves([
      { body: PLUS_ONE, answer: MOVED },
      { body: PLUS_ONE, answer: MOVED },
    ]);
    expect(out.sent).toHaveLength(2);
    expect(out.sent[1].body).toEqual(out.sent[0].body);
    expect(out.sent[1].key).not.toBe(out.sent[0].key);
  });

  /* …and the opposite, which is what the key is for: the answer never came
     back, so the panel does not know whether the bottle landed. The tap that
     follows is a RETRY of that movement and carries the same key. */
  it("a movement whose answer was lost keeps its key for the retry", async () => {
    const out = await moves([
      { body: PLUS_ONE, answer: "dead" },
      { body: PLUS_ONE, answer: MOVED },
    ]);
    expect(out.sent).toHaveLength(2);
    expect(out.sent[1].key).toBe(out.sent[0].key);
  });

  /* The retry above is the good case: the first attempt never landed, so the
     second one writes the bottle. This is the other one — the first attempt
     DID land and only the answer was lost, so the server recognises the key
     and hands back the first answer without touching the shelf. The panel
     used to print «Приход +1 ✓» over that, so six identical bottles could be
     counted as five, cheerfully (audit F6). The shop cannot tell the two
     apart and keeps under-counting — a shelf that overstates sells what is
     not there — but it now says so, with the remainder, while the bottle is
     still in his hand. */
  it("carries the server's «nothing moved» out to the caller", async () => {
    const REPLAY = { status: 200, body: { ok: true, result: { appliedDelta: 1, qtyAfter: 5 }, replayed: true } };
    const out = await moves([
      { body: PLUS_ONE, answer: "dead" },
      { body: PLUS_ONE, answer: REPLAY },
    ]);
    expect(out.sent[1].key, "the retry must reuse the key or nothing can be recognised").toBe(out.sent[0].key);
    expect(out.results[1]).toMatchObject({ appliedDelta: 1, qtyAfter: 5, replayed: true });
  });

  it("does not mark an ordinary movement as a replay", async () => {
    const out = await moves([{ body: PLUS_ONE, answer: MOVED }]);
    expect((out.results[0] as Record<string, unknown>).replayed).toBeUndefined();
  });

  /* 409 in_progress is the same movement still being written by the tap
     before. The key is kept, and the panel says so rather than «не
     сохранилось» over a movement that is going through perfectly well. */
  it("an in-progress answer keeps the key and is not worded as a failure", async () => {
    const out = await moves([
      { body: PLUS_ONE, answer: BUSY },
      { body: PLUS_ONE, answer: MOVED },
    ]);
    expect(out.results[0]).toBeNull();
    expect(out.fail).toEqual(["Движение уже записывается — подождите пару секунд."]);
    expect(out.sent[1].key).toBe(out.sent[0].key);
  });

  /* A dead connection is not an in-progress answer, and must not borrow its
     sentence from the call before it. */
  it("a dead connection after an in-progress answer does not inherit «подождите»", async () => {
    const out = await moves([
      { body: PLUS_ONE, answer: BUSY },
      { body: PLUS_ONE, answer: "dead" },
      { body: PLUS_ONE, answer: { status: 503, body: { ok: false, error: "db_unavailable" } } },
    ]);
    expect(out.results[1]).toBe("rejected");
    expect(out.fail).toEqual([
      "Движение уже записывается — подождите пару секунд.",
      "Не удалось сохранить",
    ]);
  });

  it("a different movement always gets a key of its own", async () => {
    const out = await moves([
      { body: PLUS_ONE, answer: "dead" },
      { body: { ...PLUS_ONE, delta: -1, reason: "sale_pos" }, answer: MOVED },
    ]);
    expect(out.sent[1].key).not.toBe(out.sent[0].key);
  });
});
