/**
 * The three tasks added for «AI does whole jobs»: post_full (a complete
 * article for a topic), post_translate (the same article in another
 * language, tags in place) and copy (the short texts behind every «✨»
 * button). Pure prompt builders — what is pinned is the contract each one
 * promises the route and the panel: the JSON keys, the length rules, the
 * product list the article may draw on and nothing else, the input it
 * refuses.
 */
import { describe, expect, it } from "vitest";
import {
  AI_TASKS,
  AiInputError,
  buildCopyPrompt,
  buildPostFullPrompt,
  buildPostTranslatePrompt,
  buildPrompt,
  COPY_KINDS,
  isCopyKind,
  POST_PRODUCTS_MAX,
  POST_WORDS,
  PRODUCT_NAME_TAILS,
} from "@/lib/ai-prompts";

describe("buildPostFullPrompt — a whole article, not an outline", () => {
  const products = [
    { id: "proraso-wood-spice-beard-balm-100ml", brand: "Proraso", name: "Wood & Spice Beard Balm — бальзам для бороды", category: "beard" },
    { id: "proraso-beard-oil-azur-lime-30ml", brand: "Proraso", name: "Beard Oil Azur Lime — масло для бороды", category: "beard" },
  ];

  it("rejects a missing topic", () => {
    expect(() => buildPostFullPrompt("RU", {})).toThrow(AiInputError);
    expect(() => buildPostFullPrompt("RU", { topic: "   " })).toThrow(AiInputError);
  });

  it("asks for every field the editor has, 600–900 words of clean HTML and the products actually mentioned", () => {
    const { system, user } = buildPostFullPrompt("RU", { topic: "Как ухаживать за бородой зимой", products });
    expect(system).toContain(`${POST_WORDS[0]}–${POST_WORDS[1]} words`);
    expect(system).toMatch(/"title"/);
    expect(system).toMatch(/"excerpt"/);
    expect(system).toMatch(/"body"/);
    expect(system).toMatch(/"tags"/);
    expect(system).toMatch(/"seoTitle"/);
    expect(system).toMatch(/"seoDescription"/);
    expect(system).toMatch(/"products"/);
    expect(system).toMatch(/<h2>/);
    expect(system).toMatch(/No <h1>/);
    expect(system).toMatch(/no images, no links/i);
    expect(system).toMatch(/not an outline, not a stub/i);
    expect(system).toMatch(/in Russian/);
    expect(user).toContain("Topic: Как ухаживать за бородой зимой");
  });

  it("lists the products it may mention, by id, brand and name — and says nothing else may be named", () => {
    const { user } = buildPostFullPrompt("RU", { topic: "борода зимой", products });
    expect(user).toContain("proraso-wood-spice-beard-balm-100ml | Proraso | Wood & Spice Beard Balm — бальзам для бороды | beard");
    expect(user).toContain("proraso-beard-oil-azur-lime-30ml | Proraso");
    expect(user).toMatch(/these and no others/i);
  });

  it("with no products, forbids naming any product or brand", () => {
    const { user } = buildPostFullPrompt("RU", { topic: "борода зимой" });
    expect(user).toMatch(/do not name any product or brand/i);
  });

  it("caps the product list, drops a malformed id and a duplicate", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `p-${i}`, name: `P${i}` }));
    const { user } = buildPostFullPrompt("RU", { topic: "t", products: [...many, { id: "p-1" }, { id: "Bad Id!" }, { id: "../x" }] });
    const lines = user.split("\n").filter((l) => /^p-\d+ \|/.test(l));
    expect(lines).toHaveLength(POST_PRODUCTS_MAX);
    expect(user).not.toContain("Bad Id!");
    expect(user).not.toContain("../x");
  });

  it("carries the owner's note when given, and writes in the language asked for", () => {
    const { system, user } = buildPostFullPrompt("ET", { topic: "habemehooldus talvel", hint: "для новичков, без химии" });
    expect(user).toContain("The owner's note: для новичков, без химии");
    expect(system).toMatch(/in Estonian/);
  });
});

describe("buildPostTranslatePrompt — the same article in another language", () => {
  const article = {
    sourceLang: "RU",
    title: "Как ухаживать за бородой зимой",
    excerpt: "Три привычки.",
    body: "<p>Зимой борода сохнет.</p><h2>Масло</h2><ul><li>каждый вечер</li></ul>",
    tags: ["борода", "зима"],
    seoTitle: "Уход за бородой зимой",
    seoDescription: "Три привычки на холодный сезон.",
    keepNames: ["Proraso Wood & Spice Beard Balm"],
  };

  it("refuses the source language as the target, and an empty article", () => {
    expect(() => buildPostTranslatePrompt("RU", article)).toThrow(AiInputError);
    expect(() => buildPostTranslatePrompt("ET", { sourceLang: "RU" })).toThrow(AiInputError);
  });

  it("tells the model to keep every HTML tag in place and translate only the text between them", () => {
    const { system } = buildPostTranslatePrompt("ET", article);
    expect(system).toMatch(/keep every tag exactly where it is/i);
    expect(system).toMatch(/never add, drop or rename a tag/i);
    expect(system).toMatch(/from Russian into Estonian/);
    expect(system).toMatch(/do not shorten, summarise, expand/i);
  });

  it("re-fits the Google pair to 60/155 and carries the product names that must not change", () => {
    const { system, user } = buildPostTranslatePrompt("EN", article);
    expect(system).toMatch(/at most 60 characters/);
    expect(system).toMatch(/at most 155 characters/);
    expect(system).toContain("Proraso Wood & Spice Beard Balm");
    expect(user).toContain("body:\n<p>Зимой борода сохнет.</p><h2>Масло</h2>");
    expect(user).toContain("tags: борода, зима");
    expect(user).toContain("seoTitle: Уход за бородой зимой");
  });

  it("names exactly the JSON keys the route shapes", () => {
    const { system } = buildPostTranslatePrompt("EN", article);
    expect(system).toMatch(/\{"title": "\.\.\.", "excerpt": "\.\.\.", "body": "\.\.\.", "tags": \["\.\.\."\], "seoTitle": "\.\.\.", "seoDescription": "\.\.\."\}/);
  });
});

describe("buildCopyPrompt — the «✨» texts", () => {
  it("knows its six kinds and refuses any other", () => {
    expect(COPY_KINDS).toEqual(["hero", "announcement", "contact_page", "email_footer", "promo_note", "product_name"]);
    expect(isCopyKind("hero")).toBe(true);
    expect(isCopyKind("slogan")).toBe(false);
    expect(() => buildCopyPrompt("RU", { kind: "slogan", hint: "x" })).toThrow(AiInputError);
    expect(() => buildCopyPrompt("RU", {})).toThrow(AiInputError);
  });

  it("hero: the four slide texts with the banner's own length caps, in the language asked", () => {
    const { system, user } = buildCopyPrompt("ET", { kind: "hero", hint: "скидка 20 % на бороду", product: "Proraso Beard Balm", target: "Уход за бородой" });
    expect(system).toMatch(/"eyebrow"/);
    expect(system).toMatch(/"title": at most 40 characters/);
    expect(system).toMatch(/"sub": one sentence, at most 90 characters/);
    expect(system).toMatch(/"cta": the button label, at most 24 characters/);
    expect(system).toMatch(/in Estonian/);
    expect(user).toContain("скидка 20 % на бороду");
    expect(user).toContain("Proraso Beard Balm");
    expect(user).toContain("Уход за бородой");
    expect(() => buildCopyPrompt("RU", { kind: "hero" })).toThrow(AiInputError);
  });

  it("announcement: one line and its phone-width twin, placeholders kept, nothing invented", () => {
    const { system } = buildCopyPrompt("RU", { kind: "announcement", hint: "−15 % на наборы до воскресенья" });
    expect(system).toMatch(/"text": at most 90 characters/);
    expect(system).toMatch(/"short"[^\n]*at most 40 characters/);
    expect(system).toContain("{EE} {LV} {FI} {EU}");
    expect(system).toMatch(/no invented dates, percentages or conditions/i);
    expect(() => buildCopyPrompt("RU", { kind: "announcement" })).toThrow(AiInputError);
  });

  it("contact_page: never repeats the phone, e-mail, address or hours the page prints itself", () => {
    const { system, user } = buildCopyPrompt("EN", { kind: "contact_page", company: { name: "Rempire Store OÜ", address: "Mardi 1", phone: "+372 1", hours: "пн 10:00–19:00" } });
    expect(system).toMatch(/do NOT repeat them/);
    expect(system).toMatch(/at most 600 characters/);
    expect(user).toContain("Company: Rempire Store OÜ");
    expect(user).toContain("Mardi 1");
    expect(user).not.toContain("+372 1"); // the phone is printed under the text — not even offered
  });

  it("email_footer: one warm line, capped", () => {
    const { system } = buildCopyPrompt("RU", { kind: "email_footer", hint: "спасибо" });
    expect(system).toMatch(/one extra line/i);
    expect(system).toMatch(/at most 110 characters/);
  });

  it("promo_note: from the code's own conditions, needs a code, never invents a channel", () => {
    const { system, user } = buildCopyPrompt("RU", { kind: "promo_note", promo: { code: "SUVI10", kind: "percent", value: 10, minSubtotal: 50, endsAt: "2026-09-30", maxUses: 100 } });
    expect(user).toContain("Code: SUVI10");
    expect(user).toContain("What it gives: 10 % off");
    expect(user).toContain("Minimum order: 50 €");
    expect(user).toContain("Valid until: 2026-09-30");
    expect(user).toContain("Uses allowed: 100");
    expect(system).toMatch(/never invent a channel or a date/i);
    expect(() => buildCopyPrompt("RU", { kind: "promo_note", promo: { kind: "percent", value: 10 } })).toThrow(AiInputError);
    const free = buildCopyPrompt("RU", { kind: "promo_note", promo: { code: "FREE", kind: "free_shipping" } });
    expect(free.user).toContain("What it gives: free delivery");
  });

  it("product_name: the house pattern with a tail the storefront can translate", () => {
    const { system, user } = buildCopyPrompt("RU", { kind: "product_name", brand: "Proraso", name: "beard balm cypress", category: "Уход за бородой" });
    expect(system).toContain("— <Russian type tail>");
    for (const tail of PRODUCT_NAME_TAILS) expect(system).toContain(tail);
    expect(system).toContain("для бороды");
    expect(system).toMatch(/keep the brand out of the name/i);
    expect(user).toContain("Brand: Proraso");
    expect(user).toContain("What the owner typed as the name: beard balm cypress");
    expect(() => buildCopyPrompt("RU", { kind: "product_name" })).toThrow(AiInputError);
  });
});

describe("the dispatcher knows the new tasks", () => {
  it("declares them and routes to them", () => {
    expect(AI_TASKS).toContain("post_full");
    expect(AI_TASKS).toContain("post_translate");
    expect(AI_TASKS).toContain("copy");
    expect(buildPrompt("post_full", "RU", { topic: "x" }).user).toContain("Topic: x");
    expect(buildPrompt("post_translate", "ET", { title: "x", body: "<p>y</p>" }).system).toMatch(/into Estonian/);
    expect(buildPrompt("copy", "RU", { kind: "email_footer" }).system).toMatch(/one extra line/i);
  });
});
