/**
 * «Сделать один раз» for the three writes that are not a POST anybody can key
 * — the card credit on «Вернуть деньги», the card debit at the checkout, and
 * the manual «+50 баллов» on a customer card. Storage and the reasoning:
 * db/migrations/191_gift_loyalty_once.sql.
 *
 * These are NOT wired to runOnce(), and the point of this file is that they do
 * not need a client to be safe. runOnce() protects a REQUEST and needs the
 * browser to mint an `Idempotency-Key`; what is protected here is a row of a
 * money ledger, and the receipt lives in the ledger itself, so the guard works
 * today, through whichever door the repeat arrives at — the admin card, the
 * refund webhook, a second tab.
 *
 * What each one is asked:
 *
 *   · the retry cannot double-credit, double-debit or double-grant;
 *   · a DELIBERATE second one — a second partial refund, a second order
 *     spending the same card, a second adjustment with a different note —
 *     still goes through, because a dedupe that ate one of those would be
 *     worse than the bug it fixed (the «+1 приход» argument in
 *     180_idempotency.sql);
 *   · a caller that names no intention behaves exactly as it did before.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { recordLogin } from "@/lib/customers";
import { creditGiftCard, getGiftCard, redeemGiftCard } from "@/lib/giftcards";
import { adjustLoyaltyPoints, getLoyaltyBalance } from "@/lib/loyalty";
import { createOrder, getOrder, type Order } from "@/lib/orders";
import { giftRefundRef, refundsOf } from "@/lib/payments/refund";
import { settleWithoutPayment } from "@/lib/payments/settle";
import { resetRateLimits as resetPayRateLimits } from "@/lib/payments/ratelimit";
import { adminCookieHeader, makeRequest, PRODUCT, resetIps, setFuzzEnv } from "./fuzz-harness";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const CUSTOMER = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };
const PICKUP = {
  lang: "RU",
  items: [{ id: PRODUCT.id, qty: 1 }],
  customer: CUSTOMER,
  shipping: { method: "pickup", country: "EE" },
};

const money = (n: number) => Math.round(n * 100) / 100;
const ORDER_A = "11111111-1111-4111-8111-111111111111";
const ORDER_B = "22222222-2222-4222-8222-222222222222";

let restoreEnv: () => void = () => {};

/** A card of face `face` with `balance` left on it, issued by nobody. */
async function card(face: number, balance: number, code = "RMP-ACDE-4679"): Promise<string> {
  await query("insert into gift_cards (code, amount, balance, lang) values ($1, $2, $3, 'RU')", [code, face, balance]);
  return code;
}

async function balanceOf(code: string): Promise<number> {
  const c = await getGiftCard(code);
  expect(c, `card ${code} vanished`).toBeTruthy();
  return c!.balance;
}

/** Every line of the card's ledger, oldest first. */
async function ledger(code: string): Promise<Array<{ amount: number; kind: string }>> {
  const rows = await query<{ amount: string | number; kind: string }>(
    "select amount, kind from gift_card_uses where code = $1 order by id",
    [code],
  );
  return rows.map((r) => ({ amount: Number(r.amount), kind: r.kind }));
}

/** An order a gift card paid for in full, settled. */
async function cardPaidOrder(code: string): Promise<Order> {
  const order = await createOrder({ ...PICKUP, discountCode: code } as Parameters<typeof createOrder>[0]);
  await settleWithoutPayment(order);
  return (await getOrder(order.id))!;
}

async function refund(id: string, body: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/admin/orders/[id]/refund/route");
  const res = await POST(
    makeRequest(`/api/admin/orders/${id}/refund/`, { method: "POST", body, cookie: adminCookieHeader() }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/**
 * What a first attempt that DIED ON THE WAY BACK leaves behind: the card was
 * credited, and the line explaining it never reached `orders.payment`. That is
 * the one state the route cannot see and cannot refuse — `refundableAmount()`
 * reads the ledger that is not there, says the whole amount is still
 * refundable, and «Вернуть деньги» is pressable again. Exactly the shape of a
 * 503 out of settleRefund(), which the route already answers `recorded_failed`
 * to, and of a function killed between the two writes.
 */
async function loseTheRecord(orderId: string): Promise<void> {
  await query(
    "update orders set status = 'paid', payment = payment - 'refunds' - 'refundedTotal' where id = $1",
    [orderId],
  );
}

async function patchCustomer(id: string, body: Record<string, unknown>) {
  const { PATCH } = await import("@/app/api/admin/customers/[id]/route");
  const res = await PATCH(
    makeRequest(`/api/admin/customers/${id}/`, { method: "PATCH", body, cookie: adminCookieHeader() }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function adjustRows(customerId: string): Promise<Array<{ delta: number; note: string | null }>> {
  const rows = await query<{ delta: number | string; note: string | null }>(
    "select delta, note from loyalty_ledger where customer_id = $1 and reason = 'adjust' order by id",
    [customerId],
  );
  return rows.map((r) => ({ delta: Number(r.delta), note: r.note }));
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
  await query("truncate customers restart identity cascade");
  resetIps();
  resetPayRateLimits();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------------ *
 * 1. «Вернуть деньги» — the card half
 * ------------------------------------------------------------------------ */

describe("creditGiftCard: a refund lands on a card once", () => {
  /* THE ONE THAT MATTERS. The face-value ceiling in the UPDATE looks like a
     guard and is not one: it only refuses a card that would end up holding
     more than it was sold for, and a card that paid for TWO orders is nowhere
     near that ceiling when the first refund is replayed. */
  it("the same ref twice credits once — and the face-value ceiling would not have stopped it", async () => {
    const code = await card(100, 50); // 50 € of this card has been spent elsewhere

    const first = await creditGiftCard(code, 20, ORDER_A, { ref: "gc:test-one" });
    expect(first).toMatchObject({ ok: true, taken: 20 });
    expect(await balanceOf(code)).toBe(70);

    const again = await creditGiftCard(code, 20, ORDER_A, { ref: "gc:test-one" });
    expect(again).toMatchObject({ ok: true, already: true, taken: 20 });
    // 90 is what the old code did here: 70 + 20 is under the 100 € ceiling
    expect(await balanceOf(code)).toBe(70);
    expect(await ledger(code)).toEqual([{ amount: -20, kind: "refund" }]);
  });

  /* …and the other direction. A partial refund may reach the same card for the
     same order again, on purpose, so (code, order_id) is NOT the identity of a
     credit and a second, deliberate refund must go through. */
  it("a DIFFERENT ref credits again — that is what a second partial refund is", async () => {
    const code = await card(100, 50);

    await creditGiftCard(code, 20, ORDER_A, { ref: "gc:test-one" });
    const second = await creditGiftCard(code, 20, ORDER_A, { ref: "gc:test-two" });

    expect(second).toMatchObject({ ok: true, taken: 20 });
    expect(second.already).toBeFalsy();
    expect(await balanceOf(code)).toBe(90);
    expect(await ledger(code)).toEqual([
      { amount: -20, kind: "refund" },
      { amount: -20, kind: "refund" },
    ]);
  });

  it("no ref at all behaves exactly as before", async () => {
    const code = await card(100, 50);
    await creditGiftCard(code, 20, ORDER_A);
    await creditGiftCard(code, 20, ORDER_A);
    expect(await balanceOf(code)).toBe(90);
    expect(await ledger(code)).toHaveLength(2);
  });

  /* A refused credit must leave nothing behind — the balance change and the
     ledger row are one transaction now, which they were not before. */
  it("a credit past the face value writes no ledger line", async () => {
    const code = await card(100, 90);
    const out = await creditGiftCard(code, 20, ORDER_A, { ref: "gc:too-much" });
    expect(out).toMatchObject({ ok: false, error: "over_face_value" });
    expect(await balanceOf(code)).toBe(90);
    expect(await ledger(code)).toHaveLength(0);
  });

  it("the ref is derived from the order and the ledger, never from a random", () => {
    // same order, same place in the ledger, same amount → the same string
    expect(giftRefundRef(ORDER_A, 0, 12.5)).toBe(giftRefundRef(ORDER_A, 0, 12.5));
    // a second, deliberate refund stands one line further on and is its own
    expect(giftRefundRef(ORDER_A, 0, 12.5)).not.toBe(giftRefundRef(ORDER_A, 1, 12.5));
    expect(giftRefundRef(ORDER_A, 0, 12.5)).not.toBe(giftRefundRef(ORDER_B, 0, 12.5));
    expect(giftRefundRef(ORDER_A, 0, 12.5)).not.toBe(giftRefundRef(ORDER_A, 0, 12.6));
    // …and it is still the `gc:` reference the ledger and the order card read
    expect(giftRefundRef(ORDER_A, 0, 12.5).startsWith("gc:")).toBe(true);
  });
});

describe("«Вернуть деньги»: the reference the card refund is recorded under", () => {
  /* THE ROUTE-LEVEL CHANGE, and the one that fails on the old code: the entry
     the refund writes is now reproducible. Until 17.09.2026 it was
     `gc:${randomUUID()}`, so no second attempt — retry, webhook, second tab —
     could ever name the refund the first one made. */
  it("is derived from the order and the ledger, not drawn fresh", async () => {
    const code = await card(100, 100);
    const a = await cardPaidOrder(code);

    const out = await refund(a.id);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    const gift = Number(out.body.gift);
    expect(gift).toBeGreaterThan(0);

    const entries = refundsOf((await getOrder(a.id))!.payment);
    expect(entries).toHaveLength(1);
    // the money half was 0 here, so this credit stands at the head of the ledger
    expect(entries[0].ref).toBe(giftRefundRef(a.id, 0, gift));
    expect(entries[0]).toMatchObject({ to: "giftcard", code, amount: gift });
  });

  /* …and what that buys. foldRefund() matches an incoming entry to an existing
     one BY REF, so a second recording of the same refund — the webhook landing
     after the admin card — lands ON the line the first one wrote instead of
     appending a twin and reporting more refunded than the order was worth. A
     random ref could not do this even in principle. */
  it("so recording the same refund twice leaves one line and one total", async () => {
    const code = await card(100, 100);
    const a = await cardPaidOrder(code);

    const out = await refund(a.id);
    const gift = Number(out.body.gift);
    const once = (await getOrder(a.id))!;
    const ref = refundsOf(once.payment)[0].ref;

    const { settleRefund } = await import("@/lib/payments/settle");
    await settleRefund(
      once,
      { ref, amount: gift, status: "done", at: new Date().toISOString(), by: "webhook", to: "giftcard", code },
      { notify: false },
    );

    const after = (await getOrder(a.id))!;
    expect(refundsOf(after.payment)).toHaveLength(1);
    expect((after.payment as { refundedTotal?: number }).refundedTotal).toBe(gift);
  });

  /* The other half of the route's own protection, and the one the September
     brief did not know about: the CARD LEDGER already refuses a sequential
     second credit on its own. `giftPaidByOrder()` reads gift_card_uses net of
     refunds, so once the credit is written there is nothing left on the
     order's tab to send back — even when the line in `orders.payment` is gone,
     which is the state a request killed between the two writes leaves. Pinned
     here so nobody removes it believing the ref now covers it. */
  it("and the card ledger alone already refuses the sequential retry", async () => {
    const code = await card(100, 100);
    const a = await cardPaidOrder(code);
    await cardPaidOrder(code); // a second order off the same card: room under the ceiling

    const first = await refund(a.id);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const afterFirst = await balanceOf(code);

    /* …the answer is lost and the line in `orders.payment` never lands. */
    await loseTheRecord(a.id);
    const retry = await refund(a.id);

    // refused — there is nothing left on this order's tab for the card
    expect(retry.status).toBe(409);
    expect(retry.body.gift).toBe(0);
    expect(await balanceOf(code)).toBe(afterFirst);
    expect((await ledger(code)).filter((l) => l.kind === "refund")).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ *
 * 2. redeemGiftCard — the debit at the checkout
 * ------------------------------------------------------------------------ */

describe("redeemGiftCard: one order, one debit", () => {
  it("the same order twice takes the money once", async () => {
    const code = await card(50, 50);

    expect(await redeemGiftCard(code, 20, ORDER_A)).toMatchObject({ ok: true, taken: 20, remaining: 30 });
    expect(await redeemGiftCard(code, 20, ORDER_A)).toMatchObject({ ok: true, already: true, taken: 20 });

    expect(await balanceOf(code)).toBe(30);
    expect(await ledger(code)).toEqual([{ amount: 20, kind: "redeem" }]);
  });

  it("a DIFFERENT order spends the same card again", async () => {
    const code = await card(50, 50);
    await redeemGiftCard(code, 20, ORDER_A);
    expect(await redeemGiftCard(code, 20, ORDER_B)).toMatchObject({ ok: true, taken: 20, remaining: 10 });
    expect(await balanceOf(code)).toBe(10);
    expect(await ledger(code)).toHaveLength(2);
  });

  /* THE HOLE THE OLD GUARD LEFT. The select-then-insert only fired «when
     orderId is passed at all» — a redeem with no order had no dedupe of any
     kind, and its second run simply took the money again. It has one now, and
     it is the same one everything else in this change has: the caller names
     the intention. */
  it("a redeem with NO order id is deduped by its ref", async () => {
    const code = await card(50, 50);

    expect(await redeemGiftCard(code, 20, null, { ref: "gcu:by-hand-1" })).toMatchObject({ ok: true, taken: 20 });
    const again = await redeemGiftCard(code, 20, null, { ref: "gcu:by-hand-1" });

    expect(again).toMatchObject({ ok: true, already: true, taken: 20 });
    expect(await balanceOf(code)).toBe(30);
    expect(await ledger(code)).toEqual([{ amount: 20, kind: "redeem" }]);
  });

  it("…and two DIFFERENT refs with no order id are two real spends", async () => {
    const code = await card(50, 50);
    await redeemGiftCard(code, 20, null, { ref: "gcu:by-hand-1" });
    await redeemGiftCard(code, 20, null, { ref: "gcu:by-hand-2" });
    expect(await balanceOf(code)).toBe(10);
    expect(await ledger(code)).toHaveLength(2);
  });

  /* Naming neither an order nor a ref is the one case left unguarded, on
     purpose: nothing in such a call tells a retry from a second real spend,
     and guessing would be the mistake 180_idempotency.sql argues against. It
     behaves exactly as it always has. */
  it("no order and no ref behaves exactly as before", async () => {
    const code = await card(50, 50);
    await redeemGiftCard(code, 20, null);
    await redeemGiftCard(code, 20, null);
    expect(await balanceOf(code)).toBe(10);
    expect(await ledger(code)).toHaveLength(2);
  });

  /* A row written by the OLD code carries no ref — `ref` is null on every row
     that existed before 191_gift_loyalty_once.sql. A lookup by ref alone would
     read such an order as unspent and debit the card a second time, which is
     why (code, order_id) is still asked first. */
  it("still recognises a spend recorded before the ref column existed", async () => {
    const code = await card(50, 30);
    await query(
      "insert into gift_card_uses (code, order_id, amount, kind) values ($1, $2, 20, 'redeem')",
      [code, ORDER_A],
    );

    const again = await redeemGiftCard(code, 20, ORDER_A);

    expect(again).toMatchObject({ ok: true, already: true, taken: 20, remaining: 30 });
    expect(await balanceOf(code)).toBe(30);
    expect(await ledger(code)).toHaveLength(1);
  });

  it("a refused redeem writes no ledger line and leaves the balance alone", async () => {
    const code = await card(50, 10);
    expect(await redeemGiftCard(code, 20, ORDER_A)).toMatchObject({ ok: false, error: "insufficient" });
    expect(await balanceOf(code)).toBe(10);
    expect(await ledger(code)).toHaveLength(0);
  });

  /* The backstop itself, asked directly. The helper's SELECT answers the
     common case in one round trip; two of them racing past it are refused by
     the index, and that is the half a single-connection test rig (PGlite) can
     never stage as a real race. */
  it("the database itself refuses a second row under one ref", async () => {
    const code = await card(50, 50);
    await redeemGiftCard(code, 20, ORDER_A);
    const ref = await query<{ ref: string }>("select ref from gift_card_uses where code = $1", [code]);
    expect(ref[0].ref).toBeTruthy();

    await expect(
      query("insert into gift_card_uses (code, order_id, amount, kind, ref) values ($1, $2, 5, 'redeem', $3)", [
        code,
        ORDER_B,
        ref[0].ref,
      ]),
    ).rejects.toMatchObject({ code: "23505" });
  });
});

/* ------------------------------------------------------------------------ *
 * 3. adjustLoyaltyPoints — «+50 баллов» on a customer card
 * ------------------------------------------------------------------------ */

describe("adjustLoyaltyPoints: a manual credit is granted once", () => {
  it("the same ref twice grants once and reports what the first one gave", async () => {
    const c = await recordLogin("points@example.com", "RU");

    expect(await adjustLoyaltyPoints(c.id, 50, "подарок", { ref: "adj:one" })).toMatchObject({ ok: true, points: 50 });
    expect(await adjustLoyaltyPoints(c.id, 50, "подарок", { ref: "adj:one" })).toMatchObject({
      ok: true,
      already: true,
      points: 50,
    });

    expect(await getLoyaltyBalance(c.id)).toBe(50);
    expect(await adjustRows(c.id)).toEqual([{ delta: 50, note: "подарок" }]);
  });

  it("a DIFFERENT ref grants again", async () => {
    const c = await recordLogin("points@example.com", "RU");
    await adjustLoyaltyPoints(c.id, 50, "подарок", { ref: "adj:one" });
    await adjustLoyaltyPoints(c.id, 50, "подарок", { ref: "adj:two" });
    expect(await getLoyaltyBalance(c.id)).toBe(100);
  });

  /* Every caller alive today passes no ref — the assistant's action, the test
     seeds — and none of them may change meaning. */
  it("no ref at all behaves exactly as before", async () => {
    const c = await recordLogin("points@example.com", "RU");
    await adjustLoyaltyPoints(c.id, 50, "seed");
    await adjustLoyaltyPoints(c.id, 50, "seed");
    expect(await getLoyaltyBalance(c.id)).toBe(100);
    expect(await adjustRows(c.id)).toHaveLength(2);
  });
});

describe("PATCH /api/admin/customers/<id>: «+50 баллов» pressed twice", () => {
  it("grants the points once and does not double the balance", async () => {
    const c = await recordLogin("card@example.com", "RU");

    const first = await patchCustomer(c.id, { pointsDelta: 50, note: "подарок" });
    expect(first.status, JSON.stringify(first.body)).toBe(200);

    const second = await patchCustomer(c.id, { pointsDelta: 50, note: "подарок" });
    expect(second.status, JSON.stringify(second.body)).toBe(200);

    expect(await getLoyaltyBalance(c.id)).toBe(50);
    expect(await adjustRows(c.id)).toEqual([{ delta: 50, note: "подарок" }]);
    // …and «Журнал» is not told about a correction that did not happen
    const audit = await query<{ n: string }>(
      "select count(*)::text as n from admin_audit where action = 'customer.points_adjust'",
    );
    expect(Number(audit[0].n)).toBe(1);
  });

  it("a second adjustment the owner really meant still goes through", async () => {
    const c = await recordLogin("card@example.com", "RU");
    await patchCustomer(c.id, { pointsDelta: 50, note: "подарок" });
    // a different amount is a different intention…
    await patchCustomer(c.id, { pointsDelta: 30, note: "подарок" });
    // …and so is the same amount said differently
    await patchCustomer(c.id, { pointsDelta: 50, note: "подарок за отзыв" });
    expect(await getLoyaltyBalance(c.id)).toBe(130);
    expect(await adjustRows(c.id)).toHaveLength(3);
  });

  it("the other half of the same PATCH is untouched by the guard", async () => {
    const c = await recordLogin("card@example.com", "RU");
    const out = await patchCustomer(c.id, { pointsDelta: 50, note: "подарок", notes: "постоянный клиент" });
    expect(out.status).toBe(200);
    expect((out.body.customer as { notes?: string }).notes).toBe("постоянный клиент");
    expect(await getLoyaltyBalance(c.id)).toBe(50);
  });

  /**
   * THE DAY IS TALLINN'S, not the machine's. The ref carries the calendar day
   * so that yesterday's identical adjustment is not mistaken for today's, and
   * the shop's day is the one src/lib/day.ts computes (Europe/Tallinn), never
   * UTC. In September Tallinn is UTC+3, so 21:00 and 23:00 UTC on the same
   * date are two different shop days — a tap either side of that boundary is
   * two intentions, and a UTC day would have eaten the second one.
   */
  it("counts the day on the shop's calendar, so an evening pair is two adjustments", async () => {
    const c = await recordLogin("evening@example.com", "RU");
    vi.useFakeTimers({ toFake: ["Date"] });

    vi.setSystemTime(new Date("2026-09-17T21:00:00Z")); // 00:00 on the 18th in Tallinn
    await patchCustomer(c.id, { pointsDelta: 50, note: "вечер" });
    vi.setSystemTime(new Date("2026-09-17T23:00:00Z")); // 02:00 on the 18th — same day
    await patchCustomer(c.id, { pointsDelta: 50, note: "вечер" });
    expect(await getLoyaltyBalance(c.id), "the same Tallinn day is one adjustment").toBe(50);

    vi.setSystemTime(new Date("2026-09-17T20:00:00Z")); // 23:00 on the 17th — the day before
    await patchCustomer(c.id, { pointsDelta: 50, note: "вечер" });
    expect(await getLoyaltyBalance(c.id), "the Tallinn day before is a second one").toBe(100);
  });
});
