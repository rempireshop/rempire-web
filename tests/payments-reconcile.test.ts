/**
 * The lost-webhook sweep — Dim's decision of 18.09.2026.
 *
 * Nothing in this shop ever asked Montonio what it thought. Every belief about
 * a payment arrived pushed at it, and when a notification is lost the money is
 * gone, the order sits at «ждёт оплаты» for ever and the first anybody hears
 * of it is the customer. At three to five orders a month a nightly sweep costs
 * almost nothing, and it is the only option that works while Renat is asleep.
 *
 * What is proved here, in order of how much it would cost to get wrong:
 *
 *   · it settles through the SAME door a webhook does — one settlement path,
 *     with its claim on the row, its gift cards, its stock and its letter;
 *   · it settles only what Montonio itself calls paid;
 *   · it is idempotent, so a second run and a webhook that lands mid-sweep
 *     cost one settlement between them;
 *   · and a short payment found by the sweep is HELD, exactly as it would
 *     have been had the webhook arrived.
 *
 * Real Postgres (PGlite); Montonio is a stand-in with a scripted `fetchOrder`,
 * because a lost webhook is the one thing no sandbox will ever produce.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { getLevel, move } from "@/lib/inventory";
import { capturedMail } from "@/lib/mail";
import { createOrder, getOrder, setOrderPayment, setOrderStatus, type Order } from "@/lib/orders";
import type { MontonioOrderSnapshot } from "@/lib/payments/montonio";
import {
  MIN_AGE_MINUTES,
  ordersToAsk,
  reconcileUnpaidOrders,
} from "@/lib/payments/reconcile";
import type { PaymentProvider } from "@/lib/payments/types";
import { PRODUCT, setFuzzEnv } from "./fuzz-harness";
import { setupDb, teardownDb, truncateAll } from "./helpers";

let restoreEnv: () => void = () => {};

const CUSTOMER = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };

function snapshot(over: Partial<MontonioOrderSnapshot> = {}): MontonioOrderSnapshot {
  return {
    uuid: "montonio-uuid-1",
    paymentStatus: "PAID",
    grandTotal: 0,
    currency: "EUR",
    availableForRefund: 0,
    refunds: [],
    ...over,
  };
}

/** Montonio, scripted per uuid. Anything else it has never heard of. */
function montonio(answers: Record<string, MontonioOrderSnapshot | null>) {
  const fetchOrder = vi.fn(async (uuid: string) => answers[uuid] ?? null);
  const provider = {
    name: "montonio",
    createPayment: async () => {
      throw new Error("not used");
    },
    verifyReturn: async () => {
      throw new Error("not used");
    },
    verifyNotification: async () => {
      throw new Error("not used");
    },
    fetchOrder,
  } as unknown as PaymentProvider;
  return { provider, fetchOrder };
}

async function place(qty = 2): Promise<Order> {
  return createOrder({
    lang: "RU",
    items: [{ id: PRODUCT.id, qty }],
    customer: CUSTOMER,
    shipping: { method: "pickup", country: "EE" },
  }) as unknown as Promise<Order>;
}

/**
 * An order as the shop leaves it when the webhook never arrives: a Montonio
 * uuid recorded by POST /api/payments/create/, and nothing after it. Aged past
 * the sweep's window, because the shopper standing at the bank right now is
 * not what this job is for.
 */
async function stranded(ref: string, ageMinutes = MIN_AGE_MINUTES + 15): Promise<Order> {
  const order = await place();
  await setOrderPayment(order.id, { ref, status: "pending", method: "bank" });
  await age(order.id, ageMinutes);
  return (await getOrder(order.id))!;
}

/** Backdate an order — the sweep only looks at ones old enough to be over. */
async function age(id: string, minutes: number): Promise<void> {
  await query("update orders set created_at = now() - ($1 || ' minutes')::interval where id = $2", [
    String(Math.round(minutes)),
    id,
  ]);
}

function letters(template: string): number {
  return capturedMail().filter((m) => m.template === template).length;
}

async function auditActions(): Promise<string[]> {
  const rows = await query<{ action: string }>(
    "select action from admin_audit order by id",
  );
  return rows.map((r) => r.action);
}

describe("asking Montonio about orders that never came back", () => {
  beforeAll(async () => {
    restoreEnv = setFuzzEnv();
    process.env.E2E_BOOTSTRAP = "1";
    delete process.env.RESEND_API_KEY;
    await setupDb();
  });
  afterAll(async () => {
    restoreEnv();
    await teardownDb();
  });
  beforeEach(async () => {
    await truncateAll();
    (globalThis as unknown as { __rempireMailSink?: unknown[] }).__rempireMailSink = [];
    await move({ productId: PRODUCT.id, delta: 10, reason: "goods_in", actor: "test" });
  });

  it("settles an order Montonio says was paid, through the ordinary door", async () => {
    const order = await stranded("montonio-uuid-1");
    const { provider } = montonio({
      "montonio-uuid-1": snapshot({ grandTotal: Number(order.total) }),
    });

    const report = await reconcileUnpaidOrders({ provider });

    expect(report).toMatchObject({ checked: 1, settled: 1, numbers: [order.number] });
    const fresh = (await getOrder(order.id))!;
    expect(fresh.status).toBe("paid");
    // everything that hangs off the single transition into paid ran, once
    expect((await getLevel(PRODUCT.id, ""))?.qty).toBe(8);
    expect(letters("order-confirmed")).toBe(1);
    expect(await auditActions()).toContain("order.payment_recovered");
  });

  it("leaves an order Montonio has not been paid for exactly where it was", async () => {
    const order = await stranded("montonio-uuid-1");
    const { provider } = montonio({ "montonio-uuid-1": snapshot({ paymentStatus: "PENDING" }) });

    const report = await reconcileUnpaidOrders({ provider });

    expect(report).toMatchObject({ checked: 1, settled: 0, unpaid: 1 });
    expect((await getOrder(order.id))?.status).toBe("new");
    expect(letters("order-confirmed")).toBe(0);
  });

  it("decides nothing when Montonio does not answer", async () => {
    const order = await stranded("montonio-uuid-1");
    const { provider } = montonio({ "montonio-uuid-1": null });

    const report = await reconcileUnpaidOrders({ provider });

    expect(report).toMatchObject({ settled: 0, unknown: 1 });
    expect((await getOrder(order.id))?.status).toBe("new");
  });

  it("holds a short payment it finds, instead of fulfilling it", async () => {
    const order = await stranded("montonio-uuid-1");
    /* `grandTotal` is what Montonio actually charged, and its own help centre
       warns that reusing an order can lower it — which is the whole underpay
       case. The sweep must not paper over it. */
    const { provider } = montonio({
      "montonio-uuid-1": snapshot({ grandTotal: Number(order.total) - 10 }),
    });

    const report = await reconcileUnpaidOrders({ provider });

    expect(report.settled).toBe(0);
    const fresh = (await getOrder(order.id))!;
    expect(fresh.status).toBe("new");
    expect(fresh.payment).toMatchObject({ held: { reason: "underpaid", shortfall: 10 } });
    expect((await getLevel(PRODUCT.id, ""))?.qty).toBe(10);
    expect(await auditActions()).toContain("order.payment_held");
  });

  it("never asks about the same held order twice", async () => {
    const order = await stranded("montonio-uuid-1");
    const { provider, fetchOrder } = montonio({
      "montonio-uuid-1": snapshot({ grandTotal: Number(order.total) - 10 }),
    });

    await reconcileUnpaidOrders({ provider });
    await age(order.id, 120);
    await reconcileUnpaidOrders({ provider });

    // it is not waiting for news from Montonio any more; it is waiting for Renat
    expect(fetchOrder).toHaveBeenCalledTimes(1);
    expect(await ordersToAsk()).toEqual([]);
  });

  it("settles once when it runs twice", async () => {
    const order = await stranded("montonio-uuid-1");
    const { provider } = montonio({
      "montonio-uuid-1": snapshot({ grandTotal: Number(order.total) }),
    });

    const first = await reconcileUnpaidOrders({ provider });
    const second = await reconcileUnpaidOrders({ provider });

    expect(first.settled).toBe(1);
    expect(second).toMatchObject({ checked: 0, settled: 0 });
    expect((await getLevel(PRODUCT.id, ""))?.qty).toBe(8);
    expect(letters("order-confirmed")).toBe(1);
  });

  it("does not drag a cancelled or a refunded order back into paid", async () => {
    const order = await stranded("montonio-uuid-1");
    await setOrderStatus(order.id, "cancelled", "admin");
    const { provider, fetchOrder } = montonio({
      "montonio-uuid-1": snapshot({ grandTotal: Number(order.total) }),
    });

    const report = await reconcileUnpaidOrders({ provider });

    expect(report.checked).toBe(0);
    expect(fetchOrder).not.toHaveBeenCalled();
    expect((await getOrder(order.id))?.status).toBe("cancelled");
  });

  it("leaves a shopper who is still standing at the bank alone", async () => {
    await stranded("montonio-uuid-1", 5);
    const { provider, fetchOrder } = montonio({ "montonio-uuid-1": snapshot() });

    const report = await reconcileUnpaidOrders({ provider });

    expect(report.checked).toBe(0);
    expect(fetchOrder).not.toHaveBeenCalled();
  });

  it("stops asking about last month's abandoned baskets", async () => {
    await stranded("montonio-uuid-1", 40 * 24 * 60);
    const { provider } = montonio({ "montonio-uuid-1": snapshot() });
    expect((await reconcileUnpaidOrders({ provider })).checked).toBe(0);
  });

  it("has nothing to ask with when the order carries no Montonio uuid", async () => {
    const order = await place();
    await age(order.id, 200);
    const { provider, fetchOrder } = montonio({});
    expect((await reconcileUnpaidOrders({ provider })).checked).toBe(0);
    expect(fetchOrder).not.toHaveBeenCalled();
  });

  it("calls a paid-and-already-refunded order a story for a human, not a settlement", async () => {
    const order = await stranded("montonio-uuid-1");
    const { provider } = montonio({
      "montonio-uuid-1": snapshot({
        paymentStatus: "REFUNDED",
        grandTotal: Number(order.total),
      }),
    });

    const report = await reconcileUnpaidOrders({ provider });

    expect(report).toMatchObject({ settled: 0, odd: 1 });
    expect((await getOrder(order.id))?.status).toBe("new");
    expect(await auditActions()).toContain("order.payment_odd");
  });

  it("sweeps nothing when the shop has a provider that cannot be asked", async () => {
    await stranded("montonio-uuid-1");
    const mute = {
      name: "mock",
      createPayment: async () => {
        throw new Error("not used");
      },
      verifyReturn: async () => {
        throw new Error("not used");
      },
      verifyNotification: async () => {
        throw new Error("not used");
      },
    } as unknown as PaymentProvider;

    expect(await reconcileUnpaidOrders({ provider: mute })).toMatchObject({
      skipped: "provider_cannot_ask",
      settled: 0,
    });
  });
});
