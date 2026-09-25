/**
 * Direction 1a — «Товары» → Каталог, the product card and «Новый товар»
 * (design_handoff_admin_ux README § 5; Dim's answers of 25.09.2026, q17–q23).
 *
 * What the card promises now that it has no «Сохранить»:
 *   · a price, a size's name, the salon price, a count and a barcode go when
 *     the owner LEAVES the box (q1) — «1 €» on the way to «15 €» is never the
 *     shop's price — and «Сохранено ✓» waits for the server's 2xx;
 *   · what cannot be sent (an empty price, a size with no name, a code that
 *     is not a code, a code another size carries) is not sent, and it is the
 *     one thing «← Товары» still asks about;
 *   · the owner's own row: ONE write in flight per product, the rest merged
 *     into the next — the route reads, merges and writes the whole row with
 *     no version check — and the ladder always sends sizes AND prices;
 *   · the three descriptions travel together (the server replaces the object);
 *   · «Отвязать код» frees the code at once and «Вернуть» binds it back (q20);
 *   · − / + on «Остаток»: one move per burst;
 *   · a switch moves the shop at once, its write can be sent again;
 *   · a field changed again in the same visit is one journal line.
 * «Новый товар»: a draft that saves itself, a draft id the upload route
 * accepts, and «Добавить товар» with the draft's own Idempotency-Key (q23).
 * «Каталог»: «Кончаются» instead of «Нет в наличии» (q17), a barcode finds
 * its product, and the row's «Виден» switch is not inside the row's button.
 *
 * The real functions are cut out of public/shop2/app.js and run over stubs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const app = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(/\r\n?/g, "\n");

function block(start: number, what: string): string {
  if (start < 0) throw new Error(`public/shop2/app.js no longer has ${what}`);
  let depth = 0;
  for (let i = app.indexOf("{", start); i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}" && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error(`unterminated ${what}`);
}
const fn = (name: string) => block(app.indexOf(`function ${name}(`), `function ${name}`);
function decl(name: string): string {
  const m = new RegExp(`^  var ${name} = .*;$`, "m").exec(app);
  if (!m) throw new Error(`public/shop2/app.js no longer declares ${name} on one line`);
  return m[0].trim();
}
const objDecl = (name: string) => `${block(app.indexOf(`var ${name} = {`), `var ${name}`)};`;
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

const AUTOSAVE = [
  "admAutosavePolicy", "admAutosaveSpec", "admAutosave", "admAutosaveSend", "admAutosaveOk", "admAutosaveDone",
  "admSaveFailedN", "admSaveRetry", "admAutosaveFlush", "admSaveBegin", "admSaveEnd", "admSaveSet",
  "admAutosaveHintHTML", "admAutosaveInvalidAttr",
];
const CARD = [
  "edAsKey", "edVisit", "edOk", "edApi", "edWrite", "edJournal", "edCommit", "edTyped", "edInstant",
  "edOwnPut", "edOwnPump", "edOwnPrev", "edOwnField", "edAsSpec", "edTextsOf", "edLadderCheck", "edLadderSend",
  "edQtySend", "edEanNorm", "edEanCheck", "edEanSend", "goodsEditDirty", "edAsForget",
  // the shop's own helpers the card leans on
  "goodsPrice", "edLadderNow", "edLadderMoved", "updateActionOf", "updatePatchOf", "sizesBody", "sizeLadder",
  "setSizesLocal", "descKey", "seoNorm", "seoToServer", "seoOfAction", "demoApply", "demoUndo", "stockKey",
  "stockSaveErrText", "journalStamp", "galUrlsOf",
];

type Call = { url: string; method: string; body: any; key?: string };
type World = ReturnType<typeof world>;

function world() {
  const calls: Call[] = [];
  const answers: Array<(r: unknown) => void> = [];
  const toasts: Array<[string, unknown]> = [];
  const S: Record<string, any> = { lang: "RU", screen: "admin", adminEdit: "azur", goodsSizes: null, stockLevels: [], cart: [] };
  const SRV: Record<string, any> = { admin: true };
  const DEMO: Record<string, any> = {
    price: {}, proPrice: {}, stock: {}, sizes: {}, hidden: {}, seo: {}, subcat: {}, varimg: {}, video: {},
    gallery: {}, desc: {}, custom: [], log: [],
  };
  const catalogue: Record<string, any> = {
    azur: { id: "azur", brand: "Proraso", name: "Azur Lime", cat: "beard", price: 12, prices: [12], sizes: [], stock: "in", descOv: null, seoOv: null },
    duo: { id: "duo", brand: "Davines", name: "OI Oil", cat: "hair", price: 20, prices: [20, 35], sizes: ["50 мл", "135 мл"], stock: "in", descOv: null, seoOv: null },
  };
  const own: Record<string, any> = {
    id: "c-balm", brand: "Rempire", name: "Balm — бальзам", cat: "beard", subcat: "", price: 14,
    sizes: ["50 мл", "100 мл"], prices: [14, 22], description: null, gallery: [], photos: [], seo: null, active: true,
  };
  DEMO.custom.push(own);
  const send = (url: string, method: string, body: any, key?: string) => {
    calls.push({ url, method, body: JSON.parse(JSON.stringify(body || {})), key });
    return new Promise((resolve) => answers.push(resolve));
  };
  const api = new Function(
    "S", "SRV", "DEMO", "catalogue", "own", "send", "onToast",
    `${decl("ADM_SAVE_POLICY")}
     ${decl("ADM_SAVE_IDLE_MS")}
     ${decl("ADM_SAVE_SHOWN_MS")}
     var ADM_AS = {}, ADM_AS_SPEC = {}, ADM_SAVE = { state: "idle", busy: 0, fade: 0 };
     ${objDecl("ED")}
     ${decl("ED_BURST_MS")}
     var ED_OWN = {};
     ${objDecl("CUSTOM_ERR")}
     ${objDecl("STOCK_SAVE_ERRS")}
     var SEO_LANGS = ["RU", "ET", "EN"];
     var DESC_HOOKS = { RU: "[data-eddescru]", ET: "[data-eddescet]", EN: "[data-eddescen]" };
     var CATALOGUE = [catalogue.azur, catalogue.duo];
     var STOCK_MOVE_WORD = {};
     var shipRollback = null;
     var document = { querySelector: function () { return null; }, querySelectorAll: function () { return []; } };
     function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
     function admSavePaint() {}
     function admAutosaveMark() {}
     function toast(m, e) { onToast(m, e); }
     function render() {}
     function noop() {}
     function demoSave() {}
     function applyDemoOverrides() {
       Object.keys(catalogue).forEach(function (id) {
         var p = catalogue[id];
         if (DEMO.price[id] != null) { p.price = DEMO.price[id]; p.prices = [DEMO.price[id]].concat(p.prices.slice(1)); }
         if (DEMO.sizes[id]) { p.sizes = DEMO.sizes[id].map(function (r) { return r.size; }); p.prices = DEMO.sizes[id].map(function (r) { return r.price; }); }
         p.descOv = DEMO.desc[id] || null;
       });
     }
     function actionText(a) { return "line " + a.type; }
     function proOvWrote() {}
     function rebuildCatalogue() {}
     function customSetActive(id, v) { own.active = v; }
     function customSetGallery(id, list) { own.photos = list; }
     function customAdopt(row) { for (var k in row) own[k] = row[k]; }
     function findCustom(id) { return id === own.id ? own : null; }
     function byId(id) { return catalogue[id] || null; }
     function byIdOrNull(id) { return catalogue[id] || null; }
     function admEditProduct(id) {
       if (catalogue[id]) return catalogue[id];
       if (id === own.id) return { id: own.id, custom: true, brand: own.brand, name: own.name, cat: own.cat, price: own.price,
         prices: own.prices, sizes: own.sizes, descOv: own.description, seoOv: null };
       return null;
     }
     function loadCustomAll() {}
     function reloadStock() {}
     function customFail(code) { onToast("fail " + code); }
     function stockFindRow(key) {
       for (var i = 0; i < S.stockLevels.length; i++) if (stockKey(S.stockLevels[i].productId, S.stockLevels[i].variant) === key) return S.stockLevels[i];
       return null;
     }
     function stockMoveFailText(t) { return t; }
     function stockUndoApplied() {}
     function stockMoveSend(body) { return send("/api/admin/inventory/moves/", "POST", body); }
     function stockLevelSaveDetailed(body) {
       return send("/api/admin/inventory/", "PUT", body).then(function (r) { return { ok: r.status === 200 && r.body.ok, error: (r.body && r.body.error) || "" }; });
     }
     function apiSend(url, method, body, key) { return send(url, method, body, key); }
     function apiJson(url, opts) { return send(url, opts.method, opts.body ? JSON.parse(opts.body) : {}); }
     function srvPush(a) { onToast("push " + a.type, a); }
     function pushOverride() { onToast("pushOverride"); }
     function vidReset() {}
     function parseVideo(v) { return /youtu/.test(v) ? {} : null; }
     function stockQtyValue(raw) { var n = Number(String(raw).trim()); return isFinite(n) && n >= 0 ? Math.trunc(n) : null; }
     ${AUTOSAVE.map(fn).join("\n")}
     ${CARD.map(fn).join("\n")}
     return { ADM_AS: ADM_AS, SAVE: ADM_SAVE, ED: ED, autosave: admAutosave, flush: admAutosaveFlush, retry: admSaveRetry,
       spec: edAsSpec, key: edAsKey, instant: edInstant, check: edEanCheck, dirty: goodsEditDirty, undo: demoUndo,
       forget: edAsForget };`,
  )(S, SRV, DEMO, catalogue, own, send, (m: string, e: unknown) => toasts.push([m, e])) as Record<string, any>;

  const answer = async (r: unknown) => {
    const next = answers.shift();
    if (!next) throw new Error("nothing is waiting for an answer");
    next(r);
    await tick();
  };
  /** One box's life: typed (each value an `input`), then left (blur). */
  const type = (id: string, field: string, values: string[], leave = "blur") => {
    const key = api.key({ id }, field), spec = api.spec(id, field);
    for (const v of values) api.autosave(key, v, "input", spec);
    if (leave) api.autosave(key, values[values.length - 1], leave, spec);
    return key;
  };
  const ladder = (rows: Array<[string, string]>) => JSON.stringify(rows.map(([size, price]) => ({ size, price })));
  return { api, calls, answer, toasts, S, SRV, DEMO, catalogue, own, type, ladder };
}

const OK = (body: Record<string, unknown> = {}) => ({ status: 200, body: { ok: true, ...body } });

describe("a price saves when the box is left, and «Сохранено ✓» waits for the server", () => {
  let w: World;
  beforeEach(() => { w = world(); });

  it("«1» on the way to «15» never reaches the shop", async () => {
    const key = w.api.key({ id: "azur" }, "ladder"), spec = w.api.spec("azur", "ladder");
    w.api.autosave(key, w.ladder([["", "1"]]), "input", spec);
    w.api.autosave(key, w.ladder([["", "15"]]), "input", spec);
    expect(w.calls, "a keystroke went out").toHaveLength(0);
    w.api.autosave(key, w.ladder([["", "15"]]), "blur", spec);
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0]).toMatchObject({ url: "/api/admin/overrides/", method: "PUT", body: { id: "azur", price: 15 } });
    // not before the answer: the shop's copy, the journal and the status wait
    expect(w.api.SAVE.state).toBe("saving");
    expect(w.DEMO.price.azur).toBeUndefined();
    await w.answer(OK());
    expect(w.DEMO.price.azur).toBe(15);
    expect(w.api.SAVE.state).toBe("saved");
    expect(w.DEMO.log[0].prev).toMatchObject({ type: "set_price", id: "azur", value: 12 });
  });

  it("a refusal is not «Сохранено ✓», and «Повторить» sends the same price again", async () => {
    w.type("azur", "ladder", [w.ladder([["", "15"]])]);
    await w.answer({ status: 503, body: { ok: false } });
    expect(w.api.SAVE.state).toBe("error");
    expect(w.DEMO.price.azur, "the copy claimed a price the server never took").toBeUndefined();
    w.api.retry();
    expect(w.calls).toHaveLength(2);
    expect(w.calls[1].body).toMatchObject({ id: "azur", price: 15 });
    await w.answer(OK());
    expect(w.DEMO.price.azur).toBe(15);
  });

  it("an empty price is not sent — it is what «← Товары» asks about — and goes once it is right", async () => {
    const key = w.type("azur", "ladder", [w.ladder([["", ""]])]);
    expect(w.calls).toHaveLength(0);
    expect(w.api.ADM_AS[key].err).toMatch(/Цена — число от 1 до 500/);
    expect(w.api.dirty(), "leaving would lose the box silently").toBe(true);
    w.type("azur", "ladder", [w.ladder([["", "14"]])]);
    expect(w.calls).toHaveLength(1);
    await w.answer(OK());
    expect(w.api.dirty()).toBe(false);
  });

  it("a new size waits for its name, then the whole ladder travels", async () => {
    w.type("duo", "ladder", [w.ladder([["50 мл", "20"], ["135 мл", "35"], ["", "35"]])]);
    expect(w.calls, "a size with no name was sent").toHaveLength(0);
    w.S.adminEdit = "duo";
    expect(w.api.dirty()).toBe(true);
    w.type("duo", "ladder", [w.ladder([["50 мл", "20"], ["135 мл", "35"], ["250 мл", "45"]])]);
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0].body).toEqual({ id: "duo", sizes: [{ size: "50 мл", price: 20 }, { size: "135 мл", price: 35 }, { size: "250 мл", price: 45 }], price: 20 });
  });

  it("the salon price is refused above the retail price, and an empty box is «the discount» (null)", async () => {
    const key = w.type("azur", "pro", ["15"]);
    expect(w.api.ADM_AS[key].err).toMatch(/не может быть выше розничной/);
    expect(w.calls).toHaveLength(0);
    w.type("azur", "pro", ["9,50"]);
    expect(w.calls[0].body).toEqual({ id: "azur", proPrice: 9.5 });
    await w.answer(OK());
    w.type("azur", "pro", [""]);
    expect(w.calls[1].body).toEqual({ id: "azur", proPrice: null });
  });

  it("the same field changed twice in one visit is ONE journal line, whose «Вернуть» goes back to the start", async () => {
    w.type("azur", "ladder", [w.ladder([["", "15"]])]);
    await w.answer(OK());
    w.type("azur", "ladder", [w.ladder([["", "18"]])]);
    await w.answer(OK());
    const lines = w.DEMO.log.filter((e: any) => e.a && e.a.type === "set_price");
    expect(lines).toHaveLength(1);
    expect(lines[0].prev.value, "the undo went back one step, not to the price the visit began with").toBe(12);
  });
});

describe("the owner's own product: one write in flight, sizes always with prices", () => {
  it("a second field waits for the first PUT and is merged into the next", async () => {
    const w = world();
    w.S.adminEdit = "c-balm";
    w.type("c-balm", "name", ["Balm Pro — бальзам"]);
    w.type("c-balm", "brand", ["Rempire Lab"]);
    w.type("c-balm", "ladder", [w.ladder([["50 мл", "15"], ["100 мл", "22"]])]);
    expect(w.calls, "two PUTs of the same row in the air at once").toHaveLength(1);
    expect(w.calls[0].body).toEqual({ name: "Balm Pro — бальзам" });
    await w.answer(OK({ product: { name: "Balm Pro — бальзам" } }));
    expect(w.calls).toHaveLength(2);
    expect(w.calls[1].url).toBe("/api/admin/products/c-balm/");
    expect(w.calls[1].body).toEqual({ brand: "Rempire Lab", sizes: ["50 мл", "100 мл"], prices: [15, 22] });
  });

  it("a single price still travels as sizes: [] with prices, never as {price} alone", async () => {
    const w = world();
    w.own.sizes = []; w.own.prices = [14];
    w.type("c-balm", "ladder", [w.ladder([["", "16"]])]);
    expect(w.calls[0].body).toEqual({ sizes: [], prices: [16] });
  });

  it("the journal's undo carries only the field it changed", async () => {
    const w = world();
    w.type("c-balm", "name", ["Balm Pro"]);
    await w.answer(OK({ product: { name: "Balm Pro" } }));
    expect(w.DEMO.log[0].prev).toEqual({ type: "update_product", id: "c-balm", name: "Balm — бальзам" });
  });
});

describe("the three descriptions travel together", () => {
  it("one PUT with RU, ET and EN — the server replaces the object whole", () => {
    vi.useFakeTimers();
    try {
      const w = world();
      const key = w.api.key({ id: "azur" }, "desc"), spec = w.api.spec("azur", "desc");
      w.api.autosave(key, JSON.stringify({ RU: "Бальзам", ET: "", EN: "Balm" }), "input", spec);
      expect(w.calls).toHaveLength(0);
      vi.advanceTimersByTime(1000);
      expect(w.calls).toHaveLength(1);
      expect(w.calls[0].body).toEqual({ id: "azur", description: { RU: "Бальзам", ET: "", EN: "Balm" } });
    } finally { vi.useRealTimers(); }
  });
});

describe("«Штрихкод»: checked before it travels, freed at once, «Вернуть» binds it back", () => {
  it("refuses what the server would refuse, naming the size that has the code", () => {
    const w = world();
    w.S.stockLevels = [{ productId: "duo", variant: "50 мл", ean: "4750323781389", tracked: true, qty: 3 }];
    expect(w.api.check("azur ", "4750"), "four digits: a half-typed EAN, not a code of the shop").toMatch(/8–14 цифр/);
    expect(w.api.check("azur ", "4750323781389")).toMatch(/уже привязан к другому товару: Davines — OI Oil · 50 мл/);
    expect(w.api.check("duo 50 мл", "4750323781389"), "its own code").toBe("");
    expect(w.api.check("azur ", "RMP-0042"), "the shop's own codes are codes").toBe("");
  });

  it("«Отвязать код»: a PUT with no code, and the journal can put the old one back", async () => {
    const w = world();
    w.S.stockLevels = [{ productId: "azur", variant: "", ean: "4750323781389", tracked: true, qty: 3 }];
    const key = w.api.key({ id: "azur" }, "ean:"), spec = w.api.spec("azur", "ean:");
    w.api.ED.toastFor[key] = "Код отвязан";
    w.api.autosave(key, "", "input", spec);
    w.api.autosave(key, "", "enter", spec);
    expect(w.calls[0]).toMatchObject({ url: "/api/admin/inventory/", method: "PUT", body: { productId: "azur", variant: "", ean: null } });
    await w.answer(OK());
    const [msg, entry] = w.toasts.find((t) => t[0] === "Код отвязан")!;
    expect(msg).toBe("Код отвязан");
    expect((entry as any).prev).toMatchObject({ type: "set_ean", product_id: "azur", value: "4750323781389" });
    w.api.undo(w.DEMO.log.indexOf(entry));
    expect(w.toasts.some((t) => t[0] === "push set_ean" && (t[1] as any).value === "4750323781389")).toBe(true);
  });
});

describe("«Остаток»: a count is a move against the shelf", () => {
  it("a counted size moves by the difference, a new one takes the number itself", async () => {
    const w = world();
    w.S.stockLevels = [{ productId: "duo", variant: "50 мл", tracked: true, qty: 3 }];
    w.type("duo", "qty:50 мл", ["6"]);
    expect(w.calls[0]).toMatchObject({ url: "/api/admin/inventory/moves/", body: { productId: "duo", variant: "50 мл", delta: 3, reason: "adjust" } });
    await w.answer({ delta: 3 });
    w.type("duo", "qty:135 мл", ["4"]);
    expect(w.calls[1].body).toMatchObject({ productId: "duo", variant: "135 мл", qty: 4 });
  });

  it("a burst of − / + says what it did, from where to where, with «Вернуть»", async () => {
    const w = world();
    w.S.stockLevels = [{ productId: "duo", variant: "50 мл", tracked: true, qty: 3 }];
    w.api.ED.burst["duo 50 мл"] = 3;
    w.type("duo", "qty:50 мл", ["6"]);
    await w.answer({ delta: 3 });
    const t = w.toasts.find((x) => /^Остаток:/.test(x[0]));
    expect(t && t[0]).toBe("Остаток: 3 → 6");
    expect((t![1] as any).prev).toMatchObject({ type: "stock_adjust", delta: -3 });
  });
});

describe("a switch moves the shop at once, and its write can be sent again", () => {
  it("«Показывать в магазине» off: hidden now, PUT {hidden}, «Повторить» after a failure", async () => {
    const w = world();
    w.api.instant("ed:azur:shown", { type: "set_hidden", id: "azur", value: true, name: "Proraso — Azur Lime" }, "Товар скрыт из магазина");
    expect(w.DEMO.hidden.azur).toBe(true);
    expect(w.toasts[0][0]).toBe("Товар скрыт из магазина");
    expect(w.calls[0]).toMatchObject({ body: { id: "azur", hidden: true } });
    await w.answer({ status: 500, body: { ok: false } });
    expect(w.api.SAVE.state).toBe("error");
    w.api.retry();
    expect(w.calls[1]).toMatchObject({ body: { id: "azur", hidden: true } });
  });

  it("pressed again after its «Вернуть» it is a new write, not a skipped repeat", async () => {
    const w = world();
    const a = { type: "set_hidden", id: "azur", value: true, name: "x" };
    w.api.instant("ed:azur:shown", a, "");
    await w.answer(OK());
    w.api.undo(0);
    w.api.instant("ed:azur:shown", a, "");
    expect(w.calls).toHaveLength(2);
  });
});

describe("«← Товары» asks only about what could not be sent", () => {
  it("«Новый товар» never asks — its draft is kept", () => {
    const w = world();
    w.S.adminEdit = "new";
    expect(w.api.dirty()).toBe(false);
  });
  it("a closed card forgets its fields, but not a write still in the air", () => {
    const w = world();
    const k1 = w.type("azur", "ladder", [w.ladder([["", ""]])]);
    const k2 = w.type("azur", "pro", ["9"]);
    w.api.forget("azur");
    expect(w.api.ADM_AS[k1]).toBeUndefined();
    expect(w.api.ADM_AS[k2], "a write in the air was dropped").toBeDefined();
  });
});

/* ---------- «Новый товар» ------------------------------------------------- */
describe("«Новый товар»: the draft saves itself, and «Добавить товар» makes one product", () => {
  const store: Record<string, string> = {};
  let gn: Record<string, any>;
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    const localStorage = {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    };
    gn = new Function("localStorage", `
      var S = { adminEdit: "new", goodsNew: null };
      var CAT_NAMES = { beard: "Борода" };
      var GN = { mem: null, t: 0 };
      var dropped = [];
      ${decl("GOODS_NEW_KEY")}
      ${decl("GOODS_NEW_MS")}
      var UP = { err: "" };
      var ED = { dropTyped: false };
      var document = undefined;
      function idemNewKey() { return "6F9619FF-8B86-D011-B42D-00C04FC964FF"; }
      function galDrop(k) { dropped.push(k); }
      function goodsNewSync() { return S.goodsNew; }
      ${fn("goodsNewBlank")}
      ${fn("goodsNewHasContent")}
      ${fn("goodsNewLoad")}
      ${fn("goodsNewSave")}
      ${fn("goodsNewClear")}
      ${fn("goodsNewReset")}
      return { S: S, blank: goodsNewBlank, has: goodsNewHasContent, load: goodsNewLoad, save: goodsNewSave,
        clear: goodsNewClear, reset: goodsNewReset, dropped: dropped, GN: GN };
    `)(localStorage);
  });

  it("a blank draft is not offered back; its id is one the upload route files a photo under", () => {
    const d = gn.blank();
    expect(gn.has(d)).toBe(false);
    // src/lib/storage.ts safeId(): lower case, [a-z0-9._-], at most 80
    expect(d.draftId).toMatch(/^[a-z0-9][a-z0-9._-]*$/);
    expect(d.draftId.length).toBeLessThanOrEqual(80);
    expect(d.idemKey).toBeTruthy();
  });

  it("what is typed is kept in the browser and comes back on the next «+ Товар»", () => {
    gn.S.goodsNew = gn.blank();
    gn.S.goodsNew.brand = "Proraso";
    gn.S.goodsNew.sizes = [{ size: "", price: "16" }];
    gn.save();
    const back = gn.load();
    expect(back.brand).toBe("Proraso");
    expect(back.idemKey, "the key must survive — it is what makes a retry the same product").toBe(gn.S.goodsNew.idemKey);
    expect(gn.has(back)).toBe(true);
  });

  it("«Начать заново» takes the draft's photos out of the bucket; a product made keeps them", () => {
    gn.S.goodsNew = gn.blank();
    gn.S.goodsNew.photos = [{ url: "https://cdn/a.webp", key: "products/draft-x/a.webp" }];
    gn.save();
    gn.clear();
    expect(gn.dropped).toEqual([]);
    gn.S.goodsNew.photos = [{ url: "https://cdn/b.webp", key: "products/draft-x/b.webp" }];
    gn.save();
    gn.reset();
    expect(gn.dropped).toEqual(["products/draft-x/b.webp"]);
    expect(gn.load(), "the draft outlived «Начать заново»").toBeNull();
  });

  it("a picked «Раздел» survives a render by its value — the list losing «Выберите» does not shift it", () => {
    // before the render «Уход за бородой» was option 3 (after «Выберите»); after it, 3 is «face»
    const opts = ["hair", "styling", "beard", "face"];
    let idx = 3;
    const sel = {
      tagName: "SELECT",
      get value() { return opts[idx] ?? ""; },
      set value(v: string) { idx = opts.indexOf(v); },
      get selectedIndex() { return idx; },
      set selectedIndex(i: number) { idx = i; },
    };
    const run = new Function("bodySlot", "document",
      `${fn("edKeepRestore")}\n edKeepRestore([{ sel: "select[data-edcat]", value: "beard", idx: 3, range: null }]);`);
    run({ querySelector: () => sel }, { activeElement: null });
    expect(sel.value, "the section moved one line down the list").toBe("beard");
  });

  it("«Начать заново» empties the boxes on screen too — the render does not put the typed text back", () => {
    // renderImpl carries typed boxes across a render (edKeepTyped); the reset
    // is the one render that must not, or the brand came back after it
    expect(fn("goodsNewReset")).toContain("ED.dropTyped = true");
    expect(app).toContain('=== S.adminEdit && !ED.dropTyped) goodsKeep = edKeepTyped(openFor);');
    // …and the flag holds until the page is patched: the markup reads the draft (goodsNewDraft), not the old boxes
    expect(app).toMatch(/if \(goodsKeep\) edKeepRestore\(goodsKeep\);\r?\n\s+ED\.dropTyped = false;/);
    expect(fn("goodsNewDraft")).toContain("ED.dropTyped ? null : document.querySelector(sel)");
  });

  it("«Добавить товар» sends the draft's own Idempotency-Key and its photos as the gallery", () => {
    const branch = block(app.indexOf("if (d.admsavegoods !== undefined) {"), "the «Добавить товар» branch");
    expect(branch).toContain("customCreate(ownRow, \"form\", S.goodsNew && S.goodsNew.idemKey)");
    expect(branch).toContain("ownRow.gallery = gnPhotos.map(");
    const create = fn("customCreate");
    expect(create).toContain('apiSend("/api/admin/products/", "POST", patch, idemKey || idemNewKey())');
    // a lost answer and a changed draft: the product is there — no twin under a new key
    expect(create).toMatch(/key_reused[\s\S]*Этот товар уже добавлен/);
  });

  it("a photo picked before the product exists goes up under the draft's id (q23)", () => {
    const up = fn("goodsNewUpload");
    expect(up).toContain('uploadPhoto(f, "product", d.draftId)');
    expect(fn("galUpload")).toContain("if (p && p.isNew) { goodsNewUpload(files); return; }");
  });
});

/* ---------- «Каталог» ------------------------------------------------------ */
describe("«Каталог»: «Кончаются», a barcode search and the «Виден» switch", () => {
  const cat = new Function(`
    var S = { goodsFilter: "all", goodsQ: "", goodsShown: 40, lang: "RU", stockLevels: [
      { productId: "a", variant: "75 мл", tracked: true, state: "in", qty: 5 },
      { productId: "a", variant: "500 мл", tracked: true, state: "out", qty: 0, ean: "4750323781389" },
      { productId: "b", variant: "", tracked: false }
    ] };
    var DEMO = { hidden: { c: true } };
    var list = [
      { id: "a", brand: "System 4", name: "Shampoo", sizes: ["75 мл", "500 мл"], prices: [9, 25], price: 9, stock: "in" },
      { id: "b", brand: "Proraso", name: "Balm", sizes: [], prices: [16], price: 16, stock: "in" },
      { id: "c", brand: "Proraso", name: "Oil", sizes: [], prices: [15], price: 15, stock: "low" }
    ];
    function shopHidden(id) { return !!DEMO.hidden[id]; }
    function admCatalogList() { return list; }
    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
    function media() { return "<img>"; }
    function eur(n) { return String(n).replace(".", ",") + " €"; }
    function customFresh() { return false; }
    function scanFold(s) { return String(s || "").toLowerCase().trim(); }
    function scanWordHas(hay, words, w) { return hay.indexOf(w) >= 0; }
    ${decl("ADM_TAG_KIND")}
    ${block(app.indexOf("var ADM_GOODS_FILTERS = ["), "ADM_GOODS_FILTERS")};
    ${fn("admTagHTML")}
    ${fn("admSwitchFace")}
    ${fn("admSwitch")}
    var ADM_SW_TICK = "";
    ${fn("goodsOffSale")}
    ${fn("goodsStockWord")}
    ${fn("goodsRunsLow")}
    ${fn("goodsFilterNow")}
    ${fn("goodsMatchesFilter")}
    ${fn("admCatalogRows")}
    ${fn("admCatalogRow")}
    return { S: S, list: list, filters: ADM_GOODS_FILTERS, match: goodsMatchesFilter, rows: admCatalogRows, row: admCatalogRow };
  `)() as Record<string, any>;

  it("«Кончаются» takes the place of «Нет в наличии» (q17)", () => {
    expect(cat.filters.map((x: string[]) => x[1])).toEqual(["Все", "В магазине", "Скрытые", "Кончаются"]);
    expect(cat.filters.map((x: string[]) => x[1])).not.toContain("Нет в наличии");
  });

  it("a product whose one size is out is under «Кончаются» though its badge says «В наличии»; a hidden one is not", () => {
    const [a, b, c] = cat.list;
    expect(cat.match(a, "low")).toBe(true);
    expect(cat.match(b, "low")).toBe(false);
    expect(cat.match(c, "low"), "a product the shop does not show is not for reordering").toBe(false);
    // a filter left on «out» from before lands on the same list
    expect(cat.match(a, "out")).toBe(true);
  });

  it("a barcode typed into the search finds its product", () => {
    cat.S.goodsQ = "4750323";
    const html = cat.rows();
    expect(html).toContain('data-admgoods="a"');
    expect(html).not.toContain('data-admgoods="b"');
    cat.S.goodsQ = "";
  });

  it("the row: brand over name, the «Виден» switch beside the button, never inside it", () => {
    const html = cat.row(cat.list[0]);
    const button = html.slice(html.indexOf("<button"), html.indexOf("</button>") + 9);
    expect(button).toContain('data-admgoods="a"');
    expect(button).not.toContain("data-goodsvis");
    expect(html).toContain('data-goodsvis="a"');
    expect(html).toContain('<span class="adm-grow__br">System 4</span>');
    expect(html).toContain("adm-grow__pr");
  });
});

afterEach(() => { vi.useRealTimers(); });
