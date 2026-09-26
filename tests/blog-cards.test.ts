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
    // ai-blog-cards e2 (staging, 26.09.2026): a card straight under a bullet list
    const list = blocks[i - 1].tag === "ul" || blocks[i - 1].tag === "ol";
    expect(list && blocks[i].html.includes("data-product"), `a card right after a list: ${blocks[i - 1].html} ${blocks[i].html}`).toBe(false);
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
    // not right under the list any more (ai-blog-cards e2): after the next paragraph
    expect(blockAfter(out.html, "горошина бальзама")).toBe(H3);
    expect(blockAfter(out.html, "шампунь для волос сушит")).toBe(card(BALM));
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
    // a paragraph before the closing words: the third card stands there, and the article still ends in words
    const roomy = placeArticleCards([P0, H1, P_OIL, P_HOW, H2, P_BALM, UL, H3, "<h2>Ещё раз</h2>", P_WASH, P_END].join(""), [], CANDS, { topic: TOPIC });
    expectRules(roomy.html);
    expect(roomy.cards).toHaveLength(3);
    expect(blockAfter(roomy.html, "шампунь для волос сушит")).toBe(card(roomy.cards[2]));
    expect(roomy.html.endsWith(P_END)).toBe(true);
    // a list is not room: never a card straight under it (ai-blog-cards e2), so the closing words it is
    const listed = placeArticleCards([P0, H1, P_OIL, P_HOW, H2, P_BALM, UL, H3, "<h2>Ещё раз</h2>", "<h2>И ещё</h2>", P_END].join(""), [], CANDS, { topic: TOPIC });
    expectRules(listed.html);
    expect(listed.cards).toHaveLength(3);
    expect(blockAfter(listed.html, "горошина бальзама")).toBe(H3);
    expect(listed.html.endsWith(P_END + card(listed.cards[2]))).toBe(true);
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

/* ---- ai-blog-cards e3 (verification pass on staging, 25.09.2026) ----------
   An article on «как ухаживать за сухими волосами осенью» came back with
   two cards back to back — Bio Botanical Shampoo, then Bio Botanical Serum,
   two card-only lines straight under the heading «Выбор средств для ухода».
   The placement rules («never two in a row», «a card follows words, not a
   heading») were only ever applied to the cards this module PLACES; the
   cards the model wrote itself were kept wherever it put them. The same
   pair also appears when a line between two cards held only a card for an
   unknown id (dropped), or only a blank line — which the editor drops
   (BLOG_DROP_EMPTY in public/shop2/app.js), so the owner saw the two cards
   touch there as well. */
describe("placeArticleCards — the model's own cards keep the same rules as the placed ones", () => {
  const SERUM = "system-4-bio-botanical-serum";
  const HAIR: CardCandidate[] = [
    { id: SHAMPOO, brand: "System 4", name: "Bio Botanical Shampoo — шампунь", category: "hair" },
    { id: SERUM, brand: "System 4", name: "Bio Botanical Serum — сыворотка", category: "hair" },
    { id: OIL, brand: "Proraso", name: "Beard Oil Azur Lime — масло для бороды", category: "beard" },
  ];
  const HP0 = "<p>Осенью волосы сохнут: ветер на улице, батареи дома.</p>";
  const HH1 = "<h2>Почему волосы сохнут</h2>";
  const HP1 = "<p>Горячая вода и фен вымывают из волос влагу быстрее, чем летом.</p>";
  const HH2 = "<h2>Выбор средств для ухода</h2>";
  const HP2 = "<p>Мягкий шампунь без сульфатов очищает и не сушит кожу головы.</p>";
  const HP3 = "<p>Сыворотка на кончики держит влагу до следующего мытья.</p>";
  const HH3 = "<h2>Привычки</h2>";
  const HP4 = "<p>Мойте голову тёплой водой, а не горячей.</p>";
  const HP5 = "<p>Заходите на Mardi 1 — подберём уход под ваши волосы.</p>";
  const cardAfterHeading = (html: string) => {
    const blocks = splitBlocks(html);
    for (let i = 1; i < blocks.length; i++) {
      const head = blocks[i - 1].tag === "h2" || blocks[i - 1].tag === "h3";
      expect(head && blocks[i].html.includes("data-product"), `a card straight under ${blocks[i - 1].html}`).toBe(false);
    }
  };

  it("two cards the model wrote back to back under a heading: split, each after words of that section", () => {
    const body = [HP0, HH1, HP1, HH2, card(SHAMPOO), card(SERUM), HP2, HP3, HH3, HP4, HP5].join("");
    const out = placeArticleCards(body, [{ id: SHAMPOO }, { id: SERUM }], HAIR, { topic: "как ухаживать за сухими волосами осенью" });
    expectRules(out.html);
    cardAfterHeading(out.html);
    expect(out.cards.slice(0, 2)).toEqual([SHAMPOO, SERUM]);
    expect(blockAfter(out.html, "Мягкий шампунь без сульфатов")).toBe(card(SHAMPOO));
    expect(blockAfter(out.html, "Сыворотка на кончики")).toBe(card(SERUM));
  });

  it("two cards the model wrote back to back after a paragraph: the first stays, the second moves on", () => {
    const body = [HP0, HH1, HP1, HH2, HP2, card(SHAMPOO), card(SERUM), HP3, HH3, HP4, HP5].join("");
    const out = placeArticleCards(body, [], HAIR, { topic: "сухие волосы" });
    expectRules(out.html);
    expect(blockAfter(out.html, "Мягкий шампунь без сульфатов")).toBe(card(SHAMPOO));
    expect(blockAfter(out.html, "Сыворотка на кончики")).toBe(card(SERUM));
  });

  it("a line between them that held only an unknown card, or nothing at all, does not keep them apart", () => {
    for (const between of ['<p><a data-product="system-4-invented-mask"></a></p>', "<p><br></p>", "<p>&nbsp;</p>"]) {
      const body = [HP0, HH1, HP1, HH2, HP2, card(SHAMPOO), between, card(SERUM), HP3, HH3, HP4, HP5].join("");
      const out = placeArticleCards(body, [], HAIR, { topic: "сухие волосы" });
      expectRules(out.html);
      expect(out.html, between).not.toMatch(/<p>(<br>|&nbsp;|\s)*<\/p>/);
      expect(out.cards, between).toEqual(expect.arrayContaining([SHAMPOO, SERUM]));
    }
  });

  it("a card the model opened the article with moves under words", () => {
    const body = [card(SHAMPOO), HP0, HH1, HP1, HH2, HP2, HP3, HH3, HP4, HP5].join("");
    const out = placeArticleCards(body, [], HAIR, { topic: "сухие волосы" });
    expectRules(out.html);
    expect(splitBlocks(out.html)[0].html).toBe(HP0);
    expect(out.cards).toContain(SHAMPOO);
  });
});

/* ---- ai-blog-cards e2 (verification pass on staging, 26.09.2026) ----------
   «Как создать летний образ в мужском уходе», written whole by «Написать
   статью целиком», came back with FIVE cards — Bio Botanical Shampoo,
   Touchable, Night.Rider, Bio Botanical Serum, Un.Tangled Spray — and the
   last one straight under a bullet list. The ceiling (POST_CARDS_MAX) held
   only for the cards this module adds; the model's own were all kept. And a
   card lifted out of a list, or one the model wrote right after it, was put
   «right after the list» on purpose. Now: at most four per article (the
   cards that stand where the model put them first, in the order they
   stand; the ones that had to be moved are the first to go), and never a
   card directly after a list — it goes after the next paragraph, or out of
   the article when no paragraph follows. */
describe("placeArticleCards — at most four, and never straight under a list", () => {
  const TOUCH = "kevin-murphy-touchable";
  const NIGHT = "kevin-murphy-night-rider";
  const SERUM = "system-4-bio-botanical-serum";
  const UNTANGLED = "kevin-murphy-untangled";
  const SUMMER: CardCandidate[] = [
    { id: SHAMPOO, brand: "System 4", name: "Bio Botanical Shampoo — шампунь", category: "hair" },
    { id: TOUCH, brand: "Kevin.Murphy", name: "Touchable — спрей", category: "styling" },
    { id: NIGHT, brand: "Kevin.Murphy", name: "Night.Rider — паста", category: "styling" },
    { id: SERUM, brand: "System 4", name: "Bio Botanical Serum — сыворотка", category: "hair" },
    { id: UNTANGLED, brand: "Kevin.Murphy", name: "Un.Tangled — спрей", category: "hair" },
  ];
  const S0 = "<p>Летом волосы и кожа головы сохнут от солнца и солёной воды.</p>";
  const SH1 = "<h2>Очищение</h2>";
  const S1 = "<p>Мягкий шампунь без сульфатов очищает и не сушит кожу головы.</p>";
  const SH2 = "<h2>Укладка</h2>";
  const S2 = "<p>Лёгкий спрей даёт объём и не утяжеляет.</p>";
  const S3 = "<p>Для текстуры подойдёт паста с матовым финишем.</p>";
  const SH3 = "<h2>Уход</h2>";
  const S4 = "<p>Сыворотка на кончики держит влагу до следующего мытья.</p>";
  const SUL = "<ul><li>после душа</li><li>на влажные кончики</li></ul>";
  const S5 = "<p>Заходите на Mardi 1 — подберём уход под ваши волосы.</p>";

  it("the staging article: five of the model's cards, the fifth under a list — four stay, none under the list", () => {
    const body = [S0, SH1, S1, card(SHAMPOO), SH2, S2, card(TOUCH), S3, card(NIGHT), SH3, S4, card(SERUM), SUL, card(UNTANGLED), S5].join("");
    const picks = SUMMER.map((c) => ({ id: c.id }));
    const out = placeArticleCards(body, picks, SUMMER, { topic: "летний образ в мужском уходе" });
    expectRules(out.html);
    expect(out.cards).toEqual([SHAMPOO, TOUCH, NIGHT, SERUM]);
    expect(out.html, "the fifth card is still in the text").not.toContain(UNTANGLED);
    expect(blockAfter(out.html, "на влажные кончики")).toBe(S5);
  });

  it("six cards where the model put them: the first four stay, the rest go and leave no empty line", () => {
    const paras = Array.from({ length: 7 }, (_, i) => `<p>Абзац ${i + 1}: борода, масло и бальзам.</p>`);
    const ids = [OIL, BALM, CAPTAIN, FOAM, OIL_BIG, SHAMPOO];
    const body = paras.map((p, i) => p + (ids[i] ? card(ids[i]) : "")).join("");
    const out = placeArticleCards(body, [], CANDS, { topic: TOPIC });
    expectRules(out.html);
    expect(out.cards).toEqual([OIL, BALM, CAPTAIN, FOAM]);
    expect(out.html).not.toContain(OIL_BIG);
    expect(out.html).not.toContain(SHAMPOO);
    expect(out.html).toBe(paras.map((p, i) => p + (i < 4 ? card(ids[i]) : "")).join(""));
  });

  it("a card of the owner's kind, inline in a sentence, counts too — an extra one keeps its words", () => {
    const inline = `<p>Возьмите <a data-product="${SHAMPOO}" href="/shop2/p/${SHAMPOO}/">System 4 шампунь</a> на лето.</p>`;
    const body = [S0, card(TOUCH), S1, card(NIGHT), S2, card(SERUM), S3, card(UNTANGLED), S4, inline, S5].join("");
    const out = placeArticleCards(body, [], SUMMER, { topic: "лето" });
    expectRules(out.html);
    expect(out.cards).toEqual([TOUCH, NIGHT, SERUM, UNTANGLED]);
    expect(out.html).toContain("<p>Возьмите System 4 шампунь на лето.</p>");
  });

  it("the model's card right after a list moves after the next paragraph", () => {
    const body = [P0, H1, P_OIL, card(OIL), P_HOW, H2, P_BALM, UL, card(BALM), H3, P_WASH, P_END].join("");
    const out = placeArticleCards(body, [], CANDS, { topic: TOPIC });
    expectRules(out.html);
    expect(blockAfter(out.html, "горошина бальзама")).toBe(H3);
    expect(blockAfter(out.html, "шампунь для волос сушит")).toBe(card(BALM));
  });

  it("…and leaves the article when no paragraph follows the list — which is then topped up to the minimum", () => {
    const body = [P0, H1, P_OIL, card(OIL), P_HOW, H2, P_BALM, UL, card(BALM)].join("");
    const out = placeArticleCards(body, [], CANDS, { topic: TOPIC });
    expectRules(out.html);
    expect(out.cards).not.toContain(BALM);
    expect(out.cards[0]).toBe(OIL);
    expect(out.html.endsWith(UL), "a card still stands under the closing list").toBe(true);
  });

  it("a product the model named never lands under a list either, even when its paragraph is taken", () => {
    // the balm takes the paragraph above the list; the Captain, pointed at the same section, used to slip in under the list
    const out = placeArticleCards(ARTICLE, [{ id: BALM }, { id: CAPTAIN, after: "Бальзам утром" }], CANDS, { topic: TOPIC });
    expectRules(out.html);
    expect(blockAfter(out.html, "Wood &amp; Spice")).toBe(card(BALM));
    expect(blockAfter(out.html, "горошина бальзама")).toBe(H3);
    expect(blockAfter(out.html, "шампунь для волос сушит")).toBe(card(CAPTAIN));
  });
});
