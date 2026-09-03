/**
 * When a gift card is actually spent.
 *
 * The rule this file exists to pin down (audit H3): createOrder only QUOTES the
 * discount, and the balance is taken the moment the payment is confirmed. Every
 * other path — abandoned checkout, failed payment, a webhook delivered twice —
 * must leave the card exactly as it was.
 *
 * Real Postgres (PGlite), real orders, real gift_cards rows.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { exec, query } from "@/lib/db";
import { getGiftCard } from "@/lib/giftcards";
import { createOrder, getOrder, setOrderPayment, setOrderStatus } from "@/lib/orders";
import { applyPaymentResult } from "@/lib/payments/apply";
import type { VerifyResult } from "@/lib/payments/types";
import { setupDb, teardownDb } from "./helpers";

type Min = { id: string; s: string };
const product = (catalogueMin as Min[]).find((p) => p.s === "in")!;

const CODE = "RMP-ACDE-4679";

const deps = { setOrderPayment, setOrderStatus };

function paid(over: Partial<VerifyResult> = {}): VerifyResult {
  return {
    orderRef: "",
    status: "paid",
    providerRef: "montonio-ref-1",
    currency: "EUR",
    ...over,
  };
}

/** A card with `balance` euro on it, ready to be spent. */
async function card(balance: number): Promise<void> {
  await query(
    `insert into gift_cards (code, amount, balance, lang) values ($1, $2, $3, 'RU')`,
    [CODE, 100, balance],
  );
}

async function balanceOf(): Promise<number | null> {
  const c = await getGiftCard(CODE);
  return c ? c.balance : null;
}

async function order(discountCode: string | null = CODE) {
  return createOrder({
    lang: "ru",
    items: [{ id: product.id, qty: 1 }],
    customer: { name: "Мария Тамм", email: "maria@example.com", phone: "" },
    shipping: { method: "parcel", country: "EE" },
    discountCode,
  });
}

describe("a gift card is spent when the money arrives, not before", () => {
  beforeAll(async () => {
    const applied = await setupDb();
    expect(applied).toContain("020_gift_cards.sql");
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate gift_card_uses, gift_cards restart identity cascade");
    // cascade: order_messages (111_order_messages.sql) has a foreign key onto orders.
    // stock_levels/stock_moves: applyPaymentResult's paid transition decrements
    // real stock (src/lib/payments/apply.ts decrementStock(), inventory agent)
    // whenever deps.decrementStock is not injected, which this file's deps()
    // does not — so a product sold in one case must not stay "tracked" (and
    // possibly out of stock) for the next.
    await exec("truncate orders, admin_audit, stock_levels, stock_moves restart identity cascade");
  });

  it("quotes the discount at checkout and touches nothing", async () => {
    await card(40);
    const o = await order();

    expect(o.discountCode).toBe(CODE);
    expect(o.discount).toBeGreaterThan(0);
    expect(o.total).toBe(Math.max(0, o.subtotal + o.shippingPrice - o.discount));
    // the card is untouched: this order may never be paid
    expect(await balanceOf()).toBe(40);
    const uses = await query<{ n: string }>("select count(*) as n from gift_card_uses");
    expect(Number(uses[0].n)).toBe(0);
  });

  it("spends it exactly once, on the transition into paid", async () => {
    await card(40);
    const o = await order();

    const out = await applyPaymentResult(o, paid({ orderRef: o.number, amount: o.total }), "montonio", deps);
    expect(out.status).toBe("paid");
    expect(out.alreadyPaid).toBe(false);
    expect(out.giftShortfall).toBeUndefined();
    expect(await balanceOf()).toBeCloseTo(40 - o.discount, 2);

    const uses = await query<{ code: string; order_id: string; amount: string }>(
      "select code, order_id, amount from gift_card_uses",
    );
    expect(uses).toHaveLength(1);
    expect(uses[0].code).toBe(CODE);
    expect(uses[0].order_id).toBe(o.id);
  });

  it("does not spend it twice when the webhook is delivered twice", async () => {
    await card(40);
    const o = await order();
    await applyPaymentResult(o, paid({ orderRef: o.number, amount: o.total }), "montonio", deps);
    const after = await balanceOf();

    // the replay reads the order back the way the route does
    const again = (await getOrder(o.id))!;
    const out = await applyPaymentResult(again, paid({ orderRef: o.number, amount: o.total }), "montonio", deps);

    expect(out.status).toBe("paid");
    expect(out.alreadyPaid).toBe(true); // ⇒ the routes send no second owner ping
    expect(await balanceOf()).toBe(after);
    const uses = await query<{ n: string }>("select count(*) as n from gift_card_uses");
    expect(Number(uses[0].n)).toBe(1);
  });

  it("leaves the card alone on a failed payment, and on a pending one", async () => {
    await card(40);
    const o = await order();

    await applyPaymentResult(o, paid({ orderRef: o.number, status: "failed" }), "montonio", deps);
    expect(await balanceOf()).toBe(40);

    const still = (await getOrder(o.id))!;
    await applyPaymentResult(still, paid({ orderRef: o.number, status: "pending" }), "montonio", deps);
    expect(await balanceOf()).toBe(40);
    expect(Number((await query<{ n: string }>("select count(*) as n from gift_card_uses"))[0].n)).toBe(0);
  });

  it("keeps the order paid when the card emptied in the meantime, and says so in the audit", async () => {
    await card(40);
    const o = await order();
    // somebody else spent the balance while the shopper was at the bank
    await query("update gift_cards set balance = 0 where code = $1", [CODE]);

    const out = await applyPaymentResult(o, paid({ orderRef: o.number, amount: o.total }), "montonio", deps);

    // the money arrived — the order is paid, whatever happened to the card
    expect(out.status).toBe("paid");
    expect(out.giftShortfall).toMatchObject({ code: CODE, error: "insufficient" });
    expect((await getOrder(o.id))!.status).toBe("paid");

    const audit = await query<{ action: string; payload: unknown }>(
      "select action, payload from admin_audit where action = 'giftcard_redeem_failed'",
    );
    expect(audit).toHaveLength(1);
  });

  it("does nothing at all for an order without a code", async () => {
    const o = await order(null);
    const out = await applyPaymentResult(o, paid({ orderRef: o.number, amount: o.total }), "montonio", deps);
    expect(out.status).toBe("paid");
    expect(out.giftShortfall).toBeUndefined();
  });
});
