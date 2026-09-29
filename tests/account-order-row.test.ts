/**
 * «Мой кабинет → Мои заказы», the row itself (Dim, 28.09.2026): the parcel in
 * words beside «Отследить», «Скачать чек (PDF)» on the documents line, and
 * the order's details behind «Подробнее о заказе» — a real <button> with
 * aria-expanded, opening in place.
 *
 * The storefront's own functions are sliced out of public/shop2/app.js and
 * run over stubs, the idiom of tests/loyalty-lines.test.ts. What is pinned:
 *
 *   · the closed row keeps everything it had — and nothing of the details is
 *     in the page until the row is opened (the e2e suites look for an order's
 *     number and status by text, and a hidden copy would be a second match);
 *   · every sentence is its own text node, the only shape translateTree()
 *     can put into Estonian or English — and every one of them is in both
 *     dictionaries;
 *   · the customer's own text (names, a point, an address) is escaped.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8").replace(/\r\n/g, "\n");

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

type Order = Record<string, unknown>;
type Shop = {
  row: (o: Order) => string;
  parcel: (o: Order) => string;
  details: (o: Order) => string;
  open: Record<string, boolean>;
  S: { lang: string; acctReturnBusy: string };
};

function makeShop(): Shop {
  // This repository's own source plus fixed stub text — no outside input.
  return new Function(
    `
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
    function shortDate(iso) { return String(iso).slice(8, 10) + "." + String(iso).slice(5, 7) + "." + String(iso).slice(0, 4); }
    function eur(n) { return String(n).replace(".", ",") + " €"; }
    function bankNameOf(code) { return code === "LHVBEE22" ? "LHV" : code; }
    var S = { acctReturnBusy: "", lang: "RU" };
    var ACCT_ORDER_STATE = { paid: ["оплачен", "chip--ok"], shipped: ["отправлен", "chip--ok"], delivered: ["доставлен", "chip--ok"], refunded: ["возврат", "chip--low"], "new": ["принят", "chip--low"] };
    var acctOrderOpen = {};
    ${slice("acctOrderDomId")}
    ${slice("acctParcelHTML")}
    ${slice("acctPayHTML")}
    ${slice("acctOrderDetailsHTML")}
    ${slice("acctOrderMoreHTML")}
    ${slice("acctOrderRow")}
    return { row: acctOrderRow, parcel: acctParcelHTML, details: acctOrderDetailsHTML, open: acctOrderOpen, S: S };
  `,
  )() as Shop;
}

const LOCKER_DELIVERY = { method: "parcel", place: "locker", carrier: "Omniva", point: "Kristiine keskus", address: null, price: 3.19 };
const DETAILS = {
  delivery: LOCKER_DELIVERY,
  promo: { code: "SUVI5", amount: 5 },
  giftCard: null,
  points: 0,
  payment: { method: "bank", bank: "Swedbank" },
  refunds: [],
};
const ORDER: Order = {
  number: "R-100042",
  status: "shipped",
  total: 52.19,
  createdAt: "2026-09-12T10:00:00.000Z",
  items: [{ title: "Kevin.Murphy Fresh.Hair", variant: "250 мл", qty: 2, price: 27, sum: 54 }],
  tracking: "CE123456789EE",
  trackingUrl: "https://www.omniva.ee/track/CE123456789EE",
  parcel: { carrier: "Omniva", place: "locker", point: "Kristiine keskus", city: null, state: "inTransit" },
  details: DETAILS,
  receipt: { pdfUrl: "/api/account/orders/R-100042/receipt/" },
  giftCards: [],
  invoice: null,
  refunded: 0,
  refundPending: 0,
};

/** Text nodes as the browser would split them — what translateTree() gets to see. */
function textNodes(html: string): string[] {
  return html
    .replace(/<[^>]+>/g, "\u0000")
    .split("\u0000")
    .map((s) => s.trim())
    .filter((s) => s && /[А-Яа-яЁё]/.test(s));
}

describe("the parcel, in words, beside «Отследить»", () => {
  it("names the carrier, the machine and where the parcel is", () => {
    const html = makeShop().row(ORDER);
    expect(html).toContain('class="link rowcard__act" href="https://www.omniva.ee/track/CE123456789EE"');
    expect(html).toMatch(/<span class="rowcard__parcel">.*Omniva.*Kristiine keskus.*<span class="rowcard__pstate">в пути<\/span>/);
  });

  it("says a parcel waits in a machine — and where the pick-up code came from", () => {
    const shop = makeShop();
    const html = shop.parcel({ ...ORDER, parcel: { carrier: "Omniva", place: "locker", point: "Kristiine keskus", city: null, state: "awaitingCollection" } });
    expect(html).toContain(">ждёт в пакомате<");
    expect(html).toContain(">Код для получения пришёл от перевозчика по SMS или e-mail.<");
    const counter = shop.parcel({ ...ORDER, parcel: { carrier: "DPD", place: "counter", point: "Rimi", city: null, state: "awaitingCollection" } });
    expect(counter).toContain(">ждёт в пункте выдачи<");
    expect(counter).not.toContain("пакомате");
  });

  it("gives a courier parcel «Курьер» and the city, and says «получена» and «возвращается в магазин»", () => {
    const shop = makeShop();
    const courier = shop.parcel({ ...ORDER, parcel: { carrier: "DPD", place: "courier", point: null, city: "Tallinn", state: "delivered" } });
    expect(courier).toContain(">DPD<");
    expect(courier).toContain(">Курьер<");
    expect(courier).toContain(">Tallinn<");
    expect(courier).toContain(">получена<");
    const back = shop.parcel({ ...ORDER, parcel: { carrier: "Omniva", place: "locker", point: "X", city: null, state: "returned" } });
    expect(back).toContain(">возвращается в магазин<");
  });

  it("has no state word for a status the server did not name, and no line at all without a parcel", () => {
    const shop = makeShop();
    const none = shop.parcel({ ...ORDER, parcel: { carrier: "Omniva", place: "locker", point: "Kristiine keskus", city: null, state: null } });
    expect(none).toContain("Kristiine keskus");
    expect(none).not.toContain("rowcard__pstate");
    expect(shop.row({ ...ORDER, parcel: null })).not.toContain("rowcard__parcel");
  });

  it("keeps a point's own name out of the translator and escapes it", () => {
    const html = makeShop().parcel({ ...ORDER, parcel: { carrier: "Nova Post", place: "locker", point: '<img src=x onerror="1">', city: null, state: "inTransit" } });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;1&quot;&gt;");
    expect(html).toMatch(/<span data-notr>&lt;img/);
  });
});

describe("«Скачать чек (PDF)»", () => {
  it("is on the documents line, in the page's language", () => {
    const shop = makeShop();
    shop.S.lang = "ET";
    const html = shop.row(ORDER);
    expect(html).toContain(
      '<span class="rowcard__gifts"><a class="link" href="/api/account/orders/R-100042/receipt/?lang=et" target="_blank" rel="noopener" data-receiptpdf="R-100042"><span>Скачать чек (PDF)</span></a></span>',
    );
  });

  it("is not on an order the server gave no receipt", () => {
    const html = makeShop().row({ ...ORDER, receipt: null });
    expect(html).not.toContain("data-receiptpdf");
    expect(html).not.toContain("Скачать чек");
  });

  it("sits beside a gift card's link on the same line", () => {
    const html = makeShop().row({ ...ORDER, giftCards: [{ code: "RMP-AAAA-BBBB", amount: 50, pdfUrl: "/api/giftcards/RMP-AAAA-BBBB/pdf/?t=x" }] });
    expect(html).toMatch(/<span class="rowcard__gifts"><a [^>]*data-giftpdf="RMP-AAAA-BBBB">.*<\/a><a [^>]*data-receiptpdf="R-100042">/);
  });
});

describe("«Подробнее о заказе» — the row opens in place", () => {
  it("is a real button that says it is closed, and nothing of the details is on the page yet", () => {
    const html = makeShop().row(ORDER);
    expect(html).toContain(
      '<button type="button" class="rowcard__more" data-acctorder="R-100042" aria-expanded="false" aria-controls="acctod-R-100042" aria-describedby="acctno-R-100042"><span>Подробнее о заказе</span></button>',
    );
    expect(html).toContain('<div class="rowcard__det" id="acctod-R-100042" hidden></div>');
    expect(html).toContain('<span class="num rowcard__id" id="acctno-R-100042">R-100042</span>');
    // the number once, and none of the opened row's figures
    expect(html.split("R-100042<").length - 1).toBe(1);
    expect(html).not.toContain("27 €");
    expect(html).not.toContain("SUVI5");
  });

  it("keeps the closed row as it was: status, number, date, total, items, «Отследить»", () => {
    const html = makeShop().row(ORDER);
    expect(html).toContain('<span class="chip chip--ok">отправлен</span>');
    expect(html).toContain("12.09.2026 · 52,19 €");
    expect(html).toContain('<span class="muted rowcard__what">Kevin.Murphy Fresh.Hair ×2</span>');
    expect(html).toContain(">Отследить</a>");
    expect(html).toMatch(/^<div class="rowcard" data-acctrow="R-100042">/);
  });

  it("opened, shows the items at the prices paid, the delivery, the code, the total and how it was paid", () => {
    const shop = makeShop();
    shop.open["R-100042"] = true;
    const html = shop.row(ORDER);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('<div class="rowcard__det" id="acctod-R-100042">');
    expect(html).not.toContain("hidden>");
    // the line: name, size, quantity × unit, line total
    // the name a node of its own inside .cosum__nm, so trName() can put its type tail into ET/EN
    expect(html).toContain('<span class="cosum__nm"><span>Kevin.Murphy Fresh.Hair</span> · <span>250 мл</span>');
    expect(html).toContain("<span>250 мл</span>");
    expect(html).toContain("2 × 27 €");
    expect(html).toContain('<span class="num cosum__pr">54 €</span>');
    // the code and what it took off
    expect(html).toContain("<span>Промокод</span>");
    expect(html).toContain("SUVI5");
    expect(html).toContain("−5 €");
    // the delivery, its price and where it went
    expect(html).toContain("<span>Доставка</span>");
    expect(html).toContain("3,19 €");
    expect(html).toContain("<span>Пакомат</span>");
    expect(html).toContain("<span data-notr>Kristiine keskus</span>");
    // the total, as the checkout's summary prints it
    expect(html).toContain('<div class="cosum__row cosum__row--tot"><span>Итого</span><span class="num">52,19 €</span></div>');
    // how it was paid
    expect(html).toContain("<span>Оплата</span>");
    expect(html).toContain("<span>Банковская ссылка</span>");
    expect(html).toContain("<span data-notr>Swedbank</span>");
  });

  it("says nothing twice once the parcel line and the details are both on screen (Dim, 29.09.2026)", () => {
    const shop = makeShop();
    const locker = {
      ...ORDER,
      parcel: { carrier: "DPD", place: "locker", point: "Automaat Tallinna Narva mnt Selver", city: null, state: "inTransit" },
      details: { ...DETAILS, delivery: { method: "parcel", place: "locker", carrier: "DPD", point: "Automaat Tallinna Narva mnt Selver", address: null, price: 2.59 } },
    };
    // the details name the method and the price; carrier and machine are in the parcel line above
    const det = shop.details(locker);
    expect(det).toContain("<span>Пакомат</span>");
    expect(det).not.toContain("<span data-notr>DPD</span>");
    expect(det).not.toContain("Automaat Tallinna Narva mnt Selver");
    expect(shop.parcel(locker)).toContain("Automaat Tallinna Narva mnt Selver");
    // a courier's full address stays: the parcel line names only the city
    const courier = {
      ...locker,
      parcel: { carrier: "DPD", place: "courier", point: null, city: "Tallinn", state: "inTransit" },
      details: { ...DETAILS, delivery: { method: "courier", place: null, carrier: "DPD", point: null, address: "Testitänav 1, 10111, Tallinn", price: 4 } },
    };
    expect(shop.details(courier)).toContain("Testitänav 1, 10111, Tallinn");
    expect(shop.details(courier)).not.toContain("<span data-notr>DPD</span>");
    // closed, the items' one-line summary is there; open, the details list them and the summary goes
    expect(shop.row(locker)).toContain("rowcard__what");
    shop.open["R-100042"] = true; // ORDER.number
    expect(shop.row(locker)).not.toContain("rowcard__what");
    expect(shop.row(locker)).toContain("Kevin.Murphy Fresh.Hair");
  });

  it("names a gift card, points, a free courier delivery, a card payment and every kind of refund", () => {
    const html = makeShop().details({
      ...ORDER,
      // not yet on its way: no parcel line above, so the details name the carrier themselves
      parcel: null,
      details: {
        delivery: { method: "courier", place: null, carrier: "DPD", point: null, address: "Testitänav 1, 10111, Tallinn", price: 0 },
        promo: null,
        giftCard: { code: "RMP-••••-4679", amount: 20 },
        points: 4,
        payment: { method: "card", bank: null },
        refunds: [
          { amount: 10, status: "done", toGiftCard: false, at: "2026-09-15T10:00:00.000Z" },
          { amount: 7, status: "done", toGiftCard: true, at: "2026-09-16T10:00:00.000Z" },
          { amount: 5, status: "pending", toGiftCard: false, at: "2026-09-17T10:00:00.000Z" },
        ],
      },
    });
    expect(html).toContain("<span>Подарочная карта</span>");
    expect(html).toContain("RMP-••••-4679");
    expect(html).toContain("−20 €");
    expect(html).toContain("<span>Баллы</span>");
    expect(html).toContain("−4 €");
    expect(html).toContain("<span>Бесплатно</span>");
    expect(html).toContain("<span>Курьер</span>");
    expect(html).toContain("<span data-notr>DPD</span>");
    expect(html).toContain("<span data-notr>Testitänav 1, 10111, Tallinn</span>");
    expect(html).toContain("<span>Банковская карта</span>");
    expect(html).toContain("<span>Возвращено</span>");
    expect(html).toContain("15.09.2026");
    expect(html).toContain("<span>Возвращено на подарочную карту</span>");
    expect(html).toContain("<span>Возврат отправлен</span>");
    expect(html).toContain("−10 €");
    expect(html).toContain("−7 €");
    expect(html).toContain("−5 €");
  });

  it("names a pickup, an e-mailed gift card, an invoice, the till, and a bank known only by its BIC", () => {
    const shop = makeShop();
    const d = (over: Record<string, unknown>) => shop.details({ ...ORDER, details: { ...DETAILS, promo: null, ...over } });
    expect(d({ delivery: { method: "pickup", place: null, carrier: null, point: null, address: null, price: 0 } })).toContain("<span>Самовывоз</span>");
    const digital = d({ delivery: { method: "digital", place: null, carrier: null, point: null, address: null, price: 0 } });
    expect(digital).toContain("<span>Электронная доставка</span>");
    expect(d({ payment: { method: "invoice", bank: null } })).toContain("<span>По счёту</span>");
    expect(d({ payment: { method: "cash", bank: null } })).toContain("<span>Наличные</span>");
    expect(d({ payment: { method: "wallet", bank: null } })).toContain("<span>Apple Pay / Google Pay</span>");
    expect(d({ payment: { method: "bank", bank: "LHVBEE22" } })).toContain("<span data-notr>LHV</span>");
    expect(d({ delivery: { ...LOCKER_DELIVERY, place: "counter" } })).toContain("<span>Пункт выдачи</span>");
    expect(d({ payment: null })).not.toContain("Оплата");
    // a promo with no code — the till's percent — is a discount, not a code
    expect(d({ promo: { code: null, amount: 3 } })).toContain("<span>Скидка</span>");
  });

  it("escapes what the customer and the catalogue wrote", () => {
    const shop = makeShop();
    shop.open["R-100042"] = true;
    const html = shop.row({
      ...ORDER,
      items: [{ title: '<script>x</script>', variant: '"><b>', qty: 1, price: 1, sum: 1 }],
      details: { ...DETAILS, delivery: { ...LOCKER_DELIVERY, point: "<i>p</i>" }, promo: { code: "<b>", amount: 1 } },
    });
    expect(html).not.toMatch(/<script>|<b>|<i>/);
  });

  it("puts every Russian sentence in a node of its own, and every one is in both dictionaries", () => {
    const shop = makeShop();
    shop.open["R-100042"] = true;
    const all = [
      shop.row(ORDER),
      shop.parcel({ ...ORDER, parcel: { carrier: "Omniva", place: "locker", point: "P", city: null, state: "awaitingCollection" } }),
      shop.parcel({ ...ORDER, parcel: { carrier: "DPD", place: "counter", point: "P", city: null, state: "awaitingCollection" } }),
      shop.parcel({ ...ORDER, parcel: { carrier: "DPD", place: "courier", point: null, city: "Tallinn", state: "delivered" } }),
      shop.parcel({ ...ORDER, parcel: { carrier: "DPD", place: "courier", point: null, city: "Tallinn", state: "returned" } }),
      shop.details({
        ...ORDER,
        details: {
          ...DETAILS,
          promo: { code: null, amount: 1 },
          giftCard: { code: "RMP-••••-1", amount: 1 },
          points: 1,
          refunds: [
            { amount: 1, status: "done", toGiftCard: false, at: null },
            { amount: 1, status: "done", toGiftCard: true, at: null },
            { amount: 1, status: "pending", toGiftCard: false, at: null },
          ],
        },
      }),
    ].join("");
    const ui = src.slice(src.indexOf("var UI = {"), src.indexOf("var UI_RX = ["));
    const et = ui.slice(0, ui.indexOf("\n    EN: {"));
    const en = ui.slice(ui.indexOf("\n    EN: {"));
    // product names and sizes are the catalogue's, translated by their own rules (NAME_CTX, «250 мл»)
    const own = new Set(["Kevin.Murphy Fresh.Hair", "250 мл", "Kevin.Murphy Fresh.Hair ×2"]);
    for (const text of new Set(textNodes(all))) {
      if (own.has(text)) continue;
      expect(et, `ET has no «${text}»`).toContain(`"${text}":`);
      expect(en, `EN has no «${text}»`).toContain(`"${text}":`);
    }
  });
});
