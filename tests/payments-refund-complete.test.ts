/**
 * A refund Montonio only ACCEPTED, and the moment it lands — the readiness
 * pass of 27.09.2026 (docs/audit-2026-09-27-readiness.md), findings B1, B10, B9.
 *
 * Montonio answers «Вернуть деньги» with 200 PENDING more often than not (a
 * bank-link refund always, on the live hour of 26.09.2026: R-100095 full,
 * R-100096 partial). The customer is then sent «Возврат отправлен», whose last
 * line promises «Как только деньги будут у вас, мы напишем ещё раз». What is
 * pinned here:
 *
 *   B1 · that second letter, «Деньги возвращены», goes when the entry moves
 *        from not-done to done — once, whichever door moves it (the refund
 *        webhook, the nightly re-check), never on a duplicate webhook, never a
 *        second time for a refund whose first answer was already done;
 *   B10 · a late PENDING notice never undoes a DONE (or FAILED) refund;
 *   B9 · a refund whose SUCCESSFUL webhook was lost is finished by the nightly
 *        re-check from Montonio's own refund list (GET /orders/:uuid), with
 *        the same letter, stock, status and journal as the webhook.
 *
 * Real Postgres (PGlite), the mock provider for the payment and the webhook,
 * Montonio scripted where the re-check asks it.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "@/lib/db";
import { getLevel, move } from "@/lib/inventory";
import { capturedMail } from "@/lib/mail";
import { createOrder, getOrder, type Order } from "@/lib/orders";
import { mockSecret, MockProvider, signMockRefundTicket } from "@/lib/payments/mock";
import type { MontonioOrderSnapshot } from "@/lib/payments/montonio";
import { pendingRefunds } from "@/lib/payments/pending-refunds";
import { resetRateLimits as resetPayRateLimits } from "@/lib/payments/ratelimit";
import {
  foldRefund,
  refundableAmount,
  refundedTotal,
  refundsOf,
  type RefundResult,
  type RefundStatus,
} from "@/lib/payments/refund";
import { settlePayment, settleRefund } from "@/lib/payments/settle";
import type { PaymentProvider } from "@/lib/payments/types";
import { adminCookieHeader, makeRequest, PRODUCT, resetIps, setFuzzEnv } from "./fuzz-harness";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const CUSTOMER = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };
const HOUR = 60 * 60 * 1000;
const REFUND_UUID = "5d0c6a52-8a4e-4b1f-9a55-0f5c3e0b7a11";

let restoreEnv: () => void = () => {};

/** An order the bank has paid for, through the ordinary door — so its stock
    really left the shelf and a full refund has something to put back. */
async function paidOrder(ref = "mock_ref_b1", qty = 2, provider = "mock"): Promise<Order> {
  const order = await createOrder({
    lang: "RU",
    items: [{ id: PRODUCT.id, qty }],
    customer: CUSTOMER,
    shipping: { method: "pickup", country: "EE" },
  } as Parameters<typeof createOrder>[0]);
  const out = await settlePayment(
    order,
    { orderRef: order.number, status: "paid", providerRef: ref, amount: Number(order.total), currency: "EUR" },
    provider,
  );
  expect(out.status).toBe("paid");
  return (await getOrder(order.id))!;
}

async function shelf(): Promise<number> {
  return Number((await getLevel(PRODUCT.id, ""))?.qty ?? NaN);
}

function letters(template: string): number {
  return capturedMail().filter((m) => m.template === template).length;
}

/** «Вернуть деньги» from a card opened now. */
async function press(id: string, body: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/admin/orders/[id]/refund/route");
  const seen = { refundsSeen: refundsOf((await getOrder(id))?.payment).length };
  const res = await POST(
    makeRequest(`/api/admin/orders/${id}/refund/`, { method: "POST", body: { ...seen, ...body }, cookie: adminCookieHeader() }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Montonio answering POST /refunds the way it does on a bank link: 200 PENDING. */
function montonioAnswersPending(ref = REFUND_UUID) {
  return vi.spyOn(MockProvider.prototype, "refundPayment").mockImplementation(async (req) => {
    const out: RefundResult = { ref, amount: req.amount, status: "pending", currency: "EUR", detail: "PARTIAL_REFUND · PENDING" };
    return out;
  });
}

/** Montonio's refund webhook, through the real notify route. */
async function webhook(providerOrderRef: string, refundRef: string, amount: number, status: RefundStatus) {
  const { POST } = await import("@/app/api/payments/notify/route");
  const token = signMockRefundTicket({ refundRef, providerOrderRef, amount, status }, mockSecret());
  const res = await POST(makeRequest("/api/payments/notify/", { method: "POST", body: { mockRefundToken: token } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function statusRows(to: string): Promise<number> {
  const rows = await query<{ n: number }>(
    "select count(*)::int as n from admin_audit where action = 'order.status' and payload->>'to' = $1",
    [to],
  );
  return Number(rows[0]?.n ?? 0);
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
  resetIps();
  resetPayRateLimits();
  process.env.PAYMENT_PROVIDER = "mock";
  (globalThis as unknown as { __rempireMailSink?: unknown[] }).__rempireMailSink = [];
  await move({ productId: PRODUCT.id, delta: 10, reason: "goods_in", actor: "test" });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------------ *
 * B1 — the second letter
 * ------------------------------------------------------------------------ */

describe("B1 — «Деньги возвращены» when a PENDING refund completes", () => {
  it("press → PENDING → webhook SUCCESSFUL: the second letter goes, and the order closes, once", async () => {
    const order = await paidOrder("mock_ref_full");
    const total = Number(order.total);
    expect(await shelf()).toBe(8);

    const spy = montonioAnswersPending();
    const out = await press(order.id);
    spy.mockRestore();
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.refundStatus).toBe("pending");

    // «Возврат отправлен» and nothing else — the money has not moved yet
    expect(letters("order-refund-sent")).toBe(1);
    expect(letters("order-refunded")).toBe(0);
    expect((await getOrder(order.id))!.status).toBe("paid");
    expect(await shelf()).toBe(8);

    // Montonio: SUCCESSFUL, for the same refund id
    const done = await webhook("mock_ref_full", REFUND_UUID, total, "done");
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ applied: false, status: "refunded", refund: "done" });

    expect(letters("order-refunded"), "the letter «Возврат отправлен» promised").toBe(1);
    expect(letters("order-refund-sent")).toBe(1);
    const after = (await getOrder(order.id))!;
    expect(after.status).toBe("refunded");
    expect(await shelf()).toBe(10);
    const [entry] = refundsOf(after.payment);
    expect(entry).toMatchObject({ ref: REFUND_UUID, status: "done", by: "admin" });
    expect(entry.doneAt, "the moment the money landed is written down").toBeTruthy();

    // Montonio retries for 48 hours: the same SUCCESSFUL again changes nothing
    const again = await webhook("mock_ref_full", REFUND_UUID, total, "done");
    expect(again.status).toBe(200);
    expect(letters("order-refunded")).toBe(1);
    expect(await shelf()).toBe(10);
    expect(await statusRows("refunded")).toBe(1);
    expect(refundsOf((await getOrder(order.id))!.payment)).toHaveLength(1);
  });

  it("a refund Montonio finished at once gets one letter, and its webhook none", async () => {
    const order = await paidOrder("mock_ref_now");
    const out = await press(order.id); // the mock bank answers `done` at once
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.refundStatus).toBe("done");
    expect(letters("order-refunded")).toBe(1);

    const ref = refundsOf((await getOrder(order.id))!.payment)[0].ref;
    await webhook("mock_ref_now", ref, Number(order.total), "done");
    expect(letters("order-refunded")).toBe(1);
    expect(letters("order-refund-sent")).toBe(0);
  });

  it("a partial PENDING refund completes with its own letter and leaves the order paid (R-100096)", async () => {
    const order = await paidOrder("mock_ref_part");
    const spy = montonioAnswersPending();
    expect((await press(order.id, { amount: 0.5 })).status).toBe(200);
    spy.mockRestore();
    expect(letters("order-refund-sent")).toBe(1);

    const done = await webhook("mock_ref_part", REFUND_UUID, 0.5, "done");
    expect(done.status).toBe(200);
    expect(letters("order-refunded")).toBe(1);
    const after = (await getOrder(order.id))!;
    expect(after.status).toBe("paid");
    expect(refundedTotal(after.payment)).toBe(0.5);
    expect(await shelf()).toBe(8);
    // the letter names what went back, not the order's total
    const rows = await query<{ amount: string }>(
      "select payload->>'amount' as amount from admin_audit where action = 'order.refund' order by id desc limit 1",
    );
    expect(Number(rows[0].amount)).toBe(0.5);
  });

  /* A refund Renat made in Montonio's own portal reaches this shop only as
     webhooks, with no line written before them. Decided the same way as a
     press: PENDING first → «Возврат отправлен»; SUCCESSFUL → «Деньги
     возвращены»; each once. */
  it("a portal refund: PENDING then SUCCESSFUL sends each letter once", async () => {
    const order = await paidOrder("mock_ref_portal");
    const total = Number(order.total);

    const first = await webhook("mock_ref_portal", "portal-refund-1", total, "pending");
    expect(first.body.applied).toBe(true);
    expect(letters("order-refund-sent")).toBe(1);
    expect(letters("order-refunded")).toBe(0);
    expect((await getOrder(order.id))!.status).toBe("paid");

    await webhook("mock_ref_portal", "portal-refund-1", total, "pending"); // a nudge
    expect(letters("order-refund-sent")).toBe(1);

    await webhook("mock_ref_portal", "portal-refund-1", total, "done");
    await webhook("mock_ref_portal", "portal-refund-1", total, "done");
    expect(letters("order-refunded")).toBe(1);
    expect(letters("order-refund-sent")).toBe(1);
    expect((await getOrder(order.id))!.status).toBe("refunded");
    expect(refundsOf((await getOrder(order.id))!.payment)[0].by).toBe("webhook");
  });

  it("a portal refund that is SUCCESSFUL from the first notice sends «Деньги возвращены» once", async () => {
    const order = await paidOrder("mock_ref_portal2");
    await webhook("mock_ref_portal2", "portal-refund-2", Number(order.total), "done");
    await webhook("mock_ref_portal2", "portal-refund-2", Number(order.total), "done");
    expect(letters("order-refunded")).toBe(1);
    expect(letters("order-refund-sent")).toBe(0);
  });

  it("a PENDING refund Montonio cancels sends no «Деньги возвращены» and frees the amount", async () => {
    const order = await paidOrder("mock_ref_cancel");
    const spy = montonioAnswersPending();
    expect((await press(order.id)).status).toBe(200);
    spy.mockRestore();

    await webhook("mock_ref_cancel", REFUND_UUID, Number(order.total), "failed");
    expect(letters("order-refunded")).toBe(0);
    const after = (await getOrder(order.id))!;
    expect(after.status).toBe("paid");
    expect(refundedTotal(after.payment)).toBe(0);
    expect(refundableAmount(Number(after.total), after.payment)).toBe(Number(after.total));
  });

  /* Two doors that both read the order while the refund was still PENDING —
     the webhook and the nightly re-check in the same second, or Montonio
     retrying a delivery that is still being worked on. The second writer must
     see the first one's DONE, not its own stale PENDING. */
  it("two arrivals that both read the order before either wrote: one letter, one shelf", async () => {
    const order = await paidOrder("mock_ref_race");
    const spy = montonioAnswersPending();
    expect((await press(order.id)).status).toBe(200);
    spy.mockRestore();

    const stale = (await getOrder(order.id))!;
    const entry = { ref: REFUND_UUID, amount: Number(order.total), status: "done" as const, at: new Date().toISOString(), by: "webhook" };
    const a = await settleRefund(stale, entry);
    const b = await settleRefund(stale, entry);

    expect(a.becameDone).toBe(true);
    expect(b.becameDone).toBe(false);
    expect(letters("order-refunded")).toBe(1);
    expect(await shelf()).toBe(10);
    expect(await statusRows("refunded")).toBe(1);
    expect(refundsOf((await getOrder(order.id))!.payment)).toHaveLength(1);
  });

  /* The lost-entry race foldRefund() used to document and accept: a second
     refund folded from a snapshot taken before the first was written. */
  it("a refund folded from an older snapshot does not wipe out the line written in between", async () => {
    const order = await paidOrder("mock_ref_lines");
    const stale = (await getOrder(order.id))!;
    await settleRefund(stale, { ref: "r-one", amount: 1, status: "done", at: new Date().toISOString(), by: "webhook" });
    await settleRefund(stale, { ref: "r-two", amount: 2, status: "done", at: new Date().toISOString(), by: "webhook" });
    const list = refundsOf((await getOrder(order.id))!.payment);
    expect(list.map((r) => r.ref).sort()).toEqual(["r-one", "r-two"]);
    expect(refundedTotal((await getOrder(order.id))!.payment)).toBe(3);
  });
});

/* ------------------------------------------------------------------------ *
 * B10 — status only moves forward
 * ------------------------------------------------------------------------ */

describe("B10 — a late PENDING never undoes a finished refund", () => {
  const e = (status: RefundStatus, at: string, amount = 10) => ({ ref: "r1", amount, status, at });

  it("done stays done, and the ledger is left exactly as it was", () => {
    const pending = foldRefund({}, e("pending", "2026-09-26T19:39:00.000Z"));
    const done = foldRefund({ refunds: pending.refunds }, e("done", "2026-09-27T08:00:00.000Z"));
    expect(done.becameDone).toBe(true);
    const late = foldRefund({ refunds: done.refunds }, e("pending", "2026-09-27T09:00:00.000Z"));
    expect(late.kept).toBe("done");
    expect(late.becameDone).toBe(false);
    expect(late.applied).toBe(false);
    expect(late.refunds).toEqual(done.refunds);
    expect(late.refundedTotal).toBe(10);
  });

  it("failed stays failed — a cancelled refund does not come back to count as money on its way", () => {
    const failed = foldRefund({}, e("failed", "2026-09-27T08:00:00.000Z"));
    const late = foldRefund({ refunds: failed.refunds }, e("pending", "2026-09-27T09:00:00.000Z"));
    expect(late.kept).toBe("failed");
    expect(late.refundedTotal).toBe(0);
    expect(refundsOf({ refunds: late.refunds })[0].status).toBe("failed");
  });

  it("PENDING → PENDING still moves `at` and never `since`", () => {
    const one = foldRefund({}, e("pending", "2026-09-20T00:00:00.000Z"));
    const two = foldRefund({ refunds: one.refunds }, e("pending", "2026-09-22T00:00:00.000Z"));
    expect(two.kept).toBeUndefined();
    expect(two.refunds[0]).toMatchObject({ at: "2026-09-22T00:00:00.000Z", since: "2026-09-20T00:00:00.000Z" });
  });

  it("done is stamped once: done → failed → done is not a second «деньги дошли»", () => {
    const done = foldRefund({}, e("done", "2026-09-27T08:00:00.000Z"));
    expect(done.becameDone).toBe(true);
    const failed = foldRefund({ refunds: done.refunds }, e("failed", "2026-09-27T09:00:00.000Z"));
    // a later rejection is still recorded — the order card shows it (refund.ts header)
    expect(refundsOf({ refunds: failed.refunds })[0].status).toBe("failed");
    const again = foldRefund({ refunds: failed.refunds }, e("done", "2026-09-27T10:00:00.000Z"));
    expect(again.becameDone).toBe(false);
    expect(again.refunds[0].doneAt).toBe("2026-09-27T08:00:00.000Z");
  });

  it("an entry written before `doneAt` existed counts as done already", () => {
    const legacy = { refunds: [{ ref: "r1", amount: 10, status: "done", at: "2026-09-10T00:00:00.000Z" }] };
    const again = foldRefund(legacy, e("done", "2026-09-27T10:00:00.000Z"));
    expect(again.becameDone).toBe(false);
  });

  it("through the webhook: SUCCESSFUL, then a late PENDING — the order stays «возврат»", async () => {
    const order = await paidOrder("mock_ref_late");
    const total = Number(order.total);
    await webhook("mock_ref_late", "late-1", total, "done");
    expect((await getOrder(order.id))!.status).toBe("refunded");
    const lettersBefore = capturedMail().length;

    const late = await webhook("mock_ref_late", "late-1", total, "pending");
    expect(late.status).toBe(200);
    const after = (await getOrder(order.id))!;
    expect(after.status).toBe("refunded");
    expect(refundsOf(after.payment)[0].status).toBe("done");
    expect(capturedMail().length).toBe(lettersBefore);
    expect((await pendingRefunds()).some((p) => p.ref === "late-1")).toBe(false);
    // …and the journal says a notice was refused, rather than nothing
    const rows = await query<{ kept: string | null }>(
      "select payload->>'kept' as kept from admin_audit where action = 'order.refund' order by id desc limit 1",
    );
    expect(rows[0].kept).toBe("done");
  });

  it("the admin route's own PENDING answer, landing after the webhook's SUCCESSFUL, keeps DONE and writes «Деньги возвращены»", async () => {
    const order = await paidOrder("mock_ref_racepress");
    const total = Number(order.total);
    /* Montonio finishes the refund and its webhook is recorded while the
       POST /refunds answer (PENDING) is still on its way back. */
    const spy = vi.spyOn(MockProvider.prototype, "refundPayment").mockImplementation(async (req) => {
      await webhook("mock_ref_racepress", REFUND_UUID, total, "done");
      return { ref: REFUND_UUID, amount: req.amount, status: "pending", currency: "EUR" };
    });
    const out = await press(order.id);
    spy.mockRestore();
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    expect(out.body.refundStatus).toBe("done");
    expect(out.body.pendingMessages).toBeUndefined();
    expect(refundsOf((await getOrder(order.id))!.payment)[0].status).toBe("done");
    expect(letters("order-refund-sent"), "never «отправлен» after «возвращены»").toBe(0);
    expect(letters("order-refunded"), "the webhook wrote it; the route does not write it again").toBe(1);
    expect((await getOrder(order.id))!.status).toBe("refunded");
    const pendingRows = await query<{ n: number }>(
      "select count(*)::int as n from admin_audit where action = 'order.refund_pending'",
    );
    expect(pendingRows[0].n).toBe(0);
  });
});

/* ------------------------------------------------------------------------ *
 * B9 — the nightly re-check
 * ------------------------------------------------------------------------ */

function snapshot(uuid: string, refunds: MontonioOrderSnapshot["refunds"], over: Partial<MontonioOrderSnapshot> = {}): MontonioOrderSnapshot {
  return {
    uuid,
    paymentStatus: "PARTIALLY_REFUNDED",
    grandTotal: 0,
    currency: "EUR",
    availableForRefund: 0,
    refunds,
    ...over,
  };
}

/** Montonio, scripted per order uuid; anything else it has never heard of. */
function montonio(answers: Record<string, MontonioOrderSnapshot | null | Error>) {
  const fetchOrder = vi.fn(async (uuid: string) => {
    const a = answers[uuid];
    if (a instanceof Error) throw a;
    return a ?? null;
  });
  const provider = {
    name: "montonio",
    createPayment: async () => {
      throw new Error("not used");
    },
    verifyReturn: async () => {
      throw new Error("not used");
    },
    verifyNotification: async () => {
      throw new Error("not used");
    },
    fetchOrder,
  } as unknown as PaymentProvider;
  return { provider, fetchOrder };
}

/** A Montonio-paid order carrying a refund the shop recorded as PENDING `hoursAgo` ago. */
async function pendingSince(orderUuid: string, hoursAgo: number, now: number, amount?: number, refundUuid = REFUND_UUID): Promise<Order> {
  const order = await paidOrder(orderUuid, 2, "montonio");
  const at = new Date(now - hoursAgo * HOUR).toISOString();
  await settleRefund(
    order,
    { ref: refundUuid, amount: amount ?? Number(order.total), status: "pending", at, by: "admin" },
    { notify: false },
  );
  return (await getOrder(order.id))!;
}

describe("B9 — a pending refund is asked about every night", () => {
  const NOW = Date.now();

  it("finishes a refund whose SUCCESSFUL webhook was lost — letter, shelf, status, journal", async () => {
    const { recheckPendingRefunds } = await import("@/lib/payments/refund-recheck");
    const order = await pendingSince("montonio-order-1", 30, NOW);
    expect(await shelf()).toBe(8);
    const { provider, fetchOrder } = montonio({
      "montonio-order-1": snapshot("montonio-order-1", [{ uuid: REFUND_UUID, amount: Number(order.total), status: "SUCCESSFUL" }]),
    });

    const report = await recheckPendingRefunds({ provider, now: NOW });

    expect(fetchOrder).toHaveBeenCalledWith("montonio-order-1");
    expect(report).toMatchObject({ orders: 1, asked: 1, done: 1, failed: 0, numbers: [order.number] });
    const after = (await getOrder(order.id))!;
    expect(after.status).toBe("refunded");
    expect(refundsOf(after.payment)[0]).toMatchObject({ status: "done", by: "admin" });
    expect(await shelf()).toBe(10);
    expect(letters("order-refunded")).toBe(1);
    const rows = await query<{ actor: string }>(
      "select actor from admin_audit where action = 'order.refund' order by id desc limit 1",
    );
    expect(rows[0].actor).toBe("system");

    // a second night, and the webhook turning up after all: nothing more happens
    const second = await recheckPendingRefunds({ provider, now: NOW });
    expect(second.asked).toBe(0);
    await webhook("montonio-order-1", REFUND_UUID, Number(order.total), "done");
    expect(letters("order-refunded")).toBe(1);
    expect(await shelf()).toBe(10);
  });

  it("CANCELED at Montonio frees the amount and writes no letter", async () => {
    const { recheckPendingRefunds } = await import("@/lib/payments/refund-recheck");
    const order = await pendingSince("montonio-order-2", 11 * 24, NOW);
    const { provider } = montonio({
      "montonio-order-2": snapshot("montonio-order-2", [{ uuid: REFUND_UUID, amount: Number(order.total), status: "CANCELED" }]),
    });

    const report = await recheckPendingRefunds({ provider, now: NOW });

    expect(report).toMatchObject({ done: 0, failed: 1 });
    const after = (await getOrder(order.id))!;
    expect(after.status).toBe("paid");
    expect(refundedTotal(after.payment)).toBe(0);
    expect(letters("order-refunded")).toBe(0);
    // «Вернуть деньги» is pressable again — it no longer answers already_refunded
    expect(refundableAmount(Number(after.total), after.payment)).toBe(Number(after.total));
  });

  it("leaves alone what Montonio still calls PENDING, and does not ask about a refund younger than a day", async () => {
    const { recheckPendingRefunds } = await import("@/lib/payments/refund-recheck");
    await pendingSince("montonio-order-3", 30, NOW);
    const { provider, fetchOrder } = montonio({
      "montonio-order-3": snapshot("montonio-order-3", [{ uuid: REFUND_UUID, amount: 1, status: "PENDING" }]),
    });
    expect(await recheckPendingRefunds({ provider, now: NOW })).toMatchObject({ asked: 1, pending: 1, done: 0 });

    await truncateAll();
    await move({ productId: PRODUCT.id, delta: 10, reason: "goods_in", actor: "test" });
    await pendingSince("montonio-order-4", 3, NOW);
    fetchOrder.mockClear();
    expect(await recheckPendingRefunds({ provider, now: NOW })).toMatchObject({ orders: 0, asked: 0 });
    expect(fetchOrder).not.toHaveBeenCalled();
  });

  it("decides nothing when Montonio does not answer, throws, or has no such refund", async () => {
    const { recheckPendingRefunds } = await import("@/lib/payments/refund-recheck");
    const silent = await pendingSince("montonio-order-5", 30, NOW);
    const thrower = await pendingSince("montonio-order-6", 30, NOW, undefined, "6f1e2d3c-0000-4000-8000-000000000006");
    const stranger = await pendingSince("montonio-order-7", 30, NOW, undefined, "7f1e2d3c-0000-4000-8000-000000000007");
    const { provider } = montonio({
      "montonio-order-5": null,
      "montonio-order-6": new Error("socket hang up"),
      "montonio-order-7": snapshot("montonio-order-7", [{ uuid: "somebody-else", amount: 1, status: "SUCCESSFUL" }]),
    });

    const report = await recheckPendingRefunds({ provider, now: NOW });

    expect(report).toMatchObject({ orders: 3, unknown: 2, missing: 1, done: 0, failed: 0 });
    for (const o of [silent, thrower, stranger]) {
      expect(refundsOf((await getOrder(o.id))!.payment)[0].status).toBe("pending");
    }
    expect(letters("order-refunded")).toBe(0);
  });

  it("is bounded: at most `limit` orders a night, the newest first", async () => {
    const { recheckPendingRefunds } = await import("@/lib/payments/refund-recheck");
    await pendingSince("montonio-order-8", 30, NOW);
    await query("update orders set created_at = now() - interval '2 days'");
    const newest = await pendingSince("montonio-order-9", 30, NOW);
    const { provider, fetchOrder } = montonio({});
    const report = await recheckPendingRefunds({ provider, now: NOW, limit: 1 });
    expect(fetchOrder).toHaveBeenCalledTimes(1);
    expect(fetchOrder).toHaveBeenCalledWith("montonio-order-9");
    expect(report).toMatchObject({ orders: 1, left: 1 });
    expect(newest).toBeTruthy();
  });

  it("skips a shop whose provider cannot be asked, and an order another provider took", async () => {
    const { recheckPendingRefunds } = await import("@/lib/payments/refund-recheck");
    const mute = {
      name: "mock",
      createPayment: async () => ({ redirectUrl: "", ref: "" }),
      verifyReturn: async () => {
        throw new Error("not used");
      },
      verifyNotification: async () => {
        throw new Error("not used");
      },
    } as unknown as PaymentProvider;
    expect(await recheckPendingRefunds({ provider: mute, now: NOW })).toMatchObject({ skipped: "provider_cannot_ask" });

    const order = await paidOrder("mock_ref_other", 1, "mock");
    await settleRefund(
      order,
      { ref: "mock-refund", amount: 1, status: "pending", at: new Date(NOW - 30 * HOUR).toISOString(), by: "admin" },
      { notify: false },
    );
    const { provider, fetchOrder } = montonio({});
    await recheckPendingRefunds({ provider, now: NOW });
    expect(fetchOrder).not.toHaveBeenCalled();
  });

  it("reads Montonio's own GET /orders/:uuid answer, strings and all", async () => {
    const { recheckPendingRefunds } = await import("@/lib/payments/refund-recheck");
    const { MontonioProvider } = await import("@/lib/payments/montonio");
    const order = await pendingSince("0ac2124d-9f8e-4a29-816d-7eef5b9bb0fd", 40, NOW, 1);
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/orders/0ac2124d-9f8e-4a29-816d-7eef5b9bb0fd")) {
          return new Response(
            JSON.stringify({
              uuid: "0ac2124d-9f8e-4a29-816d-7eef5b9bb0fd",
              paymentStatus: "PARTIALLY_REFUNDED",
              grandTotal: String(order.total),
              currency: "EUR",
              availableForRefund: 0,
              refunds: [{ uuid: REFUND_UUID, amount: "1", status: "SUCCESSFUL", createdAt: "2026-09-26T19:39:00.000Z" }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const provider = new MontonioProvider({ accessKey: "ak_test", secretKey: "sk_test_secret_key_long_enough", env: "live" });

    const report = await recheckPendingRefunds({ provider, now: NOW });

    expect(calls).toEqual(["https://stargate.montonio.com/api/orders/0ac2124d-9f8e-4a29-816d-7eef5b9bb0fd"]);
    expect(report.done).toBe(1);
    expect(refundsOf((await getOrder(order.id))!.payment)[0].status).toBe("done");
    expect(letters("order-refunded")).toBe(1);
  });

  it("never throws out of the cron, even when the database will not answer", async () => {
    const { recheckPendingRefunds } = await import("@/lib/payments/refund-recheck");
    const db = await import("@/lib/db");
    const { provider } = montonio({});
    const spy = vi.spyOn(db, "query").mockRejectedValue(new Error("connection reset"));
    try {
      const report = await recheckPendingRefunds({ provider, now: NOW });
      expect(report.skipped).toBe("error");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("B9 — the flows cron carries the re-check", () => {
  it("answers with the re-check's counts and still 200 when there is nothing to ask", async () => {
    const saved = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "s3cret-for-the-cron";
    try {
      const { GET } = await import("@/app/api/cron/flows/route");
      const res = await GET(
        new Request("https://rempireshop.com/api/cron/flows/", { headers: { authorization: "Bearer s3cret-for-the-cron" } }),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; refunds?: Record<string, unknown> };
      expect(body.ok).toBe(true);
      // the mock bank cannot be asked — the re-check says so instead of failing
      expect(body.refunds).toMatchObject({ skipped: "provider_cannot_ask" });
    } finally {
      if (saved === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = saved;
    }
  });
});

/* ------------------------------------------------------------------------ *
 * B17 — the routes that can outlive ten seconds say so
 * ------------------------------------------------------------------------ */

describe("B17 — maxDuration on the money and label routes", () => {
  it("exports 60 s where a Montonio call alone may take 15", async () => {
    const routes = await Promise.all([
      import("@/app/api/admin/orders/[id]/refund/route"),
      import("@/app/api/payments/notify/route"),
      import("@/app/api/payments/return/route"),
      import("@/app/api/payments/create/route"),
      import("@/app/api/admin/shipments/[id]/label/route"),
      import("@/app/api/admin/montonio/route"),
    ]);
    for (const r of routes) expect((r as { maxDuration?: number }).maxDuration).toBe(60);
  });
});
