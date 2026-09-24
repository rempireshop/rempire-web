/**
 * «от …» on a delivery type means the cheapest card is pre-selected.
 *
 * Дим, /test, 24.09.2026, on «Цены доставки: страница и касса» (ok): «Prices
 * correct, but when we show "from ... " then we should also pre-select the
 * cheapest one.» Until then the checkout pre-selected the FIRST carrier in
 * Montonio's calculator order (Nova Post, DPD, Omniva, Unisend, SmartPosti),
 * so the «Пакомат» row of an Estonian order said «от 2,49 €» while the card
 * already ticked under it was DPD's 2,59 € — and the total in the summary was
 * the dearer one. In Finland the gap was 3 €, for a Greek courier 6,90 €.
 *
 * Only the DEFAULT moves. A carrier the shopper tapped, or the one the
 * account's «Доставка по умолчанию» brought in, is kept; the order of the
 * cards and every price on them are unchanged. On a tie the first card in
 * Montonio's order is still the one.
 *
 * The storefront's own functions, sliced out of public/shop2/app.js by source
 * text and run over its own tables (tests/acct-default-delivery.test.ts's
 * technique); the bill is quoteFromRules(), imported for real.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_SHIPPING_RULES, quoteFromRules } from "@/lib/shipping";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

const has = (name: string) => src.includes(`function ${name}(`);

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

/** Every one of these that app.js has — a helper the fix added is simply absent before it. */
const fns = (...names: string[]) => names.filter(has).map(slice).join("\n");

/** The SOURCE of a `var <name> = <literal>;` in app.js. */
function literalSrc(name: string): string {
  const at = src.indexOf(`var ${name} = `);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  const open = at + `var ${name} = `.length;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{" || src[i] === "[") depth++;
    else if ((src[i] === "}" || src[i] === "]") && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unterminated literal for ${name}`);
}

type Shop = {
  S: { country: string; countryIso: string; ship: { method: string; carrier: string }; cart: unknown[] };
  POINTS: { empty: Record<string, boolean> };
  SHIP_RULES: { carriers: Record<string, Record<string, number>> };
  shipCarrier: () => string;
  shipRulePrice: (m: string, c: string, cc?: string) => number;
  methodCarriers: (m: string, cc?: string) => string[];
  acctShipPrice: (x: { l: string; pm?: string; pickup?: boolean }) => number;
  acctMethods: (cc: string) => Array<{ l: string; pm?: string; pickup?: boolean }>;
};

/** A fresh checkout: `country`/`iso` as the two selects hold them, nothing tapped. */
function shop(country: string, iso = "", method = "parcel"): Shop {
  const body = `
    var S = { country: ${JSON.stringify(country)}, countryIso: ${JSON.stringify(iso)}, cart: [],
      ship: { method: ${JSON.stringify(method)}, carrier: "", point: null },
      acctForm: { ship: null } };
    var POINTS = { empty: {}, by: {}, big: {} };
    var SHIP_RULES = ${literalSrc("SHIP_RULES")};
    var MONTONIO_PRICE = ${literalSrc("MONTONIO_PRICE")};
    var CARRIERS_BY_COUNTRY = ${literalSrc("CARRIERS_BY_COUNTRY")};
    var COURIER_CARRIERS = ${literalSrc("COURIER_CARRIERS")};
    var CARRIER_NAMES = ${literalSrc("CARRIER_NAMES")};
    var COUNTRIES = ${literalSrc("COUNTRIES")};
    var EUROPE_ISO = ${literalSrc("EUROPE_ISO")};
    var DELIVERY = ${literalSrc("DELIVERY")};
    ${fns(
      "orderCountry", "shipZoneOf", "shipServed", "giftOnlyCart", "deliveryFor", "shipMethod", "pickupOpen",
      "carriersFor", "courierCarriersFor", "methodCarriers", "shipRulePrice", "cheapestCarrier", "shipCarrier",
      "acctShipCountry", "acctMethods", "acctShipPrice",
    )}
    return { S: S, POINTS: POINTS, SHIP_RULES: SHIP_RULES, shipCarrier: shipCarrier, shipRulePrice: shipRulePrice,
      methodCarriers: methodCarriers, acctShipPrice: acctShipPrice, acctMethods: acctMethods };
  `;
  return new Function(body)() as Shop;
}

/** The «от» the delivery-type row prints: the cheapest card under it. */
function fromPrice(s: Shop, m: string): number {
  return Math.min(...s.methodCarriers(m).map((c) => s.shipRulePrice(m, c)));
}

describe("the card ticked on arrival is the cheapest one", () => {
  it("Estonia, «Пакомат»: Unisend 2,49 €, not DPD 2,59 € at the head of the list", () => {
    const s = shop("EE");
    expect(s.methodCarriers("parcel")[0]).toBe("dpd");   // Montonio's order is unchanged
    expect(s.shipCarrier()).toBe("unisend");
    expect(s.shipRulePrice("parcel", s.shipCarrier())).toBe(2.49);
  });

  it("Finland, «Пакомат»: SmartPosti 9,39 €, not DPD 12,39 €", () => {
    const s = shop("FI");
    expect(s.shipCarrier()).toBe("smartpost");
    expect(s.shipRulePrice("parcel", "smartpost")).toBe(9.39);
  });

  it("Latvia, «Пакомат»: Unisend 3,79 €", () => {
    expect(shop("LV").shipCarrier()).toBe("unisend");
  });

  it("Greece, «Курьер до двери»: SmartPosti 28,89 €, not DPD 35,79 €", () => {
    const s = shop("EU", "GR", "courier");
    expect(s.shipCarrier()).toBe("smartpost");
    expect(s.shipRulePrice("courier", "smartpost", "GR")).toBe(28.89);
  });

  it("is the card the row's «от» names, in every country, for both delivery types", () => {
    const bad: string[] = [];
    for (const iso of ["EE", "LV", "LT", "FI", "PL", "DE", "HU", "RO", "SE", "GR", "IT", "FR"]) {
      const home = ["EE", "LV", "LT", "FI"].includes(iso);
      for (const m of ["parcel", "courier"]) {
        const s = shop(home ? iso : "EU", home ? "" : iso, m);
        if (!s.methodCarriers(m).length) continue;
        const picked = s.shipRulePrice(m, s.shipCarrier());
        if (picked !== fromPrice(s, m)) bad.push(`${iso}/${m}: ticked ${s.shipCarrier()} ${picked}, «от» ${fromPrice(s, m)}`);
        // …and the bill for that card is the same number
        const bill = quoteFromRules(DEFAULT_SHIPPING_RULES, { country: iso, method: m, carrier: s.shipCarrier(), subtotal: 10 }).price;
        if (Math.abs(bill - picked) > 0.001) bad.push(`${iso}/${m}: card ${picked}, bill ${bill}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("keeps the first card on a tie — Estonia's courier is 10,84 € with every carrier", () => {
    const s = shop("EE", "", "courier");
    expect(new Set(s.methodCarriers("courier").map((c) => s.shipRulePrice("courier", c))).size).toBe(1);
    expect(s.shipCarrier()).toBe(s.methodCarriers("courier")[0]);
  });

  it("follows the owner's own prices, not only Montonio's", () => {
    const s = shop("EE");
    s.SHIP_RULES.carriers.omniva.EE = 1;
    expect(s.shipCarrier()).toBe("omniva");
  });

  it("skips a carrier whose list came back empty — the next cheapest, first on a tie", () => {
    const s = shop("EE");
    s.POINTS.empty["unisend:EE"] = true;
    // DPD and SmartPosti are both 2,59 €: DPD comes first in Montonio's order
    expect(s.shipCarrier()).toBe("dpd");
  });
});

describe("a carrier somebody chose is left alone", () => {
  it("the shopper's own tap", () => {
    const s = shop("EE");
    s.S.ship.carrier = "omniva";
    expect(s.shipCarrier()).toBe("omniva");
  });

  it("the account's default (applyAcctShipPref writes it into S.ship.carrier)", () => {
    const s = shop("FI");
    s.S.ship.carrier = "dpd";
    expect(s.shipCarrier()).toBe("dpd");
  });

  it("a carrier the new delivery type does not offer falls back to the cheapest, not to the first", () => {
    const s = shop("EE", "", "courier");
    s.S.ship.carrier = "unisend";   // a locker carrier, no courier of its own
    s.SHIP_RULES.carriers.omniva.EE = 1;   // parcel only — the courier tie stands
    expect(s.shipCarrier()).toBe(s.methodCarriers("courier")[0]);
  });
});

describe("the account's «Курьер до двери» row prices the card the checkout ticks", () => {
  it("Greece: 28,89 € in the account, 28,89 € ticked at the till", () => {
    const s = shop("EU", "GR", "courier");
    const row = s.acctMethods("GR").find((x) => !x.pm && !x.pickup);
    expect(row).toBeTruthy();
    s.S.acctForm = { ship: { country: "GR", method: "courier", carrier: "" } } as never;
    expect(s.acctShipPrice(row!)).toBe(28.89);
    expect(s.acctShipPrice(row!)).toBe(s.shipRulePrice("courier", s.shipCarrier(), "GR"));
  });
});
