/**
 * «Маркетинг» in direction 1a (design_handoff_admin_ux README § 5) — the
 * behaviour the redesign changed or fixed, beyond the look:
 *
 *   · an open promo code saves itself, and the body it sends takes `active`
 *     from the LIST, where the switch lives — the server reads a body without
 *     `active` as «on», and the form's own copy is stale once the switch
 *     beside the row has moved (gap finding 1);
 *   · the browser refuses exactly what the server would (validatePromo), so a
 *     code that saves itself never sends a value the route turns away;
 *   · the assistant's create_promo says `create: true` (Dim, q17): «уже есть»
 *     instead of silently rewriting a live code, and its journal line goes;
 *   · a letter's text saves itself, never with an unfinished or unknown
 *     «{…}» (Dim, q6) — and every letter's own default passes the same check;
 *   · a newsletter's first save carries an Idempotency-Key and the same body
 *     until it lands, so an autosave retry cannot make a twin draft (the
 *     route's half: tests/newsletters-idempotency.test.ts);
 *   · a confirmed delete / send is held (q8: 5 s, q3: 10 s): «Вернуть» means
 *     the call is never made, and a page going away sends it at once.
 *
 * The panel's halves are cut out of public/shop2/app.js by source text and
 * run over stubs (the tests/promos-r21.test.ts technique); validatePromo is
 * the server's own.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { validatePromo } from "@/lib/promos";
import { MAIL_TEXT_DEFAULTS, MAIL_TEXT_TEMPLATES } from "@/emails/texts";
import { demoValues } from "@/emails/index";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

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
/** app.js functions by name (and `var` declarations), run with `scope` as their free variables. */
function build<T>(names: string[], scope: Record<string, unknown>, expr: string, decls: string[] = []): T {
  const keys = Object.keys(scope);
  const body = decls.map(decl).join("\n") + "\n" + names.map(slice).join("\n") + `\nreturn ${expr};`;
  return new Function(...keys, body)(...keys.map((k) => scope[k])) as T;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

/* ======================================================================== */

describe("an open promo code: `active` comes from the list, where the switch is", () => {
  const payload = (S: Record<string, unknown>) =>
    build<() => Record<string, unknown>>(["promoFormPayload", "promoActiveNow", "admPromoByCode", "promoEndIso"], { S }, "promoFormPayload")();
  const form = (S: Record<string, unknown>, p: Record<string, unknown>) =>
    build<(p: unknown) => Record<string, unknown>>(["promoFormFrom"], { S }, "promoFormFrom")(p);
  const AUTUMN = { code: "AUTUMN", kind: "percent", value: 10, minSubtotal: 0, endsAt: null, maxUses: null, note: "", scope: "order", scopeValue: null };

  it("a switch flipped off while the code is open is not switched back on by the next save", () => {
    const S: Record<string, unknown> = { admPromos: [{ ...AUTUMN, active: true }] };
    S.promoForm = form(S, { ...AUTUMN, active: true });   // opened while on
    (S.admPromos as Array<Record<string, unknown>>)[0].active = false;   // …then the row's switch
    expect(payload(S).active, "the stale form put the code back on").toBe(false);
    // …and on again the same way
    (S.admPromos as Array<Record<string, unknown>>)[0].active = true;
    expect(payload(S).active).toBe(true);
  });

  it("a new code, or one the list no longer has, keeps the form's own word", () => {
    const S: Record<string, unknown> = { admPromos: [], promoForm: { ...AUTUMN, editing: false, active: true } };
    expect(payload(S).active).toBe(true);
    S.promoForm = { ...AUTUMN, editing: true, active: false };
    expect(payload(S).active).toBe(false);
  });
});

describe("the form refuses exactly what the server refuses", () => {
  // built inside each test, so a missing piece fails that test and not the whole file
  const problem = (f: unknown) => build<(f: unknown) => { f: string; hint: string } | null>(
    ["promoProblem", "promoNum"], {}, "promoProblem", ["PROMO_SAVE_ERRS"],
  )(f);
  const payload = (f: unknown) => build<(f: unknown) => Record<string, unknown>>(
    ["promoFormPayload", "promoActiveNow", "admPromoByCode", "promoEndIso"], { S: { admPromos: [] } }, "promoFormPayload",
  )(f);
  const base = { editing: true, code: "EDGE10", kind: "percent", value: "10", minSubtotal: "", endsAt: "", maxUses: "", note: "", active: true, scope: "order", scopeValue: "", startsAt: null };
  const cases: Array<Record<string, unknown>> = [
    {}, { value: "0" }, { value: "1" }, { value: "90" }, { value: "91" }, { value: "" }, { value: "сто" }, { value: "10,5" },
    { kind: "fixed", value: "200" }, { kind: "fixed", value: "200.01" }, { kind: "fixed", value: "0" }, { kind: "fixed", value: "12,50" },
    { kind: "free_shipping", value: "" }, { minSubtotal: "-1" }, { minSubtotal: "10000" }, { minSubtotal: "10001" }, { minSubtotal: "сорок" },
    { maxUses: "0" }, { maxUses: "1" }, { maxUses: "сто" }, { maxUses: "2.5" }, { endsAt: "2026-13-45" }, { endsAt: "2026-12-31" },
    { scope: "brand", scopeValue: "" }, { scope: "brand", scopeValue: "Davines" }, { scope: "product", scopeValue: "" },
    { kind: "free_shipping", scope: "brand", scopeValue: "Davines" },
    { scope: "cart", scopeValue: "3f2a9c1e-7b4d-4e8a-9f0c-2d6b1a5e8c47", scopeLines: [] },
    { scope: "cart", scopeValue: "3f2a9c1e-7b4d-4e8a-9f0c-2d6b1a5e8c47", scopeLines: ["kmrepair"] },
  ];
  for (const c of cases) {
    it(`${JSON.stringify(c)}`, () => {
      const f = { ...base, ...c };
      const pr = problem(f);
      const server = validatePromo(payload(f));
      expect(pr === null, `browser says ${JSON.stringify(pr)}, server says ${JSON.stringify(server)}`).toBe(server.ok);
    });
  }
});

describe("the assistant's create_promo never rewrites a code that is there (q17)", () => {
  function push(answer: { status: number; body: Record<string, unknown> }) {
    const sent: Array<Record<string, unknown>> = [];
    const toasts: string[] = [];
    const dropped: unknown[] = [];
    const srvPush = build<(a: unknown, entry: unknown) => void>(["srvPush"], {
      shipRollback: null,
      SRV: { admin: true },
      apiSend: (_u: string, _m: string, body: Record<string, unknown>) => { sent.push(body); return Promise.resolve(answer); },
      journalDrop: (e: unknown) => { dropped.push(e); },
      toast: (m: string) => { toasts.push(m); },
      loadAdminPromos: () => {},
      noop: () => {},
    }, "srvPush", ["PROMO_SAVE_ERRS"]);
    return { srvPush, sent, toasts, dropped };
  }
  const a = { type: "create_promo", promo: { code: "SUVI10", kind: "percent", value: 10 } };

  it("posts `create: true`", async () => {
    const r = push({ status: 200, body: { ok: true, promo: {} } });
    r.srvPush(a, { txt: "x" });
    await tick();
    expect(r.sent[0]).toMatchObject({ code: "SUVI10", create: true });
    expect(r.dropped).toEqual([]);
  });

  it("on `exists`: «Такой промокод уже есть.», and the journal line that would switch the live code off goes", async () => {
    const entry = { txt: "Промокод SUVI10: скидка 10%" };
    const r = push({ status: 409, body: { ok: false, error: "exists" } });
    r.srvPush(a, entry);
    await tick();
    expect(r.toasts).toEqual(["Такой промокод уже есть."]);
    expect(r.dropped).toEqual([entry]);
  });
});

describe("a letter's text: never an unfinished or unknown «{…}» (q6)", () => {
  const SAMPLES = Object.fromEntries(MAIL_TEXT_TEMPLATES.map((t) => [t, demoValues(t as never, "ru", {})]));
  const env = {
    MAIL_TEXTS: { samples: SAMPLES },
  };
  const problem = (tpl: string, text: string) => build<(tpl: string, text: string) => string>(
    ["mailTextProblem", "mailTokensOf"], env, "mailTextProblem", ["MAIL_PH"],
  )(tpl, text);
  const UNFINISHED = "Вставка не дописана — закройте её скобкой «}» или уберите «{»";
  const UNKNOWN = "Такой вставки в этом письме нет — возьмите её из кнопок ниже";
  // the two sentences are the constants the panel shows
  it("uses the panel's own two sentences", () => {
    expect(src).toContain(`var MAIL_PH_UNFINISHED = ${JSON.stringify(UNFINISHED)}`);
    expect(src).toContain(`var MAIL_PH_UNKNOWN = ${JSON.stringify(UNKNOWN)}`);
  });
  const withConsts = (tpl: string, t: string) =>
    build<(tpl: string, text: string) => string>(["mailTextProblem", "mailTokensOf"], {
      ...env, MAIL_PH_UNFINISHED: UNFINISHED, MAIL_PH_UNKNOWN: UNKNOWN,
    }, "mailTextProblem", ["MAIL_PH"])(tpl, t);

  it("takes a finished token this letter fills, and plain text", () => {
    expect(withConsts("order-shipped", "Заказ {order} в пути, трек {track}")).toBe("");
    expect(withConsts("order-shipped", "Спасибо!")).toBe("");
  });
  it("refuses a brace still being typed", () => {
    expect(withConsts("order-shipped", "Заказ {ord")).toBe(UNFINISHED);
    expect(withConsts("order-shipped", "Заказ {order")).toBe(UNFINISHED);
    expect(withConsts("order-shipped", "Заказ order} в пути")).toBe(UNFINISHED);
  });
  it("refuses a token the server never fills, and one this letter leaves empty", () => {
    expect(withConsts("order-shipped", "Привет {foo}")).toBe(UNKNOWN);
    expect(withConsts("birthday", "Трек {track}")).toBe(UNKNOWN);   // «{track}» in a birthday letter comes out as nothing
    expect(withConsts("order-shipped", "Имя {Name}")).toBe(UNKNOWN);
  });
  it("passes every letter's own standard text, in every language", () => {
    for (const tpl of MAIL_TEXT_TEMPLATES) {
      for (const lang of ["ru", "et", "en"] as const) {
        const d = MAIL_TEXT_DEFAULTS[tpl as keyof typeof MAIL_TEXT_DEFAULTS][lang];
        for (const field of ["subject", "intro", "signature"] as const) {
          expect(problem(tpl, d[field]), `${tpl}/${lang}/${field}: ${d[field]}`).toBe("");
        }
      }
    }
  });

  it("a refused text is never what goes out — the saved one does, and the rest of the draft with it", () => {
    const S: Record<string, unknown> = {
      mailDraft: {
        "order-shipped": { ru: { subject: "Заказ {ord", intro: "Ваш заказ уже едет." } },
        "order-confirmed": { et: { subject: "Tellimus {order} on käes" } },
      },
    };
    const out = build<() => Record<string, unknown>>(
      ["mailOutMap", "mailDraft", "mailSaved", "mailClean", "mailLimit", "mailTextProblem", "mailTokensOf", "objKeys"],
      {
        S,
        MAIL_TEXTS: { samples: SAMPLES, texts: { "order-shipped": { ru: { subject: "Заказ {order} отправлен" } } }, limits: {} },
        MAIL_LANGS: ["ru", "et", "en"],
        MAIL_LIMITS: { subject: 200, intro: 1500, signature: 300 },
        MAIL_PH_UNFINISHED: UNFINISHED, MAIL_PH_UNKNOWN: UNKNOWN,
      },
      "mailOutMap", ["ADM_MAIL_ROWS", "MAIL_FIELDS", "MAIL_PH"],
    )();
    expect(out).toEqual({
      "order-shipped": { ru: { subject: "Заказ {order} отправлен", intro: "Ваш заказ уже едет." } },
      "order-confirmed": { et: { subject: "Tellimus {order} on käes" } },
    });
  });
});

describe("a newsletter's first save is one draft, however many times it is sent", () => {
  function rig(answers: Array<() => Promise<unknown>>) {
    const calls: Array<{ method: string; body: string; key: string }> = [];
    let n = 0;
    const S: Record<string, unknown> = {};
    const d: Record<string, unknown> = { id: "", status: "draft", title: "Осень", subject: { RU: "Тема", ET: "", EN: "" }, blocks: [] };
    S.newsEdit = d;
    const save = build<(d: unknown) => Promise<{ status: number }>>(
      ["saveNewsFields", "newsPayload", "newsBlocksOut", "newsBlockOut", "newsTri", "newsBodySig", "newsDraftSig", "newsDirty"],
      {
        S, SRV: { admin: true },
        apiSend: (_u: string, method: string, body: unknown, key?: string) => {
          calls.push({ method, body: JSON.stringify(body), key: key || "" });
          const a = answers[Math.min(n++, answers.length - 1)];
          return a();
        },
        idemNewKey: () => "key-" + calls.length + "-abcdef",
        render: () => {},
        newsAutosave: () => {},
        mkKeepalive: () => Promise.reject(new Error("no")),
        mkKeepaliveIdem: () => Promise.reject(new Error("no")),
        NEWS_SAVED_AT: 0, newsHeadPaint: () => {},
      },
      "saveNewsFields",
    );
    return { save, calls, d, S };
  }

  it("a POST whose answer was lost goes again with the SAME key and the SAME body — the letter typed since waits for the PATCH", async () => {
    const created = { status: 200, body: { ok: true, newsletter: { id: "0d9f5a1e-1111-4222-8333-944455556666", status: "draft", updatedAt: "x" } } };
    const r = rig([() => Promise.reject(new Error("network")), () => Promise.resolve(created)]);
    await r.save(r.d).catch(() => {});
    (r.d.subject as Record<string, string>).RU = "Тема, которую допечатали";   // typed while the answer was lost
    await r.save(r.d);
    expect(r.calls.map((c) => c.method)).toEqual(["POST", "POST"]);
    expect(r.calls[0].key, "the first save had no Idempotency-Key").not.toBe("");
    expect(r.calls[1].key, "the retry was a second intention").toBe(r.calls[0].key);
    expect(r.calls[1].body, "the retry carried a different body — the route would refuse it as key_reused").toBe(r.calls[0].body);
    expect(r.d.id).toBe("0d9f5a1e-1111-4222-8333-944455556666");
    // …and a letter the server now has is saved by PATCH from here on
    await r.save(r.d);
    expect(r.calls[2].method).toBe("PATCH");
    expect(JSON.parse(r.calls[2].body).subject.RU).toBe("Тема, которую допечатали");
  });
});

describe("a word typed while a save is on its way is still owed", () => {
  it("the draft stays «not saved» until the write that carries the word lands", async () => {
    let release: (v: unknown) => void = () => {};
    const S: Record<string, unknown> = {};
    const d: Record<string, unknown> = { id: "0d9f5a1e-1111-4222-8333-944455556666", status: "draft", title: "Осень", subject: { RU: "Тема", ET: "", EN: "" }, blocks: [] };
    S.newsEdit = d;
    const fns = build<{ save: (d: unknown) => Promise<unknown>; dirty: () => boolean }>(
      ["saveNewsFields", "newsPayload", "newsBlocksOut", "newsBlockOut", "newsTri", "newsBodySig", "newsDraftSig", "newsDirty"],
      {
        S, SRV: { admin: true }, NEWS_SAVED_AT: 0, newsHeadPaint: () => {},
        apiSend: () => new Promise((r) => { release = r; }),
        idemNewKey: () => "k-abcdefgh", render: () => {}, newsAutosave: () => {},
        mkKeepalive: () => Promise.reject(new Error("no")), mkKeepaliveIdem: () => Promise.reject(new Error("no")),
      },
      "{ save: saveNewsFields, dirty: newsDirty }",
    );
    const saving = fns.save(d);
    (d.subject as Record<string, string>).RU = "Тема и ещё слово";   // typed while the PATCH is in the air
    release({ status: 200, body: { ok: true, newsletter: { id: d.id, status: "draft", updatedAt: "x" } } });
    await saving;
    expect(fns.dirty(), "the word typed during the save was taken for saved").toBe(true);
  });
});


describe("a confirmed delete or send is held, and «Вернуть» means it never happens (q3, q8)", () => {
  function rig() {
    const S: Record<string, unknown> = { toast: null, toastUndo: null };
    const toasts: Array<{ m: string; undo: unknown }> = [];
    const toast = Object.assign((m: string, undo: unknown) => { toasts.push({ m, undo }); }, { _t: 0 });
    const hold = build<(ms: number, fire: (l: boolean) => void, undo: () => void, text: string) => { cancel: () => boolean; fire: (l?: boolean) => void }>(
      ["mkHold"], { S, toast, paintToast: () => {}, MK_HOLDS: [] }, "mkHold", [],
    );
    return { hold, toasts, S };
  }
  it("does nothing for the held time, then fires once", () => {
    vi.useFakeTimers();
    try {
      const r = rig();
      const fired: boolean[] = [];
      r.hold(10000, (l) => fired.push(l), () => {}, "Письмо уйдёт подписчикам через 10 секунд");
      vi.advanceTimersByTime(9999);
      expect(fired).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(fired).toEqual([false]);
      vi.advanceTimersByTime(20000);
      expect(fired).toEqual([false]);
    } finally { vi.useRealTimers(); }
  });
  it("«Вернуть» on the toast cancels it before it is made", () => {
    vi.useFakeTimers();
    try {
      const r = rig();
      const fired: boolean[] = [];
      let undone = 0;
      r.hold(5000, (l) => fired.push(l), () => { undone += 1; }, "Промокод удалён");
      const offer = r.toasts[0].undo as { prev: unknown; undo: () => void };
      expect(offer.prev, "the toast would not show «Вернуть»").toBeTruthy();
      offer.undo();
      vi.advanceTimersByTime(60000);
      expect(fired).toEqual([]);
      expect(undone).toBe(1);
    } finally { vi.useRealTimers(); }
  });
  it("a page going away sends what it holds at once, and only once", () => {
    vi.useFakeTimers();
    try {
      const r = rig();
      const fired: boolean[] = [];
      const h = r.hold(5000, (l) => fired.push(l), () => {}, "");
      h.fire(true);
      vi.advanceTimersByTime(10000);
      expect(fired).toEqual([true]);
      expect(h.cancel(), "a sent call can still be cancelled").toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it("the confirm sheet's «Отправить» holds the send, it does not start it", () => {
    expect(src).toContain('if (pa.type === "newsletter_send") { newsSendHeld(pa); return; }');
    expect(src).toContain('if (pa.type === "delete_promo") { promoDeleteHeld(pa.code); return; }');
    expect(src).toContain('if (pa.type === "news_delete") { newsDeleteHeld(pa.id); return; }');
    expect(src).toMatch(/var MK_DELETE_HOLD_MS = 5000;/);
    expect(src).toMatch(/var MK_SEND_HOLD_MS = 10000;/);
  });
});

/* The bar and the pinned button step aside while a field has the keyboard
   (body.adm-typing). A press that takes the focus out of the field used to
   bring them back between the press and the release — a mouse's are two
   events a moment apart — so the pinned «Отправить» came back under the
   pointer, took the release, and the click went nowhere. Now they come back
   once the press is over. The listeners are run as app.js registers them,
   over a document that only records them. */
describe("a press out of a field brings the pinned button back only once it is released", () => {
  function rigTyping() {
    const from = src.indexOf("function admTyping(el)");
    const to = src.indexOf("\n", src.indexOf('document.addEventListener("focusout", function () { setTimeout(', from));
    if (from < 0 || to < 0) throw new Error("app.js no longer has the adm-typing block");
    const on: Record<string, Array<() => void>> = {};
    const cls = new Set<string>();
    const input = { nodeType: 1, tagName: "INPUT", isContentEditable: false, getAttribute: () => "text" };
    const button = { nodeType: 1, tagName: "BUTTON", isContentEditable: false, getAttribute: () => null };
    const doc = {
      activeElement: input as unknown,
      body: { classList: { toggle: (c: string, v: boolean) => { if (v) cls.add(c); else cls.delete(c); } } },
      addEventListener: (t: string, f: () => void) => { (on[t] = on[t] || []).push(f); },
    };
    // eslint-disable-next-line no-new-func
    new Function("document", "S", src.slice(from, to))(doc, { screen: "admin" });
    const fire = (t: string) => (on[t] || []).forEach((f) => f());
    return { doc, cls, fire, input, button };
  }
  it("while the press lasts the bar stays away; the release brings it back", () => {
    vi.useFakeTimers();
    try {
      const r = rigTyping();
      r.fire("focusin");
      expect(r.cls.has("adm-typing")).toBe(true);
      // the press lands on a button: the field loses the focus at once, and the button takes it…
      r.fire("pointerdown");
      r.doc.activeElement = r.button;
      r.fire("focusout");
      r.fire("focusin");
      vi.advanceTimersByTime(50);
      expect(r.cls.has("adm-typing"), "the pinned button came back under a press that is not over").toBe(true);
      // …and the bar is back once the button is let go
      r.fire("pointerup");
      vi.advanceTimersByTime(1);
      expect(r.cls.has("adm-typing")).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it("a press into another field keeps them away the whole time", () => {
    vi.useFakeTimers();
    try {
      const r = rigTyping();
      r.doc.activeElement = r.button;
      r.fire("pointerdown");
      r.doc.activeElement = r.input;
      r.fire("focusin");
      expect(r.cls.has("adm-typing"), "a press into a field left the bar over the keyboard").toBe(true);
      r.fire("pointerup");
      vi.advanceTimersByTime(1);
      expect(r.cls.has("adm-typing")).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it("a blur with no press — Tab, the keyboard's own «Done» — still brings it back a tick later", () => {
    vi.useFakeTimers();
    try {
      const r = rigTyping();
      r.fire("focusin");
      r.doc.activeElement = r.button;
      r.fire("focusout");
      vi.advanceTimersByTime(1);
      expect(r.cls.has("adm-typing")).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
