/**
 * The single transition into «оплачен», on a real database.
 *
 * Montonio fires two things for one payment — the shopper's redirect back to
 * the shop and the webhook — and retries the webhook for 48 hours. Both doors
 * read the order first and settle it afterwards (src/app/api/payments/return/
 * and .../notify/), so the shop has to be able to answer two questions that
 * `alreadyPaid` alone could not:
 *
 *   1. **two arrivals at once.** Both read `new`, both think they are the
 *      first. Without a conditional UPDATE both went on to spend the gift
 *      card, take the points, write the revenue row, decrement the shelf and
 *      mail the customer — twice, for one payment.
 *   2. **an arrival that died half-way.** The payment blob is written before
 *      the status (apply.ts), so a crash between them leaves an order whose
 *      payment says `paid` and whose status says `new`: no stock taken, no
 *      letter, no revenue row. Every retry used to stop at «already paid» and
 *      leave it there for ever, and no screen in the admin could recover it.
 *
 * Both are settled here by claimOrderPaid() (src/lib/orders.ts): the row comes
 * back only to the call that actually moved it.
 *
 * Real Postgres (PGlite); the mail sink stands in for the mailbox.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import { getLevel, listMoves, move } from "@/lib/inventory";
import { capturedMail } from "@/lib/mail";
import { claimOrderPaid, createOrder, getOrder, setOrderPayment, setOrderStatus, type Order } from "@/lib/orders";
import { settlePayment } from "@/lib/payments/settle";
import type { VerifyResult } from "@/lib/payments/types";
import { PRODUCT, setFuzzEnv } from "./fuzz-harness";
import { setupDb, teardownDb, truncateAll } from "./helpers";

let restoreEnv: () => void = () => {};

const CUSTOMER = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };

function ticket(order: Order, over: Partial<VerifyResult> = {}): VerifyResult {
  return {
    orderRef: order.number,
    status: "paid",
    providerRef: "montonio-uuid-1",
    amount: Number(order.total),
    currency: "EUR",
    ...over,
  };
}

async function place(qty = 2): Promise<Order> {
  return createOrder({
    lang: "RU",
    items: [{ id: PRODUCT.id, qty }],
    customer: CUSTOMER,
    shipping: { method: "pickup", country: "EE" },
  }) as unknown as Promise<Order>;
}

function paidLetters(): number {
  return capturedMail().filter((m) => m.template === "order-confirmed").length;
}

async function statusAudit(): Promise<string[]> {
  const rows = await query<{ payload: { from: string; to: string } }>(
    "select payload from admin_audit where action = 'order.status' order by id",
  );
  return rows.map((r) => `${r.payload.from}>${r.payload.to}`);
}

describe("one payment settles an order once", () => {
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
    // a counted shelf, or the sale move is skipped and proves nothing
    await move({ productId: PRODUCT.id, delta: 10, reason: "goods_in", actor: "test" });
  });

  it("the bank's return and the webhook racing on one order settle it once", async () => {
    const order = await place();
    // both doors read the order *before* either writes — the same snapshot,
    // which is exactly what the two routes hold
    const [a, b] = await Promise.all([
      settlePayment(order, ticket(order), "montonio"),
      settlePayment(order, ticket(order), "montonio"),
    ]);

    // one of them moved the order, the other found it already moved
    expect([a.alreadyPaid, b.alreadyPaid].sort()).toEqual([false, true]);
    expect((await getOrder(order.id))?.status).toBe("paid");

    // the shelf was taken once, the customer written to once, and the journal
    // has a single move into paid
    expect((await getLevel(PRODUCT.id, ""))?.qty).toBe(8);
    expect(await listMoves({ productId: PRODUCT.id, reason: "sale_web" })).toHaveLength(1);
    expect(paidLetters()).toBe(1);
    expect(await statusAudit()).toEqual(["new>paid"]);

    const revenue = await query<{ n: string }>(
      "select count(*)::text as n from events where type = 'purchase'",
    );
    expect(Number(revenue[0].n)).toBe(1);
  });

  it("finishes a settlement that died between the payment blob and the status", async () => {
    const order = await place();
    /* Exactly what apply.ts leaves behind when the process dies after
       setOrderPayment() and before setOrderStatus(): the money is recorded,
       the order never moved, nothing after it ran. */
    await setOrderPayment(order.id, {
      provider: "montonio",
      ref: "montonio-uuid-1",
      status: "paid",
      amount: Number(order.total),
      currency: "EUR",
      at: new Date().toISOString(),
    });
    const half = (await getOrder(order.id))!;
    expect(half.status).toBe("new");
    expect((await getLevel(PRODUCT.id, ""))?.qty).toBe(10);

    // the webhook Montonio is still retrying
    const out = await settlePayment(half, ticket(order), "montonio");

    expect(out.status).toBe("paid");
    expect(out.alreadyPaid).toBe(false);
    expect((await getOrder(order.id))?.status).toBe("paid");
    expect((await getLevel(PRODUCT.id, ""))?.qty).toBe(8);
    expect(paidLetters()).toBe(1);

    // …and the retry after THAT changes nothing
    const again = await settlePayment((await getOrder(order.id))!, ticket(order), "montonio");
    expect(again.alreadyPaid).toBe(true);
    expect((await getLevel(PRODUCT.id, ""))?.qty).toBe(8);
    expect(paidLetters()).toBe(1);
  });

  it("a late webhook never drags a cancelled order back into paid", async () => {
    const order = await place();
    const out = await settlePayment(order, ticket(order), "montonio");
    expect(out.status).toBe("paid");
    await setOrderStatus(order.id, "cancelled", "admin");
    expect((await getLevel(PRODUCT.id, ""))?.qty).toBe(10); // the cancellation gave it back

    const late = await settlePayment((await getOrder(order.id))!, ticket(order), "montonio");
    expect(late.alreadyPaid).toBe(true);
    expect((await getOrder(order.id))?.status).toBe("cancelled");
    expect((await getLevel(PRODUCT.id, ""))?.qty).toBe(10);
    expect(paidLetters()).toBe(1);
  });

  it("claimOrderPaid answers once, and never pulls a shipped order back", async () => {
    const order = await place();
    expect((await claimOrderPaid(order.id, "test"))?.status).toBe("paid");
    expect(await claimOrderPaid(order.id, "test")).toBeNull();

    await setOrderStatus(order.id, "shipped", "admin");
    expect(await claimOrderPaid(order.id, "test")).toBeNull();
    expect((await getOrder(order.id))?.status).toBe("shipped");
  });
});
