/**
 * The gift-card and promo-code findings of the 14.09.2026 audit sweep, one
 * `it` per defect. Every one of these failed before the fix in the same
 * commit; each comment says what the shop used to do.
 *
 * Real Postgres (PGlite), the mock provider, fetch stubbed — the same rig
 * tests/payments-refund-giftcard.test.ts runs on.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import {
  getGiftCard,
  GIFT_MAX_QTY,
  issueGiftCards,
  redeemGiftCard,
} from "@/lib/giftcards";
import {
  claimOrderPaid,
  createOrder,
  getOrder,
  OrderError,
  setOrderStatus,
  type Order,
} from "@/lib/orders";
import { earnableSubtotal } from "@/lib/payments/apply";
import { mockSecret, signMockRefundTicket } from "@/lib/payments/mock";
import { settlePayment } from "@/lib/payments/settle";
import { upsertPromo, validatePromo } from "@/lib/promos";
import { adminCookieHeader, makeRequest, PRODUCT, setFuzzEnv } from "./fuzz-harness";
import { setupDb, teardownDb, truncateAll } from "./helpers";

const CUSTOMER = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };
const money = (n: number) => Math.round(n * 100) / 100;

let restoreEnv: () => void = () => {};
let seq = 0;

async function bankPaid(body: Record<string, unknown>): Promise<Order> {
  seq += 1;
  const order = await createOrder(body as Parameters<typeof createOrder>[0]);
  const out = await settlePayment(
    order,
    { orderRef: order.number, status: "paid", providerRef: `mock_r19_${seq}`, amount: order.total, currency: "EUR" },
    "mock",
  );
  expect(out.status).toBe("paid");
  return (await getOrder(order.id))!;
}

async function refundRoute(id: string, body: Record<string, unknown> = {}) {
  const { POST } = await import("@/app/api/admin/orders/[id]/refund/route");
  const res = await POST(
    makeRequest(`/api/admin/orders/${id}/refund/`, { method: "POST", body, cookie: adminCookieHeader() }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function refundWebhook(providerOrderRef: string, refundRef: string, amount: number) {
  const { POST } = await import("@/app/api/payments/notify/route");
  const token = signMockRefundTicket({ refundRef, providerOrderRef, amount, status: "done" }, mockSecret());
  return POST(makeRequest("/api/payments/notify/", { method: "POST", body: { mockRefundToken: token } }));
}

beforeAll(async () => {
  restoreEnv = setFuzzEnv();
  process.env.PAYMENT_PROVIDER = "mock";
  process.env.E2E_BOOTSTRAP = "1";
  delete process.env.RESEND_API_KEY;
  await setupDb();
});
afterAll(async () => {
  restoreEnv();
  await teardownDb();
});
beforeEach(async () => {
  await truncateAll();
  await query("truncate gift_card_uses, gift_cards restart identity cascade");
  await query("truncate promo_codes restart identity cascade");
});

/* ---------- 1. a promo code must not discount a gift card ---------------- */

describe("a promo code and a gift card in one basket", () => {
  const goods = { lang: "RU", customer: CUSTOMER, shipping: { method: "pickup", country: "EE" } };

  beforeEach(async () => {
    const v = validatePromo({ code: "SUVI10", kind: "percent", value: 10 });
    expect(v.ok).toBe(true);
    if (v.ok) await upsertPromo(v.value);
  });

  it("takes nothing off a basket that is only gift cards", async () => {
    /* «−10 %» on a 100 € card was ten euro of the shop's own money, handed
       over and repeatable for as long as the code lived: the card is still
       minted at its full face value on the paid transition. */
    const o = await createOrder({
      ...goods,
      items: [{ id: "gift:100", qty: 1 }],
      shipping: { method: "digital", country: "EE" },
      discountCode: "SUVI10",
    } as Parameters<typeof createOrder>[0]);
    expect(o.subtotal).toBe(100);
    expect(o.discount).toBe(0);
    expect(o.total).toBe(100);
  });

  it("takes its percent off the goods only, in a mixed basket", async () => {
    const o = await createOrder({
      ...goods,
      items: [{ id: "gift:100", qty: 1 }, { id: PRODUCT.id, qty: 1 }],
      discountCode: "SUVI10",
    } as Parameters<typeof createOrder>[0]);
    const line = o.items.find((l) => l.kind === "product")!;
    expect(o.discount).toBe(money(line.sum * 0.1));
    expect(o.discount).toBeLessThan(10); // and nothing from the card's 100 €
  });

  it("measures «Минимальный заказ» against the goods too", async () => {
    // a 40 € floor that a 100 € card used to clear on its own
    const v = validatePromo({ code: "BIG40", kind: "fixed", value: 5, minSubtotal: 40 });
    expect(v.ok).toBe(true);
    if (v.ok) await upsertPromo(v.value);
    const o = await createOrder({
      ...goods,
      items: [{ id: "gift:100", qty: 1 }],
      shipping: { method: "digital", country: "EE" },
      discountCode: "BIG40",
    } as Parameters<typeof createOrder>[0]);
    expect(o.discount).toBe(0);
  });
});

/* ---------- 2. «Сколько раз» typed as text ------------------------------ */

describe("the promo form's free-text numbers", () => {
  it("refuses «Сколько раз» that is not a number instead of saving «без ограничений»", () => {
    // NaN used to serialise to JSON null, and null meant «no limit at all»
    expect(validatePromo({ code: "A1", kind: "percent", value: 10, maxUses: "сто" }))
      .toEqual({ ok: false, error: "bad_uses" });
    expect(validatePromo({ code: "A1", kind: "percent", value: 10, maxUses: "5 раз" }))
      .toEqual({ ok: false, error: "bad_uses" });
    // an empty box still means «без ограничений» — that is what it looks like
    const blank = validatePromo({ code: "A1", kind: "percent", value: 10, maxUses: "  " });
    expect(blank.ok && blank.value.maxUses).toBe(null);
    const fifty = validatePromo({ code: "A1", kind: "percent", value: 10, maxUses: "50" });
    expect(fifty.ok && fifty.value.maxUses).toBe(50);
  });

  it("refuses «Минимальный заказ» that is not a number instead of saving «no floor»", () => {
    expect(validatePromo({ code: "A1", kind: "percent", value: 10, minSubtotal: "сорок" }))
      .toEqual({ ok: false, error: "bad_min" });
    const blank = validatePromo({ code: "A1", kind: "percent", value: 10, minSubtotal: "" });
    expect(blank.ok && blank.value.minSubtotal).toBe(0);
    const forty = validatePromo({ code: "A1", kind: "percent", value: 10, minSubtotal: "40,50" });
    expect(forty.ok && forty.value.minSubtotal).toBe(40.5);
  });
});

/* ---------- 4. a card debited twice for one order ----------------------- */

describe("redeemGiftCard is once per order", () => {
  beforeEach(async () => {
    await query("insert into gift_cards (code, amount, balance, lang) values ($1, 50, 50, 'RU')", ["RMP-ACDE-4679"]);
  });

  it("does not take the money a second time for the same order", async () => {
    const order = await createOrder({
      lang: "RU", items: [{ id: PRODUCT.id, qty: 1 }], customer: CUSTOMER,
      shipping: { method: "pickup", country: "EE" },
    });
    const first = await redeemGiftCard("RMP-ACDE-4679", 32, order.id);
    expect(first).toMatchObject({ ok: true, taken: 32, remaining: 18 });

    /* The retry: settleWithoutPayment() charges the card BEFORE anything
       durable is written, so a 503 from the write that follows — or a second
       tap on «Оплатить» — used to leave the card at 18 − 32, refused, and the
       shopper 32 € poorer for one order. */
    const again = await redeemGiftCard("RMP-ACDE-4679", 32, order.id);
    expect(again).toMatchObject({ ok: true, already: true, taken: 32 });
    expect((await getGiftCard("RMP-ACDE-4679"))!.balance).toBe(18);

    const rows = await query<{ n: string }>(
      "select count(*) as n from gift_card_uses where code = $1 and kind = 'redeem'",
      ["RMP-ACDE-4679"],
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it("still lets a DIFFERENT order spend what is left", async () => {
    const a = await createOrder({
      lang: "RU", items: [{ id: PRODUCT.id, qty: 1 }], customer: CUSTOMER,
      shipping: { method: "pickup", country: "EE" },
    });
    const b = await createOrder({
      lang: "RU", items: [{ id: PRODUCT.id, qty: 1 }], customer: CUSTOMER,
      shipping: { method: "pickup", country: "EE" },
    });
    expect((await redeemGiftCard("RMP-ACDE-4679", 30, a.id)).taken).toBe(30);
    expect((await redeemGiftCard("RMP-ACDE-4679", 20, b.id)).taken).toBe(20);
    expect((await getGiftCard("RMP-ACDE-4679"))!.balance).toBe(0);
  });

  it("writes the ledger row the refund reads, or takes nothing at all", async () => {
    // the row is inside the transaction now: a debit nothing can explain is
    // a debit no refund can ever put back
    const order = await createOrder({
      lang: "RU", items: [{ id: PRODUCT.id, qty: 1 }], customer: CUSTOMER,
      shipping: { method: "pickup", country: "EE" },
    });
    await redeemGiftCard("RMP-ACDE-4679", 10, order.id);
    const rows = await query<{ amount: string; order_id: string }>(
      "select amount, order_id from gift_card_uses where code = $1 and kind = 'redeem'",
      ["RMP-ACDE-4679"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].order_id).toBe(order.id);
  });
});

/* ---------- 5. two arrivals, one paid transition ------------------------ */

describe("the webhook and the shopper's return race each other", () => {
  const giftOrder = {
    lang: "RU",
    items: [{ id: "gift:50", qty: 1, meta: { email: "mari@example.com", name: "Mari" } }],
    customer: CUSTOMER,
    shipping: { method: "digital", country: "EE" },
  } as Parameters<typeof createOrder>[0];

  it("claimOrderPaid answers exactly one caller with the row it moved", async () => {
    // the winner gets the order back, the loser gets null (src/lib/orders.ts)
    const order = await createOrder(giftOrder);
    const won = await claimOrderPaid(order.id, "payment:mock");
    expect(won?.status).toBe("paid");
    expect(await claimOrderPaid(order.id, "payment:mock")).toBeNull();
    expect((await getOrder(order.id))!.status).toBe("paid");
  });

  it("never drags an order that is already «отправлен» back to «оплачен»", async () => {
    const order = await createOrder(giftOrder);
    await claimOrderPaid(order.id);
    await setOrderStatus(order.id, "shipped", "admin");
    expect(await claimOrderPaid(order.id, "payment:mock")).toBeNull();
    expect((await getOrder(order.id))!.status).toBe("shipped");
  });

  it("mints one set of codes when both arrive at once", async () => {
    /* Both read the order, both saw «не оплачен», both minted a full set:
       two live 50 € codes for one 50 € purchase, mailed twice. */
    const order = await createOrder(giftOrder);
    const result: VerifyLike = {
      orderRef: order.number, status: "paid", providerRef: "mock_race", amount: order.total, currency: "EUR",
    };
    const fresh = (await getOrder(order.id))!;
    await Promise.all([
      settlePayment(fresh, result, "mock"),
      settlePayment(fresh, result, "mock"),
    ]);
    const cards = await query<{ code: string }>("select code from gift_cards where order_id = $1", [order.id]);
    expect(cards).toHaveLength(1);
  });

  it("mints one set when the second arrival comes after the first", async () => {
    const order = await createOrder(giftOrder);
    const result: VerifyLike = {
      orderRef: order.number, status: "paid", providerRef: "mock_seq", amount: order.total, currency: "EUR",
    };
    await settlePayment((await getOrder(order.id))!, result, "mock");
    await settlePayment((await getOrder(order.id))!, result, "mock");
    const cards = await query<{ code: string }>("select code from gift_cards where order_id = $1", [order.id]);
    expect(cards).toHaveLength(1);
  });
});

type VerifyLike = Parameters<typeof settlePayment>[1];

/* ---------- 7. points are earned on goods, never on face value ---------- */

describe("what an order may earn points on", () => {
  it("leaves the gift cards out of the subtotal", () => {
    // 100 € card + 20 € of shampoo: the card's hundred is money the shop owes
    // back in full, and the goods it later buys earn on their own
    expect(earnableSubtotal({
      id: "x", number: "R-1", subtotal: 120,
      items: [
        { id: "gift:100", kind: "gift", qty: 1, sum: 100 },
        { id: "p", kind: "product", qty: 1, sum: 20 },
      ],
    })).toBe(20);
  });

  it("earns nothing at all on a basket of only cards", () => {
    expect(earnableSubtotal({
      id: "x", number: "R-1", subtotal: 100,
      items: [{ id: "gift:100", kind: "gift", qty: 2, sum: 100 }],
    })).toBe(0);
  });

  it("leaves an ordinary order exactly as it was", () => {
    expect(earnableSubtotal({
      id: "x", number: "R-1", subtotal: 42.5,
      items: [{ id: "p", kind: "product", qty: 1, sum: 42.5 }],
    })).toBe(42.5);
    // an order whose lines were not loaded keeps its own subtotal
    expect(earnableSubtotal({ id: "x", number: "R-1", subtotal: 42.5 })).toBe(42.5);
  });

  it("hands the paid transition the goods, not the face value", async () => {
    /* The call site, which used to pass order.subtotal straight through: a
       card bought for 100 € earned a hundred euro of points, and spending it
       earned them all over again — the same euro twice, for ever. */
    const { applyPaymentResult } = await import("@/lib/payments/apply");
    const seen: number[] = [];
    const order = {
      id: "11111111-1111-4111-8111-111111111111",
      number: "R-900001",
      status: "new",
      total: 120,
      subtotal: 120,
      customerId: "22222222-2222-4222-8222-222222222222",
      items: [
        { id: "gift:100", kind: "gift", qty: 1, sum: 100 },
        { id: "p", kind: "product", qty: 1, sum: 20 },
      ],
    };
    await applyPaymentResult(
      order,
      { orderRef: order.number, status: "paid", providerRef: "x", amount: 120, currency: "EUR" },
      "mock",
      {
        setOrderPayment: async () => null,
        // truthy = this call is the one that moved the row into paid, so the
        // once-per-order work below it runs (ApplyDeps.setOrderStatus)
        setOrderStatus: async () => ({ id: order.id, status: "paid" }),
        earnLoyaltyPoints: async (_c: string, _o: string, subtotal: number) => {
          seen.push(subtotal);
          return { ok: true, points: 0 };
        },
      },
    );
    expect(seen).toEqual([20]);
  });
});

/* ---------- 8. a gift line bigger than the mint limit ------------------- */

describe("how many cards one basket line may hold", () => {
  it("refuses a line the mint would silently cut down", async () => {
    /* 30 × 100 € was priced and charged at 3000 € and came back as twenty
       cards: 1000 € taken for nothing. */
    await expect(createOrder({
      lang: "RU", items: [{ id: "gift:100", qty: 30 }], customer: CUSTOMER,
      shipping: { method: "digital", country: "EE" },
    })).rejects.toMatchObject({ code: "gift_too_many" });
    expect(GIFT_MAX_QTY).toBe(20); // one limit, shared with issueGiftCards()
  });

  it("mints exactly as many cards as the biggest line it allows", async () => {
    const o = await createOrder({
      lang: "RU", items: [{ id: "gift:25", qty: GIFT_MAX_QTY }], customer: CUSTOMER,
      shipping: { method: "digital", country: "EE" },
    });
    expect(o.total).toBe(25 * GIFT_MAX_QTY);
    const cards = await issueGiftCards(o);
    expect(cards).toHaveLength(GIFT_MAX_QTY);
  });

  it("lets an ordinary product line go on up to 99", async () => {
    const o = await createOrder({
      lang: "RU", items: [{ id: PRODUCT.id, qty: 30 }], customer: CUSTOMER,
      shipping: { method: "pickup", country: "EE" },
    });
    expect(o.items[0].qty).toBe(30);
  });
});

/* ---------- 9. the refund that cannot reach the card -------------------- */

describe("an order paid with a card that has since been voided", () => {
  it("refuses before the bank half is sent, not after", async () => {
    // the order that SOLD the card
    const sale = await bankPaid({
      lang: "RU", items: [{ id: "gift:25", qty: 1 }], customer: CUSTOMER,
      shipping: { method: "digital", country: "EE" },
    });
    const [card] = await issueGiftCards(sale);
    expect(card.balance).toBe(25);

    // the order PAID with it — part card, part bank
    const spend = await bankPaid({
      lang: "RU", items: [{ id: PRODUCT.id, qty: 3 }], customer: CUSTOMER,
      shipping: { method: "pickup", country: "EE" }, discountCode: card.code,
    });
    expect(spend.discount).toBe(25);
    expect(spend.total).toBeGreaterThan(0);

    /* A refund made in Montonio's own portal — the door the admin's
       `gift_used` guard never sees — takes the sale back in full and voids
       the card with it (setOrderStatus → voidGiftCards). */
    await refundWebhook("mock_r19_1", "rf_r19_1", sale.total);
    expect((await getGiftCard(card.code))!.voidedAt).toBeTruthy();

    const before = await getOrder(spend.id);
    const out = await refundRoute(spend.id);
    expect(out.status).toBe(409);
    expect(out.body.error).toBe("gift_credit_failed");
    // and the money is still where it was: nothing was sent to the provider
    expect(out.body.moneyRefunded).toBe(0);
    const after = await getOrder(spend.id);
    expect((after!.payment as Record<string, unknown>).refundedTotal ?? 0)
      .toEqual((before!.payment as Record<string, unknown>).refundedTotal ?? 0);
    expect(after!.status).toBe(before!.status);
  });
});

/* ---------- the browser halves, sliced out of public/shop2/app.js ------- */

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

/** Run a slice of app.js over a stubbed state. No input is interpolated. */
function run<T>(body: string, S: unknown, extra: Record<string, unknown> = {}): T {
  const keys = Object.keys(extra);
  const fn = new Function("S", ...keys, body) as (s: unknown, ...a: unknown[]) => T;
  return fn(S, ...keys.map((k) => extra[k]));
}

describe("the storefront's own halves", () => {
  it("keeps a gift card out of what a promo code may discount", () => {
    // finding 1, browser side: cartSum() counts the card, promoGoods() does not
    const S = { cart: [{ type: "gift", id: "gift:100", qty: 1 }, { id: "p", qty: 2 }] };
    const out = run<{ goods: number; all: number }>(
      `${slice("promoGoods")}
       function lineUnit(l) { return l.type === "gift" ? 100 : 10; }
       function cartSum() { var s = 0; S.cart.forEach(function (l) { s += lineUnit(l) * l.qty; }); return s; }
       return { goods: promoGoods(), all: cartSum() };`,
      S,
    );
    expect(out.all).toBe(120);
    expect(out.goods).toBe(20);
  });

  it("sends the owner's typing to the server verbatim", () => {
    // finding 2, browser side: Math.trunc(Number("сто")) was NaN → JSON null
    const body = run<Record<string, unknown>>(
      `${slice("promoFormPayload")} return promoFormPayload();`,
      { promoForm: { code: "suvi10", kind: "percent", value: "10", minSubtotal: "сорок", endsAt: "", maxUses: "сто", note: "", active: true } },
    );
    expect(body.maxUses).toBe("сто");
    expect(body.minSubtotal).toBe("сорок");
    // …and the server is the one that refuses it
    expect(validatePromo(body)).toEqual({ ok: false, error: "bad_min" });
  });

  it("shows the sum the till came back with, until the basket moves", () => {
    // finding 3, browser side: the checkout used to redirect on its own figure
    const S = { billed: { from: 90, total: 100 }, cart: [] };
    const body = `${slice("localTotal")}${slice("total")}
       function cartSum() { return LOCAL; }
       function discount() { return 0; } function shipCost() { return 0; }
       function giftDiscount() { return 0; } function loyaltyDiscount() { return 0; }
       return total();`;
    expect(run<number>(body, S, { LOCAL: 90 })).toBe(100);
    // the shopper changed something: this screen's own arithmetic is honest again
    expect(run<number>(body, S, { LOCAL: 80 })).toBe(80);
    expect(run<number>(body, { billed: null }, { LOCAL: 90 })).toBe(90);
  });

  it("keeps each gift line's own recipient when the basket names two people", () => {
    // finding 6: both cards used to be issued and mailed to the first name
    const S = {
      cart: [
        { type: "gift", id: "gift:50", qty: 1, meta: { name: "Mari", email: "mari@example.com" } },
        { type: "gift", id: "gift:50", qty: 1, meta: { name: "Jaan", email: "jaan@example.com" } },
      ],
      giftTo: { name: "Mari", email: "mari@example.com", message: "", toMe: false },
      ship: { name: "Renat" },
    };
    const body = `${slice("giftLineWho")}${slice("giftRecipientsDiffer")}${slice("giftToGoverns")}${slice("lineMeta")}
       function isDigital() { return true; }
       function giftTo() { return S.giftTo; }
       return { differ: giftRecipientsDiffer(), a: lineMeta(S.cart[0]), b: lineMeta(S.cart[1]) };`;
    const out = run<{ differ: boolean; a: Record<string, string>; b: Record<string, string> }>(body, S);
    expect(out.differ).toBe(true);
    expect(out.a.email).toBe("mari@example.com");
    expect(out.b.email).toBe("jaan@example.com");
  });

  it("still lets the one form speak for a basket that agrees", () => {
    const S = {
      cart: [
        { type: "gift", id: "gift:50", qty: 1, meta: { name: "Mari", email: "mari@example.com" } },
        { type: "gift", id: "gift:25", qty: 1 },
      ],
      giftTo: { name: "Jaan", email: "jaan@example.com", message: "", toMe: false },
      ship: { name: "Renat" },
    };
    const body = `${slice("giftLineWho")}${slice("giftRecipientsDiffer")}${slice("giftToGoverns")}${slice("lineMeta")}
       function isDigital() { return true; }
       function giftTo() { return S.giftTo; }
       return { differ: giftRecipientsDiffer(), a: lineMeta(S.cart[0]), b: lineMeta(S.cart[1]) };`;
    const out = run<{ differ: boolean; a: Record<string, string>; b: Record<string, string> }>(body, S);
    expect(out.differ).toBe(false);
    // the later, more deliberate answer still wins for the whole order
    expect(out.a.email).toBe("jaan@example.com");
    expect(out.b.email).toBe("jaan@example.com");
  });
});
