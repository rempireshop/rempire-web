/**
 * The four decisions of 17.09.2026, each pinned where it can actually go
 * wrong.
 *
 *   1. «Топ товаров» and «Бренды» are the VALUE OF GOODS, not money, and the
 *      titles now say so. The figures were deliberately not touched.
 *   2. The order search goes to the server — and **a slow answer to an old
 *      question can never replace a fast answer to a new one.** That is the
 *      one thing on that screen nobody could see going wrong.
 *   3. The «Возвраты» counter can fall, because «Обработано» exists.
 *   4. A cleared cell in the rate table stays cleared and goes on following
 *      Montonio's tariff.
 *
 * The panel is a vanilla-JS IIFE with no DOM here, so — like
 * tests/admin-toship.test.ts and tests/checkout-parity.test.ts — the functions
 * that decide each of these are **cut out of public/shop2/app.js by source
 * text** and run against stubs. Retyping them would test this file instead of
 * the panel, and the slice fails loudly the day app.js renames one of them.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

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

/** Cut `var <NAME> = { … };` or `var <NAME> = [ … ];` out of app.js. */
function decl(name: string): string {
  for (const [open, close] of [["{", "}"], ["[", "]"]] as const) {
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

/* ------------------------------------------------------------------ *
 * 1. «Топ товаров» / «Бренды» — renamed, not recalculated
 * ------------------------------------------------------------------ */

describe("«Аналитика»: the two blocks that were never money", () => {
  /* Both sum `item.sum` — price × quantity per order line — which is the price
     list before the order discount, before the points spent, before a gift
     card settled part of the bill, and without the delivery. Pro-rating the
     discount back onto the lines was considered and refused; the cure is that
     the words above the figures stop calling them money. */
  it("names them as a value ordered, and points at the figure that IS money", () => {
    expect(src).toContain("Топ товаров: на какую сумму заказали");
    expect(src).toContain("Бренды: на какую сумму заказали");
    // the old titles, which read as takings, are gone from the markup
    expect(src).not.toContain('<div class="adm-sec__t">Топ товаров</div>');
    expect(src).not.toContain('sec("Бренды: что приносит деньги"');
  });

  it("says in one line what is not in the figure, and where the money is", () => {
    const lead = "Это цена товаров в заказах, а не полученные деньги: скидки, баллы, " +
      "подарочные карты и доставка сюда не входят. Сколько денег пришло — выше, в «Выручке».";
    expect(src).toContain(lead);
    for (const lang of ["ET", "EN"]) expect(src.split(lead).length, lang).toBeGreaterThan(2);
  });

  /* The hole that belongs to «Бренды» alone: a bundle line and a gift-card
     line are built without a `brand` key at all (src/lib/orders.ts), and the
     query behind the block reads `item->>'brand'`, so neither is in the table
     under any name. Cheaper to say than to work out by adding the rows up. */
  it("warns that bundles and gift cards are not in «Бренды» at all", () => {
    expect(src).toContain("Наборы и подарочные карты сюда не попадают — бренд у них не указан.");
  });

  /* …and not one figure moved. The two lists still read the very same
     fields of the analytics answer — «Топ товаров» drawn with a share bar
     under each row since 1a (admShareRowsHTML, screen 17). */
  it("changes no number: the same two fields are still what is drawn", () => {
    expect(src).toContain("admShareRowsHTML(a.topProductsByRevenue.map(prod)");
    expect(src).toContain("a.brandRevenue.map(function (r) { return [r.brand, eur(r.revenue)]; })");
  });
});

/* ------------------------------------------------------------------ *
 * 2. The order search, on the server — and the race it must not lose
 * ------------------------------------------------------------------ */

type Answer = { status: number; body?: Record<string, unknown> };

type SearchRig = {
  type: (q: string) => void;
  send: () => void;
  /** answer the n-th request still in flight (0 = the oldest) */
  land: (n: number, answer: Answer) => Promise<void>;
  fail: (n: number) => Promise<void>;
  inflight: () => string[];
  /** the rows the screen would draw, by order number */
  shown: () => string[];
  /** which search the drawn rows are the answer to */
  answering: () => string;
  searching: () => boolean;
  renders: () => number;
};

/** loadOrderSearch() over a network the test holds open by hand. */
function searchRig(): SearchRig {
  const body = `
    var S = { admOrderQ: "" };
    var SRV = { admin: true, orders: [] };
    var FOUND = { q: null, want: "", rows: null, err: false, busy: false, seq: 0 };
    var renders = 0;
    function render() { renders++; }
    var PENDING = [];
    /* A network with no order of its own: every request is parked and the test
       decides which one comes back, and when. That is the whole point — on a
       phone on mobile data the order is the network's to choose. */
    function apiJson(url) {
      return new Promise(function (res, rej) {
        PENDING.push({ url: url, res: res, rej: rej });
      });
    }
    function srvRow(o) { return { id: o.id, number: o.number, srv: o }; }
    ${slice("admOrderQClean")}
    ${slice("admOrderQShown")}
    ${slice("admOrderQOn")}
    ${slice("admOrderSearching")}
    ${slice("loadOrderSearch")}
    return {
      type: function (q) { S.admOrderQ = q; },
      send: function () { loadOrderSearch(S.admOrderQ); },
      land: function (n, answer) {
        var p = PENDING[n];
        if (!p) throw new Error("no request " + n + " in flight");
        p.res(answer);
        return Promise.resolve();
      },
      fail: function (n) {
        var p = PENDING[n];
        if (!p) throw new Error("no request " + n + " in flight");
        p.rej(new Error("offline"));
        return Promise.resolve();
      },
      inflight: function () { return PENDING.map(function (p) { return p.url; }); },
      shown: function () {
        return admOrderQOn()
          ? (FOUND.rows || []).map(function (r) { return r.number; })
          : SRV.orders.map(function (r) { return r.number; });
      },
      answering: function () { return admOrderQShown(); },
      searching: function () { return admOrderSearching(); },
      renders: function () { return renders; }
    };
  `;
  return new Function(body)() as SearchRig;
}

/** An answer carrying one order per number given. */
function found(...numbers: string[]): Answer {
  return {
    status: 200,
    body: { ok: true, orders: numbers.map((n, i) => ({ id: String(i), number: n })) },
  };
}

/** Let every already-settled promise run its `then`. */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("«Заказы»: the search happens on the server", () => {
  it("sends the typed search to the shop rather than filtering a loaded page", () => {
    const rig = searchRig();
    rig.type("R-100423");
    rig.send();
    expect(rig.inflight()).toEqual(["/api/admin/orders/?limit=100&q=R-100423"]);
  });

  it("escapes what is typed — a name with a space and a plus is still one query", () => {
    const rig = searchRig();
    rig.type("Мария Тамм +372");
    rig.send();
    expect(rig.inflight()[0]).toBe(
      "/api/admin/orders/?limit=100&q=" + encodeURIComponent("Мария Тамм +372"),
    );
  });

  it("caps the search where listOrders caps it, so the two always agree", () => {
    const rig = searchRig();
    rig.type("  " + "x".repeat(140) + "  ");
    rig.send();
    expect(rig.inflight()[0]).toBe("/api/admin/orders/?limit=100&q=" + "x".repeat(100));
  });

  it("an emptied box is not a search: the plain newest list comes back", async () => {
    const rig = searchRig();
    rig.type("R-1");
    rig.send();
    await rig.land(0, found("R-100001"));
    await tick();
    expect(rig.answering()).toBe("R-1");

    rig.type("");
    rig.send();
    // nothing is asked for — SRV.orders is already the hundred newest
    expect(rig.inflight().length).toBe(1);
    expect(rig.searching()).toBe(false);
    expect(rig.answering()).toBe("");
  });

  it("says it is searching from the first keystroke, before anything is sent", () => {
    const rig = searchRig();
    rig.type("R");
    expect(rig.searching()).toBe(true);
    expect(rig.inflight()).toEqual([]);
  });

  /* ---- the rule this screen turns on ---------------------------------- */

  it("a SLOW answer to an old query never replaces a fast answer to a new one", async () => {
    const rig = searchRig();
    // he types «R-10», then «R-1004» a quarter of a second later
    rig.type("R-10");
    rig.send();
    rig.type("R-1004");
    rig.send();
    expect(rig.inflight().length).toBe(2);

    // the NEW one comes back first — which is exactly what mobile data does
    await rig.land(1, found("R-100423"));
    await tick();
    expect(rig.shown()).toEqual(["R-100423"]);
    expect(rig.answering()).toBe("R-1004");
    expect(rig.searching()).toBe(false);

    // …and then the old one lands. It must change nothing at all.
    const rendersWas = rig.renders();
    await rig.land(0, found("R-100001", "R-100002", "R-100003"));
    await tick();
    expect(rig.shown()).toEqual(["R-100423"]);
    expect(rig.answering()).toBe("R-1004");
    expect(rig.searching()).toBe(false);
    // it does not even redraw: a dropped answer is dropped whole
    expect(rig.renders()).toBe(rendersWas);
  });

  it("a stale FAILURE cannot put an error over a search that has answered", async () => {
    const rig = searchRig();
    rig.type("R-10");
    rig.send();
    rig.type("R-1004");
    rig.send();
    await rig.land(1, found("R-100423"));
    await tick();

    await rig.fail(0);
    await tick();
    expect(rig.shown()).toEqual(["R-100423"]);
    expect(rig.answering()).toBe("R-1004");
    expect(rig.searching()).toBe(false);
  });

  it("a stale 401 cannot sign the owner out of a panel that is answering", async () => {
    const rig = searchRig();
    rig.type("R-10");
    rig.send();
    rig.type("R-1004");
    rig.send();
    await rig.land(1, found("R-100423"));
    await tick();

    await rig.land(0, { status: 401, body: { ok: false } });
    await tick();
    expect(rig.shown()).toEqual(["R-100423"]);
    expect(rig.answering()).toBe("R-1004");
  });

  it("keeps the rows on screen when the newest search fails, and says so", async () => {
    const rig = searchRig();
    rig.type("R-1004");
    rig.send();
    await rig.land(0, found("R-100423"));
    await tick();

    rig.type("R-1005");
    rig.send();
    await rig.land(1, { status: 503, body: { ok: false } });
    await tick();
    // the previous answer is still there — blanking a list on mobile data is
    // worse than a list one word behind — and it still says which query it is
    expect(rig.shown()).toEqual(["R-100423"]);
    expect(rig.answering()).toBe("R-1004");
  });

  it("asks once per pause: the same query twice does not go out twice", async () => {
    const rig = searchRig();
    rig.type("R-1004");
    rig.send();
    rig.send();
    expect(rig.inflight().length).toBe(1);
    await rig.land(0, found("R-100423"));
    await tick();
    rig.send();
    expect(rig.inflight().length).toBe(1);
  });
});

/** admOrderRows() itself, with the row markup stubbed to its number. */
function rowsHTML(state: {
  q?: string;
  orders?: string[];
  found?: { q: string | null; rows: string[] | null; err?: boolean };
  filter?: string;
}): string {
  const body = `
    var S = { admOrderQ: Q, admOrderFilter: FILTER, ordersShown: 0 };
    var SRV = { admin: true, orders: ORDERS, ordersErr: false };
    var FOUND = FOUNDSTATE;
    var ORDERS_PAGE = 40;
    ${decl("ADM_ORDER_FILTERS")}
    ${slice("admOrderFilter")}
    ${slice("admOrderMatches")}
    ${slice("admOrderQClean")}
    ${slice("admOrderQShown")}
    ${slice("admOrderQOn")}
    ${slice("admOrderSearching")}
    ${slice("admOrderEmptyHTML")}
    ${slice("admSkelHTML")}
    ${slice("admOrderRows")}
    function admOrderVM(o) { return { id: o.id, number: o.number, toShip: true, delivered: false }; }
    function admOrderRowHTML(v) { return "<row>" + v.number + "</row>"; }
    function admOrders() { return SRV.orders; }
    return admOrderRows();
  `;
  const rows = (ns: string[] | null) =>
    ns === null ? null : ns.map((n, i) => ({ id: String(i), number: n }));
  return new Function(
    "Q",
    "FILTER",
    "ORDERS",
    "FOUNDSTATE",
    body,
  )(
    state.q ?? "",
    state.filter ?? "all",
    rows(state.orders ?? []),
    state.found
      ? { q: state.found.q, want: state.found.q ?? "", rows: rows(state.found.rows), err: !!state.found.err, busy: false, seq: 1 }
      : { q: null, want: "", rows: null, err: false, busy: false, seq: 0 },
  ) as string;
}

describe("«Заказы»: what the list itself says while a search is out", () => {
  it("keeps the rows on screen under «Ищем…» rather than blanking them", () => {
    const html = rowsHTML({ q: "R-1004", orders: ["R-100001", "R-100002"] });
    expect(html).toContain("Ищем…");
    expect(html).toContain("<row>R-100001</row>");
  });

  it("draws the matches once they land, and stops saying «Ищем…»", () => {
    const html = rowsHTML({
      q: "R-1004",
      orders: ["R-100001"],
      found: { q: "R-1004", rows: ["R-100423"] },
    });
    expect(html).not.toContain("Ищем…");
    expect(html).toContain("<row>R-100423</row>");
    expect(html).not.toContain("<row>R-100001</row>");
  });

  it("says what it searched by when the answer is empty", () => {
    const html = rowsHTML({ q: "R-9", orders: ["R-100001"], found: { q: "R-9", rows: [] } });
    expect(html).toContain("Ничего не нашли.");
    expect(html).toContain("Ищем по номеру заказа, имени, телефону и почте.");
    expect(html).not.toContain("Таких заказов нет");
  });

  it("offers «Повторить» when the search itself failed, in place of «Ищем…»", () => {
    const html = rowsHTML({
      q: "R-1004",
      orders: ["R-100001"],
      found: { q: "R-1004", rows: ["R-100423"], err: true },
    });
    expect(html).toContain("Поиск не сработал — попробуйте ещё раз.");
    expect(html).toContain('data-admreload="search"');
    expect(html).not.toContain("Ищем…");
    // …over the rows it already had, which are still the last good answer
    expect(html).toContain("<row>R-100423</row>");
  });

  it("with no search, it is the plain list and the old empty line", () => {
    expect(rowsHTML({ orders: ["R-100001"] })).toContain("<row>R-100001</row>");
    expect(rowsHTML({ orders: [] })).toContain("Таких заказов нет");
    expect(rowsHTML({ orders: [] })).not.toContain("Ничего не нашли.");
  });

  /* 1a (gap L3, recommended — Dim, 25.09.2026): the search still looks
     through every order, and it is the lit chip that says so now — «Все»
     while text is in the box, the chosen chip again once it is emptied —
     rather than a line explaining a chip that did not apply. */
  it("a search looks past the chosen chip, and the lit chip says «Все» while it does", () => {
    const html = rowsHTML({
      q: "R-1004",
      filter: "new",
      found: { q: "R-1004", rows: ["R-100423"] },
    });
    // the order found is listed although «Отправить» is the chosen chip
    expect(html).toContain("R-100423");
    const lit = (q: string, filter: string) => new Function("S", `
      ${decl("ADM_ORDER_FILTERS")}
      ${slice("admOrderFilter")}
      ${slice("admOrderChipLit")}
      return admOrderChipLit();
    `)({ admOrderQ: q, admOrderFilter: filter }) as string;
    expect(lit("R-1004", "new")).toBe("all");
    expect(lit("  ", "new"), "an empty box gives the chosen chip back").toBe("new");
    expect(lit("", "returns")).toBe("returns");
  });
});

describe("«Заказы»: the screen around the search", () => {
  it("debounces the keystrokes rather than asking per character", () => {
    expect(src).toMatch(/admOrderQTimer = setTimeout\(admOrderQSend, 300\)/);
    expect(src).toContain("admOrderQSchedule();");
  });

  it("keeps the search out of SRV.orders, which eight counters read", () => {
    // the chips, «Сделать сегодня» and the overview all count the hundred
    // NEWEST orders; a search result in that slot would re-answer every one
    expect(slice("admReturnsAsked")).toContain("SRV.orders");
    expect(slice("admInvoicesWaiting")).toContain("SRV.orders");
    expect(slice("admLiveToShip")).toContain("SRV.orders");
    expect(slice("loadOrderSearch")).not.toContain("SRV.orders");
  });

  it("has an empty state that names what the search looked at", () => {
    const empty = slice("admOrderEmptyHTML");
    expect(empty).toContain("Ничего не нашли.");
    expect(empty).toContain("Ищем по номеру заказа, имени, телефону и почте.");
    // …and none of it while an answer is still on its way
    expect(empty).toMatch(/if \(waiting\) return "";/);
  });

  it("leaves a box the owner is typing in alone when a render lands mid-word", () => {
    /* The answer arrives while he types, and its markup carries the very
       characters already in the field — so the morph must not assign `.value`
       over them, which on a phone jumps the caret to the end. */
    expect(slice("admMorphNode")).toContain("from.value !== valWant");
  });
});

/* ------------------------------------------------------------------ *
 * 3. «Возвраты» — a counter that can fall
 * ------------------------------------------------------------------ */

type Row = { id: string; status: string; shipping?: Record<string, unknown> };

/** admReturnsAsked() and the row badge, over a list of orders. */
function returnsRig(orders: Row[]) {
  const body = `
    var SRV = { admin: true, orders: ORDERS.map(function (o) {
      return { id: o.id, number: "R-1000" + o.id, who: "Мария", date: "", items: 1,
               sum: 50, ship: "", state: ["new"],
               srv: { id: o.id, status: o.status, channel: "web", shipping: o.shipping || {} } };
    }) };
    ${slice("admOrderVM")}
    ${slice("shipRegFailed")}
    ${slice("admReturnAskedAt")}
    ${slice("admReturnDoneAt")}
    ${slice("admRefundView")}
    ${slice("admReturnsAsked")}
    ${slice("admOrderMatches")}
    ${slice("admReturnBadge")}
    function admRefundedTotal() { return 0; }
    function admRefunds() { return []; }
    function admInvoiceOverdue() { return 0; }
    function admOrders() { return []; }
    var vms = SRV.orders.map(admOrderVM);
    return {
      counted: admReturnsAsked().map(function (v) { return v.id; }),
      listed: vms.filter(function (v) { return admOrderMatches(v, "returns"); }).map(function (v) { return v.id; }),
      badges: vms.map(function (v) { return admReturnBadge(v); })
    };
  `;
  return new Function("ORDERS", body)(orders) as {
    counted: string[];
    listed: string[];
    badges: string[];
  };
}

const asked = { returnRequest: { at: "2026-09-15T10:00:00.000Z" } };
const handled = { returnRequest: { at: "2026-09-15T10:00:00.000Z", doneAt: "2026-09-17T09:00:00.000Z" } };

describe("«Возвраты»: the counter falls when the owner answers", () => {
  it("counts a request nobody has answered", () => {
    const out = returnsRig([{ id: "1", status: "delivered", shipping: asked }]);
    expect(out.counted).toEqual(["1"]);
    expect(out.badges[0]).toContain("Просит возврат");
  });

  it("stops counting it the moment «Обработано» is stamped", () => {
    const out = returnsRig([{ id: "1", status: "delivered", shipping: handled }]);
    expect(out.counted).toEqual([]);
  });

  it("keeps the order in the «Возвраты» list — it is answered, not erased", () => {
    const out = returnsRig([
      { id: "1", status: "delivered", shipping: asked },
      { id: "2", status: "delivered", shipping: handled },
    ]);
    expect(out.counted).toEqual(["1"]);
    expect(out.listed).toEqual(["1", "2"]);
  });

  it("says on the row which of the two it is", () => {
    const out = returnsRig([
      { id: "1", status: "delivered", shipping: asked },
      { id: "2", status: "delivered", shipping: handled },
    ]);
    expect(out.badges[0]).toContain("Просит возврат");
    expect(out.badges[1]).toContain("Возврат обработан");
    expect(out.badges[1]).not.toContain("Просит возврат");
  });

  it("is not a refund and not a letter: the card says so in words", () => {
    const card = slice("admReturnStateHTML");
    expect(card).toContain("Обработано");
    expect(card).toContain("Вернуть в «Возвраты»");
    expect(card).toContain("Деньги не уходят и письмо не отправляется");
  });

  it("refuses a second tap while the stamp is in flight", () => {
    const card = slice("admReturnStateHTML");
    expect(card).toContain("SRV.returnBusy === v.id");
    expect(card).toContain("Сохраняем…");
  });

  it("the overview counts the same set the panel does", () => {
    const analytics = readFileSync(
      fileURLToPath(new URL("../src/lib/analytics.ts", import.meta.url)),
      "utf8",
    );
    expect(analytics).toContain("(shipping -> 'returnRequest' ->> 'doneAt') is null");
    /* …and the first two conditions are still spelled as
       orders_return_requested_idx spells them, or the partial index behind
       this count stops being used (db/migrations/150). */
    expect(analytics).toContain("status = 'delivered' and (shipping -> 'returnRequest') is not null");
  });
});

/* ------------------------------------------------------------------ *
 * 4. A cleared cell keeps following Montonio
 * ------------------------------------------------------------------ */

type RateRig = {
  /** the value the box for this key shows */
  box: (key: string) => string;
  /** the row that would be PUT to /api/admin/settings */
  stored: () => Record<string, unknown>;
  /** the table the till would bill from */
  live: () => Record<string, Record<string, Record<string, number>>>;
  dirty: () => boolean;
  /** «Везде взять цены Montonio» */
  montonioEverywhere: () => void;
  set: (key: string, raw: string) => void;
};

/** The rate screen's own draft machinery, over one stored row. */
function rateRig(storedRow: unknown): RateRig {
  const body = `
    ${decl("SHIP_RULES")}
    ${decl("MONTONIO_PRICE")}
    function cloneRules(r) { return JSON.parse(JSON.stringify(r)); }
    var SHIP_RULES_DEFAULT = cloneRules(SHIP_RULES);
    var SHIP_STORED_DEFAULT = {
      freeFrom: SHIP_RULES_DEFAULT.freeFrom,
      freeFromByCountry: cloneRules(SHIP_RULES_DEFAULT.freeFromByCountry),
      methods: { parcel: {}, courier: {}, pickup: {} },
      carriers: {},
      countriesOff: cloneRules(SHIP_RULES_DEFAULT.countriesOff)
    };
    var SHIP_STORED = cloneRules(SHIP_STORED_DEFAULT);
    var THRESH = { EE: null, LV: null, LT: null, FI: null, EU: null };
    var S = { shipDraft: null };
    var SHIP_EU_COUNTRIES = ["DE", "PL", "GR"];
    ${slice("refreshShipThresholds")}
    ${slice("applyShipRules")}
    ${slice("shipRulesBase")}
    ${slice("shipStoredMerge")}
    ${slice("shipRulesFrom")}
    ${slice("setShipRules")}
    ${slice("shipDraft")}
    ${slice("shipDraftLive")}
    ${slice("jsonCanon")}
    ${slice("shipSig")}
    ${slice("shipDirty")}
    ${slice("shipNum")}
    ${slice("shipShow")}
    ${slice("shipCell")}
    ${slice("shipFreeCell")}
    ${slice("shipCarrierCell")}
    ${slice("setShipDraftField")}
    if (ROW) setShipRules(ROW); else setShipRules(null);
    return {
      box: function (key) {
        var p = key.split(":");
        return p[0] === "c" ? shipCarrierCell(p[1], p[2])
          : p[0] === "m" ? shipCell(p[1], p[2])
          : shipFreeCell(p[1]);
      },
      stored: function () { return cloneRules(shipDraft()); },
      live: function () { return shipDraftLive(); },
      dirty: function () { return shipDirty(); },
      montonioEverywhere: function () {
        var d = shipDraft();
        d.carriers = {};
        d.methods = { parcel: {}, courier: {}, pickup: {} };
      },
      set: function (key, raw) { setShipDraftField(key, raw); }
    };
  `;
  return new Function("ROW", body)(storedRow) as RateRig;
}

describe("«Настройки → Доставка»: an empty box stays empty", () => {
  it("opens on the STORED row: a shop that saved nothing shows empty boxes", () => {
    const rig = rateRig(null);
    expect(rig.box("m:courier:DE")).toBe("");
    expect(rig.box("c:dpd:FI")).toBe("");
    // …and «Бесплатно от» is not a price: it is the owner's own answer
    expect(rig.box("free:default")).toBe("59");
  });

  it("shows what he typed and nothing else", () => {
    const rig = rateRig({ methods: { courier: { DE: 25 } }, carriers: { dpd: { FI: 13 } } });
    expect(rig.box("m:courier:DE")).toBe("25");
    expect(rig.box("c:dpd:FI")).toBe("13");
    expect(rig.box("m:courier:PL")).toBe("");
    expect(rig.box("c:dpd:LV")).toBe("");
  });

  /* The whole point. An empty box means «возьмите цену Montonio», and that can
     only stay true while the cell is ABSENT from the row that gets saved — a
     number written down stops moving when Montonio's tariff moves. */
  it("a cleared cell leaves the saved row altogether", () => {
    const rig = rateRig({ methods: { courier: { DE: 25 } } });
    expect(rig.stored().methods).toEqual({ parcel: {}, courier: { DE: 25 }, pickup: {} });
    rig.set("m:courier:DE", "");
    expect(rig.box("m:courier:DE")).toBe("");
    expect(rig.stored().methods).toEqual({ parcel: {}, courier: {}, pickup: {} });
  });

  it("…and the till goes on charging Montonio's own price for it", () => {
    const rig = rateRig({ methods: { courier: { DE: 25 } } });
    expect(rig.live().methods.courier.DE).toBe(25);
    rig.set("m:courier:DE", "");
    // 17.59 is MONTONIO_PRICE.courier.DE — the number printed under the box
    // (22.29 until the 22.09.2026 re-quote for the 25 × 18 × 8 cm carton)
    expect(rig.live().methods.courier.DE).toBe(17.59);
  });

  it("«Везде взять цены Montonio» empties the table instead of freezing it", () => {
    // the row the live shop has today: the old panel wrote every cell in
    const rig = rateRig({
      freeFrom: 59,
      freeFromByCountry: { EU: 200 },
      methods: {
        parcel: { default: 4.99, DE: 29.79, PL: 17.89 },
        courier: { default: 9.9, DE: 22.29, EE: 10.84 },
        pickup: { default: 0 },
      },
      carriers: { dpd: { FI: 12.39, EE: 2.59 }, omniva: { EE: 3.19 } },
    });
    expect(rig.box("m:courier:EE")).toBe("10.84");

    rig.montonioEverywhere();
    expect(rig.stored().carriers).toEqual({});
    expect(rig.stored().methods).toEqual({ parcel: {}, courier: {}, pickup: {} });
    expect(rig.box("m:courier:EE")).toBe("");
    expect(rig.box("c:dpd:FI")).toBe("");
    /* …and it is not the same thing as «нет цены»: the till bills Montonio's
       own number, read at the moment of the quote. */
    expect(rig.live().methods.courier.EE).toBe(6.89);
    expect(rig.live().carriers.dpd.FI).toBe(12.39);
    // how much delivery to give away is HIS decision, not Montonio's
    expect(rig.box("free:default")).toBe("59");
  });

  it("a freshly opened screen is not dirty, however empty its boxes are", () => {
    expect(rateRig(null).dirty()).toBe(false);
    expect(rateRig({ methods: { courier: { DE: 25 } } }).dirty()).toBe(false);
  });

  it("and is dirty the moment a box changes", () => {
    const rig = rateRig({ methods: { courier: { DE: 25 } } });
    rig.set("m:courier:DE", "26");
    expect(rig.dirty()).toBe(true);
  });

  it("saves the stored row, never the merged table", () => {
    // the PUT and the journal both travel the row, holes included — since 1a
    // through the settings slot (shipPut), gated for prices under the tariff
    const put = slice("shipPut");
    expect(put).toContain("var boxes = cloneRules(SHIP_STORED);");
    expect(put).toContain("var body = { settings: { shipping_rules: row } };");
    expect(src).toContain('entry.prev = { type: "set_shipping_rules", rules: cloneRules(SHIP_STORED), full: true }');
    // «Вернуть значения по умолчанию» is the EMPTY row, not today's price list
    expect(src).toContain("S.shipDraft = cloneRules(SHIP_STORED_DEFAULT);");
    expect(src).toContain('admShipCommit("Тарифы снова стандартные", { reset: true })');
  });
});

describe("the save guard only refuses cells the owner can actually change", () => {
  /* An earlier analysis of this screen: belowCostCells() policed eighteen
     `methods.parcel` cells that no box on the screen can edit, because
     admShipRowHTML() emits `c:`, `m:courier:` and `free:` keys and nothing
     else. A Montonio rise past one of them would have refused the owner's
     next save — of ANY cell — over a number he cannot reach. */
  it("the rate screen still emits exactly three kinds of box", () => {
    const row = slice("admShipRowHTML");
    expect(row).toContain('"c:" + c[0] + ":" + key');
    expect(row).toContain('"m:courier:" + key');
    expect(row).toContain('"free:" + key');
    expect(row).not.toContain("m:parcel:");
  });

  it("…and the guard no longer looks at the column they cannot reach", async () => {
    const { belowCostCells, parseShippingRules } = await import("@/lib/shipping");
    // Poland has no parcel-machine chip in the checkout and no «Пакомат» box
    // in the panel; the guard used to refuse a save over this very cell
    expect(belowCostCells(parseShippingRules({ methods: { parcel: { PL: 0.01 } } }))).toEqual([]);
    // …while the cell one column over, which HAS a box, is still refused
    expect(belowCostCells(parseShippingRules({ methods: { courier: { PL: 0.01 } } }))).toHaveLength(1);
    // …and so is every carrier chip the shopper picks himself
    expect(belowCostCells(parseShippingRules({ carriers: { dpd: { FI: 0.01 } } }))).toHaveLength(1);
  });
});
