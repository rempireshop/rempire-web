/**
 * «В пути» on «Заказы» — the chip Renat watches a parcel on.
 *
 * Renat, 18.09.2026: «в «Заказах» чип «в пути» вроде не считает то, что в
 * пути». Two separate things were wrong with it, and only one of them is what
 * the sentence sounds like:
 *
 *   1. **It carried no number at all.** Four of the five chips are queues and
 *      three of them counted — «Отправить N», «По счёту N», «Возвраты N». The
 *      count in admOrdersHTML() was a three-way ternary falling through to 0,
 *      so «В пути» was the silent one.
 *   2. **And it held delivered parcels.** admOrderMatches() answered
 *      `v.shipped || v.delivered` for that key — from 07.09.2026 (735c666),
 *      the same commit that taught the shop to close orders on its own. So
 *      «В пути» meant «всё, что когда-либо уехало»: a parcel the nightly
 *      sweep (closeDeliveredOrders) or the carrier's webhook closed never left
 *      the list. Harmless while nothing ever became `delivered` — the shipping
 *      webhook was parsed at the wrong level and thrown away unread until
 *      18.09.2026 — and wrong the moment it started arriving.
 *
 * The product said so in its own words in two places, both of which were
 * simply untrue: the delivery card's hint, «Заказ просто перестаёт висеть в
 * «В пути»» (admDeliveryCloseHTML), and src/lib/delivery.ts, «the order stops
 * appearing in «В пути» and Renat stops looking at it». The first of those is
 * pinned below, so the copy and the filter cannot drift apart again.
 *
 * The last thing this file guards is the one difference the owner cannot see
 * from the outside: **a chip saying five that opens onto three.** Every chip
 * that carries a number is checked against the rows it actually filters to.
 *
 * The panel is a vanilla-JS IIFE with no DOM here, so — like
 * tests/admin-toship.test.ts and tests/admin-panel-r22.test.ts — the functions
 * that decide this are **cut out of public/shop2/app.js by source text** and
 * run against stubs. Retyping them would test this file instead of the panel.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
/* Line endings normalised on the way in: app.js is stored CRLF, and a lifter
   that looks for a newline after a token matches somewhere far down the file
   against one — four false failures on 18.09.2026, fixed the same way in
   tests/shipping-parcel.test.ts (b4e939c). */
const src = readFileSync(APP_JS, "utf8").replace(/\r\n/g, "\n");

/** Cut `function <name>(…) { … }` out of app.js by brace matching. */
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

/** Cut `var <NAME> = [ … ];` / `var <NAME> = { … };` out of app.js. */
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

/** One row of `SRV.orders`, in the shape srvRow() leaves behind. */
function row(
  id: string,
  srv: {
    status: string;
    shipping?: Record<string, unknown>;
    channel?: string;
    invoice?: Record<string, unknown> | null;
  },
) {
  return {
    id,
    number: "R-1000" + id,
    who: "Mart Tamm",
    date: "15.06.2026",
    items: 1,
    sum: 50,
    ship: "",
    state: ["new"],
    srv: {
      id,
      status: srv.status,
      channel: srv.channel ?? "web",
      shipping: srv.shipping ?? { method: "parcel", country: "EE" },
      invoice: srv.invoice ?? null,
    },
  };
}

interface Screen {
  /** Every chip as the strip paints it: key → label with its count, or "" for no count. */
  chips: Record<string, string>;
  /** The order numbers each chip opens onto. */
  rows: Record<string, string[]>;
}

/* The real admOrdersHTML(), with the row markup and the chrome stubbed down to
   what can be read back. Everything that decides a number or a membership is
   app.js's own source. */
const BODY = `
  var S = { admOrderFilter: FILTER, admOrderQ: "", ordersShown: 0 };
  var SRV = { admin: true, orders: ORDERS, ordersErr: false };
  var FOUND = { q: null, want: "", rows: null, err: false, busy: false, seq: 0 };
  var ORDERS_PAGE = 40;
  function esc(s) { return String(s); }
  function admHead() { return ""; }
  function loadSrvOrders() {}
  function admOrderRowHTML(v) { return "<row>" + v.number + "</row>"; }
  function admRefunds() { return []; }
  function admRefundedTotal() { return 0; }
  function admInvoiceOverdue() { return 0; }
  function admOrders() { return SRV.orders; }
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
  /* …and the queue added on 19.09.2026, because the chip strip counts it now
     (tests/orders-held-r26.test.ts is the one that checks what it counts). */
  ${slice("admHeldOrders")}
  ${slice("admOrderFilter")}
  ${slice("admOrderMatches")}
  ${slice("admOrderQClean")}
  ${slice("admOrderQShown")}
  ${slice("admOrderQOn")}
  ${slice("admOrderSearching")}
  ${slice("admOrderEmptyHTML")}
  ${slice("admOrderRows")}
  ${slice("admOrdersHTML")}
  return admOrdersHTML();
`;

/* The body is this repository's own source plus fixed stub text — no input of
   any kind is interpolated into it. */
const paint = new Function("ORDERS", "FILTER", BODY) as (
  orders: unknown[],
  filter: string,
) => string;

const KEYS = ["all", "new", "shipped", "invoice", "returns"];

function screen(orders: ReturnType<typeof row>[]): Screen {
  const out: Screen = { chips: {}, rows: {} };
  for (const key of KEYS) {
    const html = paint(orders, key);
    out.rows[key] = [...html.matchAll(/<row>([^<]*)<\/row>/g)].map((m) => m[1]);
    for (const m of html.matchAll(/data-admfilter="([a-z]+)"[^>]*>([^<]*)<\/button>/g)) {
      out.chips[m[1]] = m[2];
    }
  }
  return out;
}

/** The number a chip carries, or null when it carries none. */
function count(label: string): number | null {
  const m = /\s(\d+)$/.exec(label);
  return m ? Number(m[1]) : null;
}

/* Renat's shop on a normal day: two on the shelf, three genuinely on their way,
   two the shop has already closed, one salon sale, one invoice unpaid. */
const SHOP = [
  row("1", { status: "paid" }),
  row("2", { status: "paid" }),
  row("3", { status: "shipped" }),
  row("4", { status: "shipped" }),
  row("5", { status: "shipped" }),
  row("6", { status: "delivered" }),
  row("7", { status: "delivered" }),
  row("8", { status: "paid", channel: "pos" }),
  row("9", { status: "new", invoice: { number: "2026-9", dueAt: "2026-10-01" } }),
];

describe("«Заказы» → «В пути»: what the chip counts", () => {
  it("carries a number at all — it was the one queue chip that did not", () => {
    const s = screen(SHOP);
    expect(s.chips.shipped).toMatch(/^В пути \d+$/);
  });

  it("counts the parcels that have left and have NOT arrived", () => {
    // three `shipped`; the two the shop closed are somebody else's business now
    expect(count(screen(SHOP).chips.shipped)).toBe(3);
  });

  it("does not hold a delivered order — «Доставлен» takes it off the list", () => {
    const s = screen(SHOP);
    expect(s.rows.shipped).toEqual(["R-10003", "R-10004", "R-10005"]);
    expect(s.rows.shipped).not.toContain("R-10006");
    // …and it is still in the shop, under «Все», where the badge says «Доставлен»
    expect(s.rows.all).toContain("R-10006");
  });

  it("drops an order out of «В пути» the moment it becomes delivered", () => {
    const before = screen([row("3", { status: "shipped" })]);
    const after = screen([row("3", { status: "delivered" })]);
    expect(count(before.chips.shipped)).toBe(1);
    expect(before.rows.shipped).toEqual(["R-10003"]);
    // whoever pressed it: the owner, the nightly sweep, or the carrier's webhook
    expect(count(after.chips.shipped)).toBe(null);
    expect(after.rows.shipped).toEqual([]);
  });

  it("keeps a parcel the carrier sent back — it is in transit, to Renat", () => {
    /* src/lib/delivery.ts leaves a `returned` shipment `shipped` on purpose:
       «it is on its way to Renat, not to the customer». So it belongs here,
       and it is his to deal with. */
    const s = screen([row("3", { status: "shipped", shipping: { method: "parcel", country: "EE", montonio: { shipmentId: "s1", status: "returned" } } })]);
    expect(s.rows.shipped).toEqual(["R-10003"]);
  });

  it("is the same promise the delivery card makes in words", () => {
    // admDeliveryCloseHTML()'s own hint under «Закрывать заказ через N дней»
    expect(slice("admDeliveryCloseHTML")).toContain("перестаёт висеть в «В пути»");
  });
});

describe("«Заказы»: a chip's number and the rows behind it", () => {
  const s = screen(SHOP);

  /* The difference the owner cannot tell from the outside: a chip saying five
     that opens onto three reads exactly like a chip saying five when there are
     three. Every counting chip is checked against its own list. */
  for (const key of ["new", "shipped", "invoice"]) {
    it(`«${key}» counts what it opens onto`, () => {
      expect(count(s.chips[key])).toBe(s.rows[key].length);
    });
  }

  it("«Все» carries no number — it is everything, and says so", () => {
    expect(s.chips.all).toBe("Все");
    expect(s.rows.all.length).toBe(SHOP.length);
  });

  it("«Возвраты» counts the unanswered and lists them all — on purpose, and it says so", () => {
    /* The one deliberate exception (r16/r22): the list keeps every order a
       return was ever asked for, so one being dealt with does not vanish from
       under the owner's thumb, while the number is the question «Сделать
       сегодня» asks. A line above the list is what makes that readable. */
    const asked = (at: string, done?: string) =>
      row("5", {
        status: "delivered",
        shipping: { method: "parcel", country: "EE", returnRequest: done ? { at, doneAt: done } : { at } },
      });
    const open = screen([asked("2026-09-17T10:00:00Z")]);
    expect(count(open.chips.returns)).toBe(1);
    expect(open.rows.returns.length).toBe(1);

    const handled = screen([asked("2026-09-17T10:00:00Z", "2026-09-18T10:00:00Z")]);
    expect(count(handled.chips.returns)).toBe(null);
    expect(handled.rows.returns.length).toBe(1);
    expect(paint([asked("2026-09-17T10:00:00Z", "2026-09-18T10:00:00Z")], "returns"))
      .toContain("В счётчике — те, на которые вы ещё не ответили.");
  });
});

/* ------------------------------------------------------------------------ *
 * …and the chips have to survive the ET/EN panel with their number on them. *
 * ------------------------------------------------------------------------ */

type Lang = "ET" | "EN";
type Rule = [RegExp, Record<Lang, string>];
const UI_RX = runInNewContext(
  `(${decl("UI_RX").replace(/^var UI_RX = /, "").replace(/;$/, "")})`,
) as Array<Rule | undefined>;

/** trText()'s rule half — no dictionary, so this is about the RULE only. */
function byRule(s: string, lang: Lang): string {
  for (const e of UI_RX) {
    if (!e) continue;
    const m = s.match(e[0]);
    if (m) return e[1][lang].replace(/\$(\d)/g, (_, n: string) => m[+n] ?? "");
  }
  return s;
}

describe("the chip strip on an Estonian or English panel", () => {
  /* translateTree() rewrites a WHOLE text node, and the label and its count
     are one node — so «В пути 3» needs a rule of its own, exactly as
     «Отправить N» and «По счёту N» have had one. «Возвраты N» never did: the
     bare word is in both dictionaries and the counted chip was Russian on
     every ET/EN panel since r16. i18n-gaps cannot see either, because the
     label comes out of ADM_ORDER_FILTERS rather than a string literal. */
  const CYR = /[А-Яа-яЁё]/;
  for (const [ru, et, en] of [
    ["В пути 3", "Teel 3", "On the way 3"],
    ["Возвраты 2", "Tagastused 2", "Returns 2"],
    ["Отправить 2", "Saada 2", "Ship 2"],
    ["По счёту 1", "Arvega 1", "By invoice 1"],
  ] as const) {
    it(`«${ru}» reaches both panels`, () => {
      expect(byRule(ru, "ET")).toBe(et);
      expect(byRule(ru, "EN")).toBe(en);
      expect(CYR.test(byRule(ru, "ET"))).toBe(false);
      expect(CYR.test(byRule(ru, "EN"))).toBe(false);
    });
  }
});
