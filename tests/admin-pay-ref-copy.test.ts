/**
 * The Montonio payment number on the order card.
 *
 * Dim, 24.09.2026, on /test «order-card-payment»:
 *
 *   «There is no link to that payment at the bank — just an id.»
 *
 * The checklist promised «Есть ссылка на этот платёж у банка», and there is
 * no such link to give: docs.montonio.com (the Stargate order guide and API
 * reference) names no page for one order, and Montonio's help centre only ever
 * says «Orders → paste the order number or UUID into the search». A made-up
 * `partner.montonio.com/orders/<uuid>` would be a link that leads nowhere.
 *
 * So the number travels instead, and it has to be easy to take: the number
 * itself copies on a tap (with the same «Номер платежа скопирован ✓» toast as
 * the button beside it), and the checklist asks for exactly that.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");
const plan = JSON.parse(readFileSync(fileURLToPath(new URL("../src/data/testplan.json", import.meta.url)), "utf8")) as {
  items: Array<{ id: string; steps: string[]; expect: string[]; en: { steps: string[]; expect: string[] } }>;
};

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

// The body is this repository's own source plus fixed stub text.
const admPayRefHTML = new Function(`
  ${slice("esc")}
  // 1a: where to paste the number is behind the «?» beside it
  function admHelpBtnHTML() { return '<button class="adm-help">?</button>'; }
  function admHelpHTML(k, t) { return "<div>" + t + "</div>"; }
  ${slice("admPayRefHTML")}
  return admPayRefHTML;
`)() as (p: unknown) => string;

/** The attributes of the element that carries `data-payref`. */
function payRefTag(html: string): string {
  const m = html.match(/<span[^>]*\bdata-payref\b[^>]*>/);
  if (!m) throw new Error("the card no longer marks the payment number with data-payref");
  return m[0];
}

describe("the payment number copies on a tap", () => {
  const ref = "d8c1c7a4-9d2e-4a40-9b8e-6f1f2b3c4d5e";
  const html = admPayRefHTML({ provider: "montonio", ref, status: "paid" });

  it("the number itself is a copy target, not only the button beside it", () => {
    const tag = payRefTag(html);
    expect(tag, "tapping the number does nothing").toContain(`data-admcopy="${ref}"`);
    expect(tag).toContain('data-admcopymsg="Номер платежа скопирован ✓"');
  });

  it("…and the click delegate hears it — [data-admcopy] is on its list", () => {
    expect(src).toContain("[data-admcopy],");
    expect(src).toContain('if (d.admcopy) { admCopyText(d.admcopy, t.getAttribute("data-admcopymsg") || ""); return; }');
  });

  it("the button stays, for a keyboard and for the e2e that clicks it", () => {
    expect(html).toMatch(new RegExp(`<button class="adm-copy" data-admcopy="${ref}"`));
  });

  it("invents no address at Montonio — there is no documented one for a single payment", () => {
    expect(html).not.toMatch(/href=/);
    expect(html).not.toMatch(/partner\.montonio\.com\/orders\//);
  });

  it("a manual mark and a salon sale still show no number", () => {
    expect(admPayRefHTML({ provider: "montonio", ref: "manual" })).toBe("");
    expect(admPayRefHTML({ provider: "pos", ref: "x-1" })).toBe("");
  });
});

describe("the checklist asks for what the card does", () => {
  const item = plan.items.find((i) => i.id === "order-card-payment");

  it("does not promise a link to the payment at the bank", () => {
    expect(item).toBeDefined();
    const all = [...item!.expect, ...item!.en.expect].join("\n");
    expect(all, "the checklist still promises a link Montonio does not offer").not.toMatch(/ссылка на этот платёж|link to that payment/i);
    expect(all).toMatch(/скопирован/);
  });
});
