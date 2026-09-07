import { describe, expect, it, vi } from "vitest";
import {
  applyPaymentResult,
  type ApplyDeps,
  type OrderLike,
  type PaymentBlob,
} from "@/lib/payments/apply";
import { MockProvider, mockSecret } from "@/lib/payments/mock";
import { getProvider } from "@/lib/payments";
import type { VerifyResult } from "@/lib/payments/types";

function deps() {
  return {
    setOrderPayment: vi.fn(async (_id: string, _payment: PaymentBlob) => ({})),
    setOrderStatus: vi.fn(async (_id: string, _status: "paid" | "failed", _actor: string) => ({})),
  } satisfies ApplyDeps;
}

const order: OrderLike = {
  id: "3f7c0d3e-1111-4444-8888-aaaaaaaaaaaa",
  number: "R-100042",
  status: "new",
  total: 99.99,
};

const result = (over: Partial<VerifyResult> = {}): VerifyResult => ({
  orderRef: "R-100042",
  status: "paid",
  providerRef: "montonio-uuid-1",
  amount: 99.99,
  currency: "EUR",
  ...over,
});

describe("what a verified payment does to an order", () => {
  it("marks a paid order paid", async () => {
    const d = deps();
    const out = await applyPaymentResult(order, result(), "montonio", d);
    expect(out.status).toBe("paid");
    expect(d.setOrderStatus).toHaveBeenCalledWith(order.id, "paid", "payment:montonio");
    expect(d.setOrderPayment).toHaveBeenCalledOnce();
    expect(d.setOrderPayment.mock.calls[0][1]).toMatchObject({
      provider: "montonio",
      ref: "montonio-uuid-1",
      status: "paid",
      amount: 99.99,
      currency: "EUR",
    });
  });

  it("marks a failed payment failed", async () => {
    const d = deps();
    const out = await applyPaymentResult(order, result({ status: "failed" }), "montonio", d);
    expect(out.status).toBe("failed");
    expect(d.setOrderStatus).toHaveBeenCalledWith(order.id, "failed", "payment:montonio");
  });

  it("leaves the order alone while the payment is pending", async () => {
    const d = deps();
    const out = await applyPaymentResult(order, result({ status: "pending" }), "montonio", d);
    expect(out.status).toBe("unchanged");
    expect(d.setOrderStatus).not.toHaveBeenCalled();
    // the attempt is still recorded
    expect(d.setOrderPayment.mock.calls[0][1]).toMatchObject({ status: "pending" });
  });
});

describe("idempotency — the webhook and the return race by design", () => {
  it("refuses to take a paid order back to failed", async () => {
    const d = deps();
    const paid = { ...order, status: "paid" };
    const out = await applyPaymentResult(paid, result({ status: "failed" }), "montonio", d);

    expect(out.status).toBe("unchanged");
    expect(out.keptPaid).toBe(true);
    expect(d.setOrderStatus).not.toHaveBeenCalled();
    // the refused status is kept where a human will see it
    expect(d.setOrderPayment.mock.calls[0][1]).toMatchObject({
      status: "paid",
      rejected: { status: "failed" },
    });
  });

  it("also refuses when only the payment blob says paid", async () => {
    const d = deps();
    const paid = { ...order, status: "new", payment: { status: "paid", provider: "montonio" } };
    const out = await applyPaymentResult(paid, result({ status: "failed" }), "montonio", d);
    expect(out.keptPaid).toBe(true);
    expect(d.setOrderStatus).not.toHaveBeenCalled();
  });

  it("does not re-fire the status when the same paid result arrives twice", async () => {
    const d = deps();
    await applyPaymentResult({ ...order, status: "paid" }, result(), "montonio", d);
    expect(d.setOrderStatus).not.toHaveBeenCalled();
    expect(d.setOrderPayment).toHaveBeenCalledOnce();
  });

  it("does not re-fire the status on a repeated failure either", async () => {
    const d = deps();
    await applyPaymentResult({ ...order, status: "failed" }, result({ status: "failed" }), "montonio", d);
    expect(d.setOrderStatus).not.toHaveBeenCalled();
  });

  it("a shipped order is paid as far as payments are concerned", async () => {
    const d = deps();
    const out = await applyPaymentResult(
      { ...order, status: "shipped" },
      result({ status: "failed" }),
      "montonio",
      d,
    );
    expect(out.keptPaid).toBe(true);
    expect(d.setOrderStatus).not.toHaveBeenCalled();
  });
});

describe("amount checking", () => {
  it("flags a payment that does not match the order total", async () => {
    const d = deps();
    const out = await applyPaymentResult(order, result({ amount: 9.99 }), "montonio", d);
    // the money arrived, so the order is paid…
    expect(out.status).toBe("paid");
    // …but the difference is recorded rather than swallowed
    expect(out.payment.amountMismatch).toEqual({ expected: 99.99, got: 9.99 });
  });

  it("ignores rounding noise", async () => {
    const d = deps();
    const out = await applyPaymentResult(order, result({ amount: 99.99 }), "montonio", d);
    expect(out.payment.amountMismatch).toBeUndefined();
  });

  it("copes with a numeric total that arrived as a string", async () => {
    const d = deps();
    const out = await applyPaymentResult({ ...order, total: "99.99" }, result(), "montonio", d);
    expect(out.payment.amountMismatch).toBeUndefined();
  });
});

describe("the keyless provider", () => {
  const env = { SESSION_SECRET: "test-session-secret-at-least-16-chars" } as unknown as NodeJS.ProcessEnv;

  /* The mock provider signs its own "this order is paid" tickets, so being
     picked by accident is the whole of audit C1. It is reachable one way. */
  it("is NEVER picked by default — an unconfigured shop refuses to take money", () => {
    expect(() => getProvider(env)).toThrowError(
      expect.objectContaining({ code: "not_configured" }),
    );
  });

  it("is picked only when PAYMENT_PROVIDER=mock says so, even over live keys", () => {
    expect(
      getProvider({ ...env, PAYMENT_PROVIDER: "mock" } as unknown as NodeJS.ProcessEnv).name,
    ).toBe("mock");
    expect(
      getProvider({
        ...env,
        PAYMENT_PROVIDER: "mock",
        MONTONIO_ACCESS_KEY: "a",
        MONTONIO_SECRET_KEY: "b",
      } as unknown as NodeJS.ProcessEnv).name,
    ).toBe("mock");
  });

  it("hands over to Montonio as soon as its keys exist", () => {
    expect(
      getProvider({
        ...env,
        MONTONIO_ACCESS_KEY: "a",
        MONTONIO_SECRET_KEY: "b",
      } as unknown as NodeJS.ProcessEnv).name,
    ).toBe("montonio");
  });

  it("refuses to start when montonio is demanded without keys", () => {
    expect(() =>
      getProvider({ ...env, PAYMENT_PROVIDER: "montonio" } as unknown as NodeJS.ProcessEnv),
    ).toThrowError(expect.objectContaining({ code: "not_configured" }));
  });

  /* The old fallback key was a constant printed in this repository. */
  it("refuses to sign anything without SESSION_SECRET", () => {
    expect(() =>
      getProvider({ PAYMENT_PROVIDER: "mock" } as unknown as NodeJS.ProcessEnv),
    ).toThrowError(expect.objectContaining({ code: "not_configured" }));
    expect(mockSecret(env)).not.toBe(env.SESSION_SECRET);
    expect(mockSecret(env)).toBe(mockSecret(env));
  });

  it("walks the whole flow: redirect, decide, come back", async () => {
    const provider = new MockProvider("test-secret");
    const created = await provider.createPayment(
      { id: order.id, number: "R-100042", total: 99.99 },
      {
        returnUrl: "https://rempire.ee/api/payments/return/",
        notificationUrl: "https://rempire.ee/api/payments/notify/",
        lang: "RU",
      },
    );
    const url = new URL(created.redirectUrl);
    expect(url.pathname).toBe("/api/payments/mock/");
    expect(url.origin).toBe("https://rempire.ee");
    expect(created.ref).toMatch(/^mock_/);

    // the gateway page signs the shopper's decision into the ticket
    const ticket = url.searchParams.get("t")!;
    const { readMockTicket, signMockTicket } = await import("@/lib/payments/mock");
    const settled = signMockTicket(
      { ...readMockTicket(ticket, "test-secret"), status: "paid" },
      "test-secret",
    );

    const back = await provider.verifyReturn(new URLSearchParams({ "mock-token": settled }));
    expect(back).toMatchObject({ orderRef: "R-100042", status: "paid", amount: 99.99 });
  });

  it("refuses a ticket signed with another secret", async () => {
    const provider = new MockProvider("test-secret");
    const other = new MockProvider("someone-elses-secret");
    const created = await other.createPayment(
      { id: order.id, number: "R-100042", total: 99.99 },
      {
        returnUrl: "https://rempire.ee/api/payments/return/",
        notificationUrl: "https://rempire.ee/api/payments/notify/",
        lang: "RU",
      },
    );
    const ticket = new URL(created.redirectUrl).searchParams.get("t")!;
    await expect(
      provider.verifyReturn(new URLSearchParams({ "mock-token": ticket })),
    ).rejects.toMatchObject({ code: "token_invalid" });
  });

  it("reports an unsettled ticket as pending, not as paid", async () => {
    const provider = new MockProvider("test-secret");
    const created = await provider.createPayment(
      { id: order.id, number: "R-100042", total: 99.99 },
      {
        returnUrl: "https://rempire.ee/api/payments/return/",
        notificationUrl: "https://rempire.ee/api/payments/notify/",
        lang: "RU",
      },
    );
    const ticket = new URL(created.redirectUrl).searchParams.get("t")!;
    await expect(
      provider.verifyReturn(new URLSearchParams({ "mock-token": ticket })),
    ).resolves.toMatchObject({ status: "pending" });
  });
});

describe("a PAYMENT_PROVIDER this build does not know", () => {
  /* `makecommerce` used to name a stub whose every method threw; it was
     deleted 07.09.2026 (docs/audit/2026-09-07-cleanup.md). What must hold now
     is what held then — a name the code cannot honour never becomes the mock. */
  it("never falls back to the mock: with no Montonio keys it refuses", () => {
    for (const name of ["makecommerce", "stripe", "  MakeCommerce  ", "x"]) {
      expect(() => getProvider({ PAYMENT_PROVIDER: name } as unknown as NodeJS.ProcessEnv))
        .toThrowError(expect.objectContaining({ code: "not_configured" }));
    }
  });
});

/* analytics agent: the one authoritative revenue row (db/migrations/080_events.sql)
   is written from exactly here — see recordPurchase() in src/lib/payments/apply.ts. */
describe("the authoritative revenue row", () => {
  it("is recorded once, on the transition into paid", async () => {
    const recordPurchaseEvent = vi.fn(async () => ({}));
    const out = await applyPaymentResult(order, result(), "montonio", { ...deps(), recordPurchaseEvent });
    expect(out.alreadyPaid).toBe(false);
    expect(recordPurchaseEvent).toHaveBeenCalledOnce();
    expect(recordPurchaseEvent).toHaveBeenCalledWith({ id: order.id, total: order.total });
  });

  it("is not recorded again when the same paid result arrives twice (webhook retry)", async () => {
    const recordPurchaseEvent = vi.fn(async () => ({}));
    const d = { ...deps(), recordPurchaseEvent };
    await applyPaymentResult(order, result(), "montonio", d);
    await applyPaymentResult({ ...order, status: "paid" }, result(), "montonio", d);
    expect(recordPurchaseEvent).toHaveBeenCalledOnce();
  });

  it("is not recorded when the payment fails or is only pending", async () => {
    const recordPurchaseEvent = vi.fn(async () => ({}));
    const d = { ...deps(), recordPurchaseEvent };
    await applyPaymentResult(order, result({ status: "failed" }), "montonio", d);
    await applyPaymentResult(order, result({ status: "pending" }), "montonio", d);
    expect(recordPurchaseEvent).not.toHaveBeenCalled();
  });

  it("a tracking failure never stops the payment from being recorded as paid", async () => {
    const recordPurchaseEvent = vi.fn(async () => { throw new Error("db down"); });
    const d = deps();
    const out = await applyPaymentResult(order, result(), "montonio", { ...d, recordPurchaseEvent });
    expect(out.status).toBe("paid");
    expect(d.setOrderStatus).toHaveBeenCalledWith(order.id, "paid", "payment:montonio");
  });
});
