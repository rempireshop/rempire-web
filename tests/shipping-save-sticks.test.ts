/**
 * A confirmed delivery-price save stays saved on screen — the feed the edge
 * still holds from before it does not put the old table back.
 *
 * Дим, /test, 24.09.2026, «Цена доставки ниже Montonio» (bad): «First save
 * did not save and the change in checkout could not be seen. I saved another
 * time (made fields empty) and then the second time it worked.»
 *
 * The PUT with «Сохранить всё равно» landed (tests/shipping-below-cost.test.ts
 * stores it for real). What undid it was the READ that followed.
 * /api/overrides/ — the one feed every screen takes the tariff row from — goes
 * out `public, s-maxage=30, stale-while-revalidate=120`, so for up to two and
 * a half minutes after a save the edge hands back the row from BEFORE it, and
 * the panel took that row as the truth three ways:
 *
 *   · adoptServer() — the shop brought back to the front on a phone
 *     (refreshFeeds), a bfcache return, a reload — REPLACED the saved row:
 *     the checkout priced the old table and the panel's boxes showed it;
 *   · loadShipRules(), the checkout's first visit, MERGED it over the saved
 *     row, so any cell the old row had came back;
 *   · the panel had no read of its own that no edge had kept, so a second
 *     save was built on the stale boxes and sent the old row back to the
 *     server.
 *
 * Now the row the server has just taken outranks any feed answer for three
 * minutes — in this page and, through the browser's storage, in the next one
 * — and the panel's own GET /api/admin/settings (never cached) counts as the
 * truth the same way.
 *
 * The storefront's own functions, sliced out of public/shop2/app.js and run in
 * a sandbox where every name this file does not provide is an inert stub.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

const has = (name: string) => src.includes(`function ${name}(`);

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

/** `var NAME = {…}` / `[…]` out of app.js, evaluated. */
function literal<T>(name: string): T {
  const at = src.indexOf(`var ${name} = `);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  const open = at + `var ${name} = `.length;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{" || src[i] === "[") depth++;
    else if ((src[i] === "}" || src[i] === "]") && --depth === 0) {
      return new Function(`return ${src.slice(open, i + 1)};`)() as T;
    }
  }
  throw new Error(`unterminated literal for ${name}`);
}

/** `var NAME = <number>;` or `var NAME = "<string>";`, else the fallback. */
function scalar<T>(name: string, fallback: T): T {
  const m = src.match(new RegExp(`var ${name} = ([0-9]+|"[^"]*");`));
  return m ? (JSON.parse(m[1]) as T) : fallback;
}

/** Anything the sandbox does not provide: callable, returns nothing, any property is itself. */
const STUB: unknown = new Proxy(function () { return undefined; }, {
  get: (_t, k) => (k === "then" || typeof k === "symbol" ? undefined : STUB),
  apply: () => undefined,
});

/* The functions under test, and the ones they lean on. A name the fix added
   is simply absent before it — the scenario then runs on the old code. */
const FUNCS = [
  "cloneRules", "jsonCanon", "shipSig", "shipDirty", "shipDraft", "shipNum", "setShipDraftField",
  "shipStoredMerge", "shipRulesBase", "shipRulesFrom", "setShipRules", "applyShipRules", "feedShipRules",
  "shipFreshNote", "shipFreshRow", "adoptServer", "loadShipRules", "loadAdminPricing",
  "shipLowCells", "shipPlaceName", "shipLowLine", "eur",
  "shipSavedText", "srvSaved", "srvPush", "demoApply",
  "orderCountry", "shipZoneOf", "shipRulePrice",
  // 1a: the table saves through its settings slot — shipPut() is the slot's send
  "shipCellKey", "shipRowCell", "shipRowSet", "shipAccepted", "shipLowAll", "shipHeldCells", "shipGate",
  "shipAcceptRow", "shipPut", "admAutosaveOk", "admSetTake", "admSetFresh", "admSetBusy", "admSetTyping",
];

type Row = Record<string, unknown> & { carriers?: Record<string, Record<string, number>> };
type Scope = Record<string, unknown> & { S: Record<string, unknown>; SHIP_STORED: Row };
type Fns = Record<string, (...a: unknown[]) => unknown>;

/** A browser's localStorage, shared between the "pages" of one test. */
function storage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    size: () => m.size,
  };
}

const SHIP_RULES_LIT = literal<Record<string, unknown>>("SHIP_RULES");

/** The stored row of a shop that has saved a few things before today. */
function rowWith(carriers: Record<string, Record<string, number>>): Row {
  return {
    freeFrom: 59, freeFromByCountry: { EU: 200 },
    methods: { parcel: {}, courier: {}, pickup: {} },
    carriers, countriesOff: ["CH", "CY", "GB", "IS", "LI", "MT", "NO"], pickupOff: [],
  };
}

/**
 * One page of the shop: the stored row it booted with, the feed the edge will
 * hand it, what the server answers a save and an admin read with.
 */
function page(opts: {
  ls: ReturnType<typeof storage>;
  booted: Row;
  feed: () => Row;
  admin?: () => Row | undefined;
  put?: { status: number; body: unknown };
}): { scope: Scope; fn: Fns; puts: unknown[] } {
  const puts: unknown[] = [];
  const defaults = JSON.parse(JSON.stringify(SHIP_RULES_LIT));
  const scope: Scope = {
    S: {
      lang: "RU", screen: "admin", admSetPage: "delivery", country: "EE", countryIso: "", cart: [],
      shipDraft: null, shipSaving: false, pricingLoaded: null, pricingLoadErr: false,
    },
    DEMO: { log: [], flows: {}, price: {}, stock: {} },
    SRV: { admin: true },
    SHIP_RULES: JSON.parse(JSON.stringify(SHIP_RULES_LIT)),
    SHIP_RULES_DEFAULT: defaults,
    SHIP_STORED_DEFAULT: {
      freeFrom: defaults.freeFrom, freeFromByCountry: JSON.parse(JSON.stringify(defaults.freeFromByCountry)),
      methods: { parcel: {}, courier: {}, pickup: {} }, carriers: {},
      countriesOff: defaults.countriesOff.slice(), pickupOff: defaults.pickupOff.slice(),
    },
    SHIP_STORED: {},
    MONTONIO_PRICE: literal("MONTONIO_PRICE"),
    CARRIERS_BY_COUNTRY: literal("CARRIERS_BY_COUNTRY"),
    COURIER_CARRIERS: literal("COURIER_CARRIERS"),
    CARRIER_NAMES: literal("CARRIER_NAMES"),
    COUNTRIES: literal("COUNTRIES"),
    EUROPE_ISO: literal("EUROPE_ISO"),
    SHIP_ROWS: literal("SHIP_ROWS"),
    FEED_FETCH: { cache: "no-store" },
    pendingAction: null, shipRollback: null, shipRulesAsked: false,
    shipServerRow: null, SHIP_ACCEPT: {}, ADM_AS: {}, ADM_SET_AT: {}, ADM_SET_OF: literal("ADM_SET_OF"),
    shipFresh: null,
    SHIP_FRESH_MS: scalar("SHIP_FRESH_MS", 180000),
    SHIP_FRESH_LS: scalar("SHIP_FRESH_LS", "rempire-ship-fresh"),
    localStorage: opts.ls,
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, settings: { shipping_rules: opts.feed() } }) }),
    apiJson: () => {
      const row = opts.admin ? opts.admin() : undefined;
      return Promise.resolve({ status: 200, body: { ok: true, settings: row ? { shipping_rules: row } : {} } });
    },
    apiSend: (url: string, method: string, body: unknown) => {
      puts.push(body);
      return Promise.resolve(opts.put ?? { status: 200, body: { ok: true } });
    },
    toast: () => undefined,
    countryName: (c: string) => c,
  };
  const scopeProxy = new Proxy(scope, {
    has: (t, k) => typeof k === "string" && (k in t || !(k in globalThis)),
    get: (t, k) => (typeof k !== "string" ? undefined : k in t ? t[k] : STUB),
    set: (t, k, v) => { (t as Record<string | symbol, unknown>)[k] = v; return true; },
  });
  const present = FUNCS.filter(has);
  // Only this repository's own source and fixed text go into the body.
  const make = new Function(
    "__scope",
    `with (__scope) {\n${present.map(slice).join("\n")}\nreturn { ${present.map((n) => `${n}: ${n}`).join(", ")} };\n}`,
  );
  const fn = make(scopeProxy) as Fns;
  fn.setShipRules(opts.booted);   // what the page's first feed answer left it holding
  return { scope, fn, puts };
}

const tick = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };

/** The till's price for an Estonian / Latvian Omniva locker, as this page would bill it. */
const omniva = (p: { fn: Fns }, cc = "EE") => p.fn.shipRulePrice("parcel", "omniva", cc) as number;

/** «1» and «2» in the Omniva boxes, «Оставить так» on both (1a, q4) — the
    change applied, and the settings slot's write (admSetPut → shipPut). */
async function saveBelowCost(p: { scope: Scope; fn: Fns }) {
  p.fn.setShipDraftField("c:omniva:EE", "1");
  p.fn.setShipDraftField("c:omniva:LV", "2");
  const accept = p.scope.SHIP_ACCEPT as Record<string, number>;
  accept["c:omniva:EE"] = 1;
  accept["c:omniva:LV"] = 2;
  p.fn.demoApply({ type: "set_shipping_rules", rules: p.fn.cloneRules(p.fn.shipDraft()), full: true });
  await p.fn.shipPut({});
  await tick();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the row just saved outlives the edge's copy of the old one", () => {
  it("the save itself goes out with the flag and lands — the reported card, in full", async () => {
    const before = rowWith({});
    const p = page({ ls: storage(), booted: before, feed: () => before });
    await saveBelowCost(p);
    expect(p.puts).toEqual([
      { settings: { shipping_rules: expect.objectContaining({ carriers: { omniva: { EE: 1, LV: 2 } } }) }, acceptBelowCost: true },
    ]);
    expect(omniva(p)).toBe(1);
  });

  it("the shop brought back to the front a minute later keeps it — boxes and till", async () => {
    const before = rowWith({});
    const p = page({ ls: storage(), booted: before, feed: () => before });
    await saveBelowCost(p);

    vi.setSystemTime(new Date("2026-09-24T12:01:00Z"));
    p.fn.adoptServer({ overrides: {}, settings: { shipping_rules: before } });   // refreshFeeds, stale edge copy

    expect(p.scope.SHIP_STORED.carriers, "the panel's boxes went back to the old row").toEqual({ omniva: { EE: 1, LV: 2 } });
    expect(omniva(p), "the checkout quotes the old price").toBe(1);
    expect(omniva(p, "LV")).toBe(2);
  });

  it("the checkout's first visit does not merge an old cell back over it", async () => {
    const before = rowWith({ omniva: { EE: 2.99 } });   // an earlier save the edge still has
    const p = page({ ls: storage(), booted: before, feed: () => before });
    await saveBelowCost(p);

    p.scope.S.screen = "checkout";
    p.fn.loadShipRules();
    await tick();
    expect(omniva(p), "the stale 2,99 € came back through loadShipRules").toBe(1);
  });

  it("a page opened next in the same browser starts on it, not on the edge's copy", async () => {
    const ls = storage();
    const before = rowWith({});
    const first = page({ ls, booted: before, feed: () => before });
    await saveBelowCost(first);

    vi.setSystemTime(new Date("2026-09-24T12:00:40Z"));
    const next = page({ ls, booted: rowWith({}), feed: () => before });   // a reload, a new tab
    next.fn.adoptServer({ overrides: {}, settings: { shipping_rules: before } });
    expect(next.scope.SHIP_STORED.carriers).toEqual({ omniva: { EE: 1, LV: 2 } });
    expect(omniva(next)).toBe(1);
  });

  it("…and once the edge has had time to catch up, the feed is the truth again", async () => {
    const ls = storage();
    const before = rowWith({});
    const p = page({ ls, booted: before, feed: () => before });
    await saveBelowCost(p);

    vi.setSystemTime(new Date("2026-09-24T12:03:01Z"));   // past s-maxage 30 + stale 120, with room
    const later = rowWith({ dpd: { LV: 6.49 } });           // e.g. saved since on another phone
    p.fn.adoptServer({ overrides: {}, settings: { shipping_rules: later } });
    expect(p.scope.SHIP_STORED.carriers).toEqual({ dpd: { LV: 6.49 } });
    const next = page({ ls, booted: rowWith({}), feed: () => later });
    next.fn.adoptServer({ overrides: {}, settings: { shipping_rules: later } });
    expect(next.scope.SHIP_STORED.carriers).toEqual({ dpd: { LV: 6.49 } });
  });

  it("a save the server refused is not remembered — the feed keeps its word", async () => {
    const ls = storage();
    const before = rowWith({});
    const p = page({ ls, booted: before, feed: () => before, put: { status: 503, body: { ok: false, error: "db_unavailable" } } });
    await saveBelowCost(p);
    p.fn.adoptServer({ overrides: {}, settings: { shipping_rules: before } });
    expect(p.scope.SHIP_STORED.carriers).toEqual({});
    expect(ls.size()).toBe(0);
  });

  it("prices typed and not yet saved stay in the boxes whatever lands (the 23.09 rule)", async () => {
    const before = rowWith({});
    const p = page({ ls: storage(), booted: before, feed: () => before });
    await saveBelowCost(p);
    p.fn.setShipDraftField("c:dpd:LV", "7");
    p.fn.adoptServer({ overrides: {}, settings: { shipping_rules: before } });
    expect((p.scope.S.shipDraft as Row).carriers).toEqual({ omniva: { EE: 1, LV: 2 }, dpd: { LV: 7 } });
  });
});

describe("the panel's own read of the settings is the truth the feed is not", () => {
  it("GET /api/admin/settings puts the stored row in the boxes, and a stale feed after it does not take it out", async () => {
    const saved = rowWith({ omniva: { EE: 1, LV: 2 } });
    const stale = rowWith({});
    const p = page({ ls: storage(), booted: stale, feed: () => stale, admin: () => saved });   // a reload of the panel
    p.fn.loadAdminPricing(true);
    await tick();
    expect(p.scope.SHIP_STORED.carriers, "the panel shows the edge's old row over its own read").toEqual({ omniva: { EE: 1, LV: 2 } });
    p.fn.adoptServer({ overrides: {}, settings: { shipping_rules: stale } });
    expect(p.scope.SHIP_STORED.carriers).toEqual({ omniva: { EE: 1, LV: 2 } });
  });

  it("…but a read that left before a save and answers after it does not undo the save", async () => {
    const stale = rowWith({});
    let answer!: (v: unknown) => void;
    const p = page({ ls: storage(), booted: stale, feed: () => stale });
    p.scope.apiJson = () => new Promise((r) => { answer = r; });
    p.fn.loadAdminPricing(true);                      // asked for…
    vi.setSystemTime(new Date("2026-09-24T12:00:02Z"));
    await saveBelowCost(p);                           // …the owner saves meanwhile…
    answer({ status: 200, body: { ok: true, settings: { shipping_rules: stale } } });   // …the old answer lands
    await tick();
    expect(p.scope.SHIP_STORED.carriers).toEqual({ omniva: { EE: 1, LV: 2 } });
  });

  it("a shop that has never saved the table keeps the defaults", async () => {
    const p = page({ ls: storage(), booted: rowWith({}), feed: () => rowWith({}), admin: () => undefined });
    p.fn.loadAdminPricing(true);
    await tick();
    expect(p.scope.SHIP_STORED.carriers).toEqual({});
    expect(omniva(p)).toBe(3.19);
  });
});
