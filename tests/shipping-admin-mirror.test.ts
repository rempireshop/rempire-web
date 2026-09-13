/**
 * The admin panel is a static bundle: it cannot import src/lib, so it carries
 * its own copy of what a delivery costs (MONTONIO_COST) and of which countries
 * exist in the table at all. Twenty-five countries is far past what anyone
 * keeps in step by eye, and the number the panel prints beside a price is the
 * one thing that tells Renat he is about to lose money — a stale copy is worse
 * than no copy.
 *
 * So the literals are read back out of public/shop2/app.js and compared with
 * src/data/montonio-tariffs.json through the same costBasis() the server uses.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CARRIER_CHOICE_COUNTRIES,
  carrierCost,
  carrierPriceTable,
  costBasis,
  MONTONIO_COUNTRIES,
  MONTONIO_NOT_SERVED,
} from "@/lib/shipping/country-prices";
import { DEFAULT_SHIPPING_RULES } from "@/lib/shipping";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

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

type CostRow = Partial<Record<"parcel" | "courier", [number, string]>>;

describe("the admin's copy of what a delivery costs", () => {
  const cost = literal<Record<string, CostRow>>("MONTONIO_COST");

  it("covers exactly the countries the tariff table prices", () => {
    expect(Object.keys(cost).sort()).toEqual([...MONTONIO_COUNTRIES]);
  });

  it("holds the same price and the same carrier as the server computes", () => {
    for (const country of MONTONIO_COUNTRIES) {
      for (const method of ["parcel", "courier"] as const) {
        const basis = costBasis(country, method);
        const mirrored = cost[country]?.[method];
        if (!basis) {
          expect([country, method, mirrored]).toEqual([country, method, undefined]);
          continue;
        }
        expect([country, method, mirrored]).toEqual([country, method, [basis.price, basis.carrier]]);
      }
    }
  });

  /* The rule the whole table turns on, restated as an assertion so a future
     edit to either side has to mean it. */
  it("takes the dearest carrier only for a parcel machine where the shopper picks one", () => {
    expect(cost.EE.parcel).toEqual([3.1, "omniva"]); // dearest — chips under «Пакомат»
    expect(cost.EE.courier).toEqual([6.82, "dpd"]); // cheapest — no chips for a courier
    expect(cost.DE.courier).toEqual([22.23, "smartpost"]); // cheapest the shop can use
  });

  it("never quotes Nova Post, which the shop cannot put a parcel on", () => {
    for (const row of Object.values(cost)) {
      for (const cell of Object.values(row)) expect(cell[1]).not.toBe("novapost");
    }
  });
});

/**
 * Ренат, 13.09.2026: «we get prices from Montonio and we should use those, we
 * do not need to make them up.»
 *
 * The storefront carries its own copy of the default rules (SHIP_RULES) so it
 * can price a basket before /api/overrides answers, and since 13.09.2026 those
 * defaults hold one price per carrier rather than one per country. If this copy
 * and DEFAULT_SHIPPING_RULES ever disagree, the summary the shopper watches
 * stops being the total the server bills — which is the whole reason both exist
 * in the same shape.
 */
describe("the storefront's copy of the default carrier prices", () => {
  const rules = literal<{ carriers: Record<string, Record<string, number>> }>("SHIP_RULES");

  it("is the same table the server computes from the tariff mirror", () => {
    expect(rules.carriers).toEqual(DEFAULT_SHIPPING_RULES.carriers);
    expect(rules.carriers).toEqual(carrierPriceTable());
  });

  it("prices a parcel machine per carrier, which is how Montonio bills it", () => {
    // the pair that started this: one Finnish price for two different costs
    expect(rules.carriers.dpd.FI).toBe(12.39);
    expect(rules.carriers.smartpost.FI).toBe(9.39);
    expect(rules.carriers.dpd.FI).not.toBe(rules.carriers.smartpost.FI);
  });

  it("covers only the four countries whose checkout lets the shopper pick", () => {
    for (const [carrier, row] of Object.entries(rules.carriers)) {
      for (const country of Object.keys(row)) {
        expect(CARRIER_CHOICE_COUNTRIES, `${carrier}/${country}`).toContain(country);
      }
    }
  });

  it("never sells a carrier below what that carrier costs", () => {
    for (const [carrier, row] of Object.entries(rules.carriers)) {
      for (const [country, price] of Object.entries(row)) {
        const cost = carrierCost(carrier, country, "parcel");
        expect(cost, `${carrier}/${country}`).not.toBeNull();
        expect(price, `${carrier}/${country}`).toBeGreaterThanOrEqual(cost!);
      }
    }
  });

  it("has no Nova Post row at all", () => {
    expect(Object.keys(rules.carriers)).not.toContain("novapost");
  });
});

describe("the admin's country lists", () => {
  const euRows = literal<string[]>("SHIP_EU_COUNTRIES");
  const unserved = literal<string[]>("SHIP_UNSERVED");

  it("folds out every served country that has no row of its own", () => {
    const named = new Set(CARRIER_CHOICE_COUNTRIES);
    expect(euRows).toEqual(MONTONIO_COUNTRIES.filter((c) => !named.has(c)));
    expect(euRows).toHaveLength(21);
  });

  it("lists exactly the seven Montonio cannot reach", () => {
    expect([...unserved].sort()).toEqual([...MONTONIO_NOT_SERVED].sort());
    expect(unserved).toHaveLength(7);
  });

  it("keeps the two lists apart — a country is priced or unreachable, never both", () => {
    for (const c of unserved) expect(euRows).not.toContain(c);
  });
});

describe("the storefront's country dropdown", () => {
  /* EUROPE_ISO is what «Другая страна Европы» offers. It has to be a superset
     of both lists, or a country the admin can price is one no shopper can pick. */
  const europeIso = literal<string[]>("EUROPE_ISO");

  it("offers every European country the admin knows about", () => {
    for (const c of literal<string[]>("SHIP_EU_COUNTRIES")) expect(europeIso).toContain(c);
    for (const c of literal<string[]>("SHIP_UNSERVED")) expect(europeIso).toContain(c);
  });
});
