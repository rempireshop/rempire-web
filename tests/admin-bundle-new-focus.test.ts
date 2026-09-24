/**
 * «+ Набор» puts the caret in the NAME.
 *
 * Dim, 19.09.2026: the set form asks for the name first; the address is a
 * latin slug written from the name as it is typed (paintBundleId), and a form
 * that opens on «менять нельзя после первой продажи» asks for a decision
 * before it has asked for anything at all. The form was reordered that day,
 * but the button that opens it went on focusing `[data-bundlef="id"]` — so
 * on a phone the keyboard came up under the address box, below the name, and
 * the first thing typed became the slug (map of the panel, 23.09.2026, #13;
 * /test «bundles-create»: «спросить должны название, а не адрес»).
 *
 * The branch is sliced out of public/shop2/app.js by source text and run over
 * stubs; the form itself is drawn by its own bundleFormHTML().
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

/** From `start` to the brace that closes the first `{` after it. */
function block(start: number, what: string): string {
  if (start < 0) throw new Error(`public/shop2/app.js no longer has ${what}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${what} in app.js`);
}
const fn = (name: string) => block(src.indexOf(`function ${name}(`), `function ${name}()`);
const branch = (head: string) => block(src.indexOf(head), head);

describe("«+ Набор» opens the new set on its name", () => {
  const S: Record<string, unknown> = {};
  let focused = "";
  const press = new Function(
    "S", "render", "refocus", "BUNDLE_AI_UNDO",
    `${fn("blankBundle")}
     return function (d) { ${branch("if (d.bundlenew !== undefined)")} };`,
  )(S, () => {}, (sel: string) => { focused = sel; }, null) as (d: Record<string, string>) => void;

  it("focuses the name box, not the address", () => {
    press({ bundlenew: "" });
    expect(S.bundleForm, "the form did not open").toBeTruthy();
    expect(focused, "the caret went to the address box").toBe('[data-bundlef="title"]');
  });

  it("…and that selector names the first box of the form the owner sees", () => {
    /* The form, drawn by its own function: the name is the first input and
       the refocus target, the address comes later and is written for him. */
    const html = new Function(
      "S", "LANGS", "BUNDLE_CATS", "BUNDLE_AI_UNDO", "esc",
      "bundleItemRowsHTML", "bundleSumLine", "bundlePickRows", "bundleOwnHint", "bundleFormPctText",
      "bundleHintHTML", "bundleImageRowHTML", "admDirtyCls", "admBarNoteState", "admBarNoteHTML",
      `${fn("bundleFormHTML")}\nreturn bundleFormHTML();`,
    )(
      S, [["RU", "RU"], ["ET", "ET"], ["EN", "EN"]], [["beard", "Борода"]], null, (s: string) => String(s),
      () => "", () => "", () => "", () => "", () => "", () => "", () => "", () => "", () => "", () => "",
    ) as string;
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    expect(inputs[0]).toContain('data-bundlef="title"');
    expect(html.indexOf('data-bundlef="title"')).toBeLessThan(html.indexOf('data-bundlef="id"'));
  });
});
