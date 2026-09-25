/**
 * The nine delivery findings of round 21 (17.09.2026), one assertion each.
 *
 * They came out of a full audit as «medium» and «low», which is to say: none
 * of them stops the shop, and every one of them either costs money quietly or
 * tells somebody something that is not true. That second kind is what most of
 * this file is about — a scanner that blames the browser for a download that
 * failed, a shipment box that calls a refused registration a parcel on its
 * way, a rate box that promises free delivery it puts a price back on.
 *
 * The storefront halves are sliced out of public/shop2/app.js **by source
 * text** and run against stubs, the way tests/shop-lost-answer.test.ts and
 * tests/checkout-parity.test.ts already do it: this tests the shop's own code
 * rather than a retyped copy of it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { closeDeliveredOrders } from "@/lib/delivery";
import {
  createOrder,
  fallbackShipping,
  getOrder,
  OrderError,
  setOrderStatus,
  setSetting,
} from "@/lib/orders";
import type { Order } from "@/lib/orders";
import { cheapestCost } from "@/lib/shipping/country-prices";
import { resetShippingRulesCache } from "@/lib/shipping";
import {
  createMontonioShipment,
  montonioShippingBaseUrl,
  resetMontonioCarriersCache,
  resetMontonioPointsCache,
} from "@/lib/shipping/montonio";
import { resetPointsCache } from "@/lib/parcel-points";
import catalogueMin from "@/data/catalogue.min.json";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

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

/* ------------------------------------------------------------------------ *
 * 3. loadShipRules() asks for a FRESH copy of /api/overrides/
 * ------------------------------------------------------------------------ */

describe("the checkout's own read of the delivery rules", () => {
  /*
   * /api/overrides/ goes out with `public, s-maxage=30,
   * stale-while-revalidate=120`, which leaves the BROWSER a copy with no
   * freshness of its own and a two-minute stale window — so a bare fetch() is
   * handed whatever this browser saved last time. The file has FEED_FETCH
   * (`cache: "no-store"`) for exactly that, and the two other readers of the
   * feed use it. loadShipRules() did not, and it MERGES what comes back over
   * the boot copy (applyShipRules), so a stale number could overwrite a fresh
   * one and the checkout would quote a price the shop is not charging.
   */
  it("passes FEED_FETCH, like every other reader of that feed", () => {
    const fn = slice("loadShipRules");
    expect(fn).toContain('fetch("/api/overrides/", FEED_FETCH)');
    expect(fn, "a bare fetch() is handed the browser's stale copy").not.toMatch(
      /fetch\("\/api\/overrides\/"\s*\)/,
    );
  });

  it("and FEED_FETCH is still the no-store it claims to be", () => {
    expect(src).toContain('var FEED_FETCH = { cache: "no-store" };');
  });
});

/* ------------------------------------------------------------------------ *
 * 1. the scanner blames the network, not the browser
 * ------------------------------------------------------------------------ */

describe("the scanner when the bundled decoder does not load", () => {
  /*
   * iOS Safari has no BarcodeDetector at any version, so the scanner always
   * takes scanNativeGaveUp("absent") on the owner's own phone and the bundled
   * zxing IS its decoder. When the fetch of that script failed — the
   * stockroom's wifi — the card said «Камера не поддерживается этим браузером
   * … работает … в Safari 17+ на iPhone», which is untrue twice: the camera is
   * supported (its stream is open behind the card) and the browser named is
   * the one he is holding.
   */
  it("no longer tells an iPhone that iPhones are supported and it is not one", () => {
    // the literal, with its opening quote — the sentence is still named in a
    // comment beside the line that replaced it, and that is where it belongs
    expect(src).not.toContain('"Камера не поддерживается этим браузером');
  });

  it("says the reader did not load, and how to try again", () => {
    const fn = slice("scanNativeGaveUp");
    expect(fn).toContain("Не удалось загрузить распознавание штрихкодов");
    expect(fn).toContain("откройте сканер заново");
    // the merely-mute detector still goes back on rather than showing anything
    expect(fn).toContain('if (reason === "silent") { startNativeLoop(); return; }');
  });

  it("is a sentence both dictionaries carry", () => {
    // three copies of the key: the two dictionaries' and the one that reaches
    // S.scanErr — and each dictionary's own answer beside it
    expect(src.split("Не удалось загрузить распознавание штрихкодов").length - 1).toBe(3);
    expect(src, "ET").toContain("Triipkoodituvastust ei õnnestunud laadida");
    expect(src, "EN").toContain("The barcode reader could not be loaded");
  });
});

/* ------------------------------------------------------------------------ *
 * 12. a shipment Montonio refused does not look like one on its way
 * ------------------------------------------------------------------------ */

type Mont = Record<string, unknown>;

/** Run the real admShipmentBoxHTML() over one order's `shipping.montonio`. */
function shipmentBox(mont: Mont): string {
  const body = `
    var SRV = { shipBusy: false };
    ${slice("esc")}
    function carrierWord(c) { return c ? String(c) : ""; }
    function srvAddrLine(s) { return (s && s.pointName) || ""; }
    // 1a: the box is a «Посылка» section with a status tag in its header
    function admSecHeadHTML(t, k, h, extra) { return "<h2>" + t + "</h2>" + (extra || ""); }
    function admTagHTML(kind, text) { return '<span class="adm-tag">' + text + "</span>"; }
    ${slice("shipRegFailed")}
    ${slice("admShipmentBoxHTML")}
    return admShipmentBoxHTML({ id: "o1", srv: { shipping: { montonio: MONT, pointName: "Kristiine" } } });
  `;
  return new Function("MONT", body)(mont) as string;
}

describe("«Отправление» — the parcel as Montonio really has it", () => {
  /*
   * Montonio's shipment vocabulary is pending | registered |
   * registrationFailed | inTransit | awaitingCollection | delivered |
   * returned, stored by «Создать этикетку» and overwritten by every
   * `shipment.statusUpdated` webhook. The box read none of it: a shipment the
   * carrier never accepted had an id, a PDF button and the line «Трек-номер
   * появится, когда перевозчик примет посылку» — so it looked exactly like a
   * good one, for as long as Renat was willing to wait for a code that was
   * never coming.
   */
  it("says so when the carrier refused the registration", () => {
    const html = shipmentBox({ shipmentId: "shp-1", status: "registrationFailed" });
    expect(html).toContain("Перевозчик не принял");
    /* Since 24.09.2026 the fix is one button — «Отправить заново», the order's
       own step button on a refused parcel — which sends this same shipment
       with PATCH (Montonio: «you can just try again»). It used to say «set the
       label aside and create it anew», which the server refused (audit
       18.09.2026 F15; map defect #19). */
    expect(html).toContain("Нажмите «Отправить заново»");
    expect(html).toContain("второй посылки не будет");
    expect(html).not.toContain("Отложите этикетку");
    expect(html, "the parcel is not waiting for anybody").not.toContain(
      "Трек-номер появится, когда перевозчик примет посылку.",
    );
    // and no PDF to open: there is no label, and the label route answers 409
    expect(html).not.toContain("data-labelpdf");
  });

  it("leaves a shipment on its way exactly as it was", () => {
    const waiting = shipmentBox({ shipmentId: "shp-2", status: "registered" });
    expect(waiting).toContain("Трек-номер появится, когда перевозчик примет посылку.");
    expect(waiting).not.toContain("Перевозчик не принял");

    const going = shipmentBox({ shipmentId: "shp-3", status: "inTransit", trackingCode: "CC1EE" });
    expect(going).toContain("CC1EE");
    expect(going).not.toContain("Перевозчик не принял");

    // an order booked before the status was ever stored keeps the old box
    const old = shipmentBox({ shipmentId: "shp-4" });
    expect(old).toContain("Трек-номер появится, когда перевозчик примет посылку.");
  });

  /* Map defect #19 (audit 18.09.2026 F15): the card's instruction and its
     button must match what the server does. On a refused parcel the order's
     step button is «Отправить заново» and it posts to the same route, which
     PATCHes the same shipment — never «Отправлен» over a parcel that cannot
     move, never advice the server refuses. */
  it("offers «Отправить заново» as the one step on a refused parcel", () => {
    const vm = new Function(`
      ${slice("shipRegFailed")}
      return function (mont) {
        var hasShipment = !!(mont && mont.shipmentId);
        return { labeled: hasShipment && !mont.dismissed && !shipRegFailed(mont.status),
                 shipRefused: hasShipment && shipRegFailed(mont.status) };
      };
    `)() as (m: Mont) => { labeled: boolean; shipRefused: boolean };
    // the view model's own two lines, not a copy: the test above holds the words
    expect(src).toContain("var labeled = hasShipment && !mont.dismissed && !shipRegFailed(mont.status);");
    expect(src).toContain("var shipRefused = hasShipment && shipRegFailed(mont.status);");

    const step = new Function(`
      var SRV = { shipBusy: false, stepBusy: "" };
      ${slice("esc")}
      ${slice("admOrderStepBtn")}
      return admOrderStepBtn;
    `)() as (v: Record<string, unknown>, row: boolean) => string;

    const refused = { id: "o1", paid: true, ...vm({ shipmentId: "s1", status: "registrationFailed" }) };
    const html = step(refused, false);
    expect(html).toContain("Отправить заново");
    expect(html).toContain('data-admlabel="o1"');
    expect(html).not.toContain("Отправлен<");

    const fresh = { id: "o2", paid: true, labeled: false, shipRefused: false };
    expect(step(fresh, false)).toContain("Создать этикетку");
    const booked = { id: "o3", paid: true, ...vm({ shipmentId: "s3", status: "registered" }) };
    expect(step(booked, false)).toContain("data-admshipnow");
  });

  it("reads the word however Montonio spells it, and nothing else", () => {
    const failed = new Function(`${slice("shipRegFailed")} return shipRegFailed;`)() as (
      s: unknown,
    ) => boolean;
    for (const yes of ["registrationFailed", "REGISTRATION_FAILED", "registration failed", "failed"]) {
      expect(failed(yes), yes).toBe(true);
    }
    for (const no of ["", null, undefined, "registered", "pending", "inTransit", "delivered", "returned"]) {
      expect(failed(no), String(no)).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------------ *
 * 17. «Остальные страны» → «Курьер»: an empty box is not free delivery
 * ------------------------------------------------------------------------ */

/** Run the real admShipCourierFoot() for one row of the rate table. */
function courierFoot(key: string, value: string): string {
  const body = `
    var S = { lang: "RU" };
    var MONTONIO_PRICE = { courier: { EE: [10.84, "dpd"] } };
    var SHIP_RULES_DEFAULT = { methods: { courier: { "default": 9.9 } } };
    function admRateFootHTML(k, v, price, carrier) { return "MONTONIO-FOOT:" + price; }
    ${slice("eur")}
    ${slice("admShipCourierFoot")}
    return admShipCourierFoot(KEY, VALUE);
  `;
  return new Function("KEY", "VALUE", body)(key, value) as string;
}

describe("what an empty «Курьер» box does, row by row", () => {
  /*
   * The hint said «пусто — доставка бесплатна», which is what
   * quoteFromRules() would do if `methods.courier.default` could go missing.
   * It cannot: a whole-table save re-seeds the methods from
   * SHIP_RULES_DEFAULT (setShipRules) and parseShippingRules() seeds the same
   * cell on the server, so the box comes straight back at 9,90 € and the shop
   * goes on charging it. The owner was promised free delivery by the one
   * screen that decides whether he gives any.
   */
  it("«Остальные страны» names the price that comes back, not free delivery", () => {
    const hint = courierFoot("default", "");
    expect(hint).not.toContain("доставка бесплатна");
    expect(hint).toContain("пусто — вернётся 9,90 €");
  });

  it("«Другие страны Европы» still falls through, because that cell really can stay empty", () => {
    expect(courierFoot("EU", "")).toContain("пусто — берётся «Остальные страны»");
  });

  it("a row Montonio prices keeps its own «Montonio: …» line", () => {
    expect(courierFoot("EE", "")).toBe("MONTONIO-FOOT:10.84");
  });

  it("and the sentence is a rule both languages carry", () => {
    expect(src).toContain('[/^пусто — вернётся (.+)$/, { ET: "tühi — tuleb tagasi $1", EN: "empty — it goes back to $1" }]');
    expect(src, "the old key is gone from the dictionaries too").not.toContain('"пусто — доставка бесплатна"');
  });
});

/* ------------------------------------------------------------------------ *
 * 18. the last-resort table gives Europe Estonia's threshold
 * ------------------------------------------------------------------------ */

describe("fallbackShipping — the table used when computeShipping() throws", () => {
  /*
   * It ran on ONE freeFrom (59 €) for the whole world while the real rules
   * carry `freeFromByCountry: { EU: 200 }`, so a 60 € order to Greece shipped
   * free against a 43,19 € courier — the exact hole the 200 € threshold was
   * introduced to close on 08.09.2026. Rare (it needs the shipping module to
   * be unloadable or throwing) and real.
   */
  it("holds Europe to the 200 € the real rules hold it to", () => {
    expect(fallbackShipping("GR", "courier", 60)).toBe(9.9);
    expect(fallbackShipping("DE", "courier", 199)).toBe(9.9);
    expect(fallbackShipping("DE", "courier", 200)).toBe(0);
  });

  it("leaves the four home rows on their own 59 €", () => {
    expect(fallbackShipping("EE", "parcel", 10)).toBe(5.47);
    expect(fallbackShipping("EE", "parcel", 59)).toBe(0);
    expect(fallbackShipping("EE", "courier", 10)).toBe(10.84);
    expect(fallbackShipping("LV", "courier", 59)).toBe(0);
    expect(fallbackShipping("FI", "courier", 59)).toBe(0);
    expect(fallbackShipping("LT", "courier", 10)).toBe(9.9);
  });

  it("still gives pickup away and still prices a country nothing is sold to", () => {
    expect(fallbackShipping("EE", "pickup", 10)).toBe(0);
    // «Остальные страны» has no key of its own — the shop-wide 59 € applies
    expect(fallbackShipping("US", "courier", 10)).toBe(9.9);
    expect(fallbackShipping("US", "courier", 59)).toBe(0);
  });
});

/* ------------------------------------------------------------------------ *
 * 9. the label books the carrier the price was computed from
 * ------------------------------------------------------------------------ */

const ACCESS = "test-access-key";
const SECRET = "test-secret-key-at-least-16-chars";
const BASE = montonioShippingBaseUrl("sandbox");

type Call = { url: string };

function stubFetch(routes: Array<[RegExp, () => Response]>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push({ url });
      for (const [re, handler] of routes) if (re.test(url)) return handler();
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function courierOrder(country: string): Order {
  return {
    id: "11111111-2222-3333-4444-555555555555",
    number: "R-100777",
    status: "paid",
    lang: "RU",
    currency: "EUR",
    email: "ostja@example.com",
    phone: "+372 5810 7505",
    name: "Johnny Receiver",
    shipping: {
      method: "courier",
      country,
      pointId: null,
      pointName: null,
      address: { addr: "Kai 11", zip: "10111", city: "Tallinn" },
      price: 22.29,
    },
    items: [{ id: "free-hold", kind: "product", title: "Free.Hold", variant: "100 мл", qty: 1, price: 11, sum: 11 }],
    subtotal: 11,
    shippingPrice: 22.29,
    discount: 0,
    discountCode: null,
    channel: "web",
    customerId: null,
    pricingTier: null,
    loyaltyDiscount: 0,
    total: 33.29,
    payment: null,
    notes: null,
    createdAt: "2026-09-17T10:00:00.000Z",
    updatedAt: "2026-09-17T10:00:00.000Z",
  } as unknown as Order;
}

describe("which carrier a courier label books", () => {
  beforeEach(() => {
    process.env.MONTONIO_ACCESS_KEY = ACCESS;
    process.env.MONTONIO_SECRET_KEY = SECRET;
    process.env.MONTONIO_ENV = "sandbox";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MONTONIO_ACCESS_KEY;
    delete process.env.MONTONIO_SECRET_KEY;
    delete process.env.MONTONIO_ENV;
  });

  /*
   * A courier price is costBasis() → cheapestCost(): nobody chooses the
   * carrier for a courier, Renat does, at the label, so the shelf price covers
   * the cheapest one he CAN choose. resolveCourierService() is where he
   * chooses, and it walked Montonio's `/shipping-methods` list in whatever
   * order it arrived — so Germany could be charged at SmartPosti's 22.23 € and
   * posted with DPD at 32.74 €, ten euro out of the margin of one parcel.
   */
  it("asks the cheapest carrier first, whatever order Montonio lists them in", async () => {
    expect(cheapestCost("DE", "courier")?.carrier, "the tariff mirror moved").toBe("smartpost");
    const calls = stubFetch([
      [
        /shipping-methods$/,
        () =>
          json({
            countries: [
              {
                countryCode: "DE",
                carriers: [
                  // Montonio hands DPD back first; DPD is 32.74 € and SmartPosti 22.23 €
                  { carrierCode: "dpd", shippingMethods: [{ type: "courier" }] },
                  { carrierCode: "smartpost", shippingMethods: [{ type: "courier" }] },
                ],
              },
            ],
          }),
      ],
      [/courier-services/, () => json({ courierServices: [{ id: "svc-1", type: "standard" }] })],
      [
        /\/shipments$/,
        () =>
          json({
            id: "1f83f4c1-cccc-4dd5-8eae-837e6a88362f",
            status: "registered",
            shippingMethod: { type: "courier", carrierCode: "smartpost", countryCode: "DE" },
            parcels: [{ carrierParcelId: "TRK1" }],
          }),
      ],
    ]);

    const shipment = await createMontonioShipment(courierOrder("DE"));

    const asked = calls.filter((c) => c.url.includes("courier-services"));
    expect(asked).toHaveLength(1);
    expect(asked[0].url).toBe(`${BASE}/shipping-methods/courier-services?carrierCode=smartpost&countryCode=DE`);
    expect(shipment.carrier).toBe("smartpost");
  });

  it("still falls through to a dearer carrier when the cheapest has no service", async () => {
    const calls = stubFetch([
      [
        /shipping-methods$/,
        () =>
          json({
            countries: [
              {
                countryCode: "DE",
                carriers: [
                  { carrierCode: "dpd", shippingMethods: [{ type: "courier" }] },
                  { carrierCode: "smartpost", shippingMethods: [{ type: "courier" }] },
                ],
              },
            ],
          }),
      ],
      [
        /courier-services\?carrierCode=smartpost/,
        () => json({ courierServices: [] }),
      ],
      [/courier-services/, () => json({ courierServices: [{ id: "svc-dpd", type: "standard" }] })],
      [
        /\/shipments$/,
        () =>
          json({
            id: "1f83f4c1-cccc-4dd5-8eae-837e6a88362f",
            status: "registered",
            shippingMethod: { type: "courier", carrierCode: "dpd", countryCode: "DE" },
            parcels: [{ carrierParcelId: "TRK2" }],
          }),
      ],
    ]);

    const shipment = await createMontonioShipment(courierOrder("DE"));
    const asked = calls.filter((c) => c.url.includes("courier-services")).map((c) => c.url);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain("carrierCode=smartpost");
    expect(asked[1]).toContain("carrierCode=dpd");
    expect(shipment.carrier).toBe("dpd");
  });

  /* Nova Post is the cheapest courier on most routes and is deliberately kept
     out of every basis — it is Montonio International Shipping and takes no
     returns at all. It must not be promoted here either. */
  it("does not prefer a carrier no price was ever based on", async () => {
    const calls = stubFetch([
      [
        /shipping-methods$/,
        () =>
          json({
            countries: [
              {
                countryCode: "DE",
                carriers: [
                  { carrierCode: "smartpost", shippingMethods: [{ type: "courier" }] },
                  { carrierCode: "novaPost", shippingMethods: [{ type: "courier" }] },
                ],
              },
            ],
          }),
      ],
      [/courier-services/, () => json({ courierServices: [{ id: "svc-1", type: "standard" }] })],
      [
        /\/shipments$/,
        () =>
          json({
            id: "1f83f4c1-cccc-4dd5-8eae-837e6a88362f",
            status: "registered",
            shippingMethod: { type: "courier", carrierCode: "smartpost", countryCode: "DE" },
            parcels: [{ carrierParcelId: "TRK3" }],
          }),
      ],
    ]);

    await createMontonioShipment(courierOrder("DE"));
    const asked = calls.filter((c) => c.url.includes("courier-services"));
    expect(asked[0].url).toContain("carrierCode=smartpost");
  });
});

/* ------------------------------------------------------------------------ *
 * 7. a pickup-point lookup that FAILED is not cached as «no points»
 * ------------------------------------------------------------------------ */

const ORIGIN = "https://rempire.ee";
let ip = 0;
function pointsReq(path: string) {
  return new Request(`${ORIGIN}${path}`, {
    headers: { "x-forwarded-for": `203.0.113.${(ip++ % 200) + 1}` },
  });
}

describe("GET /api/shipping/points — what an empty answer is allowed to mean", () => {
  beforeEach(() => {
    resetMontonioPointsCache();
    resetMontonioCarriersCache();
    resetPointsCache();
    process.env.MONTONIO_ACCESS_KEY = ACCESS;
    process.env.MONTONIO_SECRET_KEY = SECRET;
    process.env.MONTONIO_ENV = "sandbox";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MONTONIO_ACCESS_KEY;
    delete process.env.MONTONIO_SECRET_KEY;
    delete process.env.MONTONIO_ENV;
  });

  /*
   * fetchMontonioPickupPoints() answers `null` — never a throw — when every
   * carrier call failed, and the route could not tell that from a real empty
   * list. Unisend and Nova Post have no public feed to fall back on
   * (src/lib/parcel-points.ts covers omniva/dpd/smartpost only), so one slow
   * minute at Montonio went out as `{ points: [] }` with `s-maxage=3600` and
   * the chips were gone from the checkout for an hour behind that edge — and
   * for a day on the stale window.
   */
  it("answers no-store when the lookup failed and nothing else could answer", async () => {
    stubFetch([[/./, () => json({ error: "boom" }, 500)]]);
    const { GET } = await import("@/app/api/shipping/points/route");
    const res = await GET(pointsReq("/api/shipping/points/?country=EE&carrier=unisend"));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.points).toEqual([]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("still caches a real answer of «this carrier has no machines here» for the hour", async () => {
    stubFetch([[/pickup-points/, () => json({ pickupPoints: [], countryCode: "EE" })]]);
    const { GET } = await import("@/app/api/shipping/points/route");
    const res = await GET(pointsReq("/api/shipping/points/?country=EE&carrier=unisend"));
    const body = await res.json();
    expect(body.points).toEqual([]);
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=3600, stale-while-revalidate=86400");
  });

  it("and caches a list that really has points in it", async () => {
    stubFetch([
      [
        /pickup-points/,
        () =>
          json({
            countryCode: "EE",
            pickupPoints: [
              {
                id: "cc118dac-f9e0-4163-b281-7006fddc08e7",
                name: "DPD Pakiautomaat Kristiine",
                type: "parcelMachine",
                streetAddress: "Endla 45",
                locality: "Tallinn",
                postalCode: "10616",
                carrierCode: "dpd",
              },
            ],
          }),
      ],
    ]);
    const { GET } = await import("@/app/api/shipping/points/route");
    const res = await GET(pointsReq("/api/shipping/points/?country=EE&carrier=dpd"));
    expect((await res.json()).count).toBe(1);
    expect(res.headers.get("cache-control")).toContain("s-maxage=3600");
  });
});

/* ------------------------------------------------------------------------ *
 * 11 + 13. the two that need the database
 * ------------------------------------------------------------------------ */

type Min = { id: string; s: string };
const inStock = (catalogueMin as Min[]).find((p) => p.s === "in")!;

function orderTo(country: string, method: string) {
  return {
    lang: "ru",
    items: [{ id: inStock.id, qty: 1 }],
    customer: { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" },
    shipping: { method, country },
  } as Parameters<typeof createOrder>[0];
}

describe("a country the owner switched off", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    await truncateAll();
    resetShippingRulesCache();
  });

  /*
   * `countriesOff` defaults to the seven European countries Montonio answers
   * `contract_prices_no_applicable_tier` for: an order to any of them can be
   * placed and paid for and then never posted. Only the checkout's own
   * dropdown asked — and europeOptionsHTML() deliberately KEEPS a country the
   * shopper has already picked, so a saved delivery address or a tab left open
   * over the switch bought a delivery the shop cannot make.
   */
  it("is refused at the till, not merely hidden in the window", async () => {
    await expect(createOrder(orderTo("NO", "parcel"))).rejects.toMatchObject({ code: "country_off" });
    await expect(createOrder(orderTo("GB", "courier"))).rejects.toBeInstanceOf(OrderError);
  });

  it("does not touch a country that is on", async () => {
    const o = await createOrder(orderTo("DE", "courier"));
    expect(o.shipping.country).toBe("DE");
  });

  it("follows the owner's own list, not a frozen one", async () => {
    await setSetting("shipping_rules", { countriesOff: ["DE"] });
    resetShippingRulesCache();
    // he switched Norway back on and Germany off — both have to take effect
    const norway = await createOrder(orderTo("NO", "parcel"));
    expect(norway.shipping.country).toBe("NO");
    await expect(createOrder(orderTo("DE", "courier"))).rejects.toMatchObject({ code: "country_off" });
  });

  /* Pickup, a gift-card-only basket and «электронная доставка» post nothing,
     and the country on them is the customer's own rather than a parcel's —
     the accountant export reads it. Pickup is the one of the three this
     fixture can express. */
  it("leaves pickup alone", async () => {
    const o = await createOrder(orderTo("NO", "pickup"));
    expect(o.shippingPrice).toBe(0);
  });
});

describe("the auto-«Доставлен» clock counts from the hand-over", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    await truncateAll();
    resetShippingRulesCache();
  });

  async function shippedOrder(): Promise<string> {
    const o = await createOrder(orderTo("EE", "parcel"));
    await setOrderStatus(o.id, "paid", "admin");
    await setOrderStatus(o.id, "shipped", "admin");
    return o.id;
  }
  async function statusOf(id: string): Promise<string> {
    const rows = await query<{ status: string }>("select status from orders where id = $1", [id]);
    return rows[0].status;
  }
  /** What a carrier webhook does to a row: a status, and `updated_at = now()`. */
  async function carrierSaidSomething(id: string): Promise<void> {
    await query(
      `update orders
          set shipping = coalesce(shipping, '{}'::jsonb)
                         || jsonb_build_object('montonio', jsonb_build_object('status', 'inTransit')),
              updated_at = now()
        where id = $1`,
      [id],
    );
  }

  it("stamps the day «Отправлен» was pressed, once", async () => {
    const id = await shippedOrder();
    const first = (await getOrder(id))!.shipping as unknown as { shippedAt?: string };
    expect(first.shippedAt, "no stamp at all").toBeTruthy();
    expect(Date.parse(first.shippedAt!)).toBeLessThanOrEqual(Date.now() + 1000);

    // the journal's undo and a second «Отправлен» keep the first date
    await setOrderStatus(id, "paid", "admin");
    await setOrderStatus(id, "shipped", "admin");
    const again = (await getOrder(id))!.shipping as unknown as { shippedAt?: string };
    expect(again.shippedAt).toBe(first.shippedAt);
  });

  /*
   * This is the defect. The notify route writes saveShipmentOnOrder() for
   * every status word the carrier sends, and that sets `updated_at = now()` —
   * so a parcel that reports progress more often than `autoDays` pushed its
   * own deadline forward with every message and never closed.
   */
  it("closes a parcel nine days out although a webhook touched the row a second ago", async () => {
    const id = await shippedOrder();
    await query(
      `update orders set shipping = shipping || jsonb_build_object('shippedAt', $2::text) where id = $1`,
      [id, new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString()],
    );
    await carrierSaidSomething(id);
    await setSetting("delivery", { autoDays: 7, useCarrier: false });

    const run = await closeDeliveredOrders();
    expect(run.closed).toBe(1);
    expect(await statusOf(id)).toBe("delivered");
  });

  it("and does not close one that only LOOKS old because nobody touched it", async () => {
    const id = await shippedOrder();
    // shipped two days ago; the row itself has not been written to for a month
    await query(
      `update orders
          set shipping = shipping || jsonb_build_object('shippedAt', $2::text),
              updated_at = now() - interval '30 days'
        where id = $1`,
      [id, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()],
    );
    await setSetting("delivery", { autoDays: 7, useCarrier: false });

    const run = await closeDeliveredOrders();
    expect(run.closed).toBe(0);
    expect(await statusOf(id)).toBe("shipped");
  });

  it("still counts from updated_at for an order shipped before the stamp existed", async () => {
    const id = await shippedOrder();
    await query(
      `update orders
          set shipping = shipping - 'shippedAt',
              updated_at = now() - interval '9 days'
        where id = $1`,
      [id],
    );
    await setSetting("delivery", { autoDays: 7, useCarrier: false });

    expect((await closeDeliveredOrders()).closed).toBe(1);
    expect(await statusOf(id)).toBe("delivered");
  });
});
