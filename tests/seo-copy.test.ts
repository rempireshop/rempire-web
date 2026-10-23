/**
 * The head a crawler is served and the head it reads after the shop boots are
 * one text (SEO audit 08.10.2026, W4/T2; the words are its §1A).
 *
 * Three renderers write a page's <title> and meta description: the prerender
 * (tools/prerender-shop2.mjs), the request-time pages (src/lib/*-page.ts) and
 * setHead() in public/shop2/app.js. Until 09.10.2026 they read three tables,
 * and a section page was «Habemehooldus — osta Rempire'ist» static and
 * «Habemehooldus — REMPIRE» rendered. Now the first two import
 * src/lib/seo-copy.mjs and app.js carries a copy of its block.
 *
 * So this file:
 *   · holds app.js's copy to the module, byte for byte;
 *   · runs BOTH copies — the module as the prerender imports it, the block
 *     lifted out of app.js as the browser runs it — over every page of a kind
 *     (home, the eight sections, every catalogue brand, the blog list, every
 *     catalogue product) in every language, and wants the same head;
 *   · checks that the renderers actually call it;
 *   · holds every §1A title to 60 characters and description to 155;
 *   · and checks that the one figure the copy quotes comes from the rules.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  SEO_DESC_MAX, SEO_TITLE_MAX, seoCopy, seoHead, seoPriceText, seoProductCore, seoProductTitle,
} from "@/lib/seo-copy.mjs";
import { LANGS, productSpec } from "@/lib/seo-head.mjs";
import { seoCopyBlock } from "../tools/lib/seo-copy-block.mjs";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const APP = read("../public/shop2/app.js");
const MODULE = read("../src/lib/seo-copy.mjs");
const PRERENDER = read("../tools/prerender-shop2.mjs");
const CATALOGUE = new Function(read("../public/shop/catalogue2.js") + "\nreturn CATALOGUE;")() as Array<{
  id: string; brand: string; name: string; cat: string; price: number; priceFrom?: boolean;
}>;

type Head = { t: string; d: string; ogT: string; ogD: string };
type Copy = {
  seoHead: (kind: string, key: string, lang: string, ctx: unknown) => Head;
  seoPriceText: (price: number, from: boolean, lang: string) => string;
  seoProductCore: (id: string, core: string, lang: string) => string;
  seoProductTitle: (core: string, priceText: string) => string;
};

/* app.js, line by line — the prerender lifts its dictionary the same way. */
const appLines = APP.replace(/\r\n?/g, "\n").split("\n");
function sliceFrom(start: RegExp, end: RegExp): string {
  const i = appLines.findIndex((l) => start.test(l));
  if (i < 0) throw new Error("app.js has no line matching " + start);
  for (let j = i + 1; j < appLines.length; j++) if (end.test(appLines[j])) return appLines.slice(i, j + 1).join("\n");
  throw new Error("no end for " + start);
}
const DECL_END = /^ {2}[}\]];$/;
const FN_END = /^ {2}}$/;

/** The copy as the BROWSER runs it: the block out of app.js, in a bare VM. */
const browser = runInNewContext(
  seoCopyBlock(APP) + "\n({ seoHead: seoHead, seoPriceText: seoPriceText, seoProductCore: seoProductCore, seoProductTitle: seoProductTitle });",
) as Copy;

/** trText() as both the prerender and the browser translate a product name. */
const trText = runInNewContext([
  sliceFrom(/^ {2}var UI = \{$/, DECL_END),
  sliceFrom(/^ {2}var UI_RX = \[$/, DECL_END),
  sliceFrom(/^ {2}var NAME_TAILS = \{$/, DECL_END),
  sliceFrom(/^ {2}var NAME_FRAGS = \[$/, DECL_END),
  sliceFrom(/^ {2}var TAIL_EXACT = \{$/, DECL_END),
  sliceFrom(/^ {2}function trName\(s, lang\) \{$/, FN_END),
  sliceFrom(/^ {2}function trText\(s, lang, allowName\) \{$/, FN_END),
].join("\n") + "\ntrText;") as (s: string, lang: string, allowName: boolean) => string;
const trName = (name: string, lang: string) => (lang === "RU" ? name : trText(name, lang, true));

/** One line of app.js, found by its start. */
const appLine = (start: RegExp): string => {
  const l = appLines.find((x) => start.test(x));
  if (!l) throw new Error("app.js has no line matching " + start);
  return l;
};
/** setHead()'s product description as the BROWSER computes it: the block,
    the dictionary trText() reads the delivery line from, and descFromText()
    with the helpers it calls — all lifted out of app.js, run in a bare VM. */
const browserDesc = runInNewContext([
  sliceFrom(/^ {2}var UI = \{$/, DECL_END),
  sliceFrom(/^ {2}var UI_RX = \[$/, DECL_END),
  sliceFrom(/^ {2}var NAME_TAILS = \{$/, DECL_END),
  sliceFrom(/^ {2}var NAME_FRAGS = \[$/, DECL_END),
  sliceFrom(/^ {2}var TAIL_EXACT = \{$/, DECL_END),
  sliceFrom(/^ {2}function trName\(s, lang\) \{$/, FN_END),
  sliceFrom(/^ {2}function trText\(s, lang, allowName\) \{$/, FN_END),
  seoCopyBlock(APP),
  appLine(/^ {2}var SHOUT_RX = /),
  appLine(/^ {2}function dropShout\(s\) \{ .* \}$/),
  sliceFrom(/^ {2}function clipDesc\(s, max\) \{$/, FN_END),
  appLine(/^ {2}var DESC_MAX = 158;$/),
  sliceFrom(/^ {2}function descFromText\(text, priceText, stockText, lang\) \{$/, FN_END),
].join("\n") + "\n({ descFromText: descFromText, seoSnippetText: seoSnippetText, seoProductMeta: seoProductMeta });") as {
  descFromText: (text: string, priceText: string, stockText: string, lang: string) => string;
  seoSnippetText: (html: string) => string;
  seoProductMeta: (id: string, lang: string) => string;
};
const loadTexts = (f: string, n: string) => new Function(read("../public/shop/" + f) + "\nreturn " + n + ";")() as Record<string, string>;
const TEXTS: Record<string, Record<string, string>> = {
  EN: loadTexts("content.js", "CONTENT"), RU: loadTexts("content.ru.js", "CONTENT_RU"), ET: loadTexts("content.et.js", "CONTENT_ET"),
};
/** Code without its comments — a comment may quote the very words a check forbids. */
const uncommented = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** settings.shipping_rules as the shop runs on 09.10.2026: 70 € in the Baltics, 200 € beyond. */
const LIVE = { rules: { freeFrom: 70, freeFromByCountry: { FI: 200, EU: 200 } } };
const CODES = ["RU", "ET", "EN"] as const;
const SECTIONS = ["all", "hair", "styling", "beard", "face", "body", "perfume", "merch"];
const BRANDS = [...new Set(CATALOGUE.map((p) => p.brand))];
const PAGES: Array<[string, string]> = [
  ["home", ""], ["blog", ""],
  ...SECTIONS.map((c) => ["cat", c] as [string, string]),
  ...BRANDS.map((b) => ["brand", b] as [string, string]),
];

describe("app.js carries the copy the prerender imports", () => {
  it("byte for byte, between the markers", () => {
    const own = seoCopyBlock(MODULE);
    expect(own, "src/lib/seo-copy.mjs has lost its markers").not.toBeNull();
    expect(seoCopyBlock(APP), "run: node tools/sync-seo-copy.mjs").toBe(own);
  });

  it("is written so the browser can run it — no ES2015 syntax inside the block", () => {
    const block = uncommented(seoCopyBlock(MODULE) ?? "");
    expect(block).not.toMatch(/=>|`|\b(?:const|let|class)\s/);
  });
});

describe("static head == rendered head", () => {
  for (const code of CODES) {
    it(`every home, section, brand and blog page in ${code}`, () => {
      for (const ctx of [LIVE, { rules: { freeFrom: 59, freeFromByCountry: { EU: 200 } } }, { rules: { freeFrom: null } }, null]) {
        for (const [kind, key] of PAGES) {
          expect(browser.seoHead(kind, key, code, ctx), `${kind}/${key}`).toEqual(seoHead(kind, key, code, ctx));
        }
      }
    });

    it(`every catalogue product's title in ${code} — productSpec() against setHead()'s three calls`, () => {
      const lang = LANGS.find((l) => l.code === code)!;
      for (const p of CATALOGUE) {
        const name = trName(p.name, code);
        const staticTitle = productSpec({
          base: "https://rempireshop.com", lang, id: p.id, cat: p.cat, catName: "x", brand: p.brand, name,
          price: p.price, priceFrom: !!p.priceFrom, stock: "in", seoTitle: "", seoDesc: "", body: "", image: "", imageUrls: [],
        }).title;
        const core = p.brand + " " + name;
        const rendered = browser.seoProductTitle(
          browser.seoProductCore(p.id, core, code),
          browser.seoPriceText(p.price, !!p.priceFrom, code),
        );
        expect(rendered, p.id).toBe(staticTitle);
        expect(staticTitle.length, p.id).toBeLessThanOrEqual(SEO_TITLE_MAX);
        expect(staticTitle, p.id).not.toMatch(/купить в Rempire|osta Rempire'ist|buy at Rempire|— REMPIRE$/);
      }
    });

    /* The meta description, since 09.10.2026: the hand-written line where
       there is one (seoProductMeta()), else whole sentences of the product's
       text (seoLead()) read from the same plain text (seoSnippetText()) — the
       static page through productSpec(), the page after boot through
       setHead()'s own descFromText(). They used to cut the same text two
       ways: the shop read it through stripTags(), which runs a heading line
       into the copy. */
    it(`every catalogue product's description in ${code} — productSpec() against setHead()`, () => {
      const lang = LANGS.find((l) => l.code === code)!;
      const seo = CATALOGUE as Array<(typeof CATALOGUE)[number] & { seo?: { d?: string } }>;
      let compared = 0;
      for (const p of seo) {
        // the body the prerender writes the description from (productPage())
        const html = code === "EN" && p.seo && p.seo.d ? p.seo.d : (code !== "EN" && TEXTS[code][p.id]) || TEXTS.EN[p.id] || "";
        if (!browserDesc.seoSnippetText(html)) continue;
        const staticDesc = productSpec({
          base: "https://rempireshop.com", lang, id: p.id, cat: p.cat, catName: "x", brand: p.brand, name: trName(p.name, code),
          price: p.price, priceFrom: !!p.priceFrom, stock: "in", seoTitle: "", seoDesc: "", body: html, image: "", imageUrls: [],
        }).desc;
        const rendered = browserDesc.seoProductMeta(p.id, code) ||
          browserDesc.descFromText(browserDesc.seoSnippetText(html), "", "", code);
        expect(rendered, p.id).toBe(staticDesc);
        compared++;
      }
      expect(compared).toBe(CATALOGUE.length);
    });
  }
});

describe("the renderers call the copy", () => {
  it("setHead() in app.js — home, section, brand, blog and product", () => {
    const setHead = sliceFrom(/^ {2}function setHead\(\) \{$/, FN_END);
    expect(setHead).toContain('seoHead("home", "", S.lang, seoCtx())');
    expect(setHead).toContain('seoHead("brand", S.brand, S.lang, seoCtx())');
    expect(setHead).toContain('seoHead("cat", S.cat, S.lang, seoCtx())');
    expect(setHead).toContain('seoHead("blog", "", S.lang, seoCtx())');
    expect(setHead).toContain("seoProductTitle(seoProductCore(p.id, core, S.lang), priceText)");
    expect(setHead).toContain("seoPriceText(p.price, p.priceFrom, S.lang)");
    expect(setHead).toContain('setMetaProp("og:title", ogT || t)');
    expect(uncommented(setHead)).not.toMatch(/купить в Rempire|osta Rempire'ist|buy at Rempire/);
    expect(APP).toContain("function seoCtx() { return { rules: SHIP_RULES }; }");
  });

  it("the prerender — home, sections, brands and the blog list", () => {
    expect(PRERENDER).toContain('seoHead("home", "", code, SEO_CTX)');
    expect(PRERENDER).toContain('seoHead("cat", c, lang.code, SEO_CTX)');
    expect(PRERENDER).toContain('seoHead("brand", b, lang.code, SEO_CTX)');
    expect(PRERENDER).toContain('seoHead("blog", "", code, SEO_CTX)');
    expect(PRERENDER).toContain("const SEO_CTX = { rules: SHIP_RULES_LIVE };");
    expect(PRERENDER).not.toMatch(/t\.(?:homeDesc|catDesc|brandDesc|blogDesc)/);
  });

  it("the request-time blog list", () => {
    expect(read("../src/lib/blog-page.ts")).toContain('seoHead("blog", "", code, null)');
  });
});

describe("audit §1A limits — 60 characters a title, 155 a description", () => {
  it("holds for every page of every kind, in every language, at any threshold", () => {
    const long: string[] = [];
    for (const ctx of [LIVE, { rules: { freeFrom: 1999.99 } }, { rules: { freeFrom: null } }]) {
      for (const code of CODES) {
        for (const [kind, key] of [...PAGES, ["brand", "A Brand Nobody Has Heard Of Yet, Ltd."] as [string, string]]) {
          const h = seoHead(kind, key, code, ctx);
          for (const [what, s, max] of [["t", h.t, SEO_TITLE_MAX], ["ogT", h.ogT, SEO_TITLE_MAX], ["d", h.d, SEO_DESC_MAX], ["ogD", h.ogD, SEO_DESC_MAX]] as const) {
            if (!s) long.push(`${code} ${kind}/${key} ${what} is empty`);
            if (s.length > max) long.push(`${code} ${kind}/${key} ${what} ${s.length}: ${s}`);
          }
        }
      }
    }
    expect(long).toEqual([]);
  });

  it("writes the approved words — the home pages and two sections, as §1A has them", () => {
    expect(seoHead("home", "", "EN", LIVE).t).toBe("REMPIRE — Hair, Beard & Skin Care from a Tallinn Salon");
    expect(seoHead("home", "", "ET", LIVE).t).toBe("REMPIRE — juukse-, habeme- ja nahahooldus Tallinnas");
    expect(seoHead("home", "", "RU", LIVE).t).toBe("REMPIRE — уход за волосами, бородой и кожей в Таллинне");
    expect(seoHead("home", "", "EN", LIVE).ogT).toBe("REMPIRE — salon hair, beard & skin care, Tallinn");
    expect(seoHead("cat", "beard", "ET", LIVE).t).toBe("Habemehooldus: habemeõli, habemepalsam, raseerimine");
    expect(seoHead("cat", "styling", "ET", LIVE).t).toBe("Viimistlus: juuksevaha, pasta, savi ja juukselakk");
    // «| REMPIRE» is written in the house form, as fitTitle() writes it everywhere else
    expect(seoHead("cat", "all", "EN", LIVE).t).toBe("All Products: Hair, Beard, Skin Care & Perfume — REMPIRE");
  });

  it("gives a brand with no text of its own the template's fallback, never the filler", () => {
    expect(seoHead("brand", "Paul Mitchell", "EN", LIVE).t).toBe("Paul Mitchell in Tallinn — REMPIRE");
    expect(seoHead("brand", "Paul Mitchell", "ET", LIVE).t).toBe("Paul Mitchell Tallinnas — REMPIRE");
    expect(seoHead("brand", "Paul Mitchell", "RU", LIVE).t).toBe("Paul Mitchell в Таллинне — REMPIRE");
    // the house's own brand does not get the house's name twice
    expect(seoHead("brand", "Rempire", "EN", LIVE).t).toBe("Rempire in Tallinn");
  });
});

describe("the product-title rule", () => {
  it("spends the line on the product and the price, not on «— купить в Rempire»", () => {
    expect(seoProductTitle("Kevin.Murphy Night.Rider — paste for styling", seoPriceText(11, true, "EN")))
      .toBe("Kevin.Murphy Night.Rider — paste for styling · from €11");
    expect(seoPriceText(7.9, true, "RU")).toBe("от 7,90 €");
    expect(seoPriceText(165, false, "ET")).toBe("165 €");
    /* too long for the price: the name alone, never the site's name */
    expect(seoProductTitle("A".repeat(55), "9 €")).toBe("A".repeat(55));
    expect(seoProductTitle("Word ".repeat(20).trim(), "9 €").length).toBeLessThanOrEqual(60);
  });

  it("adds the two Russian aliases Search Console shows, in Russian only", () => {
    expect(seoProductCore("system-4-special-shampoo-1", "System 4 Special Shampoo 1 — шампунь", "RU"))
      .toBe("System 4 Special Shampoo 1 — шампунь №1");
    expect(seoProductCore("xerjoff-1861-naxos-eau-de-parfum-100ml", "Xerjoff 1861 Naxos Eau de Parfum — парфюм", "RU"))
      .toBe("Xerjoff 1861 Naxos Eau de Parfum (Ксерджофф Наксос) — парфюм");
    expect(seoProductCore("system-4-special-shampoo-1", "System 4 Special Shampoo 1 — shampoo", "EN"))
      .toBe("System 4 Special Shampoo 1 — shampoo");
    expect(Object.keys(seoCopy().ruAlias).sort()).toEqual(["system-4-special-shampoo-1", "xerjoff-1861-naxos-eau-de-parfum-100ml"]);
  });
});

describe("the one figure in the copy comes from the rules", () => {
  it("prints the Estonian threshold the checkout bills with — and drops the promise when there is none", () => {
    expect(seoHead("home", "", "ET", LIVE).d).toMatch(/tasuta tarne alates 70 €\.$/);
    expect(seoHead("home", "", "ET", { rules: { freeFrom: 59 } }).d).toMatch(/alates 59 €\.$/);
    expect(seoHead("home", "", "ET", { rules: { freeFrom: 70, freeFromByCountry: { EE: 45 } } }).d).toMatch(/alates 45 €\.$/);
    const none = seoHead("home", "", "ET", { rules: { freeFrom: null } }).d;
    expect(none).not.toMatch(/tasuta|€/);
    expect(none).toMatch(/Järeletulek Mardi 1 või tarne üle Euroopa\.$/);
  });

  it("gives System 4, Kevin.Murphy and Captain Fawcett the same threshold — and their approved line back when it is off", () => {
    for (const b of ["System 4", "Kevin.Murphy", "Captain Fawcett"] as const) {
      for (const code of ["RU", "ET", "EN"] as const) {
        const d = seoHead("brand", b, code, LIVE).d;
        expect(d.length, `${b} ${code}`).toBeLessThanOrEqual(155);
        expect(d, `${b} ${code}`).toMatch(code === "EN" ? /€70\.$/ : /70 €\.$/);
        expect(d, `${b} ${code}`).not.toContain("…");
        expect(seoHead("brand", b, code, { rules: { freeFrom: null } }).d).toBe(seoCopy().brand[b][code].meta);
      }
    }
    expect(seoHead("brand", "Kevin.Murphy", "ET", LIVE).d)
      .toBe("Kevin.Murphy laos Tallinnas: Angel ja Hydrate-Me šampoonid ja maskid, Night.Rider viimistlus. Järeletulek Mardi 1, tasuta tarne Baltikumis alates 70 €.");
    /* a brand without one keeps its approved description */
    expect(seoHead("brand", "Davines", "ET", LIVE).d).toBe(seoCopy().brand.Davines.ET.meta);
  });

  it("types no threshold anywhere in the copy", () => {
    const block = uncommented(seoCopyBlock(MODULE) ?? "");
    expect(block).toContain("{free}");
    expect(block).not.toMatch(/(?:alates|from|от)\s*€?\d+\s*€?(?!\s*(?:ml|мл|%))/i);
  });
});
