/**
 * «Доставка и оплата» lists every country the shop delivers to (Dim,
 * owner-approved 02.11.2026).
 *
 * Until then the page's table had the four home rows and ONE more —
 * «Другие страны Европы — от 5,49 € / от 7,09 € / 200 €» — and the English
 * intro said «…Finland and the rest of Europe». The shop serves 25
 * countries: the EU without Cyprus and Malta. Norway, Switzerland, the UK,
 * Iceland and Liechtenstein are off, and «the rest of Europe» promised them.
 *
 * Now every European country the owner has left on has a row of its own,
 * folded under «Ещё 21 страна ЕС», and the intro counts them. What this file
 * holds down:
 *
 *   · the list is the checkout's: DELIVERY_EUROPE = EUROPE_ISO in app.js =
 *     EUROPE in src/lib/shipping.ts, minus settings.shipping_rules.countriesOff
 *     — a country switched off leaves the page and the count by itself;
 *   · every row's prices are what the till bills (quoteFromRules() over the
 *     same stored row, carrier by carrier), its carriers the ones the checkout
 *     offers, its «Бесплатно от» the checkout's threshold — and the cheapest of
 *     them is what the Organization's ShippingService JSON-LD states;
 *   · the intro and the fold's summary in three languages, with Russian's
 *     three plural forms, and never «the rest of Europe» again;
 *   · the live page and the prerendered one are the same page: the shop
 *     renders in Russian and translateTree() rewrites the text nodes, the
 *     prerender translates as it writes — both come out identical, rows in the
 *     same order (the reader's alphabet), word for word.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { shippingTerms } from "@/lib/merchant-feed";
import { esc } from "@/lib/seo-head.mjs";
import { seoShipCount } from "@/lib/seo-copy.mjs";
import { EUROPE, parseShippingRules, pickupOffered, quoteFromRules } from "@/lib/shipping";
import { offeredCarriers } from "@/lib/shipping/country-prices";
import { liftDelivery } from "../tools/lib/delivery-lift.mjs";
import { deliveryFromPage } from "../tools/lib/llms-txt.mjs";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const APP = read("../public/shop2/app.js");
const D = liftDelivery(APP);

/* the shop's translator, lifted the way the prerender lifts it */
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
].join("\n") + "\ntrText;") as (s: string, lang: string, allowName?: boolean) => string;

type Lang = "RU" | "ET" | "EN";
const LANGS: Lang[] = ["RU", "ET", "EN"];
/** app.js eur() / the prerender's eurFor(): «6,89 €», «€6.89». */
const eurOf = (lang: Lang) => (n: number) => {
  const v = (Math.round(n * 100) / 100).toFixed(2);
  return lang === "EN" ? "€" + v.replace(".00", "") : v.replace(".", ",").replace(",00", "") + " €";
};
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

/* settings.shipping_rules as the live shop stores it: the owner's two
   thresholds, the seven Montonio cannot reach switched off, no price cell */
const LIVE_ROW = {
  freeFrom: 70,
  freeFromByCountry: { FI: 200, EU: 200 },
  methods: { parcel: {}, courier: {}, pickup: {} },
  carriers: {},
  countriesOff: ["CH", "CY", "GB", "IS", "LI", "MT", "NO"],
  pickupOff: [],
};
const SERVED = ["AT", "BE", "BG", "CZ", "DE", "DK", "ES", "FR", "GR", "HR", "HU", "IE", "IT", "LU", "NL", "PL", "PT", "RO", "SE", "SI", "SK"];

/** The page as the prerender writes it in `lang` — the dictionary applied as it goes. */
function staticPage(raw: unknown, lang: Lang): string {
  return D.page({
    lang, tr: (s: string) => trText(s, lang, false), esc, eur: eurOf(lang), title: "X",
    rules: D.liveRules(raw), carriers: D.carriers, carrierNames: D.carrierNames, rows: D.rows, montonio: D.montonio,
    europe: D.europe, courierCarriers: D.courierCarriers,
    address: "Mardi 1, 10145 Tallinn", hoursHTML: "", phoneHTML: "", mailHTML: "", logos: {}, banks: null,
    loyalty: { enabled: false, earnPct: 5 }, link: (_s: string, label: string) => esc(label), legalHtml: "",
  }) as string;
}

/** …and as the shop draws it: Russian text, sorted by the reader's names (screenDelivery's `collate`), then translateTree(). */
function livePage(raw: unknown, lang: Lang): string {
  const html = D.page({
    lang, tr: (s: string) => s, collate: (s: string) => trText(s, lang), esc, eur: eurOf(lang), title: "X",
    rules: D.liveRules(raw), carriers: D.carriers, carrierNames: D.carrierNames, rows: D.rows, montonio: D.montonio,
    europe: D.europe, courierCarriers: D.courierCarriers,
    address: "Mardi 1, 10145 Tallinn", hoursHTML: "", phoneHTML: "", mailHTML: "", logos: {}, banks: null,
    loyalty: { enabled: false, earnPct: 5 }, link: (_s: string, label: string) => esc(label), legalHtml: "",
  }) as string;
  if (lang === "RU") return html;
  /* translateTree(): every text node with Cyrillic in it, trimmed, through
     trText — and the aria-label / title / placeholder attributes */
  return html
    .replace(/>([^<]+)</g, (m, raw: string) => {
      const t = raw.trim();
      if (!t || !/[А-Яа-яЁё]/.test(t)) return m;
      return ">" + raw.replace(t, trText(t, lang, false)) + "<";
    })
    .replace(/ (aria-label|title|placeholder)="([^"]*)"/g, (m, a: string, v: string) =>
      /[А-Яа-яЁё]/.test(v) ? " " + a + '="' + trText(v, lang, false) + '"' : m);
}

type Row = { country: string; carriers: string; locker: string; courier: string; free: string };
/** The European fold's rows, in page order — the column labels inside each cell dropped. */
function euRows(html: string): Row[] {
  const table = (/<table class="dlv__eu">([\s\S]*?)<\/table>/.exec(html) || [])[1] || "";
  return (table.split("<tbody>")[1] || "").split("</tr>").filter((tr) => tr.includes('<th scope="row">')).map((tr) => {
    const th = /<th scope="row">([\s\S]*?)<\/th>/.exec(tr)![1];
    const cells = [...tr.matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => text(m[1].replace(/<span class="dlv__lbl">[\s\S]*?<\/span>/, "")));
    return {
      country: text(th.replace(/<small[\s\S]*?<\/small>/, "")),
      carriers: text((/<small[^>]*>([\s\S]*?)<\/small>/.exec(th) || [])[1] || ""),
      locker: cells[0], courier: cells[1], free: cells[2],
    };
  });
}
const intro = (html: string) => text((/<p class="sec__intro">([\s\S]*?)<\/p>/.exec(html) || [])[1] || "");
const summary = (html: string) => text((/<details class="dlv__all"><summary>([\s\S]*?)<\/summary>/.exec(html) || [])[1] || "");

/* The Russian names, keyed by code — what the page prints in RU. */
const RU_NAME = Object.fromEntries((D.europe as Array<[string, string]>).map(([c, n]) => [c, n]));
const codeOfRu = (name: string) => Object.keys(RU_NAME).find((c) => RU_NAME[c] === name)!;

/** What the till charges, on the server, for one method in one country: «от» the cheapest when the cards differ, «—» where no locker is offered.
 *  A courier with no carrier card (a country switched back on that Montonio does not reach) is quoted without one, as shippingFor() does. */
function billed(raw: unknown, cc: string, method: "parcel" | "courier"): string {
  const rules = parseShippingRules(raw);
  if (method === "parcel" && !pickupOffered(rules, cc)) return "—";
  const carriers: Array<string | undefined> = offeredCarriers(cc, method);
  const prices = [...new Set((carriers.length ? carriers : [undefined]).map((carrier) =>
    quoteFromRules(rules, { country: cc, method, carrier, subtotal: 0 }).price))];
  const eur = eurOf("RU");
  return prices.length === 1 ? eur(prices[0]) : "от " + eur(Math.min(...prices));
}
const NAMES: Record<string, string> = { novapost: "Nova Post", dpd: "DPD", omniva: "Omniva", unisend: "Unisend", smartpost: "SmartPosti" };

describe("the countries on the page", () => {
  it("are the checkout's own list — DELIVERY_EUROPE is EUROPE_ISO in app.js and EUROPE on the server", () => {
    const iso = /var EUROPE_ISO = \[([\s\S]*?)\];/.exec(APP)![1].match(/[A-Z]{2}/g)!;
    const codes = (D.europe as Array<[string, string]>).map((r) => r[0]);
    expect(codes).toEqual(iso);
    expect([...codes].sort()).toEqual([...EUROPE].sort());
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("are one row each for the 21 European countries switched on, beside the four home rows", () => {
    const html = staticPage(LIVE_ROW, "RU");
    const rows = euRows(html);
    expect(rows.map((r) => codeOfRu(r.country)).sort()).toEqual(SERVED);
    // the home table keeps its four rows and no zone row any more
    const home = (/<table class="dlv__table">([\s\S]*?)<\/table>/.exec(html) || [])[1];
    expect(home.match(/<th scope="row">/g)).toHaveLength(4);
    expect(html).not.toContain("Другие страны Европы");
    // …and with the live rules, 4 + 21 is the count the head copy and the feed use
    expect(4 + rows.length).toBe(seoShipCount(D.liveRules(LIVE_ROW)));
  });

  it("follow a country the owner switches off — its row leaves, the count follows, in every language", () => {
    const row = { ...LIVE_ROW, countriesOff: [...LIVE_ROW.countriesOff, "SE", "DE"] };
    for (const lang of LANGS) {
      const html = staticPage(row, lang);
      expect(euRows(html), lang).toHaveLength(19);
      expect(4 + euRows(html).length).toBe(seoShipCount(D.liveRules(row)));
    }
    const ru = staticPage(row, "RU");
    expect(euRows(ru).map((r) => r.country)).not.toContain("Швеция");
    expect(euRows(ru).map((r) => r.country)).not.toContain("Германия");
    expect(summary(ru)).toBe("Ещё 19 стран ЕС");
    expect(intro(ru)).toContain("и ещё 19 стран ЕС.");
    expect(intro(staticPage(row, "EN"))).toContain("and 19 more EU countries.");
    expect(intro(staticPage(row, "ET"))).toContain("ja veel 19 ELi riiki.");
    // …and one switched back on (Norway) appears, at the price the till would bill a Norwegian parcel
    const on = { ...LIVE_ROW, countriesOff: LIVE_ROW.countriesOff.filter((c) => c !== "NO") };
    const no = euRows(staticPage(on, "RU")).find((r) => r.country === "Норвегия")!;
    expect(no).toBeTruthy();
    expect(no.courier).toBe(billed(on, "NO", "courier"));
    expect(summary(staticPage(on, "RU"))).toBe("Ещё 22 страны ЕС");
  });

  it("with every European country switched off: no fold, no line in «Сроки», the intro names four", () => {
    const row = { ...LIVE_ROW, countriesOff: [...EUROPE] };
    const ru = staticPage(row, "RU");
    expect(ru).not.toContain("dlv__all");
    expect(intro(ru)).toBe("Отправляем из Таллинна по Эстонии, в Латвию, Литву и Финляндию. Ниже — способы доставки, сроки, цены и как можно заплатить.");
    expect(text((/<dl class="dlv__times">([\s\S]*?)<\/dl>/.exec(ru) || [])[1])).not.toContain("3–8");
    expect(intro(staticPage(row, "EN"))).toBe("We ship from Tallinn across Estonia, to Latvia, Lithuania and Finland. Below: delivery methods, times, prices and ways to pay.");
    expect(intro(staticPage(row, "ET"))).toBe("Saadame Tallinnast üle Eesti, Lätti, Leetu ja Soome. Allpool on tarneviisid, tarneajad, hinnad ja makseviisid.");
  });
});

describe("every row's prices are the checkout's", () => {
  for (const [label, raw] of [["the live row", LIVE_ROW], ["no row at all", null]] as const) {
    it(`locker and courier, carrier by carrier, with ${label}`, () => {
      const rows = euRows(staticPage(raw, "RU"));
      expect(rows.length).toBeGreaterThanOrEqual(21);
      for (const r of rows) {
        const cc = codeOfRu(r.country);
        expect(r.locker, `${cc} locker`).toBe(billed(raw, cc, "parcel"));
        expect(r.courier, `${cc} courier`).toBe(billed(raw, cc, "courier"));
      }
    });
  }

  it("Greece has a courier and no locker; Poland's locker is Nova Post's 5,49 €", () => {
    const rows = euRows(staticPage(LIVE_ROW, "RU"));
    const gr = rows.find((r) => r.country === "Греция")!;
    expect(gr.locker).toBe("—");
    expect(gr.courier).toMatch(/^от \d/);
    expect(gr.carriers).toBe("DPD · SmartPosti");
    expect(rows.find((r) => r.country === "Польша")!.locker).toBe("от 5,49 €");
  });

  it("names the carriers the checkout offers there, for a locker and at the door, in Montonio's order", () => {
    const rules = parseShippingRules(LIVE_ROW);
    for (const r of euRows(staticPage(LIVE_ROW, "RU"))) {
      const cc = codeOfRu(r.country);
      const offered = new Set([...(pickupOffered(rules, cc) ? offeredCarriers(cc, "parcel") : []), ...offeredCarriers(cc, "courier")]);
      const want = ["novapost", "dpd", "omniva", "unisend", "smartpost"].filter((k) => offered.has(k)).map((k) => NAMES[k]);
      expect(r.carriers, cc).toBe(want.join(" · "));
    }
  });

  it("free from the checkout's own threshold — the zone's 200 €, not the home countries' 70 €", () => {
    const rules = parseShippingRules(LIVE_ROW);
    for (const r of euRows(staticPage(LIVE_ROW, "RU"))) {
      const cc = codeOfRu(r.country);
      const free = quoteFromRules(rules, { country: cc, method: "courier", subtotal: 0 }).freeFrom;
      expect(r.free, cc).toBe(eurOf("RU")(free as number));
    }
    // a country's own key beats the zone's, on the page as at the till
    const own = { ...LIVE_ROW, freeFromByCountry: { ...LIVE_ROW.freeFromByCountry, PL: 90, GR: null } };
    const rows = euRows(staticPage(own, "RU"));
    expect(rows.find((r) => r.country === "Польша")!.free).toBe("90 €");
    expect(rows.find((r) => r.country === "Греция")!.free).toBe("не бывает");
  });

  it("a country whose lockers the owner switched off shows a dash and only its couriers", () => {
    const row = { ...LIVE_ROW, pickupOff: ["PL"] };
    const pl = euRows(staticPage(row, "RU")).find((r) => r.country === "Польша")!;
    expect(pl.locker).toBe("—");
    expect(pl.locker).toBe(billed(row, "PL", "parcel"));
    expect(pl.carriers).toBe("Nova Post · DPD · SmartPosti");
    expect(pl.courier).toBe(billed(row, "PL", "courier"));
  });

  it("agrees with the Organization's ShippingService JSON-LD: its rate is the row's cheapest, its threshold the row's", () => {
    const terms = new Map(shippingTerms(parseShippingRules(LIVE_ROW)).map((t) => [t.country, t]));
    const num = (s: string) => (s === "—" ? Infinity : Number(s.replace(/^от /, "").replace(" €", "").replace(",", ".")));
    for (const r of euRows(staticPage(LIVE_ROW, "RU"))) {
      const cc = codeOfRu(r.country);
      const t = terms.get(cc)!;
      expect(t, cc).toBeTruthy();
      expect(Math.min(num(r.locker), num(r.courier)), cc).toBeCloseTo(t.price, 2);
      expect(num(r.free), cc).toBe(t.freeFrom);
    }
    // and the JSON-LD covers exactly the page's countries
    expect([...terms.keys()].filter((c) => !["EE", "LV", "LT", "FI"].includes(c)).sort()).toEqual(SERVED);
  });
});

describe("the words", () => {
  it("count the countries in the intro and the fold, in three languages and three Russian forms", () => {
    expect(intro(staticPage(LIVE_ROW, "RU"))).toBe(
      "Отправляем из Таллинна по Эстонии, в Латвию, Литву, Финляндию и ещё 21 страну ЕС. Ниже — способы доставки, сроки, цены и как можно заплатить.");
    expect(intro(staticPage(LIVE_ROW, "EN"))).toBe(
      "We ship from Tallinn across Estonia, to Latvia, Lithuania, Finland and 21 more EU countries. Below: delivery methods, times, prices and ways to pay.");
    expect(intro(staticPage(LIVE_ROW, "ET"))).toBe(
      "Saadame Tallinnast üle Eesti, Lätti, Leetu, Soome ja veel 21 ELi riiki. Allpool on tarneviisid, tarneajad, hinnad ja makseviisid.");
    expect(summary(staticPage(LIVE_ROW, "RU"))).toBe("Ещё 21 страна ЕС");
    expect(summary(staticPage(LIVE_ROW, "EN"))).toBe("21 more EU countries");
    expect(summary(staticPage(LIVE_ROW, "ET"))).toBe("Veel 21 ELi riiki");
    // one left on: the singular, in all three
    const one = { ...LIVE_ROW, countriesOff: [...EUROPE].filter((c) => c !== "PL") };
    expect(summary(staticPage(one, "RU"))).toBe("Ещё 1 страна ЕС");
    expect(intro(staticPage(one, "RU"))).toContain("и ещё 1 страну ЕС.");
    expect(summary(staticPage(one, "EN"))).toBe("1 more EU country");
    expect(intro(staticPage(one, "EN"))).toContain("and 1 more EU country.");
    expect(summary(staticPage(one, "ET"))).toBe("Veel 1 ELi riik");
    const three = { ...LIVE_ROW, countriesOff: [...EUROPE].filter((c) => !["PL", "DE", "AT"].includes(c)) };
    expect(summary(staticPage(three, "RU"))).toBe("Ещё 3 страны ЕС");
    expect(intro(staticPage(three, "RU"))).toContain("и ещё 3 страны ЕС.");
  });

  it("never say «the rest of Europe», and leave no Russian on the ET and EN pages", () => {
    for (const lang of LANGS) {
      const html = staticPage(LIVE_ROW, lang);
      expect(text(html), lang).not.toMatch(/rest of Europe|остальн\S* Европ|mujale Euroopa|Другие страны Европы|Other European countries|Muud Euroopa riigid/);
      if (lang !== "RU") expect(text(html).match(/[А-Яа-яЁё]+/g), lang).toBeNull();
    }
  });

  it("time the fold's countries under its own name in «Сроки»", () => {
    const en = staticPage(LIVE_ROW, "EN");
    expect(en).toContain("<div><dt><span>21 more EU countries</span></dt><dd><span>3–8 working days</span></dd></div>");
  });

  it("list the countries in the reader's own alphabet", () => {
    const names = (lang: Lang) => euRows(staticPage(LIVE_ROW, lang)).map((r) => r.country);
    expect(names("EN").slice(0, 4)).toEqual(["Austria", "Belgium", "Bulgaria", "Croatia"]);
    expect(names("RU").slice(0, 4)).toEqual(["Австрия", "Бельгия", "Болгария", "Венгрия"]);
    expect(names("ET").slice(-3)).toEqual(["Taani", "Tšehhi", "Ungari"]);
    for (const lang of LANGS) {
      const n = names(lang);
      const tag = lang === "ET" ? "et" : lang === "EN" ? "en" : "ru";
      expect(n, lang).toEqual([...n].sort((a, b) => a.localeCompare(b, tag)));
    }
  });
});

describe("the live page and the prerendered one", () => {
  for (const lang of LANGS) {
    it(`are the same page in ${lang} — rows, order, prices and words`, () => {
      for (const raw of [LIVE_ROW, null, { ...LIVE_ROW, countriesOff: [...LIVE_ROW.countriesOff, "SE"], pickupOff: ["PL"] }]) {
        expect(livePage(raw, lang)).toBe(staticPage(raw, lang));
      }
    });
  }

  it("are drawn with the same tables: screenDelivery() and the prerender both hand over the European list and its couriers", () => {
    const screen = /function screenDelivery\(\) \{[\s\S]*?\n {2}\}\n/.exec(APP.replace(/\r\n/g, "\n"))![0];
    expect(screen).toContain("europe: DELIVERY_EUROPE, courierCarriers: COURIER_CARRIERS,");
    expect(screen).toContain("collate: function (s) { return trText(s, S.lang); },");
    const tool = read("../tools/prerender-shop2.mjs");
    expect(tool.match(/europe: DELIVERY\.europe, courierCarriers: DELIVERY\.courierCarriers/g)).toHaveLength(2);
  });

  it("feed llms.txt every country, each with the fold's delivery time", () => {
    const facts = deliveryFromPage(staticPage(LIVE_ROW, "EN"));
    expect(facts.rows).toHaveLength(25);
    const at = facts.rows.find((r: { country: string }) => r.country === "Austria")!;
    expect(at).toMatchObject({ carriers: "Nova Post · DPD · SmartPosti", locker: "from €9.59", free: "€200", days: "3–8 working days" });
    expect(facts.rows.find((r: { country: string }) => r.country === "Greece")!.locker).toBe("—");
    expect(facts.rows.find((r: { country: string }) => r.country === "Estonia")!.days).toBe("1–3 working days");
  });
});
