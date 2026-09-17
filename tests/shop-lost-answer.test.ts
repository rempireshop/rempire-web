/**
 * What the storefront is allowed to claim when it did not hear the answer.
 *
 * The shop tells a shopper three things it cannot take back: «настоящий заказ
 * не создан», «Записали ✓» and a parcel machine's id. Until 14.09.2026 every
 * one of them could be said about a request whose answer was simply LOST —
 * the phone changed cell, the gateway timed out and returned its own HTML
 * page, a background probe blipped once — because `postJSON` reported "no
 * server here" and "no answer" with the same flag, and the checkout kept a
 * sticky `API.ok === false` that one failed probe latched for the visit.
 *
 * The rule pinned here: only a 404/405/501 proves nothing ran on a server
 * (that is the prototype served statically, which must still walk end to
 * end). Everything else is a lost answer, and about a lost answer the shop
 * says «попробуйте ещё раз» and keeps what it has.
 *
 * Same technique as tests/checkout-parity.test.ts and tests/inventory-scanner.test.ts:
 * the functions are sliced out of public/shop2/app.js **by source text** and run
 * against stubs, so this tests the shop's own code and not a retyped copy.
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

/* ------------------------------------------------------------------------ *
 * 1. postJSON — two different failures, told apart
 * ------------------------------------------------------------------------ */

type PostOut = { offline?: boolean; lost?: boolean; body?: unknown; status?: number };

/** Run the real postJSON() against a stub fetch. */
function post(fetchStub: () => Promise<unknown>): Promise<PostOut> {
  const body = `
    var fetch = FETCH;
    ${slice("postJSON")}
    return postJSON("/api/orders/", { a: 1 });
  `;
  return new Function("FETCH", body)(fetchStub) as Promise<PostOut>;
}

/** A Response-ish object: only `status` and `json()` are ever read. */
function answer(status: number, json: unknown | Error) {
  return Promise.resolve({
    status,
    json: () => (json instanceof Error ? Promise.reject(json) : Promise.resolve(json)),
  });
}

describe("postJSON tells «no shop here» from «no answer»", () => {
  /* The contract: `offline` is set on every failure, and `lost` is what says
     the answer went missing rather than the route being absent. A BARE
     `offline` — 404/405/501 — is the only one that proves nothing ran. */
  it("404, 405 and 501 are the static host — a bare offline, never lost", async () => {
    for (const status of [404, 405, 501]) {
      const out = await post(() => answer(status, { ok: true }));
      expect(out.offline, `status ${status}`).toBe(true);
      expect(out.lost, `status ${status}`).toBeUndefined();
    }
  });

  it("a dead connection is offline AND lost", async () => {
    const out = await post(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(out.offline).toBe(true);
    expect(out.lost).toBe(true);
  });

  it("an answer that is not JSON — a gateway's own error page — is offline AND lost", async () => {
    const out = await post(() => answer(502, new SyntaxError("Unexpected token <")));
    expect(out.offline).toBe(true);
    expect(out.lost).toBe(true);
  });

  it("a real answer is a body, whatever the status says", async () => {
    const out = await post(() => answer(409, { ok: false, error: "out_of_stock" }));
    expect(out.offline).toBeUndefined();
    expect(out.body).toEqual({ ok: false, error: "out_of_stock" });
    expect(out.status).toBe(409);
  });
});

/* ------------------------------------------------------------------------ *
 * 2. payNow — the demo receipt, and who is allowed to see it
 * ------------------------------------------------------------------------ */

interface PayRun {
  demo: number;
  toasts: string[];
  posted: string[];
  cartLeft: number;
  paying: boolean;
}

/**
 * Run the real payNow() over a valid basket. `answers` is what postJSON
 * returns, in call order; `apiOk` seeds the sticky flag a background probe
 * would have set.
 */
async function payNow(answers: PostOut[], apiOk: boolean | null = null): Promise<PayRun> {
  const body = `
    var out = { demo: 0, toasts: [], posted: [], cartLeft: 0, paying: false };
    var S = {
      cart: [{ id: "x", qty: 1 }], lang: "RU", country: "EE", countryIso: "",
      pay: 0, coStep: 3, paying: false, ship: { method: "pickup", carrier: "", point: null }
    };
    var API = { ok: API_OK };
    var cartPush = { t: 0, off: false };
    var pendingOrder = null;
    var location = { href: "" };
    var history = { state: null, replaceState: function () {} };
    var PAYS = [{ k: "bank" }];
    var nth = 0;
    function postJSON(url) { out.posted.push(url); return Promise.resolve(ANSWERS[nth++] || { offline: true }); }
    function toast(m) { out.toasts.push(m); }
    function render() {}
    function go() {}
    function emailBad() { return false; }
    function isDigital() { return false; }
    function shipMissing() { return []; }
    function giftToEmailBad() { return false; }
    function pointMissing() { return false; }
    function isInvoice() { return false; }
    function invoiceMissing() { return []; }
    function failStep(step, msg) { out.toasts.push(msg); }
    function orderPayload() { return { items: [{ id: "x", qty: 1 }] }; }
    function orderErrText(code) { return "заказ: " + code; }
    function payErrText(code) { return "оплата: " + code; }
    function selectedBankCode() { return ""; }
    function holdCart() {}
    function apiSeen(ok) { API.ok = ok; }
    function clearOrderState() { S.cart = []; pendingOrder = null; }
    function finishDemo() { out.demo++; clearOrderState(); S.paying = false; }
    ${slice("payNow")}
    payNow();
    return Promise.resolve().then(function () {}).then(function () {}).then(function () {}).then(function () {
      out.cartLeft = S.cart.length;
      out.paying = S.paying;
      return out;
    });
  `;
  return (await new Function("ANSWERS", "API_OK", body)(answers, apiOk)) as PayRun;
}

describe("payNow never calls a real order a demonstration", () => {
  /* The one the audit called critical: the order POST arrived, the row is in
     Postgres with its number (and for «По счёту» the invoice is already
     mailed), and the answer was lost on the way back. The old code cleared
     the basket and printed «Это демонстрация — настоящий заказ не создан». */
  it("a lost answer to POST /api/orders/ is an error, not the demo receipt", async () => {
    const run = await payNow([{ offline: true, lost: true }]);
    expect(run.demo).toBe(0);
    expect(run.toasts).toEqual([
      "Магазин не ответил. Проверьте почту: если письмо о заказе пришло, заказ создан — иначе попробуйте ещё раз",
    ]);
    // the basket is still the shopper's — nothing was "finished"
    expect(run.cartLeft).toBe(1);
    expect(run.paying).toBe(false);
  });

  it("a lost answer to POST /api/payments/create/ is an error too", async () => {
    const run = await payNow([
      { body: { ok: true, orderId: "o1", number: "R-1" }, status: 201 },
      { offline: true, lost: true },
    ]);
    expect(run.demo).toBe(0);
    expect(run.toasts).toEqual(["Не получилось открыть оплату. Заказ сохранён — попробуйте ещё раз"]);
    expect(run.posted).toEqual(["/api/orders/", "/api/payments/create/"]);
    expect(run.cartLeft).toBe(1);
  });

  it("404 from the orders route IS the static prototype — the demo still walks", async () => {
    const run = await payNow([{ offline: true }]);
    expect(run.demo).toBe(1);
    expect(run.toasts).toEqual([]);
  });

  /* The other half of the same bug: `API.ok` goes false on ONE failed
     background probe — the shipping rules, a carrier's machine list, the bank
     logos — and every one of those is a one-shot that never runs again to put
     it back. payNow used to read that flag BEFORE sending anything. */
  it("a failed background probe does not put the live checkout into demo mode", async () => {
    const run = await payNow(
      [{ body: { ok: true, orderId: "o1", number: "R-1" }, status: 201 }, { offline: true, lost: true }],
      false,
    );
    expect(run.demo).toBe(0);
    // the order really was attempted, which is the whole point
    expect(run.posted).toEqual(["/api/orders/", "/api/payments/create/"]);
  });
});

/* ------------------------------------------------------------------------ *
 * 3. notifySend — «Записали ✓» only when somebody really was written down
 * ------------------------------------------------------------------------ */

function notifySend(res: PostOut): Promise<{ toasts: string[]; open: string; busy: boolean }> {
  const body = `
    var out = { toasts: [], open: "", busy: false };
    var S = { notifyEmail: "maria@example.com", notifyOpen: "prod-1", notifyBusy: false, lang: "RU" };
    function postJSON() { return Promise.resolve(RES); }
    function toast(m) { out.toasts.push(m); }
    function render() {}
    function apiSeen() {}
    ${slice("notifySend")}
    notifySend("prod-1");
    return Promise.resolve().then(function () {}).then(function () {
      out.open = S.notifyOpen; out.busy = S.notifyBusy;
      return out;
    });
  `;
  return new Function("RES", body)(res) as Promise<{ toasts: string[]; open: string; busy: boolean }>;
}

describe("«Сообщить о наличии» does not thank people it never signed up", () => {
  it("a lost answer says so and keeps the form open", async () => {
    const out = await notifySend({ offline: true, lost: true });
    expect(out.toasts).toEqual(["Не получилось — попробуйте ещё раз"]);
    expect(out.open).toBe("prod-1");
    expect(out.busy).toBe(false);
  });

  it("404 is still the prototype's demo «Записали ✓»", async () => {
    const out = await notifySend({ offline: true });
    expect(out.toasts).toEqual(["Записали — сообщим, когда появится ✓"]);
    expect(out.open).toBe("");
  });

  it("a real subscription still says «Записали ✓»", async () => {
    const out = await notifySend({ body: { ok: true }, status: 200 });
    expect(out.toasts).toEqual(["Записали — сообщим, когда появится ✓"]);
    expect(out.open).toBe("");
  });
});

/* ------------------------------------------------------------------------ *
 * 4. loadPointsFor — no invented machine ids on a live checkout
 * ------------------------------------------------------------------------ */

interface PointsRun {
  list: Array<{ id: string }> | undefined;
  err: boolean;
  loading: boolean;
}

/** Run the real loadPointsFor() against one stubbed answer. */
function loadPointsFor(fetchStub: () => Promise<unknown>): Promise<PointsRun> {
  const body = `
    var POINTS = { by: {}, empty: {}, loading: {}, err: {}, q: "", view: "list" };
    var S = { country: "EE" };
    var fetch = FETCH;
    function stampPointsLoading() {}
    function pointsArrived() {}
    function apiSeen() {}
    function demoPoints(carrier, cc) { return [{ id: carrier + "-demo-0", name: "Стенд-ин" }]; }
    ${slice("loadPointsFor")}
    loadPointsFor("omniva");
    return Promise.resolve().then(function () {}).then(function () {}).then(function () {}).then(function () {
      return { list: POINTS.by["omniva:EE"], err: !!POINTS.err["omniva:EE"], loading: !!POINTS.loading["omniva:EE"] };
    });
  `;
  return new Function("FETCH", body)(fetchStub) as Promise<PointsRun>;
}

describe("a parcel-point feed that failed does not invent machines", () => {
  /* demoPoints() mints `omniva-demo-0` out of the committed August name list.
     cleanShipping() in src/lib/orders.ts stores whatever id it is given as
     free text, so that string went onto a real order as the machine the
     parcel was going to — and no carrier has ever heard of it. */
  it("a 500 leaves the list unloaded and marked failed", async () => {
    const out = await loadPointsFor(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve(null) }));
    expect(out.list).toBeUndefined();
    expect(out.err).toBe(true);
    expect(out.loading).toBe(false);
  });

  it("a dead connection does the same", async () => {
    const out = await loadPointsFor(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(out.list).toBeUndefined();
    expect(out.err).toBe(true);
  });

  it("an answer without points does the same", async () => {
    const out = await loadPointsFor(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: false, error: "rate_limited" }) }),
    );
    expect(out.list).toBeUndefined();
    expect(out.err).toBe(true);
  });

  it("404 — no shop behind this page — is what the stand-in list is for", async () => {
    const out = await loadPointsFor(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) }));
    expect(out.list).toEqual([{ id: "omniva-demo-0", name: "Стенд-ин" }]);
    expect(out.err).toBe(false);
  });

  it("the feed's own machines are kept, ids and all", async () => {
    const out = await loadPointsFor(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, points: [{ id: "8f5e-real-uuid", name: "Peetri Omniva" }] }),
      }),
    );
    expect(out.list).toEqual([{ id: "8f5e-real-uuid", name: "Peetri Omniva" }]);
    expect(out.err).toBe(false);
  });
});

/* ------------------------------------------------------------------------ *
 * 5. the scanner and the «Склад» row — a rejected promise is still an answer
 * ------------------------------------------------------------------------ */

describe("a stock write that never answered releases the button", () => {
  /* apiJson() REJECTS on a dead connection and on an answer that is not JSON
     («no-api»). scanCommitMove attached only a fulfilment handler, so
     S.scanBusy stayed true for ever: «Приход» and «Списание» greyed out with
     no way back but closing the scanner. */
  it("«Приход»/«Списание»: a rejected move clears scanBusy and says so", async () => {
    const body = `
      var out = { toasts: [], busy: true };
      var S = { scanBusy: false, scanHit: { product: { id: "p" }, productId: "p", variant: "", code: "123" }, scanQty: 1, scanReady: true };
      var SCAN = { lastCode: "123" };
      var SCANEL = null;
      function stockMoveSend() { return Promise.reject(new Error("no-api")); }
      function scanRenderPanel() {}
      function toast(m) { out.toasts.push(m); }
      function scanLookup() {}
      function scanStockChanged() {}
      ${slice("scanQtyNow")}
      ${slice("scanCommitMove")}
      scanCommitMove(1);
      return Promise.resolve().then(function () {}).then(function () {}).then(function () {
        out.busy = S.scanBusy;
        return out;
      });
    `;
    const out = (await new Function(body)()) as { toasts: string[]; busy: boolean };
    expect(out.busy).toBe(false);
    expect(out.toasts).toEqual(["Не удалось сохранить"]);
  });

  /* stockLevelSaveDetailed() catches its own failures; stockMoveSend() does
     not. One rejecting job left Promise.all rejected, the form open and the
     button disabled on «Сохраняем…» until the panel was reloaded. */
  it("«Склад»: a rejected move re-renders instead of leaving «Сохраняем…»", async () => {
    const body = `
      var out = { toasts: [], renders: 0, edit: "", saved: "x" };
      var S = { stockEdit: "k", stockEditEan: "", stockEditLow: "", stockEditQty: "7", stockEditReason: "", stockSaved: "x", lang: "RU" };
      var STOCK_SAVE_ERRS = {};
      var document = { querySelector: function () { return null; } };
      function stockFindRow() { return { productId: "p", variant: "", ean: "", lowThreshold: null, tracked: true, qty: 3 }; }
      function stockLevelSaveDetailed() { return Promise.resolve({ ok: true }); }
      function stockMoveSend() { return Promise.reject(new Error("no-api")); }
      function stockSaveErrText() { return ""; }
      function toast(m) { out.toasts.push(m); }
      function render() { out.renders++; }
      function refocus() {}
      function reloadStock() {}
      function trText(s) { return s; }
      ${slice("stockQtyValue")}
      ${slice("stockCommit")}
      stockCommit("k");
      return Promise.resolve().then(function () {}).then(function () {}).then(function () {
        out.edit = S.stockEdit; out.saved = S.stockSaved;
        return out;
      });
    `;
    const out = (await new Function(body)()) as { toasts: string[]; renders: number; edit: string; saved: string };
    expect(out.toasts).toEqual(["Не удалось сохранить"]);
    expect(out.renders).toBeGreaterThan(0);
    // the row stays open on the edit the owner has not saved yet
    expect(out.edit).toBe("k");
    expect(out.saved).toBe("");
  });
});
