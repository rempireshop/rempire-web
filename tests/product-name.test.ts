/**
 * Two copies of one rule set. The storefront translates a product's Russian
 * type tail in the browser — trName() in public/shop2/app.js with the tables
 * NAME_TAILS, TAIL_EXACT and NAME_FRAGS — and the server does the same for
 * the invoice PDF and the letters — translateProductName() in
 * src/lib/product-name.ts. Nothing but this file keeps the two equal: the
 * day a tail is added on one side only, an English invoice says «— шампунь»
 * again, and nobody notices until a customer does.
 *
 * So trName() and its three tables are sliced out of app.js by source text
 * (the way tests/i18n-rules.test.ts takes UI and tests/invoices.test.ts
 * takes the checkout's functions), evaluated in a bare VM, and run beside
 * the server's copy over every name in the catalogue and a list of names
 * built to trip a careless port. The tables are compared literally as well,
 * so a drift shows up even for a word no product uses yet.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { PRODUCT_NAME_FRAGS, PRODUCT_NAME_TAILS } from "@/lib/ai-prompts";
import { NAME_FRAGS, NAME_TAILS, TAIL_EXACT, VARIANT_UNITS, translateProductName, translateVariant } from "@/lib/product-name";

const APP_JS = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
const CATALOGUE = JSON.parse(
  readFileSync(fileURLToPath(new URL("../src/data/catalogue.min.json", import.meta.url)), "utf8"),
) as Array<{ b: string; n: string }>;
const VARIANTS = JSON.parse(
  readFileSync(fileURLToPath(new URL("../src/data/catalogue.variants.json", import.meta.url)), "utf8"),
) as Record<string, { sizes: string[] }>;

/** The literal after `var NAME = `, up to the line that closes it. */
function sliceLiteral(marker: string, terminator: string): string {
  const at = APP_JS.indexOf(marker);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${marker}`);
  const end = APP_JS.indexOf(terminator, at);
  if (end < 0) throw new Error(`${marker} in public/shop2/app.js has no terminator ${JSON.stringify(terminator)}`);
  return APP_JS.slice(at + marker.length, end + terminator.length).replace(/;\s*$/, "");
}

/** `function name(…) { … }`, braces balanced. */
function sliceFn(name: string): string {
  const start = APP_JS.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = APP_JS.indexOf("{", start); i < APP_JS.length; i++) {
    if (APP_JS[i] === "{") depth++;
    else if (APP_JS[i] === "}" && --depth === 0) return APP_JS.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

type Pair = [string, string];
type Frag = [RegExp, { ET: string; EN: string }];

const tailsSrc = sliceLiteral("var NAME_TAILS = ", "\n  };");
const fragsSrc = sliceLiteral("var NAME_FRAGS = ", "\n  ];");
const exactSrc = sliceLiteral("var TAIL_EXACT = ", "\n  };");
const appTails = runInNewContext(`(${tailsSrc})`) as Record<string, Pair>;
const appFrags = runInNewContext(`(${fragsSrc})`) as Frag[];
const appExact = runInNewContext(`(${exactSrc})`) as Record<string, Pair>;
/* The storefront's UI_RX — every regex rule of the interface, the two for a
   size label among them — and the loop trText() runs it with: the first rule
   that matches wins, and its «$1» is the match's group. */
const uiRx = runInNewContext(`(${sliceLiteral("var UI_RX = ", "\n  ];")})`) as Array<[RegExp, { ET: string; EN: string }]>;
function trRx(s: string, lang: "ET" | "EN"): string {
  for (const [rx, to] of uiRx) {
    const m = s.match(rx);
    if (m) return to[lang].replace(/\$(\d)/g, (_, n: string) => m[+n]);
  }
  return s;
}

/** The storefront's own function, closed over the storefront's own tables. */
const trName = runInNewContext(
  `var NAME_TAILS = ${tailsSrc};\nvar NAME_FRAGS = ${fragsSrc};\nvar TAIL_EXACT = ${exactSrc};\n${sliceFn("trName")}\ntrName`,
) as (s: string, lang: "ET" | "EN") => string;

/* Names built to trip a port: the whole tail known, the head known and the
   rest not, nothing known, capitals, the volume rule and its «млн» trap, a
   variant glued on after the tail, a hyphen, trailing space, Latin only. */
const AWKWARD = [
  "Davines OI Oil",
  "Byredo Gypsy Water — парфюм",
  "Чёрное мыло 666 — ручная работа",
  "Rempire Чёрное мыло 666 — ручная работа",
  "Bio Botanical Shampoo — шампунь",
  "Wood & Spice — бальзам после бритья",
  "Face Scrub — скраб для лица",
  "Sheet — тканевая маска",
  "Gel — гель для умывания",
  "Eye — крем для век",
  "LOUD — ШАМПУНЬ",
  "Mixed — Шампунь Для Волос",
  "Scalp — маска для кожи головы",
  "Spray — спрей для волос 150 мл",
  "Spray — спрей 150 млн",
  "Two — масло-бальзам",
  "Tee — футболка оверсайз",
  "Oil — гидрофильное масло",
  "Trail — шампунь ",
  "Variant — шампунь · 150 мл",
  "Both — шампунь для волос и кожи головы",
  "Dash — ",
  "— шампунь",
  "",
];

describe("product-name — the server's copy of trName()", () => {
  it("carries the storefront's three tables word for word", () => {
    expect(NAME_TAILS).toEqual(appTails);
    expect(TAIL_EXACT).toEqual(appExact);
    const flat = (rules: ReadonlyArray<readonly [RegExp, { readonly ET: string; readonly EN: string }]>) =>
      rules.map(([rx, t]) => [rx.source, rx.flags, t.ET, t.EN]);
    expect(flat(NAME_FRAGS)).toEqual(flat(appFrags));
  });

  it("agrees with the browser on every name in the catalogue, alone and with its brand", () => {
    let translated = 0;
    for (const p of CATALOGUE) {
      for (const name of [p.n, `${p.b} ${p.n}`]) {
        const et = translateProductName(name, "et");
        const en = translateProductName(name, "en");
        expect(et, `ET ${name}`).toBe(trName(name, "ET"));
        expect(en, `EN ${name}`).toBe(trName(name, "EN"));
        if (en !== name) translated++;
      }
    }
    // a port that returns its input unchanged would agree with nothing to show for it
    expect(translated).toBeGreaterThan(300);
  });

  it("agrees with the browser on the names built to trip a port", () => {
    for (const name of AWKWARD) {
      expect(translateProductName(name, "et"), `ET ${name}`).toBe(trName(name, "ET"));
      expect(translateProductName(name, "en"), `EN ${name}`).toBe(trName(name, "EN"));
    }
    // …and what that agreement means, spelled out
    expect(translateProductName("Bio Botanical Shampoo — шампунь", "en")).toBe("Bio Botanical Shampoo — shampoo");
    expect(translateProductName("Bio Botanical Shampoo — шампунь", "et")).toBe("Bio Botanical Shampoo — šampoon");
    expect(translateProductName("Чёрное мыло 666 — ручная работа", "en")).toBe("Чёрное мыло 666 — handmade");
    expect(translateProductName("Чёрное мыло 666 — ручная работа", "et")).toBe("Чёрное мыло 666 — käsitöö");
    expect(translateProductName("Davines OI Oil", "en")).toBe("Davines OI Oil");
    expect(translateProductName("Face Scrub — скраб для лица", "en")).toBe("Face Scrub — скраб для лица");
    expect(translateProductName("Wood & Spice — бальзам после бритья", "en")).toBe("Wood & Spice — balm");
    expect(translateProductName("Mixed — Шампунь Для Волос", "en")).toBe("Mixed — shampoo for hair");
    // a digit is outside the tail's alphabet: the whole tail is left alone, in the browser too
    expect(translateProductName("Spray — спрей для волос 150 мл", "en")).toBe("Spray — спрей для волос 150 мл");
  });

  it("leaves Russian alone, and any language it has no table for", () => {
    for (const p of CATALOGUE) {
      expect(translateProductName(p.n, "ru")).toBe(p.n);
      expect(translateProductName(p.n, "xx")).toBe(p.n);
      expect(translateProductName(p.n, null)).toBe(p.n);
    }
    // the order's language in any spelling the rows have carried
    for (const v of ["ET", "et-EE", "Et"]) expect(translateProductName("A — шампунь", v)).toBe("A — šampoon");
    for (const v of ["EN", "en-GB", "En"]) expect(translateProductName("A — шампунь", v)).toBe("A — shampoo");
  });

  it("hands the assistant exactly the tails both sites translate", () => {
    expect([...PRODUCT_NAME_TAILS]).toEqual([...Object.keys(appTails), ...Object.keys(appExact)]);
    expect([...PRODUCT_NAME_FRAGS]).toEqual(
      appFrags.map(([rx]) => rx.source).filter((s) => s.startsWith(" для ")).map((s) => s.trim()),
    );
    for (const tail of PRODUCT_NAME_TAILS) {
      expect(trName(`X — ${tail}`, "EN"), tail).not.toMatch(/[а-яё]/i);
      expect(trName(`X — ${tail}`, "ET"), tail).not.toMatch(/[а-яё]/i);
    }
    for (const frag of PRODUCT_NAME_FRAGS) {
      expect(trName(`X — шампунь ${frag}`, "EN"), frag).not.toMatch(/[а-яё]/i);
      expect(trName(`X — шампунь ${frag}`, "ET"), frag).not.toMatch(/[а-яё]/i);
    }
  });
});

/* ---------- the variant: «215 мл» → «215 ml» --------------------------- */

describe("product-name — the server's copy of the storefront's size rules", () => {
  it("carries the two UI_RX rules for a size label word for word", () => {
    const flat = (rules: ReadonlyArray<readonly [RegExp, { readonly ET: string; readonly EN: string }]>) =>
      rules.map(([rx, t]) => [rx.source, rx.flags, t.ET, t.EN]);
    const browser = uiRx.filter(([rx]) => / (мл|г)\$$/.test(rx.source) && rx.source.startsWith("^("));
    expect(flat(VARIANT_UNITS)).toEqual(flat(browser));
  });

  it("agrees with the browser on every size in the catalogue", () => {
    let translated = 0;
    const seen = new Set<string>();
    for (const v of Object.values(VARIANTS)) for (const size of v.sizes) seen.add(size);
    expect(seen.size).toBeGreaterThan(20);
    for (const size of seen) {
      const et = translateVariant(size, "et");
      const en = translateVariant(size, "en");
      expect(et, `ET ${size}`).toBe(trRx(size, "ET"));
      expect(en, `EN ${size}`).toBe(trRx(size, "EN"));
      expect(en, `EN ${size} still Cyrillic`).not.toMatch(/[а-яё]/i);
      expect(et, `ET ${size} still Cyrillic`).not.toMatch(/[а-яё]/i);
      if (en !== size) translated++;
    }
    expect(translated).toBeGreaterThan(10);
  });

  it("spells it out: volumes go over, sizes and Russian stay", () => {
    expect(translateVariant("215 мл", "en")).toBe("215 ml");
    expect(translateVariant("215 мл", "et")).toBe("215 ml");
    expect(translateVariant("2,5 мл", "en")).toBe("2,5 ml");
    expect(translateVariant("50 г", "en")).toBe("50 g");
    expect(translateVariant("50 г", "et")).toBe("50 g");
    expect(translateVariant("215 мл", "ru")).toBe("215 мл");
    expect(translateVariant("215 мл", null)).toBe("215 мл");
    for (const size of ["white / M", "S-M", "XL", "yellow-2", ""]) {
      for (const lang of ["en", "et", "ru"]) expect(translateVariant(size, lang), `${lang} ${size}`).toBe(size);
    }
    // the trap the storefront's rule was written around: «млн» is not a volume
    expect(translateVariant("150 млн", "en")).toBe("150 млн");
    for (const v of ["EN", "en-GB", "En"]) expect(translateVariant("215 мл", v)).toBe("215 ml");
  });
});
