/**
 * One basket, one order — `payNow()` in public/shop2/app.js.
 *
 * The bug (Dim, 07.09.2026): `POST /api/orders/` succeeded, the payment that
 * followed it did not, and the second tap of «Оплатить» made a SECOND order
 * for the same basket. Two rows, one customer, one intention; the shop then
 * had to work out which of them mattered.
 *
 * payNow() now remembers the order it already made, with a signature of the
 * body it was made from. Same body, same order — straight to the payment;
 * anything the shopper changed makes a new one, because it IS a new order.
 *
 * Same technique as tests/checkout-banks.test.ts: the function is sliced out
 * of app.js by source text and run against stubs, so this tests the shop's own
 * code rather than a retyped copy of it — and the slice fails loudly if app.js
 * renames it.
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

interface Call {
  url: string;
  body: Record<string, unknown>;
}

interface Answer {
  offline?: boolean;
  body?: Record<string, unknown>;
  status?: number;
}

interface Rig {
  /** Press «Оплатить». Resolves once the whole chain has settled. */
  tap(): Promise<void>;
  calls: Call[];
  toasts: string[];
  /** Where the browser was sent, if anywhere. */
  href: string;
  /** Change the basket between taps — a different body, a different order. */
  setCart(lines: Array<{ id: string; qty: number }>): void;
  /** The shopper is back on the checkout after a trip to the bank. */
  reload(): void;
}

/**
 * payNow() with everything around it stubbed: the two POSTs are recorded and
 * answered from a script, and the rest of the checkout says «everything is
 * filled in».
 */
function rig(answers: Answer[]): Rig {
  const body = `
    var calls = [], toasts = [], href = "", cart = [{ id: "p1", qty: 1 }];
    var script = ANSWERS.slice();
    var pendingOrder = null;
    var S = {
      paying: false, lang: "RU", pay: 0, bank: 0, cart: cart,
      emailTouched: false, shipTouched: false, giftToTouched: false, invTouched: false,
      country: "EE", countryIso: "", coStep: 3, done: null
    };
    var API = { ok: true };
    /* The abandoned-cart snapshot, which payNow() switches off before it makes
       the order and back on if the order failed — a basket that is becoming an
       order is not an abandoned one, and the request must not still be in
       flight when the browser leaves for the bank. */
    var cartPush = { t: 0, last: "", off: false };
    var PAYS = [
      { l: "Банковская ссылка", h: "", k: "bank" },
      { l: "Банковская карта", h: "", k: "card" },
      { l: "Apple Pay / Google Pay", h: "", k: "wallet" },
      { l: "По счёту", h: "", k: "invoice" }
    ];
    function render() {}
    function toast(t) { toasts.push(t); }
    function failStep(n, msg) { toasts.push(msg); }
    function apiSeen() {}
    function emailBad() { return false; }
    function isDigital() { return false; }
    function shipMissing() { return []; }
    function giftToEmailBad() { return false; }
    function pointMissing() { return false; }
    function isInvoice() { return false; }
    function invoiceMissing() { return []; }
    function selectedBankCode() { return "HABAEE2X"; }
    function orderErrText(c) { return "order:" + c; }
    function payErrText(c) { return "pay:" + c; }
    function finishDemo() { toasts.push("demo"); }
    function clearOrderState() { pendingOrder = null; S.cart = []; }
    // the body payNow() signs its remembered order with — the real one is
    // orderPayload(), whose only relevant property here is that it changes
    // when the basket does
    function orderPayload() { return { items: S.cart.slice(), lang: S.lang }; }
    function postJSON(url, b) {
      calls.push({ url: url, body: b });
      var next = script.shift() || { body: { ok: false, error: "unstubbed" } };
      return Promise.resolve(next);
    }
    var location = { get href() { return href; }, set href(v) { href = v; } };

    ${slice("payNow")}

    return {
      tap: function () { payNow(); return Promise.resolve().then(function () {}).then(function () {}).then(function () {}).then(function () {}); },
      calls: calls,
      toasts: toasts,
      href: function () { return href; },
      setCart: function (lines) { S.cart = lines; },
      // the button locks for the length of the page: payNow() never unlocks on
      // success because the browser is leaving. This is the next page load.
      reload: function () { S.paying = false; }
    };
  `;
  const made = (new Function("ANSWERS", body) as (a: Answer[]) => {
    tap(): Promise<void>;
    calls: Call[];
    toasts: string[];
    href(): string;
    setCart(l: Array<{ id: string; qty: number }>): void;
    reload(): void;
  })(answers);
  return {
    tap: made.tap,
    calls: made.calls,
    toasts: made.toasts,
    get href() {
      return made.href();
    },
    setCart: made.setCart,
    reload: made.reload,
  };
}

const ORDER_OK = { body: { ok: true, orderId: "order-1", number: "R-100001" } };
const ORDER_OK_2 = { body: { ok: true, orderId: "order-2", number: "R-100002" } };
const PAY_OK = { body: { ok: true, redirectUrl: "https://bank.example/pay/1" } };
const PAY_DEAD = { body: { ok: false, error: "provider_unreachable" } };

function urls(r: Rig): string[] {
  return r.calls.map((c) => c.url);
}

describe("payNow(): a failed payment does not cost the shop a second order", () => {
  it("the second tap pays for the order the first one made", async () => {
    const r = rig([ORDER_OK, PAY_DEAD, PAY_OK]);

    await r.tap();
    expect(urls(r)).toEqual(["/api/orders/", "/api/payments/create/"]);
    expect(r.toasts).toEqual(["pay:provider_unreachable"]);

    await r.tap();
    // no second /api/orders/ — the same order goes back to the bank
    expect(urls(r)).toEqual(["/api/orders/", "/api/payments/create/", "/api/payments/create/"]);
    expect(r.calls[2].body.orderId).toBe("order-1");
    expect(r.href).toBe("https://bank.example/pay/1");
  });

  it("the retry carries the method and the bank the shopper has selected now", async () => {
    const r = rig([ORDER_OK, PAY_DEAD, PAY_OK]);
    await r.tap();
    await r.tap();
    expect(r.calls[2].body).toMatchObject({ orderId: "order-1", method: "bank", bank: "HABAEE2X", lang: "RU" });
  });

  it("a changed basket is a new order, not a retry of the old one", async () => {
    const r = rig([ORDER_OK, PAY_DEAD, ORDER_OK_2, PAY_OK]);
    await r.tap();
    r.setCart([{ id: "p1", qty: 1 }, { id: "p2", qty: 2 }]);
    await r.tap();

    expect(urls(r)).toEqual([
      "/api/orders/",
      "/api/payments/create/",
      "/api/orders/",
      "/api/payments/create/",
    ]);
    expect(r.calls[3].body.orderId).toBe("order-2");
  });

  it("an order the server will not take money for any more is forgotten", async () => {
    // the first payment failed; by the second tap a webhook has settled the
    // order, so it must not be offered again — the next tap places a new one
    const r = rig([
      ORDER_OK,
      PAY_DEAD,
      { body: { ok: false, error: "already_paid" } },
      ORDER_OK_2,
      PAY_OK,
    ]);
    await r.tap();
    await r.tap();
    expect(r.toasts).toEqual(["pay:provider_unreachable", "pay:already_paid"]);

    await r.tap();
    expect(urls(r)).toEqual([
      "/api/orders/",
      "/api/payments/create/",
      "/api/payments/create/",
      "/api/orders/",
      "/api/payments/create/",
    ]);
    expect(r.href).toBe("https://bank.example/pay/1");
  });

  it("an order that reached the bank leaves nothing behind for the next basket", async () => {
    const r = rig([ORDER_OK, PAY_OK, ORDER_OK_2, PAY_OK]);
    await r.tap();
    expect(r.href).toBe("https://bank.example/pay/1");
    // clearOrderState() emptied the basket on the way out; a new one is a new order
    r.reload();
    r.setCart([{ id: "p9", qty: 1 }]);
    await r.tap();
    expect(urls(r)).toEqual([
      "/api/orders/",
      "/api/payments/create/",
      "/api/orders/",
      "/api/payments/create/",
    ]);
  });

  it("a failed POST /api/orders/ leaves nothing remembered", async () => {
    const r = rig([{ body: { ok: false, error: "out_of_stock" } }, ORDER_OK, PAY_OK]);
    await r.tap();
    expect(r.toasts).toEqual(["order:out_of_stock"]);
    await r.tap();
    expect(urls(r)).toEqual(["/api/orders/", "/api/orders/", "/api/payments/create/"]);
  });
});
