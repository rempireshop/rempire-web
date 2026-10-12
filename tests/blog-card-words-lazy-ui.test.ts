/**
 * A product card in the Estonian or English text of an article is written in
 * that language's words — and since 09.10.2026 those words live in a file
 * the panel did not have.
 *
 * The speed package moved the interface dictionary out of app.min.js into
 * /shop2/ui.et.js and /shop2/ui.en.js, fetched when a page needs one
 * (uiWant, «the files the shop fetches when it needs them»). The panel is
 * drawn in the owner's language and fetched that one only. But the article
 * editor writes cards into all three texts (blogProductLinkHTML → trText),
 * and trText with no dictionary hands the Russian back: «Перевести на ET и
 * EN» saved «System 4 Bio Botanical Shampoo — шампунь» into the Estonian
 * article (the weekly e2e run of 12.10.2026, admin-blog.spec.ts).
 *
 * What is pinned here: every path that writes a card into another language
 * waits for that language's dictionary first, and the blog tab fetches both.
 * Each function is cut out of public/shop2/app.js by source text and run
 * with a dictionary that lands one macrotask AFTER the server's answer —
 * the order a real panel sees on a cold cache.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const appSrc = readFileSync(APP_JS, "utf8").replace(/\r\n?/g, "\n");

function slice(name: string): string {
  const start = appSrc.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = appSrc.indexOf("{", start); i < appSrc.length; i++) {
    if (appSrc[i] === "{") depth++;
    else if (appSrc[i] === "}" && --depth === 0) return appSrc.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

/** uiHas / uiWant / uiWantAll over a lazyFile() whose file lands late. */
const LAZY_UI = `
  var UI = {}, fetched = [];
  var UI_FILES = { ET: "/shop2/ui.et.js", EN: "/shop2/ui.en.js" };
  function lazyFile(path) {
    fetched.push(path);
    return new Promise(function (resolve) {
      setTimeout(function () { UI[/ui\\.et\\./.test(path) ? "ET" : "EN"] = { loaded: true }; resolve(true); }, 0);
    });
  }
  ${slice("uiHas")}
  ${slice("uiWant")}
  ${slice("uiWantAll")}
`;

/** What a card written for L reads like: its words, or the Russian ones. */
const CARD = `function cardWords(L) { return L === "RU" || UI[L] ? "šampoon(" + L + ")" : "шампунь(" + L + ")"; }`;

type Run = { fetched: string[]; out: () => string };

function genTranslate(): Promise<Run> {
  const body = `
    ${LAZY_UI}
    ${CARD}
    function productsById() { return []; }
    function blogCardsOut(html) { return { html: html, cards: ["p"] }; }
    function blogFigsOut(html) { return { html: html, figs: [] }; }
    function blogFigsIn(html) { return html; }
    function blogCardsIn(html, cards, L) { return html + " " + cardWords(L); }
    function blogCleanHtml(html) { return html; }
    function blogTags() { return []; }
    function blogGenErrText() { return "failed"; }
    function txt(s) { return String(s == null ? "" : s).trim(); }
    // the server answers at once — before the dictionary does
    function apiSend() {
      return Promise.resolve({ status: 200, body: { ok: true, text: { title: "Pealkiri", body: "<p>Esimene lõik</p>" } } });
    }
    ${slice("blogGenTranslate")}
    var d = {
      products: [], body: { RU: "<p>Первый абзац</p>", ET: "", EN: "" },
      title: { RU: "Заголовок", ET: "", EN: "" }, excerpt: { RU: "", ET: "", EN: "" },
      seoTitle: { RU: "", ET: "", EN: "" }, seoDesc: { RU: "", ET: "", EN: "" }
    };
    return blogGenTranslate(d, "ET").then(function () {
      return { fetched: fetched, out: function () { return d.body.ET; } };
    });
  `;
  return (new Function(body) as () => Promise<Run>)();
}

function insertProduct(lang: "RU" | "ET" | "EN"): Promise<{ fetched: string[]; inserted: string[] }> {
  const body = `
    ${LAZY_UI}
    ${CARD}
    var inserted = [];
    var S = { adminBlogLang: LANG };
    var BLOG_INSERTED_IN = { RU: "в русский текст", ET: "в эстонский текст", EN: "в английский текст" };
    var NEWS_INSERTED_IN = BLOG_INSERTED_IN;
    function richDraft() { return { body: {}, lang: LANG, kind: "blog" }; }
    function blogProductLinkHTML(id, L) { return '<a data-product="' + id + '">' + cardWords(L) + "</a>"; }
    function blogToolClose() {}
    function blogInsertHtml(html) { inserted.push(html); }
    function toast() {}
    ${slice("blogInsertProduct")}
    blogInsertProduct("system-4-bio-botanical-shampoo");
    return new Promise(function (r) { setTimeout(r, 5); }).then(function () {
      return { fetched: fetched, inserted: inserted };
    });
  `;
  return (new Function("LANG", body) as (l: string) => Promise<{ fetched: string[]; inserted: string[] }>)(lang);
}

describe("a card written into another language waits for that language's words", () => {
  it("«Написать статью целиком»'s translation (blogGenTranslate) writes the Estonian card in Estonian", async () => {
    const run = await genTranslate();
    expect(run.fetched).toContain("/shop2/ui.et.js");
    expect(run.out()).toContain("šampoon(ET)");
    expect(run.out()).not.toContain("шампунь");
  });

  it("«Товар» in the Estonian text inserts an Estonian card, once", async () => {
    const run = await insertProduct("ET");
    expect(run.inserted).toHaveLength(1);
    expect(run.inserted[0]).toContain("šampoon(ET)");
    expect(run.fetched).toEqual(["/shop2/ui.et.js"]);
  });

  it("…and in the Russian text it fetches nothing and inserts at once", async () => {
    const run = await insertProduct("RU");
    expect(run.inserted).toEqual(['<a data-product="system-4-bio-botanical-shampoo">šampoon(RU)</a>&nbsp;']);
    expect(run.fetched).toEqual([]);
  });
});

describe("the wiring the sliced functions cannot show", () => {
  it("«Перевести на ET и EN» waits for both dictionaries before blogCardsIn() writes the cards", () => {
    const from = appSrc.indexOf("if (d.admblogtranslate !== undefined) {");
    const to = appSrc.indexOf("blogCardsIn(blogFigsIn(blogTextToHtml(v)", from);
    expect(from, "app.js: the translate click").toBeGreaterThan(0);
    expect(to, "app.js: the translate click still rebuilds the cards").toBeGreaterThan(from);
    expect(appSrc.slice(from, to)).toContain("uiWantAll()");
  });

  it("the blog tab fetches both dictionaries as soon as it is on screen", () => {
    expect(appSrc).toContain('if (S.screen === "admin" && S.adminTab === "blog") uiWantAll();');
  });
});
