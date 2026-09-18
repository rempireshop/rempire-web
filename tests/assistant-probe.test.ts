/**
 * r21, assistant — four things that happen around the question, not inside it.
 *
 *   · GET /api/assistant/ is probed once per page to find out whether there is
 *     a model behind the route at all. Both the shop widget and the panel set
 *     the flag to «no» BEFORE the fetch and never asked again, so ONE dropped
 *     request (a lift, a sleeping laptop) left the shopper — and the owner —
 *     with the canned answers for as long as the tab stayed open.
 *   · A chip tapped while that probe was still in the air was dropped: the box
 *     drew the canned answer, the probe then turned the panel to the model,
 *     and admAnswerHTML() had nothing to draw but «…» — no request had ever
 *     been sent, and the only way out was to retype the question.
 *   · The same question sent twice — a chip double-tapped on a phone is one
 *     finger, not two — raced two proposals into the panel's ONE confirm slot.
 *   · The shop prompt asks the assistant to end an answer with an article's
 *     path; the bubble printed it as text nobody could press.
 *
 * Both files are vanilla-JS IIFEs with no DOM here, so the functions are
 * sliced out by source text and run against stubs — the idiom of
 * tests/admin-assistant-confirm.test.ts and tests/admin-panel-truth.test.ts.
 * Retyping them would test this file instead of the shop.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const CHAT_JS = fileURLToPath(new URL("../public/shop2/chat.js", import.meta.url));
const app = readFileSync(APP_JS, "utf8");
const chat = readFileSync(CHAT_JS, "utf8");

/** Cut `function <name>(…) { … }` out of a source file by brace matching. */
function fn(src: string, where: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${where} no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in ${where}`);
}
/** Cut a one-line `var <name> = …;` declaration out by source text. */
function decl(src: string, where: string, name: string): string {
  const start = src.indexOf(`var ${name} = `);
  if (start < 0) throw new Error(`${where} no longer declares ${name}`);
  const end = src.indexOf("\n", start);
  return src.slice(start, end < 0 ? src.length : end);
}
const appFn = (name: string) => fn(app, "public/shop2/app.js", name);
const chatFn = (name: string) => fn(chat, "public/shop2/chat.js", name);

/* ---------- the shop widget's probe --------------------------------------- */

type ProbeOut = { enabled: unknown; calls: number };
/** probeAI() from chat.js, run with a fetch that answers or fails. */
function shopProbe(answer: "ok-on" | "ok-off" | "fail"): Promise<ProbeOut> {
  // Every body below is this repository's own source plus fixed stub text —
  // nothing from outside is interpolated into it; the test's own values go in
  // as arguments (the idiom of tests/admin-assistant-confirm.test.ts).
  const body = `
    var aiEnabled = null;
    var calls = 0;
    function refreshHint() {}
    function fetch() {
      calls += 1;
      if (MODE === "fail") return Promise.reject(new Error("offline"));
      return Promise.resolve({ json: function () { return Promise.resolve({ enabled: MODE === "ok-on" }); } });
    }
    ${chatFn("probeAI")}
    probeAI();
    probeAI();   // the guard: one probe per page, not one per open
    return new Promise(function (done) {
      setTimeout(function () { done({ enabled: aiEnabled, calls: calls }); }, 0);
    });
  `;
  return (new Function("MODE", body) as (m: string) => Promise<ProbeOut>)(answer);
}

describe("the shop widget's one probe (chat.js probeAI)", () => {
  it("asks once and keeps the answer", async () => {
    expect(await shopProbe("ok-on")).toEqual({ enabled: true, calls: 1 });
    expect(await shopProbe("ok-off")).toEqual({ enabled: false, calls: 1 });
  });

  it("a probe that never came back leaves the flag at «не спрашивали», so the next one asks again", async () => {
    const out = await shopProbe("fail");
    expect(out.calls).toBe(1);
    expect(out.enabled, "one dropped request made the whole page rule-based").toBeNull();
  });

  it("and reply() re-probes, so the next message can reach the model", () => {
    expect(chatFn("reply")).toContain("probeAI();");
  });
});

/* ---------- the article link in the bubble --------------------------------- */

function linkify(text: string, uiLang: string): string {
  const body = `
    function lang() { return LANG; }
    ${decl(chat, "public/shop2/chat.js", "BLOG_SEG")}
    ${decl(chat, "public/shop2/chat.js", "BLOG_PATH_RX")}
    ${chatFn("withBlogLinks")}
    return withBlogLinks(TEXT);
  `;
  return (new Function("TEXT", "LANG", body) as (t: string, l: string) => string)(text, uiLang);
}

describe("the article the shop assistant points at (chat.js withBlogLinks)", () => {
  it("turns the bare path the prompt asks for into the shop's own link", () => {
    const out = linkify("Про это есть статья. /shop2/blog/beard-in-winter/", "RU");
    expect(out).toContain('data-go-blog="beard-in-winter"');
    expect(out).toContain('href="/shop2/blog/beard-in-winter/"');
    expect(out).toContain(">/shop2/blog/beard-in-winter/</a>");
  });

  it("sends an Estonian shopper to the Estonian address", () => {
    expect(linkify("/shop2/blog/beard-in-winter/", "ET")).toContain('href="/shop2/et/blog/beard-in-winter/"');
    expect(linkify("/shop2/en/blog/beard-in-winter/", "EN")).toContain('href="/shop2/en/blog/beard-in-winter/"');
  });

  it("leaves everything else alone", () => {
    const plain = "Возьмите шампунь для объёма — он в каталоге.";
    expect(linkify(plain, "RU")).toBe(plain);
    expect(linkify("/shop2/c/beard/", "RU")).toBe("/shop2/c/beard/");
    // the text is already escaped when this runs — it cannot open a tag of its own
    expect(linkify("&lt;script&gt; /shop2/blog/x/", "RU")).toContain("&lt;script&gt;");
  });
});

/* ---------- the panel: the probe, and the question waiting for it ---------- */

type AdmOut = { ai: unknown; failed: boolean; asked: string[]; probes: number };
/**
 * probeAdmAI() + admAsk() + admAskWaiting() from app.js, with a question
 * already on screen (`onScreen`) and a fetch that answers or fails.
 */
function panelProbe(mode: "ok-on" | "ok-off" | "fail", onScreen: string, thenAsk?: string): Promise<AdmOut> {
  const body = `
    var S = { adminAsk: ON_SCREEN, adminAns: null };
    var asked = [];
    var probes = 0;
    var mode = MODE;
    function render() {}
    function askAdminAI(q) { asked.push(q); }
    function fetch() {
      probes += 1;
      if (mode === "fail") return Promise.reject(new Error("offline"));
      return Promise.resolve({ json: function () { return Promise.resolve({ enabled: mode === "ok-on" }); } });
    }
    ${appFn("probeAdmAI")}
    ${appFn("admAskWaiting")}
    ${appFn("admAsk")}
    var admAI = null, admAIAsked = false, admAIFailed = false;
    probeAdmAI();
    return new Promise(function (done) {
      setTimeout(function () {
        if (LATER) { mode = "ok-on"; S.adminAsk = LATER; admAsk(LATER); }
        setTimeout(function () {
          done({ ai: admAI, failed: admAIFailed, asked: asked, probes: probes });
        }, 0);
      }, 0);
    });
  `;
  return (new Function("MODE", "ON_SCREEN", "LATER", body) as (m: string, o: string, l: string) => Promise<AdmOut>)(
    mode, onScreen, thenAsk ?? "",
  );
}

describe("the panel's probe and the question tapped before it landed", () => {
  it("fires the chip that was waiting the moment the probe says there is a model", async () => {
    const out = await panelProbe("ok-on", "Сколько продали за неделю?");
    expect(out.ai).toBe(true);
    expect(out.asked, "the chip was dropped and the answer box kept «…»").toEqual(["Сколько продали за неделю?"]);
  });

  it("asks nothing when there is no model behind the route — the canned answer stands", async () => {
    const out = await panelProbe("ok-off", "Сколько продали за неделю?");
    expect(out.ai).toBe(false);
    expect(out.asked).toEqual([]);
  });

  it("a probe that never came back is marked, not taken for «нет модели»", async () => {
    const out = await panelProbe("fail", "");
    expect(out.ai).toBe(false);
    expect(out.failed).toBe(true);
    expect(out.probes).toBe(1);
  });

  it("…and the next question the owner asks probes again and rides on it", async () => {
    const out = await panelProbe("fail", "", "Что заканчивается?");
    expect(out.probes, "the failed probe was never asked again for the life of the page").toBe(2);
    expect(out.asked).toEqual(["Что заканчивается?"]);
    expect(out.failed).toBe(false);
  });
});

/* ---------- one question at a time ---------------------------------------- */

type FlightOut = { sent: string[]; turns: number };
/** askAdminAI() from app.js, called with `questions` back to back. */
function inFlight(questions: string[]): Promise<FlightOut> {
  const body = `
    var pendingAction = null;
    var S = { adminAsk: QS[QS.length - 1], lang: "RU", adminAtt: [], adminAns: null };
    var admConvo = [];
    var sent = [];
    var AI_UNREADABLE = "unreadable";
    var AI_SILENT = "silent";
    function replyLooksLikeJson() { return false; }
    function admPaintAnswer() {}
    function loadAdminBundles() {}
    function heroForAI() { return []; }
    function contentForAI() { return {}; }
    function analyticsForAI() { return null; }
    function attachmentsForAI() { return []; }
    // r25: which article is open in the blog editor — none, in this rig
    function blogOpenForAI() { return null; }
    function fetch(_url, init) {
      sent.push(JSON.parse(init.body).messages.slice(-1)[0].content);
      return new Promise(function (ok) {
        setTimeout(function () {
          ok({ ok: true, json: function () { return Promise.resolve({ reply: "ок", product_ids: [] }); } });
        }, 5);
      });
    }
    ${decl(app, "public/shop2/app.js", "admAskFlight")}
    ${appFn("askAdminAI")}
    QS.forEach(function (q) { askAdminAI(q); });
    return new Promise(function (done) {
      setTimeout(function () { done({ sent: sent, turns: admConvo.length }); }, 40);
    });
  `;
  return (new Function("QS", body) as (q: string[]) => Promise<FlightOut>)(questions);
}

describe("one question in the air at a time (askAdminAI)", () => {
  it("ignores the same question sent again while its request is still out", async () => {
    const out = await inFlight(["сделай скидку 25 % для салонов", "сделай скидку 25 % для салонов"]);
    expect(out.sent, "a double-tapped chip raced two proposals into one confirm slot").toEqual([
      "сделай скидку 25 % для салонов",
    ]);
    // …and the model is not shown the same turn twice either
    expect(out.turns).toBe(2);   // one user turn, one answer
  });

  it("still lets the owner change his mind mid-flight", async () => {
    const out = await inFlight(["сделай скидку 25 %", "нет, лучше промокод"]);
    expect(out.sent).toEqual(["сделай скидку 25 %", "нет, лучше промокод"]);
  });

  it("and asks again once the answer has landed", async () => {
    const first = await inFlight(["сколько продали за неделю?"]);
    expect(first.sent).toHaveLength(1);
    const again = await inFlight(["сколько продали за неделю?", "сколько продали за неделю?"]);
    expect(again.sent).toHaveLength(1);
  });
});
