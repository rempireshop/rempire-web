/**
 * Four sentences the staging pass of 25.09.2026 caught saying something the
 * shop does not do.
 *
 *   1. The paid receipt of a SELF-PICKUP order (R-100083) promised «Когда
 *      посылку передадут перевозчику, пришлём трек-номер» — no parcel, no
 *      carrier. The receipt URL now says `d=pickup` and the screen promises a
 *      letter when the order can be collected.
 *   2. A gift-card checkout's name error said the name is printed «на посылке».
 *      There is no parcel: the name signs the card. (A self-pickup has none
 *      either: it is handed over by the name.)
 *   3. A gift-card-only order's «Заказ принят» (R-100084) said «мы его получили
 *      и уже собираем», «Способ получения: digital» and «напишем, когда
 *      передадим посылку в доставку».
 *   4. English «Обзор» read «1 orders · 0 in the salon».
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isDigitalOrder, renderOrderConfirmed } from "@/emails/order-confirmed";
import { setMailTextsOverride } from "@/emails/texts";
import { isPickupOrder, receiptUrl } from "@/lib/payments/receipt";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

function block(head: string): string {
  const start = src.indexOf(head);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has «${head}»`);
  const open = head.trimEnd().endsWith("[") ? "[" : "{";
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  for (let i = src.indexOf(open, start); i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced after «${head}» in app.js`);
}
const slice = (name: string) => block(`function ${name}(`);

afterEach(() => setMailTextsOverride(null));

/* ---------- 1. the receipt of a self-pickup ------------------------------- */

describe("the paid receipt of a self-pickup order", () => {
  it("the receipt URL says so — on a paid receipt only", () => {
    expect(receiptUrl("https://x", { number: "R-100083", state: "paid", total: 9, pickup: true }))
      .toBe("https://x/shop2/done/?n=R-100083&s=paid&t=9.00&d=pickup");
    expect(receiptUrl("https://x", { number: "R-100083", state: "paid", total: 9 })).not.toContain("d=");
    expect(receiptUrl("https://x", { number: "R-100083", state: "failed", pickup: true, orderId: "o" })).not.toContain("d=");
    expect(isPickupOrder({ shipping: { method: "pickup" } })).toBe(true);
    expect(isPickupOrder({ shipping: { method: "parcel" } })).toBe(false);
    expect(isPickupOrder(null)).toBe(false);
  });

  const doneFor = (search: string) =>
    new Function("S", "location", `
      function track() {} function doneDropHeld() {} function restoreHeldCart() {}
      function doneGiftCards() { return []; }
      ${slice("doneState")}
      ${slice("donePaidNote")}
      var d = doneState();
      return { pickup: d.pickup, note: donePaidNote(d) };
    `)({ done: null }, { search }) as { pickup: boolean; note: string };

  it("promises a letter when it can be collected, never a tracking number", () => {
    const pickup = doneFor("?n=R-100083&s=paid&t=9.00&d=pickup");
    expect(pickup.pickup).toBe(true);
    expect(pickup.note).toContain("Когда заказ можно будет забрать, мы напишем.");
    expect(pickup.note).not.toContain("трек-номер");

    // a parcel still gets its tracking number, and a gift card its own sentence
    expect(doneFor("?n=R-100073&s=paid&t=11.59").note).toContain("пришлём трек-номер");
    const gift = new Function(`${slice("donePaidNote")} return donePaidNote({ gift: [{}], pickup: true });`)() as string;
    expect(gift).toContain("Карта и код уже летят на почту");
    // only a paid receipt reads the flag
    expect(doneFor("?n=R-1&s=failed&d=pickup").pickup).toBe(false);
  });
});

/* ---------- 2. the name the checkout asks for ----------------------------- */

describe("the checkout's name error says what the name is for", () => {
  const msg = (method: string) =>
    new Function("S", `
      function shipMethod() { return ${JSON.stringify(method)}; }
      ${block("var SHIP_MSG = {")};
      ${slice("shipMsg")}
      return shipMsg("name");
    `)({ ship: { phone: "" } }) as string;

  it("a gift-card-only checkout: the name signs the card — there is no parcel", () => {
    expect(msg("digital")).toBe("Впишите имя и фамилию — ими подпишем подарочную карту.");
    expect(msg("digital")).not.toContain("посылк");
  });
  it("a self-pickup: the order is handed over by it", () => {
    expect(msg("pickup")).toBe("Впишите имя и фамилию — по ним выдадим заказ.");
  });
  it("a parcel: still printed on it", () => {
    expect(msg("parcel")).toBe("Впишите имя и фамилию — их напечатают на посылке.");
    expect(msg("courier")).toBe("Впишите имя и фамилию — их напечатают на посылке.");
  });
});

/* ---------- 3. «Заказ принят» for gift cards only ------------------------- */

describe("«Заказ принят» for an order of gift cards only", () => {
  const GIFT = {
    number: "R-100084",
    name: "Claude Test",
    email: "gift1@example.com",
    items: [{ id: "gift:25", kind: "gift", title: "Подарочная карта", qty: 1, price: 25, sum: 25 }],
    shipping: { method: "digital", country: "EE" },
    subtotal: 25,
    total: 25,
  };

  it("R-100084: nothing is being packed or posted", () => {
    const ru = renderOrderConfirmed(GIFT, "ru");
    for (const copy of [ru.text, ru.html]) {
      expect(copy).not.toContain("собираем");
      expect(copy).not.toContain("digital");
      expect(copy).not.toContain("передадим посылку");
    }
    expect(ru.text).toContain("Спасибо за заказ № R-100084 — мы его получили.");
    expect(ru.text).toContain("Электронная доставка");
    expect(ru.text).toContain("Подарочная карта приходит отдельным письмом");
    expect(ru.html).toContain("Подарочная карта приходит отдельным письмом.");

    const en = renderOrderConfirmed(GIFT, "en");
    expect(en.text).not.toContain("packing");
    expect(en.text).toContain("Electronic delivery");
    expect(en.text).toContain("The gift card arrives in a separate e-mail");

    const et = renderOrderConfirmed(GIFT, "et");
    expect(et.text).not.toContain("paneme selle kokku");
    expect(et.text).toContain("Kinkekaart tuleb eraldi kirjaga");
  });

  it("a card-only basket is digital even when the order does not say so", () => {
    expect(isDigitalOrder({ ...GIFT, shipping: { method: "pickup" } })).toBe(true);
    expect(isDigitalOrder({ items: [{ id: "gift:50" }] })).toBe(true);
    expect(isDigitalOrder({ items: [{ id: "gift:50", kind: "gift" }, { id: "p1", kind: "product" }] })).toBe(false);
    expect(isDigitalOrder({ items: [] })).toBe(false);
  });

  it("an order with goods reads as before, and the owner's own opening still wins", () => {
    const goods = { ...GIFT, items: [{ id: "p1", title: "Shampoo", qty: 1, price: 9, sum: 9 }], shipping: { method: "pickup" } };
    expect(renderOrderConfirmed(goods, "ru").text).toContain("мы его получили и уже собираем");

    setMailTextsOverride({ "order-confirmed": { ru: { intro: "Заказ {order} у нас." } } });
    expect(renderOrderConfirmed(GIFT, "ru").text).toContain("Заказ R-100084 у нас.");
  });
});

/* ---------- 4. «1 orders» ------------------------------------------------- */

describe("one order is «1 order»", () => {
  const tr = new Function("S", "LANG", `
    ${block("var UI = {")};
    ${block("var UI_RX = [")};
    ${slice("trName")}
    ${block("var TAIL_EXACT = {")};
    ${block("var NAME_TAILS = {")};
    ${block("var NAME_FRAGS = [")};
    ${slice("trText")}
    return trText(S, LANG, false);
  `) as (s: string, lang: string) => string;

  it("«Обзор»: 1 order · 0 in the salon", () => {
    expect(tr("1 заказ", "EN")).toBe("1 order");
    expect(tr("1 заказ", "ET")).toBe("1 tellimus");
    expect(tr("1 заказ · 0 в салоне", "EN")).toBe("1 order · 0 in the salon");
    expect(tr("1 заказ · 12 € в день", "EN")).toBe("1 order · 12 € per day");
  });

  it("every other number keeps its plural", () => {
    expect(tr("2 заказа", "EN")).toBe("2 orders");
    expect(tr("5 заказов", "ET")).toBe("5 tellimust");
    expect(tr("21 заказ", "EN")).toBe("21 orders");
    expect(tr("11 заказов · 3 в салоне", "EN")).toBe("11 orders · 3 in the salon");
    expect(tr("0 заказов", "EN")).toBe("0 orders");
  });
});
