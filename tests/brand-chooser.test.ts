/**
 * «Какой System 4 выбрать?» — the short list under the System 4 brand page's
 * intro (Dim, 09.10.2026; the one visible change of SEO pack 3).
 *
 * One line per need, each naming the real products for it, in the page's
 * language, with real links. The words are src/lib/seo-copy.mjs
 * (`brandChooser`, drawn by seoBrandChooserHtml()); app.js carries the block
 * and screenCatalog() draws it after boot, tools/prerender-shop2.mjs writes
 * the same list into the static brand page. It is dressed in the shop's own
 * rich-text classes — a product description's — so it adds no CSS.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { seoBrandChooserHtml, seoCopy } from "@/lib/seo-copy.mjs";
import { seoCopyBlock } from "../tools/lib/seo-copy-block.mjs";
import { claimIn } from "./claim-words";

/* LF whatever the checkout wrote: the source checks below look for line shapes */
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n?/g, "\n");
type P = { id: string; brand: string };
const CATALOGUE = new Function(read("../public/shop/catalogue2.js") + "\nreturn CATALOGUE;")() as P[];
const APP = read("../public/shop2/app.js");
const PRERENDER = read("../tools/prerender-shop2.mjs");
const CSS = read("../public/shop2/styles.css");
type Row = [string, Array<[string, string]>];
const CHOOSER = seoCopy().brandChooser as unknown as Record<string, Record<"RU" | "ET" | "EN", [string, Row[]]>>;
const S4 = CHOOSER["System 4"];
const CODES = ["RU", "ET", "EN"] as const;
const SEG = { RU: "/ru", ET: "/et", EN: "" } as const;
const linkTo = (code: (typeof CODES)[number]) => (id: string) => ` href="${SEG[code]}/products/${id}"`;

describe("the words", () => {
  it("is System 4's alone", () => {
    expect(Object.keys(CHOOSER)).toEqual(["System 4"]);
    for (const b of new Set(CATALOGUE.map((p) => p.brand))) {
      if (b !== "System 4") expect(seoBrandChooserHtml(b, "RU", linkTo("RU")), b).toBe("");
    }
  });

  it("asks the question in each language", () => {
    expect(S4.RU[0]).toBe("Какой System 4 выбрать?");
    expect(S4.ET[0]).toBe("Millist System 4 valida?");
    expect(S4.EN[0]).toBe("Which System 4 is right for you?");
  });

  it("keeps to six to eight lines, the same products in the same order in every language", () => {
    const ids = (code: (typeof CODES)[number]) => S4[code][1].map((r) => r[1].map((l) => l[0]));
    expect(S4.RU[1].length).toBeGreaterThanOrEqual(6);
    expect(S4.RU[1].length).toBeLessThanOrEqual(8);
    expect(ids("ET")).toEqual(ids("RU"));
    expect(ids("EN")).toEqual(ids("RU"));
  });

  it("links only to System 4 products that exist, the four numbered shampoos each on a line of its own", () => {
    const s4 = new Set(CATALOGUE.filter((p) => p.brand === "System 4").map((p) => p.id));
    const all = S4.RU[1].flatMap((r) => r[1].map((l) => l[0]));
    for (const id of all) expect(s4.has(id), id).toBe(true);
    expect(new Set(all).size).toBe(all.length);
    const first = S4.RU[1].map((r) => r[1][0][0]);
    expect(first.slice(0, 4)).toEqual([
      "system-4-special-shampoo-1", "system-4-balancing-shampoo-2", "system-4-mild-shampoo-3", "system-4-shale-oil-shampoo-4",
    ]);
    expect(S4.RU[1].slice(0, 4).map((r) => r[1][0][1])).toEqual(["шампунь №1", "шампунь №2", "шампунь №3", "шампунь №4"]);
    expect(S4.ET[1].slice(0, 4).map((r) => r[1][0][1])).toEqual(["šampoon nr 1", "šampoon nr 2", "šampoon nr 3", "šampoon nr 4"]);
    expect(S4.EN[1].slice(0, 4).map((r) => r[1][0][1])).toEqual(["shampoo 1", "shampoo 2", "shampoo 3", "shampoo 4"]);
  });

  it("names each need the way the product's own text does — cosmetic words only", () => {
    const RU = S4.RU[1].map((r) => r[0]);
    expect(RU[0]).toMatch(/жирная кожа головы, склонная к перхоти/i);
    expect(RU[1]).toMatch(/сухая кожа головы/i);
    expect(RU[3]).toMatch(/очень жирные волосы, чувствительная кожа головы/i);
    expect(RU[4]).toBe("Тонкие и ослабленные волосы");
    const bad: string[] = [];
    for (const code of CODES) {
      for (const [need, links] of S4[code][1]) {
        for (const s of [need, ...links.map((l) => l[1])]) {
          const hit = claimIn(s);
          if (hit) bad.push(`${code}: «${hit}»`);
          if (code !== "RU" && /[А-Яа-яЁё]/.test(s)) bad.push(`${code}: Russian in «${s}»`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("the HTML", () => {
  it("is the shop's own rich-text dress — classes styles.css already has, nothing new", () => {
    const html = seoBrandChooserHtml("System 4", "RU", linkTo("RU"));
    expect(html.startsWith('<div class="acc__body acc__rich" data-notr data-chooser><h2>Какой System 4 выбрать?</h2><ul><li>')).toBe(true);
    expect(html.endsWith("</li></ul></div>")).toBe(true);
    const classes = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(" ")));
    expect([...classes].sort()).toEqual(["acc__body", "acc__rich", "link"]);
    for (const c of classes) expect(CSS, c).toMatch(new RegExp("\\." + c + "\\b"));
    // the list itself, as .acc__rich draws a product description's
    expect(CSS).toContain(".acc__rich ul");
    expect(CSS).toContain(".acc__rich h2");
  });

  it("one <li> per line, a real <a href> per product, in the page's own language", () => {
    for (const code of CODES) {
      const html = seoBrandChooserHtml("System 4", code, linkTo(code));
      expect((html.match(/<li>/g) || []).length, code).toBe(S4[code][1].length);
      expect((html.match(/<a class="link" href="/g) || []).length, code).toBe(S4[code][1].flatMap((r) => r[1]).length);
      expect(html, code).toContain(`<a class="link" href="${SEG[code]}/products/system-4-special-shampoo-1">${S4[code][1][0][1][0][1]}</a>`);
      // the dash never opens a line
      expect(html, code).toContain(S4[code][1][0][0] + " — <a ");
    }
  });

  it("leaves out a product the renderer may not link to, and a line left with none", () => {
    const off = new Set(["system-4-hydro-care-conditioner-h", "system-4-mild-shampoo-3"]);
    const html = seoBrandChooserHtml("System 4", "EN", (id: string) => (off.has(id) ? null : linkTo("EN")(id)));
    expect(html).not.toContain("hydro-care");
    expect(html).not.toContain("mild-shampoo");
    expect(html).not.toContain("Gentle everyday washing");
    expect(html).toContain("Dry, dandruff-prone scalp, colour-treated hair — <a");
    expect((html.match(/<li>/g) || []).length).toBe(S4.EN[1].length - 1);
    expect(seoBrandChooserHtml("System 4", "EN", () => null)).toBe("");
  });
});

describe("both renderers draw it", () => {
  it("app.js's copy of the block writes the same HTML as the module", () => {
    const browser = runInNewContext(seoCopyBlock(APP) + "\nseoBrandChooserHtml;") as typeof seoBrandChooserHtml;
    for (const code of CODES) {
      expect(browser("System 4", code, linkTo(code)), code).toBe(seoBrandChooserHtml("System 4", code, linkTo(code)));
    }
  });

  it("screenCatalog() puts it under a brand's intro, never on a subcollection, linking only what is on sale", () => {
    const at = APP.indexOf("function screenCatalog()");
    const fn = APP.slice(at, APP.indexOf("\n  }\n", at));
    const intro = fn.indexOf('<p class="sec__intro"');
    const call = fn.indexOf("seoBrandChooserHtml(S.brand, S.lang,");
    expect(intro).toBeGreaterThan(0);
    expect(call).toBeGreaterThan(intro);
    expect(fn).toContain("(S.brand && !subPg ? seoBrandChooserHtml(S.brand, S.lang, function (id) {");
    // a product off sale is not in CATALOGUE; the shop's own click hook rides on the link
    expect(fn).toContain(`return byIdOrNull(id) ? ' href="' + linkHref("product", id) + '" data-go-product="' + esc(id) + '"' : null;`);
  });

  it("the prerender writes it into the static brand page, linking only what is on sale", () => {
    expect(PRERENDER).toContain('import { seoBrandChooserHtml, seoBrandIntro, seoHead, seoSub } from "../src/lib/seo-copy.mjs";');
    expect(PRERENDER).toContain("const ON_SALE_IDS = new Set(ON_SALE.map(p => p.id));");
    expect(PRERENDER).toContain(`after: seoBrandChooserHtml(b, lang.code, (pid) =>`);
    expect(PRERENDER).toContain(`ON_SALE_IDS.has(pid) ? ' href="' + href(lang.seg, "/p/" + encodeURIComponent(pid) + "/") + '"' : null)`);
    // right under the intro, above the grid
    expect(PRERENDER).toMatch(/'<p class="sec__intro">' \+ esc\(intro\) \+ "<\/p>" \+\s+\/\/[^\n]*\n\s+after \+/);
  });
});
