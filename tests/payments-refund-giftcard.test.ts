/**
 * Gift cards and refunds, both ways (Dim, 10.09.2026: «Can a gift card order
 * be refunded? I hope that orders paid fully with a gift card are now in the
 * correct status»).
 *
 *   · an order that BOUGHT cards: a full refund cancels them (balance 0,
 *     voided_at, the code stops working at the checkout); a card somebody
 *     has spent from blocks the refund and names the amount; a partial
 *     refund may reach into the goods and the delivery but never into a
 *     card; a refund made in Montonio's own portal cancels the cards too;
 *   · an order PAID with a card — entirely, so its total is 0 and it has no
 *     provider payment at all — is paid at once and refundable: the money
 *     goes back onto the card, the ledger says so, the order is «возврат»,
 *     the letter names the card;
 *   · an order paid partly with a card: the card first, Montonio for the
 *     rest, on a full refund and on a partial one.
 *
 * Real Postgres (PGlite), the mock provider, fetch stubbed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderOrderCancelled } from "@/emails/order-cancelled";
import { query } from "@/lib/db";
import { applyGiftCard, checkGiftCard, getGiftCard, issueGiftCards } from "@/lib/giftcards";
import { capturedMail } from "@/lib/mail";
import { createOrder, getOrder, setOrderPayment, setOrderStatus, type Order } from "@/lib/orders";
import { mockSecret, signMockRefundTicket } from "@/lib/payments/mock";
import { resetRateLimits as resetPayRateLimits } from "@/lib/payments/ratelimit";
import { giftRefundedTotal, refundsOf, refundedTotal, splitRefund } from "@/lib/payments/refund";
import { settlePayment, settleWithoutPayment } from "@/lib/payments/settle";
import { adminCookieHeader, makeRequest, PRODUCT, resetIps, setFuzzEnv } from "./fuzz-harness";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const CUSTOMER = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };
const PICKUP = { lang: "RU", items: [{ id: PRODUCT.id, qty: 1 }], customer: CUSTOMER, shipping: { method: "pickup", country: "EE" } };
/** Three of them: a basket a 10 € card cannot cover, whatever the catalogue prices the product at. */
const PICKUP_X3 = { ...PICKUP, items: [{ id: PRODUCT.id, qty: 3 }] };
const GIFT_ONLY = { lang: "RU", items: [{ id: "gift:25", qty: 1 }], customer: CUSTOMER, shipping: { method: "digital", country: "EE" } };
const GIFT_AND_GOODS = { ...PICKUP, items: [{ id: "gift:25", qty: 1 }, { id: PRODUCT.id, qty: 1 }] };

let restoreEnv: () => void = () => {};
let seq = 0;

/** An order the mock bank has paid for, with a provider reference on it. */
async function bankPaid(body: Record<string, unknown>): Promise<Order> {
  seq += 1;
  const order = await createOrder(body as Parameters<typeof createOrder>[0]);
  const out = await settlePayment(
    order,
    { orderRef: order.number, status: "paid", providerRef: `mock_ref_${seq}`, amount: order.total, currency: "EUR" },
    "mock",
  );
  expect(out.status).toBe("paid");
  return (await getOrder(order.id))!;
}

/** The cards an order sold — minted by the paid hook in production, here by hand. */
async function cardsSoldBy(order: Order): Promise<string[]> {
  const cards = await issueGiftCards(order);
  expect(cards.length).toBeGreaterThan(0);
  return cards.map((c) => c.code);
}

/** A card with `balance` on it, issued by nobody in particular. */
async function looseCard(balance: number, code = "RMP-ACDE-4679"): Promise<string> {
  await query("insert into gift_cards (code, amount, balance, lang) values ($1, $2, $3, 'RU')", [code, 100, balance]);
  return code;
}

async function balanceOf(code: string): Promise<number> {
  const c = await getGiftCard(code);
  expect(c, `card ${code} vanished`).toBeTruthy();
  return c!.balance;
}

async function ledger(code: string): Promise<Array<{ amount: number; kind: string; order: string | null }>> {
  const rows = await query<{ amount: string | number; kind: string; order_id: string | null }>(
    "select amount, kind, order_id from gift_card_uses where code = $1 order by id",
    [code],
  );
  return rows.map((r) => ({ amount: Number(r.amount), kind: r.kind, order: r.order_id }));
}

async function refund(id: string, body: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/admin/orders/[id]/refund/route");
  const res = await POST(
    makeRequest(`/api/admin/orders/${id}/refund/`, { method: "POST", body, cookie: adminCookieHeader() }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function refundWebhook(providerOrderRef: string, refundRef: string, amount: number) {
  const { POST } = await import("@/app/api/payments/notify/route");
  const token = signMockRefundTicket({ refundRef, providerOrderRef, amount, status: "done" }, mockSecret());
  const res = await POST(makeRequest("/api/payments/notify/", { method: "POST", body: { mockRefundToken: token } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const money = (n: number) => Math.round(n * 100) / 100;

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

/* ---------- pure ---------------------------------------------------------- */

describe("splitRefund()", () => {
  it("the card first, the provider for the rest", () => {
    expect(splitRefund(30, 20)).toEqual({ gift: 20, money: 10 });
    expect(splitRefund(10, 20)).toEqual({ gift: 10, money: 0 });
    expect(splitRefund(30, 0)).toEqual({ gift: 0, money: 30 });
    expect(splitRefund(0, 20)).toEqual({ gift: 0, money: 0 });
  });
});

/* ---------- (a) an order that bought gift cards ---------------------------- */

describe("refunding an order that bought gift cards", () => {
  it("a full refund cancels the cards it sold: balance 0, voided, the code buys nothing", async () => {
    const order = await bankPaid(GIFT_ONLY);
    const [code] = await cardsSoldBy(order);
    expect(await balanceOf(code)).toBe(25);
    const before = capturedMail().length;

    const out = await refund(order.id);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.fully).toBe(true);
    expect(out.body.money).toBe(25);
    expect(out.body.gift).toBe(0);
    expect(out.body.voided).toEqual([code]);

    const card = (await getGiftCard(code))!;
    expect(card.balance).toBe(0);
    expect(card.voidedAt).toBeTruthy();
    expect(card.redeemedAt).toBeTruthy();
    // …and the checkout will not take it
    expect((await checkGiftCard(code)).ok).toBe(false);
    expect((await applyGiftCard(code, 10)).ok).toBe(false);

    expect((await getOrder(order.id))!.status).toBe("refunded");
    expect(capturedMail().slice(before).map((m) => m.template)).toContain("order-refunded");
    const audit = await query<{ action: string }>("select action from admin_audit where action = 'giftcards.voided'");
    expect(audit).toHaveLength(1);

    // a second press: everything is back already, and the card stays dead
    expect((await refund(order.id)).body.error).toBe("already_refunded");
    expect((await getGiftCard(code))!.balance).toBe(0);
  });

  it("a card somebody has spent from blocks the refund and names the amount — until that spend comes back", async () => {
    const giftOrder = await bankPaid(GIFT_ONLY);
    const [code] = await cardsSoldBy(giftOrder);

    // the card pays for a second order, entirely: total 0, paid at once, no provider
    const shop = await createOrder({ ...PICKUP, discountCode: code });
    expect(shop.total).toBe(0);
    const settled = await settleWithoutPayment(shop);
    expect(settled.status).toBe("paid");
    const spent = money(25 - (await balanceOf(code)));
    expect(spent).toBeGreaterThan(0);

    const refused = await refund(giftOrder.id);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: "gift_used", code, used: spent, amount: 25 });
    expect((await getOrder(giftOrder.id))!.status).toBe("paid");
    expect(await balanceOf(code)).toBe(money(25 - spent));

    // the shop order is refunded: the money goes back onto the card…
    const back = await refund(shop.id);
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    expect(back.body).toMatchObject({ gift: spent, money: 0, giftCode: code, fully: true, status: "refunded" });
    expect(await balanceOf(code)).toBe(25);

    // …and now the card is unused again, so the order that bought it can be refunded
    const ok = await refund(giftOrder.id);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.voided).toEqual([code]);
    expect((await getGiftCard(code))!.balance).toBe(0);
    expect((await getGiftCard(code))!.voidedAt).toBeTruthy();
  });

  it("a partial refund may reach into the goods and the delivery, never into a card", async () => {
    const order = await bankPaid(GIFT_AND_GOODS);
    const [code] = await cardsSoldBy(order);
    const goods = money(order.total - 25);
    expect(goods).toBeGreaterThan(0);

    // the goods part: fine, and the card is untouched
    const part = await refund(order.id, { amount: goods });
    expect(part.status, JSON.stringify(part.body)).toBe(200);
    expect(part.body.fully).toBe(false);
    expect(await balanceOf(code)).toBe(25);
    expect((await getGiftCard(code))!.voidedAt).toBeNull();
    expect((await getOrder(order.id))!.status).toBe("paid");

    // a euro into the card's value: refused, the card is refunded whole or not at all
    const into = await refund(order.id, { amount: 1 });
    expect(into.status).toBe(409);
    expect(into.body.error).toBe("gift_whole");

    // the rest, all of it: the card dies with the refund
    const rest = await refund(order.id);
    expect(rest.status, JSON.stringify(rest.body)).toBe(200);
    expect(rest.body.amount).toBe(25);
    expect(rest.body.fully).toBe(true);
    expect(rest.body.voided).toEqual([code]);
    expect((await getGiftCard(code))!.voidedAt).toBeTruthy();
    expect((await getOrder(order.id))!.status).toBe("refunded");
  });

  it("an all-gift-card order cannot be refunded in part at all", async () => {
    const order = await bankPaid(GIFT_ONLY);
    await cardsSoldBy(order);
    const out = await refund(order.id, { amount: 5 });
    expect(out.status).toBe(409);
    expect(out.body.error).toBe("gift_whole");
    expect((await getOrder(order.id))!.status).toBe("paid");
  });

  it("a refund made in Montonio's own portal cancels the cards too", async () => {
    const order = await bankPaid(GIFT_ONLY);
    const [code] = await cardsSoldBy(order);
    const ref = String((order.payment as { ref: string }).ref);

    const out = await refundWebhook(ref, "portal-refund-1", 25);
    expect(out.status).toBe(200);
    expect(out.body.status).toBe("refunded");
    expect((await getGiftCard(code))!.voidedAt).toBeTruthy();
    expect(await balanceOf(code)).toBe(0);
  });
});

/* ---------- (b) an order paid with a gift card ------------------------------ */

describe("refunding an order a gift card paid for", () => {
  it("an order the card covered entirely is paid at once, and its refund goes back onto the card", async () => {
    const code = await looseCard(50);
    const order = await createOrder({ ...PICKUP, discountCode: code });
    expect(order.total).toBe(0);
    expect(order.status).toBe("new");

    // (c) nothing to pay → paid on the spot, provider «none», in the dispatch queue like any paid order
    await settleWithoutPayment(order);
    const paid = (await getOrder(order.id))!;
    expect(paid.status).toBe("paid");
    expect((paid.payment as { provider: string }).provider).toBe("none");
    expect((paid.payment as { ref: string }).ref).toBe("");
    // …and it stands in the dispatch queue — «Отправить» on «Обзор» counts it
    // (qAttention in src/lib/analytics.ts, the server half of admOrderVM.toShip)
    const { getOverviewSummary } = await import("@/lib/analytics");
    expect((await getOverviewSummary()).attention.ordersToShip).toBe(1);
    const goods = money(50 - (await balanceOf(code)));
    expect(goods).toBeGreaterThan(0);
    expect(await ledger(code)).toEqual([{ amount: goods, kind: "redeem", order: order.id }]);
    const before = capturedMail().length;

    const out = await refund(order.id);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body).toMatchObject({ amount: goods, gift: goods, money: 0, giftCode: code, fully: true, status: "refunded", left: 0 });

    // the card has its money back, and the ledger explains the balance
    expect(await balanceOf(code)).toBe(50);
    expect((await getGiftCard(code))!.redeemedAt).toBeNull();
    expect(await ledger(code)).toEqual([
      { amount: goods, kind: "redeem", order: order.id },
      { amount: -goods, kind: "refund", order: order.id },
    ]);

    // the order's own ledger: one entry, onto the card, no provider entry
    const after = (await getOrder(order.id))!;
    expect(after.status).toBe("refunded");
    // …and «возврат» has left the dispatch queue
    expect((await getOverviewSummary()).attention.ordersToShip).toBe(0);
    const entries = refundsOf(after.payment);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ to: "giftcard", code, amount: goods, status: "done", by: "admin" });
    expect(refundedTotal(after.payment)).toBe(goods);
    expect(giftRefundedTotal(after.payment)).toBe(goods);

    // the customer is told, and told about the card
    const letters = capturedMail().slice(before);
    expect(letters.map((m) => m.template)).toContain("order-refunded");

    // …and once back, it cannot be refunded again
    expect((await refund(order.id)).body.error).toBe("already_refunded");
  });

  it("the letter names the card when the money went back onto it", () => {
    const order = { number: "R-100042", name: "Мария", email: CUSTOMER.email, total: 0 };
    const all = renderOrderCancelled(order, "ru", { kind: "refunded", amount: 16, giftAmount: 16, giftCode: "RMP-ACDE-4679" });
    expect(all.text).toContain("Мы вернули 16 € на подарочную карту RMP-ACDE-4679.");
    expect(all.text).toContain("Картой снова можно платить");
    // the bank's waiting times are not promised for money that is on a card
    expect(all.text).not.toContain("до 5 рабочих дней");
    expect(all.html).toContain("RMP-ACDE-4679");

    const part = renderOrderCancelled(order, "en", { kind: "refunded", amount: 30, giftAmount: 10, giftCode: "RMP-ACDE-4679" });
    expect(part.text).toContain("10 € onto gift card RMP-ACDE-4679");
    expect(part.text).toContain("20 € to your account");

    // a plain refund reads exactly as before
    const plain = renderOrderCancelled(order, "ru", { kind: "refunded", amount: 30 });
    expect(plain.text).toContain("Мы отправили обратно 30 €.");
    expect(plain.text).not.toContain("подарочную карту");
  });

  it("paid partly with a card: the card first, Montonio for the rest — on a full refund and on a partial one", async () => {
    const code = await looseCard(10);
    const order = await createOrder({ ...PICKUP_X3, discountCode: code });
    const total = order.total;
    expect(total, "the basket must cost more than the card holds").toBeGreaterThan(0);
    // the bank pays the rest; the paid transition takes the 10 € off the card
    const paid = await settlePayment(
      order,
      { orderRef: order.number, status: "paid", providerRef: "mock_ref_mixed", amount: total, currency: "EUR" },
      "mock",
    );
    expect(paid.status).toBe("paid");
    expect(await balanceOf(code)).toBe(0);

    // 5 € back: all of it onto the card, nothing asked of Montonio
    const part = await refund(order.id, { amount: 5 });
    expect(part.status, JSON.stringify(part.body)).toBe(200);
    expect(part.body).toMatchObject({ amount: 5, gift: 5, money: 0, fully: false, status: "paid" });
    expect(await balanceOf(code)).toBe(5);
    expect(part.body.left).toBe(money(total + 10 - 5));

    // the rest: the card's other 5 €, then the bank's part through the provider
    const rest = await refund(order.id);
    expect(rest.status, JSON.stringify(rest.body)).toBe(200);
    expect(rest.body).toMatchObject({ amount: money(total + 5), gift: 5, money: total, fully: true, status: "refunded", left: 0 });
    expect(await balanceOf(code)).toBe(10);

    const after = (await getOrder(order.id))!;
    expect(after.status).toBe("refunded");
    const entries = refundsOf(after.payment);
    expect(entries.filter((e) => e.to === "giftcard").map((e) => e.amount)).toEqual([5, 5]);
    expect(entries.filter((e) => e.to !== "giftcard").map((e) => e.amount)).toEqual([total]);
    expect(refundedTotal(after.payment)).toBe(money(total + 10));
    expect(await ledger(code)).toEqual([
      { amount: 10, kind: "redeem", order: order.id },
      { amount: -5, kind: "refund", order: order.id },
      { amount: -5, kind: "refund", order: order.id },
    ]);
  });

  it("refuses more than the order was worth, card included", async () => {
    const code = await looseCard(50);
    const order = await createOrder({ ...PICKUP, discountCode: code });
    await settleWithoutPayment(order);
    const goods = money(50 - (await balanceOf(code)));
    const out = await refund(order.id, { amount: goods + 1 });
    expect(out.status).toBe(400);
    expect(out.body.error).toBe("bad_amount");
    expect(out.body.left).toBe(goods);
  });

  it("an order marked paid by hand still refunds the card's part, and only that", async () => {
    const code = await looseCard(10);
    const order = await createOrder({ ...PICKUP_X3, discountCode: code });
    expect(order.total, "the basket must cost more than the card holds").toBeGreaterThan(0);
    // the card's 10 € were taken on the paid transition; the bank's part was «settled» by hand — no provider id
    await settlePayment(
      order,
      { orderRef: order.number, status: "paid", providerRef: "", amount: order.total, currency: "EUR" },
      "manual",
    );
    await setOrderPayment(order.id, { provider: "manual", ref: "" });
    await setOrderStatus(order.id, "paid", "test");

    // the money part cannot go anywhere from here
    const whole = await refund(order.id);
    expect(whole.status).toBe(409);
    expect(whole.body.error).toBe("no_provider_ref");
    // …but the card's part can
    const card = await refund(order.id, { amount: 10 });
    expect(card.status, JSON.stringify(card.body)).toBe(200);
    expect(card.body).toMatchObject({ gift: 10, money: 0 });
    expect(await balanceOf(code)).toBe(10);
  });
});
