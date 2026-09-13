/**
 * The language the admin assistant answers in
 * (answerLang() in src/app/api/assistant/reply-lang.ts).
 *
 * Renat's acceptance run, 13.09.2026: «I am asking in english which orders are
 * waiting to be shipped and get russian answer». The panel was Russian, and
 * the panel's language was the only language the route knew. The rule now is
 * «the language of the question, the panel's language when the question does
 * not say» — these are the cases that rule has to get right.
 */
import { describe, expect, it } from "vitest";
import { answerLang } from "@/app/api/assistant/reply-lang";

describe("the assistant answers in the language it was asked in", () => {
  it("answers English to an English question, whatever the panel is set to", () => {
    const q = "which orders are waiting to be shipped";
    expect(answerLang(q, "RU")).toBe("EN");
    expect(answerLang(q, "ET")).toBe("EN");
    expect(answerLang(q, "EN")).toBe("EN");
  });

  it("answers English to his other question too — «what is running low»", () => {
    expect(answerLang("what is running low in stock?", "RU")).toBe("EN");
    expect(answerLang("show me the orders I have to ship today", "RU")).toBe("EN");
  });

  it("answers Russian to a Russian question, whatever the panel is set to", () => {
    const q = "Какие заказы ждут отправки?";
    expect(answerLang(q, "EN")).toBe("RU");
    expect(answerLang(q, "ET")).toBe("RU");
    expect(answerLang(q, "RU")).toBe("RU");
  });

  it("reads a Russian sentence carrying Latin brand names as Russian", () => {
    // the shop's brands and its product ids are Latin; only Russian has Cyrillic
    expect(answerLang("подними цену на Proraso Beard Oil до 14,90", "EN")).toBe("RU");
    expect(answerLang("покажи kevin-muprhy-plumping-wash", "EN")).toBe("RU");
    expect(answerLang("что с заказом R-10042?", "EN")).toBe("RU");
  });

  it("answers Estonian to an Estonian question", () => {
    expect(answerLang("millised tellimused ootavad saatmist?", "RU")).toBe("ET");
    expect(answerLang("mis on laos otsas?", "EN")).toBe("ET");
    // no function word on either list, but Estonian's own letters are there
    expect(answerLang("müük täna", "RU")).toBe("ET");
  });

  it("does not read an Estonian question as English on the words they share", () => {
    // «on», «see», «need», «tee», «all» are Estonian AND English words: none of
    // them may count as evidence for either side
    expect(answerLang("kas need tooted on laos?", "RU")).toBe("ET");
    expect(answerLang("mitu tellimust on ootel", "EN")).toBe("ET");
  });

  it("falls back to the panel's language when the words say nothing", () => {
    // a product name, an order number, a bare figure — the old behaviour, kept
    expect(answerLang("Proraso 30 ml", "RU")).toBe("RU");
    expect(answerLang("Proraso 30 ml", "EN")).toBe("EN");
    expect(answerLang("R-10042", "ET")).toBe("ET");
    expect(answerLang("?", "RU")).toBe("RU");
    expect(answerLang("", "EN")).toBe("EN");
    expect(answerLang(undefined, "ET")).toBe("ET");
    expect(answerLang(42, "RU")).toBe("RU");
  });

  it("is not thrown by one stray Cyrillic letter", () => {
    // a two-letter word is the floor: a single «с» left behind by a keyboard
    // switch must not turn an English question into a Russian answer
    expect(answerLang("show me the price of с", "EN")).toBe("EN");
  });
});
