/**
 * Paying twice, refunding twice, and the money that goes missing in between
 * (audit round 19, 14.09.2026).
 *
 * Everything here is about the same shape of mistake: two arrivals that each
 * believe they are the first one. Montonio fires the shopper's return and the
 * webhook together and retries the webhook for 48 hours; POST
 * /api/payments/create/ will start a second payment while the first is still
 * in flight; the refund webhook and the order token both say «возвращено»
 * about the same refund; «Вернуть деньги» can be tapped twice on a phone that
 * never saw the answer to the first tap. What is pinned:
 *
 *   · a second payment is recorded BESIDE the first, never on top of it — the
 *     reference a refund goes through has to stay the one that took the money;
 *   · the transition into `paid` is the lock: two doors holding the same
 *     unpaid order settle it once, so the stock comes off once and the
 *     customer is written to once;
 *   · a refund Montonio has accepted but not yet sent (PENDING, up to ten
 *     days, and it can still be CANCELED) does not close the order and does
 *     not cancel the gift cards it sold;
 *   · an order token that says REFUNDED records only what the ledger has not
 *     already got;
 *   · the webhook records what Montonio sent back, measured against what the
 *     customer gave — the money plus what a gift card paid;
 *   · the points an order spent come back with the money;
 *   · a retried refund carries the SAME idempotency key, which is the only
 *     thing that stops Montonio sending the money a second time.
 *
 * Real Postgres (PGlite), the mock provider, and the Montonio provider where
 * only its token carries the field under test.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variantData from "@/data/catalogue.variants.json";
import { query } from "@/lib/db";
import { getGiftCard, issueGiftCards } from "@/lib/giftcards";
import { getLevel, move } from "@/lib/inventory";
import { recordLogin } from "@/lib/customers";
import { adjustLoyaltyPoints, getLoyaltyBalance } from "@/lib/loyalty";
import { capturedMail } from "@/lib/mail";
import { createOrder, getOrder, setOrderPayment, setOrderStatus, type Order } from "@/lib/orders";
import { applyPaymentResult, type ApplyDeps, type OrderLike, type PaymentBlob } from "@/lib/payments/apply";
import { signHs256 } from "@/lib/payments/jwt";
import { mockSecret, signMockRefundTicket } from "@/lib/payments/mock";
import { resetRateLimits as resetPayRateLimits } from "@/lib/payments/ratelimit";
import { refundsOf, refundedTotal, type RefundStatus } from "@/lib/payments/refund";
import { settlePayment } from "@/lib/payments/settle";
import type { VerifyResult } from "@/lib/payments/types";
import { adminCookieHeader, makeRequest, PRODUCT, resetIps, setFuzzEnv } from "./fuzz-harness";
import { setupDb, teardownDb, truncateAll } from "./helpers";

/* ---------- a second payment on an already-paid order --------------------- */

describe("a second payment never takes the first one's reference", () => {
  const order: OrderLike = {
    id: "3f7c0d3e-1111-4444-8888-aaaaaaaaaaaa",
    number: "R-100042",
    status: "paid",
    total: 99.99,
    payment: { provider: "montonio", ref: "first-payment-uuid", status: "paid" },
  };
  const result = (over: Partial<VerifyResult> = {}): VerifyResult => ({
    orderRef: "R-100042",
    status: "paid",
    providerRef: "second-payment-uuid",
    amount: 99.99,
    currency: "EUR",
    ...over,
  });

  function deps() {
    const calls: Array<Record<string, unknown>> = [];
    return {
      calls,
      setOrderPayment: async (_id: string, payment: Record<string, unknown>) => {
        calls.push(payment);
        return {};
      },
      setOrderStatus: async () => ({}),
    } satisfies ApplyDeps & { calls: Array<Record<string, unknown>> };
  }

  it("records it under `repeat`, leaving the reference a refund uses alone", async () => {
    const d = deps();
    const out = await applyPaymentResult(order, result(), "montonio", d);
    expect(out.alreadyPaid).toBe(true);

    const written = d.calls[0];
    // setOrderPayment() merges top-level keys: a `ref` here would replace the
    // one the money actually came in under, and the refund route reads no other
    expect(written.ref).toBeUndefined();
    expect(written).toMatchObject({
      status: "paid",
      repeat: { provider: "montonio", ref: "second-payment-uuid", status: "paid", amount: 99.99 },
    });
  });

  it("a late «не оплачен» from that second payment does not steal it either", async () => {
    const d = deps();
    const out = await applyPaymentResult(order, result({ status: "failed" }), "montonio", d);
    expect(out.keptPaid).toBe(true);
    expect(d.calls[0].ref).toBeUndefined();
    expect((d.calls[0].repeat as PaymentBlob).rejected).toMatchObject({ status: "failed" });
  });

  it("a webhook retry of the SAME payment is written exactly as before", async () => {
    const d = deps();
    await applyPaymentResult(order, result({ providerRef: "first-payment-uuid" }), "montonio", d);
    expect(d.calls[0]).toMatchObject({ provider: "montonio", ref: "first-payment-uuid", status: "paid" });
    expect(d.calls[0].repeat).toBeUndefined();
  });
});

/* ---------- what the receipt of an unfinished payment promises ------------ */

/* The storefront's own source, sliced by function name the way
   tests/invoices.test.ts and tests/checkout-parity.test.ts slice theirs:
   retyping the sentence here would test this file instead of the shop. */
const APP_JS = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

function sliceFn(name: string): string {
  const start = APP_JS.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = APP_JS.indexOf("{", start); i < APP_JS.length; i++) {
    if (APP_JS[i] === "{") depth++;
    else if (APP_JS[i] === "}" && --depth === 0) return APP_JS.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

describe("the receipt of a payment that was started and never finished", () => {
  const done = sliceFn("screenDone");
  const at = (needle: string) => {
    const i = done.indexOf(needle);
    if (i < 0) throw new Error(`screenDone() no longer branches on ${needle}`);
    return i;
  };

  it("says nothing about whether the money was taken", () => {
    /* Montonio's PENDING covers a payment the shopper cancelled AND one the
       bank has taken and not confirmed yet (AUTHORIZED maps here too), so
       «деньги не списаны» on this screen is a promise the shop cannot keep —
       and the retry button under it invites a second charge on top of it. */
    const pending = done.slice(at('d.status === "pending"'));
    expect(pending).toContain("Заказ не оплачен");
    expect(pending, "the pending receipt still claims the money was not taken").not.toContain("не списаны");
    expect(pending).toContain("платить второй раз не нужно");
  });

  it("…while a payment the bank refused still says so, because there it is true", () => {
    const failed = done.slice(at('d.status === "failed"'), at('d.status === "invoice"'));
    expect(failed).toContain("Деньги не списаны.");
  });
});

/* ---------- the whole path, on a real database ---------------------------- */

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const VARIANTS = variantData as Record<string, { sizes: string[]; prices: number[] }>;
const plain = CATALOGUE.find((p) => !VARIANTS[p.id])!;

const CUSTOMER = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };
const PICKUP = { lang: "RU", items: [{ id: PRODUCT.id, qty: 1 }], customer: CUSTOMER, shipping: { method: "pickup", country: "EE" } };

let restoreEnv: () => void = () => {};

function money(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function place(body: Record<string, unknown> = PICKUP): Promise<Order> {
  return (await createOrder(body as Parameters<typeof createOrder>[0])) as unknown as Order;
}

/** An order the mock bank has paid for, with a provider reference on it. */
async function paidOrder(ref: string, body: Record<string, unknown> = PICKUP): Promise<Order> {
  const order = await place(body);
  const out = await settlePayment(
    order,
    { orderRef: order.number, status: "paid", providerRef: ref, amount: Number(order.total), currency: "EUR" },
    "mock",
  );
  expect(out.status).toBe("paid");
  return (await getOrder(order.id))!;
}

/** A card with `balance` on it, issued by nobody in particular. */
async function looseCard(balance: number, code = "RMP-ACDE-4679"): Promise<string> {
  await query("insert into gift_cards (code, amount, balance, lang) values ($1, $2, $3, 'RU')", [code, 100, balance]);
  return code;
}

/** «Вернуть деньги» from a card opened NOW — the panel posts the number of
    refund lines its card shows (`refundsSeen`); see tests/refund-once-per-look.test.ts. */
async function refund(id: string, body: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/admin/orders/[id]/refund/route");
  const seen = "refundsSeen" in body ? {} : { refundsSeen: refundsOf((await getOrder(id))?.payment).length };
  const res = await POST(
    makeRequest(`/api/admin/orders/${id}/refund/`, { method: "POST", body: { ...seen, ...body }, cookie: adminCookieHeader() }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function refundWebhook(providerOrderRef: string, refundRef: string, amount: number, status: RefundStatus = "done") {
  const { POST } = await import("@/app/api/payments/notify/route");
  const token = signMockRefundTicket({ refundRef, providerOrderRef, amount, status }, mockSecret());
  const res = await POST(makeRequest("/api/payments/notify/", { method: "POST", body: { mockRefundToken: token } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("payments and refunds that arrive twice", () => {
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
    await query("delete from gift_cards");
    await query("delete from loyalty_ledger");
    resetIps();
    resetPayRateLimits();
    process.env.PAYMENT_PROVIDER = "mock";
  });

  /* ---------- the return and the webhook racing --------------------------- */

  it("two doors holding the same unpaid order settle it once", async () => {
    await move({ productId: plain.id, delta: 10, reason: "goods_in", actor: "test" });
    const order = await place({ ...PICKUP, items: [{ id: plain.id, qty: 1 }] });
    /* The shopper's return and Montonio's webhook both read the order before
       either of them wrote — that is the race, and it is what makes this one
       object stand for both of them. */
    const snapshot = order;
    const ticket: VerifyResult = {
      orderRef: order.number,
      status: "paid",
      providerRef: "mock_ref_race",
      amount: Number(order.total),
      currency: "EUR",
    };
    const before = capturedMail().length;

    const first = await settlePayment(snapshot, ticket, "mock");
    const second = await settlePayment(snapshot, ticket, "mock");

    expect(first.alreadyPaid).toBe(false);
    expect(second.alreadyPaid, "the second door settled the order a second time").toBe(true);
    expect((await getLevel(plain.id, ""))?.qty, "the stock came off twice").toBe(9);
    expect(
      capturedMail().slice(before).filter((m) => m.template === "order-confirmed"),
      "the customer was written to twice",
    ).toHaveLength(1);
    expect((await getOrder(order.id))!.status).toBe("paid");
  });

  /* ---------- a refund that has not left yet ------------------------------ */

  it("a refund Montonio has not sent yet leaves the order paid and its cards alive", async () => {
    const order = await paidOrder("mock_pending_1", {
      ...PICKUP,
      items: [{ id: "gift:25", qty: 1 }],
      shipping: { method: "digital", country: "EE" },
    });
    const [card] = await issueGiftCards(order);
    expect(card.code).toBeTruthy();

    // PENDING: accepted by Montonio, nothing has left the bank — it can still
    // be CANCELED ten days from now, and nothing un-voids a card
    const pending = await refundWebhook("mock_pending_1", "refund-pending-1", Number(order.total), "pending");
    expect(pending.status).toBe(200);
    expect(pending.body.refundedTotal).toBe(Number(order.total));
    expect(pending.body.status, "a pending refund closed the order").toBe("paid");
    expect((await getOrder(order.id))!.status).toBe("paid");
    expect((await getGiftCard(card.code))!.voidedAt, "a pending refund killed the card").toBeFalsy();

    // SUCCESSFUL for the same refund — now it is money that left
    const done = await refundWebhook("mock_pending_1", "refund-pending-1", Number(order.total), "done");
    expect(done.body.status).toBe("refunded");
    expect((await getOrder(order.id))!.status).toBe("refunded");
    expect((await getGiftCard(card.code))!.voidedAt).toBeTruthy();
  });

  /* ---------- the order token that says REFUNDED -------------------------- */

  it("an order token saying REFUNDED adds nothing on top of the refund webhook", async () => {
    const order = await paidOrder("montonio-order-uuid-1");
    const total = Number(order.total);
    // the refund Renat made in Montonio's portal, under Montonio's own id
    await refundWebhook("montonio-order-uuid-1", "portal-refund-1", total);
    expect(refundedTotal((await getOrder(order.id))!.payment)).toBe(total);
    const letters = capturedMail().length;

    // …and the order webhook for the same order, which says only REFUNDED
    process.env.PAYMENT_PROVIDER = "montonio";
    process.env.MONTONIO_ACCESS_KEY = "ak_test";
    process.env.MONTONIO_SECRET_KEY = "sk_test_secret_at_least_16";
    const orderToken = signHs256(
      {
        accessKey: "ak_test",
        merchantReference: order.number,
        uuid: "montonio-order-uuid-1",
        paymentStatus: "REFUNDED",
        grandTotal: total,
        currency: "EUR",
      },
      "sk_test_secret_at_least_16",
      { expiresInSeconds: 600 },
    );
    const { POST } = await import("@/app/api/payments/notify/route");
    const res = await POST(makeRequest("/api/payments/notify/", { method: "POST", body: { orderToken } }));
    expect(res.status).toBe(200);

    const after = (await getOrder(order.id))!;
    expect(refundedTotal(after.payment), "the same money was counted twice").toBe(total);
    expect(refundsOf(after.payment)).toHaveLength(1);
    expect(capturedMail().length, "a second refund letter went to the customer").toBe(letters);
  });

  /* ---------- what the webhook is allowed to record ----------------------- */

  it("the webhook records what Montonio sent back, gift card included", async () => {
    const code = await looseCard(10);
    const order = await place({ ...PICKUP, items: [{ id: PRODUCT.id, qty: 3 }], discountCode: code });
    const total = Number(order.total);
    expect(total, "the basket must cost more than the card holds").toBeGreaterThan(0);
    const paid = await settlePayment(
      order,
      { orderRef: order.number, status: "paid", providerRef: "mock_mixed_1", amount: total, currency: "EUR" },
      "mock",
    );
    expect(paid.status).toBe("paid");

    // the card's 10 € go back onto the card first
    const part = await refund(order.id, { amount: 10 });
    expect(part.status, JSON.stringify(part.body)).toBe(200);
    expect(part.body).toMatchObject({ gift: 10, money: 0 });

    // Montonio sends the money part back from its own portal: all of it, and
    // it is not narrowed by the 10 € that went onto the card
    const out = await refundWebhook("mock_mixed_1", "portal-refund-2", total);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    const entry = refundsOf((await getOrder(order.id))!.payment).find((r) => r.ref === "portal-refund-2");
    expect(entry?.amount, "the bank's refund was clipped by the card's").toBe(total);
    expect(out.body.refundedTotal).toBe(money(total + 10));
    expect((await getOrder(order.id))!.status).toBe("refunded");
  });

  /* ---------- the same refund, sent twice --------------------------------- */

  it("a retried refund carries the same idempotency key", async () => {
    const order = await paidOrder("mock_retry_1");
    const first = await refund(order.id, { amount: 5 });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const one = refundsOf((await getOrder(order.id))!.payment)[0];
    // the stand-in bank builds its own id out of the key it was handed, so the
    // ledger entry's ref IS the key, seen from the other side
    expect(one.ref).toMatch(/^mockref_/);

    /* The attempt that timed out: Montonio took it, the answer never came
       back, and nothing was written here. The owner presses the button again. */
    await setOrderPayment(order.id, { refunds: [], refundedTotal: 0 });
    // …and the attempt that died left no answer to replay (src/lib/idempotency.ts)
    await query("delete from idempotency_keys where key like $1", [`refund:${order.id}:%`]);
    const again = await refund(order.id, { amount: 5 });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    const two = refundsOf((await getOrder(order.id))!.payment)[0];
    expect(two.ref, "Montonio was handed a fresh key and would send the money twice").toBe(one.ref);
  });

  /* ---------- points on a refunded order ---------------------------------- */

  it("the points an order spent come back when it is refunded", async () => {
    await query("insert into settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = $2::jsonb", [
      "pricing",
      JSON.stringify({ partnersOn: true, loyalty: { enabled: true, earnPct: 0, redeemMaxPct: 30, minRedeem: 5 } }),
    ]);
    const customer = await recordLogin(`points-${Date.now()}@example.com`, "RU");
    await adjustLoyaltyPoints(customer.id, 40, "seed");
    const order = await createOrder(
      { ...PICKUP, items: [{ id: PRODUCT.id, qty: 3 }], redeemPoints: true } as Parameters<typeof createOrder>[0],
      { customerId: customer.id },
    );
    const spent = Math.round(Number(order.loyaltyDiscount));
    expect(spent, "«Использовать баллы» took nothing — the basket is too small").toBeGreaterThan(0);

    await settlePayment(
      order as unknown as OrderLike,
      { orderRef: order.number, status: "paid", providerRef: "mock_points_1", amount: Number(order.total), currency: "EUR" },
      "mock",
    );
    expect(await getLoyaltyBalance(customer.id)).toBe(40 - spent);

    await setOrderStatus(order.id, "refunded", "admin");
    expect(await getLoyaltyBalance(customer.id), "the refund kept the points").toBe(40);

    // and only once, however many times the order is walked back into «возврат»
    await setOrderStatus(order.id, "paid", "admin");
    await setOrderStatus(order.id, "refunded", "admin");
    expect(await getLoyaltyBalance(customer.id)).toBe(40);
  });
});
