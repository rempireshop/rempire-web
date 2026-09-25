/**
 * Five places where the owner's panel said something that was not true, all
 * found by the r19 audit sweep and all in public/shop2/app.js:
 *
 *   · «Обзор → Сегодня» dropped a sale out of the day's takings the moment
 *     «Доставлен» was pressed, and counted the day on the browser's calendar
 *     rather than on Tallinn's;
 *   · a delivery price the server REFUSED (below Montonio's own cost) was
 *     applied to the panel anyway, announced as «Тарифы доставки сохранены»
 *     and left «Сохранено ✓» lit;
 *   · «О компании» wrote the built-in defaults over the shop's real IBAN,
 *     address and social links when the document had never loaded;
 *   · an emptied «Бесплатно от» kept the old number in the announce bar, the
 *     footer and the product page while the checkout charged for delivery;
 *   · a failed GET /api/admin/settings drew the built-in defaults as the
 *     shop's own settings, and a save persisted them.
 *
 * The storefront is a vanilla-JS IIFE with no DOM here, so the functions are
 * **sliced out of app.js by source text** and run against stubs — the same
 * technique tests/checkout-parity.test.ts and tests/shipping-admin-mirror.ts
 * use. Retyping them would test this file instead of the shop, and the slice
 * fails loudly if app.js drops or renames one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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

/** Build a callable from one or more sliced functions plus named stubs. */
function build<T>(names: string[], scope: Record<string, unknown>, expr = names[0]): T {
  const keys = Object.keys(scope);
  const body = names.map(slice).join("\n") + `\nreturn ${expr};`;
  return new Function(...keys, body)(...keys.map((k) => scope[k])) as T;
}

/* ---------- «Обзор → Сегодня» ---------------------------------------------- */

describe("today's takings on «Обзор»", () => {
  type Vm = { srv: { createdAt: string }; status: string; sum: number; pos?: boolean };
  const takings = () =>
    build<(vms: Vm[]) => { sum: number; n: number; pos: number }>(["admTodayTakings", "admShopDay"], {});

  /** Noon in Tallinn today, as an instant — safely inside the shop's own day. */
  function todayNoonISO(): string {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Tallinn", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    return `${day}T09:00:00.000Z`; // 12:00 Tallinn in summer, 11:00 in winter — both inside the day
  }

  it("counts a delivered order — pressing the last button must not unmake the sale", () => {
    const at = todayNoonISO();
    const rows: Vm[] = [
      { srv: { createdAt: at }, status: "paid", sum: 30 },
      { srv: { createdAt: at }, status: "shipped", sum: 20 },
      // the one that used to vanish from the day's money
      { srv: { createdAt: at }, status: "delivered", sum: 50 },
    ];
    expect(takings()(rows)).toEqual({ sum: 100, n: 3, pos: 0 });
  });

  it("still leaves out what is not a sale", () => {
    const at = todayNoonISO();
    const rows: Vm[] = [
      { srv: { createdAt: at }, status: "paid", sum: 10 },
      { srv: { createdAt: at }, status: "new", sum: 999 },
      { srv: { createdAt: at }, status: "cancelled", sum: 999 },
      { srv: { createdAt: at }, status: "refunded", sum: 999 },
      { srv: { createdAt: at }, status: "failed", sum: 999 },
    ];
    expect(takings()(rows)).toMatchObject({ sum: 10, n: 1 });
  });

  it("names the day on the Tallinn calendar, not on the browser's", () => {
    /* 21:30 UTC on the 13th is 00:30 on the 14th in Tallinn: the shop has
       already turned the page. A browser sitting in UTC (or anywhere west of
       Tallinn) used to file this order under the 13th and drop it out of
       «Сегодня» — the figure the owner reads at the start of his day. */
    const rows: Vm[] = [{ srv: { createdAt: "2026-09-13T21:30:00.000Z" }, status: "paid", sum: 42 }];
    const fn = build<(vms: Vm[]) => { sum: number }>(
      ["admTodayTakings", "admShopDay"],
      // pin "now" to that same instant, so "today" is the 14th in Tallinn
      { Date: class extends Date { constructor(...a: unknown[]) { if (!a.length) super("2026-09-13T21:30:00.000Z"); else super(...(a as [string])); } } },
    );
    expect(fn(rows).sum).toBe(42);
  });

  it("ignores a row the panel has no server order for, and an unreadable date", () => {
    const rows = [
      { status: "paid", sum: 99 },
      { srv: { createdAt: "not a date" }, status: "paid", sum: 99 },
    ] as unknown as Vm[];
    expect(takings()(rows)).toEqual({ sum: 0, n: 0, pos: 0 });
  });
});

/* ---------- «Бесплатно от» emptied ------------------------------------------ */

describe("an emptied «Бесплатно от» stops the shop promising free delivery", () => {
  type Thresh = Record<string, number | null>;

  function thresholds(rules: Record<string, unknown>): Thresh {
    const THRESH: Thresh = { EE: 59, LV: 59, LT: 59, FI: 59, EU: 200 };
    const fn = build<() => void>(["refreshShipThresholds"], { SHIP_RULES: rules, THRESH });
    fn();
    return THRESH;
  }

  it("carries the null instead of keeping the last real number", () => {
    // what the panel stores when the box is emptied — setShipDraftField()
    expect(thresholds({ freeFrom: null, freeFromByCountry: { EU: 200 } }))
      .toEqual({ EE: null, LV: null, LT: null, FI: null, EU: 200 });
    // …and one country switched off on its own
    expect(thresholds({ freeFrom: 59, freeFromByCountry: { EE: null, EU: 200 } }))
      .toMatchObject({ EE: null, LV: 59, EU: 200 });
  });

  const lines = (THRESH: Thresh) =>
    build<{ pdp: () => string; ftr: () => string }>(
      ["pdpShipLine", "ftrShipLine"], { THRESH }, "({ pdp: pdpShipLine, ftr: ftrShipLine })",
    );

  it("drops the clause from the product page and the footer when there is no floor", () => {
    const off = lines({ EE: null });
    expect(off.pdp()).not.toContain("бесплатно");
    expect(off.ftr()).not.toContain("бесплатно");
    // …and both shapes are real dictionary keys, or the shop speaks Russian
    // to an Estonian (see the UI/UI_RX tables in app.js)
    expect(src).toContain(`"${off.pdp()}":`);
    expect(src).toContain(`"${off.ftr()}":`);
  });

  it("still quotes the floor when there is one", () => {
    const on = lines({ EE: 59 });
    expect(on.pdp()).toContain("бесплатно от 59 €");
    expect(on.ftr()).toContain("бесплатно от 59 €");
  });

  it("empties the announce line rather than quoting a floor that is gone", () => {
    const text = "Бесплатная доставка: Эстония от {EE} € · LV, LT от {LV} € · Финляндия от {FI} €";
    const live = build<(s: string) => string>(["cTokens"], { THRESH: { EE: 59, LV: 79, LT: 79, FI: 99 } });
    expect(live(text)).toBe("Бесплатная доставка: Эстония от 59 € · LV, LT от 79 € · Финляндия от 99 €");

    const gone = build<(s: string) => string>(["cTokens"], { THRESH: { EE: 59, LV: 79, LT: 79, FI: null } });
    expect(gone(text)).toBe("");
  });
});

/* ---------- a refused delivery-price save ----------------------------------- */

/* 1a (25.09.2026): the table saves itself through its settings slot —
   shipPut() is the slot's `send`. A price the server refuses (below_cost —
   one this panel's own mirror did not catch) is held at its box, the table
   the shop runs on goes back to the server's, and the rest of the change is
   sent again; any other failure is the slot's to show («Не сохранилось —
   Повторить») with the change still owed, nothing rolled back. */
function shipRig(answers: Array<{ status: number; body: unknown }>) {
  const puts: any[] = [];
  const body = `
    var S = { shipDraft: null, shipLow: null, shipErr: "" };
    var SHIP_STORED_DEFAULT = { freeFrom: 59, methods: { parcel: {}, courier: {}, pickup: {} }, carriers: {} };
    var SHIP_STORED = { freeFrom: 59, methods: { parcel: {}, courier: {}, pickup: {} }, carriers: { dpd: { LV: 6.49 }, omniva: { EE: 1 } } };
    var shipServerRow = { freeFrom: 59, methods: { parcel: {}, courier: {}, pickup: {} }, carriers: {} };
    var SHIP_ACCEPT = {};
    var toasts = [];
    function cloneRules(r) { return JSON.parse(JSON.stringify(r)); }
    function setShipRules(r) { SHIP_STORED = cloneRules(r); }
    function shipLowCells() { return []; }   // this panel's mirror: nothing under the tariff
    function shipFreshNote() {}
    function render() {}
    function toast(t) { toasts.push(t); }
    function apiSend(url, m, b) { PUTS.push(JSON.parse(JSON.stringify(b))); return Promise.resolve(ANSWERS.shift()); }
    ${["admAutosaveOk", "jsonCanon", "shipSig", "shipCellKey", "shipRowCell", "shipRowSet", "shipAccepted",
      "shipLowAll", "shipHeldCells", "shipGate", "shipPut"].map(slice).join("\n")}
    return {
      put: shipPut,
      stored: function () { return SHIP_STORED; },
      server: function () { return shipServerRow; },
      S: S, toasts: toasts
    };`;
  const rig = new Function("PUTS", "ANSWERS", body)(puts, answers.slice()) as {
    put: (note: unknown) => Promise<unknown>; stored: () => any; server: () => any; S: any; toasts: string[];
  };
  return { ...rig, puts };
}

describe("a delivery-price save the server refuses", () => {
  it("holds the refused price at its box and saves the rest of the change", async () => {
    const cell = { carrier: "omniva", country: "EE", method: "parcel", charged: 1, cost: 3.19 };
    const rig = shipRig([
      { status: 400, body: { ok: false, error: "below_cost", cells: [cell] } },
      { status: 200, body: { ok: true } },
    ]);
    const answer = await rig.put({ toast: "Тарифы доставки сохранены" });
    expect(rig.puts).toHaveLength(2);
    expect(rig.puts[0].settings.shipping_rules.carriers).toEqual({ dpd: { LV: 6.49 }, omniva: { EE: 1 } });
    // the second write: the refused price out, the owner's other price in
    expect(rig.puts[1].settings.shipping_rules.carriers).toEqual({ dpd: { LV: 6.49 } });
    expect(answer).toEqual({ status: 200, body: { ok: true } });
    // the till runs on what the server holds; the box still shows his number, rust
    expect(rig.stored().carriers).toEqual({ dpd: { LV: 6.49 } });
    expect(rig.S.shipDraft.carriers.omniva).toEqual({ EE: 1 });
    expect(rig.S.shipLow).toEqual([cell]);
    expect(rig.server().carriers).toEqual({ dpd: { LV: 6.49 } });
  });

  it("any other failure is the slot's: the answer goes back, nothing is rolled back", async () => {
    const rig = shipRig([{ status: 503, body: { ok: false, error: "db_unavailable" } }]);
    const answer = await rig.put({ toast: "Тарифы доставки сохранены" });
    expect(answer).toEqual({ status: 503, body: { ok: false, error: "db_unavailable" } });
    expect(rig.toasts).toEqual([]);                    // never «сохранены» without a 2xx
    expect(rig.stored().carriers.omniva).toEqual({ EE: 1 });   // still owed — «Повторить» sends it
    expect(rig.server().carriers).toEqual({});
  });

  it("srvPush hands the table to its slot, whoever applied it", () => {
    const push = slice("srvPush");
    expect(push).toContain("if (a && ADM_SET_OF[a.type])");
    expect(push).toContain("admSetPut(ADM_SET_OF[a.type])");
    expect(src).toContain('set_shipping_rules: "shipping_rules"');
    expect(slice("admSetSend")).toContain('if (key === "shipping_rules") return shipPut(note);');
  });
});

/* ---------- the two documents a failed read must not overwrite --------------- */

describe("nothing is saved over the shop's own settings before they have been read", () => {
  it("a failed GET /api/admin/settings leaves S.pricingLoaded alone and says so", async () => {
    const S: Record<string, unknown> = {};
    let renders = 0;
    let calls = 0;
    const load = build<(force?: boolean) => void>(["loadAdminPricing"], {
      SRV: { admin: true },
      S,
      apiJson: () => { calls++; return Promise.resolve({ status: 503, body: {} }); },
      normalisePricing: () => ({ partnersOn: false, proDiscountPct: 20 }),
      normaliseDelivery: () => ({}),
      adoptPricingLocally: () => {},
      render: () => { renders++; },
    });

    load(false);
    await Promise.resolve(); await Promise.resolve();
    expect(calls).toBe(1);
    // the built-in defaults are NOT the shop's settings
    expect(S.pricingLoaded).toBeUndefined();
    expect(S.pricingLoadErr).toBe(true);
    expect(renders).toBe(1);

    // …and the card's own loadAdminPricing(false) does not re-fire on every render
    load(false);
    expect(calls).toBe(1);
    // «Повторить» does
    S.pricingLoadErr = false;
    load(true);
    expect(calls).toBe(2);
  });

  it("the card draws the error and a «Повторить» instead of the defaults", () => {
    const card = slice("admPricingCard");
    expect(card).toContain("S.pricingLoadErr");
    expect(card).toContain('data-admreload="pricing"');
    // and the retry is wired into the one delegated handler
    expect(src).toContain('d.admreload === "pricing"');
  });

  it("every write on that screen is gated on a real read having landed", () => {
    expect(slice("admPricingSave")).toContain("adminSettingsReady()");
    /* «Спрашивать перевозчика», «Закрывать заказ через» and the bank switches
       all PUT a whole object assembled from the same read. Since 1a
       (25.09.2026) a change made before it lands is not refused — the owner's
       tap waits for the read and goes the moment it lands (admSetWhenReady),
       computed over the shop's real values; never before. */
    expect(slice("admSetWhenReady")).toContain("if (adminSettingsReady()) { fn(); return null; }");
    expect(slice("loadAdminPricing")).toContain("admSetWaitFlush();");
    const waits = src.match(/admSetWhenReady\(function \(\) \{/g)?.length ?? 0;
    expect(waits, "the switches, the pick and the boxes all wait for the read").toBeGreaterThanOrEqual(8);
    expect(src).not.toContain('if (!adminSettingsReady()) { toast("Настройки магазина сейчас не отвечают');
  });

  it("a change made before the read waits for it and then goes, over the shop's values", () => {
    const S: Record<string, unknown> = { pricingLoaded: null, pricingLoadErr: false };
    const loads: boolean[] = [];
    const fns = new Function("S", "LOADS", `
      function loadAdminPricing(force) { LOADS.push(!!force); }
      ${slice("adminSettingsReady")}
      var ADM_SET_WAIT = [];
      ${slice("admSetWhenReady")}
      ${slice("admSetWaitFlush")}
      return { when: admSetWhenReady, flush: admSetWaitFlush };`)(S, loads) as {
      when: (fn: () => void) => Promise<unknown> | null; flush: () => void;
    };
    const ran: string[] = [];
    const w = fns.when(() => ran.push("days 7 over " + JSON.stringify(S.pricingLoaded)));
    expect(w, "a change before the read did not wait").toBeInstanceOf(Promise);
    expect(ran).toEqual([]);
    expect(loads, "nobody asked for the read").toEqual([false]);
    fns.flush();                        // the read has not landed: still waiting
    expect(ran).toEqual([]);
    S.pricingLoaded = { partnersOn: true };
    fns.flush();                        // …and now it has
    expect(ran).toEqual(['days 7 over {"partnersOn":true}']);
    // after the read, a change goes at once
    expect(fns.when(() => ran.push("now"))).toBeNull();
    expect(ran).toHaveLength(2);
  });

  it("«О компании» refuses to save until the document has really been read", () => {
    const loaded = build<() => boolean>(["contentLoaded"], { DEMO: { content: null } });
    expect(loaded()).toBe(false);
    const filled = build<() => boolean>(["contentLoaded"], { DEMO: { content: { company: { iban: "EE00" } } } });
    expect(filled()).toBe(true);
    // an array is not a document either
    const array = build<() => boolean>(["contentLoaded"], { DEMO: { content: [] } });
    expect(array()).toBe(false);

    /* The gate itself: every field's own save and «Вернуть стандартные» send
       { content: DEMO.content } in full (admSetSend), so both have to hold. */
    expect(slice("admContentCommit")).toContain("if (!contentLoaded())");
    const resetAt = src.indexOf("if (d.contentreset !== undefined) {");
    expect(resetAt).toBeGreaterThan(0);
    expect(src.slice(resetAt, resetAt + 380)).toContain("if (!contentLoaded())");
  });
});
