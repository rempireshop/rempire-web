/**
 * «Купить через G Pay» for a signed-in customer whose account already filled
 * the checkout (Dim, 23.09.2026, option «A»): the checkout opens on the first
 * step that still needs the shopper, judged by the same tests the «Далее»
 * buttons make — 3 («Оплата») when contact and delivery are complete.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(path.join(process.cwd(), "public", "shop2", "app.js"), "utf8");

function fn(name: string): string {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", at); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`unbalanced ${name}()`);
}

type World = {
  email: string;
  shipMissing: string[];
  pointMissing: boolean;
  digital: boolean;
  giftBad: boolean;
};

function firstOpen(w: World): number {
  const run = new Function(
    "S", "shipMissing", "pointMissing", "isDigital", "giftToEmailBad",
    `${fn("coFirstOpenStep")}\nreturn coFirstOpenStep();`,
  );
  return run(
    { email: w.email },
    () => w.shipMissing,
    () => w.pointMissing,
    () => w.digital,
    () => w.giftBad,
  ) as number;
}

const complete: World = { email: "dim@example.com", shipMissing: [], pointMissing: false, digital: false, giftBad: false };

describe("coFirstOpenStep — where the checkout opens for a filled account", () => {
  it("opens on «Оплата» when contact and delivery are complete", () => {
    expect(firstOpen(complete)).toBe(3);
  });

  it("stops at the contact step when the e-mail is missing or not an address", () => {
    expect(firstOpen({ ...complete, email: "" })).toBe(1);
    expect(firstOpen({ ...complete, email: "dim@" })).toBe(1);
  });

  it("stops at delivery when a field, the parcel machine or a gift recipient is missing", () => {
    expect(firstOpen({ ...complete, shipMissing: ["phone"] })).toBe(2);
    expect(firstOpen({ ...complete, pointMissing: true })).toBe(2);
    expect(firstOpen({ ...complete, digital: true, giftBad: true })).toBe(2);
    // a recipient e-mail only matters on an all-gift-card order
    expect(firstOpen({ ...complete, digital: false, giftBad: true })).toBe(3);
  });
});

describe("the wallet button uses it only for a signed-in customer", () => {
  it("skips steps behind S.loggedIn, after the checkout has opened", () => {
    const at = src.indexOf("addToCart(d.buynow); go(\"checkout\");");
    expect(at).toBeGreaterThan(0);
    const handler = src.slice(at, at + 600);
    expect(handler).toMatch(/if \(S\.loggedIn\) \{\s*var open = coFirstOpenStep\(\);/);
    expect(handler).toMatch(/if \(open > 1\) \{ S\.coStep = open; render\(\);/);
  });
});
