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

/** A whole `var <name> = …;` statement, verbatim — the literal matched by its
 *  own brackets or braces, then on to that statement's semicolon so a
 *  `.concat(…)` tail comes along with it. */
function decl(name: string): string {
  const at = src.indexOf(`\n  var ${name} = `);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  const start = at + 1;
  const open = src.indexOf("=", start) + 2;
  const [in1, out1] = src[open] === "{" ? ["{", "}"] : ["[", "]"];
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === in1) depth++;
    else if (src[i] === out1 && --depth === 0) return src.slice(start, src.indexOf(";", i) + 1);
  }
  throw new Error(`unterminated statement for ${name}`);
}

type Rules = Record<string, unknown>;
type Harness = {
  preview: () => string;
  page: (ctx: Record<string, unknown>) => string;
  rows: () => Array<[string, string, string]>;
  /** app.js's own MONTONIO_PRICE — what an empty box charges */
  montonio: () => Record<string, unknown>;
  /** the draft as the TILL reads it — the boxes hold the stored row (r22) */
  live: () => Rules;
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
    /* r22: the boxes show the STORED row and the preview shows the BILL, so
       the draft goes through the same merge the till does before it is drawn
       — an empty cell is Montonio's price and not a blank. */
    ${decl("SHIP_RULES")}
    function cloneRules(r) { return JSON.parse(JSON.stringify(r)); }
    var SHIP_RULES_DEFAULT = cloneRules(SHIP_RULES);
    ${slice("shipRulesBase")}
    ${slice("shipStoredMerge")}
    ${slice("shipRulesFrom")}
    ${slice("shipDraftLive")}
    ${decl("MONTONIO_PRICE")}
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
      montonio: function () { return MONTONIO_PRICE; },
      live: shipDraftLive,
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
      /* `h.live()` and not the draft itself: since r22 the boxes hold the
         stored row, where an empty cell is an absent key, and the preview is
         the BILL — the same merge quoteFromRules() does on the server. The
         claim being pinned is unchanged: the preview is the customer's own
         renderer over the owner's own numbers, not a second table. */
      rules: h.live(), carriers: {
        EE: ["omniva", "smartpost", "dpd", "venipak", "unisend"],
        LV: ["omniva", "dpd", "venipak", "unisend"],
        LT: ["omniva", "dpd", "venipak", "unisend"],
        FI: ["smartpost", "dpd"], EU: [],
      },
      carrierNames: { omniva: "Omniva", smartpost: "SmartPosti", dpd: "DPD", venipak: "Venipak", unisend: "Unisend" },
      montonio: h.montonio(),
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
    // …and the storefront's gutter bleed and its 560 px floor are taken off
    // inside the panel, so all four columns fit a phone
    expect(adminCss).toMatch(/\.adm-preview \.dlv__scroll \{[^}]*margin: 0;/);
    expect(adminCss).toMatch(/\.adm-preview \.dlv__table \{[^}]*min-width: 0;/);
  });

  /* The fold's state lives in S and is redrawn from it, so the <summary>'s own
     activation behaviour must not flip `open` a second time behind the
     render. Source-level, because it is one line and there is no DOM here. */
  it("keeps the fold's open state in S rather than in the browser", () => {
    expect(src).toMatch(/d\.shippreview !== undefined\) \{[\s\S]{0,120}e\.preventDefault\(\);/);
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

describe("one rule, said once, and true of every box", () => {
  /* The old screen needed three paragraphs to explain which of its three
     tables actually billed. Ренат, 14.09.2026: «it seems to me that this
     delivery is a bit over engineered.» One sentence replaces the three,
     because there is now one rule and every box on the screen obeys it. */
  it("says what an empty box means, at the top, once", () => {
    expect(src).toContain("Пустое поле — цена Montonio, она написана под полем. ");
    expect(src).toMatch(/adm-notice">Пустое поле — цена Montonio/);
  });

  it("has dropped the three paragraphs that explained the three tables", () => {
    expect(src).not.toContain("Колонка «Пакомат» — это запасная цена.");
    expect(src).not.toContain("Наценка сама по себе ничего не меняет");
    expect(src).not.toContain("Перевозчики и наценка");
  });

  /* Every control whose removal is the point of this change. A box that
     changes no bill is worse than no box: it is an answer the owner gives
     that the shop ignores. */
  it("has no «Пакомат» column, no markup boxes and no fill button", () => {
    expect(src).not.toContain("m:parcel:");       // the column's own input key
    expect(src).not.toContain("markup:percent");
    expect(src).not.toContain("data-admshipfill");
    expect(src).not.toContain("data-shipallowlower");
    expect(src).not.toContain("Заполнить по тарифам Montonio</button>");
  });

  /* The «Самовывоз, €» box priced nothing and went on 13.09.2026 — a field
     that works on nothing is the opposite of an answer to «что из этого
     вообще работает». The fact it carried is kept as a line. */
  it("has no pickup price box left, and says pickup is free instead", () => {
    expect(src).not.toContain("m:pickup:");
    expect(src).not.toMatch(/<span>Самовывоз, €<\/span>/);
    expect(src).toContain("Самовывоза в таблице нет — он всегда бесплатный. ");
  });

  /* «—» has to be readable as «не возит» by somebody who cannot see the
     colour, so it carries a word and not only a glyph — and it must not be a
     text input, or it would read as an empty overridable box. */
  it("draws a carrier that does not serve a country as a dash, not as a box", () => {
    expect(src).toMatch(/function admRateNoneHTML\(col\) \{[\s\S]*adm-rates__dash[\s\S]*не возит/);
    expect(src).not.toMatch(/function admRateNoneHTML\(col\) \{[\s\S]{0,400}data-shiprule/);
    expect(adminCss).toMatch(/\.adm-rates__c--none \.adm-rates__dash \{/);
  });

  /* Seven columns cannot be a table on a 375 px phone, and the panel's
     sideways scrollers fade at the edge — on a screen of prices, a faded edge
     is a hidden number. So the row becomes a card there and the columns become
     labelled fields: .adm-tariffs__l is drawn into every cell and shown only
     where the header row is not. */
  it("turns every column into a labelled field on a phone", () => {
    expect(src).toMatch(/function admRateCellHTML\([\s\S]{0,200}adm-tariffs__l/);
    expect(adminCss).toMatch(/@media \(max-width: 899px\) \{[\s\S]*?\.adm-tariffs \{ grid-template-columns: 1fr 1fr;/);
    expect(adminCss).toMatch(/@media \(max-width: 899px\) \{[\s\S]*?\.adm-tariffs__l \{ display: block;/);
  });

  it("has every one of them in Estonian and English", () => {
    const keys = [
      "Пустое поле — цена Montonio, она написана под полем. Впишете своё число — покупатель заплатит его.",
      "Самовывоза в таблице нет — он всегда бесплатный. «—» — этот перевозчик в эту страну не возит.",
      "Везде взять цены Montonio",
      "не возит",
      "пусто — берётся «Остальные страны»",
      "Что увидит покупатель",
    ];
    /* `"ключ":` with no space is a dictionary entry and nothing else — the
       same phrase written into the screen is always followed by markup or by
       a ` :` of a ternary. One entry in the ET dictionary, one in the EN. */
    for (const k of keys) {
      expect([k, src.split(JSON.stringify(k) + ":").length - 1]).toEqual([k, 2]);
    }
  });

  /*
   * …and the sixth line, which is a RULE rather than a key because it carries
   * a price. «Остальные страны» → «Курьер» said «пусто — доставка бесплатна»
   * until 17.09.2026, which is what quoteFromRules() would do if
   * `methods.courier.default` could go missing — and it cannot: the panel's
   * own setShipRules() re-seeds the methods table on every whole-table save
   * and parseShippingRules() seeds the same cell on the server, so the box
   * comes back at 9,90 € and the shop goes on charging it. The one box on the
   * screen whose hint was not true of it.
   */
  it("names the price that comes back where an empty box cannot stay empty", () => {
    expect(src).not.toContain('"пусто — доставка бесплатна"');
    expect(src).toContain('<span class="adm-hint adm-hint--cell">пусто — вернётся \' +');
    expect(src).toContain('[/^пусто — вернётся (.+)$/, { ET: "tühi — tuleb tagasi $1", EN: "empty — it goes back to $1" }]');
  });
});
