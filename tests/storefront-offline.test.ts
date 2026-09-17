/**
 * «Нет сервера» and «сервер не ответил» are not the same answer.
 *
 * public/shop2/app.js is also served statically, with no API behind it, so
 * Renat can walk the prototype end to end — postJSON() calls that `offline`,
 * and the screens that get it finish the demo: the checkout paints the green
 * «Заказ оформлен», «Сообщить о наличии» says «Записали ✓».
 *
 * Until 14.09.2026 postJSON() also said `offline` for a rejected fetch and for
 * any body it could not parse — which is exactly what an edge 502/504 is, and
 * what a phone that lost its signal mid-request looks like. On the real shop
 * that meant a receipt for an order nobody had paid for, and «Записали ✓» for
 * a request that had reached nobody: no stock_alerts row, and a customer
 * waiting for a letter that will never come.
 *
 * `offline` is now only 404, 405 and 501 — the three answers a static host
 * gives about /api/… . Everything else is `failed`, carries no body, and lands
 * in each caller's own «the server said no» branch.
 *
 * The functions are sliced out of app.js by source text, the way
 * tests/checkout-payonce.test.ts slices payNow(), so this tests the shop's own
 * code and not a retyped copy of it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

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

type FetchStub = () => Promise<{ status: number; json: () => Promise<unknown> }>;

/** A route that answers `status` with a parseable JSON body. */
const answers = (status: number, body: unknown): FetchStub => () =>
  Promise.resolve({ status, json: () => Promise.resolve(body) });

/** A route whose body is not JSON at all — an edge error page, a login wall. */
const html = (status: number): FetchStub => () =>
  Promise.resolve({ status, json: () => Promise.reject(new SyntaxError("Unexpected token '<'")) });

/** The connection never got there: airplane mode, a tunnel, a killed request. */
const dropped: FetchStub = () => Promise.reject(new TypeError("Failed to fetch"));

function postJSON(stub: FetchStub): Promise<Record<string, unknown>> {
  const body = `
    ${slice("postJSON")}
    return postJSON("/api/x/", { a: 1 });
  `;
  const run = new Function("fetch", body) as (f: FetchStub) => Promise<Record<string, unknown>>;
  return run(stub);
}

describe("postJSON() — «there is no API here» versus «it did not answer»", () => {
  it("says offline for the three answers a static host gives", async () => {
    for (const status of [404, 405, 501]) {
      expect([status, await postJSON(html(status))]).toEqual([status, { offline: true }]);
    }
  });

  /* A lost answer is marked `lost`; `offline` rides along with it, because the
     promo box and the points feed cannot tell the two apart and must not have
     to. What matters is that it is never a BARE offline — that is the demo's
     own answer, and the callers that can tell (payNow, notifySend) ask about
     `lost` first. */
  it("says lost — never a bare offline — when the connection dropped", async () => {
    expect(await postJSON(dropped)).toEqual({ offline: true, lost: true, status: 0 });
  });

  it("says lost for an edge 502/504 whose body is an HTML error page", async () => {
    for (const status of [500, 502, 503, 504]) {
      expect([status, await postJSON(html(status))]).toEqual([
        status,
        { offline: true, lost: true, status },
      ]);
    }
  });

  it("hands a real answer through untouched, ok or not", async () => {
    expect(await postJSON(answers(200, { ok: true, orderId: "o1" }))).toEqual({
      body: { ok: true, orderId: "o1" },
      status: 200,
    });
    expect(await postJSON(answers(409, { ok: false, error: "out_of_stock" }))).toEqual({
      body: { ok: false, error: "out_of_stock" },
      status: 409,
    });
  });
});

interface Notify {
  toasts: string[];
  /** every apiSeen() call, in order — false latches the whole page into demo */
  seen: boolean[];
  /** the form is closed only when the request really landed */
  open: string;
}

/** notifySend() over the real postJSON(), with one stubbed route. */
async function notify(stub: FetchStub): Promise<Notify> {
  const body = `
    var toasts = [], seen = [];
    var S = { notifyEmail: "maria@example.com", notifyBusy: false, notifyOpen: "p1", lang: "RU" };
    function toast(t) { toasts.push(t); }
    function render() {}
    function apiSeen(v) { seen.push(v); }
    ${slice("postJSON")}
    ${slice("notifySend")}
    notifySend("p1");
    return { toasts: toasts, seen: seen, S: S };
  `;
  const run = new Function("fetch", body) as (f: FetchStub) => { toasts: string[]; seen: boolean[]; S: { notifyOpen: string } };
  const out = run(stub);
  // one macrotask drains every microtask the chain above is waiting on
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return { toasts: out.toasts, seen: out.seen, open: out.S.notifyOpen };
}

const WROTE_IT_DOWN = "Записали — сообщим, когда появится ✓";
const TRY_AGAIN = "Не получилось — попробуйте ещё раз";

describe("«Сообщить о наличии» — «Записали ✓» only when it really was", () => {
  it("says so when the server wrote the row", async () => {
    const r = await notify(answers(200, { ok: true }));
    expect(r.toasts).toEqual([WROTE_IT_DOWN]);
    expect(r.open).toBe("");
  });

  /* The bug: a dropped request and an edge error page both looked like «no
     API here», so the shopper was told the shop would write to them. It will
     not — nothing was written. */
  it("does NOT say so when the connection dropped", async () => {
    const r = await notify(dropped);
    expect(r.toasts).toEqual([TRY_AGAIN]);
    // the form stays open with the address still in it, ready for another go
    expect(r.open).toBe("p1");
    expect(r.seen).not.toContain(false);
  });

  it("does NOT say so for an edge 502", async () => {
    const r = await notify(html(502));
    expect(r.toasts).toEqual([TRY_AGAIN]);
    expect(r.open).toBe("p1");
  });

  it("keeps its own words for a rate limit", async () => {
    const r = await notify(answers(429, { ok: false, error: "rate_limited" }));
    expect(r.toasts).toEqual(["Слишком много попыток — подождите немного"]);
  });

  /* …and the static prototype still walks: a 404 from /api/stock-alerts/ is a
     shop with no server, and the demo answers for it exactly as before. */
  it("still finishes the demo on a genuine 404", async () => {
    const r = await notify(html(404));
    expect(r.toasts).toEqual([WROTE_IT_DOWN]);
    expect(r.seen).toEqual([false]);
  });
});
