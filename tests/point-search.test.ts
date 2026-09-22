/**
 * Finding the pickup point nearest the customer, when there is no map.
 *
 * Montonio sends no coordinates for a pickup point — none of Poland's 33 603
 * DPD points or 45 791 Nova Post ones, none of Germany's, not even Estonia's
 * DPD machines (staging, 22.09.2026). Дим asked for the next best thing: «when
 * choosing the point client can choose by his address/closest to his
 * address». Postcodes are geographic by their leading digits, so a search that
 * is a postcode orders the whole list nearest-first.
 *
 * The rows below are shaped exactly like staging's answers: Polish DPD stores
 * the postcode with no dash, Nova Post's name carries it WITH one and its zip
 * field can be empty. The server runs src/lib/shipping/point-search.ts; the
 * storefront runs its own copy on lists small enough to hold whole — the two
 * must put the same point first.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { isPostcodeQuery, normZip, searchPoints, type SearchablePoint } from "@/lib/shipping/point-search";

type P = SearchablePoint & { id: string };

const POLAND: P[] = [
  { id: "lodz-a", name: "ŁÓDŹ, FRANCISZKAŃSKA 31A", address: "FRANCISZKAŃSKA 31A", city: "ŁÓDŹ", zip: "91433" },
  { id: "zn", name: "ŻNIN, 700-LECIA 7A", address: "700-LECIA 7A", city: "ŻNIN", zip: "88400" },
  { id: "lodz-b", name: "ŁÓDŹ, PIOTRKOWSKA 2", address: "PIOTRKOWSKA 2", city: "ŁÓDŹ", zip: "90001" },
  { id: "czerna", name: "(InPost) 32-065, Polska, małopolskie, Czerna, 325, Przy OSP", address: "Czerna 325", city: "Czerna", zip: "" },
  { id: "krk", name: "(Orlen) 30-444, Polska, małopolskie, Kraków, JANA PAWŁA II", address: "Jana Pawła II", city: "Kraków", zip: "30444" },
  { id: "waw", name: "WARSZAWA, MARSZAŁKOWSKA 10", address: "MARSZAŁKOWSKA 10", city: "WARSZAWA", zip: "00950" },
  { id: "nozip", name: "Somewhere", address: "", city: "", zip: null },
];

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
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
const shopSearch = new Function(
  ["normZip", "isPostcodeQuery", "pointZip", "rankByPostcode", "matchesWords", "searchPoints"].map(slice).join("\n") +
    "\nreturn searchPoints;",
)() as (points: P[], q: string) => P[];

const ids = (list: P[]) => list.map((p) => p.id);

describe("a postcode orders the list nearest-first", () => {
  it("finds a Polish point whichever way the postcode is written", () => {
    for (const q of ["91-433", "91433", "91 433"]) {
      expect(searchPoints(POLAND, q)[0].id, q).toBe("lodz-a");
    }
  });

  it("puts the same town first on a partial postcode", () => {
    const first = ids(searchPoints(POLAND, "90"));
    expect(first[0]).toBe("lodz-b");
    expect(first.indexOf("lodz-a")).toBeLessThan(first.indexOf("waw")); // 91… is nearer 90… than 00…
  });

  it("reads the postcode out of a Nova Post name when its own field is empty", () => {
    expect(searchPoints(POLAND, "32-065")[0].id).toBe("czerna");
  });

  it("keeps a point with no postcode, last, instead of losing it", () => {
    const all = ids(searchPoints(POLAND, "00-950"));
    expect(all[0]).toBe("waw");
    expect(all).toHaveLength(POLAND.length);
    expect(all.at(-1)).toBe("nozip");
  });

  it("knows a Latvian postcode with its country prefix", () => {
    expect(normZip("LV-1010")).toBe("1010");
    expect(isPostcodeQuery("LV-1010")).toBe(true);
  });
});

describe("anything else filters by words", () => {
  it("still finds a town by name", () => {
    expect(ids(searchPoints(POLAND, "kraków"))).toEqual(["krk"]);
  });

  it("does not treat a single digit or a street as a postcode", () => {
    expect(isPostcodeQuery("7")).toBe(false);
    expect(isPostcodeQuery("Piotrkowska 2")).toBe(false);
  });
});

describe("the shop and the server agree", () => {
  it("returns the same order for every kind of query", () => {
    for (const q of ["91-433", "90", "32-065", "00950", "kraków", "łódź piotrkowska", "LV-1010", "zz"]) {
      expect(ids(shopSearch(POLAND, q)), q).toEqual(ids(searchPoints(POLAND, q)));
    }
  });
});
