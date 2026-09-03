/**
 * Wholesale (salon/pro) pricing and the loyalty points programme —
 * db/migrations/100_tiers_loyalty.sql. Runs on PGlite, no server needed.
 *
 * What this covers:
 *   - pro pricing math and override precedence (proUnitPrice)
 *   - tier gating: an anonymous/guest checkout never sees a pro price,
 *     proMinOrder gates a pro customer's own basket
 *   - earn/redeem only happen on the paid transition, never at checkout
 *   - redeem never takes more than the balance, and never runs twice
 *   - ledger idempotency under the return/webhook race
 *   - admin routes require the admin cookie; customer routes require the
 *     customer cookie
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variants from "@/data/catalogue.variants.json";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { CUSTOMER_COOKIE, makeCustomerToken, recordLogin } from "@/lib/customers";
import { exec, query } from "@/lib/db";
import { createOrder, getOverrides, priceItems, upsertOverride } from "@/lib/orders";
import {
  adjustLoyaltyPoints,
  approveProCustomer,
  cleanPricing,
  customerTier,
  earnLoyaltyPoints,
  eurosToPoints,
  getLoyaltyBalance,
  getLoyaltyHistory,
  listCustomersAdmin,
  PRICING_BOUNDS,
  proUnitPrice,
  quoteLoyaltyRedeem,
  redeemLoyaltyPoints,
  requestProTier,
} from "@/lib/loyalty";
import { applyPaymentResult, type ApplyDeps } from "@/lib/payments/apply";
import type { VerifyResult } from "@/lib/payments/types";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const VARIANTS = variants as Record<string, { sizes: string[]; prices: number[] }>;

const plain = CATALOGUE.find((p) => p.s === "in" && !VARIANTS[p.id])!;
const sized = CATALOGUE.find((p) => p.s === "in" && VARIANTS[p.id])!;

const customer = { name: "Мария Тамм", email: "salon@example.com", phone: "+372 5555 5555" };
const ship = { method: "parcel", country: "EE" };

async function truncate() {
  // cascade: other agents' migrations (090+) add their own tables with
  // foreign keys into orders/customers (e.g. 111_order_messages.sql)  — this
  // suite does not need to know about every one of them to reset state.
  await exec(
    "truncate customers, loyalty_ledger, orders, product_overrides, settings, admin_audit, login_codes, carts, stock_alerts restart identity cascade",
  );
}

async function makeProCustomer(email = customer.email): Promise<string> {
  const row = await recordLogin(email, "RU");
  await approveProCustomer(row.id);
  return row.id;
}

function adminReq(url: string, opts: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cookie !== "") headers.cookie = opts.cookie ?? `${ADMIN_COOKIE}=${makeSessionToken()}`;
  return new Request(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

function customerReq(url: string, opts: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.cookie !== "") headers.cookie = opts.cookie ?? `${CUSTOMER_COOKIE}=${makeCustomerToken(customer.email)}`;
  return new Request(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
  await setupDb();
});
afterAll(teardownDb);
beforeEach(async () => {
  await truncate();
  resetRateLimits();
});

/* ---------- pure maths ----------------------------------------------------- */

describe("proUnitPrice — the pro pricing formula", () => {
  it("discounts the base price by proDiscountPct when there is no override", () => {
    expect(proUnitPrice(100, 100, null, 20)).toBe(80);
  });
  it("a per-product override replaces the base, keeping the variant's own premium", () => {
    // retail: base 20€, this variant (500ml) costs 35€ retail → 15€ premium
    // pro: override sets the base to 15€ → pro price for this variant is 15+15=30€
    expect(proUnitPrice(20, 35, 15, 20)).toBe(30);
  });
  it("never goes negative", () => {
    expect(proUnitPrice(5, 5, 0, 100)).toBe(0);
  });
});

describe("eurosToPoints — one point is one euro, rounded", () => {
  it("rounds to the nearest whole point", () => {
    expect(eurosToPoints(5.92)).toBe(6);
    expect(eurosToPoints(5.49)).toBe(5);
    expect(eurosToPoints(0)).toBe(0);
    expect(eurosToPoints(-3)).toBe(-3); // no clamping here — every call site already clamps its input to >= 0
  });
});

describe("cleanPricing — bounds and defaults", () => {
  it("fills in every field from nothing", () => {
    const p = cleanPricing(null);
    expect(p).toEqual({ proDiscountPct: 20, proMinOrder: 0, loyalty: { enabled: true, earnPct: 5, redeemMaxPct: 30, minRedeem: 5 } });
  });
  it("clamps out-of-range numbers instead of storing them", () => {
    const p = cleanPricing({ proDiscountPct: 500, proMinOrder: -10, loyalty: { earnPct: 999, redeemMaxPct: -5 } });
    expect(p.proDiscountPct).toBe(PRICING_BOUNDS.proDiscountPct[1]);
    expect(p.proMinOrder).toBe(0);
    expect(p.loyalty.earnPct).toBe(PRICING_BOUNDS.earnPct[1]);
    expect(p.loyalty.redeemMaxPct).toBe(0);
  });
  it("a malformed loyalty block does not crash — defaults instead", () => {
    expect(cleanPricing({ loyalty: "nonsense" }).loyalty.enabled).toBe(true);
  });
});

/* ---------- pro pricing in priceItems()/createOrder() ---------------------- */

describe("pro pricing — who gets it", () => {
  it("an anonymous checkout (no customerId) never sees a pro price", async () => {
    await query("insert into settings (key, value) values ($1, $2::jsonb)", [
      "pricing",
      JSON.stringify({ proDiscountPct: 50 }),
    ]);
    const { lines, pricingTier } = await priceItems([{ id: plain.id, qty: 1 }], "RU");
    expect(pricingTier).toBeNull();
    expect(lines[0].price).toBe(plain.p);
  });

  it("a signed-in but retail customer prices at retail, tier recorded as 'retail'", async () => {
    const id = await recordLogin("retail@example.com", "RU").then((c) => c.id);
    const { lines, pricingTier } = await priceItems([{ id: plain.id, qty: 1 }], "RU", { customerId: id });
    expect(pricingTier).toBe("retail");
    expect(lines[0].price).toBe(plain.p);
  });

  it("an approved pro customer gets base price × (1 − proDiscountPct/100)", async () => {
    await query("insert into settings (key, value) values ($1, $2::jsonb)", [
      "pricing",
      JSON.stringify({ proDiscountPct: 25 }),
    ]);
    const id = await makeProCustomer();
    const { lines, pricingTier, subtotal } = await priceItems([{ id: plain.id, qty: 2 }], "RU", { customerId: id });
    expect(pricingTier).toBe("pro");
    const expected = Math.round(plain.p * 0.75 * 100) / 100;
    expect(lines[0].price).toBe(expected);
    expect(subtotal).toBe(Math.round(expected * 2 * 100) / 100);
  });

  it("a per-product pro_price override wins over the percentage, and a sized variant keeps its own premium", async () => {
    await query("insert into settings (key, value) values ($1, $2::jsonb)", [
      "pricing",
      JSON.stringify({ proDiscountPct: 10 }),
    ]);
    await upsertOverride(sized.id, { proPrice: 5 });
    const id = await makeProCustomer();
    const v = VARIANTS[sized.id];
    const { lines } = await priceItems([{ id: sized.id, variant: 1, qty: 1 }], "RU", { customerId: id });
    const premium = v.prices[1] - sized.p;
    expect(lines[0].price).toBe(Math.round((5 + premium) * 100) / 100);
  });

  it("bundles and gift cards never get a pro price", async () => {
    const id = await makeProCustomer();
    const { lines } = await priceItems([{ id: "gift:50", qty: 1 }], "RU", { customerId: id });
    expect(lines[0].price).toBe(50);
  });

  it("proMinOrder gates a pro customer's own basket — under it, retail; the order records 'retail'", async () => {
    await query("insert into settings (key, value) values ($1, $2::jsonb)", [
      "pricing",
      JSON.stringify({ proDiscountPct: 30, proMinOrder: 100_000 }), // unreachable
    ]);
    const id = await makeProCustomer();
    const { lines, pricingTier } = await priceItems([{ id: plain.id, qty: 1 }], "RU", { customerId: id });
    expect(pricingTier).toBe("retail");
    expect(lines[0].price).toBe(plain.p);
  });

  it("createOrder stores customer_id and pricing_tier, and prices at pro rates", async () => {
    await query("insert into settings (key, value) values ($1, $2::jsonb)", [
      "pricing",
      JSON.stringify({ proDiscountPct: 20 }),
    ]);
    const id = await makeProCustomer();
    const order = await createOrder(
      { lang: "ru", items: [{ id: plain.id, qty: 1 }], customer, shipping: ship },
      { customerId: id },
    );
    expect(order.customerId).toBe(id);
    expect(order.pricingTier).toBe("pro");
    expect(order.items[0].price).toBe(Math.round(plain.p * 0.8 * 100) / 100);
  });

  it("createOrder never trusts a customerId the caller did not resolve — omitting ctx prices as a guest", async () => {
    await makeProCustomer();
    const order = await createOrder({ lang: "ru", items: [{ id: plain.id, qty: 1 }], customer, shipping: ship });
    expect(order.customerId).toBeNull();
    expect(order.pricingTier).toBeNull();
    expect(order.items[0].price).toBe(plain.p);
  });
});

/* ---------- the public overrides route never leaks the pro discount ------- */

describe("GET /api/overrides — the pro discount never reaches an anonymous shopper", () => {
  it("publishes only loyalty.enabled/earnPct under 'pricing'", async () => {
    await query("insert into settings (key, value) values ($1, $2::jsonb)", [
      "pricing",
      JSON.stringify({ proDiscountPct: 42, proMinOrder: 77, loyalty: { enabled: true, earnPct: 8 } }),
    ]);
    const { GET } = await import("@/app/api/overrides/route");
    const res = await GET();
    const body = await res.json();
    expect(body.settings.pricing).toEqual({ loyalty: { enabled: true, earnPct: 8 } });
    expect(JSON.stringify(body)).not.toContain("42");
    expect(JSON.stringify(body)).not.toContain("77");
  });
});

/* ---------- the ledger ------------------------------------------------------ */

describe("loyalty ledger — earn", () => {
  it("credits earnPct of the given subtotal, rounded to whole points", async () => {
    await query("insert into settings (key, value) values ($1, $2::jsonb)", [
      "pricing",
      JSON.stringify({ loyalty: { enabled: true, earnPct: 5 } }),
    ]);
    const id = await recordLogin("shopper@example.com", "RU").then((c) => c.id);
    const out = await earnLoyaltyPoints(id, "11111111-1111-1111-1111-111111111111", 118.4);
    expect(out.ok).toBe(true);
    expect(out.points).toBe(eurosToPoints(118.4 * 0.05));
    expect(await getLoyaltyBalance(id)).toBe(out.points);
  });

  it("earns nothing when the programme is disabled", async () => {
    await query("insert into settings (key, value) values ($1, $2::jsonb)", [
      "pricing",
      JSON.stringify({ loyalty: { enabled: false, earnPct: 50 } }),
    ]);
    const id = await recordLogin("shopper2@example.com", "RU").then((c) => c.id);
    const out = await earnLoyaltyPoints(id, "22222222-2222-2222-2222-222222222222", 100);
    expect(out.points).toBe(0);
    expect(await getLoyaltyBalance(id)).toBe(0);
  });

  it("is idempotent per order — a second call for the same order does not double the balance", async () => {
    const id = await recordLogin("shopper3@example.com", "RU").then((c) => c.id);
    const orderId = "33333333-3333-3333-3333-333333333333";
    const first = await earnLoyaltyPoints(id, orderId, 100);
    const second = await earnLoyaltyPoints(id, orderId, 100);
    expect(second.already).toBe(true);
    expect(await getLoyaltyBalance(id)).toBe(first.points);
    const history = await getLoyaltyHistory(id);
    expect(history.filter((h) => h.reason === "earn")).toHaveLength(1);
  });
});

describe("loyalty ledger — redeem", () => {
  it("takes exactly what is asked when the balance covers it", async () => {
    const id = await recordLogin("redeemer@example.com", "RU").then((c) => c.id);
    await adjustLoyaltyPoints(id, 20, "seed");
    const out = await redeemLoyaltyPoints(id, "44444444-4444-4444-4444-444444444444", 12);
    expect(out).toMatchObject({ ok: true, taken: 12 });
    expect(await getLoyaltyBalance(id)).toBe(8);
  });

  it("never takes more than the balance — partial redeem, not an error", async () => {
    const id = await recordLogin("shortfall@example.com", "RU").then((c) => c.id);
    await adjustLoyaltyPoints(id, 5, "seed");
    const out = await redeemLoyaltyPoints(id, "55555555-5555-5555-5555-555555555555", 20);
    expect(out).toMatchObject({ ok: true, taken: 5 });
    expect(await getLoyaltyBalance(id)).toBe(0);
  });

  it("refuses when the balance is already zero", async () => {
    const id = await recordLogin("empty@example.com", "RU").then((c) => c.id);
    const out = await redeemLoyaltyPoints(id, "66666666-6666-6666-6666-666666666666", 10);
    expect(out).toMatchObject({ ok: false, error: "insufficient", taken: 0 });
  });

  it("is idempotent per order — a second call never redeems twice", async () => {
    const id = await recordLogin("twice@example.com", "RU").then((c) => c.id);
    await adjustLoyaltyPoints(id, 50, "seed");
    const orderId = "77777777-7777-7777-7777-777777777777";
    const first = await redeemLoyaltyPoints(id, orderId, 10);
    const second = await redeemLoyaltyPoints(id, orderId, 10);
    expect(first.taken).toBe(10);
    expect(second.already).toBe(true);
    expect(await getLoyaltyBalance(id)).toBe(40); // not 30 — the second call took nothing more
  });
});

describe("quoteLoyaltyRedeem — the checkout preview", () => {
  it("caps by both the balance and redeemMaxPct of the basket", async () => {
    const id = await recordLogin("quote@example.com", "RU").then((c) => c.id);
    await adjustLoyaltyPoints(id, 100, "seed");
    const settings = { enabled: true, earnPct: 5, redeemMaxPct: 30, minRedeem: 5 };
    // 30% of 50€ = 15, well under the 100-point balance
    const q = await quoteLoyaltyRedeem(id, 50, settings);
    expect(q.maxRedeemable).toBe(15);
    expect(q.balance).toBe(100);
  });
});

/* ---------- earn/redeem only happen on the paid transition ----------------- */

function deps(overrides: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    setOrderPayment: async () => ({}),
    setOrderStatus: async () => ({}),
    ...overrides,
  };
}

const verifyResult = (over: Partial<VerifyResult> = {}): VerifyResult => ({
  orderRef: "R-100042",
  status: "paid",
  providerRef: "ref-1",
  amount: 42,
  currency: "EUR",
  ...over,
});

describe("applyPaymentResult — loyalty settles once, only on paid", () => {
  it("does nothing for a guest order (no customerId)", async () => {
    const earn = vi.fn();
    const order = { id: "id-1", number: "R-1", status: "new", total: 42 };
    await applyPaymentResult(order, verifyResult(), "montonio", deps({ earnLoyaltyPoints: earn }));
    expect(earn).not.toHaveBeenCalled();
  });

  it("does not earn on a pending or failed result", async () => {
    const earn = vi.fn();
    const order = { id: "id-2", number: "R-2", status: "new", total: 42, customerId: "c-1", subtotal: 42 };
    await applyPaymentResult(order, verifyResult({ status: "pending" }), "montonio", deps({ earnLoyaltyPoints: earn }));
    await applyPaymentResult(order, verifyResult({ status: "failed" }), "montonio", deps({ earnLoyaltyPoints: earn }));
    expect(earn).not.toHaveBeenCalled();
  });

  it("earns on the paid transition, with the goods subtotal (not the total)", async () => {
    const earn = vi.fn(async () => ({ ok: true, points: 5 }));
    const order = { id: "id-3", number: "R-3", status: "new", total: 45, subtotal: 42, customerId: "c-1" };
    const out = await applyPaymentResult(order, verifyResult({ amount: 45 }), "montonio", deps({ earnLoyaltyPoints: earn }));
    expect(earn).toHaveBeenCalledWith("c-1", "id-3", 42);
    expect(out.pointsEarned).toBe(5);
  });

  it("a webhook retry (order already paid) never earns twice", async () => {
    const earn = vi.fn(async () => ({ ok: true, points: 5 }));
    const order = { id: "id-4", number: "R-4", status: "paid", total: 45, subtotal: 42, customerId: "c-1" };
    const out = await applyPaymentResult(order, verifyResult(), "montonio", deps({ earnLoyaltyPoints: earn }));
    expect(earn).not.toHaveBeenCalled();
    expect(out.alreadyPaid).toBe(true);
  });

  it("redeems the quoted points on paid, and reports a shortfall without blocking the order", async () => {
    const redeem = vi.fn(async () => ({ ok: false, error: "insufficient", taken: 3 }));
    const write = vi.fn(async () => ({}));
    const order = { id: "id-5", number: "R-5", status: "new", total: 40, subtotal: 45, loyaltyDiscount: 5, customerId: "c-1" };
    const out = await applyPaymentResult(order, verifyResult({ amount: 40 }), "montonio", deps({ redeemLoyaltyPoints: redeem, writeAudit: write }));
    expect(redeem).toHaveBeenCalledWith("c-1", "id-5", 5, expect.any(String));
    expect(out.status).toBe("paid"); // the shortfall never fails the payment
    expect(out.loyaltyShortfall).toMatchObject({ amount: 5, taken: 3 });
    expect(write).toHaveBeenCalledWith("system", "loyalty_redeem_failed", expect.objectContaining({ orderId: "id-5" }));
  });

  it("createOrder's quote, followed by the real redeem, actually spends the balance", async () => {
    const id = await recordLogin("e2e@example.com", "RU").then((c) => c.id);
    await adjustLoyaltyPoints(id, 20, "seed");
    const order = await createOrder(
      { lang: "ru", items: [{ id: plain.id, qty: 5 }], customer, shipping: ship, redeemPoints: true },
      { customerId: id },
    );
    expect(order.loyaltyDiscount).toBeGreaterThan(0);
    const out = await applyPaymentResult(
      { id: order.id, number: order.number, status: "new", total: order.total, subtotal: order.subtotal, loyaltyDiscount: order.loyaltyDiscount, customerId: order.customerId },
      verifyResult({ orderRef: order.number, amount: order.total }),
      "montonio",
      // this same paid transition would also EARN points on the order's own
      // subtotal (settleLoyalty() in apply.ts, tested on its own above) —
      // stubbed out here so this test isolates the redeem side cleanly.
      deps({ earnLoyaltyPoints: async () => ({ ok: true, points: 0 }) }),
    );
    expect(out.status).toBe("paid");
    expect(await getLoyaltyBalance(id)).toBe(20 - order.loyaltyDiscount);
  });
});

/* ---------- admin & customer routes ----------------------------------------- */

describe("GET /api/admin/customers — auth and shape", () => {
  it("401s without the admin cookie", async () => {
    const { GET } = await import("@/app/api/admin/customers/route");
    const res = await GET(adminReq("https://x/api/admin/customers/", { cookie: "" }));
    expect(res.status).toBe(401);
  });

  it("lists customers, tier filter and CSV export both work", async () => {
    const retailId = await recordLogin("csv-retail@example.com", "RU").then((c) => c.id);
    await makeProCustomer("csv-pro@example.com");
    const { GET } = await import("@/app/api/admin/customers/route");

    const all = await GET(adminReq("https://x/api/admin/customers/"));
    const allBody = await all.json();
    expect(allBody.ok).toBe(true);
    expect(allBody.customers.length).toBeGreaterThanOrEqual(2);

    const proOnly = await GET(adminReq("https://x/api/admin/customers/?tier=pro"));
    const proBody = await proOnly.json();
    expect(proBody.customers.every((c: { tier: string }) => c.tier === "pro")).toBe(true);
    expect(proBody.customers.some((c: { email: string }) => c.email === "csv-pro@example.com")).toBe(true);
    expect(proBody.customers.some((c: { id: string }) => c.id === retailId)).toBe(false);

    const csv = await GET(adminReq("https://x/api/admin/customers/?format=csv"));
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const text = await csv.text();
    expect(text).toContain("csv-pro@example.com");
  });
});

describe("PATCH /api/admin/customers/[id] — approve, reject, adjust points", () => {
  it("401s without the admin cookie", async () => {
    const c = await recordLogin("noauth@example.com", "RU");
    const { PATCH } = await import("@/app/api/admin/customers/[id]/route");
    const res = await PATCH(adminReq("https://x", { method: "PATCH", body: { action: "approve" }, cookie: "" }), {
      params: Promise.resolve({ id: c.id }),
    });
    expect(res.status).toBe(401);
  });

  it("approves a pending pro request", async () => {
    const c = await recordLogin("pending@example.com", "RU");
    await requestProTier(c.email, { company: "OÜ Näidis", regCode: "12345678", phone: "+372" });
    const { PATCH } = await import("@/app/api/admin/customers/[id]/route");
    const res = await PATCH(adminReq("https://x", { method: "PATCH", body: { action: "approve" } }), {
      params: Promise.resolve({ id: c.id }),
    });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.customer.tier).toBe("pro");
    expect(await customerTier(c.id)).toBe("pro");
  });

  it("rejecting clears the request without granting pro", async () => {
    const c = await recordLogin("rejected@example.com", "RU");
    await requestProTier(c.email, { company: "OÜ Näidis", regCode: "12345678", phone: "" });
    const { PATCH } = await import("@/app/api/admin/customers/[id]/route");
    const res = await PATCH(adminReq("https://x", { method: "PATCH", body: { action: "reject" } }), {
      params: Promise.resolve({ id: c.id }),
    });
    const body = await res.json();
    expect(body.customer.tier).toBe("retail");
    expect(body.customer.proRequestedAt).toBeNull();
  });

  it("adjust_points credits or debits the ledger and rejects a zero delta", async () => {
    const c = await recordLogin("adjustable@example.com", "RU");
    const { PATCH } = await import("@/app/api/admin/customers/[id]/route");
    const good = await PATCH(
      adminReq("https://x", { method: "PATCH", body: { pointsDelta: 15, note: "sorry for the wait" } }),
      { params: Promise.resolve({ id: c.id }) },
    );
    expect((await good.json()).customer.pointsBalance).toBe(15);

    const zero = await PATCH(adminReq("https://x", { method: "PATCH", body: { pointsDelta: 0 } }), {
      params: Promise.resolve({ id: c.id }),
    });
    expect(zero.status).toBe(400);
  });
});

describe("customer-facing routes require the customer cookie", () => {
  it("GET /api/account/pricing 401s signed out, and never leaks proDiscountPct to a retail account", async () => {
    const { GET } = await import("@/app/api/account/pricing/route");
    const anon = await GET(customerReq("https://x/api/account/pricing/", { cookie: "" }));
    expect(anon.status).toBe(401);

    await query("insert into settings (key, value) values ($1, $2::jsonb)", [
      "pricing",
      JSON.stringify({ proDiscountPct: 33 }),
    ]);
    await recordLogin(customer.email, "RU");
    const retail = await GET(customerReq("https://x/api/account/pricing/"));
    const retailBody = await retail.json();
    expect(retailBody.tier).toBe("retail");
    expect(retailBody.proDiscountPct).toBe(0);
    expect(JSON.stringify(retailBody)).not.toContain("33");
  });

  it("GET /api/account/pricing returns real pro prices for an approved pro account", async () => {
    await query("insert into settings (key, value) values ($1, $2::jsonb)", [
      "pricing",
      JSON.stringify({ proDiscountPct: 15 }),
    ]);
    await makeProCustomer();
    const { GET } = await import("@/app/api/account/pricing/route");
    const res = await GET(customerReq("https://x/api/account/pricing/"));
    const body = await res.json();
    expect(body.tier).toBe("pro");
    expect(body.proDiscountPct).toBe(15);
    expect(body.proPrices[plain.id]).toBe(Math.round(plain.p * 0.85 * 100) / 100);
  });

  it("POST /api/account/pro-request requires the cookie and a company + reg code", async () => {
    const { POST } = await import("@/app/api/account/pro-request/route");
    const anon = await POST(customerReq("https://x", { method: "POST", body: { company: "OÜ X", regCode: "1" }, cookie: "" }));
    expect(anon.status).toBe(401);

    await recordLogin(customer.email, "RU");
    const missing = await POST(customerReq("https://x", { method: "POST", body: { company: "", regCode: "" } }));
    expect(missing.status).toBe(400);

    const ok = await POST(customerReq("https://x", { method: "POST", body: { company: "OÜ Salong", regCode: "87654321", phone: "+372 5" } }));
    expect(ok.status).toBe(200);
    const c = await listCustomersAdmin({ q: customer.email });
    expect(c[0].proRequestedAt).not.toBeNull();
    expect(c[0].company).toBe("OÜ Salong");
  });
});

/* ---------- assistant sanitisers agree with src/lib/loyalty.ts bounds ------ */

describe("assistant actions — set_pricing / adjust_points bounds match src/lib/loyalty.ts", () => {
  it("PRICING_BOUNDS is exactly what actions.ts duplicates", async () => {
    // actions.ts keeps its own literal copy (no database import allowed there —
    // see its file comment); this is the cross-check the comment promises.
    expect(PRICING_BOUNDS).toEqual({
      proDiscountPct: [0, 90],
      proMinOrder: [0, 100_000],
      earnPct: [0, 50],
      redeemMaxPct: [0, 100],
      minRedeem: [0, 10_000],
    });
  });

  it("sanitizeAction accepts a well-formed set_pricing patch and clamps out-of-range numbers", async () => {
    const { sanitizeAction } = await import("@/app/api/assistant/actions");
    const known = new Set<string>();
    const out = sanitizeAction({ type: "set_pricing", value: { proDiscountPct: 999, loyalty: { earnPct: 7 } } }, known, true) as {
      value: { proDiscountPct?: number; loyalty?: { earnPct?: number } };
    };
    expect(out).toBeTruthy();
    expect(out.value.proDiscountPct).toBeUndefined(); // out of range — dropped, not clamped-and-kept
    expect(out.value.loyalty?.earnPct).toBe(7);
  });

  it("sanitizeAction refuses adjust_points with a bad id or a zero delta", async () => {
    const { sanitizeAction } = await import("@/app/api/assistant/actions");
    const known = new Set<string>();
    expect(sanitizeAction({ type: "adjust_points", customerId: "not-a-uuid", delta: 5 }, known, true)).toBeNull();
    expect(
      sanitizeAction({ type: "adjust_points", customerId: "11111111-1111-1111-1111-111111111111", delta: 0 }, known, true),
    ).toBeNull();
    const ok = sanitizeAction(
      { type: "adjust_points", customerId: "11111111-1111-1111-1111-111111111111", delta: 10, note: "x".repeat(400) },
      known,
      true,
    ) as { note: string };
    expect(ok).toBeTruthy();
    expect(ok.note.length).toBe(300); // capped
  });

  it("non-admin mode never gets set_pricing or adjust_points", async () => {
    const { sanitizeAction } = await import("@/app/api/assistant/actions");
    const known = new Set<string>();
    expect(sanitizeAction({ type: "set_pricing", value: { proDiscountPct: 10 } }, known, false)).toBeNull();
    expect(
      sanitizeAction({ type: "adjust_points", customerId: "11111111-1111-1111-1111-111111111111", delta: 5 }, known, false),
    ).toBeNull();
  });
});
