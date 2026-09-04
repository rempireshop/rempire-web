/**
 * Money and stock invariants, driven through the real routes.
 *
 * The fuzz file next door proves no input makes a route fall over; this one
 * proves that when a hostile input *is* accepted, the numbers it produces are
 * still the server's own. Everything here goes in through
 * POST /api/orders → POST /api/payments/create → POST /api/payments/notify,
 * with the mock provider's real signed ticket — no shortcuts past the code the
 * shop actually runs.
 *
 * The invariants, one `it` each:
 *   · the client never sets a price, a line total or a shipping cost;
 *   · a quantity outside 1…99 is refused, never clamped into a free order;
 *   · a discount can zero an order but never take it below zero;
 *   · a gift card's balance never goes negative and is spent exactly once;
 *   · loyalty redeems no more than settings.pricing.loyalty.redeemMaxPct;
 *   · a paid order stays paid, and a repeated webhook settles nothing twice;
 *   · stock never goes below zero, whatever an order asks for;
 *   · settings.pricing is clamped whatever the admin PUTs;
 *   · the per-IP limiters answer 429 and leave a second address alone.
 *
 * See docs/testing.md § «Фаззинг API».
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/auth";
import { resetRateLimits as resetPayRateLimits } from "@/lib/payments/ratelimit";
import { query } from "@/lib/db";
import { mockSecret, signMockTicket } from "@/lib/payments/mock";
import { setupDb, teardownDb } from "./helpers";
import {
  ORIGIN,
  PRODUCT,
  PRODUCT_2,
  adminCookieHeader,
  customerCookieHeader,
  installFetchStub,
  makeRequest,
  resetIps,
  setFuzzEnv,
} from "./fuzz-harness";

let restoreEnv: () => void = () => {};
const admin = () => adminCookieHeader();

type OrderResult = { ok: boolean; orderId?: string; number?: string; total?: number; error?: string };

function order(body: Record<string, unknown>, opts: { cookie?: string; ip?: string } = {}) {
  return makeRequest("/api/orders/", { method: "POST", body, ...opts });
}

const BASE = {
  lang: "RU",
  items: [{ id: PRODUCT.id, qty: 1 }],
  customer: { name: "Fuzz Ostja", email: "money@example.com", phone: "+372 5555 5555" },
  shipping: { method: "parcel", country: "EE", carrier: "omniva", pointId: "1", pointName: "Kristiine" },
};

async function place(body: Record<string, unknown>, opts: { cookie?: string; ip?: string } = {}): Promise<{ status: number; body: OrderResult }> {
  const { POST } = await import("@/app/api/orders/route");
  const res = await POST(order(body, opts));
  return { status: res.status, body: (await res.json()) as OrderResult };
}

/** The mock provider's own signed ticket — the same one /api/payments/create mints. */
function ticket(number: string, amount: number, status: "paid" | "failed") {
  return signMockTicket(
    { orderRef: number, ref: `mock_${number}`, returnUrl: `${ORIGIN}/api/payments/return/`, amount, status },
    mockSecret(),
  );
}

async function notify(number: string, amount: number, status: "paid" | "failed" = "paid") {
  const { POST } = await import("@/app/api/payments/notify/route");
  const res = await POST(makeRequest("/api/payments/notify/", { method: "POST", body: { mockToken: ticket(number, amount, status) } }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function orderRow(id: string) {
  const { getOrder } = await import("@/lib/orders");
  const row = await getOrder(id);
  if (!row) throw new Error(`order ${id} vanished`);
  return row;
}

describe("money and stock invariants", () => {
  beforeAll(async () => {
    restoreEnv = setFuzzEnv();
    installFetchStub();
    await setupDb();
  }, 60_000);
  afterAll(async () => {
    vi.unstubAllGlobals();
    await teardownDb();
    restoreEnv();
  });
  beforeEach(() => {
    resetRateLimits();
    resetPayRateLimits();
    resetIps();
  });

  it("prices the order itself, whatever the client claims", async () => {
    const honest = await place(BASE);
    expect(honest.status).toBe(201);

    const tampered = await place({
      ...BASE,
      items: [{ id: PRODUCT.id, qty: 1, price: 0.01, sum: 0.01, title: "Free stuff", kind: "gift" }],
      subtotal: 0.01,
      total: 0.01,
      shippingPrice: 0,
      discount: 999,
      loyaltyDiscount: 999,
      pricingTier: "pro",
      channel: "pos",
      posDiscountPercent: 90,
      status: "paid",
    });
    expect(tampered.status).toBe(201);
    expect(tampered.body.total).toBe(honest.body.total);

    const row = await orderRow(tampered.body.orderId!);
    expect(row.status).toBe("new");
    expect(row.channel).toBe("web"); // channel:'pos' is the admin till, not a body field
    expect(row.discount).toBe(0);
    expect(row.loyaltyDiscount).toBe(0);
    expect(row.pricingTier).toBeNull();
    expect(row.items[0].price).toBeGreaterThan(1);
    expect(row.total).toBeCloseTo(row.subtotal + row.shippingPrice, 2);
  });

  it("refuses a quantity outside 1…99 instead of pricing it", async () => {
    for (const qty of [0, -1, 1000, 1e308, 2 ** 53, 0.5, "3", null, {}, []]) {
      const res = await place({ ...BASE, items: [{ id: PRODUCT.id, qty }] });
      if (qty === "3") {
        // a numeric string is a quantity a browser can honestly send
        expect(res.status, String(qty)).toBe(201);
        continue;
      }
      expect(res.status, String(JSON.stringify(qty))).toBe(400);
      expect(res.body.error, String(JSON.stringify(qty))).toBe("bad_qty");
    }
  });

  it("never lets a promo take more off than the basket holds", async () => {
    const { upsertPromo } = await import("@/lib/promos");
    await upsertPromo({ code: "HUGE", kind: "fixed", value: 200, minSubtotal: 0, startsAt: null, endsAt: null, maxUses: null, active: true, note: null });
    await upsertPromo({ code: "ALLPCT", kind: "percent", value: 90, minSubtotal: 0, startsAt: null, endsAt: null, maxUses: null, active: true, note: null });

    for (const code of ["HUGE", "ALLPCT"]) {
      const res = await place({ ...BASE, discountCode: code });
      expect(res.status, code).toBe(201);
      const row = await orderRow(res.body.orderId!);
      expect(row.discount, code).toBeGreaterThanOrEqual(0);
      expect(row.discount, code).toBeLessThanOrEqual(row.subtotal + row.shippingPrice);
      expect(row.total, code).toBeGreaterThanOrEqual(0);
      expect(row.total, code).toBeCloseTo(row.subtotal + row.shippingPrice - row.discount, 2);
    }
  });

  it("spends a gift card once, and never past zero", async () => {
    await query("insert into gift_cards (code, amount, balance, lang) values ($1, $2, $3, 'RU')", ["RMP-CDEF-GHJK", 5, 5]);
    const res = await place({ ...BASE, items: [{ id: PRODUCT.id, qty: 2 }], discountCode: "RMP-CDEF-GHJK" });
    expect(res.status).toBe(201);
    const quoted = await orderRow(res.body.orderId!);
    expect(quoted.discount).toBe(5);

    // the card is only quoted at checkout — nothing is spent before payment
    const before = await query<{ balance: string }>("select balance from gift_cards where code = $1", ["RMP-CDEF-GHJK"]);
    expect(Number(before[0].balance)).toBe(5);

    await notify(res.body.number!, res.body.total!);
    await notify(res.body.number!, res.body.total!); // Montonio's 48-hour retry
    await notify(res.body.number!, res.body.total!);

    const after = await query<{ balance: string }>("select balance from gift_cards where code = $1", ["RMP-CDEF-GHJK"]);
    expect(Number(after[0].balance)).toBe(0);
    const uses = await query<{ n: string }>("select count(*) as n from gift_card_uses where code = $1", ["RMP-CDEF-GHJK"]);
    expect(Number(uses[0].n)).toBe(1);
  });

  it("an order marked paid by hand in the admin settles the gift card once, like a provider ticket", async () => {
    await query("insert into gift_cards (code, amount, balance, lang) values ($1, $2, $3, 'RU')", ["RMP-CDFG-HJKM", 5, 5]);
    const res = await place({ ...BASE, items: [{ id: PRODUCT.id, qty: 2 }], discountCode: "RMP-CDFG-HJKM" });
    expect(res.status).toBe(201);

    const one = await import("@/app/api/admin/orders/[id]/route");
    const ctx = { params: Promise.resolve({ id: res.body.orderId! }) };
    const markPaid = () =>
      one.PATCH(makeRequest(`/api/admin/orders/${res.body.orderId}/`, { method: "PATCH", body: { status: "paid" }, cookie: admin() }), ctx);

    const first = await (await markPaid()).json();
    expect(first.ok).toBe(true);
    expect(first.order.status).toBe("paid");
    expect(first.order.payment?.provider).toBe("manual");

    // a second click, and a late provider ticket after it, change nothing
    await markPaid();
    await notify(res.body.number!, res.body.total!);

    const after = await query<{ balance: string }>("select balance from gift_cards where code = $1", ["RMP-CDFG-HJKM"]);
    expect(Number(after[0].balance)).toBe(0);
    const uses = await query<{ n: string }>("select count(*) as n from gift_card_uses where code = $1", ["RMP-CDFG-HJKM"]);
    expect(Number(uses[0].n)).toBe(1);
  });

  it("counts a promo use once per paid order and never on an abandoned one", async () => {
    const { upsertPromo } = await import("@/lib/promos");
    await upsertPromo({ code: "ONCE", kind: "percent", value: 10, minSubtotal: 0, startsAt: null, endsAt: null, maxUses: 1, active: true, note: null });

    const abandoned = await place({ ...BASE, discountCode: "ONCE" });
    expect(abandoned.status).toBe(201);
    let used = await query<{ used: number }>("select used from promo_codes where code = 'ONCE'");
    expect(Number(used[0].used)).toBe(0);

    const paid = await place({ ...BASE, discountCode: "ONCE" });
    await notify(paid.body.number!, paid.body.total!);
    await notify(paid.body.number!, paid.body.total!);
    used = await query<{ used: number }>("select used from promo_codes where code = 'ONCE'");
    expect(Number(used[0].used)).toBe(1);
    const rows = await query<{ n: string }>("select count(*) as n from promo_code_uses where code = 'ONCE'");
    expect(Number(rows[0].n)).toBe(1);
  });

  it("redeems no more loyalty than the cap, and only once", async () => {
    const { recordLogin } = await import("@/lib/customers");
    const { adjustLoyaltyPoints, getLoyaltyBalance, getPricingSettings } = await import("@/lib/loyalty");
    const email = "loyal@example.com";
    const customer = await recordLogin(email, "RU");
    await adjustLoyaltyPoints(customer.id, 100_000, "fuzz");
    const pricing = await getPricingSettings();
    const cookie = customerCookieHeader(email);

    const res = await place({ ...BASE, customer: { ...BASE.customer, email }, items: [{ id: PRODUCT.id, qty: 3 }], redeemPoints: true }, { cookie });
    expect(res.status).toBe(201);
    const row = await orderRow(res.body.orderId!);

    const cap = Math.round((row.subtotal * pricing.loyalty.redeemMaxPct) / 100);
    expect(row.loyaltyDiscount).toBeLessThanOrEqual(cap);
    expect(row.total).toBeGreaterThanOrEqual(0);
    expect(row.total).toBeCloseTo(row.subtotal + row.shippingPrice - row.discount - row.loyaltyDiscount, 2);

    const before = await getLoyaltyBalance(customer.id);
    await notify(res.body.number!, res.body.total!);
    const afterFirst = await getLoyaltyBalance(customer.id);
    await notify(res.body.number!, res.body.total!);
    const afterRetry = await getLoyaltyBalance(customer.id);
    expect(afterFirst).toBeLessThan(before); // spent, minus whatever the order earned back
    expect(afterRetry).toBe(afterFirst); // a retry settles nothing twice
  });

  it("keeps a paid order paid and never settles the same webhook twice", async () => {
    const res = await place(BASE);
    const number = res.body.number!;

    const first = await notify(number, res.body.total!);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe("paid");

    const repeat = await notify(number, res.body.total!);
    expect(repeat.status).toBe(200);
    expect((await orderRow(res.body.orderId!)).status).toBe("paid");

    // a late "failed" — Montonio's VOIDED — is recorded, never applied
    const late = await notify(number, res.body.total!, "failed");
    expect(late.status).toBe(200);
    expect(late.body.keptPaid).toBe(true);
    const row = await orderRow(res.body.orderId!);
    expect(row.status).toBe("paid");
    expect((row.payment as { rejected?: unknown }).rejected).toBeTruthy();

    // one revenue row for one order, whatever the webhook did
    const events = await query<{ n: string }>("select count(*) as n from events where type = 'purchase' and path = $1", [number]);
    expect(Number(events[0].n)).toBeLessThanOrEqual(1);
  });

  it("refuses a webhook it cannot verify, and one for an order that does not exist", async () => {
    const { POST } = await import("@/app/api/payments/notify/route");
    for (const token of ["", "junk", "a.b.c", ticket("R-999999", 10, "paid").slice(0, -3) + "AAA"]) {
      const res = await POST(makeRequest("/api/payments/notify/", { method: "POST", body: { mockToken: token } }));
      expect(res.status, token.slice(0, 12)).toBe(400);
      expect((await res.json()).error).toBe("bad_token");
    }
    // correctly signed, but nothing to apply it to
    const unknown = await notify("R-999999", 10);
    expect(unknown.status).toBe(200);
    expect(unknown.body.ignored).toBe("unknown_order");
  });

  it("never takes stock below zero", async () => {
    /* PRODUCT_2, not PRODUCT: a goods-in makes a product "tracked", and a
       tracked product sold down to 0 reads as out_of_stock for every later
       order in this file. */
    const { move, getLevels } = await import("@/lib/inventory");
    await move({ productId: PRODUCT_2.id, variant: "", delta: 2, reason: "goods_in", actor: "fuzz" });

    const res = await place({ ...BASE, items: [{ id: PRODUCT_2.id, qty: 9 }] });
    await notify(res.body.number!, res.body.total!);
    await notify(res.body.number!, res.body.total!);

    const levels = await getLevels({ q: PRODUCT_2.id });
    for (const l of levels) expect(l.qty, `${l.productId}:${l.variant}`).toBeGreaterThanOrEqual(0);
    const raw = await query<{ qty: number }>("select qty from stock_levels where product_id = $1", [PRODUCT_2.id]);
    for (const r of raw) expect(Number(r.qty)).toBeGreaterThanOrEqual(0);
  });

  it("refuses a POS sale with no lines and clamps its discount", async () => {
    const { POST } = await import("@/app/api/admin/pos-orders/route");
    const call = (body: unknown) =>
      POST(makeRequest("/api/admin/pos-orders/", { method: "POST", body, cookie: admin() }));

    for (const items of [[], null, "x", 5, {}]) {
      const res = await call({ items, payment: { method: "cash" } });
      expect(res.status, JSON.stringify(items)).toBe(400);
      expect((await res.json()).error).toBe("empty_order");
    }

    for (const pct of [150, -50, 1e308, "abc", null]) {
      const res = await call({ items: [{ id: PRODUCT.id, qty: 1 }], payment: { method: "cash" }, discountPercent: pct });
      expect(res.status, String(pct)).toBe(201);
      const body = (await res.json()) as OrderResult;
      const row = await orderRow(body.orderId!);
      expect(row.discount, String(pct)).toBeGreaterThanOrEqual(0);
      expect(row.discount, String(pct)).toBeLessThanOrEqual(row.subtotal * 0.9 + 0.01);
      expect(row.total, String(pct)).toBeGreaterThanOrEqual(0);
      expect(row.status, String(pct)).toBe("paid");
    }
  });

  it("clamps settings.pricing however it is written", async () => {
    const settings = await import("@/app/api/admin/settings/route");
    const put = (body: unknown) =>
      settings.PUT(makeRequest("/api/admin/settings/", { method: "PUT", body, cookie: admin() }));

    await put({
      pricing: {
        proDiscountPct: 999,
        proMinOrder: -50,
        loyalty: { enabled: "yes", earnPct: 1e9, redeemMaxPct: 5000, minRedeem: -3 },
      },
    });
    const { getPricingSettings } = await import("@/lib/loyalty");
    const p = await getPricingSettings();
    expect(p.proDiscountPct).toBe(90);
    expect(p.proMinOrder).toBe(0);
    expect(p.loyalty.earnPct).toBe(50);
    expect(p.loyalty.redeemMaxPct).toBe(100);
    expect(p.loyalty.minRedeem).toBe(0);

    // and the public feed still never carries the wholesale discount
    const { GET } = await import("@/app/api/overrides/route");
    const feed = (await (await GET()).json()) as { settings: Record<string, unknown> };
    const pricing = feed.settings.pricing as Record<string, unknown>;
    expect(pricing.proDiscountPct).toBeUndefined();
    expect(pricing.proMinOrder).toBeUndefined();
    expect((pricing.loyalty as Record<string, unknown>).redeemMaxPct).toBeUndefined();

    await put({ pricing: null });
    const back = await getPricingSettings();
    expect(back.proDiscountPct).toBe(20);
  });

  it("never hands the owner a spreadsheet formula a customer typed", async () => {
    const { recordLogin, updateCustomer } = await import("@/lib/customers");
    const evil = "=cmd|' /C calc'!A0";
    const CRLF = String.fromCharCode(13, 10);
    await recordLogin("formula@example.com", "RU");
    await updateCustomer("formula@example.com", { name: evil, phone: "+1" });
    await place({ ...BASE, customer: { name: evil, email: "formula@example.com", phone: "+1" }, notes: evil });

    const customers = await import("@/app/api/admin/customers/route");
    const csv = await (
      await customers.GET(makeRequest("/api/admin/customers/?format=csv", { cookie: admin() }))
    ).text();
    expect(csv).toContain(evil.slice(1)); // the text is still there …
    for (const line of csv.split(CRLF)) {
      for (const cell of line.split(",")) {
        expect(cell.replace(/^"/, "").slice(0, 1), line.slice(0, 60)).not.toMatch(/[=+@]/);
      }
    }

    const reports = await import("@/app/api/admin/reports/orders/route");
    const month = new Date().toISOString().slice(0, 7);
    const orders = await (
      await reports.GET(makeRequest(`/api/admin/reports/orders/?month=${month}&format=csv`, { cookie: admin() }))
    ).text();
    for (const line of orders.split(CRLF)) {
      for (const cell of line.split(";")) {
        expect(cell.replace(/^"/, "").slice(0, 1), line.slice(0, 60)).not.toMatch(/[=+@]/);
      }
    }
  });

  it("rate-limits per IP and leaves a second address alone", async () => {
    const orders = await import("@/app/api/orders/route");
    const login = await import("@/app/api/admin/login/route");
    const promos = await import("@/app/api/promos/check/route");
    const code = await import("@/app/api/account/code/route");

    const HOT = "203.0.113.7";
    const COLD = "203.0.113.8";

    const orderCodes: number[] = [];
    for (let i = 0; i < 12; i++) orderCodes.push((await orders.POST(order(BASE, { ip: HOT }))).status);
    expect(orderCodes.filter((c) => c === 201).length).toBe(10);
    expect(orderCodes.filter((c) => c === 429).length).toBe(2);
    expect((await orders.POST(order(BASE, { ip: COLD }))).status).toBe(201);

    const loginCodes: number[] = [];
    for (let i = 0; i < 7; i++) {
      loginCodes.push(
        (await login.POST(makeRequest("/api/admin/login/", { method: "POST", body: { password: "nope" }, ip: HOT }))).status,
      );
    }
    expect(loginCodes.filter((c) => c === 401).length).toBe(5);
    expect(loginCodes.filter((c) => c === 429).length).toBe(2);
    expect(
      (await login.POST(makeRequest("/api/admin/login/", { method: "POST", body: { password: "nope" }, ip: COLD }))).status,
    ).toBe(401);

    const promoCodes: number[] = [];
    for (let i = 0; i < 22; i++) {
      promoCodes.push((await promos.POST(makeRequest("/api/promos/check/", { method: "POST", body: { code: "ONCE" }, ip: HOT }))).status);
    }
    expect(promoCodes.filter((c) => c === 429).length).toBe(2);
    expect((await promos.POST(makeRequest("/api/promos/check/", { method: "POST", body: { code: "ONCE" }, ip: COLD }))).status).toBe(200);

    /* The login-code limiter is per address as well as per IP, so walking a
       list of mailboxes from one machine and one mailbox from many machines
       are both capped. */
    const mail = "codelimit@example.com";
    for (let i = 0; i < 3; i++) {
      await code.POST(makeRequest("/api/account/code/", { method: "POST", body: { email: mail }, ip: `203.0.113.${20 + i}` }));
    }
    const fourth = await code.POST(makeRequest("/api/account/code/", { method: "POST", body: { email: mail }, ip: "203.0.113.99" }));
    expect(fourth.status).toBe(429);
    const other = await code.POST(makeRequest("/api/account/code/", { method: "POST", body: { email: "someone-else@example.com" }, ip: "203.0.113.98" }));
    expect(other.status).toBe(200);
  });
});
