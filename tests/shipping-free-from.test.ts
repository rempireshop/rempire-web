/**
 * «Бесплатно от» — one number, four screens, and they have to say the same
 * thing.
 *
 * Renat, 13.09.2026: «„Бесплатно от“ пусто, а доставка всё равно бесплатная».
 * It was, and in two different ways:
 *
 *   1. The panel drew an **empty** box for Estonia, Latvia, Lithuania, Finland
 *      and for all twenty-one countries folded out of «Другие страны Европы»,
 *      because none of them carries a `freeFromByCountry` key — while
 *      quoteFromRules() walked on to the zone's threshold and then to
 *      `freeFrom`, and billed free delivery from 59 € all the same.
 *   2. Clearing that box deleted the key, which put the row straight back on
 *      the 59 €. So the one answer the box could not give was «бесплатной
 *      доставки сюда нет» — and on the «Другие страны Европы» row an emptied
 *      box dropped the whole of Europe from 200 € to 59 €, which is a 59 €
 *      basket to Greece shipped free against a 43,19 € courier.
 *
 * What the box means now, and what this file pins:
 *
 *   | in the box | meaning               | in the rules |
 *   | ---------- | --------------------- | ------------ |
 *   | 59         | free from 59 € up     | 59           |
 *   | 0          | free always           | 0            |
 *   | empty      | never free here       | null         |
 *
 * The panel is a static bundle with no DOM here, so its three functions are
 * **sliced out of public/shop2/app.js by source text** the way
 * tests/checkout-parity.test.ts slices the checkout's — retyping them would
 * test this file instead of the shop. The server half is imported for real.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_SHIPPING_RULES, parseShippingRules, quoteFromRules, type ShippingRules } from "@/lib/shipping";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

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

/** Read a `var <name> = [ … ];` literal out of app.js and evaluate it. */
function listLiteral(name: string): string[] {
  const at = src.indexOf(`var ${name} = [`);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  const open = src.indexOf("[", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]" && --depth === 0) {
      return new Function(`return ${src.slice(open, i + 1)};`)() as string[];
    }
  }
  throw new Error(`unterminated literal for ${name}`);
}

const EU_ROWS = listLiteral("SHIP_EU_COUNTRIES");

type Panel = {
  /** what the «Бесплатно от» box of one row shows */
  cell: (row: string) => string;
  /** type something into that box */
  type: (row: string, raw: string) => void;
  /** the rules the panel would save */
  draft: () => ShippingRules;
};

/** The panel's own three functions, over a draft of the rules. */
function panel(rules: Partial<ShippingRules>): Panel {
  // this repository's own source plus fixed stub text — nothing is interpolated
  const body = `
    ${slice("shipShow")}
    ${slice("shipNum")}
    ${slice("shipFreeCell")}
    ${slice("setShipDraftField")}
    function shipDraft() { return DRAFT; }
    return {
      cell: shipFreeCell,
      type: setShipDraftField,
      draft: function () { return DRAFT; }
    };
  `;
  const run = new Function("DRAFT", "SHIP_EU_COUNTRIES", body) as (
    d: unknown, eu: string[],
  ) => Panel;
  return run(JSON.parse(JSON.stringify({ methods: {}, ...rules })), EU_ROWS);
}

/** The storefront's own threshold(): what the cart bar and the till promise. */
function storefront(rules: Partial<ShippingRules>, country: string, iso = ""): number {
  const body = `
    ${slice("threshold")}
    ${slice("orderCountry")}
    return threshold();
  `;
  const run = new Function("SHIP_RULES", "S", body) as (r: unknown, s: unknown) => number;
  return run(rules, { country, countryIso: iso });
}

/** The «Доставка и оплата» page's own freeCell(), text only. */
function infoPage(rules: Partial<ShippingRules>, row: string): string {
  const body = `
    ${slice("freeCell")}
    function t(s) { return s; }
    function eur(v) { return v + " €"; }
    return freeCell(ROW);
  `;
  const run = new Function("rules", "ROW", body) as (r: unknown, row: string) => string;
  return run(rules, row).replace(/<[^>]*>/g, "");
}

/** …and what the server actually bills for a basket of `subtotal`. */
function billed(rules: ShippingRules, country: string, subtotal: number): number {
  return quoteFromRules(rules, { country, method: "courier", subtotal }).price;
}

/* The rules the shop ships with: one shop-wide 59 €, Europe lifted to 200 €,
   and no key at all for the four home countries. */
const SHIPPED: ShippingRules = {
  freeFrom: 59,
  freeFromByCountry: { EU: 200 },
  methods: { parcel: { default: 4.99 }, courier: { default: 9.9, EE: 10.84, DE: 22.29 }, pickup: { default: 0 } },
};

describe("the box is never empty while the till is giving delivery away", () => {
  it("shows the 59 € the four home rows inherit, not a blank", () => {
    const p = panel(SHIPPED);
    for (const row of ["EE", "LV", "LT", "FI"]) {
      expect([row, p.cell(row)]).toEqual([row, "59"]);
      expect([row, storefront(SHIPPED, row)]).toEqual([row, 59]);
    }
  });

  it("shows the zone's 200 € on every country folded out of «Другие страны Европы»", () => {
    const p = panel(SHIPPED);
    for (const row of EU_ROWS) expect([row, p.cell(row)]).toEqual([row, "200"]);
    expect(storefront(SHIPPED, "EU", "DE")).toBe(200);
  });

  it("shows the shop-wide threshold on «Остальные страны», and the zone's on its own row", () => {
    const p = panel(SHIPPED);
    expect(p.cell("default")).toBe("59");
    expect(p.cell("EU")).toBe("200");
  });

  it("follows the row above: lower the zone and its countries follow", () => {
    const p = panel(SHIPPED);
    p.type("free:EU", "150");
    expect(p.cell("DE")).toBe("150");
    expect(p.cell("EE")).toBe("59"); // …but a home row still reads freeFrom
    expect(storefront(p.draft(), "EU", "DE")).toBe(150);
  });

  it("lets a country beat its zone", () => {
    const p = panel(SHIPPED);
    p.type("free:PL", "90");
    expect(p.cell("PL")).toBe("90");
    expect(p.cell("DE")).toBe("200");
    expect(storefront(p.draft(), "EU", "PL")).toBe(90);
  });
});

describe("empty means «no free delivery here», on every screen", () => {
  it("stores a null rather than dropping the key — the row does not fall back to 59 €", () => {
    const p = panel(SHIPPED);
    p.type("free:EE", "");
    expect(p.draft().freeFromByCountry).toEqual({ EU: 200, EE: null });
    expect(p.cell("EE")).toBe("нет");
    expect(storefront(p.draft(), "EE")).toBe(Infinity);
    expect(infoPage(p.draft(), "EE")).toBe("не бывает");
    const server = parseShippingRules(p.draft());
    expect(server.freeFromByCountry?.EE).toBe(null);
    expect(billed(server, "EE", 1000)).toBe(10.84); // a 1000 € basket still pays
  });

  it("empties the whole of Europe without dropping it back to the home 59 €", () => {
    const p = panel(SHIPPED);
    p.type("free:EU", "");
    expect(p.draft().freeFromByCountry).toEqual({ EU: null });
    expect(p.cell("DE")).toBe("нет");
    expect(storefront(p.draft(), "EU", "DE")).toBe(Infinity);
    expect(infoPage(p.draft(), "EU")).toBe("не бывает");
    // the bug this replaces: a 59 € basket to Greece used to ship free here
    expect(billed(parseShippingRules(p.draft()), "DE", 59)).toBe(22.29);
    expect(storefront(p.draft(), "EE")).toBe(59); // Estonia untouched
  });

  it("empties «Остальные страны» too, and every row that inherits from it", () => {
    const p = panel(SHIPPED);
    p.type("free:default", "");
    expect(p.draft().freeFrom).toBe(null);
    expect(p.cell("default")).toBe("нет");
    expect(p.cell("EE")).toBe("нет");
    expect(p.cell("DE")).toBe("200"); // Europe has a threshold of its own
    expect(storefront(p.draft(), "EE")).toBe(Infinity);
    expect(billed(parseShippingRules(p.draft()), "EE", 10_000)).toBe(10.84);
  });

  it("takes «нет» and a dash as the same answer as an empty box", () => {
    for (const typed of ["нет", "no", "-", "—"]) {
      const p = panel(SHIPPED);
      p.type("free:EE", typed);
      expect([typed, p.draft().freeFromByCountry?.EE]).toEqual([typed, null]);
      expect([typed, p.cell("EE")]).toEqual([typed, "нет"]);
    }
  });
});

describe("zero means «always free», and is not the same as empty", () => {
  it("keeps the 0 rather than reading it as an empty box", () => {
    const p = panel(SHIPPED);
    p.type("free:EE", "0");
    expect(p.draft().freeFromByCountry).toEqual({ EU: 200, EE: 0 });
    expect(p.cell("EE")).toBe("0");
    expect(storefront(p.draft(), "EE")).toBe(0);
    expect(infoPage(p.draft(), "EE")).toBe("0 €");
  });

  it("ships an empty basket free at 0 and charges everything at null", () => {
    const free = parseShippingRules({ ...SHIPPED, freeFromByCountry: { EE: 0 } });
    const never = parseShippingRules({ ...SHIPPED, freeFromByCountry: { EE: null } });
    expect(billed(free, "EE", 0)).toBe(0);
    expect(billed(free, "EE", 5)).toBe(0);
    expect(billed(never, "EE", 0)).toBe(10.84);
    expect(billed(never, "EE", 59)).toBe(10.84);
    // and the quote says which threshold it used, for the UI to print
    expect(quoteFromRules(free, { country: "EE", method: "courier", subtotal: 5 }).freeFrom).toBe(0);
    expect(quoteFromRules(never, { country: "EE", method: "courier", subtotal: 5 }).freeFrom).toBe(null);
  });

  it("survives the round trip through the settings row unchanged", () => {
    // what the panel saves is JSON, and what comes back has to mean the same
    const saved = JSON.parse(JSON.stringify({ ...SHIPPED, freeFromByCountry: { EE: 0, LV: null, EU: 200 } }));
    const back = parseShippingRules(saved);
    expect(back.freeFromByCountry).toEqual({ EE: 0, LV: null, EU: 200 });
  });
});

describe("a real threshold still prices a basket the way it always did", () => {
  it("charges under it and ships free at it and above", () => {
    const rules = parseShippingRules(SHIPPED);
    expect(billed(rules, "EE", 58.99)).toBe(10.84);
    expect(billed(rules, "EE", 59)).toBe(0);
    expect(billed(rules, "EE", 59.01)).toBe(0);
    expect(billed(rules, "DE", 199.99)).toBe(22.29);
    expect(billed(rules, "DE", 200)).toBe(0);
  });

  it("is the same threshold the panel prints and the storefront promises", () => {
    const p = panel(SHIPPED);
    for (const [row, iso] of [["EE", ""], ["FI", ""], ["EU", "DE"]] as const) {
      const shown = Number(p.cell(row));
      expect([row, shown]).toEqual([row, storefront(SHIPPED, row, iso)]);
      const rules = parseShippingRules(SHIPPED);
      expect([row, billed(rules, iso || row, shown)]).toEqual([row, 0]);
      expect([row, billed(rules, iso || row, shown - 0.01) > 0]).toEqual([row, true]);
    }
  });

  it("still reads the defaults the shop ships with", () => {
    const p = panel(DEFAULT_SHIPPING_RULES);
    expect(p.cell("EE")).toBe("59");
    expect(p.cell("EU")).toBe("200");
    expect(p.cell("default")).toBe("59");
  });
});

/* ---------------------------------------------------------------------------
   …and the sentences that QUOTE the floor.

   Everything above is about the number the till uses. This is about the number
   the shop prints: the product page, the footer and the announcement strip all
   say «по Эстонии бесплатно от 59 €», and until 14.09.2026 they went on saying
   it after the owner cleared «Бесплатно от» — refreshShipThresholds() only
   wrote a finite number back, so THRESH kept the seed while threshold() above
   correctly answered Infinity and the checkout billed the parcel. A promise on
   the product page that the last screen of the checkout breaks is worse than
   no promise at all.
--------------------------------------------------------------------------- */

/** Read a `var <name> = { … };` literal out of app.js, verbatim. */
function objectLiteral(name: string): string {
  const at = src.indexOf(`var ${name} = {`);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  const open = src.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return `${src.slice(at, i + 1)};`;
  }
  throw new Error(`unterminated literal for ${name}`);
}

type Marketing = {
  thresh: Record<string, number | null>;
  pdp: string;
  ftr: string;
  /** the announcement strip's own body, "" when it refuses to print */
  announce: (ru: string) => string;
};

/** The shop's own four functions over a set of rules — no DOM needed. */
function marketing(rules: Partial<ShippingRules>): Marketing {
  const body = `
    var SHIP_RULES = RULES;
    ${objectLiteral("THRESH")}
    ${slice("refreshShipThresholds")}
    ${slice("pdpShipLine")}
    ${slice("ftrShipLine")}
    ${slice("cTokens")}
    ${slice("announceBody")}
    function cText(t) { return t && t.RU ? t.RU : ""; }
    function esc(s) { return s; }
    var CONTENT_DEFAULT = { announcement: { text: {} } };
    var ANN = { on: true, text: {}, short: {}, link: "" };
    function contentConf() { return { announcement: ANN }; }
    refreshShipThresholds();
    return {
      thresh: THRESH,
      pdp: pdpShipLine(),
      ftr: ftrShipLine(),
      announce: function (ru) { ANN.text = { RU: ru }; ANN.short = {}; return announceBody(); }
    };
  `;
  const run = new Function("RULES", body) as (r: unknown) => Marketing;
  return run(JSON.parse(JSON.stringify({ methods: {}, ...rules })));
}

describe("the sentences that quote «бесплатно от» stop quoting it when there is none", () => {
  it("prints the owner's real floor while there is one", () => {
    const m = marketing({ ...SHIPPED, freeFromByCountry: { EE: 39, EU: 200 } });
    expect(m.thresh.EE).toBe(39);
    expect(m.pdp).toContain("по Эстонии бесплатно от 39 €");
    /* The footer says «по Эстонии» once now, about the 1–3 days, so the
       threshold clause beside it is just «бесплатно от 39 €» — reworded
       19.09.2026 when the «230 пакоматов в 4 странах» claim was dropped. */
    expect(m.ftr).toContain("1–3 дня по Эстонии · бесплатно от 39 €");
    expect(m.announce("Бесплатная доставка по Эстонии от {EE} €")).toBe("Бесплатная доставка по Эстонии от 39 €");
  });

  it("drops the clause outright when «Бесплатно от» is cleared for Estonia", () => {
    const rules = { ...SHIPPED, freeFromByCountry: { EE: null, EU: 200 } };
    const m = marketing(rules);
    // the till already knew; now the pages do too
    expect(storefront(rules, "EE")).toBe(Infinity);
    expect(m.thresh.EE).toBeNull();
    expect(m.pdp).not.toContain("бесплатно");
    expect(m.ftr).not.toContain("бесплатно");
    expect(m.pdp).toBe("Доставка 1–3 дня: DPD, Omniva, SmartPosti, курьер · самовывоз на Mardi 1");
    expect(m.ftr).toBe("DPD, Omniva, SmartPosti и курьер · 1–3 дня по Эстонии · пакоматы и пункты выдачи по Европе");
  });

  it("drops the announcement strip rather than printing «от {EE} €» at a shopper", () => {
    const m = marketing({ ...SHIPPED, freeFromByCountry: { EE: null, EU: 200 } });
    expect(m.announce("Бесплатная доставка по Эстонии от {EE} €")).toBe("");
    // a strip that names no threshold is none of this test's business
    expect(m.announce("Новая партия Kevin.Murphy")).toBe("Новая партия Kevin.Murphy");
  });

  it("follows the shop-wide box too — clearing «Остальные страны» empties every row that inherits it", () => {
    const m = marketing({ ...SHIPPED, freeFrom: null, freeFromByCountry: {} });
    expect(m.thresh).toEqual({ EE: null, LV: null, LT: null, FI: null, EU: null });
    expect(m.pdp).not.toContain("бесплатно");
  });

  /* The half that must not break: 0 is «always free», not «no floor». */
  it("keeps printing a floor of 0", () => {
    const m = marketing({ ...SHIPPED, freeFromByCountry: { EE: 0, EU: 200 } });
    expect(m.thresh.EE).toBe(0);
    expect(m.pdp).toContain("по Эстонии бесплатно от 0 €");
  });
});
