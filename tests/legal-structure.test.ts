/**
 * The policy pages read the same in all three languages — the same sections,
 * the same numbers, the same company details.
 *
 * Dim, /test checklist, shop-info-pages (23.09.2026): «The full terms of
 * delivery in English have good numbering for the headers, but in Russian all
 * areas start with "1." and look different from the English version … Estonian
 * is also different than English — the headers of each area have left some
 * space and the numbering is incorrect.»
 *
 * Why: the RU and ET terms of delivery were the harvested Shopify page, whose
 * section headings were each a list of their own — `<ol><ol><li><b>ОБЩИЕ
 * ПОЛОЖЕНИЯ</b></li></ol></ol>` — so every one of the fourteen was numbered
 * «1.» by the browser and indented twice; their clause numbers ran 7.17, 8.5,
 * 7.10, 8.6 and skipped section 10. The English page (public/shop/legal.en.js)
 * was rewritten by hand for this shop; RU and ET are now translations of it,
 * as the terms of sale already were.
 *
 * The files are loaded exactly as the shop loads them (a `var LEGAL_xx = …`
 * script) and compared with the English one.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Page = { title: string; html: string };
type Legal = Record<string, Page>;

function load(file: string, name: string): Legal {
  return new Function(readFileSync(`public/shop/${file}`, "utf8") + `\nreturn ${name};`)() as Legal;
}

const EN = load("legal.en.js", "LEGAL_EN");
const BY_LANG: Record<string, Legal> = {
  RU: load("legal.ru.js", "LEGAL_RU"),
  ET: load("legal.et.js", "LEGAL_ET"),
};
const PAGES = Object.keys(EN);

/** The headings in order: «h2 7.» — the level and the number it is drawn with. */
function outline(html: string): string[] {
  return [...html.matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => {
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    const num = text.match(/^(\d+)\.\s/);
    return `h${m[1]}${num ? " " + num[1] + "." : ""}`;
  });
}

/** Every clause number, in the order the page prints them. */
function clauses(html: string): string[] {
  return [...html.matchAll(/<b>(\d+\.\d+)[\s<]/g)].map((m) => m[1]);
}

/** The shop details a page takes from settings.content, not from its own text. */
function placeholders(html: string): string[] {
  return [...new Set([...html.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].sort();
}

describe("the policy pages: RU and ET have the English page's structure", () => {
  it("every page exists in all three languages", () => {
    for (const [lang, legal] of Object.entries(BY_LANG)) {
      expect(Object.keys(legal).sort(), lang).toEqual([...PAGES].sort());
    }
  });

  for (const page of PAGES) {
    for (const lang of Object.keys(BY_LANG)) {
      it(`${page} · ${lang}: the same headings, at the same levels, with the same numbers`, () => {
        expect(outline(BY_LANG[lang][page].html)).toEqual(outline(EN[page].html));
      });

      it(`${page} · ${lang}: no heading drawn as a list of its own`, () => {
        const html = BY_LANG[lang][page].html;
        // each <ol> starts counting at 1 again — that is where «1.» on every section came from
        expect(html).not.toMatch(/<ol>\s*<ol>/);
        expect(html).not.toMatch(/<li>\s*<b>[^<]*<\/b>\s*<\/li>/);
        // …and none of the harvested Shopify shell around it
        expect(html).not.toMatch(/cdn\/shop|<main\b|<section\b/);
      });
    }
  }

  it("the terms of delivery number their sections 1, 2, 3 … in every language", () => {
    for (const legal of [EN, ...Object.values(BY_LANG)]) {
      const nums = outline(legal.shipping.html).filter((h) => h.startsWith("h2")).map((h) => Number(h.slice(3, -1)));
      expect(nums.length).toBeGreaterThan(10);
      expect(nums).toEqual(nums.map((_, i) => i + 1));
    }
  });

  it("…and their clauses N.1, N.2 … inside each section, the same as in English", () => {
    const en = clauses(EN.shipping.html);
    for (const [lang, legal] of Object.entries(BY_LANG)) {
      expect(clauses(legal.shipping.html), lang).toEqual(en);
    }
    // the English sequence itself: each section's clauses start at .1 and never repeat or jump
    let prev = [0, 0];
    for (const c of en) {
      const [s, n] = c.split(".").map(Number);
      if (s === prev[0]) expect(n, c).toBe(prev[1] + 1);
      else expect([s, n], c).toEqual([prev[0] + 1, 1]);
      prev = [s, n];
    }
  });

  it("names the company, the address and the contacts from the shop's settings, like English", () => {
    for (const page of ["shipping", "returns", "contact"]) {
      for (const [lang, legal] of Object.entries(BY_LANG)) {
        expect([page, lang, placeholders(legal[page].html)]).toEqual([page, lang, placeholders(EN[page].html)]);
      }
    }
  });
});
