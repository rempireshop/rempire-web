/**
 * Gift cards bought IN an order are minted when the order is paid — and still
 * get minted when the process died between `setOrderStatus(paid)` and the mail
 * hook, so the provider's retry finds a paid order with no cards. That retry
 * must mint the cards and nothing else: no second owner ping, no second
 * customer letter (audit H4 and its follow-up).
 *
 * Real Postgres (PGlite), real orders, the real notify/return routes driven
 * with the mock provider's signed tickets. fetch is stubbed so Telegram and
 * Resend calls can be counted.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exec, query } from "@/lib/db";
import { createOrder, setOrderStatus, type Order } from "@/lib/orders";
import { mockSecret, signMockTicket } from "@/lib/payments/mock";
import { resetRateLimits } from "@/lib/payments/ratelimit";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

const BASE = "https://test.rempireshop.com";

const ENV_KEYS = [
  "PAYMENT_PROVIDER",
  "SESSION_SECRET",
  "RESEND_API_KEY",
  "RESEND_TO",
  "MAIL_RETRY_DELAY_MS",
  "MAIL_PENDING_PAYMENT",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "PUBLIC_BASE_URL",
] as const;
let saved: Record<string, string | undefined> = {};

/* ---------- the outside world ------------------------------------------ */

interface Sent {
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/** Routes the stubbed fetch by host so the channels can be told apart. */
function makeFetch() {
  const calls = { resend: [] as Sent[], telegram: [] as Sent[] };
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const sent: Sent = {
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    if (u.includes("api.resend.com")) calls.resend.push(sent);
    else if (u.includes("api.telegram.org")) calls.telegram.push(sent);
    else throw new Error(`unexpected fetch: ${u}`);
    return new Response(JSON.stringify({ id: "msg_1", ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { fn, calls };
}

/** The `template` tag of a Resend call; the owner ping through notify.ts has none. */
function templateOf(sent: Sent): string | null {
  const tags = sent.body.tags as { name: string; value: string }[] | undefined;
  return tags?.find((t) => t.name === "template")?.value ?? null;
}

function letters(calls: Sent[], template: string): Sent[] {
  return calls.filter((c) => templateOf(c) === template);
}

/* ---------- orders and tickets ----------------------------------------- */

async function giftOrder(): Promise<Order> {
  return createOrder({
    lang: "ru",
    items: [
      {
        id: "gift:50",
        qty: 1,
        meta: { name: "Mari", email: "mari@example.com", message: "С днём рождения!" },
      },
    ],
    customer: { name: "Мария Тамм", email: "maria@example.com", phone: "" },
    shipping: { method: "parcel", country: "EE" },
  });
}

function paidTicket(o: Order): string {
  return signMockTicket(
    {
      orderRef: o.number,
      ref: "mock_test_1",
      returnUrl: `${BASE}/api/payments/return/`,
      amount: o.total,
      status: "paid",
    },
    mockSecret(),
  );
}

async function webhook(token: string): Promise<Response> {
  const { POST } = await import("@/app/api/payments/notify/route");
  return POST(
    new Request(`${BASE}/api/payments/notify/`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify({ mockToken: token }),
    }),
  );
}

async function comeBack(token: string): Promise<Response> {
  const { GET } = await import("@/app/api/payments/return/route");
  return GET(
    new Request(`${BASE}/api/payments/return/?mock-token=${encodeURIComponent(token)}`, {
      headers: { "x-forwarded-for": "203.0.113.7" },
    }),
  );
}

async function cardsOf(orderId: string): Promise<{ code: string; amount: number }[]> {
  const rows = await query<{ code: string; amount: string | number }>(
    "select code, amount from gift_cards where order_id = $1 order by created_at",
    [orderId],
  );
  return rows.map((r) => ({ code: r.code, amount: Number(r.amount) }));
}

/* ---------- rig ---------------------------------------------------------- */

describe("gift cards bought in an order survive a replayed payment", () => {
  beforeAll(async () => {
    const applied = await setupDb();
    expect(applied).toContain("020_gift_cards.sql");
  });
  afterAll(teardownDb);

  beforeEach(async () => {
    saved = {};
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env.PAYMENT_PROVIDER = "mock";
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.MAIL_RETRY_DELAY_MS = "0";
    process.env.PUBLIC_BASE_URL = BASE;
    process.env.TELEGRAM_BOT_TOKEN = "tg_token";
    process.env.TELEGRAM_CHAT_ID = "42";
    resetRateLimits();
    await exec("truncate gift_card_uses, gift_cards restart identity cascade");
    await exec("truncate orders, admin_audit restart identity");
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.unstubAllGlobals();
  });

  it("mints the cards, mails them, and pings the shop once on the transition into paid", async () => {
    const { fn, calls } = makeFetch();
    vi.stubGlobal("fetch", fn);
    const o = await giftOrder();

    const res = await webhook(paidTicket(o));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "paid" });
    expect(await cardsOf(o.id)).toMatchObject([{ amount: 50 }]);
    expect(calls.telegram).toHaveLength(1);
    expect(letters(calls.resend, "order-confirmed")).toHaveLength(1);
    const gift = letters(calls.resend, "gift-card");
    expect(gift).toHaveLength(1);
    expect(gift[0].body.to).toEqual(["mari@example.com"]);
  });

  it("a replayed webhook leaves one set of cards and does not ping the shop again", async () => {
    const { fn, calls } = makeFetch();
    vi.stubGlobal("fetch", fn);
    const o = await giftOrder();
    const token = paidTicket(o);

    await webhook(token);
    const first = await cardsOf(o.id);
    const res = await webhook(token);

    expect(res.status).toBe(200);
    expect(await cardsOf(o.id)).toEqual(first);
    expect(calls.telegram).toHaveLength(1);
    expect(letters(calls.resend, "order-confirmed")).toHaveLength(1);
    // Whatever the replay re-sends for the card carries the same idempotency
    // key, so Resend collapses it into the one letter the recipient already has.
    const keys = new Set(letters(calls.resend, "gift-card").map((c) => c.headers["Idempotency-Key"]));
    expect(keys).toEqual(new Set([`gift:${first[0].code}`]));
  });

  it("the shopper's return after the webhook mints nothing new and pings nobody", async () => {
    const { fn, calls } = makeFetch();
    vi.stubGlobal("fetch", fn);
    const o = await giftOrder();
    const token = paidTicket(o);

    await webhook(token);
    const first = await cardsOf(o.id);
    const res = await comeBack(token);

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("s=paid");
    expect(await cardsOf(o.id)).toEqual(first);
    expect(calls.telegram).toHaveLength(1);
    expect(letters(calls.resend, "order-confirmed")).toHaveLength(1);
  });

  it("the crash window: a paid order with no cards gets them from the retry, and only them", async () => {
    const { fn, calls } = makeFetch();
    vi.stubGlobal("fetch", fn);
    const o = await giftOrder();
    // The process died right after the status write and before the mail hook:
    // the order is paid, the customer has paid for a card that does not exist.
    await setOrderStatus(o.id, "paid", "payment:mock");
    expect(await cardsOf(o.id)).toHaveLength(0);

    const res = await webhook(paidTicket(o));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "paid" });
    expect(await cardsOf(o.id)).toMatchObject([{ amount: 50 }]);
    const gift = letters(calls.resend, "gift-card");
    expect(gift).toHaveLength(1);
    expect(gift[0].body.to).toEqual(["mari@example.com"]);
    // a retry, not a payment: Renat is not pinged and the customer gets no second letter
    expect(calls.telegram).toHaveLength(0);
    expect(letters(calls.resend, "order-confirmed")).toHaveLength(0);
  });

  it("the crash window, closed by the shopper's return instead of the webhook", async () => {
    const { fn, calls } = makeFetch();
    vi.stubGlobal("fetch", fn);
    const o = await giftOrder();
    await setOrderStatus(o.id, "paid", "payment:mock");

    const res = await comeBack(paidTicket(o));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("s=paid");
    expect(await cardsOf(o.id)).toMatchObject([{ amount: 50 }]);
    expect(letters(calls.resend, "gift-card")).toHaveLength(1);
    expect(calls.telegram).toHaveLength(0);
    expect(letters(calls.resend, "order-confirmed")).toHaveLength(0);
  });

  it("issueOrderGiftCards is the gift-card half of onOrderPaid on its own", async () => {
    const { fn, calls } = makeFetch();
    vi.stubGlobal("fetch", fn);
    const hooks = await import("@/lib/mail-hooks");
    const o = await giftOrder();

    const res = await hooks.issueOrderGiftCards(o);

    expect(res.ok).toBe(true);
    expect(await cardsOf(o.id)).toMatchObject([{ amount: 50 }]);
    expect(letters(calls.resend, "gift-card")).toHaveLength(1);
    expect(calls.telegram).toHaveLength(0);
    expect(letters(calls.resend, "order-confirmed")).toHaveLength(0);

    // an order with no gift lines is a no-op, and says so
    const plain = { ...o, items: [{ id: "p1", title: "Fresh.Hair", qty: 1, price: 27, sum: 27 }] };
    expect(await hooks.issueOrderGiftCards(plain)).toMatchObject({ ok: true, skipped: true });
    expect(letters(calls.resend, "gift-card")).toHaveLength(1);
  });
});
