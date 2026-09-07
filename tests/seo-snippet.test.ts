/**
 * src/lib/seo-head.mjs — the <title> and the meta description of a product
 * page, the two lines a search result is made of.
 *
 * Reworked 07.09.2026 after the Search Console export (docs/audit/
 * 2026-09-07-seo.md): five products ranked first for their own query and
 * earned nothing all week, and what the result offered a reader was a title
 * ending in «— REMPIRE» over half a sentence of an ingredient list, sometimes
 * with «&amp;» in the middle of it. Every case below is one of those.
 *
 * public/shop2/app.js carries a copy of these three rules (fitTitle(),
 * dropShout(), descFromText()), because Googlebot reads the rendered DOM and
 * the two have to say the same thing — the mirror is checked at the bottom.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { clip, descFrom, DESC_MAX, dropShout, fitTitle, LANGS, productSpec, stripTags, T, unentity } from "@/lib/seo-head.mjs";

const RU = T.RU;
const BASE = "https://rempireshop.com";

describe("stripTags decodes what it strips", () => {
  it("does not leave an entity for the meta tag to escape a second time", () => {
    /* Gatsby's «Mat &amp; Hard Lift-Up Wax» reached Google as «Mat &amp;amp;
       Hard Lift-Up Wax» — 47 impressions at position 1.06, no clicks. */
    expect(stripTags("<p>Mat &amp; Hard Lift-Up Wax &ndash; 80&nbsp;г</p>")).toBe("Mat & Hard Lift-Up Wax – 80 г");
    expect(unentity("&lt;b&gt; &quot;x&quot; &#39;y&#39; &hellip;")).toBe("<b> \"x\" 'y' …");
  });

  it("still keeps a word that carries markup inside it in one piece", () => {
    expect(stripTags("s<b>trong</b> hold")).toBe("strong hold");
    expect(stripTags("<p>one</p><p>two</p>")).toBe("one two");
  });
});

describe("a SHOUTED heading is not the first thing a reader sees", () => {
  it("drops the run of capitals a product text opens with", () => {
    expect(dropShout("BIO BOTANICAL SERUM ОТ SYSTEM 4 Сыворотка, стимулирующая кровообращение"))
      .toBe("Сыворотка, стимулирующая кровообращение");
    expect(dropShout("НЕВЕСОМЫЙ ЛАК ДЛЯ ВОЛОС — ОБЪЁМ И БЛЕСК БЕЗ МАСЕЛ ОТ KEVIN MURPHY Бросьте вызов гравитации"))
      .toBe("Бросьте вызов гравитации");
  });

  it("leaves a text that never shouted alone", () => {
    expect(dropShout("Шампунь для редеющих волос Шампунь поддерживает баланс"))
      .toBe("Шампунь для редеющих волос Шампунь поддерживает баланс");
    /* A short capitalised opening is a word, not a heading. */
    expect(dropShout("CBD Daily масло для бороды")).toBe("CBD Daily масло для бороды");
    /* A text that is capitals all the way down has no sentence to fall back
       to, so nothing is dropped rather than everything. */
    expect(dropShout("ВОСК ДЛЯ УКЛАДКИ 80 Г")).toBe("ВОСК ДЛЯ УКЛАДКИ 80 Г");
  });
});

describe("the meta description says what it is and why to buy it", () => {
  it("puts the price, the stock and the delivery after the product's own words", () => {
    const d = descFrom("Успокаивающий шампунь для чувствительной кожи головы", RU, "от 9 €", "В наличии");
    expect(d).toBe("Успокаивающий шампунь для чувствительной кожи головы · от 9 € · в наличии · доставка по Эстонии и Балтии");
    expect(d.length).toBeLessThanOrEqual(DESC_MAX);
  });

  it("never lets the tail be the half that gets cut off", () => {
    const long = "Слово ".repeat(60);
    const d = descFrom(long, RU, "от 123,45 €", "нет в наличии");
    expect(d.length).toBeLessThanOrEqual(DESC_MAX);
    expect(d.endsWith("· от 123,45 € · нет в наличии · доставка по Эстонии и Балтии")).toBe(true);
    expect(d).toContain("…");
  });

  it("says «нет в наличии» when there is none, in every language", () => {
    expect(descFrom("Воск для укладки", T.RU, "15 €", T.RU.out)).toContain("· нет в наличии ·");
    expect(descFrom("Viimistlusvaha", T.ET, "15 €", T.ET.out)).toContain("· pole saadaval · tarne Eestis ja Baltikumis");
    expect(descFrom("Styling wax", T.EN, "15 €", T.EN.out)).toContain("· out of stock · delivery across Estonia and the Baltics");
  });

  it("does not put a full stop directly before the separator", () => {
    expect(descFrom("Бальзам для бороды. Смягчает и укладывает.", RU, "от 14,90 €", "В наличии"))
      .toBe("Бальзам для бороды. Смягчает и укладывает · от 14,90 € · в наличии · доставка по Эстонии и Балтии");
  });
});

describe("the title ladder", () => {
  it("takes the longest rung that fits in sixty characters", () => {
    /* 1. the whole sentence */
    expect(fitTitle("Acme Wax", "Acme Wax — купить в Rempire · 9 €", "Acme Wax · 9 €"))
      .toBe("Acme Wax — купить в Rempire · 9 €");
    /* 2. brand, name and price — the rung added 07.09.2026 */
    expect(fitTitle(
      "System 4 Bio Botanical Shampoo — шампунь",
      "System 4 Bio Botanical Shampoo — шампунь — купить в Rempire · от 9 €",
      "System 4 Bio Botanical Shampoo — шампунь · от 9 €",
    )).toBe("System 4 Bio Botanical Shampoo — шампунь · от 9 €");
    /* 3. the site name, when even the price does not fit */
    expect(fitTitle("A".repeat(48), "x".repeat(70), "A".repeat(48) + " · от 1 234,56 €"))
      .toBe("A".repeat(48) + " — REMPIRE");
    /* 4. and the name alone, cut at a word, when nothing else does */
    expect(fitTitle("A".repeat(80), "", "").length).toBe(60);
  });

  it("keeps every product's title inside what a result listing prints", () => {
    for (const lang of LANGS) {
      const spec = productSpec({
        base: BASE, lang, id: "x", cat: "hair", catName: "Уход за волосами",
        brand: "Kevin.Murphy", name: "YOUNG.AGAIN MASQUE — маска для волос с маслом иммортеля",
        price: 12.5, priceFrom: true, stock: "in", body: "<p>Маска.</p>", image: "", imageUrls: [],
        seoTitle: "", seoDesc: "",
      });
      expect(spec.title.length, lang.code).toBeLessThanOrEqual(60);
      expect(spec.desc.length, lang.code).toBeLessThanOrEqual(160);
    }
  });
});

describe("a pair somebody wrote by hand is left alone", () => {
  const spec = (over: { seoTitle?: string; seoDesc?: string }) =>
    productSpec({
      base: BASE, lang: LANGS[0], id: "x", cat: "hair", catName: "Уход за волосами",
      brand: "System 4", name: "Bio Botanical Shampoo — шампунь", price: 9, priceFrom: true,
      stock: "in", body: "<p>Шампунь для редеющих волос.</p>", image: "", imageUrls: [],
      seoTitle: "", seoDesc: "", ...over,
    });

  it("appends no price to an owner's or the assistant's own description", () => {
    expect(spec({ seoDesc: "Шампунь против выпадения — 30 лет в финских клиниках." }).desc)
      .toBe("Шампунь против выпадения — 30 лет в финских клиниках.");
    expect(spec({ seoTitle: "System 4 против выпадения волос" }).title)
      .toBe("System 4 против выпадения волос — REMPIRE");
  });

  it("builds the tail only when the description comes from the product text", () => {
    expect(spec({}).desc).toBe("Шампунь для редеющих волос · от 9 € · в наличии · доставка по Эстонии и Балтии");
  });
});

describe("public/shop2/app.js says the same thing after it boots", () => {
  const app = readFileSync(path.join(__dirname, "..", "public", "shop2", "app.js"), "utf8");

  it("carries the same three rules and the delivery line in both dictionaries", () => {
    /* Not a string comparison of the implementations — one is ESM with
       template literals, the other an ES5 IIFE — but every fact a drift would
       break: the budget, the shout regex, the separator, and the ET/EN wording
       of the tail, which has to match T.ET/T.EN above word for word. */
    expect(app).toContain("var DESC_MAX = 158;");
    expect(DESC_MAX).toBe(158);
    expect(app).toContain("[^a-zà-öø-ÿšžа-яё]{10,160}?(?=[A-ZÀ-ÖØ-ÞŠŽА-ЯЁ][a-zà-öø-ÿšžа-яё])");
    expect(app).toContain('trText("доставка по Эстонии и Балтии", lang, false)');
    expect(T.RU.descTail("P", "s")).toContain("доставка по Эстонии и Балтии");
    expect(app).toContain('"доставка по Эстонии и Балтии": "tarne Eestis ja Baltikumis"');
    expect(T.ET.descTail("P", "s")).toContain("tarne Eestis ja Baltikumis");
    expect(app).toContain('"доставка по Эстонии и Балтии": "delivery across Estonia and the Baltics"');
    expect(T.EN.descTail("P", "s")).toContain("delivery across Estonia and the Baltics");
    /* The entity decode the SEO path used to skip. */
    expect(app).toContain("descFromText(unentity(stripTags(descFor(p)))");
    expect(app).toContain("unentity(stripTags(descFor(p))).slice(0, 500)");
    /* And the title's third rung. */
    expect(app).toContain('fitTitle(core, core + " — " + buy + " · " + priceText, core + " · " + priceText)');
  });

  it("clips at a word the way clip() does", () => {
    expect(clip("Шампунь поддерживает естественный баланс", 25)).toBe("Шампунь поддерживает…");
    expect(app).toContain('return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\\s.,;:·—–-]+$/, "") + "…";');
  });
});
