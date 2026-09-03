/**
 * Does the number on the shopper's screen equal the number the server bills?
 *
 * That question is the whole of audit row 5 («the promo code is client-side
 * only … two shoppers see two different totals depending on which number the
 * server ends up trusting») and row 10 («the panel quotes a different price
 * table from the one checkout charges»). The storefront is a vanilla-JS IIFE
 * with no DOM here, so the three functions that do the arithmetic are **sliced
 * out of public/shop2/app.js by source text** and run against stubs — retyping
 * them would test this file instead of the shop, and the slice fails loudly if
 * app.js drops or renames one of them.
 *
 * The server half is imported for real.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { quoteFromPromo, type Promo } from "@/lib/promos";
import { quoteFromRules, type ShippingRules } from "@/lib/shipping";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

/** Cut `function <name>(…) { … }` out of app.js by brace matching. */
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

type ClientOut = { discount: number; ship: number; sum: number };
type PromoInfo = { code: string; kind: string; value: number; minSubtotal: number } | null;

/**
 * Run the storefront's own discount() / promoLive() / shipPriceFor() over a
 * basket, with the handful of neighbours they call stubbed to the same values
 * the server is given.
 */
function client(promoInfo: PromoInfo, cartSum: number, rules: ShippingRules, country = "EE"): ClientOut {
  const body = `
    ${slice("discount")}
    ${slice("promoLive")}
    ${slice("shipPriceFor")}
    function cartSum() { return CART_SUM; }
    function threshold() {
      var by = SHIP_RULES.freeFromByCountry;
      var f = by && Object.prototype.hasOwnProperty.call(by, S.country) ? by[S.country] : SHIP_RULES.freeFrom;
      return f === null || f === undefined ? Infinity : f;
    }
    function freeShip() { return cartSum() >= threshold(); }
    function shipMethod() { return "parcel"; }
    function shipCarrier() { return S.ship.carrier; }
    function shipCost() { return shipPriceFor(shipMethod(), shipCarrier()); }
    return { discount: discount(), ship: shipCost(), sum: cartSum() };
  `;
  // The body is this repository's own source plus fixed stub text — no input
  // of any kind is interpolated into it.
  const run = new Function("S", "CART_SUM", "SHIP_RULES", body) as (
    s: unknown, n: number, r: ShippingRules,
  ) => ClientOut;
  return run({ promoInfo, country, ship: { carrier: "" } }, cartSum, rules);
}

const RULES: ShippingRules = {
  freeFrom: 59,
  methods: {
    parcel: { default: 4.99, EE: 3.49, LV: 4.99, LT: 4.99 },
    courier: { default: 9.9, EE: 5.99 },
    pickup: { default: 0 },
  },
};

const promo = (over: Partial<Promo>): Promo => ({
  code: "TESTCODE", kind: "percent", value: 10, minSubtotal: 0, startsAt: null, endsAt: null,
  maxUses: null, used: 0, active: true, note: null, createdAt: "2026-01-01T00:00:00Z", ...over,
});

const cases: Array<[string, Promo | null, number]> = [
  ["no code at all", null, 40],
  ["10 % on a small basket", promo({ value: 10 }), 40],
  ["10 % on a basket that already ships free", promo({ value: 10 }), 80],
  ["a fixed code larger than the basket", promo({ kind: "fixed", value: 200 }), 12],
  ["a fixed code under the basket", promo({ kind: "fixed", value: 5 }), 40],
  ["free shipping on a paid delivery", promo({ kind: "free_shipping", value: 0 }), 40],
  ["free shipping on a basket that is already free", promo({ kind: "free_shipping", value: 0 }), 80],
  ["a code whose floor is not reached", promo({ value: 10, minSubtotal: 60 }), 40],
  ["a code whose floor is reached exactly", promo({ value: 10, minSubtotal: 60 }), 60],
  ["an odd basket, so the rounding shows", promo({ value: 15 }), 33.33],
];

describe("the checkout total on screen equals the one the server bills", () => {
  for (const [label, p, sum] of cases) {
    it(label, () => {
      const info: PromoInfo = p
        ? { code: p.code, kind: p.kind, value: p.value, minSubtotal: p.minSubtotal }
        : null;
      const c = client(info, sum, RULES);

      const serverShip = quoteFromRules(RULES, { country: "EE", method: "parcel", subtotal: sum }).price;
      const quote = p ? quoteFromPromo(p, sum, serverShip) : null;
      const serverDiscount = quote?.ok ? quote.discount : 0;

      expect(c.ship).toBe(serverShip);
      expect(c.discount).toBe(serverDiscount);
      expect(Math.round((c.sum - c.discount + c.ship) * 100) / 100)
        .toBe(Math.round((sum + serverShip - serverDiscount) * 100) / 100);
    });
  }

  it("agrees about a country the owner priced separately", () => {
    const rules: ShippingRules = { ...RULES, freeFromByCountry: { LV: null }, methods: { ...RULES.methods, parcel: { ...RULES.methods.parcel, LV: 6.9 } } };
    const c = client(null, 500, rules, "LV");
    const server = quoteFromRules(rules, { country: "LV", method: "parcel", subtotal: 500 });
    // «never free in Latvia» has to survive on both sides, or a 500 € basket
    // ships free on screen and is billed 6,90 €
    expect(c.ship).toBe(6.9);
    expect(server.price).toBe(6.9);
  });
});
