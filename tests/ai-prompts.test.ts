/**
 * Prompt builders for POST /api/admin/ai/text — pure, no network, no
 * database. The one rule every task must enforce in its own system prompt:
 * "use only what's in INPUT, never invent a fact" (the task brief's own
 * words) — plus each task's JSON contract and input validation.
 */
import { describe, expect, it } from "vitest";
import {
  AI_TASKS,
  AiInputError,
  buildBlogOutlinePrompt,
  buildDescribePrompt,
  buildPrompt,
  buildReplyPrompt,
  buildSeoPrompt,
  buildTranslatePrompt,
  HOUSE_VOICE,
  isAiTask,
  buildCopyPrompt,
  DESC_MAX,
  SEO_POST_BODY_MAX,
  SEO_PRODUCT_RULES,
  SEO_RULES,
  TITLE_MAX,
  TITLE_SUFFIXED_UNDER,
} from "@/lib/ai-prompts";

describe("HOUSE_VOICE — the shared house style every task inherits", () => {
  it("forbids inventing facts not present in INPUT", () => {
    expect(HOUSE_VOICE).toMatch(/never invent/i);
    expect(HOUSE_VOICE).toMatch(/only the facts given to you below under input/i);
  });
  it("forbids medical/therapeutic claims", () => {
    expect(HOUSE_VOICE).toMatch(/medical|therapeutic/i);
  });
  it("pins the informal Estonian register and the UK/EU English register", () => {
    expect(HOUSE_VOICE).toMatch(/sina/);
    expect(HOUSE_VOICE).not.toMatch(/\bteie\b.*informal/i); // "teie" only appears as the form to avoid
    expect(HOUSE_VOICE).toMatch(/cart.*not.*basket/i);
    expect(HOUSE_VOICE).toMatch(/delivery.*not.*shipping/i);
  });
  it("carries the proofread-report.md formatting rules (quotation marks, money, units)", () => {
    expect(HOUSE_VOICE).toContain("„");
    expect(HOUSE_VOICE).toMatch(/12,90 €/);
    expect(HOUSE_VOICE).toMatch(/€12\.90/);
    expect(HOUSE_VOICE).toMatch(/2 tk/);
    expect(HOUSE_VOICE).toMatch(/2 pcs/);
  });
});

describe("buildDescribePrompt", () => {
  it("rejects input with no product name", () => {
    expect(() => buildDescribePrompt("RU", {})).toThrow(AiInputError);
    expect(() => buildDescribePrompt("RU", { brand: "Kevin.Murphy" })).toThrow(AiInputError);
  });

  it("only carries facts actually present in the input into the prompt", () => {
    const { system, user } = buildDescribePrompt("RU", { name: "PLUMPING.WASH" });
    expect(user).toContain("PLUMPING.WASH");
    expect(user).not.toContain("Brand:");
    expect(user).not.toContain("Category:");
    expect(system).toMatch(/description.*bullets/is);
  });

  it("passes bullet facts through verbatim, capped, so the model works from them and nothing else", () => {
    const { user } = buildDescribePrompt("RU", {
      name: "Touchable",
      facts: ["для тонких волос", "матовый финиш"],
    });
    expect(user).toContain("для тонких волос");
    expect(user).toContain("матовый финиш");
    expect(user).toMatch(/use only these, do not add more/i);
  });

  it("asks for the requested output language", () => {
    const { system } = buildDescribePrompt("ET", { name: "Touchable" });
    expect(system).toMatch(/in Estonian/);
  });
});

describe("buildTranslatePrompt", () => {
  it("rejects empty text and missing target languages", () => {
    expect(() => buildTranslatePrompt("RU", { targetLangs: ["ET"] })).toThrow(AiInputError);
    expect(() => buildTranslatePrompt("RU", { text: "hello" })).toThrow(AiInputError);
    expect(() => buildTranslatePrompt("RU", { text: "hello", targetLangs: [] })).toThrow(AiInputError);
  });

  it("drops the source language from its own target list", () => {
    const { system } = buildTranslatePrompt("RU", { text: "Привет", targetLangs: ["RU", "ET", "EN"] });
    // asks to translate INTO Estonian and English only, not back into Russian
    expect(system).toMatch(/into Estonian and English/);
  });

  it("names the exact JSON keys for the requested targets only", () => {
    const { system } = buildTranslatePrompt("RU", { text: "Привет", targetLangs: ["ET"] });
    expect(system).toContain('{"ET": "..."}');
    expect(system).not.toContain('"EN"');
  });

  it("instructs the model not to add or shorten anything the source does not say", () => {
    const { system } = buildTranslatePrompt("RU", { text: "x", targetLangs: ["EN"] });
    expect(system).toMatch(/do not shorten, summarise, expand or add anything/i);
  });

  it("carries named products/brands through as names that must not be translated", () => {
    const { system } = buildTranslatePrompt("RU", {
      text: "Крем для лица",
      targetLangs: ["EN"],
      keepNames: ["Kevin.Murphy", "PLUMPING.WASH"],
    });
    expect(system).toContain("Kevin.Murphy");
    expect(system).toContain("PLUMPING.WASH");
  });

  /* The blog editor takes every inserted product card out of a body before
     the body is translated and puts it back where its token came home —
     blogCardsOut()/blogCardsIn() in public/shop2/app.js — so the one thing
     the model must not do to a «[[1]]» is touch it. A text without any is
     not told about them at all: an instruction about placeholders in a text
     that has none is an invitation to invent one. */
  it("tells the model to carry the [[1]] placeholders through untouched, and says so only when there are some", () => {
    const marked = buildTranslatePrompt("RU", {
      text: "Вечером [[1]], утром [[2]].",
      targetLangs: ["ET"],
    }).system;
    expect(marked).toContain("[[1]], [[2]]");
    expect(marked).toMatch(/never translate, renumber, drop or duplicate one/i);
    const plain = buildTranslatePrompt("RU", { text: "Крем для лица", targetLangs: ["ET"] }).system;
    expect(plain).not.toMatch(/placeholder/i);
  });
});

describe("buildSeoPrompt", () => {
  it("rejects input with no name", () => {
    expect(() => buildSeoPrompt("RU", {})).toThrow(AiInputError);
  });
  it("caps title at 60 and description at 155 characters, explicitly, in the instructions", () => {
    const { system } = buildSeoPrompt("RU", { name: "Touchable" });
    expect(system).toMatch(/60 characters/);
    expect(system).toMatch(/155 characters/);
  });
  it("distinguishes a product from a blog post", () => {
    const { system: productSys } = buildSeoPrompt("RU", { name: "Touchable", kind: "product" });
    const { system: blogSys } = buildSeoPrompt("RU", { name: "Зимний уход", kind: "blog" });
    expect(productSys).toMatch(/product/);
    expect(blogSys).toMatch(/blog article/);
  });

  /* kind:"post" — what the blog editor's «Заполнить автоматически» sends:
     the article itself, so the snippet is written from what the owner
     actually wrote and nothing else. */
  it("a post: carries the article's own title, excerpt, tags, product names and text — and asks for the language wanted, not the one the text is in", () => {
    const { system, user } = buildSeoPrompt("ET", {
      kind: "post",
      title: "Уход за бородой зимой",
      excerpt: "Три привычки на холодный сезон.",
      body: "Зимой борода сохнет. Масло вечером, бальзам утром.",
      tags: ["борода", "зима"],
      products: ["Proraso Beard Oil Wood & Spice"],
    });
    expect(system).toMatch(/blog article/);
    expect(system).toMatch(/in Estonian/);
    expect(system).toMatch(/may be written in another language/);
    expect(system).toMatch(/60 characters/);
    expect(system).toMatch(/155 characters/);
    expect(user).toContain("Article title: Уход за бородой зимой");
    expect(user).toContain("Excerpt: Три привычки на холодный сезон.");
    expect(user).toContain("Tags: борода, зима");
    expect(user).toContain("Proraso Beard Oil Wood & Spice");
    expect(user).toContain("Масло вечером, бальзам утром.");
    expect(user).not.toMatch(/Brand:|Category:/);
  });
  it("a post: only the beginning of the text goes to the model", () => {
    const { user } = buildSeoPrompt("RU", { kind: "post", title: "Заголовок", body: "я".repeat(5000) });
    const sent = user.split("do not add more:\n")[1];
    expect(sent).toHaveLength(SEO_POST_BODY_MAX);
  });
  it("a post: leaves out what the article does not have — no empty Excerpt/Tags/Products lines", () => {
    const { user } = buildSeoPrompt("RU", { kind: "post", title: "Заголовок" });
    expect(user).toBe("INPUT:\nArticle title: Заголовок");
  });
  it("a post with no title is refused with its own code", () => {
    expect(() => buildSeoPrompt("RU", { kind: "post", body: "текст" })).toThrow(/missing_title/);
    expect(() => buildSeoPrompt("RU", { kind: "post", title: "   " })).toThrow(AiInputError);
  });
  it("still reads the older kind:\"blog\" spelling, with name/summary as the title/excerpt", () => {
    const { system, user } = buildSeoPrompt("RU", { kind: "blog", name: "Зимний уход", summary: "Анонс" });
    expect(system).toMatch(/blog article/);
    expect(user).toContain("Article title: Зимний уход");
    expect(user).toContain("Excerpt: Анонс");
  });
});

describe("buildReplyPrompt", () => {
  it("rejects a missing customer message or a missing order number", () => {
    expect(() => buildReplyPrompt("RU", { order: { number: "R-100042" } })).toThrow(AiInputError);
    expect(() => buildReplyPrompt("RU", { customerMessage: "Где мой заказ?", order: {} })).toThrow(AiInputError);
  });

  it("forbids guessing anything not given — delivery dates, refund amounts, policy details", () => {
    const { system } = buildReplyPrompt("RU", {
      customerMessage: "Когда придёт?",
      order: { number: "R-100042" },
    });
    expect(system).toMatch(/never guess a delivery date, a reason for a delay, a refund amount/i);
  });

  it("tells the model not to add its own greeting or sign-off (the route appends the real signature)", () => {
    const { system } = buildReplyPrompt("RU", {
      customerMessage: "Спасибо!",
      order: { number: "R-100042" },
    });
    expect(system).toMatch(/no sign-off/i);
    expect(system).toMatch(/added automatically after your text/i);
  });

  it("only states the order status/items that were actually given", () => {
    const { user } = buildReplyPrompt("RU", {
      customerMessage: "Где мой заказ?",
      order: { number: "R-100042", status: "paid", items: [{ title: "Touchable", qty: 2 }] },
    });
    expect(user).toContain("R-100042");
    expect(user).toContain("Touchable");
    expect(user).toContain("paid");
  });
});

describe("buildBlogOutlinePrompt", () => {
  it("rejects a missing topic", () => {
    expect(() => buildBlogOutlinePrompt("RU", {})).toThrow(AiInputError);
  });
  it("asks for exactly 6 H2 headings and forbids inventing product/brand claims", () => {
    const { system } = buildBlogOutlinePrompt("RU", { topic: "уход за бородой зимой" });
    expect(system).toMatch(/exactly 6 section headings/);
    expect(system).toMatch(/do not invent product names, brand claims or statistics/i);
  });
});

describe("buildPrompt dispatcher", () => {
  it("covers every declared task", () => {
    for (const task of AI_TASKS) {
      expect(isAiTask(task)).toBe(true);
    }
  });
  it("routes to the right builder for each task", () => {
    expect(buildPrompt("describe", "RU", { name: "x" }).user).toContain("x");
    expect(buildPrompt("seo", "RU", { name: "x" }).system).toMatch(/60 characters/);
    expect(buildPrompt("blog_outline", "RU", { topic: "x" }).user).toContain("x");
  });
  it("rejects an unknown task", () => {
    // @ts-expect-error deliberately invalid task for the runtime check
    expect(() => buildPrompt("frobnicate", "RU", {})).toThrow(AiInputError);
  });
  it("isAiTask rejects garbage", () => {
    expect(isAiTask("frobnicate")).toBe(false);
    expect(isAiTask(42)).toBe(false);
    expect(isAiTask(undefined)).toBe(false);
  });
});

/* ---------- what a search result is made of ------------------------------
 *
 * Added 07.09.2026 after the Search Console export (docs/audit/
 * 2026-09-07-seo.md). Dim: «Every text generated with AI / Assistant needs to
 * be perfect for SEO.» The prompts used to say «at most 60 characters» and
 * «no trailing "| Rempire"» and nothing else — no shape for the title, no
 * account of what the shop appends by itself, and no word about the fact that
 * the front of a product description IS the meta description of 220 pages. */
describe("SEO_RULES — the budget every snippet task inherits", () => {
  it("states both budgets as numbers the code actually uses", () => {
    expect(TITLE_MAX).toBe(60);
    expect(DESC_MAX).toBe(155);
    expect(SEO_RULES).toContain("about 60 characters of the title and about 155 of the description");
    /* And every task that inherits them repeats its own field's limit as a
       number the model has to count to. */
    expect(buildSeoPrompt("RU", { name: "x" }).system).toMatch(/at most 60 characters INCLUDING spaces/);
    expect(buildSeoPrompt("RU", { name: "x" }).system).toMatch(/at most 155 characters INCLUDING spaces/);
    /* fitTitle() in src/lib/seo-head.mjs adds " — REMPIRE" below 50 chars —
       the model has to know, or it writes the shop's name twice. */
    expect(TITLE_SUFFIXED_UNDER).toBe(50);
    expect(SEO_RULES).toContain('adds " — REMPIRE" to a title of 50 characters or fewer');
    expect(SEO_RULES).toMatch(/Never write "Rempire"/);
  });

  it("forbids the four things that make a snippet look automated", () => {
    expect(SEO_RULES).toMatch(/one subject/i);          // one product per title
    expect(SEO_RULES).toMatch(/keyword stuffing/i);
    expect(SEO_RULES).toMatch(/call to action/i);
    /* A price written into a saved text is wrong the day it changes; the shop
       puts the live one into the result itself (src/lib/seo-head.mjs). */
    expect(SEO_RULES).toMatch(/Never write a price/);
  });

  it("tells the model the words this shop is actually searched by", () => {
    /* Every example is a real query out of the export — brand, the maker's
       own name for the line, then the form. */
    for (const query of [
      "system 4 bio botanical shampoo",
      "kevin murphy anti.gravity spray",
      "davines naturaltech calming shampoo",
      "mandom gatsby moving rubber grunge mat hair wax 80g",
    ]) {
      expect(SEO_PRODUCT_RULES).toContain(query);
    }
    expect(SEO_PRODUCT_RULES).toMatch(/the brand, then the maker's own name for the line, then what the thing is/);
  });

  it("reaches every task that writes a title or a snippet", () => {
    const carries = (system: string) => expect(system).toContain(SEO_RULES);
    carries(buildSeoPrompt("RU", { name: "Touchable" }).system);
    carries(buildSeoPrompt("RU", { kind: "post", title: "Зимний уход" }).system);
    carries(buildBlogOutlinePrompt("RU", { topic: "борода зимой" }).system);
    carries(buildPrompt("post_full", "RU", { topic: "борода зимой" }).system);
    carries(buildPrompt("post_translate", "ET", { title: "Зимний уход", body: "<p>x</p>" }).system);
    /* Only those. A reply to a customer and a translation of a product text
       are not search results, and 1.3 kB of snippet rules in their prompt
       would be noise. */
    expect(buildReplyPrompt("RU", { customerMessage: "где заказ", order: { number: "R-1" } }).system)
      .not.toContain(SEO_RULES);
    expect(buildTranslatePrompt("RU", { text: "x", targetLangs: ["ET"] }).system).not.toContain(SEO_RULES);
  });

  it("only a product's snippet gets the product query shape", () => {
    expect(buildSeoPrompt("RU", { name: "Touchable" }).system).toContain(SEO_PRODUCT_RULES);
    expect(buildSeoPrompt("RU", { kind: "post", title: "Зимний уход" }).system).not.toContain(SEO_PRODUCT_RULES);
  });
});

describe("the first sentence of a description is a search snippet", () => {
  /* src/lib/seo-head.mjs descFrom(): with no Google pair of its own, a product
     page's meta description is cut from the front of this text — for all 220
     catalogue products today. The prompt has to say so, or the model opens
     with a heading and Google prints the heading. */
  it("tells the describe task what its first sentence is for", () => {
    const { system } = buildDescribePrompt("RU", { name: "Touchable", brand: "Kevin.Murphy" });
    expect(system).toContain("THE FIRST SENTENCE IS THE SEARCH SNIPPET");
    expect(system).toMatch(/under 100 characters/);
    expect(system).toMatch(/capitals/);
  });

  it("tells the product-name task that the name becomes the page title", () => {
    const { system } = buildCopyPrompt("RU", { kind: "product_name", name: "Moving Rubber 80g", brand: "Gatsby" });
    expect(system).toMatch(/builds the product page's <title>/);
    expect(system).toMatch(/the size when the maker's name carries one/);
    expect(system).toContain("ANTI.GRAVITY.SPRAY");
  });
});
