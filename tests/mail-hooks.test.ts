/**
 * The three names backend-core and the payments agent import dynamically.
 * What is being protected here is the promise on the tin: these hooks never
 * throw, whatever the order row looks like and whatever the network does —
 * an order that is already in the database must not be undone by a letter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onOrderCreated, onOrderPaid, onOrderShipped } from "@/lib/mail-hooks";
import type { OrderLike } from "@/emails";

const ENV_KEYS = [
  "RESEND_API_KEY",
  "RESEND_FROM",
  "RESEND_TO",
  "MAIL_REPLY_TO",
  "MAIL_RETRY_DELAY_MS",
  "MAIL_PENDING_PAYMENT",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "PUBLIC_BASE_URL",
] as const;

let saved: Record<string, string | undefined> = {};

const ORDER: OrderLike = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  number: "R-100042",
  lang: "RU",
  email: "klient@example.com",
  name: "Renat",
  items: [{ id: "p1", title: "Fresh.Hair", brand: "Kevin.Murphy", qty: 2, price: 27, sum: 54 }],
  shipping: { method: "parcel", carrier: "omniva", pointName: "Kristiine keskus" },
  shippingPrice: 3.5,
  total: 57.5,
};

/** Routes the mocked fetch by host so we can tell the channels apart. */
function makeFetch() {
  const calls = { resend: [] as unknown[][], telegram: [] as unknown[][] };
  const fn = vi.fn(async (url: unknown, init: unknown) => {
    const u = String(url);
    if (u.includes("api.resend.com")) calls.resend.push([url, init]);
    if (u.includes("api.telegram.org")) calls.telegram.push([url, init]);
    return new Response(JSON.stringify({ id: "msg_1", ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { fn, calls };
}

function payloadOf(call: unknown[]): Record<string, unknown> {
  return JSON.parse(String((call[1] as RequestInit).body));
}

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_RETRY_DELAY_MS = "0";
  process.env.PUBLIC_BASE_URL = "https://test.rempireshop.com";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("onOrderCreated", () => {
  it("is a no-op by default — an abandoned unpaid order sends nothing", async () => {
    const { fn, calls } = makeFetch();
    vi.stubGlobal("fetch", fn);

    const res = await onOrderCreated(ORDER);

    expect(res).toEqual({ ok: true, skipped: true, reason: "disabled" });
    expect(calls.resend).toHaveLength(0);
  });

  it("sends when MAIL_PENDING_PAYMENT is on", async () => {
    process.env.MAIL_PENDING_PAYMENT = "1";
    const { fn, calls } = makeFetch();
    vi.stubGlobal("fetch", fn);

    const res = await onOrderCreated(ORDER);

    expect(res.ok).toBe(true);
    expect(calls.resend).toHaveLength(1);
    const body = payloadOf(calls.resend[0]);
    expect(body.to).toEqual(["klient@example.com"]);
    expect(String(body.subject)).toContain("R-100042");
    expect(body.tags).toContainEqual({ name: "stage", value: "pending" });
  });

  it("sends when the caller passes the setting in directly", async () => {
    const { fn, calls } = makeFetch();
    vi.stubGlobal("fetch", fn);

    const res = await onOrderCreated(ORDER, { sendPending: true });

    expect(res.ok).toBe(true);
    expect(calls.resend).toHaveLength(1);
  });

  it("skips an order with no customer address", async () => {
    process.env.MAIL_PENDING_PAYMENT = "1";
    const { fn, calls } = makeFetch();
    vi.stubGlobal("fetch", fn);

    const res = await onOrderCreated({ ...ORDER, email: null });

    expect(res).toMatchObject({ ok: true, skipped: true, reason: "no_customer_email" });
    expect(calls.resend).toHaveLength(0);
  });
});

describe("onOrderPaid", () => {
  it("writes to the customer and pings the shop", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "tg_token";
    process.env.TELEGRAM_CHAT_ID = "42";
    const { fn, calls } = makeFetch();
    vi.stubGlobal("fetch", fn);

    const res = await onOrderPaid(ORDER);

    expect(res.ok).toBe(true);
    expect(res.notified).toBe(true);

    // one customer letter + one owner letter through notify.ts
    expect(calls.resend).toHaveLength(2);
    const customer = payloadOf(calls.resend[0]);
    expect(customer.to).toEqual(["klient@example.com"]);
    expect(String(customer.html)).toContain("Заказ принят");
    expect(customer.tags).toContainEqual({ name: "stage", value: "paid" });

    expect(calls.telegram).toHaveLength(1);
    const tg = payloadOf(calls.telegram[0]);
    expect(String(tg.text)).toContain("R-100042");
    expect(String(tg.text)).toContain("Kevin.Murphy Fresh.Hair");
  });

  it("renders in the order's own language", async () => {
    const { fn, calls } = makeFetch();
    vi.stubGlobal("fetch", fn);

    await onOrderPaid({ ...ORDER, lang: "ET" });

    expect(String(payloadOf(calls.resend[0]).subject)).toContain("Tellimus");
  });

  it("still pings the shop when the order has no customer address", async () => {
    const { fn, calls } = makeFetch();
    vi.stubGlobal("fetch", fn);

    const res = await onOrderPaid({ ...ORDER, email: null });

    expect(res.skipped).toBe(true);
    expect(res.reason).toBe("no_customer_email");
    // only the owner notification went out
    expect(calls.resend).toHaveLength(1);
  });

  it("does not throw when Resend is down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("the network is on fire")),
    );
    await expect(onOrderPaid(ORDER)).resolves.toMatchObject({ ok: false });
  });

  it("does not throw on a garbage order", async () => {
    vi.stubGlobal("fetch", makeFetch().fn);
    await expect(
      onOrderPaid(null as unknown as OrderLike),
    ).resolves.toMatchObject({ ok: false, reason: "exception" });
  });
});

describe("onOrderShipped", () => {
  it("sends the tracking code", async () => {
    const { fn, calls } = makeFetch();
    vi.stubGlobal("fetch", fn);

    const res = await onOrderShipped(ORDER, {
      code: "CE123456789EE",
      carrier: "omniva",
    });

    expect(res.ok).toBe(true);
    const body = payloadOf(calls.resend[0]);
    expect(String(body.html)).toContain("CE123456789EE");
    expect(String(body.text)).toContain("omniva.ee");
    expect(body.tags).toContainEqual({
      name: "template",
      value: "order-shipped",
    });
  });

  it("accepts a bare tracking string", async () => {
    const { fn, calls } = makeFetch();
    vi.stubGlobal("fetch", fn);

    await onOrderShipped(ORDER, "JJFI0012345");

    expect(String(payloadOf(calls.resend[0]).html)).toContain("JJFI0012345");
  });

  it("sends even with no tracking code at all", async () => {
    const { fn, calls } = makeFetch();
    vi.stubGlobal("fetch", fn);

    const res = await onOrderShipped(ORDER);

    expect(res.ok).toBe(true);
    expect(String(payloadOf(calls.resend[0]).html)).not.toContain("undefined");
  });

  it("does not throw on a garbage order", async () => {
    vi.stubGlobal("fetch", makeFetch().fn);
    await expect(
      onOrderShipped(undefined as unknown as OrderLike, "X"),
    ).resolves.toMatchObject({ ok: false, reason: "exception" });
  });
});
