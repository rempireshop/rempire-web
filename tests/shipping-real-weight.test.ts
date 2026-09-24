/**
 * Montonio prices a parcel by its REAL weight — the answer of 24.09.2026.
 *
 * «Important to know is that our pricing for time being takes into account
 * real weight. If that will change, then we'd let them know.» (Montonio
 * support to Dim; the divisor 4000 exists in their `VolumetricWeightHelper`
 * but is not applied to the price.)
 *
 * Until that day the shop assumed `chargeableWeight = max(actual, volumetric)`
 * and acted on it in one place that costs money: the weight it DECLARED on
 * `POST /shipments` was the volumetric weight of whatever box was on the card.
 * For the default carton that is 0.9 kg, which happens to sit in the same
 * ≤ 1 kg tier as an ordinary parcel's real weight — but «Другая коробка»
 * 40 × 30 × 20 declared 6 kg, and on a real-weight tariff 6 kg is the 6 kg
 * tier, paid for a parcel that weighs one.
 *
 * What is pinned here:
 *   · the switch exists, is off, and is the ONE place the volumetric rule can
 *     come back from (`MONTONIO_PRICES_VOLUMETRIC`);
 *   · with it off, the weight a price is looked up at is the real weight —
 *     a light parcel in the default carton, or in a big one, lands in the
 *     tier the mirror row was quoted for;
 *   · the declared weight no longer follows the box;
 *   · the panel's copy of that arithmetic says the same number.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import tariffs from "@/data/montonio-tariffs.json";
import {
  MONTONIO_PRICES_VOLUMETRIC,
  ORDINARY_PARCEL_KG,
  PARCEL_DEFAULTS,
  chargeableKg,
  declaredWeightKg,
  volumetricKg,
} from "@/lib/shipping/parcel";
import { REFERENCE_PARCEL } from "@/lib/shipping/tariffs";

const app = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(
  /\r\n/g,
  "\n",
);

type Row = {
  carrier: string;
  country: string;
  method: string;
  pricingStrategy: string;
  size: string | null;
  maxWeightKg: number | null;
};
const ROWS = (tariffs as unknown as { rates: Row[] }).rates;

/** A carton «Другая коробка» might carry: 6 kg of volume, one kilo of goods. */
const BIG_BOX = { length: 40, width: 30, height: 20 };

/** Does a parcel of `kg` fall inside the weight tier this mirror row was quoted for? */
function insideQuotedTier(row: Row, kg: number): boolean {
  if (row.pricingStrategy !== "weightBased") return true; // flat or a box category: weight is not the key
  return row.maxWeightKg != null && kg <= row.maxWeightKg;
}

describe("Montonio prices real weight (answer of 24.09.2026)", () => {
  it("keeps the volumetric rule behind one switch, and the switch is off", () => {
    expect(MONTONIO_PRICES_VOLUMETRIC).toBe(false);
    // the divisor Montonio confirmed is still what volumetricKg() uses
    expect(volumetricKg({ length: 20, width: 15, height: 10 })).toBe(0.75);
    expect(volumetricKg(BIG_BOX)).toBe(6);
  });

  it("prices a light parcel in the default carton on its real weight, not the carton's volume", () => {
    // 0.4 kg of goods in 25 × 18 × 8 (0.9 kg of volume): the price looks up 0.4
    expect(chargeableKg(0.4, PARCEL_DEFAULTS)).toBe(0.4);
    // …and a kilo in a 6-kg-of-volume box is still a kilo
    expect(chargeableKg(1, BIG_BOX)).toBe(1);
  });

  it("lands every weight-priced route in the tier the mirror was quoted for", () => {
    const weightRows = ROWS.filter((r) => r.pricingStrategy === "weightBased");
    expect(weightRows.length).toBeGreaterThan(50);
    const outside: string[] = [];
    for (const row of weightRows) {
      for (const [kg, box, label] of [
        [0.4, PARCEL_DEFAULTS, "0.4 kg in the default carton"],
        [0.9, PARCEL_DEFAULTS, "0.9 kg in the default carton"],
        [0.6, BIG_BOX, "0.6 kg in a 40 × 30 × 20 box"],
      ] as const) {
        if (!insideQuotedTier(row, chargeableKg(kg, box))) {
          outside.push(`${row.carrier} ${row.method} ${row.country}: ${label}`);
        }
      }
    }
    /* Under max(actual, volumetric) the big box would be 6 kg and fall out of
       every ≤ 1 kg row — a shelf price quoted for one tier, a bill in another. */
    expect(outside).toEqual([]);
  });

  it("quotes the mirror at the weight a label declares — the real one", () => {
    expect(ORDINARY_PARCEL_KG).toBe(0.9);
    expect(REFERENCE_PARCEL.weightKg).toBe(ORDINARY_PARCEL_KG);
    expect((tariffs as unknown as { referenceParcel: { weightKg: number } }).referenceParcel.weightKg).toBe(
      ORDINARY_PARCEL_KG,
    );
  });

  it("declares the ordinary parcel's weight whatever box is on the card", () => {
    expect(declaredWeightKg(PARCEL_DEFAULTS)).toBe(0.9);
    // was volumetricKg(BIG_BOX) = 6 kg until 24.09.2026 — the 6 kg tier on a real-weight tariff
    expect(declaredWeightKg(BIG_BOX)).toBe(0.9);
    expect(declaredWeightKg({ length: 10, width: 10, height: 5 })).toBe(0.9);
  });
});

describe("the panel's copy of the declared weight", () => {
  function lift<T>(name: string): T {
    const at = app.indexOf(`var ${name} = `);
    expect(at, `public/shop2/app.js no longer has var ${name}`).toBeGreaterThan(-1);
    const end = app.indexOf(";\n", at);
    return new Function(`${app.slice(at, end)}; return ${name};`)() as T;
  }
  function fn(name: string): string {
    const at = app.indexOf(`function ${name}(`);
    expect(at, `public/shop2/app.js no longer has ${name}()`).toBeGreaterThan(-1);
    return app.slice(at, app.indexOf("\n", at));
  }

  it("has the same switch, in the same position", () => {
    expect(lift<boolean>("PARCEL_PRICES_VOLUMETRIC")).toBe(MONTONIO_PRICES_VOLUMETRIC);
    expect(lift<number>("PARCEL_ORDINARY_KG")).toBe(ORDINARY_PARCEL_KG);
  });

  it("prints the weight the label will declare, for any box", () => {
    const mirror = new Function(
      `var PARCEL_PRICES_VOLUMETRIC = ${JSON.stringify(MONTONIO_PRICES_VOLUMETRIC)};
       var PARCEL_ORDINARY_KG = ${JSON.stringify(ORDINARY_PARCEL_KG)};
       ${fn("parcelVolKg")}
       ${fn("parcelDeclaredKg")}
       return parcelDeclaredKg;`,
    )() as (b: { length: number; width: number; height: number }) => number;
    for (const box of [PARCEL_DEFAULTS, BIG_BOX, { length: 1, width: 1, height: 1 }, { length: 200, width: 200, height: 200 }]) {
      expect(mirror(box), `${box.length}×${box.width}×${box.height}`).toBe(declaredWeightKg(box));
    }
  });
});
