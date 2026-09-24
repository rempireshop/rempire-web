/**
 * «Маркетинг → Промокоды»: what a code is narrowed to, in words — never a uuid.
 *
 * The second abandoned-cart letter mints a code per basket (REM-CART-XXXXXX,
 * scope 'cart', db/migrations/197_abandoned_cart_discount.sql) whose
 * scope_value is the basket's id. promoScopeLabel() knew three scopes and
 * read every other one as a product id it could not find, so the list said
 * «на товар «3f2a…-…»» — and the order card, reading the same record off the
 * order (orders.discount_scope), said «только на товар «3f2a…»» under
 * «Скидка». Both say «на корзину из письма» now.
 *
 * And the list's grey line was ONE text node — «−10% · на бренд Davines · от
 * 30 € · использован 2» — which translateTree() cannot split, so on an ET or
 * EN panel none of its pieces was translated although every piece has a rule.
 * One node per piece now (payPiecesHTML), like the order card's «Оплата».
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}
function sliceLiteral(marker: string, terminator: string): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${marker}`);
  const end = src.indexOf(terminator, at);
  return src.slice(at + marker.length, end + terminator.length).replace(/;\s*$/, "");
}

type Lang = "RU" | "ET" | "EN";
const CYR = /[А-Яа-яЁё]/;
const UUID = "3f2a9c1e-7b4d-4e8a-9f0c-2d6b1a5e8c47";

const I18N = `
  var UI = ${sliceLiteral("var UI = ", "\n  };")};
  var UI_RX = ${sliceLiteral("var UI_RX = ", "\n  ];")};
  var NAME_TAILS = ${sliceLiteral("var NAME_TAILS = ", "\n  };")};
  var NAME_FRAGS = ${sliceLiteral("var NAME_FRAGS = ", "\n  ];")};
  var TAIL_EXACT = ${sliceLiteral("var TAIL_EXACT = ", "\n  };")};
  ${slice("trName")}
  ${slice("trText")}
`;
const COMMON = `
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function eur(n) { return n + " €"; }
  var CATALOGUE = [{ id: "kmrepair", brand: "Kevin.Murphy", name: "Repair.Me.Wash — шампунь" }];
  function byIdOrNull(id) { for (var i = 0; i < CATALOGUE.length; i++) if (CATALOGUE[i].id === id) return CATALOGUE[i]; return null; }
`;

/** The text nodes a string of markup becomes, put through translateTree()'s trText (NAME_CTX). */
function translated(html: string, lang: Lang): string[] {
  const nodes = html
    .split(/<[^>]*>/)
    .map((t) => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim())
    .filter(Boolean);
  if (lang === "RU") return nodes;
  const trText = runInNewContext(`${I18N}\ntrText`) as (s: string, l: string, allowName: boolean) => string;
  return nodes.map((t) => (CYR.test(t) ? trText(t, lang, true) : t));
}

const PROMOS = [
  { code: "TEST10", kind: "percent", value: 10, minSubtotal: 0, endsAt: null, used: 0, maxUses: null, active: true, scope: "order", scopeValue: null },
  { code: "DAVINES", kind: "percent", value: 15, minSubtotal: 30, endsAt: null, used: 2, maxUses: null, active: true, scope: "brand", scopeValue: "Davines" },
  { code: "WASH5", kind: "fixed", value: 5, minSubtotal: 0, endsAt: null, used: 0, maxUses: null, active: true, scope: "product", scopeValue: "kmrepair" },
  { code: "REM-CART-7K2Q9X", kind: "percent", value: 5, minSubtotal: 0, endsAt: "2026-10-01T00:00:00.000Z", used: 0, maxUses: 1, active: true, scope: "cart", scopeValue: UUID },
];

function label(p: object): string {
  return runInNewContext(`${COMMON}\n${slice("promoScopeLabel")}\npromoScopeLabel(${JSON.stringify(p)});`, {}) as string;
}

function promoList(lang: Lang): string {
  return runInNewContext(`
    var S = { lang: ${JSON.stringify(lang)}, admPromos: ${JSON.stringify(PROMOS)}, admPromoErr: "", promoForm: null };
    var SRV = { admin: true };
    var ADM_ROW_OPEN = " data-admrowopen";
    ${COMMON}
    function loadAdminPromos() {}
    function promoFormHTML() { return ""; }
    function admSwitch() { return "<i></i>"; }
    ${slice("payPiecesHTML")}
    ${slice("promoKindLabel")}
    ${slice("promoScopeLabel")}
    ${slice("promoWhen")}
    ${slice("admPromoUsed")}
    ${slice("admPromoUsedLine")}
    ${slice("admPromosHTML")}
    admPromosHTML();
  `, {}) as string;
}

function discountRow(scope: object | null, lang: Lang): string[] {
  const html = runInNewContext(`
    ${COMMON}
    ${slice("admOrderDiscountHTML")}
    admOrderDiscountHTML({ discount: 4.5, discountCode: "REM-CART-7K2Q9X", subtotal: 120, discountScope: ${JSON.stringify(scope)} });
  `, {}) as string;
  return translated(html, lang);
}

describe("promoScopeLabel: every scope in words", () => {
  it("a whole-basket code has no label", () => {
    expect(label(PROMOS[0])).toBe("");
    expect(label({ scope: "brand", scopeValue: "" })).toBe("");
  });
  it("a brand code names the brand", () => {
    expect(label(PROMOS[1])).toBe("на бренд Davines");
  });
  it("a product code names the product, or its id when the catalogue has lost it", () => {
    expect(label(PROMOS[2])).toBe("на товар «Repair.Me.Wash — шампунь»");
    expect(label({ scope: "product", scopeValue: "gone-id" })).toBe("на товар «gone-id»");
  });
  it("a cart code says it is the basket from the letter — never the basket's uuid", () => {
    expect(label(PROMOS[3])).toBe("на корзину из письма");
    // a row somebody emptied by hand keeps scope 'cart' (src/lib/promos.ts)
    expect(label({ scope: "cart", scopeValue: null })).toBe("на корзину из письма");
  });
});

describe("«Промокоды»: the list's grey line in the panel's language", () => {
  it("RU: the cart code reads «на корзину из письма», and no uuid is anywhere on the screen", () => {
    const html = promoList("RU");
    expect(html).not.toContain(UUID);
    expect(translated(html, "RU")).toContain("на корзину из письма");
  });

  const WANT: Record<"ET" | "EN", string[]> = {
    EN: ["on the cart from the e-mail", "on Davines", "on “Repair.Me.Wash — shampoo”", "used 2", "used 0 of 1", "from 30 €"],
    ET: ["ostukorvile kirjast", "brändile Davines", "tootele «Repair.Me.Wash — šampoon»", "kasutatud 2", "kasutatud 0 / 1", "alates 30 €"],
  };
  for (const lang of ["EN", "ET"] as const) {
    it(`${lang}: every piece of every code's line is translated`, () => {
      const nodes = translated(promoList(lang), lang);
      expect(nodes).toEqual(expect.arrayContaining(WANT[lang]));
      // the rows' own text — the two hints under the list are dictionary keys and translate too
      expect(nodes.filter((t) => CYR.test(t))).toEqual([]);
    });
  }
});

describe("the order card's «Скидка» line for a cart code", () => {
  const scope = { kind: "cart", value: UUID, base: 90, lines: ["kmrepair"] };
  it("RU: names the letter's basket and the part of the order it counted", () => {
    const nodes = discountRow(scope, "RU");
    expect(nodes).toContain("только на корзину из письма · 90 € из 120 €");
    expect(nodes.join("\n")).not.toContain(UUID);
  });
  it("EN and ET: translated", () => {
    expect(discountRow(scope, "EN")).toContain("on the cart from the e-mail only · 90 € of 120 €");
    expect(discountRow(scope, "ET")).toContain("ainult ostukorvile kirjast · 90 € / 120 €");
  });
  it("brand and product codes keep their lines", () => {
    expect(discountRow({ kind: "brand", value: "Davines", base: 40 }, "RU")).toContain("только на бренд Davines · 40 € из 120 €");
    expect(discountRow({ kind: "product", value: "kmrepair", base: 20 }, "EN"))
      .toContain("on “Repair.Me.Wash — shampoo” only · 20 € of 120 €");
  });
});
