/**
 * The refund card's amount box — what «Вернуть деньги» does with the number
 * typed into it, and what the card says about that number.
 *
 * Two holes, both in public/shop2/app.js (admin-functions map, defect 9,
 * 24.09.2026):
 *
 *   · «Вернуть деньги» cleared the pending action FIRST and asked about the
 *     amount after. An amount out of range (0, 60 on a 48 € order, a typo)
 *     got the toast «Проверьте сумму…» and nothing else: no render, so the
 *     card stayed on screen with the number in it and a «Вернуть деньги» that
 *     no longer had an action behind it. Every further press did nothing.
 *   · Typing a smaller amount repainted the sentence only on an order paid
 *     with a gift card. On every other order the card went on saying «Вернём
 *     48 € … товары вернутся на склад, заказ станет «возврат»» over a box
 *     that said 10 — and a partial refund does neither of those things
 *     (settleRefund moves the order and its shelf only once the refunds
 *     cover the whole of it).
 *
 * The click handler's «Применить» branch and the card's functions are cut out
 * of app.js by source text and run over stubs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

/** `<head> { … }` cut out of app.js by brace matching, `head` included. */
function block(head: string): string {
  const start = src.indexOf(head);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has «${head}»`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after «${head}» in app.js`);
}
const slice = (name: string) => block(`function ${name}(`);

type Answer = { status: number; body: Record<string, unknown> };
type Row = { id: string; number: string; who: string; refundable: number; refunded: number; refund?: { gift: number; money: number } };

const ROW: Row = { id: "ord-1", number: "R-100042", who: "Mart Tamm", refundable: 48, refunded: 0, refund: { gift: 0, money: 48 } };

function card(row: Row = ROW) {
  const sent: Array<{ url: string; body: unknown }> = [];
  const toasts: string[] = [];
  let renders = 0;
  const box = { value: "48.00" };
  const detail = { textContent: "", innerHTML: "", parentElement: null };
  const document = {
    querySelector: (sel: string) => (sel === "[data-admrefundamt]" ? box : sel === ".adm-confirm__d" ? detail : null),
  };
  const body = `
    var pendingAction = null;
    function eur(n) { var v = (Math.round(n * 100) / 100).toFixed(2); return v.replace(".", ",").replace(",00", "") + " €"; }
    function esc(s) { return String(s == null ? "" : s); }
    function admOrderById(id) { return id === ROW.id ? ROW : null; }
    function translateTree() {}
    function refocus() {}
    function journalNote() {}
    function admOrdersChanged() {}
    function srvMsg() { return ""; }
    function admRefundCode() { return ""; }
    ${block("var REFUND_ERR = {")};
    ${slice("admPiecesHTML")}
    ${slice("admDetailHTML")}
    ${slice("admRefundConfirmText")}
    ${slice("admRefundRepaint")}
    ${slice("admRefundAmount")}
    ${slice("admRefundApply")}
    ${slice("srvOrderRefund")}
    function apply(d) { ${block("if (d.admapply !== undefined) {")} }
    return {
      open: function (pa) { pendingAction = pa; },
      pending: function () { return pendingAction; },
      apply: function () { apply({ admapply: "" }); },
      text: admRefundConfirmText,
      repaint: admRefundRepaint,
    };
  `;
  const fns = new Function("S", "SRV", "ROW", "document", "apiSend", "render", "toast", body)(
    { lang: "RU" }, { admin: true, refundBusy: false }, row, document,
    (url: string, _m: string, b: unknown) => { sent.push({ url, body: b }); return new Promise<Answer>(() => {}); },
    () => { renders++; }, (m: string) => toasts.push(m),
  ) as {
    open: (pa: unknown) => void; pending: () => unknown; apply: () => void;
    text: (v: Row, typed?: number) => string; repaint: (typed: string) => void;
  };
  const pa = {
    type: "order_refund", overlay: true, danger: true, id: row.id, number: row.number,
    amount: row.refundable.toFixed(2), title: "Вернуть деньги?", detail: "", ok: "Вернуть деньги",
  };
  return { ...fns, pa, box, detail, sent, toasts, renders: () => renders };
}

describe("«Вернуть деньги» with an amount the server would refuse", () => {
  for (const typed of ["60", "0", "", "abc"]) {
    it(`keeps the card working with «${typed}» in the box`, () => {
      const c = card();
      c.open(c.pa);
      c.box.value = typed;
      c.apply();
      expect(c.sent, "the refund went out").toEqual([]);
      expect(c.toasts).toEqual(["Проверьте сумму — вернуть можно не больше остатка."]);
      expect(c.pending(), "the card is on screen with no action behind its button").toBe(c.pa);
    });
  }

  it("a fixed amount then goes through, and the card closes", () => {
    const c = card();
    c.open(c.pa);
    c.box.value = "60";
    c.apply();
    c.box.value = "10,50";
    c.apply();
    expect(c.sent).toEqual([{ url: "/api/admin/orders/ord-1/refund/", body: { amount: 10.5 } }]);
    expect(c.pending()).toBeNull();
    expect(c.renders(), "nothing redrew the screen, so the card stayed up").toBeGreaterThan(0);
  });

  it("the whole amount, as prefilled, goes through at once", () => {
    const c = card();
    c.open(c.pa);
    c.apply();
    expect(c.sent).toEqual([{ url: "/api/admin/orders/ord-1/refund/", body: { amount: 48 } }]);
    expect(c.pending()).toBeNull();
  });
});

describe("The card's sentence follows the amount on every order", () => {
  it("the whole amount: the order becomes «возврат» and the goods go back", () => {
    const c = card();
    for (const t of [c.text(ROW), c.text(ROW, 48)]) {
      expect(t).toContain("Вернём 48 € через Montonio");
      expect(t).toContain("товары вернутся на склад, заказ станет «возврат»");
    }
  });

  it("a part: says how much of what, and that the order and the shelf stay as they are", () => {
    const t = card().text(ROW, 10);
    expect(t).toBe("R-100042 · Mart Tamm\nВернём 10 € из 48 € через Montonio — тем же путём, каким деньги пришли. Клиенту уйдёт письмо, статус заказа и склад не изменятся.");
  });

  it("a part of what is left after an earlier refund", () => {
    const row = { ...ROW, refundable: 38, refunded: 10, refund: { gift: 0, money: 38 } };
    expect(card(row).text(row, 5)).toBe("R-100042 · Mart Tamm\nПо заказу уже возвращено 10 €. Вернём ещё 5 € из оставшихся 38 € через Montonio — тем же путём, каким деньги пришли. Клиенту уйдёт письмо, статус заказа и склад не изменятся.");
    // …and the rest of it is the sentence it always was
    expect(card(row).text(row, 38)).toContain("Осталось 38 € — деньги уйдут через Montonio");
  });

  it("typing a smaller amount repaints the card on an order with no gift card", () => {
    const c = card();
    c.open(c.pa);
    c.detail.textContent = c.text(ROW);
    c.repaint("12");
    expect(c.detail.innerHTML, "the card still says the whole 48 € goes back").toContain("<span>Вернём 12 € из 48 €");
  });

  it("the gift-card split still follows the box, as before", () => {
    const row = { ...ROW, refund: { gift: 20, money: 28 } };
    expect(card(row).text(row, 30)).toContain("Вернём на подарочную карту: 20 € · на счёт покупателя: 10 €");
  });
});

/* order-refund-retry e4 (staging, 26.09.2026, R-100092): an order paid by a
   gift card, 4 € of its 9 € already back on the card. A freshly opened
   «Вернуть деньги» said only «Вернём на подарочную карту: 5 € · на счёт
   покупателя: 0 €» — the gift-card branch returned before the «По заказу уже
   возвращено …» wording, which only the Montonio sentences carried. Every
   path says it now, on a line of its own under the order. */
describe("The card says what is already back, on every payment path", () => {
  const ALREADY = "По заказу уже возвращено 4 €, осталось 5 €.";

  it("a gift-card order", () => {
    const row = { ...ROW, refundable: 5, refunded: 4, refund: { gift: 5, money: 0 } };
    expect(card(row).text(row)).toBe(
      "R-100042 · Mart Tamm\n" + ALREADY +
      "\nВернём на подарочную карту: 5 € · на счёт покупателя: 0 €\nКартой снова можно будет платить. Клиенту уйдёт письмо.");
    // …and a part of it typed into the box keeps the line
    expect(card(row).text(row, 2).split("\n")[1]).toBe(ALREADY);
  });

  it("an order paid partly by a gift card", () => {
    const row = { ...ROW, refundable: 5, refunded: 4, refund: { gift: 2, money: 3 } };
    const lines = card(row).text(row).split("\n");
    expect(lines[1]).toBe(ALREADY);
    expect(lines[2]).toBe("Вернём на подарочную карту: 2 € · на счёт покупателя: 3 €");
  });

  it("Montonio keeps its own sentence, and a first refund says nothing of the kind", () => {
    const row = { ...ROW, refundable: 5, refunded: 4, refund: { gift: 0, money: 5 } };
    expect(card(row).text(row)).toContain("По заказу уже возвращено 4 €. Осталось 5 €");
    const fresh = { ...ROW, refundable: 9, refunded: 0, refund: { gift: 9, money: 0 } };
    expect(card(fresh).text(fresh)).not.toContain("уже возвращено");
  });
});
