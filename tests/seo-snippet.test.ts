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
import {
  clip, descFrom, DESC_MAX, dropShout, fitTitle, LANGS, productSpec, stripTags, T, textForSnippet, unentity,
} from "@/lib/seo-head.mjs";
import { seoCopy, seoLead, seoMetaWithPrice, seoProductMeta } from "@/lib/seo-copy.mjs";

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
  /* The tail lost the price and the stock on 21.09.2026. The price is already
     in the title, where Google prints it more reliably, and repeating it here
     only spent the 158 characters the copy needs — while «нет в наличии» in a
     result listing is a line nobody clicks, about a page that keeps its
     ranking either way. Google reads the real availability from the Offer in
     the structured data, which does not go stale between crawls. What is left
     is the half that answers «why here» and cannot become untrue. */
  it("puts the delivery and the pickup after the product's own words", () => {
    const d = descFrom("Успокаивающий шампунь для чувствительной кожи головы", RU);
    expect(d).toBe("Успокаивающий шампунь для чувствительной кожи головы · доставка по Эстонии и Балтии · самовывоз в Таллинне");
    expect(d.length).toBeLessThanOrEqual(DESC_MAX);
  });

  it("says nothing about the price or the stock — those go stale", () => {
    const d = descFrom("Воск для укладки", RU);
    expect(d).not.toMatch(/€/);
    expect(d).not.toContain("наличии");
  });

  it("never lets the tail be the half that gets cut off", () => {
    const long = "Слово ".repeat(60);
    const d = descFrom(long, RU);
    expect(d.length).toBeLessThanOrEqual(DESC_MAX);
    expect(d.endsWith("· доставка по Эстонии и Балтии · самовывоз в Таллинне")).toBe(true);
    expect(d).toContain("…");
  });

  it("writes the tail in the page's own language", () => {
    expect(descFrom("Viimistlusvaha", T.ET)).toContain("· tarne Eestis ja Baltikumis · järeletulek Tallinnas");
    expect(descFrom("Styling wax", T.EN)).toContain("· delivery across Estonia and the Baltics · pickup in Tallinn");
  });

  /* The stock WORDS still exist and still have to match the shop's own
     dictionary — they are what the fallback description and the page itself
     print. «otsas», not «pole saadaval»: this table had drifted, so the static
     Estonian page said one word and the DOM said the other a moment later
     about the same bottle (audit § 9.3). */
  it("keeps the stock words in step with the shop's dictionary", () => {
    expect(T.RU.out).toBe("нет в наличии");
    expect(T.ET.out).toBe("otsas");
    expect(T.EN.out).toBe("out of stock");
  });

  it("does not put a full stop directly before the separator", () => {
    expect(descFrom("Бальзам для бороды. Смягчает и укладывает.", RU))
      .toBe("Бальзам для бороды. Смягчает и укладывает · доставка по Эстонии и Балтии · самовывоз в Таллинне");
  });

  /* A description usually opens with a heading line above the copy. Stripping
     the tags used to join the two with a space, so the snippet read «Шампунь
     для редеющих волос Шампунь поддерживает…» — two sentences run together,
     which reads as a typo (Dim, 21.09.2026). The heading is a good first line
     and stays; it only gets its full stop. */
  it("gives a heading line its full stop before the copy", () => {
    expect(textForSnippet("<p>Шампунь для редеющих волос</p><p>Шампунь поддерживает баланс.</p>"))
      .toBe("Шампунь для редеющих волос. Шампунь поддерживает баланс.");
  });

  it("…and does not add a second one where there already is punctuation", () => {
    expect(textForSnippet("<p>Бальзам после бритья.</p><p>Смягчает.</p>"))
      .toBe("Бальзам после бритья. Смягчает.");
    expect(textForSnippet("<p>Уход за волосами:</p><p>мягко очищает.</p>"))
      .toBe("Уход за волосами: мягко очищает.");
  });

  it("still keeps a word that carries markup inside it in one piece", () => {
    expect(textForSnippet("s<b>trong</b> hold")).toBe("strong hold");
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

  /* 25.10.2026: the price and «в наличии» are back in the tail, and the
     free-delivery threshold comes from the rules (seoProductTail(),
     src/lib/seo-copy.mjs) — Estonian results showed Google cutting the price
     off our titles while competitors' snippets printed theirs. */
  it("builds the tail only when the description comes from the product text", () => {
    expect(spec({}).desc).toBe("Шампунь для редеющих волос · от 9 € · в наличии · доставка по Эстонии и Балтии · самовывоз в Таллинне");
  });

  it("puts the free-delivery threshold from the rules into the tail, and never «нет в наличии»", () => {
    const withRules = (stock: string) => productSpec({
      base: BASE, lang: LANGS[0], id: "x", cat: "hair", catName: "Уход за волосами",
      brand: "System 4", name: "Bio Botanical Shampoo — шампунь", price: 9, priceFrom: true,
      stock, body: "<p>Шампунь для редеющих волос.</p>", image: "", imageUrls: [],
      seoTitle: "", seoDesc: "", rules: { freeFrom: 70 },
    });
    expect(withRules("in").desc).toBe("Шампунь для редеющих волос · от 9 € · в наличии · бесплатная доставка от 70 € · самовывоз в Таллинне");
    expect(withRules("out").desc).toBe("Шампунь для редеющих волос · от 9 € · бесплатная доставка от 70 € · самовывоз в Таллинне");
  });

  it("keeps every word of a hand-written line and adds the price where it fits", () => {
    const meta = seoProductMeta("system-4-bio-botanical-shampoo", "ET");
    expect(meta).toBeTruthy();
    const d = productSpec({
      base: BASE, lang: LANGS.find((l) => l.code === "ET")!, id: "system-4-bio-botanical-shampoo", cat: "hair", catName: "Juuksehooldus",
      brand: "System 4", name: "Bio Botanical Shampoo — šampoon", price: 9, priceFrom: true,
      stock: "in", body: "<p>Šampoon.</p>", image: "", imageUrls: [], seoTitle: "", seoDesc: "", rules: { freeFrom: 70 },
    }).desc;
    expect(d.startsWith(meta.replace(/\.$/, ""))).toBe(true);
    expect(d).toContain("alates 9 €");
    expect(d.length).toBeLessThanOrEqual(DESC_MAX);
    // a line too long for the price keeps itself whole
    expect(seoMetaWithPrice("A".repeat(150), "alates 9 €", true, "ET", DESC_MAX)).toBe("A".repeat(150));
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
    /* the tail is the shared seoProductTail() on both sides since 25.10.2026,
       and its delivery words are the static page's own fallback line */
    expect(app).toContain("seoProductTail(priceText, !pGoneSeo, S.lang, seoCtx().rules)");
    expect(app).toContain("seoMetaWithPrice(handWritten, priceText, !pGoneSeo, S.lang, DESC_MAX)");
    for (const code of ["RU", "ET", "EN"] as const) {
      const w = seoCopy().productTail[code];
      expect(T[code].descTail()).toBe(w.delivery + " · " + w.pickup);
    }
    /* The entity decode the SEO path used to skip — and since 09.10.2026 the
       very text the static page reads (seoSnippetText(), the seo-copy block):
       a heading line keeps its own full stop instead of running into the copy,
       and the old shop's English pair is cut from, not pasted in raw. */
    expect(app).toContain('descFromText(seoSnippetText(S.lang === "EN" && p.seo && p.seo.d ? p.seo.d : descFor(p)),');
    expect(app).toContain("return seoLead(lead, room).replace(/\\.$/, \"\") + \" · \" + tail;");
    expect(app).toContain("unentity(stripTags(descFor(p))).slice(0, 500)");
    /* And the title: since 09.10.2026 the product-title rule of
       src/lib/seo-copy.mjs (audit §1A, no «— купить в Rempire» rung) —
       tests/seo-copy.test.ts holds the two copies of it to each other. */
    expect(app).toContain("seoProductTitle(seoProductCore(p.id, core, S.lang), priceText)");
  });

  /* The words themselves, not only the shape of the sentence. Four cells of
     this table had drifted from app.js by 04.09.2026 and nothing compared
     them: the static Estonian page said a bottle was «pole saadaval» and the
     DOM said «otsas» a moment later, in the same place, about the same bottle
     (audit § 9.3). Bounded the way tools/i18n-gaps.mjs bounds the dictionary. */
  it("uses the shop's own words for stock and tax, in ET and EN", () => {
    const dict = app.slice(app.indexOf("var UI = {"), app.indexOf("var UI_RX = ["));
    const enAt = dict.indexOf("EN: {");
    const half = { ET: dict.slice(dict.indexOf("ET: {"), enAt), EN: dict.slice(enAt) };
    const TAX = "Налоги включены. Доставка рассчитается при оформлении.";

    /** What app.js translates `ru` to, in that half of the dictionary. */
    const says = (lang: "ET" | "EN", ru: string): string => {
      const at = half[lang].indexOf(`${JSON.stringify(ru)}:`);
      expect(at, `${lang} has no entry for «${ru}»`).toBeGreaterThan(-1);
      const after = half[lang].slice(at + JSON.stringify(ru).length + 1);
      const open = after.indexOf('"');
      return JSON.parse(after.slice(open, after.indexOf('",', open) + 1)) as string;
    };

    for (const lang of ["ET", "EN"] as const) {
      expect(T[lang].inStock, `${lang}.inStock`).toBe(says(lang, "В наличии"));
      expect(T[lang].low, `${lang}.low`).toBe(says(lang, "мало"));
      expect(T[lang].out, `${lang}.out`).toBe(says(lang, "нет в наличии"));
      expect(T[lang].tax, `${lang}.tax`).toBe(says(lang, TAX));
    }
    // …and the Russian side is the keys themselves
    expect([T.RU.inStock, T.RU.low, T.RU.out, T.RU.tax]).toEqual(["В наличии", "мало", "нет в наличии", TAX]);
  });

  it("clips at a word the way clip() does", () => {
    expect(clip("Шампунь поддерживает естественный баланс", 25)).toBe("Шампунь поддерживает…");
    expect(app).toContain('return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\\s.,;:·—–-]+$/, "") + "…";');
  });
});

/* ---------------------------------------------------------------------------
   Whole sentences, never half of one (SEO pack, 09.10.2026).

   The product's share of the snippet used to be clip(text, room): the first
   104 characters, cut at a word — «Scalp circulatory stimulating serum. Serum
   that stimulates the superficial circulation of the… · delivery across
   Estonia…». All 660 generic descriptions ended that way. seoLead()
   (src/lib/seo-copy.mjs, called by descFrom() here and by descFromText() in
   app.js) takes whole sentences instead; a label in capitals ends the copy;
   a first sentence longer than the room gives its longest clean clause; and
   only when there is none, the old cut at a word with «…». */
describe("whole sentences, never half of one", () => {
  const read = (rel: string) => readFileSync(path.join(__dirname, "..", rel), "utf8");
  const load = (f: string, n: string) => new Function(read("public/shop/" + f) + "\nreturn " + n + ";")() as Record<string, string>;
  const TEXTS: Record<string, Record<string, string>> = {
    EN: load("content.js", "CONTENT"), RU: load("content.ru.js", "CONTENT_RU"), ET: load("content.et.js", "CONTENT_ET"),
  };
  const CATALOGUE = new Function(read("public/shop/catalogue2.js") + "\nreturn CATALOGUE;")() as Array<{ id: string; seo?: { d?: string } }>;
  /** The body the prerender cuts a product's description from (productPage() in tools/prerender-shop2.mjs). */
  const bodyOf = (p: { id: string; seo?: { d?: string } }, code: string) =>
    code === "EN" && p.seo && p.seo.d ? p.seo.d : (code !== "EN" && TEXTS[code][p.id]) || TEXTS.EN[p.id] || "";
  const tailOf = (code: "RU" | "ET" | "EN") => " · " + T[code].descTail();
  const EN = tailOf("EN");

  it("the finding: the System 4 serum's English snippet is its first sentence, not two-thirds of the second", () => {
    const d = descFrom(textForSnippet(TEXTS.EN["system-4-bio-botanical-serum"]), T.EN);
    expect(d).toBe("Scalp circulatory stimulating serum" + EN);
    expect(d).not.toContain("…");
  });

  it("takes as many whole sentences as fit, and stops before the one that does not", () => {
    expect(descFrom("Масло для бороды. Смягчает и укладывает. Пахнет кедром и цитрусом, подходит для ежедневного ухода за бородой любой длины.", RU))
      .toBe("Масло для бороды. Смягчает и укладывает" + tailOf("RU"));
  });

  it("does not break a sentence at «pH 4.7», «e.g. after» or «№1»", () => {
    expect(seoLead("Gentle wash at pH 4.7 for daily use. And a second sentence that is far too long to fit in here.", 40))
      .toBe("Gentle wash at pH 4.7 for daily use.");
    expect(seoLead("Use it e.g. after shaving. Rinse.", 100)).toBe("Use it e.g. after shaving. Rinse.");
    expect(seoLead("Шампунь №1. Для жирной кожи головы.", 100)).toBe("Шампунь №1. Для жирной кожи головы.");
  });

  it("a label in capitals ends the copy — what follows is a list, the usage or the ingredients", () => {
    expect(descFrom("Shampoo for an oily scalp. BENEFITS: Removes dandruff. Soothes itching.", T.EN))
      .toBe("Shampoo for an oily scalp" + EN);
    expect(descFrom("Тоник для жирной кожи головы. ПРЕИМУЩЕСТВА: Освежает.", RU))
      .toBe("Тоник для жирной кожи головы" + tailOf("RU"));
    expect(descFrom("Toonik rasusele peanahale. KASUTAMINE: Kanna peanahale.", T.ET))
      .toBe("Toonik rasusele peanahale" + tailOf("ET"));
    expect(descFrom("Grunge Mat for a matte look. HOW TO USE. Apply a little.", T.EN)).toBe("Grunge Mat for a matte look" + EN);
  });

  it("…and one before the copy is skipped, as a shouted heading is", () => {
    expect(descFrom("BENEFITS: Soft hold for every day. HOW TO USE. Apply.", T.EN)).toBe("Soft hold for every day" + EN);
    expect(descFrom("SPECIAL SHAMPOO 1 BY SYSTEM 4. Shampoo for oily and flaky scalp. BENEFITS: Less oil.", T.EN))
      .toBe("Shampoo for oily and flaky scalp" + EN);
  });

  it("a first sentence too long for the room gives its longest clean clause", () => {
    // before «, который» — and not «…улитки — ингредиента», one word after a dash
    expect(seoLead("Эссенция обогащена 96,3% фильтрата секрета улитки — ингредиента, который заметно улучшает состояние кожи и дарит сияние.", 104))
      .toBe("Эссенция обогащена 96,3% фильтрата секрета улитки");
    // before «, which»
    expect(seoLead("A nourishing conditioner that hydrates and strengthens deeply and evenly, which helps against breakage and keeps every curl bouncy.", 96))
      .toBe("A nourishing conditioner that hydrates and strengthens deeply and evenly");
    // at a colon
    expect(seoLead("Верните к жизни уставшие волосы: с этим шампунем сухие, повреждённые, пушащиеся волосы снова становятся мягкими и послушными.", 104))
      .toBe("Верните к жизни уставшие волосы");
  });

  it("never cuts in the middle of a list — a bare comma or «and» is not a clause", () => {
    const lead = seoLead("Treat fine, fragile and broken hair with ANGEL.RINSE, our weightless, volumising conditioning rinse created to soothe and protect.", 96);
    expect(lead.endsWith("…")).toBe(true);
    expect(lead).not.toMatch(/weightless$|volumising$|fragile$/);
  });

  it("every catalogue text in every language: its own words, ending at a sentence, a clean clause — or, last, «…»", () => {
    let total = 0, clipped = 0;
    const bad: string[] = [];
    const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/\s+([.!?…])/g, "$1").trim();
    for (const p of CATALOGUE) {
      for (const code of ["RU", "ET", "EN"] as const) {
        const text = textForSnippet(bodyOf(p, code));
        if (!text) continue;
        total++;
        const d = descFrom(text, T[code]);
        if (d.length > DESC_MAX) bad.push(`${code} ${p.id}: ${d.length} characters`);
        const lead = d.endsWith(tailOf(code)) ? d.slice(0, -tailOf(code).length) : d;
        if (lead.endsWith("…")) { clipped++; continue; }
        const src = tidy(dropShout(text) || text);
        const at = src.indexOf(tidy(lead));
        if (at < 0) { bad.push(`${code} ${p.id}: «${lead}» is not the text's own words`); continue; }
        const next = src.slice(at + tidy(lead).length);
        if (!(/[.!?]$/.test(lead) || next === "" || /^(?:[.!?…]|[,;:]\s|\s[—–]\s|\s\()/.test(next))) bad.push(`${code} ${p.id}: ends mid-sentence «…${lead.slice(-30)}|${next.slice(0, 20)}»`);
      }
    }
    expect(bad).toEqual([]);
    expect(total).toBe(CATALOGUE.length * 3);
    /* All 660 ended in «…» before. The word cut is the last resort now: a
       first sentence with no clean clause in reach. If this climbs, the rule
       has stopped finding the sentences. */
    expect(clipped / total).toBeLessThan(0.3);
  });
});
