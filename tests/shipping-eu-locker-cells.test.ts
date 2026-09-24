/**
 * Every locker price the checkout can show abroad has a box on the rate screen.
 *
 * Дим, /test, 24.09.2026, on «Таблица тарифов доставки» (bad): «Poland,
 * Germany .. and these other countries, I can only, as it seems change the
 * price for the courier, but I think some have also parcels and maybe even
 * different parcel/locker offerings, so the current table is missing this
 * data and cannot be overridden - the info for the shipping is then taken
 * from somewhere which we cannot override.»
 *
 * He was right. Since 18.09.2026 the checkout offers a locker in every
 * country DPD serves — and Nova Post's in nine of them, Hungary and Romania
 * included — each card at its own Montonio price (MONTONIO_PRICE.chips), and
 * the fold «Цены по странам Европы» drew a courier box and a «Бесплатно от»
 * box and nothing else, over a hint saying there was no per-carrier price.
 * Now the fold has a box per locker carrier, like Estonia's row: empty is
 * Montonio's price, printed under the box; a number is the owner's, and the
 * checkout, the «Доставка и оплата» page and the server's bill all take it.
 *
 * Real data behind the columns (staging /api/shipping/points/, 24.09.2026):
 * DPD answers pickup points in the 18 countries of the fold it is offered in
 * (all but Hungary, Romania and Greece — Luxembourg 34, Poland 33 603), Nova
 * Post in AT, CZ, DE, ES, HU, IT, PL, RO, SK; Greece answers none at any
 * carrier.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  belowCostCells,
  cleanShippingRules,
  parseShippingRules,
  quoteFromRules,
  type ShippingRules,
} from "@/lib/shipping";
import { CARRIER_ORDER, offeredCarriers } from "@/lib/shipping/country-prices";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");
const css = readFileSync(fileURLToPath(new URL("../public/shop2/admin.css", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

const has = (name: string) => src.includes(`function ${name}(`);

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
const fns = (...names: string[]) => names.filter(has).map(slice).join("\n");

/** The SOURCE of a `var <name> = <literal>;` in app.js, or `fallback` when there is none. */
function literalSrc(name: string, fallback?: string): string {
  const at = src.indexOf(`var ${name} = `);
  if (at < 0) {
    if (fallback !== undefined) return fallback;
    throw new Error(`public/shop2/app.js no longer has var ${name}`);
  }
  const open = at + `var ${name} = `.length;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{" || src[i] === "[") depth++;
    else if ((src[i] === "}" || src[i] === "]") && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unterminated literal for ${name}`);
}

type Row = { carriers?: Record<string, Record<string, number>>; methods?: Record<string, Record<string, number>> };
type Panel = {
  S: { shipDraft: Row | null };
  europe: () => string;
  row: (key: string) => string;
  setField: (key: string, raw: string) => void;
  paintFoot: (input: FakeInput) => void;
  live: () => { carriers: Record<string, Record<string, number>> };
  price: (m: string, c: string, cc: string) => number;
  low: (r: Row) => Array<{ carrier: string; country: string; charged: number; cost: number }>;
  euCols: Array<[string, string]>;
};
type FakeInput = {
  dataset: { shiprule: string };
  value: string;
  parentNode: { className: string };
  nextElementSibling: { outerHTML: string } | null;
};

/** The rate screen's own functions over its own tables, with the draft `stored`. */
function panel(stored: Row = {}): Panel {
  const body = `
    var S = { lang: "RU", shipEuOpen: true, shipDraft: null, country: "EE", countryIso: "" };
    var MONTONIO_PRICE = ${literalSrc("MONTONIO_PRICE")};
    var SHIP_RULES = ${literalSrc("SHIP_RULES")};
    var SHIP_RULES_DEFAULT = JSON.parse(JSON.stringify(SHIP_RULES));
    // the stored row's own shape (SHIP_STORED_DEFAULT), with the test's cells over it
    var SHIP_STORED = Object.assign({ freeFrom: 59, freeFromByCountry: { EU: 200 },
      methods: { parcel: {}, courier: {}, pickup: {} }, carriers: {}, countriesOff: [], pickupOff: [] }, STORED);
    var CARRIERS_BY_COUNTRY = ${literalSrc("CARRIERS_BY_COUNTRY")};
    var COURIER_CARRIERS = ${literalSrc("COURIER_CARRIERS")};
    var CARRIER_NAMES = ${literalSrc("CARRIER_NAMES")};
    var COUNTRIES = ${literalSrc("COUNTRIES")};
    var EUROPE_ISO = ${literalSrc("EUROPE_ISO")};
    var SHIP_ROWS = ${literalSrc("SHIP_ROWS")};
    var SHIP_EU_COUNTRIES = ${literalSrc("SHIP_EU_COUNTRIES")};
    var SHIP_CARRIER_COLS = ${literalSrc("SHIP_CARRIER_COLS")};
    var SHIP_EU_CARRIER_COLS = ${literalSrc("SHIP_EU_CARRIER_COLS", "[]")};
    function cloneRules(r) { return JSON.parse(JSON.stringify(r)); }
    function countryName(c) { return c; }
    function orderCountry() { return S.country === "EU" ? (S.countryIso || "EU") : S.country; }
    function translateTree() {}
    function admShipPickupHTML() { return ""; }
    function admShipUnservedHTML() { return ""; }
    function admSwitch(attrs, on, name) { return "<button " + attrs + ">" + name + "</button>"; }
    ${fns(
      "eur", "esc", "shipDraft", "shipShow", "shipNum", "shipCell", "shipFreeCell", "shipCarrierCell",
      "shipCountryOff", "setShipDraftField", "montonioCarrierTag", "admRateCellHTML", "admRateFootHTML",
      "admRateNoneHTML", "admShipCourierFoot", "shipLockerMontonio", "admShipRowHTML", "admShipEuropeHTML",
      "paintShipFoot", "shipStoredMerge", "shipRulesBase", "shipRulesFrom", "shipZoneOf", "shipRulePrice",
      "shipLowCells",
    )}
    return {
      S: S,
      europe: admShipEuropeHTML,
      row: function (key) {
        var html = admShipEuropeHTML(), at = html.indexOf('data-shiprule="m:courier:' + key + '"');
        if (at < 0) return "";
        var from = html.lastIndexOf('<div class="adm-tariffs', at);
        var to = html.indexOf('data-shiprule="free:' + key + '"', at);
        return html.slice(from, to);
      },
      setField: setShipDraftField,
      paintFoot: paintShipFoot,
      live: function () { return shipRulesFrom(shipDraft()); },
      price: function (m, c, cc) {
        var live = shipRulesFrom(shipDraft());
        SHIP_RULES.carriers = live.carriers; SHIP_RULES.methods = live.methods;
        return shipRulePrice(m, c, cc);
      },
      low: shipLowCells,
      euCols: SHIP_EU_CARRIER_COLS
    };
  `;
  return new Function("STORED", body)(stored) as Panel;
}

const EU21 = ["AT", "BE", "BG", "CZ", "DE", "DK", "ES", "FR", "GR", "HR", "HU", "IE", "IT", "LU", "NL", "PL", "PT", "RO", "SE", "SI", "SK"];

describe("«Цены по странам Европы» — a locker box per carrier", () => {
  it("Poland has a Nova Post and a DPD locker box, Montonio's price under each", () => {
    const pl = panel().row("PL");
    expect(pl).toContain('data-shiprule="c:novapost:PL"');
    expect(pl).toContain('data-shiprule="c:dpd:PL"');
    expect(pl).toContain("Montonio: 5,49 €");
    expect(pl).toContain("Montonio: 7,49 €");
  });

  it("Hungary and Romania: Nova Post only — DPD's column is a dash, not a box", () => {
    for (const cc of ["HU", "RO"]) {
      const row = panel().row(cc);
      expect(row, cc).toContain(`data-shiprule="c:novapost:${cc}"`);
      expect(row, cc).not.toContain(`data-shiprule="c:dpd:${cc}"`);
      expect(row, cc).toContain("не возит");
    }
  });

  it("Greece has no locker anywhere: two dashes, and its courier box as before", () => {
    const gr = panel().row("GR");
    expect(gr).not.toContain('data-shiprule="c:');
    expect(gr.match(/не возит/g)).toHaveLength(2);
    expect(gr).toContain('data-shiprule="m:courier:GR"');
  });

  it("a box for every locker card the checkout draws in the fold, and none for a card it does not", () => {
    const html = panel().europe();
    const boxes = new Set([...html.matchAll(/data-shiprule="c:([a-z]+):([A-Z]{2})"/g)].map((m) => `${m[1]}:${m[2]}`));
    const cards = new Set<string>();
    for (const cc of EU21) for (const c of offeredCarriers(cc, "parcel")) cards.add(`${c}:${cc}`);
    expect([...boxes].sort()).toEqual([...cards].sort());
    expect(cards.size).toBe(27);   // DPD in 18 countries, Nova Post in 9
  });

  it("the columns are the carriers with lockers in those countries, in Montonio's order", () => {
    const cols = panel().euCols.map((c) => c[0]);
    const wanted = CARRIER_ORDER.filter((c) => EU21.some((cc) => offeredCarriers(cc, "parcel").includes(c)));
    expect(cols).toEqual(wanted);
    expect(cols).toEqual(["novapost", "dpd"]);
  });

  it("the header names the same columns the rows draw, and the grid has a track for each", () => {
    const html = panel().europe();
    const head = html.slice(html.indexOf("adm-tariffs--head"), html.indexOf("</div>", html.indexOf("adm-tariffs--head")));
    expect(head).toContain("<span>Nova Post</span><span>DPD</span>");
    const rule = css.slice(css.indexOf(".adm-tariffs--eu {"), css.indexOf("}", css.indexOf(".adm-tariffs--eu {")));
    const tracks = rule.match(/grid-template-columns:\s*1\.25fr repeat\((\d+),/);
    expect(tracks, rule).not.toBeNull();
    // country + the carriers + courier + «Бесплатно от»
    expect(1 + Number(tracks![1])).toBe(1 + panel().euCols.length + 2);
  });

  it("the hint above the fold no longer says there is no per-carrier price", () => {
    expect(panel().europe()).not.toContain("отдельной цены по перевозчику тут нет");
  });
});

describe("a typed Polish DPD price is the owner's, everywhere", () => {
  it("goes into the draft, and the line under the box offers Montonio's back", () => {
    const p = panel();
    p.setField("c:dpd:PL", "9,99");
    expect(p.S.shipDraft?.carriers?.dpd).toEqual({ PL: 9.99 });
    const row = p.row("PL");
    expect(row).toContain('value="9.99"');
    expect(row).toContain('data-shipclear="c:dpd:PL"');
    expect(row).toContain("Montonio: 7,49 € · вернуть");
  });

  it("the line under the box follows the keystroke, as it does for Estonia", () => {
    const p = panel();
    const input: FakeInput = {
      dataset: { shiprule: "c:dpd:PL" }, value: "5",
      parentNode: { className: "adm-rates__c" }, nextElementSibling: { outerHTML: "" },
    };
    p.paintFoot(input);
    expect(input.nextElementSibling?.outerHTML).toContain("Ниже Montonio: 7,49 €");
  });

  it("the checkout's card bills it; Nova Post's card and an empty box stay Montonio's", () => {
    const p = panel();
    p.setField("c:dpd:PL", "9,99");
    expect(p.price("parcel", "dpd", "PL")).toBe(9.99);
    expect(p.price("parcel", "novapost", "PL")).toBe(5.49);
    expect(p.price("parcel", "dpd", "DE")).toBe(16.39);
    p.setField("c:dpd:PL", "");
    expect(p.price("parcel", "dpd", "PL")).toBe(7.49);
  });

  it("the server stores it and bills it, and an empty box is Montonio's price there too", () => {
    const stored = cleanShippingRules({ carriers: { dpd: { PL: 9.99 }, novapost: { HU: 6.5 } } });
    expect(stored.carriers).toEqual({ dpd: { PL: 9.99 }, novapost: { HU: 6.5 } });
    const live = parseShippingRules(stored);
    const bill = (cc: string, carrier: string) => quoteFromRules(live, { country: cc, method: "parcel", carrier, subtotal: 10 }).price;
    expect(bill("PL", "dpd")).toBe(9.99);
    expect(bill("HU", "novapost")).toBe(6.5);
    expect(bill("PL", "novapost")).toBe(5.49);
    expect(bill("DE", "dpd")).toBe(16.39);
  });

  it("the shop's card and the server's bill agree for every locker box in the fold, typed or empty", () => {
    const typed: Row = { carriers: { dpd: { PL: 9.99, IT: 30 }, novapost: { HU: 6.5, AT: 12 } } };
    const p = panel(typed);
    const live = parseShippingRules(cleanShippingRules(typed));
    const bad: string[] = [];
    for (const cc of EU21) {
      for (const c of offeredCarriers(cc, "parcel")) {
        const shop = p.price("parcel", c, cc);
        const bill = quoteFromRules(live, { country: cc, method: "parcel", carrier: c, subtotal: 10 }).price;
        if (Math.abs(shop - bill) > 0.001) bad.push(`${cc}/${c}: shop ${shop}, bill ${bill}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("under Montonio's price it is asked about before the save — by the panel and by the server alike", () => {
    const row: Row = { carriers: { dpd: { PL: 5 } }, methods: { parcel: {}, courier: {}, pickup: {} } };
    const server = belowCostCells(cleanShippingRules(row) as ShippingRules);
    expect(server).toEqual([{ carrier: "dpd", country: "PL", method: "parcel", charged: 5, cost: 7.49 }]);
    const client = panel().low(row);
    expect(client.map((c) => `${c.carrier}:${c.country}:${c.charged}:${c.cost}`)).toEqual(["dpd:PL:5:7.49"]);
  });
});
