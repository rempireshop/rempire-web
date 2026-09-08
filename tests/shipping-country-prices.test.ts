/**
 * The table behind «real per-country prices» (Dim, 07.09.2026).
 *
 * Three things have to hold, and the money leaks the moment one of them stops:
 *   1. the cost basis is a carrier the shop can actually put a parcel on —
 *      Nova Post is not one, and it is the cheapest quote on half these routes;
 *   2. who picks the carrier decides which end of the range the price covers;
 *   3. the shelf price is never below the cost it was computed from.
 *
 * The numbers are read back out of src/data/montonio-tariffs.json rather than
 * retyped, except where a literal is the point of the assertion.
 */
import { describe, expect, it } from "vitest";
import montonioTariffsData from "@/data/montonio-tariffs.json";
import { DEFAULT_SHIPPING_RULES, quoteFromRules } from "@/lib/shipping";
import { MONTONIO_CARRIERS } from "@/lib/shipping/montonio";
import {
  CARRIER_CHOICE_COUNTRIES,
  ceilingCost,
  cheapestCost,
  cheapestCostAnyCarrier,
  costBasis,
  countryPriceTable,
  customerPrice,
  MONTONIO_COUNTRIES,
  MONTONIO_NOT_SERVED,
  montonioServes,
  returnCost,
  roundUpToX9,
  SHOP_CARRIERS,
} from "@/lib/shipping/country-prices";

const RATES = (montonioTariffsData as { rates: { carrier: string; country: string; method: string; price: number }[] })
  .rates;

describe("which carriers count", () => {
  /* The list is restated in country-prices.ts to keep that module a leaf (no
     import cycle through montonio.ts → shipping.ts). This is the guard that
     keeps the copy honest. */
  it("is exactly the carriers the rest of the code can name", () => {
    expect([...SHOP_CARRIERS].sort()).toEqual([...MONTONIO_CARRIERS].sort());
  });

  it("does not include Nova Post, which the shop cannot put a parcel on", () => {
    expect(SHOP_CARRIERS).not.toContain("novapost");
    // …and it really is in the tariff table, so excluding it is a decision
    expect(RATES.some((r) => r.carrier === "novapost")).toBe(true);
  });
});

describe("cost: cheapest, dearest, and the one the audit quoted", () => {
  it("reads the cheapest carrier the shop can use, and names it", () => {
    expect(cheapestCost("DE", "courier")).toEqual({ price: 22.23, carrier: "smartpost" });
    expect(cheapestCost("PL", "parcel")).toEqual({ price: 17.86, carrier: "dpd" });
    expect(cheapestCost("GR", "parcel")).toBeNull(); // no parcel machine from Estonia at all
  });

  it("reads the dearest carrier the shop can use", () => {
    expect(ceilingCost("DE", "courier")).toEqual({ price: 32.74, carrier: "dpd" });
    expect(ceilingCost("EE", "parcel")).toEqual({ price: 3.1, carrier: "omniva" });
  });

  /* The audit's headline numbers — «Германия 12,91 €, Польша 8,51 €» — are
     Nova Post's. Keeping the view is how the shop can show what activating
     Montonio International Shipping would be worth. */
  it("keeps the Nova Post view separate, and it is much cheaper", () => {
    expect(cheapestCostAnyCarrier("DE", "courier")).toEqual({ price: 12.91, carrier: "novapost" });
    expect(cheapestCostAnyCarrier("PL", "courier")).toEqual({ price: 8.51, carrier: "novapost" });
    expect(cheapestCostAnyCarrier("DE", "courier")!.price).toBeLessThan(cheapestCost("DE", "courier")!.price);
  });

  it("knows what a return costs where Montonio prices one", () => {
    expect(returnCost("DE", "courier")).toBe(32.74); // DPD, the only reachable carrier that prices a return
    expect(returnCost("GR", "parcel")).toBeNull();
  });
});

describe("the basis rule: whoever picks the carrier has to be covered", () => {
  /* The shopper picks a carrier in exactly one place — the chips under
     «Пакомат» in EE, LV, LT and FI. */
  it("takes the dearest for a parcel machine in the four countries with chips", () => {
    for (const c of CARRIER_CHOICE_COUNTRIES) {
      const ceiling = ceilingCost(c, "parcel");
      expect(ceiling).not.toBeNull();
      expect(costBasis(c, "parcel")).toEqual(ceiling);
    }
    expect(costBasis("EE", "parcel")).toEqual({ price: 3.1, carrier: "omniva" });
  });

  it("takes the cheapest everywhere else, couriers at home included", () => {
    // Estonia's courier: nobody can choose SmartPosti for one, so DPD's 6.82
    // is the cost, not SmartPosti's 7.38
    expect(costBasis("EE", "courier")).toEqual(cheapestCost("EE", "courier"));
    expect(costBasis("EE", "courier")!.price).toBe(6.82);
    for (const c of MONTONIO_COUNTRIES) {
      for (const m of ["parcel", "courier"] as const) {
        if (m === "parcel" && CARRIER_CHOICE_COUNTRIES.includes(c)) continue;
        const cheap = cheapestCost(c, m);
        if (!cheap) continue;
        expect(costBasis(c, m)).toEqual(cheap);
      }
    }
  });
});

describe("the shelf table", () => {
  const table = countryPriceTable();

  it("covers all twenty-five countries Montonio serves and none it does not", () => {
    expect(MONTONIO_COUNTRIES).toHaveLength(25);
    const covered = new Set([...Object.keys(table.parcel), ...Object.keys(table.courier)]);
    expect([...covered].sort()).toEqual([...MONTONIO_COUNTRIES]);
    for (const c of MONTONIO_NOT_SERVED) {
      expect(montonioServes(c)).toBe(false);
      expect(covered.has(c)).toBe(false);
    }
  });

  it("prices every cell at or above the cost it came from", () => {
    for (const method of ["parcel", "courier"] as const) {
      for (const [country, price] of Object.entries(table[method])) {
        const basis = costBasis(country, method);
        expect(basis).not.toBeNull();
        expect(price).toBeGreaterThanOrEqual(basis!.price);
      }
    }
  });

  it("ends every price in 9 cents", () => {
    for (const method of ["parcel", "courier"] as const) {
      for (const price of Object.values(table[method])) {
        expect(Math.round(price * 100) % 10).toBe(9);
        expect(roundUpToX9(price)).toBe(price);
      }
    }
  });

  it("applies the markup before rounding", () => {
    const marked = countryPriceTable({ percent: 10, fixed: 0.5 });
    expect(marked.courier.DE).toBe(customerPrice(22.23, { percent: 10, fixed: 0.5 }));
    expect(marked.courier.DE).toBeGreaterThan(table.courier.DE);
  });

  it("leaves out a country/method with no reachable carrier rather than inventing one", () => {
    expect(table.parcel.GR).toBeUndefined(); // no parcel machine at all
    expect(table.parcel.HU).toBeUndefined(); // Nova Post only
    expect(table.parcel.RO).toBeUndefined(); // Nova Post only
    expect(table.courier.HU).toBeDefined();
  });
});

describe("what the shop now charges", () => {
  const price = (country: string, method: string) =>
    quoteFromRules(DEFAULT_SHIPPING_RULES, { country, method, subtotal: 10 }).price;

  /* The finding that started this: one 9.90 € rate for a continent. */
  it("no longer charges 9.90 € for every European courier", () => {
    const euro = ["AT", "BE", "BG", "CZ", "DE", "DK", "ES", "FR", "GR", "HR", "HU", "IE", "IT", "LU", "NL", "PL", "PT", "RO", "SE", "SI", "SK"];
    for (const c of euro) expect(price(c, "courier")).not.toBe(9.9);
  });

  /* Since 08.09.2026 this holds for the parcel machine too, and that is the
     whole of the audit's question 5: the Latvian and Lithuanian lockers were
     the last two cells sold under cost, and Dim raised them to 5.59. Both
     methods are checked in one loop so neither can quietly slip back. */
  it("never sells a delivery below what it costs to send", () => {
    for (const c of MONTONIO_COUNTRIES) {
      for (const m of ["parcel", "courier"] as const) {
        const cost = costBasis(c, m);
        if (!cost) continue;
        expect([c, m, price(c, m) >= cost.price]).toEqual([c, m, true]);
      }
    }
  });

  it("leaves the home prices Renat already sells above cost alone", () => {
    expect(price("EE", "parcel")).toBe(5.47);
    expect(price("EE", "courier")).toBe(10.84);
    expect(price("LV", "courier")).toBe(9.9);
    expect(price("LT", "courier")).toBe(9.9);
  });

  /* Dim, 08.09.2026, the audit's question 5. A Latvian locker costs 5.58 with
     DPD and the shopper picks the carrier himself, so 4.99 lost 59 cents on
     every order — «Ренат не просил терять по 59 центов с заказа». */
  it("charges 5.59 for a Latvian and Lithuanian parcel machine, not 4.99", () => {
    expect(price("LV", "parcel")).toBe(5.59);
    expect(price("LT", "parcel")).toBe(5.59);
    expect(costBasis("LV", "parcel")).toEqual({ price: 5.58, carrier: "dpd" });
  });

  /* The other half of the same day: free delivery stops at the Baltic and
     Finnish border. A 59 € basket to Greece used to ship free against a
     43.15 € courier — the bigger order earned the shop less than the smaller. */
  it("gives free delivery at 59 € at home and at 200 € for the rest of Europe", () => {
    const floor = (country: string) =>
      quoteFromRules(DEFAULT_SHIPPING_RULES, { country, method: "courier", subtotal: 10 }).freeFrom;
    for (const c of ["EE", "LV", "LT", "FI"]) expect([c, floor(c)]).toEqual([c, 59]);
    for (const c of ["DE", "GR", "PL", "HR", "EU"]) expect([c, floor(c)]).toEqual([c, 200]);
  });

  it("keeps the zone and global cells as the fallback for anything unpriced", () => {
    expect(DEFAULT_SHIPPING_RULES.methods.courier.default).toBe(9.9);
    expect(DEFAULT_SHIPPING_RULES.methods.parcel.default).toBe(4.99);
    expect(DEFAULT_SHIPPING_RULES.methods.courier.EU).toBeUndefined();
  });
});
