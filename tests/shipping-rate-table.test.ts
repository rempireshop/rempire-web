import { describe, expect, it } from "vitest";
import {
  belowCostCells,
  DEFAULT_SHIPPING_RULES,
  parseShippingRules,
  quoteFromRules,
  type ShippingRules,
} from "@/lib/shipping";

/**
 * **The rate screen lost two tables. No customer lost or gained a cent.**
 *
 * Ренат, 14.09.2026: «it seems to me that this delivery is a bit over
 * engineered.» It was — three tables for two decisions — and the cure for that
 * is deleting things, which is exactly the kind of change that quietly moves a
 * price when nobody checks. So this is the check, and it is a *frozen* one:
 * every number below was read out of the code as it stood BEFORE the «Пакомат»
 * column, the «Наценка» boxes and «Заполнить по тарифам Montonio» were taken
 * out, and is pasted here as a literal. Recomputing the expectation from the
 * same code that computes the answer would prove nothing at all.
 *
 * 216 prices: every country the checkout can name (the four with carrier
 * chips, the twenty-one other European ones, the bare «EU» an unfinished
 * checkout sends, and a country nothing is sold to) × every method × every
 * carrier the storefront can tag — Venipak included, which is the one carrier
 * Montonio quotes no tariff for and therefore the only one that still reaches
 * `methods.parcel`, the column that left the screen.
 */
const FROZEN: Record<string, number> = {
  "EE|parcel|": 5.47, "EE|parcel|omniva": 3.19, "EE|parcel|smartpost": 2.59,
  "EE|parcel|dpd": 2.59, "EE|parcel|venipak": 5.47, "EE|parcel|unisend": 2.49,
  "EE|courier|": 10.84, "EE|pickup|": 0.00, "LV|parcel|": 5.59,
  "LV|parcel|omniva": 4.99, "LV|parcel|smartpost": 4.99, "LV|parcel|dpd": 5.59,
  "LV|parcel|venipak": 5.59, "LV|parcel|unisend": 3.79, "LV|courier|": 9.90,
  "LV|pickup|": 0.00, "LT|parcel|": 5.59, "LT|parcel|omniva": 4.99,
  "LT|parcel|smartpost": 4.99, "LT|parcel|dpd": 5.59, "LT|parcel|venipak": 5.59,
  "LT|parcel|unisend": 3.79, "LT|courier|": 9.90, "LT|pickup|": 0.00,
  "FI|parcel|": 12.39, "FI|parcel|omniva": 12.39, "FI|parcel|smartpost": 9.39,
  "FI|parcel|dpd": 12.39, "FI|parcel|venipak": 12.39, "FI|parcel|unisend": 12.39,
  "FI|courier|": 15.69, "FI|pickup|": 0.00, "AT|parcel|": 37.29,
  "AT|parcel|omniva": 37.29, "AT|parcel|smartpost": 37.29, "AT|parcel|dpd": 37.29,
  "AT|parcel|venipak": 37.29, "AT|parcel|unisend": 37.29, "AT|courier|": 28.49,
  "AT|pickup|": 0.00, "BE|parcel|": 29.79, "BE|parcel|omniva": 29.79,
  "BE|parcel|smartpost": 29.79, "BE|parcel|dpd": 29.79, "BE|parcel|venipak": 29.79,
  "BE|parcel|unisend": 29.79, "BE|courier|": 24.39, "BE|pickup|": 0.00,
  "BG|parcel|": 52.09, "BG|parcel|omniva": 52.09, "BG|parcel|smartpost": 52.09,
  "BG|parcel|dpd": 52.09, "BG|parcel|venipak": 52.09, "BG|parcel|unisend": 52.09,
  "BG|courier|": 32.59, "BG|pickup|": 0.00, "CZ|parcel|": 28.29,
  "CZ|parcel|omniva": 28.29, "CZ|parcel|smartpost": 28.29, "CZ|parcel|dpd": 28.29,
  "CZ|parcel|venipak": 28.29, "CZ|parcel|unisend": 28.29, "CZ|courier|": 23.99,
  "CZ|pickup|": 0.00, "DE|parcel|": 29.79, "DE|parcel|omniva": 29.79,
  "DE|parcel|smartpost": 29.79, "DE|parcel|dpd": 29.79, "DE|parcel|venipak": 29.79,
  "DE|parcel|unisend": 29.79, "DE|courier|": 22.29, "DE|pickup|": 0.00,
  "DK|parcel|": 23.89, "DK|parcel|omniva": 23.89, "DK|parcel|smartpost": 23.89,
  "DK|parcel|dpd": 23.89, "DK|parcel|venipak": 23.89, "DK|parcel|unisend": 23.89,
  "DK|courier|": 24.19, "DK|pickup|": 0.00, "ES|parcel|": 38.69,
  "ES|parcel|omniva": 38.69, "ES|parcel|smartpost": 38.69, "ES|parcel|dpd": 38.69,
  "ES|parcel|venipak": 38.69, "ES|parcel|unisend": 38.69, "ES|courier|": 34.29,
  "ES|pickup|": 0.00, "FR|parcel|": 44.69, "FR|parcel|omniva": 44.69,
  "FR|parcel|smartpost": 44.69, "FR|parcel|dpd": 44.69, "FR|parcel|venipak": 44.69,
  "FR|parcel|unisend": 44.69, "FR|courier|": 24.19, "FR|pickup|": 0.00,
  "GR|parcel|": 4.99, "GR|parcel|omniva": 4.99, "GR|parcel|smartpost": 4.99,
  "GR|parcel|dpd": 4.99, "GR|parcel|venipak": 4.99, "GR|parcel|unisend": 4.99,
  "GR|courier|": 43.19, "GR|pickup|": 0.00, "HR|parcel|": 59.59,
  "HR|parcel|omniva": 59.59, "HR|parcel|smartpost": 59.59, "HR|parcel|dpd": 59.59,
  "HR|parcel|venipak": 59.59, "HR|parcel|unisend": 59.59, "HR|courier|": 28.29,
  "HR|pickup|": 0.00, "HU|parcel|": 4.99, "HU|parcel|omniva": 4.99,
  "HU|parcel|smartpost": 4.99, "HU|parcel|dpd": 4.99, "HU|parcel|venipak": 4.99,
  "HU|parcel|unisend": 4.99, "HU|courier|": 27.39, "HU|pickup|": 0.00,
  "IE|parcel|": 52.09, "IE|parcel|omniva": 52.09, "IE|parcel|smartpost": 52.09,
  "IE|parcel|dpd": 52.09, "IE|parcel|venipak": 52.09, "IE|parcel|unisend": 52.09,
  "IE|courier|": 38.69, "IE|pickup|": 0.00, "IT|parcel|": 34.29,
  "IT|parcel|omniva": 34.29, "IT|parcel|smartpost": 34.29, "IT|parcel|dpd": 34.29,
  "IT|parcel|venipak": 34.29, "IT|parcel|unisend": 34.29, "IT|courier|": 30.09,
  "IT|pickup|": 0.00, "LU|parcel|": 35.79, "LU|parcel|omniva": 35.79,
  "LU|parcel|smartpost": 35.79, "LU|parcel|dpd": 35.79, "LU|parcel|venipak": 35.79,
  "LU|parcel|unisend": 35.79, "LU|courier|": 26.09, "LU|pickup|": 0.00,
  "NL|parcel|": 29.79, "NL|parcel|omniva": 29.79, "NL|parcel|smartpost": 29.79,
  "NL|parcel|dpd": 29.79, "NL|parcel|venipak": 29.79, "NL|parcel|unisend": 29.79,
  "NL|courier|": 25.59, "NL|pickup|": 0.00, "PL|parcel|": 17.89,
  "PL|parcel|omniva": 17.89, "PL|parcel|smartpost": 17.89, "PL|parcel|dpd": 17.89,
  "PL|parcel|venipak": 17.89, "PL|parcel|unisend": 17.89, "PL|courier|": 20.69,
  "PL|pickup|": 0.00, "PT|parcel|": 41.69, "PT|parcel|omniva": 41.69,
  "PT|parcel|smartpost": 41.69, "PT|parcel|dpd": 41.69, "PT|parcel|venipak": 41.69,
  "PT|parcel|unisend": 41.69, "PT|courier|": 38.39, "PT|pickup|": 0.00,
  "RO|parcel|": 4.99, "RO|parcel|omniva": 4.99, "RO|parcel|smartpost": 4.99,
  "RO|parcel|dpd": 4.99, "RO|parcel|venipak": 4.99, "RO|parcel|unisend": 4.99,
  "RO|courier|": 36.69, "RO|pickup|": 0.00, "SE|parcel|": 13.69,
  "SE|parcel|omniva": 13.69, "SE|parcel|smartpost": 13.69, "SE|parcel|dpd": 13.69,
  "SE|parcel|venipak": 13.69, "SE|parcel|unisend": 13.69, "SE|courier|": 21.59,
  "SE|pickup|": 0.00, "SI|parcel|": 40.19, "SI|parcel|omniva": 40.19,
  "SI|parcel|smartpost": 40.19, "SI|parcel|dpd": 40.19, "SI|parcel|venipak": 40.19,
  "SI|parcel|unisend": 40.19, "SI|courier|": 32.59, "SI|pickup|": 0.00,
  "SK|parcel|": 26.79, "SK|parcel|omniva": 26.79, "SK|parcel|smartpost": 26.79,
  "SK|parcel|dpd": 26.79, "SK|parcel|venipak": 26.79, "SK|parcel|unisend": 26.79,
  "SK|courier|": 27.69, "SK|pickup|": 0.00, "EU|parcel|": 4.99,
  "EU|parcel|omniva": 4.99, "EU|parcel|smartpost": 4.99, "EU|parcel|dpd": 4.99,
  "EU|parcel|venipak": 4.99, "EU|parcel|unisend": 4.99, "EU|courier|": 9.90,
  "EU|pickup|": 0.00, "US|parcel|": 4.99, "US|parcel|omniva": 4.99,
  "US|parcel|smartpost": 4.99, "US|parcel|dpd": 4.99, "US|parcel|venipak": 4.99,
  "US|parcel|unisend": 4.99, "US|courier|": 9.90, "US|pickup|": 0.00,
};

const COUNTRIES = ["EE", "LV", "LT", "FI", "AT", "BE", "BG", "CZ", "DE", "DK", "ES", "FR", "GR",
  "HR", "HU", "IE", "IT", "LU", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "EU", "US"];
const CARRIERS = ["", "omniva", "smartpost", "dpd", "venipak", "unisend"];

/** Every price the checkout can ask for, keyed the way FROZEN is. */
function priceEveryDelivery(rules: ShippingRules): Record<string, number> {
  const out: Record<string, number> = {};
  for (const country of COUNTRIES) {
    for (const method of ["parcel", "courier", "pickup"] as const) {
      for (const carrier of CARRIERS) {
        if (method !== "parcel" && carrier) continue;
        out[country + "|" + method + "|" + carrier] = quoteFromRules(
          rules,
          { country, method, carrier: carrier || undefined, subtotal: 10 },
        ).price;
      }
    }
  }
  return out;
}

/**
 * The row the live shop actually has: what db/migrations 030 → 031 → 148 → 149
 * leave in `settings.shipping_rules`. Note what is NOT in it — no `carriers`
 * key at all, because nothing but those migrations ever wrote the row and none
 * of them writes one. That is precisely why the markup could never reach a
 * bill: parseShippingRules() merges carrierPriceTable() in underneath, so
 * every carrier cell the checkout can read is filled, and the empty-cell
 * fallback the markup rode on is unreachable.
 */
const STORED_ROW = {
  freeFrom: 59,
  freeFromByCountry: { EU: 200 },
  methods: {
    parcel: {
      default: 4.99, AT: 37.29, BE: 29.79, BG: 52.09, CZ: 28.29, DE: 29.79, DK: 23.89,
      EE: 5.47, ES: 38.69, FI: 12.39, FR: 44.69, HR: 59.59, IE: 52.09, IT: 34.29,
      LT: 5.59, LU: 35.79, LV: 5.59, NL: 29.79, PL: 17.89, PT: 41.69, SE: 13.69,
      SI: 40.19, SK: 26.79,
    },
    courier: {
      default: 9.9, AT: 28.49, BE: 24.39, BG: 32.59, CZ: 23.99, DE: 22.29, DK: 24.19,
      EE: 10.84, ES: 34.29, FI: 15.69, FR: 24.19, GR: 43.19, HR: 28.29, HU: 27.39,
      IE: 38.69, IT: 30.09, LT: 9.9, LU: 26.09, LV: 9.9, NL: 25.59, PL: 20.69,
      PT: 38.39, RO: 36.69, SE: 21.59, SI: 32.59, SK: 27.69,
    },
    pickup: { default: 0 },
  },
};

/** The carrier table after a parse, typed so a test can clear one cell of it. */
function carriersOf(rules: ShippingRules): Record<string, Record<string, number>> {
  return rules.carriers as Record<string, Record<string, number>>;
}

describe("the rate table lost two columns and no price moved", () => {
  it("the defaults bill exactly what they billed before the screen changed", () => {
    expect(priceEveryDelivery(DEFAULT_SHIPPING_RULES)).toEqual(FROZEN);
  });

  it("the shop's own stored row bills exactly what it billed before", () => {
    expect(priceEveryDelivery(parseShippingRules(STORED_ROW))).toEqual(FROZEN);
  });

  /* The one key that was actually deleted from the shape. Every row the panel
     wrote before 14.09.2026 carries it — the save sent the whole table — so
     «the boxes are gone» has to mean «and the bill did not move» for a row
     that still has a markup in it, not only for one that never did. */
  it("a stored markup — even a big one — changes nothing now that the key is dropped", () => {
    const withMarkup = { ...STORED_ROW, markup: { percent: 30, fixed: 5 } };
    expect(priceEveryDelivery(parseShippingRules(withMarkup))).toEqual(FROZEN);
    expect((parseShippingRules(withMarkup) as unknown as Record<string, unknown>).markup).toBeUndefined();
  });

  /* …and the shop must still be able to SAVE what it is already charging. The
     guard tightened on 14.09.2026 — it compares against the price an empty box
     charges rather than the rawer tariff under it — so the row in production
     has to pass it, or the owner's first save of an unrelated cell would be
     refused over a number he never typed. */
  it("the guard accepts the defaults and the shop's own stored row", () => {
    expect(belowCostCells(DEFAULT_SHIPPING_RULES)).toEqual([]);
    expect(belowCostCells(parseShippingRules(STORED_ROW))).toEqual([]);
  });
});

describe("an empty box means Montonio's price — in every column now", () => {
  /* The rule quoteFromRules() has had for carrier cells since 13.09.2026, now
     true of the courier column too. Nothing on this shop has an empty box, so
     none of this moves a price today; it is what the owner gets when he clears
     one, and it is the number the screen prints under every box. */
  it("a cleared carrier cell charges that carrier's Montonio price", () => {
    const rules = parseShippingRules(STORED_ROW);
    delete carriersOf(rules).omniva.EE;
    expect(quoteFromRules(rules, { country: "EE", method: "parcel", carrier: "omniva", subtotal: 10 }).price)
      .toBe(3.19);
  });

  it("a cleared courier cell charges the country's Montonio price, not the zone's", () => {
    const rules = parseShippingRules(STORED_ROW);
    delete rules.methods.courier.LV;
    // …and NOT the 9.90 «Остальные страны» cell it used to fall through to
    expect(quoteFromRules(rules, { country: "LV", method: "courier", subtotal: 10 }).price).toBe(8.09);
  });

  it("a country Montonio quotes no courier for still falls through to the zone", () => {
    const rules = parseShippingRules(STORED_ROW);
    // Switzerland: Montonio has no route to it at all, so there is nothing to
    // fall back to but «Остальные страны» — exactly as before
    expect(quoteFromRules(rules, { country: "CH", method: "courier", subtotal: 10 }).price).toBe(9.9);
  });

  it("the guard refuses a price under what clearing the box would charge", () => {
    const rules = parseShippingRules(STORED_ROW);
    carriersOf(rules).omniva.EE = 3.15;
    const bad = belowCostCells(rules);
    expect(bad).toHaveLength(1);
    // 3.15 sits above the raw 3.10 tariff and under the 3.19 an empty box
    // charges — the case the old guard let through, so that its own advice
    // («очистите поле») offered a higher price than the one it had allowed
    expect(bad[0]).toMatchObject({ carrier: "omniva", country: "EE", charged: 3.15, cost: 3.19 });
  });
});
