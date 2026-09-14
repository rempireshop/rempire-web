/**
 * The tariff layer between the raw Montonio rate quote and a shelf price
 * (src/lib/shipping/tariffs.ts): the static fallback table, live-vs-static
 * preference with a 24h cache, and the .x9 rounding.
 *
 * `suggestShippingRulesFromTariffs()` and `applyMarkup()` were tested here
 * until 14.09.2026. Both were the server half of «Заполнить по тарифам
 * Montonio», a button whose numbers have been the default since an empty cell
 * started meaning «цена Montonio» — so they wrote what was already there, and
 * the markup they added on the way never reached a bill. Ренат: «it seems to
 * me that this delivery is a bit over engineered.»
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

describe("customerPrice", () => {
  it("is the tariff rounded up to .x9, and nothing else", () => {
    expect(customerPrice(5.47)).toBe(5.49);
    expect(customerPrice(3.1)).toBe(3.19);
  });

  it("never prices a delivery below its own tariff", () => {
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

describe("tariffCountries", () => {
  /* What /api/admin/shipping/rates/ will answer for: every destination the
     static table prices. A request for anything else is refused, so the panel
     cannot ask Montonio about a route nothing sells. */
  it("is every destination the mirror prices, sorted", () => {
    expect(tariffCountries()).toEqual([...MONTONIO_COUNTRIES]);
    expect(tariffCountries()).toHaveLength(25);
  });
});
