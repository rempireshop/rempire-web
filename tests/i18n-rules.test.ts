/**
 * The storefront's translation tables are hand-written JS literals inside
 * public/shop2/app.js: `UI = { ET: {...}, EN: {...} }` and the regex rule
 * list `UI_RX = [[/^…$/, { ET, EN }], …]`. A merge once dropped the comma
 * between two UI_RX entries; JS then read the next rule as an *index into the
 * previous one* (`[…][ /re/, {…} ]` — comma operator, member access), which
 * left an `undefined` slot in the array and made trText() throw on every
 * ET/EN page — the SPA never booted, while RU (no table) worked fine.
 *
 * Here the two literals are sliced out of app.js by source text and evaluated
 * in a bare VM, so the shape is checked the way the browser sees it, not the
 * way the source reads.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

function sliceLiteral(marker: string, terminator: string): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${marker}`);
  const end = src.indexOf(terminator, at);
  if (end < 0) throw new Error(`${marker} in public/shop2/app.js has no terminator ${JSON.stringify(terminator)}`);
  return src.slice(at + marker.length, end + terminator.length).replace(/;\s*$/, "");
}

type Rule = [RegExp, { ET: string; EN: string }];
const UI = runInNewContext("(" + sliceLiteral("var UI = ", "\n  };") + ")") as { ET: Record<string, string>; EN: Record<string, string> };
const UI_RX = runInNewContext("(" + sliceLiteral("var UI_RX = ", "\n  ];") + ")") as Array<Rule | undefined>;

describe("UI_RX — the regex translation rules", () => {
  it("has no holes and every entry is [RegExp, {ET, EN}]", () => {
    expect(UI_RX.length).toBeGreaterThan(50);
    const bad: string[] = [];
    UI_RX.forEach((e, i) => {
      const prev = UI_RX[i - 1]?.[0]?.source ?? "(start)";
      if (!e) return bad.push(`#${i} is ${String(e)} (after ${prev}) — a missing comma between two entries?`);
      const [rx, t] = e;
      if (!rx || typeof (rx as RegExp).test !== "function") bad.push(`#${i}: first element is not a RegExp (after ${prev})`);
      if (!t || typeof t.ET !== "string" || typeof t.EN !== "string") bad.push(`#${i} ${rx?.source}: needs string ET and EN`);
    });
    expect(bad).toEqual([]);
  });

  it("never asks for a capture group the regex does not have", () => {
    const bad: string[] = [];
    for (const e of UI_RX) {
      if (!e) continue;
      const groups = new RegExp(e[0].source + "|").exec("")!.length - 1;
      for (const lang of ["ET", "EN"] as const) {
        for (const m of e[1][lang].matchAll(/\$(\d)/g)) {
          if (+m[1] < 1 || +m[1] > groups) bad.push(`${e[0].source} ${lang} uses ${m[0]} but the regex has ${groups} group(s)`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("anchors every rule so it cannot fire on a substring", () => {
    const loose = UI_RX.filter((e) => e && !e[0].source.startsWith("^")).map((e) => e![0].source);
    expect(loose).toEqual([]);
  });
});

describe("UI — the ET and EN dictionaries", () => {
  it("are plain string-to-string tables of comparable size", () => {
    for (const lang of ["ET", "EN"] as const) {
      const table = UI[lang];
      expect(Object.keys(table).length).toBeGreaterThan(500);
      const nonString = Object.entries(table).filter(([, v]) => typeof v !== "string").map(([k]) => k);
      expect(nonString).toEqual([]);
    }
    const onlyEt = Object.keys(UI.ET).filter((k) => !(k in UI.EN));
    const onlyEn = Object.keys(UI.EN).filter((k) => !(k in UI.ET));
    expect({ onlyEt, onlyEn }).toEqual({ onlyEt: [], onlyEn: [] });
  });
});

/* trText()'s own loop, to the letter: the dictionary first, then the FIRST
   UI_RX rule that matches — which is why a rule's position in the list is a
   fact about behaviour and not about tidiness. */
function tr(s: string, lang: "ET" | "EN"): string {
  const d = UI[lang];
  if (d[s]) return d[s];
  for (const e of UI_RX) {
    if (!e) continue;
    const m = s.match(e[0]);
    if (m) return e[1][lang].replace(/\$(\d)/g, (_, n) => d[m[+n]] || m[+n]);
  }
  return s;
}

/* Scoped promo codes (db/migrations/170_promo_scope.sql). Every sentence the
   shopper and the owner read about a scope carries a brand name, a product
   name or a sum inside it, so each is a UI_RX rule rather than a key — and two
   of them are near-misses of rules that were already there. «Код действует от
   … — добавьте ещё на …» has existed since the codes did and matches the
   scoped variants too; if it came first, an English checkout would read «The
   code applies from 40,00 € товаров Davines». */
describe("UI_RX — the scoped-promo sentences", () => {
  const CYR = /[А-Яа-яЁё]/;
  /* A product name is not translated by these rules — it travels through $1
     and is turned into ET/EN by trName(), which needs the element to sit
     inside NAME_CTX (see the last test here). So the fixtures below use a
     wholly Latin product name: what is being checked is the SENTENCE around
     the name, and a Russian tail in the name would be somebody else's job
     reported as this one's failure. */
  const cases: Array<[string, string]> = [
    ["Скидка только на Davines: 61,00 € из 140,00 €.", "brand, at the checkout"],
    ["Скидка только на «OI Shampoo»: 20,00 € из 140,00 €.", "product, at the checkout"],
    ["В корзине нет товаров Davines — код действует только на них.", "nothing matched"],
    ["Код действует от 40,00 € товаров Davines — добавьте ещё на 12,00 €.", "floor, brand"],
    ["Код действует от 40,00 € по этому товару — добавьте ещё на 12,00 €.", "floor, product"],
    ["на бренд Davines", "the codes list"],
    ["на товар «OI Shampoo»", "the codes list"],
    ["только на бренд Davines · 61,00 € из 140,00 €", "the order card"],
    ["только на товар «OI Shampoo» · 20,00 € из 140,00 €", "the order card"],
    // …and the whole-basket floor the first of these must not have displaced
    ["Код действует от 40,00 € — добавьте ещё на 12,00 €.", "floor, whole basket"],
  ];

  it("translates each of them, leaving no Russian behind", () => {
    const left: string[] = [];
    for (const [ru, where] of cases) {
      for (const lang of ["ET", "EN"] as const) {
        const out = tr(ru, lang);
        if (out === ru) left.push(`${lang} ${where}: no rule matched «${ru}»`);
        else if (CYR.test(out)) left.push(`${lang} ${where}: «${out}» still has Russian in it`);
      }
    }
    expect(left).toEqual([]);
  });

  it("keeps the brand and the product names out of the translator's hands", () => {
    // a name is a proper noun: it travels through $1 unchanged, in both languages
    expect(tr("на бренд Davines", "EN")).toContain("Davines");
    expect(tr("на бренд Davines", "ET")).toContain("Davines");
    expect(tr("Скидка только на Davines: 61,00 € из 140,00 €.", "EN")).toContain("61,00 €");
  });

  it("puts the scoped floor ahead of the whole-basket one", () => {
    const scoped = UI_RX.findIndex((e) => e && e[0].source.includes("Код действует от (.+) товаров"));
    const plain = UI_RX.findIndex((e) => e && e[0].source === "^Код действует от (.+) — добавьте ещё на (.+)\\.$");
    expect(scoped).toBeGreaterThanOrEqual(0);
    expect(plain).toBeGreaterThanOrEqual(0);
    expect(scoped).toBeLessThan(plain);
  });

  it("puts the product rule ahead of the brand one, so «…» is not swallowed", () => {
    const product = UI_RX.findIndex((e) => e && e[0].source.includes("Скидка только на «"));
    const brand = UI_RX.findIndex((e) => e && e[0].source === "^Скидка только на (.+): (.+) из (.+)\\.$");
    expect(product).toBeGreaterThanOrEqual(0);
    expect(brand).toBeGreaterThan(product);
  });

  /* The product name inside those sentences is translated by trName(), and
     translateTree() only calls trName() for a node that sits inside one of
     NAME_CTX's selectors. The three places a scoped code prints a product name
     are the checkout's note (.cosum__scope), the codes list and the order card
     (both .adm-row__sub) — drop either selector and an English panel starts
     reading «on “Bio Botanical Shampoo — шампунь”». */
  it("keeps the classes those sentences are rendered in inside NAME_CTX", () => {
    const at = src.indexOf("var NAME_CTX =");
    expect(at).toBeGreaterThan(0);
    const decl = src.slice(at, src.indexOf(";", at));
    for (const sel of [".cosum__scope", ".adm-row__sub"]) expect(decl).toContain(sel);
  });
});
