/**
 * Poland, three ways, all on 20.09.2026 and all the same root: Montonio hands
 * back DPD's pickup points outside the Baltics with `lat: null, lng: null` and
 * there are 33 603 of them.
 *
 *   1. **The checkout drew a map on nothing.** «in checkout when I choose
 *      poland or other country, the map seems to show only estonia» — Leaflet,
 *      given no markers, falls back to its own default view, so a shopper who
 *      picked a Polish locker was shown Tallinn. No coordinates, no map
 *      button: `pointsHaveMap()` decides, and the list is the whole picker.
 *
 *   2. **The account asked for something it could not offer.** «in account we
 *      "load" parcel lockers but still show message that there's too many» —
 *      «Доставка по умолчанию» read the rule before the country's feed had
 *      answered, said «Выберите пакомат — тогда сохраним», and nothing came
 *      back to re-read it once the answer made the select impossible. The two
 *      lines then contradicted each other on screen. `pointsArrived()` re-runs
 *      the question with the answer in hand.
 *
 *   3. **The label card offered no door size.** «I do not have a choice for
 *      parcel locker size, only box size — is that by design?» It is:
 *      `lockerSize` is a Create Shipment field on Unisend, SmartPosti and
 *      Latvian Post only, and DPD carries every Polish locker. That was never
 *      written down where Renat could read it, so now it is.
 *
 * All three live in the panel bundle, which no unit test can execute — these
 * read the source the way the other app.js guards do.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOCKER_SIZE_CARRIERS, takesLockerSize } from "@/lib/shipping/parcel";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

/** A function's source, braces balanced. */
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

describe("no coordinates, no map", () => {
  /* pointGeo() is the whole rule — a point is mappable when it has both
     numbers — so the sweep runs it for real rather than restating it. */
  const canMap = new Function(
    "list",
    `${slice("pointGeo")}\n${slice("pointsHaveMap").replace("var all = pointsMatching();", "var all = list;")}\nreturn pointsHaveMap();`,
  ) as (list: unknown[]) => boolean;

  const TALLINN = { name: "Ülemiste", lat: 59.42, lng: 24.79 };
  const LODZ = { name: "ŁÓDŹ, FRANCISZKAŃSKA 31A", lat: null, lng: null };

  it("a Polish list cannot be mapped — every point is lat: null", () => {
    expect(canMap([LODZ, { ...LODZ, name: "WARSZAWA" }])).toBe(false);
  });

  it("an Estonian list still can", () => {
    expect(canMap([TALLINN])).toBe(true);
  });

  it("one mappable point among many is enough — the rest are counted, not hidden", () => {
    expect(canMap([LODZ, TALLINN, LODZ])).toBe(true);
  });

  it("an empty list draws no map either", () => {
    expect(canMap([])).toBe(false);
  });

  /* …and the button is behind that answer, not behind POINTS.view. While it
     was not, tapping «Карта» on a Polish list opened Leaflet on Tallinn. */
  it("the picker's map toggle is drawn only when a map is possible", () => {
    const sheet = slice("pointSheet");
    expect(sheet).toContain("var canMap = pointsHaveMap();");
    expect(sheet).toMatch(/canMap\s*\?\s*'<button class="psheet__maptoggle"/);
    // and the view itself cannot be «map» without one
    expect(sheet).toContain('var mapOn = canMap && POINTS.view === "map";');
  });
});

describe("the account stops asking once the answer is in", () => {
  const arrived = slice("pointsArrived");

  it("re-reads the waiting row when the list lands", () => {
    /* The order matters: the re-read happens BEFORE the repaint, so the line
       the shopper sees is already the settled one. */
    const at = arrived.indexOf('if (S.acctSt.ship === "need") acctShipChanged();');
    expect(at, "pointsArrived() no longer re-reads the account row").toBeGreaterThan(-1);
    expect(arrived.indexOf("render();", at), "the repaint has to come after the re-read").toBeGreaterThan(at);
  });

  it("and acctShipChanged() is the thing that can now save", () => {
    /* It refuses only while a machine could still be picked here; a country
       whose machines do not fit in one list has no select to pick from, so
       the country and the carrier save without one. */
    expect(slice("acctShipChanged")).toContain(
      'if (d.method === "parcel" && !d.machine && !acctMachinesTooMany()) { acctSt("ship", "need"); return; }',
    );
  });

  it("the hint and the status line can no longer both be on screen", () => {
    /* The hint says the machine is picked at the checkout; the status line
       asks for one here. Both are drawn from the same fact, so the pair is
       only possible while `ship` is stuck on «need» — which is what the
       re-read above ends. This pins the two readers to the one question. */
    expect(src).toContain("if (acctMachinesTooMany()) {");
    expect(slice("acctMachinesTooMany")).toContain('POINTS.big[x.pm + ":" + acctShipCountry()]');
  });
});

describe("the door size is the carrier's business, and the card says so", () => {
  it("DPD takes no locker size — so a Polish locker never shows the chips", () => {
    expect(takesLockerSize("dpd")).toBe(false);
    expect(LOCKER_SIZE_CARRIERS).not.toContain("dpd");
    // …and the ones that do still do
    expect(takesLockerSize("unisend")).toBe(true);
    expect(takesLockerSize("smartpost")).toBe(true);
  });

  it("the panel's own list is the server's list, minus the carrier it cannot sell", () => {
    /* latvian_post is in the server list because the reference names it; the
       shop cannot pick it, so the panel does not offer its chips. Everything
       the panel DOES offer has to be a carrier the server will send it for,
       or the chips choose a door that never reaches Montonio. */
    const at = src.indexOf("var LOCKER_CARRIERS = [");
    expect(at, "public/shop2/app.js no longer declares LOCKER_CARRIERS").toBeGreaterThan(-1);
    const list = [...src.slice(at, src.indexOf("];", at)).matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(list.length).toBeGreaterThan(0);
    for (const c of list) expect(takesLockerSize(c), `the panel offers door sizes for ${c}`).toBe(true);
  });

  it("a locker order without the chips explains itself instead of showing nothing", () => {
    const silent = slice("admLockerSilent");
    // never both: the chips and the line are the two halves of one answer
    expect(silent).toContain("if (admLockerOrder(v)) return false;");
    // …and only where a door would have made sense at all — a parcel, unlabelled
    expect(silent).toContain('String(sh.method || "").toLowerCase() === "parcel"');
    expect(silent).toContain("v.labeled");
    expect(src).toContain("Размер ячейки у этого перевозчика не выбирается — дверцу он подберёт сам.");
  });

  it("the box stays his to set on exactly those orders", () => {
    /* It is the only thing on that card that costs money on a DPD parcel —
       Montonio bills the greater of the real weight and the box's volume —
       so it must not have gone away with the chips. */
    expect(slice("admShipPrep")).toContain("return !!v && v.paid && !v.labeled && !v.pickup && !v.digital;");
    expect(src).toContain("Это только для этой посылки — коробка магазина не меняется.");
  });
});
