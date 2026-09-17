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
  /** The `Idempotency-Key` header this call carried, "" when it carried none. */
  key: string;
}

interface Answer {
  /** postJSON(): the route answered 404/405/501 — there is no API here. */
  offline?: boolean;
  /** postJSON(): the request left and no answer came back — see its comment. */
  lost?: boolean;
  body?: Record<string, unknown>;
  status?: number;
}

interface Held {
  order: string;
  cart: Array<{ id: string; qty: number }>;
}

interface Rig {
  /** Press «Оплатить». Resolves once the whole chain has settled. */
  tap(): Promise<void>;
  calls: Call[];
  toasts: string[];
  /** The basket as it stands now — emptied, or still there to pay for. */
  cart: Array<{ id: string; qty: number }>;
  /** Every basket parked on the way to the bank, newest last. */
  held: Held[];
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
/**
 * @param apiOk what API.ok holds when «Оплатить» is pressed. `false` is what a
 *   single failed background probe at page load latches it to.
 */
function rig(answers: Answer[], apiOk: boolean | null = true): Rig {
  const body = `
    var calls = [], toasts = [], held = [], href = "", cart = [{ id: "p1", qty: 1 }];
    var script = ANSWERS.slice();
    var pendingOrder = null;
    var S = {
      paying: false, lang: "RU", pay: 0, bank: 0, cart: cart,
      emailTouched: false, shipTouched: false, giftToTouched: false, invTouched: false,
      country: "EE", countryIso: "", coStep: 3, done: null
    };
    var API = { ok: API_OK };
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
    /* The basket is parked against the order it became just before it is
       emptied, so a receipt that says the order was not paid can give it back
       (Ренат, 13.09.2026: «cart is empty and I do not have option to pay
       again»). Recorded with the basket as it stood at that moment, so a test
       can see that the order *and* the goods were both kept. */
    function holdCart(orderId) { held.push({ order: orderId, cart: S.cart.slice() }); }
    // the body payNow() signs its remembered order with — the real one is
    // orderPayload(), whose only relevant property here is that it changes
    // when the basket does
    function orderPayload() { return { items: S.cart.slice(), lang: S.lang }; }
    function postJSON(url, b, signal, idemKey) {
      calls.push({ url: url, body: b, key: idemKey || "" });
      var next = script.shift() || { body: { ok: false, error: "unstubbed" } };
      return Promise.resolve(next);
    }
    var location = { get href() { return href; }, set href(v) { href = v; } };
    /* «сделать один раз»: the real minter and the real memo, so the key a
       retry carries is the shop's own answer and not the test's. */
    var orderIdem = { sig: "", key: "" };
    ${slice("idemNewKey")}
    ${slice("orderIdemKey")}

    ${slice("payNow")}

    return {
      tap: function () { payNow(); return Promise.resolve().then(function () {}).then(function () {}).then(function () {}).then(function () {}); },
      calls: calls,
      toasts: toasts,
      held: held,
      cart: function () { return S.cart; },
      href: function () { return href; },
      setCart: function (lines) { S.cart = lines; },
      // the button locks for the length of the page: payNow() never unlocks on
      // success because the browser is leaving. This is the next page load.
      reload: function () { S.paying = false; }
    };
  `;
  const made = (new Function("ANSWERS", "API_OK", body) as (a: Answer[], ok: boolean | null) => {
    tap(): Promise<void>;
    calls: Call[];
    toasts: string[];
    held: Held[];
    cart(): Array<{ id: string; qty: number }>;
    href(): string;
    setCart(l: Array<{ id: string; qty: number }>): void;
    reload(): void;
  })(answers, apiOk);
  return {
    tap: made.tap,
    calls: made.calls,
    toasts: made.toasts,
    held: made.held,
    get cart() {
      return made.cart();
    },
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

  /* Ренат, 13.09.2026: «I chose card payment and cancelled — … cart is empty
     and I do not have option to pay again.» Emptying the basket before the
     bank is right (a shopper who paid and closed that tab must not find the
     goods still in it), but it must not be *thrown away*: it is parked
     against the order it became, and doneState() gives it back on a receipt
     that says the order was not paid. Held before cleared, or there would be
     nothing left to park. */
  it("parks the basket against the order on the way to the bank", async () => {
    const r = rig([ORDER_OK, PAY_OK]);
    await r.tap();
    expect(r.href).toBe("https://bank.example/pay/1");
    expect(r.held).toEqual([{ order: "order-1", cart: [{ id: "p1", qty: 1 }] }]);
  });

  it("parks nothing when the payment never happened — there is still a basket", async () => {
    const r = rig([ORDER_OK, PAY_DEAD]);
    await r.tap();
    expect(r.href).toBe("");
    expect(r.held).toEqual([]);
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

  /* The other half of the same story, and the worse one. postJSON() used to
     answer `offline` to three different things: a static host (404), a dropped
     connection, and a gateway's 502/504 HTML. payNow() read all three as «there
     is no shop behind this page» and called finishDemo(), which empties the
     basket and says «Это демонстрация — настоящий заказ не создан». For «По
     счёту» that sentence was printed while the server had already numbered the
     invoice and mailed the PDF; on the payment step it threw away a basket that
     had just become a real, unpaid order. */
  it("a lost answer to POST /api/orders/ never says the order was a demo", async () => {
    const r = rig([{ offline: true, lost: true, status: 502 }, ORDER_OK, PAY_OK]);
    await r.tap();

    expect(r.toasts).toEqual([
      "Магазин не ответил. Проверьте почту: если письмо о заказе пришло, заказ создан — иначе попробуйте ещё раз",
    ]);
    // the basket is still there to try again with
    expect(r.cart).toEqual([{ id: "p1", qty: 1 }]);

    await r.tap();
    expect(urls(r)).toEqual(["/api/orders/", "/api/orders/", "/api/payments/create/"]);
    expect(r.href).toBe("https://bank.example/pay/1");
  });

  it("a lost answer to POST /api/payments/create/ keeps the order and the basket", async () => {
    const r = rig([ORDER_OK, { offline: true, lost: true, status: 0 }, PAY_OK]);
    await r.tap();

    expect(r.toasts).toEqual(["Не получилось открыть оплату. Заказ сохранён — попробуйте ещё раз"]);
    expect(r.cart).toEqual([{ id: "p1", qty: 1 }]);
    expect(r.held).toEqual([]);
    expect(r.href).toBe("");

    // the next tap pays for the order that already exists, and makes no second one
    await r.tap();
    expect(urls(r)).toEqual(["/api/orders/", "/api/payments/create/", "/api/payments/create/"]);
    expect(r.calls[2].body.orderId).toBe("order-1");
  });

  it("a static host still gets the demo receipt", async () => {
    const r = rig([{ offline: true }]);
    await r.tap();
    expect(r.toasts).toEqual(["demo"]);
  });

  it("a failed POST /api/orders/ leaves nothing remembered", async () => {
    const r = rig([{ body: { ok: false, error: "out_of_stock" } }, ORDER_OK, PAY_OK]);
    await r.tap();
    expect(r.toasts).toEqual(["order:out_of_stock"]);
    await r.tap();
    expect(urls(r)).toEqual(["/api/orders/", "/api/orders/", "/api/payments/create/"]);
  });
});

/* ---------- «сделать один раз»: the key the checkout sends -----------------
 *
 * `pendingOrder` above covers the half where the order was MADE and the
 * payment failed — the checkout knows there is an order. This is the half it
 * cannot see: POST /api/orders/ arrived, the shop numbered the order and
 * («По счёту») mailed a real invoice, and the answer was lost on the way
 * back. The checkout has nothing to remember, so the second tap re-POSTs — and
 * the only thing that stops that becoming a second order is the key it carries.
 *
 * The server half is tests/idempotency-routes.test.ts; this is the client's
 * end of the same contract, run against the shop's own payNow().
 */
function orderCalls(r: Rig): Call[] {
  return r.calls.filter((c) => c.url === "/api/orders/");
}

describe("payNow(): the key a retry carries", () => {
  it("sends one, and it is a key the shop will accept", async () => {
    const r = rig([ORDER_OK, PAY_OK]);
    await r.tap();
    const key = orderCalls(r)[0].key;
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(200);
    // the same character class src/lib/idempotency.ts KEY_RE allows
    expect(key).toMatch(/^[A-Za-z0-9._:-]+$/);
  });

  /* THE ONE THIS EXISTS FOR. A 502 on the way back from an order that really
     was created; the shopper taps «Оплатить» again. Both POSTs must carry
     the SAME key, or the shop has no way to know they are one order. */
  it("a lost answer and the tap that follows it are one key", async () => {
    const r = rig([{ offline: true, lost: true, status: 502 }, ORDER_OK, PAY_OK]);
    await r.tap();
    await r.tap();

    const posted = orderCalls(r);
    expect(posted).toHaveLength(2);
    expect(posted[1].key).toBe(posted[0].key);
    expect(posted[0].key).not.toBe("");
  });

  /* And the other direction, which is what stops somebody «fixing» this into a
     hash of the basket later: a basket the shopper changed is a different
     order and must get a key of its own. */
  it("a changed basket gets a new key, not the old one", async () => {
    const r = rig([{ offline: true, lost: true, status: 502 }, ORDER_OK, PAY_OK]);
    await r.tap();
    r.setCart([{ id: "p1", qty: 1 }, { id: "p2", qty: 2 }]);
    await r.tap();

    const posted = orderCalls(r);
    expect(posted).toHaveLength(2);
    expect(posted[1].key).not.toBe(posted[0].key);
  });

  /* …and once the shop has answered, the key has done its job. The order this
     one made can no longer be paid for (a webhook settled it), so the next tap
     makes a NEW order — which must not be handed the old one back. */
  it("a definite answer ends the key: the next order gets its own", async () => {
    const r = rig([
      ORDER_OK,
      PAY_DEAD,
      { body: { ok: false, error: "already_paid" } },
      ORDER_OK_2,
      PAY_OK,
    ]);
    await r.tap();
    await r.tap();
    await r.tap();

    const posted = orderCalls(r);
    expect(posted).toHaveLength(2);
    expect(posted[1].key).not.toBe(posted[0].key);
  });

  /* 409 in_progress is the shopper's OWN first tap still running. Nothing is
     lost, nothing is thrown away, and the sentence does not read like a
     refusal — the next tap in a moment is handed that first order. */
  it("409 in_progress keeps the basket, the key and a sentence that is not an error", async () => {
    const r = rig([
      { status: 409, body: { ok: false, error: "in_progress" } },
      ORDER_OK,
      PAY_OK,
    ]);
    await r.tap();

    expect(r.toasts).toEqual(["Заказ уже оформляется — подождите пару секунд и нажмите ещё раз"]);
    expect(r.cart).toEqual([{ id: "p1", qty: 1 }]);

    r.reload();
    await r.tap();
    const posted = orderCalls(r);
    expect(posted).toHaveLength(2);
    // the same key, so the second tap is answered with the FIRST order
    expect(posted[1].key).toBe(posted[0].key);
    expect(r.href).toBe("https://bank.example/pay/1");
  });

  /* A key the shop says belongs to a different body is a checkout that lost
     track of itself. It is forgotten, so the retry is not wedged on it. */
  it("key_reused is forgotten, and the retry mints a fresh one", async () => {
    const r = rig([
      { status: 409, body: { ok: false, error: "key_reused" } },
      ORDER_OK,
      PAY_OK,
    ]);
    await r.tap();
    expect(r.toasts).toEqual(["order:key_reused"]);

    await r.tap();
    const posted = orderCalls(r);
    expect(posted).toHaveLength(2);
    expect(posted[1].key).not.toBe(posted[0].key);
    expect(r.href).toBe("https://bank.example/pay/1");
  });
});

/* ---------- what postJSON() is actually answering ------------------------ */

/**
 * The three answers, told apart. `offline` is still set on all of them, so the
 * promo box, the points feed and the rest keep the behaviour they had; `lost`
 * is the new one, and the only thing that separates "there is no shop here"
 * from "the shop may well have taken the order and we did not hear back".
 */
describe("postJSON(): a dead host and a lost answer are not the same thing", () => {
  type Answered = { offline?: boolean; lost?: boolean; status?: number; body?: unknown };

  function post(fetchStub: unknown): Promise<Answered> {
    const body = `
      var fetch = FETCH;
      ${slice("postJSON")}
      return postJSON("/api/orders/", { a: 1 });
    `;
    // repository source plus a stub function — nothing interpolated
    return (new Function("FETCH", body) as (f: unknown) => Promise<Answered>)(fetchStub);
  }

  const res = (status: number, json: () => Promise<unknown>) => ({ status, json });

  it("404/405/501 is a static host — offline, and not lost", async () => {
    for (const status of [404, 405, 501]) {
      const out = await post(async () => res(status, async () => ({})));
      expect(out).toEqual({ offline: true });
    }
  });

  it("a dropped connection is lost", async () => {
    const out = await post(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(out).toMatchObject({ offline: true, lost: true, status: 0 });
  });

  it("a gateway's HTML 502 is lost, not a dead host", async () => {
    const out = await post(async () =>
      res(502, async () => {
        throw new SyntaxError("Unexpected token <");
      }),
    );
    expect(out).toMatchObject({ offline: true, lost: true, status: 502 });
  });

  it("a real answer — good or bad — is neither", async () => {
    const ok = await post(async () => res(200, async () => ({ ok: true, orderId: "x" })));
    expect(ok).toEqual({ body: { ok: true, orderId: "x" }, status: 200 });
    const refused = await post(async () => res(409, async () => ({ ok: false, error: "out_of_stock" })));
    expect(refused).toEqual({ body: { ok: false, error: "out_of_stock" }, status: 409 });
  });
});

/* ---------------------------------------------------------------------------
   …and the receipt that was never earned.

   `finishDemo()` empties the basket, persists it and paints the green «Заказ
   оформлен» — it exists because the prototype is also served statically for
   Renat, with no API behind it at all. Two ways into it were wrong, and both
   showed that receipt to a shopper of the REAL shop:

   1. `if (API.ok === false) return finishDemo();` before the POST. API.ok is
      latched false by the .catch of the one-shot probes this screen fires at
      load, none of which ever asks again, so one blink of a phone's connection
      turned «Оплатить» into a lie for the life of the page.
   2. postJSON() answered a bare `offline` for a rejected fetch and for any body
      it could not parse — which is exactly what an edge 502/504 is. A timeout
      on the way BACK from POST /api/orders/ meant the order existed, was
      unpaid, and the shopper was told it was done. Such an answer now carries
      `lost`, and payNow() asks about that before it asks about `offline`.

   Only a real 404/405/501 finishes the demo now; everything else is an error
   the shopper can act on.
--------------------------------------------------------------------------- */
const OFFLINE = { offline: true };
/* A lost answer as postJSON() reports it: `offline` rides along for the
   callers that cannot tell the difference, `lost` is what payNow() reads. */
const DROPPED = { offline: true, lost: true, status: 502 };
const LOST_ORDER =
  "Магазин не ответил. Проверьте почту: если письмо о заказе пришло, заказ создан — иначе попробуйте ещё раз";
const LOST_PAY = "Не получилось открыть оплату. Заказ сохранён — попробуйте ещё раз";

describe("payNow(): the demo receipt is only for a shop with no API at all", () => {
  it("still posts the order when a background probe has latched API.ok = false", async () => {
    const r = rig([ORDER_OK, PAY_OK], false);
    await r.tap();
    expect(urls(r)).toEqual(["/api/orders/", "/api/payments/create/"]);
    expect(r.toasts).not.toContain("demo");
    expect(r.href).toBe("https://bank.example/pay/1");
  });

  it("finishes the demo on a 404 from /api/orders/ — the static prototype still walks", async () => {
    const r = rig([OFFLINE]);
    await r.tap();
    expect(urls(r)).toEqual(["/api/orders/"]);
    expect(r.toasts).toEqual(["demo"]);
  });

  it("a dropped line on POST /api/orders/ is an error, not a receipt", async () => {
    const r = rig([DROPPED]);
    await r.tap();
    expect(r.toasts).toEqual([LOST_ORDER]);
    expect(r.toasts).not.toContain("demo");
  });

  /* The worst of the two: the order EXISTS by now. A green receipt here is a
     paid-looking page for an order nobody has paid for. */
  it("a dropped line on POST /api/payments/create/ is an error, not a receipt", async () => {
    const r = rig([ORDER_OK, DROPPED, PAY_OK]);
    await r.tap();
    expect(urls(r)).toEqual(["/api/orders/", "/api/payments/create/"]);
    expect(r.toasts).toEqual([LOST_PAY]);
    expect(r.toasts).not.toContain("demo");
    expect(r.href).toBe("");
    // …and the order it already made is still the one the next tap pays for
    await r.tap();
    expect(urls(r)).toEqual(["/api/orders/", "/api/payments/create/", "/api/payments/create/"]);
    expect(r.calls[2].body.orderId).toBe("order-1");
    expect(r.href).toBe("https://bank.example/pay/1");
  });
});
