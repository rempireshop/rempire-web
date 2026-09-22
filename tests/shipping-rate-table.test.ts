/*
 * 22.09.2026, later the same day — HU, RO AND NOVAPOST MOVED AGAIN, ON PURPOSE.
 *
 * The owner's decision: the delivery step offers carriers the way Montonio's
 * own shipping calculator does (offeredCarriers() in
 * src/lib/shipping/country-prices.ts; tests/shipping-carrier-choice.test.ts is
 * the specification). Three things follow for this table, and nothing else:
 *
 *   · Nova Post is never offered in EE, LV or LT. A delivery still tagged
 *     with it there bills as if it named no carrier — the country's own
 *     «Пакомат» price: EE 2.39 → 5.47, LV 4.79 → 5.59, LT 4.09 → 5.59;
 *   · Nova Post is offered everywhere else Montonio carries it, at its own
 *     Montonio price, like any other card: AT 9.59, CZ 6.99, DE 8.89,
 *     ES 11.39, IT 10.99, PL 5.49, SK 7.29 (each was the country's cell);
 *   · Hungary and Romania have lockers now, Nova Post's only, and have no
 *     «Пакомат» cell of their own — so every HU and RO parcel price, whatever
 *     carrier tag it carries, is Nova Post's: HU 4.99 → 7.09, RO 4.99 → 10.99.
 *
 * Nothing moved in EE, LV, LT or FI but Nova Post; no courier moved at all.
 *
 * 22.09.2026 — THE PRICES IN FROZEN AND NOVAPOST MOVED, ON PURPOSE.
 *
 * Renat measured his carton: 25 × 18 × 8 cm, declared at 0.9 kg. The tariff
 * table (src/data/montonio-tariffs.json) had been quoted for a 30 × 30 × 30 cm
 * cube at 5 kg, which fits only DPD's biggest (L) drawer, and it was re-quoted
 * for the real box. Outside the Baltics Montonio prices a parcel machine by
 * size — the carton goes through DPD's XS door — and a courier by weight, so:
 *
 *   · «Пакомат» moved in 17 countries: AT BE BG CZ DE DK ES FR HR IE IT LU NL
 *     PL PT SI SK (Poland 17.89 → 7.49, Croatia 59.59 → 29.79), and with it
 *     every carrier tag there that falls through to that cell — Venipak and
 *     Nova Post outside the Baltics included;
 *   · «Курьер» moved in 20: the same 17 plus GR, HU and RO (Germany 22.29 →
 *     17.59; Greece 43.19 → 28.89, priced off SmartPosti now, which became the
 *     cheaper of the two);
 *   · nothing moved in EE, LV, LT, FI or SE, where Montonio's price does not
 *     depend on size — Nova Post's own EE/LV/LT chips included — nor in the
 *     fallback cells (the GR, HU and RO parcel machine, EU, US) or pickup.
 *
 * Every literal below was re-read from the code after the re-quote and pasted
 * in. It is the baseline again: a refactor must not move one of them, exactly
 * as the 14.09.2026 note below says, and a deliberate re-quote that does gets
 * a dated note like this one. STORED_ROW changed the same day — see there.
 */
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
  "FI|courier|": 15.69, "FI|pickup|": 0.00, "AT|parcel|": 20.89,
  "AT|parcel|omniva": 20.89, "AT|parcel|smartpost": 20.89, "AT|parcel|dpd": 20.89,
  "AT|parcel|venipak": 20.89, "AT|parcel|unisend": 20.89, "AT|courier|": 23.79,
  "AT|pickup|": 0.00, "BE|parcel|": 17.89, "BE|parcel|omniva": 17.89,
  "BE|parcel|smartpost": 17.89, "BE|parcel|dpd": 17.89, "BE|parcel|venipak": 17.89,
  "BE|parcel|unisend": 17.89, "BE|courier|": 19.69, "BE|pickup|": 0.00,
  "BG|parcel|": 37.29, "BG|parcel|omniva": 37.29, "BG|parcel|smartpost": 37.29,
  "BG|parcel|dpd": 37.29, "BG|parcel|venipak": 37.29, "BG|parcel|unisend": 37.29,
  "BG|courier|": 27.89, "BG|pickup|": 0.00, "CZ|parcel|": 16.39,
  "CZ|parcel|omniva": 16.39, "CZ|parcel|smartpost": 16.39, "CZ|parcel|dpd": 16.39,
  "CZ|parcel|venipak": 16.39, "CZ|parcel|unisend": 16.39, "CZ|courier|": 19.29,
  "CZ|pickup|": 0.00, "DE|parcel|": 16.39, "DE|parcel|omniva": 16.39,
  "DE|parcel|smartpost": 16.39, "DE|parcel|dpd": 16.39, "DE|parcel|venipak": 16.39,
  "DE|parcel|unisend": 16.39, "DE|courier|": 17.59, "DE|pickup|": 0.00,
  "DK|parcel|": 14.89, "DK|parcel|omniva": 14.89, "DK|parcel|smartpost": 14.89,
  "DK|parcel|dpd": 14.89, "DK|parcel|venipak": 14.89, "DK|parcel|unisend": 14.89,
  "DK|courier|": 19.59, "DK|pickup|": 0.00, "ES|parcel|": 23.89,
  "ES|parcel|omniva": 23.89, "ES|parcel|smartpost": 23.89, "ES|parcel|dpd": 23.89,
  "ES|parcel|venipak": 23.89, "ES|parcel|unisend": 23.89, "ES|courier|": 29.69,
  "ES|pickup|": 0.00, "FR|parcel|": 28.29, "FR|parcel|omniva": 28.29,
  "FR|parcel|smartpost": 28.29, "FR|parcel|dpd": 28.29, "FR|parcel|venipak": 28.29,
  "FR|parcel|unisend": 28.29, "FR|courier|": 19.59, "FR|pickup|": 0.00,
  "GR|parcel|": 4.99, "GR|parcel|omniva": 4.99, "GR|parcel|smartpost": 4.99,
  "GR|parcel|dpd": 4.99, "GR|parcel|venipak": 4.99, "GR|parcel|unisend": 4.99,
  "GR|courier|": 28.89, "GR|pickup|": 0.00, "HR|parcel|": 29.79,
  "HR|parcel|omniva": 29.79, "HR|parcel|smartpost": 29.79, "HR|parcel|dpd": 29.79,
  "HR|parcel|venipak": 29.79, "HR|parcel|unisend": 29.79, "HR|courier|": 23.59,
  "HR|pickup|": 0.00, "HU|parcel|": 7.09, "HU|parcel|omniva": 7.09,
  "HU|parcel|smartpost": 7.09, "HU|parcel|dpd": 7.09, "HU|parcel|venipak": 7.09,
  "HU|parcel|unisend": 7.09, "HU|courier|": 22.69, "HU|pickup|": 0.00,
  "IE|parcel|": 22.39, "IE|parcel|omniva": 22.39, "IE|parcel|smartpost": 22.39,
  "IE|parcel|dpd": 22.39, "IE|parcel|venipak": 22.39, "IE|parcel|unisend": 22.39,
  "IE|courier|": 31.29, "IE|pickup|": 0.00, "IT|parcel|": 20.89,
  "IT|parcel|omniva": 20.89, "IT|parcel|smartpost": 20.89, "IT|parcel|dpd": 20.89,
  "IT|parcel|venipak": 20.89, "IT|parcel|unisend": 20.89, "IT|courier|": 25.49,
  "IT|pickup|": 0.00, "LU|parcel|": 20.89, "LU|parcel|omniva": 20.89,
  "LU|parcel|smartpost": 20.89, "LU|parcel|dpd": 20.89, "LU|parcel|venipak": 20.89,
  "LU|parcel|unisend": 20.89, "LU|courier|": 21.39, "LU|pickup|": 0.00,
  "NL|parcel|": 14.89, "NL|parcel|omniva": 14.89, "NL|parcel|smartpost": 14.89,
  "NL|parcel|dpd": 14.89, "NL|parcel|venipak": 14.89, "NL|parcel|unisend": 14.89,
  "NL|courier|": 20.89, "NL|pickup|": 0.00, "PL|parcel|": 7.49,
  "PL|parcel|omniva": 7.49, "PL|parcel|smartpost": 7.49, "PL|parcel|dpd": 7.49,
  "PL|parcel|venipak": 7.49, "PL|parcel|unisend": 7.49, "PL|courier|": 15.99,
  "PL|pickup|": 0.00, "PT|parcel|": 29.79, "PT|parcel|omniva": 29.79,
  "PT|parcel|smartpost": 29.79, "PT|parcel|dpd": 29.79, "PT|parcel|venipak": 29.79,
  "PT|parcel|unisend": 29.79, "PT|courier|": 33.69, "PT|pickup|": 0.00,
  "RO|parcel|": 10.99, "RO|parcel|omniva": 10.99, "RO|parcel|smartpost": 10.99,
  "RO|parcel|dpd": 10.99, "RO|parcel|venipak": 10.99, "RO|parcel|unisend": 10.99,
  "RO|courier|": 31.99, "RO|pickup|": 0.00, "SE|parcel|": 13.69,
  "SE|parcel|omniva": 13.69, "SE|parcel|smartpost": 13.69, "SE|parcel|dpd": 13.69,
  "SE|parcel|venipak": 13.69, "SE|parcel|unisend": 13.69, "SE|courier|": 21.59,
  "SE|pickup|": 0.00, "SI|parcel|": 22.39, "SI|parcel|omniva": 22.39,
  "SI|parcel|smartpost": 22.39, "SI|parcel|dpd": 22.39, "SI|parcel|venipak": 22.39,
  "SI|parcel|unisend": 22.39, "SI|courier|": 27.89, "SI|pickup|": 0.00,
  "SK|parcel|": 16.39, "SK|parcel|omniva": 16.39, "SK|parcel|smartpost": 16.39,
  "SK|parcel|dpd": 16.39, "SK|parcel|venipak": 16.39, "SK|parcel|unisend": 16.39,
  "SK|courier|": 22.99, "SK|pickup|": 0.00, "EU|parcel|": 4.99,
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
 * Until 22.09.2026 three of these were the carrier's own Montonio rate — EE
 * 2,39, LV 4,79, LT 4,09, the only countries the checkout drew a Nova Post chip
 * in — and every other country fell through to its own cell. Since that day
 * (owner's decision, Montonio-calculator carrier choice) it is the other way
 * round: Nova Post is never offered in EE, LV or LT, so there the tag falls
 * through to the country's «Пакомат» cell and equals its Venipak twin; and it
 * IS offered in AT CZ DE ES HU IT PL RO SK, so there it bills its own Montonio
 * price (MONTONIO_PRICE.chips.parcel.novapost in public/shop2/app.js). Finland
 * is still 12,39 — Montonio runs no Nova Post locker there — and every
 * remaining country still falls through the same way.
 */
const NOVAPOST: Record<string, number> = {
  "EE|parcel|novapost": 5.47, "LV|parcel|novapost": 5.59, "LT|parcel|novapost": 5.59,
  "FI|parcel|novapost": 12.39, "AT|parcel|novapost": 9.59, "BE|parcel|novapost": 17.89,
  "BG|parcel|novapost": 37.29, "CZ|parcel|novapost": 6.99, "DE|parcel|novapost": 8.89,
  "DK|parcel|novapost": 14.89, "ES|parcel|novapost": 11.39, "FR|parcel|novapost": 28.29,
  "GR|parcel|novapost": 4.99, "HR|parcel|novapost": 29.79, "HU|parcel|novapost": 7.09,
  "IE|parcel|novapost": 22.39, "IT|parcel|novapost": 10.99, "LU|parcel|novapost": 20.89,
  "NL|parcel|novapost": 14.89, "PL|parcel|novapost": 5.49, "PT|parcel|novapost": 29.79,
  "RO|parcel|novapost": 10.99, "SE|parcel|novapost": 13.69, "SI|parcel|novapost": 22.39,
  "SK|parcel|novapost": 7.29, "EU|parcel|novapost": 4.99, "US|parcel|novapost": 4.99,
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
 * The row a migrated shop has before anyone types a price into it: what
 * db/migrations 030 → 031 → 148 → 149 → 202 leave in `settings.shipping_rules`
 * (tests/shipping-migration.test.ts builds it for real and compares).
 *
 * Until 22.09.2026 this held a cell for every country — 148 wrote them all as
 * fixed numbers, and a stored cell wins over the code defaults, so the row kept
 * billing the 30 cm cube after the table was re-quoted for the carton. 202
 * took out every cell that still said 148's (or 149's) number: an absent cell
 * is Montonio's price. What is left are the fallback cells and the three home
 * couriers, EE 10.84 and LV/LT 9.90 — the shop's own prices, which the read
 * does NOT seed (parseShippingRules() fills the courier column from Montonio's
 * table without them), so they have to stay in the row to keep billing.
 *
 * Note what is NOT in it — no `carriers` key at all, because nothing but those
 * migrations ever wrote the row and none of them writes one. That is precisely
 * why the markup could never reach a bill: parseShippingRules() merges
 * carrierPriceTable() in underneath, so every carrier cell the checkout can
 * read is filled, and the empty-cell fallback the markup rode on is
 * unreachable.
 */
const STORED_ROW = {
  freeFrom: 59,
  freeFromByCountry: { EU: 200 },
  countriesOff: ["CH", "CY", "GB", "IS", "LI", "MT", "NO"],
  methods: {
    parcel: { default: 4.99 },
    courier: { default: 9.9, EE: 10.84, LV: 9.9, LT: 9.9 },
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
     either. Nova Post prices its own column and touches nothing else — no
     country's «Курьер», no country's «Пакомат», no other carrier's chip.
     (Hungary and Romania, whose every parcel price IS Nova Post's since
     22.09.2026, are in FROZEN at that price — they have no other carrier.) */
  it("Nova Post prices its own column and moves nothing else", () => {
    const priced = priceEveryDelivery(DEFAULT_SHIPPING_RULES);
    for (const [k, v] of Object.entries(FROZEN)) expect([k, priced[k]]).toEqual([k, v]);
    /* 22.09.2026 (owner's decision, Montonio-calculator carrier choice): never
       offered in the Baltics — a stale tag bills the country's «Пакомат»… */
    expect(priced["EE|parcel|novapost"]).toBe(priced["EE|parcel|"]);
    expect(priced["LV|parcel|novapost"]).toBe(priced["LV|parcel|"]);
    expect(priced["LT|parcel|novapost"]).toBe(priced["LT|parcel|"]);
    // …and abroad it bills its own card, which is why it is so often the cheapest
    expect(priced["PL|parcel|novapost"]).toBe(5.49);   // DPD's is 7,49
  });
});

describe("an empty box means Montonio's price — in every column now", () => {
  /* The rule quoteFromRules() has had for carrier cells since 13.09.2026, now
     true of the courier column too. Since db/migrations/202 (22.09.2026) it is
     what prices every country cell nobody typed — 148 used to fill them all
     with fixed numbers; it is also what the owner gets when he clears one, and
     the number the screen prints under every box. */
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
    /* The cells a save sends back are the ones the read seeded — today's
       table, so DE 16.39 and PL 7.49 since the 22.09.2026 carton re-quote,
       and HU 7.09 since the carrier choice of the same day: Hungary's only
       locker is Nova Post's, at Nova Post's price (it was the 4.99 fallback). */
    const withCells = parseShippingRules({
      methods: { parcel: { default: 4.99, DE: 16.39, PL: 7.49, GR: 4.99, HU: 7.09 } },
    });
    const dropped = parseShippingRules(cleanShippingRules({
      methods: { parcel: { default: 4.99, DE: 16.39, PL: 7.49, GR: 4.99, HU: 7.09 } },
    }));
    for (const c of ["DE", "PL", "AT", "SK", "GR", "HU", "RO", "ES", "IT"]) {
      const q = { country: c, method: "parcel" as const, subtotal: 10 };
      expect(quoteFromRules(dropped, q).price).toBe(quoteFromRules(withCells, q).price);
    }
  });

  it("leaves nothing below cost for the removed guard to have caught", () => {
    const clean = parseShippingRules(cleanShippingRules({ methods: { parcel: { DE: 0.01 } } }));
    expect(belowCostCells(clean).filter((c) => c.method === "parcel" && c.country === "DE")).toEqual([]);
    expect(quoteFromRules(clean, { country: "DE", method: "parcel", subtotal: 10 }).price).not.toBe(0.01);
  });
});
