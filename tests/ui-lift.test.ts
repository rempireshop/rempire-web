/**
 * The interface dictionary out of app.min.js — tools/lib/ui-lift.mjs, perf
 * 09.10.2026 — and the tag each page links for it (pageAssets in
 * src/lib/seo-head.mjs).
 *
 * The build lifts `var UI = {…}` out of the stripped app.js into
 * /shop2/ui.et.js and /shop2/ui.en.js. What must hold:
 *
 *   · the two files rebuild exactly the object app.js declares — every key,
 *     every string; a phrase lost here is a phrase printed in Russian on the
 *     Estonian or English shop, which no other test would notice;
 *   · app.min.js keeps a `UI` that the files fill in, and nothing else of the
 *     script moves;
 *   · a page links its own language's file: the English one on an English
 *     page, the Estonian one on an Estonian page, none on a Russian page or on
 *     the owner's screens.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { stripJs } from "../tools/lib/js-strip.mjs";
import { liftUi, uiSpan, UI_GLOBAL } from "../tools/lib/ui-lift.mjs";
import { pageAssets, patchShell } from "../src/lib/seo-head.mjs";

const APP = readFileSync(path.join(process.cwd(), "public", "shop2", "app.js"), "utf8");

/** The dictionary as the browser built it before the split: the source's own declaration, evaluated. */
function sourceUi(): Record<string, Record<string, string>> {
  const src = APP.replace(/\r\n?/g, "\n");
  const span = uiSpan(src);
  expect(span, "app.js: `var UI = {` not found").not.toBeNull();
  return new Function(src.slice(span![0], span![1]) + "\nreturn UI;")();
}

describe("liftUi on the real app.js", () => {
  const out = liftUi(stripJs(APP));

  it("writes a file for each language that rebuilds UI exactly", () => {
    expect(Object.keys(out.files).sort()).toEqual(["EN", "ET"]);
    const sandbox: { window: Record<string, unknown> } = { window: {} };
    vm.createContext(sandbox);
    const files = out.files as Record<string, string>;
    for (const lang of Object.keys(files)) vm.runInContext(files[lang], sandbox);
    const built = sandbox.window[UI_GLOBAL] as Record<string, Record<string, string>>;
    const want = sourceUi();
    for (const lang of ["ET", "EN"]) {
      expect(Object.keys(built[lang]).length, lang).toBeGreaterThan(1000);
      expect(JSON.stringify(built[lang]), lang).toBe(JSON.stringify(want[lang]));
    }
  });

  it("leaves app.min.js a UI the files fill in, and the rest of the script as it was", () => {
    expect(out.app).not.toMatch(/var UI = \{/);
    expect(out.app).toContain("var UI = window." + UI_GLOBAL + " || (window." + UI_GLOBAL + " = {});");
    expect(() => new vm.Script(out.app)).not.toThrow();
    const stripped = stripJs(APP);
    const span = uiSpan(stripped)!;
    expect(out.app.slice(0, span[0])).toBe(stripped.slice(0, span[0]));
    expect(out.app.endsWith(stripped.slice(span[1]))).toBe(true);
    // the dictionary is the heavy part of the file: well over a quarter of it
    expect(stripped.length - out.app.length).toBeGreaterThan(stripped.length / 4);
  });
});

describe("liftUi on its own", () => {
  it("counts braces outside strings and regexes only", () => {
    const src = 'var A = 1;\nvar UI = {\nET: { "a}": "b{", "c": "/}/" },\nEN: { "a}": "x" }\n};\nvar RX = /[}]/;\n';
    const out = liftUi(src);
    expect(out.ui).toEqual({ ET: { "a}": "b{", c: "/}/" }, EN: { "a}": "x" } });
    expect(out.app).toBe("var A = 1;\nvar UI = window." + UI_GLOBAL + " || (window." + UI_GLOBAL + " = {});\nvar RX = /[}]/;\n");
  });

  it("hands a script with no table back unchanged", () => {
    const src = "(function(){ /* the shop */ })();\n";
    expect(liftUi(src)).toEqual({ app: src, files: {}, ui: null });
  });
});

describe("pageAssets: the dictionary a page links", () => {
  const shell = [
    '<html lang="en"><head></head><body>',
    '<script src="/shop/catalogue2.js?v=abc123def456"></script>',
    '<script src="/shop2/ui.en.js?v=abc123def456" data-ui></script>',
    '<script src="/shop2/app.min.js?v=abc123def456"></script>',
    "</body></html>",
  ].join("\n");

  it("English keeps the English file, Estonian links its own, Russian and the owner's screens none", () => {
    expect(pageAssets(shell, { code: "EN" })).toBe(shell);
    expect(pageAssets(shell, { code: "ET" })).toBe(shell.replace("/shop2/ui.en.js", "/shop2/ui.et.js"));
    expect(pageAssets(shell, { code: "RU" })).not.toMatch(/ui\.(en|et)\.js/);
    expect(pageAssets(shell, { code: null })).not.toMatch(/ui\.(en|et)\.js/);
    expect(pageAssets(shell, { code: "RU" })).toContain('<script src="/shop2/app.min.js?v=abc123def456"></script>');
  });

  it("a policy page links its text in its own language, in front of app.min.js, on the shared token", () => {
    const et = pageAssets(shell, { code: "ET", legal: true });
    expect(et).toContain('<script src="/shop/legal.et.js?v=abc123def456"></script>\n<script src="/shop2/app.min.js?v=abc123def456">');
    expect(pageAssets(shell, { code: "RU", legal: true })).toContain("/shop/legal.ru.js?v=abc123def456");
    expect(pageAssets(shell, { code: "EN", legal: true })).toContain("/shop/legal.en.js?v=abc123def456");
  });

  it("patchShell writes the page's language into the tag along with <html lang>", () => {
    const withMarks = shell.replace("<head></head>", "<head><!-- seo:start --><!-- seo:end --></head>")
      .replace("<body>", '<body><div id="app"><!-- prerender:start --><!-- prerender:end --></div>');
    expect(patchShell(withMarks, "", "", "ru")).not.toMatch(/ui\.(en|et)\.js/);
    expect(patchShell(withMarks, "", "", "et")).toContain("/shop2/ui.et.js?v=abc123def456");
    // no language given: the shell's own tag stays
    expect(patchShell(withMarks, "", "")).toContain("/shop2/ui.en.js?v=abc123def456");
  });

  it("the real shell carries the tag pageAssets looks for", () => {
    const real = readFileSync(path.join(process.cwd(), "public", "shop2", "index.html"), "utf8");
    expect(real).toMatch(/<script src="\/shop2\/ui\.en\.js\?v=[0-9a-f]{12}" data-ui><\/script>/);
    expect(pageAssets(real, { code: "RU" })).not.toMatch(/<script src="\/shop2\/ui\./);
  });
});
