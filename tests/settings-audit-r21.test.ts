/**
 * Round 21 — the «Настройки» half of the audit's medium and low findings.
 *
 * Four things the panel and the server said to each other that were not true:
 *
 *   · five identifier fields on «О компании» — the registration number, the
 *     KMKR number, the e-mail, the phone and every link — are blanked by the
 *     server when they do not match its regex, and nothing on the way out
 *     said so: «Сохранено ✓», and the footer of every page lost the number;
 *   · a refused delivery price — the one refusal this panel can get — lived in
 *     a toast for two and a half seconds and nowhere else, although the page
 *     carries an error box built for it;
 *   · a shop with no tariff row is priced by the defaults on the server
 *     (loadShippingRules() → null) but the feed sends it `shipping: {}`, which
 *     the storefront read as a saved row with every box empty — «пустая
 *     клетка — цена Montonio» — and quoted an Estonian courier at 6,89 €
 *     against a till billing 10,84 €;
 *   · PUT /api/admin/settings answered 503 db_unavailable when its read-back
 *     failed, about a row it had already written.
 *
 * The panel's own functions are sliced out of public/shop2/app.js **by source
 * text** and run against stubs (tests/checkout-parity.test.ts's technique);
 * the server halves are imported and called for real.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitizeContentPatch } from "@/lib/content";
import { DEFAULT_SHIPPING_RULES } from "@/lib/shipping";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { query } from "@/lib/db";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");

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

/* ------------------------------------------------------------------------ *
 * 1. The panel judges the five identifier fields the way the server does
 * ------------------------------------------------------------------------ */

describe("«О компании»: what the server will keep, said before the save", () => {
  /** The real cFieldNorm() / cFieldOk() over the panel's own regex table. */
  const panelOk = new Function(`
    var C_FIELD_RE = ${literalSrc("C_FIELD_RE")};
    ${slice("cFieldNorm")}
    ${slice("cFieldOk")}
    return cFieldOk;
  `)() as (kind: string, v: string) => boolean;

  /** Does the SERVER keep this value, or store an empty string for it? */
  function serverKeeps(kind: string, v: string): boolean {
    if (kind === "url") {
      const out = sanitizeContentPatch({ social: { instagram: v } });
      return (out?.social?.instagram ?? "") !== "";
    }
    const out = sanitizeContentPatch({ company: { [kind]: v } });
    return ((out?.company as Record<string, string> | undefined)?.[kind] ?? "") !== "";
  }

  const CASES: Array<[string, string]> = [
    ["regCode", "12216136"],
    ["regCode", "1221 6136"],
    ["regCode", "12216136-x"],
    ["regCode", "12"],
    ["regCode", "EE12216136"],
    ["vatNumber", "EE102723858"],
    ["vatNumber", "ee102723858"],
    ["vatNumber", "EE 1027 2385 8"],
    ["vatNumber", "E102723858"],
    ["vatNumber", "102723858"],
    ["email", "info@rempireshop.com"],
    ["email", "INFO@Rempireshop.com"],
    ["email", "info@localhost"],
    ["email", "info rempire@x.com"],
    ["email", "@rempireshop.com"],
    ["phone", "+372 5623 7237"],
    ["phone", "5623 7237"],
    ["phone", "372-562-372"],
    ["phone", "tel 5623"],
    ["phone", "+372"],
    ["url", "https://instagram.com/rempire"],
    ["url", "http://x.ee"],
    ["url", "instagram.com/rempire"],
    ["url", "javascript:alert(1)"],
    ["url", "https://a b.com"],
  ];

  it.each(CASES)("%s «%s» — the panel agrees with the server", (kind, value) => {
    expect([kind, value, panelOk(kind, value)]).toEqual([kind, value, serverKeeps(kind, value)]);
  });

  it("says nothing about an empty field — an empty field is an answer", () => {
    for (const kind of ["regCode", "vatNumber", "email", "phone", "url"]) {
      expect([kind, panelOk(kind, "")]).toEqual([kind, true]);
      expect([kind, panelOk(kind, "   ")]).toEqual([kind, true]);
    }
  });

  /* 1a (25.09.2026, README § 2): the page saves itself, and «don't autosave
     invalid values» — a value the server would quietly blank is not sent at
     all; the box turns rust with one line under it, and saves the moment it
     is right. Nothing typed is lost: it stays in the box. */
  it("a value the server would blank is not sent — the box says why instead", () => {
    const gate = new Function(`
      var IBAN_RE = /^[A-Z]{2}[0-9A-Z ]{10,40}$/;
      var C_FIELD_RE = ${literalSrc("C_FIELD_RE")};
      var C_FIELD_GATE = ${literalSrc("C_FIELD_GATE")};
      ${slice("ibanOk")}
      ${slice("cFieldNorm")}
      ${slice("cFieldOk")}
      ${slice("cGateHint")}
      return cGateHint;
    `)() as (kind: string, v: string) => string;
    expect(gate("phone", "tel 5623")).toMatch(/^Телефон/);
    expect(gate("phone", "+372 5623 7237")).toBe("");
    expect(gate("url", "javascript:alert(1)")).toMatch(/https:\/\//);
    expect(gate("iban", "EE38 22")).toMatch(/^IBAN/);
    expect(gate("iban", "EE38 2200 2210 2014 5685")).toBe("");
    // an empty field is an answer, and always goes
    for (const kind of ["regCode", "vatNumber", "email", "phone", "url", "iban"]) expect(gate(kind, "")).toBe("");
    // …and the box that asks it is the one that sends it
    expect(slice("cAs")).toContain("validate: function (v) { return cGateHint(gate, v); }");
  });
});

/* ------------------------------------------------------------------------ *
 * 2. `shipping: {}` is «no row», and a shop with no row is priced by the
 *    defaults — the same defaults the server prices it by
 * ------------------------------------------------------------------------ */

describe("feedShipRules: a shop that has never saved the tariff table", () => {
  type Rules = {
    freeFrom: number | null;
    methods: Record<string, Record<string, number>>;
    carriers?: Record<string, Record<string, number>>;
  };

  /** adoptServer's own two lines, over the panel's real rules machinery. */
  function adopt(settings: Record<string, unknown>): Rules {
    const body = `
      var SHIP_RULES = ${literalSrc("SHIP_RULES")};
      var MONTONIO_PRICE = ${literalSrc("MONTONIO_PRICE")};
      function cloneRules(r) { return JSON.parse(JSON.stringify(r)); }
      var SHIP_RULES_DEFAULT = cloneRules(SHIP_RULES);
      /* r22: the panel keeps the STORED row beside the merged table, and
         setShipRules() is what fills both — so the harness carries it too. */
      var SHIP_STORED_DEFAULT = {
        freeFrom: SHIP_RULES_DEFAULT.freeFrom,
        freeFromByCountry: cloneRules(SHIP_RULES_DEFAULT.freeFromByCountry),
        methods: { parcel: {}, courier: {}, pickup: {} },
        carriers: {},
        countriesOff: cloneRules(SHIP_RULES_DEFAULT.countriesOff)
      };
      var SHIP_STORED = cloneRules(SHIP_STORED_DEFAULT);
      var THRESH = { EE: null, LV: null, LT: null, FI: null, EU: null };
      ${slice("refreshShipThresholds")}
      ${slice("applyShipRules")}
      ${slice("shipRulesBase")}
      ${slice("shipStoredMerge")}
      ${slice("shipRulesFrom")}
      ${slice("setShipRules")}
      ${slice("feedShipRules")}
      var r = feedShipRules(S);
      if (r) setShipRules(r);
      return SHIP_RULES;
    `;
    return new Function("S", body)(settings) as Rules;
  }

  it("quotes the Estonian courier at the price the till bills — 10,84 €", () => {
    // …which is DEFAULT_SHIPPING_RULES's, because loadShippingRules() answers
    // null for a shop with no row and the server prices from those defaults
    expect(adopt({ shipping: {} }).methods.courier.EE)
      .toBe(DEFAULT_SHIPPING_RULES.methods.courier.EE);
    expect(adopt({ shipping: {} }).methods.courier.EE).toBe(10.84);
  });

  it("agrees with the server's defaults cell by cell across the courier row", () => {
    const got = adopt({ shipping: {} }).methods.courier;
    for (const c of Object.keys(DEFAULT_SHIPPING_RULES.methods.courier)) {
      expect([c, got[c]]).toEqual([c, DEFAULT_SHIPPING_RULES.methods.courier[c]]);
    }
  });

  it("…and still takes Montonio's price for an empty box of a SAVED row", () => {
    // a row the panel wrote is never empty — parseShippingRules() always
    // writes freeFrom, the methods and the carriers
    const saved = adopt({ shipping_rules: { freeFrom: 59, methods: { parcel: {}, courier: {}, pickup: {} } } });
    expect(saved.methods.courier.EE).toBe(6.89);
  });

  it("reads an empty object, an array and a missing key all as «no row»", () => {
    const off = DEFAULT_SHIPPING_RULES.methods.courier.EE;
    expect(adopt({}).methods.courier.EE).toBe(off);
    expect(adopt({ shipping: {} }).methods.courier.EE).toBe(off);
    expect(adopt({ shipping_rules: [] }).methods.courier.EE).toBe(off);
    expect(adopt({ shipping_rules: null, shipping: {} }).methods.courier.EE).toBe(off);
  });
});

/* ------------------------------------------------------------------------ *
 * 3. A refused delivery price stays on the page it was typed on
 * ------------------------------------------------------------------------ */

describe("srvSaved: «Доставка» keeps the server's refusal in sight", () => {
  /** The real srvSaved() against one canned answer. */
  function run(answer: { status: number; body?: unknown }) {
    const S = { shipErr: "" };
    const SRV = { admin: true };
    const toasts: string[] = [];
    const body = `${slice("srvSaved")} return srvSaved(P);`;
    const p = new Function("S", "SRV", "toast", "render", "P", body)(
      S, SRV, (t: string) => toasts.push(t), () => {}, Promise.resolve(answer),
    ) as Promise<unknown>;
    return p.then(() => ({ shipErr: S.shipErr, toasts, admin: SRV.admin }));
  }

  const DETAIL = "Курьер в Эстонию: 5,00 € — Montonio берёт 10,84 €.";

  it("puts the sentence in the page's error box, not only in a toast", async () => {
    const out = await run({ status: 400, body: { ok: false, error: "below_cost", detail: DETAIL } });
    expect(out.shipErr).toBe(DETAIL);
    /* since 23.09.2026 the toast says only what happened: the sentence itself
       was cut at three lines, and the box and the card list every cell
       (tests/shipping-below-cost.test.ts) */
    expect(out.toasts).toEqual(["Не сохранено: цена ниже тарифа Montonio"]);
  });

  it("leaves the box empty for a save that went through", async () => {
    expect((await run({ status: 200, body: { ok: true } })).shipErr).toBe("");
  });

  it("and for any other refusal, which is not about a price", async () => {
    const out = await run({ status: 500, body: { ok: false, error: "db_unavailable" } });
    expect(out.shipErr).toBe("");
    expect(out.toasts).toEqual(["Не удалось сохранить на сервере — попробуйте ещё раз"]);
  });

  it("opening any settings page starts the box quiet again", () => {
    // …so a refusal cannot follow the owner to another screen
    // 1a: every door to a page goes through admSetOpen(), which clears it
    expect(src).toContain("if (d.admsetpage !== undefined) { admSetOpen(d.admsetpage);");
    expect(src.slice(src.indexOf("function admSetOpen("), src.indexOf("function admSetOpen(") + 400)).toContain('S.shipErr = "";');
  });
});

/* ------------------------------------------------------------------------ *
 * 4. The panel is told what happened to the SAVE, not to the answer
 * ------------------------------------------------------------------------ */

let mockReadBackFails = false;

vi.mock("@/lib/orders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/orders")>();
  return {
    ...actual,
    getSettings: async () => {
      if (mockReadBackFails) throw new Error("Connection terminated unexpectedly");
      return actual.getSettings();
    },
  };
});

describe("PUT /api/admin/settings when the read-back fails", () => {
  const ORIGIN = "https://rempireshop.com";
  let admin = "";

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(async () => {
    mockReadBackFails = false;
    await teardownDb();
  });
  beforeEach(async () => {
    mockReadBackFails = false;
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

  it("answers ok — the row is written, and «не удалось сохранить» would be a lie", async () => {
    mockReadBackFails = true;
    const res = await put({ chatbot: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("and the change really is in the table the panel was told about", async () => {
    mockReadBackFails = true;
    await put({ chatbot: false });
    const rows = await query<{ value: unknown }>("select value from settings where key = $1", ["chatbot"]);
    expect(rows.map((r) => r.value)).toEqual([false]);
  });

  it("a write that really failed still says so", async () => {
    // an unwritable value: jsonb cannot hold a NUL, and setSetting is inside
    // the try that answers 503
    const res = await put({ chatbot: false, "bad key with spaces": 1 });
    expect(res.status).toBe(400);
  });

  it("carries the settings back when the read-back works", async () => {
    const res = await put({ chatbot: false });
    expect(res.status).toBe(200);
    expect((await res.json()).settings.chatbot).toBe(false);
  });
});

/* ------------------------------------------------------------------------ *
 * The settings write queue, and the one thing that could jam it
 * ------------------------------------------------------------------------ */

describe("apiSend — one settings write at a time, and never for ever", () => {
  /** apiSend() over a controllable apiJson, on a clock this test drives. */
  function rig() {
    const body = `
      var noop = function () {};
      var settingsWrite = Promise.resolve();
      var SETTINGS_WRITE_MS = 30000;
      var calls = [];
      function apiJson(url, opts) {
        return new Promise(function (ok, fail) {
          var call = { url: url, opts: opts, ok: ok, fail: fail, aborted: false };
          if (opts && opts.signal) opts.signal.addEventListener("abort", function () {
            call.aborted = true;
            fail(new Error("aborted"));
          });
          calls.push(call);
        });
      }
      ${slice("apiSend")}
      return { apiSend: apiSend, calls: calls };
    `;
    return new Function(body)() as {
      apiSend: (url: string, method: string, body?: unknown) => Promise<unknown>;
      calls: Array<{ url: string; aborted: boolean; ok: (v: unknown) => void }>;
    };
  }

  const SETTINGS = "/api/admin/settings/";

  it("holds the second write until the first answers", async () => {
    const { apiSend, calls } = rig();
    const first = apiSend(SETTINGS, "PUT", { a: 1 });
    apiSend(SETTINGS, "PUT", { b: 2 });
    await Promise.resolve();
    expect(calls).toHaveLength(1);

    calls[0].ok({ status: 200, body: {} });
    await first;
    await Promise.resolve();
    expect(calls).toHaveLength(2);
  });

  it("lets a write that never answers go, instead of jamming every later one", async () => {
    /* The queue frees itself on a REJECTED write, which covers a refusal and a
       dead connection — but not a request that simply never answers, and the
       browser gives one of those minutes. Until then every later settings write
       waited behind it while the panel had already said «Сохранено ✓» for each
       of them (audit F41). */
    vi.useFakeTimers();
    try {
      const { apiSend, calls } = rig();
      const first = apiSend(SETTINGS, "PUT", { a: 1 });
      first.catch(() => {});
      apiSend(SETTINGS, "PUT", { b: 2 }).catch(() => {});
      await Promise.resolve();
      expect(calls).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(31_000);
      expect(calls[0].aborted, "the stalled write was never abandoned").toBe(true);
      expect(calls, "the second write is still stuck behind it").toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves every other route alone — only this one is queued", async () => {
    const { apiSend, calls } = rig();
    apiSend("/api/admin/orders/1/", "PATCH", {});
    apiSend("/api/admin/orders/2/", "PATCH", {});
    await Promise.resolve();
    expect(calls).toHaveLength(2);
  });
});
