/**
 * The tariff layer between the raw Montonio rate quote and what the admin's
 * «Заполнить по тарифам Montonio» button writes into settings.shipping_rules
 * (src/lib/shipping/tariffs.ts): the static fallback table, live-vs-static
 * preference with a 24h cache, the markup formula and the .x9 rounding.
 *
 * computeShipping()/quoteFromRules() in src/lib/shipping.ts are untouched by
 * any of this — see tests/shipping.test.ts for those. Nothing here talks to a
 * database; a network call only happens when a test explicitly configures
 * Montonio keys.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import montonioTariffsData from "@/data/montonio-tariffs.json";
import {
  applyMarkup,
  cheapestCost,
  customerPrice,
  getMontonioTariff,
  MONTONIO_COUNTRIES,
  MONTONIO_NOT_SERVED,
  montonioServes,
  resetMontonioTariffCache,
  roundUpToX9,
  staticTariff,
  staticTariffsForCountry,
  suggestShippingRulesFromTariffs,
  tariffCountries,
} from "@/lib/shipping/tariffs";

const ACCESS = "test-access-key";
const SECRET = "test-secret-key-at-least-16-chars";

function withKeys() {
  process.env.MONTONIO_ACCESS_KEY = ACCESS;
  process.env.MONTONIO_SECRET_KEY = SECRET;
  process.env.MONTONIO_ENV = "sandbox";
}
function withoutKeys() {
  delete process.env.MONTONIO_ACCESS_KEY;
  delete process.env.MONTONIO_SECRET_KEY;
  delete process.env.MONTONIO_ENV;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Call = { url: string };
/** A fetch stub that answers every request the same way and counts calls. */
function stubFetch(handler: (url: string) => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push({ url });
      return handler(url);
    }),
  );
  return calls;
}

beforeEach(() => {
  resetMontonioTariffCache();
  withoutKeys();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetMontonioTariffCache();
  withoutKeys();
});

describe("roundUpToX9", () => {
  it("rounds up to the next price ending in 9 cents", () => {
    expect(roundUpToX9(4.5)).toBe(4.59);
    expect(roundUpToX9(5.9)).toBe(5.99);
    expect(roundUpToX9(10)).toBe(10.09);
    expect(roundUpToX9(10.78)).toBe(10.79);
  });

  it("leaves a price already ending in 9 cents alone", () => {
    expect(roundUpToX9(4.49)).toBe(4.49);
    expect(roundUpToX9(9.99)).toBe(9.99);
    expect(roundUpToX9(11.79)).toBe(11.79);
  });

  it("never rounds down — the output never sells below the input", () => {
    for (const n of [0.01, 1, 2.5, 3.333, 7.77, 12.01, 99.98]) {
      expect(roundUpToX9(n)).toBeGreaterThanOrEqual(n - 1e-9);
    }
  });

  it("treats zero and negative numbers as free, not as a price to round up", () => {
    expect(roundUpToX9(0)).toBe(0);
    expect(roundUpToX9(-5)).toBe(0);
  });
});

describe("applyMarkup", () => {
  it("defaults to no markup at all", () => {
    expect(applyMarkup(5.47)).toBe(5.47);
    expect(applyMarkup(5.47, {})).toBe(5.47);
  });

  it("applies percent, then a flat fixed amount on top", () => {
    expect(applyMarkup(5.47, { percent: 10, fixed: 0.5 })).toBe(6.52);
    expect(applyMarkup(10, { percent: 20 })).toBe(12);
  });

  it("ignores a negative markup rather than discounting the tariff", () => {
    expect(applyMarkup(10, { percent: -50, fixed: -5 })).toBe(10);
  });
});

describe("customerPrice", () => {
  it("is the marked-up tariff, rounded up to .x9", () => {
    expect(customerPrice(5.47)).toBe(5.49);
    expect(customerPrice(5.47, { percent: 10, fixed: 0.5 })).toBe(6.59);
  });

  it("never prices a delivery below its own marked-up tariff", () => {
    for (const tariff of [4.5, 5.46, 8.62, 18.6, 26.04]) {
      expect(customerPrice(tariff)).toBeGreaterThanOrEqual(tariff);
    }
  });
});

describe("the static fallback table (src/data/montonio-tariffs.json)", () => {
  it("answers a known carrier/country/method with Montonio's own contract price", () => {
    const q = staticTariff("omniva", "ee", "parcel");
    expect(q).not.toBeNull();
    expect(q!.price).toBe(3.1); // 2.50 € ex VAT + 24 %
    expect(q!.currency).toBe("EUR");
    expect(q!.source).toBe("static");
    expect(q!.country).toBe("EE"); // uppercased regardless of input case
  });

  it("is null where Montonio quotes nothing", () => {
    expect(staticTariff("venipak", "EE", "parcel")).toBeNull(); // direct contract only, no Montonio price
    expect(staticTariff("omniva", "FI", "parcel")).toBeNull(); // Omniva runs no FI machines
    expect(staticTariff("omniva", "DE", "parcel")).toBeNull(); // Omniva does not leave the Baltics
    expect(staticTariff("dpd", "GB", "parcel")).toBeNull(); // Montonio serves no UK route at all
  });

  it("never has a tariff for pickup — self-collection has no carrier", () => {
    expect(staticTariff("omniva", "EE", "pickup")).toBeNull();
  });

  it("carries what Montonio charges for the return leg, where it prices one", () => {
    // «Same pricing applies to return parcels» — Omniva by Montonio,
    // help.montonio.com/en/articles/143643. The outbound and the return are
    // the same number wherever Montonio prices both.
    const omniva = staticTariff("omniva", "EE", "parcel")!;
    expect(omniva.returnPrice).toBe(omniva.price);
    // …and null where it prices no return: SmartPosti's returns run through
    // the carrier's own self-service, so Montonio's table has no figure.
    expect(staticTariff("smartpost", "FI", "parcel")!.returnPrice).toBeNull();
  });

  it("knows which destinations the checkout offers that Montonio cannot serve", () => {
    // app.js EUROPE_ISO offers all seven; contract-prices answers HTTP 400
    // `contract_prices_no_applicable_tier` for every carrier and both methods.
    expect([...MONTONIO_NOT_SERVED].sort()).toEqual(["CH", "CY", "GB", "IS", "LI", "MT", "NO"]);
    expect(montonioServes("DE")).toBe(true);
    expect(montonioServes("gb")).toBe(false); // case-insensitive
    expect(montonioServes("NO")).toBe(false);
  });

  it("lists every sourced row for a country in one call", () => {
    const rows = staticTariffsForCountry("EE");
    const wanted = montonioTariffsData.rates.filter((r) => r.country === "EE").length;
    expect(rows).toHaveLength(wanted);
    expect(rows.every((r) => r.source === "static")).toBe(true);
  });
});

describe("getMontonioTariff — live preferred, static as the fallback", () => {
  it("goes straight to the static table when Montonio is not configured", async () => {
    const calls = stubFetch(() => json({ carriers: [] }));
    const q = await getMontonioTariff("omniva", "EE", "parcel");
    expect(q?.source).toBe("static");
    expect(q?.price).toBe(3.1);
    expect(calls).toHaveLength(0); // never even asked
  });

  it("prefers a live quote over the static table when Montonio answers", async () => {
    withKeys();
    stubFetch((url) => {
      expect(url).toContain("/shipping-methods/rates");
      return json({
        destination: "EE",
        carriers: [
          {
            carrierCode: "omniva",
            shippingMethods: [
              { type: "pickupPoint", subtypes: [{ code: "parcelMachine", rate: "2.50", currency: "EUR" }] },
            ],
          },
        ],
      });
    });
    const q = await getMontonioTariff("omniva", "EE", "parcel");
    expect(q?.source).toBe("live");
    expect(q?.price).toBe(2.5);
  });

  it("falls back to the static row for a carrier the live answer said nothing about", async () => {
    withKeys();
    stubFetch(() => json({ destination: "EE", carriers: [] })); // configured, answered, but empty
    const q = await getMontonioTariff("omniva", "EE", "parcel");
    expect(q?.source).toBe("static");
    expect(q?.price).toBe(3.1);
  });

  it("returns null for pickup — there is no carrier tariff for self-collection", async () => {
    expect(await getMontonioTariff("omniva", "EE", "pickup")).toBeNull();
  });

  it("caches the live answer — one request per country, not one per carrier/method lookup", async () => {
    withKeys();
    const calls = stubFetch(() => json({ destination: "EE", carriers: [] }));
    await getMontonioTariff("omniva", "EE", "parcel");
    await getMontonioTariff("dpd", "EE", "courier");
    await getMontonioTariff("smartpost", "EE", "parcel");
    expect(calls).toHaveLength(1);
  });

  it("refetches once the cache is reset, and again once 24h have passed", async () => {
    withKeys();
    const calls = stubFetch(() => json({ destination: "EE", carriers: [] }));
    await getMontonioTariff("omniva", "EE", "parcel");
    expect(calls).toHaveLength(1);

    resetMontonioTariffCache();
    await getMontonioTariff("omniva", "EE", "parcel");
    expect(calls).toHaveLength(2);

    vi.useFakeTimers({ now: Date.now() });
    vi.advanceTimersByTime(23 * 60 * 60 * 1000);
    await getMontonioTariff("omniva", "EE", "parcel");
    expect(calls).toHaveLength(2); // 23h — still fresh

    vi.advanceTimersByTime(2 * 60 * 60 * 1000); // total 25h
    await getMontonioTariff("omniva", "EE", "parcel");
    expect(calls).toHaveLength(3); // stale — refetched
  });
});

describe("suggestShippingRulesFromTariffs — what the admin's fill button applies", () => {
  it("prices the four carrier-choice countries to the priciest carrier the shopper can pick", async () => {
    const patch = await suggestShippingRulesFromTariffs();
    // EE parcel: highest of unisend 2.47 / smartpost 2.54 / dpd 2.59 /
    // omniva 3.10 -> Omniva's 3.10 -> .x9. Nova Post's 2.33 is not in the
    // running: the shop has no carrier row for it and never names it.
    expect(patch.methods.parcel?.EE).toBe(3.19);
    // A courier has no chips anywhere, home included — Renat picks it, so the
    // basis is the cheapest he can pick: DPD/Omniva 6.82, not SmartPosti 7.38.
    expect(patch.methods.courier?.EE).toBe(6.89);
    // LT parcel ceiling is DPD's 5.58
    expect(patch.methods.parcel?.LT).toBe(5.59);
  });

  it("also fills each carrier's own price, cheaper than the ceiling when that carrier is cheaper", async () => {
    const patch = await suggestShippingRulesFromTariffs();
    expect(patch.carriers.dpd?.EE).toBe(2.59); // DPD's own parcel price, below the 3.19 ceiling
    expect(patch.carriers.omniva?.LT).toBe(4.99);
  });

  it("never writes a courier price under a carrier — checkout never tags a carrier on a courier order", async () => {
    const patch = await suggestShippingRulesFromTariffs();
    // SmartPosti has an EE courier tariff (7.38), but carriers.smartpost.EE must be its
    // PARCEL price (2.54 -> 2.59), because src/lib/shipping.ts's carrier override applies
    // regardless of method and the storefront only ever sends a carrier for "parcel".
    expect(patch.carriers.smartpost?.EE).toBe(2.59);
  });

  it("applies the markup before rounding to .x9", async () => {
    // omniva LT 4.96 -> +10% +0.50 = 5.956 -> rounded 5.96 -> next .x9 is 5.99
    const patch = await suggestShippingRulesFromTariffs({ percent: 10, fixed: 0.5 });
    expect(patch.carriers.omniva?.LT).toBe(5.99);
  });

  it("prices each European country on its own, instead of one number for all of them", async () => {
    const patch = await suggestShippingRulesFromTariffs();
    // Poland's parcel machine and Croatia's are the same box on the same
    // shelf; charging one price for both is what the «EU» cell used to do.
    expect(patch.methods.parcel?.PL).toBe(17.89); // dpd 17.86, the only carrier the shop can use
    expect(patch.methods.parcel?.HR).toBe(59.59); // dpd 59.52 — the dearest route Montonio sells
    // Outside the four carrier-choice countries Renat picks the carrier, so
    // the price covers the cheapest he can pick: SmartPosti 22.23, not DPD's
    // 32.74 — and not Nova Post's 12.91, which the shop cannot use at all.
    expect(patch.methods.courier?.DE).toBe(22.29);
    expect(patch.methods.courier?.FR).toBe(24.19); // smartpost 24.19, against dpd 44.64
    // Greece has no parcel machine at all from Estonia, only a courier.
    expect(patch.methods.parcel?.GR).toBeUndefined();
    expect(patch.methods.courier?.GR).toBe(43.19);
  });

  /* The one thing that must never happen: a European shelf price under the
     cheapest carrier the shop could actually put the parcel on. */
  it("never prices a European country below the cheapest carrier the shop can use", async () => {
    const patch = await suggestShippingRulesFromTariffs();
    for (const country of MONTONIO_COUNTRIES) {
      for (const method of ["parcel", "courier"] as const) {
        const cost = cheapestCost(country, method);
        const price = patch.methods[method]?.[country];
        if (!cost) {
          expect(price).toBeUndefined();
          continue;
        }
        expect(price).toBeGreaterThanOrEqual(cost.price);
      }
    }
  });

  /* Hungary and Romania have a Nova Post parcel machine and nothing else, so
     the shop has no parcel price for them — better a missing cell than a
     price for a parcel it cannot send. */
  it("writes no cell where the only carrier is one the shop cannot use", async () => {
    const patch = await suggestShippingRulesFromTariffs();
    expect(patch.methods.parcel?.HU).toBeUndefined();
    expect(patch.methods.parcel?.RO).toBeUndefined();
    expect(patch.methods.courier?.HU).toBe(27.39); // smartpost 27.33
  });

  it("names a carrier only for the four countries the checkout lets one be picked in", async () => {
    const patch = await suggestShippingRulesFromTariffs();
    expect(Object.keys(patch.carriers.dpd ?? {}).sort()).toEqual(["EE", "FI", "LT", "LV"]);
  });

  it("leaves what Montonio quotes nothing for untouched — no Venipak, no EU or 'default' row", async () => {
    const patch = await suggestShippingRulesFromTariffs();
    expect(patch.carriers.venipak).toBeUndefined(); // direct contract only
    // The «EU» cell now only covers the seven countries Montonio serves not at
    // all, and no tariff can be invented for a parcel that cannot be sent.
    expect(patch.methods.parcel?.EU).toBeUndefined();
    expect(patch.methods.parcel?.default).toBeUndefined();
    expect(patch.methods.pickup).toBeUndefined();
    for (const c of MONTONIO_NOT_SERVED) {
      expect(patch.methods.parcel?.[c]).toBeUndefined();
      expect(patch.methods.courier?.[c]).toBeUndefined();
    }
  });

  it("covers every destination the table has a price for and no other", async () => {
    const patch = await suggestShippingRulesFromTariffs();
    const filled = new Set([
      ...Object.keys(patch.methods.parcel ?? {}),
      ...Object.keys(patch.methods.courier ?? {}),
    ]);
    expect([...filled].sort()).toEqual(tariffCountries());
  });
});
