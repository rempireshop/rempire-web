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
    ${block("ADM_MORE")}
    ${block("ADM_TOP_BACK")}
    var ADM_SAVE = { state: "idle" };
    var ADM_ICON = { assistant: "M0", customers: "M1", marketing: "M2", blog: "M3", analytics: "M4", integrations: "M5", settings: "M6" };
    function admIcon(k) { return "<svg data-i=\\"" + k + "\\"></svg>"; }
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
    ${fn("admMoreSheetHTML")}
    ${fn("admGateMarkHTML")}
    ${fn("admGateFootHTML")}
    ${fn("admWaitScreen")}
    ${fn("admLoginScreen")}
    return { back: admTopBackLabel, top: admTopHTML, strip: admStripHTML, line: admMoreLine, more: admMoreSheetHTML,
      login: admLoginScreen, wait: admWaitScreen };
  `)(S, esc, { data: overview }, () => layers, { admin: S.srvAdmin === undefined ? true : S.srvAdmin, err: S.err || "", busy: false }) as {
    back: () => string; top: () => string; strip: () => string; line: (k: string) => [string, boolean, boolean];
    more: () => string; login: (title?: string) => string; wait: (title?: string) => string;
  };
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
      [["section", "order", "more", "confirm"], {}, "Заказы"],
    ];
    for (const [layers, S, label] of cases) {
      const f = frame(S, layers);
      expect(f.back(), layers.join(" → ")).toBe(label);
      expect(f.top()).toContain(`<button class="adm-top__back" type="button" data-admtopback>← <span>${label}</span></button>`);
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
  it("fixed lines while nothing is loaded", () => {
    const f = frame({}, [], null);
    expect(f.line("people")).toEqual(["и отзывы", false, false]);
    expect(f.line("promos")).toEqual(["промокоды · подарочные карты · письма", false, false]);
    expect(f.line("blog")).toEqual(["статьи для покупателей", false, false]);
    expect(f.line("stats")).toEqual(["продажи и посетители", false, false]);
    expect(f.line("apps")).toEqual(["оплата, доставка, почта, Google", false, false]);
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

  it("the sheet: its hooks as before, a rust line where he is wanted, the language and the two ways out — and no «Помощник» row (q12)", () => {
    const html = frame({ section: "blog" }, [], { attention: { proRequests: 1, reviewsPending: 0 } }).more();
    expect(html).toContain('<button class="adm-scrim adm-scrim--phone adm-scrim--more" data-admmoreclose aria-label="Закрыть"></button>');
    expect(html).toContain('role="dialog" aria-modal="true" aria-label="Ещё"');
    for (const key of ["people", "promos", "blog", "stats", "apps", "setup"]) expect(html).toContain(`data-admtab="${key}"`);
    expect(html).toContain('data-admtab="blog" aria-current="true"');
    expect(html).toContain('<span class="adm-row__sub adm-row__sub--warn"><span>1 заявка</span></span>');
    expect(html).not.toContain("data-admai");
    expect(html).not.toContain(">Помощник<");
    expect(html).toContain("<span>Язык панели</span>");
    expect(html).toContain('<div class="adm-langs" role="group"');
    expect(html).toContain('<button class="adm-btn adm-btn--ghost" type="button" data-go="home">Открыть магазин ↗</button>');
    expect(html).toContain("data-admlogout");
  });

  it("the sheet stands on the tab bar, and so does its scrim", () => {
    expect(css).toContain(".adm-scrim--more { bottom: var(--a-barh); }");
    expect(css).toContain(".adm-more { bottom: var(--a-barh);");
  });
});

describe("the new words have their Estonian and English", () => {
  const ui = app.slice(app.indexOf("  var UI = {"), app.indexOf("  var UI_RX = ["));
  for (const key of ["Не надо", "Не сохранилось — проверьте интернет", "Подсказка", "Язык панели", "как русский",
    "статьи для покупателей", "продажи и посетители", "оплата, доставка, почта, Google"]) {
    it(`«${key}»`, () => {
      expect(ui.split(`"${key}":`).length - 1, `«${key}» is not in both dictionaries`).toBe(2);
    });
  }
});
