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
import { cleanBankFilter, filterBanks } from "@/lib/payments/methods";

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

/* ---------- «Слишком много банков» — settings.payment_banks ---------------- */

describe("cleanBankFilter — what the owner is allowed to store", () => {
  it("uppercases, de-duplicates and keeps Montonio's own order", () => {
    expect(cleanBankFilter(["lhvbee22", "HABAEE2X", "LHVBEE22"])).toEqual(["LHVBEE22", "HABAEE2X"]);
  });

  it("anything that is not a list of codes means «показывать все»", () => {
    expect(cleanBankFilter(null)).toEqual([]);
    expect(cleanBankFilter("HABAEE2X")).toEqual([]);
    expect(cleanBankFilter({ HABAEE2X: true })).toEqual([]);
    expect(cleanBankFilter([])).toEqual([]);
  });

  it("drops junk entries rather than the whole setting", () => {
    expect(cleanBankFilter(["HABAEE2X", "", 7, null, "a code with spaces", "x".repeat(40)])).toEqual([
      "HABAEE2X",
    ]);
  });

  it("stops at forty codes — a настройка, not a paste of the internet", () => {
    const many = Array.from({ length: 60 }, (_, i) => `BANK${i}`);
    expect(cleanBankFilter(many)).toHaveLength(40);
  });
});

describe("filterBanks — the same chips, fewer of them", () => {
  it("keeps only the named Estonian banks", () => {
    const out = filterBanks(LIST, ["HABAEE2X", "LHVBEE22"]);
    expect(out.filter((b) => b.country === "EE").map((b) => b.code)).toEqual([
      "HABAEE2X",
      "LHVBEE22",
    ]);
  });

  it("leaves a country nobody named exactly as it was — a parcel to Riga still gets Latvian banks", () => {
    const out = filterBanks(LIST, ["HABAEE2X"]);
    expect(out.filter((b) => b.country === "LV").map((b) => b.code)).toEqual([
      "HABALV22",
      "UNLALV2X",
    ]);
    expect(out.filter((b) => b.country === "LT").map((b) => b.code)).toEqual(["CBVILT2X"]);
  });

  it("an empty setting, or codes Montonio does not have, change nothing", () => {
    expect(filterBanks(LIST, [])).toEqual(LIST);
    expect(filterBanks(LIST, ["NOSUCHBANK"])).toEqual(LIST);
  });

  it("matches codes case-insensitively — the setting is stored uppercase, Montonio's list may not be", () => {
    const mixed = [{ code: "habaee2x", name: "Swedbank", country: "EE", logoUrl: "" }];
    expect(filterBanks(mixed, ["HABAEE2X"])).toEqual(mixed);
  });

  it("never leaves the checkout with no chip at all", () => {
    expect(filterBanks(LIST, ["NOPE"]).length).toBe(LIST.length);
    expect(filterBanks([], ["HABAEE2X"])).toEqual([]);
  });
});
