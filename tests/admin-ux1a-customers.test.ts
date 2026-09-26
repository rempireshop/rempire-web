/**
 * «Клиенты» in direction 1a (design_handoff_admin_ux README § 5, screens 07
 * and 15; Dim's answers of 25.09.2026).
 *
 *   · q3  — an answer to a partner request, the first flip to «Партнёр» and
 *           «+ Партнёр» are on screen at once and SENT ten seconds later;
 *           «Вернуть» inside the ten seconds means the call is never made
 *           (the server cannot take an approval or a refusal back); a page
 *           going away sends what it holds at once, with keepalive.
 *   · q9  — a points correction is held five seconds the same way; a number
 *           that is not one is refused in the box, not sent.
 *   · q1  — the private note saves itself (running text).
 *   · q33 — the birthday is on the card.
 *   · gap Q1 a / Q4 — «Подписаны» stays (and now works with the programme
 *           off), a review's author opens the customer's card.
 *
 * The whole «Клиенты» section of public/shop2/app.js is cut out by source
 * text and run over stubs, with vitest's fake clock for the holds.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

function between(from: string, to: string): string {
  const a = src.indexOf(from);
  if (a < 0) throw new Error(`app.js no longer has «${from}»`);
  const b = src.indexOf(to, a);
  if (b < 0) throw new Error(`app.js no longer has «${to}» after «${from}»`);
  return src.slice(a, b);
}
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
function decl(name: string): string {
  for (const [open, close] of [["[", "]"], ["{", "}"]] as const) {
    const start = src.indexOf(`var ${name} = ${open}`);
    if (start < 0) continue;
    let depth = 0;
    for (let i = src.indexOf(open, start); i < src.length; i++) {
      if (src[i] === open) depth++;
      else if (src[i] === close && --depth === 0) return `${src.slice(start, i + 1)};`;
    }
  }
  throw new Error(`public/shop2/app.js no longer declares ${name}`);
}

const SECTION = between("  /* ---------- wholesale/loyalty: admin «Клиенты» ---", "  /* Every string in this table came from a stranger");

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Sent = { url: string; method: string; body: Any; keepalive: boolean };
type Answer = { status: number; body: Any };

/** The section, live, over stubs. `answer` decides what every write gets back. */
function panel(S: Any, opts: { partners?: boolean; answer?: (s: Sent) => Answer; get?: (url: string) => Answer } = {}) {
  const sent: Sent[] = [];
  const toasts: Array<{ msg: string; undo: Any | null }> = [];
  const applied: Any[] = [];
  const journal: string[] = [];
  const specs: Record<string, Any> = {};
  let renders = 0;
  const answer = opts.answer ?? (() => ({ status: 200, body: { ok: true, customer: null } }));
  const env: Record<string, unknown> = {
    S, SRV: { admin: true }, DEMO: { log: [] }, document: undefined, window: undefined,
    OVERVIEW: { data: null },
    partnersOn: () => opts.partners !== false,
    apiSend: (url: string, method: string, body: Any) => {
      const s = { url, method, body, keepalive: false };
      sent.push(s);
      return Promise.resolve(answer(s));
    },
    apiJson: (url: string, o: Any = {}) => {
      if (!o.method || o.method === "GET") return Promise.resolve(opts.get ? opts.get(url) : { status: 404, body: { ok: false } });
      const s = { url, method: o.method, body: JSON.parse(o.body || "{}"), keepalive: !!o.keepalive };
      sent.push(s);
      return Promise.resolve(answer(s));
    },
    render: () => { renders++; },
    toast: (msg: string, undo?: Any) => { toasts.push({ msg, undo: undo && undo.prev ? undo : null }); },
    journalNote: (t: string) => { journal.push(t); },
    actionText: (a: Any) => (a.type === "set_tier" ? (a.value === "pro" ? "Партнёр: " : "Розница: ") + a.email : a.type),
    admAutosaveSpec: (key: string, spec: Any) => { specs[key] = spec; return key; },
    admAutosaveInvalidAttr: () => "",
    admAutosaveHintHTML: () => "",
    admTagHTML: (kind: string, text: string) => `<span class="adm-badge adm-tag" data-kind="${kind}">${text}</span>`,
    admSecHeadHTML: (t: string) => `<h2 class="adm-sech__t">${t}</h2>`,
    admHelpBtnHTML: (k: string) => `<button data-admhelp="${k}">?</button>`,
    admHelpHTML: (k: string, t: string) => `<div class="adm-helpp" data-help="${k}">${t}</div>`,
    admPinnedHTML: (attrs: string, label: string) => `<div class="adm-pin"><button class="adm-btn adm-pin__btn" ${attrs}>${label}</button></div>`,
    admBackHTML: (attrs: string, label: string) => `<button class="adm-link" ${attrs}>← <span>${label}</span></button>`,
    esc: (s: unknown) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"),
    eur: (n: number) => `${n} €`,
    shortDate: (iso: string) => (iso ? String(iso).slice(8, 10) + "." + String(iso).slice(5, 7) + "." + String(iso).slice(0, 4) : ""),
    pl: (n: number, one: string, few: string, many: string) => { const a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? few : many; },
    admOrdersLabel: (n: number) => `${n} заказов`,
    admItemsLabel: (n: number) => `${n} товаров`,
    admProdName: (s: string) => s,
    admOrderById: () => null, admInvoiceOverdue: () => 0, admOrderBadge: () => "<chip>",
    byIdOrNull: () => null, fakeCustomers: () => [],
    LOYALTY_REASON: { adjust: "Корректировка" },
    ADM_ROW_OPEN: " data-admrowopen",
    refocus: () => {}, translateTree: () => {}, noop: () => {},
    loadSrvOrders: () => {}, admCurOrder: () => null, admOrderCardHTML: () => "", admOrderMissingHTML: () => "",
  };
  const body = `
    function demoApply(a) {
      applied.push(a);
      if (a.type === "set_tier") admTierLocal(a.id, a.email, a.value);
      return { txt: a.type, prev: a.type === "set_tier" ? { type: "set_tier", value: a.prev } : null };
    }
    ${SECTION}
    ${slice("loyaltyLabel")}
    ${slice("loyaltySub")}
    ${slice("admCustPendingN")}
    ${slice("admCustTabsHTML")}
    ${slice("admCustHeadHTML")}
    ${slice("admRevTagHTML")}
    ${slice("admReviewWhoHTML")}
    ${slice("admReviewRowHTML")}
    return {
      filtered: filteredAdminCustomers, chips: admCustChipsHTML, rows: admCustRowsHTML, row: admCustRowHTML,
      decide: custDecide, setTier: custSetTier, fireAll: custHoldsFire, loadList: loadAdminCustomers,
      loadCard: loadAdminCustomerDetail, parse: custPointsParse, label: custPtsLabelHTML, adjust: adjustCustomerPoints,
      balance: custBalance, addPartner: custAddPartner, note: admCustNoteHTML, facts: admCustFactsHTML,
      card: admCustomerCardHTML, head: admCustHeadHTML, review: admReviewRowHTML, exportHref: admCustExportHref,
    };
  `;
  const keys = Object.keys(env);
  const api = new Function(...keys, "applied", body)(...keys.map((k) => env[k]), applied) as Any;
  const rig = {
    ...api, sent, toasts, applied, journal, specs,
    get renders() { return renders; },
    /** «Вернуть» on the newest toast that offers one. */
    undo() { const t = [...toasts].reverse().find((x) => x.undo); t!.undo!.undo(); },
  };
  // the section's own functions ride along untyped — they are app.js's, not this file's
  return rig as typeof rig & Any;
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

const REQ = { id: "c1", email: "maria@example.com", name: "Мария", tier: "retail", proRequestedAt: "2026-09-24T10:00:00.000Z", proApprovedAt: null, company: "Salon OÜ", regCode: "14567890", ordersCount: 2, revenue: 48, marketing: true, pointsBalance: 0 };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("the list", () => {
  it("«Подписаны» still sorts with «Партнёры и баллы» off — it is not a tier", () => {
    const S: Any = { admCustomers: [{ ...REQ, marketing: true }, { ...REQ, id: "c2", email: "b@example.com", marketing: false }], admCustTier: "news", admCustQ: "" };
    const p = panel(S, { partners: false });
    expect(p.filtered().map((c: Any) => c.id), "the one chip left with the programme off did nothing").toEqual(["c1"]);
    expect(S.admCustTier).toBe("news");
    // …while a tier chip left over from «on» still falls back to «Все»
    S.admCustTier = "pro";
    expect(p.filtered()).toHaveLength(2);
    expect(S.admCustTier).toBe("");
  });

  it("every chip says how many it holds under the search typed now — the count its own node", () => {
    const S: Any = {
      admCustTier: "", admCustQ: "salon",
      admCustomers: [REQ, { ...REQ, id: "c2", email: "x@salon.ee", proRequestedAt: null, tier: "pro", marketing: false }, { ...REQ, id: "c3", email: "z@example.com", company: "", proRequestedAt: null, marketing: false }],
    };
    const html = panel(S).chips();
    expect(html).toContain('data-admcusttier="" aria-current="true"><span>Все</span> <span class="adm-chip__n">2</span>');
    expect(html).toContain('<span>Заявки</span> <span class="adm-chip__n">1</span>');
    expect(html).toContain('<span>Партнёры</span> <span class="adm-chip__n">1</span>');
    expect(html).toContain('<span>Подписаны</span> <span class="adm-chip__n">1</span>');
  });

  it("a waiting request is answered on the row with two OUTLINED buttons — «+ Партнёр» is the one dark button", () => {
    const S: Any = { admCustomers: [REQ], admCustTier: "", admCustQ: "" };
    const p = panel(S);
    const row = p.row(REQ);
    expect(row).toContain('class="adm-btn adm-btn--ghost adm-btn--row adm-crow__yes" data-admcustapprove="c1">Сделать партнёром');
    expect(row).toContain('data-admcustreject="c1">Отказать');
    expect(row).not.toMatch(/class="adm-btn adm-btn--row/);
    expect(row).toContain("Заявка Pro");
    expect(row, "the consent tag went (gap Q1 a keeps it)").toContain(">Подписан<");
    const head = p.head(false);
    expect(head.match(/adm-pin__btn/g), "the header has one dark button").toHaveLength(1);
    expect(head).toContain("data-admpartnernew>+ Партнёр");
    expect(head, "the lead left the help").toContain('data-admgoset="prices"');
    expect(head).toContain("data-admcustmore");
    // on «Отзывы» there is nothing to add and nothing to download
    expect(panel(S).head(true)).not.toContain("data-admpartnernew");
  });
});

describe("«Сделать партнёром» / «Отказать» — held ten seconds (q3)", () => {
  it("is on screen at once, and sent only after ten seconds", async () => {
    const S: Any = { admCustomers: [{ ...REQ }], admCustTier: "", admCustQ: "" };
    const p = panel(S, { answer: () => ({ status: 200, body: { ok: true, customer: { ...REQ, tier: "pro", proRequestedAt: null }, mail: { sent: true } } }) });
    p.decide("c1", "approve");
    expect(S.admCustomers[0]).toMatchObject({ tier: "pro", proRequestedAt: null });
    expect(p.sent, "the approval left before «Вернуть» had its ten seconds").toEqual([]);
    expect(p.toasts[0].msg).toBe("Мария — партнёр · письмо уйдёт через 10 с");
    expect(p.toasts[0].undo!.ms).toBe(10000);
    vi.advanceTimersByTime(9999);
    expect(p.sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(p.sent).toEqual([{ url: "/api/admin/customers/c1/", method: "PATCH", body: { action: "approve" }, keepalive: false }]);
    await flush();
    expect(p.toasts.at(-1)!.msg).toBe("Партнёр одобрен · письмо ушло");
  });

  it("«Вернуть» inside the ten seconds: nothing is sent, the request is back on the row", async () => {
    const S: Any = { admCustomers: [{ ...REQ }], admCustTier: "", admCustQ: "" };
    const p = panel(S);
    p.decide("c1", "reject");
    expect(S.admCustomers[0].proRequestedAt).toBeNull();
    expect(p.toasts[0].msg).toBe("Заявка отклонена");
    p.undo();
    expect(S.admCustomers[0]).toMatchObject({ tier: "retail", proRequestedAt: REQ.proRequestedAt });
    expect(p.toasts.at(-1)!.msg).toBe("Отменено");
    vi.advanceTimersByTime(30000);
    expect(p.sent, "a refusal the owner took back reached the server").toEqual([]);
  });

  it("a page going away sends what it holds at once, with keepalive — and never twice", () => {
    const S: Any = { admCustomers: [{ ...REQ }], admCustTier: "", admCustQ: "" };
    const p = panel(S);
    p.decide("c1", "approve");
    p.fireAll();
    expect(p.sent).toEqual([{ url: "/api/admin/customers/c1/", method: "PATCH", body: { action: "approve" }, keepalive: true }]);
    vi.advanceTimersByTime(20000);
    expect(p.sent).toHaveLength(1);
  });

  it("a refusal from the server puts the request back and says so", async () => {
    const S: Any = { admCustomers: [{ ...REQ }], admCustTier: "", admCustQ: "" };
    const p = panel(S, { answer: () => ({ status: 503, body: { ok: false } }) });
    p.decide("c1", "approve");
    vi.advanceTimersByTime(10000);
    await flush();
    expect(S.admCustomers[0]).toMatchObject({ tier: "retail", proRequestedAt: REQ.proRequestedAt });
    expect(p.toasts.at(-1)!.msg).toBe("Не получилось сохранить");
  });

  it("a list that lands inside the ten seconds does not show the request again", async () => {
    const S: Any = { admCustomers: [{ ...REQ }], admCustTier: "", admCustQ: "" };
    const p = panel(S, { get: () => ({ status: 200, body: { ok: true, customers: [{ ...REQ }] } }) });
    p.decide("c1", "approve");
    p.loadList(true);
    await flush();
    expect(S.admCustomers[0]).toMatchObject({ tier: "pro", proRequestedAt: null });
  });
});

describe("«Розница / Партнёр» on the card", () => {
  const card = (c: Any) => ({ admCustOpen: c.id, admCustDetail: { customer: { ...c }, history: [] }, admCustomers: [{ ...c }] });

  it("the first flip to «Партнёр» (the letter goes with it) is held ten seconds", () => {
    const S: Any = card({ ...REQ, proRequestedAt: null });
    const p = panel(S);
    p.setTier("pro");
    expect(S.admCustDetail.customer.tier, "the switch waited").toBe("pro");
    expect(p.applied).toEqual([]);
    expect(p.toasts[0].msg).toBe("Цены для салонов включены · письмо уйдёт через 10 с");
    vi.advanceTimersByTime(10000);
    expect(p.applied).toMatchObject([{ type: "set_tier", id: "c1", value: "pro", prev: "retail" }]);
  });

  it("picking the other side while it is held is «Вернуть»", () => {
    const S: Any = card({ ...REQ, proRequestedAt: null });
    const p = panel(S);
    p.setTier("pro");
    p.setTier("retail");
    expect(S.admCustDetail.customer.tier).toBe("retail");
    vi.advanceTimersByTime(20000);
    expect(p.applied).toEqual([]);
  });

  it("a return to partner (welcomed before) and a move to retail are made at once, with «Вернуть»", () => {
    const S: Any = card({ ...REQ, proRequestedAt: null, proApprovedAt: "2026-01-01T00:00:00.000Z" });
    const p = panel(S);
    p.setTier("pro");
    expect(p.applied).toMatchObject([{ type: "set_tier", value: "pro" }]);
    expect(p.toasts.at(-1)!.msg).toBe("Цены для салонов включены · письмо уже отправляли");
    expect(p.toasts.at(-1)!.undo).not.toBeNull();
    p.setTier("retail");
    expect(p.applied.at(-1)).toMatchObject({ type: "set_tier", value: "retail", prev: "pro" });
    expect(p.toasts.at(-1)!.msg).toBe("Снова обычные цены");
  });
});

describe("points: «Начислить +10» / «Списать −5», held five seconds (q9)", () => {
  it("a number that is not one is refused in the box, never sent", () => {
    const p = panel({});
    expect(p.parse("").err).toBe("Впишите число баллов — можно с минусом");
    expect(p.parse("0").err).toBe("Впишите число баллов — можно с минусом");
    expect(p.parse("abc").err).toBe("Только целое число — например, +10 или −5");
    expect(p.parse("1.5").err).toBe("Только целое число — например, +10 или −5");
    expect(p.parse("1000000000").err).toBe("Не больше 1 000 000 баллов за раз");
    // the phone's own minus and a typed plus both count
    expect(p.parse("−5")).toEqual({ n: -5, err: "" });
    expect(p.parse(" +10 ")).toEqual({ n: 10, err: "" });
    expect(p.label("+10")).toBe("<span>Начислить</span> +10");
    expect(p.label("-5")).toBe("<span>Списать</span> −5");
    expect(p.label("abc")).toBe("<span>Начислить</span>");

    const S: Any = { admCustOpen: "c1", admCustDetail: { customer: { ...REQ }, history: [] }, admCustPoints: "abc", admCustNote: "" };
    const q = panel(S);
    q.adjust("c1");
    expect(S.admCustPtsErr).toBe("Только целое число — например, +10 или −5");
    vi.advanceTimersByTime(10000);
    expect(q.sent).toEqual([]);
  });

  it("on the card at once, sent after five seconds; «Вернуть» before that sends nothing", () => {
    const S: Any = { admCustOpen: "c1", admCustDetail: { customer: { ...REQ, pointsBalance: 7 }, history: [] }, admCustPoints: "+10", admCustNote: " извинение за задержку " };
    const p = panel(S);
    p.adjust("c1");
    expect(p.balance(S.admCustDetail.customer), "the tile waited for the server").toBe(17);
    expect(S.admCustPoints).toBe("");
    expect(S.admCustNote).toBe("");
    expect(p.toasts[0].msg).toBe("Начислено 10 баллов");
    expect(p.toasts[0].undo!.ms).toBe(5000);
    vi.advanceTimersByTime(4999);
    expect(p.sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(p.sent).toEqual([{ url: "/api/admin/customers/c1/", method: "PATCH", body: { pointsDelta: 10, note: "извинение за задержку" }, keepalive: false }]);

    const T: Any = { admCustOpen: "c1", admCustDetail: { customer: { ...REQ, pointsBalance: 7 }, history: [] }, admCustPoints: "−5", admCustNote: "" };
    const q = panel(T);
    q.adjust("c1");
    expect(q.toasts[0].msg).toBe("Списано 5 баллов");
    expect(q.balance(T.admCustDetail.customer)).toBe(2);
    q.undo();
    expect(q.balance(T.admCustDetail.customer)).toBe(7);
    vi.advanceTimersByTime(10000);
    expect(q.sent).toEqual([]);
  });
});

describe("«+ Партнёр» — held ten seconds (q3)", () => {
  it("a wrong address is refused in the box; nothing is sent", () => {
    const S: Any = { partnerForm: { email: "salon@", company: "", phone: "" }, admCustomers: [], admCustTier: "pro", admCustQ: "x" };
    const p = panel(S);
    p.addPartner();
    expect(S.partnerErr).toBe("Проверьте e-mail");
    expect(S.partnerForm).not.toBeNull();
    vi.advanceTimersByTime(20000);
    expect(p.sent).toEqual([]);
  });

  it("closes the form, shows «Все», and posts after ten seconds; «Вернуть» brings the form back", () => {
    const S: Any = { partnerForm: { email: " New@Salon.ee ", company: "Salon OÜ", phone: "+372 5555" }, admCustomers: [], admCustTier: "pro", admCustQ: "x", lang: "ET" };
    const p = panel(S);
    p.addPartner();
    expect(S.partnerForm).toBeNull();
    expect(S.admCustTier, "the list stayed on «Партнёры» (gap B8)").toBe("");
    expect(S.admCustQ).toBe("");
    expect(p.toasts[0].msg).toBe("Партнёр добавлен · письмо уйдёт через 10 с");
    vi.advanceTimersByTime(10000);
    expect(p.sent).toEqual([{ url: "/api/admin/customers/", method: "POST", body: { email: "new@salon.ee", company: "Salon OÜ", phone: "+372 5555", lang: "ET" }, keepalive: false }]);

    const T: Any = { partnerForm: { email: "b@salon.ee", company: "B", phone: "" }, admCustomers: [], admCustTier: "", admCustQ: "" };
    const q = panel(T);
    q.addPartner();
    q.undo();
    expect(T.partnerForm, "«Вернуть» lost what was typed").toEqual({ email: "b@salon.ee", company: "B", phone: "" });
    vi.advanceTimersByTime(20000);
    expect(q.sent).toEqual([]);
  });

  it("an address that is a partner already gets no letter, so nothing waits", () => {
    const S: Any = { partnerForm: { email: "maria@example.com", company: "", phone: "" }, admCustomers: [{ ...REQ, tier: "pro" }], admCustTier: "", admCustQ: "" };
    const p = panel(S);
    p.addPartner();
    expect(p.sent).toHaveLength(1);
    expect(p.sent[0]).toMatchObject({ method: "POST", body: { email: "maria@example.com" } });
  });
});

describe("the card", () => {
  it("the note saves itself — running text, keyed by the customer (q1)", async () => {
    const S: Any = { admCustOpen: "c1", admCustDetail: { customer: { ...REQ, notes: null }, history: [] }, admCustomers: [{ ...REQ, notes: null }], admCustNotesDraft: "" };
    const p = panel(S, { answer: () => ({ status: 200, body: { ok: true, customer: { ...REQ } } }) });
    const html = p.note(S.admCustDetail.customer);
    expect(html).toContain('data-admcustnotesf data-autosave="cust:c1:notes"');
    expect(html, "the note still has a button to press").not.toContain("data-admcustsavenotes");
    const spec = p.specs["cust:c1:notes"];
    expect(spec.kind).toBe("text");
    const r = await spec.send("постоянный клиент", {});
    expect(r.status).toBe(200);
    expect(p.sent).toEqual([{ url: "/api/admin/customers/c1/", method: "PATCH", body: { notes: "постоянный клиент" }, keepalive: false }]);
    expect(S.admCustDetail.customer.notes).toBe("постоянный клиент");
    expect(S.admCustomers[0].notes, "the list's row was not told").toBe("постоянный клиент");
    await spec.send("", { keepalive: true });
    expect(p.sent.at(-1)).toEqual({ url: "/api/admin/customers/c1/", method: "PATCH", body: { notes: null }, keepalive: true });
  });

  it("shows the birthday the customer gave (q33), with or without a purchase", () => {
    const p = panel({});
    const html = p.facts({ customer: { birthday: "1990-03-07" }, stats: null });
    expect(html).toContain('<span class="adm-cfact__l">День рождения</span><span class="adm-cfact__v">07.03</span>');
    expect(p.facts({ customer: { birthday: null }, stats: null })).toBe("");
  });

  it("«Написать клиенту» is the owner's mail app, addressed (q32); the request has the card's one dark button", () => {
    const S: Any = { admCustOpen: "c1", admCustDetail: { customer: { ...REQ }, history: [], orders: [], stats: null, reviews: [] }, admCustNotesDraft: null, admCustPoints: "", admCustNote: "" };
    const html = panel(S).card();
    expect(html).toContain('<a class="adm-btn adm-btn--ghost adm-cwrite" href="mailto:maria@example.com">Написать клиенту</a>');
    expect(html).toContain('<a href="mailto:maria@example.com">maria@example.com</a>');
    expect(html.match(/class="adm-btn" /g), "more than one dark button on the card").toHaveLength(1);
    expect(html).toContain('<button class="adm-btn" data-admcustapprove="c1">Сделать партнёром</button>');
    expect(html).toContain("Заявка на партнёрство");
    expect(html).toContain('data-admcusttierset="pro"');
    expect(html).toContain("Согласие") ;
  });

  it("opened by an address (a review's author), it is re-keyed to the customer's id", async () => {
    const S: Any = { admCustOpen: "maria@example.com", admCustDetail: null, admCustDetailErr: "" };
    const p = panel(S, { get: () => ({ status: 200, body: { ok: true, customer: { ...REQ, id: "uuid-1" }, history: [], orders: [], stats: null, reviews: [] } }) });
    p.loadCard("maria@example.com", false);
    await flush();
    expect(S.admCustOpen).toBe("uuid-1");
    expect(S.admCustDetail.customer.id).toBe("uuid-1");
  });
});

describe("«Отзывы»", () => {
  const R = { id: "r1", name: "Anna", rating: 4, text: "Хорошо", lang: "RU", createdAt: "2026-09-20T10:00:00.000Z", productId: "p1" };

  it("the author of a review from a cabinet opens the customer's card (gap Q4); a guest's does not", () => {
    const p = panel({});
    const mine = p.review({ ...R, status: "pending", email: "anna@example.com" });
    expect(mine).toContain('<button class="adm-link adm-rev__who" data-admcustopen="anna@example.com">Anna</button>');
    expect(mine).toContain("anna@example.com");
    const guest = p.review({ ...R, status: "pending", email: "" });
    expect(guest).not.toContain("data-admcustopen");
    expect(guest).toContain("без аккаунта");
  });

  it("keeps «Скрыть» on a published review and «Опубликовать» on a hidden one (gap Q4 a)", () => {
    const p = panel({});
    const pub = p.review({ ...R, status: "approved" });
    expect(pub).toContain(':rejected">Скрыть');
    expect(pub).not.toContain(":approved");
    expect(pub).toContain("Опубликован");
    const hid = p.review({ ...R, status: "rejected" });
    expect(hid).toContain(':approved">Опубликовать');
    expect(hid).toContain(">Скрыт<");
  });
});

describe("the toast holds «Вернуть» as long as the change is held", () => {
  it("ten seconds for a letter, six for everything else", () => {
    const S: Any = { toast: null, toastUndo: null };
    const waits: number[] = [];
    const run = new Function("S", "ADM_UNDO_MS", "paintToast", "patchHeader", "patchNav", "setTimeout", "clearTimeout",
      `${slice("toast")} return toast;`)(S, 6000, () => {}, () => {}, () => {}, (_f: () => void, ms: number) => { waits.push(ms); return 0; }, () => {}) as (m: string, u?: Any) => void;
    run("Партнёр добавлен · письмо уйдёт через 10 с", { prev: true, ms: 10000, undo() {} });
    run("Отзыв опубликован", { prev: { type: "moderate_review" } });
    run("Сохранено");
    expect(waits).toEqual([10000, 6000, 2600]);
  });

  it("«Вернуть» on a held change runs its own way back", () => {
    let undone = 0;
    const S: Any = { toast: "x", toastUndo: { prev: true, undo: () => { undone++; } } };
    const run = new Function("S", "DEMO", "paintToast", "clearTimeout", "toast", "demoUndo", "journalNote", "admCancelLine", "render",
      `${slice("admUndoToast")} return admUndoToast;`)(S, { log: [] }, () => {}, () => {}, () => {}, () => { throw new Error("journal undo"); }, () => {}, () => "", () => {}) as () => void;
    run();
    expect(undone).toBe(1);
  });
});

describe("every new word reaches the ET and EN panel", () => {
  const tr = new Function("S", "LANG", `
    ${decl("UI")} ${decl("UI_RX")} ${slice("trName")} ${decl("TAIL_EXACT")} ${decl("NAME_TAILS")} ${decl("NAME_FRAGS")} ${slice("trText")}
    return trText(S, LANG, false);`) as (s: string, lang: string) => string;

  const PHRASES = [
    // a customer's name is data and stays as written — a Latin one here, so the check sees only our words
    "Maria Tamm — партнёр · письмо уйдёт через 10 с", "Заявка отклонена", "Отменено",
    "Начислено 1 балл", "Начислено 3 балла", "Начислено 10 баллов", "Списано 1 балл", "Списано 5 баллов",
    "Цены для салонов включены · письмо уйдёт через 10 с", "Цены для салонов включены · письмо уже отправляли",
    "Цены для салонов включены · письмо ушло", "Снова обычные цены", "Партнёр добавлен · письмо уйдёт через 10 с",
    "Заявки", "Скрытые", "Скачать список · Excel", "Скачать список · CSV", "Ещё действия", "Почта салона",
    "Начислить", "Списать", "Впишите число баллов — можно с минусом", "Не больше 1 000 000 баллов за раз",
    "Заявка на партнёрство", "Клиенты", "День рождения",
  ];
  for (const lang of ["ET", "EN"]) {
    it(`in ${lang}`, () => {
      for (const s of PHRASES) {
        expect(tr(s, lang), `«${s}» came back Russian in ${lang}`).not.toMatch(/[А-Яа-яЁё]/);
      }
      // the name and the count survive their rule
      expect(tr("Maria Tamm — партнёр · письмо уйдёт через 10 с", lang)).toContain("Maria Tamm");
      expect(tr("Начислено 10 баллов", lang)).toContain("10");
    });
  }
});
