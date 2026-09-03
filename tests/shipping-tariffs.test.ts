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
  customerPrice,
  getMontonioTariff,
  resetMontonioTariffCache,
  roundUpToX9,
  staticTariff,
  staticTariffsForCountry,
  suggestShippingRulesFromTariffs,
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
  it("answers a known carrier/country/method with the sourced price", () => {
    const q = staticTariff("omniva", "ee", "parcel");
    expect(q).not.toBeNull();
    expect(q!.price).toBe(5.46);
    expect(q!.currency).toBe("EUR");
    expect(q!.source).toBe("static");
    expect(q!.country).toBe("EE"); // uppercased regardless of input case
  });

  it("is null for a combination nobody sourced yet", () => {
    expect(staticTariff("venipak", "EE", "parcel")).toBeNull(); // no price list found at all
    expect(staticTariff("omniva", "FI", "parcel")).toBeNull(); // Omniva runs no FI machines
    expect(staticTariff("omniva", "DE", "parcel")).toBeNull(); // country never researched
  });

  it("never has a tariff for pickup — self-collection has no carrier", () => {
    expect(staticTariff("omniva", "EE", "pickup")).toBeNull();
  });

  it("flags the one DPD Finland figure the source PDF could not confirm", () => {
    expect(staticTariff("dpd", "FI", "parcel")!.uncertain).toBe(true);
    expect(staticTariff("dpd", "FI", "courier")!.uncertain).toBe(true);
    expect(staticTariff("dpd", "EE", "parcel")!.uncertain).toBeFalsy();
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
    expect(q?.price).toBe(5.46);
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
    expect(q?.price).toBe(5.46);
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
  it("prices every method/country to the priciest known carrier, so no carrier is sold below cost", async () => {
    const patch = await suggestShippingRulesFromTariffs();
    // EE parcel: highest of omniva 5.46 / smartpost 5.47 / dpd 4.50 -> smartpost's 5.47 -> .x9
    expect(patch.methods.parcel?.EE).toBe(5.49);
    // EE courier: highest of dpd 10.78 / smartpost 10.84 -> smartpost's 10.84 -> .x9
    expect(patch.methods.courier?.EE).toBe(10.89);
    // LT parcel ceiling (omniva 11.79) was already ending in 9 cents
    expect(patch.methods.parcel?.LT).toBe(11.79);
  });

  it("also fills each carrier's own price, cheaper than the ceiling when that carrier is cheaper", async () => {
    const patch = await suggestShippingRulesFromTariffs();
    expect(patch.carriers.dpd?.EE).toBe(4.59); // DPD's own parcel price, below the 5.49 ceiling
    expect(patch.carriers.omniva?.LT).toBe(11.79);
  });

  it("never writes a courier price under a carrier — checkout never tags a carrier on a courier order", async () => {
    const patch = await suggestShippingRulesFromTariffs();
    // SmartPosti has a sourced EE courier tariff (10.84), but carriers.smartpost.EE must be its
    // PARCEL price (5.47 -> 5.49), because src/lib/shipping.ts's carrier override applies
    // regardless of method and the storefront only ever sends a carrier for "parcel".
    expect(patch.carriers.smartpost?.EE).toBe(5.49);
  });

  it("applies the markup before rounding to .x9", async () => {
    // omniva LT 11.79 -> +10% +0.50 = 13.469 -> rounded 13.47 -> next .x9 is 13.49
    const patch = await suggestShippingRulesFromTariffs({ percent: 10, fixed: 0.5 });
    expect(patch.carriers.omniva?.LT).toBe(13.49);
  });

  it("leaves what it has no sourced tariff for untouched — no Venipak, Unisend, EU or 'default' row", async () => {
    const patch = await suggestShippingRulesFromTariffs();
    expect(patch.carriers.venipak).toBeUndefined();
    expect(patch.carriers.unisend).toBeUndefined();
    expect(patch.methods.parcel?.EU).toBeUndefined();
    expect(patch.methods.parcel?.default).toBeUndefined();
    expect(patch.methods.pickup).toBeUndefined();
  });
});
