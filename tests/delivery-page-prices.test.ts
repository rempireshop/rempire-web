/**
 * «Доставка и оплата» prints what the checkout charges.
 *
 * The prerendered shipping page (/policies/shipping-policy, /ru/…, /et/…)
 * showed EE 10,84 € and LV/LT 9,90 € for a courier on 09.10.2026 while the
 * checkout and the bill charged Montonio's price — 6,89–7,39 € in Estonia,
 * 8,09–11,19 € in Latvia and Lithuania. The page is drawn by the shop's own
 * deliveryPageHTML(); what was wrong was the table the BUILD handed it: a merge
 * of the owner's stored row over the defaults of a shop with no row, whose
 * courier column holds those three home numbers. Since then the build takes
 * the shop's own path — tools/lib/delivery-lift.mjs, liveRules(): the row
 * laid over the Montonio-priced base, as setShipRules() does in the browser
 * and parseShippingRules() on the server.
 *
 * So this renders the page's price table exactly as the prerender does —
 * the same lift, the same function, the same arguments — and holds every
 * courier and locker cell of the four countries with a row of their own to
 * quoteFromRules() on the server, carrier by carrier, for the stored row the
 * shop runs on and for a shop with no row at all.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseShippingRules, quoteFromRules } from "@/lib/shipping";
import { offeredCarriers } from "@/lib/shipping/country-prices";
import { esc } from "@/lib/seo-head.mjs";
import { liftDelivery } from "../tools/lib/delivery-lift.mjs";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const D = liftDelivery(read("../public/shop2/app.js"));

/* settings.shipping_rules as the panel stores it on 09.10.2026: the owner's
   two thresholds and no price cell at all — «пустое поле — цена Montonio». */
const LIVE_ROW = {
  freeFrom: 70,
  freeFromByCountry: { FI: 200, EU: 200 },
  methods: { parcel: {}, courier: {}, pickup: {} },
  carriers: {},
  countriesOff: ["CH", "CY", "GB", "IS", "LI", "MT", "NO"],
  pickupOff: [],
};

/** «6,89 €» — the page's Russian money, eurFor() in the prerender. */
const eurRU = (n: number) => (Math.round(n * 100) / 100).toFixed(2).replace(".", ",").replace(",00", "") + " €";
const text = (h: string) => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/** The price table, as the prerender writes it into the Russian page: country → [locker, courier, free from]. */
function pageTable(raw: unknown): Record<string, [string, string, string]> {
  const html = D.page({
    lang: "RU", tr: (s: string) => s, esc, eur: eurRU, title: "Доставка и оплата",
    rules: D.liveRules(raw), carriers: D.carriers, carrierNames: D.carrierNames, rows: D.rows, montonio: D.montonio,
    tableOnly: true,
  }) as string;
  const out: Record<string, [string, string, string]> = {};
  const rows = D.rows as Array<[string, string, string]>;
  for (const [cc, name] of rows) {
    const at = html.indexOf("<span>" + name + "</span>");
    expect(at, name).toBeGreaterThan(-1);
    const tr = html.slice(at, html.indexOf("</tr>", at));
    const cells = [...tr.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
    out[cc] = [cells[0], cells[1], cells[2]];
  }
  return out;
}

/** What the till charges, on the server: every carrier offered for that method and country. */
function billed(raw: unknown, cc: string, method: "parcel" | "courier"): string {
  const rules = parseShippingRules(raw);
  const prices = [...new Set(offeredCarriers(cc, method).map((carrier) =>
    quoteFromRules(rules, { country: cc, method, carrier, subtotal: 0 }).price))];
  expect(prices.length, `${cc} ${method}`).toBeGreaterThan(0);
  return prices.length === 1 ? eurRU(prices[0]) : "от " + eurRU(Math.min(...prices));
}

describe("the shipping page's prices are the checkout's", () => {
  const COUNTRIES = ["EE", "LV", "LT", "FI"];

  it("with the row the shop runs on: the courier at Montonio's price, not the defaults' 10,84 / 9,90", () => {
    const page = pageTable(LIVE_ROW);
    for (const cc of COUNTRIES) {
      expect(page[cc][1], `${cc} courier`).toBe(billed(LIVE_ROW, cc, "courier"));
      expect(page[cc][0], `${cc} locker`).toBe(billed(LIVE_ROW, cc, "parcel"));
    }
    expect(page.EE[1]).toBe("от 6,89 €");
    expect(page.LV[1]).toBe("от 8,09 €");
    expect(page.LT[1]).toBe("от 8,09 €");
    for (const cc of ["EE", "LV", "LT"]) expect(page[cc][1]).not.toMatch(/10,84|9,90/);
    // …and the free-delivery column is the owner's, from the same row
    expect(page.EE[2]).toBe("70 €");
    expect(page.FI[2]).toBe("200 €");
  });

  it("with a courier price the owner typed himself, that price, on both sides", () => {
    const row = { ...LIVE_ROW, methods: { parcel: {}, courier: { EE: 9.5 }, pickup: {} } };
    const page = pageTable(row);
    expect(page.EE[1]).toBe("9,50 €");
    expect(page.EE[1]).toBe(billed(row, "EE", "courier"));
  });

  it("with no row at all, the defaults a shop with no row bills from — on both sides", () => {
    const page = pageTable(null);
    for (const cc of COUNTRIES) expect(page[cc][1], `${cc} courier`).toBe(billed(null, cc, "courier"));
    expect(page.EE[1]).toBe("10,84 €");
  });

  it("is what the prerender actually runs", () => {
    const tool = read("../tools/prerender-shop2.mjs");
    expect(tool).toContain("DELIVERY = liftDelivery(appSrc);");
    expect(tool).toContain("const SHIP_RULES_LIVE = DELIVERY ? DELIVERY.liveRules(LIVE_SETTINGS.shipping_rules) : null;");
    expect(tool).not.toContain("mergeShipRules");
  });
});
