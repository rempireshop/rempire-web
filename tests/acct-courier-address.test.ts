/**
 * The courier's address in «Доставка по умолчанию».
 *
 * Dim, 23.09.2026: «everything set on the account → buy in 3 taps». A courier
 * default had no door to ring — the account kept {country, method, carrier,
 * machine} and nothing else — so a customer who gets his parcels to the door
 * could never buy in three taps, and typed his street into every checkout.
 *
 * The address is the checkout's courier step, field for field: «Адрес»,
 * «Индекс», «Город» ({addr, zip, city}, the order's own `shipping.address`).
 * It is saved with the rest of the default delivery (the same PATCH of
 * `shipPref`), kept by the server only whole and cleaned the way createOrder()
 * cleans an order's address, put into the checkout's boxes by
 * applyAcctShipPref(), and sent by «Купить за … с доставкой» (the express
 * half is in tests/express-buy.test.ts, PARITY — the body equals the
 * checkout's and the total equals createOrder()'s for three courier
 * defaults).
 *
 * The storefront half is sliced out of public/shop2/app.js by source text and
 * run against stubs, like tests/express-buy.test.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { getCustomer, makeCustomerToken, normalizeShipPref, recordLogin, updateCustomer } from "@/lib/customers";
import { createOrder } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

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
const MARDI: Addr = { addr: "Mardi 1", zip: "10145", city: "Tallinn" };

/* ---------- the server: kept whole, cleaned like an order's ------------- */

// one in-memory Postgres for the file; the storefront halves never touch it
beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  await setupDb();
});
afterAll(teardownDb);

describe("normalizeShipPref(): the courier's address", () => {
  it("a courier with all three fields keeps them", () => {
    expect(normalizeShipPref({ country: "EE", method: "courier", address: MARDI }))
      .toEqual({ country: "EE", method: "courier", carrier: "", machine: "", address: MARDI });
  });

  it("half an address is not kept — the checkout would not take it either", () => {
    for (const address of [
      { addr: "Mardi 1", zip: "10145" },
      { addr: "Mardi 1", zip: "   ", city: "Tallinn" },
      { addr: "", zip: "10145", city: "Tallinn" },
      "Mardi 1, 10145 Tallinn",
      ["Mardi 1", "10145", "Tallinn"],
      null,
    ]) {
      expect(normalizeShipPref({ country: "EE", method: "courier", address }))
        .toEqual({ country: "EE", method: "courier", carrier: "", machine: "" });
    }
  });

  it("only a courier carries one — a machine or the counter never inherits a door", () => {
    expect(normalizeShipPref({ country: "EE", method: "parcel", carrier: "omniva", machine: "X", address: MARDI }))
      .toEqual({ country: "EE", method: "parcel", carrier: "omniva", machine: "X" });
    expect(normalizeShipPref({ country: "EE", method: "pickup", address: MARDI }))
      .toEqual({ country: "EE", method: "pickup", carrier: "", machine: "" });
  });

  it("cleaned exactly as createOrder() cleans the order's address", async () => {
    const messy = { addr: "  Mardi\t 1\u0007, korter 4 ", zip: "10145\n", city: "x".repeat(200) };
    const pref = normalizeShipPref({ country: "EE", method: "courier", address: messy });
    expect(pref?.address).toEqual({ addr: "Mardi 1 , korter 4", zip: "10145", city: "x".repeat(160) });
    await truncateAll();
    {
      const product = (catalogueMin as Array<{ id: string; s: string }>).find((p) => p.s === "in")!;
      const order = await createOrder({
        lang: "RU",
        items: [{ id: product.id, qty: 1 }],
        customer: { name: "Renat Ostrovski", email: "renat@example.com", phone: "+372 5555 1234" },
        shipping: { method: "courier", country: "EE", carrier: "dpd", address: messy },
        channel: "web",
      } as Parameters<typeof createOrder>[0]);
      expect(order.shipping.address).toEqual(pref?.address);
    }
  });
});

describe("the account's own door: saved with the default, handed back", () => {
  const EMAIL = "courier-default@example.com";
  beforeEach(truncateAll);

  it("updateCustomer() stores it, and clearing the boxes clears it", async () => {
    await recordLogin(EMAIL, "RU");
    await updateCustomer(EMAIL, { shipPref: { country: "EE", method: "courier", carrier: "", machine: "", address: MARDI } });
    expect((await getCustomer(EMAIL))?.shipPref).toEqual({ country: "EE", method: "courier", carrier: "", machine: "", address: MARDI });
    await updateCustomer(EMAIL, { shipPref: { country: "EE", method: "courier", carrier: "", machine: "", address: { addr: "", zip: "", city: "" } } });
    expect((await getCustomer(EMAIL))?.shipPref).toEqual({ country: "EE", method: "courier", carrier: "", machine: "" });
  });

  it("PATCH /api/account/me stores it, GET hands it back — the account screen's round trip", async () => {
    await recordLogin(EMAIL, "RU");
    const { GET, PATCH } = await import("@/app/api/account/me/route");
    const cookie = `rmp_cust=${makeCustomerToken(EMAIL)}`;
    const shipPref = { country: "LV", method: "courier", carrier: "", machine: "", address: { addr: "Brīvības iela 12-4", zip: "LV-1010", city: "Rīga" } };
    const patched = await PATCH(new Request("https://rempireshop.com/api/account/me/", {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json", "x-forwarded-for": "203.0.113.41" },
      body: JSON.stringify({ lang: "RU", shipPref }),
    }));
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { customer: { shipPref: unknown } }).customer.shipPref).toEqual(shipPref);
    const got = await GET(new Request("https://rempireshop.com/api/account/me/", { headers: { cookie } }));
    expect(((await got.json()) as { customer: { shipPref: unknown } }).customer.shipPref).toEqual(shipPref);
  });
});

/* ---------- the account screen: the draft and its save ------------------ */

interface Acct {
  S: Record<string, unknown>;
  st: Array<[string, string]>;
  queued: string[];
  shipDraftFrom(p: unknown): Record<string, unknown> | null;
  acctShipFromRow(cc: string, row: Record<string, unknown>): Record<string, unknown>;
  acctShipChanged(): void;
  acctFieldDirty(f: string): boolean;
  acctFieldPayload(f: string): Record<string, unknown>;
  acctAddrHTML(): string;
}
function acct(saved: unknown, draft?: unknown): Acct {
  const body = `
    var st = [], queued = [];
    var S = { lang: "RU", cust: { email: "a@example.com", shipPref: SAVED }, acctForm: {}, acctSt: { ship: "" } };
    var document = { querySelectorAll: function () { return []; } };
    function acctSt(f, v) { S.acctSt[f] = v; st.push([f, v]); }
    function acctQueue(f) { queued.push(f); }
    function acctMachinesTooMany() { return false; }
    ${slice("shipDraftFrom")}
    ${slice("acctAddrOf")}
    ${slice("acctAddrWhole")}
    ${slice("acctAddrPartial")}
    ${slice("acctAddrKey")}
    ${slice("paintAcctAddr")}
    ${slice("shipKey")}
    ${slice("acctFieldDirty")}
    ${slice("acctFieldPayload")}
    ${slice("acctShipFromRow")}
    ${slice("rowKind")}
    ${slice("acctShipChanged")}
    ${slice("acctAddrHTML")}
    ${slice("esc")}
    S.acctForm.ship = DRAFT === undefined ? shipDraftFrom(SAVED) : DRAFT;
    return {
      S: S, st: st, queued: queued,
      shipDraftFrom: shipDraftFrom, acctShipFromRow: acctShipFromRow, acctShipChanged: acctShipChanged,
      acctFieldDirty: acctFieldDirty, acctFieldPayload: acctFieldPayload, acctAddrHTML: acctAddrHTML
    };
  `;
  return new Function("SAVED", "DRAFT", body)(saved, draft) as Acct;
}
const COURIER_EE = { country: "EE", method: "courier", carrier: "", machine: "", address: MARDI };

describe("«Доставка по умолчанию»: the courier row's three boxes", () => {
  it("the boxes are the checkout's courier step: «Адрес», «Индекс», «Город»", () => {
    const html = acct(COURIER_EE).acctAddrHTML();
    for (const [k, label, ph, auto] of [
      ["addr", "Адрес", "улица, дом", "street-address"],
      ["zip", "Индекс", "12345", "postal-code"],
      ["city", "Город", "Город", "address-level2"],
    ]) {
      expect(html).toContain('<span class="field__label">' + label + "</span>");
      expect(html).toContain('data-acctaddr="' + k + '"');
      expect(html).toContain('placeholder="' + ph + '"');
      expect(html).toContain('autocomplete="' + auto + '"');
    }
    // the same three the checkout draws for a courier (screenCheckout)
    const co = src.slice(src.indexOf('shipField("addr"'), src.indexOf('shipField("addr"') + 400);
    expect(co).toContain('shipField("addr", "Адрес", "улица, дом", "street-address", "")');
    expect(co).toContain('shipField("zip", "Индекс", "12345", "postal-code", "numeric")');
    expect(co).toContain('shipField("city", "Город", "Город", "address-level2", "")');
    // filled from the row
    expect(html).toContain('value="Mardi 1"');
    expect(html).toContain('value="10145"');
  });

  it("the draft carries the row's address, and the save sends it", () => {
    const a = acct(COURIER_EE);
    expect(a.S.acctForm).toMatchObject({ ship: COURIER_EE });
    expect(a.acctFieldDirty("ship")).toBe(false);
    ((a.S.acctForm as Record<string, Record<string, Addr>>).ship.address).addr = "Mardi 3";
    expect(a.acctFieldDirty("ship")).toBe(true);
    expect(a.acctFieldPayload("ship").shipPref).toMatchObject({ method: "courier", address: { addr: "Mardi 3", zip: "10145", city: "Tallinn" } });
  });

  it("a whole address saves when a box is left", () => {
    const a = acct(COURIER_EE);
    a.acctShipChanged();
    expect(a.queued).toEqual(["ship"]);
  });

  it("half an address waits, and the line says what is missing", () => {
    const a = acct(COURIER_EE, { country: "EE", method: "courier", carrier: "", machine: "", address: { addr: "Mardi 3", zip: "", city: "Tallinn" } });
    a.acctShipChanged();
    expect(a.queued).toEqual([]);
    expect(a.st).toContainEqual(["ship", "addr"]);
    // …and the empty box is the one marked
    const html = a.acctAddrHTML();
    expect(html).toMatch(/data-acctaddr="zip"[^>]*aria-invalid="true"/);
    expect(html).not.toMatch(/data-acctaddr="addr"[^>]*aria-invalid="true"/);
    expect(src).toContain('if (st === "addr") return "Впишите адрес, индекс и город — тогда сохраним";');
  });

  it("the courier row with no address at all still saves at once — the checkout asks, as before", () => {
    const a = acct(null, { country: "EE", method: "courier", carrier: "", machine: "", address: { addr: "", zip: "", city: "" } });
    a.acctShipChanged();
    expect(a.queued).toEqual(["ship"]);
  });

  it("back on the courier row of the same country the address is still there; another country starts empty", () => {
    const a = acct(COURIER_EE, { country: "EE", method: "parcel", carrier: "omniva", machine: "" });
    expect(a.acctShipFromRow("EE", { l: "Курьер до двери" }).address).toEqual(MARDI);
    expect(a.acctShipFromRow("LV", { l: "Курьер до двери" }).address).toEqual({ addr: "", zip: "", city: "" });
    // a machine row carries none
    expect(a.acctShipFromRow("EE", { l: "Пакомат Omniva", pm: "omniva" }).address).toBeUndefined();
  });
});

/* ---------- the checkout: the boxes filled from the account ------------- */

function checkout(ship: Record<string, string>, onScreen = false) {
  const body = `
    var boxes = {}, focused = null;
    ["addr", "zip", "city"].forEach(function (k) { boxes[k] = { value: SHIP[k] || "" }; });
    var document = {
      querySelector: function (sel) { var m = /data-shipf="(\\w+)"/.exec(sel); return m && boxes[m[1]] || null; },
      get activeElement() { return focused; }
    };
    var S = {
      screen: ON ? "checkout" : "product", shipPicked: false, country: "EE", countryIso: "", cart: [],
      ship: { name: "", addr: SHIP.addr || "", zip: SHIP.zip || "", city: SHIP.city || "", phone: "", method: "parcel", carrier: "", point: null },
      cust: { shipPref: { country: "EE", method: "courier", carrier: "", machine: "", address: { addr: "Mardi 1", zip: "10145", city: "Tallinn" } } }
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
    ${slice("shipServed")}
    ${slice("shipZoneOf")}
    ${slice("isParcel")}
    ${slice("shipMethod")}
    ${slice("giftOnlyCart")}
    ${slice("deliveryFor")}
    ${slice("carriersFor")}
    ${slice("pickupOpen")}
    ${slice("orderCountry")}
    return { S: S, boxes: boxes, apply: applyAcctShipPref, focus: function (k) { focused = boxes[k]; } };
  `;
  return new Function("SHIP", "ON", body)(ship, onScreen) as {
    S: { ship: Record<string, string> }; boxes: Record<string, { value: string }>;
    apply(saved?: boolean): void; focus(k: string): void;
  };
}

describe("applyAcctShipPref(): the checkout takes the account's door", () => {
  it("empty boxes are filled from the account", () => {
    const c = checkout({});
    c.apply();
    expect(c.S.ship).toMatchObject({ method: "courier", addr: "Mardi 1", zip: "10145", city: "Tallinn" });
  });

  it("an address being typed is never mixed with the account's", () => {
    const c = checkout({ addr: "Pärnu mnt 5" });
    c.apply();
    expect(c.S.ship).toMatchObject({ addr: "Pärnu mnt 5", zip: "", city: "" });
  });

  it("…unless the account's own save is the newer choice — then the whole address", () => {
    const c = checkout({ addr: "Pärnu mnt 5" });
    c.apply(true);
    expect(c.S.ship).toMatchObject({ addr: "Mardi 1", zip: "10145", city: "Tallinn" });
  });

  it("the boxes on screen show it — except the one the shopper is in", () => {
    const c = checkout({}, true);
    c.focus("zip");
    c.apply();
    expect(c.boxes.addr.value).toBe("Mardi 1");
    expect(c.boxes.city.value).toBe("Tallinn");
    expect(c.boxes.zip.value).toBe("");
  });
});
