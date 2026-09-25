/**
 * An order older than the newest hundred — found, stepped and opened.
 *
 * «Заказы» fetches the hundred newest orders (SRV.orders) and, since r22, asks
 * the server when a search is typed, so the search can find ANY order the
 * shop ever took (FOUND.rows). But every action that starts from a row or a
 * card — «Отправлен», «Выдан клиенту», «Создать этикетку», the card itself —
 * looked the order up in SRV.orders alone. For an order the search found
 * beyond that hundred the step answered nothing and the card said «Заказ не
 * найден» (Dim, 24.09.2026).
 *
 * And an order in NEITHER list — a customer's old order, a notification
 * tapped a week later — is fetched on its own (GET /api/admin/orders/<id>/)
 * and kept beside the two lists, never inside SRV.orders, which eight
 * counters read as «the hundred newest».
 *
 * The panel's own functions are cut out of public/shop2/app.js by source text
 * and run against a network the test answers by hand
 * (tests/admin-order-step-once.test.ts's technique).
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
/** A helper the lookup may be built from — cut out when app.js has it. */
const opt = (name: string) => (src.includes(`function ${name}(`) ? slice(name) : "");

/** One `if (…) { … }` branch of the panel's click dispatcher. */
function branch(head: string): string {
  const start = src.indexOf(head);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has the branch «${head}»`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in the branch «${head}»`);
}

const flush = () => new Promise((r) => setTimeout(r, 0));

type Order = {
  id: string;
  number: string;
  status: string;
  name?: string;
  total?: number;
  channel?: string;
  shipping?: Record<string, unknown>;
};
type Answer = { status: number; body: Record<string, unknown> };
type Call = { url: string; method: string; body?: unknown; answer: (a: Answer) => void; fail: () => void };
type Row = { id: string; number: string; srv: Order };
type VM = { id: string; number: string; status: string } | null;

const ONE_DECL = (src.match(/var ORDER_ONE = \{[^\n]*\};/) || [""])[0];
const SHIP_ERR = src.slice(src.indexOf("var SHIP_ERR = {"), src.indexOf("};", src.indexOf("var SHIP_ERR = {")) + 2);

function panel(opts: { orders: Order[]; found?: { q: string; rows: Order[] }; want?: string }) {
  const calls: Call[] = [];
  const toasts: string[] = [];
  const applied: Record<string, unknown>[] = [];
  const env = {
    ask: (url: string, method: string, body?: unknown) =>
      new Promise<Answer>((resolve, reject) => {
        calls.push({ url, method, body, answer: resolve, fail: () => reject(new Error("offline")) });
      }),
    toast: (m: string) => toasts.push(m),
    applied,
    orders: opts.orders,
    found: opts.found || null,
    search: opts.want || "",
  };
  const body = `
    function srvRow(o) {
      return { id: o.id, number: o.number, who: o.name || "—", date: "", items: 1, sum: o.total || 0,
        ship: "", state: ["paid", "оплачен", ""], srv: o };
    }
    var S = { adminOrder: 0, adminTab: "orders", lang: "RU", admGiftCards: null, admOrderQ: env.found ? env.found.q : "" };
    var SRV = { admin: true, orders: env.orders.map(srvRow), ordersErr: false, stepBusy: "", shipBusy: false };
    var FOUND = env.found
      ? { q: env.found.q, want: env.found.q, rows: env.found.rows.map(srvRow), err: false, busy: false, seq: 1 }
      : { q: null, want: "", rows: null, err: false, busy: false, seq: 0 };
    var PUSH = { want: null };
    var location = { search: env.search };
    var pendingAction = null;
    var shipRollback = null, flowCountsAt = 0, reportSummaryAt = 0;
    ${ONE_DECL}
    ${SHIP_ERR}
    function apiJson(url) { return env.ask(url, "GET"); }
    function apiSend(url, method, body) { return env.ask(url, method, body); }
    function render() {}
    function refocus() {}
    function toast(m) { env.toast(m); }
    function demoApply(a) { env.applied.push(a); if (a.type === "order_status") srvPush(a, { a: a }); return { a: a }; }
    function journalDrop() {}
    function pushBoot() {}
    function loadOverview() {}
    function scanStockChanged() {}
    function countryName(c) { return c; }
    function admShipBody(id) { return { orderId: id }; }
    function admShipSpent() {}
    function admShipClear() {}
    function admBackHTML(attrs, label) { return "<back " + attrs + ">" + label + "</back>"; }
    function admOrderCardHTML() { var v = admCurOrder(); return v ? "<card>" + v.number + "</card>" : "<missing>"; }
    function admOrders() { return SRV.admin === true ? SRV.orders || [] : []; }
    function admRefundView() { return { refunded: 0, refundable: 0, pending: 0 }; }
    function admInvoiceOverdue() { return 0; }
    function admReturnAskedAt() { return ""; }
    function admReturnDoneAt() { return ""; }
    ${slice("admOrderVM")}
    ${slice("shipRegFailed")}
    ${slice("admShipConfirmText")}
    ${slice("srvMsg")}
    ${slice("shipCourierErr")}
    ${opt("admOrderRaw")}
    ${slice("admCurOrder")}
    ${slice("admOrderById")}
    ${slice("admOrderQClean")}
    ${slice("loadOrderSearch")}
    ${slice("loadSrvOrders")}
    ${opt("loadOrderOne")}
    ${opt("admOrderOneWait")}
    ${opt("admOrderMissingHTML")}
    ${opt("admOrderListsReload")}
    ${slice("admOrdersChanged")}
    ${slice("admOrderLand")}
    ${slice("srvPush")}
    ${slice("srvCreateShipment")}
    ${slice("admCustOrderCardHTML")}
    ${slice("pushOpenWanted")}
    function click(d) {
      ${branch("if (d.admlabel) {")}
      ${branch("if (d.admdelivered) {")}
      ${branch("if (d.admshipnow) {")}
    }
    return {
      S: S, SRV: SRV, FOUND: FOUND,
      click: click,
      card: function () { return admCurOrder(); },
      byId: function (id) { return admOrderById(id); },
      pending: function () { return pendingAction; },
      one: function () { return typeof ORDER_ONE === "undefined" ? null : ORDER_ONE; },
      missing: function (head) { return admOrderMissingHTML(head); },
      custCard: function () { return admCustOrderCardHTML(); },
      changed: function () { admOrdersChanged(); },
      openWanted: function () { pushOpenWanted(); }
    };
  `;
  const p = new Function("env", body)(env) as {
    S: { adminOrder: string | number; adminTab: string };
    SRV: { orders: Row[] | null; stepBusy: string; shipBusy: boolean };
    FOUND: { rows: Row[] | null };
    click: (d: Record<string, string>) => void;
    card: () => VM;
    byId: (id: string) => VM;
    pending: () => { id: string; value: string } | null;
    one: () => { rows: Row[] } | null;
    missing: (head: string) => string;
    custCard: () => string;
    changed: () => void;
    openWanted: () => void;
  };
  const find = (pred: (c: Call) => boolean) => calls.filter(pred);
  return { ...p, calls, toasts, applied, find };
}

/* The newest hundred — one order is enough to stand for it. */
const NEW: Order = { id: "u-new", number: "R-100500", status: "paid", shipping: { method: "parcel" } };
/* Three orders the search found, none of them among the hundred. */
const PICKUP: Order = { id: "u-old", number: "R-000123", status: "paid", name: "Мари Тамм", shipping: { method: "pickup" } };
const LABELLED: Order = {
  id: "u-lab", number: "R-000124", status: "paid", name: "Kati Saar",
  shipping: { method: "parcel", montonio: { shipmentId: "s-1", trackingCode: "EE123" } },
};
const NO_LABEL: Order = { id: "u-nolab", number: "R-000125", status: "paid", shipping: { method: "parcel" } };
const SEARCHED = { q: "R-0001", rows: [PICKUP, LABELLED, NO_LABEL] };
/* …and one in neither list: a customer's order from last year. */
const OLDER: Order = { id: "u-older", number: "R-000001", status: "shipped", shipping: { method: "parcel" } };

const isSearch = (c: Call) => c.method === "GET" && /[?&]q=/.test(c.url);
const isOne = (key: string) => (c: Call) => c.method === "GET" && c.url === `/api/admin/orders/${key}/`;

describe("an order the search found beyond the newest hundred", () => {
  it("opens its card", () => {
    const p = panel({ orders: [NEW], found: SEARCHED });
    p.S.adminOrder = "u-old";
    expect(p.card()?.number, "the card looked in the newest hundred only").toBe("R-000123");
  });

  it("«Выдан клиенту» on its row steps it — one tap, one PATCH", async () => {
    const p = panel({ orders: [NEW], found: SEARCHED });
    p.click({ admdelivered: "u-old" });
    expect(p.applied, "the tap did nothing").toEqual([
      { type: "order_status", id: "u-old", number: "R-000123", value: "delivered", prev: "paid" },
    ]);
    expect(p.toasts).toEqual(["R-000123 выдан клиенту"]);
    const patch = p.find((c) => c.method === "PATCH");
    expect(patch.map((c) => [c.url, c.body])).toEqual([["/api/admin/orders/u-old/", { status: "delivered" }]]);

    // the status the server answered with lands in the search's own row at once…
    patch[0].answer({ status: 200, body: { ok: true, order: { ...PICKUP, status: "delivered" } } });
    await flush();
    expect(p.FOUND.rows?.find((r) => r.id === "u-old")?.srv.status).toBe("delivered");
    expect(p.SRV.stepBusy).toBe("");
    // …and the search itself is asked again, not only the newest hundred
    expect(p.find(isSearch).length).toBe(1);
  });

  it("«Отправлен» on a labelled row applies at once", () => {
    const p = panel({ orders: [NEW], found: SEARCHED });
    p.click({ admshipnow: "u-lab" });
    expect(p.applied).toEqual([
      { type: "order_status", id: "u-lab", number: "R-000124", value: "shipped", prev: "paid" },
    ]);
  });

  it("«Отправлен» without a label asks first, about this order", () => {
    const p = panel({ orders: [NEW], found: SEARCHED });
    p.click({ admshipnow: "u-nolab" });
    expect(p.pending()).toMatchObject({ type: "order_status", id: "u-nolab", number: "R-000125", value: "shipped" });
  });

  it("«Создать этикетку» names the order and re-reads the search it came from", async () => {
    const p = panel({ orders: [NEW], found: SEARCHED });
    p.click({ admlabel: "u-nolab" });
    const post = p.find((c) => c.method === "POST");
    expect(post.map((c) => [c.url, c.body])).toEqual([["/api/admin/shipments/", { orderId: "u-nolab" }]]);
    post[0].answer({ status: 200, body: { ok: true, shipment: { trackingCode: "EE9" } } });
    await flush();
    expect(p.applied[0]).toMatchObject({ type: "order_label", id: "u-nolab", number: "R-000125" });
    expect(p.toasts).toEqual(["Этикетка готова ✓"]);
    expect(p.find(isSearch).length, "the row kept offering «Создать этикетку» — the search was never re-read").toBe(1);
  });

  it("an order in both lists is still the newest hundred's copy", () => {
    const p = panel({ orders: [NEW, PICKUP], found: { q: "R-0001", rows: [{ ...PICKUP, status: "new" }] } });
    expect(p.byId("u-old")?.status).toBe("paid");
  });
});

describe("an order in neither list is fetched on its own", () => {
  it("the card shows bars, asks for that one order, then opens on it", async () => {
    const p = panel({ orders: [NEW] });
    p.S.adminOrder = "u-older";
    expect(p.missing("<head>")).toContain("adm-skel");
    expect(p.find(isOne("u-older")).length).toBe(1);
    p.missing("<head>");
    expect(p.find(isOne("u-older")).length, "one question, not one per render").toBe(1);

    p.find(isOne("u-older"))[0].answer({ status: 200, body: { ok: true, order: OLDER } });
    await flush();
    expect(p.card()?.number).toBe("R-000001");
    // beside the hundred, never inside it: «Отправить N» and the rest count SRV.orders
    expect(p.SRV.orders?.map((r) => r.id)).toEqual(["u-new"]);
  });

  it("says «Заказ не найден» when the shop has no such order", async () => {
    const p = panel({ orders: [NEW] });
    p.S.adminOrder = "u-gone";
    p.missing("<head>");
    p.find(isOne("u-gone"))[0].answer({ status: 404, body: { ok: false, error: "not_found" } });
    await flush();
    const html = p.missing("<head>");
    expect(html).toContain("Заказ не найден");
    expect(p.find(isOne("u-gone")).length).toBe(1);
  });

  it("…and «Повторить» — not «не найден» — when the server did not answer", async () => {
    const p = panel({ orders: [NEW] });
    p.S.adminOrder = "u-older";
    p.missing("<head>");
    p.find(isOne("u-older"))[0].fail();
    await flush();
    const html = p.missing("<head>");
    expect(html).not.toContain("Заказ не найден");
    expect(html).toContain('data-admreload="order"');
  });

  it("a step on it lands on its own copy, and the copy is read again", async () => {
    const p = panel({ orders: [NEW] });
    p.S.adminOrder = "u-older";
    p.missing("<head>");
    p.find(isOne("u-older"))[0].answer({ status: 200, body: { ok: true, order: OLDER } });
    await flush();

    p.click({ admdelivered: "u-older" });
    expect(p.applied).toMatchObject([{ type: "order_status", id: "u-older", value: "delivered", prev: "shipped" }]);
    p.find((c) => c.method === "PATCH")[0].answer({ status: 200, body: { ok: true, order: { ...OLDER, status: "delivered" } } });
    await flush();
    expect(p.card()?.status).toBe("delivered");
    expect(p.find(isOne("u-older")).length, "the write did not re-read the order it moved").toBe(2);
  });

  it("the customer card's old order goes the same way — and does not join the hundred", async () => {
    const p = panel({ orders: [NEW] });
    p.S.adminOrder = "u-older";
    expect(p.custCard()).toContain("adm-skel");
    expect(p.custCard()).toContain("К клиенту");
    p.find(isOne("u-older"))[0].answer({ status: 200, body: { ok: true, order: OLDER } });
    await flush();
    expect(p.custCard()).toBe("<card>R-000001</card>");
    expect(p.SRV.orders?.map((r) => r.id)).toEqual(["u-new"]);

    // a reload of the hundred (any write does one) no longer loses it
    p.changed();
    p.find((c) => c.url === "/api/admin/orders/?limit=100")[0].answer({ status: 200, body: { ok: true, orders: [NEW] } });
    await flush();
    expect(p.custCard()).toBe("<card>R-000001</card>");
  });

  it("the order card routes a missing order through the same fallback", () => {
    expect(slice("admOrderCardHTML")).toMatch(/if \(!v\) return admOrderMissingHTML\(/);
  });
});

describe("a notification for an order older than the hundred", () => {
  it("opens its card once the order has come", async () => {
    const p = panel({ orders: [NEW], want: "?order=r-000001" });
    p.openWanted();
    expect(p.S.adminTab).toBe("orders");
    const one = p.find(isOne("R-000001"));
    expect(one.length).toBe(1);
    one[0].answer({ status: 200, body: { ok: true, order: OLDER } });
    await flush();
    expect(p.S.adminOrder).toBe("u-older");
    expect(p.card()?.number).toBe("R-000001");
  });

  it("an order among the hundred opens straight away, by its number", () => {
    const p = panel({ orders: [NEW], want: "?order=R-100500" });
    p.openWanted();
    expect(p.S.adminOrder).toBe("u-new");
    expect(p.calls.length).toBe(0);
  });

  it("an order the shop no longer has leaves «Заказы» open, not an empty card", async () => {
    const p = panel({ orders: [NEW], want: "?order=R-999999" });
    p.openWanted();
    p.find(isOne("R-999999"))[0].answer({ status: 404, body: { ok: false, error: "not_found" } });
    await flush();
    expect(p.S.adminOrder).toBe(0);
    expect(p.S.adminTab).toBe("orders");
  });
});
