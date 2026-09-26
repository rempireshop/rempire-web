/**
 * «Доставка и оплата», a price under Montonio's tariff: «Оставить так» sits
 * level with the box it answers for.
 *
 * Dim, 26.09.2026 (panel-delivery-below, ok with a note): «The "keep it" and
 * the box where we enter the number seem not to be inline, a small
 * positioning fix needs to be done.» The line beside the box was the rust
 * sentence first — two lines of it in the 140 px a phone leaves — then the
 * button, then «вернуть»; the grid centred that whole stack on the box, so
 * the button floated wherever the sentence ended. In a desktop column the
 * button came under the sentence, narrower than the box, its words broken
 * over two lines.
 *
 * Now the button comes first and the sentence with «вернуть» after it, and
 * admin.css places them: on the phone's label · box · line grid the button
 * takes the third track of the box's own row and the sentence a row of its
 * own under both; in a column the button is straight under the box and as
 * wide. Measured on the dev server (probe, 26.09.2026): 320–1000 px the
 * button's top and height equal the box's; 1440 px it is the box's width,
 * 4 px under it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
const src = read("../public/shop2/app.js");
// comments out first: they hold commas, and a selector list is split on them
const css = read("../public/shop2/admin.css").replace(/\/\*[\s\S]*?\*\//g, "");

function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}()`);
}
function literalSrc(name: string): string {
  const at = src.indexOf(`var ${name} = `);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  const open = at + `var ${name} = `.length;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{" || src[i] === "[") depth++;
    else if (src[i] === "}" || src[i] === "]") if (--depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unterminated literal for ${name}`);
}
/** Every declaration block whose selector list contains exactly `sel`, joined. */
function rules(sel: string): string {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const sels = m[1].split(",").map((s) => s.trim());
    if (sels.includes(sel)) out.push(m[2]);
  }
  return out.join("\n");
}
/** The same, inside the `@container admpage (min-width: 620px)` block only. */
function containerRules(sel: string): string {
  const at = css.indexOf("@container admpage (min-width: 620px) {");
  const body = css.slice(at, css.indexOf("\n}\n", at));
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) if (m[1].split(",").map((s) => s.trim()).includes(sel)) out.push(m[2]);
  return out.join("\n");
}

const foot = new Function(`
  var CARRIER_NAMES = ${literalSrc("CARRIER_NAMES")};
  var S = { lang: "RU" }, SHIP_ACCEPT = {}, shipServerRow = null, SHIP_STORED = {};
  ${["eur", "esc", "montonioCarrierTag", "shipRowCell", "shipAccepted", "admRateFootHTML"].map(slice).join("\n")}
  return admRateFootHTML;
`)() as (k: string, v: string, price: number, carrier: string) => string;

const HELD = ".adm-rt .adm-rates__c:has(.adm-rt__keep)";

describe("«Оставить так» is level with its box", () => {
  it("the button first, then the rust sentence with «вернуть» — two parts the layout can place", () => {
    const held = foot("c:omniva:EE", "1", 3.19, "");
    expect(held).toMatch(
      /^<span class="adm-rt__acts"><button class="adm-rt__keep" type="button" data-shipaccept="c:omniva:EE">Оставить так<\/button><\/span>/,
    );
    expect(held).toMatch(
      /<span class="adm-rt__why"><span class="adm-hint adm-hint--cell adm-hint--loss">Ниже тарифа Montonio: 3,19 €<\/span><button class="adm-rates__undo" type="button" data-shipclear="c:omniva:EE">вернуть<\/button><\/span>$/,
    );
  });

  it("on the phone's grid the button takes the box's row, the sentence a row under both", () => {
    expect(rules(`${HELD} .adm-rt__f`)).toMatch(/display: contents/);
    expect(rules(`${HELD} > .adm-input`)).toMatch(/grid-row: 1/);
    const acts = rules(`${HELD} .adm-rt__acts`);
    expect(acts).toMatch(/grid-column: 3/);
    expect(acts).toMatch(/grid-row: 1/);
    // as tall as the box, so level with it top and bottom
    expect(rules(`${HELD} .adm-rt__keep`)).toMatch(/min-height: 44px/);
    const why = rules(`${HELD} .adm-rt__why`);
    expect(why).toMatch(/grid-column: 2 \/ -1/);
    expect(why).toMatch(/grid-row: 2/);
  });

  it("in a desktop column the button is straight under the box and as wide as it", () => {
    expect(containerRules(`${HELD} .adm-rt__f`)).toMatch(/display: block/);
    expect(containerRules(`${HELD} .adm-rt__acts`)).toMatch(/justify-self: stretch/);
    expect(containerRules(`${HELD} .adm-rt__keep`)).toMatch(/width: 100%/);
    expect(rules(".adm-rt__keep")).toMatch(/width: 100%/);
  });

  it("the held box's own «why not sent» line stays hidden — the rust sentence says it", () => {
    expect(css).toContain(".adm-rates__c:has(.adm-rt__keep) .adm-ashint { display: none; }");
  });
});
