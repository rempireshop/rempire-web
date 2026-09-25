/**
 * Direction 1a — «Обзор», «Заказы», «Заказ» (design_handoff_admin_ux README
 * § 5, screens 01 / 03 / 04; the gap analysis § C–E with Dim's answers of
 * 25.09.2026). What is tested is what the owner meets:
 *
 *   · the card's ONE next step — the dark button and the «Следующий шаг»
 *     words for every state an order can be in, the Glossary's verbs;
 *   · «⋯» — every rare action that used to stand on the card is still there,
 *     with the data-* hook it always had;
 *   · the progress line — four dots, two for a pickup, the skipped label;
 *   · the note saving itself through PATCH { note } (no «Сохранить заметку»);
 *   · the held letters: «Отправлен»/cancel toasts that say ten seconds, and
 *     «Написать клиенту» with «Вернуть» that really stops the letter;
 *   · «Обзор»: grey bars instead of «Всё в порядке» on the first open, no
 *     total beside «Сделать сегодня», who is waiting under the review and
 *     partner rows, «Отправить N заказа» → «Заказы» on «Отправить»;
 *   · «Заказы»: the dark button, «Открыть первый», «Показать все заказы».
 *
 * Functions are cut out of public/shop2/app.js by source text and run over
 * stubs (the technique of tests/admin-order-card-r21.test.ts).
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
/** One `else if (a.type === "…") { … }` branch of srvPush, as a statement. */
function pushBranch(type: string): string {
  const body = fn("srvPush");
  const at = body.indexOf(`else if (a.type === "${type}") {`);
  if (at < 0) throw new Error(`srvPush no longer has a branch for ${type}`);
  let depth = 0;
  for (let i = body.indexOf("{", at); i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}" && --depth === 0) return body.slice(at + "else ".length, i + 1);
  }
  throw new Error("unterminated branch");
}
const flush = () => new Promise((r) => setTimeout(r, 0));

/* ---------- the card's next step ------------------------------------------ */

type V = Record<string, unknown>;
const card = new Function(`
  var SRV = { shipBusy: false, stepBusy: "", invoiceBusy: false, refundBusy: false, invPaidBusy: "" };
  var S = { admOrderMore: "", adminOrder: "" };
  function esc(s) { return String(s == null ? "" : s); }
  function admShipPrepHTML(v) { return "<prep " + v.id + ">"; }
  function admInvoiceStateHTML(v) { return "<invoice-line>"; }
  ${fn("admInvPaidBtnHTML")}
  ${fn("admOrderStepBtn")}
  ${fn("admOrderNext")}
  ${fn("admOrderMenuItems")}
  ${fn("admOrderSteps")}
  return { next: admOrderNext, menu: admOrderMenuItems, steps: admOrderSteps };
`)() as { next: (v: V) => Record<string, string>; menu: (v: V, nx: V) => string[]; steps: (v: V) => string };

const base = { id: "o1", number: "R-100001", who: "Maria", status: "paid", paid: true, unpaid: false, shipped: false,
  delivered: false, pos: false, digital: false, pickup: false, labeled: false, shipRefused: false, held: false,
  invoice: null, refundable: 0, srv: { status: "paid", email: "m@example.com" } };
const order = (over: V = {}) => ({ ...base, ...over, srv: { ...(base.srv as V), ...((over.srv as V) || {}) } });

describe("«Заказ» — the ONE next step, in the Glossary's words", () => {
  it("a paid parcel with no label: «Создать этикетку», the box, and «Отправлен без этикетки» under it", () => {
    const nx = card.next(order());
    expect(nx.title).toBe("Создать этикетку");
    expect(nx.btn).toContain('data-admlabel="o1"');
    expect(nx.btn).toContain("adm-pin__btn");
    expect(nx.btn).toContain(">Создать этикетку<");
    expect(nx.body).toBe("<prep o1>");                                  // the box and the locker door (C2, C3)
    expect(nx.after).toContain('data-admshipnow="o1"');                 // C4: a text link, asks first
    expect(nx.after).toContain("Отправлен без этикетки");
    expect(nx.help).toBe("Этикетка — наклейка Montonio с трек-номером. Статус заказа она не меняет.");
  });

  it("a refused parcel: the carrier's refusal is the title and «Отправить заново» the button", () => {
    const nx = card.next(order({ shipRefused: true }));
    expect(nx.title).toBe("Перевозчик не принял посылку");
    expect(nx.btn).toContain(">Отправить заново<");
  });

  it("with a label: «Отправлен», and today's hint behind «?»", () => {
    const nx = card.next(order({ labeled: true }));
    expect(nx.btn).toContain('data-admshipnow="o1"');
    expect(nx.btn).toContain(">Отправлен<");
    expect(nx.btn, "never the design's «Отметить отправленным»").not.toContain("Отметить отправленным");
    expect(nx.help).toContain("отнесите посылку в пакомат");
  });

  it("on its way: «Доставлен»; a pickup: «Выдан клиенту»", () => {
    expect(card.next(order({ status: "shipped", paid: false, shipped: true, labeled: true })).btn).toContain('data-admdelivered="o1"');
    const pick = card.next(order({ pickup: true }));
    expect(pick.btn).toContain(">Выдан клиенту<");
    expect(pick.after).toBeUndefined();
  });

  it("an awaited invoice: «Отметить оплаченным» is the dark button and the invoice line the card's body", () => {
    const nx = card.next(order({ status: "new", paid: false, unpaid: true, invoice: { number: "A-1" } }));
    expect(nx.btn).toContain('data-adminvpaid="o1"');
    expect(nx.btn).toContain("adm-pin__btn");
    expect(nx.body).toBe("<invoice-line>");
  });

  it("a held order: marking it paid — behind its own question — is the one way on", () => {
    const nx = card.next(order({ status: "new", paid: false, unpaid: true, held: true }));
    expect(nx.title).toBe("Заплатили меньше");
    expect(nx.btn).toContain('data-admstatus="paid"');
  });

  it("nothing left to do: the done card, and no dark button", () => {
    expect(card.next(order({ status: "delivered", paid: false, delivered: true }))).toMatchObject({ done: "Доставлен — всё сделано ✓" });
    expect(card.next(order({ status: "delivered", paid: false, delivered: true, pickup: true })).done).toBe("Выдан клиенту — всё сделано ✓");
    expect(card.next(order({ status: "cancelled", paid: false })).done).toBe("Заказ отменён");
    expect(card.next(order({ status: "refunded", paid: false })).done).toBe("Деньги возвращены");
    expect(card.next(order({ pos: true, paid: false })).done).toBe("Продажа в салоне");
    expect(card.next(order({ digital: true })).done).toBe("Карта ушла на почту ✓");
    expect(card.next(order({ status: "cancelled", paid: false })).btn).toBeUndefined();
  });
});

describe("«Заказ» — «⋯» keeps every rare action, with the hook it always had", () => {
  it("refund, the two statuses by hand and cancel; «Написать клиенту» for the phone", () => {
    const v = order({ refundable: 19.84 });
    const items = card.menu(v, card.next(v)).join("\n");
    expect(items).toContain('data-admorderreply');
    expect(items).toContain("adm-omenu__i--phone");
    expect(items).toContain('data-admrefund="o1"');
    expect(items).toContain('data-admstatus="refunded"');
    expect(items).not.toContain('data-admstatus="paid"');                // it is already paid
    expect(items).toContain('data-admordercancel="o1"');
    expect(items).toContain('role="menuitem"');
  });

  it("an invoice order: «Скачать счёт» and «Отправить счёт ещё раз» — never a second door for the money", () => {
    const v = order({ status: "new", paid: false, unpaid: true, invoice: { number: "A-1" }, srv: { status: "new" } });
    const items = card.menu(v, card.next(v)).join("\n");
    expect(items).toContain('data-adminvpdf="A-1"');
    expect(items).toContain('/api/admin/orders/o1/invoice/');
    expect(items).toContain('data-adminvresend="o1"');
    expect(items).not.toContain('data-admstatus="paid"');
  });

  it("a held order has its «оплачен» as the dark button, not in «⋯»", () => {
    const v = order({ status: "new", paid: false, unpaid: true, held: true, srv: { status: "new" } });
    expect(card.menu(v, card.next(v)).join("\n")).not.toContain('data-admstatus="paid"');
  });

  it("a closed order still offers its status by hand; nothing to cancel", () => {
    const v = order({ status: "cancelled", paid: false, srv: { status: "cancelled" } });
    const items = card.menu(v, card.next(v)).join("\n");
    expect(items).toContain('data-admstatus="paid"');
    expect(items).not.toContain("data-admordercancel");
    // with no dark button «Написать клиенту» is the bar's own button, not a menu line
    expect(items).not.toContain("data-admorderreply");
  });
});

describe("«Заказ» — the progress line", () => {
  const lis = (html: string) => [...html.matchAll(/<li class="adm-prog__s adm-prog__s--([a-z]+)"/g)].map((m) => m[1]);
  it("four dots for a parcel: paid done, the label to do now", () => {
    const html = card.steps(order());
    expect(lis(html)).toEqual(["done", "now", "todo", "todo"]);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('style="width:33%"');
    expect(html).toContain("Этикетка");
  });
  it("a parcel that left without a label says so under the skipped step", () => {
    const html = card.steps(order({ status: "shipped", paid: false, shipped: true }));
    expect(lis(html)).toEqual(["done", "skip", "done", "now"]);
    expect(html).toContain("без этикетки");
  });
  it("two dots for a pickup — «Оплачен · Выдан»", () => {
    const html = card.steps(order({ pickup: true }));
    expect(lis(html)).toEqual(["done", "now"]);
    expect(html).toContain("adm-prog--2");
    expect(html).toContain("Выдан");
  });
});

/* ---------- the note saves itself ------------------------------------------ */

describe("«Заметка» saves itself", () => {
  it("the card draws no «Сохранить заметку»: the box is an autosave field of kind text", () => {
    const c = fn("admOrderCardHTML");
    expect(c).not.toContain("data-admnotesave");
    expect(c).toContain('data-autosave="');
    expect(c).toMatch(/admAutosaveSpec\(noteKey, \{ kind: "text"/);
    expect(c).toContain('maxlength="2000"');
    expect(c).toContain("Сохраняется само");
  });

  it("the write is the PATCH { note } the card always made, keepalive when the page goes, and every list follows", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const landed: unknown[] = [];
    const send = new Function("apiJson", "admOrderLand", `${fn("admOrderNoteSend")} return admOrderNoteSend;`)(
      (url: string, init: RequestInit) => { calls.push({ url, init }); return Promise.resolve({ status: 200, body: { ok: true } }); },
      (o: unknown) => landed.push(o),
    ) as (id: string, note: string, opts?: { keepalive?: boolean }) => Promise<{ status: number }>;
    const r = await send("u-1", "позвонить до 18", { keepalive: true });
    expect(r.status).toBe(200);
    expect(calls[0].url).toBe("/api/admin/orders/u-1/");
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ note: "позвонить до 18" });
    expect(calls[0].init.keepalive).toBe(true);
    expect(landed).toEqual([{ id: "u-1", notes: "позвонить до 18" }]);
  });

  it("a refused save does not pretend: nothing is written into the lists", async () => {
    const landed: unknown[] = [];
    const send = new Function("apiJson", "admOrderLand", `${fn("admOrderNoteSend")} return admOrderNoteSend;`)(
      () => Promise.resolve({ status: 503, body: { ok: false } }),
      (o: unknown) => landed.push(o),
    ) as (id: string, note: string) => Promise<{ status: number }>;
    expect((await send("u-1", "x")).status).toBe(503);
    expect(landed).toEqual([]);
  });
});

/* ---------- the held letters ---------------------------------------------- */

describe("letters held ten seconds — what the panel says and does", () => {
  it("«Отправлен» and «Отменить заказ» toast that the letter goes in ten seconds, with «Вернуть»", () => {
    expect(app).toContain('toast(shipRow.number + " отправлен · письмо уйдёт через 10 с", shipEntry);');
    expect(app).toContain('? pa.number + " отправлен · письмо уйдёт через 10 с"');
    expect(app).toContain(': pa.number + " отменён · письмо уйдёт через 10 с", oEntry);');
    // and «Отправлен» without a label still asks, in the Glossary's words
    expect(app).toContain('title: "Отправлен без этикетки?",');
    expect(app).not.toContain('title: "Отметить отправленным?"');
  });

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function mailRig(sendAnswer: unknown, thread: unknown[]) {
    const toasts: Array<{ msg: string; entry: unknown }> = [];
    const applied: Array<Record<string, unknown>> = [];
    const boxes: Record<string, { value: string }> = { "[data-ordercustmsg]": { value: "Когда придёт?" }, "[data-orderreplydraft]": { value: "Уже в пути." } };
    const S: Record<string, unknown> = { adminOrder: "u-1", orderReplyOpen: true, orderReplyDraft: "Уже в пути.", orderDrafts: { "u-1": { reply: "Уже в пути.", cust: "Когда придёт?" } } };
    const rig = new Function("S", "apiSend", "apiJson", "toast", "demoApply", "document", "journalNote", "render", "noop", `
      var SRV = { admin: true };
      ${fn("srvOrderMailSend")}
      ${fn("admReplyFollow")}
      ${fn("admReplyRestore")}
      var ADM_LETTER_UNDONE = {};
      return { send: srvOrderMailSend, undone: ADM_LETTER_UNDONE };
    `)(
      S,
      () => Promise.resolve(sendAnswer),
      () => Promise.resolve({ status: 200, body: { ok: true, messages: thread } }),
      (msg: string, entry: unknown) => toasts.push({ msg, entry }),
      (a: Record<string, unknown>) => { applied.push(a); return { a, prev: { type: "order_letter_cancel" } }; },
      { querySelector: (sel: string) => boxes[sel] || null },
      () => {}, () => {}, () => {},
    ) as { send: (pa: unknown) => void; undone: Record<string, boolean> };
    return { S, toasts, applied, boxes, ...rig };
  }
  const PA = { id: "u-1", number: "R-100001", reply: "Уже в пути.", customerMessage: "Когда придёт?" };

  it("«Отправить» without a confirm: the toast offers «Вернуть» for a letter the server holds", async () => {
    const p = mailRig({ status: 200, body: { ok: true, held: true, kind: "reply", token: "tok-1", ms: 10000, messages: [] } }, []);
    p.send(PA);
    await vi.advanceTimersByTimeAsync(0);
    expect(p.applied).toEqual([expect.objectContaining({ type: "order_letter", kind: "reply", id: "u-1", token: "tok-1", reply: "Уже в пути." })]);
    expect(p.toasts[0].msg).toBe("Письмо уйдёт через 10 секунд");
    expect(p.toasts[0].entry, "the toast carries the journal line «Вернуть» takes back").toBeTruthy();
    expect(p.boxes["[data-ordercustmsg]"].value).toBe("");
    expect(p.boxes["[data-orderreplydraft]"].value).toBe("");
    expect((p.S.orderDrafts as Record<string, unknown>)["u-1"]).toBeUndefined();
  });

  it("after the hold the thread is read again; a letter that is not in it — and was not taken back — is said, and its words come back", async () => {
    const p = mailRig({ status: 200, body: { ok: true, held: true, token: "tok-2", ms: 10000, messages: [] } }, []);
    p.send(PA);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(p.toasts.map((t) => t.msg)).toEqual(["Письмо уйдёт через 10 секунд"]);
    await vi.advanceTimersByTimeAsync(600);
    expect(p.toasts.map((t) => t.msg)).toContain("Письмо не ушло — текст снова в поле, попробуйте ещё раз");
    expect(p.S.orderReplyDraft).toBe("Уже в пути.");
  });

  it("…and a letter that went is simply in the thread — no warning", async () => {
    const p = mailRig({ status: 200, body: { ok: true, held: true, token: "tok-3", ms: 10000, messages: [] } },
      [{ direction: "out", body: "Уже в пути.", orderId: "u-1" }]);
    p.send(PA);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(p.toasts.map((t) => t.msg)).toEqual(["Письмо уйдёт через 10 секунд"]);
    expect(p.S.orderMsgs).toEqual([{ direction: "out", body: "Уже в пути.", orderId: "u-1" }]);
  });

  it("…nor for a letter «Вернуть» stopped", async () => {
    const p = mailRig({ status: 200, body: { ok: true, held: true, token: "tok-4", ms: 10000, messages: [] } }, []);
    p.send(PA);
    await vi.advanceTimersByTimeAsync(0);
    p.undone["tok-4"] = true;
    await vi.advanceTimersByTimeAsync(12_000);
    expect(p.toasts.map((t) => t.msg)).toEqual(["Письмо уйдёт через 10 секунд"]);
  });

  function cancelRig(answer: unknown) {
    const toasts: string[] = [];
    const sent: Array<{ url: string; method: string; body: unknown }> = [];
    const restored: unknown[] = [];
    const reloads: number[] = [];
    const run = new Function("apiSend", "toast", "admReplyRestore", "admOrderListsReload", "render", `
      var SRV = { admin: true };
      var ADM_LETTER_UNDONE = {};
      return function (a) { if (!SRV.admin || !a) return; if (false) {} ${pushBranch("order_letter_cancel")} return ADM_LETTER_UNDONE; };
    `)(
      (url: string, method: string, body: unknown) => { sent.push({ url, method, body }); return Promise.resolve(answer); },
      (m: string) => toasts.push(m),
      (pa: unknown) => restored.push(pa),
      () => reloads.push(1),
      () => {},
    ) as (a: Record<string, unknown>) => Record<string, boolean>;
    return { run, toasts, sent, restored, reloads };
  }

  it("«Вернуть» in time: PATCH { letterCancel }, and the letter's words back in the box", async () => {
    vi.useRealTimers();
    const r = cancelRig({ status: 200, body: { ok: true, cancelled: true } });
    const undone = r.run({ type: "order_letter_cancel", id: "u-1", kind: "reply", token: "tok-5", reply: "Уже в пути.", customerMessage: "" });
    expect(undone["tok-5"]).toBe(true);
    await flush();
    expect(r.sent).toEqual([{ url: "/api/admin/orders/u-1/", method: "PATCH", body: { letterCancel: "tok-5" } }]);
    expect(r.toasts).toEqual(["Письмо не отправлено — текст снова в поле"]);
    expect(r.restored).toEqual([{ id: "u-1", reply: "Уже в пути.", customerMessage: "" }]);
  });

  it("«Вернуть» too late says so plainly", async () => {
    vi.useRealTimers();
    const r = cancelRig({ status: 200, body: { ok: true, cancelled: false } });
    r.run({ type: "order_letter_cancel", id: "u-1", kind: "invoice", token: "tok-6" });
    await flush();
    expect(r.toasts).toEqual(["Письмо уже ушло — вернуть его нельзя"]);
    expect(r.restored).toEqual([]);
  });
});

/* ---------- «Обзор» ---------------------------------------------------------- */

function overview(data: unknown, orders: unknown[] | null, toShip = 0): string {
  return new Function("DATA", "ORDERS", "TOSHIP", `
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
    function admLiveToShip() { return []; }
    function lowStock() { return []; }
    function admWaitingCount() { return TOSHIP; }
    function admReturnsAsked() { return []; }
    function admInvoicesWaiting() { return []; }
    function companyIban() { return "EE00"; }
    function admHeldOrders() { return []; }
    function admTodayTakings() { return { sum: 0, n: 0, pos: 0 }; }
    function admShopDay() { return "2026-09-25"; }
    function admShopDayAdd(d) { return d; }
    function admHead(k, t, right) { return "<head>" + t + (right || "") + "</head>"; }
    function admDateLine() { return ""; }
    function admRecentRow(v) { return "<recent>"; }
    function admProdName(s) { return s; }
    function admSecHeadHTML(t, k, h, extra) { return '<div class="adm-sech"><h2>' + t + "</h2>" + (extra || "") + "</div>"; }
    function admPinnedHTML(attrs, label) { return '<div class="adm-pin"><button ' + attrs + ">" + label + "</button></div>"; }
    function admOrdersLabel(n) { return n + " " + pl(n, "заказ", "заказа", "заказов"); }
    ${fn("admShipAllLabel")}
    ${fn("admSkelHTML")}
    ${fn("admReviewWho")}
    ${fn("admTaskRow")}
    ${fn("admOverviewHTML")}
    return admOverviewHTML();
  `)(data, orders, toShip) as string;
}
const SUMMARY = {
  attention: { ordersToShip: 0, proRequests: 1, reviewsPending: 1, stockAlerts: 0, returnRequests: 0 },
  lowStock: { total: 0, items: [], hidden: 0, hiddenItems: [] },
  revenue7d: { total: 0, orders: 0, perDay: 0 },
  revenueByDay: [],
  attentionNames: { reviews: [{ name: "Марина К.", rating: 5 }], partners: [{ name: "Salon Olga OÜ" }] },
};

describe("«Обзор»", () => {
  it("first open: grey bars, not «Всё в порядке» and 0 € over numbers nobody has read yet", () => {
    const html = overview(null, null);
    expect(html).toContain("adm-skel--rows");
    expect(html).not.toContain("Всё в порядке");
    expect(html).not.toContain("0 €");
  });

  it("names who is waiting under the review and the partner rows (q41)", () => {
    const html = overview(SUMMARY, []);
    expect(html).toContain("Марина К. · ★★★★★");
    expect(html).toContain("Salon Olga OÜ");
    expect(html).toContain('data-admtab="reviews"');
    expect(html).toContain('data-admtab="people" data-admfilter="pending"');
  });

  it("no total beside «Сделать сегодня» (q15)", () => {
    const html = overview(SUMMARY, []);
    expect(html).not.toContain("adm-sec__x");
    expect(fn("admOverviewHTML")).not.toContain("taskN");
  });

  it("«Отправить N заказа» is the one dark button, and it opens «Заказы» on «Отправить» (q14)", () => {
    const html = overview(SUMMARY, [], 3);
    expect(html).toContain('<div class="adm-pin"><button data-admtab="orders" data-admfilter="new">Отправить 3 заказа</button></div>');
    expect(overview(SUMMARY, [], 0)).not.toContain("adm-pin");
  });

  it("recent orders: the list, «Все заказы» beside its header, bars while the list is on its way", () => {
    expect(overview(SUMMARY, [{ id: 1 }])).toContain("<recent>");
    expect(overview(SUMMARY, [{ id: 1 }])).toContain('data-admtab="orders" data-admfilter="all"');
    expect(overview(SUMMARY, null)).toMatch(/Последние заказы.*adm-skel--rows/s);
  });
});

/* ---------- «Заказы» -------------------------------------------------------- */

describe("«Заказы»", () => {
  function pin(chip: string, q = "") {
    return new Function("S", `
      var ADM_ORDER_FILTERS = [["all", "Все"], ["new", "Отправить"]];
      function esc(s) { return String(s); }
      function admWaitingCount() { return 2; }
      function admLiveToShip() { return [{ id: "new-1", who: "Newest" }, { id: "old-1", who: "Anna Saar" }]; }
      function admShipAllLabel(n) { return "Отправить " + n + " заказа"; }
      function admPinnedHTML(attrs, label) { return "<pin " + attrs + ">" + label + "</pin>"; }
      ${fn("admOrderFilter")}
      ${fn("admOrderChipLit")}
      ${fn("admOrdersPinHTML")}
      return admOrdersPinHTML();
    `)({ admOrderFilter: chip, admOrderQ: q }) as string;
  }

  it("«Отправить N заказа» lights the «Отправить» chip — by a hook of its own, so the chip's key stays one", () => {
    expect(pin("all")).toBe("<pin data-admshipall>Отправить 2 заказа</pin>");
    expect(app).toContain('if (el && el.hasAttribute("data-admshipall")) {');
    expect(app).toContain('S.admOrderQ = ""; S.admOrderFilter = "new"; S.ordersShown = ORDERS_PAGE;');
  });

  it("on that chip it opens the order that has waited longest", () => {
    expect(pin("new")).toBe('<pin data-admorder="old-1"><span>Открыть первый:</span> <span>Anna Saar</span></pin>');
    // a search in the box lights «Все», so the button goes back to lighting «Отправить»
    expect(pin("new", "R-1")).toContain("data-admshipall");
  });

  it("an empty answer has one way out — «Показать все заказы» — and none on «Все» with nothing typed", () => {
    const empty = new Function(`${fn("admOrderEmptyHTML")} return admOrderEmptyHTML;`)() as (q: string, w: string, f: string) => string;
    expect(empty("zz", "", "all")).toContain("data-admorderreset");
    expect(empty("zz", "", "all")).toContain("Ничего не нашли.");
    expect(empty("", "", "held")).toContain("data-admorderreset");
    expect(empty("", "", "all")).not.toContain("data-admorderreset");
    expect(empty("zz", "<waiting>", "all")).toBe("");
  });

  it("the search box keeps «почта» — the server matches the e-mail too", () => {
    expect(fn("admOrdersHTML")).toContain('placeholder="Имя, номер, телефон или почта"');
    expect(fn("admOrdersHTML")).toContain("data-admorderq");
  });

  /* The coordinator's review of 25.09.2026: a row that still waited for a
     label carried «Создать этикетку» AND «Отправлен», stacked — two actions,
     a row twice the height of its neighbours. One action per row, and it is
     the card's dark button. */
  const row = new Function(`
    var SRV = { shipBusy: false, stepBusy: "", invPaidBusy: "" };
    var ADM_ROW_OPEN = "";
    function esc(s) { return String(s == null ? "" : s); }
    function eur(n) { return n + " €"; }
    function admOrderRowBodyHTML(v) { return "<body " + v.id + ">"; }
    function admOrderBadge(v) { return "<tag>"; }
    function admReturnBadge(v) { return ""; }
    function admShipPrepHTML(v) { return ""; }
    function admInvoiceStateHTML(v) { return ""; }
    ${fn("admReceiptLink")}
    ${fn("admInvPaidBtnHTML")}
    ${fn("admOrderStepBtn")}
    ${fn("admOrderNext")}
    ${fn("admOrderRowHTML")}
    return { row: admOrderRowHTML, next: admOrderNext };
  `)() as { row: (v: V) => string; next: (v: V) => Record<string, string> };
  const acts = (v: V) => {
    const html = row.row(v), at = html.indexOf('<div class="adm-acts adm-orow__acts">');
    return at < 0 ? "" : html.slice(at);
  };
  const hook = (html: string) => (/ (data-adm[a-z]+)="/.exec(html) || [])[1];

  it("a row carries at most ONE action — the card's own next step", () => {
    const states: V[] = [
      order(),                                                         // «Создать этикетку»
      order({ labeled: true }),                                        // «Отправлен»
      order({ status: "shipped", paid: false, shipped: true }),        // «Доставлен»
      order({ pickup: true }),                                         // «Выдан клиенту»
      order({ shipRefused: true }),                                    // «Отправить заново»
      order({ status: "new", paid: false, unpaid: true, invoice: { number: "A-1" } }),
    ];
    for (const v of states) {
      const a = acts(v);
      expect(a.match(/<button /g), JSON.stringify(v)).toHaveLength(1);
      expect(hook(a), JSON.stringify(v)).toBe(hook(row.next(v).btn));
    }
    expect(acts(order())).toContain(">Создать этикетку<");
    expect(acts(order({ pickup: true }))).toContain(">Выдан клиенту<");
  });

  it("«Отправлен без этикетки» is the card's only — never a second button in the row", () => {
    expect(acts(order())).not.toContain("data-admshipnow");
    expect(row.next(order()).after).toContain('data-admshipnow="o1"');
    // an unpaid order keeps its one «Написать»; a held one has none
    expect(acts(order({ status: "new", paid: false, unpaid: true }))).toContain('data-admwrite="o1"');
    expect(acts(order({ status: "new", paid: false, unpaid: true, held: true }))).toBe("");
  });
});
