/**
 * The admin panel is a static bundle: it cannot import src/lib, so it carries
 * its own copy of what an empty box charges (MONTONIO_PRICE) and of which
 * countries exist in the table at all. Twenty-five countries is far past what anyone
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
  methodPrice,
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

/**
 * Since 14.09.2026 the panel carries ONE mirror instead of two, and it holds
 * prices rather than costs: MONTONIO_PRICE is what the shop charges when a box
 * is left empty. That is the only number worth printing under a box, because
 * it is the one the till bills and the one the save guard refuses to go under
 * — the old pair (`MONTONIO_TARIFFS`, `MONTONIO_COST`) printed a rawer number
 * nobody could ever be charged.
 */
describe("the admin's copy of what an empty box charges", () => {
  const price = literal<{
    carriers: Record<string, Record<string, number>>;
    courier: Record<string, [number, string]>;
  }>("MONTONIO_PRICE");

  it("holds exactly the carrier table the server computes", () => {
    expect(price.carriers).toEqual(carrierPriceTable());
  });

  it("covers exactly the countries the tariff table prices a courier for", () => {
    expect(Object.keys(price.courier).sort()).toEqual([...MONTONIO_COUNTRIES]);
  });

  it("holds the same courier price and the same carrier as the server computes", () => {
    for (const country of MONTONIO_COUNTRIES) {
      const basis = costBasis(country, "courier");
      expect([country, price.courier[country]])
        .toEqual([country, [methodPrice(country, "courier"), basis!.carrier]]);
    }
  });

  /* The rule the whole table turns on, restated as an assertion so a future
     edit to either side has to mean it. */
  it("takes the dearest carrier only for a parcel machine, where the shopper picks one", () => {
    // dearest — the chips under «Пакомат»: Omniva at 3.10 is the one to cover
    expect(price.carriers.omniva.EE).toBe(3.19);
    expect(price.courier.EE).toEqual([6.89, "dpd"]); // cheapest — no chips for a courier
    expect(price.courier.DE).toEqual([22.29, "smartpost"]); // cheapest the shop can use
  });

  it("never quotes Nova Post, which the shop cannot put a parcel on", () => {
    for (const cell of Object.values(price.courier)) expect(cell[1]).not.toBe("novapost");
    expect(Object.keys(price.carriers)).not.toContain("novapost");
  });

  it("never charges less than the carrier costs", () => {
    for (const [carrier, row] of Object.entries(price.carriers)) {
      for (const [country, p] of Object.entries(row)) {
        expect(p, `${carrier}/${country}`).toBeGreaterThanOrEqual(carrierCost(carrier, country, "parcel")!);
      }
    }
    for (const [country, cell] of Object.entries(price.courier)) {
      expect(cell[0], country).toBeGreaterThanOrEqual(costBasis(country, "courier")!.price);
    }
  });
});

/**
 * The four carrier columns of the rate table. A column exists where Montonio
 * quotes that carrier a parcel price — which is exactly the set of cells
 * `carrierPriceTable()` fills, so the screen shows every cell the rules can
 * carry and no cell they cannot.
 */
describe("the rate table's carrier columns", () => {
  const cols = literal<[string, string][]>("SHIP_CARRIER_COLS");

  it("is every carrier Montonio prices a locker for, and only those", () => {
    expect(cols.map((c) => c[0]).sort()).toEqual(Object.keys(carrierPriceTable()).sort());
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
