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
  SEO_POST_BODY_MAX,
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
