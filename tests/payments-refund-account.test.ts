/**
 * What the CUSTOMER's own screen says about a refund, and about a card the
 * shop has bought back.
 *
 * Both halves come from one report. Dim refunded a card-paid order on
 * 19.09.2026 and wrote: «When I got to "Gift cards" it seems that the card is
 * still valid. Also I can still see it in "my orders" on "my account".
 * Something is not right here.»
 *
 * The card was right and the screens were wrong. Montonio answers `200
 * PENDING` to a refund it has only accepted, and everything that closes an
 * order — voiding the cards it sold, reversing the points, the move to
 * «возврат» — waits for the webhook that confirms it, up to ten days later.
 * That is deliberate: a void cannot be undone and Montonio may still cancel
 * the refund. What was wrong is that nothing on the customer's side said a
 * refund had been sent at all, while the letter «Возврат отправлен» was
 * already in their inbox — and that a card which HAD been voided went on
 * being offered in the account, with its full face value on the PDF.
 *
 * Real Postgres (PGlite), the mock provider, fetch stubbed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import { getGiftCard, issueGiftCards } from "@/lib/giftcards";
import { listCustomerOrders } from "@/lib/customers";
import { createOrder, getOrder, type Order } from "@/lib/orders";
import { refundedTotal } from "@/lib/payments/refund";
import { settlePayment, settleRefund } from "@/lib/payments/settle";
import { PRODUCT, setFuzzEnv } from "./fuzz-harness";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const CUSTOMER = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };
const GOODS = { lang: "RU", items: [{ id: PRODUCT.id, qty: 1 }], customer: CUSTOMER, shipping: { method: "pickup", country: "EE" } };
const GIFT = { ...GOODS, items: [{ id: "gift:25", qty: 1 }], shipping: { method: "digital", country: "EE" } };

let restoreEnv: () => void = () => {};
let seq = 0;

async function bankPaid(body: Record<string, unknown>): Promise<Order> {
  seq += 1;
  const order = await createOrder(body as Parameters<typeof createOrder>[0]);
  await settlePayment(
    order,
    { orderRef: order.number, status: "paid", providerRef: `mock_ref_${seq}`, amount: order.total, currency: "EUR" },
    "mock",
  );
  return (await getOrder(order.id))!;
}

/** The customer's own row for this order, as /api/account/me/ serves it. */
async function accountRow(number: string) {
  const rows = await listCustomerOrders(CUSTOMER.email, 20);
  const row = rows.find((r) => r.number === number);
  expect(row, `order ${number} is not in the customer's list`).toBeTruthy();
  return row!;
}

beforeAll(async () => {
  await setupDb();
  restoreEnv = setFuzzEnv();
});
afterAll(async () => {
  restoreEnv();
  await teardownDb();
});
beforeEach(async () => {
  await truncateAll();
});

describe("a refund the bank has not confirmed yet", () => {
  it("shows on the customer's order as sent, not as done", async () => {
    const order = await bankPaid(GOODS);
    await settleRefund(
      order,
      { ref: "rf_pending", amount: 12.5, status: "pending", at: new Date().toISOString(), by: "admin" },
      { notify: false },
    );

    const row = await accountRow(order.number);
    expect(row.refundPending).toBe(12.5);
    expect(row.refunded).toBe(0);
    /* …and the order is still paid, which is the whole reason the screen
       needed a second number: its status alone says nothing happened. */
    expect(row.status).toBe("paid");
  });

  it("becomes «возвращено» when the webhook confirms it", async () => {
    const order = await bankPaid(GOODS);
    const at = new Date().toISOString();
    await settleRefund(order, { ref: "rf_1", amount: 12.5, status: "pending", at, by: "admin" }, { notify: false });
    const midway = (await getOrder(order.id))!;
    await settleRefund(midway, { ref: "rf_1", amount: 12.5, status: "done", at, by: "montonio" }, { notify: false });

    const row = await accountRow(order.number);
    expect(row.refundPending).toBe(0);
    expect(row.refunded).toBe(12.5);
  });

  it("counts the same money the payments module counts", async () => {
    const order = await bankPaid(GOODS);
    const at = new Date().toISOString();
    await settleRefund(order, { ref: "rf_a", amount: 4, status: "done", at, by: "admin" }, { notify: false });
    const midway = (await getOrder(order.id))!;
    await settleRefund(midway, { ref: "rf_b", amount: 2.5, status: "pending", at, by: "admin" }, { notify: false });

    const stored = (await getOrder(order.id))!;
    const row = await accountRow(order.number);
    /* refundedTotal() is everything that has not failed — the two numbers on
       the screen have to add up to exactly that, or one of the readers has
       drifted from the shape settleRefund() writes. */
    expect(row.refunded + row.refundPending).toBe(refundedTotal(stored.payment));
    expect(row.refunded).toBe(4);
    expect(row.refundPending).toBe(2.5);
  });

  it("says nothing on an order nobody has refunded", async () => {
    const order = await bankPaid(GOODS);
    const row = await accountRow(order.number);
    expect(row.refunded).toBe(0);
    expect(row.refundPending).toBe(0);
  });
});

describe("a gift card the shop has bought back", () => {
  async function soldCard(): Promise<{ order: Order; code: string }> {
    const order = await bankPaid(GIFT);
    const cards = await issueGiftCards(order);
    expect(cards.length).toBeGreaterThan(0);
    return { order, code: cards[0].code };
  }

  it("is offered in the account while it is alive", async () => {
    const { order, code } = await soldCard();
    const row = await accountRow(order.number);
    expect(row.giftCards.map((c) => c.code)).toEqual([code]);
    expect(row.giftCards[0].pdfUrl).toContain(encodeURIComponent(code));
  });

  it("disappears from the account once it is voided", async () => {
    const { order, code } = await soldCard();
    await query("update gift_cards set balance = 0, voided_at = now() where code = $1", [code]);
    expect((await getGiftCard(code))!.voidedAt).toBeTruthy();

    const row = await accountRow(order.number);
    /* It used to stay, with its face value and a working PDF link: a 50 €
       card in the customer's hands that no till will take. */
    expect(row.giftCards).toEqual([]);
  });

  it("will not print its PDF again — 410, because the card did exist", async () => {
    const { code } = await soldCard();
    const { giftPdfPath } = await import("@/lib/giftcard-pdf");
    const url = giftPdfPath(code);
    const { GET } = await import("@/app/api/giftcards/[code]/pdf/route");
    const params = Promise.resolve({ code });

    const alive = await GET(new Request("https://shop.test" + url), { params });
    expect(alive.status).toBe(200);

    await query("update gift_cards set balance = 0, voided_at = now() where code = $1", [code]);
    const dead = await GET(new Request("https://shop.test" + url), { params: Promise.resolve({ code }) });
    expect(dead.status).toBe(410);
    expect((await dead.json()).error).toBe("voided");
  });
});
