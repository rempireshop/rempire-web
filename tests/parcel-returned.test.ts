/**
 * A parcel nobody collected — readiness pass of 27.09.2026, B14.
 *
 * The carriers hold a parcel for their own window (Omniva 4 days, SmartPosti
 * and DPD 7, …) and then send it back to the shop, and Montonio's word for it
 * is `returned`. Until now that was silent: the order stayed «Отправлен», the
 * nightly close counted it in the cron's JSON (`delivered.returned`) and left
 * it, and the one line the cron writes to Vercel's log did not even carry the
 * count. Now, whoever brings the news — the webhook, the nightly poll, the
 * nightly close — it is:
 *   · a journal row `shipment.returned`, once per parcel;
 *   · through that row, a ping on Renat's phone (src/lib/owner-alerts.ts);
 *   · the word on the order, so the card can say it (tests/admin-parcel-
 *     nudge.test.ts reads the card);
 *   · a count in the morning's log line, beside «delivered» and the payment
 *     sweep.
 * The order's status is never moved.
 *
 * Real Postgres (PGlite); Montonio's GET is a stub; the push is mocked.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exec, query } from "@/lib/db";
import { getOrder, setSetting, type Order } from "@/lib/orders";
import { closeDeliveredOrders } from "@/lib/delivery";
import { applyShipmentUpdate } from "@/lib/shipping/shipment-sync";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const carrier = vi.hoisted(() => ({ status: "returned", asked: [] as string[] }));
vi.mock("@/lib/shipping/montonio", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/shipping/montonio")>();
  return {
    ...real,
    getMontonioShipment: async (id: string) => {
      carrier.asked.push(id);
      return {
        provider: "montonio" as const, shipmentId: id, status: carrier.status, carrier: "omniva", country: "EE",
        method: "pickupPoint" as const, trackingCode: "", trackingUrl: "", dropOffPin: "", createdAt: "", merchantReference: "",
      };
    },
  };
});
const push = vi.hoisted(() => ({ sent: [] as Array<{ title: string; body: string }> }));
vi.mock("@/lib/push", () => ({
  sendPush: async (msg: { title: string; body: string }) => {
    push.sent.push(msg);
    return { ok: true, configured: true, devices: 1, sent: 1, failed: 0, gone: 0 };
  },
}));

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

async function shippedOrder(montonio: Record<string, unknown>, shippedDaysAgo = 9): Promise<Order> {
  seq += 1;
  const rows = await query<{ id: string }>(
    `insert into orders (number, email, name, status, shipping)
     values ($1, 'buyer@example.com', 'Тест', 'shipped', $2::jsonb) returning id`,
    [
      `R-4000${String(seq).padStart(2, "0")}`,
      JSON.stringify({
        method: "parcel",
        country: "EE",
        shippedAt: new Date(Date.now() - shippedDaysAgo * DAY).toISOString(),
        montonio: { provider: "montonio", shipmentId: `shp-back-${seq}`, carrier: "omniva", status: "awaitingCollection", ...montonio },
      }),
    ],
  );
  return (await getOrder(rows[0].id))!;
}
const journal = () =>
  query<{ actor: string; payload: Record<string, unknown> }>(
    "select actor, payload from admin_audit where action = 'shipment.returned' order by id",
  );
const montonioOf = async (id: string) =>
  (await query<{ m: Record<string, unknown> }>("select shipping->'montonio' as m from orders where id = $1", [id]))[0].m;
const statusOf = async (id: string) => (await query<{ status: string }>("select status from orders where id = $1", [id]))[0].status;

beforeAll(setupDb);
afterAll(teardownDb);
beforeEach(async () => {
  await truncateAll();
  await exec("truncate owner_alerts");
  carrier.status = "returned";
  carrier.asked.length = 0;
  push.sent.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("a returned parcel is said out loud, once", () => {
  it("by webhook: a journal row and a ping; the retry writes nothing; the order stays «Отправлен»", async () => {
    const order = await shippedOrder({});
    const sid = String((order.shipping as unknown as { montonio: { shipmentId: string } }).montonio.shipmentId);
    const first = await applyShipmentUpdate(order, { status: "returned", shipmentId: sid, event: "shipment.statusUpdated" }, { source: "webhook" });
    expect(first.returned).toBe(true);
    const again = await applyShipmentUpdate((await getOrder(order.id))!, { status: "returned", shipmentId: sid }, { source: "webhook" });
    expect(again.returned).toBe(false);

    const rows = await journal();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "system", payload: { number: order.number, shipmentId: sid, carrier: "omniva", orderStatus: "shipped" } });
    expect(push.sent.map((m) => m.title)).toEqual([`📦 Посылка возвращается: ${order.number}`]);
    expect(await statusOf(order.id)).toBe("shipped");
    expect((await montonioOf(order.id)).status).toBe("returned");
  });

  it("a late `awaitingCollection` after it does not un-return it, and journals nothing", async () => {
    const order = await shippedOrder({ status: "returned" });
    const sid = String((order.shipping as unknown as { montonio: { shipmentId: string } }).montonio.shipmentId);
    const late = await applyShipmentUpdate(order, { status: "awaitingCollection", shipmentId: sid }, { source: "webhook" });
    expect(late.stale).toBe(true);
    expect((await montonioOf(order.id)).status).toBe("returned");
    expect(await journal()).toHaveLength(0);
  });

  /* The nightly close (src/lib/delivery.ts) asks Montonio about every shipped
     order; a parcel coming back was a number in the JSON and nothing more. */
  it("by the nightly close: recorded on the order and journalled — then quiet on the nights after", async () => {
    // «закрывать через 1 день» on: without the returned rule this order would be closed as delivered
    await setSetting("delivery", { autoDays: 1, useCarrier: true });
    const order = await shippedOrder({});
    const first = await closeDeliveredOrders();
    expect(first).toMatchObject({ closed: 0, returned: 1 });
    expect(await statusOf(order.id)).toBe("shipped");
    expect((await montonioOf(order.id)).status).toBe("returned");
    expect(await journal()).toHaveLength(1);
    expect(push.sent).toHaveLength(1);

    const second = await closeDeliveredOrders(Date.now() + DAY);
    expect(second).toMatchObject({ closed: 0, returned: 1 });
    expect(await journal()).toHaveLength(1);
    expect(push.sent).toHaveLength(1);
  });
});

describe("the morning's log line carries what the night did", () => {
  const saved: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const k of ["CRON_SECRET", "MONTONIO_ACCESS_KEY", "MONTONIO_SECRET_KEY", "PAYMENT_PROVIDER"]) saved[k] = process.env[k];
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("delivered, returned and the payment check, not only the letters", async () => {
    process.env.CRON_SECRET = "cron-secret-for-the-test";
    delete process.env.MONTONIO_ACCESS_KEY;
    delete process.env.MONTONIO_SECRET_KEY;
    delete process.env.PAYMENT_PROVIDER;
    await shippedOrder({});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { GET } = await import("@/app/api/cron/flows/route");
    const res = await GET(
      new Request("https://test.rempireshop.com/api/cron/flows/", { headers: { authorization: "Bearer cron-secret-for-the-test" } }),
    );
    expect(res.status).toBe(200);
    const line = info.mock.calls.map((c) => c.join(" ")).find((l) => l.includes("[api/cron/flows]")) ?? "";
    expect(line, "the cron wrote no summary line").not.toBe("");
    expect(line).toMatch(/shipments: checked 0, changed 0, refused 0, returned 0, closed 0, errors 0, left 0 \(not_configured\)/);
    expect(line).toMatch(/delivered: closed 0, checked 1, returned 1/);
    expect(line).toMatch(/payments: (skipped \(\w+\)|checked \d+, found paid \d+, odd \d+, no answer \d+)/);
    // counts and codes only — never an order number or an address
    expect(line).not.toMatch(/R-\d{6}|@/);
  });
});
