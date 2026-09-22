/**
 * The delivery step picks a carrier the way Montonio's own calculator does.
 *
 * Дим, 22.09.2026: «We need a choice, either courier and parcel locker, like
 * montonio calculator has, depending on that we show the options and price»,
 * and «first the parcel is preselected and then after a provider». So since
 * that day the checkout offers, per country and per delivery type, the
 * carriers Montonio will take the parcel with — in Montonio's order, the
 * first pre-selected — each at its own price, for a courier as well as for a
 * locker. Nova Post is never offered in Estonia, Latvia or Lithuania: it has no
 * returns at all, and Montonio advises against it where the local locker
 * networks are good.
 *
 * Three things are pinned here, because each has a copy in public/shop2/app.js
 * that no import can keep in step:
 *   1. which carriers each country offers, and in what order;
 *   2. what each of those cards charges;
 *   3. that the price the shopper sees on a card is the price the server
 *      bills for it — for every country, both delivery types, every carrier.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DEFAULT_SHIPPING_RULES, quoteFromRules } from "@/lib/shipping";
import {
  CARRIER_ORDER,
  chipPriceTable,
  MONTONIO_COUNTRIES,
  NO_NOVAPOST_COUNTRIES,
  offeredCarriers,
  PICKUP_POINT_COUNTRIES,
} from "@/lib/shipping/country-prices";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

/** `var NAME = { … };` out of app.js, evaluated. */
function literal<T>(name: string): T {
  const start = src.indexOf(`var ${name} = {`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) {
      return new Function(`return ${src.slice(src.indexOf("{", start), i + 1)};`)() as T;
    }
  }
  throw new Error(`unbalanced braces around ${name}`);
}

/** `var NAME = [ … ];` out of app.js, as source text. */
function arraySource(name: string): string {
  const start = src.indexOf(`var ${name} = [`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  let depth = 0;
  for (let i = src.indexOf("[", start); i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]" && --depth === 0) return src.slice(src.indexOf("[", start), i + 1);
  }
  throw new Error(`unbalanced brackets around ${name}`);
}

/** `function NAME(…) { … }` out of app.js. */
function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}()`);
}

type CarrierMap = Record<string, string[]>;
const PARCEL = literal<CarrierMap>("CARRIERS_BY_COUNTRY");
const COURIER = literal<CarrierMap>("COURIER_CARRIERS");
const PRICE = literal<{ chips: { parcel: Record<string, Record<string, number>>; courier: Record<string, Record<string, number>> } }>(
  "MONTONIO_PRICE",
);

describe("which carriers a country offers", () => {
  it("is the server's list, in the server's order, for a locker", () => {
    for (const cc of MONTONIO_COUNTRIES) {
      expect([cc, PARCEL[cc] ?? []]).toEqual([cc, offeredCarriers(cc, "parcel")]);
    }
  });

  it("is the server's list, in the server's order, for a courier", () => {
    for (const cc of MONTONIO_COUNTRIES) {
      expect([cc, COURIER[cc] ?? []]).toEqual([cc, offeredCarriers(cc, "courier")]);
    }
  });

  it("follows Montonio's calculator: Nova Post, DPD, Omniva, Unisend, SmartPosti", () => {
    expect([...CARRIER_ORDER]).toEqual(["novapost", "dpd", "omniva", "unisend", "smartpost"]);
    // the calculator's own screen for EE → PL by courier, 22.09.2026
    expect(offeredCarriers("PL", "courier")).toEqual(["novapost", "dpd", "smartpost"]);
    // …and for EE → EE by pickup point, Nova Post aside
    expect(offeredCarriers("EE", "parcel")).toEqual(["dpd", "omniva", "unisend", "smartpost"]);
  });

  it("never offers Nova Post in Estonia, Latvia or Lithuania", () => {
    expect([...NO_NOVAPOST_COUNTRIES]).toEqual(["EE", "LV", "LT"]);
    for (const cc of NO_NOVAPOST_COUNTRIES) {
      for (const map of [PARCEL, COURIER]) expect(map[cc] ?? [], cc).not.toContain("novapost");
    }
  });

  it("offers it everywhere else Montonio carries it — which opens Hungary and Romania", () => {
    expect(PARCEL.HU).toEqual(["novapost"]);
    expect(PARCEL.RO).toEqual(["novapost"]);
    expect(PICKUP_POINT_COUNTRIES).toContain("HU");
    expect(PICKUP_POINT_COUNTRIES).toContain("RO");
    expect(PARCEL.PL[0]).toBe("novapost");
  });

  it("shows SmartPosti lockers in Latvia and Lithuania, which were never shown before", () => {
    expect(PARCEL.LV).toContain("smartpost");
    expect(PARCEL.LT).toContain("smartpost");
  });

  it("has no locker at all in Greece — courier only", () => {
    expect(PARCEL.GR).toBeUndefined();
    expect(COURIER.GR).toEqual(["dpd", "smartpost"]);
  });
});

describe("what each card charges", () => {
  it("is the server's chip table, to the cent", () => {
    expect(PRICE.chips.parcel).toEqual(chipPriceTable("parcel"));
    expect(PRICE.chips.courier).toEqual(chipPriceTable("courier"));
  });

  it("prices Poland the way Montonio does for Renat's box", () => {
    // 25 × 18 × 8 cm, 0.9 kg; Montonio ex-VAT × 1.24, rounded up to …,X9
    expect(PRICE.chips.parcel.novapost.PL).toBe(5.49);
    expect(PRICE.chips.parcel.dpd.PL).toBe(7.49);
    expect(PRICE.chips.courier.novapost.PL).toBe(7.09);
    expect(PRICE.chips.courier.smartpost.PL).toBe(15.99);
    expect(PRICE.chips.courier.dpd.PL).toBe(23.89);
  });
});

describe("the price on the card is the price on the bill", () => {
  /* shipRulePrice() and the one helper it calls, run against the literals
     above and the default rules — the same inputs quoteFromRules() gets. */
  const SHIP_RULES = literal<Record<string, unknown>>("SHIP_RULES");
  const shipRulePrice = new Function(
    "SHIP_RULES", "MONTONIO_PRICE", "CARRIERS_BY_COUNTRY", "COURIER_CARRIERS",
    `var S = { country: "EE" }; function orderCountry() { return "EE"; }
     var COUNTRIES = ${arraySource("COUNTRIES")};
     var EUROPE_ISO = ${arraySource("EUROPE_ISO")};
     ${slice("shipZoneOf")}
     ${slice("shipRulePrice")}
     return shipRulePrice;`,
  );

  it("agrees for every country, both delivery types, every carrier", () => {
    const price = shipRulePrice(SHIP_RULES, literal("MONTONIO_PRICE"), PARCEL, COURIER) as (
      m: string, c: string, cc: string,
    ) => number;
    const bad: string[] = [];
    for (const cc of MONTONIO_COUNTRIES) {
      for (const m of ["parcel", "courier"] as const) {
        for (const c of offeredCarriers(cc, m)) {
          const client = price(m, c, cc);
          const server = quoteFromRules(DEFAULT_SHIPPING_RULES, { country: cc, method: m, carrier: c, subtotal: 10 }).price;
          if (Math.abs(client - server) > 0.001) bad.push(`${cc}/${m}/${c}: shop ${client} vs bill ${server}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("keeps the owner's own courier price for every carrier at home", () => {
    // Estonia 10,84 and Latvia/Lithuania 9,90 are Renat's numbers, not Montonio's
    for (const [cc, want] of [["EE", 10.84], ["LV", 9.9], ["LT", 9.9]] as const) {
      for (const c of offeredCarriers(cc, "courier")) {
        expect(quoteFromRules(DEFAULT_SHIPPING_RULES, { country: cc, method: "courier", carrier: c, subtotal: 10 }).price, `${cc}/${c}`)
          .toBe(want);
      }
    }
  });

  it("ignores Nova Post if a stale tab sends it for Estonia", () => {
    const withIt = quoteFromRules(DEFAULT_SHIPPING_RULES, { country: "EE", method: "parcel", carrier: "novapost", subtotal: 10 });
    const without = quoteFromRules(DEFAULT_SHIPPING_RULES, { country: "EE", method: "parcel", subtotal: 10 });
    expect(withIt.price).toBe(without.price);
  });
});
