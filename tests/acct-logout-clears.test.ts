/**
 * «Выйти» leaves no personal details in the open page (24.09.2026): the
 * account filled the checkout's e-mail, name, phone, courier address and
 * parcel machine, and before this they survived the sign-out — on a shared
 * computer the next person's checkout opened on the last one's details.
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

describe("acctForget — signing out empties the checkout's personal fields", () => {
  it("clears e-mail, name, phone, address and parcel machine; keeps method and carrier", () => {
    const S: Record<string, unknown> = {
      email: "dim@example.com",
      ship: { name: "Dim", phone: "+372 5550000", addr: "Mardi 1", zip: "10145", city: "Tallinn", method: "parcel", carrier: "omniva", point: { id: "p1" } },
      emailTouched: true, shipTouched: true, shipPicked: true,
      cust: { email: "dim@example.com" }, loggedIn: true,
    };
    new Function("S", "acctHint", "acctQuiet", `${fn("acctForget")}\nacctForget();`)(S, () => {}, () => {});
    expect(S.email).toBe("");
    expect(S.ship).toEqual({ name: "", phone: "", addr: "", zip: "", city: "", method: "parcel", carrier: "omniva", point: null });
    expect(S.loggedIn).toBe(false);
    expect(S.cust).toBeNull();
    expect([S.emailTouched, S.shipTouched, S.shipPicked]).toEqual([false, false, false]);
  });
});
