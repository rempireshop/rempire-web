/**
 * /llms.txt — tools/lib/llms-txt.mjs, written into public/llms.txt by every
 * prerender run from the data the pages are written from.
 *
 * Run here over the real catalogue: every section and every brand the shop
 * sells has a line, with its English, Russian and Estonian address; the
 * delivery table is read off the shipping page itself (deliveryPageHTML()
 * over the rules the checkout bills with), so its prices are the till's.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { publicPath } from "@/lib/shop-paths.mjs";
import { CAT_NAMES_I18N, esc, slugify, T } from "@/lib/seo-head.mjs";
import { liftDelivery } from "../tools/lib/delivery-lift.mjs";
import { buildLlmsTxt, deliveryFromPage } from "../tools/lib/llms-txt.mjs";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const APP = read("../public/shop2/app.js");
const CATALOGUE = new Function(read("../public/shop/catalogue2.js") + "\nreturn CATALOGUE;")() as Array<{ id: string; brand: string; cat: string }>;
const BASE = "https://rempireshop.com";

/* the shop's English, as the prerender's tr() gives it */
const lines = APP.replace(/\r\n?/g, "\n").split("\n");
const slice = (start: RegExp, end: RegExp) => {
  const i = lines.findIndex((l) => start.test(l));
  for (let j = i + 1; j < lines.length; j++) if (end.test(lines[j])) return lines.slice(i, j + 1).join("\n");
  throw new Error("no slice for " + start);
};
const trText = runInNewContext([
  slice(/^ {2}var UI = \{$/, /^ {2}[}\]];$/), slice(/^ {2}var UI_RX = \[$/, /^ {2}[}\]];$/),
  slice(/^ {2}var NAME_TAILS = \{$/, /^ {2}[}\]];$/), slice(/^ {2}var NAME_FRAGS = \[$/, /^ {2}[}\]];$/),
  slice(/^ {2}var TAIL_EXACT = \{$/, /^ {2}[}\]];$/), slice(/^ {2}function trName\(s, lang\) \{$/, /^ {2}}$/),
  slice(/^ {2}function trText\(s, lang, allowName\) \{$/, /^ {2}}$/),
].join("\n") + "\ntrText;") as (s: string, lang: string, allowName: boolean) => string;
const EN = (s: string) => trText(s, "EN", false);
const eurEN = (n: number) => "€" + (Math.round(n * 100) / 100).toFixed(2).replace(".00", "");

const D = liftDelivery(APP);
const LIVE_ROW = { freeFrom: 70, freeFromByCountry: { FI: 200, EU: 200 }, methods: { parcel: {}, courier: {}, pickup: {} }, carriers: {} };
const RULES = D.liveRules(LIVE_ROW);
const facts = deliveryFromPage(D.page({
  lang: "EN", tr: EN, esc, eur: eurEN, title: "", rules: RULES, carriers: D.carriers, carrierNames: D.carrierNames,
  rows: D.rows, montonio: D.montonio, address: "Mardi 1, 10145 Tallinn", hoursHTML: "", phoneHTML: "", mailHTML: "",
  logos: {}, banks: null, loyalty: { enabled: true, earnPct: 5 }, link: (_s: string, label: string) => esc(label), legalHtml: "",
}), { returnsHeading: EN("Возврат товара") });

const TXT = buildLlmsTxt({
  base: BASE, products: CATALOGUE,
  identity: { legalName: "Rempire Store OÜ", regCode: "12216136", vatNumber: "EE102723858", address: "Mardi 1, 10145 Tallinn", email: "info@rempireshop.com", phone: "+372 5623 7237" },
  social: ["https://www.instagram.com/rempire.shop/"], hours: [],
  policies: [{ slug: "shipping", title: "Delivery and payment" }, { slug: "returns", title: "Returns and refunds" }],
  delivery: facts, returns: facts.returns, posts: [{ title: "Paste, wax or clay", slug: "paste-wax-clay" }],
  ctx: { rules: RULES },
});

describe("llms.txt", () => {
  it("says what the shop is, where, and how its addresses work", () => {
    expect(TXT.startsWith("# REMPIRE\n\n> ")).toBe(true);
    expect(TXT).toContain("barbershop and tattoo studio at Mardi 1, 10145 Tallinn, Estonia");
    expect(TXT).toContain("Russian (https://rempireshop.com/ru), Estonian (https://rempireshop.com/et)");
    expect(TXT).toContain("products /products/<handle>");
  });

  it("lists every section with its address in all three languages", () => {
    for (const cat of ["all", "hair", "styling", "beard", "face", "body", "perfume", "merch"]) {
      const rest = "/c/" + cat + "/";
      const en = cat === "all" ? T.EN.all : CAT_NAMES_I18N[cat as keyof typeof CAT_NAMES_I18N].EN;
      expect(TXT, cat).toContain("- [" + en + "](" + BASE + publicPath("EN", rest) + "): ");
      expect(TXT, cat).toContain("(" + BASE + publicPath("RU", rest) + ")");
      expect(TXT, cat).toContain("(" + BASE + publicPath("ET", rest) + ")");
    }
  });

  it("lists every brand the catalogue sells, with its address in all three languages", () => {
    const brands = [...new Set(CATALOGUE.map((p) => p.brand))];
    expect(brands.length).toBeGreaterThan(20);
    for (const b of brands) {
      const rest = "/b/" + slugify(b) + "/";
      expect(TXT, b).toContain("- [" + b + "](" + BASE + publicPath("EN", rest) + "): ");
      expect(TXT, b).toContain(BASE + publicPath("RU", rest));
      expect(TXT, b).toContain(BASE + publicPath("ET", rest));
    }
  });

  it("prints the delivery prices the shipping page prints — the checkout's", () => {
    expect(TXT).toMatch(/\| Estonia \| DPD · Omniva · Unisend · SmartPosti \| from €2\.49 \| from €6\.89 \| €70 \| 1–3 working days \|/);
    expect(TXT).toMatch(/\| Latvia \| [^|]+ \| from €3\.79 \| from €8\.09 \| €70 \|/);
    expect(TXT).toMatch(/\| Finland \| [^|]+ \| [^|]+ \| [^|]+ \| €200 \|/);
    expect(TXT).toContain("Pickup at the salon");
    expect(TXT).not.toMatch(/[А-Яа-яЁё]{3}.*\| €/);
  });

  it("summarises returns and links the policies, contact and guides", () => {
    expect(TXT).toContain("You have 30 days");
    expect(TXT).toContain("[Refund policy](" + BASE + "/policies/refund-policy)");
    expect(TXT).toContain("[Delivery and payment](" + BASE + "/policies/shipping-policy)");
    expect(TXT).toContain("- Email: info@rempireshop.com");
    expect(TXT).toContain("[Paste, wax or clay](" + BASE + "/blogs/news/paste-wax-clay)");
  });

  it("is written by the prerender on every build and not committed", () => {
    const tool = read("../tools/prerender-shop2.mjs");
    expect(tool).toContain('await writeFile(path.join(PUB, "llms.txt"), llms, "utf8");');
    expect(tool).toContain("products: ON_SALE,");
    expect(read("../.gitignore")).toMatch(/^public\/llms\.txt$/m);
  });
});
