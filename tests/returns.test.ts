/**
 * «Хочу вернуть заказ» — the tick a customer puts on a delivered order.
 *
 * The bugs this file exists to catch are the ones that would make the tick a
 * lie: a window that closes before the 30 days /shop2/info/returns/ promises,
 * a tick anybody can put on somebody else's order, a second tap that moves the
 * date the owner is looking at, and a delivery date that drifts because the
 * owner typed a note a month later.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { resetRateLimits } from "@/lib/auth";
import { CUSTOMER_COOKIE, listCustomerOrders, makeCustomerToken } from "@/lib/customers";
import { exec, query } from "@/lib/db";
import { createOrder, getOrder, setOrderNote, setOrderStatus } from "@/lib/orders";
import {
  RETURN_WINDOW_DAYS,
  canRequestReturn,
  deliveredAt,
  recordReturnRequest,
  returnRequestedAt,
  returnWindowEnds,
} from "@/lib/returns";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

type Min = { id: string; s: string };
const PRODUCT = (catalogueMin as Min[]).find((p) => p.s === "in")!.id;

const BUYER = "shopper@example.com";
const OTHER = "somebody-else@example.com";
const DAY_MS = 86_400_000;

async function placedFor(email: string) {
  return createOrder({
    lang: "ru",
    items: [{ id: PRODUCT, qty: 1 }],
    customer: { name: "Мария Тамм", email, phone: "+372 5555 5555" },
    shipping: { method: "parcel", country: "EE" },
  });
}

/** An order that has been through the whole flow to «Доставлен». */
async function delivered(email = BUYER) {
  const o = await placedFor(email);
  await setOrderStatus(o.id, "paid");
  await setOrderStatus(o.id, "shipped");
  await setOrderStatus(o.id, "delivered");
  return (await getOrder(o.id))!;
}

/** Moves the hand-over into the past without touching anything else. */
async function deliveredDaysAgo(orderId: string, days: number) {
  await query(
    `update orders set shipping = shipping || jsonb_build_object('deliveredAt', $2::text) where id = $1`,
    [orderId, new Date(Date.now() - days * DAY_MS).toISOString()],
  );
  return (await getOrder(orderId))!;
}

function post(body: unknown, cookieEmail: string | null = BUYER) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookieEmail) headers.cookie = `${CUSTOMER_COOKIE}=${makeCustomerToken(cookieEmail)}`;
  return new Request("https://rempireshop.com/api/account/return-request/", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  await setupDb();
});
afterAll(teardownDb);
beforeEach(async () => {
  resetRateLimits();
  await exec("truncate orders, admin_audit, stock_levels, stock_moves restart identity cascade");
});

describe("the delivery stamp the window is counted from", () => {
  it("is written the first time «Доставлен» is pressed", async () => {
    const order = await delivered();
    const stamped = (order.shipping as unknown as { deliveredAt?: string }).deliveredAt;
    expect(stamped).toBeTruthy();
    expect(deliveredAt(order)).toBe(new Date(stamped!).toISOString());
  });

  it("does not move when the step is undone and pressed again, or when a note is typed", async () => {
    const order = await delivered();
    const first = deliveredAt(order);

    await setOrderStatus(order.id, "shipped");
    await setOrderStatus(order.id, "delivered");
    await setOrderNote(order.id, "клиент звонил");
    const again = (await getOrder(order.id))!;

    expect(deliveredAt(again)).toBe(first);
    // …and `updated_at` did move, which is exactly why it cannot be the stamp
    expect(new Date(again.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(first!).getTime());
  });

  it("falls back to updated_at on an order delivered before the stamp existed", async () => {
    const order = await delivered();
    await query("update orders set shipping = shipping - 'deliveredAt' where id = $1", [order.id]);
    const old = (await getOrder(order.id))!;
    expect((old.shipping as unknown as { deliveredAt?: string }).deliveredAt).toBeUndefined();
    expect(deliveredAt(old)).toBe(new Date(old.updatedAt).toISOString());
  });
});

describe("the window /info/returns/ promises", () => {
  it("is the 30 days the page states, counted from the hand-over", async () => {
    expect(RETURN_WINDOW_DAYS).toBe(30);
    const order = await delivered();
    const ends = new Date(returnWindowEnds(order)!).getTime();
    expect(ends - new Date(deliveredAt(order)!).getTime()).toBe(30 * DAY_MS);
  });

  it("offers the tick on day 29 and not on day 31", async () => {
    const fresh = await delivered();
    expect(canRequestReturn(await deliveredDaysAgo(fresh.id, 29))).toBe(true);

    const stale = await delivered();
    expect(canRequestReturn(await deliveredDaysAgo(stale.id, 31))).toBe(false);
  });

  it("offers it on a delivered order only — not on one still on its way", async () => {
    const order = await placedFor(BUYER);
    await setOrderStatus(order.id, "paid");
    expect(canRequestReturn((await getOrder(order.id))!)).toBe(false);
    await setOrderStatus(order.id, "shipped");
    expect(canRequestReturn((await getOrder(order.id))!)).toBe(false);
    await setOrderStatus(order.id, "delivered");
    expect(canRequestReturn((await getOrder(order.id))!)).toBe(true);
  });
});

describe("recording the tick", () => {
  it("stores the date, and a second tick keeps the first one", async () => {
    const order = await delivered();
    const first = await recordReturnRequest(order, new Date("2026-09-08T10:00:00Z"));
    expect(first).toEqual({ ok: true, at: "2026-09-08T10:00:00.000Z", repeat: false });

    const again = (await getOrder(order.id))!;
    const second = await recordReturnRequest(again, new Date("2026-09-09T10:00:00Z"));
    expect(second).toEqual({ ok: true, at: "2026-09-08T10:00:00.000Z", repeat: true });
    expect(returnRequestedAt((await getOrder(order.id))!)).toBe("2026-09-08T10:00:00.000Z");
  });

  it("refuses an order that was never handed over, and one past the window", async () => {
    const paid = await placedFor(BUYER);
    await setOrderStatus(paid.id, "paid");
    expect(await recordReturnRequest((await getOrder(paid.id))!)).toEqual({ ok: false, error: "not_delivered" });

    const stale = await delivered();
    expect(await recordReturnRequest(await deliveredDaysAgo(stale.id, 31))).toEqual({
      ok: false,
      error: "window_closed",
    });
  });

  it("leaves the shipment on the order alone", async () => {
    const order = await delivered();
    await query(
      `update orders set shipping = shipping || jsonb_build_object('montonio', jsonb_build_object('shipmentId', 'sh_1'))
        where id = $1`,
      [order.id],
    );
    await recordReturnRequest((await getOrder(order.id))!);
    const after = (await getOrder(order.id))! as unknown as {
      shipping: { montonio?: { shipmentId?: string }; method?: string; returnRequest?: { at?: string } };
    };
    expect(after.shipping.montonio?.shipmentId).toBe("sh_1");
    expect(after.shipping.method).toBe("parcel");
    expect(after.shipping.returnRequest?.at).toBeTruthy();
  });
});

describe("POST /api/account/return-request", () => {
  it("turns away a guest", async () => {
    const { POST } = await import("@/app/api/account/return-request/route");
    const order = await delivered();
    const res = await POST(post({ number: order.number }, null));
    expect(res.status).toBe(401);
    expect(returnRequestedAt((await getOrder(order.id))!)).toBeNull();
  });

  it("answers «not_found» for somebody else's order, and writes nothing", async () => {
    const { POST } = await import("@/app/api/account/return-request/route");
    const order = await delivered(OTHER);
    const res = await POST(post({ number: order.number }, BUYER));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: "not_found" });
    expect(returnRequestedAt((await getOrder(order.id))!)).toBeNull();
  });

  it("records the tick, logs it once, and says so on the account screen", async () => {
    const { POST } = await import("@/app/api/account/return-request/route");
    const order = await delivered();

    const before = await listCustomerOrders(BUYER);
    expect(before[0].returnable).toBe(true);
    expect(before[0].returnRequestedAt).toBeNull();

    const res = await POST(post({ number: order.number }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; at: string };
    expect(body.ok).toBe(true);
    expect(new Date(body.at).getTime()).toBeGreaterThan(0);

    const after = await listCustomerOrders(BUYER);
    expect(after[0].returnRequestedAt).toBe(body.at);
    // …and the tick is not offered twice
    expect(after[0].returnable).toBe(false);

    // the journal names the customer, not an admin — nobody in the panel did this
    const log = await query<{ actor: string; action: string; payload: { number: string } }>(
      "select actor, action, payload from admin_audit where action = 'order.return_request'",
    );
    expect(log).toHaveLength(1);
    expect(log[0].actor).toBe(BUYER);
    expect(log[0].payload.number).toBe(order.number);

    // a second tap changes neither the date nor the journal
    const twice = await POST(post({ number: order.number }));
    expect(twice.status).toBe(200);
    expect((await twice.json()).at).toBe(body.at);
    expect(
      await query("select 1 from admin_audit where action = 'order.return_request'"),
    ).toHaveLength(1);
  });

  it("refuses an order that has not been delivered", async () => {
    const { POST } = await import("@/app/api/account/return-request/route");
    const order = await placedFor(BUYER);
    await setOrderStatus(order.id, "paid");
    const res = await POST(post({ number: order.number }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "not_delivered" });
  });

  it("refuses a body with no order number", async () => {
    const { POST } = await import("@/app/api/account/return-request/route");
    const res = await POST(post({}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "bad_order" });
  });
});
