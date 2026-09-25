/**
 * Montonio Shipping — pickup points, the merge with the public feeds, the
 * shipment payload and the admin routes.
 *
 * Every literal response below is copied from Montonio's own documentation
 * (https://docs.montonio.com/api/shipping-v2/, read 03.09.2026), so a change on
 * their side shows up here as a failing test rather than as a silent 400.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { letterClock, lettersSettled } from "@/lib/letter-hold";
import montonioTariffsData from "@/data/montonio-tariffs.json";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { createOrder, getOrder, listAudit, setOrderStatus, type Order } from "@/lib/orders";
import { verifyHs256 } from "@/lib/payments/jwt";
import {
  type MontonioPoint,
  MontonioShippingError,
  createMontonioShipment,
  enrichCoordinates,
  estimateWeightKg,
  fetchMontonioCarrierReturns,
  fetchMontonioCarriers,
  fetchMontonioPickupPoints,
  fetchMontonioRates,
  fromParcelPoint,
  getMontonioLabel,
  mapMontonioPickupPoints,
  mergePoints,
  montonioShippingBaseUrl,
  resetMontonioCarriersCache,
  resetMontonioMethodsCache,
  resetMontonioPointsCache,
  shippingAuthToken,
  splitPhone,
} from "@/lib/shipping/montonio";
import { resetPointsCache } from "@/lib/parcel-points";
import { capturedMail } from "@/lib/mail";
import { MOCK_TRACKING_HOST, mockLabelPdf, mockLabel, shippingMockOn } from "@/lib/shipping/montonio-mock";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ACCESS = "test-access-key";
const SECRET = "test-secret-key-at-least-16-chars";
const BASE = montonioShippingBaseUrl("sandbox");
const POINT_UUID = "98b391d7-5299-447c-9ad7-6b4042ef8b2f";

/** Verbatim from the reference § "Get pickup points for a store". */
const PICKUP_POINTS_BODY = {
  pickupPoints: [
    {
      id: POINT_UUID,
      name: "Laagri Coop Maksimarketi pakiautomaat",
      type: "parcelMachine",
      streetAddress: "Pärnu mnt 558a",
      locality: "Laagri alevik",
      postalCode: "96067",
      carrierCode: "omniva",
      additionalServices: [{ code: "cod" }, { code: "ageVerification" }],
    },
    {
      id: "0739f3d5-a500-4f15-8432-a03ed6f82e91",
      name: "Laagri Veskitammi Maxima X pakiautomaat",
      type: "parcelMachine",
      streetAddress: "Veskitammi tn 3",
      locality: "Laagri alevik",
      postalCode: "96381",
      carrierCode: "omniva",
      additionalServices: [],
    },
  ],
  countryCode: "EE",
};

/** Verbatim from the shipments guide, trimmed to the fields we read. */
const SHIPMENT_BODY = {
  id: "1f83f4c1-cccc-4dd5-8eae-837e6a88362f",
  createdAt: "2024-06-13T08:50:45.376Z",
  status: "registered",
  merchantReference: "R-100001",
  shippingMethod: { type: "pickupPoint", id: POINT_UUID, carrierCode: "omniva", countryCode: "EE" },
  parcels: [
    {
      id: "ba5184ea-6470-4a2d-b216-2eebc75db40e",
      weight: 1,
      carrierParcelId: "CC543167770EE",
      trackingLink: "https://minu.omniva.ee/track/CC543167770EE?language=et",
      dropOffPin: "4821",
    },
  ],
};

type Call = { url: string; init: RequestInit | undefined };

/** A fetch stub that routes on the URL and records every call. */
function stubFetch(routes: Array<[RegExp, (init?: RequestInit) => Response]>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      for (const [re, handler] of routes) if (re.test(url)) return handler(init);
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
  return calls;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function withKeys() {
  process.env.MONTONIO_ACCESS_KEY = ACCESS;
  process.env.MONTONIO_SECRET_KEY = SECRET;
  process.env.MONTONIO_ENV = "sandbox";
}
/**
 * The `POST /shipments` out of a recorded call list, found rather than
 * indexed.
 *
 * Since 18.09.2026 a booking also asks `GET /shipping-methods` — that is where
 * `constraints.parcelDimensionsRequired` lives, and the reference's own Note
 * says to read it before deciding whether dimensions are required. So the
 * booking is no longer reliably `calls[0]`, and counting the calls before it
 * is a test that breaks every time the client gets one step cleverer without
 * anything about the request changing.
 */
function booking(calls: Array<{ url: string; init?: RequestInit }>): { url: string; init?: RequestInit } {
  const hit = calls.find((c) => /\/shipments$/.test(c.url) && c.init?.method === "POST");
  if (!hit) throw new Error(`no POST /shipments among ${calls.map((c) => c.url).join(", ")}`);
  return hit;
}
/**
 * …and its decoded body, which is what nearly every assertion below wants.
 * Typed loosely on purpose: this is a wire payload and the assertions reach
 * into it (`body.receiver.streetAddress`), exactly as they did when each of
 * them wrote its own `JSON.parse`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function bookingBody(calls: Array<{ url: string; init?: RequestInit }>): any {
  return JSON.parse(String(booking(calls).init?.body));
}

function withoutKeys() {
  delete process.env.MONTONIO_ACCESS_KEY;
  delete process.env.MONTONIO_SECRET_KEY;
  delete process.env.MONTONIO_ENV;
}

beforeEach(() => {
  resetMontonioPointsCache();
  resetMontonioCarriersCache();
  resetMontonioMethodsCache();
  resetPointsCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();   // SHIPPING_PROVIDER=mock and the e2e mail sink must not leak into the next test
  resetMontonioPointsCache();
  resetMontonioCarriersCache();
  resetMontonioMethodsCache();
  resetPointsCache();
  withoutKeys();
});

/* ---------- normalisation ------------------------------------------------ */

describe("normalising Montonio's pickup points", () => {
  it("reads the documented response", () => {
    const [p] = mapMontonioPickupPoints(PICKUP_POINTS_BODY);
    expect(p).toEqual({
      id: POINT_UUID,
      carrier: "omniva",
      name: "Laagri Coop Maksimarketi pakiautomaat",
      address: "Pärnu mnt 558a",
      city: "Laagri alevik",
      zip: "96067",
      country: "EE",
      // Montonio's pickup-point payload carries no coordinates at all
      lat: null,
      lng: null,
      type: "parcel_machine",
    });
  });

  it("maps all three Montonio point types into ours", () => {
    const body = {
      countryCode: "LV",
      pickupPoints: [
        { id: "a", name: "A", type: "parcelMachine", carrierCode: "dpd" },
        { id: "b", name: "B", type: "parcelShop", carrierCode: "dpd" },
        { id: "c", name: "C", type: "postOffice", carrierCode: "omniva" },
        { id: "d", name: "D", type: "somethingNew", carrierCode: "venipak" },
      ],
    };
    expect(mapMontonioPickupPoints(body).map((p) => p.type)).toEqual([
      "parcel_machine",
      "pickup_point",
      "post_office",
      "pickup_point",
    ]);
    expect(mapMontonioPickupPoints(body).every((p) => p.country === "LV")).toBe(true);
  });

  it("survives junk instead of a list", () => {
    expect(mapMontonioPickupPoints(null)).toEqual([]);
    expect(mapMontonioPickupPoints({ pickupPoints: "nope" })).toEqual([]);
    expect(mapMontonioPickupPoints({ pickupPoints: [null, 7, { id: "", name: "x" }, { id: "y" }] })).toEqual([]);
  });
});

/* ---------- authentication ----------------------------------------------- */

describe("authentication", () => {
  it("signs a Bearer JWT that carries accessKey and an hour of exp", () => {
    withKeys();
    const token = shippingAuthToken({ accessKey: ACCESS, secretKey: SECRET, env: "sandbox" });
    const claims = verifyHs256<{ accessKey?: string; exp?: number; iat?: number }>(token, SECRET);
    expect(claims.accessKey).toBe(ACCESS);
    expect(claims.exp! - claims.iat!).toBe(3600);
    // signed with the secret, so another secret must not verify
    expect(() => verifyHs256(token, "some-other-secret")).toThrow();
  });

  it("puts the token in the Authorization header, not the body", async () => {
    withKeys();
    const calls = stubFetch([[/pickup-points/, () => json(PICKUP_POINTS_BODY)]]);
    await fetchMontonioPickupPoints({ country: "EE", carrier: "omniva" });
    const auth = new Headers(calls[0].init?.headers).get("authorization") ?? "";
    expect(auth.startsWith("Bearer ")).toBe(true);
    expect(verifyHs256<{ accessKey?: string }>(auth.slice(7), SECRET).accessKey).toBe(ACCESS);
  });
});

/* ---------- returns ------------------------------------------------------ */

describe("fetchMontonioCarrierReturns — the only thing the API says about returns", () => {
  it("is null without keys, and asks nobody anything", async () => {
    const calls = stubFetch([[/./, () => json({})]]);
    expect(await fetchMontonioCarrierReturns()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("reads returnsAllowed and daysAllowedForReturns off each contract", async () => {
    withKeys();
    const calls = stubFetch([
      [
        /\/carriers$/,
        () =>
          json({
            carriers: [
              {
                code: "OMNIVA",
                contracts: [
                  { country: "ee", isDirectContract: false, returnsAllowed: true, daysAllowedForReturns: 14 },
                  { country: "LV", isDirectContract: false, returnsAllowed: false, daysAllowedForReturns: null },
                ],
              },
              // SmartPosti's returns run through the carrier's own self-service,
              // so its contract can say false while returns still work.
              { code: "smartpost", contracts: [{ country: "FI", returnsAllowed: false }] },
              { code: "dpd", contracts: null }, // no contract at all
              { contracts: [{ country: "EE", returnsAllowed: true }] }, // no code — skipped
            ],
          }),
      ],
    ]);
    const rows = await fetchMontonioCarrierReturns();
    expect(calls).toHaveLength(1);
    expect(rows).toEqual([
      { carrier: "omniva", country: "EE", directContract: false, returnsAllowed: true, daysAllowedForReturns: 14 },
      { carrier: "omniva", country: "LV", directContract: false, returnsAllowed: false, daysAllowedForReturns: null },
      { carrier: "smartpost", country: "FI", directContract: false, returnsAllowed: false, daysAllowedForReturns: null },
    ]);
  });

  it("answers null rather than throwing when Montonio will not talk", async () => {
    withKeys();
    stubFetch([[/\/carriers$/, () => new Response("nope", { status: 500 })]]);
    expect(await fetchMontonioCarrierReturns()).toBeNull();
  });
});

/* ---------- carrier logos ------------------------------------------------- */

/* Dim, 08.09.2026: the delivery step should show each carrier's own mark next
   to its name, the way the payment step already shows the banks'. `GET
   /carriers` is the only Montonio endpoint that carries a logoUrl at all — the
   three /shipping-methods paths do not — so this is where the picture comes
   from, and what happens when it does not come is as much of the feature as
   the picture itself: the checkout keeps its coloured dots. */
describe("fetchMontonioCarriers — the brand marks", () => {
  it("is null without keys, and asks nobody anything", async () => {
    const calls = stubFetch([[/./, () => json({})]]);
    expect(await fetchMontonioCarriers()).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("reads code, name and logoUrl, and holds the answer", async () => {
    withKeys();
    const calls = stubFetch([
      [
        /\/carriers$/,
        () =>
          json({
            carriers: [
              {
                id: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
                code: "SMARTPOST",
                name: "SmartPosti",
                logoUrl: "https://public.montonio.com/images/carrier_logos/smartpost.svg",
                hasMontonioContract: true,
              },
              // a carrier with no mark of its own keeps its dot, not a hole
              { code: "venipak", name: "Venipak", logoUrl: null },
              { name: "no code at all" },
            ],
          }),
      ],
    ]);

    expect(await fetchMontonioCarriers()).toEqual([
      { code: "smartpost", name: "SmartPosti", logoUrl: "https://public.montonio.com/images/carrier_logos/smartpost.svg" },
      { code: "venipak", name: "Venipak", logoUrl: "" },
    ]);
    // …and the second reader of the day gets the cached copy, not a second call
    await fetchMontonioCarriers();
    expect(calls).toHaveLength(1);
  });

  it("answers null rather than throwing when Montonio will not talk", async () => {
    withKeys();
    stubFetch([[/\/carriers$/, () => new Response("nope", { status: 500 })]]);
    expect(await fetchMontonioCarriers()).toBeNull();
  });
});

describe("GET /api/shipping/carriers", () => {
  it("refuses without keys, so the checkout falls back to its dots", async () => {
    const { GET } = await import("@/app/api/shipping/carriers/route");
    const res = await GET(new Request("https://rempireshop.ee/api/shipping/carriers/"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "not_configured" });
  });

  it("hands the checkout the list, cached at the edge", async () => {
    withKeys();
    stubFetch([
      [
        /\/carriers$/,
        () => json({ carriers: [{ code: "omniva", name: "Omniva", logoUrl: "https://public.montonio.com/x.svg" }] }),
      ],
    ]);
    const { GET } = await import("@/app/api/shipping/carriers/route");
    const res = await GET(new Request("https://rempireshop.ee/api/shipping/carriers/"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      carriers: [{ code: "omniva", name: "Omniva", logoUrl: "https://public.montonio.com/x.svg" }],
    });
    expect(res.headers.get("cache-control")).toContain("s-maxage=21600");
  });
});

/* ---------- fetching ----------------------------------------------------- */

describe("fetchMontonioPickupPoints", () => {
  it("is null without keys, and asks nobody anything", async () => {
    const calls = stubFetch([[/./, () => json({})]]);
    expect(await fetchMontonioPickupPoints({ country: "EE", carrier: "omniva" })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("asks the documented endpoint and caches the answer", async () => {
    withKeys();
    const calls = stubFetch([[/pickup-points/, () => json(PICKUP_POINTS_BODY)]]);
    const first = await fetchMontonioPickupPoints({ country: "EE", carrier: "omniva" });
    expect(first).toHaveLength(2);
    expect(calls[0].url).toBe(
      `${BASE}/shipping-methods/pickup-points?carrierCode=omniva&countryCode=EE`,
    );
    await fetchMontonioPickupPoints({ country: "EE", carrier: "omniva" });
    expect(calls).toHaveLength(1);
  });

  it("without a carrier, asks /shipping-methods which ones are active", async () => {
    withKeys();
    const calls = stubFetch([
      [
        /shipping-methods$/,
        () =>
          json({
            countries: [
              {
                countryCode: "EE",
                carriers: [
                  { carrierCode: "omniva", shippingMethods: [{ type: "pickupPoint" }, { type: "courier" }] },
                  { carrierCode: "venipak", shippingMethods: [{ type: "courier" }] },
                ],
              },
            ],
          }),
      ],
      [/pickup-points/, () => json(PICKUP_POINTS_BODY)],
    ]);
    const points = await fetchMontonioPickupPoints({ country: "EE" });
    expect(points).toHaveLength(2);
    // venipak has no pickupPoint method in EE, so it is never asked for points
    expect(calls.filter((c) => c.url.includes("pickup-points"))).toHaveLength(1);
  });

  it("is null — not a throw — when Montonio refuses", async () => {
    withKeys();
    stubFetch([[/pickup-points/, () => new Response("nope", { status: 500 })]]);
    expect(await fetchMontonioPickupPoints({ country: "EE", carrier: "dpd" })).toBeNull();
  });

  it("filters by point type when asked", async () => {
    withKeys();
    stubFetch([
      [
        /pickup-points/,
        () =>
          json({
            countryCode: "EE",
            pickupPoints: [
              { id: "a", name: "A", type: "parcelMachine", carrierCode: "omniva" },
              { id: "b", name: "B", type: "postOffice", carrierCode: "omniva" },
            ],
          }),
      ],
    ]);
    const only = await fetchMontonioPickupPoints({ country: "EE", carrier: "omniva", type: "postOffice" });
    expect(only!.map((p) => p.id)).toEqual(["b"]);
  });
});

/* ---------- merging with the feeds --------------------------------------- */

describe("merging Montonio with the public feeds", () => {
  const feedPoint = (over: Partial<MontonioPoint> = {}): MontonioPoint => ({
    id: "omniva-96243",
    carrier: "omniva",
    name: "Abja Coop Konsumi pakiautomaat",
    address: "Pärnu mnt 13",
    city: "Mulgi vald",
    zip: "",
    country: "EE",
    lat: 58.125803,
    lng: 25.355809,
    type: "parcel_machine",
    ...over,
  });

  it("keeps a carrier feed only where Montonio did not answer for it", () => {
    const montonio = mapMontonioPickupPoints(PICKUP_POINTS_BODY);
    const merged = mergePoints(montonio, [
      feedPoint(),
      feedPoint({ id: "smartpost-1", carrier: "smartpost", name: "Tallinn Kristiine" }),
    ]);
    expect(merged).toHaveLength(3);
    // omniva is Montonio's now — its feed rows are dropped whole, ids and all
    expect(merged.filter((p) => p.carrier === "omniva").map((p) => p.id)).toEqual(
      montonio.map((p) => p.id),
    );
    expect(merged.some((p) => p.id === "smartpost-1")).toBe(true);
  });

  it("dedupes the rest by carrier + zip + name", () => {
    const a = feedPoint({ carrier: "smartpost", id: "one" });
    const same = feedPoint({ carrier: "smartpost", id: "two", name: "  ABJA coop konsumi   pakiautomaat " });
    const other = feedPoint({ carrier: "smartpost", id: "three", zip: "10111" });
    expect(mergePoints([], [a, same, other]).map((p) => p.id)).toEqual(["one", "three"]);
  });

  it("brings the feed's coordinates across and translates its type", () => {
    const office = fromParcelPoint({
      id: "omniva-11701",
      carrier: "omniva",
      name: "Tallinn post office",
      address: "Narva mnt 1",
      city: "Tallinn",
      zip: "11701",
      country: "EE",
      lat: 59.4,
      lng: 24.7,
      type: "office",
    });
    expect(office.type).toBe("post_office");
    expect(office.lat).toBe(59.4);
    expect(fromParcelPoint({ ...office, type: "machine", lat: NaN, lng: NaN }).lat).toBeNull();
  });
});

describe("enrichCoordinates — Montonio's rows borrow lat/lng from the carrier feed", () => {
  const feed = (over: Partial<MontonioPoint>): MontonioPoint => ({
    id: "omniva-1",
    carrier: "omniva",
    name: "Tallinna Balti Jaama pakiautomaat",
    address: "Toompuiestee 37",
    city: "Tallinn",
    zip: "10133",
    country: "EE",
    lat: 59.44,
    lng: 24.737,
    type: "parcel_machine",
    ...over,
  });
  const montonio = (over: Partial<MontonioPoint>): MontonioPoint =>
    feed({ id: "93ef56f2-12ff-4d81-9c5a-5b2ad5eec0bb", lat: null, lng: null, ...over });

  it("matches by place name, ignoring the carrier word, case and punctuation", () => {
    const { points, matched } = enrichCoordinates(
      [montonio({ name: "Tallinna Balti jaama PAKIAUTOMAAT", zip: "10133" })],
      [feed({ name: "Tallinna Balti Jaama pakiautomaat" })],
    );
    expect(matched).toBe(1);
    expect(points[0].lat).toBe(59.44);
    expect(points[0].lng).toBe(24.737);
    expect(points[0].id).toBe("93ef56f2-12ff-4d81-9c5a-5b2ad5eec0bb"); // the Montonio id stays
  });

  it("falls back to zip + house number, then to a zip only one feed row has", () => {
    const { points } = enrichCoordinates(
      [
        montonio({ id: "a", name: "Selver Torupilli", address: "Vesivärava tn 37", zip: "10126" }),
        montonio({ id: "b", name: "Somewhere else", address: "", zip: "96332" }),
      ],
      [
        feed({ id: "f1", name: "Torupilli Selveri pakiautomaat", address: "Vesivärava 37", zip: "10126", lat: 59.43, lng: 24.77 }),
        feed({ id: "f2", name: "Torupilli teine", address: "Vesivärava 40", zip: "10126", lat: 1, lng: 1 }),
        feed({ id: "f3", name: "Kareda teeninduskeskus", address: "Kesktee 11", zip: "96332", lat: 58.9, lng: 25.9 }),
      ],
    );
    expect([points[0].lat, points[0].lng]).toEqual([59.43, 24.77]);
    expect([points[1].lat, points[1].lng]).toEqual([58.9, 25.9]);
  });

  it("never invents a pin: no match, another carrier, or an ambiguous zip stays null; existing coordinates are kept", () => {
    const keep = montonio({ id: "k", lat: 1.5, lng: 2.5 });
    const { points, matched } = enrichCoordinates(
      [
        montonio({ id: "x", name: "Nowhere", address: "", zip: "99999" }),
        montonio({ id: "y", name: "Ambiguous", address: "", zip: "10126" }),
        montonio({ id: "z", name: "Tallinna Balti Jaama pakiautomaat", carrier: "smartpost" }),
        keep,
      ],
      [
        feed({ id: "f1", name: "One", address: "A 1", zip: "10126", lat: 1, lng: 1 }),
        feed({ id: "f2", name: "Two", address: "A 2", zip: "10126", lat: 2, lng: 2 }),
        feed({ id: "f3" }),
      ],
    );
    expect(matched).toBe(0);
    expect(points.slice(0, 3).every((p) => p.lat === null && p.lng === null)).toBe(true);
    expect(points[3]).toEqual(keep);
  });
});

/* ---------- shipment payload --------------------------------------------- */

describe("creating a shipment", () => {
  const order: Order = {
    id: "11111111-2222-3333-4444-555555555555",
    number: "R-100001",
    status: "paid",
    lang: "RU",
    currency: "EUR",
    email: "ostja@example.com",
    phone: "+372 5810 7505",
    name: "Johnny Receiver",
    shipping: {
      method: "Пакомат Omniva",
      country: "EE",
      pointId: POINT_UUID,
      pointName: "Laagri Coop Maksimarketi pakiautomaat",
      address: null,
      price: 3.49,
    },
    items: [
      { id: "free-hold", kind: "product", title: "Free.Hold", variant: "100 мл", qty: 2, price: 11, sum: 22 },
    ],
    subtotal: 22,
    shippingPrice: 3.49,
    discount: 0,
    discountCode: null,
    channel: "web",
    customerId: null,
    pricingTier: null,
    loyaltyDiscount: 0,
    total: 25.49,
    payment: null,
    notes: null,
    createdAt: "2026-09-03T10:00:00.000Z",
    updatedAt: "2026-09-03T10:00:00.000Z",
  };

  it("throws not_configured without keys", async () => {
    await expect(createMontonioShipment(order)).rejects.toMatchObject({ code: "not_configured" });
  });

  it("posts the documented body and reads the tracking code back", async () => {
    withKeys();
    const calls = stubFetch([[/\/shipments$/, () => json(SHIPMENT_BODY)]]);

    const shipment = await createMontonioShipment(order);

    expect(booking(calls).url).toBe(`${BASE}/shipments`);
    expect(booking(calls).init?.method).toBe("POST");
    const body = bookingBody(calls);
    expect(body).toMatchObject({
      merchantReference: "R-100001",
      shippingMethod: { type: "pickupPoint", id: POINT_UUID },
      receiver: {
        name: "Johnny Receiver",
        email: "ostja@example.com",
        phoneCountryCode: "372",
        phoneNumber: "58107505",
      },
      synchronous: true,
    });
    // a pickup point needs no street address on the receiver
    expect(body.receiver.streetAddress).toBeUndefined();
    /* The DECLARED CARTON, not the basket: `volumetricKg(PARCEL_DEFAULTS)`,
       25 × 18 × 8 cm — Renat's carton, measured 22.09.2026 (25 × 18 × 10 and
       1.13 kg before). This order holds two units, which the old per-unit
       estimate called 1 kg — and a nine-unit order 3.8 kg, on the same box.
       Ренат, 18.09.2026: «no weight modelling» (F24, src/lib/shipping/parcel.ts). */
    expect(body.parcels).toEqual([{ weight: 0.9 }]);
    expect(body.products).toEqual([
      { sku: "free-hold", name: "Free.Hold", quantity: 2, price: 11, currency: "EUR" },
    ]);

    expect(shipment).toMatchObject({
      provider: "montonio",
      shipmentId: SHIPMENT_BODY.id,
      status: "registered",
      carrier: "omniva",
      country: "EE",
      method: "pickupPoint",
      trackingCode: "CC543167770EE",
      trackingUrl: "https://minu.omniva.ee/track/CC543167770EE?language=et",
      dropOffPin: "4821",
    });
  });

  /**
   * «quantity — Product quantity. Max value is 999» (reference § Create
   * Shipment → products). Over that, Montonio answers 400 and the **whole**
   * shipment fails to book — the products array is only pick-list and
   * tracking-page metadata, so a silly count losing its exact value is far
   * cheaper than the parcel losing its booking.
   */
  it("clamps a product quantity to the 999 Montonio documents", async () => {
    withKeys();
    const calls = stubFetch([[/\/shipments$/, () => json(SHIPMENT_BODY)]]);

    await createMontonioShipment({
      ...order,
      items: order.items.map((i) => ({ ...i, qty: 5000 })),
    });

    const body = bookingBody(calls);
    expect(body.products).toEqual([
      { sku: "free-hold", name: "Free.Hold", quantity: 999, price: 11, currency: "EUR" },
    ]);
  });

  it("resolves a courier service and sends the street address", async () => {
    withKeys();
    const calls = stubFetch([
      [
        /courier-services/,
        () => json({ courierServices: [{ id: "e580d125-53eb-4c76-a6ed-c909765262a3", type: "standard" }], countryCode: "EE" }),
      ],
      [/\/shipments$/, () => json({ ...SHIPMENT_BODY, shippingMethod: { type: "courier", carrierCode: "dpd", countryCode: "EE" } })],
    ]);

    await createMontonioShipment(
      {
        ...order,
        shipping: {
          method: "Курьер до двери (DPD)",
          country: "EE",
          pointId: null,
          pointName: null,
          address: { addr: "Kai 11", zip: "10111", city: "Tallinn" },
          price: 5.99,
        },
      },
      { weight: 2.5 },
    );

    expect(calls[0].url).toBe(
      `${BASE}/shipping-methods/courier-services?carrierCode=dpd&countryCode=EE`,
    );
    const body = bookingBody(calls);
    expect(body.shippingMethod).toEqual({ type: "courier", id: "e580d125-53eb-4c76-a6ed-c909765262a3" });
    expect(body.receiver).toMatchObject({
      streetAddress: "Kai 11",
      locality: "Tallinn",
      postalCode: "10111",
      country: "EE",
    });
    expect(body.parcels).toEqual([{ weight: 2.5 }]);
  });

  it("matches a carrier-feed point id back to Montonio's by name", async () => {
    withKeys();
    const calls = stubFetch([
      [/pickup-points/, () => json(PICKUP_POINTS_BODY)],
      [/\/shipments$/, () => json(SHIPMENT_BODY)],
    ]);
    await createMontonioShipment({
      ...order,
      shipping: { ...order.shipping, pointId: "omniva-96067", pointName: "Laagri Coop Maksimarketi pakiautomaat" },
    });
    expect(calls[0].url).toContain("pickup-points");
    expect((bookingBody(calls).shippingMethod as { id: string }).id).toBe(POINT_UUID);
  });

  it("refuses a point Montonio has never heard of, and a pickup order", async () => {
    withKeys();
    stubFetch([[/pickup-points/, () => json({ pickupPoints: [], countryCode: "EE" })]]);
    await expect(
      createMontonioShipment({
        ...order,
        shipping: { ...order.shipping, pointId: "omniva-1", pointName: "Nowhere" },
      }),
    ).rejects.toMatchObject({ code: "point_unresolved" });

    await expect(
      createMontonioShipment({
        ...order,
        shipping: { ...order.shipping, method: "Самовывоз — Mardi 1, Таллинн" },
      }),
    ).rejects.toBeInstanceOf(MontonioShippingError);
  });

  it("finds a courier carrier itself when the order names none", async () => {
    withKeys();
    // what the checkout sends for a courier: method "courier" and no carrier, so none is stored
    const calls = stubFetch([
      [
        /shipping-methods$/,
        () =>
          json({
            countries: [
              {
                countryCode: "EE",
                carriers: [
                  { carrierCode: "omniva", shippingMethods: [{ type: "pickupPoint" }] },
                  { carrierCode: "dpd", shippingMethods: [{ type: "courier" }] },
                ],
              },
            ],
          }),
      ],
      [/courier-services/, () => json({ courierServices: [{ id: "svc-1", type: "standard" }] })],
      [
        /\/shipments$/,
        () => json({ ...SHIPMENT_BODY, shippingMethod: { type: "courier", carrierCode: "dpd", countryCode: "EE" } }),
      ],
    ]);

    const shipment = await createMontonioShipment({
      ...order,
      shipping: {
        method: "courier",
        country: "EE",
        pointId: null,
        pointName: null,
        address: { addr: "Kai 11", zip: "10111", city: "Tallinn" },
        price: 5.99,
      },
    });

    // omniva has no courier in EE here, so it is never asked for a service
    expect(calls.filter((c) => c.url.includes("courier-services"))).toHaveLength(1);
    expect(calls[1].url).toContain("carrierCode=dpd");
    expect(shipment.carrier).toBe("dpd");
  });

  it("reads the carrier out of a feed point id when nothing else names one", async () => {
    withKeys();
    const calls = stubFetch([
      [/pickup-points/, () => json({ pickupPoints: [], countryCode: "EE" })],
    ]);
    await expect(
      createMontonioShipment({
        ...order,
        // an order from before createOrder() kept `carrier` — "dpd-90020" is all there is
        shipping: { method: "parcel", country: "EE", pointId: "dpd-90020", pointName: "Kristiine", address: null, price: 4.99 },
      }),
    ).rejects.toMatchObject({ code: "point_unresolved" });
    expect(calls[0].url).toContain("carrierCode=dpd");
  });

  it("trusts the carrier createOrder() stored over the point id and the method label", async () => {
    withKeys();
    const calls = stubFetch([
      [/pickup-points/, () => json({ pickupPoints: [], countryCode: "EE" })],
    ]);
    await expect(
      createMontonioShipment({
        ...order,
        shipping: {
          method: "Пакомат Omniva",
          country: "EE",
          carrier: "dpd",
          pointId: "omniva-96243",
          pointName: "Kristiine",
          address: null,
          price: 4.99,
        },
      }),
    ).rejects.toMatchObject({ code: "point_unresolved" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("carrierCode=dpd");
  });

  it("asks the stored carrier for a courier service without consulting /shipping-methods", async () => {
    withKeys();
    const calls = stubFetch([
      [/courier-services/, () => json({ courierServices: [{ id: "svc-venipak", type: "standard" }] })],
      [
        /\/shipments$/,
        () => json({ ...SHIPMENT_BODY, shippingMethod: { type: "courier", carrierCode: "venipak", countryCode: "EE" } }),
      ],
    ]);

    const shipment = await createMontonioShipment({
      ...order,
      shipping: {
        method: "courier",
        country: "EE",
        carrier: "venipak",
        pointId: null,
        pointName: null,
        address: { addr: "Kai 11", zip: "10111", city: "Tallinn" },
        price: 5.99,
      },
    });

    /* The point of this test is that the carrier is NOT chosen by walking
       Montonio's candidate list: `courier-services` is asked for venipak by
       name and nothing else decides. `/shipping-methods` is still fetched —
       since 18.09.2026 it is where `constraints.parcelDimensionsRequired` is
       read from — so what is asserted is that it is not being used to pick a
       carrier, rather than that it is never called. */
    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/shipping-methods/courier-services?carrierCode=venipak&countryCode=EE`,
      `${BASE}/shipping-methods`,
      `${BASE}/shipments`,
    ]);
    expect(bookingBody(calls).shippingMethod).toEqual({ type: "courier", id: "svc-venipak" });
    expect(shipment.carrier).toBe("venipak");
  });

  /**
   * F24 — the same number on every parcel, whatever is in it.
   *
   * The declared weight is the box the owner set, so a nine-line order and a
   * one-line order declare the same 0.9 kg (25 × 18 × 8 cm since 22.09.2026).
   * `estimateWeightKg()` would have
   * said 3.8 kg for the first, and since dimensions go out only where
   * `parcelDimensionsRequired` is true, on most routes that guess IS the bill.
   */
  it("declares the box, not the basket — the same weight whatever the line count", async () => {
    withKeys();
    const calls = stubFetch([[/\/shipments$/, () => json(SHIPMENT_BODY)]]);
    await createMontonioShipment({
      ...order,
      items: [...order.items, ...order.items, ...order.items, ...order.items],
    });
    expect(bookingBody(calls).parcels).toEqual([{ weight: 0.9 }]);
  });

  it("still lets a weighed parcel win over the declared box", async () => {
    withKeys();
    const calls = stubFetch([[/\/shipments$/, () => json(SHIPMENT_BODY)]]);
    await createMontonioShipment(order, { weight: 4.2 });
    expect(bookingBody(calls).parcels).toEqual([{ weight: 4.2 }]);
  });

  it("keeps the basket estimate for the tariff tool, which is a different question", () => {
    /* Not declared anywhere any more (F24) — `tools/lib/delivery-pricing.mjs`
       asks «предположим, в заказе N банок» and compares carrier bands, and
       tests/delivery-pricing.test.ts holds the two formulas equal. */
    expect(estimateWeightKg({ items: order.items })).toBe(1);
    expect(estimateWeightKg({ items: [] })).toBe(0.3);
  });

  it("splits a phone number", () => {
    expect(splitPhone("+372 5810 7505", "EE")).toEqual({ phoneCountryCode: "372", phoneNumber: "58107505" });
    expect(splitPhone("58107505", "EE")).toEqual({ phoneCountryCode: "372", phoneNumber: "58107505" });
    expect(splitPhone("00358 40 1234567", "FI")).toEqual({ phoneCountryCode: "358", phoneNumber: "401234567" });
    expect(splitPhone("2012345", "LV")).toEqual({ phoneCountryCode: "371", phoneNumber: "2012345" });
  });

  /**
   * `receiver.phoneCountryCode` is required on every shipment and the shipments
   * guide names the price of getting it wrong: «A common issue causing
   * [registrationFailed] is an incorrect receiver phone number». Until
   * 18.09.2026 the table held four countries and everything else fell back to
   * Estonia's "372" — and the sandbox never complained, because it «skips phone
   * number and address validation» (sandbox guide). Production does not.
   */
  it("gives a parcel the destination's own calling code, not Estonia's", () => {
    expect(splitPhone("15112345678", "DE")).toEqual({ phoneCountryCode: "49", phoneNumber: "15112345678" });
    expect(splitPhone("512345678", "PL")).toEqual({ phoneCountryCode: "48", phoneNumber: "512345678" });
    expect(splitPhone("3401234567", "IT")).toEqual({ phoneCountryCode: "39", phoneNumber: "3401234567" });
    expect(splitPhone("20123456", "DK")).toEqual({ phoneCountryCode: "45", phoneNumber: "20123456" });
    expect(splitPhone("7700900123", "GB")).toEqual({ phoneCountryCode: "44", phoneNumber: "7700900123" });
    // a country we do not ship to at all still has to produce something valid
    expect(splitPhone("5551234", "ZZ")).toEqual({ phoneCountryCode: "372", phoneNumber: "5551234" });
  });

  it("splits a number the customer wrote in international form, wherever it is from", () => {
    expect(splitPhone("+49 151 23456789", "DE")).toEqual({ phoneCountryCode: "49", phoneNumber: "15123456789" });
    expect(splitPhone("0048 512 345 678", "PL")).toEqual({ phoneCountryCode: "48", phoneNumber: "512345678" });
    // the longest code wins: 372 is a country, 37 is not
    expect(splitPhone("+37258107505", "DE")).toEqual({ phoneCountryCode: "372", phoneNumber: "58107505" });
    /* The codes a customer of this shop plausibly carries are split too, even
       though the shop does not DELIVER to those countries — somebody standing
       in Tallinn with a Russian, Ukrainian or Emirati number is an ordinary
       customer. Until 19.09.2026 this line asserted the opposite and was the
       fallback written in as the contract: «+971 555 1234» to Germany became
       `49 / 9715551234`, which Montonio answers with registrationFailed, or
       the carrier texts the collection code to nobody (audit F22). */
    expect(splitPhone("+9715551234", "DE")).toEqual({ phoneCountryCode: "971", phoneNumber: "5551234" });
    expect(splitPhone("+7 999 123-45-67", "EE")).toEqual({ phoneCountryCode: "7", phoneNumber: "9991234567" });
    expect(splitPhone("+380 67 123 4567", "EE")).toEqual({ phoneCountryCode: "380", phoneNumber: "671234567" });
    expect(splitPhone("+375 29 123 45 67", "EE")).toEqual({ phoneCountryCode: "375", phoneNumber: "291234567" });
    // …and a code nobody here has ever dialled still keeps the destination's
    expect(splitPhone("+2995551234", "DE")).toEqual({ phoneCountryCode: "49", phoneNumber: "2995551234" });
  });

  /**
   * The mirror image of the case above, and the reason the whole table is not
   * scanned for a bare number: "45…" is Denmark's calling code AND a complete
   * Danish number, "39…" is Italy's AND an Italian mobile. Only the four
   * prefixes this function has always recognised bare are still scanned for.
   */
  it("does not eat a local number that merely starts like a country code", () => {
    expect(splitPhone("45123456", "DK")).toEqual({ phoneCountryCode: "45", phoneNumber: "45123456" });
    expect(splitPhone("3912345678", "IT")).toEqual({ phoneCountryCode: "39", phoneNumber: "3912345678" });
    // the Baltic four keep the behaviour they have always had
    expect(splitPhone("372 5810 7505", "EE")).toEqual({ phoneCountryCode: "372", phoneNumber: "58107505" });
  });
});

/* ---------- labels ------------------------------------------------------- */

describe("label files", () => {
  it("asks for one A6 label, synchronously, and returns the URL", async () => {
    withKeys();
    const calls = stubFetch([
      [
        /label-files/,
        () =>
          json({
            id: "d58f2e2f-7460-4916-8463-8644f917b22b",
            status: "ready",
            pageSize: "A6",
            labelsPerPage: 1,
            labelFileUrl: "https://s3.example/label.pdf",
          }),
      ],
    ]);
    const label = await getMontonioLabel(SHIPMENT_BODY.id);
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      shipmentIds: [SHIPMENT_BODY.id],
      pageSize: "A6",
      labelsPerPage: 1,
      orderLabelsBy: "createdAt",
      synchronous: true,
    });
    expect(label.url).toBe("https://s3.example/label.pdf");
  });

  it("says label_not_ready rather than handing back an empty URL", async () => {
    withKeys();
    stubFetch([[/label-files/, () => json({ id: "abc", status: "pending", labelFileUrl: null })]]);
    await expect(getMontonioLabel(SHIPMENT_BODY.id)).rejects.toMatchObject({
      code: "label_not_ready",
      detail: "abc",
    });
  });
});

/* ---------- the routes --------------------------------------------------- */

type Min = { id: string; p: number; s: string };
const product = (catalogueMin as Min[]).find((p) => p.s === "in")!;
const ORIGIN = "https://rempireshop.com";
let ip = 0;

function req(path: string, init: RequestInit = {}, cookie?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `198.51.100.${(ip++ % 200) + 1}`,
  };
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}${path}`, { ...init, headers });
}

describe("the shipping routes", () => {
  let admin = "";

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    resetRateLimits();
    await truncateAll();
  });

  async function paidOrder(shipping: Record<string, unknown>) {
    const order = await createOrder({
      lang: "RU",
      items: [{ id: product.id, qty: 1 }],
      customer: { name: "Test Ostja", email: "test@example.com", phone: "+372 5555555" },
      shipping: shipping as never,
    });
    await setOrderStatus(order.id, "paid", "test");
    return order;
  }

  it("POST /api/admin/shipments needs the admin cookie", async () => {
    const { POST } = await import("@/app/api/admin/shipments/route");
    const res = await POST(req("/api/admin/shipments/", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
    expect((await res.json()).ok).toBe(false);
  });

  it("GET .../label needs the admin cookie, and never touches Montonio without it", async () => {
    const calls = stubFetch([[/./, () => json({})]]);
    const { GET } = await import("@/app/api/admin/shipments/[id]/label/route");
    const res = await GET(req("/api/admin/shipments/R-100001/label/"), {
      params: Promise.resolve({ id: "R-100001" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("json");
    expect(calls).toHaveLength(0);
  });

  it("refuses to ship an unpaid order", async () => {
    withKeys();
    const order = await createOrder({
      lang: "RU",
      items: [{ id: product.id, qty: 1 }],
      customer: { name: "Test Ostja", email: "test@example.com", phone: "+372 5555555" },
      shipping: { method: "parcel", country: "EE", pointId: POINT_UUID, pointName: "Laagri" },
    });
    const { POST } = await import("@/app/api/admin/shipments/route");
    const res = await POST(
      req("/api/admin/shipments/", { method: "POST", body: JSON.stringify({ orderId: order.id }) }, admin),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_paid");
  });

  it("says not_configured, with no order touched, when there are no keys", async () => {
    const order = await paidOrder({ method: "parcel", country: "EE", pointId: POINT_UUID, pointName: "Laagri" });
    const { POST } = await import("@/app/api/admin/shipments/route");
    const res = await POST(
      req("/api/admin/shipments/", { method: "POST", body: JSON.stringify({ orderId: order.id }) }, admin),
    );
    expect(res.status).toBe(501);
    expect((await res.json()).error).toBe("not_configured");
    expect((await getOrder(order.id))!.status).toBe("paid");
  });

  it("creates the shipment, stores it, audits it — and leaves the order's status alone", async () => {
    withKeys();
    stubFetch([[/\/shipments$/, () => json(SHIPMENT_BODY)]]);
    const order = await paidOrder({
      method: "Пакомат Omniva",
      country: "EE",
      pointId: POINT_UUID,
      pointName: "Laagri Coop Maksimarketi pakiautomaat",
    });

    const { POST } = await import("@/app/api/admin/shipments/route");
    const res = await POST(
      req("/api/admin/shipments/", { method: "POST", body: JSON.stringify({ orderId: order.id }) }, admin),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shipment.trackingCode).toBe("CC543167770EE");
    // the answer carries the order as it is — still paid
    expect(body.order.status).toBe("paid");

    const stored = await getOrder(order.id);
    /* The owner's complaint, in one line: «нажимаю „этикетка“ — меняется весь
       статус». A label is a sticker; «Отправлен» is its own step (the PATCH
       test below). */
    expect(stored!.status).toBe("paid");
    const ship = stored!.shipping as unknown as Record<string, Record<string, unknown>>;
    // merged, not replaced: the checkout's own fields survive
    expect(ship.pointName).toBe("Laagri Coop Maksimarketi pakiautomaat");
    expect(ship.montonio.shipmentId).toBe(SHIPMENT_BODY.id);
    expect(ship.montonio.trackingCode).toBe("CC543167770EE");

    const audit = await listAudit(10);
    expect(audit.some((a) => a.action === "shipment.create")).toBe(true);
    // …and no status row past the test's own new→paid: nothing about the status happened
    expect(audit.some((a) => a.action === "order.status" && (a.payload as { to: string }).to === "shipped")).toBe(false);

    // a second press books nothing and answers with what is already there
    const again = await POST(
      req("/api/admin/shipments/", { method: "POST", body: JSON.stringify({ orderId: order.number }) }, admin),
    );
    const againBody = await again.json();
    expect(againBody.reused).toBe(true);
    expect(againBody.shipment.shipmentId).toBe(SHIPMENT_BODY.id);
    expect((await getOrder(order.id))!.status).toBe("paid");
  });

  /* The «second press» above is the easy half: by then the shipment is on the
     order row. The hard half is the press that arrives while the FIRST one is
     still inside Montonio — the owner's phone timed the request out and he
     pressed again. The route read the order, saw no shipment, booked, and only
     then wrote the row, so that second press booked (and paid for) a second
     parcel with nothing to show for it (audit 14.09.2026). The slot on the
     order row is claimed before the call now. */
  it("a press that arrives while the first is still inside Montonio books nothing", async () => {
    withKeys();
    let bookings = 0;
    let letGo = () => {};
    let firstIsInside = () => {};
    const held = new Promise<void>((r) => { letGo = r; });
    const reached = new Promise<void>((r) => { firstIsInside = r; });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (!/\/shipments$/.test(url)) throw new Error(`unexpected fetch: ${url}`);
        bookings += 1;
        // only the first call hangs — a second one answers at once, so a shop
        // without the claim fails this test on the count instead of timing out
        if (bookings === 1) { firstIsInside(); await held; }
        return json(SHIPMENT_BODY);
      }),
    );

    const order = await paidOrder({
      method: "Пакомат Omniva",
      country: "EE",
      pointId: POINT_UUID,
      pointName: "Laagri Coop Maksimarketi pakiautomaat",
    });
    const { POST } = await import("@/app/api/admin/shipments/route");
    const press = () =>
      POST(req("/api/admin/shipments/", { method: "POST", body: JSON.stringify({ orderId: order.id }) }, admin));

    const first = press();
    await reached;
    const second = await press();
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("in_progress");

    letGo();
    const firstRes = await first;
    expect(firstRes.status).toBe(200);
    // one parcel at the carrier, one invoice from it
    expect(bookings).toBe(1);

    const ship = (await getOrder(order.id))!.shipping as unknown as Record<string, Record<string, unknown>>;
    expect(ship.montonio.shipmentId).toBe(SHIPMENT_BODY.id);
    // the claim goes out with the write that records the parcel
    expect(ship.montonio.bookingAt).toBeNull();
  });

  /* …and a booking Montonio refused must not leave the button locked: there is
     no parcel, so the owner has to be able to press again at once. */
  it("gives the slot back when Montonio refuses, so the next press goes through", async () => {
    withKeys();
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (!/\/shipments$/.test(String(input))) throw new Error(`unexpected fetch: ${String(input)}`);
        attempts += 1;
        return attempts === 1 ? json({ message: "nope" }, 500) : json(SHIPMENT_BODY);
      }),
    );
    const order = await paidOrder({
      method: "Пакомат Omniva",
      country: "EE",
      pointId: POINT_UUID,
      pointName: "Laagri Coop Maksimarketi pakiautomaat",
    });
    const { POST } = await import("@/app/api/admin/shipments/route");
    const press = () =>
      POST(req("/api/admin/shipments/", { method: "POST", body: JSON.stringify({ orderId: order.id }) }, admin));

    const refused = await press();
    expect(refused.status).toBe(502);
    const ok = await press();
    expect(ok.status).toBe(200);
    expect(attempts).toBe(2);
  });

  it("«Отправлен» is the PATCH: shipped, the letter with the tracking link, and every step undoable", async () => {
    withKeys();
    stubFetch([[/\/shipments$/, () => json(SHIPMENT_BODY)]]);
    // the e2e mail sink, so the letter can be read back without a mailbox
    vi.stubEnv("E2E_BOOTSTRAP", "1");
    const order = await paidOrder({
      method: "Пакомат Omniva",
      country: "EE",
      pointId: POINT_UUID,
      pointName: "Laagri Coop Maksimarketi pakiautomaat",
    });
    const { POST } = await import("@/app/api/admin/shipments/route");
    await POST(req("/api/admin/shipments/", { method: "POST", body: JSON.stringify({ orderId: order.id }) }, admin));

    const { PATCH } = await import("@/app/api/admin/orders/[id]/route");
    const patch = (body: Record<string, unknown>) =>
      PATCH(req(`/api/admin/orders/${order.id}/`, { method: "PATCH", body: JSON.stringify(body) }, admin), {
        params: Promise.resolve({ id: order.id }),
      });
    const mailsBefore = capturedMail().filter((m) => m.template === "order-shipped").length;

    /* Since 25.09.2026 the letter is held ten seconds (src/lib/letter-hold.ts,
       tests/letter-hold.test.ts): a fake clock stands in for them here, and
       `letterDue()` is the moment they are up. */
    let wakers: Array<() => void> = [];
    const realSleep = letterClock.sleep;
    letterClock.sleep = () => new Promise<void>((wake) => wakers.push(wake));
    const letterDue = async () => {
      const w = wakers;
      wakers = [];
      w.forEach((f) => f());
      await lettersSettled();
    };
    onTestFinished(async () => {
      await letterDue();
      letterClock.sleep = realSleep;
    });

    // shipped: the status moves, the customer's letter carries the carrier's link
    const shipped = await patch({ status: "shipped" });
    expect(shipped.status).toBe(200);
    expect((await shipped.json()).order.status).toBe("shipped");
    expect(capturedMail().filter((m) => m.template === "order-shipped").length, "held, not sent yet").toBe(mailsBefore);
    await letterDue();
    const letters = capturedMail().filter((m) => m.template === "order-shipped");
    expect(letters.length).toBe(mailsBefore + 1);
    expect(letters[letters.length - 1].to).toEqual(["test@example.com"]);
    expect(letters[letters.length - 1].links).toContain(SHIPMENT_BODY.parcels[0].trackingLink);

    // delivered: the last step, no letter
    expect((await (await patch({ status: "delivered" })).json()).order.status).toBe("delivered");
    expect(capturedMail().filter((m) => m.template === "order-shipped").length).toBe(mailsBefore + 1);

    // the journal's undo of «Доставлен»: back to shipped, still no second letter
    expect((await (await patch({ status: "shipped" })).json()).order.status).toBe("shipped");
    expect(capturedMail().filter((m) => m.template === "order-shipped").length).toBe(mailsBefore + 1);

    /* the undo of «Отправлен»: back to paid. This must NOT be the manual
       «отметить оплаченным» path — applyPaymentResult() treats a shipped
       order as already paid and would leave the status where it is. */
    expect((await (await patch({ status: "paid" })).json()).order.status).toBe("paid");
    expect((await getOrder(order.id))!.status).toBe("paid");
    // the shipment is untouched by any of it
    const ship = (await getOrder(order.id))!.shipping as unknown as Record<string, Record<string, unknown>>;
    expect(ship.montonio.trackingCode).toBe("CC543167770EE");

    // a courier order with no label: the letter still goes, without a link into the carrier
    const plain = await paidOrder({
      method: "courier",
      country: "EE",
      address: { addr: "Testitänav 1", zip: "10111", city: "Tallinn" },
    });
    const res = await PATCH(
      req(`/api/admin/orders/${plain.id}/`, { method: "PATCH", body: JSON.stringify({ status: "shipped" }) }, admin),
      { params: Promise.resolve({ id: plain.id }) },
    );
    expect((await res.json()).order.status).toBe("shipped");
    await letterDue();
    const last = capturedMail().filter((m) => m.template === "order-shipped").pop()!;
    expect(last.links.some((l) => /omniva|dpd|itella|venipak|tracking\.example/.test(l))).toBe(false);
  });

  it("labelStep:false sets the label aside — the parcel stays, the next press brings it back", async () => {
    withKeys();
    stubFetch([[/\/shipments$/, () => json(SHIPMENT_BODY)]]);
    const order = await paidOrder({
      method: "Пакомат Omniva",
      country: "EE",
      pointId: POINT_UUID,
      pointName: "Laagri Coop Maksimarketi pakiautomaat",
    });
    const { POST } = await import("@/app/api/admin/shipments/route");
    const { PATCH } = await import("@/app/api/admin/orders/[id]/route");
    const ctx = { params: Promise.resolve({ id: order.id }) };

    // nothing to set aside yet
    const early = await PATCH(
      req(`/api/admin/orders/${order.id}/`, { method: "PATCH", body: JSON.stringify({ labelStep: false }) }, admin),
      ctx,
    );
    expect(early.status).toBe(409);
    expect((await early.json()).error).toBe("no_shipment");

    await POST(req("/api/admin/shipments/", { method: "POST", body: JSON.stringify({ orderId: order.id }) }, admin));
    const aside = await PATCH(
      req(`/api/admin/orders/${order.id}/`, { method: "PATCH", body: JSON.stringify({ labelStep: false }) }, admin),
      ctx,
    );
    expect(aside.status).toBe(200);
    let ship = (await getOrder(order.id))!.shipping as unknown as Record<string, Record<string, unknown>>;
    // the record is still there, whole — Montonio cannot cancel a parcel
    expect(ship.montonio.shipmentId).toBe(SHIPMENT_BODY.id);
    expect(ship.montonio.trackingCode).toBe("CC543167770EE");
    expect(ship.montonio.dismissed).toBe(true);
    expect((await listAudit(10)).some((a) => a.action === "shipment.step")).toBe(true);

    // «Создать этикетку» again: no second parcel, the same one comes back
    const calls = stubFetch([[/\/shipments$/, () => json({ ...SHIPMENT_BODY, id: "must-not-be-booked" })]]);
    const again = await (
      await POST(req("/api/admin/shipments/", { method: "POST", body: JSON.stringify({ orderId: order.id }) }, admin))
    ).json();
    expect(again.reused).toBe(true);
    expect(again.shipment.shipmentId).toBe(SHIPMENT_BODY.id);
    expect(again.shipment.dismissed).toBe(false);
    expect(calls).toHaveLength(0);
    ship = (await getOrder(order.id))!.shipping as unknown as Record<string, Record<string, unknown>>;
    expect(ship.montonio.dismissed).toBe(false);
  });

  it("SHIPPING_PROVIDER=mock registers a parcel and prints a PDF with no network at all — and never in production", async () => {
    withoutKeys();
    vi.stubEnv("SHIPPING_PROVIDER", "mock");
    const calls = stubFetch([]); // any fetch would throw «unexpected fetch»
    const order = await paidOrder({
      method: "courier",
      country: "EE",
      address: { addr: "Testitänav 1", zip: "10111", city: "Tallinn" },
    });

    const { POST } = await import("@/app/api/admin/shipments/route");
    const res = await POST(
      req("/api/admin/shipments/", { method: "POST", body: JSON.stringify({ orderId: order.id }) }, admin),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shipment.trackingCode).toMatch(/^MK\d{9}EE$/);
    expect(body.shipment.trackingUrl.startsWith(MOCK_TRACKING_HOST)).toBe(true);
    expect(body.shipment.carrier).toBe("dpd");
    expect(body.order.status).toBe("paid");

    const { GET } = await import("@/app/api/admin/shipments/[id]/label/route");
    for (const size of ["A4", "A6"] as const) {
      const pdf = await GET(req(`/api/admin/shipments/${order.number}/label/?size=${size}`, {}, admin), {
        params: Promise.resolve({ id: order.number }),
      });
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get("content-type")).toBe("application/pdf");
      const bytes = new Uint8Array(await pdf.arrayBuffer());
      expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
    }
    expect(calls).toHaveLength(0);

    // the same refusals as the real thing: a pickup order is not a parcel for the mock either
    const pickup = await paidOrder({ method: "pickup", country: "EE" });
    const refused = await POST(
      req("/api/admin/shipments/", { method: "POST", body: JSON.stringify({ orderId: pickup.id }) }, admin),
    );
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe("not_shippable");

    // the switch is explicit and development-only
    expect(shippingMockOn({ SHIPPING_PROVIDER: "mock", NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
    expect(shippingMockOn({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(false);
    expect(shippingMockOn({ SHIPPING_PROVIDER: "mock", NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe(true);
    // a mock label file is a valid one-page PDF in either size
    const a6 = mockLabelPdf(mockLabel("mock-r-1", "A6").url);
    expect(new TextDecoder().decode(a6)).toContain("/MediaBox [0 0 298 420]");
    expect(new TextDecoder().decode(a6)).toContain("%%EOF");
  });

  it("proxies the label PDF and remembers its URL", async () => {
    withKeys();
    stubFetch([
      [/\/shipments$/, () => json(SHIPMENT_BODY)],
      [
        /label-files/,
        () => json({ id: "label-1", status: "ready", labelFileUrl: "https://s3.example/label.pdf" }),
      ],
      [
        /s3\.example/,
        () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { headers: { "content-type": "application/pdf" } }),
      ],
    ]);
    const order = await paidOrder({
      method: "Пакомат Omniva",
      country: "EE",
      pointId: POINT_UUID,
      pointName: "Laagri Coop Maksimarketi pakiautomaat",
    });
    const { POST } = await import("@/app/api/admin/shipments/route");
    await POST(
      req("/api/admin/shipments/", { method: "POST", body: JSON.stringify({ orderId: order.id }) }, admin),
    );

    const { GET } = await import("@/app/api/admin/shipments/[id]/label/route");
    const res = await GET(req(`/api/admin/shipments/${order.id}/label/`, {}, admin), {
      params: Promise.resolve({ id: order.id }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain(`${order.number}.pdf`);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));

    const stored = await getOrder(order.id);
    const ship = stored!.shipping as unknown as Record<string, Record<string, unknown>>;
    expect(ship.montonio.labelUrl).toBe("https://s3.example/label.pdf");
  });

  it("404s the label when the order has no shipment yet", async () => {
    withKeys();
    const order = await paidOrder({ method: "parcel", country: "EE", pointId: POINT_UUID });
    const { GET } = await import("@/app/api/admin/shipments/[id]/label/route");
    const res = await GET(req(`/api/admin/shipments/${order.id}/label/`, {}, admin), {
      params: Promise.resolve({ id: order.id }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("no_shipment");
  });
});

/* ---------- the points route --------------------------------------------- */

describe("GET /api/shipping/points", () => {
  it("serves DPD from Montonio, a carrier the public feeds cannot answer for", async () => {
    withKeys();
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
    const res = await GET(req("/api/shipping/points/?country=EE&carrier=dpd"));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.source).toBe("montonio");
    expect(body.points).toHaveLength(1);
    expect(body.points[0]).toMatchObject({ carrier: "dpd", city: "Tallinn", type: "parcel_machine" });
  });

  it("falls back to the committed seed when Montonio has nothing for a carrier", async () => {
    withKeys();
    stubFetch([[/pickup-points/, () => json({ pickupPoints: [], countryCode: "EE" })]]);
    const { GET } = await import("@/app/api/shipping/points/route");
    const res = await GET(req("/api/shipping/points/?country=EE&carrier=smartpost"));
    const body = await res.json();
    expect(body.source).toBe("seed");
    expect(body.count).toBeGreaterThan(100);
    expect(body.points.every((p: { carrier: string }) => p.carrier === "smartpost")).toBe(true);
  });

  it("answers an unknown carrier with an empty list, not a 400", async () => {
    const { GET } = await import("@/app/api/shipping/points/route");
    const res = await GET(req("/api/shipping/points/?country=EE&carrier=venipak"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.points).toEqual([]);
    // …but a carrier that is not even a name stays a 400
    const bad = await GET(req("/api/shipping/points/?country=EE&carrier=../etc"));
    expect(bad.status).toBe(400);
  });

  /* 19.09.2026: the lockers of every country DPD serves were opened, and the
     lists stopped being anything a phone should download — Poland is 33 603
     rows. The answer is capped and the shopper's typing narrows it HERE,
     because filtering the first 1 500 of Poland on the browser's side would
     never find Kraków. */
  describe("a country too long for one answer", () => {
    /** `n` DPD machines in a country, every fifth of them in Kraków. */
    function crowd(n: number) {
      withKeys();
      stubFetch([
        [
          /pickup-points/,
          () =>
            json({
              countryCode: "PL",
              pickupPoints: Array.from({ length: n }, (_, i) => ({
                id: `1111aaaa-0000-0000-0000-${String(i).padStart(12, "0")}`,
                name: `DPD Punkt ${i}`,
                type: "parcelShop",
                streetAddress: `Ulica ${i}`,
                locality: i % 5 === 0 ? "Kraków" : "Warszawa",
                postalCode: "30-001",
                carrierCode: "dpd",
              })),
            }),
        ],
      ]);
    }

    it("caps the list and says how many there really are", async () => {
      crowd(2000);
      const { GET } = await import("@/app/api/shipping/points/route");
      const body = await (await GET(req("/api/shipping/points/?country=PL&carrier=dpd"))).json();
      expect(body.points).toHaveLength(1500);
      expect(body.count).toBe(1500);
      expect(body.total).toBe(2000);
      expect(body.truncated).toBe(true);
    });

    it("finds the town that was past the cap", async () => {
      crowd(2000);
      const { GET } = await import("@/app/api/shipping/points/route");
      const body = await (await GET(req("/api/shipping/points/?country=PL&carrier=dpd&q=krak%C3%B3w&limit=200"))).json();
      expect(body.q).toBe("kraków");
      expect(body.total).toBe(400);
      expect(body.points).toHaveLength(200);
      expect(body.points.every((p: { city: string }) => p.city === "Kraków")).toBe(true);
    });

    it("leaves a country that fits exactly as it was", async () => {
      crowd(12);
      const { GET } = await import("@/app/api/shipping/points/route");
      const body = await (await GET(req("/api/shipping/points/?country=PL&carrier=dpd"))).json();
      expect(body.truncated).toBe(false);
      expect(body.count).toBe(12);
      expect(body.total).toBe(12);
      expect(body.q).toBeUndefined();
    });

    it("ignores one letter, which narrows nothing and only splits the cache", async () => {
      crowd(12);
      const { GET } = await import("@/app/api/shipping/points/route");
      const body = await (await GET(req("/api/shipping/points/?country=PL&carrier=dpd&q=k"))).json();
      expect(body.count).toBe(12);
      expect(body.q).toBeUndefined();
    });

    it("will not be talked into an unbounded answer", async () => {
      crowd(4000);
      const { GET } = await import("@/app/api/shipping/points/route");
      const body = await (await GET(req("/api/shipping/points/?country=PL&carrier=dpd&limit=999999"))).json();
      expect(body.points).toHaveLength(3000);
      expect(body.truncated).toBe(true);
    });
  });

  it("keeps working exactly as before with no Montonio keys", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    const { GET } = await import("@/app/api/shipping/points/route");
    const res = await GET(req("/api/shipping/points/?country=EE&carrier=omniva"));
    const body = await res.json();
    expect(body.source).toBe("seed");
    expect(body.count).toBeGreaterThan(100);
    expect(body.seedAt).toBeTruthy();
  });
});

/* ---------- rate quotes (Shipping API v2 "Calculate shipping costs") -----
   src/lib/shipping/tariffs.ts builds the cached, marked-up, .x9-rounded
   admin-facing tariff on top of this; what is tested here is only the raw
   call — request shape and response mapping — against the documented example
   (docs.montonio.com/api/shipping-v2/reference § POST /shipping-methods/rates,
   read 03.09.2026; see docs/shipping.md § «Тарифы Montonio»). */

describe("fetchMontonioRates", () => {
  it("is null without keys, and asks nobody anything", async () => {
    const calls = stubFetch([[/rates/, () => json({ carriers: [] })]]);
    const rates = await fetchMontonioRates("EE", [{ length: 30, width: 30, height: 30, weight: 5 }]);
    expect(rates).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("sends destination, dimensions in cm and weight in kg", async () => {
    withKeys();
    const calls = stubFetch([[/shipping-methods\/rates/, () => json({ destination: "EE", carriers: [] })]]);
    await fetchMontonioRates("ee", [{ length: 20, width: 15, height: 10, weight: 0.5, quantity: 2 }]);
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toEqual({
      destination: "EE",
      parcels: [
        {
          items: [
            { length: 20, width: 15, height: 10, dimensionUnit: "cm", weight: 0.5, weightUnit: "kg", quantity: 2 },
          ],
        },
      ],
    });
  });

  it("reads the documented response into a flat list of carrier/method/subtype rates", async () => {
    withKeys();
    stubFetch([
      [
        /rates/,
        () =>
          json({
            calculationDetails: {},
            destination: "EE",
            carriers: [
              {
                carrierCode: "omniva",
                shippingMethods: [
                  {
                    type: "pickupPoint",
                    subtypes: [
                      { code: "parcelMachine", rate: "2.50", currency: "EUR" },
                      { code: "postOffice", rate: "2.50", currency: "EUR" },
                    ],
                  },
                ],
              },
              {
                carrierCode: "dpd",
                shippingMethods: [
                  { type: "courier", subtypes: [{ code: "standard", rate: "9.90", currency: "EUR" }] },
                ],
              },
            ],
          }),
      ],
    ]);
    const rates = await fetchMontonioRates("EE", [{ length: 30, width: 30, height: 30, weight: 5 }]);
    /* `rate` is ex-VAT — Montonio confirmed it on 22.09.2026 — and `price` is
       gross, because that is what the static mirror this is preferred over
       holds and what a shelf price is compared against
       (src/lib/shipping/country-prices.ts). 2.50 + 24 % = 3.10, 9.90 = 12.28.
       Until 22.09.2026 the raw number flowed straight through and every live
       cost was a quarter under the static one beside it. */
    expect(rates).toEqual([
      { carrier: "omniva", methodType: "pickupPoint", subtype: "parcelMachine", price: 3.1, currency: "EUR" },
      { carrier: "omniva", methodType: "pickupPoint", subtype: "postOffice", price: 3.1, currency: "EUR" },
      { carrier: "dpd", methodType: "courier", subtype: "standard", price: 12.28, currency: "EUR" },
    ]);
  });

  it("grosses up with the mirror's own VAT rate, not a second copy of 24 %", async () => {
    /* One rate, written down in src/data/montonio-tariffs.json, applied by
       both the tool that writes that file and the live leg here. A live quote
       of Montonio's own published contract price must land exactly on the
       static row it replaces — that is the whole of «the two sources mean the
       same thing», and it is checked against the file rather than against a
       literal so the day the rate moves this moves with it. */
    withKeys();
    stubFetch([
      [
        /rates/,
        () =>
          json({
            destination: "EE",
            carriers: [
              {
                carrierCode: "omniva",
                shippingMethods: [
                  { type: "pickupPoint", subtypes: [{ code: "parcelMachine", rate: "2.50", currency: "EUR" }] },
                ],
              },
            ],
          }),
      ],
    ]);
    const rates = await fetchMontonioRates("EE", [{ length: 30, width: 30, height: 30, weight: 5 }]);
    const omniva = montonioTariffsData.rates.find(
      (r) => r.carrier === "omniva" && r.country === "EE" && r.method === "parcel",
    )!;
    expect(omniva.priceExVat).toBe(2.5); // the same ex-VAT figure Montonio just quoted
    expect(rates![0].price).toBe(omniva.price); // …so the same gross price, to the cent
    expect(rates![0].price).toBe(Math.round(2.5 * (1 + montonioTariffsData.vatRateEE) * 100) / 100);
  });

  /**
   * A rate of exactly 0 is not a free delivery, it is **no rate**.
   *
   * Montonio answers `"rate": "0"` for a carrier/method pair this store has no
   * priced tier for, and DPD's Estonian courier is one of them — a route that
   * really costs 6.82 €. Read as a price it printed «тариф Montonio: €0 · DPD»
   * on the rate screen, which tells the owner that any number he types is
   * above cost, and it would have become the basis of a shelf price anywhere
   * the cheapest carrier is what counts. A courier that costs nothing does not
   * exist; the row is dropped like a negative one, and the caller falls back
   * to the static mirror, which knows the route's real price.
   */
  it("drops a rate of zero — that is an unpriced route, not a free delivery", async () => {
    withKeys();
    stubFetch([
      [
        /rates/,
        () =>
          json({
            destination: "EE",
            carriers: [
              {
                carrierCode: "dpd",
                shippingMethods: [
                  { type: "courier", subtypes: [{ code: "standard", rate: "0", currency: "EUR" }] },
                  {
                    type: "pickupPoint",
                    subtypes: [
                      { code: "parcelMachine", rate: "2.59", currency: "EUR" },
                      { code: "postOffice", rate: "-1", currency: "EUR" },
                    ],
                  },
                ],
              },
            ],
          }),
      ],
    ]);
    const rates = await fetchMontonioRates("EE", [{ length: 30, width: 30, height: 30, weight: 5 }]);
    expect(rates).toEqual([
      // 2.59 ex-VAT + 24 % — the surviving row is grossed up like any other
      { carrier: "dpd", methodType: "pickupPoint", subtype: "parcelMachine", price: 3.21, currency: "EUR" },
    ]);
  });

  it("is null — not a throw — on a bad destination, an empty parcel list, or a network failure", async () => {
    withKeys();
    expect(await fetchMontonioRates("estonia", [{ length: 1, width: 1, height: 1, weight: 1 }])).toBeNull();
    expect(await fetchMontonioRates("EE", [])).toBeNull();

    stubFetch([
      [
        /rates/,
        () => {
          throw new Error("ECONNRESET");
        },
      ],
    ]);
    expect(await fetchMontonioRates("EE", [{ length: 1, width: 1, height: 1, weight: 1 }])).toBeNull();
  });

  it("is null when Montonio rejects the request", async () => {
    withKeys();
    stubFetch([[/rates/, () => json({ error: "bad parcel" }, 400)]]);
    expect(await fetchMontonioRates("EE", [{ length: 1, width: 1, height: 1, weight: 1 }])).toBeNull();
  });
});
