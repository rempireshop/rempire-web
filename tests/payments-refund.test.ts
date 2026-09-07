/**
 * Money going back — «Вернуть деньги» in the admin, and the refund webhook.
 *
 * Before 07.09.2026 a refund happened in Montonio's own portal and this shop
 * never learned about it: `mapMontonioStatus` folded REFUNDED into `paid`, the
 * refund webhook was answered 200 and thrown away, and the order card went on
 * saying «Оплачен» for ever. What is pinned here:
 *
 *   · the payload Montonio's refunds guide asks for — `{data:<jwt>}` to
 *     POST /refunds, with accessKey, orderUuid, amount and an idempotencyKey;
 *   · a full refund moves the order to «возврат», puts the stock back and
 *     writes to the customer, once;
 *   · a partial one leaves the order paid and only shrinks what is left;
 *   · the same refund id twice — Montonio retries for 48 hours — folds into
 *     one entry and sends no second letter;
 *   · a refund made in Montonio's portal lands here through the webhook;
 *   · a shop with no keys says so and does not crash.
 *
 * Real Postgres (PGlite), the mock provider for the route, fetch stubbed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyHs256 } from "@/lib/payments/jwt";
import { capturedMail } from "@/lib/mail";
import { query } from "@/lib/db";
import { getOrder, setOrderPayment, setOrderStatus, type Order } from "@/lib/orders";
import {
  mapMontonioRefundStatus,
  mapMontonioStatus,
  montonioRefundKind,
  MontonioProvider,
} from "@/lib/payments/montonio";
import { mockSecret, signMockRefundTicket } from "@/lib/payments/mock";
import { resetRateLimits as resetPayRateLimits } from "@/lib/payments/ratelimit";
import {
  foldRefund,
  fullyRefunded,
  refundableAmount,
  refundedTotal,
  refundsOf,
  type RefundStatus,
} from "@/lib/payments/refund";
import { adminCookieHeader, makeRequest, PRODUCT, resetIps, setFuzzEnv } from "./fuzz-harness";
import { setupDb, teardownDb, truncateAll } from "./helpers";

/* ---------- pure --------------------------------------------------------- */

describe("Montonio's words for a refund", () => {
  it("REFUNDED and PARTIALLY_REFUNDED are still a paid payment", () => {
    // the money DID arrive; it going back is the second movement
    expect(mapMontonioStatus("REFUNDED")).toBe("paid");
    expect(mapMontonioStatus("PARTIALLY_REFUNDED")).toBe("paid");
    expect(montonioRefundKind("REFUNDED")).toBe("full");
    expect(montonioRefundKind("PARTIALLY_REFUNDED")).toBe("partial");
    expect(montonioRefundKind("PAID")).toBeUndefined();
  });

  it("maps the five refund statuses, and never calls an unknown one finished", () => {
    expect(mapMontonioRefundStatus("SUCCESSFUL")).toBe("done");
    expect(mapMontonioRefundStatus("PENDING")).toBe("pending");
    expect(mapMontonioRefundStatus("PROCESSING")).toBe("pending");
    expect(mapMontonioRefundStatus("REJECTED")).toBe("failed");
    expect(mapMontonioRefundStatus("CANCELED")).toBe("failed");
    expect(mapMontonioRefundStatus("SOMETHING_NEW")).toBe("pending");
    expect(mapMontonioRefundStatus(undefined)).toBe("pending");
  });
});

describe("the ledger on orders.payment", () => {
  const entry = (ref: string, amount: number, status: "pending" | "done" | "failed" = "done") => ({
    ref,
    amount,
    status,
    at: "2026-09-07T10:00:00.000Z",
  });

  it("the same refund id twice is one entry and one amount", () => {
    const first = foldRefund({}, entry("r1", 10));
    expect(first.applied).toBe(true);
    expect(first.refundedTotal).toBe(10);

    const again = foldRefund({ refunds: first.refunds }, entry("r1", 10));
    expect(again.applied).toBe(false);
    expect(again.refunds).toHaveLength(1);
    expect(again.refundedTotal).toBe(10);
  });

  it("a pending refund counts, a rejected one frees the money up again", () => {
    const pending = foldRefund({}, entry("r1", 10, "pending"));
    expect(pending.refundedTotal).toBe(10);
    // PENDING → SUCCESSFUL is the same refund, not a second one
    const settled = foldRefund({ refunds: pending.refunds }, entry("r1", 10, "done"));
    expect(settled.applied).toBe(false);
    expect(settled.refundedTotal).toBe(10);
    const rejected = foldRefund({ refunds: settled.refunds }, entry("r1", 10, "failed"));
    expect(rejected.refundedTotal).toBe(0);
    expect(refundsOf({ refunds: rejected.refunds })[0].status).toBe("failed");
  });

  it("two partials add up, and what is left never goes below zero", () => {
    const one = foldRefund({}, entry("r1", 12.34));
    const two = foldRefund({ refunds: one.refunds }, entry("r2", 7.66));
    expect(two.refundedTotal).toBe(20);
    expect(refundableAmount(20, { refunds: two.refunds })).toBe(0);
    expect(refundableAmount(15, { refunds: two.refunds })).toBe(0);
    expect(refundedTotal(null)).toBe(0);
    expect(refundsOf({ refunds: "nonsense" })).toEqual([]);
  });

  it("«fully refunded» tolerates the half-cent a provider rounds to", () => {
    expect(fullyRefunded(20, 19.999)).toBe(true);
    expect(fullyRefunded(20, 19.98)).toBe(false);
    expect(fullyRefunded(0, 0)).toBe(false);
  });
});

/* ---------- the Montonio call -------------------------------------------- */

describe("POST /refunds — the envelope Montonio's guide asks for", () => {
  const provider = new MontonioProvider({ accessKey: "ak_test", secretKey: "sk_test_secret", env: "sandbox" });
  let sent: { url: string; body: string } | null = null;

  function stub(status: number, body: unknown) {
    sent = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        sent = { url: String(input), body: String(init?.body ?? "") };
        return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      }),
    );
  }

  afterEach(() => vi.unstubAllGlobals());

  it("signs the refund into the body and reads the answer back", async () => {
    stub(200, {
      uuid: "refund-uuid-1",
      amount: 12.5,
      status: "PENDING",
      currency: "EUR",
      type: "PARTIAL_REFUND",
      createdAt: "2026-09-07T10:00:00.000Z",
    });
    const out = await provider.refundPayment({
      providerRef: "order-uuid-1",
      amount: 12.5,
      idempotencyKey: "1a2b3c4d-0000-4000-8000-000000000000",
      orderNumber: "R-100042",
    });

    expect(sent!.url).toBe("https://sandbox-stargate.montonio.com/api/refunds");
    const claims = verifyHs256<Record<string, unknown>>(
      (JSON.parse(sent!.body) as { data: string }).data,
      "sk_test_secret",
    );
    expect(claims.accessKey).toBe("ak_test");
    expect(claims.orderUuid).toBe("order-uuid-1");
    expect(claims.amount).toBe(12.5);
    expect(claims.idempotencyKey).toBe("1a2b3c4d-0000-4000-8000-000000000000");
    expect(typeof claims.exp).toBe("number");

    // PENDING is not a failure — Montonio holds it until it has the balance
    expect(out).toMatchObject({ ref: "refund-uuid-1", amount: 12.5, status: "pending", currency: "EUR" });
  });

  it("refuses a zero refund and an order with no provider id, before any call", async () => {
    stub(200, { uuid: "x" });
    await expect(provider.refundPayment({ providerRef: "o", amount: 0, idempotencyKey: "k" })).rejects.toThrow("bad_amount");
    await expect(provider.refundPayment({ providerRef: "", amount: 5, idempotencyKey: "k" })).rejects.toThrow("no_provider_ref");
    expect(sent).toBeNull();
  });

  it("a refusal and an unreachable gateway are told apart", async () => {
    stub(422, { error: "no balance" });
    await expect(provider.refundPayment({ providerRef: "o", amount: 5, idempotencyKey: "k" })).rejects.toThrow(
      "provider_rejected",
    );
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    await expect(provider.refundPayment({ providerRef: "o", amount: 5, idempotencyKey: "k" })).rejects.toThrow(
      "provider_unreachable",
    );
  });

  it("reads a refund webhook, and refuses one signed for another store", async () => {
    const { signHs256 } = await import("@/lib/payments/jwt");
    const body = (claims: Record<string, unknown>, secret = "sk_test_secret") =>
      new Request("https://shop.example/api/payments/notify/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refundToken: signHs256(claims, secret, { expiresInSeconds: 600 }) }),
      });

    const note = await provider.verifyRefundNotification(
      body({
        accessKey: "ak_test",
        refundUuid: "refund-uuid-1",
        orderUuid: "order-uuid-1",
        refundAmount: 9.99,
        refundStatus: "SUCCESSFUL",
        refundStatusDescription: "Sent to the bank",
      }),
    );
    expect(note).toMatchObject({
      refundRef: "refund-uuid-1",
      providerOrderRef: "order-uuid-1",
      amount: 9.99,
      status: "done",
    });

    await expect(
      provider.verifyRefundNotification(
        body({ accessKey: "someone_else", refundUuid: "r", orderUuid: "o", refundAmount: 1, refundStatus: "SUCCESSFUL" }),
      ),
    ).rejects.toThrow("token_foreign");
    await expect(
      provider.verifyRefundNotification(body({ accessKey: "ak_test", refundUuid: "r", orderUuid: "o" }, "wrong-secret")),
    ).rejects.toThrow(/token_/);
  });
});

/* ---------- the whole path, on a real database ---------------------------- */

const CUSTOMER = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };
const ORDER_BODY = {
  lang: "RU",
  items: [{ id: PRODUCT.id, qty: 1 }],
  customer: CUSTOMER,
  shipping: { method: "pickup", country: "EE" },
};

let restoreEnv: () => void = () => {};

async function place(): Promise<Order> {
  const { createOrder } = await import("@/lib/orders");
  return createOrder(ORDER_BODY) as unknown as Order;
}

/** An order the mock bank has paid for, with a provider reference on it. */
async function paidOrder(ref = "mock_ref_1"): Promise<Order> {
  const order = await place();
  await setOrderPayment(order.id, {
    provider: "mock",
    ref,
    status: "paid",
    method: "card",
    amount: Number(order.total),
    currency: "EUR",
    at: new Date().toISOString(),
  });
  await setOrderStatus(order.id, "paid", "test");
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

async function refundWebhook(
  providerOrderRef: string,
  refundRef: string,
  amount: number,
  status: RefundStatus = "done",
) {
  const { POST } = await import("@/app/api/payments/notify/route");
  const token = signMockRefundTicket({ refundRef, providerOrderRef, amount, status }, mockSecret());
  const res = await POST(
    makeRequest("/api/payments/notify/", { method: "POST", body: { mockRefundToken: token } }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("«Вернуть деньги» — the admin route", () => {
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
    resetIps();
    resetPayRateLimits();
    process.env.PAYMENT_PROVIDER = "mock";
  });

  it("a full refund moves the order to «возврат», puts the stock back and writes once", async () => {
    const order = await paidOrder();
    const before = capturedMail().length;

    const out = await refund(order.id);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.fully).toBe(true);
    expect(out.body.amount).toBe(Number(order.total));
    expect(out.body.left).toBe(0);
    expect(out.body.status).toBe("refunded");

    const after = (await getOrder(order.id))!;
    expect(after.status).toBe("refunded");
    expect(refundedTotal(after.payment)).toBe(Number(order.total));
    expect(refundsOf(after.payment)).toHaveLength(1);
    expect(refundsOf(after.payment)[0].by).toBe("admin");

    // the customer is told — the letter that did not exist before 07.09.2026
    const letters = capturedMail().slice(before);
    expect(letters.map((m) => m.template)).toContain("order-refunded");

    // …and the journal has it
    const rows = await query<{ action: string }>("select action from admin_audit where action = 'order.refund'");
    expect(rows).toHaveLength(1);
  });

  it("a partial refund leaves the order paid and only shrinks what is left", async () => {
    const order = await paidOrder();
    const total = Number(order.total);

    const first = await refund(order.id, { amount: 1 });
    expect(first.status).toBe(200);
    expect(first.body.fully).toBe(false);
    expect(first.body.left).toBe(Math.round((total - 1) * 100) / 100);
    expect((await getOrder(order.id))!.status).toBe("paid");

    // the rest goes back, and now it is «возврат»
    const rest = await refund(order.id);
    expect(rest.status).toBe(200);
    expect(rest.body.amount).toBe(Math.round((total - 1) * 100) / 100);
    expect(rest.body.fully).toBe(true);
    expect((await getOrder(order.id))!.status).toBe("refunded");
  });

  it("refuses more than is left, a refund of a refunded order, and an order nobody paid for", async () => {
    const order = await paidOrder();
    const total = Number(order.total);

    expect((await refund(order.id, { amount: total + 1 })).status).toBe(400);
    expect((await refund(order.id, { amount: 0 })).status).toBe(400);

    await refund(order.id);
    const again = await refund(order.id);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("already_refunded");

    const unpaid = await place();
    const nope = await refund(unpaid.id);
    expect(nope.status).toBe(409);
    expect(nope.body.error).toBe("not_paid");
  });

  it("an order with no provider payment — marked paid by hand, or covered by a card — has nothing to reverse", async () => {
    const order = await place();
    await setOrderPayment(order.id, { provider: "manual", ref: "", status: "paid", at: new Date().toISOString() });
    await setOrderStatus(order.id, "paid", "test");
    const out = await refund(order.id);
    expect(out.status).toBe(409);
    expect(out.body.error).toBe("no_provider_ref");
  });

  it("a shop with no payment keys says so instead of crashing", async () => {
    const order = await paidOrder();
    delete process.env.PAYMENT_PROVIDER;
    delete process.env.MONTONIO_ACCESS_KEY;
    delete process.env.MONTONIO_SECRET_KEY;
    const out = await refund(order.id);
    expect(out.status).toBe(503);
    expect(out.body.error).toBe("not_configured");
    // and the order is untouched
    expect((await getOrder(order.id))!.status).toBe("paid");
  });

  it("refuses without an admin cookie", async () => {
    const order = await paidOrder();
    const { POST } = await import("@/app/api/admin/orders/[id]/refund/route");
    const res = await POST(
      makeRequest(`/api/admin/orders/${order.id}/refund/`, { method: "POST", body: {} }),
      { params: Promise.resolve({ id: order.id }) },
    );
    expect(res.status).toBe(401);
    expect((await getOrder(order.id))!.status).toBe("paid");
  });
});

describe("the refund webhook — a refund made in Montonio's own portal", () => {
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
    resetIps();
    resetPayRateLimits();
    process.env.PAYMENT_PROVIDER = "mock";
  });

  it("finds the order by the provider's own id and moves it to «возврат»", async () => {
    const order = await paidOrder("mock_portal_1");
    const before = capturedMail().length;

    const out = await refundWebhook("mock_portal_1", "refund-1", Number(order.total));
    expect(out.status).toBe(200);
    expect(out.body.applied).toBe(true);
    expect(out.body.status).toBe("refunded");

    const after = (await getOrder(order.id))!;
    expect(after.status).toBe("refunded");
    expect(refundsOf(after.payment)[0].by).toBe("webhook");
    expect(capturedMail().slice(before).map((m) => m.template)).toContain("order-refunded");
  });

  it("the same webhook twice is one refund and one letter — Montonio retries for 48 hours", async () => {
    const order = await paidOrder("mock_portal_2");
    await refundWebhook("mock_portal_2", "refund-2", Number(order.total));
    const afterFirst = capturedMail().length;

    const repeat = await refundWebhook("mock_portal_2", "refund-2", Number(order.total));
    expect(repeat.status).toBe(200);
    expect(repeat.body.applied).toBe(false);
    expect(repeat.body.refundedTotal).toBe(Number(order.total));
    expect(refundsOf((await getOrder(order.id))!.payment)).toHaveLength(1);
    expect(capturedMail().length).toBe(afterFirst);
  });

  it("a partial refund leaves the order paid", async () => {
    const order = await paidOrder("mock_portal_3");
    const out = await refundWebhook("mock_portal_3", "refund-3", 1);
    expect(out.status).toBe(200);
    expect(out.body.refundedTotal).toBe(1);
    expect((await getOrder(order.id))!.status).toBe("paid");
  });

  it("an unknown order is acknowledged, not retried for two days", async () => {
    const out = await refundWebhook("nobody-here", "refund-x", 5);
    expect(out.status).toBe(200);
    expect(out.body.ignored).toBe("unknown_order");
  });

  it("a refund the provider rejected is recorded and frees the amount again", async () => {
    const order = await paidOrder("mock_portal_4");
    await refundWebhook("mock_portal_4", "refund-4", Number(order.total), "failed");
    const after = (await getOrder(order.id))!;
    // the money never left, so it is refundable again — and the order did not move
    expect(refundedTotal(after.payment)).toBe(0);
    expect(after.status).toBe("paid");
    expect(refundsOf(after.payment)[0].status).toBe("failed");
  });
});
