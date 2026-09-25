/**
 * The medium and low i18n findings of the round-21 audit, each pinned by the
 * behaviour it was about.
 *
 * Same technique as tests/shop-lost-answer.test.ts and tests/checkout-parity.test.ts:
 * the shop's own functions are cut out of public/shop2/app.js and
 * public/shop2/chat.js **by source text** and run against stubs, so what is
 * checked is the code that ships rather than a copy retyped here. That matters
 * more than usual in this file: tests/i18n-rules.test.ts has its own hand-made
 * `tr()` beside the real trText(), and it carried the very prototype-chain bug
 * the first test below is about — a retyped copy agrees with itself.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeLang } from "@/emails/layout";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const CHAT_JS = fileURLToPath(new URL("../public/shop2/chat.js", import.meta.url));
const app = readFileSync(APP_JS, "utf8");
const chat = readFileSync(CHAT_JS, "utf8");

/** `function <name>(…) { … }`, cut out by brace matching. */
function fn(src: string, name: string, where = "public/shop2/app.js"): string {
  return block(src, `function ${name}(`, `${where} no longer has function ${name}()`);
}

/** Any `<head> { … }` — a function or an `if` — cut out by brace matching. */
function block(src: string, head: string, missing: string): string {
  const start = src.indexOf(head);
  if (start < 0) throw new Error(missing);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after ${JSON.stringify(head)}`);
}

/** A whole `var X = …;` declaration, terminator included. */
function decl(src: string, marker: string, terminator: string): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${marker}`);
  const end = src.indexOf(terminator, at);
  if (end < 0) throw new Error(`${marker} has no terminator ${JSON.stringify(terminator)}`);
  return src.slice(at, end + terminator.length);
}

/** Let every pending promise chain settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/* ------------------------------------------------------------------------ *
 * trText — the shop's translator, with its two real tables behind it
 * ------------------------------------------------------------------------ */

type Lang = "ET" | "EN";
const trText = new Function(`
  ${decl(app, "var UI = ", "\n  };")}
  ${decl(app, "var UI_RX = ", "\n  ];")}
  ${fn(app, "trText")}
  // trName() is somebody else's test (tests/i18n-rules.test.ts): here a name
  // is a proper noun that must travel through $1 unchanged.
  function trName(s) { return s; }
  return trText;
`)() as (s: string, lang: Lang, allowName?: boolean) => string;

const CYRILLIC = /[А-Яа-яЁё]/;

describe("trText looks words up in the dictionary, not up the prototype chain", () => {
  /* UI.ET and UI.EN are object literals, so a bare d[key] reaches
     Object.prototype. The captures are not always ours — the empty-search line
     carries whatever the shopper typed — so «constructor» in the search box
     used to answer «Nothing found for “function Object() { [native code] }”». */
  const POISON = ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__", "isPrototypeOf"];

  it("hands a shopper's own query back to them, whatever they typed", () => {
    const bad: string[] = [];
    for (const word of POISON) {
      for (const lang of ["ET", "EN"] as const) {
        const out = trText(`По запросу «${word}» ничего не нашлось.`, lang, false);
        if (typeof out !== "string") bad.push(`${lang} «${word}»: trText returned a ${typeof out}`);
        else if (!out.includes(word)) bad.push(`${lang} «${word}»: the query is gone — «${out}»`);
        else if (/native code|\[object |function \(/.test(out)) bad.push(`${lang} «${word}»: «${out}»`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("never answers a whole-string lookup with something that is not a string", () => {
    const bad: string[] = [];
    for (const word of POISON) {
      for (const lang of ["ET", "EN"] as const) {
        const out = trText(word, lang, false);
        if (typeof out !== "string") bad.push(`${lang} «${word}»: ${typeof out}`);
        else if (out !== word) bad.push(`${lang} «${word}» → «${out}»`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("still translates the words the dictionary really holds", () => {
    expect(trText("В корзину", "EN", false)).toBe("Add to cart");
    expect(trText("В корзину", "ET", false)).toBe("Lisa ostukorvi");
    expect(trText("По запросу «Davines» ничего не нашлось.", "EN", false)).toBe("Nothing found for “Davines”.");
  });
});

/* ------------------------------------------------------------------------ *
 * …and the same trText has to keep coming out of app.js in one piece
 * ------------------------------------------------------------------------ */

describe("the prerenderer can still lift the translator out of app.js", () => {
  /* tools/prerender-shop2.mjs writes the 813 static pages, and it does not
     keep a second copy of the dictionaries: it cuts the tables and the two
     functions out of app.js line by line and evaluates them. A dependency
     added to trText that the tool does not lift is not an error there — it
     prints one warning and writes every ET and EN page in Russian. That is
     how a one-line prototype guard nearly shipped as 542 Russian pages, so
     the tool's own anchors are read out of the tool and checked here. */
  const TOOL = fileURLToPath(new URL("../tools/prerender-shop2.mjs", import.meta.url));
  const tool = readFileSync(TOOL, "utf8");
  const appLines = app.replace(/\r\n?/g, "\n").split("\n");

  function ends(name: string): RegExp {
    const m = tool.match(new RegExp(`const ${name} = /(.+?)/;`));
    if (!m) throw new Error(`tools/prerender-shop2.mjs no longer has const ${name}`);
    return new RegExp(m[1]);
  }
  /** sliceFrom() from the tool, to the letter. */
  function sliceFrom(startRx: RegExp, endRx: RegExp): string | null {
    const i = appLines.findIndex((l) => startRx.test(l));
    if (i < 0) return null;
    for (let j = i + 1; j < appLines.length; j++) {
      if (endRx.test(appLines[j])) return appLines.slice(i, j + 1).join("\n");
    }
    return null;
  }
  const END = { DECL_END: ends("DECL_END"), FN_END: ends("FN_END") };
  const anchors = [...tool.matchAll(/sliceFrom\(\/(.+?)\/, (DECL_END|FN_END)\)/g)].map((m) => ({
    source: m[1],
    end: END[m[2] as keyof typeof END],
  }));

  it("finds every slice the tool asks app.js for", () => {
    expect(anchors.length).toBeGreaterThan(10);
    const lost = anchors.filter((a) => !sliceFrom(new RegExp(a.source), a.end)).map((a) => a.source);
    expect(lost).toEqual([]);
  });

  it("gets a translator that translates, with nothing left undefined", () => {
    const wanted = ["var UI = ", "var UI_RX = ", "NAME_TAILS", "NAME_FRAGS", "TAIL_EXACT", "trName", "trText"];
    const pieces = anchors
      .filter((a) => wanted.some((w) => a.source.includes(w.replace("var ", "var ").trim())))
      .map((a) => sliceFrom(new RegExp(a.source), a.end)!)
      .filter(Boolean);
    const lifted = new Function(pieces.join("\n") + "\nreturn trText;")() as typeof trText;
    // the tool's own smoke test, and one that goes through a $1 capture
    expect(lifted("Уход за волосами", "ET", false)).not.toBe("Уход за волосами");
    expect(lifted("По запросу «Davines» ничего не нашлось.", "EN", false)).toBe("Nothing found for “Davines”.");
  });
});

/* ------------------------------------------------------------------------ *
 * the order of the rules IS behaviour — trText takes the first that matches
 * ------------------------------------------------------------------------ */

describe("UI_RX — a specific rule stands above the general one it would fall into", () => {
  it("translates the newsletter's «Письмо ушло — отправлено …» whole", () => {
    const bad: string[] = [];
    for (const lang of ["ET", "EN"] as const) {
      const out = trText("Письмо ушло — отправлено 5, ошибок 0 ✓", lang, false);
      if (CYRILLIC.test(out)) bad.push(`${lang}: «${out}»`);
      if (!out.includes("5") || !out.includes("0")) bad.push(`${lang}: the counts are gone — «${out}»`);
    }
    expect(bad).toEqual([]);
  });

  it("leaves the invoice's «Письмо ушло <дата>» alone", () => {
    expect(trText("Письмо ушло 12.09.2026", "EN", false)).toBe("Letter sent 12.09.2026");
    expect(trText("Письмо ушло 12.09.2026", "ET", false)).toBe("Kiri läks välja 12.09.2026");
  });
});

describe("UI_RX — one is one in Estonian and English", () => {
  /* The general rules carry a single wording for every number, which is right
     from two up and wrong at exactly one: a search with a single hit counted
     «1 products» on the shopper's own screen. */
  const SINGULAR: Array<[string, string, string]> = [
    ["1 товар", "1 toode", "1 product"],
    ["1 балл", "1 punkt", "1 point"],
    ["1 точка", "1 punkt", "1 location"],
    ["Показать 1 товар", "Näita 1 toodet", "Show 1 product"],
    ["Показаны все 1 товар", "Kuvatud kõik 1 toode", "All 1 product shown"],
  ];
  it("says «1 product», not «1 products»", () => {
    const bad: string[] = [];
    for (const [ru, et, en] of SINGULAR) {
      if (trText(ru, "ET", false) !== et) bad.push(`ET «${ru}» → «${trText(ru, "ET", false)}», wanted «${et}»`);
      if (trText(ru, "EN", false) !== en) bad.push(`EN «${ru}» → «${trText(ru, "EN", false)}», wanted «${en}»`);
    }
    expect(bad).toEqual([]);
  });

  /* …and 21 is still plural in both, which is why the new rules are /^1 …$/
     and not a \d*1 pattern: Russian says «21 товар» with the singular noun. */
  const PLURAL: Array<[string, string, string]> = [
    ["2 товара", "2 toodet", "2 products"],
    ["21 товар", "21 toodet", "21 products"],
    ["5 баллов", "5 punkti", "5 points"],
    ["3 точки", "3 punkti", "3 locations"],
    ["Показать 12 товаров", "Näita 12 toodet", "Show 12 products"],
  ];
  it("leaves every other count exactly as it was", () => {
    const bad: string[] = [];
    for (const [ru, et, en] of PLURAL) {
      if (trText(ru, "ET", false) !== et) bad.push(`ET «${ru}» → «${trText(ru, "ET", false)}», wanted «${et}»`);
      if (trText(ru, "EN", false) !== en) bad.push(`EN «${ru}» → «${trText(ru, "EN", false)}», wanted «${en}»`);
    }
    expect(bad).toEqual([]);
  });
});

describe("the checkout's company block", () => {
  /* invoiceBlockHTML() and the customer card label the field with a capital;
     only the lower-case «рег. номер» was in the tables, so the line fell to
     /^Рег\. (.+)$/ and the shop asked an Estonian buyer for a «Reg-kood номер». */
  it("asks for the registry code in the buyer's own language", () => {
    expect(trText("Рег. номер", "ET", false)).toBe("Registrikood");
    expect(trText("Рег. номер", "EN", false)).toBe("Registry code");
  });

  it("still translates the shop's own registry line under the letters", () => {
    expect(trText("Рег. 12216136 · KMKR EE102723858", "EN", false)).toBe("Reg. no 12216136 · VAT EE102723858");
  });
});

/* ------------------------------------------------------------------------ *
 * translateTree — the attributes it says it translates, and the ones it visits
 * ------------------------------------------------------------------------ */

describe("translateTree collects every attribute TR_ATTRS names", () => {
  /* `label` sat in TR_ATTRS while the selector asked only for
     [placeholder],[aria-label],[title] — so an <optgroup>, which carries its
     heading in `label` and nowhere else, was never visited, and the four group
     headings of the banner editor's «Куда ведёт кнопка» stayed Russian on an
     ET or EN panel although both dictionaries had them. */
  const attrs = (() => {
    const m = app.match(/var TR_ATTRS = (\[[^\]]*\]);/);
    if (!m) throw new Error("public/shop2/app.js no longer has var TR_ATTRS = [ … ];");
    return JSON.parse(m[1].replace(/'/g, '"')) as string[];
  })();
  const selector = (() => {
    const m = fn(app, "translateTree").match(/root\.querySelectorAll\("([^"]+)"\)/);
    if (!m) throw new Error("translateTree() no longer collects attribute elements with querySelectorAll");
    return m[1];
  })();

  it("asks the DOM for each one", () => {
    expect(attrs.length).toBeGreaterThan(3);
    expect(attrs.filter((a) => !selector.includes(`[${a}]`))).toEqual([]);
  });

  it("has the four <optgroup> headings in both dictionaries", () => {
    for (const heading of ["Разделы", "Страницы магазина", "Информация", "Один товар"]) {
      expect(trText(heading, "ET", false)).not.toBe(heading);
      expect(trText(heading, "EN", false)).not.toBe(heading);
    }
  });
});

/* ------------------------------------------------------------------------ *
 * «Письма» — a load that failed must be askable again
 * ------------------------------------------------------------------------ */

type MailHarness = {
  load: (force?: boolean) => void;
  state: () => { asked: boolean; texts: unknown; renders: number };
};

function mailLoader(fetchStub: (url: string) => Promise<unknown>): MailHarness {
  return new Function(
    "FETCH",
    `
    var mailTextsAsked = false, MAIL_TEXTS = null, renders = 0;
    function noop() {}
    function render() { renders++; }
    var fetch = FETCH;
    ${fn(app, "loadMailTexts")}
    return {
      load: function (force) { loadMailTexts(force); },
      state: function () { return { asked: mailTextsAsked, texts: MAIL_TEXTS, renders: renders }; }
    };
  `,
  )(fetchStub) as MailHarness;
}

describe("loadMailTexts — the «Письма» editor is not a permanent skeleton", () => {
  /* admMailEditorHTML() draws three grey bars while MAIL_TEXTS is null, the
     only call site is loadMailTexts(false) inside the render, and the section
     has no «Повторить» button — so one refused request used to cost the owner
     the whole page. */
  it("asks again after a request that never arrived", async () => {
    let calls = 0;
    const h = mailLoader(() => { calls++; return Promise.reject(new Error("offline")); });
    h.load();
    await flush();
    expect(calls).toBe(1);
    expect(h.state().asked).toBe(false);
    h.load();
    await flush();
    expect(calls).toBe(2);
  });

  it("asks again after an answer that was not ok", async () => {
    let calls = 0;
    const h = mailLoader(() => { calls++; return Promise.resolve({ ok: false, status: 503 }); });
    h.load();
    await flush();
    h.load();
    await flush();
    expect(calls).toBe(2);
    expect(h.state().texts).toBeNull();
  });

  it("asks once while the first request is still in the air", async () => {
    let calls = 0;
    const h = mailLoader(() => { calls++; return new Promise(() => {}); });
    h.load();
    h.load();
    h.load();
    await flush();
    expect(calls).toBe(1);
  });

  it("stops asking once the texts have landed", async () => {
    let calls = 0;
    const h = mailLoader(() => {
      calls++;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, texts: {} }) });
    });
    h.load();
    await flush();
    expect(h.state().texts).toEqual({ ok: true, texts: {} });
    expect(h.state().renders).toBe(1);
    h.load();
    await flush();
    expect(calls).toBe(1);
  });
});

/* ------------------------------------------------------------------------ *
 * «Перевести статью» — three requests, one honest answer
 * ------------------------------------------------------------------------ */

type Answer = { status: number; body: Record<string, unknown> };
type BlogOut = { toasts: string[]; draft: Record<string, Record<string, string>> };

/** Run the panel's own «Перевести» handler with one answer per field. */
function blogTranslate(answer: (text: string) => Answer): BlogOut {
  const draft = {
    title: { RU: "Как ухаживать за бородой", ET: "", EN: "" },
    excerpt: { RU: "Коротко о главном", ET: "", EN: "" },
    body: { RU: "<p>Текст статьи</p>", ET: "", EN: "" },
  };
  return new Function(
    "DRAFT",
    "ANSWER",
    `
    var toasts = [];
    var SRV = { admin: true };
    var S = { adminBlogEdit: DRAFT };
    var d = { admblogtranslate: "" };
    var t = { disabled: false, textContent: "Перевести" };
    function toast(m) { toasts.push(m); }
    function render() {}
    function txt(v) { return typeof v === "string" ? v.trim() : ""; }
    function blogCardsOut(h) { return { html: String(h || ""), cards: [] }; }
    function blogFigsOut(h) { return { html: String(h || ""), figs: [] }; }
    function blogHtmlToText(h) { return String(h || ""); }
    function blogTextToHtml(s) { return String(s); }
    function blogFigsIn(h) { return h; }
    function blogCardsIn(h) { return h; }
    function blogCleanHtml(h) { return h; }
    function apiSend(url, method, payload) { return Promise.resolve(ANSWER(payload.input.text)); }
    /* 1a: a draft asks nothing before the assistant writes (blogAiAsks is
       for a published article), and a translation saves itself */
    function blogTextLen(h) { return String(h || "").length; }
    function blogAiAsks() { return false; }
    function blogAutosave() { return true; }
    function run() {
      ${block(app, "if (d.admblogtranslate !== undefined) {", "public/shop2/app.js no longer has the admblogtranslate handler")}
    }
    run();
    return { toasts: toasts, draft: DRAFT };
  `,
  )(draft, answer) as BlogOut;
}

const OK = (et: string, en: string): Answer => ({ status: 200, body: { ok: true, texts: { ET: et, EN: en } } });

describe("«Перевести статью» says it is done only when it is", () => {
  /* Title, excerpt and body are three separate requests to the model and any
     one of them can come back 502 or rate-limited on its own. The flag used to
     be set by the first target string of the first field that landed, so a body
     that never arrived was announced as a finished draft with the Russian still
     in the box — and the owner pressed «Сохранить» on it. */
  it("reports the partial answer when one field failed", async () => {
    const out = blogTranslate((text) =>
      text.includes("Текст статьи")
        ? { status: 502, body: {} }
        : OK("Kuidas habet hooldada", "How to look after a beard"));
    await flush();
    expect(out.toasts).toEqual(["Перевелось не всё — проверьте и допишите"]);
    expect(out.draft.body.ET).toBe("");
    expect(out.draft.body.EN).toBe("");
    expect(out.draft.title.ET).toBe("Kuidas habet hooldada");
  });

  it("reports the partial answer when one language of one field is missing", async () => {
    const out = blogTranslate((text) =>
      text.includes("Текст статьи")
        ? { status: 200, body: { ok: true, texts: { ET: "Artikli tekst" } } }
        : OK("eesti", "english"));
    await flush();
    expect(out.toasts).toEqual(["Перевелось не всё — проверьте и допишите"]);
    expect(out.draft.body.ET).toBe("Artikli tekst");
    expect(out.draft.body.EN).toBe("");
  });

  /* 1a: the article saves itself, so the whole answer no longer says
     «…и сохраните» — «Готово — проверьте текст.» (screen 16) */
  it("says «Готово» when every field landed in every language", async () => {
    const out = blogTranslate(() => OK("eesti", "english"));
    await flush();
    expect(out.toasts).toEqual(["Готово — проверьте текст."]);
    expect(out.draft.body.EN).toBe("english");
  });

  it("keeps the two whole-failure answers it always had", async () => {
    const dead = blogTranslate(() => ({ status: 502, body: {} }));
    await flush();
    expect(dead.toasts).toEqual(["Не получилось — попробуйте ещё раз"]);

    const limited = blogTranslate(() => ({ status: 429, body: { error: "rate_limited" } }));
    await flush();
    expect(limited.toasts).toEqual(["Слишком много запросов — попробуйте позже"]);
  });
});

describe("the partial-translation toast is in all three languages", () => {
  it("has an Estonian and an English wording with no Russian left in them", () => {
    for (const lang of ["ET", "EN"] as const) {
      const out = trText("Перевелось не всё — проверьте и допишите", lang, false);
      expect(out).not.toBe("Перевелось не всё — проверьте и допишите");
      expect(CYRILLIC.test(out)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------------ *
 * the shop's chat widget — an answer to a conversation that no longer exists
 * ------------------------------------------------------------------------ */

type ChatHarness = {
  open: () => void;
  ask: (q: string) => void;
  switchTo: (lang: string) => void;
  seen: () => { bubbles: string[]; actions: unknown[]; convo: Array<{ role: string; content: string }>; rules: string[] };
};

function chatHarness(fetchStub: () => Promise<unknown>): ChatHarness {
  return new Function(
    "FETCH",
    `
    var LANG = "RU";
    function lang() { return LANG; }
    var uiLang = null;
    var convo = [], convoGen = 0, aiEnabled = true;
    var bubbles = [], actions = [], rules = [];
    var log = { childNodes: [], innerHTML: "", scrollTop: 0, scrollHeight: 0, appendChild: function () {} };
    var input = { placeholder: "" };
    var chipsEl = { innerHTML: "" };
    var root = { querySelector: function () { return { textContent: "" }; } };
    var document = { createElement: function () { return { className: "", textContent: "", remove: function () {} }; } };
    var byIdMap = {};
    function tt() { return { title: "t", hint: "h", placeholder: "p", chips: [], hello: "hello-" + LANG }; }
    function paintLabels() {}
    function refreshHint() {}
    function esc(s) { return String(s); }
    function productRow() { return ""; }
    function bubble(who, html) { bubbles.push(String(html)); }
    function runAction(a) { if (a) actions.push(a); }
    function rulesReply(q) { rules.push(q); }
    /* Two collaborators reply() grew after this harness was written, both
       stubbed like every other one above.

       probeAI — r21-assistant's re-probe: a dropped GET /api/assistant/ used
       to leave the shopper on the canned matcher for as long as the page
       stayed open, so every question re-asks. With aiEnabled already decided
       here (true), the real one returns on its first line, which is exactly
       what this no-op does.

       withBlogLinks — r21-assistant turns a /shop2/blog/<slug>/ path the model
       wrote into a link, AFTER escaping. What it makes of the text belongs to
       its own test; here the bubble has to arrive unchanged so the assertions
       below can look for the sentence in it. */
    function probeAI() {}
    function withBlogLinks(html) { return String(html); }
    var fetch = FETCH;
    ${fn(chat, "reply", "public/shop2/chat.js")}
    ${fn(chat, "paintPanel", "public/shop2/chat.js")}
    return {
      open: function () { paintPanel(); },
      ask: function (q) { reply(q); },
      switchTo: function (l) { LANG = l; paintPanel(); },
      seen: function () { return { bubbles: bubbles, actions: actions, convo: convo, rules: rules }; }
    };
  `,
  )(fetchStub) as ChatHarness;
}

describe("the chat drops an answer whose conversation was thrown away", () => {
  /* paintPanel() empties the log and `convo` when the shop's language changed
     under the widget. The POST already in the air carried on regardless: it
     came back in the language the question was asked in, landed under a
     greeting in the new one, pushed itself into the fresh conversation — and
     ran its action, so «в корзину» or «оформить заказ» happened in a panel the
     shopper had just reset. */
  it("neither speaks nor acts after the language switch reset the panel", async () => {
    let land: (v: unknown) => void = () => {};
    const h = chatHarness(() => new Promise((res) => { land = res; }));
    h.open();
    h.ask("подарок до 50 €");
    h.switchTo("EN");
    land({ ok: true, json: () => Promise.resolve({ reply: "Вот что подходит", action: { type: "open_cart" } }) });
    await flush();
    const s = h.seen();
    expect(s.actions).toEqual([]);
    expect(s.convo.filter((m) => m.role === "assistant")).toEqual([]);
    expect(s.bubbles.filter((b) => b.includes("Вот что подходит"))).toEqual([]);
  });

  it("does not fall back to the rule-based answer either", async () => {
    let die: (e: unknown) => void = () => {};
    const h = chatHarness(() => new Promise((_res, rej) => { die = rej; }));
    h.open();
    h.ask("подарок до 50 €");
    h.switchTo("ET");
    die(new Error("offline"));
    await flush();
    expect(h.seen().rules).toEqual([]);
  });

  it("still answers the conversation it was asked in", async () => {
    let land: (v: unknown) => void = () => {};
    const h = chatHarness(() => new Promise((res) => { land = res; }));
    h.open();
    h.ask("подарок до 50 €");
    land({ ok: true, json: () => Promise.resolve({ reply: "Вот что подходит", action: { type: "open_cart" } }) });
    await flush();
    const s = h.seen();
    expect(s.actions).toEqual([{ type: "open_cart" }]);
    expect(s.bubbles.filter((b) => b.includes("Вот что подходит"))).toHaveLength(1);
  });

  it("keeps answering after a language switch that changed nothing", async () => {
    let land: (v: unknown) => void = () => {};
    const h = chatHarness(() => new Promise((res) => { land = res; }));
    h.open();
    h.ask("подарок до 50 €");
    h.switchTo("RU"); // the same language: paintPanel keeps the conversation
    land({ ok: true, json: () => Promise.resolve({ reply: "Вот что подходит", action: null }) });
    await flush();
    expect(h.seen().bubbles.filter((b) => b.includes("Вот что подходит"))).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ *
 * which letters a language tag asks for
 * ------------------------------------------------------------------------ */

describe("normalizeLang — «es» is Spanish, not Estonian", () => {
  it("answers Estonian to every tag that really means Estonian", () => {
    for (const tag of ["et", "ET", "et-EE", "est", "EST", "ee", "eesti"]) {
      expect(normalizeLang(tag)).toBe("et");
    }
  });

  it("does not answer Estonian to a Spanish tag", () => {
    for (const tag of ["es", "es-ES", "es-MX", "ES"]) {
      expect(normalizeLang(tag)).not.toBe("et");
    }
  });

  it("keeps the three it is for", () => {
    expect(normalizeLang("ru-RU")).toBe("ru");
    expect(normalizeLang("en-GB")).toBe("en");
    expect(normalizeLang("")).toBe("ru");
    expect(normalizeLang(undefined)).toBe("ru");
  });
});
