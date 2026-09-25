/**
 * The 1a polish pass (25.09.2026) — what Dim saw on his phone and what the
 * overflow sweep found next to it.
 *
 *   1. «in search the magnifying glass seems a bit off». Two screens' rules
 *      both positioned `.adm-search__i` — one with `transform: translateY(-50%)`,
 *      the other with `margin-top: -8px` — so the glass stood 8 px above the
 *      words; «Клиенты» drew its own glass with a third rule, and «Склад»,
 *      «Салон» and every «найти товар» picker had none. Now there is one
 *      helper (admSearchHTML) and one rule.
 *   2. «The "Главная страница" page seems to be too wide». `.adm-set` keeps
 *      the desktop grid's `align-items: start` when a phone turns it into a
 *      flex column, so the page was as wide as its widest content (427 px on
 *      a 390-px phone) and .adm2's clip cut the rest off.
 *   3. The ET/EN panel's «Каталог» rows kept the Russian type tail
 *      («— шампунь»): the 1a row draws the name in `.adm-grow__t`, which
 *      translateTree()'s NAME_CTX did not list.
 *
 * Source-level checks, like the other 1a suites: the markup is app.js's own,
 * sliced by source text; the layout rules are read from admin.css.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const css = readFileSync(fileURLToPath(new URL("../public/shop2/admin.css", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

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

type Rule = { media: string; selectors: string[]; body: string };
/** Every rule of admin.css with the @media it sits in ("" at the top level). */
function rules(): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Rule[] = [];
  const stack: string[] = [];
  let i = 0;
  let head = "";
  while (i < text.length) {
    const c = text[i];
    if (c === "{") {
      const h = head.trim();
      if (h.startsWith("@")) { stack.push(h); head = ""; i++; continue; }
      const end = text.indexOf("}", i);
      out.push({ media: stack.filter((s) => s.startsWith("@media")).join(" "), selectors: h.split(",").map((s) => s.trim()), body: text.slice(i + 1, end) });
      head = ""; i = end + 1; continue;
    }
    if (c === "}") { stack.pop(); head = ""; i++; continue; }
    head += c; i++;
  }
  return out;
}
const RULES = rules();
const phone = (r: Rule) => /max-width:\s*899px/.test(r.media);

describe("the search box — one helper, one glass, centred", () => {
  it("draws a label: the glass, then the box, with the screen's class", () => {
    const helper = new Function(`${slice("admSearchHTML")}; return admSearchHTML;`)() as (input: string, cls?: string) => string;
    const html = helper('<input class="adm-input" data-x>', "adm-search--list");
    expect(html.startsWith('<label class="adm-search adm-search--list">')).toBe(true);
    expect(html).toMatch(/^<label[^>]*><svg class="adm-search__i" width="16" height="16"[^>]*aria-hidden="true">/);
    expect(html.endsWith('<input class="adm-input" data-x></label>')).toBe(true);
    expect(helper("<input>")).toMatch(/^<label class="adm-search">/);
  });

  /* Every search box of the panel goes through it — the lists, «Салон» and
     each picker that finds a product — and keeps its data-* hook. */
  const HOOKS = [
    "data-admorderq", "data-goodsq", "data-stockq", "data-admcustq", "data-posq",
    "data-bundleq", "data-promoq", "data-heroq", "data-heroimgq", "data-admblogq",
    "data-blogtoolq", 'data-nbf="q"', "data-scanassignq",
  ];
  for (const hook of HOOKS) {
    it(`${hook} sits inside admSearchHTML(…)`, () => {
      // the hook as a whole attribute — `data-stockq`, not `data-stockqty`
      const found = src.search(new RegExp(`<input [^>]*${hook}(?=[\\s=>])`));
      expect(found, `${hook} is no longer drawn`).toBeGreaterThan(0);
      const at = src.indexOf(`<input `, found);
      expect(at, `${hook} is no longer drawn`).toBeGreaterThan(0);
      const before = src.slice(Math.max(0, at - 120), at);
      expect(before, `${hook} is drawn without the shared search label`).toContain("admSearchHTML(");
    });
  }

  /* The box moved one level down, into the label: whatever found its
     neighbours from `t.parentNode` found nothing — «Рассылка»'s picker typed
     and never repainted its list (the e2e newsletter spec caught it). */
  it("the newsletter picker repaints its list from the picker, not from the box's parent", () => {
    const at = src.indexOf("S.newsPick.q = t.value;");
    expect(at).toBeGreaterThan(0);
    const chunk = src.slice(at, src.indexOf("return;", at));
    expect(chunk).toContain('closest("[data-nbpick]")');
    expect(chunk).not.toContain("t.parentNode");
  });

  it("no screen draws a glass of its own any more", () => {
    // the helper is the one place the drawing lives
    const glass = src.match(/<circle cx="11" cy="11" r="(7|6\.5)"/g) || [];
    expect(glass).toHaveLength(1);
    expect(src).not.toContain("ADM_SEARCH_SVG");
  });

  it("admin.css positions the glass once: top 50 % and half its size back up — no second offset", () => {
    // every rule that places the glass (a screen may still hide it: «Салон» under 390 px)
    const glass = RULES.filter((r) => r.selectors.some((s) => /\.adm-search__i\b/.test(s)) && /\b(top|left|margin[\w-]*|transform)\s*:/.test(r.body));
    expect(glass, "one rule for the glass").toHaveLength(1);
    expect(glass[0].media).toBe("");
    expect(glass[0].body).toMatch(/top:\s*50%/);
    expect(glass[0].body).toMatch(/height:\s*16px/);
    expect(glass[0].body).toMatch(/margin-top:\s*-8px/);
    expect(glass[0].body).not.toMatch(/transform/);
    // and the box itself is defined once, with the words clear of the glass
    const box = RULES.filter((r) => r.selectors.includes(".adm-search"));
    expect(box, "one base rule for .adm-search").toHaveLength(1);
    const pad = RULES.find((r) => r.selectors.includes(".adm2 .adm-search > .adm-input"));
    expect(pad?.body).toMatch(/padding-left:\s*40px/);
    // «Клиенты» no longer carries its own glass rule
    expect(RULES.some((r) => r.selectors.some((s) => /\.adm-csearch\s*>\s*svg/.test(s)))).toBe(false);
  });

  it("on a phone «Заказы»' search takes the whole row, not its own content's width", () => {
    const r = RULES.find((x) => phone(x) && x.selectors.includes(".adm-orders__acts .adm-search"));
    expect(r?.body).toMatch(/flex:\s*1 1 auto/);
    // no bare `.adm-search { flex: … }` left for one screen to size another's box with
    expect(RULES.some((x) => x.selectors.includes(".adm-search") && /flex:/.test(x.body))).toBe(false);
  });
});

describe("«Настройки» on a phone is the phone's width", () => {
  it("the single column stretches its pages instead of sizing them to their content", () => {
    const r = RULES.find((x) => phone(x) && x.selectors.includes(".adm-set") && /flex-direction:\s*column/.test(x.body));
    expect(r, "the phone's .adm-set column").toBeTruthy();
    expect(r!.body).toMatch(/align-items:\s*stretch/);
  });
});

describe("a narrow desktop (900–1239 px) — a 1024 laptop, an iPad on its side", () => {
  const narrow = (r: Rule) => /min-width:\s*900px/.test(r.media) && /max-width:\s*12(09|39)px/.test(r.media);
  it("«Настройки» shows one pane at a time: the index, or the open page", () => {
    const set = RULES.find((x) => narrow(x) && x.selectors.includes(".adm-set"));
    expect(set?.body).toMatch(/flex-direction:\s*column/);
    expect(RULES.some((x) => narrow(x) && x.selectors.includes(".adm-set--open .adm-set__col") && /display:\s*none/.test(x.body))).toBe(true);
    expect(RULES.some((x) => narrow(x) && x.selectors.includes(".adm-set:not(.adm-set--open) .adm-set__main") && /display:\s*none/.test(x.body))).toBe(true);
    // the price table waits for a page wide enough for its seven columns
    expect(css).toMatch(/@media \(min-width: 1000px\) \{\n {2}\.adm-rt__head, \.adm-rt__row \{/);
  });
  it("«Каталог» puts the sizes under the name, «Наборы» shows the list or the set", () => {
    const grow = RULES.find((x) => narrow(x) && x.selectors.includes(".adm-grow"));
    expect(grow?.body).toMatch(/"img open st pr vis" "img sz st pr vis"/);
    expect(RULES.some((x) => narrow(x) && x.selectors.includes(".adm-sets--ed .adm-sets__list"))).toBe(true);
  });
  it("«Заказы»' «Открыть первый: <имя>» gives way instead of pushing the search over the title", () => {
    const pin = RULES.find((x) => x.media === "" && x.selectors.includes(".adm-orders__acts .adm-pin") && /flex:/.test(x.body));
    expect(pin?.body).toMatch(/flex:\s*0 1 auto/);
    expect(pin?.body).toMatch(/min-width:\s*0/);
    const span = RULES.find((x) => x.selectors.includes(".adm-pin__btn > span"));
    expect(span?.body).toMatch(/text-overflow:\s*ellipsis/);
  });
});

describe("a phone's field is at least 16 px — iOS zooms the page in on anything smaller", () => {
  it("the panel's inputs, selects and text boxes are 16 px under 900 px", () => {
    const r = RULES.find((x) => phone(x) && x.selectors.includes(".adm2 input") && x.selectors.includes(".adm2 select") && x.selectors.includes(".adm2 textarea"));
    expect(r?.body).toMatch(/font-size:\s*16px/);
  });
});

describe("an ET/EN panel translates the product type in the 1a lists too", () => {
  const ctx = (() => {
    const at = src.indexOf("var NAME_CTX = ");
    const end = src.indexOf(";", at);
    return new Function(`return ${src.slice(at + "var NAME_CTX = ".length, end).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")};`)() as string;
  })();
  it("«Каталог»'s name, «Наборы»' picker and «Что покупают» are name contexts", () => {
    const list = ctx.split(",");
    expect(list).toContain(".adm-grow__t");
    expect(list).toContain(".adm-setpick__nm");
    expect(list).toContain(".adm-share__n");
    // …and they are the classes the rows actually draw the name in
    expect(slice("admCatalogRow")).toContain('<span class="adm-grow__t">\' + esc(p.name)');
    expect(src).toContain('<div class="adm-setpick"><span class="adm-setpick__nm">');
  });
});

describe("«Доставка и оплата»'s price boxes are named in the panel's language", () => {
  /* The panel's own translator with its own tables, lifted by source text
     (tests/admin-chip-labels.test.ts's technique): a rule added to app.js is
     a rule this test sees. */
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
  const tr = new Function("S", "LANG", `
    ${decl("UI")}
    ${decl("UI_RX")}
    ${slice("trName")}
    ${decl("TAIL_EXACT")}
    ${decl("NAME_TAILS")}
    ${decl("NAME_FRAGS")}
    ${slice("trText")}
    return trText(S, LANG, false);
  `) as (s: string, lang: string) => string;

  it("reads «DPD — Эстония», «Курьер — Латвия», «Бесплатно от — Литва» out in Estonian and English", () => {
    expect(tr("DPD — Эстония", "ET")).toBe("DPD — Eesti");
    expect(tr("DPD — Эстония", "EN")).toBe("DPD — Estonia");
    expect(tr("Курьер — Латвия", "EN")).toBe("Courier — Latvia");
    expect(tr("Бесплатно от — Литва", "ET")).toBe("Tasuta alates — Leedu");
    // …and the labels really are built that way
    expect(src).toContain('admRateCellHTML("m:courier:" + key, courier, "Курьер — " + name');
  });
});

describe("chips count in bold on every screen", () => {
  it("«Каталог», «Склад» and its history draw the number as .adm-chip__n", () => {
    expect(slice("admCatalogHTML")).toContain('\'</span> <b class="adm-chip__n">\' + n + "</b></button>"');
    expect(slice("admStockHTML")).toContain('<b class="adm-chip__n">\' + stockFilterCount(x[0])');
    expect(slice("admStockMovesHTML")).toContain('<b class="adm-chip__n">\' + n + "</b>"');
  });
});
