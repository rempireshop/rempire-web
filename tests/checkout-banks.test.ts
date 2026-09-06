/**
 * Which bank chips the checkout offers once Montonio's real list has arrived.
 *
 * `GET /stores/payment-methods` lists the banks of every country the store has
 * switched on (src/lib/payments/methods.ts flattens EE, LV, LT, FI, PL into one
 * array with a `country` on each). The checkout used to draw that whole array
 * as chips, and `selectedBankCode()` indexed into it — an Estonian shopper with
 * a Latvian store setup would have seen Swedbank LV next to Swedbank EE and
 * could have sent the wrong BIC as `preferredProvider`.
 *
 * Same technique as tests/checkout-parity.test.ts: the two functions are sliced
 * out of public/shop2/app.js by source text and run against stubs, so this
 * tests the shop's own code rather than a retyped copy of it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

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

type Bank = { code: string; name: string; country: string; logoUrl: string };

const LIST: Bank[] = [
  { code: "HABAEE2X", name: "Swedbank", country: "EE", logoUrl: "" },
  { code: "EEUHEE2X", name: "SEB", country: "EE", logoUrl: "" },
  { code: "LHVBEE22", name: "LHV", country: "EE", logoUrl: "" },
  { code: "HABALV22", name: "Swedbank", country: "LV", logoUrl: "" },
  { code: "UNLALV2X", name: "SEB", country: "LV", logoUrl: "" },
  { code: "CBVILT2X", name: "Swedbank", country: "LT", logoUrl: "" },
];

function run(banks: Bank[] | null, country: string, iso: string, bankIndex: number) {
  const body = `
    ${slice("banksForCountry")}
    ${slice("selectedBankCode")}
    var PAYMETHODS = { banks: BANKS_IN };
    var S = { country: COUNTRY, countryIso: ISO, bank: BANK_INDEX };
    var BANKS = ["Swedbank", "SEB", "LHV", "Luminor", "Coop"];
    var BANK_CODES = { Swedbank: "HABAEE2X", SEB: "EEUHEE2X", LHV: "LHVBEE22", Luminor: "RIKOEE22", Coop: "EKRDEE22" };
    function orderCountry() { return S.country === "EU" ? (S.countryIso || "EU") : S.country; }
    return { banks: banksForCountry(), code: selectedBankCode() };
  `;
  const fn = new Function("BANKS_IN", "COUNTRY", "ISO", "BANK_INDEX", body) as (
    b: Bank[] | null,
    c: string,
    i: string,
    n: number,
  ) => { banks: Bank[] | null; code: string | undefined };
  return fn(banks, country, iso, bankIndex);
}

describe("the bank chips follow the delivery country", () => {
  it("an Estonian order sees Estonian banks only, and the chip index maps onto them", () => {
    const out = run(LIST, "EE", "", 2);
    expect(out.banks?.map((b) => b.code)).toEqual(["HABAEE2X", "EEUHEE2X", "LHVBEE22"]);
    expect(out.code).toBe("LHVBEE22");
  });

  it("a Latvian order sees Latvian banks, so index 0 is Swedbank LV, not Swedbank EE", () => {
    const out = run(LIST, "LV", "", 0);
    expect(out.banks?.map((b) => b.code)).toEqual(["HABALV22", "UNLALV2X"]);
    expect(out.code).toBe("HABALV22");
  });

  it("a country with no banks in the list gets the whole list, as before", () => {
    const out = run(LIST, "EU", "DE", 0);
    expect(out.banks?.length).toBe(LIST.length);
    expect(out.code).toBe("HABAEE2X");
  });

  it("a chip picked in a longer list does not fall off a shorter one", () => {
    // LHV was chip 2 for Estonia; Lithuania has one bank — never `undefined`
    const out = run(LIST, "LT", "", 2);
    expect(out.banks?.map((b) => b.code)).toEqual(["CBVILT2X"]);
    expect(out.code).toBe("CBVILT2X");
  });

  it("with no real list the five built-in names and their BICs stand in", () => {
    const out = run(null, "EE", "", 3);
    expect(out.banks).toBeNull();
    expect(out.code).toBe("RIKOEE22");
  });
});
