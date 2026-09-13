/**
 * «Что увидит покупатель» — the panel's preview of the delivery table.
 *
 * Ренат, 13.09.2026: «I do not understand the table … & what is actually
 * used». The answer chosen was to show him, with the customer's own table,
 * over the numbers he is typing right now. That only works while two things
 * stay true, and both are what this file holds down:
 *
 *   1. **One renderer.** The preview is `deliveryPageHTML(..., tableOnly)` —
 *      the very function that draws /info/shipping/ and its prerendered
 *      twin. A second implementation would drift, and a preview that drifts
 *      from the page it previews is worse than none.
 *   2. **The draft, not the settings.** It reads shipDraft(), so an unsaved
 *      edit shows; a preview of the saved row would confirm numbers the owner
 *      has already changed.
 *
 * Both halves are sliced out of public/shop2/app.js by source text, the way
 * tests/checkout-parity.test.ts slices the checkout's arithmetic.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
const adminCss = readFileSync(fileURLToPath(new URL("../public/shop2/admin.css", import.meta.url)), "utf8");

/** Cut `  function <name>(…) { … }` out of app.js — the declaration at the
 *  start of a line, since app.js also *quotes* one inside a comment. */
function slice(name: string): string {
  const at = src.indexOf(`\n  function ${name}(`);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  const start = at + 1;
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

/** A whole `var <name> = […];` statement, verbatim — the array matched by
 *  brackets, then on to that statement's semicolon so a `.concat(…)` tail
 *  comes along with it. */
function decl(name: string): string {
  const at = src.indexOf(`\n  var ${name} = `);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  const start = at + 1;
  let depth = 0;
  for (let i = src.indexOf("[", start); i < src.length; i++) {
    if (src[i] === "[") depth++;
    else if (src[i] === "]" && --depth === 0) return src.slice(start, src.indexOf(";", i) + 1);
  }
  throw new Error(`unterminated statement for ${name}`);
}

type Rules = Record<string, unknown>;
type Harness = {
  preview: () => string;
  page: (ctx: Record<string, unknown>) => string;
  rows: () => Array<[string, string, string]>;
  /** app.js's own eur(), so the assertions read the page's own formatting */
  eur: (v: number) => string;
};

/** The panel's preview function and the page's renderer, over one draft. */
function harness(draft: Rules): Harness {
  // this repository's own source plus fixed stub text — nothing is interpolated
  const body = `
    ${slice("deliveryPageHTML")}
    ${decl("DELIVERY_ROWS")}
    ${decl("ADM_SHIP_PREVIEW_ROWS")}
    ${slice("admShipPreviewTableHTML")}
    function shipDraft() { return DRAFT; }
    function esc(s) { return String(s); }
    ${slice("eur")}
    var S = { lang: "RU" };
    var CARRIER_NAMES = {
      omniva: "Omniva", smartpost: "SmartPosti", dpd: "DPD", venipak: "Venipak", unisend: "Unisend"
    };
    var CARRIERS_BY_COUNTRY = {
      EE: ["omniva", "smartpost", "dpd", "venipak", "unisend"],
      LV: ["omniva", "dpd", "venipak", "unisend"],
      LT: ["omniva", "dpd", "venipak", "unisend"],
      FI: ["smartpost", "dpd"], EU: []
    };
    return {
      preview: admShipPreviewTableHTML,
      page: deliveryPageHTML,
      rows: function () { return ADM_SHIP_PREVIEW_ROWS; },
      eur: eur
    };
  `;
  return (new Function("DRAFT", body) as (d: Rules) => Harness)(JSON.parse(JSON.stringify(draft)));
}

/** The rendered table as plain rows of cells, the way the owner reads it. */
function cells(html: string): string[][] {
  return (html.match(/<tr>[\s\S]*?<\/tr>/g) || []).map((row) =>
    (row.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/g) || []).map((c) =>
      c.replace(/<small[\s\S]*?<\/small>/g, "").replace(/<[^>]*>/g, "").trim(),
    ),
  );
}

/* The rules the shop runs on today (staging's settings row, 13.09.2026):
   carrier cells filled, so the parcel price a shopper pays is not the one in
   the «Пакомат» column — the whole reason the preview exists. */
const LIVE: Rules = {
  freeFrom: 59,
  freeFromByCountry: { EU: 200 },
  methods: {
    parcel: { default: 4.99, EE: 5.47, LV: 5.59, LT: 5.59, FI: 7.89, PL: 17.89 },
    courier: { default: 9.9, EE: 10.84, LV: 16.29, LT: 17.79, FI: 16.29, PL: 20.69, DE: 22.29 },
    pickup: { default: 0 },
  },
  carriers: {
    omniva: { EE: 2.59, LV: 4.09, LT: 4.09 },
    smartpost: { EE: 2.59, LV: 4.09, LT: 4.09, FI: 7.89 },
    dpd: { EE: 2.59, LV: 4.09, LT: 4.09, FI: 7.89 },
    unisend: { EE: 2.59, LV: 4.09, LT: 4.09 },
  },
};

describe("the preview is the customer's own table, not a second one", () => {
  it("renders exactly what deliveryPageHTML draws for the same rules", () => {
    const h = harness(LIVE);
    const byHand = h.page({
      tableOnly: true, lang: "RU",
      tr: (s: string) => s,
      esc: (s: string) => String(s),
      eur: h.eur,
      rules: LIVE, carriers: {
        EE: ["omniva", "smartpost", "dpd", "venipak", "unisend"],
        LV: ["omniva", "dpd", "venipak", "unisend"],
        LT: ["omniva", "dpd", "venipak", "unisend"],
        FI: ["smartpost", "dpd"], EU: [],
      },
      carrierNames: { omniva: "Omniva", smartpost: "SmartPosti", dpd: "DPD", venipak: "Venipak", unisend: "Unisend" },
      rows: h.rows(),
    });
    expect(h.preview()).toBe(byHand);
  });

  it("returns the table alone — no page around it", () => {
    const html = harness(LIVE).preview();
    expect(html.startsWith('<div class="dlv__scroll"')).toBe(true);
    expect(html.endsWith("</table></div>")).toBe(true);
    // nothing from the rest of the customer page leaks in
    expect(html).not.toContain("dlv__pay");
    expect(html).not.toContain("dlv__pickup");
    expect(html).not.toContain("dlv__times");
  });

  it("scrolls inside its own strip, so a 375 px panel never scrolls sideways", () => {
    expect(harness(LIVE).preview()).toContain('class="dlv__scroll"');
    // …and the storefront's gutter bleed is taken off inside the panel
    expect(adminCss).toMatch(/\.adm-preview \.dlv__scroll \{[^}]*margin: 0;/);
  });

  it("shows all six rows of the panel's grid, «Остальные страны» included", () => {
    const rows = cells(harness(LIVE).preview());
    expect(rows[0]).toEqual(["Страна", "Пакомат", "Курьер", "Бесплатно от"]);
    expect(rows.slice(1).map((r) => r[0])).toEqual([
      "Эстония", "Латвия", "Литва", "Финляндия", "Другие страны Европы", "Остальные страны",
    ]);
  });
});

describe("…and it answers for what the owner is typing, not for what is saved", () => {
  it("prints the price a shopper really pays, not the «Пакомат» column", () => {
    const rows = cells(harness(LIVE).preview());
    const ee = rows.find((r) => r[0] === "Эстония")!;
    // the column says 5,47; the carriers say 2,59, and the carriers win
    expect(ee[1]).toBe("от 2,59 €");
    expect(ee[2]).toBe("10,84 €");
    expect(ee[3]).toBe("59 €");
  });

  it("follows an edit that is still in the draft", () => {
    const edited = JSON.parse(JSON.stringify(LIVE));
    edited.carriers.omniva.EE = 6.49;
    edited.carriers.smartpost.EE = 6.49;
    edited.carriers.dpd.EE = 6.49;
    edited.carriers.unisend.EE = 6.49;
    edited.methods.courier.EE = 12.9;
    const ee = cells(harness(edited).preview()).find((r) => r[0] === "Эстония")!;
    // Venipak has no cell of its own and still falls back to the 5,47 column
    expect(ee[1]).toBe("от 5,47 €");
    expect(ee[2]).toBe("12,90 €");
  });

  it("says «не бывает» the moment a threshold is cleared in the draft", () => {
    const edited = JSON.parse(JSON.stringify(LIVE));
    edited.freeFromByCountry = { EU: null, EE: 0 };
    const rows = cells(harness(edited).preview());
    expect(rows.find((r) => r[0] === "Эстония")![3]).toBe("0 €");
    expect(rows.find((r) => r[0] === "Другие страны Европы")![3]).toBe("не бывает");
    // Latvia has no key and inherits the shop-wide 59 €, same as the grid shows
    expect(rows.find((r) => r[0] === "Латвия")![3]).toBe("59 €");
  });

  it("prices «Остальные страны» off the default cells", () => {
    const rest = cells(harness(LIVE).preview()).find((r) => r[0] === "Остальные страны")!;
    expect(rest[1]).toBe("—");      // no carriers there, so no parcel machine
    expect(rest[2]).toBe("9,90 €");
    expect(rest[3]).toBe("59 €");
  });
});

describe("the three labels say which numbers are real", () => {
  it("warns, in the grid, that a carrier price beats the «Пакомат» column", () => {
    expect(src).toContain("Колонка «Пакомат» — это запасная цена.");
    expect(src).toMatch(/adm-notice">Колонка «Пакомат»/);
  });

  it("repeats it where the carrier prices are typed", () => {
    expect(src).toContain("Цена перевозчика сильнее колонки «Пакомат» ");
  });

  it("says the pickup box prices nothing and the markup only feeds the button", () => {
    expect(src).toContain("Самовывоз всегда бесплатный — что бы тут ни ");
    expect(src).toContain("Наценка сама по себе ничего не меняет: её ");
  });

  it("has every one of them in Estonian and English", () => {
    const keys = [
      "Колонка «Пакомат» — это запасная цена. Если внизу, в «Ценах по перевозчикам», у Omniva, DPD, SmartPosti или Unisend стоит своя цена, покупатель заплатит её, а не ту, что в таблице.",
      "Цена перевозчика сильнее колонки «Пакомат» в таблице выше: если тут стоит число, покупатель платит его.",
      "Самовывоз всегда бесплатный — что бы тут ни стояло, в кассе будет 0 €.",
      "Наценка сама по себе ничего не меняет: её прибавляет только кнопка «Заполнить по тарифам Montonio», когда вписывает цены в таблицу.",
      "Что увидит покупатель",
    ];
    // one key in the ET dictionary and one in the EN dictionary — never fewer
    for (const k of keys) {
      expect([k, src.split(JSON.stringify(k)).length - 1]).toEqual([k, 2]);
    }
  });
});
