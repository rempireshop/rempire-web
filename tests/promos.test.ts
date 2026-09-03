/**
 * Promo codes end to end: the rules module, the order that quotes one, and the
 * payment that spends it. Runs on PGlite — a real Postgres, no server.
 *
 * The audit row this covers: «the promo code is client-side only» — a string
 * compared in the browser, readable out of app.js, with the server having no
 * idea a discount had been promised.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { exec, query } from "@/lib/db";
import { createOrder } from "@/lib/orders";
import {
  consumePromo,
  getPromo,
  listPromos,
  looksLikeGiftCode,
  normalisePromoCode,
  PROMO_MAX_FIXED,
  PROMO_MAX_PERCENT,
  quoteFromPromo,
  quotePromo,
  setPromoActive,
  upsertPromo,
  validatePromo,
  type Promo,
} from "@/lib/promos";
import { applyPaymentResult, type ApplyDeps, type PaymentBlob } from "@/lib/payments/apply";
import type { VerifyResult } from "@/lib/payments/types";
import { setupDb, teardownDb } from "./helpers";

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const plain = CATALOGUE.find((p) => p.s === "in")!;

const customer = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };

async function make(over: Partial<Promo> & { code: string }): Promise<Promo> {
  const check = validatePromo({
    kind: "percent",
    value: 10,
    minSubtotal: 0,
    startsAt: null,
    endsAt: null,
    maxUses: null,
    active: true,
    note: null,
    ...over,
  });
  if (!check.ok) throw new Error("bad fixture: " + check.error);
  return upsertPromo(check.value);
}

describe("promo codes", () => {
  beforeAll(async () => {
    const applied = await setupDb();
    expect(applied).toContain("060_promo_codes.sql");
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate promo_code_uses, promo_codes restart identity cascade");
  });

  /* ---------- codes ---------- */

  it("normalises what a customer types and refuses what is not a code", () => {
    expect(normalisePromoCode("suvi10")).toBe("SUVI10");
    expect(normalisePromoCode("  SUVI 10 ")).toBe("SUVI10");
    expect(normalisePromoCode("BLACK-FRIDAY")).toBe("BLACK-FRIDAY");
    expect(normalisePromoCode("")).toBe("");
    expect(normalisePromoCode("ПРОМО10")).toBe("");        // Cyrillic
    expect(normalisePromoCode("A".repeat(25))).toBe("");   // over 24
    expect(normalisePromoCode("---")).toBe("");            // no letter or digit
    expect(normalisePromoCode("SUVI_10")).toBe("");        // underscore is not allowed
  });

  it("tells a gift card apart from a promo code by shape", () => {
    expect(looksLikeGiftCode("RMP-ACDE-4679")).toBe(true);
    expect(looksLikeGiftCode("rmp acde 4679")).toBe(true);
    expect(looksLikeGiftCode("SUVI10")).toBe(false);
    expect(looksLikeGiftCode("RMP10")).toBe(false);
  });

  /* ---------- quoting ---------- */

  it("prices the three kinds", async () => {
    await make({ code: "TEN", kind: "percent", value: 10 });
    await make({ code: "FIVER", kind: "fixed", value: 5 });
    await make({ code: "SHIP0", kind: "free_shipping" });

    expect(await quotePromo("ten", 40, 3.49)).toMatchObject({ ok: true, discount: 4, freeShipping: false });
    expect(await quotePromo("FIVER", 40, 3.49)).toMatchObject({ ok: true, discount: 5, freeShipping: false });
    expect(await quotePromo("SHIP0", 40, 3.49)).toMatchObject({ ok: true, discount: 3.49, freeShipping: true });
  });

  it("never gives away more than the basket holds", async () => {
    await make({ code: "BIG", kind: "fixed", value: 200 });
    expect((await quotePromo("BIG", 12, 3.49)).discount).toBe(12);
    // free shipping on a basket that already ships free takes nothing off
    await make({ code: "SHIP0", kind: "free_shipping" });
    expect((await quotePromo("SHIP0", 90, 0)).discount).toBe(0);
  });

  it("refuses a code that is off, unstarted, expired, spent, or under its floor", async () => {
    const base: Promo = {
      code: "X", kind: "percent", value: 10, minSubtotal: 0, startsAt: null, endsAt: null,
      maxUses: null, used: 0, active: true, note: null, createdAt: new Date().toISOString(),
    };
    const now = new Date("2026-06-15T12:00:00Z");
    expect(quoteFromPromo({ ...base, active: false }, 50, 3, now).error).toBe("inactive");
    expect(quoteFromPromo({ ...base, startsAt: "2026-07-01T00:00:00Z" }, 50, 3, now).error).toBe("not_started");
    expect(quoteFromPromo({ ...base, endsAt: "2026-06-01T00:00:00Z" }, 50, 3, now).error).toBe("expired");
    expect(quoteFromPromo({ ...base, maxUses: 3, used: 3 }, 50, 3, now).error).toBe("used_up");
    const low = quoteFromPromo({ ...base, minSubtotal: 60 }, 50, 3, now);
    expect(low.error).toBe("min_subtotal");
    // the shop has to be able to say «ещё 10 €», so the floor comes back too
    expect(low.minSubtotal).toBe(60);
    expect(quoteFromPromo({ ...base, maxUses: 3, used: 2 }, 50, 3, now).ok).toBe(true);
  });

  it("says not_found for a code nobody made, and bad_code for nonsense", async () => {
    expect((await quotePromo("NOPE", 50, 3)).error).toBe("not_found");
    expect((await quotePromo("ПРОМО", 50, 3)).error).toBe("bad_code");
  });

  /* ---------- validation ---------- */

  it("holds every code to the same bounds, however it was made", () => {
    expect(validatePromo({ code: "SUVI10", kind: "percent", value: 91 })).toMatchObject({ ok: false, error: "bad_value" });
    expect(validatePromo({ code: "SUVI10", kind: "percent", value: 0 })).toMatchObject({ ok: false, error: "bad_value" });
    expect(validatePromo({ code: "SUVI10", kind: "fixed", value: 201 })).toMatchObject({ ok: false, error: "bad_value" });
    expect(validatePromo({ code: "SUVI10", kind: "fixed", value: 0 })).toMatchObject({ ok: false, error: "bad_value" });
    expect(validatePromo({ code: "!!", kind: "percent", value: 10 })).toMatchObject({ ok: false, error: "bad_code" });
    expect(validatePromo({ code: "S", kind: "percent", value: 10, endsAt: "not a date" })).toMatchObject({ ok: false, error: "bad_date" });
    expect(validatePromo({
      code: "S", kind: "percent", value: 10,
      startsAt: "2026-09-10T00:00:00Z", endsAt: "2026-09-01T00:00:00Z",
    })).toMatchObject({ ok: false, error: "bad_date" });
    expect(validatePromo({ code: "S", kind: "percent", value: 10, maxUses: 0 })).toMatchObject({ ok: false, error: "bad_uses" });
    expect(validatePromo({ code: "S", kind: "percent", value: 10, maxUses: 2.7 })).toMatchObject({ ok: true });
    // free_shipping ignores whatever value the caller sent
    const free = validatePromo({ code: "SHIP0", kind: "free_shipping", value: 999 });
    expect(free.ok && free.value.value).toBe(0);
    // the extremes are allowed, one step past them is not
    expect(validatePromo({ code: "S", kind: "percent", value: PROMO_MAX_PERCENT }).ok).toBe(true);
    expect(validatePromo({ code: "S", kind: "fixed", value: PROMO_MAX_FIXED }).ok).toBe(true);
  });

  /* ---------- the admin's CRUD ---------- */

  it("creates, edits and deactivates without losing the usage count", async () => {
    await make({ code: "SUVI10", kind: "percent", value: 10, maxUses: 5 });
    await consumePromo("SUVI10", "11111111-1111-4111-8111-111111111111", 4);
    expect((await getPromo("SUVI10"))!.used).toBe(1);

    await make({ code: "SUVI10", kind: "percent", value: 15, maxUses: 5 });
    const edited = (await getPromo("SUVI10"))!;
    expect(edited.value).toBe(15);
    expect(edited.used).toBe(1);   // editing must not hand back a spent use

    expect((await setPromoActive("suvi10", false))!.active).toBe(false);
    expect(await setPromoActive("NOPE", false)).toBe(null);
    expect(await listPromos()).toHaveLength(1);
  });

  /* ---------- consuming ---------- */

  it("counts a use once per order, however many times the webhook arrives", async () => {
    await make({ code: "ONCE", kind: "percent", value: 10, maxUses: 2 });
    const orderId = "22222222-2222-4222-8222-222222222222";

    expect(await consumePromo("ONCE", orderId, 4)).toMatchObject({ ok: true, used: 1 });
    expect(await consumePromo("ONCE", orderId, 4)).toMatchObject({ ok: true, already: true });
    expect((await getPromo("ONCE"))!.used).toBe(1);

    // a different order does count
    expect(await consumePromo("ONCE", "33333333-3333-4333-8333-333333333333", 4)).toMatchObject({ ok: true, used: 2 });
    // and the third one hits the ceiling
    expect(await consumePromo("ONCE", "44444444-4444-4444-8444-444444444444", 4)).toMatchObject({ ok: false, error: "used_up" });
    expect((await getPromo("ONCE"))!.used).toBe(2);
  });

  it("cannot be raced past its own limit", async () => {
    await make({ code: "LAST", kind: "percent", value: 10, maxUses: 1 });
    const ids = [
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666",
      "77777777-7777-4777-8777-777777777777",
    ];
    const out = await Promise.all(ids.map((id) => consumePromo("LAST", id, 1)));
    expect(out.filter((r) => r.ok)).toHaveLength(1);
    expect((await getPromo("LAST"))!.used).toBe(1);
  });

  it("says not_found rather than inventing a row", async () => {
    expect(await consumePromo("GHOST", "88888888-8888-4888-8888-888888888888")).toMatchObject({
      ok: false, error: "not_found",
    });
    expect(await consumePromo("ПРОМО")).toMatchObject({ ok: false, error: "bad_code" });
  });

  /* ---------- the order that quotes one ---------- */

  it("prices a real order from the table, not from the browser", async () => {
    await make({ code: "TEN", kind: "percent", value: 10 });
    const o = await createOrder({
      lang: "ru",
      items: [{ id: plain.id, qty: 1 }],
      customer,
      shipping: { method: "parcel", country: "EE" },
      discountCode: "ten",
    });
    expect(o.discountCode).toBe("ten");
    expect(o.discount).toBeCloseTo(Math.round(o.subtotal * 10) / 100, 2);
    expect(o.total).toBeCloseTo(o.subtotal + o.shippingPrice - o.discount, 2);
    // and nothing was spent yet — the order has not been paid
    expect((await getPromo("TEN"))!.used).toBe(0);
  });

  it("charges full price for a code that does not exist", async () => {
    const o = await createOrder({
      lang: "ru",
      items: [{ id: plain.id, qty: 1 }],
      customer,
      shipping: { method: "parcel", country: "EE" },
      discountCode: "REMPIRE10",   // the old client-side code is just a string now
    });
    expect(o.discount).toBe(0);
    expect(o.total).toBeCloseTo(o.subtotal + o.shippingPrice, 2);
  });

  it("takes the delivery off for a free-shipping code and keeps the shipping line honest", async () => {
    await make({ code: "SHIP0", kind: "free_shipping" });
    const o = await createOrder({
      lang: "ru",
      items: [{ id: plain.id, qty: 1 }],
      customer,
      shipping: { method: "parcel", country: "EE" },
      discountCode: "SHIP0",
    });
    expect(o.shippingPrice).toBeGreaterThan(0);          // the parcel still costs what it costs
    expect(o.discount).toBeCloseTo(o.shippingPrice, 2);  // and the code pays for it
    expect(o.total).toBeCloseTo(o.subtotal, 2);
  });

  it("refuses to discount a basket under the code's floor", async () => {
    await make({ code: "BIG40", kind: "percent", value: 10, minSubtotal: 10_000 });
    const o = await createOrder({
      lang: "ru",
      items: [{ id: plain.id, qty: 1 }],
      customer,
      shipping: { method: "parcel", country: "EE" },
      discountCode: "BIG40",
    });
    expect(o.discount).toBe(0);
  });

  /* ---------- the payment that spends it ---------- */

  it("spends the code on the paid transition and only then", async () => {
    await make({ code: "PAID10", kind: "percent", value: 10, maxUses: 3 });
    const id = "99999999-9999-4999-8999-999999999999";
    const deps: ApplyDeps = {
      setOrderPayment: vi.fn(async (_i: string, _p: PaymentBlob) => ({})),
      setOrderStatus: vi.fn(async () => ({})),
      writeAudit: vi.fn(async () => ({})),
    };
    const order = { id, number: "R-100100", status: "new", total: 36, discount: 4, discountCode: "PAID10" };
    const paid: VerifyResult = { orderRef: "R-100100", status: "paid", providerRef: "ref-1", amount: 36, currency: "EUR" };

    const first = await applyPaymentResult(order, paid, "montonio", deps);
    expect(first.alreadyPaid).toBe(false);
    expect(first.giftShortfall).toBeUndefined();
    expect((await getPromo("PAID10"))!.used).toBe(1);

    // the webhook retries; the same order must not count twice
    const again = await applyPaymentResult({ ...order, status: "paid" }, paid, "montonio", deps);
    expect(again.alreadyPaid).toBe(true);
    expect((await getPromo("PAID10"))!.used).toBe(1);
  });

  it("keeps a paid order paid when the code ran out in the meantime, and audits it", async () => {
    await make({ code: "GONE", kind: "percent", value: 10, maxUses: 1 });
    await consumePromo("GONE", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", 1);

    const writeAudit = vi.fn(async () => ({}));
    const out = await applyPaymentResult(
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", number: "R-100101", status: "new", total: 36, discount: 4, discountCode: "GONE" },
      { orderRef: "R-100101", status: "paid", providerRef: "ref-2", amount: 36, currency: "EUR" },
      "montonio",
      {
        setOrderPayment: vi.fn(async (_i: string, _p: PaymentBlob) => ({})),
        setOrderStatus: vi.fn(async () => ({})),
        writeAudit,
      },
    );
    expect(out.status).toBe("paid");
    expect(out.giftShortfall).toMatchObject({ code: "GONE", error: "used_up" });
    expect(writeAudit).toHaveBeenCalledWith("system", "promo_consume_failed", expect.objectContaining({ code: "GONE" }));
  });

  it("does not send a promo code to the gift-card redeem", async () => {
    await make({ code: "NOTACARD", kind: "percent", value: 10 });
    const redeemGiftCard = vi.fn(async () => ({ ok: false, error: "not_found" }));
    const writeAudit = vi.fn(async () => ({}));
    await applyPaymentResult(
      { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", number: "R-100102", status: "new", total: 36, discount: 4, discountCode: "NOTACARD" },
      { orderRef: "R-100102", status: "paid", providerRef: "ref-3", amount: 36, currency: "EUR" },
      "montonio",
      {
        setOrderPayment: vi.fn(async (_i: string, _p: PaymentBlob) => ({})),
        setOrderStatus: vi.fn(async () => ({})),
        redeemGiftCard,
        writeAudit,
      },
    );
    expect(redeemGiftCard).not.toHaveBeenCalled();
    expect((await getPromo("NOTACARD"))!.used).toBe(1);
    // and no giftcard_redeem_failed row about a card that never existed
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("keeps an append-only trail of every use", async () => {
    await make({ code: "TRAIL", kind: "fixed", value: 5 });
    await consumePromo("TRAIL", "dddddddd-dddd-4ddd-8ddd-dddddddddddd", 5);
    const rows = await query<{ code: string; amount: string }>(
      "select code, amount from promo_code_uses order by id",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("TRAIL");
    expect(Number(rows[0].amount)).toBe(5);
  });
});
