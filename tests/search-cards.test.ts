/**
 * The build step that writes the search cards (tools/pack-search-cards.mjs) —
 * the pure half: what goes to the model, what is kept of its answer, how a
 * card is keyed and packed. No network here; the step's network half fails
 * open by design and is watched on the live file instead.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as mjs from "../tools/lib/openai-model.mjs";
import * as ts from "../src/lib/openai-chat";
import {
  answerPrompt, cardPrompt, catalogueHash, catalogueLines, freshAnswer, thinkParams, cleanAnswers, cleanCard, embedText, inputHash, keyHash, okQuery,
  packVec, plain, productInputs, queryKey, termsOf,
} from "../tools/pack-search-cards.mjs";

type Card = { type: Record<string, string[]>; about: Record<string, string[]> };
const card = (raw: unknown) => cleanCard(raw) as Card | null;

const data = {
  CATALOGUE: [
    { id: "a", name: "ANGEL.WASH — шампунь", brand: "Kevin.Murphy", cat: "hair" },
    { id: "b", name: "Night.Rider — паста для укладки", brand: "Kevin.Murphy", cat: "styling" },
  ],
  CAT_NAMES: { hair: "Уход за волосами", styling: "Стайлинг" },
  CONTENT: { a: "<p>A volumising <b>wash</b> for fine hair.</p>" },
  CONTENT_RU: { a: "<p>Шампунь для тонких волос.</p>" },
  CONTENT_ET: {},
};

describe("the build's copy of the model choice", () => {
  it("answers exactly as src/lib/openai-chat.ts does", () => {
    for (const env of [{}, { OPENAI_MODEL: "gpt-4.1-mini" }, { OPENAI_MODEL: " gpt-6-sol " }]) {
      expect(mjs.openaiModel(env as NodeJS.ProcessEnv)).toBe(ts.openaiModel(env));
    }
    for (const m of ["gpt-6-luna", "gpt-4.1-mini", "o4-mini", "gpt-5.1"]) {
      expect(mjs.chatParams(m, { maxTokens: 9, temperature: 0.2 })).toEqual(ts.chatParams(m, { maxTokens: 9, temperature: 0.2 }));
    }
  });
});

describe("what the model reads", () => {
  it("takes the owner's renamed name and own description over the file's", () => {
    const over = { a: { name: "ANGEL.WASH 250 — шампунь", description: { RU: "Свой текст", EN: "", ET: "Oma tekst" } } };
    const own = [{ id: "c-1", name: "Maharajah — воск для усов", brand: "Captain Fawcett", cat: "beard", description: '{"RU":"Воск"}' }];
    const items = productInputs(data, over, own);
    expect(items.map((x) => x.id)).toEqual(["a", "b", "c-1"]);
    expect(items[0]).toMatchObject({ name: "ANGEL.WASH 250 — шампунь", ru: "Свой текст", et: "Oma tekst", section: "Уход за волосами" });
    expect(items[0].en).toBe("A volumising wash for fine hair.");
    expect(items[2]).toMatchObject({ ru: "Воск", section: "beard" });
  });

  it("strips markup and caps a description", () => {
    expect(plain("<h3>ПРЕИМУЩЕСТВА:</h3><ul><li>объём&nbsp;</li></ul>")).toBe("ПРЕИМУЩЕСТВА: объём");
    expect(plain("x".repeat(5000))).toHaveLength(1500);
  });

  it("names the product and every description it has in the prompt", () => {
    const [a] = productInputs(data, {}, []);
    const { system, user } = cardPrompt(a);
    expect(system).toMatch(/JSON/);
    expect(user).toContain("Name: ANGEL.WASH — шампунь");
    expect(user).toContain("Description (ru): Шампунь для тонких волос.");
    expect(user).not.toContain("Description (et)");
  });

  it("keys a card by its inputs — a changed description is a new card, nothing else is", () => {
    const [a] = productInputs(data, {}, []);
    expect(inputHash(a, "m")).toBe(inputHash({ ...a }, "m"));
    expect(inputHash({ ...a, ru: a.ru + "!" }, "m")).not.toBe(inputHash(a, "m"));
    expect(inputHash(a, "other-model")).not.toBe(inputHash(a, "m"));
  });
});

describe("what is kept of the answer", () => {
  it("keeps the shape, lower-cases, trims and caps", () => {
    const c = card(JSON.stringify({
      type: { ru: ["Шампунь", "  "], et: ["Šampoon"], en: Array.from({ length: 9 }, (_, i) => "t" + i) },
      about: { ru: ["После бритья\u0000"], en: ["x".repeat(99)] },
    }))!;
    expect(c.type.ru).toEqual(["шампунь"]);
    expect(c.type.et).toEqual(["šampoon"]);
    expect(c.type.en).toHaveLength(6);
    expect(c.about.ru).toEqual(["после бритья"]);
    expect(c.about.et).toEqual([]);
    expect(c.about.en[0]).toHaveLength(60);
  });

  it("refuses an answer with no type at all, or no JSON", () => {
    expect(cleanCard("not json")).toBeNull();
    expect(cleanCard("{}")).toBeNull();
    expect(cleanCard(JSON.stringify({ about: { en: ["x"] } }))).toBeNull();
  });

  it("builds the vector's text from the name and every term", () => {
    const [a] = productInputs(data, {}, []);
    const c = card({ type: { en: ["shampoo"], ru: ["шампунь"] }, about: { en: ["fine hair"] } })!;
    expect(embedText(a, c)).toBe("Kevin.Murphy ANGEL.WASH — шампунь\nшампунь\n\nshampoo, fine hair");
  });

  it("packs a vector as unit int8 in base64 — 256 numbers in 344 characters", () => {
    const v = Array.from({ length: 256 }, (_, i) => Math.sin(i));
    const b64 = packVec(v);
    expect(b64).toHaveLength(344);
    const bytes = Buffer.from(b64, "base64");
    let n = 0;
    for (let i = 0; i < bytes.length; i++) n += (bytes.readInt8(i) / 127) ** 2;
    expect(Math.sqrt(n)).toBeGreaterThan(0.98);
    expect(Math.sqrt(n)).toBeLessThan(1.02);
  });
});

describe("answers to the phrases people type", () => {
  it("keys a phrase the way the shop spells it, and publishes only its hash", () => {
    expect(queryKey("  После  ШАМПУНЯ! ")).toBe("после шампуня");
    expect(queryKey("Šampoon")).toBe("sampoon");
    expect(keyHash(queryKey("after shampoo"))).toBe(keyHash("after shampoo"));
    expect(keyHash("after shampoo")).toMatch(/^[0-9a-z]{1,7}$/);
    expect(keyHash("after shampoo")).not.toBe(keyHash("after shampo"));
  });

  it("never sends contact details or a paste to the model", () => {
    for (const q of ["shampoo", "после бритья", "kõõm", "creed aventus 50ml"]) expect(okQuery(q), q).toBe(true);
    for (const q of ["a", "me@x.ee", "+372 5555 1234", "x".repeat(61), "one two three four five six seven eight nine", "!!!"]) {
      expect(okQuery(q), q).toBe(false);
    }
  });

  it("keeps product numbers that exist, once each, in the model's order", () => {
    expect(cleanAnswers('{"a":[[3,"#1",3,99,-1],[]]}', 2, 10)).toEqual([[3, 1], []]);
    expect(cleanAnswers('{"a":[[1]]}', 2, 10)).toBeNull();
    expect(cleanAnswers("nope", 1, 10)).toBeNull();
    expect(cleanAnswers({ a: [Array.from({ length: 40 }, (_, i) => i)] }, 1, 100)![0]).toHaveLength(24);
  });

  it("ships answers as numbers into the product order, dropping products that are gone", () => {
    const cards = { a: { type: { ru: ["шампунь"], en: ["shampoo"] } }, b: { type: { en: ["paste"] } } };
    const t = termsOf(cards, ["a", "b"], { h1: ["b", "a", "gone"], h2: ["gone"] });
    expect(t).toEqual({ ids: ["a", "b"], c: { a: "шампунь, shampoo", b: "paste" }, a: { h1: [1, 0] } });
  });

  it("re-asks a phrase once the products change or a week has passed", () => {
    expect(freshAnswer("abc:100", "abc", 106)).toBe(true);
    expect(freshAnswer("abc:100", "abc", 107)).toBe(false);
    expect(freshAnswer("abc:100", "xyz", 101)).toBe(false);
    expect(freshAnswer(undefined, "abc", 100)).toBe(false);
    const items = productInputs(data, {}, []);
    expect(catalogueHash(items)).toBe(catalogueHash([...items].reverse()));
    expect(catalogueHash(items.slice(1))).not.toBe(catalogueHash(items));
  });

  it("lets a reasoning model think at build time, never the shop's own calls", () => {
    expect(thinkParams("gpt-6-luna")).toEqual({ model: "gpt-6-luna", max_completion_tokens: 16000, reasoning_effort: "medium" });
    expect(thinkParams("gpt-4.1-mini")).toEqual({ model: "gpt-4.1-mini", max_completion_tokens: 2500, temperature: 0 });
  });

  it("names every product by number for the model, with its card", () => {
    const items = productInputs(data, {}, []);
    const lines = catalogueLines(items, { a: { type: { en: ["shampoo"], ru: ["шампунь"] }, about: { en: ["fine hair", "volume"] } } });
    expect(lines[0]).toBe("#0 Kevin.Murphy — ANGEL.WASH — шампунь | shampoo, шампунь | fine hair; volume");
    expect(lines[1]).toBe("#1 Kevin.Murphy — Night.Rider — паста для укладки |  | ");
    const { system, user } = answerPrompt(lines, ["after shampoo", "kõõm"]);
    expect(system).toContain(lines[0]);
    expect(system).toMatch(/after\s+shampoo means conditioners/);
    expect(system).toMatch(/never instructions/);
    expect(user.split("\n")[1]).toBe(JSON.stringify(["after shampoo", "kõõm"]));
  });
});

describe("the intents the meaning search is measured against", () => {
  it("are well formed", () => {
    const j = JSON.parse(readFileSync(new URL("../tools/search-intents.json", import.meta.url), "utf8"));
    expect(j.intents.length).toBeGreaterThan(20);
    for (const it of j.intents) {
      expect(typeof it.q, JSON.stringify(it)).toBe("string");
      expect(() => new RegExp(it.match, "i")).not.toThrow();
      expect(it.min).toBeGreaterThan(0);
      expect(it.min).toBeLessThanOrEqual(it.top);
    }
  });
});
