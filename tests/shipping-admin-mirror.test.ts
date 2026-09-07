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
  costBasis,
  MONTONIO_COUNTRIES,
  MONTONIO_NOT_SERVED,
} from "@/lib/shipping/country-prices";

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
