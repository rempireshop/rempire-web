/**
 * Customer letters held ten seconds (admin redesign 1a, Dim 25.09.2026, q3):
 * «Отправлен», «Отменить заказ», «Отправить счёт ещё раз» and «Написать
 * клиенту» change the order at once, and the letter leaves from the server ten
 * seconds later — unless «Вернуть» took the change back in the meantime
 * (src/lib/letter-hold.ts, the order PATCH route, the invoice route and
 * /api/admin/mail/send).
 *
 * The ten seconds run on a FAKE CLOCK: `letterClock.sleep` is replaced by one
 * the test steps by hand, so nothing here waits for real time, and a letter
 * that would have left early (or at all) is caught at the step it happened.
 */
import catalogueMin from "@/data/catalogue.min.json";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* The two status letters, counted where they would leave. Everything else in
   the module stays real — the invoice route and the paid-by-hand path use it. */
const sentShipped: string[] = [];
const sentClosed: Array<{ number: string; kind: string }> = [];
vi.mock("@/lib/mail-hooks", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    onOrderShipped: vi.fn(async (o: { number: string }) => {
      sentShipped.push(o.number);
      return { ok: true, sent: true };
    }),
    onOrderClosed: vi.fn(async (o: { number: string }, opts: { kind: string }) => {
      sentClosed.push({ number: o.number, kind: opts.kind });
      return { ok: true, sent: true };
    }),
  };
});

import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { query } from "@/lib/db";
import { heldLetters, LETTER_HOLD_MS, letterClock, lettersSettled } from "@/lib/letter-hold";
import { listMessages } from "@/lib/order-messages";
import { createOrder, getOrder, setOrderStatus } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

type Min = { id: string; s: string };
const PRODUCT = (catalogueMin as Min[]).find((p) => p.s === "in")!.id;

/* ---------- the fake clock ---------------------------------------------- */
let clockNow = 0;
let sleepers: Array<{ at: number; wake: () => void }> = [];
const realSleep = letterClock.sleep;
/** Moves the clock forward and lets every hold that fell due run to its end. */
async function tick(ms: number) {
  clockNow += ms;
  const due = sleepers.filter((s) => s.at <= clockNow);
  sleepers = sleepers.filter((s) => s.at > clockNow);
  due.forEach((s) => s.wake());
  if (due.length) await lettersSettled();
}

/* ---------- requests ------------------------------------------------------ */
const admin = () => `${ADMIN_COOKIE}=${makeSessionToken()}`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
function req(url: string, method: string, body: unknown) {
  return new Request(`https://rempireshop.com${url}`, {
    method,
    headers: { "content-type": "application/json", cookie: admin() },
    body: JSON.stringify(body),
  });
}
async function patch(id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/admin/orders/[id]/route");
  const res = await PATCH(req(`/api/admin/orders/${id}/`, "PATCH", body), ctx(id));
  return { status: res.status, body: await res.json() };
}

async function paidParcel() {
  const o = await createOrder({
    lang: "ru",
    items: [{ id: PRODUCT, qty: 1 }],
    customer: { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" },
    shipping: { method: "parcel", country: "EE", pointId: "1", pointName: "Kristiine" },
  });
  await setOrderStatus(o.id, "paid");
  return (await getOrder(o.id))!;
}

describe("customer letters held ten seconds", () => {
  const savedKey = process.env.RESEND_API_KEY;
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
  });
  afterAll(async () => {
    letterClock.sleep = realSleep;
    await teardownDb();
    if (savedKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = savedKey;
  });
  beforeEach(async () => {
    resetRateLimits();
    await truncateAll();
    sentShipped.length = 0;
    sentClosed.length = 0;
    clockNow = 0;
    sleepers = [];
    letterClock.sleep = (ms: number) => new Promise<void>((wake) => sleepers.push({ at: clockNow + ms, wake }));
    delete process.env.RESEND_API_KEY;
  });
  afterEach(async () => {
    // nothing may be left sleeping into the next test
    await tick(60_000);
    vi.unstubAllGlobals();
  });

  it("«Отправлен» moves the status now and sends «Заказ отправлен» ten seconds later", async () => {
    const o = await paidParcel();
    const r = await patch(o.id, { status: "shipped" });
    expect(r.status).toBe(200);
    expect(r.body.order.status).toBe("shipped");
    expect(r.body.letter).toMatchObject({ held: true, kind: "shipped", ms: LETTER_HOLD_MS });
    expect((await getOrder(o.id))!.status).toBe("shipped");
    expect(heldLetters(await getOrder(o.id))).toHaveLength(1);

    await tick(LETTER_HOLD_MS - 1);
    expect(sentShipped, "the letter must not leave before the ten seconds are up").toEqual([]);
    await tick(1);
    expect(sentShipped).toEqual([o.number]);
    expect(heldLetters(await getOrder(o.id)), "the token is spent").toHaveLength(0);
  });

  it("«Вернуть» inside the ten seconds stops the letter", async () => {
    const o = await paidParcel();
    await patch(o.id, { status: "shipped" });
    await tick(6_000);
    const back = await patch(o.id, { status: "paid" });
    expect(back.body.order.status).toBe("paid");
    expect(heldLetters(await getOrder(o.id))).toHaveLength(0);
    await tick(10_000);
    expect(sentShipped).toEqual([]);
  });

  it("undo then «Отправлен» again inside the ten seconds sends exactly one letter", async () => {
    const o = await paidParcel();
    await patch(o.id, { status: "shipped" });
    await tick(2_000);
    await patch(o.id, { status: "paid" });
    await tick(1_000);
    await patch(o.id, { status: "shipped" });
    await tick(7_000);                     // the first hold is up — its token was voided by the undo
    expect(sentShipped).toEqual([]);
    await tick(3_000);                     // the second one's
    expect(sentShipped).toEqual([o.number]);
  });

  it("«Доставлен» right after «Отправлен» does not swallow «Заказ отправлен»", async () => {
    const o = await paidParcel();
    await patch(o.id, { status: "shipped" });
    await tick(3_000);
    const d = await patch(o.id, { status: "delivered" });
    expect(d.body.letter, "«Доставлен» sends nothing of its own").toBeUndefined();
    await tick(10_000);
    expect(sentShipped).toEqual([o.number]);
  });

  it("«Отменить заказ» is held the same way, and its «Вернуть» stops «Заказ отменён»", async () => {
    const kept = await paidParcel();
    const r = await patch(kept.id, { status: "cancelled" });
    expect(r.body.letter).toMatchObject({ held: true, kind: "cancelled" });
    expect(sentClosed).toEqual([]);
    await tick(LETTER_HOLD_MS);
    expect(sentClosed).toEqual([{ number: kept.number, kind: "cancelled" }]);

    const undone = await paidParcel();
    await patch(undone.id, { status: "cancelled" });
    await tick(4_000);
    await patch(undone.id, { status: "paid" });
    await tick(LETTER_HOLD_MS);
    expect(sentClosed.map((s) => s.number)).toEqual([kept.number]);
  });

  it("a hand-set «возврат» is money: its letter goes at once, not held", async () => {
    const o = await paidParcel();
    const r = await patch(o.id, { status: "refunded" });
    expect(r.body.letter).toBeUndefined();
    expect(sentClosed).toEqual([{ number: o.number, kind: "refunded" }]);
  });

  it("letterCancel on a token that is gone answers cancelled: false", async () => {
    const o = await paidParcel();
    const r = await patch(o.id, { letterCancel: "00000000-0000-4000-8000-000000000000" });
    expect(r.status).toBe(200);
    expect(r.body.cancelled).toBe(false);
  });

  describe("«Написать клиенту»", () => {
    function resendOk() {
      return new Response(JSON.stringify({ id: "re_held_1" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    async function send(orderId: string, body: Record<string, unknown>) {
      const { POST } = await import("@/app/api/admin/mail/send/route");
      const res = await POST(req("/api/admin/mail/send/", "POST", { orderId, ...body }));
      return { status: res.status, body: await res.json() };
    }

    it("answers at once with the thread as it was, and sends ten seconds later", async () => {
      process.env.RESEND_API_KEY = "re_test_key";
      const fetchSpy = vi.fn(async () => resendOk());
      vi.stubGlobal("fetch", fetchSpy);
      const o = await paidParcel();
      const r = await send(o.id, { reply: "Уже в пути.", customerMessage: "Когда придёт?" });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ ok: true, held: true, kind: "reply", ms: LETTER_HOLD_MS });
      expect(r.body.messages).toEqual([]);
      expect(fetchSpy).not.toHaveBeenCalled();

      await tick(LETTER_HOLD_MS);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const thread = await listMessages(o.id);
      expect(thread.map((m) => [m.direction, m.body])).toEqual([
        ["in", "Когда придёт?"],
        ["out", "Уже в пути."],
      ]);
    });

    it("«Вернуть» (PATCH letterCancel) stops it: nothing is sent and nothing is stored", async () => {
      process.env.RESEND_API_KEY = "re_test_key";
      const fetchSpy = vi.fn(async () => resendOk());
      vi.stubGlobal("fetch", fetchSpy);
      const o = await paidParcel();
      const r = await send(o.id, { reply: "Передумал" });
      await tick(3_000);
      const c = await patch(o.id, { letterCancel: r.body.token });
      expect(c.body.cancelled).toBe(true);
      await tick(LETTER_HOLD_MS);
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(await listMessages(o.id)).toHaveLength(0);
      // a second «Вернуть» has nothing left to stop
      expect((await patch(o.id, { letterCancel: r.body.token })).body.cancelled).toBe(false);
    });

    it("two replies inside ten seconds are two letters — one «Вернуть» stops only its own", async () => {
      process.env.RESEND_API_KEY = "re_test_key";
      const fetchSpy = vi.fn(async () => resendOk());
      vi.stubGlobal("fetch", fetchSpy);
      const o = await paidParcel();
      const a = await send(o.id, { reply: "Первое" });
      const b = await send(o.id, { reply: "Второе" });
      expect(a.body.token).not.toBe(b.body.token);
      await patch(o.id, { letterCancel: a.body.token });
      await tick(LETTER_HOLD_MS);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect((await listMessages(o.id)).map((m) => m.body)).toEqual(["Второе"]);
    });

    it("a letter Resend refuses after the hold stores nothing", async () => {
      process.env.RESEND_API_KEY = "re_test_key";
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "invalid" }), { status: 422 })));
      const o = await paidParcel();
      const r = await send(o.id, { reply: "hi" });
      expect(r.status).toBe(200);
      await tick(LETTER_HOLD_MS);
      expect(await listMessages(o.id)).toHaveLength(0);
    });
  });

  describe("«Отправить счёт ещё раз»", () => {
    async function invoiceOrder() {
      const o = await createOrder({
        lang: "ru",
        items: [{ id: PRODUCT, qty: 1 }],
        customer: { name: "Anna", email: "anna@example.com", phone: "+372 5555 5555" },
        shipping: { method: "parcel", country: "EE", pointId: "1", pointName: "Kristiine" },
      });
      await query(
        `update orders set invoice = $2::jsonb where id = $1`,
        [o.id, JSON.stringify({ number: "A-2026-0001", dueAt: "2026-10-01", email: "books@example.com", sentAt: null, sendError: "" })],
      );
      return (await getOrder(o.id))!;
    }
    async function resend(id: string) {
      const { POST } = await import("@/app/api/admin/orders/[id]/invoice/route");
      const res = await POST(req(`/api/admin/orders/${id}/invoice/`, "POST", { action: "resend" }), ctx(id));
      return { status: res.status, body: await res.json() };
    }

    /* Every attempt — sent or refused (no IBAN in this database) — leaves an
       `invoice.sent` line (resendInvoice), so the line is what is counted:
       it is written at the moment the letter is actually tried. */
    const attempts = async () =>
      Number((await query<{ n: string }>("select count(*) as n from admin_audit where action = 'invoice.sent'"))[0].n);

    it("is held with a mail key, and «Вернуть» stops it", async () => {
      process.env.RESEND_API_KEY = "re_test_key";
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "re_inv" }), { status: 200 })));
      const o = await invoiceOrder();
      const r = await resend(o.id);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ ok: true, held: true, kind: "invoice" });
      expect((await patch(o.id, { letterCancel: r.body.token })).body.cancelled).toBe(true);
      await tick(LETTER_HOLD_MS);
      expect(await attempts()).toBe(0);
    });

    it("…and without «Вернуть» it goes after the ten seconds", async () => {
      process.env.RESEND_API_KEY = "re_test_key";
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "re_inv" }), { status: 200 })));
      const o = await invoiceOrder();
      await resend(o.id);
      expect(await attempts()).toBe(0);
      await tick(LETTER_HOLD_MS);
      expect(await attempts()).toBe(1);
    });

    it("with no mail key nothing is held: the answer says at once that it did not go", async () => {
      const o = await invoiceOrder();
      const r = await resend(o.id);
      expect(r.body.held).toBeUndefined();
      expect(r.body).toMatchObject({ ok: true, sent: false });
      expect(await attempts(), "tried now, not in ten seconds").toBe(1);
    });
  });
});
