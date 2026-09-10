/**
 * src/lib/blog-cards.ts — the product cards the article generator places,
 * without a model or a database: what the route promises the editor about
 * an article's cards (Dim, 10.09.2026: the assistant chooses 2–4 products
 * and puts them into the draft itself).
 *
 *   - the model's own cards stay, once each, known ids only, out of headings
 *     and lists; an unknown id loses its tag and keeps its words;
 *   - the products it named get a card after the paragraph they belong to —
 *     the one `after` points at, else the one that names them;
 *   - an article short of POST_CARDS_MIN cards is filled from the candidates
 *     by the topic and its own words, one bottle size per product;
 *   - never two cards in a row, never more than POST_CARDS_MAX, one of them
 *     in the last third — before the closing paragraph when there is room.
 */
import { describe, expect, it } from "vitest";
import { POST_CARDS_MAX, POST_CARDS_MIN } from "@/lib/ai-prompts";
import { cardIds, placeArticleCards, rankCandidates, readCardPicks, splitBlocks, type CardCandidate } from "@/lib/blog-cards";

const OIL = "proraso-beard-oil-azur-lime-30ml";
const OIL_BIG = "proraso-beard-oil-azur-lime-100ml";
const BALM = "proraso-wood-spice-beard-balm-100ml";
const CAPTAIN = "captain-fawcett-beard-oil-private-stock";
const FOAM = "reuzel-beard-foam";
const SHAMPOO = "system-4-bio-botanical-shampoo";

/** The slice a beard topic gets: beard products first, one hair product at the end, in stock. */
const CANDS: CardCandidate[] = [
  { id: OIL, brand: "Proraso", name: "Beard Oil Azur Lime — масло для бороды", category: "beard" },
  { id: BALM, brand: "Proraso", name: "Wood & Spice — бальзам для бороды", category: "beard" },
  { id: CAPTAIN, brand: "Captain Fawcett", name: "Private Stock — масло для бороды", category: "beard" },
  { id: FOAM, brand: "Reuzel", name: "Beard Foam — пена для бороды", category: "beard" },
  { id: OIL_BIG, brand: "Proraso", name: "Beard Oil Azur Lime — масло для бороды", category: "beard" },
  { id: SHAMPOO, brand: "System 4", name: "Bio Botanical Shampoo — шампунь", category: "hair" },
];
const TOPIC = "уход за бородой зимой";

/* Ten blocks, as sanitizeHtml() writes them: p h2 p p h2 p ul h2 p p. The
   oil is named in the third block, the balm in the sixth, a shampoo in the
   ninth; the last block is the closing paragraph. */
const P0 = "<p>Зимой борода сохнет: мороз снаружи, отопление внутри.</p>";
const H1 = "<h2>Масло каждый вечер</h2>";
const P_OIL = "<p>Капля масла после умывания — и борода мягкая. Proraso делает масло с ароматом лайма.</p>";
const P_HOW = "<p>Наносите на влажную бороду, распределяя от корней к кончикам.</p>";
const H2 = "<h2>Бальзам утром</h2>";
const P_BALM = "<p>Бальзам Wood &amp; Spice держит форму и питает кожу под бородой.</p>";
const UL = "<ul><li>капля масла</li><li>горошина бальзама</li></ul>";
const H3 = "<h2>Мытьё</h2>";
const P_WASH = "<p>Мойте бороду два раза в неделю, не чаще — шампунь для волос сушит.</p>";
const P_END = "<p>Заходите на Mardi 1 — покажем на живой бороде.</p>";
const ARTICLE = [P0, H1, P_OIL, P_HOW, H2, P_BALM, UL, H3, P_WASH, P_END].join("");

const card = (id: string) => `<p><a data-product="${id}"></a></p>`;

/** Every rule an article's cards must keep, whatever put them there. */
function expectRules(html: string, opts: { min?: number; max?: number } = {}) {
  const blocks = splitBlocks(html);
  const cards = cardIds(html);
  expect(cards.length, "too few cards").toBeGreaterThanOrEqual(opts.min ?? POST_CARDS_MIN);
  expect(cards.length, "too many cards").toBeLessThanOrEqual(opts.max ?? POST_CARDS_MAX);
  expect(new Set(cards).size, "a product has two cards").toBe(cards.length);
  for (let i = 1; i < blocks.length; i++) {
    const two = blocks[i].html.includes("data-product") && blocks[i - 1].html.includes("data-product");
    expect(two, `two cards in a row at block ${i}: ${blocks[i - 1].html} ${blocks[i].html}`).toBe(false);
  }
  for (const b of blocks) {
    if (b.tag !== "p" && b.tag !== "text") expect(b.html, `a card inside <${b.tag}>`).not.toContain("data-product");
  }
  const cut = Math.floor((blocks.length * 2) / 3);
  expect(blocks.slice(cut).some((b) => b.html.includes("data-product")), "no card in the last third").toBe(true);
}

/** The block right after the block that contains `text`. */
function blockAfter(html: string, text: string): string {
  const blocks = splitBlocks(html);
  const i = blocks.findIndex((b) => b.html.includes(text));
  expect(i, `no block holds «${text}»`).toBeGreaterThanOrEqual(0);
  return blocks[i + 1]?.html ?? "";
}

describe("readCardPicks — the model's `products`, whichever shape it chose", () => {
  it("reads ids and {id, after} alike, once each, and drops what is not an id", () => {
    expect(readCardPicks([OIL, { id: BALM, after: "Бальзам утром" }, { id: CAPTAIN, after: 3.7 }, { id: OIL }, "Bad Id!", "../x", 42, { after: 2 }, ""]))
      .toEqual([{ id: OIL }, { id: BALM, after: "Бальзам утром" }, { id: CAPTAIN, after: 3 }]);
    expect(readCardPicks("nope")).toEqual([]);
    expect(readCardPicks(null)).toEqual([]);
  });
  it("caps the list and the hint", () => {
    const many = Array.from({ length: 30 }, (_, i) => `p-${i}`);
    expect(readCardPicks(many, 5)).toHaveLength(5);
    expect(readCardPicks([{ id: OIL, after: "x".repeat(500) }])[0].after).toHaveLength(120);
  });
});

describe("splitBlocks — sanitised html as its top-level blocks", () => {
  it("keeps nested tags inside their block and words between blocks as a block of their own", () => {
    const blocks = splitBlocks('<p>a <strong>b</strong></p>stray<ul><li>x<br>y</li><li><img src="/i.webp" alt="">z</li></ul><h2>t</h2>');
    expect(blocks.map((b) => b.tag)).toEqual(["p", "text", "ul", "h2"]);
    expect(blocks[2].html).toBe('<ul><li>x<br>y</li><li><img src="/i.webp" alt="">z</li></ul>');
    expect(blocks.map((b) => b.html).join("")).toBe('<p>a <strong>b</strong></p>stray<ul><li>x<br>y</li><li><img src="/i.webp" alt="">z</li></ul><h2>t</h2>');
  });
  it("closes what the input left open and ignores a stray close tag", () => {
    expect(splitBlocks("<p>one</p></p><p>two").map((b) => b.html)).toEqual(["<p>one</p>", "<p>two"]);
    expect(splitBlocks("")).toEqual([]);
  });
});

describe("rankCandidates — the products that fit a text best", () => {
  it("puts the product the text names by brand and name first, and one size of it only", () => {
    const ranked = rankCandidates(CANDS, `${TOPIC} ${ARTICLE}`).map((c) => c.id);
    expect(ranked[0]).toBe(BALM);          // Proraso + Wood + Spice + бальзам + бороды
    expect(ranked[1]).toBe(OIL);           // Proraso + масло + бороды
    expect(ranked, "the bigger bottle of the same oil is the same product").not.toContain(OIL_BIG);
    expect(ranked.indexOf(SHAMPOO), "a hair product ranks under every beard product the text names").toBeGreaterThan(ranked.indexOf(CAPTAIN));
  });
  it("skips what is taken, and another size of it", () => {
    const ranked = rankCandidates(CANDS, ARTICLE, new Set([OIL_BIG])).map((c) => c.id);
    expect(ranked).not.toContain(OIL_BIG);
    expect(ranked).not.toContain(OIL);
    expect(ranked[0]).toBe(BALM);
  });
  it("falls back to the candidates' own order when nothing in the text names them", () => {
    expect(rankCandidates(CANDS, "погода в Таллинне").map((c) => c.id)).toEqual([OIL, BALM, CAPTAIN, FOAM, SHAMPOO]);
  });
});

describe("placeArticleCards — the model's own cards", () => {
  it("keeps a card where the model put it and fills up to the minimum around it", () => {
    const body = [P0, H1, P_OIL, card(OIL), P_HOW, H2, P_BALM, UL, H3, P_WASH, P_END].join("");
    const out = placeArticleCards(body, [], CANDS, { topic: TOPIC });
    expectRules(out.html);
    expect(out.cards[0]).toBe(OIL);
    expect(blockAfter(out.html, "Proraso делает масло")).toBe(card(OIL));
    // the balm is the next best fit, and its paragraph is where it lands
    expect(out.cards).toContain(BALM);
    expect(blockAfter(out.html, "Wood &amp; Spice")).toBe(card(BALM));
  });

  it("unwraps a card for an id that was never offered — its words stay, an empty line goes — and a repeat", () => {
    const body = [P0, '<p><a data-product="proraso-beard-oil-2000ml">Масло на два литра</a></p>', H1, P_OIL, card(OIL), P_HOW, card(OIL), H2, P_BALM, UL, H3, P_WASH, P_END].join("");
    const out = placeArticleCards(body, [], CANDS, { topic: TOPIC });
    expectRules(out.html);
    expect(out.html).not.toContain("proraso-beard-oil-2000ml");
    expect(out.html).toContain("<p>Масло на два литра</p>");
    expect(out.html.split(`data-product="${OIL}"`).length - 1, "the repeated card survived").toBe(1);
    expect(out.html).not.toContain("<p></p>");
  });

  it("lifts a card out of a heading and out of a list, to the paragraph below", () => {
    const body = [P0, `<h2>Масло <a data-product="${OIL}"></a> каждый вечер</h2>`, P_OIL, P_HOW, H2, P_BALM, `<ul><li><a data-product="${BALM}"></a></li><li>горошина бальзама</li></ul>`, H3, P_WASH, P_END].join("");
    const out = placeArticleCards(body, [], CANDS, { topic: TOPIC });
    expectRules(out.html);
    expect(out.html).toContain("<h2>Масло  каждый вечер</h2>");
    expect(blockAfter(out.html, "Proraso делает масло")).toBe(card(OIL));
    expect(out.html).toContain("<ul><li></li><li>горошина бальзама</li></ul>");
    expect(blockAfter(out.html, "горошина бальзама")).toBe(card(BALM));
  });

  it("leaves a card the owner's way — inline in a sentence — alone, and counts it", () => {
    const body = [P0, H1, `<p>Капля <a data-product="${OIL}" href="/shop2/p/${OIL}/">Proraso Beard Oil — 15 €</a> после умывания.</p>`, P_HOW, H2, P_BALM, UL, H3, P_WASH, P_END].join("");
    const out = placeArticleCards(body, [], CANDS, { topic: TOPIC });
    expectRules(out.html);
    expect(out.html).toContain(`<a data-product="${OIL}" href="/shop2/p/${OIL}/">Proraso Beard Oil — 15 €</a>`);
    expect(out.cards[0]).toBe(OIL);
  });
});

describe("placeArticleCards — the products the model named", () => {
  it("gives each a card after the paragraph that names it", () => {
    const out = placeArticleCards(ARTICLE, [{ id: BALM }, { id: OIL }], CANDS, { topic: TOPIC });
    expectRules(out.html);
    expect(blockAfter(out.html, "Wood &amp; Spice")).toBe(card(BALM));
    expect(blockAfter(out.html, "Proraso делает масло")).toBe(card(OIL));
    expect(out.cards.slice(0, 2), "cards come back in the order they stand, not the order they were named").toEqual([OIL, BALM]);
  });

  it("follows `after` — a heading's words, or the paragraph's number", () => {
    const byHeading = placeArticleCards(ARTICLE, [{ id: CAPTAIN, after: "Бальзам утром" }, { id: FOAM, after: 2 }], CANDS, { topic: TOPIC });
    expectRules(byHeading.html);
    // under the heading: after the first paragraph that follows it
    expect(blockAfter(byHeading.html, "Wood &amp; Spice")).toBe(card(CAPTAIN));
    // the second paragraph of the text is the one about the oil
    expect(blockAfter(byHeading.html, "Proraso делает масло")).toBe(card(FOAM));
  });

  it("never puts two cards in a row: the second of a pair moves to the next paragraph", () => {
    // both belong to the oil paragraph by their words — Proraso in it, масло and борода in both names
    const out = placeArticleCards(ARTICLE, [{ id: OIL }, { id: CAPTAIN }], CANDS, { topic: TOPIC });
    expectRules(out.html);
    expect(blockAfter(out.html, "Proraso делает масло")).toBe(card(OIL));
    expect(blockAfter(out.html, "от корней к кончикам")).toBe(card(CAPTAIN));
  });

  it("ignores an id outside the candidates — the second door in front of an invented product", () => {
    const out = placeArticleCards(ARTICLE, [{ id: "proraso-beard-oil-2000ml" }, { id: OIL }], CANDS, { topic: TOPIC });
    expectRules(out.html);
    expect(out.html).not.toContain("2000ml");
    expect(out.cards).toContain(OIL);
  });

  it("stops at the ceiling", () => {
    const out = placeArticleCards(ARTICLE, CANDS.map((c) => ({ id: c.id })), CANDS, { topic: TOPIC });
    expectRules(out.html);
    expect(out.cards).toHaveLength(POST_CARDS_MAX);
    expect(out.cards.slice(0, 4).sort()).toEqual([OIL, BALM, CAPTAIN, FOAM].sort());   // the first four named, none dropped for a later one
  });
});

describe("placeArticleCards — an article that came back without cards", () => {
  it("gets its products by the topic and its own words, after the paragraphs that name them, one near the end", () => {
    const out = placeArticleCards(ARTICLE, [], CANDS, { topic: TOPIC });
    expectRules(out.html);
    expect(blockAfter(out.html, "Wood &amp; Spice")).toBe(card(BALM));
    expect(blockAfter(out.html, "Proraso делает масло")).toBe(card(OIL));
    // the two best paragraphs are early, so a third beard product stands in the last third — before the closing words
    expect(out.cards).toHaveLength(3);
    expect(out.cards[2]).toBe(CAPTAIN);
    expect(blockAfter(out.html, "шампунь для волос сушит")).toBe(card(CAPTAIN));
    expect(out.html.endsWith(P_END), "the article no longer ends in words").toBe(true);
  });

  it("with nothing offered, places nothing and strips what it cannot vouch for", () => {
    const out = placeArticleCards([P0, card(OIL), P_HOW].join(""), [{ id: OIL }], [], { topic: TOPIC });
    expect(out.cards).toEqual([]);
    expect(out.html).toBe(P0 + P_HOW);
  });

  it("leaves an empty body and a body with nowhere to stand alone", () => {
    expect(placeArticleCards("", [], CANDS, { topic: TOPIC })).toEqual({ html: "", cards: [] });
    const heads = placeArticleCards("<h2>Раз</h2><h2>Два</h2>", [{ id: OIL }], CANDS, { topic: TOPIC });
    expect(heads.html).toBe("<h2>Раз</h2><h2>Два</h2>");
    expect(heads.cards).toEqual([]);
  });

  it("spreads cards over a text that names none of them", () => {
    const dull = Array.from({ length: 9 }, (_, i) => `<p>Абзац номер ${i + 1} ни о чём конкретном.</p>`).join("");
    const out = placeArticleCards(dull, [], CANDS, { topic: "разное" });
    expectRules(out.html);
    const blocks = splitBlocks(out.html).map((b) => (b.html.includes("data-product") ? "C" : "p")).join("");
    expect(blocks.startsWith("p"), "a card before any words").toBe(true);
    expect(blocks.split("C").length - 1).toBe(POST_CARDS_MIN);
    expect(blocks, "the two cards were bunched together").not.toMatch(/CpC/);
  });

  it("uses the closing paragraph only when it is the one place in the last third", () => {
    // a list before the closing words: the third card stands after the list, and the article still ends in words
    const roomy = placeArticleCards([P0, H1, P_OIL, P_HOW, H2, P_BALM, UL, H3, "<h2>Ещё раз</h2>", "<h2>И ещё</h2>", P_END].join(""), [], CANDS, { topic: TOPIC });
    expectRules(roomy.html);
    expect(roomy.cards).toHaveLength(3);
    expect(blockAfter(roomy.html, "горошина бальзама")).toBe(card(roomy.cards[2]));
    expect(roomy.html.endsWith(P_END)).toBe(true);
    // nothing but headings before the closing words: the card has one place to stand
    const tight = placeArticleCards([P0, H1, P_OIL, P_HOW, H2, P_BALM, UL, H3, "<h2>Ещё раз</h2>", "<h2>И ещё</h2>", "<h2>Напоследок</h2>", P_END].join(""), [], CANDS, { topic: TOPIC });
    expectRules(tight.html);
    expect(tight.cards).toHaveLength(3);
    expect(tight.html.endsWith(P_END + card(tight.cards[2]))).toBe(true);
  });

  it("moves the last card down when the article is full and every card is early", () => {
    const tail = "<p>Полотенцем — промокнуть, не тереть.</p><p>Фен — только тёплый, с расстояния.</p>";
    const early = [P0, card(OIL), P_OIL, card(BALM), P_HOW, card(CAPTAIN), H2, P_BALM, card(FOAM), UL, H3, P_WASH, tail, P_END].join("");
    const out = placeArticleCards(early, [], CANDS, { topic: TOPIC });
    expectRules(out.html);
    expect(out.cards).toEqual([OIL, BALM, CAPTAIN, FOAM]);
    expect(blockAfter(out.html, "Wood &amp; Spice"), "the card that was here should have moved down").toBe(UL);
    expect(blockAfter(out.html, "шампунь для волос сушит")).toBe(card(FOAM));
  });

  it("respects a smaller minimum and a larger one", () => {
    expect(placeArticleCards(ARTICLE, [], CANDS, { topic: TOPIC, min: 0, max: 4 }).cards).toEqual([]);
    const four = placeArticleCards(ARTICLE, [], CANDS, { topic: TOPIC, min: 4, max: 4 });
    expectRules(four.html, { min: 4, max: 4 });
    expect(four.cards).toHaveLength(4);
  });
});
