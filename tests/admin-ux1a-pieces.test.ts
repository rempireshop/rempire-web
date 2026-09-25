/**
 * Direction 1a — the small shared pieces a screen builds with
 * (design_handoff_admin_ux README § 1 and § 3):
 *
 *   admSecHeadHTML / admHelpBtnHTML / admHelpHTML   a section header and its «?»
 *   admFoldHTML                                     an optional part, folded
 *   admLangBarHTML + admLangFallback                RU / ET / EN of a customer text
 *   admPinnedHTML                                   the ONE dark button
 *   admTagHTML                                      a status tag
 *
 * Each is markup; what is tested is the contract a screen relies on — the
 * data-* hook, the ARIA that says open or shut, the state remembered for the
 * session, the words — cut out of public/shop2/app.js and run over stubs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
const esc = (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A sessionStorage good enough for the helpers, or one that throws (Safari private mode). */
function storage(throws = false) {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => { if (throws) throw new Error("denied"); return m.has(k) ? m.get(k)! : null; },
    setItem: (k: string, v: string) => { if (throws) throw new Error("denied"); m.set(k, v); },
    map: m,
  };
}

function pieces(ss = storage()) {
  return new Function("esc", "sessionStorage", `
    ${decl("ADM_HELP_SS")}
    ${fn("admSessRead")}
    ${fn("admSessWrite")}
    ${decl("ADM_HELP")}
    ${fn("admDomId")}
    ${fn("admHelpBtnHTML")}
    ${fn("admHelpHTML")}
    ${fn("admHelpToggle")}
    ${fn("admSecHeadHTML")}
    ${fn("admFoldHTML")}
    ${fn("admFoldToggle")}
    ${fn("admPinnedHTML")}
    ${decl("ADM_TAG_KIND")}
    ${fn("admTagHTML")}
    return { helpBtn: admHelpBtnHTML, help: admHelpHTML, helpToggle: admHelpToggle, sec: admSecHeadHTML,
      fold: admFoldHTML, foldToggle: admFoldToggle, pinned: admPinnedHTML, tag: admTagHTML };
  `)(esc, ss) as {
    helpBtn: (k: string) => string; help: (k: string, t: string) => string; helpToggle: (k: string) => boolean;
    sec: (t: string, k?: string, h?: string, extra?: string) => string;
    fold: (k: string, t: string, s: string, b: string) => string; foldToggle: (k: string) => boolean;
    pinned: (attrs: string, label: string) => string; tag: (kind: string, text: string) => string;
  };
}

describe("«?» — the help behind a section title (README rule 5)", () => {
  it("shut by default: aria-expanded=false, the paragraph hidden, the two tied by aria-controls", () => {
    const p = pieces();
    const btn = p.helpBtn("goods:video");
    expect(btn).toContain('data-admhelp="goods:video"');
    expect(btn).toContain('aria-expanded="false"');
    expect(btn).toContain('aria-controls="admhelp-goods_video"');
    // «?» is drawn, «Подсказка» is what a reader hears
    expect(btn).toContain('<span class="adm-help__c" aria-hidden="true">?</span><span class="vh">Подсказка</span>');
    expect(p.help("goods:video", "Ссылка на YouTube или Instagram.")).toBe(
      '<div class="adm-helpp" id="admhelp-goods_video" hidden>Ссылка на YouTube или Instagram.</div>');
  });

  it("a tap opens it and the session remembers; a second tap shuts it", () => {
    const ss = storage();
    const p = pieces(ss);
    expect(p.helpToggle("goods:video")).toBe(true);
    expect(p.helpBtn("goods:video")).toContain('aria-expanded="true"');
    expect(p.help("goods:video", "x")).not.toContain(" hidden");
    expect(JSON.parse(ss.map.get("rempire-admin-help")!)).toEqual({ "goods:video": 1 });
    // a reload of the panel in the same session: still open
    expect(pieces(ss).helpBtn("goods:video")).toContain('aria-expanded="true"');
    expect(p.helpToggle("goods:video")).toBe(false);
    expect(JSON.parse(ss.map.get("rempire-admin-help")!)).toEqual({});
  });

  it("a browser that refuses sessionStorage still toggles (for this page)", () => {
    const p = pieces(storage(true));
    expect(p.helpToggle("k")).toBe(true);
    expect(p.helpBtn("k")).toContain('aria-expanded="true"');
  });

  it("the section header: 12-px capitals over an ink rule, «?» at its right, the paragraph under the rule", () => {
    const p = pieces();
    const html = p.sec("Видео", "goods:video", "Ссылка на YouTube или Instagram.");
    expect(html).toMatch(/^<div class="adm-sech"><h2 class="adm-sech__t">Видео<\/h2><button class="adm-help"/);
    expect(html).toMatch(/<\/div><div class="adm-helpp" id="admhelp-goods_video" hidden>/);
    expect(p.sec("Состав")).toBe('<div class="adm-sech"><h2 class="adm-sech__t">Состав</h2></div>');
  });
});

describe("admFoldHTML — an optional part, folded", () => {
  it("a button with the title, the one-line summary and a chevron; the body hidden until opened", () => {
    const p = pieces();
    const html = p.fold("setup:delivery:eu", "Страны Европы", "12 включено", "<p>…</p>");
    expect(html).toContain('<button class="adm-foldrow__h" type="button" data-admfold="setup:delivery:eu" aria-expanded="false" aria-controls="admfold-setup_delivery_eu">');
    expect(html).toContain('<span class="adm-foldrow__t">Страны Европы</span><span class="adm-foldrow__s">12 включено</span>');
    expect(html).toContain('<div class="adm-foldrow__b" id="admfold-setup_delivery_eu" hidden><p>…</p></div>');
  });

  it("opening it is remembered for the session, per key", () => {
    const ss = storage();
    const p = pieces(ss);
    expect(p.foldToggle("a")).toBe(true);
    const html = p.fold("a", "A", "", "body");
    expect(html).toContain('class="adm-foldrow is-open"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain(" hidden>");
    expect(p.fold("b", "B", "", "body"), "one key opened another").toContain('aria-expanded="false"');
    expect(JSON.parse(ss.map.get("rempire-admin-folds")!)).toEqual({ a: 1 });
  });

  it("no summary, no empty span", () => {
    expect(pieces().fold("a", "A", "", "b")).not.toContain("adm-foldrow__s");
  });

  it("leaves the panel's existing <details class=\"adm-fold\"> folds exactly as they were", () => {
    /* The first cut named this row `.adm-fold` and drew a rule over the
       blog's «Адрес, автор и текст для Google», «Только часть», the delivery
       preview and the promo extras — every <details> the panel already had. */
    const css = readFileSync(fileURLToPath(new URL("../public/shop2/admin.css", import.meta.url)), "utf8").replace(/\r\n?/g, "\n");
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/^\.adm-fold[ .{[>:]/gm) ?? [];
    expect(rules, "a new rule for .adm-fold").toHaveLength(5);
    expect(fn("admFoldHTML")).not.toMatch(/class="adm-fold[" ]/);
  });
});

describe("admPinnedHTML — the ONE dark button (README rule 2)", () => {
  it("one ink button in the pin slot, carrying the screen's own hook", () => {
    expect(pieces().pinned('data-admlabel="R-1"', "Создать этикетку")).toBe(
      '<div class="adm-pin"><button class="adm-btn adm-pin__btn" type="button" data-admlabel="R-1">Создать этикетку</button></div>');
  });
  it("renderImpl tells the CSS a pin is on screen (body.adm-pinned)", () => {
    expect(fn("renderImpl")).toContain('document.body.classList.toggle("adm-pinned", S.screen === "admin" && !!bodySlot.querySelector(".adm-pin"));');
  });
});

describe("admTagHTML — a status tag (README § 3)", () => {
  it("green = ok, rust outline = low, rust fill = alert, ink fill = next — the words are the caller's", () => {
    const p = pieces();
    expect(p.tag("ok", "Доставлен")).toBe('<span class="adm-badge adm-tag adm-badge--ok">Доставлен</span>');
    expect(p.tag("low", "мало")).toBe('<span class="adm-badge adm-tag adm-badge--warn">мало</span>');
    expect(p.tag("alert", "нет")).toBe('<span class="adm-badge adm-tag adm-badge--warnfill">нет</span>');
    expect(p.tag("next", "Отправить")).toBe('<span class="adm-badge adm-tag adm-badge--ink">Отправить</span>');
    expect(p.tag("plain", "Оплачен")).toBe('<span class="adm-badge adm-tag">Оплачен</span>');
    expect(p.tag("quiet", "Черновик")).toBe('<span class="adm-badge adm-tag adm-badge--quiet">Черновик</span>');
  });
});

describe("RU / ET / EN of a text the customer reads (README § 1)", () => {
  const fallback = new Function(`${fn("admLangFallback")}; return admLangFallback;`)() as (c: string, t: unknown, ru: unknown) => string[];

  it("«есть текст» / «как русский» / «пусто»: an empty ET or EN is shown in Russian", () => {
    expect(fallback("RU", "Шампунь", "Шампунь")).toEqual(["есть текст"]);
    expect(fallback("RU", " ", "")).toEqual(["пусто"]);
    expect(fallback("ET", "", "Шампунь")).toEqual(["как русский"]);
    expect(fallback("EN", "Shampoo", "Шампунь")).toEqual(["есть текст"]);
    expect(fallback("et", "Шампунь ", "Шампунь"), "a copy of the Russian is the Russian").toEqual(["как русский"]);
    expect(fallback("EN", "", ""), "nothing in any language").toEqual(["пусто"]);
    expect(fallback("EN", null, undefined)).toEqual(["пусто"]);
  });

  const bar = new Function("esc", `${fn("admLangStateHTML")}; ${fn("admLangBarHTML")}; return admLangBarHTML;`)(esc) as (
    attr: string, items: string[][], cur: string, label: string, stateOf?: (c: string) => string[], note?: string, opts?: { translate?: string },
  ) => string;
  const ITEMS = [["RU", "Русский"], ["ET", "Eesti"], ["EN", "English"]];

  it("every existing caller draws exactly what it did (six arguments, no slot)", () => {
    const html = bar("data-herolang", ITEMS, "ET", "Язык текста", (c) => fallback(c, c === "RU" ? "Скидки" : "", "Скидки"), "Это язык текста, а не язык панели — у каждого языка свой текст.");
    expect(html).toContain('<button data-herolang="ET" aria-current="true">');
    expect(html).toContain('<span class="adm-seg__slot" data-langst="ET"><span class="adm-seg__st"><span>как русский</span></span></span>');
    expect(html).not.toContain("adm-langbar__tr");
  });

  it("…and «Перевести с русского» goes under the tabs when a caller hands its button in", () => {
    const tr = '<button class="adm-btn adm-btn--ghost adm-btn--row" data-admtranslate>Перевести с русского</button>';
    const html = bar("data-eddesclang", ITEMS, "EN", "Язык описания", undefined, "", { translate: tr });
    const tabs = html.indexOf('class="adm-seg adm-seg--lang"'), slot = html.indexOf('<div class="adm-langbar__tr">');
    expect(slot).toBeGreaterThan(tabs);
    expect(html).toContain(`<div class="adm-langbar__tr">${tr}</div>`);
  });
});

describe("the look the handoff fixed (admin.css § 3)", () => {
  const css = readFileSync(fileURLToPath(new URL("../public/shop2/admin.css", import.meta.url)), "utf8").replace(/\r\n?/g, "\n");
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));

  it("the palette: ink, paper, panel, canvas, rust, green — and the old names mapped onto it", () => {
    for (const [name, value] of [
      ["--a-ink", "#1c1a00"], ["--a-paper", "#fdfcf9"], ["--a-panel", "#f4f2ec"], ["--a-canvas", "#e6e3da"],
      ["--a-rust", "#8b4a2b"], ["--a-green", "#2f5b45"],
      ["--a-warn", "var(--a-rust)"], ["--a-ok", "var(--a-green)"], ["--a-tint", "var(--a-panel)"],
    ]) expect(root, name).toMatch(new RegExp(`${name}: ${value.replace(/[()]/g, "\\$&")};`));
  });

  it("titles in Oswald 600 at 34 px (30 on a phone); money in Oswald 600", () => {
    expect(css).toContain("font-family: Oswald, sans-serif; font-weight: 600; font-size: 34px;");
    expect(css).toMatch(/@media \(max-width: 899px\) \{[\s\S]*?\.adm-h1 \{ font-size: 30px;/);
    expect(css).toMatch(/\.adm-row__amt \{ font-family: Oswald, sans-serif; font-weight: 600;/);
  });

  it("the switch is square, 52 × 30, ink when on — and still says «Вкл» / «Выкл»", () => {
    expect(css).toMatch(/\.adm-sw__t \{\n\s*width: 52px; height: 30px;/);
    expect(css).toMatch(/\[role="switch"\]\[aria-checked="true"\] \.adm-sw__t \{ background: var\(--a-ink\); \}/);
    expect(fn("admSwitchFace")).toContain('(on ? "Вкл" : "Выкл")');
  });

  it("segmented controls wear a 1-px ink frame", () => {
    expect(css).toContain(".adm-seg { display: flex; border: 1px solid var(--a-ink); width: fit-content; max-width: 100%; }");
  });

  it("the «?» is the one round control; it is a thumb's size on a phone", () => {
    expect(css).toContain("border-radius: 50%; border: 1px solid var(--a-edge);");
    expect(css).toContain("@media (max-width: 899px) { .adm-help { width: 44px; height: 44px;");
    expect(css.match(/border-radius: (?!0)[^;]+;/g), "something else went round").toEqual(["border-radius: 50%;"]);
  });

  it("codes stay in PT Mono (Dim, 25.09.2026, q42)", () => {
    expect(css).toContain('"PT Mono"');
    expect(css).not.toContain("JetBrains");
  });
});
