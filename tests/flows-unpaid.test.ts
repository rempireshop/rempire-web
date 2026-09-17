/**
 * The unpaid order's clock — `runUnpaidOrders()` in src/lib/flows.ts.
 *
 * Dim, 07.09.2026: «нужны напоминания, а через семь дней отменяем и
 * сообщаем.» Before this an order that reached the bank page and was never
 * paid sat in «новый» for ever: nobody wrote to the customer and nobody let
 * the order go. What is pinned here is which orders the two queries pick up
 * and — just as important — which they must never touch:
 *
 *   · the reminder goes once, after the interval in «Письма», and the stamp
 *     on the order is what stops a second copy every day after that;
 *   · the cancellation follows at its own interval, with a letter;
 *   · a paid order, an order taken at the till and an order already cancelled
 *     are all left alone;
 *   · the switch decides — a shop that has not asked for this sends nothing;
 *   · a reminder can never be scheduled after the cancellation, whatever the
 *     two settings say.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { getFlows, runFlows, runUnpaidOrders } from "@/lib/flows";
import { createOrder, getOrder, setOrderPayment, setOrderStatus, setSetting, type Order } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const PRODUCT = "system-4-bio-botanical-shampoo";
const DAY = 24 * 60 * 60 * 1000;

/** Every letter Resend was asked to send since the last reset. */
const sent: Array<{ subject: string; to: string[]; text: string }> = [];

/** Runs once, while the NEXT letter is in flight — the shop's clock does not
 *  stop while the cron walks its list, and this is how a test says so. */
let whileSending: (() => Promise<void>) | null = null;

const ORDER = {
  lang: "RU",
  items: [{ id: PRODUCT, qty: 1 }],
  customer: { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" },
  shipping: { method: "pickup", country: "EE" },
};

async function place(extra: Record<string, unknown> = {}): Promise<Order> {
  return (await createOrder({ ...ORDER, ...extra } as Parameters<typeof createOrder>[0])) as unknown as Order;
}

/** Backdates an order so the cron's cutoffs can see it. */
async function age(id: string, days: number): Promise<void> {
  await query("update orders set created_at = $2 where id = $1", [id, new Date(Date.now() - days * DAY).toISOString()]);
}

async function setFlows(value: Record<string, unknown>): Promise<void> {
  await setSetting("flows", value);
}

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.PUBLIC_BASE_URL = "https://rempireshop.com";
  await setupDb();
});

afterAll(async () => {
  delete process.env.RESEND_API_KEY;
  await teardownDb();
});

beforeEach(async () => {
  await truncateAll();
  sent.length = 0;
  whileSending = null;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { subject: string; to: string[]; text?: string };
    sent.push({ subject: body.subject, to: body.to, text: body.text ?? "" });
    if (whileSending) {
      const hook = whileSending;
      whileSending = null;
      await hook();
    }
    return new Response(JSON.stringify({ id: `msg_${sent.length}` }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("the switch and the two intervals", () => {
  it("does nothing at all until the owner asks for it", async () => {
    const order = await place();
    await age(order.id, 30);
    expect(await runUnpaidOrders()).toMatchObject({ sent: 0, cancelled: 0, reason: "disabled" });
    expect((await getOrder(order.id))!.status).toBe("new");
    expect(sent).toHaveLength(0);
  });

  it("reads the two day counts, clamps them, and never puts the reminder after the cancellation", async () => {
    await setFlows({ unpaid: true, unpaidRemindDays: 2, unpaidCancelDays: 10 });
    expect(await getFlows()).toMatchObject({ unpaid: true, unpaidRemindDays: 2, unpaidCancelDays: 10 });

    // a reminder that would arrive after the order is already gone is pulled back
    await setFlows({ unpaid: true, unpaidRemindDays: 9, unpaidCancelDays: 5 });
    expect(await getFlows()).toMatchObject({ unpaidRemindDays: 4, unpaidCancelDays: 5 });

    // nonsense falls back to Dim's answer: remind on the third day, cancel on the seventh
    await setFlows({ unpaid: true, unpaidRemindDays: "soon", unpaidCancelDays: 0 });
    expect(await getFlows()).toMatchObject({ unpaidRemindDays: 3, unpaidCancelDays: 7 });
  });
});

describe("the reminder", () => {
  beforeEach(async () => {
    await setFlows({ unpaid: true, unpaidRemindDays: 3, unpaidCancelDays: 7 });
  });

  it("goes once to an order old enough for it, and never again", async () => {
    const order = await place();
    await age(order.id, 4);

    const first = await runUnpaidOrders();
    expect(first).toMatchObject({ sent: 1, cancelled: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain(order.number);
    expect(sent[0].to).toEqual(["maria@example.com"]);
    /* The button goes to the screen that can pay this order again — carrying
       the order's country, because that screen draws one country's bank chips
       and a letter is opened in a browser that has never seen this shop's
       checkout (Ренат, R-100033, 17.09.2026). */
    expect(sent[0].text).toContain(
      `/shop2/done/?n=${order.number}&s=failed&o=${order.id}&c=EE`,
    );
    // …and it says how long THIS order really has left: cancelled on day 7,
    // reminded on day 4, so three days — not the four the settings imply
    expect(sent[0].text).toMatch(/ещё 3 дня/);

    const stamped = (await getOrder(order.id))!;
    expect((stamped.payment as { unpaidRemindedAt?: string }).unpaidRemindedAt).toBeTruthy();
    expect(stamped.status).toBe("new");

    // a cron that runs again the same day, or the next one, sends nothing
    expect(await runUnpaidOrders()).toMatchObject({ sent: 0, cancelled: 0 });
    expect(sent).toHaveLength(1);
  });

  it("leaves an order that is not old enough yet", async () => {
    const order = await place();
    await age(order.id, 2);
    expect(await runUnpaidOrders()).toMatchObject({ sent: 0, cancelled: 0 });
    expect((await getOrder(order.id))!.payment).toBeNull();
  });

  it("goes to an order the shopper cancelled at the bank too", async () => {
    const order = await place();
    await setOrderStatus(order.id, "failed", "test");
    await age(order.id, 4);
    expect(await runUnpaidOrders()).toMatchObject({ sent: 1 });
  });

  it("never goes to a paid order, a till sale or an order already cancelled", async () => {
    const paid = await place();
    await setOrderPayment(paid.id, { provider: "mock", ref: "r", status: "paid", at: new Date().toISOString() });
    await setOrderStatus(paid.id, "paid", "test");
    const till = await place({ channel: "pos" });
    const gone = await place();
    await setOrderStatus(gone.id, "cancelled", "test");
    for (const o of [paid, till, gone]) await age(o.id, 30);

    expect(await runUnpaidOrders()).toMatchObject({ sent: 0, cancelled: 0 });
    expect(sent).toHaveLength(0);
    expect((await getOrder(paid.id))!.status).toBe("paid");
    expect((await getOrder(till.id))!.status).toBe("new");
  });
});

describe("the cancellation", () => {
  beforeEach(async () => {
    await setFlows({ unpaid: true, unpaidRemindDays: 3, unpaidCancelDays: 7 });
  });

  it("lets the order go at seven days and tells the customer", async () => {
    const order = await place();
    await age(order.id, 8);

    const run = await runUnpaidOrders();
    expect(run.cancelled).toBe(1);
    expect(run.sent).toBe(1);

    const after = (await getOrder(order.id))!;
    expect(after.status).toBe("cancelled");
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain(order.number);
    expect(sent[0].text).toMatch(/не списаны|отменён/i);

    // and it stays gone — the status is its own stamp
    expect(await runUnpaidOrders()).toMatchObject({ sent: 0, cancelled: 0 });

    const rows = await query<{ actor: string }>(
      "select actor from admin_audit where action = 'order.status'",
    );
    expect(rows.map((r) => r.actor)).toContain("system:unpaid");
  });

  /* The cancel list is read ONCE and every letter after it takes its own trip
     to Resend, so the list is minutes old by the time the last row is reached
     — long enough for a bank to answer. Until the write was guarded
     («unless», src/lib/orders.ts) the order paid in the middle of the walk was
     overwritten with «отменён», and the customer who had just paid was told
     his order was gone. */
  it("leaves an order alone when the money lands in the middle of the walk", async () => {
    const first = await place();
    const second = await place();
    await age(first.id, 20);
    await age(second.id, 15); // younger, so `order by created_at` puts it second

    whileSending = async () => {
      await setOrderPayment(second.id, {
        provider: "mock", ref: "r", status: "paid", at: new Date().toISOString(),
      });
      await setOrderStatus(second.id, "paid", "test");
    };

    const run = await runUnpaidOrders();
    expect(run.cancelled).toBe(1);
    expect((await getOrder(first.id))!.status).toBe("cancelled");
    expect((await getOrder(second.id))!.status).toBe("paid");

    // one letter, and it is not the one that would have been a lie
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain(first.number);
    expect(sent.some((m) => m.subject.includes(second.number))).toBe(false);
  });

  it("does not send the reminder to an order that is already past the cancel day", async () => {
    const order = await place();
    await age(order.id, 20);
    const run = await runUnpaidOrders();
    // one letter, and it is the cancellation
    expect(run.cancelled).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/отменён/i);
  });

  it("an order that was reminded on day 4 is cancelled on day 8, with both letters", async () => {
    const order = await place();
    await age(order.id, 4);
    await runUnpaidOrders();
    expect(sent).toHaveLength(1);

    await age(order.id, 8);
    const run = await runUnpaidOrders();
    expect(run.cancelled).toBe(1);
    expect(sent).toHaveLength(2);
    expect(sent[0].subject).toMatch(/ждёт оплаты/i);
    expect(sent[1].subject).toMatch(/отменён/i);
    expect((await getOrder(order.id))!.status).toBe("cancelled");
  });
});

describe("the scheduler", () => {
  it("reports the unpaid branch beside the other three", async () => {
    await setFlows({ unpaid: true, unpaidRemindDays: 3, unpaidCancelDays: 7 });
    const order = await place();
    await age(order.id, 4);
    const report = await runFlows();
    expect(report.unpaid).toMatchObject({ sent: 1, cancelled: 0 });
    expect(report.abandoned).toBeTruthy();
    expect(typeof report.ms).toBe("number");
  });
});
