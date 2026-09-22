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
   * · **novapost, outside EE/LV/LT** — Montonio International Shipping. It is
   *   the cheapest locker on every one of these routes, often half of DPD, and
   *   it has no returns at all. Montonio, 22.09.2026, advises against it in
   *   the Baltics specifically, where the locker networks are already dense.
   *   Дим, 22.09.2026: offer it outside the Baltics and tell the customer in
   *   the terms that the return is on them. **Not yet built** — when it is,
   *   these nine lines go.
   *
   * · **smartpost in LV and LT** — SmartPosti has lockers in both (3.95 € ex
   *   VAT against DPD's 4.50), and the shop has never shown them. No decision
   *   was ever recorded against it; it looks like an oversight rather than a
   *   choice.
   *
   * · **novapost is present in EE/LV/LT today** and, by the same 22.09.2026
   *   decision, is due to come OFF that list. Until it does it stays here as
   *   an offered chip, not an omission.
   */
  const KNOWN_OMISSIONS = [
    "AT/novaPost", "CZ/novaPost", "DE/novaPost", "ES/novaPost",
    "IT/novaPost", "PL/novaPost", "SK/novaPost",
    "LT/smartpost", "LV/smartpost",
  ].sort();
  /* Hungary and Romania are not here: they have no chip row at all, which the
     next test covers. Omitting a carrier from a country the shop does not draw
     is not an omission, it is the same decision counted twice. */

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

  it("lists HU and RO as countries with no chips at all", () => {
    /* Nova Post is the only carrier Montonio prices a locker with in either —
       DPD's Hungarian lockers are not in its list, and its Romanian ones are
       listed but quote nothing. Excluding Nova Post therefore leaves nothing
       to show, which is why neither country has a row in CARRIERS_BY_COUNTRY.
       Both gain a locker the day Nova Post goes on outside the Baltics. */
    expect(chips.HU).toBeUndefined();
    expect(chips.RO).toBeUndefined();
    expect(carriersFor("pickupPoint", "HU")).toEqual(["novaPost"]);
    expect(carriersFor("pickupPoint", "RO")).toEqual(["novaPost"]);
  });

  it("has no locker route to Greece at all", () => {
    expect(carriersFor("pickupPoint", "GR")).toEqual([]);
    expect(chips.GR).toBeUndefined();
  });
});
