/**
 * «Купить через G Pay» in three taps — public/shop2/app.js expressPlan(),
 * expressQuote(), expressBuy().
 *
 * Dim, 23.09.2026: «If they are logged in and everything is set (shipping
 * method etc.) and they press it, route them straight to the Google Pay /
 * Apple Pay payment page, and that's it. If we miss any data, route them to
 * checkout to add it.» Until then the button put the item in the basket and
 * opened the checkout for everybody, a signed-in customer with a complete
 * account included.
 *
 * Four questions, one block each:
 *   1. is everything there? — every missing piece sends the shopper to the
 *      checkout, and only a complete account goes to the wallet;
 *   2. is the order the checkout's order? — the body is orderPayload() over
 *      the same choices, byte for byte, and the total is its localTotal();
 *   3. is the price on the button the price the server bills? — the body is
 *      put through createOrder() for real;
 *   4. does a double tap make one order? — the button's own lock and memo,
 *      and the route's idempotency key behind them.
 *
 * The storefront is a vanilla-JS IIFE with no DOM here, so its functions are
 * sliced out of app.js by source text and run against stubs — the same
 * technique as tests/checkout-parity.test.ts and tests/checkout-payonce.test.ts:
 * this tests the shop's own code, not a retyped copy, and a rename fails loudly.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variantData from "@/data/catalogue.variants.json";
import { resetRateLimits } from "@/lib/auth";
import { query } from "@/lib/db";
import { IDEMPOTENCY_HEADER } from "@/lib/idempotency";
import { createOrder } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

/** Cut `function <name>(…) { … }` out of app.js by brace matching. */
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
/** The same, for a helper the file may or may not have yet — "" when it has not. */
function optional(name: string): string {
  return src.includes(`function ${name}(`) ? slice(name) : "";
}
/** `var <name> = …;` — the literal's source, `{…}` or `[…]`, by bracket matching. */
function literal(name: string): string {
  const head = src.indexOf(`var ${name} = `);
  if (head < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  const from = head + `var ${name} = `.length;
  const open = src[from];
  const close = open === "{" ? "}" : open === "[" ? "]" : "";
  if (!close) throw new Error(`var ${name} is not a literal`);
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(from, i + 1);
  }
  throw new Error(`unbalanced brackets around var ${name} in app.js`);
}

/* ---------- the catalogue, as both halves see it ------------------------ */

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const VARIANTS = variantData as Record<string, { sizes: string[]; prices: number[] }>;
/** A product the way the storefront's CATALOGUE carries it, built from the
    two files createOrder() prices from — so the browser and the server are
    looking at the same numbers. */
function clientProduct(id: string) {
  const m = (catalogueMin as Min[]).find((p) => p.id === id);
  if (!m) throw new Error(`no product ${id} in src/data/catalogue.min.json`);
  const v = VARIANTS[id];
  return { id, brand: m.b, name: m.n, cat: m.c, price: m.p, stock: m.s, sizes: v ? v.sizes : [], prices: v ? v.prices : undefined };
}
// three volumes, 9 / 16 / 25 €
const SHAMPOO = clientProduct("system-4-bio-botanical-shampoo");
// one volume, no ladder at all
const ONE_SIZE = clientProduct(
  (catalogueMin as Min[]).find((p) => !VARIANTS[p.id] && p.s === "in")!.id,
);

/* ---------- the storefront, sliced ------------------------------------- */

type Point = { id: string; name: string; type: string; address?: string; city?: string };
type Pref = { country: string; method: string; carrier: string; machine: string } | null;
interface Cust {
  email: string; name: string; phone: string; marketing?: boolean; shipPref: Pref;
}
type Plan = { ok: boolean; why?: string } & Record<string, unknown>;
type Quote = { payload: Record<string, unknown>; total: number; goods: number; ship: number; shipLabel: string; line: Record<string, unknown> };

interface Shop {
  S: Record<string, unknown>;
  POINTS: {
    by: Record<string, Point[]>; err: Record<string, boolean>; empty: Record<string, boolean>;
    big: Record<string, number>; found: Record<string, Point[]>; failed: Record<string, boolean>; finding: Record<string, boolean>;
  };
  loads: string[];
  /** URLs the real pointsFind() asked for (only with `opts.search`). */
  asked: string[];
  /** How many times the express slot was asked to redraw itself. */
  patches(): number;
  expressPlan(p: unknown, si: number, qty: number): Plan;
  expressQuote(plan: Plan): Quote;
  expressMarkup(p: unknown): string;
  orderPayload(): Record<string, unknown>;
  localTotal(): number;
  applyAcctShipPref(): void;
  matchAcctPoint(): boolean;
  walletPay(): number;
  eur(n: number): string;
}
/** What the fake /api/shipping/points/ answers a name search with. */
type Found = { ok: true; points: Point[] } | "fail" | "hang";
interface ShopOpts {
  /** Run the real pointsFind()/pointsFoundArrived() against this script. */
  search?: (url: string) => Found;
}

/** Locker lists the carriers «answered» with — names are what the account keeps. */
const LISTS: Record<string, Point[]> = {
  "omniva:EE": [
    { id: "omn-101", name: "Tallinna Ülemiste Selveri pakiautomaat", type: "parcel_machine", city: "Tallinn" },
    { id: "omn-102", name: "Kristiine keskuse pakiautomaat", type: "parcel_machine", city: "Tallinn" },
  ],
  "dpd:EE": [{ id: "dpd-201", name: "DPD Pickup Rocca al Mare", type: "parcel_machine", city: "Tallinn" }],
  "smartpost:LV": [{ id: "sp-301", name: "Rīga Origo SmartPosti", type: "parcel_machine", city: "Rīga" }],
  "dpd:IT": [{ id: "dpd-401", name: "DPD Pickup Tabaccheria Roma", type: "pickup_point", city: "Roma" }],
  "novapost:PL": [{ id: "np-501", name: "Nova Post Warszawa 12", type: "post_office", city: "Warszawa" }],
};

function freshState(cust: Cust | null, product: ReturnType<typeof clientProduct> = SHAMPOO, size = 1, qty = 1) {
  return {
    lang: "RU",
    screen: "product", productId: product.id, size, qty,
    loggedIn: !!cust, cust,
    cart: [] as unknown[],
    country: "EE", countryIso: "",
    ship: { name: "", addr: "", zip: "", city: "", phone: "", method: "parcel", carrier: "", point: null },
    email: "", promo: "", promoInfo: null, giftCard: null, loyaltyRedeem: false, loyalty: null,
    newsletter: false, pay: 0, billed: null, pro: null, shipPicked: false,
  };
}

/**
 * The express half and the checkout half of app.js over one S. Stubs first:
 * a function sliced after its stub replaces it (the later declaration wins),
 * so a helper that another branch adds to app.js is picked up for real the
 * day it arrives and stubbed until then.
 */
function shop(state: Record<string, unknown>, catalogue: unknown[] = [SHAMPOO, ONE_SIZE], opts: ShopOpts = {}): Shop {
  const body = `
    var S = STATE;
    var CATALOGUE = CAT;
    var CART_MAX_QTY = 99;
    var POINTS = { by: {}, empty: {}, loading: {}, err: {}, q: "", view: "list", big: {}, found: {}, finding: {}, failed: {}, rows: [] };
    var loads = [], asked = [], patches = 0;
    var SHIP_RULES = ${literal("SHIP_RULES")};
    var MONTONIO_PRICE = ${literal("MONTONIO_PRICE")};
    var CARRIERS_BY_COUNTRY = ${literal("CARRIERS_BY_COUNTRY")};
    var COURIER_CARRIERS = ${literal("COURIER_CARRIERS")};
    var CARRIER_NAMES = ${literal("CARRIER_NAMES")};
    var POINT_KIND = ${literal("POINT_KIND")};
    var DELIVERY = ${literal("DELIVERY")};
    var PAYS = ${literal("PAYS")};
    var COUNTRIES = ${literal("COUNTRIES")};
    var EUROPE_ISO = ${literal("EUROPE_ISO")};
    var expressBilled = null, expressBusy = false;

    /* stubs — nothing here draws, fetches or stores */
    function loadPointsFor(c, cc) { loads.push(c + ":" + cc); }
    function loadPoints() {}
    function loadCarrierLogos() {}
    function patchDelivery() {}
    function patchSummary() {}
    function patchCountry() {}
    function render() {}
    function pointsFind() { return null; }
    function bundleById() { return null; }
    function giftAmount() { return 0; }
    function pointsOn() { return false; }
    function colourRu(c) { return c; }
    function patchExpress() { patches++; }
    function pointResultsChanged() {}
    var PAYLOGOS = undefined;
    /* the network the real search talks to, when a test brings one: capped,
       so a retry loop shows up as a count instead of hanging the test */
    function fetch(url) {
      asked.push(url);
      var a = asked.length > 25 ? "hang" : SEARCH(url);
      if (a === "hang") return new Promise(function () {});
      if (a === "fail") return Promise.reject(new Error("offline"));
      return Promise.resolve({ ok: true, json: function () { return Promise.resolve(a); } });
    }

    ${slice("walletPay")}
    ${slice("expressPoint")}
    ${slice("expressPlan")}
    ${slice("expressRun")}
    ${slice("expressQuote")}
    ${slice("expressMarkup")}
    ${slice("walletMarks")}
    ${slice("gpayOnDark")}
    ${slice("orderPayload")}
    ${slice("lineVariant")}
    ${slice("lineMeta")}
    ${slice("lineTitle")}
    ${slice("lineLabelHTML")}
    ${slice("lineLabelParts")}
    ${slice("shipMethod")}
    ${slice("orderCountry")}
    ${slice("shipZoneOf")}
    ${slice("countryOff")}
    ${slice("deliveryFor")}
    ${slice("pickupOpen")}
    ${slice("carriersFor")}
    ${slice("courierCarriersFor")}
    ${slice("methodCarriers")}
    ${slice("shipCarrier")}
    ${slice("isParcel")}
    ${slice("giftOnlyCart")}
    ${slice("isDigital")}
    ${slice("isInvoice")}
    ${slice("invoiceOffered")}
    ${slice("total")}
    ${slice("localTotal")}
    ${slice("cartSum")}
    ${slice("lineUnit")}
    ${slice("proPrice")}
    ${slice("cartSumRetail")}
    ${slice("sizePrice")}
    ${slice("byId")}
    ${slice("byIdOrNull")}
    ${slice("threshold")}
    ${slice("freeShip")}
    ${slice("shipCost")}
    ${slice("shipPriceFor")}
    ${slice("shipRulePrice")}
    ${slice("discount")}
    ${slice("promoLive")}
    ${slice("promoBase")}
    ${slice("promoGoods")}
    ${slice("promoLines")}
    ${slice("promoLineIn")}
    ${slice("promoBrandKey")}
    ${slice("giftDiscount")}
    ${slice("loyaltyDiscount")}
    ${slice("loyaltyMaxRedeem")}
    ${slice("shipMethodLabel")}
    ${slice("pointKind")}
    ${slice("sizeOut")}
    ${slice("sizeStockOf")}
    ${slice("soldOut")}
    ${slice("applyAcctShipPref")}
    ${slice("matchAcctPoint")}
    ${slice("pointsList")}
    ${slice("pointsKey")}
    ${slice("eur")}
    ${slice("esc")}
    ${optional("shipServed")}
    ${optional("coPointsKey")}
    ${optional("pointNamed")}
    ${optional("pointsForAcct")}
    ${opts.search ? slice("pointsFind") : ""}
    ${opts.search ? slice("pointsFoundArrived") : ""}

    return {
      S: S, POINTS: POINTS, loads: loads, asked: asked,
      patches: function () { return patches; },
      expressPlan: expressPlan, expressQuote: expressQuote, expressMarkup: expressMarkup,
      orderPayload: orderPayload, localTotal: localTotal,
      applyAcctShipPref: applyAcctShipPref, matchAcctPoint: matchAcctPoint,
      walletPay: walletPay, eur: eur
    };
  `;
  // The body is this repository's own source plus fixed stub text.
  const made = new Function("STATE", "CAT", "SEARCH", body)(state, catalogue, opts.search ?? (() => "hang")) as Shop;
  for (const [k, v] of Object.entries(LISTS)) made.POINTS.by[k] = v;
  return made;
}

/** A customer whose account holds everything a parcel order needs. */
const FULL: Cust = {
  email: "renat@example.com",
  name: "Renat Ostrovski",
  phone: "+372 5555 1234",
  marketing: false,
  shipPref: { country: "EE", method: "parcel", carrier: "omniva", machine: "Tallinna Ülemiste Selveri pakiautomaat" },
};
const withPref = (pref: Partial<NonNullable<Pref>> | null, over: Partial<Cust> = {}): Cust => ({
  ...FULL,
  ...over,
  shipPref: pref === null ? null : { ...FULL.shipPref!, ...pref },
});

/* ---------- 1. is everything there? ------------------------------------ */

describe("expressPlan(): only a complete account goes straight to the wallet", () => {
  it("a complete account: the order is all there, the saved machine found by name", () => {
    const s = shop(freshState(FULL));
    const plan = s.expressPlan(SHAMPOO, 1, 1);
    expect(plan.ok).toBe(true);
    expect(plan).toMatchObject({
      id: SHAMPOO.id, size: 1, qty: 1,
      name: "Renat Ostrovski", email: "renat@example.com", phone: "+372 5555 1234",
      country: "EE", zone: "EE", method: "parcel", carrier: "omniva",
    });
    expect((plan.point as Point).id).toBe("omn-101");
  });

  it("the machine is matched whatever the case it was saved in — matchAcctPoint()'s rule", () => {
    const s = shop(freshState(withPref({ machine: "tallinna ülemiste selveri PAKIAUTOMAAT" })));
    expect((s.expressPlan(SHAMPOO, 1, 1).point as Point).id).toBe("omn-101");
  });

  it("a counter in Tallinn needs no phone — shipRequired() does not ask for one", () => {
    const s = shop(freshState(withPref({ method: "pickup", carrier: "", machine: "" }, { phone: "" })));
    const plan = s.expressPlan(SHAMPOO, 1, 1);
    expect(plan.ok).toBe(true);
    expect(plan.method).toBe("pickup");
  });

  it("a country behind «Другая страна Европы» carries its zone and its real code", () => {
    const s = shop(freshState(withPref({ country: "IT", carrier: "dpd", machine: "DPD Pickup Tabaccheria Roma" })));
    expect(s.expressPlan(SHAMPOO, 1, 1)).toMatchObject({ ok: true, country: "IT", zone: "EU" });
  });

  /* Each gap is one line of the table. Everything else about the account is
     complete, so the row proves that THIS piece alone sends the shopper to
     the checkout. */
  const gaps: Array<[string, Cust | null, string, (s: Shop) => void]> = [
    ["nobody is signed in", null, "guest", () => {}],
    ["the account has no name", withPref({}, { name: "  " }), "name", () => {}],
    ["the e-mail is not an address", withPref({}, { email: "renat@" }), "email", () => {}],
    ["no default delivery was ever saved", withPref(null), "delivery", () => {}],
    ["the default is the zone «EU», not a country", withPref({ country: "EU", carrier: "dpd" }), "country", () => {}],
    ["a country the owner switched off", withPref({ country: "CY", carrier: "dpd" }), "country", () => {}],
    ["a country the shop does not post to", withPref({ country: "US", carrier: "dpd" }), "country", () => {}],
    ["pickup outside Estonia", withPref({ country: "LV", method: "pickup", carrier: "", machine: "" }), "delivery", () => {}],
    ["a parcel with no phone to text", withPref({}, { phone: "" }), "phone", () => {}],
    ["a phone too short to be one", withPref({}, { phone: "12-34" }), "phone", () => {}],
    ["a courier — the account keeps no street address", withPref({ method: "courier", carrier: "", machine: "" }), "address", () => {}],
    ["a carrier this country does not offer", withPref({ carrier: "novapost" }), "delivery", () => {}],
    ["a carrier whose list came back empty", withPref({}), "delivery", (s) => { s.POINTS.empty["omniva:EE"] = true; }],
    ["a parcel with no machine chosen", withPref({ machine: "" }), "point", () => {}],
    ["the saved machine has closed since", withPref({ machine: "Viru keskuse pakiautomaat" }), "point", () => {}],
    ["the carrier's list could not be fetched", withPref({}), "point", (s) => { delete s.POINTS.by["omniva:EE"]; s.POINTS.err["omniva:EE"] = true; }],
  ];
  for (const [label, cust, why, arrange] of gaps) {
    it(`${label} → the checkout (${why})`, () => {
      const s = shop(freshState(cust));
      arrange(s);
      const plan = s.expressPlan(SHAMPOO, 1, 1);
      expect(plan.ok).toBe(false);
      expect(plan.why).toBe(why);
    });
  }

  it("a size counted to zero is not bought — neither here nor by the checkout", () => {
    const gone = { ...SHAMPOO, stockVar: { "250 мл": "out" } };
    const s = shop(freshState(FULL, gone as never), [gone, ONE_SIZE]);
    expect(s.expressPlan(gone, 1, 1)).toMatchObject({ ok: false, why: "stock" });
    // …while the size next to it still can
    expect(s.expressPlan(gone, 2, 1).ok).toBe(true);
  });

  it("the machine's list still on its way: wait for it, and ask for it", () => {
    const s = shop(freshState(FULL));
    delete s.POINTS.by["omniva:EE"];
    expect(s.expressPlan(SHAMPOO, 1, 1)).toMatchObject({ ok: false, why: "wait" });
    expect(s.loads).toContain("omniva:EE");
  });

  it("a guest's button is today's, and the plan asks the network for nothing", () => {
    const s = shop(freshState(null));
    expect(s.expressPlan(SHAMPOO, 1, 1).why).toBe("guest");
    expect(s.loads).toEqual([]);
    const html = s.expressMarkup(SHAMPOO);
    expect(html).toContain('class="btn btn--wide btn--express" data-buynow="' + SHAMPOO.id + '"');
    expect(html).toContain("Купить через ");
    expect(html).not.toContain("data-express");
  });
});

/* ---------- 1a. a big country's saved machine ------------------------- */

/* Poland's DPD is 33 603 points and the shop downloads the first 1 500. A
   machine saved from the account's search is usually not among them, so it
   is asked for by name through the server search the sheet uses
   (pointsFind) — the same query matchAcctPoint() sends, so one answer serves
   the product page and the checkout. */
const KRAKOW: Point = { id: "dpd-pl-9001", name: "DPD Pickup Kraków Rynek 7", type: "pickup_point", city: "Kraków" };
const PL_PREF = withPref({ country: "PL", carrier: "dpd", machine: KRAKOW.name });
const tick = () => new Promise((r) => setTimeout(r, 0));
async function ticks(n = 5) { for (let i = 0; i < n; i++) await tick(); }

function bigShop(search: (url: string) => Found, screen = "product") {
  const state = freshState(PL_PREF);
  state.screen = screen;
  const s = shop(state, [SHAMPOO, ONE_SIZE], { search });
  // the first slice, without the saved machine in it
  s.POINTS.by["dpd:PL"] = [{ id: "dpd-pl-1", name: "DPD Pickup Warszawa 1", type: "pickup_point" }];
  s.POINTS.big["dpd:PL"] = 33603;
  return s;
}

describe("a big country's saved machine is looked up by name before deciding", () => {
  it("in flight: neither path — a neutral block, no order button, no fallback", () => {
    const s = bigShop(() => "hang");
    expect(s.expressPlan(SHAMPOO, 1, 1)).toMatchObject({ ok: false, why: "wait" });
    expect(s.asked).toHaveLength(1);
    expect(s.asked[0]).toContain("country=PL");
    expect(s.asked[0]).toContain("carrier=dpd");
    expect(s.asked[0]).toContain("q=" + encodeURIComponent(KRAKOW.name.toLowerCase()));
    const html = s.expressMarkup(SHAMPOO);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Ищем ваш пакомат из кабинета…");
    expect(html).toMatch(/<button class="btn btn--wide btn--express" data-buynow="[^"]+" disabled>/);
    expect(html).not.toContain("data-express");
    // asked once, however often the page is drawn meanwhile
    s.expressMarkup(SHAMPOO);
    s.expressPlan(SHAMPOO, 1, 1);
    expect(s.asked).toHaveLength(1);
  });

  it("found: the express path, with the machine the server found", async () => {
    const s = bigShop(() => ({ ok: true, points: [KRAKOW] }));
    expect(s.expressPlan(SHAMPOO, 1, 1).why).toBe("wait");
    await ticks();
    // the answer redraws the express slot on the product page
    expect(s.patches()).toBeGreaterThan(0);
    const plan = s.expressPlan(SHAMPOO, 1, 1);
    expect(plan.ok).toBe(true);
    expect((plan.point as Point).id).toBe(KRAKOW.id);
    expect(s.expressMarkup(SHAMPOO)).toContain("data-express");
    const q = s.expressQuote(plan);
    expect((q.payload.shipping as Record<string, unknown>).pointId).toBe(KRAKOW.id);
    expect((q.payload.shipping as Record<string, unknown>).country).toBe("PL");
  });

  it("the search answers without that machine: the checkout, which asks for one", async () => {
    const s = bigShop(() => ({ ok: true, points: [{ id: "x", name: "DPD Pickup Kraków Rynek 8", type: "pickup_point" }] }));
    s.expressPlan(SHAMPOO, 1, 1);
    await ticks();
    expect(s.expressPlan(SHAMPOO, 1, 1)).toMatchObject({ ok: false, why: "point" });
  });

  it("the search fails: the checkout (step 2), and nobody asks again by themselves", async () => {
    const s = bigShop(() => "fail");
    s.expressPlan(SHAMPOO, 1, 1);
    await ticks();
    expect(s.expressPlan(SHAMPOO, 1, 1)).toMatchObject({ ok: false, why: "point" });
    s.expressMarkup(SHAMPOO);
    await ticks();
    expect(s.asked).toHaveLength(1);
    // today's button again — the tap goes to the checkout
    expect(s.expressMarkup(SHAMPOO)).toContain("Купить через ");
    expect(s.expressMarkup(SHAMPOO)).not.toContain("disabled");
  });

  /* Found while building the above: matchAcctPoint() re-asked a failed query
     every time an answer landed, and every failure is an answer landing — so
     a search that could not be answered (offline, a 500) was asked again and
     again, as fast as the failures came back, on the checkout. */
  it("a failed search is not re-asked in a loop by the checkout's own match", async () => {
    const s = bigShop(() => "fail", "checkout");
    Object.assign(s.S, { country: "EU", countryIso: "PL" });
    (s.S.ship as Record<string, unknown>).carrier = "dpd";
    s.matchAcctPoint();
    await ticks(10);
    expect(s.asked).toHaveLength(1);
    expect(s.POINTS.failed["dpd:PL|" + KRAKOW.name.toLowerCase()]).toBe(true);
  });
});

/* ---------- 1b. …and a gap lands on the step that asks for it ----------- */

/**
 * expressGapStep() over the checkout's own validators — the state is the
 * checkout's as the account left it (applyAcctShipPref ran at sign-in), plus
 * the line the fallback has just put in the basket.
 */
function gapRig(ship: Record<string, unknown>, over: Record<string, unknown> = {}) {
  const body = `
    var S = STATE, toasts = [], renders = 0, focused = [], matched = 0;
    var SHIP_RULES = ${literal("SHIP_RULES")};
    var CARRIERS_BY_COUNTRY = ${literal("CARRIERS_BY_COUNTRY")};
    var DELIVERY = ${literal("DELIVERY")};
    var POINTS = { by: {}, empty: {}, loading: {}, err: {} };
    function render() { renders++; }
    function toast(t) { toasts.push(t); }
    function refocus(sel) { focused.push(sel); }
    function requestAnimationFrame(fn) { fn(); }
    function matchAcctPoint() { matched++; return false; }
    ${slice("expressGapStep")}
    ${slice("emailBad")}
    ${slice("shipMissing")}
    ${slice("shipRequired")}
    ${slice("shipEmpty")}
    ${slice("phoneOk")}
    ${slice("pointMissing")}
    ${slice("isParcel")}
    ${slice("isDigital")}
    ${slice("giftOnlyCart")}
    ${slice("shipMethod")}
    ${slice("deliveryFor")}
    ${slice("carriersFor")}
    ${slice("pickupOpen")}
    ${slice("orderCountry")}
    expressGapStep();
    return { S: S, toasts: toasts, renders: renders, focused: focused, matched: matched };
  `;
  const state = {
    screen: "checkout", coStep: 1, emailTouched: false, shipTouched: false,
    email: "renat@example.com", country: "EE", countryIso: "",
    cart: [{ id: SHAMPOO.id, size: 1, qty: 1 }],
    ship: { name: "Renat Ostrovski", addr: "", zip: "", city: "", phone: "+372 5555 1234", method: "parcel", carrier: "omniva", point: null, ...ship },
    ...over,
  };
  return new Function("STATE", body)(state) as {
    S: Record<string, unknown>; toasts: string[]; renders: number; focused: string[]; matched: number;
  };
}

describe("expressGapStep(): the checkout opens where the account falls short", () => {
  it("a courier default: step 2, the address fields marked", () => {
    const r = gapRig({ method: "courier", carrier: "" });
    expect(r.S.coStep).toBe(2);
    expect(r.S.shipTouched).toBe(true);
    expect(r.toasts).toEqual(["Заполните данные доставки"]);
    expect(r.renders).toBe(1);
    // the caret goes to the first marked field once the step is drawn
    expect(r.focused).toEqual(['.costep__body [aria-invalid="true"]']);
  });

  it("no phone for the machine to text: step 2 again", () => {
    const r = gapRig({ phone: "" });
    expect(r.S.coStep).toBe(2);
    expect(r.toasts).toEqual(["Заполните данные доставки"]);
  });

  it("the saved machine is gone: step 2, «Выберите пакомат» — after one more look for it", () => {
    const r = gapRig({ point: null });
    expect(r.matched).toBe(1);
    expect(r.S.coStep).toBe(2);
    expect(r.toasts).toEqual(["Выберите пакомат"]);
  });

  it("the zone «EU» with no country behind it: step 2, «Выберите страну доставки»", () => {
    const r = gapRig({ method: "courier" }, { country: "EU", countryIso: "" });
    expect(r.S.coStep).toBe(2);
    expect(r.toasts).toEqual(["Выберите страну доставки"]);
  });

  it("nothing missing after all (a street typed earlier this visit): step 1, nothing marked", () => {
    const r = gapRig({ method: "courier", carrier: "", addr: "Mardi 1", zip: "10145", city: "Tallinn" });
    expect(r.S.coStep).toBe(1);
    expect(r.S.shipTouched).toBe(false);
    expect(r.S.emailTouched).toBe(false);
    expect(r.toasts).toEqual([]);
    expect(r.renders).toBe(0);
  });

  it("the click handler sends a guest — and a list still loading — to step 1 as before", () => {
    const handler = src.slice(src.indexOf("if (d.buynow) {"), src.indexOf("if (d.cart !== undefined)"));
    expect(handler).toContain("xplan = expressPlan(xp, S.size, S.qty);");
    expect(handler).toContain("if (xplan.ok) { expressBuy(xp, xplan); return; }");
    expect(handler).toContain('if (xplan.why !== "guest" && xplan.why !== "wait" && xplan.why !== "stock") expressGapStep();');
    // the fallback is today's path: the wallet chosen, the item in the basket, the checkout
    const fallback = handler.slice(handler.indexOf("if (xplan.ok)"));
    expect(fallback.indexOf('PAYS[wi].k === "wallet"')).toBeLessThan(fallback.indexOf("addToCart(d.buynow); go(\"checkout\");"));
  });
});

/* ---------- 2. the checkout's own order -------------------------------- */

/**
 * What the checkout itself would send for this account and this item: the
 * profile put in the way acctApply() puts it (name, phone, e-mail), the saved
 * delivery by applyAcctShipPref() and matchAcctPoint(), the line the way
 * addToCart() adds it, Apple Pay / Google Pay on step 3, and the newsletter
 * box as acctSyncNewsletter() leaves it.
 */
function checkoutSends(cust: Cust, product: ReturnType<typeof clientProduct>, size: number, qty: number) {
  const s = shop(freshState(cust, product, size, qty));
  const S = s.S;
  S.email = cust.email;
  (S.ship as Record<string, unknown>).name = cust.name;
  (S.ship as Record<string, unknown>).phone = cust.phone;
  s.applyAcctShipPref();
  s.matchAcctPoint();
  S.cart = [{ id: product.id, size, qty }];
  S.pay = s.walletPay();
  S.newsletter = !!cust.marketing;
  return { payload: s.orderPayload(), total: s.localTotal() };
}

const PARITY: Array<[string, Cust, ReturnType<typeof clientProduct>, number, number]> = [
  ["an Omniva machine in Estonia", FULL, SHAMPOO, 1, 1],
  ["a DPD machine, three bottles — free delivery", withPref({ carrier: "dpd", machine: "DPD Pickup Rocca al Mare" }), SHAMPOO, 2, 3],
  ["a SmartPosti machine in Latvia", withPref({ country: "LV", carrier: "smartpost", machine: "Rīga Origo SmartPosti" }), SHAMPOO, 0, 1],
  ["a DPD counter in Italy, behind «Другая страна Европы»", withPref({ country: "IT", carrier: "dpd", machine: "DPD Pickup Tabaccheria Roma" }), SHAMPOO, 1, 2],
  ["a Nova Post office in Poland", withPref({ country: "PL", carrier: "novapost", machine: "Nova Post Warszawa 12" }), SHAMPOO, 0, 1],
  ["the counter on Mardi 1", withPref({ method: "pickup", carrier: "", machine: "" }), SHAMPOO, 1, 1],
  ["a product with one volume", FULL, ONE_SIZE, 0, 1],
];

describe("expressQuote(): the order is the one the checkout would place", () => {
  for (const [label, cust, product, size, qty] of PARITY) {
    it(`${label}: the same body and the same total`, () => {
      const s = shop(freshState(cust, product, size, qty));
      const plan = s.expressPlan(product, size, qty);
      expect(plan.ok, `plan refused: ${plan.why}`).toBe(true);
      const q = s.expressQuote(plan);
      const co = checkoutSends(cust, product, size, qty);
      expect(q.payload).toEqual(co.payload);
      expect(q.total).toBe(co.total);
    });
  }

  it("what the body says: this one line, the account's delivery, no code, no card, no points", () => {
    const s = shop(freshState(FULL));
    const q = s.expressQuote(s.expressPlan(SHAMPOO, 1, 1));
    expect(q.payload).toEqual({
      lang: "RU",
      items: [{ id: SHAMPOO.id, variant: 1, qty: 1 }],
      customer: { name: "Renat Ostrovski", email: "renat@example.com", phone: "+372 5555 1234" },
      shipping: {
        method: "parcel", country: "EE", carrier: "omniva",
        pointId: "omn-101", pointName: "Tallinna Ülemiste Selveri pakiautomaat", pointType: "parcel_machine",
        address: null,
      },
      discountCode: null,
      redeemPoints: false,
      newsletter: false,
    });
  });

  it("the newsletter is left alone even for a subscribed account — false never withdraws a consent", () => {
    const subscribed = withPref({}, { marketing: true });
    const s = shop(freshState(subscribed));
    const q = s.expressQuote(s.expressPlan(SHAMPOO, 1, 1));
    expect(q.payload.newsletter).toBe(false);
    // the only field the checkout's untouched box would send differently
    const co = checkoutSends(subscribed, SHAMPOO, 1, 1);
    expect({ ...co.payload, newsletter: false }).toEqual(q.payload);
  });

  it("the basket, the checkout's delivery and its codes are exactly as they were afterwards", () => {
    const state = freshState(FULL);
    const s = shop(state);
    const basket = [{ id: ONE_SIZE.id, size: 0, qty: 4 }];
    Object.assign(s.S, {
      cart: basket, country: "EU", countryIso: "DE", email: "typed@example.com",
      ship: { name: "Someone Else", addr: "Pärnu mnt 1", zip: "10141", city: "Tallinn", phone: "5", method: "courier", carrier: "dpd", point: null },
      promoInfo: { code: "SUVI10", kind: "percent", value: 10, minSubtotal: 0 }, giftCard: { code: "RMP-AAAA-BBBB", balance: 5 },
      loyaltyRedeem: true, newsletter: true, pay: 0, billed: { from: 1, total: 2 },
    });
    const before = JSON.stringify(s.S);
    const q = s.expressQuote(s.expressPlan(SHAMPOO, 1, 1));
    expect(JSON.stringify(s.S)).toBe(before);
    expect(s.S.cart).toBe(basket);
    // …and none of it leaked into the express order
    expect(q.payload.discountCode).toBeNull();
    expect(q.payload.redeemPoints).toBe(false);
    expect(q.payload.items).toEqual([{ id: SHAMPOO.id, variant: 1, qty: 1 }]);
  });

  it("the button names the total with delivery, and it is the quote's total", () => {
    const s = shop(freshState(FULL));
    const q = s.expressQuote(s.expressPlan(SHAMPOO, 1, 1));
    const html = s.expressMarkup(SHAMPOO);
    expect(html).toContain("data-express");
    expect(html).toContain("<span>Купить за " + s.eur(q.total) + " с доставкой</span>");
    // what is bought, where it goes and what delivery costs sit right above it
    expect(html).toContain("Bio Botanical Shampoo");
    expect(html).toContain("250 мл");
    expect(html).toContain("Пакомат Omniva");
    expect(html).toContain("Tallinna Ülemiste Selveri pakiautomaat");
    expect(html).toContain(s.eur(q.ship));
    expect(html).toContain("Нажимая «Купить», вы соглашаетесь с условиями и политикой возврата.");
    expect(q.total).toBeCloseTo(q.goods + q.ship, 2);
  });
});

/* ---------- 3. the price on the button is the price billed -------------- */

describe("against the server's own code", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await truncateAll();
    resetRateLimits();
  });

  describe("the total on the button is the total createOrder() bills", () => {
    for (const [label, cust, product, size, qty] of PARITY) {
      it(label, async () => {
        const s = shop(freshState(cust, product, size, qty));
        const q = s.expressQuote(s.expressPlan(product, size, qty));
        const order = await createOrder({ ...(q.payload as Parameters<typeof createOrder>[0]), channel: "web" });
        expect(order.subtotal).toBe(q.goods);
        expect(order.shippingPrice).toBe(q.ship);
        expect(order.total).toBe(q.total);
        expect(order.discount).toBe(0);
      });
    }
  });

  /* The button's own lock and memo are below; this is the door behind them.
     The express body goes through the checkout's route, under the checkout's
     `Idempotency-Key` — a tap whose answer was lost and a second tap with the
     same key get the first order back and make nothing. */
  describe("the route behind it: the same key twice is one order", () => {
    it("two POST /api/orders/ with the express body and one key → one row, one answer", async () => {
      const { POST } = await import("@/app/api/orders/route");
      const s = shop(freshState(FULL));
      const q = s.expressQuote(s.expressPlan(SHAMPOO, 1, 1));
      const key = "eeeeeeee-1111-4111-8111-eeeeeeeeeeee";
      const post = (ip: string) =>
        POST(new Request("https://rempireshop.com/api/orders/", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": ip, [IDEMPOTENCY_HEADER]: key },
          body: JSON.stringify(q.payload),
        }));
      const a = await post("203.0.113.71");
      const b = await post("203.0.113.72");
      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      const ja = (await a.json()) as { orderId: string; total: number };
      const jb = (await b.json()) as { orderId: string };
      expect(jb.orderId).toBe(ja.orderId);
      expect(ja.total).toBe(q.total);
      const rows = await query<{ n: string }>("select count(*)::text as n from orders");
      expect(Number(rows[0].n)).toBe(1);
    });
  });
});

/* ---------- 4. one tap, one order -------------------------------------- */

interface Call { url: string; body: Record<string, unknown>; key: string }
interface Answer { offline?: boolean; lost?: boolean; status?: number; body?: Record<string, unknown> }

/**
 * expressBuy() with the network scripted. Each answer can be held back
 * (a Deferred) to model a tap that lands while the first is in flight.
 */
function rig(opts: { quoteTotal?: number; stale?: boolean } = {}) {
  const body = `
    var calls = [], toasts = [], marks = [], href = "", patches = 0;
    var queue = [];
    var S = { lang: "ET", cart: [{ id: "else", size: 0, qty: 2 }] };
    var PLAN = { ok: true, id: "p1", size: 1, qty: 1 };
    var QUOTE = { payload: { items: [{ id: "p1", variant: 1, qty: 1 }], lang: "ET" }, total: TOTAL };
    var expressShown = "shown";
    function expressMarkup() { return STALE ? "moved" : expressShown; }
    function expressQuote() { return QUOTE; }
    function patchExpress() { patches++; }
    function toast(t) { toasts.push(t); }
    function apiSeen() {}
    function orderErrText(c) { return "order:" + c; }
    function payErrText(c) { return "pay:" + c; }
    function expressMark(id, n) { marks.push([id, n]); }
    var tracked = [];
    function track(type, extra) { tracked.push(type); }
    function sizePrice() { return 16; }
    function postJSON(url, b, signal, key) {
      calls.push({ url: url, body: b, key: key || "" });
      var next = queue.shift();
      return next ? next.promise : Promise.resolve({ body: { ok: false, error: "unstubbed" } });
    }
    var location = { get href() { return href; }, set href(v) { href = v; } };
    var expressBusy = false, expressOrder = null, expressIdem = { sig: "", key: "" }, expressBilled = null;
    ${slice("idemNewKey")}
    ${slice("expressBuy")}
    return {
      tap: function () { expressBuy({ id: "p1" }, PLAN); },
      answer: function (a) {
        var d = {}; d.promise = new Promise(function (r) { d.resolve = r; });
        queue.push(d);
        if (a) d.resolve(a);
        return d;
      },
      calls: calls, toasts: toasts, marks: marks, tracked: tracked,
      href: function () { return href; },
      busy: function () { return expressBusy; },
      billed: function () { return expressBilled; },
      cart: function () { return S.cart; },
      patches: function () { return patches; }
    };
  `;
  return new Function("TOTAL", "STALE", body)(opts.quoteTotal ?? 25, !!opts.stale) as {
    tap(): void;
    answer(a?: Answer): { resolve(a: Answer): void };
    calls: Call[]; toasts: string[]; marks: Array<[string, string]>; tracked: string[];
    href(): string; busy(): boolean; billed(): unknown; cart(): unknown[]; patches(): number;
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));
const ORDER = { status: 201, body: { ok: true, orderId: "order-1", number: "R-100001", total: 25 } };
const PAY = { status: 200, body: { ok: true, redirectUrl: "https://montonio.example/card/1" } };

describe("expressBuy(): one tap, one order, straight to the wallet", () => {
  it("makes the order, asks for the wallet and leaves — the basket untouched", async () => {
    const r = rig();
    r.answer(ORDER); r.answer(PAY);
    r.tap();
    await settle();
    expect(r.calls.map((c) => c.url)).toEqual(["/api/orders/", "/api/payments/create/"]);
    expect(r.calls[0].key).not.toBe("");
    /* Montonio's card page, opened on its Apple Pay / Google Pay half: the
       server turns "wallet" into cardPayments + preferredMethod "wallet"
       (tests/payments-montonio.test.ts). No bank code rides along. */
    expect(r.calls[1].body).toEqual({ orderId: "order-1", method: "wallet", lang: "ET" });
    expect(r.href()).toBe("https://montonio.example/card/1");
    expect(r.marks).toEqual([["order-1", "R-100001"]]);
    expect(r.cart()).toEqual([{ id: "else", size: 0, qty: 2 }]);
    // the funnel still sees the two steps this tap stood in for
    expect(r.tracked).toEqual(["add_to_cart", "checkout"]);
  });

  it("a second tap while the first is in flight does nothing at all", async () => {
    const r = rig();
    const first = r.answer();
    r.tap();
    r.tap();
    r.tap();
    expect(r.calls).toHaveLength(1);
    r.answer(PAY);
    first.resolve(ORDER);
    await settle();
    expect(r.calls.map((c) => c.url)).toEqual(["/api/orders/", "/api/payments/create/"]);
  });

  it("a lost answer keeps the key, so the next tap is handed the same order back", async () => {
    const r = rig();
    r.answer({ offline: true, lost: true, status: 0 });
    r.tap();
    await settle();
    expect(r.busy()).toBe(false);
    expect(r.toasts[0]).toMatch(/^Магазин не ответил/);
    r.answer(ORDER); r.answer(PAY);
    r.tap();
    await settle();
    const orders = r.calls.filter((c) => c.url === "/api/orders/");
    expect(orders).toHaveLength(2);
    expect(orders[1].key).toBe(orders[0].key);
    expect(r.href()).toBe("https://montonio.example/card/1");
  });

  it("«the first tap is still running» is not a failure — the key stays for the next tap", async () => {
    const r = rig();
    r.answer({ status: 409, body: { ok: false, error: "in_progress" } });
    r.tap();
    await settle();
    expect(r.busy()).toBe(false);
    r.answer(ORDER); r.answer(PAY);
    r.tap();
    await settle();
    expect(r.calls.map((c) => c.url)).toEqual(["/api/orders/", "/api/orders/", "/api/payments/create/"]);
    expect(r.calls[1].key).toBe(r.calls[0].key);
  });

  it("the order was made and the payment failed: the next tap pays THAT order", async () => {
    const r = rig();
    r.answer(ORDER); r.answer({ status: 502, body: { ok: false, error: "provider_unreachable" } });
    r.tap();
    await settle();
    expect(r.toasts).toEqual(["pay:provider_unreachable"]);
    r.answer(PAY);
    r.tap();
    await settle();
    expect(r.calls.map((c) => c.url)).toEqual(["/api/orders/", "/api/payments/create/", "/api/payments/create/"]);
    expect(r.calls[2].body.orderId).toBe("order-1");
    expect(r.href()).toBe("https://montonio.example/card/1");
    // paying the remembered order is not a new trip through the funnel
    expect(r.tracked).toEqual(["add_to_cart", "checkout"]);
  });

  it("the till billed another total: stop, show it, and the next tap pays that order", async () => {
    const r = rig({ quoteTotal: 21.47 });
    r.answer(ORDER);
    r.tap();
    await settle();
    expect(r.calls.map((c) => c.url)).toEqual(["/api/orders/"]);
    expect(r.href()).toBe("");
    expect(r.billed()).toMatchObject({ from: 21.47, total: 25 });
    expect(r.toasts).toEqual(["Сумма изменилась — проверьте заказ"]);
    r.answer(PAY);
    r.tap();
    await settle();
    expect(r.calls.map((c) => c.url)).toEqual(["/api/orders/", "/api/payments/create/"]);
    expect(r.href()).toBe("https://montonio.example/card/1");
  });

  it("an order refused outright says why and makes nothing", async () => {
    const r = rig();
    r.answer({ status: 400, body: { ok: false, error: "out_of_stock" } });
    r.tap();
    await settle();
    expect(r.toasts).toEqual(["order:out_of_stock"]);
    expect(r.href()).toBe("");
    expect(r.busy()).toBe(false);
  });

  it("a screen that moved since it was drawn is redrawn, and nothing is ordered", async () => {
    const r = rig({ stale: true });
    r.tap();
    await settle();
    expect(r.calls).toEqual([]);
    expect(r.patches()).toBeGreaterThan(0);
    expect(r.toasts).toEqual(["Данные заказа обновились — проверьте и нажмите ещё раз"]);
  });
});

/* ---------- the receipt of an express order leaves the basket alone ------ */

describe("the receipt of an express order does not settle the basket", () => {
  it("doneState() asks expressOwns() before dropping or refilling the cart", () => {
    const done = slice("doneState");
    const at = done.indexOf("if (!expressOwns(S.done.order, S.done.number)) {");
    expect(at, "doneState() no longer asks whether the order was an express one").toBeGreaterThan(-1);
    expect(done.indexOf("doneDropHeld();", at)).toBeGreaterThan(at);
    expect(done.indexOf("restoreHeldCart(S.done.order);", at)).toBeGreaterThan(at);
  });

  it("«Оплатить ещё раз» parks and empties the basket only for a checkout order", () => {
    const again = slice("payAgain");
    const at = again.indexOf("if (!expressOwns(orderId)) {");
    expect(at).toBeGreaterThan(-1);
    expect(again.indexOf("holdCart(orderId);", at)).toBeGreaterThan(at);
    expect(again.indexOf("clearOrderState();", at)).toBeGreaterThan(at);
  });

  it("expressMark()/expressOwns() remember an order by id and by number, for a day", () => {
    const store: Record<string, string> = {};
    const body = `
      var localStorage = {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(STORE, k) ? STORE[k] : null; },
        setItem: function (k, v) { STORE[k] = String(v); }
      };
      var EXPRESS_LS = "rmp-express-orders";
      ${slice("expressRead")}
      ${slice("expressMark")}
      ${slice("expressOwns")}
      return { mark: expressMark, owns: expressOwns };
    `;
    const m = new Function("STORE", body)(store) as {
      mark(id: string, n: string): void; owns(id?: string, n?: string): boolean;
    };
    expect(m.owns("order-1", "R-100001")).toBe(false);
    m.mark("order-1", "R-100001");
    // a failed receipt carries the id, a paid one only the number
    expect(m.owns("order-1")).toBe(true);
    expect(m.owns("", "R-100001")).toBe(true);
    expect(m.owns("order-2", "R-100002")).toBe(false);
    expect(m.owns("", "")).toBe(false);
    // a day later it is somebody else's business
    const list = JSON.parse(store["rmp-express-orders"]) as Array<{ at: number }>;
    list[0].at = Date.now() - 864e5 - 1;
    store["rmp-express-orders"] = JSON.stringify(list);
    expect(m.owns("order-1")).toBe(false);
  });
});
