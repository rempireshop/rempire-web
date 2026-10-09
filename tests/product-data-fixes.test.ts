/**
 * Product names and texts fixed on 09.10.2026 (SEO audit §1A product
 * template, §11.4; the owner's drafts): data only, no layout.
 *
 *   · Russian K-beauty «тоник» → «тонер» — what Russians search («cosrx тонер»);
 *     the System 4 scalp tonic stays a «тоник», it is one;
 *   · a type for the Kevin.Murphy names that carried none (Free.Hold,
 *     HEATED.DEFENSE, Motion.Lotion, Touchable), from the maker's own type;
 *   · Laneige Cica Sleeping Mask says it is the 10 ml mini; Baccarat Rouge 540
 *     loses its cut-off «Unisex 2.4oz …» (the texts and the id say Eau de
 *     Parfum 70 ml);
 *   · medical-sounding claims out of the product texts, in all three
 *     languages: System 4's «Therapeutic / Терапевтический / Лечебный /
 *     Terapeutiline / Ravitoimeline», Cosrx's percentages the maker does not
 *     give, Anua BHA's «breakouts / inflammation / acne-prone», Anua
 *     Heartleaf's «anti-inflammatory».
 *
 * The names live in public/shop/catalogue2.js AND src/data/catalogue.min.json
 * (the server's copy); the texts in public/shop/content{,.ru,.et}.js and, for
 * the Merchant Center feed, src/data/catalogue.feed.json (tools/pack-feed.mjs).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { translateProductName } from "@/lib/product-name";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
type P = { id: string; brand: string; name: string; cat: string };
const CATALOGUE = new Function(read("../public/shop/catalogue2.js") + "\nreturn CATALOGUE;")() as P[];
const MIN = JSON.parse(read("../src/data/catalogue.min.json")) as Array<{ id: string; n: string }>;
const byId = (id: string) => CATALOGUE.find((p) => p.id === id)!;
const load = (f: string, n: string) => new Function(read("../public/shop/" + f) + "\nreturn " + n + ";")() as Record<string, string>;
const TEXTS = { EN: load("content.js", "CONTENT"), RU: load("content.ru.js", "CONTENT_RU"), ET: load("content.et.js", "CONTENT_ET") };
const FEED = read("../src/data/catalogue.feed.json");

describe("product names", () => {
  it("the two copies of the catalogue agree on every name", () => {
    const min = new Map(MIN.map((p) => [p.id, p.n]));
    for (const p of CATALOGUE) expect(min.get(p.id), p.id).toBe(p.name);
  });

  it("K-beauty toners are «тонер» in Russian, toner/toonik elsewhere; the scalp tonic stays «тоник»", () => {
    const toners = CATALOGUE.filter((p) => p.cat === "face" && /toner/i.test(p.name));
    expect(toners.map((p) => p.id).sort()).toEqual([
      "anua-bha-2-gentle-exfoliating-toner-150ml", "anua-heartleaf-77-soothing-toner",
      "cosrx-aha-bha-clarifying-treatment-toner", "cosrx-full-fit-propolis-synergy-toner",
    ]);
    for (const p of toners) {
      expect(p.name, p.id).toMatch(/ — тонер$/);
      expect(translateProductName(p.name, "EN"), p.id).toMatch(/ — toner$/);
      expect(translateProductName(p.name, "ET"), p.id).toMatch(/ — toonik$/);
    }
    expect(CATALOGUE.filter((p) => p.cat === "face" && / — тоник/.test(p.name))).toEqual([]);
    expect(byId("sim-sensitive-system-4-scalp-tonic-t").name).toBe("Scalp Tonic T — тоник для кожи головы");
  });

  it("the face section's toner chip still holds the four toners", () => {
    const app = read("../public/shop2/app.js");
    expect(app).toContain('{ id: "to", name: "Тонеры", re: /тоник|тонер/i },');
    const re = /тоник|тонер/i;
    expect(CATALOGUE.filter((p) => p.cat === "face" && re.test(p.name)).length).toBe(4);
  });

  it("the Kevin.Murphy names carry the maker's type, in every language", () => {
    const want: Record<string, [string, string, string]> = {
      // the natural compound since 09.10.2026 (TAIL_EXACT), not «pasta soengu jaoks» / «paste for styling»
      "free-hold": ["Free.Hold — паста для укладки", "Free.Hold — viimistluspasta", "Free.Hold — styling paste"],
      "heated-defense": ["HEATED.DEFENSE — термозащитная пенка", "HEATED.DEFENSE — kuumakaitsevaht", "HEATED.DEFENSE — heat protection foam"],
      "kevin-murphy-motion-lotion": ["Motion.Lotion — лосьон для локонов", "Motion.Lotion — lokilosjoon", "Motion.Lotion — curl lotion"],
      touchable: ["Touchable — спрей-воск", "Touchable — spreivaha", "Touchable — spray wax"],
    };
    for (const [id, [ru, et, en]] of Object.entries(want)) {
      expect(byId(id).name).toBe(ru);
      expect(translateProductName(ru, "ET")).toBe(et);
      expect(translateProductName(ru, "EN")).toBe(en);
    }
  });

  it("Laneige says it is the 10 ml mini; Baccarat Rouge 540 is whole", () => {
    expect(byId("laneige-cica-sleeping-mask").name).toBe("Cica Sleeping Mask mini 10 ml — маска");
    expect(translateProductName(byId("laneige-cica-sleeping-mask").name, "EN")).toBe("Cica Sleeping Mask mini 10 ml — mask");
    const br = byId("baccarat-rouge-540-eau-de-parfum-70ml").name;
    expect(br).toBe("Baccarat Rouge 540 Eau de Parfum 70 ml — парфюм");
    expect(translateProductName(br, "ET")).toBe("Baccarat Rouge 540 Eau de Parfum 70 ml — parfüüm");
    expect(CATALOGUE.some((p) => /2\.4oz|Unisex 2/i.test(p.name))).toBe(false);
  });
});

describe("product texts", () => {
  const FLAGGED = [
    /therapeutic/i, /терапевтическ/i, /лечебн/i, /terapeutiline/i, /ravitoime/i,
    /10% white willow bark/i, /10% экстракта коры белой ивы/, /10% valge paju/,
    /reduce breakouts|preventing breakouts|calms inflammation|acne-prone &amp; oily/i,
    /уменьшая высыпания|предотвращая высыпания|снимает воспаление|склонной к акне кожи<\/strong>/,
    /vähendades vistrikke|ennetades vistrike|leevendab põletikku|aknele kalduvale ja rasusele/,
  ];
  const IDS = [
    ...CATALOGUE.filter((p) => p.brand === "System 4").map((p) => p.id),
    "cosrx-aha-bha-clarifying-treatment-toner", "anua-bha-2-gentle-exfoliating-toner-150ml", "anua-heartleaf-77-soothing-toner",
  ];

  it("carry none of the flagged medical wording, in any language", () => {
    for (const id of IDS) {
      for (const [lang, t] of Object.entries(TEXTS)) {
        for (const rx of FLAGGED) expect(t[id] ?? "", `${id} ${lang} ${rx}`).not.toMatch(rx);
      }
    }
    for (const lang of ["EN", "RU", "ET"] as const) {
      expect(TEXTS[lang]["anua-heartleaf-77-soothing-toner"]).not.toMatch(/anti-inflammatory|противовоспал|põletikuvastas/i);
    }
  });

  it("…and nor does the Merchant Center feed built from them", () => {
    for (const rx of [/Therapeutic/, /Терапевтическ/, /Лечебн/, /Terapeutiline/, /Ravitoime/, /10% white willow/, /снимает воспаление/]) {
      expect(FEED).not.toMatch(rx);
    }
  });

  it("keeps the maker's own neutral claims", () => {
    expect(TEXTS.EN["system-4-special-shampoo-1"]).toContain("Shampoo for oily and flaky scalp");
    expect(TEXTS.RU["system-4-special-shampoo-1"]).toContain("Шампунь для жирной и шелушащейся кожи головы");
    expect(TEXTS.ET["system-4-special-shampoo-1"]).toContain("Šampoon rasusele ja ketendavale peanahale");
    expect(TEXTS.EN["cosrx-aha-bha-clarifying-treatment-toner"]).toContain("Willow bark water (a natural BHA)");
  });
});
