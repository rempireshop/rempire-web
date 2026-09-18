/**
 * tools/lib/delivery-pricing.mjs — the arithmetic that turns live Montonio
 * rates into «какую фиксированную цену ставить».
 *
 * ## Every fixture here is copied from Montonio's documentation, not from us
 *
 * This is the whole point of the file, and it is a direct response to how the
 * shipping webhook stayed broken for months with a green suite:
 * `tests/shipping-webhook.test.ts` built its token the way `readEvent()`
 * happened to read one — flat — while the documented payload puts everything
 * inside `data`. The test proved the code agreed with itself.
 * (docs/montonio-shipping-audit.md § 1.1.)
 *
 * So `DOC_EXAMPLE` below is the reference's own example response body,
 * transcribed field for field from
 * <https://docs.montonio.com/api/shipping-v2/reference> § Calculate shipping
 * rates, read 18.09.2026 — including the things our code does NOT do:
 *
 *   · `rate` is a **string** («"2.50"»), not a number;
 *   · there is a `calculationDetails.estimatedParcels[]` block with
 *     `actualWeight`, `volumetricWeight`, `chargeableWeight` and
 *     `bufferApplied`, which `fetchMontonioRates()` in
 *     src/lib/shipping/montonio.ts throws away entirely;
 *   · `destination` is echoed at the top level;
 *   · one `pickupPoint` method carries SEVERAL subtypes, which is the fact the
 *     whole branch exists for.
 *
 * A fixture written to match what our parser wanted would have proved nothing.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { DEFAULT_SHIPPING_RULES, shippingZone as shippingZoneTs } from "@/lib/shipping";
import { estimateWeightKg } from "@/lib/shipping/montonio";
import {
  CARRIER_CHOICE_COUNTRIES as CHOICE_TS,
  CHIP_ONLY_CARRIERS as CHIP_TS,
  roundUpToX9 as roundUpToX9Ts,
  SHOP_CARRIERS as SHOP_TS,
} from "@/lib/shipping/country-prices";

import {
  bandsFrom,
  basisFor,
  buildGrid,
  candidates,
  CARRIER_CHOICE_COUNTRIES,
  CHIP_ONLY_CARRIERS,
  DEFAULT_BANDS,
  emptyGridDiagnosis,
  EUROPE,
  eur,
  flatPriceEconomics,
  gridRows,
  grossCost,
  HOLE,
  kindOf,
  KINDS,
  parseRatesResponse,
  perCarrierRows,
  plural,
  rateRequestBody,
  roundUpToX9,
  sellableRows,
  sensitivity,
  shippingZone,
  SHOP_CARRIERS,
  unitsToKg,
  VAT_EE,
  zoneRollup,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — a plain .mjs helper, same as tools/lib/asset-token.mjs elsewhere
} from "../tools/lib/delivery-pricing.mjs";

/**
 * «This must not be a hole here» — and if it is, say so instead of reading
 * `undefined.rate` three lines later.
 *
 * Almost everything in the module returns `null` for an absent price on
 * purpose (that is the point of the whole file), so TypeScript is right to
 * insist. Where a test has already established that a value exists, this
 * unwraps it and turns a regression into a sentence rather than a TypeError.
 */
function must<T>(v: T | null | undefined, what = "значение"): T {
  if (v === null || v === undefined) throw new Error(`ожидали ${what}, получили дыру`);
  return v;
}

const CLI = fileURLToPath(new URL("../tools/delivery-pricing.mjs", import.meta.url));
const LIB_SRC = readFileSync(fileURLToPath(new URL("../tools/lib/delivery-pricing.mjs", import.meta.url)), "utf8");
const CLI_SRC = readFileSync(CLI, "utf8");

/* ---------- the documentation's own example response ----------------------- */

/**
 * Verbatim from the reference § Calculate shipping rates. Do not "tidy" the
 * string rates or drop `calculationDetails`: both are what makes this fixture
 * evidence rather than a mirror of our assumptions.
 */
const DOC_EXAMPLE = {
  calculationDetails: {
    estimatedParcels: [
      {
        length: 20,
        width: 15,
        height: 10,
        dimensionUnit: "cm",
        actualWeight: 0.5,
        volumetricWeight: 0.75,
        chargeableWeight: 0.75,
        weightUnit: "kg",
        bufferApplied: 0,
      },
    ],
  },
  destination: "EE",
  carriers: [
    {
      carrierCode: "omniva",
      shippingMethods: [
        {
          type: "pickupPoint",
          subtypes: [
            { code: "parcelMachine", rate: "2.50", currency: "EUR" },
            { code: "postOffice", rate: "2.50", currency: "EUR" },
          ],
        },
      ],
    },
    {
      carrierCode: "dpd",
      shippingMethods: [
        {
          type: "pickupPoint",
          subtypes: [
            { code: "parcelMachine", rate: "3.00", currency: "EUR" },
            { code: "parcelShop", rate: "3.00", currency: "EUR" },
          ],
        },
      ],
    },
  ],
};

/** The same shape, with the subtypes priced apart — which is the defect being corrected. */
function bodyWithSubtypesApart() {
  return {
    destination: "LV",
    calculationDetails: {
      estimatedParcels: [
        { length: 25, width: 20, height: 15, dimensionUnit: "cm", actualWeight: 1.4, volumetricWeight: 1.5, chargeableWeight: 1.5, weightUnit: "kg", bufferApplied: 0 },
      ],
    },
    carriers: [
      {
        carrierCode: "dpd",
        shippingMethods: [
          {
            type: "pickupPoint",
            subtypes: [
              { code: "parcelMachine", rate: "4.10", currency: "EUR" },
              { code: "parcelShop", rate: "5.90", currency: "EUR" },
              { code: "postOffice", rate: "6.40", currency: "EUR" },
            ],
          },
          { type: "courier", subtypes: [{ code: "standard", rate: "8.20", currency: "EUR" }] },
        ],
      },
    ],
  };
}

/* ========================================================================== */

describe("reading Montonio's documented rates response", () => {
  it("parses the reference's own example body, string rates and all", () => {
    const parsed = parseRatesResponse(DOC_EXAMPLE, { country: "EE" });
    expect(parsed.problems).toEqual([]);
    expect(parsed.destination).toBe("EE");
    /* Four rows: two carriers × two subtypes. A parser that collapsed a
       method to one row — which is what contract-prices forces and what
       flatten() in tools/fetch-montonio-tariffs.mjs does on purpose — would
       find two. */
    expect(parsed.rows).toHaveLength(4);
    expect(parsed.rows.map((r: { carrier: string; kind: string; rate: number }) => `${r.carrier} ${r.kind} ${r.rate}`)).toEqual([
      "omniva locker 2.5",
      "omniva postOffice 2.5",
      "dpd locker 3",
      "dpd parcelShop 3",
    ]);
    /* `rate` arrives as a STRING in the documented example. If this ever
       starts failing because the fixture was "fixed" to a number, the fixture
       is wrong, not the parser. */
    expect(typeof DOC_EXAMPLE.carriers[0].shippingMethods[0].subtypes[0].rate).toBe("string");
  });

  it("reads calculationDetails — the block our production parser discards", () => {
    const parsed = parseRatesResponse(DOC_EXAMPLE, { country: "EE" });
    expect(parsed.chargeable).toEqual({
      actualKg: 0.5,
      volumetricKg: 0.75,
      chargeableKg: 0.75,
      bufferApplied: 0,
      weightUnit: "kg",
      dimensionUnit: "cm",
      parcels: 1,
    });
    /* The documented example is itself a case where the BOX is billed, not the
       contents: 20×15×10 cm ÷ 5000 = 0.75 kg against 0.5 kg of actual weight.
       That is the fact that makes "assume a typical order is X kg" a much
       weaker lever than it looks, and the tool prints it for exactly that
       reason. */
    const ch = must(parsed.chargeable, "calculationDetails");
    expect(must(ch.chargeableKg)).toBeGreaterThan(must(ch.actualKg));
  });

  it("keeps the three pickupPoint subtypes apart — the defect this branch exists for", () => {
    const parsed = parseRatesResponse(bodyWithSubtypesApart(), { country: "LV" });
    const byKind = Object.fromEntries(parsed.rows.map((r: { kind: string; rate: number }) => [r.kind, r.rate]));
    expect(byKind).toEqual({ locker: 4.1, parcelShop: 5.9, postOffice: 6.4, courier: 8.2 });
    /* contract-prices answers ONE number for shippingMethod=pickupPoint. If the
       mirror took the parcel-shop tier, a locker priced at 4.10 would be sold
       against a 5.90 cost — 1.80 € an order, invisible to the customer, out of
       Renat's margin. This assertion is the difference. */
    expect(byKind.locker).not.toBe(byKind.parcelShop);
  });

  it("maps Montonio's (type, subtype) pairs onto the four kinds a customer picks", () => {
    expect(kindOf("pickupPoint", "parcelMachine")).toBe("locker");
    expect(kindOf("pickupPoint", "parcelShop")).toBe("parcelShop");
    expect(kindOf("pickupPoint", "postOffice")).toBe("postOffice");
    expect(kindOf("courier", "standard")).toBe("courier");
    /* standardB2B is in the reference's subtype list and is still a courier. */
    expect(kindOf("courier", "standardB2B")).toBe("courier");
    /* An unseen code is news: kept and labelled, never silently folded into
       "locker" where it would set a price. */
    expect(kindOf("pickupPoint", "someNewTier")).toBe("other:someNewTier");
    expect(KINDS).not.toContain("other:someNewTier");
  });
});

describe("holes are holes and never zero", () => {
  it("an absent carrier is not priced, which is not the same as free", () => {
    /* The reference Note: "This endpoint only returns rates for carriers with
       Montonio contracts. Carriers that only support Direct contracts will not
       be included in the response." So a partial contract set means an absent
       carrier, and the grid must say so. */
    const onlyOmniva = {
      destination: "EE",
      carriers: [DOC_EXAMPLE.carriers[0]],
    };
    const parsed = parseRatesResponse(onlyOmniva, { country: "EE" });
    expect(parsed.rows.every((r: { carrier: string }) => r.carrier === "omniva")).toBe(true);
    expect(basisFor("EE", "parcelShop", parsed.rows)).toBeNull();
    expect(basisFor("EE", "courier", parsed.rows)).toBeNull();

    const grid = buildGrid({ countries: ["EE"], bands: bandsFrom([DEFAULT_BANDS[0]]), answers: { EE: { 0: parsed } } });
    expect(grid.cells["EE"][0].courier).toBeNull();
    expect(gridRows(grid, "courier")[0]).toContain(HOLE);
    /* The one thing that must never happen: a hole read as a price of zero. */
    expect(gridRows(grid, "courier")[0]).not.toContain("0.00 €");
    expect(eur(null)).toBe(HOLE);
  });

  it('rate "0" is no tariff, not a free delivery, and it says why', () => {
    const zeroed = {
      destination: "GR",
      carriers: [
        {
          carrierCode: "smartpost",
          shippingMethods: [{ type: "courier", subtypes: [{ code: "standard", rate: "0", currency: "EUR" }] }],
        },
      ],
    };
    const parsed = parseRatesResponse(zeroed, { country: "GR" });
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.problems.join(" ")).toMatch(/rate = 0/);
    expect(basisFor("GR", "courier", parsed.rows)).toBeNull();
    /* Taken as a price, 0 would make every flat price infinitely profitable
       and would become the cheapest carrier — i.e. the basis. Same call
       src/lib/shipping/montonio.ts:503 makes, and here it is written down
       rather than silent. */
  });

  it("a malformed body yields holes and a complaint, not a throw", () => {
    for (const bad of [null, {}, { carriers: "nope" }, { carriers: [{}] }]) {
      const parsed = parseRatesResponse(bad, { country: "EE" });
      expect(parsed.rows).toEqual([]);
      expect(Array.isArray(parsed.problems)).toBe(true);
    }
    const unreadable = {
      destination: "EE",
      carriers: [{ carrierCode: "dpd", shippingMethods: [{ type: "courier", subtypes: [{ code: "standard", rate: "n/a" }] }] }],
    };
    const parsed = parseRatesResponse(unreadable, { country: "EE" });
    expect(parsed.rows).toEqual([]);
    expect(parsed.problems.join(" ")).toMatch(/не число/);
  });

  it("notices when the answer is about a different country than the question", () => {
    const parsed = parseRatesResponse({ ...DOC_EXAMPLE, destination: "LV" }, { country: "EE" });
    expect(parsed.problems.join(" ")).toMatch(/ответ про LV/);
  });
});

describe("which rows may set a price — costBasis(), restated", () => {
  function rows(spec: Array<[string, string, number]>) {
    return spec.map(([carrier, kind, rate]) => ({ carrier, kind, rate, currency: "EUR" }));
  }

  it("where the SHOPPER picks the carrier, the price covers the dearest", () => {
    /* EE, LV, LT, FI under «Пакомат» draw carrier chips, so he may pick the
       dear one — src/lib/shipping/country-prices.ts costBasis(). */
    for (const cc of CARRIER_CHOICE_COUNTRIES) {
      const b = must(basisFor(cc, "locker", rows([["omniva", "locker", 2.5], ["dpd", "locker", 3.4]])), cc);
      expect(b.carrier).toBe("dpd");
      expect(b.rate).toBe(3.4);
      expect(b.rule).toMatch(/дороже/);
    }
  });

  it("where RENAT picks it at the label, the price covers the cheapest", () => {
    /* A courier has no chips anywhere, and no country outside the four has
       locker chips either. */
    const courier = must(basisFor("EE", "courier", rows([["dpd", "courier", 6.8], ["smartpost", "courier", 7.4]])));
    expect(courier.carrier).toBe("dpd");
    expect(courier.rule).toMatch(/дешевле/);
    const deLocker = must(basisFor("DE", "locker", rows([["dpd", "locker", 11.8], ["smartpost", "locker", 9.9]])));
    expect(deLocker.carrier).toBe("smartpost");
    expect(deLocker.rule).toMatch(/дешевле/);
  });

  it("Nova Post prices itself and never a country, and says so", () => {
    /* CHIP_ONLY_CARRIERS: it is Montonio International Shipping, cheapest on
       most routes, and has no returns at all. Letting it into a basis would
       reprice most of Europe downwards and bind those parcels to a carrier
       the shop cannot take a return through. */
    const only = rows([["novapost", "courier", 8.7]]);
    expect(basisFor("DE", "courier", only)).toBeNull();
    const { kept, excluded } = sellableRows(only);
    expect(kept).toEqual([]);
    expect(excluded[0].why).toMatch(/фишка/);

    const mixed = rows([["novapost", "courier", 8.7], ["smartpost", "courier", 15.4]]);
    expect(must(basisFor("DE", "courier", mixed)).carrier).toBe("smartpost");
  });

  it("keeps every sellable carrier's own price where the shopper is the one choosing", () => {
    /* The basis grid shows ONE carrier per country. Under «Пакомат» in EE, LV,
       LT and FI that is not the whole story: the checkout draws a chip per
       carrier and the panel keeps a cell per carrier
       (carrierPriceTable() in src/lib/shipping/country-prices.ts). Collapsing
       them to one country number is how nine of the fourteen pairs came to be
       sold below cost — Finland charged 7.89 € for a 12.39 € DPD machine. */
    const bands = bandsFrom(DEFAULT_BANDS.slice(0, 2));
    const band = (rates: Array<[string, number]>) => ({
      destination: "EE",
      chargeable: null,
      problems: [],
      rows: rates.map(([carrier, rate]) => ({ carrier, kind: "locker", rate, currency: "EUR" })),
    });
    const answersByBand = {
      0: band([["omniva", 2.5], ["dpd", 3.4], ["novapost", 1.8], ["inpost", 0.9]]),
      1: band([["omniva", 2.6], ["dpd", 3.6]]),
    };
    const grid = buildGrid({ countries: ["EE"], bands, answers: { EE: answersByBand } });
    const out = perCarrierRows({ country: "EE", kind: "locker", grid, answersByBand });

    /* Nova Post is here and marked: a chip IS what it is — it prices itself,
       it just never becomes the basis of a country. InPost is not, because the
       checkout cannot offer it at all. */
    expect(out.carriers.map((c: { carrier: string }) => c.carrier)).toEqual(["dpd", "novapost", "omniva"]);
    expect(out.carriers.find((c: { carrier: string }) => c.carrier === "novapost")?.chipOnly).toBe(true);
    expect(out.carriers.find((c: { carrier: string }) => c.carrier === "dpd")?.chipOnly).toBe(false);

    /* A carrier quoted on one band and not the other keeps a hole, not a zero. */
    const np = must(out.carriers.find((c: { carrier: string }) => c.carrier === "novapost"));
    expect(np.perBand[0]).toBe(grossCost(1.8));
    expect(np.perBand[1]).toBeNull();
  });

  it("a carrier the checkout cannot offer is excluded with a reason", () => {
    const { kept, excluded } = sellableRows(rows([["inpost", "locker", 1.1], ["omniva", "locker", 2.5]]));
    expect(kept.map((r: { carrier: string }) => r.carrier)).toEqual(["omniva"]);
    expect(excluded[0].why).toMatch(/SHOP_CARRIERS/);
    /* Otherwise an InPost row — Montonio quotes none today, but the endpoint
       may start — would silently become the cheapest and therefore the basis
       of a shelf price for a delivery nobody can buy. */
  });
});

describe("the arithmetic a person reads before typing a number", () => {
  /** Three bands, costs 3.00 / 4.00 / 6.00 gross, one country, one kind. */
  function gridOf(costs: number[], country = "EE", kind = "locker") {
    const bands = bandsFrom(DEFAULT_BANDS.slice(0, costs.length));
    const answers: Record<string, Record<number, unknown>> = { [country]: {} };
    costs.forEach((c, i) => {
      answers[country][i] = {
        destination: country,
        chargeable: null,
        problems: [],
        /* Net of VAT, so the gross figure lands on the round number above. */
        rows: [{ carrier: "dpd", kind, rate: Math.round((c / (1 + VAT_EE)) * 10000) / 10000, currency: "EUR" }],
      };
    });
    return buildGrid({ countries: [country], bands, answers });
  }

  it("margin per band, and the band where a flat price stops paying", () => {
    const grid = gridOf([3, 4, 6]);
    const econ = flatPriceEconomics({ flat: 4.5, country: "EE", kind: "locker", grid });
    expect(econ.perBand.map((p: { margin: number | null }) => p.margin)).toEqual([1.5, 0.5, -1.5]);
    expect(econ.losesFrom).toBe(2);
    expect(econ.worstMargin).toBe(-1.5);
    /* «Сколько остаётся на самом тяжёлом заказе» — the brief's own question,
       and the number an average hides. */
    expect(must(econ.atHeaviest).margin).toBe(-1.5);
    expect(econ.holes).toBe(0);
  });

  it("break-even is the dearest band, rounded the way the shop rounds", () => {
    const grid = gridOf([3, 4, 6]);
    const econ = flatPriceEconomics({ flat: null, country: "EE", kind: "locker", grid });
    expect(econ.breakEvenAll).toBe(6);
    /* roundUpToX9 — always up. Rounding down would put the shelf price under
       the cost that was just computed, which is the one thing this must not do. */
    expect(econ.suggestedX9).toBe(6.09);
    expect(econ.suggestedX9).toBeGreaterThanOrEqual(econ.breakEvenAll);
  });

  it("holes do not become zero margin, and do not drag the break-even down", () => {
    const bands = bandsFrom(DEFAULT_BANDS.slice(0, 3));
    const grid = buildGrid({
      countries: ["EE"],
      bands,
      answers: {
        EE: {
          0: { destination: "EE", chargeable: null, problems: [], rows: [{ carrier: "dpd", kind: "locker", rate: 10, currency: "EUR" }] },
          // band 1: Montonio never answered — a hole
          2: { destination: "EE", chargeable: null, problems: [], rows: [] },
        },
      },
    });
    const econ = flatPriceEconomics({ flat: 5, country: "EE", kind: "locker", grid });
    expect(econ.holes).toBe(2);
    expect(econ.priced).toBe(1);
    expect(econ.perBand[1].margin).toBeNull();
    expect(econ.perBand[2].margin).toBeNull();
    /* A hole counted as cost 0 would leave worstMargin at +5 — «we make five
       euro on the parcels Montonio would not quote». It must read the loss on
       the one band that HAS a price, and nothing at all on the two that do not. */
    expect(econ.breakEvenAll).toBe(grossCost(10)); // 12.40, the only priced band
    expect(econ.worstMargin).toBe(-7.4); // 5.00 charged against 12.40 of cost
    expect(grid.missing.some((m: { band: number }) => m.band === 1)).toBe(true);
  });

  it("names three candidate prices instead of picking one", () => {
    const grid = gridOf([3, 4, 6]);
    const c = must(candidates({ country: "EE", kind: "locker", grid, typicalBand: 0 }));
    expect(c.typical).toBe(3.09); // breaks even on a typical order, loses above it
    expect(c.safe).toBe(6.09); //   never loses; small orders pay for it
    expect(c.middle).toBe(4.59); // the bet, stated as one
    expect(must(c.typical)).toBeLessThan(must(c.middle));
    expect(must(c.middle)).toBeLessThan(must(c.safe));
  });

  it("--heaviest changes the verdict, not just a column", () => {
    /* «Заказов больше N у нас не бывает» has to move the break-even, or
       «без убытка» quietly covers a parcel he has just said never turns up
       and the price comes out too high on purpose. The band stays visible —
       the guess may be wrong — but it stops counting. */
    const grid = gridOf([3, 4, 20]); // the top band is the expensive outlier
    const all = flatPriceEconomics({ flat: 5, country: "EE", kind: "locker", grid });
    expect(all.breakEvenAll).toBe(20);
    expect(all.worstMargin).toBe(-15);

    const capped = flatPriceEconomics({ flat: 5, country: "EE", kind: "locker", grid, heaviestBand: 1 });
    expect(capped.breakEvenAll).toBe(4); //  covers only what he says happens
    expect(capped.worstMargin).toBe(1); //   and no longer reports a loss on it
    expect(capped.losesFrom).toBeNull();
    /* Still printed, still true, simply not counted. */
    expect(capped.perBand[2].cost).toBe(20);
    expect(capped.perBand[2].counted).toBe(false);
    expect(capped.perBand[1].counted).toBe(true);
  });

  it("does not invent a candidate for a band Montonio never priced", () => {
    /* A hole at the typical band must not quietly become «then use the safe
       price»: the table would show «—» in «себест. типичн.» and a confident
       number in «по типичному» next to it, and that number is the break-even
       of nothing. Two of the three candidates do not exist here. */
    const bands = bandsFrom(DEFAULT_BANDS.slice(0, 2));
    const grid = buildGrid({
      countries: ["EE"],
      bands,
      answers: {
        EE: {
          // band 0 (the typical one) is a hole
          1: { destination: "EE", chargeable: null, problems: [], rows: [{ carrier: "dpd", kind: "locker", rate: 10, currency: "EUR" }] },
        },
      },
    });
    const c = must(candidates({ country: "EE", kind: "locker", grid, typicalBand: 0 }));
    expect(c.typicalCost).toBeNull();
    expect(c.typical).toBeNull();
    expect(c.middle).toBeNull();
    expect(c.safe).toBe(roundUpToX9(grossCost(10))); // the one that is real
  });

  it("says how much the unmeasured weight actually moves the answer", () => {
    const flat = sensitivity({ country: "EE", kind: "locker", grid: gridOf([3, 3.2]) });
    expect(flat.spread).toBeCloseTo(0.2, 2);
    expect(flat.verdict).toMatch(/почти не влияет/);

    const steep = sensitivity({ country: "EE", kind: "locker", grid: gridOf([3, 9]) });
    expect(steep.ratio).toBe(3);
    expect(steep.verdict).toMatch(/решает всё/);
    /* This is the honest answer to «nobody has weighed the products»: not a
       guess dressed as a figure, but a statement of how much the guess is
       worth in this country. */
  });

  it("a zone price has to cover the dearest country in it, and holes stay out", () => {
    const bands = bandsFrom([DEFAULT_BANDS[0]]);
    const row = (rate: number) => ({ destination: "", chargeable: null, problems: [], rows: [{ carrier: "dpd", kind: "courier", rate, currency: "EUR" }] });
    const grid = buildGrid({
      countries: ["DE", "GR", "PL"],
      bands,
      answers: {
        DE: { 0: row(20) },
        GR: { 0: row(40) },
        PL: { 0: { destination: "PL", chargeable: null, problems: [], rows: [] } }, // no contract → hole
      },
    });
    const roll = zoneRollup({ zone: "EU", kind: "courier", grid });
    expect(roll.members).toEqual(["DE", "GR", "PL"]);
    expect(roll.perBand[0].dearest.country).toBe("GR");
    expect(roll.perBand[0].cheapest.country).toBe("DE");
    expect(roll.perBand[0].holes).toEqual(["PL"]);
    expect(roll.breakEvenAll).toBe(grossCost(40));
    /* Poland priced at 0 would make it the cheapest country and would drag a
       "spread" figure to nonsense. It is simply not in the calculation. */
    expect(roll.perBand[0].cheapest.gross).toBe(grossCost(20));
  });
});

describe("VAT is an assumption, and it is the same one the mirror makes", () => {
  it("adds Estonian VAT by default, because that is what the tariff mirror does", () => {
    /* tools/fetch-montonio-tariffs.mjs stores contract prices WITH 24 % VAT
       (withVat(), line 111) so they compare like for like against shelf
       prices, which include VAT — src/lib/shipping/country-prices.ts says so
       in its header. This tool matches that, so a cost here and a cost there
       mean the same thing. */
    expect(grossCost(10)).toBe(12.4);
    expect(VAT_EE).toBe(0.24);
    const tariffs = JSON.parse(
      readFileSync(fileURLToPath(new URL("../src/data/montonio-tariffs.json", import.meta.url)), "utf8"),
    );
    expect(tariffs.vatRateEE).toBe(VAT_EE);
  });

  it("can be flipped in one place when a real invoice settles it", () => {
    expect(grossCost(10, { ratesIncludeVat: true })).toBe(10);
    expect(CLI_SRC).toContain("--rates-include-vat");
  });

  it("says out loud that the documentation is silent about it", () => {
    /* The reference prints `code`, `rate`, `currency` and no tax field, and no
       Note on the endpoint mentions VAT. The live overlay in
       tools/fetch-montonio-tariffs.mjs writes the raw rate with
       `vatIncluded: false` while the static rows beside it are gross, so the
       existing tooling disagrees with itself. An assumption that big has to be
       on the screen, not in a comment. */
    expect(LIB_SRC).toMatch(/документация Montonio про `rate` НЕ ГОВОРИТ НИЧЕГО/);
  });
});

describe("the request body is the documented one, in the documented units", () => {
  it("sends centimetres and kilograms, per the reference's own defaults", () => {
    const band = bandsFrom([{ units: 3, box: [25, 20, 15] }])[0];
    expect(rateRequestBody("ee", band)).toEqual({
      destination: "EE",
      parcels: [
        {
          items: [
            { length: 25, width: 20, height: 15, dimensionUnit: "cm", weight: 1.4, weightUnit: "kg", quantity: 1 },
          ],
        },
      ],
    });
  });

  it("does NOT use metres — the trap next door", () => {
    /* `POST /shipping-methods/rates` takes cm via items[].dimensionUnit;
       `POST /shipments` takes METRES. Both are correct and they really do
       differ — docs/montonio-shipping-audit.md § 6. Sending metres here would
       quote a 0.25 m parcel as a 25 cm one's price by luck, or not at all. */
    const band = bandsFrom([DEFAULT_BANDS[0]])[0];
    const item = rateRequestBody("EE", band).parcels[0].items[0];
    expect(item.dimensionUnit).toBe("cm");
    expect(item.length).toBeGreaterThan(1); // a metre-valued box would be < 1
  });
});

describe("the weight bands are the shop's own guess, not a new one", () => {
  it("unitsToKg is estimateWeightKg(), the number already sent on every shipment", () => {
    for (const units of [0, 1, 2, 3, 6, 12, 24, 100]) {
      const order = { items: Array.from({ length: units }, () => ({ qty: 1 })) } as Parameters<typeof estimateWeightKg>[0];
      expect(unitsToKg(units)).toBe(estimateWeightKg(order));
    }
    /* Clamped the same way at both ends. */
    expect(unitsToKg(0)).toBe(0.3);
    expect(unitsToKg(1000)).toBe(30);
  });

  it("every default band grows its carton with the order", () => {
    /* Montonio bills chargeableWeight = max(actual, volumetric), so a ladder
       of weights inside ONE box measures nothing: 30×30×30 is 5.4 kg of
       volumetric weight whatever goes in it, and every band below that would
       come back at the same price. */
    const bands = bandsFrom(DEFAULT_BANDS);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].kg).toBeGreaterThan(bands[i - 1].kg);
      const vol = (b: { box: number[] }) => b.box[0] * b.box[1] * b.box[2];
      expect(vol(bands[i])).toBeGreaterThan(vol(bands[i - 1]));
    }
    expect(bands[0].label).toContain("кг");
  });
});

describe("the constants restated from the app have not drifted", () => {
  /* Same contract as SHOP_CARRIERS in src/lib/shipping/country-prices.ts,
     which restates MONTONIO_CARRIERS and is held to it in
     tests/shipping-country-prices.test.ts: a tools/*.mjs file is a standalone
     node process with no "@/" alias, so it carries its own copy and a test
     holds the two together. */
  it("SHOP_CARRIERS, CHIP_ONLY_CARRIERS and CARRIER_CHOICE_COUNTRIES match", () => {
    expect([...SHOP_CARRIERS].sort()).toEqual([...SHOP_TS].sort());
    expect([...CHIP_ONLY_CARRIERS].sort()).toEqual([...CHIP_TS].sort());
    expect([...CARRIER_CHOICE_COUNTRIES].sort()).toEqual([...CHOICE_TS].sort());
  });

  it("shippingZone() agrees with src/lib/shipping.ts on every country in play", () => {
    const all = [
      ...EUROPE,
      ...CARRIER_CHOICE_COUNTRIES,
      "EU",
      "US", "UA", "AU", "", "xx", "ee",
    ];
    for (const c of all) expect(shippingZone(c)).toBe(shippingZoneTs(c));
    /* And the EU list really is the zone «Другие страны Европы» prices. */
    for (const c of EUROPE) expect(shippingZone(c)).toBe("EU");
    expect(shippingZone("US")).toBe("default");
  });

  it("roundUpToX9 is the shop's own rounding, to the cent", () => {
    for (const n of [0.01, 1, 2.4, 4.39, 4.4, 5.58, 5.59, 6.0, 12.345, 43.15]) {
      expect(roundUpToX9(n)).toBe(roundUpToX9Ts(n));
      if (n > 0) expect(roundUpToX9(n)).toBeGreaterThanOrEqual(n);
    }
    expect(roundUpToX9(0)).toBe(0);
    expect(roundUpToX9(NaN)).toBe(0);
  });

  it("the zones it prints are the ones the rate screen actually has", () => {
    /* Not a spelling check: a zone the panel has no row for is a number
       nobody could type in. DEFAULT_SHIPPING_RULES keys its method tables by
       exactly these. */
    const zones = new Set(EUROPE.map((c: string) => shippingZone(c)));
    expect([...zones]).toEqual(["EU"]);
    expect(Object.keys(DEFAULT_SHIPPING_RULES.methods.courier)).toContain("default");
  });

  it("counts in Russian three ways, because a person reads this", () => {
    const f = ["страну", "страны", "стран"];
    expect(plural(1, f)).toBe("страну");
    expect(plural(2, f)).toBe("страны");
    expect(plural(5, f)).toBe("стран");
    expect(plural(11, f)).toBe("стран");
    expect(plural(21, f)).toBe("страну");
    expect(plural(22, f)).toBe("страны");
  });
});

describe("the committed sample is the documented shape and nothing more", () => {
  const sample = JSON.parse(
    readFileSync(fileURLToPath(new URL("../tools/lib/delivery-pricing.sample.json", import.meta.url)), "utf8"),
  );

  it("marks itself as invented, in the file itself", () => {
    /* The file outlives the run that printed it and can be opened by anyone.
       If it ever stops saying this, somebody will read it as a price list. */
    expect(sample._comment).toMatch(/ОБРАЗЕЦ/);
    expect(sample._comment).toMatch(/НЕ настоящие цены/);
  });

  it("every response in it parses as a documented one", () => {
    for (const [country, byBand] of Object.entries(sample.responses) as Array<[string, Record<string, unknown>]>) {
      for (const [band, body] of Object.entries(byBand)) {
        const parsed = parseRatesResponse(body, { country });
        expect(parsed.destination, `${country} band ${band}`).toBe(country);
        expect(parsed.chargeable, `${country} band ${band}`).not.toBeNull();
        /* Its problems are only the deliberate rate-0 case, never a shape bug. */
        for (const p of parsed.problems) expect(p, `${country} band ${band}`).toMatch(/rate = 0/);
      }
    }
  });

  it("exercises a hole, a zero rate and a subtype split, or it proves nothing", () => {
    const gr = parseRatesResponse(sample.responses.GR["0"], { country: "GR" });
    expect(gr.problems.join(" ")).toMatch(/rate = 0/); // a zero rate
    expect(basisFor("GR", "locker", gr.rows)).toBeNull(); // a hole: no locker in Greece
    const ee = parseRatesResponse(sample.responses.EE["0"], { country: "EE" });
    const dpd = ee.rows.filter((r: { carrier: string }) => r.carrier === "dpd");
    const locker = dpd.find((r: { kind: string }) => r.kind === "locker");
    const shop = dpd.find((r: { kind: string }) => r.kind === "parcelShop");
    expect(locker.rate).not.toBe(shop.rate); // a subtype split
  });
});

describe("it refuses to run without keys, and has nothing to fall back to", () => {
  it("stops with a non-zero exit and prints no prices", () => {
    let code = 0;
    let output = "";
    try {
      output = execFileSync(process.execPath, [CLI], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, MONTONIO_ACCESS_KEY: "", MONTONIO_SECRET_KEY: "" },
        timeout: 30_000,
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      code = e.status ?? 1;
      output = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    }
    expect(code).toBe(2);
    expect(output).toMatch(/ОСТАНОВ/);
    expect(output).toMatch(/MONTONIO_ACCESS_KEY/);
    /* No table, no euro figure, nothing that could be mistaken for an answer. */
    expect(output).not.toMatch(/\d+[.,]\d\d\s*€/);
  }, 40_000);

  it("never reaches for the undocumented endpoint, in either file", () => {
    /* This is the failure being corrected, not a style preference.
       contract-prices answers one subtype-blind `pickupPoint` price where
       Montonio has three, so a quiet fallback to it would produce plausible
       numbers that may be the parcel-shop tier charged for a locker — and
       nothing downstream could tell. tools/fetch-montonio-tariffs.mjs may
       keep using it; this tool may not. */
    /* Naming it in the refusal message is the point — he is told exactly which
       endpoint the old numbers came from and why this one will not use it. So
       the assertion is about URLs the process could actually fetch, not about
       the word appearing. */
    for (const [name, src] of [["tools/delivery-pricing.mjs", CLI_SRC], ["tools/lib/delivery-pricing.mjs", LIB_SRC]] as const) {
      const urls = src.match(/https?:\/\/[^\s"'`)]+/g) ?? [];
      expect(urls.filter((u) => /contract-prices|shipping-calculator/.test(u)), name).toEqual([]);
    }
    /* Exactly one fetch, at the documented authenticated endpoint. */
    const fetched = CLI_SRC.match(/fetch\(([^)]*)/g) ?? [];
    expect(fetched).toHaveLength(1);
    expect(fetched[0]).toContain("/shipping-methods/rates");
    expect(CLI_SRC).toMatch(/authorization.*Bearer/i);
  });

  it("tells apart the three reasons a grid comes back empty", () => {
    /* All three end with «no prices» and they send a person to three different
       screens. On the one morning there is no hour to spare, a confident wrong
       diagnosis costs more than no diagnosis. */
    const asked = 125;
    const keys = emptyGridDiagnosis({ failures: [{ why: "HTTP 401 unauthorized" }], asked, env: "live", base: "https://x" });
    expect(keys.cause).toBe("keys");
    expect(keys.text).toMatch(/НЕ «перевозчики не включены»/);

    const net = emptyGridDiagnosis({ failures: [{ why: "fetch failed ETIMEDOUT" }], asked, env: "live", base: "https://x" });
    expect(net.cause).toBe("network");
    expect(net.text).toMatch(/похоже на\nсеть/);

    /* A rate limit reads like a network failure and is not one: nothing is
       misconfigured, the run was simply too greedy. */
    const slow = emptyGridDiagnosis({ failures: [{ why: "HTTP 429 Too Many Requests" }], asked, env: "live", base: "https://x" });
    expect(slow.cause).toBe("throttled");
    expect(slow.text).toMatch(/--countries/);

    /* Only THIS one may send him to the Shipping tab — it is the case where
       Montonio answered politely and had nothing to sell. */
    const carriers = emptyGridDiagnosis({ failures: [], asked, env: "live", base: "https://x" });
    expect(carriers.cause).toBe("carriers");
    expect(carriers.text).toMatch(/partner\.montonio\.com/);
    expect(keys.text).not.toMatch(/partner\.montonio\.com/);
    /* And none of them says or implies zero. */
    for (const d of [keys, net, carriers]) expect(d.text).toMatch(/ОСТАНОВ/);
  });

  it("--dry-run works without keys and stamps every screen", () => {
    /* --out into the OS temp dir: a test must not leave a report behind in
       output/, where somebody could open it later and read invented prices. */
    const report = path.join(mkdtempSync(path.join(tmpdir(), "rempire-pricing-")), "sample.md");
    const out = execFileSync(process.execPath, [CLI, "--dry-run", "--countries", "EE", "--out", report], {
      encoding: "utf8",
      env: { ...process.env, MONTONIO_ACCESS_KEY: "", MONTONIO_SECRET_KEY: "" },
      timeout: 60_000,
    });
    /* The written file carries the stamp too — it outlives the terminal. */
    const written = readFileSync(report, "utf8");
    expect(written).toMatch(/ОБРАЗЕЦ/);
    expect(written).toMatch(/НЕ НАСТОЯЩИЕ ЦЕНЫ/);
    expect(out).toMatch(/ОБРАЗЕЦ/);
    expect(out).toMatch(/ВЫДУМАННЫЕ ЦИФРЫ/);
    /* It really does compute — a stamp on an empty run would prove nothing. */
    expect(out).toMatch(/Пакомат/);
    expect(out).toMatch(/\d+\.\d\d €/);
    /* …and the stamp is the last word too, because the tables are long. */
    expect(out.trimEnd().split("\n").slice(-3).join("\n")).toMatch(/ОБРАЗЕЦ/);
  }, 60_000);
});
