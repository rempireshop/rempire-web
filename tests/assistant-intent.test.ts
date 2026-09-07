/**
 * «Набор» or «промокод» — the thing that went wrong.
 *
 * Dim, 07.09.2026: «The "Beardset50" code was done by the assistant, although
 * I wanted to create an item set… so the assistant needs to clearly understand
 * what we're doing.» These are real sentences the owner would type, and what
 * each of them is allowed to become. Pure functions, no model, no network:
 * src/app/api/assistant/intent.ts.
 */
import { describe, expect, it } from "vitest";
import { discountIntent, intentConflicts, intentPromptBlock } from "@/app/api/assistant/intent";

/* The sentence → the intent → what the route does with the action the model
   sent back. `promo` and `bundle` are what the owner's own words say; `ask`
   is the case the assistant must not decide on its own. */
const SENTENCES: Array<[ru: string, want: "bundle" | "promo" | "ask" | ""]> = [
  // ---- a set, unmistakably ------------------------------------------------
  ["собери набор для бороды", "bundle"],
  ["сделай набор из шампуня и кондиционера", "bundle"],
  ["хочу набор Beardset со скидкой 50 %", "bundle"],
  ["добавь масло в набор для бороды", "bundle"],
  ["предложи товары в набор для волос", "bundle"],
  ["сделай комплект для бритья за 39 евро", "bundle"],
  ["в наборе поменяй бальзам на масло", "bundle"],
  ["скидка 20 % на наборы", "bundle"],
  ["продавай эти два товара вместе", "bundle"],
  ["продай их вместе одной ценой", "bundle"],
  ["скрой наборы на сайте", "bundle"],

  // ---- a promo code, unmistakably ----------------------------------------
  ["сделай промокод на 10 %", "promo"],
  ["промокод SUVI10 на бесплатную доставку", "promo"],
  ["нужен купон на 5 евро от 50 евро корзины", "promo"],
  ["сделай код на скидку до конца месяца", "promo"],
  ["выключи промокод SUVI10", "promo"],
  ["промо-код для инстаграма на 15 %", "promo"],

  // ---- both words: the owner may mean either, so ask ----------------------
  ["сделай промокод на наборы -15 %", "ask"],
  ["набор со скидкой по промокоду", "ask"],

  // ---- neither word, a discount over several products: ask ---------------
  ["сделай скидку на несколько товаров", "ask"],
  ["сделай скидку на эти три товара", "ask"],
  ["хочу скидку на пару товаров для бороды", "ask"],
  ["сделай дешевле на два товара", "ask"],
  ["скидку 20 % на группу товаров", "ask"],

  // ---- none of this business ---------------------------------------------
  ["подними цену на PLUMPING.WASH до 9 евро", ""],
  ["сделай скидку на масло Proraso — поставь 12 евро", ""],
  ["что заканчивается на складе", ""],
  ["напиши статью про уход за бородой зимой", ""],
  ["выгрузи отчёт за август", ""],
  ["", ""],
];

describe("what the owner's own words say", () => {
  for (const [sentence, want] of SENTENCES) {
    it(`«${sentence || "(пусто)"}» → ${want || "no opinion"}`, () => {
      expect(discountIntent(sentence)).toBe(want);
    });
  }

  it("reads a word inside its own endings, and not inside another word", () => {
    expect(discountIntent("что в наборе для бороды")).toBe("bundle");
    expect(discountIntent("добавь в комплекты ещё один товар")).toBe("bundle");
    // «код» lives inside «штрихкод», and a barcode is not a promo code
    expect(discountIntent("привяжи штрихкод к маслу Proraso")).toBe("");
    expect(discountIntent("сбрось настройки доставки")).toBe("");
  });

  it("survives anything that is not a string", () => {
    expect(discountIntent(null)).toBe("");
    expect(discountIntent(undefined)).toBe("");
    expect(discountIntent(42)).toBe("");
    expect(discountIntent({ набор: true })).toBe("");
  });
});

describe("the action the model sent back is held to those words", () => {
  it("refuses a promo code for a sentence that said «набор» — Dim's own bug", () => {
    expect(intentConflicts("bundle", "create_promo")).toBe(true);
    expect(intentConflicts("bundle", "propose_bundle")).toBe(false);
    expect(intentConflicts("bundle", "set_bundle")).toBe(false);
  });

  it("refuses a set for a sentence that said «промокод»", () => {
    expect(intentConflicts("promo", "propose_bundle")).toBe(true);
    expect(intentConflicts("promo", "set_bundle")).toBe(true);
    expect(intentConflicts("promo", "create_promo")).toBe(false);
  });

  it("refuses BOTH when the sentence could mean either", () => {
    expect(intentConflicts("ask", "create_promo")).toBe(true);
    expect(intentConflicts("ask", "propose_bundle")).toBe(true);
    expect(intentConflicts("ask", "set_bundle")).toBe(true);
  });

  it("leaves every other action alone, whatever the sentence was about", () => {
    for (const intent of ["bundle", "promo", "ask", ""] as const) {
      for (const type of ["set_price", "set_stock", "set_hero", "draft_post", "create_product", "toggle_bundles", "toggle_promo"]) {
        expect(intentConflicts(intent, type), `${intent} × ${type}`).toBe(false);
      }
      expect(intentConflicts(intent, null)).toBe(false);
      expect(intentConflicts(intent, undefined)).toBe(false);
    }
  });

  it("has no opinion when the sentence had none", () => {
    expect(intentConflicts("", "create_promo")).toBe(false);
    expect(intentConflicts("", "propose_bundle")).toBe(false);
  });
});

describe("what the model is told about the two", () => {
  it("always explains both, and names the one this message is", () => {
    for (const intent of ["bundle", "promo", "ask", ""] as const) {
      const block = intentPromptBlock(intent);
      expect(block).toContain("propose_bundle");
      expect(block).toContain("create_promo");
      expect(block).toContain("ONE price");
      expect(block).toContain("TYPES IN THE CART");
    }
    expect(intentPromptBlock("bundle")).toContain("create_promo is forbidden for this message");
    expect(intentPromptBlock("promo")).toContain("propose_bundle and set_bundle are forbidden for this message");
    expect(intentPromptBlock("ask")).toContain("Do NOT choose");
    expect(intentPromptBlock("")).not.toContain("forbidden for this message");
  });
});
