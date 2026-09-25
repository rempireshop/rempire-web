/**
 * The assistant's OFFLINE answer to «Что заканчивается и что дозаказать?» —
 * one product a line, each name in the panel's language.
 *
 * When the assistant itself is off (no key on the server — probeAdmAI), the
 * panel answers from adminAnswer() in public/shop2/app.js. For this question
 * it glued three product names into one sentence, one text node:
 *   «Заканчиваются 5 товаров. Срочно: Kevin.Murphy Repair.Me.Wash — шампунь,
 *    Rempire Beard balm — бальзам для бороды, … . Могу собрать заказ …»
 * so (a) the names ran together — the owner's /test note of 23.09.2026 on the
 * online answer, «it's just a list of words» — and (b) on an ET/EN panel the
 * dictionary's rule translated the sentence around them and left every
 * Russian tail («— шампунь») inside: translateTree() only translates a name's
 * tail at the END of a node (tests/admin-product-names-i18n.test.ts).
 *
 * Now each name goes through admProdName() and the list is drawn the way the
 * online answer's is (admReplyHTML: «name — state», one item a line, «нет»
 * marked) — as the panel's own words, so the dictionary still translates the
 * sentences and the states around the names.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

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
function sliceLiteral(marker: string, terminator: string): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${marker}`);
  const end = src.indexOf(terminator, at);
  return src.slice(at + marker.length, end + terminator.length).replace(/;\s*$/, "");
}

type Lang = "RU" | "ET" | "EN";
const CYR = /[А-Яа-яЁё]/;

const I18N = `
  var UI = ${sliceLiteral("var UI = ", "\n  };")};
  var UI_RX = ${sliceLiteral("var UI_RX = ", "\n  ];")};
  var NAME_TAILS = ${sliceLiteral("var NAME_TAILS = ", "\n  };")};
  var NAME_FRAGS = ${sliceLiteral("var NAME_FRAGS = ", "\n  ];")};
  var TAIL_EXACT = ${sliceLiteral("var TAIL_EXACT = ", "\n  };")};
  ${slice("trName")}
  ${slice("trText")}
`;

type Product = { id: string; brand: string; name: string; stock: string };
const LOW: Product[] = [
  { id: "a", brand: "Kevin.Murphy", name: "Repair.Me.Wash — шампунь", stock: "low" },
  { id: "b", brand: "Rempire", name: "Beard balm — бальзам для бороды", stock: "out" },
  { id: "c", brand: "Paula's Choice", name: "BHA 2% Gentle Exfoliating Toner — тоник", stock: "low" },
  { id: "d", brand: "Davines", name: "OI Oil — масло для волос", stock: "out" },
];

/** adminAnswer() as the panel runs it, with the catalogue's low stock given. */
function answer(lang: Lang, q: string, low: Product[] = LOW): string {
  return runInNewContext(`
    var S = { lang: ${JSON.stringify(lang)} };
    ${I18N}
    ${slice("esc")}
    ${slice("pl")}
    ${slice("plural")}
    ${slice("admProdName")}
    function lowStock() { return ${JSON.stringify(low)}; }
    function aiGo(tab, label) { return '<button data-admtab="' + tab + '">' + label + "</button>"; }
    ${slice("adminAnswer")}
    adminAnswer(${JSON.stringify(q)});
  `, {}) as string;
}

/** What translateTree() leaves on screen: every text node through trText().
    The answer sits in no NAME_CTX element, so a node gets no name rules. */
function onScreen(html: string, lang: Lang): string[] {
  const nodes = html
    .split(/<[^>]*>/)
    .map((t) => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim())
    .filter(Boolean);
  if (lang === "RU") return nodes;
  const trText = runInNewContext(`${I18N}\ntrText`) as (s: string, l: string, allowName: boolean) => string;
  return nodes.map((t) => (CYR.test(t) ? trText(t, lang, false) : t));
}

const items = (html: string) => [...html.matchAll(/<li class="adm-msg__li">([\s\S]*?)<\/li>/g)].map((m) => m[1]);
const Q = "Что заканчивается и что дозаказать?";

describe("the offline answer to «Что заканчивается…» is a list", () => {
  it("one product a line, its state at the end, «нет» marked", () => {
    const html = answer("RU", Q);
    const li = items(html);
    expect(li, "the names were glued into one sentence").toHaveLength(3);
    expect(li[0]).toBe(
      '<span class="adm-msg__nm">Kevin.Murphy Repair.Me.Wash — шампунь</span><span class="adm-msg__st">мало</span>',
    );
    expect(li[1]).toBe(
      '<span class="adm-msg__nm">Rempire Beard balm — бальзам для бороды</span>' +
      '<span class="adm-msg__st adm-msg__st--out">нет</span>',
    );
    expect(html).toContain('<ul class="adm-msg__list">');
    expect(html).toContain('<p class="adm-msg__p">Заканчиваются 4 товара. Срочно:</p>');
  });

  it("is drawn exactly as the online answer draws «name — state»", () => {
    const reply = new Function(`${slice("esc")}\n${slice("admReplyItem")}\nreturn admReplyItem;`)() as (s: string) => string;
    const li = items(answer("RU", Q));
    expect(li[0]).toBe(reply("Kevin.Murphy Repair.Me.Wash — шампунь — мало"));
    expect(li[1]).toBe(reply("Rempire Beard balm — бальзам для бороды — нет"));
  });

  it("is the panel's own words, not [data-notr] — the dictionary must reach them", () => {
    expect(answer("RU", Q)).not.toContain("data-notr");
  });

  for (const lang of ["ET", "EN"] as const) {
    it(`leaves no Russian on an ${lang} panel — the names, the states and both sentences`, () => {
      const shown = onScreen(answer(lang, Q), lang);
      expect(shown.filter((t) => CYR.test(t)), `Russian left on the ${lang} panel`).toEqual([]);
    });

    it(`names each product on its own on an ${lang} panel`, () => {
      const li = items(answer(lang, Q));
      expect(li).toHaveLength(3);
      expect(li[0]).toContain(lang === "EN" ? "Repair.Me.Wash — shampoo" : "Repair.Me.Wash — šampoon");
    });
  }

  it("a shop with nothing running low says so, instead of «Срочно: .»", () => {
    for (const lang of ["RU", "ET", "EN"] as const) {
      const html = answer(lang, Q, []);
      expect(html).not.toContain("Срочно");
      expect(onScreen(html, lang).filter((t) => CYR.test(t) && lang !== "RU")).toEqual([]);
    }
  });
});

/* Verification pass on staging, 25.09.2026 (ai-assistant-ask): the list
   stopped with no word that there were more. The lead sentence counts them
   all; the list shows three; the rest is said by number, with the way to
   «Склад». */
describe("the offline list says how many it did not show", () => {
  const many = (n: number): Product[] =>
    Array.from({ length: n }, (_, i) => ({ id: `p${i}`, brand: "Proraso", name: `Wax ${i}`, stock: i % 2 ? "low" : "out" }));

  it("«…и ещё N» in Russian plural, and a button to «Склад»", () => {
    expect(answer("RU", Q, many(4))).toContain('<p class="adm-msg__p">…и ещё 1 товар</p>');
    expect(answer("RU", Q, many(5))).toContain('<p class="adm-msg__p">…и ещё 2 товара</p>');
    const html = answer("RU", Q, many(8));
    expect(html).toContain('<p class="adm-msg__p">…и ещё 5 товаров</p>');
    expect(html).toContain('data-admtab="stock"');
  });

  it("three or fewer: nothing more to say, no extra button", () => {
    const html = answer("RU", Q, many(3));
    expect(html).not.toContain("и ещё");
    expect(html).not.toContain('data-admtab="stock"');
  });

  it("in Estonian and English too", () => {
    expect(onScreen(answer("ET", Q, many(4)), "ET")).toContain("…ja veel 1 toode");
    expect(onScreen(answer("EN", Q, many(4)), "EN")).toContain("…and 1 more product");
    expect(onScreen(answer("ET", Q, many(8)), "ET")).toContain("…ja veel 5 toodet");
    expect(onScreen(answer("EN", Q, many(8)), "EN")).toContain("…and 5 more products");
    for (const lang of ["ET", "EN"] as const) {
      expect(onScreen(answer(lang, Q, many(8)), lang).filter((t) => CYR.test(t))).toEqual([]);
    }
  });
});

describe("the other offline answers name no products", () => {
  /* The same glue can only happen where a list of names is joined into one
     node. Every other branch of adminAnswer() is a fixed sentence and a
     button to the tab that has the figures — pinned here so a future branch
     that lists products is drawn as a list too. */
  it("only the low-stock branch reads the catalogue", () => {
    const fn = slice("adminAnswer").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(fn.match(/admProdName\(/g) || []).toHaveLength(1);
    expect(fn.match(/lowStock\(\)|CATALOGUE/g) || []).toHaveLength(1);
    expect(fn).not.toMatch(/\.join\(", "\)/);
  });
});
