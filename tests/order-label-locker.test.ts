/**
 * «Размер ячейки» on the order card — where it is asked, and where it is not.
 *
 * Ренат, /test checklist, order-label (23.09.2026): «There are no locker sizes
 * anywhere now — I just see box size and I can change it on a paid order. Not
 * sure if bug or feature.» A feature, and this pins which: Montonio takes a
 * locker door (`lockerSize`) on Unisend, SmartPosti and Latvian Post labels
 * only (takesLockerSize, src/lib/shipping/parcel.ts); for Omniva and DPD the
 * carrier picks the door, and the card says so in a line instead of chips.
 * The box is the one thing every paid, unlabelled parcel order may change.
 *
 * The card's own admShipPrepHTML(), sliced out of public/shop2/app.js and
 * rendered for one order per carrier.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { takesLockerSize } from "@/lib/shipping/parcel";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(name);
}
function literal(name: string): string {
  const at = src.indexOf(`var ${name} = `);
  return src.slice(at + `var ${name} = `.length, src.indexOf(";", at));
}

const card = new Function(`
  var S = { lockerSize: "", boxOpen: false, boxOverride: null };
  var LOCKER_SIZES = ${literal("LOCKER_SIZES")};
  var LOCKER_CARRIERS = ${literal("LOCKER_CARRIERS")};
  function esc(s) { return String(s); }
  function loadAdminPricing() {}
  function parcelConf() { return { length: 25, width: 18, height: 8, lockerSize: "S", recent: [] }; }
  function parcelVolKg() { return 0.9; }
  function parcelDeclaredKg() { return 0.9; }
  function kgNum(n) { return String(n).replace(".", ","); }
  function suggestLocker() { return "S"; }
  function lockerReason() { return "обычно S"; }
  ${slice("admLockerOrder")}
  ${slice("admLockerSilent")}
  ${slice("admShipPrep")}
  ${slice("admBoxPick")}
  ${slice("admLockerPick")}
  ${slice("admBoxLine")}
  ${slice("admShipPrepHTML")}
  return admShipPrepHTML;
`)() as (v: unknown) => string;

/** A paid, unlabelled order to a parcel machine of this carrier. */
const order = (carrier: string, extra: Record<string, unknown> = {}) => ({
  paid: true, labeled: false, pickup: false, digital: false,
  srv: { shipping: { method: "parcel", carrier, pointId: "1" } },
  ...extra,
});
const chips = (html: string) => (html.match(/data-lockersize="/g) ?? []).length;
const SILENT = "Размер ячейки у этого перевозчика не выбирается — дверцу он подберёт сам.";

describe("the order card: «Размер ячейки»", () => {
  it("offers the five doors on a SmartPosti and on a Unisend order", () => {
    for (const c of ["smartpost", "unisend"]) {
      const html = card(order(c));
      expect([c, chips(html)]).toEqual([c, 5]);
      expect(html).not.toContain(SILENT);
      expect(takesLockerSize(c)).toBe(true);
    }
  });

  it("says why there are none on Omniva and DPD — the carrier picks the door", () => {
    for (const c of ["omniva", "dpd", "novapost"]) {
      const html = card(order(c));
      expect([c, chips(html)]).toEqual([c, 0]);
      expect(html).toContain(SILENT);
      expect(takesLockerSize(c)).toBe(false);
    }
  });

  it("the box is on every paid parcel order, whichever carrier", () => {
    for (const c of ["smartpost", "unisend", "omniva", "dpd"]) {
      const html = card(order(c));
      expect(html).toContain("Коробка");
      expect(html).toContain("data-shipboxopen");
    }
  });

  it("…and none of it once the label exists, or before the order is paid", () => {
    expect(card(order("smartpost", { labeled: true }))).toBe("");
    expect(card(order("smartpost", { paid: false }))).toBe("");
  });
});
