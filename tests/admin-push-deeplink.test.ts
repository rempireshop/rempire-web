/**
 * A tapped «Оплачен заказ» notification opens that order's card.
 *
 * Dim, 24.09.2026, on /test «mail-owner-ping»:
 *
 *   «When I click on the phone notification of a completed order, then it
 *   should bring me to that order — currently it just logs me in to admin.»
 *
 * Where the number was lost, link by link:
 *
 *   · the payload — `/shop2/admin/?order=R-…` (src/lib/mail-hooks.ts), right;
 *   · the worker — a closed panel is opened on that address, right; an OPEN
 *     panel was navigate()d (a reload that loses a half-typed note) or, on iOS
 *     where navigate() does not exist, merely focused on whatever screen it
 *     was left on — wrong;
 *   · the panel — pushOpenWanted() read the number, but loadSrvOrders() called
 *     it BEFORE the list it had just fetched was put into SRV.orders. On the
 *     panel's first open (and after the sign-in) there was no list to look in,
 *     the number was put aside and nothing asked again: «Обзор». This is the
 *     one that bit every time.
 *
 * The panel's functions are cut out of public/shop2/app.js and run against a
 * network the test answers by hand; the worker runs in a vm with a fake
 * `self` and fake windows.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerOrderPath } from "@/lib/mail-hooks";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");
const sw = readFileSync(fileURLToPath(new URL("../public/shop2/admin-sw.js", import.meta.url)), "utf8");

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
const opt = (name: string) => (src.includes(`function ${name}(`) ? slice(name) : "");
const ONE_DECL = (src.match(/var ORDER_ONE = \{[^\n]*\};/) || ["var ORDER_ONE = { rows: [], busy: \"\", gone: \"\", err: \"\", seq: 0 };"])[0];

const flush = () => new Promise((r) => setTimeout(r, 0));

type Order = { id: string; number: string; status: string };
type Answer = { status: number; body: Record<string, unknown> };
type Call = { url: string; method: string; body?: unknown; answer: (a: Answer) => void };

function panel(opts: { search: string; admin?: boolean | null; orders?: Order[] | null }) {
  const calls: Call[] = [];
  const replaced: string[] = [];
  const env = {
    ask: (url: string, method: string, body?: unknown) =>
      new Promise<Answer>((resolve) => { calls.push({ url, method, body, answer: resolve }); }),
    search: opts.search,
    admin: opts.admin === undefined ? true : opts.admin,
    orders: opts.orders === undefined ? null : opts.orders,
    replaced,
  };
  // This repository's own source plus fixed stub text — no outside input.
  const body = `
    function srvRow(o) { return { id: o.id, number: o.number, srv: o }; }
    var S = { adminOrder: 0, adminTab: "over", screen: "admin" };
    var SRV = { admin: env.admin, orders: env.orders ? env.orders.map(srvRow) : null, ordersErr: false, stepBusy: "", busy: false, err: "" };
    var FOUND = { q: null, want: "", rows: null, err: false, busy: false, seq: 0 };
    ${ONE_DECL}
    var PUSH = { want: null };
    var ADM_OV = { at: 0 };   // admLogin asks for the panel's own product read again (loadAdminOverrides)
    var location = { search: env.search, pathname: "/shop2/admin/", hash: "" };
    var history = { state: { y: 0 }, replaceState: function (s, t, url) { env.replaced.push(url); location.search = url.indexOf("?") >= 0 ? url.slice(url.indexOf("?")) : ""; } };
    function apiJson(url) { return env.ask(url, "GET"); }
    function apiSend(url, method, body) { return env.ask(url, method, body); }
    function render() {}
    function refocus() {}
    function noop() {}
    function pushBoot() {}
    function admOrders() { return SRV.admin === true ? SRV.orders || [] : []; }
    ${opt("admOrderRaw")}
    ${opt("loadOrderOne")}
    ${slice("loadSrvOrders")}
    ${slice("pushOpenWanted")}
    ${opt("pushOpenFrom")}
    ${slice("admLogin")}
    return {
      S: S, SRV: SRV,
      load: function () { loadSrvOrders(true); },
      login: function () { admLogin("pw"); },
      message: function (url) { pushOpenFrom(url); }
    };
  `;
  const p = new Function("env", body)(env) as {
    S: { adminOrder: string | number; adminTab: string };
    SRV: { admin: boolean | null; orders: unknown[] | null };
    load: () => void;
    login: () => void;
    message: (url: string) => void;
  };
  const find = (pred: (c: Call) => boolean) => calls.filter(pred);
  return { ...p, calls, find, replaced };
}

const isList = (c: Call) => c.method === "GET" && c.url === "/api/admin/orders/?limit=100";
const PAID: Order = { id: "u-42", number: "R-100042", status: "paid" };
const OTHER: Order = { id: "u-41", number: "R-100041", status: "shipped" };

describe("the panel opens the order the notification names", () => {
  it("on the panel's FIRST open — the list arrives after the number was read", async () => {
    const p = panel({ search: "?order=R-100042" });
    p.load();
    p.find(isList)[0].answer({ status: 200, body: { ok: true, orders: [OTHER, PAID] } });
    await flush();
    expect(p.S.adminOrder, "the tap opened «Обзор», not the order").toBe("u-42");
    expect(p.S.adminTab).toBe("orders");
  });

  it("after the sign-in, when the session had run out", async () => {
    const p = panel({ search: "?order=r-100042", admin: null });
    p.load();
    p.find(isList)[0].answer({ status: 401, body: { ok: false } });
    await flush();
    expect(p.SRV.admin).toBe(false);          // the password screen

    p.login();
    p.find((c) => c.method === "POST")[0].answer({ status: 200, body: { ok: true } });
    await flush();
    p.find(isList)[1].answer({ status: 200, body: { ok: true, orders: [PAID] } });
    await flush();
    expect(p.S.adminOrder, "the sign-in lost the order").toBe("u-42");
  });

  it("takes the number out of the address once it has opened it — a reload does not reopen it", async () => {
    const p = panel({ search: "?order=R-100042&x=1" });
    p.load();
    p.find(isList)[0].answer({ status: 200, body: { ok: true, orders: [PAID] } });
    await flush();
    expect(p.replaced).toEqual(["/shop2/admin/?x=1"]);
  });

  it("an order the list does not hold is fetched on its own, and its card opens", async () => {
    const p = panel({ search: "?order=R-100042" });
    p.load();
    p.find(isList)[0].answer({ status: 200, body: { ok: true, orders: [OTHER] } });
    await flush();
    const one = p.find((c) => c.url === "/api/admin/orders/R-100042/");
    expect(one.length).toBe(1);
    one[0].answer({ status: 200, body: { ok: true, order: PAID } });
    await flush();
    expect(p.S.adminOrder).toBe("u-42");
  });

  it("a panel that is already open is told by the worker, re-reads the list and opens the card", async () => {
    const p = panel({ search: "", orders: [OTHER] });
    p.S.adminOrder = "u-41";                    // another card is open
    p.message("https://rempireshop.com/shop2/admin/?order=R-100042");
    const list = p.find(isList);
    expect(list.length, "the open panel did nothing with the tapped address").toBe(1);
    list[0].answer({ status: 200, body: { ok: true, orders: [PAID, OTHER] } });
    await flush();
    expect(p.S.adminOrder).toBe("u-42");
  });
});

/* ---------- the service worker ------------------------------------------- */

type FakeClient = {
  url: string;
  focus: ReturnType<typeof vi.fn>;
  navigate?: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
};

/** A MessageChannel whose second port answers straight into the first. */
class FakeChannel {
  port1: { onmessage: ((e: { data: unknown }) => void) | null } = { onmessage: null };
  port2 = { postMessage: (data: unknown) => queueMicrotask(() => this.port1.onmessage?.({ data })) };
}

function worker(windows: FakeClient[]) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const opened: string[] = [];
  const self = {
    location: { origin: "https://rempireshop.com" },
    addEventListener: (type: string, fn: (e: unknown) => void) => { handlers[type] = fn; },
    clients: {
      matchAll: async () => windows,
      openWindow: async (href: string) => { opened.push(href); return null; },
      claim: async () => {},
    },
    skipWaiting: async () => {},
    registration: { showNotification: async () => {} },
  };
  vm.runInNewContext(sw, { self, URL, Promise, setTimeout, MessageChannel: FakeChannel });
  const tap = async (url: string) => {
    let done: Promise<unknown> = Promise.resolve();
    handlers.notificationclick({
      notification: { close: () => {}, data: { url } },
      waitUntil: (p: Promise<unknown>) => { done = p; },
    });
    return done;
  };
  return { tap, opened };
}

afterEach(() => { vi.useRealTimers(); });

describe("the worker hands the tap to the panel that is open", () => {
  it("focuses it and tells it the address — no reload", async () => {
    const client: FakeClient = {
      url: "https://rempireshop.com/shop2/admin/",
      focus: vi.fn(async () => client),
      navigate: vi.fn(async () => client),
      postMessage: vi.fn((msg: unknown, ports: Array<{ postMessage: (d: unknown) => void }>) => ports[0].postMessage({ ok: true })),
    };
    const w = worker([client]);
    await w.tap("/shop2/admin/?order=R-100042");
    expect(client.focus).toHaveBeenCalled();
    expect(client.postMessage).toHaveBeenCalledTimes(1);
    expect(client.postMessage.mock.calls[0][0]).toEqual({ type: "rempire:open", url: "https://rempireshop.com/shop2/admin/?order=R-100042" });
    expect(client.navigate, "the open panel was reloaded — a half-typed note is gone").not.toHaveBeenCalled();
    expect(w.opened).toEqual([]);
  });

  it("an iPhone panel (no navigate) is told too, not merely focused on the old screen", async () => {
    const client: FakeClient = {
      url: "https://rempireshop.com/shop2/admin/",
      focus: vi.fn(async () => client),
      postMessage: vi.fn((msg: unknown, ports: Array<{ postMessage: (d: unknown) => void }>) => ports[0].postMessage({ ok: true })),
    };
    await worker([client]).tap("/shop2/admin/?order=R-100042");
    expect(client.postMessage).toHaveBeenCalledTimes(1);
  });

  it("a panel that does not answer (older code in the tab) is reloaded onto the address", async () => {
    vi.useFakeTimers();
    const client: FakeClient = {
      url: "https://rempireshop.com/shop2/admin/",
      focus: vi.fn(async () => client),
      navigate: vi.fn(async () => client),
      postMessage: vi.fn(),
    };
    const w = worker([client]);
    const done = w.tap("/shop2/admin/?order=R-100042");
    await vi.advanceTimersByTimeAsync(2000);
    await done;
    expect(client.navigate).toHaveBeenCalledWith("https://rempireshop.com/shop2/admin/?order=R-100042");
  });

  it("with no panel open, a new window opens on the address itself", async () => {
    const shop: FakeClient = { url: "https://rempireshop.com/shop2/", focus: vi.fn(), postMessage: vi.fn() };
    const w = worker([shop]);
    await w.tap("/shop2/admin/?order=R-100042");
    expect(w.opened).toEqual(["https://rempireshop.com/shop2/admin/?order=R-100042"]);
    expect(shop.postMessage).not.toHaveBeenCalled();
  });
});

describe("the address the notification and the letter carry", () => {
  it("is the panel with the order NUMBER — what the notification prints", () => {
    expect(ownerOrderPath({ number: "R-100042", id: "u-42" } as never)).toBe("/shop2/admin/?order=R-100042");
  });

  it("the panel reads that very parameter", () => {
    expect(slice("pushOpenWanted")).toContain("[?&]order=");
  });

  it("the panel listens for the worker's message and answers on the port", () => {
    expect(src).toContain('navigator.serviceWorker.addEventListener("message"');
    expect(src).toContain('if (d.type !== "rempire:open") return;');
    expect(src).toContain("e.ports[0].postMessage({ ok: true })");
  });
});
