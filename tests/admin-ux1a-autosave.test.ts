/**
 * Direction 1a, README § 2 — a field that saves itself (app.js admAutosave)
 * and the one save status of the panel (ADM_SAVE, admSaveStatusHTML).
 *
 * The promises under test, each one a way the old panel lost or misreported
 * a change (admin-functions map § 3.1):
 *   · WHEN a field goes is ADM_SAVE_POLICY's to say, per kind — `leave` on
 *     blur/Enter, `idle` after ADM_SAVE_IDLE_MS and on blur, `instant` at once
 *     (Dim, 25.09.2026, q1: numbers/codes/names on leave, long text 1 s,
 *     switches and picks instant);
 *   · a value the screen's validator refuses is not sent, and goes the moment
 *     it is right;
 *   · one write per field at a time, and the server ends on the last value;
 *   · «Сохранено ✓» only after a 2xx — never on a refusal, a dead connection
 *     or a 200 whose body says `ok: false`;
 *   · a failed write leaves «Не сохранилось — проверьте интернет · Повторить»,
 *     and «Повторить» sends it again;
 *   · Back, the nav, a card closing and the page going away send whatever is
 *     owed (admAutosaveFlush), the last with `keepalive`.
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
/** A one-line `var NAME = …;` declaration, as it stands in app.js. */
function decl(name: string): string {
  const m = new RegExp(`^  var ${name} = .*;$`, "m").exec(app);
  if (!m) throw new Error(`public/shop2/app.js no longer declares ${name} on one line`);
  return m[0].trim();
}

const FNS = [
  "admAutosavePolicy", "admAutosaveSpec", "admAutosave", "admAutosaveSend", "admAutosaveOk", "admAutosaveDone",
  "admSaveFailedN", "admSaveRetry", "admAutosaveFlush", "admSaveBegin", "admSaveEnd", "admSaveSet",
  "admSaveStatusHTML", "admSaveSlotHTML", "admAutosaveHintHTML", "admAutosaveInvalidAttr",
];

type Res = { status: number; body?: Record<string, unknown> } | boolean | null;
type Panel = {
  autosave: (key: string, value: unknown, ev: string, spec?: unknown) => boolean;
  spec: (key: string, spec: unknown) => string;
  flush: (keepalive?: boolean) => number;
  retry: () => number;
  statusHTML: () => string;
  slotHTML: (cls: string) => string;
  hintHTML: (key: string) => string;
  invalidAttr: (key: string) => string;
  /** what a render does after drawing: the status looked at again, no write ended */
  settle: () => void;
  SAVE: { state: string; busy: number };
  S: Record<string, unknown>;
  SRV: Record<string, unknown>;
  paints: string[];
  marks: Array<[string, string]>;
  toasts: string[];
  counter: { renders: number };
};

/** `onPage`: the autosave keys whose box (or hint line) the page still shows — a
    stand-in `document` that answers querySelector for them. Left out, there is
    no `document` at all, as in every other test here. */
function panel(onPage?: Set<string>): Panel {
  const doc = onPage && {
    querySelector: (sel: string) => ([...onPage].some((k) => sel.includes(`"${k}"`)) ? {} : null),
    querySelectorAll: () => [],
  };
  const S: Record<string, unknown> = { lang: "RU", screen: "admin" };
  const SRV: Record<string, unknown> = { admin: true };
  const paints: string[] = [];
  const marks: Array<[string, string]> = [];
  const toasts: string[] = [];
  const counter = { renders: 0 };
  const body = `
    ${decl("ADM_SAVE_POLICY")}
    ${decl("ADM_SAVE_IDLE_MS")}
    ${decl("ADM_SAVE_SHOWN_MS")}
    var ADM_AS = {}, ADM_AS_SPEC = {};
    var ADM_SAVE = { state: "idle", busy: 0, fade: 0 };
    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
    function admSavePaint() { onPaint(ADM_SAVE.state); }
    function admAutosaveMark(key, hint) { onMark(key, hint); }
    function toast(m) { onToast(m); }
    function render() { onRender(); }
    ${FNS.map(fn).join("\n")}
    return {
      autosave: admAutosave, spec: admAutosaveSpec, flush: admAutosaveFlush, retry: admSaveRetry,
      statusHTML: admSaveStatusHTML, slotHTML: admSaveSlotHTML, hintHTML: admAutosaveHintHTML,
      invalidAttr: admAutosaveInvalidAttr, SAVE: ADM_SAVE, settle: function () { admSaveEnd(true); },
    };
  `;
  const api = new Function("S", "SRV", "onPaint", "onMark", "onToast", "onRender", "document", body)(
    S, SRV,
    (s: string) => paints.push(s),
    (k: string, h: string) => marks.push([k, h]),
    (t: string) => toasts.push(t),
    () => { counter.renders++; },
    doc,
  );
  return Object.assign(api, { S, SRV, paints, marks, toasts, counter }) as Panel;
}

/** A send() that records what went and answers when the test says so. */
function wire() {
  const sent: Array<{ value: unknown; opts: Record<string, unknown> }> = [];
  const pending: Array<(r: Res) => void> = [];
  const send = (value: unknown, opts: Record<string, unknown>) => {
    sent.push({ value, opts });
    return new Promise<Res>((resolve) => pending.push(resolve));
  };
  const answer = async (r: Res) => {
    const next = pending.shift();
    if (!next) throw new Error("nothing is waiting for an answer");
    next(r);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  };
  return { sent, send, answer, pending };
}

const OK = { status: 200, body: { ok: true } };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("ADM_SAVE_POLICY — Dim's answer (25.09.2026, q1), in one place", () => {
  it("numbers, codes, names and counts on leave; long text on a pause; switches and picks at once", () => {
    const policy = new Function(`${decl("ADM_SAVE_POLICY")}; return ADM_SAVE_POLICY;`)();
    expect(policy).toEqual({ money: "leave", code: "leave", name: "leave", count: "leave", text: "idle", toggle: "instant", pick: "instant" });
    expect(new Function(`${decl("ADM_SAVE_IDLE_MS")}; return ADM_SAVE_IDLE_MS;`)()).toBe(1000);
  });
});

describe("admAutosave — when a field goes", () => {
  it("`leave`: typing sends nothing; blur sends the last value once", async () => {
    const p = panel(), w = wire();
    p.autosave("goods:x:price", "1", "input", { kind: "money", send: w.send });
    p.autosave("goods:x:price", "12", "input");
    p.autosave("goods:x:price", "12,5", "input");
    vi.advanceTimersByTime(5000);
    expect(w.sent, "a price went out while it was being typed").toEqual([]);
    p.autosave("goods:x:price", "12,5", "blur");
    expect(w.sent.map((s) => s.value)).toEqual(["12,5"]);
    // a second blur with nothing new sends nothing
    p.autosave("goods:x:price", "12,5", "blur");
    expect(w.sent).toHaveLength(1);
  });

  it("`leave`: Enter sends too", () => {
    const p = panel(), w = wire();
    p.autosave("promo:SUMMER:code", "SUMMER2", "input", { kind: "code", send: w.send });
    p.autosave("promo:SUMMER:code", "SUMMER2", "enter");
    expect(w.sent.map((s) => s.value)).toEqual(["SUMMER2"]);
  });

  it("`idle`: ADM_SAVE_IDLE_MS after the last keystroke — and every keystroke restarts the wait", () => {
    const p = panel(), w = wire();
    p.autosave("order:R-1:note", "П", "input", { kind: "text", send: w.send });
    vi.advanceTimersByTime(900);
    p.autosave("order:R-1:note", "Пр", "input");
    vi.advanceTimersByTime(900);
    expect(w.sent, "it went before the pause").toEqual([]);
    vi.advanceTimersByTime(100);
    expect(w.sent.map((s) => s.value)).toEqual(["Пр"]);
  });

  it("`idle`: blur does not wait for the pause", () => {
    const p = panel(), w = wire();
    p.autosave("order:R-1:note", "Позвонить", "input", { kind: "text", send: w.send });
    p.autosave("order:R-1:note", "Позвонить", "blur");
    expect(w.sent.map((s) => s.value)).toEqual(["Позвонить"]);
    vi.advanceTimersByTime(2000);
    expect(w.sent, "the idle timer sent it a second time").toHaveLength(1);
  });

  it("`instant`: a switch goes the moment it changes", () => {
    const p = panel(), w = wire();
    p.autosave("promo:SUMMER:on", false, "change", { kind: "toggle", send: w.send });
    expect(w.sent.map((s) => s.value)).toEqual([false]);
  });

  it("a kind the table does not know waits for the owner to leave the box", () => {
    const p = panel(), w = wire();
    p.autosave("x", "a", "input", { kind: "nonsense", send: w.send });
    vi.advanceTimersByTime(5000);
    expect(w.sent).toEqual([]);
    p.autosave("x", "a", "blur");
    expect(w.sent).toHaveLength(1);
  });
});

describe("admAutosave — a value that does not pass is not sent", () => {
  const price = (v: unknown) => (/^\d+([.,]\d{1,2})?$/.test(String(v).trim()) ? "" : "Цена — число, например 12,90");

  it("the hint goes on the box, nothing goes to the server, and the right value goes at once", () => {
    const p = panel(), w = wire();
    p.autosave("g:price", "12a", "input", { kind: "money", send: w.send, validate: price });
    p.autosave("g:price", "12a", "blur");
    expect(w.sent).toEqual([]);
    expect(p.marks.at(-1)).toEqual(["g:price", "Цена — число, например 12,90"]);
    expect(p.invalidAttr("g:price")).toBe(' aria-invalid="true"');
    expect(p.hintHTML("g:price")).toContain("Цена — число, например 12,90");
    expect(p.hintHTML("g:price")).not.toContain(" hidden");

    p.autosave("g:price", "12", "input");
    p.autosave("g:price", "12", "blur");
    expect(w.sent.map((s) => s.value)).toEqual(["12"]);
    expect(p.marks.at(-1)).toEqual(["g:price", ""]);
    expect(p.invalidAttr("g:price")).toBe("");
    expect(p.hintHTML("g:price")).toContain(" hidden");
  });

  it("a flush does not send it either", () => {
    const p = panel(), w = wire();
    p.autosave("g:price", "", "input", { kind: "money", send: w.send, validate: price });
    expect(p.flush()).toBe(0);
    expect(w.sent).toEqual([]);
  });
});

describe("admAutosave — one write per field, the last value wins", () => {
  it("a value typed while the first is in flight follows it, and only the newest", async () => {
    const p = panel(), w = wire();
    p.autosave("n", "a", "input", { kind: "text", send: w.send });
    p.autosave("n", "a", "blur");
    p.autosave("n", "ab", "input");
    p.autosave("n", "ab", "blur");
    p.autosave("n", "abc", "input");
    p.autosave("n", "abc", "blur");
    expect(w.sent.map((s) => s.value), "two writes of one field were in flight at once").toEqual(["a"]);
    await w.answer(OK);
    expect(w.sent.map((s) => s.value)).toEqual(["a", "abc"]);
    await w.answer(OK);
    expect(p.SAVE.state).toBe("saved");
  });

  it("typed back to what the server already holds: nothing to send", async () => {
    const p = panel(), w = wire();
    p.autosave("n", "a", "input", { kind: "money", send: w.send });
    p.autosave("n", "a", "blur");
    await w.answer(OK);
    p.autosave("n", "b", "input");
    p.autosave("n", "a", "input");
    p.autosave("n", "a", "blur");
    expect(w.sent).toHaveLength(1);
  });
});

describe("ADM_SAVE — «Сохранено ✓» only after the server said so", () => {
  it("saving → saved on a 2xx, then idle after ADM_SAVE_SHOWN_MS", async () => {
    const p = panel(), w = wire();
    p.autosave("t", true, "change", { kind: "toggle", send: w.send });
    expect(p.SAVE.state).toBe("saving");
    expect(p.statusHTML()).toContain("Сохраняем…");
    expect(p.statusHTML()).not.toContain("Сохранено");
    await w.answer(OK);
    expect(p.SAVE.state).toBe("saved");
    expect(p.statusHTML()).toContain("Сохранено ✓");
    vi.advanceTimersByTime(2400);
    expect(p.SAVE.state).toBe("idle");
    expect(p.statusHTML()).toBe("");
    // painted in place at every step — never by a full render
    expect(p.paints).toEqual(["saving", "saved", "idle"]);
    expect(p.counter.renders).toBe(0);
  });

  it("a send that answers `true` counts; `false` does not", async () => {
    const p = panel(), w = wire();
    p.autosave("a", 1, "change", { kind: "pick", send: w.send });
    await w.answer(true);
    expect(p.SAVE.state).toBe("saved");
    p.autosave("b", 1, "change", { kind: "pick", send: w.send });
    await w.answer(false);
    expect(p.SAVE.state).toBe("error");
  });

  for (const [what, r] of [
    ["a 500", { status: 500, body: { ok: false } }],
    ["a 200 whose body refuses", { status: 200, body: { ok: false, error: "bad" } }],
    ["a dead connection", null],
  ] as const) {
    it(`${what} is «Не сохранилось — проверьте интернет · Повторить», never «Сохранено ✓»`, async () => {
      const p = panel(), w = wire();
      p.autosave("t", "x", "change", { kind: "pick", send: w.send });
      await w.answer(r as Res);
      expect(p.SAVE.state).toBe("error");
      const html = p.statusHTML();
      expect(html).toContain("Не сохранилось — проверьте интернет");
      expect(html).toContain("data-admsaveretry");
      expect(html).toContain(">Повторить<");
      expect(html).not.toContain("Сохранено");
      // it stays — an error does not fade
      vi.advanceTimersByTime(60_000);
      expect(p.SAVE.state).toBe("error");
    });
  }

  it("a rejected promise is a failure too", async () => {
    const p = panel();
    p.autosave("t", "x", "change", { kind: "pick", send: () => Promise.reject(new Error("offline")) });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(p.SAVE.state).toBe("error");
  });

  it("«Повторить» sends the failed value again, and a 2xx clears the error", async () => {
    const p = panel(), w = wire();
    p.autosave("t", "x", "change", { kind: "pick", send: w.send });
    await w.answer({ status: 503 });
    expect(p.SAVE.state).toBe("error");
    expect(p.retry()).toBe(1);
    expect(w.sent.map((s) => s.value)).toEqual(["x", "x"]);
    expect(p.SAVE.state).toBe("saving");
    await w.answer(OK);
    expect(p.SAVE.state).toBe("saved");
  });

  it("one field failing keeps the error up while another one saves", async () => {
    const p = panel(), w = wire();
    p.autosave("a", 1, "change", { kind: "pick", send: w.send });
    await w.answer({ status: 500 });
    p.autosave("b", 2, "change", { kind: "pick", send: w.send });
    await w.answer(OK);
    expect(p.SAVE.state, "a save elsewhere hid an unsaved field").toBe("error");
  });

  it("a 401 is the session, not the internet: the login card and the panel's own sentence", async () => {
    const p = panel(), w = wire();
    p.autosave("t", "x", "change", { kind: "pick", send: w.send });
    await w.answer({ status: 401 });
    expect(p.SRV.admin).toBe(false);
    expect(p.toasts).toEqual(["Нужен вход в админку — изменение не сохранилось"]);
    expect(p.counter.renders).toBe(1);
  });

  it("the slot carries the state for the CSS and a render draws the same words", () => {
    const p = panel();
    const html = p.slotHTML("adm-savest--top");
    expect(html).toMatch(/^<span class="adm-savest adm-savest--top" data-admsavest data-st="idle">/);
    // the slot itself is no live region — it would read out every «Сохраняем…»
    expect(html).not.toMatch(/role="status"|role="alert"|aria-live/);
  });

  it("only the error is announced: role=\"alert\" on its line — «Сохраняем…» and «Сохранено ✓» stay silent", () => {
    const p = panel();
    for (const state of ["idle", "saving", "saved"]) {
      p.SAVE.state = state;
      expect(p.statusHTML(), state).not.toMatch(/role=|aria-live/);
    }
    p.SAVE.state = "error";
    const html = p.statusHTML();
    expect(html).toContain('<span class="adm-savest__t adm-savest__t--err" role="alert">Не сохранилось — проверьте интернет</span>');
    expect(html.match(/role="alert"/g), "one announcement, not two").toHaveLength(1);
    // «Повторить» stands beside the alert, not inside it: the sentence is what is read out
    expect(html).toMatch(/<\/span><button class="adm-savest__retry" type="button" data-admsaveretry>Повторить<\/button>$/);
    expect(p.slotHTML("adm-savest--page")).toContain('role="alert"');
  });
});

/* Integration of the 1a screens, 25.09.2026 (reported by the «Товары» agent):
   the header said «Сохранено ✓» — a save of another box, or one a moment
   earlier — while a price that does not pass stood rust on the card and the
   leave question said «Правки не сохранены». The status now tells the truth
   about the whole page: a box that does not pass (or that the server refused
   and said why, under it) is «Не сохранено — проверьте поле» in rust, and a
   value typed and not sent yet is not «Сохранено ✓» either. */
describe("ADM_SAVE — never «Сохранено ✓» while a box does not pass or is still owed", () => {
  const price = (v: unknown) => (/^\d+([.,]\d{1,2})?$/.test(String(v).trim()) ? "" : "Цена — число, например 12,90");
  const INVALID = "Не сохранено — проверьте поле";

  it("a box that does not pass puts the rust line up at once — and it is not an announcement", () => {
    const p = panel(), w = wire();
    p.autosave("g:price", "12a", "input", { kind: "money", send: w.send, validate: price });
    p.autosave("g:price", "12a", "blur");
    expect(p.SAVE.state).toBe("invalid");
    const html = p.statusHTML();
    expect(html).toBe(`<span class="adm-savest__t adm-savest__t--err">${INVALID}</span>`);
    expect(html).not.toContain("Сохранено ✓");
    expect(html, "the box itself carries the hint; the header does not talk over it").not.toMatch(/role=|aria-live/);
    expect(p.paints).toEqual(["invalid"]);
  });

  it("a save of ANOTHER box does not claim «Сохранено ✓» over it", async () => {
    const p = panel(), w = wire();
    p.autosave("g:price", "12a", "input", { kind: "money", send: w.send, validate: price });
    p.autosave("g:price", "12a", "blur");
    p.autosave("g:name", "Rose", "input", { kind: "name", send: w.send });
    p.autosave("g:name", "Rose", "blur");
    expect(p.SAVE.state, "a write in flight still says «Сохраняем…»").toBe("saving");
    await w.answer(OK);
    expect(w.sent.map((s) => s.value)).toEqual(["Rose"]);
    expect(p.SAVE.state).toBe("invalid");
    expect(p.statusHTML()).toContain(INVALID);
    expect(p.statusHTML()).not.toContain("Сохранено ✓");
  });

  it("«Сохранено ✓» of a moment ago goes the moment a box goes wrong", async () => {
    const p = panel(), w = wire();
    p.autosave("g:name", "Rose", "input", { kind: "name", send: w.send });
    p.autosave("g:name", "Rose", "blur");
    await w.answer(OK);
    expect(p.SAVE.state).toBe("saved");
    p.autosave("g:price", "abc", "input", { kind: "money", send: w.send, validate: price });
    p.autosave("g:price", "abc", "enter");
    expect(p.SAVE.state, "«Сохранено ✓» stood over a rust box until it faded").toBe("invalid");
  });

  it("a refusal the server explained under the box is the same rust line", async () => {
    const p = panel(), w = wire();
    p.autosave("stockean:x", "4740000000001", "input", { kind: "code", send: w.send });
    p.autosave("stockean:x", "4740000000001", "enter");
    await w.answer({ refused: "Этот штрихкод уже привязан к другому товару" } as unknown as Res);
    expect(p.SAVE.state).toBe("invalid");
    expect(p.statusHTML()).not.toContain("Сохранено");
    expect(p.statusHTML()).not.toContain("проверьте интернет");
  });

  it("put right, it saves and the header says so; typed back to what the shop holds, it goes quiet", async () => {
    const p = panel(), w = wire();
    p.autosave("g:price", "12", "input", { kind: "money", send: w.send, validate: price });
    p.autosave("g:price", "12", "blur");
    await w.answer(OK);
    vi.advanceTimersByTime(2400);
    p.autosave("g:price", "1x", "input");
    p.autosave("g:price", "1x", "blur");
    expect(p.SAVE.state).toBe("invalid");
    // back to 12 — what the server already has: nothing goes, and nothing is wrong any more
    p.autosave("g:price", "12", "input");
    p.autosave("g:price", "12", "blur");
    expect(w.sent).toHaveLength(1);
    expect(p.SAVE.state).toBe("idle");
    // a new right value: «Сохраняем…», then «Сохранено ✓»
    p.autosave("g:price", "13", "input");
    p.autosave("g:price", "13", "blur");
    expect(p.SAVE.state).toBe("saving");
    await w.answer(OK);
    expect(p.SAVE.state).toBe("saved");
  });

  it("typing again after «Сохранено ✓» takes the claim down until the new value lands", async () => {
    const p = panel(), w = wire();
    p.autosave("g:price", "12", "input", { kind: "money", send: w.send });
    p.autosave("g:price", "12", "blur");
    await w.answer(OK);
    expect(p.SAVE.state).toBe("saved");
    p.autosave("g:price", "14", "input");
    expect(p.SAVE.state, "«Сохранено ✓» stood over a price not sent yet").toBe("idle");
    p.autosave("g:price", "14", "blur");
    await w.answer(OK);
    expect(p.SAVE.state).toBe("saved");
  });

  it("…and a field still waiting (another box typed, not left) keeps a save elsewhere from claiming it all", async () => {
    const p = panel(), w = wire();
    p.autosave("o:note", "позвонить", "input", { kind: "text", send: w.send });
    p.autosave("o:note", "позвонить", "blur");
    p.autosave("g:price", "14", "input", { kind: "money", send: w.send });
    await w.answer(OK);
    expect(p.SAVE.state).toBe("idle");
    p.autosave("g:price", "14", "blur");
    await w.answer(OK);
    expect(p.SAVE.state).toBe("saved");
  });

  it("a network failure outranks it: «Не сохранилось — проверьте интернет · Повторить»", async () => {
    const p = panel(), w = wire();
    p.autosave("g:price", "x", "input", { kind: "money", send: w.send, validate: price });
    p.autosave("g:price", "x", "blur");
    p.autosave("t", true, "change", { kind: "toggle", send: w.send });
    await w.answer(null);
    expect(p.SAVE.state).toBe("error");
  });

  it("a rust box the page no longer shows (its card closed) does not hold the line up", async () => {
    const page = new Set(["g:price", "g:name"]);
    const p = panel(page), w = wire();
    p.autosave("g:price", "x", "input", { kind: "money", send: w.send, validate: price });
    p.autosave("g:price", "x", "blur");
    expect(p.SAVE.state).toBe("invalid");
    // the card is closed: the box and its hint line are gone; the next settle (a render) goes quiet
    page.delete("g:price");
    p.settle();
    expect(p.SAVE.state).toBe("idle");
    // …and comes back with the card, the hint still under the box
    page.add("g:price");
    p.settle();
    expect(p.SAVE.state).toBe("invalid");
  });

  it("a render settles the status (renderImpl) — after the page is drawn", () => {
    const r = fn("renderImpl");
    expect(r).toContain('if (S.screen === "admin") admSaveEnd(true);');
    expect(r.indexOf('if (S.screen === "admin") admSaveEnd(true);')).toBeGreaterThan(r.indexOf("bodySlot"));
  });
});

describe("admAutosaveFlush — whatever is owed goes before the screen does", () => {
  it("a price typed and not yet left goes on Back, a note mid-pause goes too", () => {
    const p = panel(), w = wire();
    p.autosave("g:price", "14", "input", { kind: "money", send: w.send });
    p.autosave("o:note", "позвонить", "input", { kind: "text", send: w.send });
    expect(w.sent).toEqual([]);
    expect(p.flush()).toBe(2);
    expect(w.sent.map((s) => s.value).sort()).toEqual(["14", "позвонить"]);
    // the idle timer that was running does not send the note a second time
    vi.advanceTimersByTime(5000);
    expect(w.sent).toHaveLength(2);
  });

  it("the page going away sends with keepalive, so a locked phone still delivers it", () => {
    const p = panel(), w = wire();
    p.autosave("o:note", "позвонить", "input", { kind: "text", send: w.send });
    p.flush(true);
    expect(w.sent[0].opts).toEqual({ keepalive: true });
  });

  it("a failed write is still owed, so the next flush tries it again", async () => {
    const p = panel(), w = wire();
    p.autosave("t", "x", "change", { kind: "pick", send: w.send });
    await w.answer(null);
    expect(p.flush(true)).toBe(1);
    expect(w.sent.map((s) => s.value)).toEqual(["x", "x"]);
  });

  it("nothing owed, nothing sent", () => {
    const p = panel();
    expect(p.flush()).toBe(0);
  });
});

describe("where the flushes are wired", () => {
  it("Back (admCloseTop) and the nav (admGoTab) flush first", () => {
    expect(fn("admCloseTop")).toMatch(/^function admCloseTop\(\) \{\n(\s*\/\/.*\n)*\s*admAutosaveFlush\(\);/);
    expect(fn("admGoTab")).toMatch(/^function admGoTab\(go\) \{\n\s*admAutosaveFlush\(\);/);
  });
  it("a render that changes the view — a card opening or closing, a section, leaving the panel — flushes", () => {
    const r = fn("renderImpl");
    expect(r).toContain("var asView = admAsViewKey();");
    expect(r).toContain("if (asView !== admAsView) { admAsView = asView; admAutosaveFlush(); }");
    const key = fn("admAsViewKey");
    for (const part of ["S.adminTab", "S.adminOrder", "S.adminEdit", "S.admCustOpen", "S.mailOpen", "S.admSetPage", "S.adminBlogEdit", "S.newsEdit"]) {
      expect(key, `${part} is not part of the view`).toContain(part);
    }
  });
  it("pagehide and a hidden tab flush with keepalive", () => {
    expect(app).toContain('window.addEventListener("pagehide", function () { admAutosaveFlush(true); });');
    expect(app).toMatch(/visibilitychange", function \(\) \{\n\s*if \(document\.visibilityState === "hidden"\) admAutosaveFlush\(true\);/);
  });
});
