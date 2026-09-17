import { describe, expect, it } from "vitest";
import {
  belowCostCells,
  cleanShippingRules,
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
 *
 * **Two carriers changed hands on 14.09.2026 and not one of these numbers
 * moved.** Venipak was removed («Venipak does not seem to be available, so
 * remove») and Nova Post restored («From montonio page there is Nova Post, so
 * keep it actually»). Every Venipak literal below is **kept exactly as it
 * was**: a delivery still tagged with Venipak — an old order, a stale tab —
 * bills `methods.parcel` now as it did then, because Venipak never had a cell
 * of its own to lose. That is the proof the removal moved no price, and it is
 * worth more as a frozen literal than as a deleted line. NOVAPOST below is the
 * new carrier's own column, added rather than merged in, so the two questions
 * — «did anything move» and «what does the new one charge» — stay separable.
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

/**
 * The column Nova Post added on 14.09.2026, kept apart from FROZEN on purpose.
 *
 * FROZEN is the "nothing moved" assertion and it has to stay readable as one:
 * merging a new carrier's twenty-seven prices into it would make every future
 * reader wonder which literals are the freeze and which are the new thing.
 *
 * Three of these are the carrier's own Montonio rate — EE 2,39, LV 4,79,
 * LT 4,09, the only countries the checkout draws a Nova Post chip in. Finland
 * is 12,39 because Montonio runs no Nova Post locker there, so the chip is not
 * drawn and the tag falls through to `methods.parcel` — the same number every
 * other carrier without a Finnish cell gets. Every remaining country falls
 * through the same way, which is why each one equals its Venipak twin above.
 */
const NOVAPOST: Record<string, number> = {
  "EE|parcel|novapost": 2.39, "LV|parcel|novapost": 4.79, "LT|parcel|novapost": 4.09,
  "FI|parcel|novapost": 12.39, "AT|parcel|novapost": 37.29, "BE|parcel|novapost": 29.79,
  "BG|parcel|novapost": 52.09, "CZ|parcel|novapost": 28.29, "DE|parcel|novapost": 29.79,
  "DK|parcel|novapost": 23.89, "ES|parcel|novapost": 38.69, "FR|parcel|novapost": 44.69,
  "GR|parcel|novapost": 4.99, "HR|parcel|novapost": 59.59, "HU|parcel|novapost": 4.99,
  "IE|parcel|novapost": 52.09, "IT|parcel|novapost": 34.29, "LU|parcel|novapost": 35.79,
  "NL|parcel|novapost": 29.79, "PL|parcel|novapost": 17.89, "PT|parcel|novapost": 41.69,
  "RO|parcel|novapost": 4.99, "SE|parcel|novapost": 13.69, "SI|parcel|novapost": 40.19,
  "SK|parcel|novapost": 26.79, "EU|parcel|novapost": 4.99, "US|parcel|novapost": 4.99,
};

const ALL = { ...FROZEN, ...NOVAPOST };

const COUNTRIES = ["EE", "LV", "LT", "FI", "AT", "BE", "BG", "CZ", "DE", "DK", "ES", "FR", "GR",
  "HR", "HU", "IE", "IT", "LU", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "EU", "US"];
/* «venipak» stays in this list although the shop no longer offers it: the
   question the freeze answers is what a delivery ALREADY tagged with it bills,
   and the answer has to go on being the one above. */
const CARRIERS = ["", "omniva", "smartpost", "dpd", "venipak", "unisend", "novapost"];

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
    expect(priceEveryDelivery(DEFAULT_SHIPPING_RULES)).toEqual(ALL);
  });

  it("the shop's own stored row bills exactly what it billed before", () => {
    expect(priceEveryDelivery(parseShippingRules(STORED_ROW))).toEqual(ALL);
  });

  /* The one key that was actually deleted from the shape. Every row the panel
     wrote before 14.09.2026 carries it — the save sent the whole table — so
     «the boxes are gone» has to mean «and the bill did not move» for a row
     that still has a markup in it, not only for one that never did. */
  it("a stored markup — even a big one — changes nothing now that the key is dropped", () => {
    const withMarkup = { ...STORED_ROW, markup: { percent: 30, fixed: 5 } };
    expect(priceEveryDelivery(parseShippingRules(withMarkup))).toEqual(ALL);
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

  /* Removing a carrier is the move that quietly changes a price, because the
     stored row outlives the code: a `carriers.venipak` table written while the
     panel still had the carrier is still in `settings.shipping_rules` after
     the deploy that dropped it, and quoteFromRules() reads that map *before*
     the method's own. So this is the removal's own proof — the same 216
     numbers, out of a row that still carries Venipak, and a deliberately
     absurd 0,01 € in it so a leak would be unmissable rather than a rounding
     argument. */
  it("a stored Venipak table changes no price at all — not even Venipak's", () => {
    const stale = {
      ...STORED_ROW,
      carriers: { venipak: { EE: 0.01, LV: 0.01, LT: 0.01, FI: 0.01, default: 0.01 } },
    };
    expect(priceEveryDelivery(parseShippingRules(stale))).toEqual(ALL);
    expect(parseShippingRules(stale).carriers?.venipak).toBeUndefined();
    expect(belowCostCells(parseShippingRules(stale))).toEqual([]);
  });

  /* The other half of the same day: a carrier arriving must not move anything
     either. Nova Post prices its own three cells and touches nothing else —
     no country's «Курьер», no country's «Пакомат», no other carrier's chip. */
  it("Nova Post prices its own column and moves nothing else", () => {
    const priced = priceEveryDelivery(DEFAULT_SHIPPING_RULES);
    for (const [k, v] of Object.entries(FROZEN)) expect([k, priced[k]]).toEqual([k, v]);
    expect(priced["EE|parcel|novapost"]).toBe(2.39);   // cheapest chip in Estonia
    expect(priced["LV|parcel|novapost"]).toBe(4.79);   // Unisend's 3,79 is still cheaper
    expect(priced["LT|parcel|novapost"]).toBe(4.09);   // …and here too
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

/* ------------------------------------------------------------------------ *
 * What the row is allowed to HOLD — r22, Dim 17.09.2026
 * ------------------------------------------------------------------------ */

/**
 * **A cell nobody typed must not be in the row.**
 *
 * PUT /api/admin/settings used to run the incoming table through
 * parseShippingRules() and store the result, so the row came back out of the
 * database with every cell seeded from Montonio's own table and written down
 * as an explicit number. A number in the row is an override, and an override
 * does not move when Montonio's tariff moves — so «пустое поле — цена
 * Montonio», the one sentence the rate screen is built on, stopped being true
 * the moment anything was saved, and «Везде взять цены Montonio» froze that
 * day's price list instead of clearing the table.
 *
 * cleanShippingRules() is the same validation without the seeding. The proof
 * it costs nothing is the 216 prices above: they are computed here out of a
 * CLEANED row and have to come out identical.
 */
describe("cleanShippingRules: the row keeps the owner's cells and no others", () => {
  it("stores an empty table as empty — not as today's tariff", () => {
    const row = cleanShippingRules({ methods: { parcel: {}, courier: {}, pickup: {} }, carriers: {} });
    expect(row.methods).toEqual({ parcel: {}, courier: {}, pickup: {} });
    expect(row.carriers).toEqual({});
    // …and the two decisions that ARE the owner's keep their defaults
    expect(row.freeFrom).toBe(DEFAULT_SHIPPING_RULES.freeFrom);
    expect(row.countriesOff).toEqual(DEFAULT_SHIPPING_RULES.countriesOff);
  });

  it("keeps exactly the cells that were sent, cleaned", () => {
    const row = cleanShippingRules({
      methods: { courier: { de: "25,50", FR: -1, PL: "x" } },
      carriers: { DPD: { fi: 13 }, venipak: { EE: 1 } },
      markup: { percent: 30 },
    });
    expect(row.methods.courier).toEqual({ DE: 25.5 });
    // a carrier the shop cannot put a parcel on is dropped on the way in too
    expect(row.carriers).toEqual({ dpd: { FI: 13 } });
    expect((row as unknown as Record<string, unknown>).markup).toBeUndefined();
  });

  /* An EMPTY saved row is not the same thing as NO row, and never has been:
     parseShippingRules() seeds the courier column from Montonio's own table
     rather than from DEFAULT_SHIPPING_RULES, exactly so that «пустое поле —
     цена Montonio» holds after a save as well as before it. Three cells differ by
     that rule — EE 10,84 → 6,89 and LV/LT 9,90 → 8,09 — and they are the three
     the shop ships with rather than Montonio's. Every other one of the 216 is
     identical, which is what makes this a statement about those three and not
     about the cleaning. */
  it("an empty row prices every delivery as an empty box has always priced it", () => {
    const priced = priceEveryDelivery(parseShippingRules(cleanShippingRules({})));
    const moved = Object.keys(ALL).filter((k) => priced[k] !== ALL[k]);
    expect(moved.sort()).toEqual(["EE|courier|", "LT|courier|", "LV|courier|"]);
    expect([priced["EE|courier|"], priced["LV|courier|"], priced["LT|courier|"]]).toEqual([6.89, 8.09, 8.09]);
  });

  it("the live shop's row prices every delivery the same after a clean", () => {
    const cleaned = cleanShippingRules(STORED_ROW);
    expect(priceEveryDelivery(parseShippingRules(cleaned))).toEqual(ALL);
  });

  /* And the point of all of it: a cell that is not in the row follows the
     tariff. Montonio raising Germany's courier is a one-line change to
     src/lib/shipping/country-prices.ts — here it is simulated by comparing an
     absent cell against the table the read path seeds from. */
  it("an absent cell is priced from Montonio's table, not from the row", () => {
    const cleaned = parseShippingRules(cleanShippingRules({ methods: { courier: { EE: 12 } } }));
    // his own cell stands
    expect(quoteFromRules(cleaned, { country: "EE", method: "courier", subtotal: 10 }).price).toBe(12);
    // the one he never touched is whatever the price table says today
    expect(quoteFromRules(cleaned, { country: "DE", method: "courier", subtotal: 10 }).price)
      .toBe(DEFAULT_SHIPPING_RULES.methods.courier.DE);
  });

  it("an empty «Бесплатно от» is still an answer and still survives", () => {
    expect(cleanShippingRules({ freeFrom: null }).freeFrom).toBeNull();
    expect(cleanShippingRules({ freeFromByCountry: { EU: null } }).freeFromByCountry).toEqual({ EU: null });
    // …and `{}` means «одна цена везде», not «put the default back»
    expect(cleanShippingRules({ freeFromByCountry: {} }).freeFromByCountry).toEqual({});
    expect(cleanShippingRules({ countriesOff: [] }).countriesOff).toEqual([]);
  });
});

/* The eighteen «Пакомат» cells no box can edit. belowCostCells() stopped
   policing them on 17.09.2026 on the stated grounds that a saved row no longer
   carries them — which was not true of the code until the review that produced
   these tests. If they are ever stored again, the guard has to come back. */
describe("the parcel column is not stored", () => {
  it("drops the country cells an ordinary save sends back, keeping default", () => {
    const live = {
      methods: {
        parcel: { default: 4.99, DE: 29.79, PL: 17.89, AT: 28.49, SK: 27.69 },
        courier: { default: 9.9, EE: 6.89, LV: 8.09, LT: 8.09 },
      },
    };
    const clean = cleanShippingRules(live);
    expect(clean.methods.parcel).toEqual({ default: 4.99 });
    /* The courier column is seeded WITHOUT its three home prices, so the same
       treatment there would move real money. It must survive untouched. */
    expect(clean.methods.courier).toEqual({ default: 9.9, EE: 6.89, LV: 8.09, LT: 8.09 });
  });

  it("prices every delivery exactly the same after the drop", () => {
    const withCells = parseShippingRules({
      methods: { parcel: { default: 4.99, DE: 29.79, PL: 17.89, GR: 4.99, HU: 4.99 } },
    });
    const dropped = parseShippingRules(cleanShippingRules({
      methods: { parcel: { default: 4.99, DE: 29.79, PL: 17.89, GR: 4.99, HU: 4.99 } },
    }));
    for (const c of ["DE", "PL", "AT", "SK", "GR", "HU", "RO", "ES", "IT"]) {
      expect(quoteFromRules(dropped, c, "parcel", null, 10))
        .toStrictEqual(quoteFromRules(withCells, c, "parcel", null, 10));
    }
  });

  it("leaves nothing below cost for the removed guard to have caught", () => {
    const clean = parseShippingRules(cleanShippingRules({ methods: { parcel: { DE: 0.01 } } }));
    expect(belowCostCells(clean).filter((c) => c.method === "parcel" && c.country === "DE")).toEqual([]);
    expect(quoteFromRules(clean, "DE", "parcel", null, 10).price).not.toBe(0.01);
  });
});
