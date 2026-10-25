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
       checkout (Ренат, R-100033, 17.09.2026). In the order's language: the
       receipt is /ru/checkout/done since the URL move of 08.10.2026. */
    expect(sent[0].text).toContain(
      `/ru/checkout/done?n=${order.number}&s=failed&o=${order.id}&c=EE`,
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

  it("never goes to an order that was HELD for paying short — that customer did pay", async () => {
    /* A short payment is held rather than fulfilled (the owner's decision of
       18.09.2026): nothing ships, no gift card is minted, and the order keeps
       the status «новый» because nothing has happened to it yet. That status
       is one of the two this loop selects, so without a predicate of its own
       the shop would write «Заказ ждёт оплаты» to somebody whose money is
       sitting in Montonio, and then cancel the order under them a week later.
       Never seen only because this flow is switched off — and the decision of
       17.09.2026 is that it gets switched on. */
    const held = await place();
    await setOrderPayment(held.id, {
      provider: "montonio",
      ref: "held-1",
      status: "pending",
      at: new Date().toISOString(),
      held: { expected: 4990, got: 1000, currency: "EUR", reason: "short" },
    } as Parameters<typeof setOrderPayment>[1]);
    await age(held.id, 30);

    expect(await runUnpaidOrders()).toMatchObject({ sent: 0, cancelled: 0 });
    expect(sent).toHaveLength(0);
    expect((await getOrder(held.id))!.status).toBe("new");
  });

  /* …and a cancelled order stays cancelled when the bank's ticket finally
     turns up. Montonio marks an unfinished payment ABANDONED long after the
     shopper walked away — by then this order had been closed and the customer
     told so. The `failed` that ticket used to write is one of the two statuses
     this loop selects, so the shop went on to ask for the money anyway. */
  it("is not restarted by a late ABANDONED ticket on a cancelled order", async () => {
    const { settlePayment } = await import("@/lib/payments/settle");
    const order = await place();
    await setOrderStatus(order.id, "cancelled", "test");
    await age(order.id, 4);

    await settlePayment(
      (await getOrder(order.id))!,
      { orderRef: order.number, status: "failed", providerRef: "montonio-uuid-9", amount: 0, currency: "EUR", detail: "ABANDONED" },
      "montonio",
    );

    expect((await getOrder(order.id))!.status).toBe("cancelled");
    expect(await runUnpaidOrders()).toMatchObject({ sent: 0, cancelled: 0 });
    expect(sent).toHaveLength(0);
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

/* R-100107 → R-100108 and R-100110 → R-100111 (18. and 22.10.2026): back from
   the bank without paying, «Оплатить» again places a NEW order, and the
   customer paid that one within minutes. The first order then drew «Заказ ждёт
   оплаты» on day 3 — to a customer whose parcel had already arrived. Dim,
   25.10.2026: a paid order from the same e-mail within 24 hours means the
   purchase was finished; the unpaid one goes quietly. */
describe("paid on a second try", () => {
  const MIN = 60 * 1000;

  beforeEach(async () => {
    await setFlows({ unpaid: true, unpaidRemindDays: 3, unpaidCancelDays: 7 });
  });

  async function paidOrder(extra: Record<string, unknown> = {}): Promise<Order> {
    const o = await place(extra);
    await setOrderPayment(o.id, { provider: "mock", ref: `r-${o.number}`, status: "paid", at: new Date().toISOString() });
    await setOrderStatus(o.id, "paid", "test");
    return o;
  }

  it("cancels the unpaid order without a letter and names the paid one", async () => {
    const first = await place();
    const again = await paidOrder();
    await age(first.id, 4);
    await age(again.id, 4 - (5 * MIN) / DAY); // paid five minutes after the first

    const run = await runUnpaidOrders();
    expect(run).toMatchObject({ sent: 0, cancelled: 1, reordered: 1 });
    expect(sent).toHaveLength(0);

    const after = (await getOrder(first.id))!;
    expect(after.status).toBe("cancelled");
    expect((after.payment as { reorderedAs?: string }).reorderedAs).toBe(again.number);
    expect((await getOrder(again.id))!.status).toBe("paid");

    const audit = await query<{ actor: string; payload: { reason?: string; again?: string; number?: string } }>(
      "select actor, payload from admin_audit where action = 'order.status' and payload->>'reason' = 'reordered'",
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: "system:unpaid", payload: { again: again.number, number: first.number } });

    // nothing left for the next run to write about
    expect(await runUnpaidOrders()).toMatchObject({ sent: 0, cancelled: 0, reordered: 0 });
    expect(sent).toHaveLength(0);
  });

  it("does the same before the reminder day, and for an order the bank marked failed", async () => {
    const first = await place();
    await setOrderStatus(first.id, "failed", "test");
    const again = await paidOrder();
    await age(first.id, 1);
    await age(again.id, 1 - (40 * MIN) / DAY);

    expect(await runUnpaidOrders()).toMatchObject({ sent: 0, reordered: 1 });
    expect((await getOrder(first.id))!.status).toBe("cancelled");
  });

  it("keeps the reminder when the paid order came more than 24 hours later — another purchase", async () => {
    const first = await place();
    const later = await paidOrder();
    await age(first.id, 4);
    await age(later.id, 2);

    expect(await runUnpaidOrders()).toMatchObject({ sent: 1, cancelled: 0, reordered: 0 });
    expect(sent[0].subject).toContain(first.number);
    expect((await getOrder(first.id))!.status).toBe("new");
  });

  it("keeps the reminder when the paid order is somebody else's, or not paid at all", async () => {
    const first = await place();
    const other = await paidOrder({ customer: { ...ORDER.customer, email: "someone@example.com" } });
    const unpaidAgain = await place();
    await age(first.id, 4);
    await age(other.id, 4 - (5 * MIN) / DAY);
    await age(unpaidAgain.id, 4 - (10 * MIN) / DAY);

    const run = await runUnpaidOrders();
    expect(run).toMatchObject({ reordered: 0 });
    expect((await getOrder(first.id))!.status).toBe("new");
    expect(sent.some((m) => m.subject.includes(first.number))).toBe(true);
  });

  it("leaves an order alone while its payment may still be open at the bank", async () => {
    const first = await place();
    const again = await paidOrder();
    await age(first.id, 1 / 24); // an hour old
    await age(again.id, 1 / 48);

    expect(await runUnpaidOrders()).toMatchObject({ cancelled: 0, reordered: 0 });
    expect((await getOrder(first.id))!.status).toBe("new");
  });

  it("leaves an order whose payment the bank still holds open to the normal clock", async () => {
    const first = await place();
    await setOrderPayment(first.id, { provider: "montonio", ref: "open-1", status: "pending", at: new Date().toISOString() });
    const again = await paidOrder();
    await age(first.id, 1);
    await age(again.id, 1 - (5 * MIN) / DAY);

    expect(await runUnpaidOrders()).toMatchObject({ cancelled: 0, reordered: 0 });
    expect((await getOrder(first.id))!.status).toBe("new");
  });

  it("matches the e-mail whatever its case", async () => {
    const first = await place({ customer: { ...ORDER.customer, email: "Maria@Example.com" } });
    const again = await paidOrder();
    await age(first.id, 4);
    await age(again.id, 4 - MIN / DAY);

    expect(await runUnpaidOrders()).toMatchObject({ sent: 0, reordered: 1 });
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
