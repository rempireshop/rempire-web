/**
 * «Настройки → Цены и баллы»: ONE ink line between «Как это посчитается на
 * заказе в 40 €» and the two columns under it.
 *
 * Dim, 26.09.2026 (panel-partners-switch, ok with a note): «Below "How this
 * works out on an order of €40" is one line and then before "an ordinary
 * shopper" is another line — we have two lines there, we can remove one.»
 * The heading (.adm-sech: a 1-px ink rule under its words) and each column
 * (.adm-calc__c: a 1-px ink rule over it) both drew one. The columns' rules
 * stay — on a phone the second parts the partner from the shopper — and the
 * heading, in this one block, gives its own up.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const app = read("../public/shop2/app.js");
const css = read("../public/shop2/admin.css");

function slice(name: string): string {
  const start = app.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = app.indexOf("{", start); i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}" && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}()`);
}
/** The declarations of the first rule whose selector is exactly `sel`. */
function rule(sel: string): string {
  const at = css.indexOf("\n" + sel + " {");
  if (at < 0) return "";
  return css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
}

describe("the 40 € example has one line under its heading", () => {
  it("the heading and the example are one block", () => {
    const card = slice("admPricingCard");
    expect(card).toMatch(/'<div class="adm-calcsec">' \+\s*admSecHeadHTML\("Как это посчитается на заказе в "/);
    expect(card).toContain(`'<div id="pricingcalc">' + admPricingCalcHTML() + "</div></div>"`);
  });

  it("in that block the heading draws no rule, and each column still draws its own", () => {
    expect(rule(".adm-sech")).toMatch(/border-bottom: 1px solid var\(--a-ink\)/);
    expect(rule(".adm-calcsec > .adm-sech")).toMatch(/border-bottom: 0/);
    expect(rule(".adm-calc__c")).toMatch(/border-top: 1px solid var\(--a-ink\)/);
  });
});
