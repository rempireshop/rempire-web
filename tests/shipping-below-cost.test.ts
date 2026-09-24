/**
 * A delivery price under Montonio's tariff: asked about, not lost.
 *
 * Ренат, 23.09.2026 (the /test checklist), on «Цены доставки»: «I did this
 * change, but the text in the message cannot be seen to the end: Цена ниже
 * тарифа Montonio: Пакомат Omniva, Эстония — 1,00 € при тарифе 3,19 €; …
 * и ещё 12.» And one check later, on the rate table: «Now when I go back, the
 * prices are not there anymore.» settings.shipping_rules had last been
 * written on 19.09 — his save never happened:
 *
 *   · the server refused it outright (below_cost) — there was no way to say
 *     «yes, cheaper on purpose»;
 *   · the panel had said «Тарифы доставки сохранены» before the PUT answered;
 *   · the refusal was a three-line toast, cut after six cells and «и ещё 12»;
 *   · a feed landing later dropped the unsaved draft from the boxes.
 *
 * Now: «Сохранить» lists every cell under the tariff on the confirm card, and
 * «Сохранить всё равно» saves them (acceptBelowCost). Nothing below the
 * tariff is stored without it.
 *
 * The server half is called for real against PGlite; the panel's functions
 * are sliced out of public/shop2/app.js by source text and run on stubs
 * (tests/settings-audit-r21.test.ts's technique).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  belowCostCells,
  belowCostMessage,
  cleanShippingRules,
  parseShippingRules,
  type ShippingRules,
} from "@/lib/shipping";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
const css = readFileSync(fileURLToPath(new URL("../public/shop2/admin.css", import.meta.url)), "utf8");

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

/** The SOURCE of a `var <name> = <literal>;` in app.js, brackets and all. */
function literalSrc(name: string): string {
  const at = src.indexOf(`var ${name} = `);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  const open = at + `var ${name} = `.length;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{" || src[i] === "[") depth++;
    else if (src[i] === "}" || src[i] === "]") {
      if (--depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unterminated literal for ${name}`);
}

type Cell = { carrier: string; country: string; method: string; charged: number; cost: number };
type Row = { carriers?: Record<string, Record<string, number>>; methods?: Record<string, Record<string, number>> };

const MONTONIO = new Function(`return ${literalSrc("MONTONIO_PRICE")};`)() as {
  carriers: Record<string, Record<string, number>>;
  courier: Record<string, [number, string]>;
};

/** Every box on the rate screen one cent under what an empty box charges. */
function allUnder(): Row {
  const carriers: Record<string, Record<string, number>> = {};
  for (const [c, row] of Object.entries(MONTONIO.carriers)) {
    for (const [k, p] of Object.entries(row)) (carriers[c] ??= {})[k] = Math.round((p - 0.01) * 100) / 100;
  }
  const courier: Record<string, number> = {};
  for (const [k, [p]] of Object.entries(MONTONIO.courier)) courier[k] = Math.round((p - 0.01) * 100) / 100;
  return { carriers, methods: { parcel: {}, courier, pickup: {} } };
}

/** The Renat case: Omniva's Estonian and Latvian lockers at 1 € and 2 €, plus twelve more. */
function renatsRow(): Row {
  return {
    carriers: {
      omniva: { EE: 1, LV: 2, LT: 2 },
      smartpost: { EE: 1, FI: 5, LT: 2, LV: 2 },
      dpd: { EE: 1, FI: 5, LT: 2, LV: 2 },
      unisend: { EE: 1, LT: 2, LV: 2 },
    },
    methods: { parcel: {}, courier: {}, pickup: {} },
  };
}

/* ------------------------------------------------------------------------ *
 * 1. The server: refused unless asked, stored when asked
 * ------------------------------------------------------------------------ */

describe("PUT /api/admin/settings — a price below Montonio's tariff", () => {
  const ORIGIN = "https://rempireshop.com";
  let admin = "";

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(async () => {
    await teardownDb();
  });
  beforeEach(async () => {
    resetRateLimits();
    await truncateAll();
  });

  async function put(body: unknown): Promise<Response> {
    const { PUT } = await import("@/app/api/admin/settings/route");
    return PUT(new Request(`${ORIGIN}/api/admin/settings/`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify(body),
    }));
  }
  async function stored(): Promise<Record<string, unknown>> {
    const { GET } = await import("@/app/api/admin/settings/route");
    const res = await GET(new Request(`${ORIGIN}/api/admin/settings/`, { headers: { cookie: admin } }));
    return ((await res.json()) as { settings: Record<string, unknown> }).settings;
  }

  it("refuses them when the request did not ask, and stores nothing", async () => {
    const res = await put({ shipping_rules: renatsRow() });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; cells: Cell[]; detail: string };
    expect(body.error).toBe("below_cost");
    expect(body.cells).toHaveLength(14);
    expect((await stored()).shipping_rules).toBeUndefined();
  });

  it("stores them after «Сохранить всё равно», every cell as typed", async () => {
    const res = await put({ settings: { shipping_rules: renatsRow() }, acceptBelowCost: true });
    expect(res.status).toBe(200);
    const rules = (await stored()).shipping_rules as Row;
    expect(rules.carriers?.omniva).toEqual({ EE: 1, LV: 2, LT: 2 });
    expect(rules.carriers?.dpd?.FI).toBe(5);
    // …and the till bills them: the Estonian Omniva locker at the owner's 1 €
    const { quoteFromRules } = await import("@/lib/shipping");
    const live = parseShippingRules(rules);
    expect(quoteFromRules(live, { country: "EE", method: "parcel", carrier: "omniva", subtotal: 20 }).price).toBe(1);
  });

  it("writes which cells were confirmed into the audit line", async () => {
    await put({ settings: { shipping_rules: renatsRow() }, acceptBelowCost: true });
    const rows = await query<{ payload: { key: string; belowCost?: Cell[] } }>(
      "select payload from admin_audit where action = 'setting.set' order by id desc limit 1",
    );
    expect(rows[0].payload.key).toBe("shipping_rules");
    expect(rows[0].payload.belowCost).toHaveLength(14);
  });

  it("never stores the flag as a setting of its own, in the flat-map form either", async () => {
    const res = await put({ shipping_rules: renatsRow(), acceptBelowCost: true });
    expect(res.status).toBe(200);
    const all = await stored();
    expect(all).not.toHaveProperty("acceptBelowCost");
    expect((all.shipping_rules as Row).carriers?.omniva?.EE).toBe(1);
  });

  it("takes only a literal true — «yes», 1 and a string are still refused", async () => {
    for (const flag of ["yes", 1, "true"]) {
      const res = await put({ settings: { shipping_rules: renatsRow() }, acceptBelowCost: flag });
      expect([flag, res.status]).toEqual([flag, 400]);
    }
    expect((await stored()).shipping_rules).toBeUndefined();
  });

  it("a flag alone is not a save", async () => {
    const res = await put({ acceptBelowCost: true });
    expect(res.status).toBe(400);
  });
});

/* ------------------------------------------------------------------------ *
 * 2. The sentence names every cell
 * ------------------------------------------------------------------------ */

describe("belowCostMessage — nothing cut off", () => {
  it("lists all fourteen cells of the reported save, with no «и ещё»", () => {
    const bad = belowCostCells(cleanShippingRules(renatsRow()) as ShippingRules);
    expect(bad).toHaveLength(14);
    const said = belowCostMessage(bad);
    expect(said).not.toContain("и ещё");
    expect(said).toContain("Пакомат Omniva, Эстония — 1,00 € при тарифе 3,19 €");
    expect(said).toContain("Пакомат Unisend, Латвия — 2,00 € при тарифе 3,79 €");
    expect(said).toContain("«Сохранить всё равно»");
  });
});

/* ------------------------------------------------------------------------ *
 * 3. The panel asks before it sends — and asks about the same cells
 * ------------------------------------------------------------------------ */

type Panel = {
  shipLowCells: (r: Row) => Cell[];
  shipSaveAction: (r: Row) => { title: string; detail: string; ok?: string; belowCost?: boolean; rules: Row };
  srvPush: (a: unknown, entry?: unknown) => void;
  pending: () => { title: string; detail: string; ok?: string; belowCost?: boolean; rules: Row } | null;
  setRollback: (b: unknown) => void;
};

function panel(scope: {
  S: Record<string, unknown>;
  stored: Row;
  answer?: { status: number; body?: unknown };
  puts?: unknown[];
  toasts?: Array<[string, unknown]>;
}): Panel {
  const body = `
    var MONTONIO_PRICE = ${literalSrc("MONTONIO_PRICE")};
    var SHIP_ROWS = ${literalSrc("SHIP_ROWS")};
    var CARRIER_NAMES = ${literalSrc("CARRIER_NAMES")};
    var pendingAction = null, shipRollback = null;
    // a save the server took is remembered over a stale feed (shipping-save-sticks.test.ts)
    var shipFresh = null, SHIP_FRESH_LS = "rempire-ship-fresh";
    var localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
    var SHIP_STORED = STORED;
    var DEMO = { log: [] };
    function cloneRules(r) { return JSON.parse(JSON.stringify(r)); }
    function countryName(c) { return c; }
    function refocus() {}
    function render() {}
    function noop() {}
    function demoSave() {}
    function setShipRules(r) { SHIP_STORED = r; }
    function apiSend(url, method, b) { PUTS.push({ url: url, method: method, body: b }); return Promise.resolve(ANSWER); }
    function toast(t, u) { TOASTS.push([t, u || null]); }
    ${slice("eur")}
    ${slice("shipLowCells")}
    ${slice("shipPlaceName")}
    ${slice("shipLowLine")}
    ${slice("shipLowAction")}
    ${slice("shipSaveAction")}
    ${slice("shipLowAsk")}
    ${slice("shipBody")}
    ${slice("shipSavedText")}
    ${slice("shipSavedOk")}
    ${slice("shipFreshNote")}
    ${slice("shipRulesRefused")}
    ${slice("srvSaved")}
    ${slice("srvPush")}
    return {
      shipLowCells: shipLowCells, shipSaveAction: shipSaveAction, srvPush: srvPush,
      pending: function () { return pendingAction; },
      setRollback: function (b) { shipRollback = b; }
    };
  `;
  return new Function("S", "SRV", "STORED", "ANSWER", "PUTS", "TOASTS", body)(
    scope.S, { admin: true }, scope.stored, scope.answer ?? { status: 200, body: { ok: true } },
    scope.puts ?? [], scope.toasts ?? [],
  ) as Panel;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("the panel's own list agrees with the server's refusal", () => {
  const p = panel({ S: { lang: "RU" }, stored: {} });
  const key = (c: Cell) => `${c.method}:${c.carrier}:${c.country}:${c.charged}:${c.cost}`;
  const server = (row: Row) => belowCostCells(cleanShippingRules(row) as ShippingRules).map(key).sort();
  const client = (row: Row) => p.shipLowCells(row).map(key).sort();

  it("every box on the screen a cent under its price — the same cells, the same numbers", () => {
    const row = allUnder();
    expect(client(row).length).toBeGreaterThan(30);
    expect(client(row)).toEqual(server(row));
  });

  it("the reported save", () => {
    expect(client(renatsRow())).toEqual(server(renatsRow()));
  });

  it("at the price exactly, above it, and cells no box edits — nothing", () => {
    const at: Row = { carriers: { omniva: { EE: 3.19 } }, methods: { parcel: { PL: 0.5 }, courier: { EE: 6.89, default: 1, EU: 1 }, pickup: {} } };
    expect(client(at)).toEqual([]);
    expect(server(at)).toEqual([]);
  });
});

describe("«Сохранить» on «Доставка и оплата»", () => {
  const p = panel({ S: { lang: "RU" }, stored: {} });

  it("asks the ordinary question when every price is at or above Montonio's", () => {
    const a = p.shipSaveAction({ carriers: { dpd: { LV: 6.49 } }, methods: { parcel: {}, courier: {}, pickup: {} } });
    expect(a.title).toBe("Изменить тарифы доставки?");
    expect(a.belowCost).toBeFalsy();
    expect(a.ok).toBeUndefined();
  });

  it("lists EVERY cell under the tariff, one per line, and offers «Сохранить всё равно»", () => {
    const a = p.shipSaveAction(renatsRow());
    expect(a.title).toBe("Цена ниже тарифа Montonio");
    expect(a.ok).toBe("Сохранить всё равно");
    expect(a.belowCost).toBe(true);
    const lines = a.detail.split("\n");
    expect(lines).toHaveLength(14 + 2);
    expect(a.detail).not.toContain("и ещё");
    expect(lines).toContain("Omniva · Эстония · 1 € (Montonio 3,19 €)");
    expect(lines).toContain("Unisend · Латвия · 2 € (Montonio 3,79 €)");
    expect(lines).toContain("DPD · Финляндия · 5 € (Montonio 12,39 €)");
  });

  it("names a courier cell by its column", () => {
    const a = p.shipSaveAction({ methods: { parcel: {}, courier: { DE: 9.9 }, pickup: {} } });
    expect(a.detail.split("\n")).toContain("Курьер · DE · 9,90 € (Montonio 17,59 €)");
  });
});

describe("what the save sends, and what the screen says afterwards", () => {
  it("«Сохранить всё равно» sends acceptBelowCost beside the settings, not inside them", async () => {
    const puts: Array<{ body: unknown }> = [];
    const S: Record<string, unknown> = { lang: "RU", admSetPage: "delivery" };
    const p = panel({ S, stored: renatsRow(), puts: puts as unknown[] });
    const a = p.shipSaveAction(renatsRow());
    p.srvPush(a, { txt: "x" });
    await tick();
    expect(puts).toHaveLength(1);
    expect(puts[0].body).toEqual({ settings: { shipping_rules: renatsRow() }, acceptBelowCost: true });
  });

  it("an ordinary save sends no flag — the server's guard still stands", async () => {
    const puts: Array<{ body: unknown }> = [];
    const p = panel({ S: { lang: "RU" }, stored: { carriers: { dpd: { LV: 6.49 } } }, puts: puts as unknown[] });
    p.srvPush({ type: "set_shipping_rules", rules: {}, full: true }, { txt: "x" });
    await tick();
    expect(puts[0].body).toEqual({ shipping_rules: { carriers: { dpd: { LV: 6.49 } } } });
  });

  it("says «Тарифы доставки сохранены» only once the server said 200 — «Сохраняем…» until then", async () => {
    const toasts: Array<[string, unknown]> = [];
    const S: Record<string, unknown> = { lang: "RU", admSetPage: "delivery", admSetSaved: "" };
    const entry = { txt: "Тарифы" };
    const p = panel({ S, stored: {}, toasts });
    p.srvPush({ type: "set_shipping_rules", rules: {}, full: true }, entry);
    expect(S.shipSaving).toBe(true);
    expect(S.admSetSaved).toBe("");
    expect(toasts).toEqual([]);
    await tick();
    expect(S.shipSaving).toBe(false);
    expect(toasts).toEqual([["Тарифы доставки сохранены", entry]]);
    expect(S.admSetSaved).toBe("delivery");
  });

  it("a refusal it did not ask about: his numbers back in the boxes, «Не сохранено», and the card that asks", async () => {
    const tried = renatsRow();
    const was = { carriers: {}, methods: { parcel: {}, courier: {}, pickup: {} } };
    const cells = belowCostCells(cleanShippingRules(tried) as ShippingRules);
    const toasts: Array<[string, unknown]> = [];
    const S: Record<string, unknown> = { lang: "RU", admSetPage: "delivery", admSetSaved: "", shipDraft: null };
    const p = panel({
      S, stored: tried, toasts,
      answer: { status: 400, body: { ok: false, error: "below_cost", detail: belowCostMessage(cells), cells } },
    });
    // the assistant's card, or an older tab: a table sent without the flag
    p.setRollback({ was, tried, entry: null });
    p.srvPush({ type: "set_shipping_rules", rules: tried, full: true }, { txt: "x" });
    await tick();

    expect(S.shipSaving).toBe(false);
    expect(S.shipDraft).toEqual(tried);           // the boxes hold what he typed → the bar says «Не сохранено»
    expect(S.admSetSaved).toBe("");              // never «Сохранено ✓»
    expect(toasts.map((t) => t[0])).toEqual(["Не сохранено: цена ниже тарифа Montonio"]);
    expect(S.shipLow).toHaveLength(14);          // the page's box lists every cell
    const card = p.pending();
    expect(card?.belowCost).toBe(true);
    expect(card?.ok).toBe("Сохранить всё равно");
    expect(card?.rules).toEqual(tried);
    expect(card?.detail.split("\n")).toHaveLength(16);
  });

  it("any other failure puts the draft back and asks nothing", async () => {
    const tried = { carriers: { dpd: { LV: 6.49 } } };
    const S: Record<string, unknown> = { lang: "RU", admSetPage: "delivery", admSetSaved: "", shipDraft: null };
    const p = panel({ S, stored: tried, answer: { status: 503, body: { ok: false, error: "db_unavailable" } } });
    p.setRollback({ was: {}, tried, entry: null });
    p.srvPush({ type: "set_shipping_rules", rules: tried, full: true }, { txt: "x" });
    await tick();
    expect(S.shipDraft).toEqual(tried);
    expect(p.pending()).toBeNull();
  });
});

describe("the screen around it", () => {
  it("the confirm card never outgrows the screen: the list scrolls, the buttons stay", () => {
    const card = css.slice(css.indexOf(".adm-confirm__card {"), css.indexOf("}", css.indexOf(".adm-confirm__card {")));
    expect(card).toMatch(/max-height:\s*100%/);
    const d = css.slice(css.indexOf(".adm-confirm__d {"), css.indexOf("}", css.indexOf(".adm-confirm__d {")));
    expect(d).toMatch(/overflow-y:\s*auto/);
    expect(d).toMatch(/min-height:\s*0/);
    expect(css).toMatch(/\.adm-confirm__acts \{ flex: none; \}/);
  });

  it("a feed that lands while prices are typed but not saved leaves them in the boxes", () => {
    const adopt = slice("adoptServer");
    expect(adopt).toContain("var keepShipDraft = shipDirty();");
    expect(adopt).toContain("if (!keepShipDraft) S.shipDraft = null;");
  });

  it("the page's refusal box sits above the table, not under the preview", () => {
    const page = slice("admSetDeliveryHTML");
    expect(page.indexOf("admShipErrHTML()")).toBeGreaterThan(0);
    expect(page.indexOf("admShipErrHTML()")).toBeLessThan(page.indexOf("SHIP_ROWS.map"));
  });
});
