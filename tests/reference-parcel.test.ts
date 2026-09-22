/**
 * The box the prices are quoted for is the box the shop posts.
 *
 * Two numbers describe a parcel in this repo, and for a week they described
 * two different parcels. `PARCEL_DEFAULTS` (src/lib/shipping/parcel.ts) is what
 * `POST /shipments` declares on every label. `REFERENCE_PARCEL` is what the
 * price table was quoted for — and it was a 30 cm cube at 5 kg. Outside the
 * Baltics Montonio prices by size, a 30 cm cube only fits DPD's biggest
 * drawer, and so the shop charged a Polish customer the L-tier price for a
 * parcel that goes through the XS door. Nobody lost money; everybody abroad
 * paid for cardboard they never received.
 *
 * Renat measured his carton on 22.09.2026: 25 × 18 × 8 cm. This file holds the
 * three places that carry it to each other, so the next change to the box moves
 * the price with it or fails here.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { declaredWeightKg, PARCEL_DEFAULTS } from "@/lib/shipping/parcel";
import { REFERENCE_PARCEL } from "@/lib/shipping/tariffs";
import { TIERS_DPD } from "../tools/lib/montonio-routes.mjs";

const tool = readFileSync(
  fileURLToPath(new URL("../tools/fetch-montonio-tariffs.mjs", import.meta.url)),
  "utf8",
);

/** The standalone script's own copy — it cannot import TypeScript. */
function toolReference() {
  const m = tool.match(
    /const REFERENCE_PARCEL = \{ length: ([\d.]+), width: ([\d.]+), height: ([\d.]+), weight: ([\d.]+) \};/,
  );
  expect(m, "tools/fetch-montonio-tariffs.mjs no longer states REFERENCE_PARCEL on one line").toBeTruthy();
  const [, length, width, height, weight] = m!.map(Number);
  return { length, width, height, weight };
}

describe("one box, three places", () => {
  it("the declared carton is Renat's, as he measured it", () => {
    expect([PARCEL_DEFAULTS.length, PARCEL_DEFAULTS.width, PARCEL_DEFAULTS.height]).toEqual([25, 18, 8]);
  });

  it("the server quotes the box it declares", () => {
    expect(REFERENCE_PARCEL).toEqual({
      lengthCm: PARCEL_DEFAULTS.length,
      widthCm: PARCEL_DEFAULTS.width,
      heightCm: PARCEL_DEFAULTS.height,
      weightKg: declaredWeightKg(PARCEL_DEFAULTS),
    });
  });

  it("the tariff script quotes the same box", () => {
    expect(toolReference()).toEqual({
      length: PARCEL_DEFAULTS.length,
      width: PARCEL_DEFAULTS.width,
      height: PARCEL_DEFAULTS.height,
      weight: declaredWeightKg(PARCEL_DEFAULTS),
    });
  });
});

describe("the panel knows the same box", () => {
  const app = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

  it("carries PARCEL_DEFAULTS in its own copy", () => {
    const m = app.match(/var PARCEL_DEFAULT = \{ length: ([\d.]+), width: ([\d.]+), height: ([\d.]+),/);
    expect(m, "PARCEL_DEFAULT has moved in public/shop2/app.js").toBeTruthy();
    expect(m!.slice(1, 4).map(Number)).toEqual([PARCEL_DEFAULTS.length, PARCEL_DEFAULTS.width, PARCEL_DEFAULTS.height]);
  });

  it("names that box in the warning it shows for a bigger one", () => {
    /* «Цены доставки за границу посчитаны для коробки 25 × 18 × 8 см» — the
       numbers are typed into the sentence so it stays one translatable text
       node, which means they can go stale. This is what stops that. */
    const box = `${PARCEL_DEFAULTS.length} × ${PARCEL_DEFAULTS.width} × ${PARCEL_DEFAULTS.height} см`;
    expect(app).toContain(`посчитаны для коробки ${box}.`);
    expect(app).toContain("function parcelBeyondPriced(p)");
  });
});

describe("what that box is, at DPD", () => {
  /* Sorted smallest-first, because a carton goes in whichever way round fits. */
  const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
  const carton = sorted([PARCEL_DEFAULTS.length, PARCEL_DEFAULTS.width, PARCEL_DEFAULTS.height]);
  const fits = (tier: readonly (string | number)[]) => {
    const [, l, w, h] = tier as [string, number, number, number];
    const door = sorted([l, w, h]);
    return carton.every((c, i) => c <= door[i]);
  };

  it("goes through the XS drawer — the cheapest one", () => {
    const xs = TIERS_DPD.find((t) => t[0] === "XS")!;
    expect(fits(xs), `a ${carton.join(" × ")} cm carton should fit DPD XS (8 × 18 × 61)`).toBe(true);
  });

  it("is at the limit on two sides, which is worth knowing", () => {
    /* 8 cm of height and 18 of width are exactly XS's maximum. A carton that
       bulges by half a centimetre is an S at the counter, so the rare bigger
       box is a small surcharge rather than a surprise — Renat's own trade,
       18.09.2026: «in edge cases maybe take a small loss». */
    expect(PARCEL_DEFAULTS.height).toBe(8);
    expect(PARCEL_DEFAULTS.width).toBe(18);
  });
});
