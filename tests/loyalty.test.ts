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
import { inflateRawSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variants from "@/data/catalogue.variants.json";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { CUSTOMER_COOKIE, makeCustomerToken, recordLogin } from "@/lib/customers";
import { exec, query } from "@/lib/db";
import { createOrder, getOrder, getOverrides, priceItems, setOrderStatus, upsertOverride } from "@/lib/orders";
import {
  adjustLoyaltyPoints,
  approveProCustomer,
  cleanPricing,
  loyaltyOn,
  customerTier,
  earnLoyaltyPoints,
  eurosToPoints,
  getLoyaltyBalance,
  getLoyaltyHistory,
  listCustomersAdmin,
  orderPointsMoved,
  PRICING_BOUNDS,
  proUnitPrice,
  quoteLoyaltyRedeem,
  redeemCapPoints,
  redeemLoyaltyPoints,
  refundLoyaltyPoints,
  requestProTier,
  setCustomerTier,
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

/** Walks the local file headers the repo's own zip writer produces and
    inflates each entry — the same reader tests/reports.test.ts uses on the
    accountant's workbook, so «Клиенты» → XLSX is checked for real and not
    just for "it did not throw". */
function readZipEntries(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let offset = 0;
  while (offset < buf.length && buf.readUInt32LE(offset) === 0x04034b50) {
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buf.toString("utf8", nameStart, nameStart + nameLen);
    const dataStart = nameStart + nameLen + extraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    out[name] = (method === 0 ? raw : inflateRawSync(raw)).toString("utf8");
    offset = dataStart + compSize;
  }
  return out;
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
  it("fills in every field from nothing — with «Партнёры и баллы» OFF", () => {
    const p = cleanPricing(null);
    /* partnersOn false is the whole default (Dim, 07.09.2026: «Renat said
       later»): a shop nobody has asked has no wholesale tier and no points.
       The numbers underneath still have sane values, so switching it on later
       is one tap and not a form to fill in. */
    expect(p).toEqual({ partnersOn: false, proDiscountPct: 20, proMinOrder: 0, loyalty: { enabled: true, earnPct: 5, redeemMaxPct: 30, minRedeem: 5 } });
    expect(cleanPricing({ partnersOn: "yes" }).partnersOn, "a non-boolean switched the programme on").toBe(false);
    expect(cleanPricing({ partnersOn: true }).partnersOn).toBe(true);
  });

  it("loyaltyOn() needs both switches", () => {
    expect(loyaltyOn(cleanPricing({ partnersOn: true, loyalty: { enabled: true } }))).toBe(true);
    expect(loyaltyOn(cleanPricing({ partnersOn: true, loyalty: { enabled: false } }))).toBe(false);
    expect(loyaltyOn(cleanPricing({ partnersOn: false, loyalty: { enabled: true } }))).toBe(false);
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
      JSON.stringify({ partnersOn: true, proDiscountPct: 50 }),
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
      JSON.stringify({ partnersOn: true, proDiscountPct: 25 }),
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
      JSON.stringify({ partnersOn: true, proDiscountPct: 10 }),
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
      JSON.stringify({ partnersOn: true, proDiscountPct: 30, proMinOrder: 100_000 }), // unreachable
    ]);
    const id = await makeProCustomer();
    const { lines, pricingTier } = await priceItems([{ id: plain.id, qty: 1 }], "RU", { customerId: id });
    expect(pricingTier).toBe("retail");
    expect(lines[0].price).toBe(plain.p);
  });

  it("createOrder stores customer_id and pricing_tier, and prices at pro rates", async () => {
    await query("insert into settings (key, value) values ($1, $2::jsonb)", [
      "pricing",
      JSON.stringify({ partnersOn: true, proDiscountPct: 20 }),
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
      JSON.stringify({ partnersOn: true, proDiscountPct: 42, proMinOrder: 77, loyalty: { enabled: true, earnPct: 8 } }),
    ]);
    const { GET } = await import("@/app/api/overrides/route");
    const res = await GET();
    const body = await res.json();
    // partnersOn is public — the storefront has to know whether to draw the
    // points block and «Стать партнёром» at all; the DISCOUNT still is not
    expect(body.settings.pricing).toEqual({ partnersOn: true, loyalty: { enabled: true, earnPct: 8 } });
    expect(JSON.stringify(body)).not.toContain("42");
    expect(JSON.stringify(body)).not.toContain("77");
  });
});

/* ---------- the ledger ------------------------------------------------------ */

describe("loyalty ledger — earn", () => {
  it("credits earnPct of the given subtotal, rounded to whole points", async () => {
    await query("insert into settings (key, value) values ($1, $2::jsonb)", [
      "pricing",
      JSON.stringify({ partnersOn: true, loyalty: { enabled: true, earnPct: 5 } }),
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
      JSON.stringify({ partnersOn: true, loyalty: { enabled: false, earnPct: 50 } }),
    ]);
    const id = await recordLogin("shopper2@example.com", "RU").then((c) => c.id);
    const out = await earnLoyaltyPoints(id, "22222222-2222-2222-2222-222222222222", 100);
    expect(out.points).toBe(0);
    expect(await getLoyaltyBalance(id)).toBe(0);
  });

  it("is idempotent per order — a second call for the same order does not double the balance", async () => {
    await query("insert into settings (key, value) values ($1, $2::jsonb)", [
      "pricing",
      JSON.stringify({ partnersOn: true, loyalty: { enabled: true, earnPct: 5 } }),
    ]);
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

/* 14.09.2026. A refund used to leave both ledger lines standing: the shop went
   on paying the bonus for a sale it had un-made, and a customer who had paid
   with points got the euros back and lost the points as well. */
describe("loyalty ledger — a refund takes the points back with the money", () => {
  async function paidOrderFor(email: string, redeem: boolean) {
    await query(
      "insert into settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value",
      ["pricing", JSON.stringify({ partnersOn: true, loyalty: { enabled: true, earnPct: 5, redeemMaxPct: 100, minRedeem: 1 } })],
    );
    const id = await recordLogin(email, "RU").then((c) => c.id);
    if (redeem) await adjustLoyaltyPoints(id, 30, "seed");
    const o = await createOrder(
      { lang: "ru", items: [{ id: plain.id, qty: 4 }], customer, shipping: ship, redeemPoints: redeem },
      { customerId: id },
    );
    await applyPaymentResult(
      { id: o.id, number: o.number, status: "new", total: o.total, subtotal: o.subtotal, discount: o.discount, loyaltyDiscount: o.loyaltyDiscount, items: o.items, customerId: id },
      verifyResult({ orderRef: o.number, amount: o.total }),
      "montonio",
      // the real one: the order row has to actually reach `paid`, because that
      // is what setOrderStatus() reads before deciding a refund reverses
      deps({ setOrderStatus: async (oid, st) => setOrderStatus(oid, st, "payment:montonio") }),
    );
    return { id, order: o };
  }

  it("cancels the points it earned when the order is refunded", async () => {
    const { id, order: o } = await paidOrderFor("refund-earn@example.com", false);
    const earned = await getLoyaltyBalance(id);
    expect(earned).toBeGreaterThan(0);

    await setOrderStatus(o.id, "refunded");
    expect(await getLoyaltyBalance(id)).toBe(0);
    const history = await getLoyaltyHistory(id);
    expect(history.filter((h) => h.reason === "adjust" && h.orderId === o.id)).toEqual([
      expect.objectContaining({ delta: -earned }),
    ]);
  });

  it("gives back the points the refunded order was paid with", async () => {
    const { id, order: o } = await paidOrderFor("refund-redeem@example.com", true);
    expect(o.loyaltyDiscount).toBeGreaterThan(0);
    const afterPaid = await getLoyaltyBalance(id);

    await setOrderStatus(o.id, "refunded");
    // the spent points come back, and whatever this order earned goes away
    const earn = (await getLoyaltyHistory(id)).find((h) => h.reason === "earn" && h.orderId === o.id);
    expect(await getLoyaltyBalance(id)).toBe(afterPaid + o.loyaltyDiscount - (earn?.delta ?? 0));
    expect(await getLoyaltyBalance(id)).toBe(30);
  });

  it("gives the points back when the order was CANCELLED first and refunded after", async () => {
    /* The order Renat actually does them in: «Отменить заказ», then «Вернуть
       деньги». A cancelled order can never move to «возврат», and the reversal
       hung off exactly that move — so the money went back and the ledger did
       not: the customer kept the points the order earned and never saw the
       points they had spent on it, at 1 point = 1 € (audit § 9.4). The gift
       cards were moved onto the refund itself in r22 for this same reason and
       the points were left behind; they now ride the same door. */
    const { id, order: o } = await paidOrderFor("refund-cancelled@example.com", true);
    expect(o.loyaltyDiscount).toBeGreaterThan(0);
    const afterPaid = await getLoyaltyBalance(id);

    await setOrderStatus(o.id, "cancelled", "admin");
    expect(await getLoyaltyBalance(id), "a cancel alone still holds the money").toBe(afterPaid);

    const { settleRefund } = await import("@/lib/payments/settle");
    await settleRefund((await getOrder(o.id))!, {
      ref: "cancelled-then-refunded-1",
      amount: o.total,
      status: "done",
      at: new Date().toISOString(),
      by: "admin",
    });

    const earn = (await getLoyaltyHistory(id)).find((h) => h.reason === "earn" && h.orderId === o.id);
    expect(await getLoyaltyBalance(id)).toBe(afterPaid + o.loyaltyDiscount - (earn?.delta ?? 0));
    // …and the order stays cancelled, which is what the customer was told
    expect((await getOrder(o.id))!.status).toBe("cancelled");
  });

  it("does not post the reversal twice, and leaves a cancellation alone", async () => {
    const { id, order: o } = await paidOrderFor("refund-twice@example.com", false);
    await setOrderStatus(o.id, "refunded");
    const once = await getLoyaltyHistory(id);
    await setOrderStatus(o.id, "refunded");
    expect(await getLoyaltyHistory(id)).toHaveLength(once.length);
    expect(await getLoyaltyBalance(id)).toBe(0);

    // a cancellation is not a refund — the order still holds the money
    const other = await paidOrderFor("refund-cancel@example.com", false);
    const before = await getLoyaltyBalance(other.id);
    await setOrderStatus(other.order.id, "cancelled");
    expect(await getLoyaltyBalance(other.id)).toBe(before);
  });
});

/* Dim, 26.09.2026, /test «order-refund-full»: «Text is there, but I'm not sure
   if in the account the points were returned.» The refund posted ONE row with
   the net of both halves — «Корректировка +N» — so neither «did my points come
   back» nor «were the order's own taken off» could be read anywhere. */
describe("loyalty ledger — a refund's points as two named lines", () => {
  async function pricing() {
    await query(
      "insert into settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value",
      ["pricing", JSON.stringify({ partnersOn: true, loyalty: { enabled: true, earnPct: 5, redeemMaxPct: 100, minRedeem: 1 } })],
    );
  }
  /** A paid order of `email` that spent `spend` points and earned `earn` — the ledger rows the paid transition writes. */
  async function paidWith(email: string, spend: number, earn: number, total = 40) {
    await pricing();
    const id = await recordLogin(email, "RU").then((c) => c.id);
    await adjustLoyaltyPoints(id, 100, "seed");
    const o = await createOrder({ lang: "ru", items: [{ id: plain.id, qty: 1 }], customer, shipping: ship }, { customerId: id });
    await query("update orders set status = 'paid', total = $2, payment = '{\"status\":\"paid\"}'::jsonb where id = $1", [o.id, total]);
    if (spend) await redeemLoyaltyPoints(id, o.id, spend, `списание на заказ ${o.number}`);
    if (earn) await query("insert into loyalty_ledger (customer_id, delta, reason, order_id) values ($1, $2, 'earn', $3)", [id, earn, o.id]);
    return { id, order: o };
  }
  const refundRows = async (orderId: string) =>
    (await query<{ delta: number; ref: string | null }>(
      "select delta, ref from loyalty_ledger where order_id = $1 and reason = 'adjust' order by id",
      [orderId],
    )).map((r) => ({ delta: Number(r.delta), ref: r.ref }));

  it("gives the spent points back on one line and takes the earned ones off on another", async () => {
    const { id, order: o } = await paidWith("two-lines@example.com", 10, 3);
    expect(await getLoyaltyBalance(id)).toBe(93);
    await setOrderStatus(o.id, "refunded", "admin");
    expect(await getLoyaltyBalance(id)).toBe(100);

    const rows = await refundRows(o.id);
    expect(rows.map((r) => r.delta)).toEqual([10, -3]);
    const lines = (await getLoyaltyHistory(id)).filter((h) => h.orderId === o.id && h.reason === "adjust");
    expect(lines.map((h) => [h.line, h.delta, h.orderNumber])).toEqual([
      ["revoke", -3, o.number],
      ["back", 10, o.number],
    ]);
    // and the order's own rows carry its number too — the screens print it
    expect((await getLoyaltyHistory(id)).find((h) => h.reason === "earn")?.orderNumber).toBe(o.number);
    expect(await orderPointsMoved(o.id)).toEqual({ back: 10, revoked: 3 });
  });

  it("posts nothing a second time — the card, the webhook and a retry all land on the same answer", async () => {
    const { id, order: o } = await paidWith("again@example.com", 10, 3);
    const first = await refundLoyaltyPoints(o.id, "возврат");
    expect(first).toMatchObject({ ok: true, back: 10, revoked: 3, points: 7 });
    const second = await refundLoyaltyPoints(o.id, "возврат");
    expect(second).toMatchObject({ ok: true, already: true, points: 0 });
    await setOrderStatus(o.id, "refunded", "admin");
    expect(await refundRows(o.id)).toHaveLength(2);
    expect(await getLoyaltyBalance(id)).toBe(100);
  });

  it("gives the points back when an order points paid for in full is cancelled — there is no refund to wait for", async () => {
    const { id, order: o } = await paidWith("all-points@example.com", 25, 0, 0);
    expect(await getLoyaltyBalance(id)).toBe(75);
    await setOrderStatus(o.id, "cancelled", "admin");
    expect(await getLoyaltyBalance(id)).toBe(100);
    expect((await refundRows(o.id)).map((r) => r.delta)).toEqual([25]);
  });

  it("leaves an order with money in it alone on a cancel — its refund brings the points", async () => {
    const { id, order: o } = await paidWith("money-cancel@example.com", 10, 3, 40);
    await setOrderStatus(o.id, "cancelled", "admin");
    expect(await getLoyaltyBalance(id)).toBe(93);
    expect(await refundRows(o.id)).toEqual([]);
  });

  it("puts the points back where they were when the refund is undone, and again when it is redone", async () => {
    const { id, order: o } = await paidWith("undo@example.com", 10, 3);
    await setOrderStatus(o.id, "refunded", "admin");
    expect(await getLoyaltyBalance(id)).toBe(100);

    await setOrderStatus(o.id, "paid", "admin"); // the journal's «Вернуть»
    expect(await getLoyaltyBalance(id), "the undo left the customer the spent points AND the order").toBe(93);
    const undo = (await getLoyaltyHistory(id)).filter((h) => h.line === "undo");
    expect(undo.map((h) => h.delta).sort((a, b) => a - b)).toEqual([-10, 3]);
    expect(await orderPointsMoved(o.id)).toEqual({ back: 0, revoked: 0 });

    await setOrderStatus(o.id, "refunded", "admin");
    expect(await getLoyaltyBalance(id)).toBe(100);
    expect(await refundRows(o.id)).toHaveLength(6);
  });

  it("keeps the points where the refund put them when the money really went back", async () => {
    const { id, order: o } = await paidWith("money-back@example.com", 10, 3);
    await setOrderStatus(o.id, "cancelled", "admin");
    const { settleRefund } = await import("@/lib/payments/settle");
    await settleRefund((await getOrder(o.id))!, {
      ref: "money-back-1", amount: 40, status: "done", at: new Date().toISOString(), by: "admin",
    }, { notify: false });
    expect(await getLoyaltyBalance(id)).toBe(100);
    // a status click does not bring the money back, so it does not take the points either
    await setOrderStatus(o.id, "paid", "admin");
    expect(await getLoyaltyBalance(id)).toBe(100);
  });

  it("the refund letter reads the ledger and says what moved", async () => {
    const { order: o } = await paidWith("letter@example.com", 10, 3);
    await setOrderStatus(o.id, "refunded", "admin");
    const bodies: string[] = [];
    const saved = { key: process.env.RESEND_API_KEY, retry: process.env.MAIL_RETRY_DELAY_MS };
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.MAIL_RETRY_DELAY_MS = "0";
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
      bodies.push(String(init.body));
      return new Response(JSON.stringify({ id: "msg_1" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    try {
      const { onOrderClosed } = await import("@/lib/mail-hooks");
      const order = (await getOrder(o.id))!;
      await onOrderClosed({ ...order, email: "letter@example.com" }, { kind: "refunded", amount: 40 });
      const sent = JSON.parse(bodies[0]) as { text: string };
      expect(sent.text).toContain("Баллы, потраченные на этот заказ, вернули на ваш счёт: 10.");
      expect(sent.text).toContain("Баллы, начисленные за этот заказ, сняли: 3.");
    } finally {
      vi.unstubAllGlobals();
      process.env.RESEND_API_KEY = saved.key;
      process.env.MAIL_RETRY_DELAY_MS = saved.retry;
      if (saved.key === undefined) delete process.env.RESEND_API_KEY;
      if (saved.retry === undefined) delete process.env.MAIL_RETRY_DELAY_MS;
    }
  });

  it("reads a net row written before 26.09.2026 as the whole reversal, and never pays it out again", async () => {
    const { id, order: o } = await paidWith("legacy@example.com", 10, 3);
    await query(
      "insert into loyalty_ledger (customer_id, delta, reason, order_id, note) values ($1, 7, 'adjust', $2, 'возврат заказа')",
      [id, o.id],
    );
    expect(await getLoyaltyBalance(id)).toBe(100);
    expect(await refundLoyaltyPoints(o.id)).toMatchObject({ ok: true, already: true, points: 0 });
    await setOrderStatus(o.id, "refunded", "admin");
    expect(await getLoyaltyBalance(id)).toBe(100);
    // an undo of it takes back exactly what it gave
    await setOrderStatus(o.id, "paid", "admin");
    expect(await getLoyaltyBalance(id)).toBe(93);
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

  /* A ceiling floors. eurosToPoints() rounds to the nearest point, which is
     what earning wants and the opposite of what «не больше 30 % от суммы
     корзины» means: on an 11.70 € basket round(3.51) allowed 4 points — 4 €,
     34 % — off a limit the account screen states in words. Up to half a euro
     of the shop's money, every basket that landed on a .5. */
  it("the percentage cap rounds down, never up", () => {
    expect(redeemCapPoints(11.7, 30)).toBe(3); // was round(3.51) = 4
    expect(redeemCapPoints(5, 30)).toBe(1); // was round(1.5) = 2
    expect(redeemCapPoints(50, 30)).toBe(15); // exact stays exact
    expect(redeemCapPoints(20, 100)).toBe(20);
    expect(redeemCapPoints(0, 30)).toBe(0);
    expect(redeemCapPoints(-10, 30)).toBe(0);
    // counted in cents, so 11.70 * 30 / 100 = 3.5100000000000002 cannot tip it
    expect(redeemCapPoints(10, 30)).toBe(3);
  });

  it("the quote takes the floored cap", async () => {
    const id = await recordLogin("floor@example.com", "RU").then((c) => c.id);
    await adjustLoyaltyPoints(id, 100, "seed");
    const q = await quoteLoyaltyRedeem(id, 11.7, { enabled: true, earnPct: 5, redeemMaxPct: 30, minRedeem: 5 });
    expect(q.maxRedeemable).toBe(3);
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

  /* 14.09.2026: «earnPct of the PAID goods subtotal» is what the setting has
     always promised; the call passed order.subtotal, which is the figure
     before discount and loyaltyDiscount come off and which prices a gift-card
     line at face value. */
  it("earns on what was paid for goods — not on the discount, not on the points, not on a gift card", async () => {
    const earn = vi.fn(async () => ({ ok: true, points: 1 }));
    // 100 € of goods, a 10 € promo and 5 points spent → 85 € was paid for goods
    const discounted = { id: "id-b1", number: "R-B1", status: "new", total: 85, subtotal: 100, discount: 10, loyaltyDiscount: 5, customerId: "c-1" };
    await applyPaymentResult(discounted, verifyResult({ amount: 85 }), "montonio", deps({ earnLoyaltyPoints: earn }));
    expect(earn).toHaveBeenCalledWith("c-1", "id-b1", 85);

    // a 100 € gift card bought alongside 20 € of shampoo: the card is money
    // changing shape and earns where it is SPENT, so only the 20 € counts
    earn.mockClear();
    const withCard = {
      id: "id-b2", number: "R-B2", status: "new", total: 120, subtotal: 120, customerId: "c-1",
      items: [
        { id: "gift-100", kind: "gift", qty: 1, price: 100, sum: 100 },
        { id: plain.id, kind: "product", qty: 1, price: 20, sum: 20 },
      ],
    };
    await applyPaymentResult(withCard, verifyResult({ amount: 120 }), "montonio", deps({ earnLoyaltyPoints: earn }));
    expect(earn).toHaveBeenCalledWith("c-1", "id-b2", 20);

    // …and the basket that card later pays for earns on nothing at all: the
    // card is redeemed through `discount` (codeDiscount in src/lib/orders.ts)
    earn.mockClear();
    const paidByCard = { id: "id-b3", number: "R-B3", status: "new", total: 0, subtotal: 60, discount: 60, customerId: "c-1" };
    await applyPaymentResult(paidByCard, verifyResult({ amount: 0 }), "montonio", deps({ earnLoyaltyPoints: earn }));
    expect(earn).toHaveBeenCalledWith("c-1", "id-b3", 0);
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
    await query("insert into settings (key, value) values ($1, $2::jsonb)", [
      "pricing",
      JSON.stringify({ partnersOn: true, loyalty: { enabled: true, earnPct: 5 } }),
    ]);
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

  /**
   * Dim, 13.09.2026: «An excel would be better, CSV hard to read» — he was
   * looking at a comma-separated file in an Excel that splits on `;`, so
   * every column landed in cell A. Both halves of the answer are checked
   * here: the CSV now uses the separator that Excel expects, and there is a
   * real .xlsx beside it for when nothing should have to be guessed.
   */
  it("exports a table Excel can open: `;` in the CSV, and an .xlsx beside it", async () => {
    await makeProCustomer("excel-pro@example.com");
    await recordLogin("excel-retail@example.com", "RU");
    const { GET } = await import("@/app/api/admin/customers/route");

    const csv = await GET(adminReq("https://x/api/admin/customers/?format=csv"));
    const bytes = Buffer.from(await csv.clone().arrayBuffer());
    const text = await csv.text();
    expect(csv.headers.get("content-disposition")).toContain("customers.csv");
    /* The BOM Excel needs before it will read Cyrillic — checked on the bytes,
       because Response.text() eats a leading BOM while decoding and the file
       Renat double-clicks is the bytes. */
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const head = text.split("\r\n")[0];
    expect(head.split(";")).toContain("pointsBalance");
    expect(head).not.toContain(",");
    // one row per customer, every row as wide as the header
    const rows = text.trim().split("\r\n").slice(1);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) expect(row.split(";")).toHaveLength(head.split(";").length);

    const xlsx = await GET(adminReq("https://x/api/admin/customers/?format=xlsx"));
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(xlsx.headers.get("content-disposition")).toContain("customers.xlsx");
    const book = Buffer.from(await xlsx.arrayBuffer());
    // a real OOXML package, not a renamed CSV: a zip whose sheet carries the rows
    expect(book.subarray(0, 2).toString("latin1")).toBe("PK");
    const entries = readZipEntries(book);
    expect(Object.keys(entries)).toEqual(expect.arrayContaining(["xl/workbook.xml", "xl/worksheets/sheet1.xml"]));
    const sheet = entries["xl/worksheets/sheet1.xml"];
    expect(sheet).toContain("excel-pro@example.com");
    expect(sheet).toContain("excel-retail@example.com");
    expect(sheet).toContain("pointsBalance");
    // the tab is named in the owner’s own language
    expect(entries["xl/workbook.xml"]).toContain("Клиенты");
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

  /* A decision closes the request — either decision. Until 17.09.2026
     «Одобрить» flipped the tier and left `pro_requested_at` standing, so the
     pending predicate (`pro_requested_at is not null and tier = 'retail'` —
     listCustomersAdmin, the «Заявка Pro» badge, the panel's counter and
     «Аналитика») matched the row again the moment that partner was moved back
     to retail: a request decided months ago, waiting for ever. The customer's
     own account screen read the same field and sat on «на рассмотрении ·
     Заявку получили, скоро рассмотрим», with no form to ask a second time. */
  it("a decided request stays decided — demoting a partner does not raise it again", async () => {
    const c = await recordLogin("decided@example.com", "RU");
    await requestProTier(c.email, { company: "OÜ Näidis", regCode: "12345678", phone: "" });
    expect((await listCustomersAdmin({ tier: "pending" })).map((r) => r.email)).toContain(c.email);

    const approved = await approveProCustomer(c.id);
    expect(approved?.tier).toBe("pro");
    expect(approved?.proRequestedAt).toBeNull();

    const demoted = await setCustomerTier(c.id, "retail");
    expect(demoted?.tier).toBe("retail");
    expect(demoted?.proRequestedAt).toBeNull();
    expect((await listCustomersAdmin({ tier: "pending" })).map((r) => r.email)).not.toContain(c.email);
  });

  it("the card's switch closes an open request exactly as «Одобрить» does", async () => {
    const c = await recordLogin("switched@example.com", "RU");
    await requestProTier(c.email, { company: "OÜ Näidis", regCode: "12345678", phone: "" });
    expect((await setCustomerTier(c.id, "pro"))?.proRequestedAt).toBeNull();
    expect((await setCustomerTier(c.id, "retail"))?.proRequestedAt).toBeNull();
    expect(await listCustomersAdmin({ tier: "pending" })).toHaveLength(0);
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
      JSON.stringify({ partnersOn: true, proDiscountPct: 33 }),
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
      JSON.stringify({ partnersOn: true, proDiscountPct: 15 }),
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
