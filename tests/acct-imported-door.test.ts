/**
 * The address an imported Shopify customer arrives with — the country and the
 * door, and NO delivery method.
 *
 * Dim, 28.09.2026, option b: tools/import-shopify-customers.mjs keeps the
 * customer's default address, but the import must not choose anybody's
 * delivery. So `ship_pref` is {country, method: "", carrier: "", machine: "",
 * address}, and:
 *   · the checkout opens on that country with its usual method — nothing
 *     pre-selected, the courier's boxes empty;
 *   · the moment the shopper picks «Курьер» himself, the three boxes fill with
 *     the address (fillSavedDoor, from the data-dm click) — only while they
 *     are all empty, and only for the country the address is in;
 *   · where the courier is all the country has, the checkout already stands on
 *     it, so the door comes in on arrival;
 *   · the account's «Доставка по умолчанию» shows the country with no row
 *     ticked and nothing half-filled; its «Курьер до двери» row comes up with
 *     the address in it, and a default the customer then saves works as before;
 *   · a courier default the shopper saved himself behaves exactly as before.
 *
 * The storefront half is sliced out of public/shop2/app.js by source text and
 * run against stubs, like tests/acct-courier-address.test.ts; the server half
 * runs normalizeShipPref() and the account route against PGlite.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCustomer, makeCustomerToken, normalizeShipPref, recordLogin, updateCustomer } from "@/lib/customers";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

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
function literal(name: string): string {
  const head = src.indexOf(`var ${name} = `);
  if (head < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  const from = head + `var ${name} = `.length;
  const open = src[from];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(from, i + 1);
  }
  throw new Error(`unbalanced brackets around var ${name} in app.js`);
}

type Addr = { addr: string; zip: string; city: string };
type Pref = { country: string; method: string; carrier: string; machine: string; address?: Addr };
const DOOR: Addr = { addr: "Merekalda tee 5, korter 12", zip: "10111", city: "Tallinn" };
const IMPORTED_EE: Pref = { country: "EE", method: "", carrier: "", machine: "", address: DOOR };
const SPAIN: Addr = { addr: "Calle Inventada 7", zip: "28001", city: "Madrid" };
const IMPORTED_ES: Pref = { country: "ES", method: "", carrier: "", machine: "", address: SPAIN };
const ATHENS: Addr = { addr: "Odos Invented 3", zip: "10552", city: "Athens" };
const IMPORTED_GR: Pref = { country: "GR", method: "", carrier: "", machine: "", address: ATHENS };

/* ---------- the server keeps the shape, and only whole ------------------- */

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  await setupDb();
});
afterAll(teardownDb);

describe("normalizeShipPref(): an address with no method", () => {
  it("is kept with its country and a whole address — method stays empty", () => {
    expect(normalizeShipPref(IMPORTED_EE)).toEqual(IMPORTED_EE);
    // no `method` key at all reads the same
    expect(normalizeShipPref({ country: "es", address: SPAIN })).toEqual(IMPORTED_ES);
  });

  it("is nothing without a whole address, and a made-up method is still refused", () => {
    expect(normalizeShipPref({ country: "EE", method: "" })).toBeNull();
    expect(normalizeShipPref({ country: "EE", method: "", address: { addr: "Merekalda tee 5", zip: "", city: "Tallinn" } })).toBeNull();
    expect(normalizeShipPref({ method: "", address: DOOR })).toBeNull(); // no country
    expect(normalizeShipPref({ country: "EE", method: "teleport", address: DOOR })).toBeNull();
  });

  it("changes nothing for the three methods a shopper can save", () => {
    expect(normalizeShipPref({ country: "EE", method: "courier", address: DOOR }))
      .toEqual({ country: "EE", method: "courier", carrier: "", machine: "", address: DOOR });
    expect(normalizeShipPref({ country: "EE", method: "parcel", carrier: "omniva", machine: "X", address: DOOR }))
      .toEqual({ country: "EE", method: "parcel", carrier: "omniva", machine: "X" });
    expect(normalizeShipPref({ country: "EE", method: "pickup", address: DOOR }))
      .toEqual({ country: "EE", method: "pickup", carrier: "", machine: "" });
  });

  it("the account route hands it back as it is, and the customer's own save replaces it", async () => {
    const email = "imported-door@example.com";
    await recordLogin(email, "RU");
    await updateCustomer(email, { shipPref: IMPORTED_EE });
    const { GET, PATCH } = await import("@/app/api/account/me/route");
    const cookie = `rmp_cust=${makeCustomerToken(email)}`;
    const got = await GET(new Request("https://rempireshop.com/api/account/me/", { headers: { cookie } }));
    expect(((await got.json()) as { customer: { shipPref: unknown } }).customer.shipPref).toEqual(IMPORTED_EE);
    // «Курьер до двери» ticked in the account, the door as it came up
    const mine = { country: "EE", method: "courier", carrier: "", machine: "", address: DOOR };
    const patched = await PATCH(new Request("https://rempireshop.com/api/account/me/", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json", "x-forwarded-for": "203.0.113.61" },
      body: JSON.stringify({ lang: "RU", shipPref: mine }),
    }));
    expect(patched.status).toBe(200);
    expect((await getCustomer(email))?.shipPref).toEqual(mine);
  });
});

/* ---------- the checkout ---------------------------------------------------- */

interface Checkout {
  S: { country: string; countryIso: string; shipPicked: boolean; ship: Record<string, unknown> };
  boxes: Record<string, { value: string }>;
  apply(saved?: boolean): void;
  /** What the data-dm click does, in its order: the method, the hand, then the door. */
  pick(method: string): void;
  fillSavedDoor(): boolean;
  shipMethod(): string;
  focus(k: string): void;
}
function checkout(pref: Pref | null, opts: { ship?: Partial<Addr>; onScreen?: boolean; country?: string; iso?: string; guest?: boolean } = {}): Checkout {
  const body = `
    var boxes = {}, focused = null;
    ["addr", "zip", "city"].forEach(function (k) { boxes[k] = { value: SHIP[k] || "" }; });
    var document = {
      querySelector: function (sel) { var m = /data-shipf="(\\w+)"/.exec(sel); return m && boxes[m[1]] || null; },
      get activeElement() { return focused; }
    };
    var S = {
      screen: OPTS.onScreen ? "checkout" : "product", shipPicked: false,
      country: OPTS.country || "EE", countryIso: OPTS.iso || "", cart: [],
      ship: { name: "", addr: SHIP.addr || "", zip: SHIP.zip || "", city: SHIP.city || "", phone: "", method: "parcel", carrier: "", point: null },
      cust: OPTS.guest ? null : { shipPref: PREF }
    };
    var SHIP_RULES = ${literal("SHIP_RULES")};
    var CARRIERS_BY_COUNTRY = ${literal("CARRIERS_BY_COUNTRY")};
    var COURIER_CARRIERS = ${literal("COURIER_CARRIERS")};
    var DELIVERY = ${literal("DELIVERY")};
    var COUNTRIES = ${literal("COUNTRIES")};
    var EUROPE_ISO = ${literal("EUROPE_ISO")};
    var POINTS = { by: {}, empty: {}, loading: {}, err: {}, big: {}, found: {}, finding: {}, failed: {} };
    function loadPoints() {}
    function matchAcctPoint() { return false; }
    function patchCountry() {}
    function patchDelivery() {}
    function patchSummary() {}
    ${slice("applyAcctShipPref")}
    ${slice("fillSavedDoor")}
    ${slice("shipServed")}
    ${slice("shipZoneOf")}
    ${slice("isParcel")}
    ${slice("shipMethod")}
    ${slice("giftOnlyCart")}
    ${slice("deliveryFor")}
    ${slice("carriersFor")}
    ${slice("pickupOpen")}
    ${slice("orderCountry")}
    function pick(m) {
      S.ship.method = m; S.shipPicked = true; S.ship.carrier = "";
      if (m !== "parcel") S.ship.point = null;
      if (m === "courier") fillSavedDoor();
    }
    return {
      S: S, boxes: boxes, apply: applyAcctShipPref, pick: pick, fillSavedDoor: fillSavedDoor, shipMethod: shipMethod,
      focus: function (k) { focused = boxes[k]; }
    };
  `;
  return new Function("PREF", "SHIP", "OPTS", body)(pref, opts.ship ?? {}, opts) as Checkout;
}
const boxesOf = (c: Checkout) => ({ addr: c.S.ship.addr, zip: c.S.ship.zip, city: c.S.ship.city });
const EMPTY = { addr: "", zip: "", city: "" };

describe("the checkout: the imported door waits for «Курьер»", () => {
  it("opens on the customer's country with its usual method and empty boxes", () => {
    const c = checkout(IMPORTED_EE, { onScreen: true });
    c.apply();
    expect(c.S.country).toBe("EE");
    expect(c.S.ship.method, "the import chose no delivery").toBe("parcel");
    expect(c.shipMethod()).toBe("parcel");
    expect(c.S.ship.carrier).toBe("");
    expect(boxesOf(c)).toEqual(EMPTY);
    expect(c.boxes.addr.value).toBe("");
    // …and nothing counts as picked by hand: the checkout is still the shopper's to choose
    expect(c.S.shipPicked).toBe(false);
  });

  it("a country behind «Другая страна Европы» opens on that country, method untouched", () => {
    const c = checkout(IMPORTED_ES);
    c.apply();
    expect([c.S.country, c.S.countryIso]).toEqual(["EU", "ES"]);
    expect(c.S.ship.method).toBe("parcel");
    expect(boxesOf(c)).toEqual(EMPTY);
  });

  it("the shopper's own «Курьер» fills the three boxes with the saved address", () => {
    const c = checkout(IMPORTED_EE);
    c.apply();
    c.pick("courier");
    expect(c.shipMethod()).toBe("courier");
    expect(boxesOf(c)).toEqual(DOOR);
    // the same for Spain, whose checkout country is the real one behind «EU»
    const es = checkout(IMPORTED_ES);
    es.apply();
    es.pick("courier");
    expect(boxesOf(es)).toEqual(SPAIN);
  });

  it("the click handler really does it — «Курьер» and only «Курьер»", () => {
    const handler = src.slice(src.indexOf("if (d.dm) {"), src.indexOf("if (d.carrier) {"));
    expect(handler).toContain('if (d.dm === "courier") fillSavedDoor();');
    // before the render that draws the boxes from S.ship
    expect(handler.indexOf("fillSavedDoor()")).toBeLessThan(handler.indexOf("render()"));
  });

  it("a parcel machine or the counter leaves the boxes alone", () => {
    const c = checkout(IMPORTED_EE);
    c.apply();
    c.pick("pickup");
    expect(c.fillSavedDoor()).toBe(false);
    c.pick("parcel");
    expect(c.fillSavedDoor()).toBe(false);
    expect(boxesOf(c)).toEqual(EMPTY);
  });

  it("never mixes into an address being typed", () => {
    const c = checkout(IMPORTED_EE, { ship: { addr: "Pärnu mnt 5" } });
    c.apply();
    c.pick("courier");
    expect(boxesOf(c)).toEqual({ addr: "Pärnu mnt 5", zip: "", city: "" });
  });

  it("another country picked in the checkout does not get this country's door", () => {
    const c = checkout(IMPORTED_EE);
    c.apply();
    c.S.country = "LV"; // the first select, by hand
    c.S.shipPicked = true;
    c.pick("courier");
    expect(boxesOf(c)).toEqual(EMPTY);
  });

  it("a country with nothing but the courier stands on it already — the door comes in on arrival", () => {
    const c = checkout(IMPORTED_GR, { onScreen: true });
    c.apply();
    expect([c.S.country, c.S.countryIso]).toEqual(["EU", "GR"]);
    expect(c.shipMethod()).toBe("courier");
    expect(boxesOf(c)).toEqual(ATHENS);
    expect(c.boxes.city.value, "painted in place, like a courier default").toBe("Athens");
  });

  it("a guest has no door to fill", () => {
    const c = checkout(null, { guest: true });
    c.pick("courier");
    expect(boxesOf(c)).toEqual(EMPTY);
  });

  it("a courier default the shopper saved himself: exactly as before — courier chosen, boxes filled on arrival", () => {
    const mine = { country: "EE", method: "courier", carrier: "", machine: "", address: DOOR };
    const c = checkout(mine);
    c.apply();
    expect(c.S.ship.method).toBe("courier");
    expect(boxesOf(c)).toEqual(DOOR);
    // …and a parcel default still opens on its carrier, with no door anywhere
    const parcel = checkout({ country: "EE", method: "parcel", carrier: "omniva", machine: "" });
    parcel.apply();
    expect([parcel.S.ship.method, parcel.S.ship.carrier]).toEqual(["parcel", "omniva"]);
    parcel.pick("courier");
    expect(boxesOf(parcel)).toEqual(EMPTY);
  });
});

/* ---------- the account's «Доставка по умолчанию» ----------------------------- */

interface Acct {
  S: { acctForm: { ship: Record<string, unknown> | null } };
  queued: string[];
  st: Array<[string, string]>;
  acctIdx(): number;
  acctShipCountry(): string;
  acctMachines(): unknown[] | null;
  acctPointHTML(): string;
  acctFieldDirty(f: string): boolean;
  tap(i: number): void;
  rows(): string[];
}
function account(pref: Pref): Acct {
  const body = `
    var queued = [], st = [];
    var S = {
      screen: "account", lang: "RU", country: "EE", countryIso: "",
      ship: { method: "parcel", carrier: "", point: null }, shipPicked: false,
      cust: { email: "a@example.com", shipPref: PREF },
      acctForm: { ship: null }, acctSt: { ship: "" }, pointOpen: false, pointFor: ""
    };
    var document = { querySelectorAll: function () { return []; } };
    var SHIP_RULES = ${literal("SHIP_RULES")};
    var CARRIERS_BY_COUNTRY = ${literal("CARRIERS_BY_COUNTRY")};
    var COURIER_CARRIERS = ${literal("COURIER_CARRIERS")};
    var CARRIER_NAMES = ${literal("CARRIER_NAMES")};
    var POINTS = { by: {}, empty: {}, loading: {}, err: {}, big: {}, found: {}, finding: {}, failed: {} };
    function acctSt(f, v) { S.acctSt[f] = v; st.push([f, v]); }
    function acctQueue(f) { queued.push(f); }
    function acctMachinesTooMany() { return false; }
    function loadPointsFor() {}
    function pointKind() { return "Пакомат"; }
    function acctPointButton() { return "<BUTTON>"; }
    ${slice("shipDraftFrom")}
    ${slice("acctAddrOf")}
    ${slice("acctAddrWhole")}
    ${slice("acctAddrPartial")}
    ${slice("acctAddrKey")}
    ${slice("paintAcctAddr")}
    ${slice("shipKey")}
    ${slice("acctFieldDirty")}
    ${slice("acctShipFromRow")}
    ${slice("acctShipChanged")}
    ${slice("acctIdx")}
    ${slice("methods")}
    ${slice("acctMethods")}
    ${slice("acctShipCountry")}
    ${slice("acctMachines")}
    ${slice("acctPointHTML")}
    ${slice("rowKind")}
    ${slice("shipServed")}
    ${slice("carriersFor")}
    ${slice("pickupOpen")}
    ${slice("orderCountry")}
    S.acctForm.ship = shipDraftFrom(S.cust.shipPref);
    return {
      S: S, queued: queued, st: st,
      acctIdx: acctIdx, acctShipCountry: acctShipCountry, acctMachines: acctMachines, acctPointHTML: acctPointHTML,
      acctFieldDirty: acctFieldDirty,
      rows: function () { return methods().map(rowKind); },
      // what the data-acctm click does: the row becomes the draft, and saves itself
      tap: function (i) { S.acctForm.ship = acctShipFromRow(acctShipCountry(), methods()[i]); acctShipChanged(); }
    };
  `;
  return new Function("PREF", body)(pref) as Acct;
}

describe("the account's «Доставка по умолчанию» for an imported customer", () => {
  it("shows the country with no row ticked — nothing half-filled, nothing to save", () => {
    const a = account(IMPORTED_ES);
    expect(a.acctShipCountry()).toBe("ES");
    expect(a.acctIdx(), "no row is ticked").toBe(-1);
    expect(a.S.acctForm.ship).toEqual({ country: "ES", method: "", carrier: "", machine: "" });
    // no machine button under a row nobody picked, and no courier boxes (drawn only for method "courier")
    expect(a.acctMachines()).toEqual([]);
    expect(a.acctPointHTML()).toBe("");
    expect(src).toContain('(S.acctForm.ship && S.acctForm.ship.method === "courier" ? acctAddrHTML() : "")');
    // opening the account does not send anything back
    expect(a.acctFieldDirty("ship")).toBe(false);
    expect(a.queued).toEqual([]);
  });

  it("«Курьер до двери» comes up with the imported address, and saves as the customer's own courier default", () => {
    const a = account(IMPORTED_EE);
    const courier = a.rows().indexOf("courier");
    expect(courier).toBeGreaterThan(-1);
    a.tap(courier);
    expect(a.S.acctForm.ship).toEqual({ country: "EE", method: "courier", carrier: "", machine: "", address: DOOR });
    expect(a.acctFieldDirty("ship")).toBe(true);
    expect(a.queued).toEqual(["ship"]);
    // what the server then keeps is an ordinary courier default
    expect(normalizeShipPref(a.S.acctForm.ship)).toEqual({ country: "EE", method: "courier", carrier: "", machine: "", address: DOOR });
  });

  it("a parcel row works as before: it waits for its machine and carries no door", () => {
    const a = account(IMPORTED_EE);
    const parcel = a.rows().indexOf("parcel");
    a.tap(parcel);
    expect(a.queued).toEqual([]);
    expect(a.st).toContainEqual(["ship", "need"]);
    expect((a.S.acctForm.ship as { address?: unknown }).address).toBeUndefined();
  });
});
