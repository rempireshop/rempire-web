/**
 * Direction 1a — «Наборы»: a set saves itself (README § 5; Dim, 25.09.2026,
 * q27, q28, q8).
 *
 *   · the whole row goes through the one route it always did (POST
 *     /api/admin/bundles/), and only once the route would take it: a Russian
 *     name, two to eight products, a price below the parts;
 *   · «+ Набор» is a LOCAL draft that becomes a real set — hidden — the moment
 *     it is valid, on the address its Russian name gives it (q27, q23);
 *   · the price is what is stored, never the percentage (q28);
 *   · a name or a price leaves when the box is left, not per keystroke;
 *   · the route's refusal is shown in its own words and nothing claims
 *     «Сохранено ✓»;
 *   · a confirmed delete is held ADM_UNDO_MS with «Вернуть» before the
 *     DELETE goes (q8);
 *   · the same bottle added twice is one more of it, never a second line the
 *     route would refuse.
 *
 * The real functions are cut out of public/shop2/app.js by source text and run
 * over stubs; the timers are vitest's fake ones.
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
function decl(name: string): string {
  const m = new RegExp(`^  var ${name} = .*;$`, "m").exec(app);
  if (!m) throw new Error(`public/shop2/app.js no longer declares ${name} on one line`);
  return m[0].trim();
}
function block(name: string): string {
  const head = app.indexOf(`  var ${name} = `);
  if (head < 0) throw new Error(`public/shop2/app.js no longer declares ${name}`);
  const open = app.slice(head).search(/[[{]/) + head;
  const close = app[open] === "[" ? "]" : "}";
  let depth = 0;
  for (let i = open; i < app.length; i++) {
    if (app[i] === app[open]) depth++;
    else if (app[i] === close && --depth === 0) return app.slice(head, i + 1) + ";";
  }
  throw new Error(`unterminated ${name}`);
}
/** The click delegate's own `if (…) { … }` block for one data attribute. */
function branch(head: string): string {
  const start = app.indexOf(head);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has «${head}»`);
  let depth = 0;
  for (let i = app.indexOf("{", start); i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}" && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in «${head}»`);
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

type Call = { url: string; method: string; body: Record<string, unknown> | null };

const AUTOSAVE = [
  "admAutosavePolicy", "admAutosave", "admAutosaveSend", "admAutosaveOk", "admAutosaveDone",
  "admSaveFailedN", "admAutosaveFlush", "admSaveBegin", "admSaveEnd", "admSaveSet",
];
const SETS = [
  "bundleUid", "blankBundle", "bundleToForm", "bundleListEntry", "bundleDraftHas", "bundleDraftStore", "bundleDraftClear",
  "bundleFormSum", "bundleFormPrice", "bundleProblem", "bundleFormPayload", "bundleAsKey", "bundleAsSpec", "bundleTouched",
  "bundleAsEvent", "bundleAsSend", "bundlePaintErr", "bundlePaintState", "bundleJournal", "bundleSnap", "bundleSnapApply",
  "bundleUndoLocal", "bundleHoldDelete", "bundleHeldGo", "deleteBundleById",
];

/* two catalogue products at 9 € and 8 € — a set of both costs 17 € separately */
const CATALOGUE = [
  { id: "shampoo", brand: "System 4", name: "Shampoo", price: 9, sizes: ["75 мл", "250 мл"], prices: [9, 20] },
  { id: "balm", brand: "Proraso", name: "Balm", price: 8, sizes: [], prices: [8] },
];

function sets(list: Array<Record<string, unknown>> | null = []) {
  const calls: Call[] = [];
  const toasts: Array<{ msg: string; undo: unknown }> = [];
  const store: Record<string, string> = {};
  let answer: (c: Call) => { status: number; body: Record<string, unknown> } = () => ({ status: 200, body: { ok: true } });
  const S: Record<string, unknown> = { lang: "RU", screen: "admin", admBundles: list, bundleForm: null, bundleFormErr: "", bundleQ: "" };
  const body = `
    ${decl("ADM_SAVE_POLICY")}
    ${decl("ADM_SAVE_IDLE_MS")}
    ${decl("ADM_SAVE_SHOWN_MS")}
    ${decl("ADM_UNDO_MS")}
    ${decl("BUNDLE_DRAFT_KEY")}
    ${block("BUNDLE_SAVE_ERRS")}
    var BUNDLE_UIDN = 0, BUNDLE_HELD = {};
    var ADM_AS = {}, ADM_AS_SPEC = {};
    var ADM_SAVE = { state: "idle", busy: 0, fade: 0, refused: false };
    var SRV = { admin: true };
    var DEMO = { log: [] };
    var CATALOGUE = CAT;
    var localStorage = { getItem: function (k) { return STORE[k] || null; }, setItem: function (k, v) { STORE[k] = v; }, removeItem: function (k) { delete STORE[k]; } };
    var document = undefined;
    function byIdOrNull(id) { for (var i = 0; i < CATALOGUE.length; i++) if (CATALOGUE[i].id === id) return CATALOGUE[i]; return null; }
    function sizePrice(p, i) { return p.prices[i || 0] != null ? p.prices[i || 0] : p.price; }
    function bundleSuggestId(t) { return (t && t.RU) === "Набор для бороды" ? "beard-set" : "set-x"; }
    function bundleTitle(b) { return (b.title && b.title.RU) || b.id; }
    function hydrateBundles(l) { return l; }
    function admSavePaint() {}
    function admAutosaveMark() {}
    function trText(s) { return s; }
    function journalStamp() { return "t"; }
    function actionText(a) { return a.type; }
    function demoSave() {}
    function journalNote() {}
    function toast(m, u) { TOASTS.push({ msg: m, undo: u }); }
    function render() {}
    function loadAdminBundles() {}
    function loadBundles() {}
    function call(url, method, b) { var c = { url: url, method: method, body: b || null }; CALLS.push(c); return Promise.resolve(ANSWER(c)); }
    function apiSend(url, method, b) { return call(url, method, b); }
    function apiJson(url, opts) { return call(url, (opts && opts.method) || "GET", null); }
    ${AUTOSAVE.map(fn).join("\n")}
    ${SETS.map(fn).join("\n")}
    function click(d, t) {
      var pendingAction = null;
      ${branch("if (d.bundleadd) {")}
    }
    return { S: S, blank: blankBundle, toForm: bundleToForm, touched: bundleTouched, leave: bundleAsEvent,
      problem: bundleProblem, payload: bundleFormPayload, hold: bundleHoldDelete, undo: bundleUndoLocal,
      held: BUNDLE_HELD, log: DEMO.log, click: click, SAVE: ADM_SAVE };
  `;
  const api = new Function("S", "CAT", "CALLS", "TOASTS", "STORE", "ANSWER", body)(
    S, CATALOGUE, calls, toasts, store, (c: Call) => answer(c),
  ) as {
    S: Record<string, unknown>;
    blank: () => Record<string, any>;
    toForm: (b: Record<string, unknown>) => Record<string, any>;
    touched: (kind: string) => void;
    leave: (ev: string) => void;
    problem: (f: Record<string, unknown>) => string;
    payload: (f: Record<string, unknown>) => Record<string, unknown>;
    hold: (id: string) => void;
    undo: (a: Record<string, unknown>) => void;
    held: Record<string, unknown>;
    log: Array<{ prev: Record<string, unknown> }>;
    click: (d: Record<string, string>, t: { getAttribute: (n: string) => string | null }) => void;
    SAVE: { state: string };
  };
  return { ...api, calls, toasts, store, answer: (f: typeof answer) => { answer = f; } };
}

const saved = { id: "beard-start", cat: "beard", title: { RU: "Борода — старт", ET: "", EN: "" }, desc: { RU: "", ET: "", EN: "" },
  items: [{ productId: "shampoo", variant: 0, qty: 1 }, { productId: "balm", variant: 0, qty: 1 }],
  price: 15, image: "", active: true, sort: 7 };

describe("«+ Набор» is a local draft until it is valid (q27)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("nothing reaches the server while a name, two products or the price is missing", async () => {
    const s = sets();
    const f = s.blank(); s.S.bundleForm = f;
    f.title.RU = "Набор для бороды"; s.touched("name"); s.leave("blur");
    f.items.push({ productId: "shampoo", variant: 0, qty: 1 }); s.touched("pick");
    await flush();
    expect(s.calls).toEqual([]);
    expect(s.problem(f)).toBe("В наборе должно быть минимум два товара.");
    // …but it is kept in this browser, so a reload does not lose it
    expect(JSON.parse(s.store["rmp-bundle-draft"]).title.RU).toBe("Набор для бороды");
  });

  it("the moment it is valid it is created — HIDDEN, on the address its Russian name gives it", async () => {
    const s = sets();
    const f = s.blank(); s.S.bundleForm = f;
    f.title.RU = "Набор для бороды";
    f.items.push({ productId: "shampoo", variant: 0, qty: 1 }, { productId: "balm", variant: 0, qty: 1 });
    f.price = "12,90"; s.touched("money");
    await flush();
    expect(s.calls, "a price typed half-way went to the shop").toEqual([]);   // money leaves on blur
    s.leave("blur");
    await flush();
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({ url: "/api/admin/bundles/", method: "POST" });
    expect(s.calls[0].body).toMatchObject({ id: "beard-set", active: false, price: 12.9, title: { RU: "Набор для бороды" } });
    expect(f.editing, "the draft did not become a set").toBe(true);
    expect(s.store["rmp-bundle-draft"], "the draft outlived the set it became").toBeUndefined();
    expect(s.SAVE.state).toBe("saved");
  });

  it("the price is what is stored — never the percentage (q28)", () => {
    const s = sets([saved]);
    const f = s.toForm(saved);
    expect(s.payload(f)).toMatchObject({ price: 15 });
    expect(s.payload(f)).not.toHaveProperty("discountPct");
  });

  it("a price at or above the parts is not sent, and says why", async () => {
    const s = sets([saved]);
    const f = s.toForm(saved); s.S.bundleForm = f;
    f.price = "17"; s.touched("money"); s.leave("blur");
    await flush();
    expect(s.calls).toEqual([]);
    expect(s.problem(f)).toBe("Набор должен стоить дешевле, чем те же товары по отдельности.");
  });
});

describe("a set that exists saves itself — the whole row, its order kept", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("a description goes after the pause, a picked photo at once", async () => {
    const s = sets([saved]);
    const f = s.toForm(saved); s.S.bundleForm = f;
    f.desc.RU = "Масло и бальзам."; s.touched("text");
    await flush();
    expect(s.calls).toEqual([]);
    vi.advanceTimersByTime(1000);
    await flush();
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].body).toMatchObject({ id: "beard-start", desc: { RU: "Масло и бальзам." }, active: true });
    f.image = "balm"; s.touched("pick");
    await flush();
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1].body).toMatchObject({ image: "balm" });
  });

  it("the row carries the list's order, not the one the form opened with (↑ ↓ are PATCHed on their own)", () => {
    const moved = { ...saved, sort: 2 };
    const s = sets([moved]);
    const f = s.toForm(saved);                 // opened before the arrows moved it
    expect(s.payload(f).sort).toBe(2);
  });

  it("the route's refusal is shown in its own words, and nothing says «Сохранено ✓»", async () => {
    const s = sets([saved]);
    s.answer(() => ({ status: 400, body: { ok: false, error: "price_too_high" } }));
    const f = s.toForm(saved); s.S.bundleForm = f;
    f.cat = "hair"; s.touched("pick");
    await flush();
    expect(s.S.bundleFormErr).toBe("Набор должен стоить дешевле, чем те же товары по отдельности.");
    expect(s.SAVE.state).toBe("idle");
  });
});

describe("the same bottle added twice is one more of it", () => {
  it("a chip of a volume already in the set adds one to its quantity; another volume is a line of its own", () => {
    const s = sets([saved]);
    const f = s.toForm(saved); s.S.bundleForm = f;
    const chip = (sz: string) => ({ getAttribute: (n: string) => (n === "data-bundleaddsz" ? sz : null) });
    s.click({ bundleadd: "shampoo" }, chip("0"));
    expect(f.items).toEqual([{ productId: "shampoo", variant: 0, qty: 2 }, { productId: "balm", variant: 0, qty: 1 }]);
    s.click({ bundleadd: "shampoo" }, chip("1"));
    expect(f.items[2]).toEqual({ productId: "shampoo", variant: 1, qty: 1 });
  });
});

describe("«Удалить набор» is held with «Вернуть» before the DELETE goes (q8)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("leaves the list at once; the DELETE waits ADM_UNDO_MS", async () => {
    const s = sets([saved]);
    s.hold("beard-start");
    expect(s.S.admBundles).toEqual([]);
    expect(s.toasts[0].msg).toBe("Набор удалён ✓");
    expect(s.calls).toEqual([]);
    vi.advanceTimersByTime(5999);
    expect(s.calls).toEqual([]);
    vi.advanceTimersByTime(1);
    await flush();
    expect(s.calls).toEqual([{ url: "/api/admin/bundles/?id=beard-start", method: "DELETE", body: null }]);
  });

  it("«Вернуть» inside the window puts it back and nothing is ever sent", async () => {
    const s = sets([saved]);
    s.hold("beard-start");
    s.undo(s.log[0].prev);                       // demoUndo → bundleUndoLocal
    expect((s.S.admBundles as Array<{ id: string }>).map((b) => b.id)).toEqual(["beard-start"]);
    vi.advanceTimersByTime(10000);
    await flush();
    expect(s.calls, "the held DELETE still went").toEqual([]);
    expect(s.log[0].prev.held).toBe(true);        // srvPush then knows there is nothing to re-create
  });
});
