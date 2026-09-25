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
  let flushed = 0;
  const press = new Function(
    "S", "render", "refocus", "admAutosaveFlush", "bundleDraftLoad",
    `${fn("bundleUid")}
     var BUNDLE_UIDN = 0;
     ${fn("blankBundle")}
     return function (d) { ${branch("if (d.bundlenew !== undefined)")} };`,
  )(S, () => {}, (sel: string) => { focused = sel; }, () => { flushed++; }, () => null) as (d: Record<string, string>) => void;

  it("focuses the name box, not the address", () => {
    press({ bundlenew: "" });
    expect(S.bundleForm, "the form did not open").toBeTruthy();
    expect(focused, "the caret went to the address box").toBe('[data-bundlef="title"]');
    // 1a: whatever the set open before still owed went first
    expect(flushed).toBe(1);
  });

  it("…and that selector names the first box of the form the owner sees — and there is no address box at all", () => {
    /* The form, drawn by its own function: the name is the first input and
       the refocus target. Since 1a the address is not a box: it is written
       from the name when the set is first saved, and shown behind «?» (q23). */
    const form = { uid: "d1", id: "", cat: "beard", editing: false, title: { RU: "", ET: "", EN: "" },
      desc: { RU: "", ET: "", EN: "" }, items: [], price: "", image: "", active: false, sort: 0, lang: "RU", rev: 0 };
    const html = new Function(
      "S", "LANGS", "BUNDLE_CATS", "esc", "BUNDLE_SAVE_ERRS",
      "bundleItemRowsHTML", "bundleSumLine", "bundlePickRows", "bundleOwnHint", "bundleFormPctText",
      "bundleHintHTML", "bundleImageRowHTML", "bundleProblem", "bundleHintWarn", "bundleDraftHas",
      "admLangBarHTML", "admLangFallback", "admSecHeadHTML", "bundleAddrHTML", "admLabelledSwitch",
      `${fn("bundleFormHTML")}\nreturn bundleFormHTML();`,
    )(
      { bundleForm: form, bundleFormErr: "" }, [["RU", "RU"], ["ET", "ET"], ["EN", "EN"]], [["beard", "Борода"]],
      (s: string) => String(s), { bad_name: "name", bad_desc: "desc", few_items: "few" },
      () => "", () => "", () => "", () => "", () => "", () => "", () => "", () => "", () => false, () => false,
      () => "", () => [], () => "", () => "", () => "",
    ) as string;
    const inputs = html.match(/<input[^>]*>/g) ?? [];
    expect(inputs[0]).toContain('data-bundlef="title"');
    expect(html).not.toContain('data-bundlef="id"');
  });
});
