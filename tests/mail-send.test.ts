/**
 * POST /api/admin/mail/send — the owner's reply to a customer. Resend itself
 * is mocked (fetch stub, same idiom as tests/mail.test.ts); this file is
 * about auth, validation, and that a successful send stores both sides of
 * the exchange in order_messages.
 *
 * Since 25.09.2026 the letter is HELD ten seconds (admin redesign 1a, q3;
 * src/lib/letter-hold.ts): the route answers at once and sends from after().
 * The hold runs on a fake clock here — `settle()` steps it past the ten
 * seconds and waits for the send — and tests/letter-hold.test.ts covers the
 * hold itself («Вернуть», two letters at once).
 */
import catalogueMin from "@/data/catalogue.min.json";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { createOrder } from "@/lib/orders";
import { query } from "@/lib/db";
import { LETTER_HOLD_MS, letterClock, lettersSettled } from "@/lib/letter-hold";
import { listMessages } from "@/lib/order-messages";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

/* the fake clock the hold waits on: every sleeper wakes when settle() says so */
let sleepers: Array<() => void> = [];
const realSleep = letterClock.sleep;
async function settle() {
  const wake = sleepers;
  sleepers = [];
  wake.forEach((w) => w());
  await lettersSettled();
}

type Min = { id: string; s: string };
const product = (catalogueMin as Min[]).find((p) => p.s === "in")!;

const ORIGIN = "https://rempireshop.com";

function post(body: unknown, cookie?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}/api/admin/mail/send/`, { method: "POST", headers, body: JSON.stringify(body) });
}

function resendOk(id = "re_test_123") {
  return new Response(JSON.stringify({ id }), { status: 200, headers: { "content-type": "application/json" } });
}

async function makeOrder(email = "customer@example.com") {
  return createOrder({
    lang: "RU",
    items: [{ id: product.id, qty: 1 }],
    customer: { name: "Test Ostja", email, phone: "+372 5555 5555" },
    shipping: { method: "parcel", country: "EE", pointId: "1", pointName: "Kristiine" },
  });
}

describe("POST /api/admin/mail/send", () => {
  let admin = "";
  const savedKey = process.env.RESEND_API_KEY;

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
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
    process.env.RESEND_API_KEY = "re_test_key";
    letterClock.sleep = (ms: number) => {
      expect(ms).toBe(LETTER_HOLD_MS);
      return new Promise<void>((wake) => sleepers.push(wake));
    };
  });
  afterEach(async () => {
    await settle();   // nothing left waiting into the next test
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("401s without the admin cookie", async () => {
    const { POST } = await import("@/app/api/admin/mail/send/route");
    const res = await POST(post({ orderId: "x", reply: "hi" }));
    expect(res.status).toBe(401);
  });

  it("400s with no reply text", async () => {
    const { POST } = await import("@/app/api/admin/mail/send/route");
    const order = await makeOrder();
    const res = await POST(post({ orderId: order.id }, admin));
    expect(res.status).toBe(400);
  });

  it("404s an order that does not exist", async () => {
    const { POST } = await import("@/app/api/admin/mail/send/route");
    vi.stubGlobal("fetch", () => { throw new Error("must not call Resend for a missing order"); });
    const res = await POST(post({ orderId: "00000000-0000-0000-0000-000000000000", reply: "hi" }, admin));
    expect(res.status).toBe(404);
  });

  it("503s (skipped) when RESEND_API_KEY is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    const { POST } = await import("@/app/api/admin/mail/send/route");
    const order = await makeOrder();
    const res = await POST(post({ orderId: order.id, reply: "hi" }, admin));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.skipped).toBe(true);
  });

  it("sends the reply and stores it as an 'out' message — no pasted customer message means no 'in' row", async () => {
    const order = await makeOrder();
    vi.stubGlobal("fetch", vi.fn(async () => resendOk()));
    const { POST } = await import("@/app/api/admin/mail/send/route");

    const res = await POST(post({ orderId: order.id, reply: "Ваш заказ уже собран." }, admin));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // held: the answer comes at once, with the thread as it was
    expect(body).toMatchObject({ held: true, kind: "reply", ms: LETTER_HOLD_MS });
    expect(body.messages).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();

    await settle();
    const thread = await listMessages(order.id);
    expect(thread).toHaveLength(1);
    expect(thread[0].direction).toBe("out");
    expect(thread[0].body).toBe("Ваш заказ уже собран.");

    // the request actually went to Resend, addressed to the order's e-mail
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const payload = JSON.parse(String((init as RequestInit).body));
    expect(payload.to).toEqual([order.email]);
    expect(payload.subject).toBe(`Re: заказ ${order.number}`);
  });

  it("with a pasted customer message, stores both sides — 'in' before 'out'", async () => {
    const order = await makeOrder();
    vi.stubGlobal("fetch", vi.fn(async () => resendOk()));
    const { POST } = await import("@/app/api/admin/mail/send/route");

    await POST(post({ orderId: order.id, customerMessage: "Когда придёт?", reply: "Уже в пути." }, admin));
    await settle();

    const thread = await listMessages(order.id);
    expect(thread).toHaveLength(2);
    expect(thread[0]).toMatchObject({ direction: "in", body: "Когда придёт?" });
    expect(thread[1]).toMatchObject({ direction: "out", body: "Уже в пути." });
  });

  it("400s an order with no customer e-mail on file", async () => {
    // createOrder() itself requires a valid e-mail (bad_email otherwise), so
    // the only way a stored order ends up without one is a row edited after
    // the fact — simulated here directly, to exercise the route's own guard.
    const order = await makeOrder();
    await query("update orders set email = '' where id = $1", [order.id]);
    vi.stubGlobal("fetch", () => { throw new Error("must not call Resend with no recipient"); });
    const { POST } = await import("@/app/api/admin/mail/send/route");
    const res = await POST(post({ orderId: order.id, reply: "hi" }, admin));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("no_customer_email");
  });

  /* Resend's refusal now comes ten seconds after the answer, so the answer
     cannot carry it: nothing is stored, and the panel — which reads the
     thread again after the hold — says the letter did not go. */
  it("when Resend refuses the held send, stores nothing", async () => {
    const order = await makeOrder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ message: "invalid" }), { status: 422 })),
    );
    const { POST } = await import("@/app/api/admin/mail/send/route");
    const res = await POST(post({ orderId: order.id, reply: "hi" }, admin));
    expect(res.status).toBe(200);
    await settle();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await listMessages(order.id)).toHaveLength(0);
  });

  it("finds the order by its human-readable number as well as its id", async () => {
    const order = await makeOrder();
    vi.stubGlobal("fetch", vi.fn(async () => resendOk()));
    const { POST } = await import("@/app/api/admin/mail/send/route");
    const res = await POST(post({ orderId: order.number, reply: "hi" }, admin));
    expect(res.status).toBe(200);
  });

  it("rate-limits after 30 sends in the window", async () => {
    const order = await makeOrder();
    vi.stubGlobal("fetch", vi.fn(async () => resendOk()));
    const { POST } = await import("@/app/api/admin/mail/send/route");
    let last;
    for (let i = 0; i < 31; i++) {
      last = await POST(post({ orderId: order.id, reply: "hi " + i }, admin));
    }
    expect(last!.status).toBe(429);
  });
});
