/**
 * The meta descriptions written by hand for the products people search for
 * (Dim, 09.10.2026) — src/lib/seo-copy.mjs `productMeta`, read through
 * seoProductMeta() by productSpec() (the prerender and the request-time page)
 * and by setHead() in public/shop2/app.js.
 *
 * Search Console's top product queries were answered by clipped supplier
 * text: «Scalp circulatory stimulating serum. Serum that stimulates the
 * superficial circulation of the… · delivery across Estonia and the Baltics ·
 * pickup in Tallinn». Each line here says what the product is, who it is for
 * and one fact from its own text, in the shopper's words, whole, in 155
 * characters — cosmetic effects only.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { SEO_DESC_MAX, seoCopy, seoMetaWithPrice, seoPriceText, seoProductMeta, seoProductTail } from "@/lib/seo-copy.mjs";
import { DESC_MAX, descFrom, LANGS, productSpec, T, textForSnippet } from "@/lib/seo-head.mjs";
import { claimIn } from "./claim-words";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
type P = { id: string; brand: string; name: string; cat: string; price: number; priceFrom?: boolean };
const CATALOGUE = new Function(read("../public/shop/catalogue2.js") + "\nreturn CATALOGUE;")() as P[];
const MIN = catalogueMin as Array<{ id: string }>;
const META = seoCopy().productMeta as Record<string, Record<"RU" | "ET" | "EN", string>>;
const CODES = ["RU", "ET", "EN"] as const;
const APP = read("../public/shop2/app.js");
const TEXT_EN = new Function(read("../public/shop/content.js") + "\nreturn CONTENT;")() as Record<string, string>;

/* The products the brief names: the whole System 4 range, three
   Kevin.Murphy pastes, the grey Grunge Mat, the Azur Lime balm, both Aventus. */
const NAMED = [
  "free-hold", "night-rider", "rough-rider",
  "gatsby-moving-rubber-grunge-mat-grey-hair-wax",
  "proraso-azur-lime-after-shave-balm-100-ml",
  "creed-aventus-eau-de-parfum-for-men-50ml", "creed-creed-aventus-cologne-50ml",
  /* 16.10.2026: the twelve most-shown Kevin.Murphy products in Search Console
     with no line of their own yet — approved by Dim the same day */
  "kevin-murphy-hydrate-me-masque", "heated-defense", "touchable", "repair-me-wash", "super-goo",
  "kevin-murphy-un-tangled-spray", "bedroom-hair", "kevin-murphy-motion-lotion", "anti-gravity-spray",
  "hair-resort-spray", "powder-puff", "kevin-murphy-angel-wash",
];
const SYSTEM_4 = CATALOGUE.filter((p) => p.brand === "System 4").map((p) => p.id);

const specFor = (id: string, code: (typeof CODES)[number], seoDesc = "") => {
  const p = CATALOGUE.find((x) => x.id === id)!;
  return productSpec({
    base: "https://rempireshop.com", lang: LANGS.find((l) => l.code === code)!, id, cat: p.cat, catName: "x",
    brand: p.brand, name: p.name, price: p.price, priceFrom: !!p.priceFrom, stock: "in", seoTitle: "", seoDesc,
    body: TEXT_EN[id] || "<p>Text.</p>", image: "", imageUrls: [],
  });
};

describe("the table", () => {
  it("covers exactly the products the brief names — the whole System 4 range among them", () => {
    expect(SYSTEM_4).toHaveLength(12);
    expect(Object.keys(META).sort()).toEqual([...SYSTEM_4, ...NAMED].sort());
  });

  it("names only products that exist, in both copies of the catalogue — never an owner's own (c-…) product", () => {
    const min = new Set(MIN.map((p) => p.id));
    for (const id of Object.keys(META)) {
      expect(CATALOGUE.some((p) => p.id === id), id).toBe(true);
      expect(min.has(id), id).toBe(true);
      expect(id.startsWith("c-"), id).toBe(false);
    }
  });

  it("has all three languages, each whole and inside what a result listing prints", () => {
    for (const [id, m] of Object.entries(META)) {
      expect(Object.keys(m).sort(), id).toEqual(["EN", "ET", "RU"]);
      for (const code of CODES) {
        const s = m[code];
        expect(s.length, `${id} ${code}: ${s.length}`).toBeLessThanOrEqual(SEO_DESC_MAX);
        expect(s.length, `${id} ${code}`).toBeGreaterThanOrEqual(100);
        expect(s, `${id} ${code}`).not.toContain("…");
        expect(s, `${id} ${code}`).toBe(s.trim());
        expect(s, `${id} ${code}`).toMatch(/[.a-zа-яёõäöüšž0-9)]$/i);
      }
      expect(m.ET, `${id} ET`).not.toMatch(/[А-Яа-яЁё]/);
      expect(m.EN, `${id} EN`).not.toMatch(/[А-Яа-яЁё]/);
    }
  });

  it("makes no disease or treatment claim — the word list the product texts are held to", () => {
    const bad: string[] = [];
    for (const [id, m] of Object.entries(META)) {
      for (const code of CODES) {
        const hit = claimIn(m[code]);
        if (hit) bad.push(`${id} ${code}: «${hit}»`);
      }
    }
    expect(bad).toEqual([]);
    // nor the phrases the brief rules out by name
    const all = Object.values(META).flatMap((m) => CODES.map((c) => m[c])).join("\n");
    expect(all).not.toMatch(/stops? hair loss|против выпадения|juuste väljalangemise vastu|лечит|treats?\b/i);
  });

  it("names the brand in every line", () => {
    for (const [id, m] of Object.entries(META)) {
      const brand = CATALOGUE.find((p) => p.id === id)!.brand;
      for (const code of CODES) expect(m[code], `${id} ${code}`).toContain(brand);
    }
  });

  it("System 4's numbered shampoos say their number and the scalp they are for", () => {
    const WANT: Record<string, { n: string; ru: RegExp; et: RegExp; en: RegExp }> = {
      "system-4-special-shampoo-1": { n: "1", ru: /жирной кожи головы, склонной к перхоти/, et: /rasusele, kõõmale kalduvale peanahale/, en: /oily, dandruff-prone scalp/ },
      "system-4-balancing-shampoo-2": { n: "2", ru: /сухой кожи головы, склонной к перхоти/, et: /kuivale, kõõmale kalduvale peanahale/, en: /dry, dandruff-prone scalp/ },
      "system-4-mild-shampoo-3": { n: "3", ru: /мягкий шампунь на каждый день/, et: /igapäevaseks pesuks/, en: /gentle everyday shampoo/ },
      "system-4-shale-oil-shampoo-4": { n: "4", ru: /очень жирных волос и чувствительной кожи головы/, et: /väga rasustele juustele ja tundlikule peanahale/, en: /very oily hair and a sensitive scalp/ },
    };
    for (const [id, w] of Object.entries(WANT)) {
      // «номер 1», as people type it (Search Console 15.10.2026: «шампунь номер 1», «system 4 шампунь 1»);
      // the page title keeps «шампунь №1»
      expect(META[id].RU, id).toContain("Шампунь System 4 номер " + w.n);
      expect(META[id].ET, id).toContain("System 4 šampoon nr " + w.n);
      expect(META[id].EN, id).toContain("(No. " + w.n + ")");
      expect(META[id].RU, id).toMatch(w.ru);
      expect(META[id].ET, id).toMatch(w.et);
      expect(META[id].EN, id).toMatch(w.en);
    }
  });

  it("states sizes the catalogue actually sells", () => {
    /* every «75–500 мл» / «30 и 100 г» / «50 or 150 ml» in a line names the
       product's own smallest and largest size */
    let checked = 0;
    for (const [id, m] of Object.entries(META)) {
      const p = CATALOGUE.find((x) => x.id === id)! as P & { sizes?: string[] };
      const sizes = (p.sizes || []).map((s) => Number((/\d+/.exec(s) || ["0"])[0]));
      for (const code of CODES) {
        const range = /(\d+)(?:–|, \d+ or | и | ja | or )(\d+) (?:мл|ml|г|g)(?![a-zа-яё])/.exec(m[code]);
        if (!range) continue;
        expect(sizes, `${id} ${code}`).toContain(Number(range[1]));
        expect(sizes, `${id} ${code}`).toContain(Number(range[2]));
        expect(Math.min(...sizes), `${id} ${code}`).toBe(Number(range[1]));
        expect(Math.max(...sizes), `${id} ${code}`).toBe(Number(range[2]));
        checked++;
      }
    }
    // the System 4 range and the three pastes, in three languages
    expect(checked).toBeGreaterThanOrEqual(40);
  });
});

describe("who wins", () => {
  /* Every word of a hand-written line stays; since 25.10.2026 the price — and
     «in stock» — follow it where they still fit (seoMetaWithPrice()), never a
     delivery line. */
  it("a hand-written line is the page's description, every word of it, with the price after it where it fits", () => {
    let priced = 0;
    for (const id of Object.keys(META)) {
      const p = CATALOGUE.find((x) => x.id === id)!;
      for (const code of CODES) {
        const desc = specFor(id, code).desc;
        expect(seoProductMeta(id, code)).toBe(META[id][code]);
        expect(desc, `${id} ${code}`).toBe(seoMetaWithPrice(META[id][code], seoPriceText(p.price, !!p.priceFrom, code), true, code, DESC_MAX));
        expect(desc.startsWith(META[id][code].replace(/\.$/, "")), `${id} ${code}`).toBe(true);
        expect(desc.length).toBeLessThanOrEqual(DESC_MAX);
        expect(desc).not.toMatch(/доставк|tarne|delivery/);
        if (desc !== META[id][code]) priced++;
      }
    }
    // most lines have room for the price
    expect(priced).toBeGreaterThan(Object.keys(META).length);
  });

  it("the owner's own description still wins over it", () => {
    expect(specFor("system-4-special-shampoo-1", "RU", "Свой текст владельца.").desc).toBe("Свой текст владельца.");
    // app.js: the owner's pair first, then the hand-written line, then the text
    expect(APP).toMatch(/d = so && so\.d \? so\.d\s+: handWritten \? seoMetaWithPrice\(handWritten, [^\n]*\n\s+: descFromText\(/);
  });

  it("every other product is still described from its own text", () => {
    const other = CATALOGUE.find((p) => !META[p.id] && TEXT_EN[p.id])!;
    expect(seoProductMeta(other.id, "EN")).toBe("");
    const tail = seoProductTail(seoPriceText(other.price, !!other.priceFrom, "EN"), true, "EN", undefined);
    expect(specFor(other.id, "EN").desc).toBe(descFrom(textForSnippet(TEXT_EN[other.id]), T.EN, tail));
    expect(seoProductMeta("c-anything", "RU")).toBe("");
  });
});
