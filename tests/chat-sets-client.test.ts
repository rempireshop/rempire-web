/**
 * The shop's sets in the chat's OWN answers — the ones given without a key
 * (public/shop2/chat.js setFits / setsFor). The same rule as the route's
 * allowedSet() in src/app/api/assistant/shop-sets.ts, which has its own
 * test (assistant-shop-sets): a gift is never a set for a problem the
 * shopper did not name, and a gift for a woman is never a beard or men's
 * set. The live chat, 07.11.2026: «что подарить жене до 60 €?» got the
 * thinning-hair set.
 *
 * The block of chat.js that holds the set helpers is cut out and run on its
 * own, with a small catalogue in place of the shop's.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const chat = readFileSync(fileURLToPath(new URL("../public/shop2/chat.js", import.meta.url)), "utf8");

function between(head: string, tail: string): string {
  const a = chat.indexOf(head);
  const b = chat.indexOf(tail, a);
  if (a < 0 || b < 0) throw new Error(`public/shop2/chat.js no longer has ${JSON.stringify(head)} … ${JSON.stringify(tail)}`);
  return chat.slice(a, b);
}

type Set = { id: string; cat: string; title: string; titles: Record<string, string>; items: string[]; price: number };
const CATALOGUE = [
  { id: "oil", cat: "beard" }, { id: "balm", cat: "beard" }, { id: "soap", cat: "body" },
  { id: "s4-sh", cat: "hair" }, { id: "s4-tonic", cat: "hair" }, { id: "cream", cat: "face" }, { id: "toner", cat: "face" },
];
const helpers = new Function(
  "CATALOGUE", "window",
  between("var CATS_KW = [", "var TYPE_KW = [") +
  between("var SET_ASK_RX = ", "/* The shop's sets first, then the products") +
  "\nreturn { setFits: setFits, setsFor: setsFor };",
)(CATALOGUE, {}) as {
  setFits: (s: Set, q: string, cap: number | null) => boolean;
  setsFor: (q: string, sets: Set[], max: number) => Set[];
};

const mk = (id: string, cat: string, RU: string, EN: string, items: string[], price = 40): Set =>
  ({ id, cat, title: RU, titles: { RU, ET: RU, EN }, items, price });
const PROBLEM = mk("scalp-oily", "hair", "Жирная кожа головы и перхоть — System 4", "Oily scalp and dandruff — System 4", ["s4-sh", "s4-tonic"]);
const GIFT_BEARD = mk("gift-rempire", "body", "Подарочный набор Rempire", "Rempire gift set", ["oil", "balm", "soap"]);
const FOR_HIM = mk("gift-men", "body", "Подарок мужчине", "Gift for him", ["soap"]);
const FACE = mk("face-basic", "face", "Лицо — три шага", "Face — three steps", ["cream", "toner"], 57);

describe("the chat's own answers keep the gift rule (chat.js setFits)", () => {
  it("a gift for a wife — no problem set, no beard or men's set", () => {
    const shown = helpers.setsFor("Что подарить жене?", [PROBLEM, GIFT_BEARD, FOR_HIM, FACE], 3).map((s) => s.id);
    expect(shown).toEqual(["face-basic"]);
  });
  it("«a gift for my wife» refuses the set named «Gift for him»", () => {
    expect(helpers.setFits(FOR_HIM, "a gift for my wife", null)).toBe(false);
    expect(helpers.setFits(FOR_HIM, "подарок мужу", null)).toBe(true);
  });
  it("a gift for someone with dandruff may be the dandruff set; a question that is no gift as well", () => {
    expect(helpers.setFits(PROBLEM, "Подарок маме, у неё перхоть", null)).toBe(true);
    expect(helpers.setFits(PROBLEM, "Есть набор от перхоти?", null)).toBe(true);
    expect(helpers.setFits(PROBLEM, "kinkekomplekt emale", null)).toBe(false);
  });
  it("the budget still holds", () => {
    expect(helpers.setFits(FACE, "подарок до 50 €", 50)).toBe(false);
  });
});
