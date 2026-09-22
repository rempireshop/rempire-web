/**
 * The shop must not offer a carrier Montonio will not take the parcel to.
 *
 * `CARRIERS_BY_COUNTRY` in public/shop2/app.js is the row of chips under
 * «Пакомат». Every chip is a promise: pick this one and your order goes on
 * that carrier. If Montonio has no pickup-point contract for the pair, the
 * promise breaks at label time — after the customer has paid — and the owner
 * is left with an order he cannot post.
 *
 * `tools/lib/montonio-routes.mjs` is Montonio's own answer to which pairs
 * exist, lifted from their shipping calculator on 22.09.2026 and verified
 * against its screen. This file holds the chips to it, in both directions:
 * nothing offered that is not served, and nothing served quietly dropped
 * without a reason written down.
 *
 * The second direction is the one that matters for the next change. Sending
 * from Estonia, Montonio reaches more lockers than the shop offers, and every
 * omission below was a decision — so when the list changes, this test fails
 * and the decision gets made again rather than drifting.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ALL_COUNTRIES, CARRIERS, carriersFor, SHOP_CODE } from "../tools/lib/montonio-routes.mjs";

const app = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

/** The module is plain JS, so the one carrier whose wire code differs needs a shape here. */
const WIRE_TO_SHOP = SHOP_CODE as Record<string, string | undefined>;

/** The chip list, read out of the source rather than imported — app.js is a script, not a module. */
function chipsByCountry(): Record<string, string[]> {
  const start = app.indexOf("var CARRIERS_BY_COUNTRY = {");
  expect(start, "CARRIERS_BY_COUNTRY has moved or been renamed").toBeGreaterThan(-1);
  const end = app.indexOf("};", start);
  const block = app.slice(start, end);
  const out: Record<string, string[]> = {};
  for (const m of block.matchAll(/\b([A-Z]{2}):\s*\[([^\]]*)\]/g)) {
    out[m[1]] = [...m[2].matchAll(/"([a-z_]+)"/g)].map((c) => c[1]);
  }
  return out;
}

/** Montonio's spelling for a carrier the shop writes in lower case. */
function wireCode(shop: string): string {
  const found = Object.keys(CARRIERS).find((c) => (WIRE_TO_SHOP[c] ?? c) === shop);
  return found ?? shop;
}

const chips = chipsByCountry();

describe("the chips the shop shows", () => {
  it("names the countries we expect and nothing stray", () => {
    const keys = Object.keys(chips).filter((k) => k !== "EU");
    expect(keys.length).toBeGreaterThan(20);
    for (const cc of keys) {
      expect(ALL_COUNTRIES, `${cc} is not a country Montonio serves from Estonia`).toContain(cc);
    }
  });

  it("never offers a carrier Montonio will not take there", () => {
    const broken: string[] = [];
    for (const [cc, carriers] of Object.entries(chips)) {
      if (cc === "EU") continue;
      for (const shop of carriers) {
        if (!carriersFor("pickupPoint", cc).includes(wireCode(shop))) broken.push(`${cc}/${shop}`);
      }
    }
    expect(broken, "a chip that cannot be posted").toEqual([]);
  });

  it("never offers a carrier that only ships out of Poland or Latvia", () => {
    /* Inpost, Orlen and Latvian Post exist in Montonio's carrier list but only
       with PL or LV as the SOURCE. Venipak is «veel tulemas» and was removed
       on 14.09.2026. Any of them appearing here is a 400 at label time. */
    const forbidden = ["inpost", "orlen", "latvian_post", "venipak"];
    for (const [cc, carriers] of Object.entries(chips)) {
      for (const bad of forbidden) {
        expect(carriers, `${cc} offers ${bad}, which we cannot send from Estonia`).not.toContain(bad);
      }
    }
  });
});

describe("what Montonio serves and the shop does not", () => {
  /**
   * Every pair below is a deliberate omission, and the reason is here so the
   * next reader does not have to guess:
   *
   * · **novapost in EE, LV and LT** — Montonio International Shipping has no
   *   returns at all, and Montonio, 22.09.2026, advises against it in the
   *   Baltics specifically, where the locker networks are already dense.
   *   NO_NOVAPOST_COUNTRIES in src/lib/shipping/country-prices.ts.
   *
   * 22.09.2026 (owner's decision, Montonio-calculator carrier choice): the
   * list used to be the other way round — Nova Post offered in the Baltics
   * and omitted in AT CZ DE ES IT PL SK, SmartPosti omitted in LV and LT. The
   * delivery step was rebuilt that day to offer every carrier Montonio serves,
   * in Montonio's order, so Nova Post went on outside the Baltics (its card
   * says «без возврата», the terms say the return is the buyer's), came off
   * inside them, and SmartPosti's Latvian and Lithuanian lockers are shown.
   */
  const KNOWN_OMISSIONS = [
    "EE/novaPost", "LT/novaPost", "LV/novaPost",
  ].sort();
  /* Hungary and Romania are not here: since 22.09.2026 they have a chip row,
     Nova Post alone, which the next test covers. */

  it("omits exactly what we decided to omit", () => {
    const missing: string[] = [];
    for (const cc of ALL_COUNTRIES) {
      const offered = chips[cc];
      if (!offered) continue;   // a country with no chips at all is covered by pickupOff, not here
      for (const carrier of carriersFor("pickupPoint", cc)) {
        if (!offered.includes(WIRE_TO_SHOP[carrier] ?? carrier)) missing.push(`${cc}/${carrier}`);
      }
    }
    expect(missing.sort(), "a locker Montonio serves stopped being offered, or started").toEqual(KNOWN_OMISSIONS);
  });

  it("lists HU and RO with Nova Post as their only chip", () => {
    /* Nova Post is the only carrier Montonio prices a locker with in either —
       DPD's Hungarian lockers are not in its list, and its Romanian ones are
       listed but quote nothing. Until 22.09.2026 Nova Post was not offered
       outside the Baltics, so neither country had a row in
       CARRIERS_BY_COUNTRY; that day it went on (owner's decision,
       Montonio-calculator carrier choice) and both gained a locker. */
    expect(chips.HU).toEqual(["novapost"]);
    expect(chips.RO).toEqual(["novapost"]);
    expect(carriersFor("pickupPoint", "HU")).toEqual(["novaPost"]);
    expect(carriersFor("pickupPoint", "RO")).toEqual(["novaPost"]);
  });

  it("has no locker route to Greece at all", () => {
    expect(carriersFor("pickupPoint", "GR")).toEqual([]);
    expect(chips.GR).toBeUndefined();
  });
});
