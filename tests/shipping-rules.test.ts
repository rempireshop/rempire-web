/**
 * The delivery-price editor's two ends.
 *
 * The audit rows this covers: «the admin's Настройки → Доставка quotes a
 * different price table from the one checkout charges» and «shipping defaults
 * are below cost outside Estonia and there is no admin editor for them». The
 * panel now writes settings.shipping_rules, so what is checked here is that
 * anything that can reach that row — a hand-typed table, an assistant action —
 * is bounded, and that what comes back out prices an order.
 *
 * Pure functions plus one PGlite round trip through the settings row.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { sanitizeAction, sanitizeShippingRules } from "@/app/api/assistant/actions";
import { exec } from "@/lib/db";
import { createOrder, setSetting } from "@/lib/orders";
import {
  DEFAULT_SHIPPING_RULES,
  computeShipping,
  parseShippingRules,
  quoteFromRules,
  resetShippingRulesCache,
} from "@/lib/shipping";
import { setupDb, teardownDb } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const known = new Set(CATALOGUE.map((p) => p.id));
const cheap = CATALOGUE.filter((p) => p.s === "in").sort((a, b) => a.p - b.p)[0];

const customer = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };

describe("what the assistant may do to the delivery prices", () => {
  it("takes a partial patch and leaves everything else alone", () => {
    const out = sanitizeShippingRules({ methods: { parcel: { LV: 6.9 } } }) as {
      methods: { parcel: Record<string, number> };
    };
    expect(out).toEqual({ methods: { parcel: { LV: 6.9 } } });
    // «сделай доставку в Латвию 6,90» must not carry the other eleven prices
    expect(Object.keys(out.methods)).toEqual(["parcel"]);
  });

  it("accepts a comma for a decimal point, the way the owner speaks", () => {
    expect(sanitizeShippingRules({ methods: { courier: { EE: "6,50" } } }))
      .toEqual({ methods: { courier: { EE: 6.5 } } });
  });

  it("refuses a price that is not a tariff", () => {
    expect(sanitizeShippingRules({ methods: { parcel: { EE: -1 } } })).toBe(null);
    expect(sanitizeShippingRules({ methods: { parcel: { EE: 100 } } })).toBe(null);
    expect(sanitizeShippingRules({ methods: { parcel: { EE: "free" } } })).toBe(null);
    expect(sanitizeShippingRules({ methods: { parcel: { EE: 99 } } })).toEqual({ methods: { parcel: { EE: 99 } } });
    // two decimals, never a float tail
    expect(sanitizeShippingRules({ methods: { parcel: { EE: 3.4567 } } }))
      .toEqual({ methods: { parcel: { EE: 3.46 } } });
  });

  it("drops a country, a method or a carrier the shop does not have", () => {
    expect(sanitizeShippingRules({ methods: { parcel: { XX: 5 } } })).toBe(null);
    expect(sanitizeShippingRules({ methods: { drone: { EE: 5 } } })).toBe(null);
    expect(sanitizeShippingRules({ carriers: { fedex: { EE: 5 } } })).toBe(null);
    expect(sanitizeShippingRules({ carriers: { omniva: { EE: 3.29 } } }))
      .toEqual({ carriers: { omniva: { EE: 3.29 } } });
    // «default» is a real key, not a country
    expect(sanitizeShippingRules({ methods: { courier: { default: 9.9 } } }))
      .toEqual({ methods: { courier: { default: 9.9 } } });
  });

  /* Every carrier an order may actually carry (SHIP_CARRIERS in
     src/lib/orders.ts). «unisend» was missing from the assistant's own list,
     so a Unisend price the owner asked for was dropped without a word — the
     confirm card still said «Применить» and the tariff never moved. */
  it("takes a price for every carrier the shop ships with, Unisend included", () => {
    for (const carrier of ["omniva", "smartpost", "dpd", "venipak", "unisend"]) {
      expect(sanitizeShippingRules({ carriers: { [carrier]: { EE: 4.5 } } }), carrier)
        .toEqual({ carriers: { [carrier]: { EE: 4.5 } } });
    }
    // …and the name as the model is likeliest to write it
    expect(sanitizeShippingRules({ carriers: { Unisend: { LV: 5.2 } } }))
      .toEqual({ carriers: { unisend: { LV: 5.2 } } });
  });

  it("handles the free-shipping floor, null included", () => {
    expect(sanitizeShippingRules({ freeFrom: 79 })).toEqual({ freeFrom: 79 });
    expect(sanitizeShippingRules({ freeFrom: null })).toEqual({ freeFrom: null });
    expect(sanitizeShippingRules({ freeFromByCountry: { FI: 99, LV: null } }))
      .toEqual({ freeFromByCountry: { FI: 99, LV: null } });
    expect(sanitizeShippingRules({ freeFromByCountry: { XX: 99 } })).toBe(null);
  });

  it("says no to nonsense rather than storing an empty table", () => {
    expect(sanitizeShippingRules(null)).toBe(null);
    expect(sanitizeShippingRules("everything free")).toBe(null);
    expect(sanitizeShippingRules([])).toBe(null);
    expect(sanitizeShippingRules({})).toBe(null);
  });

  it("only reaches the shop through the admin door", () => {
    const good = { type: "set_shipping_rules", rules: { methods: { parcel: { LV: 6.9 } } } };
    expect(sanitizeAction(good, known, true)).toEqual(good);
    expect(sanitizeAction(good, known, false)).toBe(null);   // a customer cannot reprice delivery
    expect(sanitizeAction({ type: "set_shipping_rules", rules: { methods: { parcel: { LV: 900 } } } }, known, true)).toBe(null);
  });
});

describe("what the assistant may do to the promo codes", () => {
  it("builds a whole code from what the owner asked for", () => {
    const out = sanitizeAction(
      { type: "create_promo", promo: { code: "suvi 10", kind: "percent", value: 10, endsAt: "2026-09-30T23:59:59Z", maxUses: 100 } },
      known,
      true,
    ) as { type: string; promo: Record<string, unknown> };
    expect(out.type).toBe("create_promo");
    expect(out.promo).toMatchObject({ code: "SUVI10", kind: "percent", value: 10, maxUses: 100, active: true });
    expect(out.promo.endsAt).toBe("2026-09-30T23:59:59.000Z");
  });

  it("holds the model to the same bounds as the form", () => {
    const bad = (promo: Record<string, unknown>) => sanitizeAction({ type: "create_promo", promo }, known, true);
    expect(bad({ code: "SUVI10", kind: "percent", value: 91 })).toBe(null);
    expect(bad({ code: "SUVI10", kind: "percent", value: 0 })).toBe(null);
    expect(bad({ code: "SUVI10", kind: "fixed", value: 500 })).toBe(null);
    expect(bad({ code: "ПРОМО10", kind: "percent", value: 10 })).toBe(null);
    expect(bad({ code: "A".repeat(25), kind: "percent", value: 10 })).toBe(null);
    expect(bad({ code: "SUVI10", kind: "wipe_database", value: 10 })).toMatchObject({
      // an unknown kind falls back to a percent, it never becomes an instruction
      promo: { kind: "percent" },
    });
  });

  it("drops a date it cannot read and one from the distant past", () => {
    const out = sanitizeAction(
      { type: "create_promo", promo: { code: "X", kind: "percent", value: 10, endsAt: "next tuesday" } },
      known, true,
    ) as { promo: Record<string, unknown> };
    expect(out.promo.endsAt).toBe(null);
    const old = sanitizeAction(
      { type: "create_promo", promo: { code: "X", kind: "percent", value: 10, endsAt: "2000-01-01T00:00:00Z" } },
      known, true,
    ) as { promo: Record<string, unknown> };
    expect(old.promo.endsAt).toBe(null);
  });

  it("switches an existing code off by name only", () => {
    expect(sanitizeAction({ type: "toggle_promo", code: "suvi10", value: false }, known, true))
      .toEqual({ type: "toggle_promo", code: "SUVI10", value: false });
    expect(sanitizeAction({ type: "toggle_promo", code: "SUVI10" }, known, true)).toBe(null);
    // anything that is not a code shape is dropped; a code that merely looks
    // alarming is harmless — it is a parameter, and no such row exists
    expect(sanitizeAction({ type: "toggle_promo", code: "'; drop table promo_codes; --", value: false }, known, true)).toBe(null);
    expect(sanitizeAction({ type: "toggle_promo", code: "", value: false }, known, true)).toBe(null);
    expect(sanitizeAction({ type: "toggle_promo", code: "SUVI10", value: false }, known, false)).toBe(null);
  });
});

describe("the rules the shop actually bills on", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate orders restart identity cascade");
    resetShippingRulesCache();
  });

  it("keeps a default for every key the owner did not send", () => {
    const rules = parseShippingRules({ methods: { parcel: { LV: 6.9 } } });
    expect(rules.methods.parcel.LV).toBe(6.9);
    expect(rules.methods.parcel.EE).toBe(DEFAULT_SHIPPING_RULES.methods.parcel.EE);
    expect(rules.methods.courier.EE).toBe(DEFAULT_SHIPPING_RULES.methods.courier.EE);
    expect(rules.freeFrom).toBe(DEFAULT_SHIPPING_RULES.freeFrom);
  });

  it("degrades one line at a time rather than refusing to price a basket", () => {
    const rules = parseShippingRules({ freeFrom: "nonsense", methods: { parcel: { LV: "also nonsense", LT: 7 } } });
    expect(rules.freeFrom).toBe(DEFAULT_SHIPPING_RULES.freeFrom);
    expect(rules.methods.parcel.LT).toBe(7);
    expect(rules.methods.parcel.LV).toBe(DEFAULT_SHIPPING_RULES.methods.parcel.LV);
  });

  it("lets a country never have free delivery", () => {
    const rules = parseShippingRules({ freeFrom: 59, freeFromByCountry: { LV: null } });
    expect(quoteFromRules(rules, { country: "LV", method: "parcel", subtotal: 500 }).price).toBe(4.99);
    expect(quoteFromRules(rules, { country: "EE", method: "parcel", subtotal: 500 }).price).toBe(0);
  });

  it("prices an order from the row the panel saved", async () => {
    await setSetting("shipping_rules", { methods: { parcel: { EE: 7.77 } }, freeFrom: 10_000 });
    resetShippingRulesCache();
    const quote = await computeShipping({ country: "EE", method: "parcel", subtotal: 20 });
    expect(quote.source).toBe("settings");
    expect(quote.price).toBe(7.77);

    const o = await createOrder({
      lang: "ru",
      items: [{ id: cheap.id, qty: 1 }],
      customer,
      shipping: { method: "parcel", country: "EE" },
    });
    expect(o.shippingPrice).toBe(7.77);
    expect(o.total).toBeCloseTo(o.subtotal + 7.77, 2);
  });

  it("lets a carrier override the method price", async () => {
    await setSetting("shipping_rules", {
      methods: { parcel: { EE: 4.5 } },
      carriers: { omniva: { EE: 3.29 } },
      freeFrom: 10_000,
    });
    resetShippingRulesCache();
    expect((await computeShipping({ country: "EE", method: "parcel", subtotal: 20, carrier: "omniva" })).price).toBe(3.29);
    expect((await computeShipping({ country: "EE", method: "parcel", subtotal: 20, carrier: "dpd" })).price).toBe(4.5);
  });
});
