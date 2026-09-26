/**
 * «Заказ отменён» for an order that WAS paid tells the truth about the money.
 *
 * Staging, 25.09.2026 (order-cancel, R-100078 and order-cancel-undo-set,
 * R-100087): both orders were paid, both were cancelled from the card, and
 * both customers were told «Деньги за него не списаны — платить ничего не
 * нужно … Деньги за этот заказ не списаны». The card's own confirm says the
 * opposite, and it is right: «Отменить заказ» moves no money — the refund is
 * the separate «Вернуть деньги» button (admCancelConfirmText in app.js, and
 * src/app/api/admin/orders/[id]/route.ts, which only moves the status).
 *
 * So the letter reads the money off the order: nothing came in → «не
 * списаны» (unchanged); money came in and has not all gone back → «мы вернём
 * … придёт отдельное письмо»; all of it is back → «уже возвращены».
 */
import { afterEach, describe, expect, it } from "vitest";
import { cancelMoneyOf, renderOrderCancelled } from "@/emails/order-cancelled";
import { setMailTextsOverride } from "@/emails/texts";

const BASE = {
  number: "R-100078",
  name: "Claude Test",
  email: "ord4@example.com",
  items: [{ title: "Очень классный — шампунь", qty: 1, price: 9, sum: 9 }],
  subtotal: 9,
  total: 12.49,
  status: "cancelled",
};
const PAID = { ...BASE, payment: { status: "paid", provider: "montonio", method: "bank", ref: "uuid-1", amount: 12.49 } };
const UNPAID = { ...BASE, payment: { status: "pending", provider: "montonio", method: "bank" } };

afterEach(() => setMailTextsOverride(null));

describe("«Заказ отменён» on a paid order", () => {
  it("R-100078: does not say the money was never taken — it says it comes back", () => {
    const ru = renderOrderCancelled(PAID, "ru", { kind: "cancelled" });
    for (const copy of [ru.text, ru.html]) {
      expect(copy).not.toContain("не списаны");
      expect(copy).not.toContain("платить ничего не нужно");
    }
    expect(ru.text).toContain("Заказ № R-100078 отменён. Деньги за него мы вернём — об этом придёт отдельное письмо.");
    expect(ru.text).toContain("Деньги за этот заказ мы вернём тем же путём, каким они пришли.");

    const et = renderOrderCancelled(PAID, "et", { kind: "cancelled" });
    expect(et.text).not.toContain("maha ei võetud");
    expect(et.text).toContain("Raha selle eest tagastame");

    const en = renderOrderCancelled(PAID, "en", { kind: "cancelled" });
    expect(en.text).not.toContain("Nothing was charged");
    expect(en.text).not.toContain("nothing to pay");
    expect(en.text).toContain("We will refund what you paid");
  });

  it("an order whose money is all back already says so", () => {
    const back = {
      ...PAID,
      payment: { ...PAID.payment, refunds: [{ ref: "r1", amount: 12.49, status: "done" }] },
    };
    const ru = renderOrderCancelled(back, "ru", { kind: "cancelled" });
    expect(ru.text).toContain("Деньги за этот заказ уже возвращены.");
    expect(ru.text).not.toContain("мы вернём");
    expect(ru.text).not.toContain("не списаны");
  });

  it("a refund that FAILED is money still owed", () => {
    const failed = {
      ...PAID,
      payment: { ...PAID.payment, refunds: [{ ref: "r1", amount: 12.49, status: "failed" }] },
    };
    expect(cancelMoneyOf(failed)).toBe("owed");
  });

  it("an unpaid order reads exactly as before", () => {
    const ru = renderOrderCancelled(UNPAID, "ru", { kind: "cancelled" });
    expect(ru.text).toContain("Деньги за него не списаны — платить ничего не нужно.");
    expect(ru.text).toContain("Деньги за этот заказ не списаны.");
    expect(renderOrderCancelled(BASE, "en", { kind: "cancelled" }).text).toContain("Nothing was charged");
  });

  it("which money state: from the payment, and from what the order was worth when the caller knows it", () => {
    expect(cancelMoneyOf(UNPAID)).toBe("none");
    expect(cancelMoneyOf(BASE)).toBe("none");
    expect(cancelMoneyOf(PAID)).toBe("owed");
    // money arrived and was too little: it is sitting in Montonio and goes back
    expect(cancelMoneyOf({ ...BASE, payment: { status: "pending", held: { got: 5, expected: 12.49 } } })).toBe("owed");
    // a gift card paid the lot: the total is 0, the card's value comes back
    const gift = { ...BASE, total: 0, payment: { status: "paid", provider: "none", method: "giftcard" } };
    expect(cancelMoneyOf(gift)).toBe("owed");
    expect(cancelMoneyOf({ ...gift, payment: { ...gift.payment, refunds: [{ ref: "gc:1", amount: 9, status: "done" }] } }, 9)).toBe("back");
    expect(cancelMoneyOf({ ...gift, payment: { ...gift.payment, refunds: [{ ref: "gc:1", amount: 4, status: "done" }] } }, 9)).toBe("owed");
    // a promo or points covered it: nothing was charged at all
    expect(cancelMoneyOf({ ...BASE, total: 0, payment: { status: "paid", provider: "none", method: "promo" } })).toBe("none");
    // the caller's figure wins over the letter's own reading
    expect(cancelMoneyOf(PAID, 20)).toBe("owed");
    expect(cancelMoneyOf({ ...PAID, payment: { ...PAID.payment, refunds: [{ ref: "r1", amount: 20, status: "done" }] } }, 20)).toBe("back");
  });

  it("the owner's own opening still wins; the money line under it is still true", () => {
    setMailTextsOverride({ "order-cancelled": { ru: { intro: "Ваш заказ {order} отменён по вашей просьбе." } } });
    const ru = renderOrderCancelled(PAID, "ru", { kind: "cancelled" });
    expect(ru.text).toContain("Ваш заказ R-100078 отменён по вашей просьбе.");
    expect(ru.text).toContain("Деньги за этот заказ мы вернём тем же путём, каким они пришли.");
  });
});

/* Dim, 26.09.2026, /test «order-refund-full»: the letter was right about the
   money and silent about the points. It now says what moved — and only when
   something did. */
describe("«Деньги возвращены» and the points", () => {
  const REFUNDED = { ...PAID, status: "refunded" };

  it("names both halves, in each language, in both copies", () => {
    const points = { back: 10, revoked: 3 };
    const ru = renderOrderCancelled(REFUNDED, "ru", { kind: "refunded", amount: 12.49, points });
    for (const copy of [ru.text, ru.html]) {
      expect(copy).toContain("Баллы, потраченные на этот заказ, вернули на ваш счёт: 10.");
      expect(copy).toContain("Баллы, начисленные за этот заказ, сняли: 3.");
    }
    const et = renderOrderCancelled(REFUNDED, "et", { kind: "refunded", amount: 12.49, points });
    expect(et.text).toContain("Sellele tellimusele kulutatud punktid tagastasime teie kontole: 10.");
    expect(et.text).toContain("Selle tellimuse eest saadud punktid võtsime tagasi: 3.");
    const en = renderOrderCancelled(REFUNDED, "en", { kind: "refunded", amount: 12.49, points });
    expect(en.text).toContain("The points you spent on this order are back in your account: 10.");
    expect(en.text).toContain("The points this order earned have been taken back: 3.");
  });

  it("says only the half that moved, and nothing when neither did", () => {
    const only = renderOrderCancelled(REFUNDED, "ru", { kind: "refunded", amount: 12.49, points: { back: 0, revoked: 4 } });
    expect(only.text).toContain("Баллы, начисленные за этот заказ, сняли: 4.");
    expect(only.text).not.toContain("вернули на ваш счёт");
    const none = renderOrderCancelled(REFUNDED, "ru", { kind: "refunded", amount: 12.49 });
    expect(none.text).not.toContain("Баллы");
  });

  it("promises nothing about points while the refund is only sent — they follow the money", () => {
    const sent = renderOrderCancelled(PAID, "ru", { kind: "refund_sent", amount: 12.49, points: { back: 10, revoked: 3 } });
    expect(sent.text).not.toContain("Баллы");
  });

  it("tells a cancelled order that points paid for that they are back", () => {
    const free = { ...BASE, total: 0, payment: { status: "paid", method: "points" } };
    const ru = renderOrderCancelled(free, "ru", { kind: "cancelled", points: { back: 25, revoked: 0 } });
    expect(ru.text).toContain("Баллы, потраченные на этот заказ, вернули на ваш счёт: 25.");
  });
});
