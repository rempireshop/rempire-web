/**
 * «Доставка по умолчанию»: which countries have a locker, and what the block
 * says where one does not.
 *
 * Дим, /test, 24.09.2026, «Доставка по умолчанию» (bad): «Finland does not
 * have a map - not sure if it should.»
 *
 * Asked of the real thing — staging's GET /api/shipping/points/, 24.09.2026,
 * for every carrier the checkout asks about in every country it sells to —
 * Finland has lockers: DPD 2 572 points, SmartPosti 1 777. None of them
 * carries coordinates (Montonio sends none outside Omniva's Baltic feed and
 * the SmartPosti Estonian seed), so the sheet offers the search — postcode,
 * town, street, answered on the server because the list is longer than one
 * download — and no «Карта», exactly as for Poland or Italy. That is right,
 * and stays. The one country with no locker at any carrier is Greece: until
 * now the block drew its courier row and nothing else, which reads like a
 * list that has not loaded. It now says, in words, that only the courier
 * goes there.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");
const has = (name: string) => src.includes(`function ${name}(`);
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
function literal<T>(name: string): T {
  const at = src.indexOf(`var ${name} = `);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  const open = at + `var ${name} = `.length;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{" || src[i] === "[") depth++;
    else if ((src[i] === "}" || src[i] === "]") && --depth === 0) {
      return new Function(`return ${src.slice(open, i + 1)};`)() as T;
    }
  }
  throw new Error(`unterminated literal for ${name}`);
}

const CARRIERS_BY_COUNTRY = literal<Record<string, string[]>>("CARRIERS_BY_COUNTRY");
const COURIER_CARRIERS = literal<Record<string, string[]>>("COURIER_CARRIERS");

/**
 * Points per carrier, as staging answered on 24.09.2026 for the carriers the
 * checkout asks about (CARRIERS_BY_COUNTRY), plus Greece asked at every
 * carrier that couriers there.
 */
const STAGING: Record<string, Record<string, number>> = {
  EE: { dpd: 358, omniva: 439, unisend: 306, smartpost: 351 },
  LV: { dpd: 390, omniva: 412, unisend: 554, smartpost: 231 },
  LT: { dpd: 420, omniva: 562, unisend: 531, smartpost: 301 },
  FI: { dpd: 2572, smartpost: 1777 },
  AT: { novapost: 1955, dpd: 3205 }, BE: { dpd: 993 }, BG: { dpd: 1218 },
  CZ: { novapost: 4370, dpd: 15079 }, DE: { novapost: 9266, dpd: 10106 }, DK: { dpd: 2343 },
  ES: { novapost: 20571, dpd: 8846 }, FR: { dpd: 23179 }, HR: { dpd: 1664 }, HU: { novapost: 2520 },
  IE: { dpd: 249 }, IT: { novapost: 10013, dpd: 12048 }, LU: { dpd: 34 }, NL: { dpd: 2314 },
  PL: { novapost: 45800, dpd: 33603 }, PT: { dpd: 2289 }, RO: { novapost: 3296 }, SE: { dpd: 4505 },
  SI: { dpd: 802 }, SK: { novapost: 2832, dpd: 3328 },
  GR: { dpd: 0, smartpost: 0, novapost: 0 },
};

type Row = { l: string; pm?: string; pickup?: boolean };
function block(pickupOff: string[] = []) {
  const body = `
    var S = { country: "EE", countryIso: "" };
    var POINTS = { empty: {} };
    var SHIP_RULES = { pickupOff: PICKUP_OFF };
    var CARRIERS_BY_COUNTRY = ${JSON.stringify(CARRIERS_BY_COUNTRY)};
    var CARRIER_NAMES = ${JSON.stringify(literal("CARRIER_NAMES"))};
    ${["orderCountry", "pickupOpen", "carriersFor", "acctMethods", "acctCourierOnlyHTML"].filter(has).map(slice).join("\n")}
    return { rows: acctMethods, line: typeof acctCourierOnlyHTML === "function" ? acctCourierOnlyHTML : function () { return ""; } };
  `;
  return new Function("PICKUP_OFF", body)(pickupOff) as { rows: (cc: string) => Row[]; line: (rows: Row[]) => string };
}

const COURIER_ONLY = "В эту страну доставляем только курьером до двери.";

describe("what the real data says", () => {
  it("every carrier the checkout asks about has points where it is asked", () => {
    for (const [cc, list] of Object.entries(CARRIERS_BY_COUNTRY)) {
      for (const c of list) expect(STAGING[cc]?.[c] ?? 0, `${c} in ${cc}`).toBeGreaterThan(0);
    }
  });

  it("Finland has lockers at DPD and SmartPosti — thousands of them", () => {
    expect(CARRIERS_BY_COUNTRY.FI).toEqual(["dpd", "smartpost"]);
    expect(STAGING.FI.dpd + STAGING.FI.smartpost).toBeGreaterThan(4000);
  });

  it("Greece is the one country served with no locker at any carrier", () => {
    const courierOnly = Object.keys(COURIER_CARRIERS).filter((cc) => !(CARRIERS_BY_COUNTRY[cc] ?? []).length);
    expect(courierOnly).toEqual(["GR"]);
    expect(Object.values(STAGING.GR).every((n) => n === 0)).toBe(true);
  });
});

describe("the account block", () => {
  const b = block();

  it("offers Finland's lockers like everybody else's — a row per carrier, and the courier", () => {
    const fi = b.rows("FI");
    expect(fi.filter((x) => x.pm).map((x) => x.pm)).toEqual(["dpd", "smartpost"]);
    expect(b.line(fi)).toBe("");
  });

  it("says in words that Greece is courier only", () => {
    const gr = b.rows("GR");
    expect(gr.map((x) => x.l)).toEqual(["Курьер до двери"]);
    expect(b.line(gr)).toContain(COURIER_ONLY);
  });

  it("says nothing of the kind for a country with lockers, or for Estonia's pickup at the shop", () => {
    for (const cc of ["EE", "LV", "LT", "FI", "PL", "HU", "RO", "SE"]) expect(b.line(b.rows(cc)), cc).toBe("");
  });

  it("…and says it for a country whose lockers the owner switched off", () => {
    const off = block(["PL"]);
    expect(off.rows("PL").some((x) => x.pm)).toBe(false);
    expect(off.line(off.rows("PL"))).toContain(COURIER_ONLY);
  });

  it("is drawn into «Доставка по умолчанию», right under its rows", () => {
    const acct = slice("screenAccount");
    const at = acct.indexOf("acctCourierOnlyHTML(m)");
    expect(at).toBeGreaterThan(acct.indexOf('m.map(function (x, i)'));
    expect(at).toBeLessThan(acct.indexOf('acctStHTML("ship")'));
  });
});
