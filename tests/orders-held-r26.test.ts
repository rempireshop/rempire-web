/**
 * An order somebody paid too little for, and where the panel says so.
 *
 * Since 18.09.2026 a short payment is HELD: no stock moves, no gift card is
 * minted, no letter goes, and `payment.held` is written onto the order. The
 * order deliberately keeps the status «новый», because nothing has been
 * fulfilled — and that is exactly what hid it. On «Заказы» it sat in «Все»
 * behind the badge «Ждёт оплаты», indistinguishable from a checkout somebody
 * abandoned, and the two warnings about it were inside the card.
 *
 * Dim, 19.09.2026, testing `order-paid-short`: «There is no warning - it's
 * grouped under "all" orders and there's just text "awaiting payment". When
 * opening the order then somewhere written in grey: … Needs better UI/UX.»
 *
 * So three things are pinned here — the badge on the row, the chip that leads
 * to it (and hides when there is nothing to lead to), and the «Обзор» queue
 * row — plus the one thing that must NOT be on the row: «Написать», which
 * means «ask him to pay» and would be addressed to somebody who has.
 *
 * The panel is a vanilla-JS IIFE with no DOM here, so the functions that
 * decide this are cut out of public/shop2/app.js by source text and run
 * against stubs, exactly as tests/orders-onway-r25.test.ts does it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
/* app.js is stored CRLF and a lifter that looks for a newline after a token
   matches far down the file against one (18.09.2026, b4e939c). */
const src = readFileSync(APP_JS, "utf8").replace(/\r\n/g, "\n");

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

function decl(name: string): string {
  for (const [open, close] of [["[", "]"], ["{", "}"]] as const) {
    const start = src.indexOf(`var ${name} = ${open}`);
    if (start < 0) continue;
    let depth = 0;
    for (let i = src.indexOf(open, start); i < src.length; i++) {
      if (src[i] === open) depth++;
      else if (src[i] === close && --depth === 0) return `${src.slice(start, i + 1)};`;
    }
    throw new Error(`unbalanced ${open}${close} around ${name} in app.js`);
  }
  throw new Error(`public/shop2/app.js no longer declares ${name}`);
}

/** One row of `SRV.orders`, with a payment blob this time. */
function row(id: string, srv: { status: string; payment?: Record<string, unknown> | null; channel?: string }) {
  return {
    id,
    number: "R-1000" + id,
    who: "Mart Tamm",
    date: "15.06.2026",
    items: 1,
    sum: 108,
    ship: "",
    state: ["new"],
    srv: {
      id,
      status: srv.status,
      channel: srv.channel ?? "web",
      shipping: { method: "parcel", country: "EE" },
      invoice: null,
      payment: srv.payment ?? null,
    },
  };
}

/** What applyPaymentResult() leaves on an order paid 54 € of 108 €. */
const HELD = {
  provider: "montonio",
  ref: "pi_1",
  status: "pending",
  amount: 54,
  currency: "EUR",
  amountMismatch: { expected: 108, got: 54 },
  held: { reason: "underpaid", expected: 108, got: 54, shortfall: 54, currency: "EUR", paidCurrency: "EUR", at: "2026-09-19T12:00:00.000Z", providerStatus: "paid" },
};

const BODY = `
  var S = { admOrderFilter: FILTER, admOrderQ: "", ordersShown: 0 };
  var SRV = { admin: true, orders: ORDERS, ordersErr: false };
  var FOUND = { q: null, want: "", rows: null, err: false, busy: false, seq: 0 };
  var ORDERS_PAGE = 40;
  function esc(s) { return String(s); }
  function admHead() { return ""; }
  function loadSrvOrders() {}
  /* The badge's own angle brackets are swapped for square ones so the row
     stays a single tag the reader below can lift whole. */
  function admOrderRowHTML(v) {
    var badge = admOrderBadge(v).replace(/</g, "[").replace(/>/g, "]");
    return "<row>" + v.number + "|" + badge + "|" + (v.held ? "held" : "-") + "</row>";
  }
  function admRefunds() { return []; }
  function admRefundedTotal() { return 0; }
  function admInvoiceOverdue() { return 0; }
  function admOrders() { return SRV.orders; }
  /* 1a: the chrome around the chips — the search box's icon, the dark
     button, the «?» of «Возвраты», the skeleton — stubbed down to nothing */
  var ADM_SEARCH_SVG = "";
  function admPinnedHTML() { return ""; }
  function admHelpBtnHTML() { return ""; }
  function admHelpHTML() { return ""; }
  function admSkelHTML() { return ""; }
  function admWaitingCount() { return admLiveToShip().length; }
  function admShipAllLabel(n) { return "Отправить " + n; }
  ${decl("ADM_ORDER_FILTERS")}
  ${slice("admOrderVM")}
  ${slice("shipRegFailed")}
  ${slice("admRefundView")}
  ${slice("admReturnAskedAt")}
  ${slice("admReturnDoneAt")}
  ${slice("admLiveToShip")}
  ${slice("admWaitingSplit")}
  ${slice("admOnTheWay")}
  ${slice("admInvoicesWaiting")}
  ${slice("admReturnsAsked")}
  ${slice("admHeldOrders")}
  ${slice("admOrderBadge")}
  ${slice("admOrderFilter")}
  ${slice("admOrderMatches")}
  ${slice("admOrderQClean")}
  ${slice("admOrderQShown")}
  ${slice("admOrderQOn")}
  ${slice("admOrderSearching")}
  ${slice("admOrderEmptyHTML")}
  ${slice("admOrderRows")}
  ${slice("admOrderChipLit")}
  ${slice("admOrdersPinHTML")}
  ${slice("admOrderChipsHTML")}
  ${slice("admOrdersHTML")}
  return admOrdersHTML();
`;

/* The body is this repository's own source plus fixed stub text — no input of
   any kind is interpolated into it. */
const paint = new Function("ORDERS", "FILTER", BODY) as (orders: unknown[], filter: string) => string;

const KEYS = ["all", "new", "shipped", "invoice", "returns", "held"];

function screen(orders: ReturnType<typeof row>[]) {
  const chips: Record<string, string> = {};
  const rows: Record<string, string[]> = {};
  for (const key of KEYS) {
    const html = paint(orders, key);
    rows[key] = [...html.matchAll(/<row>([^<]*)<\/row>/g)].map((m) => m[1]);
    // 1a: the chip's word and its count are two nodes (<span>, <b>) — read as the eye does
    for (const m of html.matchAll(/data-admfilter="([a-z]+)"[^>]*>(.*?)<\/button>/g)) chips[m[1]] = m[2].replace(/<[^>]+>/g, "");
  }
  return { chips, rows };
}

const SHOP = [
  row("1", { status: "paid", payment: { provider: "montonio", status: "paid", amount: 108 } }),
  row("2", { status: "new", payment: null }),                 // an abandoned checkout
  row("3", { status: "new", payment: HELD }),                 // paid 54 of 108
];

describe("«Заказы»: an order that was paid too little for", () => {
  it("wears its own badge, not «Ждёт оплаты»", () => {
    const held = screen(SHOP).rows.all.find((r) => r.startsWith("R-10003"))!;
    expect(held).toContain("Заплатили меньше");
    // 1a (README § 3): rust FILL — the one kind of tag that means «only you can end this»
    expect(held).toContain("adm-badge--warnfill");
    /* …and the abandoned checkout beside it still says what it always said,
       which is the whole reason the two needed telling apart. */
    const abandoned = screen(SHOP).rows.all.find((r) => r.startsWith("R-10002"))!;
    expect(abandoned).toContain("Ждёт оплаты");
    expect(abandoned).not.toContain("Заплатили меньше");
  });

  it("has a chip of its own, counting exactly the rows it opens onto", () => {
    const s = screen(SHOP);
    expect(s.chips.held).toBe("Придержаны 1");
    expect(s.rows.held).toHaveLength(1);
    expect(s.rows.held[0]).toContain("R-10003");
  });

  it("hides that chip when there is nothing behind it", () => {
    /* Rare by nature — four or five a year — and a chip that is always there
       and always zero is a tap a day for nothing. */
    /* One paint, on the filter the screen opens at — screen() above walks
       every chip in turn, and «Придержаны» is deliberately kept while IT is
       the one selected (the test below). */
    const quiet = paint([SHOP[0], SHOP[1]], "all");
    expect(quiet).not.toContain('data-admfilter="held"');
    // …the other five are where they always were
    for (const key of ["all", "new", "shipped", "invoice", "returns"]) {
      expect(quiet, key).toContain(`data-admfilter="${key}"`);
    }
  });

  it("keeps the chip while it is the one selected, so the last answer does not move the screen", () => {
    const html = paint([SHOP[0], SHOP[1]], "held");
    expect(html).toContain('data-admfilter="held"');
  });

  it("is not in «Отправить» — nothing was fulfilled", () => {
    const s = screen(SHOP);
    expect(s.rows.new.some((r) => r.startsWith("R-10003"))).toBe(false);
    expect(s.rows.all.some((r) => r.startsWith("R-10003"))).toBe(true);
  });

  it("reads `held` off the payment blob the list already carries", () => {
    /* No new server field: listOrders() is `select *` and mapOrder() passes
       the whole payment jsonb through. If that ever becomes a projection this
       test is the one that says so. */
    const s = screen(SHOP);
    expect(s.rows.all.find((r) => r.startsWith("R-10003"))).toContain("|held");
    expect(s.rows.all.find((r) => r.startsWith("R-10001"))).toContain("|-");
  });
});

describe("the two sentences on the card, and the one button that is wrong there", () => {
  const CARD = `
    var S = {};
    function esc(s) { return String(s); }
    function eur(v) { return v + " €"; }
    function payPiecesHTML(xs) { return xs.filter(Boolean).join(" · "); }
    function admPayRefHTML() { return ""; }
    function admRefunds() { return []; }
    function admRefundedTotal() { return 0; }
    function admRefundView() { return { refunded: 0, refundable: 0, gift: 0, money: 0 }; }
    var PAY_METHOD_NAMES = { bank: "Банковская ссылка" };
    var PAY_PROVIDER_NAMES = { montonio: "Montonio" };
    var BANK_CODES = {};
    function bankNameOf(c) { return c; }
    function admRealBanks() { return []; }
    ${slice("admPaymentHTML")}
    return admPaymentHTML({ payment: PAYMENT });
  `;
  const card = new Function("PAYMENT", CARD) as (p: unknown) => string;

  it("says «заказ придержан» once, not the same thing twice", () => {
    /* applyPaymentResult() writes BOTH `amountMismatch` and `held` for a
       shortfall, and the panel printed a line for each: «⚠ Пришло 54 € вместо
       108 €» followed by «⚠ Заплатили 54 € вместо 108 € — заказ придержан…».
       The owner read them as a pair and neither landed. */
    const html = card(HELD);
    expect((html.match(/⚠/g) || []).length).toBe(1);
    expect(html).toContain("заказ придержан");
    expect(html).not.toContain("Пришло");
  });

  it("still warns about a mismatch on an order that was NOT held", () => {
    // an overpayment: flagged and fulfilled, deliberately (apply.ts)
    const over = { provider: "montonio", status: "paid", amount: 120, amountMismatch: { expected: 108, got: 120 } };
    const html = card(over);
    expect(html).toContain("Пришло");
    expect(html).not.toContain("придержан");
  });
});
