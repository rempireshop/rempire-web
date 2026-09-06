/**
 * POST /api/payments/create — the moment an order turns into a payment.
 *
 * Three things the checkout got wrong on 06.09.2026, each pinned here through
 * the real routes (POST /api/orders → POST /api/payments/create → the mock
 * provider's signed ticket → notify/return), never a shortcut past them:
 *
 *   · Apple Pay / Google Pay were sent to the bank list. The route now takes
 *     "wallet" as its own method, hands it to the provider as a card payment
 *     and remembers the shopper's real choice on the order.
 *   · An order a gift card (or points, or a promo) paid for entirely answered
 *     `bad_amount` and the checkout said «Оплата пока недоступна». Nothing
 *     is left to pay, so the order is settled on the spot — the same paid
 *     transition a provider's ticket runs, once — and the shopper is sent
 *     to the same receipt.
 *   · A shopper who cancelled at the bank had no way back: the failed receipt
 *     now carries the order id, and a create with nothing but that id reuses
 *     the method chosen the first time.
 *
 * Real Postgres (PGlite), the mock provider, fetch stubbed.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/auth";
import { exec, query } from "@/lib/db";
import { getGiftCard } from "@/lib/giftcards";
import { issueOrderGiftCards, onOrderPaid } from "@/lib/mail-hooks";
import { getOrder } from "@/lib/orders";
import { mockSecret, readMockTicket, signMockTicket } from "@/lib/payments/mock";
import { resetRateLimits as resetPayRateLimits } from "@/lib/payments/ratelimit";
import {
  customerCookieHeader,
  installFetchStub,
  makeRequest,
  ORIGIN,
  PRODUCT,
  resetIps,
  setFuzzEnv,
} from "./fuzz-harness";
import { setupDb, teardownDb } from "./helpers";

/* The letter and the owner's ping are counted, not sent: the hook module is
   wrapped so its two entry points are spies over the real functions (fetch is
   stubbed underneath them anyway). */
vi.mock("@/lib/mail-hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mail-hooks")>();
  return {
    ...actual,
    onOrderPaid: vi.fn(actual.onOrderPaid),
    issueOrderGiftCards: vi.fn(actual.issueOrderGiftCards),
  };
});

let restoreEnv: () => void = () => {};

const CODE = "RMP-ACDE-4679";
const CUSTOMER = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };
/** Pickup in the salon: nothing to deliver, so the basket is the whole bill. */
const PICKUP = {
  lang: "RU",
  items: [{ id: PRODUCT.id, qty: 1 }],
  customer: CUSTOMER,
  shipping: { method: "pickup", country: "EE" },
};
/** A courier to the door: a delivery line on top of the goods. */
const COURIER = {
  ...PICKUP,
  shipping: { method: "courier", country: "EE", address: { addr: "Testitänav 1", zip: "10111", city: "Tallinn" } },
};

type OrderResult = { ok: boolean; orderId?: string; number?: string; total?: number; error?: string };
type CreateResult = {
  ok: boolean;
  error?: string;
  provider?: string;
  ref?: string;
  redirectUrl?: string;
  paid?: boolean;
};

async function place(body: Record<string, unknown>, opts: { cookie?: string } = {}) {
  const { POST } = await import("@/app/api/orders/route");
  const res = await POST(makeRequest("/api/orders/", { method: "POST", body, ...opts }));
  const json = (await res.json()) as OrderResult;
  expect(res.status, `place: ${JSON.stringify(json)}`).toBe(201);
  return json as Required<Pick<OrderResult, "orderId" | "number" | "total">>;
}

async function create(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/payments/create/route");
  const res = await POST(makeRequest("/api/payments/create/", { method: "POST", body }));
  return { status: res.status, body: (await res.json()) as CreateResult };
}

function ticket(number: string, amount: number, status: "paid" | "failed") {
  return signMockTicket(
    { orderRef: number, ref: `mock_${number}`, returnUrl: `${ORIGIN}/api/payments/return/`, amount, status },
    mockSecret(),
  );
}

async function notify(number: string, amount: number, status: "paid" | "failed" = "paid") {
  const { POST } = await import("@/app/api/payments/notify/route");
  const res = await POST(
    makeRequest("/api/payments/notify/", { method: "POST", body: { mockToken: ticket(number, amount, status) } }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function comeBack(number: string, amount: number, status: "paid" | "failed") {
  const { GET } = await import("@/app/api/payments/return/route");
  const token = encodeURIComponent(ticket(number, amount, status));
  return GET(makeRequest(`/api/payments/return/?mock-token=${token}`));
}

/** The mock bank's ticket, read back off the URL the shopper is sent to. */
function ticketOf(redirectUrl: string | undefined) {
  expect(redirectUrl, "no redirectUrl").toMatch(/\/api\/payments\/mock\/\?t=/);
  const t = new URL(String(redirectUrl)).searchParams.get("t") ?? "";
  return readMockTicket(t, mockSecret());
}

async function row(id: string) {
  const o = await getOrder(id);
  if (!o) throw new Error(`order ${id} vanished`);
  return o;
}

async function card(balance: number, code = CODE) {
  await query(`insert into gift_cards (code, amount, balance, lang) values ($1, $2, $3, 'RU')`, [code, 100, balance]);
}

async function balanceOf(code = CODE): Promise<number | null> {
  const c = await getGiftCard(code);
  return c ? c.balance : null;
}

async function uses(code = CODE): Promise<number[]> {
  const rows = await query<{ amount: string | number }>("select amount from gift_card_uses where code = $1", [code]);
  return rows.map((r) => Number(r.amount));
}

const paidMails = () => (onOrderPaid as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

describe("POST /api/payments/create", () => {
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
  beforeEach(async () => {
    resetRateLimits();
    resetPayRateLimits();
    resetIps();
    (onOrderPaid as unknown as { mockClear(): void }).mockClear();
    (issueOrderGiftCards as unknown as { mockClear(): void }).mockClear();
    await exec("truncate gift_card_uses, gift_cards, promo_code_uses, promo_codes restart identity cascade");
    await exec(
      "truncate orders, admin_audit, stock_levels, stock_moves, loyalty_ledger, customers, events restart identity cascade",
    );
  });
  afterEach(() => {
    // a test that switched the provider off puts it back
    process.env.PAYMENT_PROVIDER = "mock";
  });

  describe("which way the shopper pays", () => {
    it("Apple Pay / Google Pay is a card payment, never the bank list — and the choice is remembered", async () => {
      const o = await place(PICKUP);
      // the checkout sends whatever bank chip was last highlighted; it must not travel with a wallet
      const res = await create({ orderId: o.orderId, method: "wallet", bank: "LHVBEE22", lang: "RU" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.provider).toBe("mock");

      const t = ticketOf(res.body.redirectUrl);
      expect(t.method).toBe("wallet");
      expect(t.bank).toBeUndefined();
      expect(t.amount).toBe(o.total);

      const stored = (await row(o.orderId)).payment as Record<string, unknown>;
      expect(stored.method).toBe("wallet");
      // written as null on purpose: a retry that switched away from a bank link clears the old bank
      expect(stored.bank ?? null).toBeNull();
      expect(stored.status).toBe("pending");
      expect(stored.provider).toBe("mock");
    });

    it("a bank link carries the chosen bank; a card leaves a stray bank code behind", async () => {
      const a = await place(PICKUP);
      const bank = await create({ orderId: a.orderId, method: "bank", bank: "EEUHEE2X", lang: "ET" });
      expect(bank.status).toBe(200);
      expect(ticketOf(bank.body.redirectUrl).bank).toBe("EEUHEE2X");
      expect(((await row(a.orderId)).payment as Record<string, unknown>).method).toBe("bank");
      expect(((await row(a.orderId)).payment as Record<string, unknown>).bank).toBe("EEUHEE2X");

      const b = await place(PICKUP);
      const cardRes = await create({ orderId: b.orderId, method: "card", bank: "EEUHEE2X" });
      expect(cardRes.status).toBe(200);
      expect(ticketOf(cardRes.body.redirectUrl).method).toBe("card");
      expect(ticketOf(cardRes.body.redirectUrl).bank).toBeUndefined();
      expect(((await row(b.orderId)).payment as Record<string, unknown>).bank ?? null).toBeNull();
    });

    it("anything it has not been taught is a bank link, as before", async () => {
      const o = await place(PICKUP);
      const res = await create({ orderId: o.orderId, method: "bitcoin" });
      expect(res.status).toBe(200);
      expect(ticketOf(res.body.redirectUrl).method).toBe("bank");
    });

    it("the mock bank page says which page Montonio would have shown", async () => {
      const { GET } = await import("@/app/api/payments/mock/route");
      const o = await place(PICKUP);
      const wallet = await create({ orderId: o.orderId, method: "wallet" });
      const page = await GET(makeRequest(new URL(String(wallet.body.redirectUrl)).pathname + new URL(String(wallet.body.redirectUrl)).search));
      const html = await page.text();
      expect(page.status).toBe(200);
      expect(html).toContain('data-mock-page="card"');
      expect(html).toContain("Apple Pay");

      const o2 = await place(PICKUP);
      const bank = await create({ orderId: o2.orderId, method: "bank", bank: "LHVBEE22" });
      const page2 = await GET(makeRequest(new URL(String(bank.body.redirectUrl)).pathname + new URL(String(bank.body.redirectUrl)).search));
      const html2 = await page2.text();
      expect(html2).toContain('data-mock-page="bank"');
      expect(html2).toContain("LHVBEE22");
    });
  });

  describe("an order with nothing left to pay", () => {
    it("a gift card bigger than the basket settles the order on the spot", async () => {
      await card(50);
      const o = await place({ ...PICKUP, discountCode: CODE });
      expect(o.total).toBe(0);
      const goods = (await row(o.orderId)).subtotal;
      expect(goods).toBeGreaterThan(0);

      const res = await create({ orderId: o.orderId, method: "bank", bank: "LHVBEE22", lang: "RU" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.paid).toBe(true);
      expect(res.body.provider).toBe("none");
      // the same receipt a provider's return lands on — paid, with the total for the funnel beacon
      expect(res.body.redirectUrl).toBe(`${ORIGIN}/shop2/done/?n=${o.number}&s=paid&t=0.00`);

      const r = await row(o.orderId);
      expect(r.status).toBe("paid");
      const p = r.payment as Record<string, unknown>;
      expect(p.provider).toBe("none");
      expect(p.status).toBe("paid");
      expect(p.method).toBe("giftcard");
      expect(p.amount).toBe(0);

      // the card paid exactly the basket and keeps the rest; one use row
      expect(await balanceOf()).toBeCloseTo(50 - goods, 2);
      expect(await uses()).toEqual([goods]);
      // one letter, one ping — the same hook the webhook runs
      expect(paidMails()).toBe(1);
    });

    it("a second create for the settled order changes nothing", async () => {
      await card(50);
      const o = await place({ ...PICKUP, discountCode: CODE });
      expect((await create({ orderId: o.orderId, method: "card" })).status).toBe(200);
      const balance = await balanceOf();

      const again = await create({ orderId: o.orderId, method: "card" });
      expect(again.status).toBe(409);
      expect(again.body.error).toBe("already_paid");
      expect(await balanceOf()).toBe(balance);
      expect((await uses()).length).toBe(1);
      expect(paidMails()).toBe(1);
      // a webhook-shaped repeat is quiet too
      await notify(o.number, 0);
      expect((await uses()).length).toBe(1);
      expect(paidMails()).toBe(1);
    });

    it("a gift card that covers the goods but not the delivery still goes to the bank for the rest", async () => {
      const probe = await place(COURIER);
      const goods = (await row(probe.orderId)).subtotal;
      const delivery = (await row(probe.orderId)).shippingPrice;
      expect(delivery).toBeGreaterThan(0);

      await card(goods);
      const o = await place({ ...COURIER, discountCode: CODE });
      expect(o.total).toBeCloseTo(delivery, 2);

      const res = await create({ orderId: o.orderId, method: "bank", bank: "HABAEE2X" });
      expect(res.status).toBe(200);
      expect(res.body.paid).toBeUndefined();
      expect(res.body.provider).toBe("mock");
      expect(ticketOf(res.body.redirectUrl).amount).toBeCloseTo(delivery, 2);
      // nothing is taken off the card until the bank says paid
      expect(await balanceOf()).toBe(goods);
      expect((await row(o.orderId)).status).toBe("new");

      await notify(o.number, o.total);
      expect((await row(o.orderId)).status).toBe("paid");
      expect(await balanceOf()).toBe(0);
      expect(await uses()).toEqual([goods]);
    });

    it("one cent left to pay is still a payment", async () => {
      const probe = await place(PICKUP);
      const goods = (await row(probe.orderId)).subtotal;
      await card(Math.round((goods - 0.01) * 100) / 100);
      const o = await place({ ...PICKUP, discountCode: CODE });
      expect(o.total).toBe(0.01);

      const res = await create({ orderId: o.orderId, method: "card" });
      expect(res.status).toBe(200);
      expect(res.body.provider).toBe("mock");
      expect(ticketOf(res.body.redirectUrl).amount).toBe(0.01);
      expect((await row(o.orderId)).status).toBe("new");
    });

    it("points stop at what the gift card left to pay, and both settle once", async () => {
      const { recordLogin } = await import("@/lib/customers");
      const { adjustLoyaltyPoints, getLoyaltyBalance, getPricingSettings } = await import("@/lib/loyalty");
      const customer = await recordLogin(CUSTOMER.email, "RU");
      await adjustLoyaltyPoints(customer.id, 1000, "test");
      const pricing = await getPricingSettings();
      expect(pricing.loyalty.enabled).toBe(true);
      const cookie = customerCookieHeader(CUSTOMER.email);

      const probe = await place({ ...PICKUP, items: [{ id: PRODUCT.id, qty: 3 }] }, { cookie });
      const goods = (await row(probe.orderId)).subtotal;
      const cap = Math.round((goods * pricing.loyalty.redeemMaxPct) / 100);
      expect(cap).toBeGreaterThan(1);

      // the card leaves less to pay than the points could cover
      const left = cap - 1;
      await card(goods - left);
      const o = await place({ ...PICKUP, items: [{ id: PRODUCT.id, qty: 3 }], discountCode: CODE, redeemPoints: true }, { cookie });
      const r = await row(o.orderId);
      expect(r.discount).toBeCloseTo(goods - left, 2);
      expect(r.loyaltyDiscount).toBe(left);
      expect(r.total).toBe(0);

      const res = await create({ orderId: o.orderId, method: "wallet" });
      expect(res.status).toBe(200);
      expect(res.body.paid).toBe(true);
      expect((await row(o.orderId)).status).toBe("paid");
      expect(await balanceOf()).toBe(0);
      // only what was left, not the whole cap — and earned points come on top
      const balance = await getLoyaltyBalance(customer.id);
      const earned = Math.round((goods * pricing.loyalty.earnPct) / 100);
      expect(balance).toBe(1000 - left + earned);
      expect(paidMails()).toBe(1);
    });

    it("a gift card that covers everything leaves the points alone", async () => {
      const { recordLogin } = await import("@/lib/customers");
      const { adjustLoyaltyPoints, getLoyaltyBalance, getPricingSettings } = await import("@/lib/loyalty");
      const customer = await recordLogin(CUSTOMER.email, "RU");
      await adjustLoyaltyPoints(customer.id, 1000, "test");
      const pricing = await getPricingSettings();
      const cookie = customerCookieHeader(CUSTOMER.email);

      await card(100);
      const o = await place({ ...PICKUP, discountCode: CODE, redeemPoints: true }, { cookie });
      const r = await row(o.orderId);
      expect(r.loyaltyDiscount).toBe(0);
      expect(r.total).toBe(0);

      const res = await create({ orderId: o.orderId, method: "card" });
      expect(res.status).toBe(200);
      expect(res.body.paid).toBe(true);
      const earned = Math.round((r.subtotal * pricing.loyalty.earnPct) / 100);
      expect(await getLoyaltyBalance(customer.id)).toBe(1000 + earned);
      const ledger = await query<{ reason: string }>("select reason from loyalty_ledger where order_id = $1", [o.orderId]);
      expect(ledger.map((l) => l.reason)).toEqual(earned > 0 ? ["earn"] : []);
    });

    it("a promo code that zeroes the order counts its use once", async () => {
      const { upsertPromo, getPromo } = await import("@/lib/promos");
      await upsertPromo({ code: "FREEALL", kind: "fixed", value: 200, minSubtotal: 0, startsAt: null, endsAt: null, maxUses: null, active: true, note: null });
      const o = await place({ ...PICKUP, discountCode: "FREEALL" });
      expect(o.total).toBe(0);

      const res = await create({ orderId: o.orderId, method: "bank" });
      expect(res.status).toBe(200);
      expect(res.body.paid).toBe(true);
      const p = (await row(o.orderId)).payment as Record<string, unknown>;
      expect(p.method).toBe("promo");
      expect((await getPromo("FREEALL"))?.used).toBe(1);
      const usesRows = await query("select id from promo_code_uses where order_id = $1", [o.orderId]);
      expect(usesRows.length).toBe(1);

      await notify(o.number, 0);
      expect((await getPromo("FREEALL"))?.used).toBe(1);
    });

    it("a card spent in the meantime does not buy the order for free", async () => {
      await card(50);
      // quoted while the card held 50 €…
      const o = await place({ ...PICKUP, discountCode: CODE });
      expect(o.total).toBe(0);
      // …then the same card paid for something else (another tab, another basket)
      await query("update gift_cards set balance = 5 where code = $1", [CODE]);

      const res = await create({ orderId: o.orderId, method: "bank" });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("not_covered");
      const r = await row(o.orderId);
      expect(r.status).toBe("new");
      expect(r.payment).toBeNull();
      expect(await balanceOf()).toBe(5);
      expect((await uses()).length).toBe(0);
      expect(paidMails()).toBe(0);
      // the same for points that were spent in between
      const { recordLogin } = await import("@/lib/customers");
      const { adjustLoyaltyPoints } = await import("@/lib/loyalty");
      const customer = await recordLogin(CUSTOMER.email, "RU");
      await adjustLoyaltyPoints(customer.id, 1000, "test");
      await card(100, "RMP-CDEF-GHJK");
      const probe = await place({ ...PICKUP, items: [{ id: PRODUCT.id, qty: 3 }] });
      const goods = (await row(probe.orderId)).subtotal;
      await query("update gift_cards set balance = $2 where code = $1", ["RMP-CDEF-GHJK", goods - 2]);
      const p = await place(
        { ...PICKUP, items: [{ id: PRODUCT.id, qty: 3 }], discountCode: "RMP-CDEF-GHJK", redeemPoints: true },
        { cookie: customerCookieHeader(CUSTOMER.email) },
      );
      expect((await row(p.orderId)).loyaltyDiscount).toBe(2);
      expect(p.total).toBe(0);
      await adjustLoyaltyPoints(customer.id, -999, "test");
      const short = await create({ orderId: p.orderId, method: "card" });
      expect(short.status).toBe(409);
      expect(short.body.error).toBe("not_covered");
      expect((await row(p.orderId)).status).toBe("new");
      // the card was not touched either — the points were checked first
      expect(await balanceOf("RMP-CDEF-GHJK")).toBe(goods - 2);
    });

    it("needs no payment provider at all", async () => {
      delete process.env.PAYMENT_PROVIDER;
      await card(50);
      const o = await place({ ...PICKUP, discountCode: CODE });
      const res = await create({ orderId: o.orderId, method: "bank" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.paid).toBe(true);
      expect((await row(o.orderId)).status).toBe("paid");

      // …while an order that does cost something still refuses without one
      const paid = await place(PICKUP);
      const refused = await create({ orderId: paid.orderId, method: "bank" });
      expect(refused.status).toBe(503);
      expect(refused.body.error).toBe("not_configured");
    });
  });

  describe("coming back and trying again", () => {
    it("a cancelled payment lands on the failed receipt with the order id, and a bare id re-creates the payment the same way", async () => {
      const o = await place(PICKUP);
      const first = await create({ orderId: o.orderId, method: "bank", bank: "RIKOEE22", lang: "ET" });
      expect(first.status).toBe(200);

      const back = await comeBack(o.number, o.total, "failed");
      expect(back.status).toBe(303);
      const location = new URL(back.headers.get("location") ?? "");
      expect(location.pathname).toBe("/shop2/done/");
      expect(location.searchParams.get("s")).toBe("failed");
      expect(location.searchParams.get("n")).toBe(o.number);
      expect(location.searchParams.get("o")).toBe(o.orderId);
      expect((await row(o.orderId)).status).toBe("failed");

      const retry = await create({ orderId: o.orderId, lang: "ET" });
      expect(retry.status, JSON.stringify(retry.body)).toBe(200);
      const t = ticketOf(retry.body.redirectUrl);
      expect(t.method).toBe("bank");
      expect(t.bank).toBe("RIKOEE22");
      expect(t.amount).toBe(o.total);

      const done = await comeBack(o.number, o.total, "paid");
      const finalUrl = new URL(done.headers.get("location") ?? "");
      expect(finalUrl.searchParams.get("s")).toBe("paid");
      expect(finalUrl.searchParams.get("o")).toBeNull();
      expect((await row(o.orderId)).status).toBe("paid");
    });

    it("a webhook delivered twice settles once: one letter, one gift-card charge", async () => {
      await card(5);
      const o = await place({ ...PICKUP, discountCode: CODE });
      expect(o.total).toBeGreaterThan(0);
      expect((await create({ orderId: o.orderId, method: "card" })).status).toBe(200);

      const one = await notify(o.number, o.total);
      expect(one.status).toBe(200);
      const two = await notify(o.number, o.total);
      expect(two.status).toBe(200);
      expect(await balanceOf()).toBe(0);
      expect((await uses()).length).toBe(1);
      expect(paidMails()).toBe(1);
      // a late "failed" never takes a paid order back
      await notify(o.number, o.total, "failed");
      expect((await row(o.orderId)).status).toBe("paid");
    });
  });
});
