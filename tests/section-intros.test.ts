/**
 * The line under each section's heading (CAT_INTROS / catIntro() in
 * public/shop2/app.js; the prerender writes the same line into the static
 * .sec__intro). Rewritten 09.10.2026 so each names the subtypes people search
 * for (SEO audit §1, §7.3 — habemeõli, habemepalsam, juuksevaha, palsamid,
 * šampoonid, peanahahooldus; масло для бороды, воск для волос, шампуни, тонер),
 * in the same place and at about the same length, without touching the
 * headings. Russian is the key; the ET and EN lines live in the dictionary
 * and are what translateTree() and the prerender's tr() print.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const APP = read("../public/shop2/app.js");
const lines = APP.replace(/\r\n?/g, "\n").split("\n");
const slice = (start: RegExp, end: RegExp) => {
  const i = lines.findIndex((l) => start.test(l));
  if (i < 0) throw new Error("app.js has no " + start);
  for (let j = i + 1; j < lines.length; j++) if (end.test(lines[j])) return lines.slice(i, j + 1).join("\n");
  throw new Error("no end for " + start);
};
const DECL = /^ {2}[}\]];$/, FN = /^ {2}}$/;
const lifted = runInNewContext([
  slice(/^ {2}var UI = \{$/, DECL), slice(/^ {2}var UI_RX = \[$/, DECL),
  slice(/^ {2}var NAME_TAILS = \{$/, DECL), slice(/^ {2}var NAME_FRAGS = \[$/, DECL),
  slice(/^ {2}var TAIL_EXACT = \{$/, DECL), slice(/^ {2}function trName\(s, lang\) \{$/, FN),
  slice(/^ {2}function trText\(s, lang, allowName\) \{$/, FN),
  slice(/^ {2}var CAT_INTROS = \{$/, DECL), slice(/^ {2}function catIntro\(cat, brand\) \{$/, FN),
].join("\n") + "\n({ trText: trText, catIntro: catIntro, CAT_INTROS: CAT_INTROS });") as {
  trText: (s: string, lang: string, allowName: boolean) => string;
  catIntro: (cat: string, brand: string) => string;
  CAT_INTROS: Record<string, string>;
};
const intro = (cat: string, lang: "RU" | "ET" | "EN") =>
  lang === "RU" ? lifted.catIntro(cat, "") : lifted.trText(lifted.catIntro(cat, ""), lang, false);

const SECTIONS = ["all", "hair", "styling", "beard", "face", "body", "perfume", "merch"];

describe("section intros", () => {
  it("every section has its own line, in all three languages", () => {
    expect(Object.keys(lifted.CAT_INTROS).sort()).toEqual([...SECTIONS].sort());
    for (const cat of SECTIONS) {
      const ru = intro(cat, "RU");
      for (const lang of ["ET", "EN"] as const) {
        const t = intro(cat, lang);
        expect(t, `${cat} ${lang} is not translated`).not.toBe(ru);
        expect(t, `${cat} ${lang}`).not.toMatch(/[А-Яа-яЁё]/);
      }
    }
  });

  it("name the subtypes people search for", () => {
    const has = (cat: string, lang: "RU" | "ET" | "EN", words: string[]) => {
      for (const w of words) expect(intro(cat, lang).toLowerCase(), `${cat} ${lang}: ${w}`).toContain(w);
    };
    has("beard", "ET", ["habemeõli", "habemepalsam", "habemehooldus", "vuntsivaha"]);
    has("hair", "ET", ["šampoonid", "palsamid", "juuksemaskid", "peanahahooldus"]);
    has("styling", "ET", ["juuksevaha", "pasta", "savi"]);
    has("face", "ET", ["korea nahahooldus", "toonikud", "seerumid"]);
    has("body", "ET", ["tätoveeringu", "käsitööseep"]);
    has("perfume", "ET", ["nišiparfüümid"]);
    has("beard", "RU", ["масло для бороды", "воск для усов"]);
    has("styling", "RU", ["воск для волос"]);
    has("hair", "RU", ["шампуни", "кондиционеры", "уход за кожей головы"]);
    has("face", "RU", ["корейская косметика", "тонеры"]);
    has("beard", "EN", ["beard oil", "beard balm", "moustache wax"]);
    has("styling", "EN", ["hair wax", "paste", "clay"]);
    has("hair", "EN", ["shampoos", "conditioners", "scalp care"]);
    has("face", "EN", ["korean skincare", "toners"]);
  });

  /* 16.10.2026: the Estonian beard and hair lines were rewritten longer, in the
     words Search Console shows Estonians typing (Dim approved both texts as
     they stand) — two sentences each; every other line stays one line long */
  const LONGER: Record<string, number> = { "beard ET": 280, "hair ET": 260 };

  it("stay the length of a line under a heading — one or two sentences, about what they were", () => {
    for (const cat of SECTIONS) {
      for (const lang of ["RU", "ET", "EN"] as const) {
        const t = intro(cat, lang);
        expect(t.length, `${cat} ${lang}: ${t}`).toBeLessThanOrEqual(LONGER[`${cat} ${lang}`] ?? 105);
        expect((t.match(/[.!?](\s|$)/g) || []).length, `${cat} ${lang}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("do not invent the compound the owner asked us to avoid", () => {
    for (const cat of SECTIONS) expect(intro(cat, "ET")).not.toMatch(/hoolduspood/i);
  });

  it("leave the headings alone", () => {
    const names = new Function(read("../public/shop/catalogue2.js") + "\nreturn CAT_NAMES;")() as Record<string, string>;
    expect(names).toEqual({
      hair: "Уход за волосами", styling: "Стайлинг", beard: "Уход за бородой", face: "Уход за лицом",
      body: "Уход за телом", perfume: "Парфюмерия", merch: "Мерч",
    });
  });

  it("are the line both renderers print", () => {
    expect(APP).toContain("var intro = esc(ownIntro || catIntro(S.cat, S.brand));");
    expect(read("../tools/prerender-shop2.mjs")).toContain('intro: tr(catIntro(c, ""), lang.code, false)');
  });
});
