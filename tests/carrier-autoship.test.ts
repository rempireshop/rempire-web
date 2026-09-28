/**
 * «Отправлен» by the carrier's scan — the owner's decision of 28.09.2026
 * (Renat via Dim).
 *
 * Renat prints the label and drops the parcel into the carrier's machine. When
 * the carrier's scan reaches the shop through Montonio — the webhook, or the
 * nightly re-ask when the webhook was lost — the order becomes «Отправлен» and
 * the customer's tracking letter goes out, with nobody pressing anything. The
 * evidence: live order R-100098 (DPD parcel machine) got
 * `shipment.statusUpdated` → `inTransit` on 27.09.2026 17:24 UTC by itself
 * while the order stayed «оплачен».
 *
 * What is proven here, whoever brings the news (src/lib/shipping/shipment-
 * sync.ts, applyShipmentUpdate → src/lib/ship-order.ts, shipOrder):
 *   · only Montonio's three documented words for «the carrier has it» —
 *     `inTransit`, `awaitingCollection`, `delivered` — and only on a `paid`
 *     order that has never been «Отправлен» before;
 *   · the SAME door as the owner's press: the status, the journal row (which
 *     says «по скану перевозчика»), the one tracking letter;
 *   · exactly once — a duplicate webhook, the webhook racing the poll, a press
 *     before or after;
 *   · `delivered` as the first word: shipped, then delivered, one letter;
 *   · a cancelled or refunded order whose parcel moves: no change, one alert;
 *   · the label still does not ship.
 *
 * Real Postgres (PGlite). Montonio is a signed token (the webhook) or a stub
 * (the poll); the letters are counted where they would leave; the push is
 * mocked.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* The customer's tracking letter, counted where it would leave. */
const letters = vi.hoisted(() => ({ shipped: [] as Array<{ number: string; code: string }> }));
vi.mock("@/lib/mail-hooks", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    onOrderShipped: vi.fn(async (o: { number: string }, tracking?: { code?: string }) => {
      letters.shipped.push({ number: o.number, code: String(tracking?.code ?? "") });
      return { ok: true, sent: true };
    }),
  };
});
/* The owner's phone. */
const push = vi.hoisted(() => ({ sent: [] as Array<{ title: string; body: string }> }));
vi.mock("@/lib/push", () => ({
  sendPush: async (msg: { title: string; body: string }) => {
    push.sent.push(msg);
    return { ok: true, configured: true, devices: 1, sent: 1, failed: 0, gone: 0 };
  },
}));

import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits as resetAuthLimits } from "@/lib/auth";
import { exec, query } from "@/lib/db";
import { letterClock, lettersSettled } from "@/lib/letter-hold";
import { getOrder } from "@/lib/orders";
import { signHs256 } from "@/lib/payments/jwt";
import { resetRateLimits } from "@/lib/payments/ratelimit";
import { carrierHasParcel } from "@/lib/ship-order";
import type { MontonioShipment } from "@/lib/shipping/montonio";
import { applyShipmentUpdate, syncStaleShipments } from "@/lib/shipping/shipment-sync";
import { POST as notify } from "@/app/api/shipping/notify/route";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const SECRET = "sample-montonio-secret-key-0123456789";
const ACCESS = "sample-access-key";
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-09-28T07:00:00.000Z");
const ago = (h: number) => new Date(NOW - h * HOUR).toISOString();

let seq = 0;
/** A paid (or otherwise) web order holding one Montonio parcel. */
async function orderWith(
  opts: { status?: string; montonio?: Record<string, unknown> | null; shipping?: Record<string, unknown> } = {},
): Promise<{ id: string; number: string; shipmentId: string; trackingCode: string }> {
  seq += 1;
  const number = `R-7000${String(seq).padStart(2, "0")}`;
  const shipmentId = `3888e013-c3a6-4ead-9609-${String(seq).padStart(12, "0")}`;
  const trackingCode = `CC${seq}00000EE`;
  const montonio =
    opts.montonio === null
      ? undefined
      : {
          provider: "montonio",
          shipmentId,
          carrier: "dpd",
          status: "registered",
          trackingCode,
          trackingUrl: `https://tracking.dpd.ee/${seq}`,
          createdAt: ago(40),
          statusAt: ago(30),
          ...(opts.montonio ?? {}),
        };
  const rows = await query<{ id: string }>(
    `insert into orders (number, email, name, status, shipping)
     values ($1, 'buyer@example.com', 'Мария Тамм', $2, $3::jsonb) returning id`,
    [
      number,
      opts.status ?? "paid",
      JSON.stringify({ method: "parcel", country: "EE", ...(opts.shipping ?? {}), ...(montonio ? { montonio } : {}) }),
    ],
  );
  return { id: rows[0].id, number, shipmentId, trackingCode };
}

const statusOf = async (id: string) => (await query<{ status: string }>("select status from orders where id = $1", [id]))[0].status;
const shippingOf = async (id: string) =>
  (await query<{ s: Record<string, unknown> }>("select shipping as s from orders where id = $1", [id]))[0].s;
const statusRows = (number: string) =>
  query<{ actor: string; payload: Record<string, unknown> }>(
    "select actor, payload from admin_audit where action = 'order.status' and payload ->> 'number' = $1 order by id",
    [number],
  );
const journal = (action: string) =>
  query<{ actor: string; payload: Record<string, unknown> }>("select actor, payload from admin_audit where action = $1 order by id", [
    action,
  ]);

/** A token shaped like the one Montonio signs (the webhooks guide's decoded payload). */
function event(o: { number: string; shipmentId: string }, status: string, extra: Record<string, unknown> = {}): Request {
  const payload = signHs256(
    {
      accessKey: ACCESS,
      eventType: "shipment.statusUpdated",
      shipmentId: o.shipmentId,
      data: { id: o.shipmentId, status, merchantReference: o.number, ...extra },
    },
    SECRET,
    { expiresInSeconds: 600 },
  );
  return new Request("https://rempireshop.ee/api/shipping/notify/", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "35.156.245.42" },
    body: JSON.stringify({ payload }),
  });
}
async function hook(o: { number: string; shipmentId: string }, status: string, extra: Record<string, unknown> = {}) {
  const res = await notify(event(o, status, extra));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Montonio's GET, stubbed: one answer per shipment id. */
function montonio(answers: Record<string, Partial<MontonioShipment>>) {
  const asked: string[] = [];
  const fetchShipment = async (id: string): Promise<MontonioShipment> => {
    asked.push(id);
    return {
      provider: "montonio", shipmentId: id, status: "registered", carrier: "dpd", country: "EE", method: "pickupPoint",
      trackingCode: "", trackingUrl: "", dropOffPin: "", createdAt: "", ...(answers[id] ?? {}),
    };
  };
  return { asked, fetchShipment };
}
const poll = (answers: Record<string, Partial<MontonioShipment>>) =>
  syncStaleShipments({ now: NOW, fetchShipment: montonio(answers).fetchShipment, configured: () => true });

/* ---------- the owner's own press (PATCH /api/admin/orders/<id>) ---------- */
const admin = () => `${ADMIN_COOKIE}=${makeSessionToken()}`;
async function press(id: string, status: string) {
  const { PATCH } = await import("@/app/api/admin/orders/[id]/route");
  const res = await PATCH(
    new Request(`https://rempireshop.com/api/admin/orders/${id}/`, {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: admin() },
      body: JSON.stringify({ status }),
    }),
    { params: Promise.resolve({ id }) },
  );
  const body = (await res.json()) as Record<string, unknown>;
  await lettersSettled();
  return { status: res.status, body };
}

const realSleep = letterClock.sleep;
beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
  process.env.MONTONIO_ACCESS_KEY = ACCESS;
  process.env.MONTONIO_SECRET_KEY = SECRET;
  await setupDb();
});
afterAll(async () => {
  letterClock.sleep = realSleep;
  delete process.env.MONTONIO_ACCESS_KEY;
  delete process.env.MONTONIO_SECRET_KEY;
  await teardownDb();
});
beforeEach(async () => {
  await truncateAll();
  await exec("truncate owner_alerts");
  resetRateLimits();
  resetAuthLimits();
  letters.shipped.length = 0;
  push.sent.length = 0;
  // the owner's letter is held ten seconds; here the ten seconds pass at once
  letterClock.sleep = async () => {};
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(async () => {
  await lettersSettled();
  vi.restoreAllMocks();
});

describe("the words that mean «the carrier has it»", () => {
  it("are Montonio's three documented ones, and nothing else", () => {
    for (const w of ["inTransit", "awaitingCollection", "delivered", "INTRANSIT", " delivered "]) expect(carrierHasParcel(w), w).toBe(true);
    for (const w of ["pending", "registered", "registrationFailed", "labelsCreated", "returned", "", "in_transit", "in transit",
      "completed", "picked_up", "delivered_to_locker", "something_new"]) {
      expect(carrierHasParcel(w), w).toBe(false);
    }
  });
});

describe("the webhook ships a paid order", () => {
  it("inTransit: «Отправлен», one tracking letter, the journal says «по скану перевозчика»", async () => {
    const o = await orderWith();
    const r = await hook(o, "inTransit");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, status: "inTransit", number: o.number, shipped: true });

    expect(await statusOf(o.id)).toBe("shipped");
    // the letter carries the tracking code the card shows
    expect(letters.shipped).toEqual([{ number: o.number, code: o.trackingCode }]);
    const rows = await statusRows(o.number);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "system", payload: { from: "paid", to: "shipped", via: "carrier", shipmentId: o.shipmentId, carrierStatus: "inTransit" } });
    const s = await shippingOf(o.id);
    expect(typeof s.shippedAt).toBe("string");
    expect((s.montonio as Record<string, unknown>).status).toBe("inTransit");
    expect(typeof (s.montonio as Record<string, unknown>).autoShippedAt).toBe("string");
  });

  it("awaitingCollection first (the scan was missed): shipped the same way", async () => {
    const o = await orderWith();
    await hook(o, "awaitingCollection");
    expect(await statusOf(o.id)).toBe("shipped");
    expect(letters.shipped).toHaveLength(1);
  });

  it("the same event again, and the next word after it: nothing more", async () => {
    const o = await orderWith();
    await hook(o, "inTransit");
    const again = await hook(o, "inTransit");
    expect(again.body.shipped).toBeUndefined();
    await hook(o, "awaitingCollection");
    expect(await statusOf(o.id)).toBe("shipped");
    expect(letters.shipped).toHaveLength(1);
    expect(await statusRows(o.number)).toHaveLength(1);
  });

  it("delivered as the first word: shipped, then delivered — one letter, two steps in order", async () => {
    const o = await orderWith();
    const r = await hook(o, "delivered");
    expect(r.body).toMatchObject({ shipped: true, applied: "delivered" });
    expect(await statusOf(o.id)).toBe("delivered");
    expect(letters.shipped).toHaveLength(1);
    const rows = await statusRows(o.number);
    expect(rows.map((x) => `${x.payload.from}→${x.payload.to}`)).toEqual(["paid→shipped", "shipped→delivered"]);
    // …and a retry of it moves nothing and writes nothing
    await hook(o, "delivered");
    expect(await statusRows(o.number)).toHaveLength(2);
    expect(letters.shipped).toHaveLength(1);
  });

  it("R-100098: the parcel the order had no id for is recorded AND shipped by the same event", async () => {
    const o = await orderWith({ montonio: null });
    const r = await hook(o, "inTransit", { shippingMethod: { type: "pickupPoint", carrierCode: "dpd", countryCode: "EE" } });
    expect(r.body).toMatchObject({ adopted: true, shipped: true });
    expect(await statusOf(o.id)).toBe("shipped");
    expect(letters.shipped).toHaveLength(1);
  });

  it("a word that does not mean the carrier has it moves nothing", async () => {
    for (const word of ["pending", "registered", "labelsCreated", "registrationFailed", "something_new", "in_transit", "completed"]) {
      const o = await orderWith();
      await hook(o, word);
      expect(await statusOf(o.id), word).toBe("paid");
    }
    expect(letters.shipped).toEqual([]);
  });

  it("a stored inTransit is enough: a late older word on a paid order still ships it (the state, not the change)", async () => {
    const o = await orderWith({ montonio: { status: "inTransit" } });
    const r = await hook(o, "registered");
    expect(r.body.stale).toBe(true);
    expect(await statusOf(o.id)).toBe("shipped");
    expect(letters.shipped).toHaveLength(1);
  });
});

describe("the nightly re-ask ships what the webhook missed", () => {
  it("a paid order whose parcel Montonio now calls inTransit: shipped, one letter", async () => {
    const o = await orderWith({ montonio: { statusAt: ago(20) } });
    const run = await poll({ [o.shipmentId]: { status: "inTransit" } });
    expect(run).toMatchObject({ checked: 1, shipped: 1 });
    expect(await statusOf(o.id)).toBe("shipped");
    expect(letters.shipped).toHaveLength(1);
    expect((await statusRows(o.number))[0].payload).toMatchObject({ via: "carrier", source: "poll" });
  });

  it("R-100098 after the deploy: inTransit already stored, order still paid — the next run ships it", async () => {
    const o = await orderWith({ montonio: { status: "inTransit", statusAt: ago(14) } });
    const run = await poll({ [o.shipmentId]: { status: "inTransit" } });
    expect(run).toMatchObject({ checked: 1, shipped: 1, changed: 0 });
    expect(await statusOf(o.id)).toBe("shipped");
    expect(letters.shipped).toHaveLength(1);
  });

  it("…and if `delivered` arrived before the deploy, the run still takes it: shipped, then delivered", async () => {
    const o = await orderWith({ montonio: { status: "delivered", statusAt: ago(14) } });
    const run = await poll({ [o.shipmentId]: { status: "delivered" } });
    expect(run).toMatchObject({ checked: 1, shipped: 1, closed: 1 });
    expect(await statusOf(o.id)).toBe("delivered");
    expect(letters.shipped).toHaveLength(1);
  });

  it("a delivered parcel on an order already closed, or taken back by hand, is not asked about again", async () => {
    await orderWith({ status: "shipped", montonio: { status: "delivered", statusAt: ago(14) } });
    await orderWith({ montonio: { status: "delivered", statusAt: ago(14) }, shipping: { shippedAt: ago(50) } });
    const run = await poll({});
    expect(run.checked).toBe(0);
  });

  it("the webhook and the poll racing: one transition, one letter", async () => {
    const o = await orderWith({ montonio: { statusAt: ago(20) } });
    await Promise.all([hook(o, "inTransit"), poll({ [o.shipmentId]: { status: "inTransit" } })]);
    expect(await statusOf(o.id)).toBe("shipped");
    expect(letters.shipped).toHaveLength(1);
    expect(await statusRows(o.number)).toHaveLength(1);
  });

  it("two copies of the same event at once: one transition, one letter", async () => {
    const o = await orderWith();
    const order = (await getOrder(o.id))!;
    const results = await Promise.all([
      applyShipmentUpdate(order, { status: "inTransit", shipmentId: o.shipmentId }, { source: "webhook" }),
      applyShipmentUpdate(order, { status: "inTransit", shipmentId: o.shipmentId }, { source: "webhook" }),
    ]);
    expect(results.filter((x) => x.shipped)).toHaveLength(1);
    expect(letters.shipped).toHaveLength(1);
    expect(await statusRows(o.number)).toHaveLength(1);
  });
});

describe("the owner's press and the scan", () => {
  it("pressed first: the scan later changes nothing and sends nothing", async () => {
    const o = await orderWith();
    const p = await press(o.id, "shipped");
    expect(p.status).toBe(200);
    expect(letters.shipped).toHaveLength(1);
    await hook(o, "inTransit");
    await hook(o, "awaitingCollection");
    expect(await statusOf(o.id)).toBe("shipped");
    expect(letters.shipped).toHaveLength(1);
    expect((await statusRows(o.number)).map((x) => x.actor)).toEqual(["admin"]);
  });

  it("scanned first: the press later finds it «Отправлен» and sends nothing", async () => {
    const o = await orderWith();
    await hook(o, "inTransit");
    const p = await press(o.id, "shipped");
    expect(p.status).toBe(200);
    expect(p.body.letter).toBeUndefined();
    expect(letters.shipped).toHaveLength(1);
    expect(await statusRows(o.number)).toHaveLength(1);
  });

  it("pressed, then taken back by hand: the scan leaves the owner's decision alone", async () => {
    const o = await orderWith();
    await press(o.id, "shipped");
    await press(o.id, "paid");
    expect(await statusOf(o.id)).toBe("paid");
    const r = await hook(o, "inTransit");
    expect(r.body.shipped).toBeUndefined();
    expect(await statusOf(o.id)).toBe("paid");
    expect(letters.shipped).toHaveLength(1);
  });

  it("the press on a card read before the scan landed: no second letter, and the order is not pulled back", async () => {
    const o = await orderWith();
    await hook(o, "delivered");
    expect(await statusOf(o.id)).toBe("delivered");
    const { shipOrder } = await import("@/lib/ship-order");
    // the owner's phone still showed «оплачен»
    const out = await shipOrder({ id: o.id, status: "paid" }, { actor: "admin", hold: true });
    await lettersSettled();
    expect(out.order).toBeNull();
    expect(await statusOf(o.id)).toBe("delivered");
    expect(letters.shipped).toHaveLength(1);
  });
});

describe("orders the scan does not ship", () => {
  it("new, held, already shipped or delivered: no change, no letter, no alert", async () => {
    const orders = [
      await orderWith({ status: "new" }),
      await orderWith({ status: "failed" }),
      await orderWith({ status: "shipped", shipping: { shippedAt: ago(20) } }),
      await orderWith({ status: "delivered" }),
    ];
    await query(`update orders set payment = '{"held": true, "status": "held"}'::jsonb where id = $1`, [orders[0].id]);
    for (const o of orders) await hook(o, "inTransit");
    expect(await Promise.all(orders.map((o) => statusOf(o.id)))).toEqual(["new", "failed", "shipped", "delivered"]);
    expect(letters.shipped).toEqual([]);
    expect(push.sent).toEqual([]);
  });

  it("a label the journal set aside: nothing", async () => {
    const o = await orderWith({ montonio: { dismissed: true } });
    await hook(o, "inTransit");
    expect(await statusOf(o.id)).toBe("paid");
    expect(letters.shipped).toEqual([]);
  });

  it("salon pickup, and an order with no Montonio parcel that the event does not name: nothing", async () => {
    const pickup = await orderWith({ montonio: null, shipping: { method: "pickup" } });
    await applyShipmentUpdate((await getOrder(pickup.id))!, { status: "inTransit" }, { source: "webhook" });
    const bare = await orderWith({ montonio: null });
    await applyShipmentUpdate((await getOrder(bare.id))!, { status: "delivered" }, { source: "webhook" });
    expect(await statusOf(pickup.id)).toBe("paid");
    expect(await statusOf(bare.id)).toBe("paid");
    expect(letters.shipped).toEqual([]);
  });

  it("cancelled: the order stays cancelled, Renat is told once, the journal says so once", async () => {
    const o = await orderWith({ status: "cancelled" });
    await hook(o, "inTransit");
    await hook(o, "inTransit");
    await hook(o, "awaitingCollection");
    expect(await statusOf(o.id)).toBe("cancelled");
    expect(letters.shipped).toEqual([]);
    expect(push.sent.map((m) => m.title)).toEqual([`📦 Посылка едет по отменённому заказу: ${o.number}`]);
    const rows = await journal("shipment.closed_moving");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "system", payload: { number: o.number, shipmentId: o.shipmentId, orderStatus: "cancelled", code: "inTransit" } });
  });

  it("refunded: the same, in its own words", async () => {
    const o = await orderWith({ status: "refunded" });
    await hook(o, "delivered");
    expect(await statusOf(o.id)).toBe("refunded");
    expect(push.sent.map((m) => m.title)).toEqual([`📦 Посылка едет по заказу с возвратом денег: ${o.number}`]);
  });

  it("cancelled with a parcel that has not moved: no alert", async () => {
    const o = await orderWith({ status: "cancelled" });
    await hook(o, "registered");
    expect(push.sent).toEqual([]);
    expect(await journal("shipment.closed_moving")).toHaveLength(0);
  });
});
