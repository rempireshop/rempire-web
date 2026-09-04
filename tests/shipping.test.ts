import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import {
  DEFAULT_SHIPPING_RULES,
  computeShipping,
  loadShippingRules,
  normalizeMethod,
  parseShippingRules,
  quoteFromRules,
  resetShippingRulesCache,
  sniffCarrier,
  type ShippingRules,
} from "@/lib/shipping";
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
    expect(quote("LV", "parcel", 10).price).toBe(4.99);
    expect(quote("LT", "parcel", 10).price).toBe(4.99);
    // anything not named falls to the method's default
    expect(quote("DE", "parcel", 10).price).toBe(4.99);
  });

  it("prices a courier per country", () => {
    expect(quote("EE", "courier", 10).price).toBe(10.84);
    expect(quote("DE", "courier", 10).price).toBe(9.9);
    expect(quote("FI", "courier", 10).price).toBe(9.9);
  });

  it("never charges for a pickup", () => {
    const q = quote("EE", "pickup", 0);
    expect(q.price).toBe(0);
    expect(q.free).toBe(true);
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
    expect(quote("FI", "parcel", 100, undefined, custom).price).toBe(4.99);
    expect(quote("FI", "parcel", 150, undefined, custom).price).toBe(0);
    // null = never free in that country, however big the basket
    expect(quote("LV", "parcel", 10_000, undefined, custom).price).toBe(4.99);
    expect(quote("EE", "parcel", 59, undefined, custom).price).toBe(0);
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
    expect(parsed.methods.parcel.LV).toBe(4.99);
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
