/**
 * The eight brands with a text of their own (Dim, 09.10.2026 —
 * Rempire/seo/brand-intros.json, intros with the history trimmed): System 4,
 * Kevin.Murphy, Davines, Captain Fawcett, Proraso, Creed, Xerjoff, Byredo.
 * Each has, in RU, ET and EN, a title, a meta description and a visible
 * paragraph under the heading — two different texts where the static page
 * used to print the meta description as the paragraph. Every other brand
 * falls back: the template's title, the description brand pages always
 * carried, the shop's own line under the heading.
 *
 * The words live in src/lib/seo-copy.mjs; app.js carries the same block
 * (tests/seo-copy.test.ts), so this runs the module and the block lifted out
 * of app.js side by side, and checks that both renderers put the paragraph
 * where the other one does.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { SEO_DESC_MAX, SEO_TITLE_MAX, seoBrandIntro, seoCopy, seoHead, seoHouse } from "@/lib/seo-copy.mjs";
import { seoCopyBlock } from "../tools/lib/seo-copy-block.mjs";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const APP = read("../public/shop2/app.js");
const PRERENDER = read("../tools/prerender-shop2.mjs");
const CATALOGUE = new Function(read("../public/shop/catalogue2.js") + "\nreturn CATALOGUE;")() as Array<{ brand: string }>;

type Head = { t: string; d: string; ogT: string; ogD: string };
const browser = runInNewContext(seoCopyBlock(APP) + "\n({ seoHead: seoHead, seoBrandIntro: seoBrandIntro });") as {
  seoHead: (kind: string, key: string, lang: string, ctx: unknown) => Head;
  seoBrandIntro: (brand: string, lang: string) => string;
};

const OWN = ["System 4", "Kevin.Murphy", "Davines", "Captain Fawcett", "Proraso", "Creed", "Xerjoff", "Byredo"];
const CODES = ["RU", "ET", "EN"] as const;
type Text = { title: string; meta: string; intro: string };
const COPY = seoCopy().brand as Record<string, Record<string, Text>>;
const words = (s: string) => s.trim().split(/\s+/).length;

describe("the eight brands with their own text", () => {
  it("are exactly the eight, and every one of them is a brand the catalogue sells", () => {
    expect(Object.keys(COPY).sort()).toEqual([...OWN].sort());
    const sold = new Set(CATALOGUE.map((p) => p.brand));
    for (const b of OWN) expect(sold.has(b), b).toBe(true);
  });

  for (const b of OWN) {
    for (const code of CODES) {
      it(`${b} — ${code}: its title, its meta description and its intro, on both sides`, () => {
        const own = COPY[b][code];
        expect(own, `${b} ${code}`).toBeTruthy();
        const h = seoHead("brand", b, code, null);
        /* the title as approved, in the house form fitTitle() writes («| REMPIRE» → «— REMPIRE») */
        expect(h.t).toBe(seoHouse(own.title));
        expect(h.t).toMatch(/ — REMPIRE$/);
        expect(h.t.length).toBeLessThanOrEqual(SEO_TITLE_MAX);
        expect(h.d).toBe(own.meta);
        expect(h.d.length).toBeLessThanOrEqual(SEO_DESC_MAX);
        expect(h.ogT).toBe(h.t);
        expect(h.ogD).toBe(h.d);
        /* the paragraph is not the snippet */
        expect(seoBrandIntro(b, code)).toBe(own.intro);
        expect(own.intro).not.toBe(own.meta);
        expect(words(own.intro)).toBeGreaterThanOrEqual(25);
        expect(words(own.intro)).toBeLessThanOrEqual(70);
        /* …in the page's own language: no Cyrillic on an ET or EN page but the alias the RU one carries */
        if (code !== "RU") expect(own.intro + own.meta + own.title).not.toMatch(/[А-Яа-яЁё]/);
        /* the browser's copy says the same */
        expect(browser.seoHead("brand", b, code, null)).toEqual(h);
        expect(browser.seoBrandIntro(b, code)).toBe(own.intro);
      });
    }
  }

  it("says what the brief asked for in the words searchers use", () => {
    expect(seoHead("brand", "Kevin.Murphy", "EN", null).t).toBe("Kevin.Murphy: Shampoos, Masks & Styling — REMPIRE");
    expect(seoHead("brand", "System 4", "RU", null).t).toBe("System 4 (Sim Sensitive): шампуни №1–4 и сыворотка — REMPIRE");
    expect(seoHead("brand", "Xerjoff", "RU", null).t).toContain("Ксерджофф");
    expect(seoBrandIntro("Captain Fawcett", "ET")).toContain("habemeõlid");
  });
});

describe("every other brand falls back", () => {
  const others = [...new Set(CATALOGUE.map((p) => p.brand))].filter((b) => !OWN.includes(b));

  it("to the template's title, the description brand pages always carried, and no paragraph of its own", () => {
    expect(others.length).toBeGreaterThan(10);
    for (const b of others) {
      for (const code of CODES) {
        expect(seoBrandIntro(b, code), `${b} ${code}`).toBe("");
        expect(browser.seoBrandIntro(b, code), `${b} ${code}`).toBe("");
        const h = seoHead("brand", b, code, null);
        expect(browser.seoHead("brand", b, code, null)).toEqual(h);
        expect(h.t.length, b).toBeLessThanOrEqual(SEO_TITLE_MAX);
        expect(h.d.length, b).toBeLessThanOrEqual(SEO_DESC_MAX);
      }
    }
    expect(seoHead("brand", "Paul Mitchell", "EN", null)).toMatchObject({
      t: "Paul Mitchell in Tallinn — REMPIRE",
      d: "Paul Mitchell in stock at Rempire, Tallinn — the brand's full range across every section of the shop.",
    });
    expect(seoHead("brand", "Paul Mitchell", "ET", null).d).toBe("Paul Mitchell laos Rempire'is, Tallinn — kogu brändi valik kõigist poe osakondadest.");
    expect(seoHead("brand", "Paul Mitchell", "RU", null).d).toBe("Paul Mitchell в наличии в Rempire, Таллинн — весь ассортимент бренда во всех разделах магазина.");
  });
});

describe("both renderers put the paragraph under the heading", () => {
  it("the prerender: the brand's own intro, else the shop's line", () => {
    expect(PRERENDER).toContain('intro: seoBrandIntro(b, lang.code) || tr(catIntro("", b), lang.code, false)');
    expect(PRERENDER).toContain("'<p class=\"sec__intro\">' + esc(intro) + \"</p>\"");
  });

  it("app.js: the same choice in screenCatalog(), kept off the dictionary", () => {
    // a section's line comes from the block too since «Тексты страниц» (26.10.2026, tests/page-texts.test.ts)
    expect(APP).toContain("var ownIntro = S.brand ? seoBrandIntro(S.brand, S.lang) : seoCatIntro(S.cat, S.lang);");
    expect(APP).toContain("var intro = esc(ownIntro || catIntro(S.cat, S.brand));");
    expect(APP).toContain("'<p class=\"sec__intro\"' + (ownIntro ? \" data-notr\" : \"\") + \">\" + intro + \"</p>\"");
  });
});
