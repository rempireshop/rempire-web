/**
 * Montonio Shipping — pickup points, the merge with the public feeds, the
 * shipment payload and the admin routes.
 *
 * Every literal response below is copied from Montonio's own documentation
 * (https://docs.montonio.com/api/shipping-v2/, read 03.09.2026), so a change on
 * their side shows up here as a failing test rather than as a silent 400.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { createOrder, getOrder, listAudit, setOrderStatus, type Order } from "@/lib/orders";
import { verifyHs256 } from "@/lib/payments/jwt";
import {
  MontonioShippingError,
  createMontonioShipment,
  estimateWeightKg,
  fetchMontonioPickupPoints,
  fetchMontonioRates,
  fromParcelPoint,
  getMontonioLabel,
  mapMontonioPickupPoints,
  mergePoints,
  montonioShippingBaseUrl,
  resetMontonioPointsCache,
  shippingAuthToken,
  splitPhone,
  type MontonioPoint,
} from "@/lib/shipping/montonio";
import { resetPointsCache } from "@/lib/parcel-points";
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
function withoutKeys() {
  delete process.env.MONTONIO_ACCESS_KEY;
  delete process.env.MONTONIO_SECRET_KEY;
  delete process.env.MONTONIO_ENV;
}

beforeEach(() => {
  resetMontonioPointsCache();
  resetPointsCache();
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetMontonioPointsCache();
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

    expect(calls[0].url).toBe(`${BASE}/shipments`);
    expect(calls[0].init?.method).toBe("POST");
    const body = JSON.parse(String(calls[0].init?.body));
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
    expect(body.parcels).toEqual([{ weight: 1 }]);
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
    const body = JSON.parse(String(calls[1].init?.body));
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
    expect(JSON.parse(String(calls[1].init?.body)).shippingMethod.id).toBe(POINT_UUID);
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

    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/shipping-methods/courier-services?carrierCode=venipak&countryCode=EE`,
      `${BASE}/shipments`,
    ]);
    expect(JSON.parse(String(calls[1].init?.body)).shippingMethod).toEqual({ type: "courier", id: "svc-venipak" });
    expect(shipment.carrier).toBe("venipak");
  });

  it("estimates a weight and splits a phone number", () => {
    expect(estimateWeightKg({ items: order.items })).toBe(1);
    expect(estimateWeightKg({ items: [] })).toBe(0.3);
    expect(splitPhone("+372 5810 7505", "EE")).toEqual({ phoneCountryCode: "372", phoneNumber: "58107505" });
    expect(splitPhone("58107505", "EE")).toEqual({ phoneCountryCode: "372", phoneNumber: "58107505" });
    expect(splitPhone("00358 40 1234567", "FI")).toEqual({ phoneCountryCode: "358", phoneNumber: "401234567" });
    expect(splitPhone("2012345", "LV")).toEqual({ phoneCountryCode: "371", phoneNumber: "2012345" });
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

  it("creates the shipment, stores it, audits it and moves the order to shipped", async () => {
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

    const stored = await getOrder(order.id);
    expect(stored!.status).toBe("shipped");
    const ship = stored!.shipping as unknown as Record<string, Record<string, unknown>>;
    // merged, not replaced: the checkout's own fields survive
    expect(ship.pointName).toBe("Laagri Coop Maksimarketi pakiautomaat");
    expect(ship.montonio.shipmentId).toBe(SHIPMENT_BODY.id);
    expect(ship.montonio.trackingCode).toBe("CC543167770EE");

    expect((await listAudit(10)).some((a) => a.action === "shipment.create")).toBe(true);

    // a second press books nothing and answers with what is already there
    const again = await POST(
      req("/api/admin/shipments/", { method: "POST", body: JSON.stringify({ orderId: order.number }) }, admin),
    );
    const againBody = await again.json();
    expect(againBody.reused).toBe(true);
    expect(againBody.shipment.shipmentId).toBe(SHIPMENT_BODY.id);
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
    expect(rates).toEqual([
      { carrier: "omniva", methodType: "pickupPoint", subtype: "parcelMachine", price: 2.5, currency: "EUR" },
      { carrier: "omniva", methodType: "pickupPoint", subtype: "postOffice", price: 2.5, currency: "EUR" },
      { carrier: "dpd", methodType: "courier", subtype: "standard", price: 9.9, currency: "EUR" },
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
