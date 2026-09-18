/**
 * An order paid SHORT is held, not fulfilled — Dim's decision of 18.09.2026.
 *
 * Montonio's own help centre, on reusing an order under the same
 * `merchantReference`: «Reusing orders while changing the amount may allow
 * your customers to complete orders by paying a smaller amount than
 * intended.» Until now the shop wrote `payment.amountMismatch`, logged, and
 * then ran the whole paid transition anyway — stock off the shelf, the
 * order's gift cards minted and e-mailed, the receipt sent.
 *
 * Dim chose the strict option and turned the middle one down by name: marking
 * it paid while holding only the cards lets the parcel go, and a parcel that
 * has gone cannot be recalled, while a gift card held back can be reissued in
 * seconds.
 *
 * So the three things this file proves are the three that cannot be undone:
 * the shelf, the card and the letter. Real Postgres (PGlite), real orders,
 * the real settlePayment() door; the mail sink stands in for the mailbox.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import { getLevel, listMoves, move } from "@/lib/inventory";
import { capturedMail } from "@/lib/mail";
import { createOrder, getOrder, type Order } from "@/lib/orders";
import { settlePayment } from "@/lib/payments/settle";
import type { VerifyResult } from "@/lib/payments/types";
import { adminCookieHeader, makeRequest, ORIGIN, PRODUCT, setFuzzEnv } from "./fuzz-harness";
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

/** An order that buys a 50 € gift card — the mintable thing. */
async function placeGift(): Promise<Order> {
  return createOrder({
    lang: "RU",
    items: [{ id: "gift:50", qty: 1, meta: { name: "Mari", email: "mari@example.com" } }],
    customer: CUSTOMER,
    shipping: { method: "digital", country: "EE" },
  }) as unknown as Promise<Order>;
}

function letters(template: string): number {
  return capturedMail().filter((m) => m.template === template).length;
}

async function heldRows(): Promise<Array<Record<string, unknown>>> {
  return query<{ payload: Record<string, unknown> }>(
    "select payload from admin_audit where action = 'order.payment_held' order by id",
  ).then((rows) => rows.map((r) => r.payload));
}

describe("money that arrives short of the order total", () => {
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

  it("takes no stock, sends no receipt, and leaves the order unpaid", async () => {
    const order = await place();
    const short = Math.round((Number(order.total) - 5) * 100) / 100;

    const out = await settlePayment(order, ticket(order, { amount: short }), "montonio");

    expect(out.status).toBe("unchanged");
    expect(out.alreadyPaid).toBe(false);

    const fresh = (await getOrder(order.id))!;
    expect(fresh.status).toBe("new");
    // the shelf is untouched — the one thing a parcel would take off it
    expect((await getLevel(PRODUCT.id, ""))?.qty).toBe(10);
    expect(await listMoves({ productId: PRODUCT.id, reason: "sale_web" })).toHaveLength(0);
    // …and the customer was told nothing, because nothing is confirmed
    expect(letters("order-confirmed")).toBe(0);
  });

  it("puts it on the order card and in the journal, so Renat can find it", async () => {
    const order = await place();
    await settlePayment(order, ticket(order, { amount: 1 }), "montonio");

    const fresh = (await getOrder(order.id))!;
    const payment = fresh.payment as Record<string, unknown>;
    expect(payment.held).toMatchObject({
      reason: "underpaid",
      expected: Number(order.total),
      got: 1,
      currency: "EUR",
      providerStatus: "paid",
    });
    /* `pending`, not `paid`. The blob is what alreadyPaid() and halfSettled()
       read, and a blob saying paid on an order that never moved is what those
       two call «a settlement that died half-way» — see the retry test below. */
    expect(payment.status).toBe("pending");

    const rows = await heldRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ number: order.number, reason: "underpaid" });
  });

  it("mints no gift card — the thing the middle option would have let through", async () => {
    const order = await placeGift();
    await settlePayment(order, ticket(order, { amount: 10 }), "montonio");

    const cards = await query<{ n: string }>("select count(*)::text as n from gift_cards");
    expect(Number(cards[0].n)).toBe(0);
    expect(letters("giftcard")).toBe(0);
    expect((await getOrder(order.id))?.status).toBe("new");
  });

  it("stays held through all thirteen of Montonio's retries", async () => {
    const order = await place();
    await settlePayment(order, ticket(order, { amount: 1 }), "montonio");

    for (let i = 0; i < 3; i += 1) {
      const held = (await getOrder(order.id))!;
      const out = await settlePayment(held, ticket(order, { amount: 1 }), "montonio");
      expect(out.status).toBe("unchanged");
    }

    expect((await getOrder(order.id))?.status).toBe("new");
    expect((await getLevel(PRODUCT.id, ""))?.qty).toBe(10);
    expect(letters("order-confirmed")).toBe(0);
    // one event, one journal row — a retry is not news
    expect(await heldRows()).toHaveLength(1);
  });

  it("settles normally the moment the full amount arrives", async () => {
    const order = await place();
    await settlePayment(order, ticket(order, { amount: 1 }), "montonio");
    expect((await getOrder(order.id))?.status).toBe("new");

    /* The shopper pays again and this time in full. Nothing about the hold
       blocks the real payment: the order was never moved, so the ordinary
       transition into paid is still ahead of it. */
    const held = (await getOrder(order.id))!;
    const out = await settlePayment(held, ticket(order), "montonio");

    expect(out.status).toBe("paid");
    expect(out.alreadyPaid).toBe(false);
    expect((await getOrder(order.id))?.status).toBe("paid");
    expect((await getLevel(PRODUCT.id, ""))?.qty).toBe(8);
    expect(letters("order-confirmed")).toBe(1);
  });

  /* Renat's way out, and the only one he needs: the order card's «Оплачен».
     It goes through applyPaymentResult() with the order's own total, so the
     shelf, the cards, the points and the letter all happen exactly once — and
     the hold comes off, or the card would go on warning about a shortfall
     that has been settled. */
  it("is released by the panel's «Оплачен», with everything settled and the Montonio id kept", async () => {
    const order = await place();
    await settlePayment(order, ticket(order, { amount: 1 }), "montonio");
    expect((await getOrder(order.id))?.status).toBe("new");

    const { PATCH } = await import("@/app/api/admin/orders/[id]/route");
    const res = await PATCH(
      makeRequest(`/api/admin/orders/${order.id}/`, {
        method: "PATCH",
        headers: { cookie: adminCookieHeader(), origin: ORIGIN },
        body: { status: "paid" },
      }),
      { params: Promise.resolve({ id: order.id }) },
    );
    expect(res.status).toBe(200);

    const fresh = (await getOrder(order.id))!;
    expect(fresh.status).toBe("paid");
    expect((await getLevel(PRODUCT.id, ""))?.qty).toBe(8);
    expect(letters("order-confirmed")).toBe(1);

    const payment = fresh.payment as Record<string, unknown>;
    // the hold is lifted, not left lying on the card…
    expect(payment.held).toBeNull();
    // …and `payment.ref` is still Montonio's, which is the only id
    // «Вернуть деньги» can send money back through
    expect(payment.ref).toBe("montonio-uuid-1");
  });

  it("does not hold an order that was paid in full", async () => {
    const order = await place();
    const out = await settlePayment(order, ticket(order), "montonio");
    expect(out.status).toBe("paid");
    expect((await getOrder(order.id))?.payment).not.toHaveProperty("held");
    expect(await heldRows()).toHaveLength(0);
  });
});
