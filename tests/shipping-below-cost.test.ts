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
 * Then (23.09.2026): «Сохранить» listed every such cell on a confirm card with
 * «Сохранить всё равно» (acceptBelowCost). Since 1a (Dim, 25.09.2026, q4) the
 * table saves itself: each such box turns rust with «Оставить так», is held
 * out of the save until that tap, and the tap sends acceptBelowCost. Nothing
 * below the tariff is stored without it.
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
 * 3. The panel holds such a price at its box — and names the same cells
 *
 * 1a (Dim, 25.09.2026, q4): the table saves itself, so there is no
 * «Сохранить» to ask on and no sheet. A box under Montonio's price turns
 * rust with «Ниже тарифа Montonio» and «Оставить так»; it is NOT sent until
 * that tap (shipGate) — the rest of the table saves around it — and the tap
 * sends the server's own accept flag. The server still refuses a save that
 * never asked; the refused cells are held at their boxes the same way.
 * ------------------------------------------------------------------------ */

type Gate = { send: Row; held: Cell[] };
type Panel = {
  shipLowCells: (r: Row) => Cell[];
  gate: (r: Row) => Gate;
  accept: (key: string, v: number) => void;
  put: (note: Record<string, unknown>) => Promise<unknown>;
  setStored: (r: Row) => void;
  setServer: (r: Row | null) => void;
  stored: () => Row;
  S: Record<string, unknown>;
};

function panel(scope: {
  stored?: Row;
  server?: Row | null;
  answers?: Array<{ status: number; body?: unknown }>;
  puts?: unknown[];
  toasts?: Array<[string, unknown]>;
}): Panel {
  const body = `
    var MONTONIO_PRICE = ${literalSrc("MONTONIO_PRICE")};
    var SHIP_ROWS = ${literalSrc("SHIP_ROWS")};
    var CARRIER_NAMES = ${literalSrc("CARRIER_NAMES")};
    var S = { lang: "RU", shipDraft: null, shipLow: null, shipErr: "" };
    var SHIP_STORED_DEFAULT = { freeFrom: 59, methods: { parcel: {}, courier: {}, pickup: {} }, carriers: {} };
    var SHIP_STORED = STORED, shipServerRow = SERVER, SHIP_ACCEPT = {};
    // a save the server took is remembered over a stale feed (shipping-save-sticks.test.ts)
    var shipFresh = null, SHIP_FRESH_LS = "rempire-ship-fresh";
    var localStorage = { getItem: function () { return null; }, setItem: function () {}, removeItem: function () {} };
    function cloneRules(r) { return JSON.parse(JSON.stringify(r)); }
    function countryName(c) { return c; }
    function render() {}
    function setShipRules(r) { SHIP_STORED = cloneRules(r); }
    function apiSend(url, method, b) { PUTS.push({ url: url, method: method, body: JSON.parse(JSON.stringify(b)) }); return Promise.resolve(ANSWERS.shift() || { status: 200, body: { ok: true } }); }
    function toast(t, u) { TOASTS.push([t, u || null]); }
    ${["eur", "shipLowCells", "shipPlaceName", "shipLowLine", "shipCellKey", "shipRowCell", "shipRowSet",
      "shipAccepted", "shipLowAll", "shipHeldCells", "shipGate", "shipAcceptRow", "jsonCanon", "shipSig",
      "admAutosaveOk", "shipFreshNote", "shipPut"].map(slice).join("\n")}
    return {
      S: S, shipLowCells: shipLowCells, gate: shipGate, put: shipPut,
      accept: function (k, v) { SHIP_ACCEPT[k] = v; },
      setStored: function (r) { SHIP_STORED = r; },
      setServer: function (r) { shipServerRow = r; },
      stored: function () { return SHIP_STORED; }
    };
  `;
  return new Function("STORED", "SERVER", "ANSWERS", "PUTS", "TOASTS", body)(
    scope.stored ?? {}, scope.server === undefined ? null : scope.server, (scope.answers ?? []).slice(),
    scope.puts ?? [], scope.toasts ?? [],
  ) as Panel;
}

describe("the panel's own list agrees with the server's refusal", () => {
  const p = panel({});
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

describe("a price under the tariff waits for «Оставить так» (q4)", () => {
  const empty: Row = { carriers: {}, methods: { parcel: {}, courier: {}, pickup: {} } };

  it("holds EVERY cell under the tariff, and sends the rest of the table", () => {
    const p = panel({ server: empty });
    const row = renatsRow();
    row.carriers!.dpd.LV = 6.49;   // one price at or above Montonio's among Renat's fourteen
    const g = p.gate(row);
    expect(g.held).toHaveLength(13);
    expect(g.send.carriers).toEqual({ dpd: { LV: 6.49 } });
  });

  it("«Оставить так» lets that one cell through — and only that one", () => {
    const p = panel({ server: empty });
    p.accept("c:omniva:EE", 1);
    const g = p.gate(renatsRow());
    expect(g.held).toHaveLength(13);
    expect(g.send.carriers?.omniva).toEqual({ EE: 1 });
  });

  it("a price the server already holds was accepted when it was stored", () => {
    const p = panel({ server: { carriers: { omniva: { EE: 1 } }, methods: { parcel: {}, courier: {}, pickup: {} } } });
    const g = p.gate({ carriers: { omniva: { EE: 1 }, dpd: { LV: 6.49 } }, methods: { parcel: {}, courier: {}, pickup: {} } });
    expect(g.held).toEqual([]);
  });

  it("…but not a lower number typed over it", () => {
    const p = panel({ server: { carriers: { omniva: { EE: 1 } }, methods: { parcel: {}, courier: {}, pickup: {} } } });
    const g = p.gate({ carriers: { omniva: { EE: 0.5 } }, methods: { parcel: {}, courier: {}, pickup: {} } });
    expect(g.held.map((c) => c.charged)).toEqual([0.5]);
    expect(g.send.carriers?.omniva, "the held cell goes back to what the server holds").toEqual({ EE: 1 });
  });

  it("the cell's line says it and offers the tap — «Оставить так» beside «вернуть»", () => {
    const foot = new Function(`
      var CARRIER_NAMES = ${literalSrc("CARRIER_NAMES")};
      var S = { lang: "RU" }, SHIP_ACCEPT = {}, shipServerRow = null, SHIP_STORED = {};
      ${["eur", "esc", "montonioCarrierTag", "shipRowCell", "shipAccepted", "admRateFootHTML"].map(slice).join("\n")}
      return admRateFootHTML;
    `)() as (k: string, v: string, price: number, carrier: string) => string;
    const held = foot("c:omniva:EE", "1", 3.19, "");
    expect(held).toContain("Ниже тарифа Montonio: 3,19 €");
    expect(held).toContain('data-shipaccept="c:omniva:EE">Оставить так');
    expect(held).toContain('data-shipclear="c:omniva:EE"');
    // at or above the price: the ordinary line, no question
    expect(foot("c:omniva:EE", "3,50", 3.19, "")).not.toContain("data-shipaccept");
  });
});

describe("what the save sends, and what the screen says afterwards", () => {
  it("an accepted price goes with acceptBelowCost beside the settings, not inside them", async () => {
    const puts: Array<{ body: any }> = [];
    const p = panel({ stored: { carriers: { omniva: { EE: 1 } } }, server: null, puts: puts as unknown[] });
    p.accept("c:omniva:EE", 1);
    await p.put({ toast: "x" });
    expect(puts).toHaveLength(1);
    expect(puts[0].body).toEqual({ settings: { shipping_rules: { carriers: { omniva: { EE: 1 } } } }, acceptBelowCost: true });
  });

  it("an ordinary save sends no flag — the server's guard still stands", async () => {
    const puts: Array<{ body: any }> = [];
    const p = panel({ stored: { carriers: { dpd: { LV: 6.49 } } }, puts: puts as unknown[] });
    await p.put({});
    expect(puts[0].body).toEqual({ settings: { shipping_rules: { carriers: { dpd: { LV: 6.49 } } } } });
  });

  it("says «Тарифы доставки сохранены» only once the server said 200", async () => {
    const toasts: Array<[string, unknown]> = [];
    const entry = { txt: "Тарифы" };
    const p = panel({ stored: { carriers: { dpd: { LV: 6.49 } } }, toasts });
    const done = p.put({ toast: "Тарифы доставки сохранены", entry });
    expect(toasts).toEqual([]);
    await done;
    expect(toasts).toEqual([["Тарифы доставки сохранены", entry]]);
  });

  it("only a held price moved: nothing is sent, the box keeps it, and no «сохранены»", async () => {
    const empty: Row = { carriers: {}, methods: { parcel: {}, courier: {}, pickup: {} } };
    const puts: unknown[] = [];
    const toasts: Array<[string, unknown]> = [];
    const p = panel({ stored: { carriers: { omniva: { EE: 1 } }, methods: { parcel: {}, courier: {}, pickup: {} } }, server: empty, puts, toasts });
    expect(await p.put({ toast: "Тарифы доставки сохранены" })).toBe(true);
    expect(puts).toEqual([]);
    expect(toasts).toEqual([]);
    expect((p.S.shipDraft as Row).carriers?.omniva).toEqual({ EE: 1 });
    expect(p.stored().carriers).toEqual({});
  });

  it("a refusal it did not ask about: the cell the server names is held at its box", async () => {
    /* the server's mirror prices a cell higher than this panel's does (or an
       older tab sent it): the refusal names it, and it is held like any other */
    const cell = { carrier: "dpd", country: "LV", method: "parcel" as const, charged: 6.49, cost: 7 };
    const tried: Row = { carriers: { dpd: { LV: 6.49 } }, methods: { parcel: {}, courier: {}, pickup: {} } };
    const puts: Array<{ body: any }> = [];
    const p = panel({
      stored: tried, server: { carriers: {}, methods: { parcel: {}, courier: {}, pickup: {} } }, puts: puts as unknown[],
      answers: [{ status: 400, body: { ok: false, error: "below_cost", detail: belowCostMessage([cell]), cells: [cell] } }],
    });
    expect(await p.put({ toast: "x" })).toBe(true);
    expect(puts).toHaveLength(1);                     // nothing else was left to send
    expect(p.S.shipLow).toEqual([cell]);
    expect(p.S.shipDraft).toEqual(tried);             // his number stays in its box, rust
    expect(p.stored().carriers).toEqual({});          // the till runs on what the server holds
  });

  it("any other failure is the slot's to show and retry — the answer goes back", async () => {
    const p = panel({ stored: { carriers: { dpd: { LV: 6.49 } } }, answers: [{ status: 503, body: { ok: false } }] });
    expect(await p.put({ toast: "x" })).toEqual({ status: 503, body: { ok: false } });
  });
});

describe("the screen around it", () => {
  it("the confirm sheet never outgrows the screen: the list scrolls, the buttons stay", () => {
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

  it("the page's «не сохранено» line sits above the table, not under the preview", () => {
    const page = slice("admSetDeliveryHTML");
    expect(page.indexOf("admShipHeldHTML()")).toBeGreaterThan(0);
    expect(page.indexOf("admShipHeldHTML()")).toBeLessThan(page.indexOf("SHIP_ROWS.map"));
  });
});
