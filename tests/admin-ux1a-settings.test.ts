/**
 * «Настройки» in direction 1a (design_handoff_admin_ux README § 5; Dim's
 * answers of 25.09.2026 — q4, q7, q8, q37–q40).
 *
 *   · every settings key saves through one slot: the whole value of its key,
 *     the toast with «Вернуть» only after the server's 2xx, `ref` so the
 *     journal can tell this browser's row from another device's;
 *   · the index: six pages, «Языки» one line with nothing to tap (q39),
 *     «нет IBAN» on «О компании», the «Письма» door;
 *   · «Часы работы»: 24-hour boxes that format themselves (q38) and the line
 *     that sums the week up;
 *   · «Журнал»: this browser's lines and the server's merged, a line of a
 *     key saved whole taken back from here only while it is the newest of its
 *     key (older ones through the server row), the server row's fields put
 *     back over the key as it is NOW (q7);
 *   · a confirmed delete is held five seconds with «Вернуть» (q8).
 *
 * The real functions are sliced out of public/shop2/app.js and run on stubs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(fileURLToPath(new URL("../public/shop2/admin.css", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

function fn(name: string): string {
  const head = src.indexOf(`function ${name}(`);
  if (head < 0) throw new Error(`public/shop2/app.js no longer has function ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", head); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(head, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}
/** `var NAME = <literal>;` — an object or array literal, brackets balanced. */
function decl(name: string): string {
  const at = src.indexOf(`var ${name} = `);
  if (at < 0) throw new Error(`public/shop2/app.js no longer declares ${name}`);
  const open = at + `var ${name} = `.length;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{" || src[i] === "[") depth++;
    else if ((src[i] === "}" || src[i] === "]") && --depth === 0) return src.slice(at, i + 1) + ";";
  }
  throw new Error(`unterminated literal ${name}`);
}
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* ------------------------------------------------------------------------ */

describe("one settings key, one write — the whole value, the toast after the 2xx", () => {
  function rig(answer: { status: number; body: unknown }) {
    const puts: any[] = [];
    const toasts: Array<[string, unknown]> = [];
    const body = `
      var SRV = { admin: true };
      var DEMO = { chatbot: true, bundles: false, hero: null, content: { company: {} }, log: [] };
      var S = { pricingLoaded: { partnersOn: true } };
      ${decl("ADM_SET_OF")}
      var ADM_SET_NOTE = {}, ADM_SET_AT = {}, admSetSeq = 0;
      function apiSend(url, m, b) { PUTS.push(JSON.parse(JSON.stringify(b))); return Promise.resolve(ANSWER); }
      function toast(t, e) { TOASTS.push([t, e || null]); }
      function reloadPayMethods() {}
      function normaliseDelivery(x) { return x; }
      function normaliseParcel(x) { return x; }
      function bankFilter() { return []; }
      function invoiceConf() { return {}; }
      function demoSave() {}
      /* the slot: sends at once, like admAutosave with nothing in flight */
      var SENT = [];
      function admAutosave(key, v, ev, spec) { SENT.push(spec.send()); return true; }
      function demoApply(a) {
        var e = { txt: "x", a: a, prev: {} };
        if (a.type === "toggle_chatbot") DEMO.chatbot = a.value;
        srvPush(a, e);
        return e;
      }
      function srvPush(a) { if (ADM_SET_OF[a.type]) admSetPut(ADM_SET_OF[a.type]); }
      ${fn("admSetValue")}
      ${fn("admSetRef")}
      ${fn("admSetPut")}
      ${fn("admSetSend")}
      ${fn("admAutosaveOk")}
      ${fn("admSetApply")}
      return { apply: admSetApply, sent: function () { return Promise.all(SENT); } };`;
    const r = new Function("ANSWER", "PUTS", "TOASTS", body)(answer, puts, toasts) as {
      apply: (a: unknown, t: string) => { ref?: string }; sent: () => Promise<unknown>;
    };
    return { ...r, puts, toasts };
  }

  it("sends the key whole, with the change's ref, and says «сохранено» once the server did", async () => {
    const r = rig({ status: 200, body: { ok: true } });
    const entry = r.apply({ type: "toggle_chatbot", value: false }, "Чат выключен ✓");
    expect(r.toasts, "the toast came before the server's answer").toEqual([]);
    await r.sent();
    expect(r.puts).toHaveLength(1);
    expect(r.puts[0].settings).toEqual({ chatbot: false });
    expect(r.puts[0].ref).toBe(entry.ref);
    expect(entry.ref).toMatch(/^j[a-z0-9]+$/);
    expect(r.toasts).toEqual([["Чат выключен ✓", entry]]);
  });

  it("a refusal says nothing of the kind — the header's «Не сохранилось» is the slot's", async () => {
    const r = rig({ status: 503, body: { ok: false } });
    r.apply({ type: "toggle_chatbot", value: false }, "Чат выключен ✓");
    await r.sent();
    expect(r.toasts).toEqual([]);
  });

  it("srvPush hands every settings key to its slot — the assistant's applies and «Вернуть» too", () => {
    const push = fn("srvPush");
    expect(push.indexOf("if (a && ADM_SET_OF[a.type])")).toBeLessThan(push.indexOf("if (!SRV.admin || !a) return;"));
    for (const t of ["set_hero", "set_content", "set_pricing", "set_delivery", "set_parcel", "set_banks",
      "toggle_chatbot", "toggle_bundles", "set_invoice", "set_shipping_rules"]) {
      expect(src, `${t} is not a settings key of the slot`).toMatch(new RegExp(`${t}: "[a-z_]+"`));
    }
  });
});

/* ------------------------------------------------------------------------ */

describe("the index", () => {
  function index(iban: string, desk: boolean, page = "") {
    return new Function(
      "S", "ADM_PHONE_MQ", "esc",
      `var PUSH = { loaded: true, configured: true, devices: [1, 2] };
       ${decl("ADM_SET_PAGES")}
       function pushCan() { return true; }
       function pushLoad() {}
       function admSetForget() {}
       function admSetRead() {}
       function admHead(k, t) { return "<h1>" + t + "</h1>"; }
       function contentConf() { return { company: { iban: ${JSON.stringify(iban)} } }; }
       function admSetPageHTML(p) { return "[page " + p + "]"; }
       ${fn("ibanOk").replace("function ibanOk", "var IBAN_RE = /^[A-Z]{2}[0-9A-Z ]{10,40}$/; function ibanOk")}
       ${fn("admTagHTML").replace("function admTagHTML", "var ADM_TAG_KIND = { alert: 'adm-badge--warnfill' }; function admTagHTML")}
       ${fn("admSetTitle")}
       ${fn("admSetSub")}
       ${fn("admSetMailLinkHTML")}
       ${fn("admSetIndexHTML")}
       ${fn("admSetupHTML")}
       return admSetupHTML();`,
    )({ admSetPage: page }, { matches: !desk }, esc) as string;
  }

  it("six pages, «Письма» between «Оповещения» and «Журнал», «Языки» a line with nothing to tap", () => {
    const html = index("EE382200221020145685", false);
    const pages = [...html.matchAll(/data-admsetpage="([a-z]+)"/g)].map((m) => m[1]);
    expect(pages).toEqual(["delivery", "home", "company", "prices", "push", "journal"]);
    expect(html.indexOf('data-admtab="mail"')).toBeGreaterThan(html.indexOf('data-admsetpage="push"'));
    expect(html).toContain("RU основной · ET · EN — переводятся сами");
    expect(html).not.toContain('data-admsetpage="langs"');
    // the live line under «Оповещения»
    expect(html).toContain("подключено устройств: 2");
  });

  it("«нет IBAN» on «О компании» while there is none", () => {
    expect(index("", false)).toContain("нет IBAN");
    expect(index("EE382200221020145685", false)).not.toContain("нет IBAN");
  });

  it("a phone shows the index alone; a desktop the index and a page beside it", () => {
    expect(index("x", false)).not.toContain("[page");
    expect(index("x", true)).toContain("[page delivery]");
    expect(index("x", true, "company")).toContain("[page company]");
    // …and the page shown is the one lit in the column
    expect(index("x", true, "company")).toMatch(/data-admsetpage="company" aria-current="page"/);
  });

  it("the two panes are CSS: one column on a phone, the index hidden while a page is open", () => {
    expect(css).toMatch(/\.adm-set--open \.adm-set__col \{ display: none; \}/);
    expect(css).toMatch(/\.adm-set \{ display: grid; grid-template-columns: 250px/);
  });
});

/* ------------------------------------------------------------------------ */

describe("«Часы работы»: boxes that format themselves, and the week in one line", () => {
  const fmt = new Function(`${fn("cTimeFmt")} return cTimeFmt;`)() as (s: string) => string | null;
  it.each([
    ["1000", "10:00"], ["930", "09:30"], ["9", "09:00"], ["19", "19:00"], ["10:30", "10:30"],
    ["10.30", "10:30"], ["7,05", "07:05"], ["", ""], ["2400", null], ["1060", null], ["abc", null], ["10:3", null],
  ])("«%s» → %s", (typed, out) => {
    expect(fmt(typed)).toBe(out);
  });

  const sum = new Function("S", `
    ${decl("CONTENT_DAYS")}
    ${decl("CONTENT_DAY_SHORT")}
    ${fn("cHoursNorm")}
    ${fn("admPiecesHTML")}
    ${fn("admSumHTML")}
    function esc(s) { return String(s); }
    ${fn("cHoursSum")}
    return cHoursSum;`)({}) as (h: Record<string, string>) => string;
  const plain = (h: Record<string, string>) => sum(h).replace(/<\/?span>/g, "");

  it("equal neighbours are one span, a closed day says so, an unset day is left out", () => {
    expect(plain({ mon: "10:00–19:00", tue: "10:00–19:00", wed: "10:00–19:00", thu: "10:00–19:00", fri: "10:00–19:00", sat: "10:00–16:00", sun: "closed" }))
      .toBe("Пн–Пт 10:00–19:00 · Сб 10:00–16:00 · Вс выходной");
    expect(plain({ mon: "10:00–19:00", tue: "", wed: "10:00–19:00", thu: "", fri: "", sat: "", sun: "" }))
      .toBe("Пн 10:00–19:00 · Ср 10:00–19:00");
  });

  it("no hours at all — the block is not shown, and the line says so", () => {
    expect(sum({ mon: "", tue: "", wed: "", thu: "", fri: "", sat: "", sun: "" })).toBe("не указаны — раздел не показывается");
  });

  it("each span is a whole node a rule can translate", () => {
    const rx = src.slice(src.indexOf("var UI_RX = ["));
    expect(rx).toContain("[/^(Пн|Вт|Ср|Чт|Пт|Сб|Вс)–(Пн|Вт|Ср|Чт|Пт|Сб|Вс) (.+)$/");
  });
});

/* ------------------------------------------------------------------------ */

describe("«Журнал»: one list, «Вернуть» from any device (q7)", () => {
  const J = new Function("DEMO", "AUDIT", `
    var ADM_SET_OF = {};
    ${decl("JOURNAL_WHOLE")}
    var AUDIT_TWIN_MS = 120000;
    ${fn("jentryAt")}
    ${fn("auditTwin")}
    ${fn("jentryNewestOfKind")}
    ${fn("jentryTwin")}
    ${fn("jentryUndo")}
    ${fn("admUndoPaths")}
    return { twin: auditTwin, undo: jentryUndo, paths: admUndoPaths };`);
  const T = Date.parse("2026-09-25T10:00:00Z");

  it("a server row with this browser's ref is the same change — shown once", () => {
    const j = J({ log: [] }, { rows: [] }) as any;
    const e = { at: T, ref: "jabc", a: { type: "set_hero" }, prev: {} };
    expect(j.twin({ action: "setting.set", at: new Date(T).toISOString(), payload: { key: "hero", ref: "jabc" } }, e)).toBe(true);
    expect(j.twin({ action: "setting.set", at: new Date(T).toISOString(), payload: { key: "hero", ref: "jzzz" } }, e)).toBe(false);
  });

  it("…and a product's or an order's row within two minutes of this browser's line", () => {
    const j = J({ log: [] }, { rows: [] }) as any;
    const e = { at: T, a: { type: "set_price", id: "azur" }, prev: {} };
    expect(j.twin({ action: "override.set", at: new Date(T + 5000).toISOString(), payload: { id: "azur" } }, e)).toBe(true);
    expect(j.twin({ action: "override.set", at: new Date(T + 5 * 60000).toISOString(), payload: { id: "azur" } }, e)).toBe(false);
    const o = { at: T, a: { type: "order_status", id: "u1", number: "R-100042" }, prev: {} };
    expect(j.twin({ action: "order.status", at: new Date(T).toISOString(), payload: { number: "R-100042" } }, o)).toBe(true);
  });

  it("a key saved whole: «Вернуть» here only on its newest line, an older one through its server row", () => {
    const newest = { at: T + 2, ref: "j2", a: { type: "set_hero" }, prev: { type: "set_hero" } };
    const older = { at: T + 1, ref: "j1", a: { type: "set_hero" }, prev: { type: "set_hero" } };
    const content = { at: T, ref: "j0", a: { type: "set_content" }, prev: { type: "set_content" } };
    const noServer = J({ log: [newest, older, content] }, { rows: [] }) as any;
    expect(noServer.undo(0)).toBe("local");
    expect(noServer.undo(1), "an older banner line would take the newer one back with it").toBe("");
    expect(noServer.undo(2), "the shop's details go back field by field — any line").toBe("local");
    const withRow = J({ log: [newest, older, content] }, {
      rows: [{ id: 7, action: "setting.set", at: new Date(T).toISOString(), payload: { key: "hero", ref: "j1" }, undo: { kind: "setting", key: "hero", changes: [] } }],
    }) as any;
    expect(withRow.undo(1)).toBe("server");
  });

  it("a line taken back reads «вернули» and offers nothing", () => {
    const j = J({ log: [{ at: T, a: { type: "set_price" }, prev: {}, undone: true }] }, { rows: [] }) as any;
    expect(j.undo(0)).toBe("");
  });

  it("the server row's fields go back over the key as it is NOW — later edits of other fields stay", () => {
    const j = J({ log: [] }, { rows: [] }) as any;
    const now = { company: { phone: "+372 2", email: "b@x.ee" }, announcement: { on: false } };
    const back = j.paths(now, [
      { path: ["company", "phone"], before: "+372 1" },
      { path: ["announcement", "link"], gone: true },
    ]);
    expect(back).toEqual({ company: { phone: "+372 1", email: "b@x.ee" }, announcement: { on: false } });
    expect(now.company.phone, "the key as read was changed in place").toBe("+372 2");
    // a whole value (a key that did not exist before) goes back whole
    expect(j.paths({ slides: [] }, [{ path: [], before: null }])).toBeNull();
  });

  it("the journal draws both kinds of «Вернуть», the logins folded", () => {
    const page = fn("admSetJournalHTML");
    expect(page).toContain("data-admundo=");
    expect(page).toContain("data-admundosrv=");
    expect(page).toContain('admFoldHTML("set:logins", "Входы в админку"');
    expect(page).toContain("вернули");
  });
});

/* ------------------------------------------------------------------------ */

describe("a confirmed delete is held five seconds with «Вернуть» (q8)", () => {
  function holdRig() {
    vi.useFakeTimers();
    const toasts: Array<[string, any]> = [];
    const r = new Function("toast", `
      var ADM_HOLDS = [];
      ${fn("admHold")}
      return admHold;`)((t: string, u: unknown) => toasts.push([t, u])) as
      (ms: number, fire: (h: unknown) => void, undo: (late: boolean) => void, text: string) => unknown;
    return { hold: r, toasts };
  }

  it("fires after the five seconds, not before", () => {
    const { hold, toasts } = holdRig();
    const log: string[] = [];
    hold(5000, () => log.push("fired"), (late) => log.push(late ? "late" : "early"), "Слайд удалён");
    expect(toasts[0][0]).toBe("Слайд удалён");
    expect(toasts[0][1].prev, "the toast carries no «Вернуть»").toBeTruthy();
    vi.advanceTimersByTime(4999);
    expect(log).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(log).toEqual(["fired"]);
    vi.useRealTimers();
  });

  it("«Вернуть» inside the five seconds: nothing is ever sent", () => {
    const { hold, toasts } = holdRig();
    const log: string[] = [];
    hold(5000, () => log.push("fired"), (late) => log.push(late ? "late" : "early"), "Слайд удалён");
    toasts[0][1].undo();
    vi.advanceTimersByTime(10000);
    expect(log).toEqual(["early"]);
    vi.useRealTimers();
  });

  it("«Вернуть» after them: the journal's own undo", () => {
    const { hold, toasts } = holdRig();
    const log: string[] = [];
    hold(5000, () => log.push("fired"), (late) => log.push(late ? "late" : "early"), "Слайд удалён");
    vi.advanceTimersByTime(5000);
    toasts[0][1].undo();
    expect(log).toEqual(["fired", "late"]);
    vi.useRealTimers();
  });

  it("the toast's «Вернуть» reaches a held change's own way back", () => {
    expect(fn("admUndoToast")).toContain('if (typeof entry.undo === "function") { entry.undo(); return; }');
  });

  it("«Удалить слайд» asks first — rust, «Не надо» — and «Убрать» on a device waits the same five seconds", () => {
    expect(src).toContain('type: "hero_delete", index: Number(d.herodel), overlay: true, danger: true');
    expect(src).toContain('if (pa.type === "hero_delete") { admHeroDelete(pa.index); return; }');
    expect(fn("pushDropHeld")).toContain("admHold(ADM_HOLD_MS,");
  });
});

/* ------------------------------------------------------------------------ */

describe("«Счета для компаний» saves itself, with a way back", () => {
  it("a set_invoice line names the term, and the intervals only when they moved", () => {
    const text = new Function(`${fn("pl")} ${fn("invoiceActionText")} return invoiceActionText;`)() as
      (v: unknown, was: unknown) => string;
    expect(text({ prefix: "A-", dueDays: 10, remindBeforeDays: 2, cancelAfterDays: 7 }, { remindBeforeDays: 2, cancelAfterDays: 7 }))
      .toBe("Счета для компаний: префикс «A-», срок оплаты 10 дней");
    expect(text({ prefix: "B-", dueDays: 1, remindBeforeDays: 0, cancelAfterDays: 7 }, { remindBeforeDays: 2, cancelAfterDays: 7 }))
      .toBe("Счета для компаний: префикс «B-», срок оплаты 1 день\nСчета для компаний: напоминание выключено");
  });

  it("demoApply keeps the old settings as the line's `prev`, demoUndo puts them back", () => {
    expect(fn("demoApply")).toContain('entry.prev = { type: "set_invoice", value: invoiceConf() };');
    expect(fn("demoUndo")).toContain('else if (a.type === "set_invoice")');
  });
});
