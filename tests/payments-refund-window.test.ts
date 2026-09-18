/**
 * The window between the two ledgers — «Вернуть деньги» pressed a second time
 * on an order a gift card and a bank both paid for (audit 18.09.2026, F1/F4).
 *
 * A refund on such an order writes THREE things in three separate statements:
 * Montonio's own refund, the line for it in `orders.payment`, and the credit
 * back onto the card in `gift_card_uses` — plus a fourth line for the card.
 * Anything may die between any two of them: a 15-second timeout on the
 * provider, a 503 out of settleRefund(), a serverless function that simply
 * stops. The owner then sees «не удалось», and he presses the button again,
 * because that is what a button that failed is for.
 *
 * The whole promise of a DERIVED reference is that the second press is the
 * SAME REFUND — the same idempotency key at Montonio, the same `gc:` ref on
 * the card ledger — whatever the half-written state in between looks like. It
 * held for an order a card had paid for on its own, and it did not hold for a
 * mixed one: the card's share of the split was clamped by the card ledger,
 * which the first attempt had already moved, while the sequence the keys are
 * derived from was counted off `orders.payment`, which it had not. The retry
 * re-split the same refund, and the remainder went to Montonio as real money.
 *
 * What is asked here:
 *
 *   · the retry after a successful card credit and a lost line derives the
 *     same split, credits nothing twice and asks the bank for nothing;
 *   · a DELIBERATE second refund is still a second refund;
 *   · a refund whose answer was lost is written down from Montonio's own
 *     refund list, so «сумма должна быть в списке возвратов» is true when the
 *     owner is told it;
 *   · the ten-day clock on a pending refund runs from the refund, not from
 *     the last notice about it.
 *
 * Real Postgres (PGlite), the mock provider for the bank, fetch stubbed where
 * the real Montonio client is under test.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { getGiftCard } from "@/lib/giftcards";
import { createOrder, getOrder, setOrderPayment, type Order } from "@/lib/orders";
import { pendingRefunds } from "@/lib/payments/pending-refunds";
import {
  foldRefund,
  giftOwedByCard,
  giftRefundRef,
  refundedTotal,
  refundsOf,
} from "@/lib/payments/refund";
import { settlePayment } from "@/lib/payments/settle";
import { resetRateLimits as resetPayRateLimits } from "@/lib/payments/ratelimit";
import { adminCookieHeader, makeRequest, PRODUCT, resetIps, setFuzzEnv } from "./fuzz-harness";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const CUSTOMER = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };
/** Three of them, so the basket costs more than any card in this file holds. */
const PICKUP_X3 = {
  lang: "RU",
  items: [{ id: PRODUCT.id, qty: 3 }],
  customer: CUSTOMER,
  shipping: { method: "pickup", country: "EE" },
};

const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const CARD = "RMP-ACDE-4679";
const ORDER_UUID = "12228dce-2f7c-4db5-8d28-5d82a19aa3b6";
const REFUND_UUID = "8f4c1f3e-9a21-4b77-9f0e-2c6d5b8a1e44";

let restoreEnv: () => void = () => {};

async function card(balance: number, code = CARD): Promise<string> {
  await query("insert into gift_cards (code, amount, balance, lang) values ($1, 100, $2, 'RU')", [code, balance]);
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

/**
 * An order a gift card and the bank both paid for: the card's balance goes on
 * the basket at the checkout, the bank pays what is left, and the paid
 * transition takes the card's part off it for real.
 */
async function mixedOrder(cardBalance: number, providerRef = "mock_ref_mixed"): Promise<Order> {
  const code = await card(cardBalance);
  const order = await createOrder({ ...PICKUP_X3, discountCode: code } as Parameters<typeof createOrder>[0]);
  expect(order.total, "the basket must cost more than the card holds").toBeGreaterThan(0);
  const paid = await settlePayment(
    order,
    { orderRef: order.number, status: "paid", providerRef, amount: order.total, currency: "EUR" },
    "mock",
  );
  expect(paid.status).toBe("paid");
  expect(await balanceOf(code)).toBe(0);
  return (await getOrder(order.id))!;
}

/**
 * What a card credit that landed and a line that never did leaves behind.
 *
 * `creditGiftCard()` has committed — the card holds the money and
 * `gift_card_uses` has the negative row that explains it — and the statement
 * that would have written the matching line into `orders.payment` did not run:
 * a 503 out of settleRefund(), which this route already answers
 * `recorded_failed` to, or a function killed between the two writes. The money
 * half of the same refund, if there was one, IS recorded: it is written first,
 * before the card is touched at all.
 *
 * So: drop the `giftcard` lines from the ledger and put the order back where
 * it was. Everything else stays exactly as the first attempt left it.
 */
async function loseTheGiftLine(orderId: string): Promise<void> {
  const order = (await getOrder(orderId))!;
  const kept = refundsOf(order.payment).filter((r) => r.to !== "giftcard");
  await setOrderPayment(orderId, { refunds: kept, refundedTotal: refundedTotal({ refunds: kept }) });
  await query("update orders set status = 'paid' where id = $1", [orderId]);
}

async function refund(id: string, body: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/admin/orders/[id]/refund/route");
  const res = await POST(
    makeRequest(`/api/admin/orders/${id}/refund/`, { method: "POST", body, cookie: adminCookieHeader() }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Every call the bank was asked to make, with the key it was asked under. */
async function watchTheBank(): Promise<{ calls: Array<{ key: string; amount: number }>; stop: () => void }> {
  const { MockProvider } = await import("@/lib/payments/mock");
  const calls: Array<{ key: string; amount: number }> = [];
  const real = MockProvider.prototype.refundPayment;
  const spy = vi
    .spyOn(MockProvider.prototype, "refundPayment")
    .mockImplementation(async function (this: InstanceType<typeof MockProvider>, req) {
      calls.push({ key: req.idempotencyKey, amount: req.amount });
      return real.call(this, req);
    });
  return { calls, stop: () => spy.mockRestore() };
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
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------------ *
 * 1. F1 — the retry is the same refund, on a mixed order too
 * ------------------------------------------------------------------------ */

describe("«Вернуть деньги» twice on a card + bank order", () => {
  /* The finding's own arithmetic. 6 € back off an order a 10 € card helped
     pay for: the card takes all of it and the bank is not asked. The credit
     lands, the line does not. The second press used to read the CARD ledger —
     which now says 4 € left on the order's tab — re-split the same 6 € as
     «4 onto the card, 2 through Montonio», and 2 € of real money left the shop
     for a refund that was already paid in full. */
  it("does not re-split the refund when the card credit landed and the line did not", async () => {
    const order = await mixedOrder(10);
    const bank = await watchTheBank();

    try {
      const first = await refund(order.id, { amount: 6 });
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body).toMatchObject({ gift: 6, money: 0 });
      expect(await balanceOf(CARD)).toBe(6);
      const firstRef = refundsOf((await getOrder(order.id))!.payment)[0].ref;

      // …and the line never reaches `orders.payment`
      await loseTheGiftLine(order.id);
      expect(refundsOf((await getOrder(order.id))!.payment)).toHaveLength(0);

      const retry = await refund(order.id, { amount: 6 });
      expect(retry.status, JSON.stringify(retry.body)).toBe(200);
      // the same split, not a new one: all 6 € on the card, nothing to the bank
      expect(retry.body).toMatchObject({ gift: 6, money: 0 });
      expect(bank.calls, "the bank must not be asked for a refund the card covered").toEqual([]);
    } finally {
      bank.stop();
    }

    // one credit, one line, one refund — the card is not 10 € richer
    expect(await balanceOf(CARD)).toBe(6);
    expect((await ledger(CARD)).filter((l) => l.kind === "refund")).toEqual([{ amount: -6, kind: "refund" }]);
    const after = (await getOrder(order.id))!;
    const entries = refundsOf(after.payment);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ to: "giftcard", amount: 6, code: CARD });
    expect(refundedTotal(after.payment)).toBe(6);
  });

  /* The same window on a FULL refund, which is the expensive one: the money
     half is recorded first and really has gone, so the retry that re-split
     sent the card's whole share to the bank a second time. 100 € order paid
     30 € card + 70 € bank, refunded in full, the card's line lost: 130 € out
     and the customer 30 € up. */
  it("does not send the card's share to the bank when the retry follows a lost line", async () => {
    const order = await mixedOrder(10);
    const total = order.total;
    const worth = money(total + 10);
    const bank = await watchTheBank();

    try {
      const first = await refund(order.id);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body).toMatchObject({ gift: 10, money: total, fully: true });
      expect(await balanceOf(CARD)).toBe(10);
      expect(bank.calls).toHaveLength(1);

      /* The money half is on the ledger — it is written before the card is
         touched — and the card's line is the one that was lost. */
      await loseTheGiftLine(order.id);
      const half = (await getOrder(order.id))!;
      expect(refundsOf(half.payment).map((r) => r.amount)).toEqual([total]);
      expect(half.status).toBe("paid");

      const retry = await refund(order.id);
      expect(retry.status, JSON.stringify(retry.body)).toBe(200);
      expect(retry.body).toMatchObject({ gift: 10, money: 0 });
      // the bank was asked once, for the bank's part, and never again
      expect(bank.calls.map((c) => c.amount)).toEqual([total]);
    } finally {
      bank.stop();
    }

    const after = (await getOrder(order.id))!;
    const entries = refundsOf(after.payment);
    expect(entries.filter((e) => e.to !== "giftcard").map((e) => e.amount)).toEqual([total]);
    expect(entries.filter((e) => e.to === "giftcard").map((e) => e.amount)).toEqual([10]);
    expect(refundedTotal(after.payment)).toBe(worth);
    expect(after.status).toBe("refunded");
    // one credit on the card, one row explaining it
    expect(await balanceOf(CARD)).toBe(10);
    expect((await ledger(CARD)).filter((l) => l.kind === "refund")).toHaveLength(1);
  });

  /* …and the derived ref is the SAME string, which is what makes both of the
     above true rather than lucky. The first attempt's `gc:` ref is recomputed
     from the state the retry finds. */
  it("derives the same gc: reference on both presses", async () => {
    const order = await mixedOrder(10);
    const first = await refund(order.id, { amount: 6 });
    expect(first.status).toBe(200);
    const was = refundsOf((await getOrder(order.id))!.payment)[0].ref;

    await loseTheGiftLine(order.id);
    const retry = await refund(order.id, { amount: 6 });
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);

    const now = refundsOf((await getOrder(order.id))!.payment)[0].ref;
    expect(now).toBe(was);
    expect(now).toBe(giftRefundRef(order.id, 0, 6));
  });

  /* The other half of the rule, and the reason the fix is not «never credit a
     card twice»: a second partial refund the owner MEANS is a second refund.
     It counts one line further, derives a different ref and goes through. */
  it("still lets a deliberate second partial refund through", async () => {
    const order = await mixedOrder(10);

    const first = await refund(order.id, { amount: 6 });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const second = await refund(order.id, { amount: 4 });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body).toMatchObject({ gift: 4, money: 0 });

    const entries = refundsOf((await getOrder(order.id))!.payment);
    expect(entries.map((e) => e.amount)).toEqual([6, 4]);
    expect(entries[0].ref).not.toBe(entries[1].ref);
    expect(await balanceOf(CARD)).toBe(10);
    expect((await ledger(CARD)).filter((l) => l.kind === "refund")).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------------ *
 * 2. giftOwedByCard — one blob feeds the split
 * ------------------------------------------------------------------------ */

describe("giftOwedByCard reads orders.payment and nothing else", () => {
  const paid = [{ code: "RMP-AAAA-1111", amount: 30 }];

  it("owes the whole share while the blob knows of no refund", () => {
    expect(giftOwedByCard(paid, { refunds: [] })).toEqual([{ code: "RMP-AAAA-1111", amount: 30, owed: 30 }]);
  });

  it("takes off what the blob says went back to that card, and only that", () => {
    const payment = {
      refunds: [
        { ref: "gc:a", amount: 20, status: "done", at: "", to: "giftcard", code: "RMP-AAAA-1111" },
        { ref: "m1", amount: 70, status: "done", at: "" },
        { ref: "gc:b", amount: 5, status: "done", at: "", to: "giftcard", code: "RMP-BBBB-2222" },
      ],
    };
    expect(giftOwedByCard(paid, payment)[0].owed).toBe(10);
  });

  it("a failed credit is money that never went back, so it is still owed", () => {
    const payment = {
      refunds: [{ ref: "gc:a", amount: 20, status: "failed", at: "", to: "giftcard", code: "RMP-AAAA-1111" }],
    };
    expect(giftOwedByCard(paid, payment)[0].owed).toBe(30);
  });

  it("a giftcard line that names no card still comes off the tab", () => {
    const payment = { refunds: [{ ref: "gc:old", amount: 12, status: "done", at: "", to: "giftcard" }] };
    expect(giftOwedByCard(paid, payment)[0].owed).toBe(18);
  });

  it("never goes below zero", () => {
    const payment = {
      refunds: [{ ref: "gc:a", amount: 99, status: "done", at: "", to: "giftcard", code: "RMP-AAAA-1111" }],
    };
    expect(giftOwedByCard(paid, payment)[0].owed).toBe(0);
  });
});

/* ------------------------------------------------------------------------ *
 * 3. F4 — a refund whose answer was lost is written down from Montonio's own
 *    list, so the sentence the owner is shown is true
 * ------------------------------------------------------------------------ */

describe("a refund Montonio made and never got to tell us about", () => {
  /** The order snapshot `GET /orders/:uuid` answers with. */
  function snapshot(refunds: Array<{ uuid: string; amount: number; status: string }>, total: number) {
    return {
      uuid: ORDER_UUID,
      paymentStatus: refunds.length ? "PARTIALLY_REFUNDED" : "PAID",
      grandTotal: total,
      currency: "EUR",
      availableForRefund: money(total - refunds.reduce((s, r) => s + r.amount, 0)),
      isRefundableType: true,
      refunds,
    };
  }

  /**
   * Montonio with the network under our thumb: `POST /refunds` behaves as
   * `post` says, `GET /orders/:uuid` answers with `order`.
   */
  function stubMontonio(post: { throws: true } | { status: number; body: unknown }, order: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/refunds") && init?.method === "POST") {
          if ("throws" in post) throw new Error("socket hang up");
          return new Response(JSON.stringify(post.body), {
            status: post.status,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.includes(`/orders/${ORDER_UUID}`)) {
          return new Response(JSON.stringify(order), { status: 200, headers: { "content-type": "application/json" } });
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
  }

  /** An order the real Montonio provider took, by bank alone. */
  async function montonioOrder(): Promise<Order> {
    process.env.PAYMENT_PROVIDER = "montonio";
    process.env.MONTONIO_ACCESS_KEY = "ak_test";
    process.env.MONTONIO_SECRET_KEY = "sk_test_secret_key_long_enough";
    process.env.MONTONIO_ENV = "sandbox";
    const order = await createOrder(PICKUP_X3 as Parameters<typeof createOrder>[0]);
    await settlePayment(
      order,
      { orderRef: order.number, status: "paid", providerRef: ORDER_UUID, amount: order.total, currency: "EUR" },
      "montonio",
    );
    return (await getOrder(order.id))!;
  }

  /* Fifteen seconds is what the client gives POST /refunds. Montonio took the
     request, made the refund and answered into a socket nobody was holding.
     The catch block used to write an audit row and a 502 and no ledger entry
     at all — so the card offered the whole amount again, `pendingRefunds()`
     could not see it, and the retry sent the owner to look for the amount in
     a list that was empty because of the very failure he was retrying. */
  it("is written down from GET /orders/:uuid when the answer is lost", async () => {
    const order = await montonioOrder();
    stubMontonio({ throws: true }, snapshot([{ uuid: REFUND_UUID, amount: 5, status: "SUCCESSFUL" }], order.total));

    const lost = await refund(order.id, { amount: 5 });
    expect(lost.status).toBe(502);
    expect(lost.body.error).toBe("provider_unreachable");
    expect(lost.body.recorded).toEqual([{ ref: REFUND_UUID, amount: 5, status: "done" }]);

    const after = (await getOrder(order.id))!;
    const entries = refundsOf(after.payment);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ ref: REFUND_UUID, amount: 5, status: "done", by: "montonio" });
    // …and `left` has shrunk by it, so a different amount cannot quietly be a second refund
    expect(refundedTotal(after.payment)).toBe(5);
  });

  /* A refund Montonio has only ACCEPTED is money on its way out, not money
     back: it counts towards the total, it shows up in the pending list with
     its ten-day clock, and it does not close the order. */
  it("a PENDING one lands in the pending list and does not close the order", async () => {
    const order = await montonioOrder();
    stubMontonio({ throws: true }, snapshot([{ uuid: REFUND_UUID, amount: 5, status: "PENDING" }], order.total));

    expect((await refund(order.id, { amount: 5 })).status).toBe(502);

    const after = (await getOrder(order.id))!;
    expect(refundsOf(after.payment)[0]).toMatchObject({ status: "pending" });
    expect(after.status).toBe("paid");

    const pending = await pendingRefunds();
    expect(pending.map((p) => p.ref)).toEqual([REFUND_UUID]);
    expect(pending[0].amount).toBe(5);
  });

  /* The retry after that. Our key is derived, so Montonio recognises it and
     refuses — correctly, and with the one message that means the opposite of
     failure. The sentence sends the owner to the order's refund list, and
     the list now has the amount in it. */
  it("and the retry's refusal names a list the amount is really in", async () => {
    const order = await montonioOrder();
    stubMontonio({ throws: true }, snapshot([{ uuid: REFUND_UUID, amount: 5, status: "SUCCESSFUL" }], order.total));
    expect((await refund(order.id, { amount: 5 })).status).toBe(502);

    stubMontonio(
      {
        status: 400,
        body: { message: `Order uuid [${ORDER_UUID}] already has a refund with same idempotency key` },
      },
      snapshot([{ uuid: REFUND_UUID, amount: 5, status: "SUCCESSFUL" }], order.total),
    );
    const again = await refund(order.id, { amount: 5 });
    expect(again.status).toBe(502);
    expect(again.body.reason).toBe("duplicate_key");
    const messages = again.body.messages as Record<string, string>;
    expect(messages.RU).toContain("Сумма записана в заказ");
    expect(messages.RU).not.toContain("должна быть в списке");

    // still one refund on the order: the adoption is idempotent on the uuid
    expect(refundsOf((await getOrder(order.id))!.payment)).toHaveLength(1);
  });

  /* The lookup is an explanation, never a gate, and it must not turn silence
     into a promise: a duplicate key Montonio will not explain leaves the
     owner told that the amount is NOT in the list and sent to Montonio's own
     panel, which is the truth. */
  it("says the amount is missing when the list could not be read", async () => {
    const order = await montonioOrder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith("/refunds") && init?.method === "POST") {
          return new Response(
            JSON.stringify({ message: `Order uuid [${ORDER_UUID}] already has a refund with same idempotency key` }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error("GET is down too");
      }),
    );

    const out = await refund(order.id, { amount: 5 });
    expect(out.status).toBe(502);
    expect(out.body.reason).toBe("duplicate_key");
    expect(out.body.recorded).toBeUndefined();
    const messages = out.body.messages as Record<string, string>;
    expect(messages.RU).toContain("записать его в заказ не удалось");
    expect(refundsOf((await getOrder(order.id))!.payment)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------ *
 * 4. F20 — the ten-day clock runs from the refund, not from the last notice
 * ------------------------------------------------------------------------ */

describe("a pending refund's clock", () => {
  it("foldRefund stamps `since` once and never moves it", () => {
    const first = foldRefund(null, { ref: "r1", amount: 5, status: "pending", at: "2026-09-01T00:00:00.000Z" });
    expect(first.refunds[0].since).toBe("2026-09-01T00:00:00.000Z");

    const later = foldRefund({ refunds: first.refunds }, {
      ref: "r1",
      amount: 5,
      status: "pending",
      at: "2026-09-09T00:00:00.000Z",
    });
    expect(later.refunds[0].at).toBe("2026-09-09T00:00:00.000Z");
    expect(later.refunds[0].since).toBe("2026-09-01T00:00:00.000Z");
  });

  /* Montonio retries an under-funded refund by itself and the shop hears about
     it; every notice used to reset the countdown, so the refund the flag was
     built for — one nudged along for ten days and then cancelled — could never
     become overdue. */
  it("counts the days from the refund, not from Montonio's last notice", async () => {
    const order = await createOrder(PICKUP_X3 as Parameters<typeof createOrder>[0]);
    await settlePayment(
      order,
      { orderRef: order.number, status: "paid", providerRef: "mock_ref_clock", amount: order.total, currency: "EUR" },
      "mock",
    );
    const { settleRefund } = await import("@/lib/payments/settle");

    const fresh = (await getOrder(order.id))!;
    await settleRefund(
      fresh,
      { ref: "rf-1", amount: 5, status: "pending", at: "2026-09-01T00:00:00.000Z", by: "admin" },
      { notify: false },
    );
    // …Montonio says «still pending» a week later
    await settleRefund(
      (await getOrder(order.id))!,
      { ref: "rf-1", amount: 5, status: "pending", at: "2026-09-08T00:00:00.000Z", by: "webhook" },
      { notify: false },
    );

    const list = await pendingRefunds({ now: new Date("2026-09-12T00:00:00.000Z") });
    const one = list.find((p) => p.ref === "rf-1");
    expect(one, "the pending refund must be listed").toBeTruthy();
    expect(one!.at).toBe("2026-09-08T00:00:00.000Z");
    expect(one!.since).toBe("2026-09-01T00:00:00.000Z");
    expect(one!.hours).toBe(11 * 24);
    expect(one!.overdue).toBe(true);
  });
});
