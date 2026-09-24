/**
 * «Создать этикетку» on a parcel the carrier refused — the repair.
 *
 * Montonio support, 24.09.2026: «Yes, that's exactly the right and
 * recommended approach and you don't need to create a new shipment.
 * `registrationFailed` is one of three states from which a shipment can be
 * updated via PATCH, and PATCH automatically triggers a new registration
 * attempt with the carrier. If the attempt fails again, the shipment simply
 * stays in that same `registrationFailed` state (nothing is lost), and you can
 * just try again.»
 *
 * So POST /api/admin/shipments on a refused shipment must: PATCH the SAME
 * shipment (never POST /shipments), carry the order as it stands now, work
 * again and again, and never PATCH a shipment Montonio has registered since.
 * Montonio is a stubbed fetch; the order is a real row in PGlite.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { query } from "@/lib/db";
import { resetRateLimits as resetPayRateLimits } from "@/lib/payments/ratelimit";
import { resetMontonioMethodsCache } from "@/lib/shipping/montonio";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.ee";
const BASE = "https://sandbox-shipping.montonio.com/api/v2";
const SHIPMENT = "1f83f4c1-cccc-4dd5-8eae-837e6a88362f";
const POINT = "377c3b06-0967-4ff2-b28a-372cab234898";

type Call = { method: string; url: string; body: Record<string, unknown> | null };

function shipmentBody(status: string, code: string | null = null) {
  return {
    id: SHIPMENT,
    createdAt: "2026-09-24T08:50:45.376Z",
    status,
    merchantReference: "R-300001",
    shippingMethod: { type: "pickupPoint", id: POINT, carrierCode: "smartpost", countryCode: "EE" },
    parcels: [{ id: "p1", weight: 0.9, carrierParcelId: code, trackingLink: code ? `https://track.example/${code}` : null }],
  };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Montonio: GET and PATCH on the shipment answer from `get`/`patch`; anything else is a surprise. */
function montonio(get: () => Response, patch: () => Response): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url === `${BASE}/shipments/${SHIPMENT}` && method === "GET") return get();
      if (url === `${BASE}/shipments/${SHIPMENT}` && method === "PATCH") return patch();
      if (url === `${BASE}/shipping-methods`) return json({ countries: [] });
      throw new Error(`unexpected fetch: ${method} ${url}`);
    }),
  );
  return calls;
}

let admin = "";
let ip = 0;
function press(orderId: string, extra: Record<string, unknown> = {}) {
  return new Request(`${ORIGIN}/api/admin/shipments/`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${(ip++ % 200) + 1}`,
      cookie: admin,
    },
    body: JSON.stringify({ orderId, ...extra }),
  });
}

/** A paid order whose SmartPosti parcel Montonio has on file as refused. */
async function refusedOrder(montonio: Record<string, unknown> = {}): Promise<string> {
  const rows = await query<{ id: string }>(
    `insert into orders (number, email, name, phone, status, items, shipping)
     values ('R-300001', 'ostja@example.com', 'Johnny Receiver', '+372 5810 750', 'paid', $1::jsonb, $2::jsonb)
     returning id`,
    [
      JSON.stringify([{ id: "free-hold", title: "Free.Hold", qty: 1, price: 11 }]),
      JSON.stringify({
        method: "parcel",
        country: "EE",
        carrier: "smartpost",
        pointId: POINT,
        pointName: "Viljandi Turu Konsum",
        price: 2.59,
        montonio: {
          provider: "montonio",
          shipmentId: SHIPMENT,
          status: "registrationFailed",
          carrier: "smartpost",
          country: "EE",
          method: "pickupPoint",
          trackingCode: "",
          trackingUrl: "",
          dropOffPin: "",
          createdAt: "2026-09-24T08:50:45.376Z",
          ...montonio,
        },
      }),
    ],
  );
  return rows[0].id;
}

async function montonioOf(id: string): Promise<Record<string, unknown>> {
  return (await query<{ m: Record<string, unknown> }>("select shipping->'montonio' as m from orders where id = $1", [id]))[0].m;
}
async function journal(action: string) {
  return query<{ payload: Record<string, unknown> }>("select payload from admin_audit where action = $1 order by id", [action]);
}

describe("repairing a refused parcel — PATCH the same shipment", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    resetRateLimits();
    resetPayRateLimits();
    resetMontonioMethodsCache();
    await truncateAll();
    process.env.MONTONIO_ACCESS_KEY = "test-access-key";
    process.env.MONTONIO_SECRET_KEY = "test-secret-key-test-secret-key-0";
    process.env.MONTONIO_ENV = "sandbox";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MONTONIO_ACCESS_KEY;
    delete process.env.MONTONIO_SECRET_KEY;
    delete process.env.MONTONIO_ENV;
  });

  it("sends the same shipment again with PATCH, and stores the registration", async () => {
    const id = await refusedOrder();
    const calls = montonio(
      () => json(shipmentBody("registrationFailed")),
      () => json(shipmentBody("registered", "CC777EE")),
    );
    const { POST } = await import("@/app/api/admin/shipments/route");
    const res = await POST(press(id, { lockerSize: "S" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, repaired: true, patched: true, shipment: { status: "registered" } });

    // asked first, then PATCHed the very same id — and never booked a new one
    expect(calls.filter((c) => /\/shipments/.test(c.url)).map((c) => `${c.method} ${c.url.replace(BASE, "")}`)).toEqual([
      `GET /shipments/${SHIPMENT}`,
      `PATCH /shipments/${SHIPMENT}`,
    ]);
    expect(calls.some((c) => c.method === "POST")).toBe(false);

    const patch = calls.find((c) => c.method === "PATCH")!.body!;
    expect(patch).toEqual({
      shippingMethod: { type: "pickupPoint", id: POINT, lockerSize: "S" },
      receiver: { name: "Johnny Receiver", email: "ostja@example.com", phoneCountryCode: "372", phoneNumber: "5810750" },
      parcels: [{ weight: 0.9 }],
    });

    expect(await montonioOf(id)).toMatchObject({
      shipmentId: SHIPMENT,
      status: "registered",
      trackingCode: "CC777EE",
      trackingUrl: "https://track.example/CC777EE",
      repairs: 1,
      repairAt: null,
      dismissed: false,
    });
    expect(await journal("shipment.repair")).toHaveLength(1);
  });

  it("carries the order as it stands now — a corrected phone goes to the carrier", async () => {
    const id = await refusedOrder();
    await query("update orders set phone = '+372 5555 1234' where id = $1", [id]);
    const calls = montonio(
      () => json(shipmentBody("registrationFailed")),
      () => json(shipmentBody("registered", "CC888EE")),
    );
    const { POST } = await import("@/app/api/admin/shipments/route");
    expect((await POST(press(id))).status).toBe(200);
    const patch = calls.find((c) => c.method === "PATCH")!.body!;
    expect(patch.receiver).toMatchObject({ phoneCountryCode: "372", phoneNumber: "55551234" });
  });

  it("refused again is the same 502 — and the next press tries again, still the same shipment", async () => {
    const id = await refusedOrder();
    const calls = montonio(
      () => json(shipmentBody("registrationFailed")),
      () => json(shipmentBody("registrationFailed")),
    );
    const { POST } = await import("@/app/api/admin/shipments/route");

    const first = await POST(press(id));
    expect(first.status).toBe(502);
    const body = await first.json();
    expect(body).toMatchObject({ ok: false, error: "registration_failed", reason: "registration_failed" });
    expect(body.messages.RU).toMatch(/ещё раз/);
    expect((await montonioOf(id))).toMatchObject({ status: "registrationFailed", repairs: 1, repairAt: null });

    const second = await POST(press(id));
    expect(second.status).toBe(502);
    expect((await montonioOf(id)).repairs).toBe(2);

    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(2);
    expect(calls.every((c) => c.method !== "POST")).toBe(true);
    const rows = await journal("shipment.registration_failed");
    expect(rows.map((r) => r.payload.attempt)).toEqual([1, 2]);
  });

  it("does not PATCH a shipment Montonio has registered by itself since", async () => {
    /* Montonio re-tries a refusal on its own, and PATCH on a registered
       shipment would register it AGAIN. */
    const id = await refusedOrder();
    const calls = montonio(
      () => json(shipmentBody("registered", "CC999EE")),
      () => {
        throw new Error("must not PATCH");
      },
    );
    const { POST } = await import("@/app/api/admin/shipments/route");
    const res = await POST(press(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, repaired: true, patched: false });
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(await montonioOf(id)).toMatchObject({ status: "registered", trackingCode: "CC999EE" });
  });

  it("sends nothing when Montonio cannot be asked, and the button works again at once", async () => {
    const id = await refusedOrder();
    const calls = montonio(
      () => json({ message: "boom" }, 500),
      () => {
        throw new Error("must not PATCH");
      },
    );
    const { POST } = await import("@/app/api/admin/shipments/route");
    const res = await POST(press(id));
    expect(res.status).toBe(502);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect((await montonioOf(id)).repairAt).toBeNull();
  });

  it("answers in_progress to a second tap while the first repair is still at Montonio", async () => {
    const id = await refusedOrder({ repairAt: Date.now() });
    const calls = montonio(
      () => json(shipmentBody("registrationFailed")),
      () => json(shipmentBody("registered", "CC1EE")),
    );
    const { POST } = await import("@/app/api/admin/shipments/route");
    const res = await POST(press(id));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: "in_progress" });
    expect(calls).toHaveLength(0);
  });
});
