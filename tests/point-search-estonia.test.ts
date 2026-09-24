/**
 * A postcode typed over Omniva's list finds the machines near it.
 *
 * Дим, /test, 24.09.2026, «Доставка по умолчанию» (bad): «Searching in
 * Estonia according to postal code does not find "nearest" or almost
 * anything close to (I searched for 10120).» The checklist has him on
 * «Пакомат Omniva». 10120 is Tallinn's city centre; the list opened on Kihnu,
 * Vormsi and Ruhnu — three islands.
 *
 * Why: Montonio's `postalCode` for an Omniva point is the machine's own
 * terminal code (96001 Tallinna Balti Jaam, 88999 Kihnu), never a postcode,
 * and the search ordered by closeness of postcodes — so it measured 10120
 * against terminal codes, and the islands' 88999/91999/93999 were the
 * «nearest». Every other carrier stores real postcodes and was right.
 *
 * The rows below are staging's own answers (GET /api/shipping/points/,
 * 24.09.2026), trimmed: Omniva's 439 Estonian points cut to 23, DPD's 358 to
 * 12, Omniva's 412 Latvian ones to 6 — every field as it came, only the ids
 * shortened.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { searchPoints, type SearchablePoint } from "@/lib/shipping/point-search";
import postcodeGeo from "@/data/postcode-geo.json";
import seed from "@/data/parcel-points.seed.json";
import { buildPostcodeGeo } from "../tools/postcode-geo.mjs";

type P = SearchablePoint & { id: string };

const OMNIVA_EE: P[] = [
  { id: "af85b46d", carrier: "omniva", name: "Rannamõisa Merepiiga tee pakiautomaat", address: "Rannamõisa küla, Merepiiga tee 8", city: "Harku vald", zip: "96451", lat: 59.438992, lng: 24.515529 },
  { id: "dfd9de86", carrier: "omniva", name: "Tartu Raadiraja 10 pakiautomaat", address: "Raadi alev, Raadiraja tn 10", city: "Tartu vald", zip: "96459", lat: 58.394026, lng: 26.750775 },
  { id: "d021873c", carrier: "omniva", name: "Tallinna Astangu Maxima X pakiautomaat", address: "Haabersti linnaosa, Astangu tn 27a", city: "Tallinn", zip: "96411", lat: 59.40525, lng: 24.638312 },
  { id: "b43859ae", carrier: "omniva", name: "Tallinna Ülemiste City Selveri pakiautomaat", address: "Lasnamäe linnaosa, Sepapaja tn 2", city: "Tallinn", zip: "96208", lat: 59.421651, lng: 24.802435 },
  { id: "133cb58b", carrier: "omniva", name: "Tallinna Viru Keskuse bussiterminali pakiautomaat", address: "Kesklinna linnaosa, Viru väljak 4", city: "Tallinn", zip: "96104", lat: 59.436135, lng: 24.756196 },
  { id: "a3072cc3", carrier: "omniva", name: "Tallinna Mähe Grossi pakiautomaat", address: "Pirita linnaosa, Randvere tee 115", city: "Tallinn", zip: "96380", lat: 59.490945, lng: 24.879067 },
  { id: "095f2c55", carrier: "omniva", name: "Tallinna Pelgulinna Selveri pakiautomaat", address: "Põhja-Tallinna linnaosa, Sõle tn 51", city: "Tallinn", zip: "96017", lat: 59.444612, lng: 24.700754 },
  { id: "1de5ed8f", carrier: "omniva", name: "Tallinna Raudalu Coop Konsumi pakiautomaat", address: "Nõmme linnaosa, Viljandi mnt 41a", city: "Tallinn", zip: "96084", lat: 59.366249, lng: 24.759516 },
  { id: "11e75f87", carrier: "omniva", name: "Vormsi pakiväljastus", address: "Hullo küla,", city: "Vormsi vald", zip: "91999", lat: 58.992369, lng: 23.243318 },
  { id: "90d1763b", carrier: "omniva", name: "Haapsalu Kaubamaja pakiautomaat", address: "Haapsalu linn, Tallinna mnt 1", city: "Haapsalu linn", zip: "96033", lat: 58.940735, lng: 23.541928 },
  { id: "2d5585a5", carrier: "omniva", name: "Tallinna Lastekodu Grossi pakiautomaat", address: "Kesklinna linnaosa, Lastekodu tn 14", city: "Tallinn", zip: "96180", lat: 59.430299, lng: 24.768273 },
  { id: "220d31eb", carrier: "omniva", name: "Tallinna Solaris Keskuse pakiautomaat", address: "Kesklinna linnaosa, Estonia pst 9", city: "Tallinn", zip: "96406", lat: 59.43386, lng: 24.750785 },
  { id: "bf8d5bfe", carrier: "omniva", name: "Kihnu pakiväljastus", address: "Linaküla,  1", city: "Kihnu vald", zip: "88999", lat: 58.132415, lng: 23.982259 },
  { id: "a2092454", carrier: "omniva", name: "Ruhnu pakiväljastus", address: "Ruhnu küla,", city: "Ruhnu vald", zip: "93999", lat: 57.802455, lng: 23.24556 },
  { id: "8fb8da5d", carrier: "omniva", name: "Saaremaa Kaubamaja pakiautomaat", address: "Kuressaare linn, Raekoja tn 1", city: "Saaremaa vald", zip: "96199", lat: 58.251815, lng: 22.485396 },
  { id: "7c4e8afb", carrier: "omniva", name: "Tallinna Stockmanni pakiautomaat", address: "Kesklinna linnaosa, Liivalaia tn 53", city: "Tallinn", zip: "96057", lat: 59.4317, lng: 24.76118 },
  { id: "ebf63a8b", carrier: "omniva", name: "Tallinna Balti Jaama pakiautomaat", address: "Põhja-Tallinna linnaosa, Toompuiestee 37", city: "Tallinn", zip: "96001", lat: 59.439807, lng: 24.736474 },
  { id: "51a15521", carrier: "omniva", name: "Pärnu Kaubamajaka pakiautomaat", address: "Pärnu linn, Papiniidu tn 8", city: "Pärnu linn", zip: "96040", lat: 58.371106, lng: 24.550329 },
  { id: "c6e58633", carrier: "omniva", name: "Pärnu Turu pakiautomaat", address: "Pärnu linn, Suur-Sepa tn 18", city: "Pärnu linn", zip: "96198", lat: 58.38221, lng: 24.50958 },
  { id: "bd450e1b", carrier: "omniva", name: "Tartu Maarjamõisa Coop Konsumi pakiautomaat", address: "Tartu linn, Ravila tn 14d", city: "Tartu linn", zip: "96384", lat: 58.369432, lng: 26.690013 },
  { id: "cde8806c", carrier: "omniva", name: "Narva Fama keskuse pakiautomaat", address: "Fama tn 10", city: "Narva linn", zip: "96072", lat: 59.37939, lng: 28.187516 },
  { id: "359a8963", carrier: "omniva", name: "Tallinna Apollo Plaza pakiautomaat", address: "Kesklinna linnaosa, Hobujaama tn 5", city: "Tallinn", zip: "96219", lat: 59.438101, lng: 24.756946 },
  { id: "56424b31", carrier: "omniva", name: "Omniva ettevõttesisene pakiautomaat", address: "", city: "Tallinn", zip: "96419", lat: null, lng: null },
];

const DPD_EE: P[] = [
  { id: "18220bdf", carrier: "dpd", name: "Automaat Kohtla-Järve Selver", address: "JÄRVEKÜLA TEE 68", city: "KOHTLA-JÄRVE", zip: "30322", lat: null, lng: null },
  { id: "73cdc766", carrier: "dpd", name: "Automaat Tallinna Viru terminal", address: "VIRU VÄLJAK 4", city: "TALLINN", zip: "10111", lat: null, lng: null },
  { id: "c107d79a", carrier: "dpd", name: "Automaat Pärnu Ülejõe Selver", address: "TALLINNA MNT 93A", city: "PÄRNU", zip: "80041", lat: null, lng: null },
  { id: "58472f03", carrier: "dpd", name: "Automaat Tallinna Laagna MiniRimi", address: "VIKERLASE TN 19", city: "TALLINN", zip: "13616", lat: null, lng: null },
  { id: "da7ad347", carrier: "dpd", name: "Automaat Tartu Aardla Selver", address: "VÕRU 77", city: "TARTU", zip: "50112", lat: null, lng: null },
  { id: "7aebb89f", carrier: "dpd", name: "Automaat Tartu Lõunakeskus", address: "LÄÄNERINGTEE 39", city: "TARTU", zip: "50501", lat: null, lng: null },
  { id: "cd4d77b7", carrier: "dpd", name: "Automaat Kohtla-Järve Virula keskus", address: "KESKALLEE 1", city: "KOHTLA-JÄRVE", zip: "30325", lat: null, lng: null },
  { id: "a50f7620", carrier: "dpd", name: "Automaat Tartu Lembitu Konsum", address: "LEMBITU 2", city: "TARTU", zip: "50406", lat: null, lng: null },
  { id: "a48d2e1f", carrier: "dpd", name: "Automaat Tartu Vahi Selver", address: "VAHI 62", city: "TARTU", zip: "50304", lat: null, lng: null },
  { id: "74161750", carrier: "dpd", name: "Automaat J. Vilmsi", address: "J. VILMSI 47", city: "TALLINN", zip: "10115", lat: null, lng: null },
  { id: "42310648", carrier: "dpd", name: "Automaat Tallinna Narva mnt Selver", address: "NARVA MNT 23", city: "TALLINN", zip: "10120", lat: null, lng: null },
  { id: "36b3efd0", carrier: "dpd", name: "Automaat Tallinna Torupilli Selver", address: "VESIVÄRAVA 37", city: "TALLINN", zip: "10126", lat: null, lng: null },
];

const OMNIVA_LV: P[] = [
  { id: "5fa503d7", carrier: "omniva", name: "Rīgas Gramzdas RIMI pakomāts", address: "Imantas 15. līnija 7", city: "Rīga", zip: "9908", lat: 56.944413, lng: 24.011813 },
  { id: "080f842e", carrier: "omniva", name: "Rīgas Pļavnieku ielas BETA pakomāts", address: "Pļavnieku iela 1A", city: "Rīga", zip: "9615", lat: 56.942744, lng: 24.207922 },
  { id: "969008e0", carrier: "omniva", name: "Ventspils T/C Tobago pakomāts", address: "Lielais prospekts 3/5", city: "Ventspils", zip: "9963", lat: 57.387718, lng: 21.580209 },
  { id: "80bf1f11", carrier: "omniva", name: "Ventspils Tārgales ielas Mini RIMI pakomāts", address: "Tārgales iela 62", city: "Ventspils", zip: "9957", lat: 57.400019, lng: 21.602782 },
  { id: "89586bc3", carrier: "omniva", name: "Rīgas Duntes ielas Neste pakomāts", address: "Dambja iela 10", city: "Rīga", zip: "9143", lat: 56.987922, lng: 24.130399 },
  { id: "2819d325", carrier: "omniva", name: "Rīgas T/C Ozols pakomāts", address: "Mazā Rencēnu iela 1", city: "Rīga", zip: "9529", lat: 56.927824, lng: 24.179811 },
];

/** Viru väljak — the middle of 10120's neighbourhood. */
const CENTRE = { lat: 59.437, lng: 24.7536 };
const km = (p: P) => {
  if (typeof p.lat !== "number" || typeof p.lng !== "number") return Infinity;
  const k = Math.cos((CENTRE.lat * Math.PI) / 180);
  return Math.hypot(p.lat - CENTRE.lat, (p.lng - CENTRE.lng) * k) * 111.2;
};
const names = (list: P[]) => list.map((p) => p.name);
const ISLANDS = ["Kihnu pakiväljastus", "Vormsi pakiväljastus", "Ruhnu pakiväljastus"];

/* The storefront's own copy, sliced out of app.js — it runs on the lists
   small enough to hold whole, which Estonia's Omniva list is. */
const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}()`);
}
function literalSrc(name: string, fallback: string): string {
  const at = src.indexOf(`var ${name} = `);
  if (at < 0) return fallback;
  const open = at + `var ${name} = `.length;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unterminated literal for ${name}`);
}
const has = (name: string) => src.includes(`function ${name}(`);
const shopSearch = new Function(
  `var POSTCODE_GEO = ${literalSrc("POSTCODE_GEO", "{}")};\n` +
    ["normZip", "isPostcodeQuery", "zipIsPostcode", "pointZip", "postcodeAnchor", "geoGap", "rankByPostcode",
      "matchesWords", "searchPoints"].filter(has).map(slice).join("\n") +
    "\nreturn searchPoints;",
)() as (points: P[], q: string, country?: string) => P[];

for (const [who, search] of [["the server", searchPoints], ["the shop", shopSearch]] as const) {
  describe(`${who}: 10120 over Estonia's Omniva list`, () => {
    it("opens on the city-centre machines, every one of the first five within 1,5 km of Viru väljak", () => {
      const got = search(OMNIVA_EE, "10120", "EE");
      const first = got.slice(0, 5);
      expect(first.map(km).every((d) => d < 1.5), names(first).join(" | ")).toBe(true);
      expect(names(first)).toEqual(expect.arrayContaining([
        "Tallinna Stockmanni pakiautomaat",
        "Tallinna Viru Keskuse bussiterminali pakiautomaat",
        "Tallinna Solaris Keskuse pakiautomaat",
      ]));
    });

    it("puts every Tallinn-area machine before any island", () => {
      const got = search(OMNIVA_EE, "10120", "EE");
      const lastNear = Math.max(...got.map((p, i) => (p.lat !== null && km(p) < 20 ? i : -1)));
      expect(lastNear).toBe(11);   // the eleven Tallinn machines and Rannamõisa, 14 km out
      for (const island of ISLANDS) expect(names(got).indexOf(island), island).toBeGreaterThan(lastNear);
    });

    it("is nearest-first all the way down; a machine with no coordinates is last, not lost", () => {
      const got = search(OMNIVA_EE, "10120", "EE");
      expect(got).toHaveLength(OMNIVA_EE.length);
      const d = got.slice(0, -1).map(km);
      for (let i = 1; i < d.length; i++) expect(d[i], String(got[i].name)).toBeGreaterThanOrEqual(d[i - 1] - 1.2);
      expect(got.at(-1)?.name).toBe("Omniva ettevõttesisene pakiautomaat");
    });

    it("reads the postcode however it is written", () => {
      const want = names(search(OMNIVA_EE, "10120", "EE"));
      for (const q of ["10 120", "EE-10120", " 10120 "]) expect(names(search(OMNIVA_EE, q, "EE")), q).toEqual(want);
    });

    it("finds the town of any Estonian postcode: Tartu, Pärnu, Narva", () => {
      expect(search(OMNIVA_EE, "50410", "EE")[0].name).toBe("Tartu Maarjamõisa Coop Konsumi pakiautomaat");
      expect(search(OMNIVA_EE, "80010", "EE")[0].city).toBe("Pärnu linn");
      expect(search(OMNIVA_EE, "20308", "EE")[0].name).toBe("Narva Fama keskuse pakiautomaat");
    });

    it("never takes a terminal code for a postcode — 96001 is not «Balti Jaam»", () => {
      // no Estonian postcode starts 96: nothing to place it by, and no terminal code to match
      expect(search(OMNIVA_EE, "96001", "EE")).toEqual([]);
    });

    it("still finds a machine by its town or street", () => {
      expect(names(search(OMNIVA_EE, "pärnu", "EE"))).toEqual(["Pärnu Kaubamajaka pakiautomaat", "Pärnu Turu pakiautomaat"]);
      expect(names(search(OMNIVA_EE, "viru väljak", "EE"))).toEqual(["Tallinna Viru Keskuse bussiterminali pakiautomaat"]);
    });
  });

  describe(`${who}: the carriers whose postcodes ARE postcodes are ordered as before`, () => {
    it("DPD: 10120 first, then the 101… of the centre, Lasnamäe's 136… after them", () => {
      const got = search(DPD_EE, "10120", "EE");
      expect(got[0].name).toBe("Automaat Tallinna Narva mnt Selver");
      expect(got.slice(1, 4).map((p) => p.zip).sort()).toEqual(["10111", "10115", "10126"]);
      expect(got.findIndex((p) => p.zip === "13616")).toBeGreaterThan(3);
    });
  });

  describe(`${who}: a country no postcode can be placed in`, () => {
    it("Latvian Omniva: a postcode finds nothing and says so, a town still finds its machines", () => {
      expect(search(OMNIVA_LV, "LV-1010", "LV")).toEqual([]);
      expect(names(search(OMNIVA_LV, "ventspils", "LV"))).toHaveLength(2);
    });
  });
}

describe("the shop and the server agree", () => {
  it("to the row, on every list and query here", () => {
    const cases: Array<[P[], string, string]> = [
      [OMNIVA_EE, "10120", "EE"], [OMNIVA_EE, "50410", "EE"], [OMNIVA_EE, "13", "EE"], [OMNIVA_EE, "96001", "EE"],
      [OMNIVA_EE, "tallinn", "EE"], [DPD_EE, "10120", "EE"], [DPD_EE, "50", "EE"], [OMNIVA_LV, "LV-1010", "LV"],
      [OMNIVA_LV, "rīga", "LV"],
    ];
    for (const [list, q, cc] of cases) {
      expect(shopSearch(list, q, cc).map((p) => p.id), `${cc} ${q}`).toEqual(searchPoints(list, q, cc).map((p) => p.id));
    }
  });
});

describe("where a postcode is", () => {
  it("app.js carries src/data/postcode-geo.json to the digit", () => {
    const shop = new Function(`return ${literalSrc("POSTCODE_GEO", "{}")};`)();
    expect(shop).toEqual(postcodeGeo);
  });

  it("the file is what tools/postcode-geo.mjs builds from the committed seed — run it after a new seed", () => {
    expect(buildPostcodeGeo((seed as { points: unknown[] }).points)).toEqual(postcodeGeo);
  });

  it("puts 101… in Tallinn's centre and 50… in Tartu", () => {
    const ee = (postcodeGeo as unknown as Record<string, Record<string, [number, number]>>).EE;
    expect(km({ id: "", lat: ee["101"][0], lng: ee["101"][1] })).toBeLessThan(1);
    expect(ee["50"][0]).toBeCloseTo(58.37, 1);
    expect(ee["50"][1]).toBeCloseTo(26.72, 1);
  });
});
