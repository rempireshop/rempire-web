/**
 * «Вернуть деньги» pressed a second time is not a second refund.
 *
 * Staging, 25.09.2026, R-100086: an order of 9 € paid entirely by a gift card.
 * «Вернуть деньги» for 4 €, then «Вернуть деньги» again for 4 € — and the
 * order read «Возвращено 8 € из 9 €», two lines «На подарочную карту … вернулось
 * 4 €», the card went 16 → 24 €. The /test item order-refund-retry expects a
 * repeat to leave one line.
 *
 * Why the existing keys did not catch it: giftRefundRef() and
 * refundIdempotencyKey() are derived from the number of refund lines already
 * on the order, so once the first refund is written the second press derives a
 * NEW ref — the design's own word for a deliberate second refund. The Montonio
 * half behaves the same; the sandbox only looked safe because Montonio refused
 * every bank-link refund there.
 *
 * The fix: the request says which ledger it was made from (`refundsSeen`, the
 * number of refund lines the card showed), the server refuses one made from a
 * ledger that has moved on, and runs at most one refund per look at the ledger
 * at a time. A second partial refund still works — from a card opened after
 * the first, which says «По заказу уже возвращено …».
 *
 * Real Postgres (PGlite), the mock provider.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { getGiftCard } from "@/lib/giftcards";
import { isValidIdempotencyKey } from "@/lib/idempotency";
import { createOrder, getOrder, type Order } from "@/lib/orders";
import { resetRateLimits as resetPayRateLimits } from "@/lib/payments/ratelimit";
import { refundedTotal, refundIntentKey, refundSeenOf, refundsOf, refundStaleText } from "@/lib/payments/refund";
import { settlePayment, settleWithoutPayment } from "@/lib/payments/settle";
import { adminCookieHeader, makeRequest, PRODUCT, resetIps, setFuzzEnv } from "./fuzz-harness";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const CUSTOMER = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };
const PICKUP = { lang: "RU", items: [{ id: PRODUCT.id, qty: 1 }], customer: CUSTOMER, shipping: { method: "pickup", country: "EE" } };

let restoreEnv: () => void = () => {};
let seq = 0;

const money = (n: number) => Math.round(n * 100) / 100;

/** Exactly what the panel posts: the sum, and the count of refund lines the card was opened on. */
async function refund(id: string, body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/admin/orders/[id]/refund/route");
  const res = await POST(
    makeRequest(`/api/admin/orders/${id}/refund/`, { method: "POST", body, cookie: adminCookieHeader() }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function looseCard(balance: number, code = "RMP-ACDE-4679"): Promise<string> {
  await query("insert into gift_cards (code, amount, balance, lang) values ($1, $2, $3, 'RU')", [code, 100, balance]);
  return code;
}

async function balanceOf(code: string): Promise<number> {
  const c = await getGiftCard(code);
  expect(c, `card ${code} vanished`).toBeTruthy();
  return c!.balance;
}

/** R-100086's shape: nothing to pay, the card covered all of it. */
async function cardOnlyOrder(code: string): Promise<{ order: Order; goods: number }> {
  const before = await balanceOf(code);
  const order = await createOrder({ ...PICKUP, discountCode: code } as Parameters<typeof createOrder>[0]);
  expect(order.total).toBe(0);
  await settleWithoutPayment(order);
  const goods = money(before - (await balanceOf(code)));
  expect(goods, "the card paid nothing").toBeGreaterThan(5);
  return { order: (await getOrder(order.id))!, goods };
}

/** An order the mock bank paid, with a provider reference to refund through. */
async function bankPaid(): Promise<Order> {
  seq += 1;
  const order = await createOrder({ ...PICKUP, items: [{ id: PRODUCT.id, qty: 2 }] } as Parameters<typeof createOrder>[0]);
  const out = await settlePayment(
    order,
    { orderRef: order.number, status: "paid", providerRef: `mock_once_${seq}`, amount: order.total, currency: "EUR" },
    "mock",
  );
  expect(out.status).toBe("paid");
  return (await getOrder(order.id))!;
}

async function lines(id: string) {
  return refundsOf((await getOrder(id))!.payment);
}

beforeAll(async () => {
  restoreEnv = setFuzzEnv();
  process.env.PAYMENT_PROVIDER = "mock";
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
  await query("truncate gift_card_uses, gift_cards restart identity cascade");
  resetIps();
  resetPayRateLimits();
  process.env.PAYMENT_PROVIDER = "mock";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("«Вернуть деньги» pressed again from the same card", () => {
  it("R-100086: a gift-card order refunded 4 €, then 4 € again — one refund, the card credited once", async () => {
    const code = await looseCard(50);
    const { order } = await cardOnlyOrder(code);
    const start = await balanceOf(code);

    const first = await refund(order.id, { amount: 4, refundsSeen: 0 });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ amount: 4, gift: 4, money: 0 });
    expect(await balanceOf(code)).toBe(money(start + 4));

    // the same card, the same 4 €, pressed again
    const again = await refund(order.id, { amount: 4, refundsSeen: 0 });
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expect(again.body.error).toBe("refund_stale");
    expect(again.body.refundedTotal).toBe(4);
    const said = again.body.messages as Record<string, string>;
    expect(said.RU).toContain("По этому заказу уже вернули 4 €.");
    expect(said.RU).toContain("второй раз деньги не ушли");
    expect(said.EN).toContain("4 € has already been refunded");
    expect(said.ET).toContain("tagastatud 4 €");

    // one line, «Возвращено 4 € из …», and the card grew once
    expect(await lines(order.id)).toHaveLength(1);
    expect(refundedTotal((await getOrder(order.id))!.payment)).toBe(4);
    expect(await balanceOf(code)).toBe(money(start + 4));
  });

  it("the same through Montonio: the second press sends nothing to the bank", async () => {
    const order = await bankPaid();
    const first = await refund(order.id, { amount: 5, refundsSeen: 0 });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ amount: 5, money: 5, gift: 0 });

    const again = await refund(order.id, { amount: 5, refundsSeen: 0 });
    expect(again.status, JSON.stringify(again.body)).toBe(409);
    expect(again.body.error).toBe("refund_stale");
    expect(await lines(order.id)).toHaveLength(1);
    expect(refundedTotal((await getOrder(order.id))!.payment)).toBe(5);
  });

  it("a request that names no ledger at all can only be the first refund", async () => {
    const order = await bankPaid();
    const first = await refund(order.id, { amount: 3 });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const again = await refund(order.id, { amount: 3 });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("refund_stale");
    // …and a count nobody could have seen is not a way round it
    for (const bogus of [-1, 1.5, "x", 99]) {
      const out = await refund(order.id, { amount: 3, refundsSeen: bogus });
      expect(out.status, String(bogus)).toBe(409);
      expect(out.body.error).toBe("refund_stale");
    }
    expect(await lines(order.id)).toHaveLength(1);
  });

  it("two presses in the same instant — two devices, two sums — make one refund", async () => {
    const code = await looseCard(50);
    const { order } = await cardOnlyOrder(code);
    const start = await balanceOf(code);
    const [a, b] = await Promise.all([
      refund(order.id, { amount: 3, refundsSeen: 0 }),
      refund(order.id, { amount: 2, refundsSeen: 0 }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses, JSON.stringify([a.body, b.body])).toEqual([200, 409]);
    const refused = a.status === 409 ? a : b;
    expect(["in_progress", "refund_stale"]).toContain(refused.body.error);
    expect(await lines(order.id)).toHaveLength(1);
    const won = a.status === 200 ? 3 : 2;
    expect(await balanceOf(code)).toBe(money(start + won));
  });
});

describe("a second partial refund is still possible — from a card opened after the first", () => {
  it("the fresh card carries the new count, and the remainder still bounds it", async () => {
    const code = await looseCard(50);
    const { order, goods } = await cardOnlyOrder(code);
    const start = await balanceOf(code);

    expect((await refund(order.id, { amount: 4, refundsSeen: 0 })).status).toBe(200);
    // the owner opens «Вернуть деньги» again: the card now shows one line
    const second = await refund(order.id, { amount: 4, refundsSeen: 1 });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body).toMatchObject({ amount: 4, gift: 4 });
    expect(await lines(order.id)).toHaveLength(2);
    expect(await balanceOf(code)).toBe(money(start + 8));

    // never past what is left
    const over = await refund(order.id, { amount: goods, refundsSeen: 2 });
    expect(over.status).toBe(400);
    expect(over.body.error).toBe("bad_amount");
    expect(over.body.left).toBe(money(goods - 8));
    expect(await lines(order.id)).toHaveLength(2);
  });

  it("a refused refund moves nothing, so the retry from the same card is still allowed", async () => {
    const order = await bankPaid();
    // more than the order is worth — refused before any money moves
    const refused = await refund(order.id, { amount: 10_000, refundsSeen: 0 });
    expect(refused.status).toBe(400);
    const ok = await refund(order.id, { amount: 2, refundsSeen: 0 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await lines(order.id)).toHaveLength(1);
  });
});

describe("the pieces", () => {
  it("refundSeenOf: absent is 0, anything that is not a count is -1", () => {
    expect(refundSeenOf(undefined)).toBe(0);
    expect(refundSeenOf(null)).toBe(0);
    expect(refundSeenOf("")).toBe(0);
    expect(refundSeenOf(0)).toBe(0);
    expect(refundSeenOf(2)).toBe(2);
    expect(refundSeenOf("3")).toBe(3);
    expect(refundSeenOf(-1)).toBe(-1);
    expect(refundSeenOf(1.5)).toBe(-1);
    expect(refundSeenOf("x")).toBe(-1);
    expect(refundSeenOf({})).toBe(-1);
  });

  it("refundIntentKey is a key runOnce() accepts, one per order and count", () => {
    const k = refundIntentKey("0b6c1b0e-7d7a-4d0c-9c43-6f3c1c9f4a11", 2);
    expect(isValidIdempotencyKey(k)).toBe(true);
    expect(k).not.toBe(refundIntentKey("0b6c1b0e-7d7a-4d0c-9c43-6f3c1c9f4a11", 3));
  });

  it("the refusal without money in the ledger does not say «вернули 0 €»", () => {
    const t = refundStaleText(0);
    expect(t.RU).not.toContain("0 €");
    expect(t.RU).toContain("Возвраты по этому заказу изменились.");
    expect(refundStaleText(12.9).RU).toContain("12,90 €");
  });
});
