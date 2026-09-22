/**
 * The table behind «real per-country prices» (Dim, 07.09.2026).
 *
 * Three things have to hold, and the money leaks the moment one of them stops:
 *   1. the cost basis is a carrier the shop can actually put a parcel on;
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
  carrierPriceTable,
  ceilingCost,
  cheapestCost,
  cheapestCostAnyCarrier,
  CHIP_ONLY_CARRIERS,
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
/** The per-carrier reachability index the fetch tool writes beside the rates. */
const COVERAGE = (montonioTariffsData as { coverage: Record<string, unknown> }).coverage;
/** Carriers Montonio quotes nowhere out of Estonia — "direct contract only". */
const NO_CONTRACT_PRICE = (montonioTariffsData as { noMontonioContractPrice: string[] })
  .noMontonioContractPrice;

describe("which carriers count", () => {
  /* The list is restated in country-prices.ts to keep that module a leaf (no
     import cycle through montonio.ts → shipping.ts). This is the guard that
     keeps the copy honest. */
  it("is exactly the carriers the rest of the code can name", () => {
    expect([...SHOP_CARRIERS].sort()).toEqual([...MONTONIO_CARRIERS].sort());
  });

  /* Ренат, 14.09.2026: «From montonio page there is Nova Post, so keep it
     actually… Venipak does not seem to be available, so remove.» */
  it("offers Nova Post and not Venipak", () => {
    expect(SHOP_CARRIERS).toContain("novapost");
    expect(SHOP_CARRIERS).not.toContain("venipak");
    // 26 rows and a coverage block, back from Montonio's own endpoint
    expect(RATES.filter((r) => r.carrier === "novapost")).toHaveLength(26);
    expect(Object.keys(COVERAGE)).toContain("novapost");
    // Venipak has no row to lose: Montonio quotes no price for it out of
    // Estonia at all, which is what `noMontonioContractPrice` records
    expect(RATES.some((r) => r.carrier === "venipak")).toBe(false);
    expect(NO_CONTRACT_PRICE).toContain("venipak");
  });

  it("every carrier in the table is one the shop can pick", () => {
    const carriers = [...new Set(RATES.map((r) => r.carrier))].sort();
    expect(carriers).toEqual(["dpd", "novapost", "omniva", "smartpost", "unisend"]);
    for (const c of carriers) expect(SHOP_CARRIERS).toContain(c);
  });

  /* The line that keeps Nova Post a chip. It is in SHOP_CARRIERS — the
     checkout names it, the rate screen has a column for it — and it is in
     CHIP_ONLY_CARRIERS, so `rowsFor()` will not let it price a country. Both
     have to hold: in the first list alone it would reprice most of Europe
     downwards, in neither it would not exist. */
  it("keeps Nova Post out of every basis, and only Nova Post", () => {
    expect(CHIP_ONLY_CARRIERS).toEqual(["novapost"]);
    for (const c of CHIP_ONLY_CARRIERS) expect(SHOP_CARRIERS).toContain(c);
    for (const country of MONTONIO_COUNTRIES) {
      for (const m of ["parcel", "courier"] as const) {
        expect(cheapestCost(country, m)?.carrier, `${country}/${m}`).not.toBe("novapost");
        expect(ceilingCost(country, m)?.carrier, `${country}/${m}`).not.toBe("novapost");
        expect(costBasis(country, m)?.carrier, `${country}/${m}`).not.toBe("novapost");
      }
    }
  });

  /* …and the countries it must not open. Nova Post has a locker Montonio
     prices in nine countries with no chips — AT CZ DE ES HU IT PL RO SK, and
     Hungary and Romania have no other carrier at all — so letting it into the
     basis would put a parcel price on two countries that have never had one.
     Offering a locker somewhere new is a decision about what the customer
     sees; this is the assertion that it has not been taken by accident. */
  it("opens no parcel machine in a country that had none", () => {
    expect(CARRIER_CHOICE_COUNTRIES).toEqual(["EE", "LV", "LT", "FI"]);
    const parcel = countryPriceTable().parcel;
    expect(parcel.HU).toBeUndefined();
    expect(parcel.RO).toBeUndefined();
    expect(cheapestCostAnyCarrier("HU", "parcel")).toEqual({ price: 7.06, carrier: "novapost" });
    // …and a Nova Post cell exists in exactly the three Baltic countries
    expect(Object.keys(carrierPriceTable().novapost).sort()).toEqual(["EE", "LT", "LV"]);
  });
});

describe("cost: cheapest, dearest, and the one the audit quoted", () => {
  it("reads the cheapest carrier the shop can use, and names it", () => {
    expect(cheapestCost("DE", "courier")).toEqual({ price: 17.55, carrier: "smartpost" });
    expect(cheapestCost("PL", "parcel")).toEqual({ price: 7.44, carrier: "dpd" });
    expect(cheapestCost("GR", "parcel")).toBeNull(); // no parcel machine from Estonia at all
  });

  it("reads the dearest carrier the shop can use", () => {
    expect(ceilingCost("DE", "courier")).toEqual({ price: 23.81, carrier: "dpd" });
    expect(ceilingCost("EE", "parcel")).toEqual({ price: 3.1, carrier: "omniva" });
  });

  /* The audit's headline numbers — «Германия 12,91 €, Польша 8,51 €» — are
     Nova Post's, and `cheapestCostAnyCarrier()` is the one view that shows
     them. They are in the mirror again since 14.09.2026 and they still price
     nothing: the basis is what the shop can put a parcel on knowing it can
     take a return, and that is not Montonio International Shipping. Both
     halves asserted, because the whole point is that the two answers differ.
     Since 22.09.2026 the table is quoted for the 25 × 18 × 8 cm carton, not a
     30 cm cube, so the same two Nova Post rows now read 9.23 and 7.03. */
  it("the audit's cheap numbers are visible and still price nothing", () => {
    expect(cheapestCostAnyCarrier("DE", "courier")).toEqual({ price: 9.23, carrier: "novapost" });
    expect(cheapestCostAnyCarrier("PL", "courier")).toEqual({ price: 7.03, carrier: "novapost" });
    expect(cheapestCost("DE", "courier")!.price).toBeGreaterThan(9.23);
    expect(cheapestCost("PL", "courier")!.price).toBeGreaterThan(7.03);
    expect(countryPriceTable().courier.DE).toBe(17.59);
    expect(countryPriceTable().courier.PL).toBe(15.99);
  });

  it("knows what a return costs where Montonio prices one", () => {
    expect(returnCost("DE", "courier")).toBe(23.81); // DPD, the only reachable carrier that prices a return
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

  /* One step between a tariff and a shelf price, and it only ever rounds up:
     the markup that used to sit in front of it is gone (14.09.2026) — its
     boxes changed no bill, and a hidden multiplier under a screen that says
     «цена Montonio» would have made that sentence untrue. */
  it("is the tariff rounded up, and nothing else", () => {
    // SmartPosti's German courier, 22.23 → 22.29 until the 22.09.2026 carton re-quote
    expect(table.courier.DE).toBe(customerPrice(17.55));
    expect(customerPrice(17.55)).toBe(17.59);
  });

  it("leaves out a country/method with no reachable carrier rather than inventing one", () => {
    expect(table.parcel.GR).toBeUndefined(); // no parcel machine at all
    expect(table.parcel.HU).toBeUndefined(); // no reachable parcel machine
    expect(table.parcel.RO).toBeUndefined(); // no reachable parcel machine
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
