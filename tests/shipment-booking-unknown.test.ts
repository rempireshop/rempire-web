/**
 * «Создать этикетку» when Montonio answers too late — R-100098, 26.09.2026.
 *
 * The first live hour, real keys, a paid order to a DPD parcel machine. The
 * button posted `POST /shipments` with `synchronous: true`; our fetch gave up
 * after ten seconds; the route took that for «nothing was booked», gave the
 * booking slot back and answered 502. Montonio HAD booked it: at 19:33:03 UTC
 * `shipment.registered` arrived for shipment 3888e013-… and order R-100098.
 * The webhook wrote only `{ status, statusAt }` onto the order — no id — so
 * the shop still believed there was no parcel, and the next press would have
 * booked, and paid for, a second one.
 *
 * What is proven here, against the real route, a real database (PGlite) and a
 * stubbed Montonio:
 *   · a timeout (or a 5xx, or a 2xx we could not read) is «we do not know», not
 *     «no»: the slot is not given back, the order carries a marker, the
 *     journal a row, and the answer is its own error, `booking_unknown`;
 *   · a definite refusal (4xx with a body) still frees the button at once;
 *   · the webhook now stores the shipment on an order that has none;
 *   · every press first looks for a parcel Montonio already has — on the
 *     order, then in the journal — and ADOPTS it instead of booking;
 *   · only when nothing can be found and the marker is older than the safe
 *     window may a new booking go ahead;
 *   · R-100098 exactly as it stands in production is adopted, never re-booked.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { query } from "@/lib/db";
import { signHs256 } from "@/lib/payments/jwt";
import { resetRateLimits as resetPayRateLimits } from "@/lib/payments/ratelimit";
import { BOOKING_UNCERTAIN_MS, CREATE_TIMEOUT_MS, resetMontonioMethodsCache } from "@/lib/shipping/montonio";
import { readStatusBook } from "@/lib/shipping/webhook";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.ee";
const BASE = "https://sandbox-shipping.montonio.com/api/v2";
const ACCESS = "test-access-key";
const SECRET = "test-secret-key-test-secret-key-0";
const NUMBER = "R-100098";
/** The parcel Montonio booked for R-100098 while our fetch had already given up. */
const BOOKED = "3888e013-c3a6-4ead-9609-292447179f52";
/** A second, different parcel — what a second booking would have cost. */
const SECOND = "7d1e0b44-5555-4c3a-9e11-0a0b0c0d0e0f";
const POINT = "5f0c2a8e-8d0b-4f4e-9d67-1f3a0e2b7c11";
const TRACKING = "09062026098EE";

function shipmentBody(over: Record<string, unknown> = {}) {
  return {
    id: BOOKED,
    createdAt: "2026-09-26T19:32:55.000Z",
    status: "registered",
    merchantReference: NUMBER,
    shippingMethod: { type: "pickupPoint", id: POINT, carrierCode: "dpd", countryCode: "EE" },
    parcels: [{ id: "p1", weight: 0.9, carrierParcelId: TRACKING, trackingLink: `https://tracking.dpd.ee/${TRACKING}` }],
    ...over,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** What AbortSignal.timeout() makes fetch throw when the time is up. */
function timedOut(): never {
  throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
}

type Call = { method: string; path: string; signal: AbortSignal | undefined };

/**
 * Montonio: `POST /shipments` answers from `create`, `GET /shipments/{id}`
 * from `get`; `/shipping-methods` is the constraints read every booking makes.
 * Anything else is a surprise and fails the test.
 */
function montonio(stub: { create?: () => Response; get?: (id: string) => Response }): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
      calls.push({ method, path, signal: init?.signal ?? undefined });
      if (path === "/shipping-methods") return json({ countries: [] });
      if (path === "/shipments" && method === "POST") {
        if (!stub.create) throw new Error("this press must not book a parcel");
        return stub.create();
      }
      const one = /^\/shipments\/([^/?]+)$/.exec(path);
      if (one && method === "GET" && stub.get) return stub.get(decodeURIComponent(one[1]));
      throw new Error(`unexpected fetch: ${method} ${url}`);
    }),
  );
  return calls;
}
const bookings = (calls: Call[]) => calls.filter((c) => c.method === "POST" && c.path === "/shipments").length;

let admin = "";
let ip = 0;
function press(orderId: string) {
  return new Request(`${ORIGIN}/api/admin/shipments/`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${(ip++ % 200) + 1}`,
      cookie: admin,
    },
    body: JSON.stringify({ orderId }),
  });
}

/** Montonio's `shipment.registered`, in the envelope the webhooks guide prints. */
function registeredHook(data: Record<string, unknown> = shipmentBody()): Request {
  const payload = signHs256(
    {
      accessKey: ACCESS,
      eventId: "e1be81fb-2355-44b2-9f28-2b1a691151bb",
      shipmentId: String(data.id ?? BOOKED),
      created: "2026-09-26T19:33:03.000Z",
      eventType: "shipment.registered",
      data,
    },
    SECRET,
    { expiresInSeconds: 600 },
  );
  return new Request(`${ORIGIN}/api/shipping/notify/`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "35.156.245.42" },
    body: JSON.stringify({ payload }),
  });
}

/** R-100098: paid, a DPD parcel machine, and whatever `montonio` the case needs. */
async function paidOrder(montonioPart?: Record<string, unknown>): Promise<string> {
  const rows = await query<{ id: string }>(
    `insert into orders (number, email, name, phone, status, items, shipping)
     values ($1, 'ostja@example.com', 'Ostja Test', '+372 5555 0098', 'paid', $2::jsonb, $3::jsonb)
     returning id`,
    [
      NUMBER,
      JSON.stringify([{ id: "one-euro", title: "Live test item", qty: 1, price: 1 }]),
      JSON.stringify({
        method: "parcel",
        country: "EE",
        carrier: "dpd",
        pointId: POINT,
        pointName: "Tartu Lõunakeskus DPD pakiautomaat",
        price: 3.49,
        ...(montonioPart ? { montonio: montonioPart } : {}),
      }),
    ],
  );
  return rows[0].id;
}

/** The row the OLD notify route wrote on 26.09.2026 — the id is only here. */
async function statusJournalRow(at = "now()") {
  await query(
    `insert into admin_audit (actor, action, payload, at) values ('system', 'shipment.status', $1::jsonb, ${at})`,
    [
      JSON.stringify({
        code: "registered",
        event: "shipment.registered",
        order: NUMBER,
        meaning: "unknown",
        shipmentId: BOOKED,
      }),
    ],
  );
}

async function montonioOf(id: string): Promise<Record<string, unknown>> {
  const rows = await query<{ m: Record<string, unknown> | null }>(
    "select shipping->'montonio' as m from orders where id = $1",
    [id],
  );
  return rows[0].m ?? {};
}
async function journal(action: string) {
  return query<{ actor: string; payload: Record<string, unknown> }>(
    "select actor, payload from admin_audit where action = $1 order by id",
    [action],
  );
}
async function orderStatus(id: string) {
  return (await query<{ status: string }>("select status from orders where id = $1", [id]))[0].status;
}
/** A booking-clock value `ms` in the past, on the database's own clock. */
async function msAgo(ms: number): Promise<number> {
  const rows = await query<{ t: number | string }>("select ((extract(epoch from now()) * 1000)::bigint - $1::bigint)::float8 as t", [ms]);
  return Number(rows[0].t);
}

type Msgs = { RU: string; ET: string; EN: string };

describe("«Создать этикетку» when Montonio does not answer in time", () => {
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
    process.env.MONTONIO_ACCESS_KEY = ACCESS;
    process.env.MONTONIO_SECRET_KEY = SECRET;
    process.env.MONTONIO_ENV = "sandbox";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.MONTONIO_ACCESS_KEY;
    delete process.env.MONTONIO_SECRET_KEY;
    delete process.env.MONTONIO_ENV;
  });

  it("a timeout is «we do not know»: 504 booking_unknown, the slot kept, a marker and a journal row", async () => {
    const id = await paidOrder();
    const timeouts = vi.spyOn(AbortSignal, "timeout");
    const calls = montonio({ create: timedOut });
    const { POST } = await import("@/app/api/admin/shipments/route");

    const res = await POST(press(id));
    expect(res.status).toBe(504);
    const body = (await res.json()) as { ok: boolean; error: string; reason: string; messages: Msgs };
    expect(body).toMatchObject({ ok: false, error: "booking_unknown", reason: "timeout" });
    for (const lang of ["RU", "ET", "EN"] as const) expect(body.messages[lang].length).toBeGreaterThan(60);
    // says plainly: wait, press again, the shop checks first, no second parcel
    expect(body.messages.RU).toMatch(/не ответил/);
    expect(body.messages.RU).toMatch(/вторую не создаст/);

    /* The create call waited its own, longer time — live DPD took more than
       ten seconds to register synchronously. */
    const post = calls.find((c) => c.method === "POST" && c.path === "/shipments")!;
    const made = timeouts.mock.results.findIndex((r) => r.value === post.signal);
    expect(made).toBeGreaterThanOrEqual(0);
    expect(timeouts.mock.calls[made][0]).toBe(CREATE_TIMEOUT_MS);
    expect(CREATE_TIMEOUT_MS).toBeGreaterThanOrEqual(25_000);

    const m = await montonioOf(id);
    expect(m.shipmentId).toBeUndefined();
    expect(Number(m.bookingUncertainAt)).toBeGreaterThan(0);
    expect(m.bookingAt).toBeNull();
    const rows = await journal("shipment.booking_unknown");
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({ number: NUMBER, provider: "montonio" });
  });

  it("R-100098 end to end: timeout → the next press waits → the webhook stores the parcel → the press adopts it — one booking in all", async () => {
    const id = await paidOrder();
    const calls = montonio({ create: timedOut });
    const { POST } = await import("@/app/api/admin/shipments/route");
    const notify = await import("@/app/api/shipping/notify/route");

    expect((await POST(press(id))).status).toBe(504);

    // pressed again at once: nothing found yet, and nothing is booked
    const again = await POST(press(id));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ ok: false, error: "booking_unknown", reason: "waiting" });
    expect(bookings(calls)).toBe(1);

    // 19:33:03 UTC — Montonio's webhook: the parcel exists
    const hooked = await notify.POST(registeredHook());
    expect(hooked.status).toBe(200);
    expect(await hooked.json()).toMatchObject({ ok: true, number: NUMBER, adopted: true });
    expect(await montonioOf(id)).toMatchObject({
      provider: "montonio",
      shipmentId: BOOKED,
      status: "registered",
      carrier: "dpd",
      country: "EE",
      method: "pickupPoint",
      trackingCode: TRACKING,
      trackingUrl: `https://tracking.dpd.ee/${TRACKING}`,
      adoptedFrom: "webhook",
      bookingUncertainAt: null,
    });
    const adopted = await journal("shipment.adopt");
    expect(adopted).toHaveLength(1);
    expect(adopted[0].payload).toMatchObject({ number: NUMBER, shipmentId: BOOKED, source: "webhook" });

    // the press after it shows the parcel that exists — it never books
    const third = await POST(press(id));
    expect(third.status).toBe(200);
    expect(await third.json()).toMatchObject({
      ok: true,
      reused: true,
      adopted: true,
      shipment: { shipmentId: BOOKED, trackingCode: TRACKING },
    });
    expect(bookings(calls)).toBe(1);
    // a label is a sticker, not a hand-over: the order is still paid
    expect(await orderStatus(id)).toBe("paid");
  });

  it("R-100098 as it stands in production — status without an id, the id only in the journal: the press adopts 3888e013", async () => {
    const id = await paidOrder({ bookingAt: null, status: "registered", statusAt: "2026-09-26T19:33:03.000Z" });
    await statusJournalRow();
    const calls = montonio({ get: (sid) => (sid === BOOKED ? json(shipmentBody()) : json({ message: "no" }, 404)) });
    const { POST } = await import("@/app/api/admin/shipments/route");

    const res = await POST(press(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      reused: true,
      adopted: true,
      shipment: { shipmentId: BOOKED, trackingCode: TRACKING, status: "registered" },
    });
    // asked Montonio about that one shipment, and booked nothing
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([`GET /shipments/${BOOKED}`]);

    expect(await montonioOf(id)).toMatchObject({
      shipmentId: BOOKED,
      status: "registered",
      carrier: "dpd",
      trackingCode: TRACKING,
      adoptedFrom: "journal",
      dismissed: false,
    });
    const rows = await journal("shipment.adopt");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "admin", payload: { number: NUMBER, shipmentId: BOOKED, source: "journal" } });

    // …and from now on it is simply the order's parcel
    const again = await POST(press(id));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ reused: true, shipment: { shipmentId: BOOKED } });
    expect(bookings(calls)).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("a definite refusal — a 4xx with a body — still frees the button at once", async () => {
    const id = await paidOrder();
    let attempt = 0;
    const calls = montonio({
      create: () => {
        attempt += 1;
        return attempt === 1
          ? json({ statusCode: 400, message: ["receiver.phoneNumber must be a valid phone number"] }, 400)
          : json(shipmentBody({ id: SECOND }));
      },
    });
    const { POST } = await import("@/app/api/admin/shipments/route");

    const refused = await POST(press(id));
    expect(refused.status).toBe(502);
    expect(await refused.json()).toMatchObject({ ok: false, error: "rejected" });
    const m = await montonioOf(id);
    expect(m.bookingAt).toBeNull();
    expect(m.bookingUncertainAt ?? null).toBeNull();
    expect(await journal("shipment.booking_unknown")).toHaveLength(0);

    const ok = await POST(press(id));
    expect(ok.status).toBe(200);
    expect(bookings(calls)).toBe(2);
  });

  it("a 5xx is not a refusal either — the parcel may exist, so the next press waits", async () => {
    const id = await paidOrder();
    const calls = montonio({ create: () => json({ message: "Internal server error" }, 500) });
    const { POST } = await import("@/app/api/admin/shipments/route");

    const first = await POST(press(id));
    expect(first.status).toBe(504);
    expect(await first.json()).toMatchObject({ error: "booking_unknown", reason: "timeout" });
    const second = await POST(press(id));
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "booking_unknown", reason: "waiting" });
    expect(bookings(calls)).toBe(1);
  });

  it("a 2xx without a shipment id is not a refusal: something was created", async () => {
    const id = await paidOrder();
    const calls = montonio({ create: () => json({ status: "registered" }) });
    const { POST } = await import("@/app/api/admin/shipments/route");
    const first = await POST(press(id));
    expect(first.status).toBe(504);
    expect(await first.json()).toMatchObject({ error: "booking_unknown" });
    expect((await POST(press(id))).status).toBe(409);
    expect(bookings(calls)).toBe(1);
  });

  it("after the safe window, with nothing found anywhere, a booking is allowed again", async () => {
    const id = await paidOrder({ bookingAt: null, bookingUncertainAt: await msAgo(BOOKING_UNCERTAIN_MS + 60_000) });
    const calls = montonio({ create: () => json(shipmentBody({ id: SECOND })) });
    const { POST } = await import("@/app/api/admin/shipments/route");

    const res = await POST(press(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, shipment: { shipmentId: SECOND } });
    expect(bookings(calls)).toBe(1);
    expect(await montonioOf(id)).toMatchObject({ shipmentId: SECOND, bookingAt: null, bookingUncertainAt: null });
  });

  it("inside the safe window the answer stays booking_unknown, and nothing is booked", async () => {
    const id = await paidOrder({ bookingAt: null, bookingUncertainAt: await msAgo(BOOKING_UNCERTAIN_MS - 60_000) });
    const calls = montonio({});
    const { POST } = await import("@/app/api/admin/shipments/route");
    const res = await POST(press(id));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "booking_unknown", reason: "waiting" });
    expect(bookings(calls)).toBe(0);
  });

  it("a press that died inside Montonio holds the button like a timeout, not for two minutes", async () => {
    // a claim five minutes old that nobody resolved: the function was killed mid-call
    const id = await paidOrder({ bookingAt: await msAgo(5 * 60_000) });
    const calls = montonio({ create: () => json(shipmentBody({ id: SECOND })) });
    const { POST } = await import("@/app/api/admin/shipments/route");

    const held = await POST(press(id));
    expect(held.status).toBe(409);
    expect(await held.json()).toMatchObject({ error: "booking_unknown", reason: "waiting" });
    expect(bookings(calls)).toBe(0);

    // eleven minutes: nothing turned up, the button books again
    await query(
      `update orders set shipping = jsonb_set(shipping, '{montonio,bookingAt}', to_jsonb($2::float8)) where id = $1`,
      [id, await msAgo(BOOKING_UNCERTAIN_MS + 60_000)],
    );
    const booked = await POST(press(id));
    expect(booked.status).toBe(200);
    expect(bookings(calls)).toBe(1);
  });

  it("a journal lead Montonio cannot confirm right now blocks the booking — it does not guess", async () => {
    const id = await paidOrder();
    await statusJournalRow();
    const calls = montonio({ get: timedOut });
    const { POST } = await import("@/app/api/admin/shipments/route");
    const res = await POST(press(id));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "booking_unknown", reason: "waiting" });
    expect(bookings(calls)).toBe(0);
    expect((await montonioOf(id)).shipmentId).toBeUndefined();
  });

  it("a journal lead for another order's parcel is not adopted", async () => {
    const id = await paidOrder();
    await statusJournalRow();
    const calls = montonio({
      get: () => json(shipmentBody({ merchantReference: "R-100001" })),
      create: () => json(shipmentBody({ id: SECOND })),
    });
    const { POST } = await import("@/app/api/admin/shipments/route");
    const res = await POST(press(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ shipment: { shipmentId: SECOND } });
    expect(await journal("shipment.adopt")).toHaveLength(0);
    expect(bookings(calls)).toBe(1);
  });

  it("a journal row older than the order itself is somebody else's R-100098 (before the go-live reset)", async () => {
    const id = await paidOrder();
    await statusJournalRow("now() - interval '3 days'");
    const calls = montonio({ create: () => json(shipmentBody({ id: SECOND })) });
    const { POST } = await import("@/app/api/admin/shipments/route");
    const res = await POST(press(id));
    expect(res.status).toBe(200);
    // never even asked about it
    expect(calls.some((c) => c.path === `/shipments/${BOOKED}`)).toBe(false);
    expect(bookings(calls)).toBe(1);
  });

  it("Montonio reported a parcel but no id is anywhere: never books, and says why — even after the window", async () => {
    const id = await paidOrder({ status: "registered", statusAt: "2026-09-26T19:33:03.000Z" });
    const calls = montonio({ create: () => json(shipmentBody({ id: SECOND })) });
    const { POST } = await import("@/app/api/admin/shipments/route");
    const res = await POST(press(id));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; reason: string; messages: Msgs };
    expect(body).toMatchObject({ error: "booking_unknown", reason: "unlinked" });
    expect(body.messages.RU).toMatch(/Montonio/);
    expect(bookings(calls)).toBe(0);
  });
});

describe("the webhook on an order the shop has no parcel id for", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    resetPayRateLimits();
    await truncateAll();
    process.env.MONTONIO_ACCESS_KEY = ACCESS;
    process.env.MONTONIO_SECRET_KEY = SECRET;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.MONTONIO_ACCESS_KEY;
    delete process.env.MONTONIO_SECRET_KEY;
  });

  it("stores the parcel from the signed event alone — no call to Montonio, an answer at once", async () => {
    const id = await paidOrder({ bookingAt: null, bookingUncertainAt: 1 });
    const fetchSpy = vi.fn(() => {
      throw new Error("the webhook must not call out");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { POST } = await import("@/app/api/shipping/notify/route");
    const res = await POST(registeredHook());
    expect(res.status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await montonioOf(id)).toMatchObject({ shipmentId: BOOKED, trackingCode: TRACKING, bookingUncertainAt: null });
    expect(await orderStatus(id)).toBe("paid");
  });

  it("gives «registered» a meaning of its own — and it still moves no order", async () => {
    const id = await paidOrder();
    const { POST } = await import("@/app/api/shipping/notify/route");
    const res = await POST(registeredHook());
    expect(await res.json()).toMatchObject({ status: "registered", meaning: "registered" });
    expect((await readStatusBook()).registered).toMatchObject({ meaning: "registered" });
    expect((await journal("shipment.status"))[0].payload).toMatchObject({ code: "registered", meaning: "registered" });
    expect(await orderStatus(id)).toBe("paid");
  });

  it("an event with no shipment id still writes its status — and the press then refuses to guess", async () => {
    const id = await paidOrder();
    const { POST } = await import("@/app/api/shipping/notify/route");
    const payload = signHs256(
      { accessKey: ACCESS, eventType: "shipment.registered", merchantReference: NUMBER, status: "registered" },
      SECRET,
      { expiresInSeconds: 600 },
    );
    const res = await POST(
      new Request(`${ORIGIN}/api/shipping/notify/`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "35.156.245.42" },
        body: JSON.stringify({ payload }),
      }),
    );
    expect(res.status).toBe(200);
    const m = await montonioOf(id);
    expect(m.status).toBe("registered");
    expect(m.shipmentId).toBeUndefined();
  });
});
