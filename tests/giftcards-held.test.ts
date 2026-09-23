/**
 * A gift card is HELD while the refund of the order that SOLD it is pending
 * (23.09.2026).
 *
 * The owner's own reproduction: «Вернуть деньги» on R-100050, which bought a
 * card — Montonio answered PENDING, as it does for every refund it has only
 * accepted — and then R-100054 paid with that same card. A pending refund
 * voids nothing by design (settleRefund: Montonio may still cancel it, and a
 * void cannot be undone), and nothing refused the card in between, so it was
 * spent while its own money was on the way back; the void that followed the
 * confirmation zeroed only what was left.
 *
 * What is pinned here:
 *
 *   · pending → checkGiftCard, applyGiftCard and redeemGiftCard all refuse
 *     it with `held`, and nothing on the card moves;
 *   · confirmed → the card is voided, exactly as before;
 *   · cancelled (Montonio's `failed`) → the card works again with everything
 *     that was on it;
 *   · a card whose order has no refund, or only a pending refund of the goods,
 *     is untouched;
 *   · the race: a card quoted onto an order at checkout, the refund going out
 *     before the payment — the payment start and the redeem both re-check;
 *   · the order card, the account and the gift-card list say «held».
 *
 * Real Postgres (PGlite), the mock provider with its refund answer switched
 * to PENDING, fetch stubbed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { attachGiftCards } from "@/lib/giftcard-links";
import {
  applyGiftCard,
  checkGiftCard,
  getGiftCard,
  giftHoldsByOrder,
  issueGiftCards,
  redeemGiftCard,
} from "@/lib/giftcards";
import { createOrder, getOrder, type Order } from "@/lib/orders";
import { MockProvider, mockSecret, signMockRefundTicket } from "@/lib/payments/mock";
import { resetRateLimits as resetPayRateLimits } from "@/lib/payments/ratelimit";
import { refundPendingInFull, type RefundStatus } from "@/lib/payments/refund";
import { settlePayment, settleWithoutPayment } from "@/lib/payments/settle";
import { PaymentError } from "@/lib/payments/types";
import { adminCookieHeader, installFetchStub, makeRequest, PRODUCT, resetIps, setFuzzEnv } from "./fuzz-harness";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const CUSTOMER = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };
const PICKUP = { lang: "RU", items: [{ id: PRODUCT.id, qty: 1 }], customer: CUSTOMER, shipping: { method: "pickup", country: "EE" } };
const GIFT_ONLY = { lang: "RU", items: [{ id: "gift:25", qty: 1 }], customer: CUSTOMER, shipping: { method: "digital", country: "EE" } };
const GIFT_AND_GOODS = { ...PICKUP, items: [{ id: "gift:25", qty: 1 }, { id: PRODUCT.id, qty: 1 }] };
/** The ref Montonio gives the refund the panel asks for — the webhook confirms or cancels it by this. */
const PENDING_REF = "rf-held-1";

let restoreEnv: () => void = () => {};
let seq = 0;

/** An order the mock bank has paid for, with a provider reference on it. */
async function bankPaid(body: Record<string, unknown>): Promise<Order> {
  seq += 1;
  const order = await createOrder(body as Parameters<typeof createOrder>[0]);
  const out = await settlePayment(
    order,
    { orderRef: order.number, status: "paid", providerRef: `mock_held_${seq}`, amount: order.total, currency: "EUR" },
    "mock",
  );
  expect(out.status).toBe("paid");
  return (await getOrder(order.id))!;
}

/** The order that buys a 25 € card, paid, with the card minted — R-100050. */
async function soldCard(body: Record<string, unknown> = GIFT_ONLY): Promise<{ order: Order; code: string }> {
  const order = await bankPaid(body);
  const [card] = await issueGiftCards(order);
  expect(card, "the paid order minted no card").toBeTruthy();
  return { order: (await getOrder(order.id))!, code: card.code };
}

/** «Вернуть деньги» in the panel, with Montonio answering 200 PENDING — what a real refund looks like at first. */
async function refundPending(id: string, body: Record<string, unknown> = {}) {
  vi.spyOn(MockProvider.prototype, "refundPayment").mockImplementation(async (req) => ({
    ref: PENDING_REF,
    amount: Math.round(Number(req.amount) * 100) / 100,
    status: "pending",
    currency: "EUR",
  }));
  const { POST } = await import("@/app/api/admin/orders/[id]/refund/route");
  const res = await POST(
    makeRequest(`/api/admin/orders/${id}/refund/`, { method: "POST", body, cookie: adminCookieHeader() }),
    { params: Promise.resolve({ id }) },
  );
  const out = { status: res.status, body: (await res.json()) as Record<string, unknown> };
  expect(out.status, JSON.stringify(out.body)).toBe(200);
  expect(out.body.refundStatus).toBe("pending");
  return out;
}

/** Montonio's refund webhook, days later: SUCCESSFUL (`done`) or CANCELED/REJECTED (`failed`). */
async function refundWebhook(order: Order, status: RefundStatus, amount: number, refundRef = PENDING_REF) {
  const providerOrderRef = String((order.payment as { ref: string }).ref);
  const { POST } = await import("@/app/api/payments/notify/route");
  const token = signMockRefundTicket({ refundRef, providerOrderRef, amount, status }, mockSecret());
  const res = await POST(makeRequest("/api/payments/notify/", { method: "POST", body: { mockRefundToken: token } }));
  const out = { status: res.status, body: (await res.json()) as Record<string, unknown> };
  expect(out.status, JSON.stringify(out.body)).toBe(200);
  return out;
}

async function placeOrder(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/orders/route");
  const res = await POST(makeRequest("/api/orders/", { method: "POST", body }));
  const json = (await res.json()) as { orderId: string; number: string; total: number };
  expect(res.status, JSON.stringify(json)).toBe(201);
  return json;
}

async function payStart(orderId: string, method = "bank") {
  const { POST } = await import("@/app/api/payments/create/route");
  const res = await POST(makeRequest("/api/payments/create/", { method: "POST", body: { orderId, method } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function checkRoute(code: string) {
  const { POST } = await import("@/app/api/giftcards/check/route");
  const res = await POST(makeRequest("/api/giftcards/check/", { method: "POST", body: { code } }));
  return (await res.json()) as Record<string, unknown>;
}

async function balanceOf(code: string): Promise<number> {
  const c = await getGiftCard(code);
  expect(c, `card ${code} vanished`).toBeTruthy();
  return c!.balance;
}

async function spends(code: string): Promise<number[]> {
  const rows = await query<{ amount: string | number }>("select amount from gift_card_uses where code = $1 order by id", [code]);
  return rows.map((r) => Number(r.amount));
}

/** A basket the 25 € card cannot cover on its own, whatever the product costs. */
async function biggerThanCard(): Promise<Record<string, unknown>> {
  const probe = await createOrder(PICKUP as Parameters<typeof createOrder>[0]);
  const qty = Math.ceil(30 / Math.max(0.01, probe.subtotal)) + 1;
  await query("delete from orders where id = $1", [probe.id]);
  return { ...PICKUP, items: [{ id: PRODUCT.id, qty }] };
}

beforeAll(async () => {
  restoreEnv = setFuzzEnv();
  installFetchStub();
  process.env.PAYMENT_PROVIDER = "mock";
  process.env.E2E_BOOTSTRAP = "1";
  delete process.env.RESEND_API_KEY;
  await setupDb();
}, 60_000);
afterAll(async () => {
  vi.unstubAllGlobals();
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
afterEach(() => {
  vi.restoreAllMocks();
});

/* ---------- the rule, pure ------------------------------------------------- */

describe("refundPendingInFull()", () => {
  const at = "2026-09-23T10:00:00.000Z";
  const line = (ref: string, amount: number, status: RefundStatus) => ({ ref, amount, status, at });

  it("holds only for a pending refund that, once confirmed, covers the order", () => {
    expect(refundPendingInFull(25, { refunds: [line("r1", 25, "pending")] })).toBe(true);
    // a pending refund of the goods alone voids nothing when it lands — nothing to hold
    expect(refundPendingInFull(80, { refunds: [line("r1", 30, "pending")] })).toBe(false);
    // the goods already back, the rest pending: confirming it covers the order
    expect(refundPendingInFull(80, { refunds: [line("r1", 30, "done"), line("r2", 50, "pending")] })).toBe(true);
    // the goods pending, the rest already back: the same
    expect(refundPendingInFull(80, { refunds: [line("r1", 30, "pending"), line("r2", 50, "done")] })).toBe(true);
  });

  it("lets go once nothing is pending — confirmed or cancelled", () => {
    expect(refundPendingInFull(25, { refunds: [line("r1", 25, "done")] })).toBe(false);
    expect(refundPendingInFull(25, { refunds: [line("r1", 25, "failed")] })).toBe(false);
    expect(refundPendingInFull(25, {})).toBe(false);
    expect(refundPendingInFull(25, null)).toBe(false);
  });
});

/* ---------- the owner's reproduction ------------------------------------------ */

describe("a card whose selling order has a pending refund", () => {
  it("is refused by check, apply and redeem — and nothing on it moves", async () => {
    const { order, code } = await soldCard();
    await refundPending(order.id);

    // the refund is only accepted: nothing voided, the balance is whole
    const card = (await getGiftCard(code))!;
    expect(card.voidedAt).toBeNull();
    expect(card.balance).toBe(25);
    expect((await getOrder(order.id))!.status).toBe("paid");

    expect(await checkGiftCard(code)).toMatchObject({ ok: false, error: "held", code });
    expect(await checkRoute(code)).toMatchObject({ ok: false, error: "held" });
    expect(await applyGiftCard(code, 10)).toMatchObject({ ok: false, error: "held", discount: 0 });

    // R-100054: an order that tries to spend it
    const other = await createOrder({ ...PICKUP, discountCode: code } as Parameters<typeof createOrder>[0]);
    expect(other.discount, "the checkout must not price a held card").toBe(0);
    expect(other.total).toBeGreaterThan(0);
    expect(await redeemGiftCard(code, 5, other.id)).toMatchObject({ ok: false, error: "held", taken: 0, remaining: 25 });

    expect(await balanceOf(code)).toBe(25);
    expect(await spends(code)).toEqual([]);
  });

  it("is voided when Montonio confirms the refund — as before", async () => {
    const { order, code } = await soldCard();
    await refundPending(order.id);

    const done = await refundWebhook(order, "done", 25);
    expect(done.body.status).toBe("refunded");
    const card = (await getGiftCard(code))!;
    expect(card.voidedAt).toBeTruthy();
    expect(card.balance).toBe(0);
    // dead now, not held: «empty» is what a voided card has always answered
    expect(await checkGiftCard(code)).toMatchObject({ ok: false, error: "empty" });
    expect(await giftHoldsByOrder([order.id])).toEqual({});
    const audit = await query<{ action: string }>("select action from admin_audit where action = 'giftcards.voided'");
    expect(audit).toHaveLength(1);
  });

  it("works again with its whole balance when Montonio cancels the refund", async () => {
    const { order, code } = await soldCard();
    await refundPending(order.id);
    expect((await checkGiftCard(code)).error).toBe("held");

    const cancelled = await refundWebhook(order, "failed", 25);
    expect(cancelled.body.refund).toBe("failed");
    expect((await getOrder(order.id))!.status).toBe("paid");

    expect(await checkGiftCard(code)).toEqual({ ok: true, code, balance: 25, amount: 25 });
    expect(await applyGiftCard(code, 10)).toMatchObject({ ok: true, discount: 10, remaining: 15 });

    // …and it really pays: an order it covers entirely goes through on the spot
    const shop = await createOrder({ ...PICKUP, discountCode: code } as Parameters<typeof createOrder>[0]);
    expect(shop.total).toBe(0);
    expect((await settleWithoutPayment(shop)).status).toBe("paid");
    expect(await balanceOf(code)).toBe(Math.round((25 - shop.discount) * 100) / 100);
  });
});

describe("cards the rule must leave alone", () => {
  it("a card from an order with no refund, and a card made by hand", async () => {
    const { code } = await soldCard();
    const other = await soldCard();
    await refundPending(other.order.id);
    expect((await checkGiftCard(other.code)).error).toBe("held");

    // the refund of ANOTHER order holds nothing but its own cards
    expect(await checkGiftCard(code)).toMatchObject({ ok: true, balance: 25 });
    await query("insert into gift_cards (code, amount, balance, lang) values ('RMP-ACDE-4679', 50, 50, 'RU')");
    expect(await checkGiftCard("RMP-ACDE-4679")).toMatchObject({ ok: true, balance: 50 });
    expect(await redeemGiftCard(code, 5, null, { ref: "held-test-free" })).toMatchObject({ ok: true, taken: 5 });
  });

  it("a pending refund of the goods alone holds nothing — confirming it voids nothing either", async () => {
    const { order, code } = await soldCard(GIFT_AND_GOODS);
    const goods = Math.round((order.total - 25) * 100) / 100;
    expect(goods).toBeGreaterThan(0);
    await refundPending(order.id, { amount: goods });

    expect(await checkGiftCard(code)).toMatchObject({ ok: true, balance: 25 });
    await refundWebhook(order, "done", goods);
    expect((await getGiftCard(code))!.voidedAt).toBeNull();
    expect(await checkGiftCard(code)).toMatchObject({ ok: true, balance: 25 });
  });

  it("a spend made BEFORE the hold is still that spend when its retry arrives", async () => {
    const { order, code } = await soldCard();
    // the card pays for another order entirely…
    const shop = await createOrder({ ...PICKUP, discountCode: code } as Parameters<typeof createOrder>[0]);
    expect((await settleWithoutPayment(shop)).status).toBe("paid");
    const left = await balanceOf(code);
    // …and then a refund of the order that sold it is made in Montonio's own
    // portal, which the «уже потрачена» guard in the panel never sees
    await refundWebhook(order, "pending", 25, "portal-pending-1");
    expect((await checkGiftCard(code)).error).toBe("held");

    // the retry of the first spend answers what it took, and takes nothing more
    expect(await redeemGiftCard(code, shop.discount, shop.id)).toMatchObject({ ok: true, already: true, taken: shop.discount });
    expect(await balanceOf(code)).toBe(left);
  });
});

/* ---------- the race: quoted at checkout, refunded before the payment -------- */

describe("a card quoted onto an order, then held before the payment", () => {
  it("an order the card covers entirely is stopped at «Оплатить» — the card untouched", async () => {
    const { order, code } = await soldCard();
    const placed = await placeOrder({ ...PICKUP, discountCode: code });
    expect(placed.total).toBe(0);

    await refundPending(order.id);

    const pay = await payStart(placed.orderId);
    expect(pay.status).toBe(409);
    expect(pay.body.error).toBe("gift_held");
    expect((await getOrder(placed.orderId))!.status).toBe("new");
    expect(await balanceOf(code)).toBe(25);
    expect(await spends(code)).toEqual([]);

    // the settle itself says the same, whoever calls it
    const again = (await getOrder(placed.orderId))!;
    await expect(settleWithoutPayment(again)).rejects.toMatchObject({ code: "gift_held" });
    await expect(settleWithoutPayment(again)).rejects.toBeInstanceOf(PaymentError);
  });

  it("an order the bank pays the rest of is refused before the shopper is sent to the bank", async () => {
    const { order, code } = await soldCard();
    const placed = await placeOrder({ ...(await biggerThanCard()), discountCode: code });
    expect(placed.total).toBeGreaterThan(0);
    expect((await getOrder(placed.orderId))!.discount).toBe(25);

    await refundPending(order.id);

    const pay = await payStart(placed.orderId);
    expect(pay.status).toBe(409);
    expect(pay.body.error).toBe("gift_held");
    expect(pay.body.redirectUrl).toBeUndefined();
    expect(await balanceOf(code)).toBe(25);
  });

  it("…and if the bank's money arrives anyway, the redeem re-checks: the card is not spent", async () => {
    const { order, code } = await soldCard();
    const placed = await placeOrder({ ...(await biggerThanCard()), discountCode: code });
    // the shopper is already on the bank's page when the refund goes out
    expect((await payStart(placed.orderId)).status).toBe(200);
    await refundPending(order.id);

    const bought = (await getOrder(placed.orderId))!;
    const paid = await settlePayment(
      bought,
      { orderRef: bought.number, status: "paid", providerRef: "mock_held_race", amount: bought.total, currency: "EUR" },
      "mock",
    );
    expect(paid.status).toBe("paid");
    expect(paid.giftShortfall).toMatchObject({ code, amount: 25, error: "held" });
    expect(await balanceOf(code)).toBe(25);
    expect(await spends(code)).toEqual([]);
    const audit = await query<{ payload: { error?: string } }>(
      "select payload from admin_audit where action = 'giftcard_redeem_failed'",
    );
    expect(audit.map((a) => a.payload.error)).toEqual(["held"]);
  });
});

/* ---------- what the screens are told ---------------------------------------- */

describe("the order card, the account and the gift-card list say «held»", () => {
  it("while pending, and not once the refund is cancelled", async () => {
    const { order, code } = await soldCard();
    await refundPending(order.id);

    const [card] = (await attachGiftCards([(await getOrder(order.id))!]))[0].giftCards ?? [];
    expect(card).toMatchObject({ code, held: true, voidedAt: null, balance: 25 });

    const { listCustomerOrders } = await import("@/lib/customers");
    const row = (await listCustomerOrders(CUSTOMER.email)).find((o) => o.number === order.number)!;
    expect(row.refundPending).toBe(25);
    expect(row.giftCards).toEqual([expect.objectContaining({ code, held: true })]);

    const { GET } = await import("@/app/api/admin/giftcards/route");
    const list = (await (await GET(makeRequest("/api/admin/giftcards/", { cookie: adminCookieHeader() }))).json()) as {
      cards: Array<{ code: string; held: boolean }>;
    };
    expect(list.cards.find((c) => c.code === code)?.held).toBe(true);

    await refundWebhook(order, "failed", 25);
    const [after] = (await attachGiftCards([(await getOrder(order.id))!]))[0].giftCards ?? [];
    expect(after.held).toBe(false);
    const rowAfter = (await listCustomerOrders(CUSTOMER.email)).find((o) => o.number === order.number)!;
    expect(rowAfter.giftCards[0]).not.toHaveProperty("held");
  });
});
