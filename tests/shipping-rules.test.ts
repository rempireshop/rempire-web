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
  belowCostCells,
  belowCostMessage,
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
    for (const carrier of ["omniva", "smartpost", "dpd", "unisend", "novapost"]) {
      expect(sanitizeShippingRules({ carriers: { [carrier]: { EE: 4.5 } } }), carrier)
        .toEqual({ carriers: { [carrier]: { EE: 4.5 } } });
    }
    // …and the name as the model is likeliest to write it
    expect(sanitizeShippingRules({ carriers: { Unisend: { LV: 5.2 } } }))
      .toEqual({ carriers: { unisend: { LV: 5.2 } } });
    // Venipak is not one of them since 14.09.2026 («Venipak does not seem to
    // be available, so remove»), so asking for a Venipak price is asking for
    // nothing — and the card must not claim it applied one
    expect(sanitizeShippingRules({ carriers: { venipak: { EE: 4.5 } } })).toBe(null);
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
    /* …except the courier column, whose floor under a stored row is Montonio's
       own price and not the 10.84 the shop ships with (14.09.2026). The three
       home courier numbers are overrides like any other cell, so a row that
       does not send one means «цена Montonio» — which is what the panel's
       «Везде взять цены Montonio» leaves behind. A shop with no row at all is
       still priced by DEFAULT_SHIPPING_RULES and still pays 10.84. */
    expect(rules.methods.courier.EE).toBe(6.89);
    expect(DEFAULT_SHIPPING_RULES.methods.courier.EE).toBe(10.84);
    expect(rules.freeFrom).toBe(DEFAULT_SHIPPING_RULES.freeFrom);
  });

  it("degrades one line at a time rather than refusing to price a basket", () => {
    const rules = parseShippingRules({ freeFrom: "nonsense", methods: { parcel: { LV: "also nonsense", LT: 7 } } });
    expect(rules.freeFrom).toBe(DEFAULT_SHIPPING_RULES.freeFrom);
    expect(rules.methods.parcel.LT).toBe(7);
    expect(rules.methods.parcel.LV).toBe(DEFAULT_SHIPPING_RULES.methods.parcel.LV);
  });

  /* Ренат, 14.09.2026: «Venipak does not seem to be available, so remove».
     The live shop's settings row can still carry a `carriers.venipak` table —
     the fill button wrote whole tables, and a row written once outlives the
     code that wrote it. quoteFromRules() reads `rules.carriers?.[carrier]`
     *before* the method's own table, so a stale entry is not inert — it is a
     price nobody can reach that would win if an order ever carried that
     carrier. parseShippingRules() is the one door every reader comes through,
     so it is where the row is dropped. */
  it("ignores a carrier the shop cannot ship with, Venipak included", () => {
    const rules = parseShippingRules({
      carriers: { venipak: { EE: 0.01, default: 0.01 }, omniva: { EE: 3.29 } },
    });
    expect(rules.carriers?.venipak).toBeUndefined();
    // the typed Estonian cell wins; the rest of Omniva stays on the mirror
    expect(rules.carriers?.omniva?.EE).toBe(3.29);
    expect(rules.carriers?.omniva?.LV).toBe(DEFAULT_SHIPPING_RULES.carriers?.omniva?.LV);
    // …and a parcel tagged with Venipak is billed the method's price, not 0.01 €
    expect(quoteFromRules(rules, { country: "EE", method: "parcel", carrier: "venipak", subtotal: 10 }).price)
      .toBe(DEFAULT_SHIPPING_RULES.methods.parcel.EE);
  });

  it("drops a carriers map that holds nothing the shop can use", () => {
    expect(parseShippingRules({ carriers: { venipak: { EE: 0.01 } } }).carriers)
      .toEqual(DEFAULT_SHIPPING_RULES.carriers);
  });

  /* …and the carrier that came the other way on the same day. Nova Post is in
     SHOP_CARRIERS now, so a stored cell for it is the owner's number and is
     kept — the read is a whitelist, not a blanket refusal, and the two halves
     have to be asserted separately or one list could quietly swallow both. */
  it("keeps a stored Nova Post cell, which the shop does ship with again", () => {
    const rules = parseShippingRules({ carriers: { novapost: { EE: 2.9 } } });
    expect(rules.carriers?.novapost?.EE).toBe(2.9);
    // the cells he did not type stay on Montonio's own prices
    expect(rules.carriers?.novapost?.LV).toBe(DEFAULT_SHIPPING_RULES.carriers?.novapost?.LV);
    expect(quoteFromRules(rules, { country: "EE", method: "parcel", carrier: "novapost", subtotal: 10 }).price)
      .toBe(2.9);
  });

  /* Ренат, 13.09.2026: «we get prices from Montonio and we should use those,
     we do not need to make them up.» An empty carrier cell used to fall
     through to the country's «Пакомат» number, so one price covered every
     chip while Montonio billed a different one per carrier. Now the empty
     cell IS Montonio's price for that carrier, and a typed one still wins. */
  it("prices an empty carrier cell from Montonio, not from the «Пакомат» column", () => {
    const rules = parseShippingRules({ methods: { parcel: { FI: 7.89 } }, freeFrom: 10_000 });
    const at = (carrier: string) =>
      quoteFromRules(rules, { country: "FI", method: "parcel", carrier, subtotal: 20 }).price;
    // DPD costs 12.39 in Finland, SmartPosti 9.30 — two carriers, two prices
    expect(at("dpd")).toBe(12.39);
    expect(at("smartpost")).toBe(9.39);
    expect(at("dpd")).toBeGreaterThan(7.89);
    // …and with no carrier at all the column is still what prices it
    expect(quoteFromRules(rules, { country: "FI", method: "parcel", subtotal: 20 }).price).toBe(7.89);
  });

  it("a typed carrier cell still wins over Montonio's own price", () => {
    const rules = parseShippingRules({ carriers: { dpd: { FI: 14.9 } }, freeFrom: 10_000 });
    expect(quoteFromRules(rules, { country: "FI", method: "parcel", carrier: "dpd", subtotal: 20 }).price)
      .toBe(14.9);
  });

  /* A carrier cell is a parcel-machine price and nothing writes a courier one,
     so the Montonio fallback must not price a courier off a parcel tariff
     either — the same hole the carrier lookup itself had. */
  it("never prices a courier from a parcel carrier's tariff", () => {
    const rules = parseShippingRules({ freeFrom: 10_000 });
    // DPD's Estonian LOCKER is 2.59; a courier is never priced off it
    expect(quoteFromRules(rules, { country: "EE", method: "courier", carrier: "dpd", subtotal: 20 }).price)
      .toBe(6.89);
  });

  /* Ренат, 13.09.2026. The panel already printed the cost under each box and
     reddened it when the price was under; nine of fourteen carrier-country
     pairs still went out below cost. What belowCostCells() answers is what the
     save now refuses. */
  describe("what may never be saved: a price below Montonio's own tariff", () => {
    it("catches a carrier cell under that carrier's price, and names both numbers", () => {
      const rules = parseShippingRules({ carriers: { dpd: { FI: 7.89 } } });
      const bad = belowCostCells(rules);
      expect(bad).toEqual([{ carrier: "dpd", country: "FI", method: "parcel", charged: 7.89, cost: 12.39 }]);
      const said = belowCostMessage(bad);
      expect(said).toContain("Пакомат DPD, Финляндия");
      expect(said).toContain("7,89 €");
      expect(said).toContain("12,39 €");
    });

    it("lets the price stand at the tariff exactly — cost covered is not a loss", () => {
      expect(belowCostCells(parseShippingRules({ carriers: { dpd: { FI: 12.39 } } }))).toEqual([]);
      expect(belowCostCells(parseShippingRules({ carriers: { dpd: { FI: 12.4 } } }))).toEqual([]);
    });

    it("catches the courier column too", () => {
      /* SmartPosti is the cheapest courier to Germany at 22.23 — Renat picks
         it — and 22.29 is what an empty box would charge for it. The floor is
         that, not the raw 22.23: since 14.09.2026 the guard refuses exactly
         what the screen says an empty box gives, so its own advice («очистите
         поле») can never lead to a higher price than the one it allowed. */
      const bad = belowCostCells(parseShippingRules({ methods: { courier: { DE: 9.9 } } }));
      expect(bad).toEqual([{ carrier: "", country: "DE", method: "courier", charged: 9.9, cost: 22.29 }]);
      expect(belowCostMessage(bad)).toContain("Курьер, Германия");
    });

    /* A courier's carrier is Renat's choice when he makes the label, so the
       floor is the cheapest he can pick, not the dearest. Finland's 16.29 €
       courier covers SmartPosti's 15.62 € even though DPD would cost 20.09 €:
       a thin margin, not a hole, and refusing the save over it would refuse a
       price that makes money. */
    it("prices a courier against the cheapest carrier, because nobody else picks it", () => {
      expect(belowCostCells(parseShippingRules({ methods: { courier: { FI: 16.29 } } }))).toEqual([]);
      expect(belowCostCells(parseShippingRules({ methods: { courier: { FI: 15.5 } } }))).toHaveLength(1);
    });

    /* Inside EE/LV/LT/FI the shopper always picks a chip, so the carrier cell
       is what bills and the «Пакомат» column is a fallback nobody reaches.
       Flagging it would refuse a save over a number that charges no one. */
    it("leaves the parcel column alone where the shopper picks the carrier", () => {
      expect(belowCostCells(parseShippingRules({ methods: { parcel: { FI: 7.89 } } }))).toEqual([]);
      // …but not outside those four, where the column IS the price
      expect(belowCostCells(parseShippingRules({ methods: { parcel: { PL: 9.9 } } }))).toHaveLength(1);
    });

    it("says nothing about a zone row, a default or the free-delivery floor", () => {
      expect(belowCostCells(parseShippingRules({ methods: { courier: { default: 1, EU: 1 } } }))).toEqual([]);
      expect(belowCostCells(parseShippingRules({ freeFrom: 0 }))).toEqual([]);
    });

    it("passes the shop's own defaults, which is the point of them", () => {
      expect(belowCostCells(DEFAULT_SHIPPING_RULES)).toEqual([]);
      expect(belowCostCells(parseShippingRules({}))).toEqual([]);
    });

    it("lists several at once and stops naming them after six", () => {
      const many = belowCostCells(parseShippingRules({
        carriers: { dpd: { EE: 0.5, LV: 0.5, LT: 0.5, FI: 0.5 }, omniva: { EE: 0.5, LV: 0.5, LT: 0.5 } },
      }));
      expect(many).toHaveLength(7);
      expect(belowCostMessage(many)).toContain("и ещё 1");
    });
  });

  it("lets a country never have free delivery", () => {
    const rules = parseShippingRules({ freeFrom: 59, freeFromByCountry: { LV: null } });
    expect(quoteFromRules(rules, { country: "LV", method: "parcel", subtotal: 500 }).price).toBe(5.59);
    expect(quoteFromRules(rules, { country: "EE", method: "parcel", subtotal: 500 }).price).toBe(0);
  });

  /* The owner's whole answer, not a merge: the row he saved replaces the map,
     so clearing «Бесплатно от» on the «Другие страны Европы» row really does
     put Europe back on the shop-wide 59 € rather than quietly restoring the
     200 € default. A row written before that default existed — every
     production row until db/migrations/149 runs — still gets it. */
  it("takes the owner's free-delivery map whole, empty included", () => {
    expect(parseShippingRules({ freeFrom: 59 }).freeFromByCountry).toEqual({ EU: 200 });
    expect(parseShippingRules({ freeFromByCountry: { EU: 150 } }).freeFromByCountry).toEqual({ EU: 150 });
    expect(parseShippingRules({ freeFromByCountry: {} }).freeFromByCountry).toEqual({});
    const cleared = parseShippingRules({ freeFrom: 59, freeFromByCountry: {} });
    expect(quoteFromRules(cleared, { country: "DE", method: "courier", subtotal: 59 }).price).toBe(0);
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
    /* DPD has no cell of its own here, and since 13.09.2026 that does NOT
       mean «charge 4,50 like everything else in Estonia» — it means «charge
       what DPD costs», 2.59. The whole point: one price per country was the
       wrong shape, because Montonio bills per carrier and the shopper picks. */
    expect((await computeShipping({ country: "EE", method: "parcel", subtotal: 20, carrier: "dpd" })).price).toBe(2.59);
    // …and with no carrier at all the method column still prices it
    expect((await computeShipping({ country: "EE", method: "parcel", subtotal: 20 })).price).toBe(4.5);
  });
});
