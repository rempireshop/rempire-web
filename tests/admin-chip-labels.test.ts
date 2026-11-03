/**
 * Every chip that prints a number has to survive the translator.
 *
 * The panel's chips were one text node then — «Все 334», «Придержаны 2» — so
 * the dictionary's entry for the bare word never matched them; each needed a
 * `UI_RX` rule of its own. On 19.09.2026 three screens grew numbers without
 * one: «Заказы» gained «Придержаны», and «Склад» and «Каталог» started
 * printing a count on all four of their chips. The English panel then showed
 * Russian, which is what the owner opened it on the next morning, two hours
 * before a demo: «"придержаны" on english site. also "russian" text in
 * products page.»
 *
 * Since the 1a redesign the label and the count are separate nodes, so what
 * has to survive the translator is every label in the real tables — taken out
 * of app.js and put through the panel's own translator below.
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

/* «Склад»'s four chips — a table of their own since the 1a redesign
   (`STOCK_FILTERS`) — and its history's, whose first key is the empty «Все»
   and whose keys carry underscores (`goods_in`), so they are lifted by a
   wider shape. The history prints a count on every chip too. */
const STOCK = labels("STOCK_FILTERS");
const HIST = [...decl("STOCK_HIST_CHIPS").matchAll(/\[\s*"[a-z_]*"\s*,\s*"([^"]+)"/g)].map((m) => m[1]);
CHIPS.push(["STOCK_HIST_CHIPS", HIST]);

describe("a chip with a number on it is still translated", () => {
  it("finds the label tables at all — an empty sweep proves nothing", () => {
    for (const [name, list] of CHIPS) expect(list.length, name).toBeGreaterThan(2);
    expect(STOCK.length, "the «Склад» chips").toBe(4);
    expect(HIST.length, "the «История склада» chips").toBe(7);
  });

  /* Since the 1a redesign every chip draws its label and its count as two
     nodes (`<span>label</span> <b>count</b>`), so the translator only ever
     sees the bare label. The 42 «<label> 7» cases that stood here checked the
     glued form no screen draws any more — removed 03.11.2026 (test cleanup). */
  it("translates every chip label", () => {
    for (const [, list] of [...CHIPS, ["", STOCK] as [string, string[]]]) {
      for (const label of list) {
        for (const lang of ["ET", "EN"]) {
          expect(tr(label, lang), `«${label}» in ${lang}`).not.toMatch(/[А-Яа-яЁё]/);
        }
      }
    }
  });
});
