/**
 * tools/montonio-live-check.mjs — the read-only look at the live Montonio
 * account. Its network half can only run with the live keys; everything it
 * concludes goes through the pure functions below, fed here with the shapes
 * Montonio documents.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { accountRoutes, compareRoutes, paymentSummary, shopOffer, webhookSummary } from "../tools/montonio-live-check.mjs";

const appJs = readFileSync(path.join(process.cwd(), "public", "shop2", "app.js"), "utf8");

describe("the checkout's offer, read out of app.js", () => {
  const offer = shopOffer(appJs);

  it("has lockers and couriers per country, and never the «EU» zone", () => {
    expect(offer.parcel.EE).toContain("omniva");
    expect(offer.courier.DE).toContain("dpd");
    expect(offer.parcel.EU).toBeUndefined();
  });

  it("offers no Nova Post in the Baltics, by either method", () => {
    for (const cc of ["EE", "LV", "LT"]) {
      expect(offer.parcel[cc]).not.toContain("novapost");
      expect(offer.courier[cc]).not.toContain("novapost");
    }
  });
});

describe("routes the shop offers against routes the account can book", () => {
  const body = {
    countries: [
      {
        countryCode: "EE",
        carriers: [
          { carrierCode: "omniva", shippingMethods: [{ type: "pickupPoint" }, { type: "courier" }] },
          { carrierCode: "unisend", shippingMethods: [{ type: "pickupPoint" }] },
        ],
      },
      { countryCode: "PL", carriers: [{ carrierCode: "novaPost", shippingMethods: [{ type: "pickupPoint" }] }] },
    ],
  };

  it("reads Montonio's novaPost as the shop's novapost", () => {
    const routes = accountRoutes(body) as { parcel: Record<string, Set<string>> };
    expect([...routes.parcel.PL]).toEqual(["novapost"]);
  });

  it("names every offered route the account lacks, and lists the unused ones apart", () => {
    const offer = {
      parcel: { EE: ["omniva", "unisend", "dpd"], PL: ["novapost"] },
      courier: { EE: ["omniva", "smartpost"] },
    };
    expect(compareRoutes(offer, accountRoutes(body))).toEqual({
      missing: ["courier EE smartpost", "parcel EE dpd"],
      unused: [],
    });
    expect(compareRoutes({ parcel: { EE: ["omniva"] }, courier: {} }, accountRoutes(body)).unused).toEqual([
      "courier EE omniva",
      "parcel EE unisend",
      "parcel PL novapost",
    ]);
  });
});

describe("payment methods, after the checkout's EUR-only rule", () => {
  it("lists what is on and hides a zloty-only bank the way mapBanks() does", () => {
    const p = paymentSummary({
      paymentMethods: {
        cardPayments: {},
        paymentInitiation: {
          setup: {
            EE: { paymentMethods: [{ code: "HABAEE2X" }] },
            PL: { supportedCurrencies: ["EUR", "PLN"], paymentMethods: [{ code: "PKO", supportedCurrencies: ["PLN"] }] },
          },
        },
      },
    });
    expect(p.enabled).toEqual(["cardPayments", "paymentInitiation"]);
    expect(p.banks).toEqual({ EE: ["HABAEE2X"] });
    expect(p.dropped).toEqual(["PL PKO"]);
  });
});

describe("the parcel webhook", () => {
  const url = "https://rempireshop.diipsolutions.eu/api/shipping/notify/";

  it("finds ours and names the events it lacks", () => {
    const w = webhookSummary(
      { data: [{ url, enabledEvents: ["shipment.statusUpdated"] }] },
      url,
    );
    expect(w.ours).toBe(true);
    expect(w.missingEvents).toEqual(["shipment.registered", "shipment.registrationFailed"]);
    expect(w.slashMissing).toBe(false);
  });

  it("matches without the slash but says the slash is missing — a 308 loses the POST", () => {
    const w = webhookSummary({ data: [{ url: url.replace(/\/$/, ""), enabledEvents: [] }] }, url);
    expect(w.ours).toBe(true);
    expect(w.slashMissing).toBe(true);
  });

  it("an empty list is «not registered»", () => {
    expect(webhookSummary({ data: [] }, url).ours).toBe(false);
  });
});
