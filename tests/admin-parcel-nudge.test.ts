/**
 * The panel's half of the readiness pass of 27.09.2026 — what Renat SEES:
 *
 *   B13  the carrier already has the parcel (in transit, in the machine, even
 *        delivered) and the order still says «оплачен», so the customer never
 *        got the letter with the tracking number. «Обзор» says so in «Сделать
 *        сегодня», and the order card's next step says the parcel is already
 *        on its way. Since 28.09.2026 (the owner's decision) the carrier's
 *        scan ships such an order by itself (src/lib/ship-order.ts,
 *        tests/carrier-autoship.test.ts), so the nudge is left for what the
 *        scan cannot close: a word outside Montonio's documented three, or an
 *        order shipped and taken back by hand.
 *   B14  a parcel nobody collected is coming back: a chip on the row, a tag
 *        and a sentence in «Посылка», the card's next step, a journal word.
 *   B11  the nightly job has stopped: a red row at the top of «Сделать
 *        сегодня», opening «Письма».
 *
 * Functions are cut out of public/shop2/app.js by source text and run over
 * stubs — the technique of tests/admin-toship.test.ts and
 * tests/admin-ux1a-orders.test.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
function block(head: string): string {
  const start = app.indexOf(head);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has «${head}»`);
  let depth = 0;
  for (let i = app.indexOf("{", start); i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}" && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after «${head}»`);
}

type V = Record<string, unknown>;

/* ---------- the order's view model: what the carrier's word means ---------- */

// This repository's own source plus fixed stub text.
const vm = new Function(`
  ${fn("admOrderVM")}
  ${fn("shipRegFailed")}
  ${fn("admRefundView")}
  ${fn("admReturnAskedAt")}
  ${fn("admReturnDoneAt")}
  function admRefundedTotal() { return 0; }
  function admRefunds() { return []; }
  function admInvoiceOverdue() { return 0; }
  return admOrderVM;
`)() as (o: V) => V;

function order(status: string, montonio: V | null, method = "parcel", shipping: V = {}): V {
  return {
    id: "o1", number: "R-100001", who: "Мария Тамм", date: "", items: 1, sum: 50, ship: "", state: ["new"],
    srv: { id: "o1", status, channel: "web", shipping: { method, country: "EE", ...shipping, ...(montonio ? { montonio } : {}) } },
  };
}
const mont = (status: string, extra: V = {}) => ({ provider: "montonio", shipmentId: "shp-1", status, ...extra });

describe("the carrier's word, read once in the order's view model", () => {
  it("handed over — in transit, in the machine, delivered — is `carrierHas`", () => {
    for (const word of ["inTransit", "awaitingCollection", "delivered", "DELIVERED", "picked_up", "handed-over", "collected", "completed"]) {
      expect(vm(order("paid", mont(word))).carrierHas, word).toBe(true);
    }
  });

  it("not yet handed over — pending, registered, labels, a refusal, a word nobody knows — is not", () => {
    for (const word of ["pending", "registered", "labelsCreated", "registrationFailed", "", "something_new"]) {
      expect(vm(order("paid", mont(word))).carrierHas, word).toBe(false);
    }
  });

  it("coming back is `parcelBack`, never `carrierHas` — the same spellings the server's looksReturned() takes", () => {
    for (const word of ["returned", "RETURNED", "return", "returning", "returned_to_sender", "return-to-sender"]) {
      const v = vm(order("shipped", mont(word)));
      expect(v.parcelBack, word).toBe(true);
      expect(v.carrierHas, word).toBe(false);
    }
    expect(vm(order("shipped", mont("inTransit"))).parcelBack).toBe(false);
  });

  it("a label the journal set aside says nothing about a parcel", () => {
    const v = vm(order("paid", mont("inTransit", { dismissed: true })));
    expect(v.carrierHas).toBe(false);
    expect(v.parcelBack).toBe(false);
    expect(vm(order("paid", null)).carrierHas).toBe(false);
  });

  it("the status is not touched: a paid order the carrier has is still in «Отправить»", () => {
    const v = vm(order("paid", mont("delivered")));
    expect(v.status).toBe("paid");
    expect(v.toShip).toBe(true);
  });

  /* 28.09.2026: the server ships these by itself — the same rule as
     carrierHasParcel() + shippedBefore() in src/lib/ship-order.ts. */
  it("`scanShips` — Montonio's three words exactly, on a label in use, never shipped before", () => {
    for (const word of ["inTransit", "awaitingCollection", "delivered", "INTRANSIT"]) {
      expect(vm(order("paid", mont(word))).scanShips, word).toBe(true);
    }
    // the looser reading still counts as «the carrier has it», but the scan rule does not take it
    for (const word of ["in_transit", "picked_up", "completed", "handed-over", "delivered_to_locker"]) {
      const v = vm(order("paid", mont(word)));
      expect(v.carrierHas, word).toBe(true);
      expect(v.scanShips, word).toBe(false);
    }
    for (const word of ["registered", "labelsCreated", "returned", ""]) expect(vm(order("paid", mont(word))).scanShips, word).toBe(false);
    // pressed and taken back by hand: the owner's, not the scan's
    expect(vm(order("paid", mont("inTransit"), "parcel", { shippedAt: "2026-09-27T10:00:00.000Z" })).scanShips).toBe(false);
    expect(vm(order("paid", mont("inTransit", { dismissed: true }))).scanShips).toBe(false);
  });

  it("`byScan` — «Отправлен» set by the carrier's scan", () => {
    expect(vm(order("shipped", mont("inTransit", { autoShippedAt: "2026-09-28T07:00:00.000Z" }))).byScan).toBe(true);
    expect(vm(order("shipped", mont("inTransit"))).byScan).toBe(false);
    expect(vm(order("shipped", null)).byScan).toBe(false);
  });
});

describe("the progress line", () => {
  // This repository's own source plus fixed stub text.
  const steps = new Function(`${fn("admOrderSteps")} return admOrderSteps;`)() as (v: V) => string;
  const sv = (over: V) => ({ paid: false, shipped: true, delivered: false, pickup: false, labeled: true, byScan: false, ...over });

  it("says «по скану» under «Отправлен» when the carrier's scan set it — and nothing when a press did", () => {
    expect(steps(sv({ byScan: true }))).toContain('<span class="adm-prog__l">Отправлен</span><span class="adm-prog__c">по скану</span>');
    expect(steps(sv({ byScan: true, shipped: false, delivered: true }))).toContain("по скану");
    expect(steps(sv({}))).not.toContain("по скану");
    // not before it happened
    expect(steps(sv({ byScan: true, shipped: false, paid: true }))).not.toContain("по скану");
  });
});

/* ---------- the card: its next step, its parcel ---------------------------- */

// This repository's own source plus fixed stub text.
const card = new Function(`
  var SRV = { shipBusy: false, stepBusy: "", invoiceBusy: false, refundBusy: false, invPaidBusy: "" };
  var S = { admOrderMore: "", adminOrder: "" };
  function esc(s) { return String(s == null ? "" : s); }
  function admShipPrepHTML(v) { return "<prep " + v.id + ">"; }
  function admInvoiceStateHTML(v) { return "<invoice-line>"; }
  ${fn("admInvPaidBtnHTML")}
  ${fn("admOrderStepBtn")}
  ${fn("admOrderNext")}
  return admOrderNext;
`)() as (v: V) => Record<string, string>;

const base = { id: "o1", number: "R-100001", who: "Maria", status: "paid", paid: true, unpaid: false, shipped: false,
  delivered: false, pos: false, digital: false, pickup: false, labeled: true, shipRefused: false, held: false,
  invoice: null, refundable: 0, carrierHas: false, parcelBack: false, srv: { status: "paid", email: "m@example.com" } };
const v = (over: V = {}) => ({ ...base, ...over });

describe("«Следующий шаг» on the card", () => {
  it("B13: the carrier has it with a word the scan rule does not take — the same button, and why it is overdue", () => {
    const nx = card(v({ carrierHas: true }));
    expect(nx.key).toBe("ship");                                   // the «?» hint keeps its key
    expect(nx.title).toBe("Посылка уже в пути");
    expect(nx.sub).toBe("Нажмите «Отправлен», чтобы покупатель получил трек-номер.");
    expect(nx.btn).toContain('data-admshipnow="o1"');
    expect(nx.btn).toContain(">Отправлен<");
  });

  it("28.09.2026: the carrier has it and the scan rule takes it — the shop does it; the button stays as the fallback", () => {
    const nx = card(v({ carrierHas: true, scanShips: true }));
    expect(nx.title).toBe("Посылка уже в пути");
    expect(nx.sub).toBe("Перевозчик её принял — «Отправлен» и письмо с трек-номером магазин сделает сам.");
    expect(nx.btn).toContain('data-admshipnow="o1"');
  });

  it("…and before the carrier has it: drop it off, the scan does the rest", () => {
    const nx = card(v());
    expect(nx.title).toBe("Отнести посылку");
    expect(nx.sub).toBe("Сдайте посылку — после скана перевозчика заказ сам станет «Отправлен».");
    expect(nx.help).toBe(
      "Наклейте этикетку и отнесите посылку в пакомат — курьера вызывают в панели Montonio. Когда перевозчик отсканирует посылку, заказ сам станет «Отправлен» и клиенту уйдёт письмо «Заказ отправлен» с трек-номером. Нажимать «Отправлен» нужно, только если посылка ушла без скана.",
    );
    // the press is still there, for a parcel that left without a scan
    expect(nx.btn).toContain(">Отправлен<");
  });

  it("B14: a shipped parcel coming back — what is going on and what is his to do; «Доставлен» stays", () => {
    const nx = card(v({ status: "shipped", paid: false, shipped: true, parcelBack: true }));
    expect(nx.title).toBe("Посылка возвращается");
    expect(nx.sub).toBe("Покупатель её не забрал. Свяжитесь с ним: отправить заново или вернуть деньги.");
    expect(nx.btn).toContain('data-admdelivered="o1"');
    expect(card(v({ status: "shipped", paid: false, shipped: true })).title).toBe("Ждём доставки");
  });

  it("B14: coming back on an order never marked sent — no «Отправлен», which would mail a tracking number for it", () => {
    const nx = card(v({ parcelBack: true }));
    expect(nx.title).toBe("Посылка возвращается");
    expect(nx.btn).toBeUndefined();
  });
});

describe("«Посылка» and the row's chips", () => {
  // This repository's own source plus fixed stub text.
  const box = new Function("V", `
    var SRV = { shipBusy: false };
    ${fn("esc")}
    function carrierWord(c) { return c ? String(c) : ""; }
    function srvAddrLine(s) { return (s && s.pointName) || ""; }
    function admSecHeadHTML(t, k, h, extra) { return "<h2>" + t + "</h2>" + (extra || ""); }
    function admTagHTML(kind, text) { return '<span class="adm-tag ' + kind + '">' + text + "</span>"; }
    ${fn("shipRegFailed")}
    ${fn("admShipmentBoxHTML")}
    return admShipmentBoxHTML(V);
  `) as (v: V) => string;
  const withMont = (m: V, extra: V = {}) => ({ id: "o1", srv: { shipping: { montonio: m, pointName: "Kristiine" } }, ...extra });

  it("B14: a tag and one sentence; the tracking code stays", () => {
    const html = box(withMont(mont("returned", { trackingCode: "CC1EE" }), { parcelBack: true }));
    expect(html).toContain('<span class="adm-tag alert">Возвращается</span>');
    expect(html).toContain("Покупатель не забрал посылку — перевозчик везёт её обратно в магазин. Свяжитесь с покупателем.");
    expect(html).toContain("data-trackingcode");
    expect(box(withMont(mont("inTransit", { trackingCode: "CC1EE" })))).not.toContain("Возвращается");
  });

  // This repository's own source plus fixed stub text.
  const chips = new Function(`${fn("admReturnBadge")} return admReturnBadge;`)() as (v: V) => string;

  it("B14: «Посылка возвращается» on the row while the order is open; gone once it is closed", () => {
    expect(chips({ status: "shipped", parcelBack: true })).toBe('<span class="adm-badge adm-tag adm-badge--warn">Посылка возвращается</span>');
    expect(chips({ status: "paid", parcelBack: true })).toContain("Посылка возвращается");
    expect(chips({ status: "refunded", parcelBack: true })).toBe("");
    expect(chips({ status: "delivered", parcelBack: true })).toBe("");
    expect(chips({ status: "shipped", parcelBack: false })).toBe("");
    // the customer's own return request keeps its chip
    expect(chips({ status: "delivered", returnAskedAt: "2026-09-20" })).toContain("Просит возврат");
  });

  it("B14: the journal names the row in words", () => {
    const words = new Function(`return (${block("var AUDIT_WORDS = {").replace(/^var AUDIT_WORDS = /, "")});`)() as Record<string, string>;
    expect(words["shipment.returned"]).toBe("Посылка возвращается — покупатель не забрал");
    expect(words["shipment.closed_moving"]).toBe("Посылка едет, а заказ отменён или деньги возвращены");
  });

  it("28.09.2026: the journal says «Отправлен — по скану перевозчика» for the scan's move, and nothing new for a press", () => {
    // This repository's own source plus fixed stub text.
    const text = new Function(`
      function esc(s) { return String(s == null ? "" : s); }
      function admPiecesHTML(s) { return "<p>" + s + "</p>"; }
      var ${block("var AUDIT_WORDS = {").replace(/^var /, "")};
      var AUDIT_SETTING_WORDS = {};
      ${fn("auditTextHTML")}
      return auditTextHTML;
    `)() as (row: V) => string;
    const row = (payload: V) => ({ action: "order.status", payload: { id: "o1", number: "R-100098", from: "paid", to: "shipped", ...payload } });
    expect(text(row({ via: "carrier", carrierStatus: "inTransit" }))).toBe("<span>Отправлен — по скану перевозчика</span>: R-100098");
    expect(text(row({}))).toBe("<span>Статус заказа</span>: R-100098");
    expect(text(row({ via: "carrier", to: "delivered" }))).toBe("<span>Статус заказа</span>: R-100098");
  });
});

/* ---------- «Обзор» → «Сделать сегодня» ----------------------------------- */

function overview(data: unknown, orders: V[]): string {
  // This repository's own source plus fixed stub text.
  return new Function("DATA", "ORDERS", `
    var S = { lang: "RU" };
    var SRV = { admin: true, orders: ORDERS, ordersErr: false };
    var OVERVIEW = { data: DATA, err: null };
    var ANALYTICS = {};
    function esc(s) { return String(s == null ? "" : s); }
    function pl(n, a, b, c) { return n === 1 ? a : n > 1 && n < 5 ? b : c; }
    function eur(n) { return n + " €"; }
    function loadOverview() {}
    function admOrders() { return ORDERS || []; }
    function admOrderVM(o) { return o; }
    function admLiveToShip() { return (ORDERS || []).filter(function (v) { return v.toShip; }); }
    function admWaitingCount() { return admLiveToShip().length; }
    function admReturnsAsked() { return []; }
    function admInvoicesWaiting() { return []; }
    function companyIban() { return "EE00"; }
    function admHeldOrders() { return []; }
    function admTodayTakings() { return { sum: 0, n: 0, pos: 0 }; }
    function admShopDay() { return "2026-09-27"; }
    function admShopDayAdd(d) { return d; }
    function admHead(k, t, right) { return "<head>" + t + (right || "") + "</head>"; }
    function admDateLine() { return ""; }
    function admRecentRow(v) { return "<recent>"; }
    function admProdName(s) { return s; }
    function admSecHeadHTML(t) { return "<h2>" + t + "</h2>"; }
    function admPinnedHTML(attrs, label) { return '<div class="adm-pin"><button ' + attrs + ">" + label + "</button></div>"; }
    function admOrdersLabel(n) { return n + " " + pl(n, "заказ", "заказа", "заказов"); }
    function admCatalogList() { return []; }
    ${fn("admShipAllLabel")}
    ${fn("admSkelHTML")}
    ${fn("admReviewWho")}
    ${fn("admTaskRow")}
    ${fn("admLowRows")}
    ${fn("admOverviewHTML")}
    return admOverviewHTML();
  `)(data, orders) as string;
}
const SUMMARY = {
  attention: { ordersToShip: 0, proRequests: 0, reviewsPending: 0, stockAlerts: 0, returnRequests: 0 },
  lowStock: { total: 0, low: 0, out: 0, items: [] },
  revenue7d: { total: 0, orders: 0, perDay: 0 },
  revenueByDay: [],
  attentionNames: {},
};
/** The rows of «Сделать сегодня», each as its opening tag and its words. */
function todo(html: string): Array<{ attrs: string; big: string; words: string; sub: string }> {
  const at = html.indexOf('<section class="adm-ov__todo">');
  const end = html.indexOf("</section>", at);
  return [...html.slice(at, end).matchAll(
    /<button class="adm-row adm-row--click adm-todo" ([^>]*)><span class="adm-row__big[^"]*">([^<]*)<\/span><span class="adm-row__body"><span class="adm-row__nm adm-todo__t"[^>]*>([^<]*)<\/span>(?:<span class="adm-row__sub[^"]*">([^<]*)<\/span>)?/g,
  )].map((m) => ({ attrs: m[1], big: m[2], words: m[3], sub: m[4] ?? "" }));
}
const vmOf = (id: string, who: string, over: V) => ({ id, who, toShip: true, labeled: true, carrierHas: false, ...over });

describe("«Сделать сегодня»", () => {
  it("B13: one parcel the carrier has — a rust row naming the customer, opening that order's card", () => {
    const rows = todo(overview(SUMMARY, [vmOf("o-7", "Мария Тамм", { carrierHas: true }), vmOf("o-8", "Anna Saar", {})]));
    const nudge = rows.find((r) => r.words.includes("уже в пути"))!;
    expect(nudge).toEqual({ attrs: 'data-admorder="o-7"', big: "1", words: "посылка уже в пути — нажмите «Отправлен»", sub: "Мария Тамм" });
    // …and the ordinary queue row still counts both, first
    expect(rows[0].attrs).toBe('data-admtab="orders" data-admfilter="new"');
    expect(rows[0].big).toBe("2");
  });

  it("B13: several — «Отправить», the chip they are on", () => {
    const rows = todo(overview(SUMMARY, [
      vmOf("o-1", "A", { carrierHas: true }), vmOf("o-2", "B", { carrierHas: true }), vmOf("o-3", "C", { carrierHas: true }),
    ]));
    const nudge = rows.find((r) => r.words.includes("уже в пути"))!;
    expect(nudge).toMatchObject({ big: "3", words: "посылки уже в пути — нажмите «Отправлен»", sub: "A · B · C" });
    expect(nudge.attrs).toBe('data-admtab="orders" data-admfilter="new"');
    expect(overview(SUMMARY, [vmOf("o-1", "A", { carrierHas: true })])).toContain('adm-row__big adm-row__big--warn">1<');
  });

  it("B13: nothing when the carrier has nothing — or when the order is already «Отправлен»", () => {
    expect(overview(SUMMARY, [vmOf("o-1", "A", {})])).not.toContain("уже в пути");
    expect(overview(SUMMARY, [vmOf("o-1", "A", { toShip: false, carrierHas: true })])).not.toContain("уже в пути");
  });

  it("28.09.2026: nothing for a parcel the carrier's scan will ship by itself — only for what it cannot", () => {
    expect(overview(SUMMARY, [vmOf("o-1", "A", { carrierHas: true, scanShips: true })])).not.toContain("уже в пути");
    const rows = todo(overview(SUMMARY, [
      vmOf("o-1", "A", { carrierHas: true, scanShips: true }), vmOf("o-2", "B", { carrierHas: true }),
    ]));
    expect(rows.find((r) => r.words.includes("уже в пути"))).toMatchObject({ big: "1", sub: "B", attrs: 'data-admorder="o-2"' });
  });

  it("B11: the nightly job stopped — red, first, and it opens «Письма»", () => {
    const stale = { ...SUMMARY, cron: { lastRunAt: "2026-09-25T07:00:00.000Z", stale: true } };
    const rows = todo(overview(stale, [vmOf("o-1", "A", {})]));
    expect(rows[0]).toEqual({
      attrs: 'data-admtab="mail"', big: "!",
      words: "Ночная проверка не запускалась больше суток",
      sub: "Письма, сверка оплат и посылок не идут — напишите Диму",
    });
    expect(overview(stale, [])).toContain('adm-row__big adm-row__big--warn">!<');
    const never = todo(overview({ ...SUMMARY, cron: { lastRunAt: null, stale: true } }, []));
    expect(never[0].words).toBe("Ночная проверка ещё ни разу не запускалась");
  });

  it("B11: a job that ran, or a summary that does not say, draws nothing — «Всё в порядке» stays", () => {
    const fine = overview({ ...SUMMARY, cron: { lastRunAt: "2026-09-27T07:00:00.000Z", stale: false } }, []);
    expect(fine).not.toContain("Ночная проверка");
    expect(fine).toContain("Всё в порядке");
    expect(overview({ ...SUMMARY, cron: null }, [])).toContain("Всё в порядке");
    expect(overview(SUMMARY, [])).toContain("Всё в порядке");
  });

  it("B11: «mail» is a section the panel has — the tap does not fall back to «Обзор»", () => {
    const sections = new Function(`${block("var ADM_SECTION_OF = {")}; return ADM_SECTION_OF;`)() as Record<string, string>;
    expect(sections.mail).toBe("promos");
  });
});

describe("every new word has an Estonian and an English line", () => {
  const UI = new Function(`return (${block("var UI = {").replace(/^var UI = /, "")});`)() as Record<"ET" | "EN", Record<string, string>>;
  it.each([
    "посылка уже в пути — нажмите «Отправлен»",
    "посылки уже в пути — нажмите «Отправлен»",
    "посылок уже в пути — нажмите «Отправлен»",
    "Ночная проверка не запускалась больше суток",
    "Ночная проверка ещё ни разу не запускалась",
    "Письма, сверка оплат и посылок не идут — напишите Диму",
    "Посылка уже в пути",
    "Нажмите «Отправлен», чтобы покупатель получил трек-номер.",
    "Посылка возвращается",
    "Возвращается",
    "Покупатель не забрал посылку — перевозчик везёт её обратно в магазин. Свяжитесь с покупателем.",
    "Покупатель её не забрал. Свяжитесь с ним: отправить заново или вернуть деньги.",
    "Посылка возвращается — покупатель не забрал",
    // 28.09.2026: the carrier's scan ships the order
    "Сдайте посылку — после скана перевозчика заказ сам станет «Отправлен».",
    "Перевозчик её принял — «Отправлен» и письмо с трек-номером магазин сделает сам.",
    "Наклейте этикетку и отнесите посылку в пакомат — курьера вызывают в панели Montonio. Когда перевозчик отсканирует посылку, заказ сам станет «Отправлен» и клиенту уйдёт письмо «Заказ отправлен» с трек-номером. Нажимать «Отправлен» нужно, только если посылка ушла без скана.",
    "Этикетка — наклейка Montonio с трек-номером. Статус заказа она не меняет: «Отправлен» заказ станет сам, когда перевозчик отсканирует посылку.",
    "когда перевозчик примет посылку или вы нажмёте «Отправлен»",
    "по скану",
    "Отправлен — по скану перевозчика",
    "Посылка едет, а заказ отменён или деньги возвращены",
  ])("%s", (ru) => {
    expect(UI.ET[ru], "ET").toMatch(/^[^А-Яа-яЁё]+$/);
    expect(UI.EN[ru], "EN").toMatch(/^[^А-Яа-яЁё]+$/);
  });
});
