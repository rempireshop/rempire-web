import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import {
  DEFAULT_SHIPPING_RULES,
  computeShipping,
  countryOff,
  loadShippingRules,
  normalizeMethod,
  parseShippingRules,
  quoteFromRules,
  resetShippingRulesCache,
  shippingZone,
  sniffCarrier,
  type ShippingRules,
} from "@/lib/shipping";

describe("zones: an order carries a real country, the rules price it by row", () => {
  it("maps the four named countries to themselves, Europe to the EU row, the rest to default", () => {
    for (const c of ["EE", "LV", "LT", "FI"]) expect(shippingZone(c)).toBe(c);
    for (const c of ["DE", "de", "IT", "NL", "SE", "NO", "CH", "GB", "IS"]) expect(shippingZone(c), c).toBe("EU");
    for (const c of ["US", "UA", "TR", "JP", "", "XX"]) expect(shippingZone(c), c).toBe("default");
    // orders placed before the checkout asked for the country still say "EU"
    expect(shippingZone("EU")).toBe("EU");
  });

  it("prices a German courier order from the EU row and a US one from the default cell", () => {
    const rules: ShippingRules = {
      ...DEFAULT_SHIPPING_RULES,
      methods: {
        parcel: { default: 4.99, EE: 5.47, EU: 8.5 },
        courier: { default: 9.9, EE: 10.84, EU: 16.29 },
        pickup: { default: 0 },
      },
      freeFromByCountry: { EU: 120, default: null },
    };
    const de = quoteFromRules(rules, { country: "DE", method: "courier", subtotal: 40 });
    expect(de.price).toBe(16.29);
    expect(de.freeFrom).toBe(120);
    expect(de.country, "the quote keeps the real country").toBe("DE");
    const us = quoteFromRules(rules, { country: "US", method: "courier", subtotal: 40 });
    expect(us.price).toBe(9.9);
    expect(us.freeFrom).toBeNull();
    const legacy = quoteFromRules(rules, { country: "EU", method: "parcel", subtotal: 40 });
    expect(legacy.price).toBe(8.5);
  });

  it("prefers a country's own cell over its zone, so Europe need not be one price", () => {
    // Montonio's own contract rates run from 17.86 € (Poland) to 52.08 €
    // (Croatia) for the same box; the «EU» cell cannot be right for both.
    // «Заполнить по тарифам Montonio» writes country cells like these.
    const rules: ShippingRules = {
      ...DEFAULT_SHIPPING_RULES,
      methods: {
        parcel: { default: 4.99, EU: 29.99, PL: 17.89, HR: 59.59 },
        courier: { default: 9.9, EU: 39.99 },
        pickup: { default: 0 },
      },
      freeFromByCountry: { EU: 200, PL: 90 },
    };
    expect(quoteFromRules(rules, { country: "PL", method: "parcel", subtotal: 40 }).price).toBe(17.89);
    expect(quoteFromRules(rules, { country: "HR", method: "parcel", subtotal: 40 }).price).toBe(59.59);
    // a European country with no cell of its own still falls to the EU row
    expect(quoteFromRules(rules, { country: "DE", method: "parcel", subtotal: 40 }).price).toBe(29.99);
    // and the method with no country cell at all still falls to the EU row
    expect(quoteFromRules(rules, { country: "PL", method: "courier", subtotal: 40 }).price).toBe(39.99);
    // the free-from threshold resolves the same way: country, then zone
    expect(quoteFromRules(rules, { country: "PL", method: "parcel", subtotal: 40 }).freeFrom).toBe(90);
    expect(quoteFromRules(rules, { country: "DE", method: "parcel", subtotal: 40 }).freeFrom).toBe(200);
  });

  it("lets a carrier's country cell beat the same carrier's zone cell", () => {
    const rules: ShippingRules = {
      ...DEFAULT_SHIPPING_RULES,
      methods: { parcel: { default: 4.99, EU: 29.99 }, courier: { default: 9.9 }, pickup: { default: 0 } },
      carriers: { dpd: { EU: 24.99, PL: 14.99 } },
    };
    expect(quoteFromRules(rules, { country: "PL", method: "parcel", subtotal: 10, carrier: "dpd" }).price).toBe(14.99);
    expect(quoteFromRules(rules, { country: "DE", method: "parcel", subtotal: 10, carrier: "dpd" }).price).toBe(24.99);
  });
});
import { setupDb, teardownDb } from "./helpers";

const rules = DEFAULT_SHIPPING_RULES;
const quote = (
  country: string,
  method: string,
  subtotal: number,
  carrier?: string,
  r: ShippingRules = rules,
) => quoteFromRules(r, { country, method, subtotal, carrier });

describe("the default price list", () => {
  it("prices a parcel machine per country", () => {
    expect(quote("EE", "parcel", 10).price).toBe(5.47);
    // 08.09.2026, Dim: the Latvian and Lithuanian locker covers its 5.58 € DPD
    // cost now — those two were the last cells the shop sold at a loss.
    expect(quote("LV", "parcel", 10).price).toBe(5.59);
    expect(quote("LT", "parcel", 10).price).toBe(5.59);
    // Since 07.09.2026 every country Montonio serves has its own cell rather
    // than falling to the method's default: a German parcel machine costs
    // 29.76 € on the cheapest carrier the shop can actually put it on.
    expect(quote("DE", "parcel", 10).price).toBe(29.79);
  });

  it("prices a courier per country", () => {
    expect(quote("EE", "courier", 10).price).toBe(10.84);
    expect(quote("DE", "courier", 10).price).toBe(22.29);
    expect(quote("FI", "courier", 10).price).toBe(15.69);
    expect(quote("GR", "courier", 10).price).toBe(43.19);
    expect(quote("PL", "courier", 10).price).toBe(20.69);
  });

  /* The zone cell is still there, and still 9.90 — it is what a destination
     with no tariff row of its own falls back to, exactly as before. */
  it("keeps the zone and the global fallback for anything not in the table", () => {
    expect(quote("CH", "courier", 10).price).toBe(9.9); // Europe, Montonio does not serve it
    expect(quote("US", "courier", 10).price).toBe(9.9); // outside Europe → `default`
    expect(quote("CH", "parcel", 10).price).toBe(4.99);
  });

  it("never charges for a pickup", () => {
    const q = quote("EE", "pickup", 0);
    expect(q.price).toBe(0);
    expect(q.free).toBe(true);
  });

  /* The whole point of the change: not one number for the continent. */
  it("gives twenty-five different countries genuinely different prices", () => {
    const couriers = new Set(
      ["AT", "BE", "BG", "CZ", "DE", "DK", "ES", "FR", "GR", "HR", "IE", "IT", "NL", "PL", "SE"].map(
        (c) => quote(c, "courier", 10).price,
      ),
    );
    expect(couriers.size).toBeGreaterThan(10);
    expect(couriers.has(9.9)).toBe(false);
  });
});

describe("countries switched off in the shop", () => {
  it("defaults the seven Montonio cannot reach to off", () => {
    for (const c of ["CY", "MT", "IS", "LI", "NO", "CH", "GB"]) {
      expect(countryOff(rules, c)).toBe(true);
    }
  });

  it("leaves every country Montonio serves on", () => {
    for (const c of ["EE", "LV", "LT", "FI", "DE", "GR", "PL", "SE"]) {
      expect(countryOff(rules, c)).toBe(false);
    }
  });

  /* A switched-off country is a storefront rule, not a pricing one: an order
     that got past the dropdown is still priced rather than dropped. */
  it("still quotes a price for a country that is off", () => {
    expect(quote("GB", "courier", 10).price).toBe(9.9);
  });

  it("is Renat's to change, empty list included", () => {
    expect(countryOff({ ...rules, countriesOff: [] }, "GB")).toBe(false);
    expect(countryOff({ ...rules, countriesOff: ["GB"] }, "CY")).toBe(false);
    expect(countryOff({ ...rules, countriesOff: ["GB"] }, "gb")).toBe(true);
  });
});

describe("free delivery", () => {
  it("kicks in at the threshold, not a cent before", () => {
    expect(quote("EE", "parcel", 58.99).price).toBe(5.47);
    expect(quote("EE", "parcel", 58.99).free).toBe(false);
    expect(quote("EE", "parcel", 59).price).toBe(0);
    expect(quote("EE", "parcel", 59).free).toBe(true);
    expect(quote("EE", "parcel", 200).price).toBe(0);
  });

  it("applies to couriers and to every country", () => {
    expect(quote("EE", "courier", 59).price).toBe(0);
    expect(quote("LT", "parcel", 60).price).toBe(0);
  });

  it("reports the threshold so the basket can count down to it", () => {
    expect(quote("EE", "parcel", 10).freeFrom).toBe(59);
  });

  it("honours a per-country threshold", () => {
    const custom: ShippingRules = {
      ...rules,
      freeFrom: 59,
      freeFromByCountry: { FI: 150, LV: null },
    };
    expect(quote("FI", "parcel", 100, undefined, custom).price).toBe(12.39);
    expect(quote("FI", "parcel", 150, undefined, custom).price).toBe(0);
    // null = never free in that country, however big the basket
    expect(quote("LV", "parcel", 10_000, undefined, custom).price).toBe(5.59);
    expect(quote("EE", "parcel", 59, undefined, custom).price).toBe(0);
  });

  /* Item 5 of Dim's decision: the threshold has to be settable per ZONE, so
     one number covers all of Europe without twenty-one edits — and a country
     of its own still beats its zone. */
  it("honours a per-zone threshold, and lets one country beat its zone", () => {
    const custom: ShippingRules = {
      ...rules,
      freeFrom: 59,
      freeFromByCountry: { EU: 150, GR: null },
    };
    // Europe: 59 € is no longer enough, 150 € is
    expect(quote("DE", "courier", 100, undefined, custom).free).toBe(false);
    expect(quote("DE", "courier", 100, undefined, custom).freeFrom).toBe(150);
    expect(quote("DE", "courier", 150, undefined, custom).price).toBe(0);
    // Greece costs 43.15 € to reach — never free, whatever the basket
    expect(quote("GR", "courier", 10_000, undefined, custom).price).toBe(43.19);
    expect(quote("GR", "courier", 10_000, undefined, custom).freeFrom).toBe(null);
    // home is untouched by a European rule
    expect(quote("EE", "parcel", 59, undefined, custom).price).toBe(0);
    expect(quote("EE", "parcel", 59, undefined, custom).freeFrom).toBe(59);
  });

  /* Renat's partner said so on 08.09.2026 — «Rest of EU — from €200». Croatia
     and Greece are exactly the countries this was written for: a 59 € basket
     to either used to ship free against a courier costing 28.26 € and
     43.15 €, so the bigger order earned the shop less than the smaller one. */
  it("ships free from 59 € at home and from 200 € for the rest of Europe", () => {
    expect(rules.freeFromByCountry).toEqual({ EU: 200 });
    for (const c of ["EE", "LV", "LT", "FI"]) {
      expect([c, quote(c, "courier", 59).price]).toEqual([c, 0]);
    }
    expect(quote("HR", "courier", 59).price).toBe(28.29);
    expect(quote("GR", "courier", 59).price).toBe(43.19);
    expect(quote("GR", "courier", 200).price).toBe(0);
    expect(quote("GR", "courier", 59).freeFrom).toBe(200);
  });
});

describe("carrier overrides", () => {
  const withCarriers: ShippingRules = {
    ...rules,
    carriers: { omniva: { EE: 2.99 }, dpd: { default: 6.5 } },
  };

  it("prefers the carrier's own price when there is one", () => {
    expect(quote("EE", "parcel", 10, "omniva", withCarriers).price).toBe(2.99);
    expect(quote("EE", "parcel", 10, "OMNIVA", withCarriers).price).toBe(2.99);
    expect(quote("LV", "parcel", 10, "dpd", withCarriers).price).toBe(6.5);
    // a carrier with no entry falls back to the method table
    expect(quote("EE", "parcel", 10, "smartpost", withCarriers).price).toBe(5.47);
  });

  /* A carrier cell is a parcel-machine price — the fill button writes no
     courier ones, because the checkout shows carrier chips only under
     «Пакомат». Reading one for a courier charged the Omniva *parcel* price
     for an Estonian courier as soon as the fill button was used. */
  it("ignores a carrier price for a courier or a pickup", () => {
    expect(quote("EE", "courier", 10, "omniva", withCarriers).price).toBe(10.84);
    expect(quote("LV", "courier", 10, "dpd", withCarriers).price).toBe(9.9);
    expect(quote("EE", "pickup", 10, "omniva", withCarriers).price).toBe(0);
  });
});

describe("method names as the checkout actually sends them", () => {
  it("normalises three languages of label", () => {
    expect(normalizeMethod("parcel")).toBe("parcel");
    expect(normalizeMethod("Пакомат Omniva")).toBe("parcel");
    expect(normalizeMethod("Курьер до двери (DPD)")).toBe("courier");
    expect(normalizeMethod("DPD kuller")).toBe("courier");
    expect(normalizeMethod("Courier to the door")).toBe("courier");
    expect(normalizeMethod("Самовывоз — Mardi 1, Таллинн")).toBe("pickup");
    expect(normalizeMethod("Tule ise järele")).toBe("pickup");
    expect(normalizeMethod(undefined)).toBe("parcel");
  });

  it("prices a courier label as a courier, not as a parcel", () => {
    expect(quote("EE", "Курьер до двери (DPD)", 10).price).toBe(10.84);
    expect(quote("EE", "Самовывоз — Mardi 1", 10).price).toBe(0);
  });

  it("finds the carrier inside a label", () => {
    expect(sniffCarrier("Пакомат Omniva")).toBe("omniva");
    expect(sniffCarrier("Пакомат SmartPosti")).toBe("smartpost");
    expect(sniffCarrier("Курьер DPD")).toBe("dpd");
    expect(sniffCarrier("Самовывоз")).toBeUndefined();
  });
});

describe("parsing the settings row", () => {
  it("keeps the defaults for anything missing or nonsense", () => {
    expect(parseShippingRules(null)).toEqual(DEFAULT_SHIPPING_RULES);
    expect(parseShippingRules("not an object")).toEqual(DEFAULT_SHIPPING_RULES);
    expect(parseShippingRules([1, 2])).toEqual(DEFAULT_SHIPPING_RULES);
    expect(parseShippingRules({ freeFrom: "rubbish" }).freeFrom).toBe(59);
    expect(parseShippingRules({ methods: { parcel: { EE: "nope" } } }).methods.parcel.EE).toBe(5.47);
  });

  it("merges a partial row over the defaults one line at a time", () => {
    const parsed = parseShippingRules({
      freeFrom: 75,
      methods: { parcel: { EE: 2.5 } },
    });
    expect(parsed.freeFrom).toBe(75);
    expect(parsed.methods.parcel.EE).toBe(2.5);
    // untouched entries survive
    expect(parsed.methods.parcel.LV).toBe(5.59);
    expect(parsed.methods.courier.EE).toBe(10.84);
  });

  it("accepts freeFrom: null as 'never free'", () => {
    expect(parseShippingRules({ freeFrom: null }).freeFrom).toBeNull();
    expect(quote("EE", "parcel", 10_000, undefined, parseShippingRules({ freeFrom: null })).price).toBe(
      5.47,
    );
  });

  it("reads a numeric string, as jsonb hands them back", () => {
    expect(parseShippingRules({ freeFrom: "75" }).freeFrom).toBe(75);
    expect(parseShippingRules({ methods: { courier: { EE: "7.50" } } }).methods.courier.EE).toBe(7.5);
  });
});

describe("against the database", () => {
  beforeAll(async () => {
    await setupDb();
  });
  afterAll(async () => {
    await teardownDb();
  });
  beforeEach(() => {
    resetShippingRulesCache();
  });

  it("migrations 030 + 031 seed a rules row the admin can edit, at the sourced EE tariffs", async () => {
    // The raw row, not loadShippingRules(): that one merges over the code
    // defaults, so a missing EE cell would read as 5.47 and hide a stale seed.
    const rows = await query<{ value: { methods: Record<string, Record<string, number>> } }>(
      "select value from settings where key = 'shipping_rules'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].value.methods.parcel.EE).toBe(5.47);
    expect(rows[0].value.methods.courier.EE).toBe(10.84);
    const loaded = await loadShippingRules();
    expect(loaded?.freeFrom).toBe(59);
  });

  it("bills what the settings row says, not what the code says", async () => {
    await query(
      `insert into settings (key, value) values ('shipping_rules', $1::jsonb)
       on conflict (key) do update set value = excluded.value`,
      [JSON.stringify({ freeFrom: 40, methods: { parcel: { EE: 1.5 } } })],
    );
    resetShippingRulesCache();

    const q = await computeShipping({ country: "EE", method: "parcel", subtotal: 10 });
    expect(q.price).toBe(1.5);
    expect(q.source).toBe("settings");

    const free = await computeShipping({ country: "EE", method: "parcel", subtotal: 40 });
    expect(free.price).toBe(0);
    expect(free.free).toBe(true);
  });

  it("falls back to the defaults when the row is gone", async () => {
    await query("delete from settings where key = 'shipping_rules'");
    resetShippingRulesCache();
    const q = await computeShipping({ country: "EE", method: "parcel", subtotal: 10 });
    expect(q.price).toBe(5.47);
    expect(q.source).toBe("defaults");
  });
});
