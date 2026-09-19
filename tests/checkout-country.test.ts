/**
 * Which country the storefront is actually talking about.
 *
 * The checkout holds the country in TWO variables: `S.country` is the zone —
 * one of five, «EU» standing for a continent — and `S.countryIso` is the real
 * country behind «Другая страна Европы». Every carrier list is keyed by the
 * real one, and for a long time every reader passed the zone. The result was
 * that Ренат opened every country DPD serves on 18.09.2026, the server began
 * allowing those lockers, and the shop went on offering eighteen countries the
 * courier and nothing else — because `CARRIERS_BY_COUNTRY.EU` is empty.
 *
 * Dim found it on 19.09.2026, from the account rather than the checkout: «it
 * seems that other countries do still have only courier available if we
 * already discovered that it's possible to deliver to parcel lockers or
 * pick-up points as well (like Italy)». The live points API answers 12 048 DPD
 * points for Italy on the shop's own keys, so nothing was missing but the
 * question the storefront asked itself.
 *
 * These are the storefront's own functions, sliced out of public/shop2/app.js
 * by source text and run against stubs — retyping them would test this file
 * instead of the shop. The server half is imported for real, so the two
 * answers are compared and not merely asserted.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_SHIPPING_RULES, pickupOffered, quoteFromRules, shippingZone, type ShippingRules } from "@/lib/shipping";
import { PICKUP_POINT_COUNTRIES } from "@/lib/shipping/country-prices";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

/** Cut `function <name>(…) { … }` out of app.js by brace matching. */
function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

/** Read a `var <name> = <literal>;` out of app.js and evaluate it. */
function literal<T>(name: string): T {
  const at = src.indexOf(`var ${name} = `);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  const open = at + `var ${name} = `.length;
  const closer = src[open] === "{" ? "}" : "]";
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{" || src[i] === "[") depth++;
    else if (src[i] === "}" || src[i] === "]") {
      if (--depth === 0) {
        if (src[i] !== closer) throw new Error(`unbalanced literal for ${name}`);
        return new Function(`return ${src.slice(open, i + 1)};`)() as T;
      }
    }
  }
  throw new Error(`unterminated literal for ${name}`);
}

const CARRIERS_BY_COUNTRY = literal<Record<string, string[]>>("CARRIERS_BY_COUNTRY");

type Shop = {
  iso: string;
  zone: string;
  methods: string[];
  carriers: string[];
  parcelPrice: number;
  courierPrice: number;
};

/**
 * The storefront, asked what it would offer a shopper in this country.
 *
 * `country` is the zone select and `countryIso` the second one, exactly as the
 * two live in S. `rules` is what the owner has saved.
 */
function shop(country: string, countryIso = "", rules: ShippingRules = DEFAULT_SHIPPING_RULES, carrier = "dpd"): Shop {
  const body = `
    ${slice("orderCountry")}
    ${slice("shipZoneOf")}
    ${slice("pickupOpen")}
    ${slice("carriersFor")}
    ${slice("deliveryFor")}
    ${slice("shipRulePrice")}
    return {
      iso: orderCountry(),
      zone: shipZoneOf(orderCountry()),
      methods: deliveryFor(orderCountry()).map(function (d) { return d.k; }),
      carriers: carriersFor(),
      parcelPrice: shipRulePrice("parcel", CARRIER),
      courierPrice: shipRulePrice("courier", "")
    };
  `;
  // The body is this repository's own source plus fixed stub text — no input
  // of any kind is interpolated into it.
  const run = new Function(
    "S", "COUNTRIES", "EUROPE_ISO", "CARRIERS_BY_COUNTRY", "DELIVERY", "SHIP_RULES", "POINTS", "MONTONIO_PRICE", "CARRIER",
    body,
  ) as (...args: unknown[]) => Shop;
  return run(
    { country, countryIso, ship: { carrier: "" } },
    literal<Array<[string, string]>>("COUNTRIES"),
    literal<string[]>("EUROPE_ISO"),
    CARRIERS_BY_COUNTRY,
    literal<Array<{ k: string; l: string }>>("DELIVERY"),
    rules,
    { empty: {} },
    literal<unknown>("MONTONIO_PRICE"),
    carrier,
  );
}

describe("the country the storefront asks about is the real one, not the zone", () => {
  it("offers Italy its locker, because the server does", () => {
    const it = shop("EU", "IT");
    expect(it.iso).toBe("IT");
    expect(it.methods).toContain("parcel");
    expect(it.carriers).toEqual(["dpd"]);
    // …and the server agrees, which is the point of importing it
    expect(pickupOffered(DEFAULT_SHIPPING_RULES, "IT")).toBe(true);
  });

  it("offers the courier alone until the second select is answered", () => {
    /* «Другая страна Европы» and nothing else is not a country: there is no
       carrier list behind «EU», and a chip with nothing behind it is worse
       than no chip. */
    const eu = shop("EU", "");
    expect(eu.iso).toBe("EU");
    expect(eu.methods).toEqual(["courier"]);
    expect(eu.carriers).toEqual([]);
  });

  it("still knows the counter is in Tallinn and nowhere else", () => {
    expect(shop("EE").methods).toContain("pickup");
    expect(shop("LV").methods).not.toContain("pickup");
    expect(shop("EU", "IT").methods).not.toContain("pickup");
  });

  it("answers the same as the server for every country either of them knows", () => {
    const countries = new Set([...PICKUP_POINT_COUNTRIES, ...Object.keys(CARRIERS_BY_COUNTRY)]);
    countries.delete("EU");   // the zone is not a country on either side
    const disagree: string[] = [];
    for (const cc of countries) {
      const zone = shippingZone(cc);
      const offers = shop(zone === "default" ? cc : zone, zone === "EU" ? cc : "").methods.includes("parcel");
      if (offers !== pickupOffered(DEFAULT_SHIPPING_RULES, cc)) disagree.push(cc);
    }
    expect(disagree, "the shop and the server must offer a locker in the same countries").toEqual([]);
  });

  /* The functions above are right when they are handed the real country. The
     bug was never inside them — it was in what the CALLERS handed over, and
     no stub can see a caller. So the source itself is read: the zone may be
     asked about prices, where it is the second lookup step, and nowhere else. */
  it("never asks the zone which carriers a country has", () => {
    const bad: string[] = [];
    for (const call of ["deliveryFor(S.country)", "pickupOpen(S.country)", "carriersFor(S.country)",
      "CARRIERS_BY_COUNTRY[S.country]", 'loadPointsFor(all[i])', '":" + S.country']) {
      if (src.includes(call)) bad.push(call);
    }
    expect(
      bad,
      "S.country is the zone — «EU» for a continent — and a carrier list is keyed by the real country. " +
        "Use orderCountry(), or pass the country the screen is drawing for.",
    ).toEqual([]);
  });

  it("switches a country off on both sides at once", () => {
    const off: ShippingRules = { ...DEFAULT_SHIPPING_RULES, pickupOff: ["IT"] };
    expect(shop("EU", "IT", off).methods).not.toContain("parcel");
    expect(pickupOffered(off, "IT")).toBe(false);
  });

  it("mirrors shippingZone() for every country the second select offers", () => {
    for (const cc of [...literal<string[]>("EUROPE_ISO"), "EE", "LV", "LT", "FI", "EU", "US"]) {
      expect(shop(cc === "EE" || cc === "LV" || cc === "LT" || cc === "FI" || cc === "EU" ? cc : "EU", cc).zone, cc)
        .toBe(shippingZone(cc));
    }
  });
});

describe("the price beside a method is the price the server bills", () => {
  /* The account screen's «Доставка по умолчанию» holds a country of its own,
     and it prices its rows through the same shipRulePrice() with that country
     passed in. Before 19.09.2026 it passed nothing, so a Latvian preference
     was labelled with Latvian rows and priced with Estonian numbers: «If I
     choose in my account another country - I get one price. If I go to
     checkout … the price changes» (Dim). */
  for (const cc of ["IT", "PL", "SE", "DE", "LV", "FI"]) {
    it(`${cc}: the parcel and the courier both match quoteFromRules()`, () => {
      const s = shop(shippingZone(cc) === "EU" ? "EU" : cc, shippingZone(cc) === "EU" ? cc : "");
      const parcel = quoteFromRules(DEFAULT_SHIPPING_RULES, { country: cc, method: "parcel", carrier: "dpd", subtotal: 0 });
      const courier = quoteFromRules(DEFAULT_SHIPPING_RULES, { country: cc, method: "courier", subtotal: 0 });
      expect(s.parcelPrice, `${cc} parcel`).toBe(parcel.price);
      expect(s.courierPrice, `${cc} courier`).toBe(courier.price);
    });
  }

  it("prices the account's own country, not the checkout's", () => {
    /* The call the account makes: the same function, with the country named.
       Without the argument this is the Estonian number, which is exactly the
       bug — so the two are compared here rather than one of them asserted. */
    const body = `${slice("orderCountry")}${slice("shipZoneOf")}${slice("shipRulePrice")}
      return { asked: shipRulePrice("courier", "", "LV"), ambient: shipRulePrice("courier", "") };`;
    const run = new Function("S", "COUNTRIES", "EUROPE_ISO", "SHIP_RULES", "MONTONIO_PRICE", body) as (
      ...args: unknown[]
    ) => { asked: number; ambient: number };
    const out = run(
      { country: "EE", countryIso: "" },
      literal<Array<[string, string]>>("COUNTRIES"),
      literal<string[]>("EUROPE_ISO"),
      DEFAULT_SHIPPING_RULES,
      literal<unknown>("MONTONIO_PRICE"),
    );
    expect(out.asked).toBe(quoteFromRules(DEFAULT_SHIPPING_RULES, { country: "LV", method: "courier", subtotal: 0 }).price);
    expect(out.ambient).toBe(quoteFromRules(DEFAULT_SHIPPING_RULES, { country: "EE", method: "courier", subtotal: 0 }).price);
    expect(out.asked, "Latvia and Estonia are not the same price — the fixture would prove nothing").not.toBe(out.ambient);
  });
});
