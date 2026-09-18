/**
 * POST /api/shipping/notify/ — Montonio's `shipment.statusUpdated`.
 *
 * Registered on Dim's answer of 08.09.2026 («register it and watch what
 * actually arrives»), so what is proven here is, in this order: that an
 * unsigned or foreign token moves nothing, that every status word is written
 * down whether or not we understand it, and that the white list in
 * src/lib/delivery.ts — still a guess until the recorded vocabulary replaces
 * it — closes exactly the orders it should and no others.
 *
 * There is no Montonio in a test run (`PAYMENT_PROVIDER=mock`, and the sandbox
 * store cannot even switch bank payments on), so the provider is mocked the
 * way the payment webhook's own tests mock it: a key pair in the environment
 * and tokens signed with it. Nothing here reaches the network.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import { signHs256 } from "@/lib/payments/jwt";
import { resetRateLimits } from "@/lib/payments/ratelimit";
import { readStatusBook, statusMeaning, verifyShipmentWebhook } from "@/lib/shipping/webhook";
import { GET, POST } from "@/app/api/shipping/notify/route";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const SECRET = "sample-montonio-secret-key-0123456789";
const ACCESS = "sample-access-key";
const SHIPMENT = "9f1c7a52-1111-4444-8888-aaaaaaaaaaaa";
const NUMBER = "R-100042";

/** A token shaped like the one Montonio signs — same secret, same envelope. */
function token(claims: Record<string, unknown> = {}, secret = SECRET): string {
  return signHs256(
    {
      accessKey: ACCESS,
      event: "shipment.statusUpdated",
      shipmentId: SHIPMENT,
      merchantReference: NUMBER,
      status: "delivered",
      ...claims,
    },
    secret,
    { expiresInSeconds: 600 },
  );
}

function hook(body: unknown): Request {
  return new Request("https://rempireshop.ee/api/shipping/notify/", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "35.156.245.42" },
    body: JSON.stringify(body),
  });
}

/** A `shipped` order carrying the shipment the webhooks below talk about. */
async function shippedOrder(number = NUMBER): Promise<string> {
  const rows = await query<{ id: string }>(
    `insert into orders (number, email, name, status, shipping)
     values ($1, $2, $3, 'shipped', $4::jsonb) returning id`,
    [
      number,
      "buyer@example.com",
      "Тест",
      JSON.stringify({
        method: "parcel",
        country: "EE",
        montonio: { provider: "montonio", shipmentId: SHIPMENT, status: "registered", carrier: "omniva" },
      }),
    ],
  );
  return rows[0].id;
}

async function statusOf(id: string): Promise<string> {
  const rows = await query<{ status: string }>("select status from orders where id = $1", [id]);
  return rows[0].status;
}

async function shipmentStatusOf(id: string): Promise<string> {
  const rows = await query<{ status: string | null }>(
    "select shipping->'montonio'->>'status' as status from orders where id = $1",
    [id],
  );
  return rows[0].status ?? "";
}

async function journal(action: string): Promise<Array<{ actor: string; payload: Record<string, unknown> }>> {
  return query("select actor, payload from admin_audit where action = $1 order by id", [action]);
}

describe("the shipment webhook", () => {
  beforeAll(async () => {
    await setupDb();
    process.env.MONTONIO_ACCESS_KEY = ACCESS;
    process.env.MONTONIO_SECRET_KEY = SECRET;
  });
  afterAll(async () => {
    delete process.env.MONTONIO_ACCESS_KEY;
    delete process.env.MONTONIO_SECRET_KEY;
    await teardownDb();
  });
  beforeEach(async () => {
    await truncateAll();
    resetRateLimits();
  });

  it("takes a signed status, writes it down and closes the parcel", async () => {
    const id = await shippedOrder();

    const res = await POST(hook({ payload: token() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, status: "delivered", number: NUMBER, applied: "delivered" });

    expect(await statusOf(id)).toBe("delivered");
    // and the carrier's own word is on the order, next to the shipment id
    expect(await shipmentStatusOf(id)).toBe("delivered");

    const book = await readStatusBook();
    expect(Object.keys(book)).toEqual(["delivered"]);
    expect(book.delivered).toMatchObject({ count: 1, meaning: "delivered", event: "shipment.statusUpdated" });
    expect(book.delivered.first).toBe(book.delivered.last);

    // a word nobody had seen before is news, and lands in the shop's journal
    const rows = await journal("shipment.status");
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe("system");
    expect(rows[0].payload).toMatchObject({ code: "delivered", meaning: "delivered" });
  });

  it("refuses a token signed with someone else's secret and touches nothing", async () => {
    const id = await shippedOrder();

    const res = await POST(hook({ payload: token({}, "not-the-montonio-secret-key") }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ ok: false, error: "bad_token" });

    // the refusal is total: no status recorded, no order moved, no journal line
    expect(await statusOf(id)).toBe("shipped");
    expect(await readStatusBook()).toEqual({});
    expect(await journal("shipment.status")).toHaveLength(0);
  });

  it("refuses a valid token belonging to another Montonio store", async () => {
    const id = await shippedOrder();
    const res = await POST(hook({ payload: token({ accessKey: "someone-elses-store" }) }));
    expect(res.status).toBe(400);
    expect(await statusOf(id)).toBe("shipped");
    expect(await readStatusBook()).toEqual({});
  });

  it("records a status the white list has never heard of, and moves nothing", async () => {
    const id = await shippedOrder();

    const res = await POST(hook({ payload: token({ status: "AWAITING_COLLECTION" }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "AWAITING_COLLECTION", meaning: "unknown" });

    /* The whole point of the endpoint: the word is kept exactly as it arrived,
       with the fact that the white list did not recognise it, so the real
       vocabulary can be read off production instead of guessed at. */
    const book = await readStatusBook();
    expect(book.AWAITING_COLLECTION).toMatchObject({ count: 1, meaning: "" });
    expect(statusMeaning("AWAITING_COLLECTION")).toBe("");

    // an unknown word never closes an order — the rule delivery.ts already had
    expect(await statusOf(id)).toBe("shipped");
    expect(await shipmentStatusOf(id)).toBe("AWAITING_COLLECTION");
  });

  it("counts a redelivered webhook without doing anything twice", async () => {
    const id = await shippedOrder();
    const first = await POST(hook({ payload: token() }));
    expect(first.status).toBe(200);

    /* Montonio retries for 48 hours, so the same event arriving again is
       normal traffic, not an error: 200, one more tick on the word, and
       nothing else moves. */
    const again = await POST(hook({ payload: token() }));
    expect(again.status).toBe(200);
    const body = await again.json();
    expect(body).toMatchObject({ ok: true, status: "delivered" });
    // nothing was applied the second time: the order had already arrived
    expect(body.applied).toBeUndefined();

    const book = await readStatusBook();
    expect(Object.keys(book)).toEqual(["delivered"]);
    expect(book.delivered.count).toBe(2);

    expect(await statusOf(id)).toBe("delivered");
    // one close, one journal line for the status, one for the order
    expect(await journal("shipment.status")).toHaveLength(1);
    expect(await journal("order.status")).toHaveLength(1);
  });

  it("records a parcel that came back, and leaves the order open", async () => {
    const id = await shippedOrder();
    const res = await POST(hook({ payload: token({ status: "returned" }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ meaning: "returned" });
    /* It is on its way to Renat, not to the customer: «Доставлен» would be a
       lie and would take the order off his screen. */
    expect(await statusOf(id)).toBe("shipped");
    expect((await readStatusBook()).returned).toMatchObject({ meaning: "returned" });
  });

  it("finds the order by the shipment when the token names no order number", async () => {
    const id = await shippedOrder();
    const res = await POST(hook({ payload: token({ merchantReference: "" }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ number: NUMBER });
    expect(await statusOf(id)).toBe("delivered");
  });

  it("answers 200 for a shipment this shop has no order for — and keeps the word", async () => {
    const res = await POST(hook({ payload: token({ merchantReference: "R-999999" }) }));
    // 200: a 4xx would buy 48 hours of redelivery and fix nothing
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ignored: "unknown_shipment", status: "delivered" });
    expect((await readStatusBook()).delivered).toMatchObject({ count: 1 });
  });

  it("does not close an order that was never shipped", async () => {
    const rows = await query<{ id: string }>(
      "insert into orders (number, email, status) values ($1, $2, 'paid') returning id",
      ["R-100077", "buyer@example.com"],
    );
    const res = await POST(hook({ payload: token({ merchantReference: "R-100077" }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).applied).toBeUndefined();
    expect(await statusOf(rows[0].id)).toBe("paid");
  });

  it("refuses a token that names neither a shipment nor an order", async () => {
    const res = await POST(hook({ payload: token({ shipmentId: "", merchantReference: "" }) }));
    expect(res.status).toBe(400);
    expect(await readStatusBook()).toEqual({});
  });

  it("refuses a body with no token at all", async () => {
    const res = await POST(hook({ hello: "world" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "bad_token" });
  });

  it("answers 405 on GET, like the payment webhook", async () => {
    const res = GET();
    expect(res.status).toBe(405);
  });
});

/**
 * The envelope Montonio actually sends — the one printed, decoded, in the
 * webhooks guide. `eventType` and `shipmentId` at the top; the shipment itself,
 * with its status, its merchantReference and its parcels, inside `data`.
 *
 * The fixture above this one is flat, which is what Montonio's envelope is not,
 * and for months that was the only shape under test: readEvent() had been
 * written to match the fixture, so every real notification read as «no status»
 * and was thrown away with a 200. These cases are the documented shape, and
 * they fail against the code as it stood before 18.09.2026.
 */
function guideToken(
  overrides: { eventType?: string; data?: Record<string, unknown> } = {},
  secret = SECRET,
): string {
  return signHs256(
    {
      eventId: "e1be81fb-2355-44b2-9f28-2b1a691151bb",
      shipmentId: SHIPMENT,
      created: "2026-09-18T10:51:57.322Z",
      eventType: overrides.eventType ?? "shipment.statusUpdated",
      data: {
        id: SHIPMENT,
        createdAt: "2026-09-18T10:51:55.288Z",
        status: "delivered",
        montonioOrderUuid: null,
        merchantReference: NUMBER,
        carrierShipmentId: null,
        shippingMethod: {
          type: "pickupPoint",
          id: "377c3b06-0967-4ff2-b28a-372cab234898",
          carrierCode: "omniva",
          countryCode: "EE",
        },
        parcels: [
          {
            id: "0b10c1e1-beaa-4b09-9bb6-c6dd4002114d",
            weight: 1,
            carrierParcelId: "CC548936341EE",
            trackingLink: "https://minu.omniva.ee/track/CC548936341EE?language=et",
          },
        ],
        store: { id: "088ae409-ae24-4a3c-a640-5c269f732caa" },
        ...overrides.data,
      },
    },
    secret,
    { expiresInSeconds: 600 },
  );
}

describe("the envelope Montonio documents", () => {
  const config = { accessKey: ACCESS, secretKey: SECRET, env: "sandbox" } as const;

  it("reads the status, the order and the parcel out of `data`", () => {
    const event = verifyShipmentWebhook({ payload: guideToken() }, config);
    expect(event).toEqual({
      event: "shipment.statusUpdated",
      shipmentId: SHIPMENT,
      orderRef: NUMBER,
      status: "delivered",
      trackingCode: "CC548936341EE",
    });
  });

  it("still reads a flat token, so nothing that worked stopped working", () => {
    const event = verifyShipmentWebhook({ payload: token() }, config);
    expect(event).toMatchObject({ shipmentId: SHIPMENT, orderRef: NUMBER, status: "delivered" });
  });

  it("accepts `orderId`, which Montonio's own example token still encodes", () => {
    const event = verifyShipmentWebhook(
      { payload: guideToken({ data: { merchantReference: undefined, orderId: NUMBER } }) },
      config,
    );
    expect(event.orderRef).toBe(NUMBER);
  });
});

describe("the shipment webhook, spoken the way Montonio speaks it", () => {
  beforeAll(async () => {
    await setupDb();
    process.env.MONTONIO_ACCESS_KEY = ACCESS;
    process.env.MONTONIO_SECRET_KEY = SECRET;
  });
  afterAll(async () => {
    delete process.env.MONTONIO_ACCESS_KEY;
    delete process.env.MONTONIO_SECRET_KEY;
    await teardownDb();
  });
  beforeEach(async () => {
    await truncateAll();
    resetRateLimits();
  });

  it("closes the order from a real `shipment.statusUpdated`", async () => {
    const id = await shippedOrder();

    const res = await POST(hook({ payload: guideToken() }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      status: "delivered",
      number: NUMBER,
      applied: "delivered",
    });

    expect(await statusOf(id)).toBe("delivered");
    expect(await shipmentStatusOf(id)).toBe("delivered");
    expect((await readStatusBook()).delivered).toMatchObject({ count: 1, meaning: "delivered" });
  });

  it("writes down `registrationFailed` — the carrier refused the parcel — and moves nothing", async () => {
    const id = await shippedOrder();

    const res = await POST(
      hook({
        payload: guideToken({
          eventType: "shipment.registrationFailed",
          data: { status: "registrationFailed" },
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "registrationFailed", meaning: "unknown" });

    /* Nothing in the white list matches it, so the order stays where it is —
       but the word is recorded, which is the whole reason this endpoint exists
       and is exactly what used to be lost. */
    expect(await statusOf(id)).toBe("shipped");
    expect((await readStatusBook()).registrationFailed).toMatchObject({
      count: 1,
      meaning: "",
      event: "shipment.registrationFailed",
    });
  });

  it("records `awaitingCollection` without calling a waiting parcel delivered", async () => {
    const id = await shippedOrder();
    const res = await POST(hook({ payload: guideToken({ data: { status: "awaitingCollection" } }) }));
    expect(res.status).toBe(200);
    // it is in the locker, not in the customer's hands
    expect(await statusOf(id)).toBe("shipped");
    expect((await readStatusBook()).awaitingCollection).toMatchObject({ meaning: "" });
  });

  it("finds the order by shipmentId when `data` names no reference", async () => {
    const id = await shippedOrder();
    const res = await POST(hook({ payload: guideToken({ data: { merchantReference: "" } }) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ number: NUMBER });
    expect(await statusOf(id)).toBe("delivered");
  });
});

describe("the shipment webhook without Montonio keys", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(async () => {
    await truncateAll();
    resetRateLimits();
    delete process.env.MONTONIO_ACCESS_KEY;
    delete process.env.MONTONIO_SECRET_KEY;
  });

  it("believes nothing it cannot check", async () => {
    const id = await shippedOrder();
    const res = await POST(hook({ payload: token() }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "not_configured" });
    expect(await statusOf(id)).toBe("shipped");
    expect(await readStatusBook()).toEqual({});
  });
});
