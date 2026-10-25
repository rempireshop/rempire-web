/**
 * «Where the shop delivers», in the sentences search engines and AI answers
 * read (Dim, 25.10.2026).
 *
 * The static home text, the info pages' descriptions and the sets page's
 * named Estonia, Latvia, Lithuania and Finland only, and a customer in Spain
 * read that as «not to Spain» — while the checkout, the Merchant Center feed
 * and the product markup all delivered to 25 countries. These sentences now
 * come from the rules the checkout bills with: the count from the countries
 * the owner left on, the amounts from «Бесплатно от».
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  SEO_EUROPE, seoHomeIntro, seoInfoTail, seoSetsDesc, seoShipCount, seoShipLine,
} from "@/lib/seo-copy.mjs";
import { T } from "@/lib/seo-head.mjs";
import { EUROPE } from "@/lib/shipping";

/** The live rules of 25.10.2026: 70 € in the Baltics, 200 € for Finland and Europe, seven countries off. */
const LIVE = {
  freeFrom: 70,
  freeFromByCountry: { EU: 200, FI: 200 },
  countriesOff: ["CH", "CY", "GB", "IS", "LI", "MT", "NO"],
};

const APP = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
const PRERENDER = readFileSync(fileURLToPath(new URL("../tools/prerender-shop2.mjs", import.meta.url)), "utf8");

describe("the countries it counts", () => {
  it("are the checkout's: the four home rows and src/lib/shipping.ts's Europe", () => {
    expect([...SEO_EUROPE].sort()).toEqual([...EUROPE].sort());
  });

  it("are 25 with the live rules, and follow a country switched on or off", () => {
    expect(seoShipCount(LIVE)).toBe(25);
    expect(seoShipCount({ ...LIVE, countriesOff: [...LIVE.countriesOff, "SE"] })).toBe(24);
    expect(seoShipCount({ ...LIVE, countriesOff: ["GB"] })).toBe(31);
  });

  it("are not guessed when the rules carry no list of countries switched off", () => {
    expect(seoShipCount({ freeFrom: 70 })).toBeNull();
    expect(seoShipLine("RU", { freeFrom: 70 })).toMatch(/^Доставка по Европе\./);
  });
});

describe("the sentence", () => {
  it("names the Baltics, Finland and the rest of Europe with the live amounts", () => {
    expect(seoShipLine("RU", LIVE)).toBe(
      "Доставка в 25 стран Европы. Бесплатно: по Балтии от 70 €, в Финляндию и остальную Европу от 200 €.",
    );
    expect(seoShipLine("ET", LIVE)).toBe(
      "Tarne 25 Euroopa riiki. Tasuta: Baltikumis alates 70 €, Soome ja mujale Euroopasse alates 200 €.",
    );
    expect(seoShipLine("EN", LIVE)).toBe(
      "Delivery to 25 countries in Europe. Free: in the Baltics from €70, to Finland and the rest of Europe from €200.",
    );
  });

  it("splits a group whose amounts the owner split, instead of quoting one for both", () => {
    const split = { ...LIVE, freeFromByCountry: { EU: 200, FI: 150, LV: 80 } };
    expect(seoShipLine("RU", split)).toBe(
      "Доставка в 25 стран Европы. Бесплатно: по Эстонии от 70 €, в Финляндию от 150 €, в остальную Европу от 200 €.",
    );
  });

  it("drops a clause whose free delivery was switched off, and the whole «free» part with the last one", () => {
    expect(seoShipLine("EN", { ...LIVE, freeFromByCountry: { EU: null, FI: null } })).toBe(
      "Delivery to 25 countries in Europe. Free: in the Baltics from €70.",
    );
    expect(seoShipLine("EN", { freeFrom: null, freeFromByCountry: {}, countriesOff: LIVE.countriesOff })).toBe(
      "Delivery to 25 countries in Europe.",
    );
  });

  it("says «страну», «страны» and «стран» where Russian does", () => {
    const off = (n: number) => ["EE", "LV", "LT", "FI", ...SEO_EUROPE].slice(n);
    expect(seoShipLine("RU", { countriesOff: off(21) })).toBe("Доставка в 21 страну Европы.");
    expect(seoShipLine("RU", { countriesOff: off(22) })).toBe("Доставка в 22 страны Европы.");
    expect(seoShipLine("RU", { countriesOff: off(25) })).toBe("Доставка в 25 стран Европы.");
    expect(seoShipLine("RU", { countriesOff: off(11) })).toBe("Доставка в 11 стран Европы.");
  });
});

describe("where it is written", () => {
  it("is the home page's static paragraph, the info pages' and the sets page's descriptions", () => {
    for (const lang of ["RU", "ET", "EN"] as const) {
      expect(T[lang].homeIntro(LIVE)).toBe(seoHomeIntro(lang, LIVE));
      expect(T[lang].homeIntro(LIVE)).toContain(seoShipLine(lang, LIVE));
      expect(T[lang].infoDesc("X", LIVE)).toBe("X — " + seoInfoTail(lang, LIVE));
      expect(T[lang].setsDesc(LIVE)).toBe(seoSetsDesc(lang, LIVE));
    }
    expect(PRERENDER).toContain("t.homeIntro(SEO_CTX.rules)");
    expect(PRERENDER).toContain("t.infoDesc(heading, SEO_CTX.rules)");
    expect(PRERENDER).toContain("t.setsDesc(SEO_CTX.rules)");
  });

  it("is what app.js writes into the same heads once it has booted", () => {
    expect(APP).toContain("seoInfoTail(S.lang, SHIP_RULES)");
    expect(APP).toContain("seoSetsDesc(S.lang, SHIP_RULES)");
    expect(APP).not.toContain("INFO_DESC_TAIL");
    expect(APP).not.toContain("SETS_DESC");
  });

  it("never says «Baltics only» in a description again", () => {
    for (const lang of ["RU", "ET", "EN"] as const) {
      for (const s of [T[lang].homeIntro(LIVE), T[lang].infoDesc("X", LIVE), T[lang].setsDesc(LIVE)]) {
        expect(s).not.toMatch(/по Эстонии и Балтии|Eestis ja Baltikumis|üle Baltikumi|across Estonia and the Baltics|Baltic delivery\.|Латвии, Литве и Финляндии|Lätis, Leedus ja Soomes|Lithuania and Finland/);
      }
      expect(T[lang].infoDesc("Доставка и оплата", LIVE).length).toBeLessThanOrEqual(158);
      expect(T[lang].setsDesc(LIVE).length).toBeLessThanOrEqual(155);
    }
  });
});
