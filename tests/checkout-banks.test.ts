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

  /* Ренат, 13.09.2026: «For Denmark, the list of "bank link" is very large.
     Seems like almost all are suggested.» Montonio's pay-by-bank covers EE,
     LV, LT, FI and PL — the keys of `paymentInitiation.setup`, the only place
     a bank's country is named — and a country that is not one of them used to
     be shown the whole cross-country array. A Dane was offered every Estonian,
     Latvian, Lithuanian, Finnish and Polish bank, and whichever chip he tapped
     travelled to Montonio as `preferredProvider`: a bank he has no account
     with. No chips and no `preferredProvider` is the honest answer — Montonio
     asks on its own page, which is the only place that knows what Denmark
     really has. */
  it("a country Montonio has no bank links for gets no chips and no preferred bank", () => {
    const out = run(LIST, "EU", "DK", 0);
    expect(out.banks).toEqual([]);
    expect(out.code).toBe("");
  });

  it("still narrows to a country that IS in the list, whichever way it was picked", () => {
    // Poland arrives through «Другая страна Европы» + the ISO select
    const pl = [...LIST, { code: "PKOPPLPW", name: "PKO", country: "PL", logoUrl: "" }];
    const out = run(pl, "EU", "PL", 0);
    expect(out.banks?.map((b) => b.code)).toEqual(["PKOPPLPW"]);
    expect(out.code).toBe("PKOPPLPW");
  });

  it("shows the whole list while no country has been picked yet", () => {
    // «Другая страна Европы» chosen, the second select still empty: nothing is
    // known, so nothing is narrowed — and the built-in fallback is not used
    const out = run(LIST, "EU", "", 0);
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

/* ---------- the panel's own switches must agree with that rule ------------ */

/**
 * Ренат, 13.09.2026: «I can switch off all in Estonia and also I can switch of
 * some, but they are still displayed in checkout.»
 *
 * He could, and they were. The server's rule is **per country** — filterBanks()
 * above gives a country whose banks are all switched off its whole group back,
 * so an owner trimming the Estonian list cannot take every Latvian bank away
 * from a shopper in Riga. The panel did not know about it: its own guard was
 * «нельзя выключить все» counted across every country at once, which fires only
 * when the very last switch in the whole list goes off. Five Estonian switches
 * could therefore read «off» while the checkout drew all five.
 *
 * admBankLastOn() is the panel enforcing the same rule the server does, and
 * these run it against filterBanks() so the two can never drift apart again.
 */
function panel(list: Bank[]) {
  const body = `
    ${slice("admBankToggle")}
    ${slice("admBankOn")}
    ${slice("admBankCountry")}
    ${slice("admBankLastOn")}
    var PAYMETHODS = { all: LIST_IN, banks: LIST_IN };
    var S = { banksLoaded: [] };
    function bankFilter() { return Array.isArray(S.banksLoaded) ? S.banksLoaded : []; }
    function admBankList() { return (PAYMETHODS.all || PAYMETHODS.banks || []); }
    return {
      /** One thumb on one switch: refused, or the new stored filter. */
      tap: function (code) {
        if (admBankLastOn(code)) return "refused";
        S.banksLoaded = admBankToggle(code);
        return S.banksLoaded;
      },
      on: function (code) { return admBankOn(code); },
      filter: function () { return S.banksLoaded; }
    };
  `;
  return new Function("LIST_IN", body)(list) as {
    tap: (c: string) => string[] | "refused";
    on: (c: string) => boolean;
    filter: () => string[];
  };
}

describe("«Какие банки показывать» — the switches tell the truth", () => {
  it("refuses to switch off the last bank of a country", () => {
    const p = panel(LIST);
    expect(p.tap("HABAEE2X")).not.toBe("refused");
    expect(p.tap("EEUHEE2X")).not.toBe("refused");
    // LHV is the only Estonian bank still on — it has to stay
    expect(p.tap("LHVBEE22")).toBe("refused");
    expect(p.on("LHVBEE22")).toBe(true);
  });

  it("…so what the panel shows is exactly what the checkout draws", () => {
    const p = panel(LIST);
    p.tap("HABAEE2X");
    p.tap("EEUHEE2X");
    p.tap("LHVBEE22");   // refused
    const shown = filterBanks(LIST, p.filter() as string[]).map((b) => b.code);
    expect(shown).toEqual(["LHVBEE22", "HABALV22", "UNLALV2X", "CBVILT2X"]);
    for (const b of LIST) expect(p.on(b.code), b.code).toBe(shown.includes(b.code));
  });

  it("a country with one bank cannot be switched off at all", () => {
    const p = panel(LIST);
    expect(p.tap("CBVILT2X")).toBe("refused");   // the only Lithuanian one
  });

  it("switching a hidden bank back on is never refused, and the last one clears the filter", () => {
    const p = panel(LIST);
    p.tap("HABAEE2X");
    expect(p.on("HABAEE2X")).toBe(false);
    expect(p.tap("HABAEE2X")).toEqual([]);   // all on again ⇒ «показывать все»
    expect(p.on("HABAEE2X")).toBe(true);
  });

  /* The guard has to read the *live* filter, not just the full list: after
     two Estonian banks are off, the third is the last one on even though the
     country still has three banks in Montonio's answer. */
  it("counts what is still on, not how many the country has", () => {
    const p = panel(LIST);
    p.tap("EEUHEE2X");
    expect(p.tap("HABAEE2X")).not.toBe("refused");   // LHV still on
    expect(p.tap("LHVBEE22")).toBe("refused");
  });
});
