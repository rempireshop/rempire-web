/**
 * Direction 1a, README § 4 — the frame around every screen.
 *
 *   · the thin site bar above the panel (the checkout's own header reused:
 *     logo · «Админка» · RU ET EN · «← В магазин») is gone from the panel —
 *     the checkout keeps it;
 *   · a phone has the panel's own top bar: «← back» inside a card — the same
 *     step the phone's Back takes — or the wordmark, the save status, the
 *     assistant's icon (Dim, 25.09.2026, q10: the wordmark does nothing);
 *   · the desktop's assistant, folded, is a docked strip — no floating button
 *     anywhere;
 *   · «Ещё» carries one line per section from what is already loaded, and no
 *     «Помощник» row (q12); the Блог and Подключения counts ride on
 *     GET /api/admin/overview (q13);
 *   · …and «Ещё» is a PAGE, not a bottom sheet (screen 14; Dim: follow the new
 *     UX): the tab bar under it with «Ещё» alone lit, the wordmark in the top
 *     bar, the screen it was opened over hidden rather than thrown away;
 *   · the confirm's «Не надо» is «Cancel» in English, and only the save
 *     status's error is announced (role="alert");
 *   · the sign-in card keeps its password and gains the language and the way
 *     back to the shop under it (q11).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const app = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(/\r\n?/g, "\n");
const css = readFileSync(fileURLToPath(new URL("../public/shop2/admin.css", import.meta.url)), "utf8").replace(/\r\n?/g, "\n");

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
/** `var NAME = [ … ];` / `{ … }` over several lines, brace-matched. */
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
const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type St = Record<string, unknown>;
function frame(S: St, layers: string[], overview: unknown = null) {
  if (!S.lang) S.lang = "RU";
  return new Function("S", "esc", "OVERVIEW", "admLayers", "SRV", `
    ${block("ADM_SECTIONS")}
    ${block("ADM_MORE")}
    ${block("ADM_TOP_BACK")}
    var ADM_SAVE = { state: "idle" };
    var ADM_ICON = { assistant: "M0", customers: "M1", marketing: "M2", blog: "M3", analytics: "M4", integrations: "M5", settings: "M6" };
    function admIcon(k, on) { return "<svg data-i=\\"" + k + "\\"" + (on ? " data-on" : "") + "></svg>"; }
    function admSection() { return S.section || "over"; }
    function admSaveStatusHTML() { return ""; }
    function pl(n, one, few, many) { var a = n % 10, b = n % 100; if (a === 1 && b !== 11) return one; if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few; return many; }
    function eur(n) { return String(n).replace(".", ",") + " €"; }
    function admPiecesHTML(line) { return String(line).split(" · ").map(function (p) { return "<span>" + esc(p) + "</span>"; }).join(" · "); }
    function LANGS_() {}
    var LANGS = [["RU"], ["ET"], ["EN"]];
    ${fn("admLangsHTML")}
    ${fn("admLogoutHTML")}
    ${fn("admSaveSlotHTML")}
    ${fn("admTopBackLabel")}
    ${fn("admTopHTML")}
    ${fn("admStripHTML")}
    ${fn("admMoreLine")}
    ${fn("admMorePageHTML")}
    ${fn("admBarHTML")}
    ${fn("admGateMarkHTML")}
    ${fn("admGateFootHTML")}
    ${fn("admWaitScreen")}
    ${fn("admLoginScreen")}
    return { back: admTopBackLabel, top: admTopHTML, strip: admStripHTML, line: admMoreLine, more: admMorePageHTML,
      bar: admBarHTML, login: admLoginScreen, wait: admWaitScreen };
  `)(S, esc, { data: overview }, () => layers, { admin: S.srvAdmin === undefined ? true : S.srvAdmin, err: S.err || "", busy: false }) as {
    back: () => string; top: () => string; strip: () => string; line: (k: string) => [string, boolean, boolean];
    more: () => string; bar: (waiting?: number) => string; login: (title?: string) => string; wait: (title?: string) => string;
  };
}
/** The CSS inside one `@media (…) { … }` block, every block with that query. */
function media(query: string): string {
  const out: string[] = [];
  for (let at = css.indexOf(`@media ${query} {`); at >= 0; at = css.indexOf(`@media ${query} {`, at + 1)) {
    let depth = 0;
    for (let i = css.indexOf("{", at); i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) { out.push(css.slice(at, i + 1)); break; }
    }
  }
  return out.join("\n");
}

describe("the phone's top bar", () => {
  it("at a section's front door: the wordmark, which does nothing (q10)", () => {
    const html = frame({}, ["section"]).top();
    expect(html).toContain('<span class="adm-top__mark">REMPIRE</span>');
    expect(html).not.toContain("data-admtopback");
    expect(html, "the wordmark became a control").not.toMatch(/<(button|a)[^>]*>REMPIRE/);
  });

  it("inside a card: «← …» in the words the card's own back link uses — the top card, whatever is stacked over it", () => {
    const cases: Array<[string[], St, string]> = [
      [["section", "order"], {}, "Заказы"],
      [["section", "order"], { admCustOpen: "c1" }, "К клиенту"],
      [["edit"], {}, "Товары"],
      [["section", "customer"], {}, "Все клиенты"],
      [["section", "mail"], {}, "Все письма"],
      [["section", "setpage"], {}, "Настройки"],
      [["section", "blog"], {}, "Блог"],
      [["section", "news"], {}, "Рассылка"],
      [["section", "moves"], {}, "Склад"],
      [["section", "order", "confirm"], {}, "Заказы"],
      [["section", "order", "asst"], {}, "Заказы"],
    ];
    for (const [layers, S, label] of cases) {
      const f = frame(S, layers);
      expect(f.back(), layers.join(" → ")).toBe(label);
      expect(f.top()).toContain(`<button class="adm-top__back" type="button" data-admtopback>← <span>${label}</span></button>`);
    }
  });

  it("on the «Ещё» page: the wordmark, whatever card the page was opened over (screen 14)", () => {
    for (const layers of [["more"], ["section", "more"], ["section", "order", "more"], ["edit", "more", "confirm"], ["section", "customer", "more", "asst"]]) {
      const f = frame({}, layers);
      expect(f.back(), layers.join(" → ")).toBe("");
      expect(f.top(), layers.join(" → ")).toContain('<span class="adm-top__mark">REMPIRE</span>');
      expect(f.top()).not.toContain("data-admtopback");
    }
  });

  it("the save status and the assistant's icon; the icon says whether the assistant is open", () => {
    const shut = frame({ admAi: false }, []).top();
    expect(shut).toContain('<span class="adm-savest adm-savest--top" data-admsavest data-st="idle">');
    expect(shut).toContain('<button class="adm-top__ai adm-aiopen" type="button" data-admai aria-expanded="false" title="Помощник" aria-label="Помощник">');
    expect(frame({ admAi: true }, []).top()).toContain('data-admai aria-expanded="true"');
  });

  it("«←» is the phone's own Back: the same admCloseTop(), then a render", () => {
    expect(app).toContain("if (d.admtopback !== undefined) { if (admCloseTop()) render(); return; }");
  });
});

describe("the assistant, folded, is docked — nothing floats over the work", () => {
  it("a desktop strip that opens it; no floating button left in the panel", () => {
    const strip = frame({}, []).strip();
    expect(strip).toMatch(/^<button class="adm-strip adm-aiopen" type="button" data-admai aria-expanded="false" title="Открыть помощника">/);
    expect(strip).toContain('<span class="adm-strip__l">Помощник</span>');
    expect(app).not.toContain("admFabHTML");
    expect(app).not.toContain('class="adm-fab"');
    expect(css.replace(/\/\*[\s\S]*?\*\//g, ""), "a rule for the old button is left").not.toContain(".adm-fab");
    expect(fn("screenAdmin")).toContain("(S.admAi ? admAsstHTML() : admStripHTML())");
  });

  it("the work column leaves the strip's width free, or the pane's", () => {
    expect(css).toMatch(/@media \(min-width: 900px\) \{\n\s*\.adm-main \{ padding-right: var\(--a-strip\); \}\n\s*\.adm2--asst \.adm-main \{ padding-right: var\(--a-asst\); \}/);
    expect(css).toMatch(/--a-strip: 52px;/);
  });
});

describe("no site bar above the panel", () => {
  it("screenAdmin, the wait card and the sign-in card draw no .cohdr; the checkout keeps its own", () => {
    expect(fn("screenAdmin")).not.toContain("admHeader");
    expect(app).not.toContain("function admHeader(");
    expect(app, "the panel still builds the checkout header").not.toContain("cohdr cohdr--adm");
    const f = frame({}, []);
    expect(f.wait()).not.toContain("cohdr");
    expect(f.login()).not.toContain("cohdr");
    // the checkout's header is untouched
    expect(app).toContain('<div class="cohdr"><div class="wrap wrap--co">');
  });

  it("the panel's CSS no longer measures itself against the shop's header", () => {
    expect(css).not.toContain("--cohdrh");
    expect(fn("renderImpl")).not.toContain("--cohdrh");
    expect(fn("admScrollUnderHeader")).toContain('document.querySelector(".adm-top")');
  });

  it("the phone bar gives way to a save bar while one is the phone's header (≤ 767)", () => {
    expect(css).toMatch(/@media \(max-width: 767px\) \{[\s\S]*?body\.adm-saving \.adm-top \{ display: none; \}/);
    expect(css).toMatch(/\.adm-top \{ display: none; \}\n@media \(max-width: 899px\) \{\n\s*\.adm-top \{\n\s*display: flex;/);
  });
});

describe("the sign-in card (q11)", () => {
  it("the same password, the same hooks; under the card the language and «Открыть магазин ↗»", () => {
    const html = frame({ srvAdmin: false }, []).login();
    expect(html).toContain('data-admpw autocomplete="current-password"');
    expect(html).toContain("data-admlogin");
    expect(html).toContain('<div class="adm-gate__mark">REMPIRE</div>');
    const foot = html.slice(html.indexOf('<div class="adm-gate__foot">'));
    expect(foot).toContain('<button data-lang="RU" aria-current="true">RU</button>');
    expect(foot).toContain('<button data-lang="ET"');
    expect(foot).toContain('<button class="adm-link" type="button" data-go="home">Открыть магазин ↗</button>');
    expect(html.indexOf("adm-gate__foot"), "the foot is above the button").toBeGreaterThan(html.indexOf("data-admlogin"));
  });
  it("the scanner's door still says whose it is", () => {
    expect(frame({ srvAdmin: false }, []).login("Сканер")).toContain('<div class="adm-gate__mark">REMPIRE <span>Сканер</span></div>');
  });
});

describe("«Ещё» — one line per section (1a, screen 14)", () => {
  it("fixed lines while nothing is loaded — the design's words", () => {
    const f = frame({}, [], null);
    expect(f.line("people")).toEqual(["и отзывы", false, false]);
    expect(f.line("promos")).toEqual(["промокоды, карты, письма", false, false]);
    expect(f.line("blog")).toEqual(["статьи для покупателей", false, false]);
    expect(f.line("stats")).toEqual(["продажи и посетители", false, false]);
    expect(f.line("apps")).toEqual(["оплата, доставка, почта, Google", false, false]);
    expect(f.line("setup")).toEqual(["доставка, главная, компания", false, false]);
  });

  it("Russian plurals in every live line: 1 · 2–4 · 5+ · 11–14 · 21", () => {
    const cases: Array<[number, string, string, string, string]> = [
      [1, "1 заявка", "1 отзыв", "1 статья", "1 требует внимания"],
      [2, "2 заявки", "2 отзыва", "2 статьи", "2 требуют внимания"],
      [5, "5 заявок", "5 отзывов", "5 статей", "5 требуют внимания"],
      [11, "11 заявок", "11 отзывов", "11 статей", "11 требуют внимания"],
      [21, "21 заявка", "21 отзыв", "21 статья", "21 требует внимания"],
    ];
    for (const [n, req, rev, post, apps] of cases) {
      expect(frame({}, [], { attention: { proRequests: n } }).line("people")[0]).toBe(req);
      expect(frame({}, [], { attention: { reviewsPending: n } }).line("people")[0]).toBe(rev);
      expect(frame({}, [], { blog: { published: n, drafts: 0 } }).line("blog")[0]).toBe(post);
      expect(frame({}, [], { integrations: { problems: n } }).line("apps")[0]).toBe(apps);
    }
  });

  it("live lines from the «Обзор» summary already in hand — nothing is fetched for them", () => {
    const f = frame({}, [], {
      attention: { proRequests: 1, reviewsPending: 2 },
      revenue7d: { total: 190.91 },
      blog: { published: 3, drafts: 1 },
      integrations: { problems: 3 },
    });
    expect(f.line("people")).toEqual(["1 заявка · 2 отзыва", true, true]);
    expect(f.line("stats")).toEqual(["190,91 € за 7 дней", false, true]);
    expect(f.line("blog")).toEqual(["3 статьи · 1 черновик", false, true]);
    expect(f.line("apps")).toEqual(["3 требуют внимания", true, true]);
    expect(frame({}, [], { integrations: { problems: 1 } }).line("apps")).toEqual(["1 требует внимания", true, true]);
    // nothing waiting: the fixed line, not «0 заявок»
    expect(frame({}, [], { attention: { proRequests: 0, reviewsPending: 0 }, integrations: { problems: 0 } }).line("people"))
      .toEqual(["и отзывы", false, false]);
    expect(frame({}, [], { integrations: null }).line("apps")[0]).toBe("оплата, доставка, почта, Google");
  });

  it("a page, not a sheet: its title with the rule, no scrim, no dialog, no grab handle", () => {
    const html = frame({ section: "blog" }, []).more();
    expect(html).toMatch(/^<section class="adm-more" aria-labelledby="adm-more-t"><h1 class="adm-more__t" id="adm-more-t" tabindex="-1">Ещё<\/h1><div class="adm-more__list">/);
    expect(html).not.toContain("adm-scrim");
    expect(html).not.toContain("adm-sheet");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("aria-modal");
    // closing is a row or Back — the page draws no close control of its own
    expect(html).not.toContain("data-admmoreclose");
    expect(css).toMatch(/\.adm-more__list \{ border-top: 1px solid var\(--a-ink\); margin-top: 16px; \}/);
  });

  it("its rows: icon · name · one line · chevron, the section it was opened over marked, a rust line where he is wanted", () => {
    const html = frame({ section: "blog" }, [], { attention: { proRequests: 1, reviewsPending: 1 }, integrations: { problems: 3 } }).more();
    const rows = html.match(/<button class="adm-more__row"[\s\S]*?<\/button>/g) || [];
    expect(rows.map((r) => /data-admtab="(\w+)"/.exec(r)![1])).toEqual(["people", "promos", "blog", "stats", "apps", "setup"]);
    for (const r of rows) {
      expect(r).toMatch(/^<button class="adm-more__row" type="button" data-admtab="\w+" aria-current="(true|false)" title="[^"]+"><svg data-i="\w+"><\/svg><span class="adm-more__txt"><span class="adm-row__nm">[^<]+<\/span><span class="adm-row__sub[^"]*">/);
      expect(r).toMatch(/<svg class="adm-more__chev" width="14" height="14" viewBox="0 0 24 24"[^>]*aria-hidden="true"><path d="M9 6l6 6-6 6"><\/path><\/svg><\/button>$/);
    }
    expect(html).toContain('data-admtab="blog" aria-current="true"');
    expect(rows.filter((r) => r.includes('aria-current="true"'))).toHaveLength(1);
    // «1 заявка · 1 отзыв» and «3 требуют внимания» in rust; the rest quiet
    expect(rows[0]).toContain('<span class="adm-row__sub adm-row__sub--warn"><span>1 заявка</span> · <span>1 отзыв</span></span>');
    expect(rows[4]).toContain('<span class="adm-row__sub adm-row__sub--warn"><span>3 требуют внимания</span></span>');
    expect(rows[1]).toContain('<span class="adm-row__sub">промокоды, карты, письма</span>');
    expect(rows[5]).toContain('<span class="adm-row__sub">доставка, главная, компания</span>');
    // …and nothing waiting is the quiet line, not rust
    const calm = frame({}, [], { attention: { proRequests: 0, reviewsPending: 0 }, integrations: { problems: 0 } }).more();
    expect(calm).not.toContain("adm-row__sub--warn");
    expect(calm).toContain('<span class="adm-row__sub">и отзывы</span>');
    expect(calm).toContain('<span class="adm-row__sub">оплата, доставка, почта, Google</span>');
  });

  it("rust is the panel's warn token, and a line is never cut — it wraps", () => {
    expect(css).toMatch(/\.adm-row__sub--warn \{ color: var\(--a-warn\); \}/);
    expect(css).toMatch(/--a-warn: var\(--a-rust\);/);
    const rules = css.slice(css.indexOf("/* «Ещё» on a phone (1a, screen 14) is a page"), css.indexOf("/* The assistant is a bottom sheet only"));
    expect(rules, "the «Ещё» rules moved").not.toBe("");
    expect(rules).not.toMatch(/ellipsis|nowrap/);
    expect(rules).toMatch(/\.adm-more \.adm-row__nm \{[^}]*white-space: normal;[^}]*overflow: visible;/);
  });

  it("then the panel's language and the two ways out — and no «Помощник» row (q12)", () => {
    const html = frame({ section: "blog" }, []).more();
    const foot = html.slice(html.indexOf('<div class="adm-more__foot">'));
    expect(foot).toContain('<div class="adm-more__lang"><span>Язык панели</span><div class="adm-langs" role="group"');
    expect(foot).toContain('<button data-lang="RU" aria-current="true">RU</button>');
    expect(foot).toContain('<button class="adm-btn adm-btn--ghost" type="button" data-go="home">Открыть магазин ↗</button>');
    expect(foot).toContain("data-admlogout");
    expect(html.indexOf("adm-more__foot"), "the foot is under the list").toBeGreaterThan(html.lastIndexOf("adm-more__row"));
    expect(html).not.toContain("data-admai");
    expect(html).not.toContain(">Помощник<");
  });

  it("the tab bar under it: «Ещё» alone is lit while the page is open, the section it was opened over is not", () => {
    const open = frame({ section: "orders", admMore: true }, []).bar(2);
    expect(open).toContain('data-admtab="orders" aria-current="false"');
    expect(open).toContain('<button class="adm-bar__i" data-admmore aria-current="true" title="Ещё">');
    expect(open.match(/aria-current="true"/g)).toHaveLength(1);
    expect(open, "the orders badge went with the lit state").toContain('<span class="adm-bar__b">2</span>');
    const shut = frame({ section: "orders", admMore: false }, []).bar(0);
    expect(shut).toContain('data-admtab="orders" aria-current="true"');
    expect(shut).toContain('data-admmore aria-current="false"');
    // one of the six sections behind «Ещё» is open: «Ещё» stays lit, as before
    expect(frame({ section: "stats", admMore: false }, []).bar(0)).toContain('data-admmore aria-current="true"');
  });

  it("drawn beside the screen, which is hidden — not replaced — while the page is up", () => {
    const shell = fn("screenAdmin");
    expect(shell).not.toContain("admMoreSheetHTML");
    expect(shell).toContain('(S.admMore ? " adm2--more" : "")');
    expect(shell).toContain('body + "</div>" +\n            (S.admMore ? admMorePageHTML() : "") + "</div>"');
    const phone = media("(max-width: 899px)");
    expect(phone).toContain(".adm2--more .adm-page { display: none; }");
    expect(phone).toMatch(/\.adm-more \{ display: block; padding: 20px 16px calc\(var\(--a-barh\) \+ 28px\);/);
    // …over a form whose save bar is the phone's header, the page keeps the top bar
    expect(phone).toContain("body.adm-saving .adm2--more .adm-top { display: flex; }");
    // a desktop has the sidebar: a page left open by a window that grew stays out of the way
    expect(css).toContain(".adm-more { display: none; }");
    expect(media("(min-width: 900px)")).not.toContain("adm-more");
  });

  it("opens at its title, and Back hands the screen under it back where it was left", () => {
    expect(app).toContain('if (!S.admMore) S.admMoreY = window.scrollY || 0;\n      // a new page: a screen reader starts reading at its title\n      S.admMore = true; render(); refocus("#adm-more-t"); return;');
    expect(fn("renderImpl")).toContain("admMoreScroll();");
    expect(app).not.toContain(".adm-sheet--phone\")) S.admMore");
  });
});

describe("admMoreScroll — the page opens at its top, Back lands where the screen was", () => {
  function run() {
    const calls: number[] = [];
    const S: St = { admMore: false, admMoreY: 0, tab: "orders", layers: [] as string[] };
    expect(app).toContain('  var admMoreOver = "";');
    const f = new Function("S", "window", `
      function admViewKey() { return S.tab; }
      function admLayers() { return S.layers.concat(S.admMore ? ["more"] : []); }
      var admMoreOver = "";
      ${fn("admMoreScroll")}
      return admMoreScroll;
    `)(S, { scrollTo: (_x: number, y: number) => calls.push(y) }) as () => void;
    return { S, calls, paint: f };
  }
  it("opened: to the top once, however many renders land while it is up", () => {
    const r = run();
    r.S.admMoreY = 900; r.S.admMore = true;
    r.paint(); r.paint(); r.paint();
    expect(r.calls).toEqual([0]);
  });
  it("Back onto the same screen: where it was", () => {
    const r = run();
    r.S.admMoreY = 900; r.S.admMore = true; r.paint();
    r.S.admMore = false; r.paint(); r.paint();
    expect(r.calls).toEqual([0, 900]);
  });
  it("a row into another section, or a card closed meanwhile: left at the top admGoTab put it", () => {
    const r = run();
    r.S.admMoreY = 900; r.S.admMore = true; r.paint();
    r.S.tab = "people"; r.S.admMore = false; r.paint();
    expect(r.calls).toEqual([0]);
    const q = run();
    q.S.layers = ["section", "order"]; q.S.admMoreY = 400; q.S.admMore = true; q.paint();
    q.S.layers = ["section"]; q.S.admMore = false; q.paint();
    expect(q.calls).toEqual([0]);
  });
});

describe("the new words have their Estonian and English", () => {
  const ui = app.slice(app.indexOf("  var UI = {"), app.indexOf("  var UI_RX = ["));
  for (const key of ["Не надо", "Не сохранилось — проверьте интернет", "Подсказка", "Язык панели", "как русский",
    "статьи для покупателей", "продажи и посетители", "оплата, доставка, почта, Google",
    "промокоды, карты, письма", "доставка, главная, компания", "и отзывы", "Ещё"]) {
    it(`«${key}»`, () => {
      expect(ui.split(`"${key}":`).length - 1, `«${key}» is not in both dictionaries`).toBe(2);
    });
  }
  it("the confirm's «Не надо»: «Loobu» in Estonian, «Cancel» in English", () => {
    const et = ui.slice(0, ui.indexOf("    EN: {"));
    const en = ui.slice(ui.indexOf("    EN: {"));
    expect(et).toContain('"Не надо": "Loobu",');
    expect(en).toContain('"Не надо": "Cancel",');
    expect(ui).not.toContain('"Не надо": "Don\'t"');
  });
  it("the design's two new lines, in both languages", () => {
    expect(ui).toContain('"промокоды, карты, письма": "sooduskoodid, kaardid, kirjad",');
    expect(ui).toContain('"промокоды, карты, письма": "promo codes, cards, e-mails",');
    expect(ui).toContain('"доставка, главная, компания": "tarne, avaleht, ettevõte",');
    expect(ui).toContain('"доставка, главная, компания": "delivery, home page, company",');
  });
});
