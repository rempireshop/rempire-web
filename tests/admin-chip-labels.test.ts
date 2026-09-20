/**
 * Every chip that prints a number has to survive the translator.
 *
 * The panel's chips are one text node — «Все 334», «Придержаны 2» — so the
 * dictionary's entry for the bare word never matches them; each needs a
 * `UI_RX` rule of its own. On 19.09.2026 three screens grew numbers without
 * one: «Заказы» gained «Придержаны», and «Склад» and «Каталог» started
 * printing a count on all four of their chips. The English panel then showed
 * Russian, which is what the owner opened it on the next morning, two hours
 * before a demo: «"придержаны" on english site. also "russian" text in
 * products page.»
 *
 * `tools/i18n-gaps.mjs` cannot catch this. It reads the SOURCE for Russian
 * literals, and «Все 334» exists only at run time — the label and the count
 * are glued together by the renderer. So the check has to be this one: take
 * the real label tables out of app.js, glue a number on the way the renderer
 * does, and put the result through the panel's own translator.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

/** A `var NAME = [ … ];` / `{ … };` declaration, as source. */
function decl(name: string): string {
  for (const [open, close] of [["[", "]"], ["{", "}"]] as const) {
    const start = src.indexOf(`var ${name} = ${open}`);
    if (start < 0) continue;
    let depth = 0;
    for (let i = src.indexOf(open, start); i < src.length; i++) {
      if (src[i] === open) depth++;
      else if (src[i] === close && --depth === 0) return `${src.slice(start, i + 1)};`;
    }
    throw new Error(`unbalanced ${open}${close} around ${name}`);
  }
  throw new Error(`public/shop2/app.js no longer declares ${name}`);
}

/* The panel's own translator, with its own two tables. Nothing is retyped:
   a rule added to app.js is a rule this test sees. */
const BODY = `
  ${decl("UI")}
  ${decl("UI_RX")}
  ${slice("trName")}
  ${decl("TAIL_EXACT")}
  ${decl("NAME_TAILS")}
  ${decl("NAME_FRAGS")}
  ${slice("trText")}
  return trText(S, LANG, false);
`;
// repository source plus fixed stub text — S and LANG are arguments
const tr = new Function("S", "LANG", BODY) as (s: string, lang: string) => string;

/** The label column of a `[key, label, …]` table. */
function labels(name: string): string[] {
  const d = decl(name);
  return [...d.matchAll(/\[\s*"[a-z-]+"\s*,\s*"([^"]+)"/g)].map((m) => m[1]);
}

const CHIPS: Array<[string, string[]]> = [
  ["ADM_ORDER_FILTERS", labels("ADM_ORDER_FILTERS")],
  ["ADM_GOODS_FILTERS", labels("ADM_GOODS_FILTERS")],
];

/* «Склад»'s four live inside admStockHTML() as a local `var FILTERS = [...]`,
   which `decl()` cannot reach — lifted by the same shape instead. */
const stockAt = src.indexOf('var FILTERS = [["all"');
const STOCK = stockAt < 0
  ? []
  : [...src.slice(stockAt, src.indexOf("];", stockAt)).matchAll(/\[\s*"[a-z-]+"\s*,\s*"([^"]+)"/g)].map((m) => m[1]);

describe("a chip with a number on it is still translated", () => {
  it("finds the label tables at all — an empty sweep proves nothing", () => {
    for (const [name, list] of CHIPS) expect(list.length, name).toBeGreaterThan(2);
    expect(STOCK.length, "the «Склад» chips").toBe(4);
  });

  for (const [name, list] of [...CHIPS, ["«Склад» FILTERS", STOCK] as [string, string[]]]) {
    for (const label of list) {
      for (const lang of ["ET", "EN"]) {
        it(`${name}: «${label} 7» in ${lang}`, () => {
          const got = tr(`${label} 7`, lang);
          expect(got, `«${label} 7» came back untranslated in ${lang}`).not.toMatch(/[А-Яа-яЁё]/);
          // …and the number survived the rule's own $1
          expect(got, `«${label} 7» lost its count in ${lang}`).toContain("7");
        });
      }
    }
  }

  /* The bare labels still have to work too: «Придержаны» hides when it is
     empty and «Все» has never carried a number. */
  it("translates the bare labels as well", () => {
    for (const [, list] of [...CHIPS, ["", STOCK] as [string, string[]]]) {
      for (const label of list) {
        for (const lang of ["ET", "EN"]) {
          expect(tr(label, lang), `«${label}» in ${lang}`).not.toMatch(/[А-Яа-яЁё]/);
        }
      }
    }
  });
});
