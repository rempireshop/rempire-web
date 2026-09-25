/**
 * The order card and the order lists in the owner's language — every word
 * about the money.
 *
 * Dim, /test checklist, checkout-lv-parcel (23.09.2026), panel in English:
 * «in panel the payment method and "paid" are written in Russian». The same
 * sentence came on 13.09.2026, and the fix then (payPiecesHTML) split the
 * glued «Банковская ссылка · Swedbank» / «Montonio · оплачен» into nodes of
 * their own. This file renders what the panel draws about a payment — the
 * «Оплата» block for every method × provider × status, the badge, the step
 * bar, «Изменить статус вручную», the rows of «Заказы» and of a customer's
 * card — and translates every text node the way translateTree() does
 * (public/shop2/app.js: a whole node is a key or a UI_RX rule, or it stays
 * Russian). Nothing Russian may be left in ET or EN.
 *
 * The functions are the panel's own, sliced out of app.js by source text and
 * run in a sandbox (tests/admin-composed-i18n.test.ts's technique), so a new
 * method, provider or status word that reaches the card without a
 * translation fails here by name.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

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
function sliceLiteral(marker: string, terminator: string): string {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${marker}`);
  const end = src.indexOf(terminator, at);
  return src.slice(at + marker.length, end + terminator.length).replace(/;\s*$/, "");
}

type Lang = "ET" | "EN";
type Rule = [RegExp, Record<Lang, string>];
const UI = runInNewContext("(" + sliceLiteral("var UI = ", "\n  };") + ")") as Record<Lang, Record<string, string>>;
const UI_RX = runInNewContext("(" + sliceLiteral("var UI_RX = ", "\n  ];") + ")") as Array<Rule | undefined>;
const CYR = /[А-Яа-яЁё]/;

/** trText() from app.js: an own key, else the first UI_RX rule, pieces looked up again. */
function trText(s: string, lang: Lang): string {
  const d = UI[lang];
  const own = (k: string) => (Object.prototype.hasOwnProperty.call(d, k) ? d[k] : "");
  if (own(s)) return own(s);
  for (const e of UI_RX) {
    if (!e) continue;
    const m = s.match(e[0]);
    if (m) return e[1][lang].replace(/\$(\d)/g, (_, n: string) => own(m[+n]) || m[+n] || "");
  }
  return s;
}

/** The text nodes a string of markup becomes, trimmed, the way translateTree() meets them. */
function textNodes(html: string): string[] {
  return html
    .split(/<[^>]*>/)
    .map((t) => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim())
    .filter(Boolean);
}

/** Everything the panel draws about an order's money, rendered in one go. */
function renderAll(lang: string): string {
  const code = `
    var S = { lang: ${JSON.stringify(lang)} };
    var PAY_METHOD_NAMES = ${sliceLiteral("var PAY_METHOD_NAMES = ", "};")};
    var PAY_PROVIDER_NAMES = ${sliceLiteral("var PAY_PROVIDER_NAMES = ", "};")};
    var SRV_STATES = ${sliceLiteral("var SRV_STATES = ", "};")};
    var SHIP_WORD = ${sliceLiteral("var SHIP_WORD = ", "};")};
    var POINT_KIND = { locker: "Пакомат", counter: "Пункт выдачи" };
    var PAYMETHODS = { banks: [{ code: "HABALV22", name: "Swedbank Latvia" }] };
    var BANK_CODES = ${sliceLiteral("var BANK_CODES = ", "};")};
    var BANK_NAMES_ABROAD = ${sliceLiteral("var BANK_NAMES_ABROAD = ", "};")};
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
    function pl(n, a, b, c) { return n === 1 ? a : n < 5 ? b : c; }
    function admRefundedTotal(p) { return p.refunded || 0; }
    function admRefunds(p) { return p.refunds || []; }
    function admRefundView(t) { return { value: t }; }
    function admRefundCode() { return "RMP-ABCD"; }
    function shortDate() { return "22.09"; }
    function admOrderById() { return null; }
    function admInvoiceOverdue() { return 0; }
    function admProdName(s) { return String(s); }
    // 1a: the «?» beside the payment number — its paragraph is a text node too
    var ADM_HELP = {};
    ${slice("admDomId")}
    ${slice("admHelpBtnHTML")}
    ${slice("admHelpHTML")}
    ${slice("admOrderShortDate")}
    ${slice("eur")}
    ${slice("payPiecesHTML")}
    ${slice("bankNameOf")}
    ${slice("admPaymentHTML")}
    ${slice("admPayRefHTML")}
    ${slice("admOrderBadge")}
    ${slice("admOrderSteps")}
    ${slice("admItemsLabel")}
    ${slice("admOrderRowBodyHTML")}
    ${slice("srvPointKind")}
    ${slice("srvShipLabel")}
    ${slice("admCustOrderRowHTML")}
    var out = [];
    // «Оплата»: every method × every provider × every status the server writes
    for (var m in PAY_METHOD_NAMES) for (var pr in PAY_PROVIDER_NAMES) {
      ["paid", "failed", "pending"].forEach(function (st) {
        out.push(admPaymentHTML({ total: 30, payment: { method: m, bank: "HABALV22", provider: pr, status: st, ref: "abc-123" } }));
      });
    }
    // …and the warnings and refund lines under it
    out.push(admPaymentHTML({ total: 30, payment: { method: "bank", provider: "montonio", status: "paid",
      amountMismatch: { got: 20, expected: 30 }, rejected: { status: "failed" }, repeat: { ref: "second" }, ref: "first",
      refunded: 12, refunds: [{ status: "failed", amount: 1 }, { status: "pending", amount: 2 }, { to: "giftcard", amount: 3 }] } }));
    out.push(admPaymentHTML({ total: 30, payment: { method: "card", provider: "montonio", status: "paid", held: { reason: "currency" } } }));
    out.push(admPaymentHTML({ total: 30, payment: { method: "bank", provider: "montonio", status: "pending", held: { got: 15, expected: 30 } } }));
    // the badge on a row and on the card
    [{ pos: true }, { held: true }, { invoice: {}, unpaid: true }, { invoice: {}, unpaid: true, overdue: 3 },
     { delivered: true }, { shipped: true }, { status: "paid" }, { status: "paid", labeled: true },
     { status: "cancelled" }, { status: "refunded" }, { status: "new" }, { status: "failed" }].forEach(function (v) {
      out.push(admOrderBadge(v, true)); out.push(admOrderBadge(v, false));
    });
    // the step bar
    [{ paid: true }, { paid: true, pickup: true }, { paid: true, labeled: true }, { shipped: true }, { shipped: true, labeled: true },
     { delivered: true }].forEach(function (v) { out.push(admOrderSteps(v)); });
    // «Изменить статус вручную» — one button per status word
    for (var k in SRV_STATES) out.push("<button>" + SRV_STATES[k][1] + "</button>");
    // a row of «Заказы» / «Обзор», with each kind of delivery on it
    [{ method: "parcel", pointName: "Rīga Origo" }, { method: "parcel", pointName: "Rīga", pointType: "counter" },
     { method: "courier" }, { method: "pickup" }, { method: "digital" }].forEach(function (sh) {
      out.push(admOrderRowBodyHTML({ number: "R-100042", date: "22.09.2026", who: "Mart Tamm", items: 2, ship: srvShipLabel(sh) }));
    });
    // a row of a customer's card
    ["new", "paid", "failed", "shipped", "delivered", "cancelled", "refunded"].forEach(function (st) {
      out.push(admCustOrderRowHTML({ id: 1, number: "R-100042", createdAt: "2026-09-22", itemsCount: 1, firstItem: "Davines OI", total: 30, status: st }));
    });
    out.join("\\n");
  `;
  return runInNewContext(code, {}) as string;
}

describe("the order card and lists: every word about the money in the panel's language", () => {
  for (const lang of ["EN", "ET"] as const) {
    it(`${lang}: nothing Russian is left after translation`, () => {
      const nodes = [...new Set(textNodes(renderAll(lang)).filter((t) => CYR.test(t)))];
      // the sweep reached the words the report was about
      // (1a: «Оплата» is no title of its own any more — it is «Доставка и оплата» on the card)
      expect(nodes).toEqual(expect.arrayContaining(["Банковская ссылка", "оплачен", "Оплачен", "Номер платежа в Montonio"]));
      const left = nodes.filter((t) => CYR.test(trText(t, lang)));
      expect(left).toEqual([]);
    });
  }

  it("names the method and the state in separate nodes, never glued to the bank or the provider", () => {
    const nodes = textNodes(renderAll("EN"));
    expect(nodes).toContain("Банковская ссылка");
    expect(nodes).toContain("Swedbank Latvia");
    expect(nodes).toContain("Montonio");
    expect(nodes).toContain("оплачен");
    expect(nodes.some((t) => /Банковская ссылка ·|· оплачен/.test(t))).toBe(false);
  });

  it("the English words are the ones the owner expects", () => {
    expect(trText("Банковская ссылка", "EN")).toBe("Bank link");
    expect(trText("Банковская карта", "EN")).toBe("Bank card");
    expect(trText("оплачен", "EN")).toBe("paid");
    expect(trText("не оплачен", "EN")).toBe("unpaid");
    expect(trText("ждёт оплаты", "EN")).toBe("awaiting payment");
    expect(trText("Оплачен", "EN")).toBe("Paid");
  });
});
