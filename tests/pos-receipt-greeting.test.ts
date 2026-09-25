/**
 * A salon sale with no name typed greets nobody by the till's placeholder.
 *
 * Staging, 25.09.2026 (pos-receipt, R-100081): the receipt letter opened
 * «Здравствуйте, Продажа в!» — and «Hello, Продажа в!» in English. createOrder()
 * stores a till sale the cashier typed no name for as «Продажа в салоне»
 * (src/lib/orders.ts), and customerName() took the first two words of it for
 * the greeting. Every letter such an order can get — the receipt, a refund —
 * now opens the way a letter with no name does: «Здравствуйте!».
 */
import { describe, expect, it } from "vitest";
import { customerName } from "@/emails/common";
import { renderOrderCancelled } from "@/emails/order-cancelled";
import { renderPosReceipt } from "@/emails/pos-receipt";
import { POS_NO_NAME } from "@/lib/pos-name";

const SALE = {
  number: "R-100081",
  channel: "pos",
  name: POS_NO_NAME,
  email: "buyer@example.com",
  items: [{ title: "Bio Botanical Shampoo", brand: "System 4", qty: 1, price: 9, sum: 9 }],
  subtotal: 9,
  total: 9,
};

describe("a salon sale without a name", () => {
  it("is stored under the till's placeholder", () => {
    expect(POS_NO_NAME).toBe("Продажа в салоне");
  });

  it("the receipt greets neutrally, in every language", () => {
    const ru = renderPosReceipt(SALE, "ru", { method: "terminal" });
    expect(ru.text).toContain("Здравствуйте! Спасибо за покупку!");
    expect(ru.text).not.toContain("Продажа в");
    expect(ru.html).not.toContain("Продажа в");

    const en = renderPosReceipt(SALE, "en", { method: "cash" });
    expect(en.text).toContain("Hello! Thank you for your purchase!");
    expect(en.text).not.toContain("Продажа");

    const et = renderPosReceipt(SALE, "et", { method: "cash" });
    expect(et.text).toContain("Tere! Aitäh ostu eest!");
    expect(et.text).not.toContain("Продажа");
  });

  it("so does any other letter the sale can get — a refund", () => {
    const mail = renderOrderCancelled(SALE, "ru", { kind: "refunded", amount: 9 });
    expect(mail.text).toContain("Здравствуйте!");
    expect(mail.text).not.toContain("Продажа в");
  });

  it("a name the cashier did type is still used", () => {
    const named = renderPosReceipt({ ...SALE, name: "Мария Тамм" }, "ru");
    expect(named.text).toContain("Здравствуйте, Мария Тамм!");
    expect(customerName({ name: "Мария Тамм" })).toBe("Мария Тамм");
  });

  it("customerName: the placeholder is no name, wherever it sits", () => {
    expect(customerName({ name: POS_NO_NAME })).toBe("");
    expect(customerName({ name: ` ${POS_NO_NAME} ` })).toBe("");
    expect(customerName({ customer_name: POS_NO_NAME, name: POS_NO_NAME })).toBe("");
    // …and a real name behind it still counts
    expect(customerName({ name: POS_NO_NAME, shipping: { name: "Mart Tamm" } })).toBe("Mart Tamm");
  });
});
