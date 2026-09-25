/**
 * «Маркетинг → Промокоды»: the form's «Создать» and «Сохранить».
 *
 * map-defects #4 (24.09.2026): «Создать» with a code that already exists
 * silently rewrote that code. The form posted through upsertPromo()'s
 * `on conflict (code) do update`, so SUVI10 typed a second time — a month
 * later, for a different promotion — replaced the percent, the dates, the
 * limit and the scope of the SUVI10 customers were already holding, and the
 * panel said «Промокод сохранён ✓». «Создать» now says `create: true`, the
 * route answers 409 `exists` without writing, and the form says «Такой
 * промокод уже есть.» with «Открыть его» beside it. «Сохранить» on an open
 * code edits exactly as before.
 *
 * map-defects #11: a REM-CART code (the abandoned-cart letter's, scope
 * 'cart') could not be saved from the form at all — its basket lines were
 * neither loaded nor sent, and the server's `bad_scope_lines` had no sentence.
 * And switching the kind kept the number: 150 € became 150 %.
 *
 * Real Postgres (PGlite) and the real route for the server half; the browser
 * half is sliced out of public/shop2/app.js by source text and run over stubs
 * (the tests/promos-r21.test.ts technique), and its sentences go through the
 * panel's own translator.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { exec } from "@/lib/db";
import { getPromo, upsertPromo, validatePromo } from "@/lib/promos";
import { adminCookieHeader, makeRequest, setFuzzEnv } from "./fuzz-harness";
import { setupDb, teardownDb } from "./helpers";

const src = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8")
  .replace(/\r\n/g, "\n");

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
  }
  throw new Error(`public/shop2/app.js no longer declares ${name}`);
}

/** app.js functions by name, run with `scope` as their free variables. */
function build<T>(names: string[], scope: Record<string, unknown>, expr = names[0]): T {
  const keys = Object.keys(scope);
  const body = names.map(slice).join("\n") + `\nreturn ${expr};`;
  return new Function(...keys, body)(...keys.map((k) => scope[k])) as T;
}

const CYR = /[А-Яа-яЁё]/;
const trText = new Function(`
  ${decl("UI")}
  ${decl("UI_RX")}
  ${slice("trName")}
  ${decl("TAIL_EXACT")}
  ${decl("NAME_TAILS")}
  ${decl("NAME_FRAGS")}
  ${slice("trText")}
  return trText;
`)() as (s: string, lang: string, allowName: boolean) => string;

/** The text nodes of a piece of markup, as translateTree() would leave them. */
function nodes(html: string, lang: "RU" | "ET" | "EN"): string[] {
  const list = html
    .split(/<[^>]*>/)
    .map((t) => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').trim())
    .filter(Boolean);
  return lang === "RU" ? list : list.map((t) => (CYR.test(t) ? trText(t, lang, false) : t));
}

const esc = (s: unknown) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The body of a code as the form posts it — with the two pieces it reads the list through. */
const PAYLOAD = ["promoFormPayload", "promoActiveNow", "admPromoByCode", "promoEndIso"];

/** The promo form as the panel draws it (1a: the panel of one code), with its neighbours stubbed. */
function formHTML(S: Record<string, unknown>): string {
  return build<() => string>(["promoFormHTML", "promoErrLineHTML", "promoBad", "promoHintHTML", "admSegHTML", "admPinnedHTML", "admPromoByCode", "admPromoUsed"], {
    S,
    esc,
    PROMO_KIND_ROWS: [["percent", "Процент"], ["fixed", "Сумма"], ["free_shipping", "Доставка"]],
    promoScopeFormHTML: () => "",
    promoSumHTML: () => "",
    promoFoldSum: () => "",
    admHelpBtnHTML: () => "",
    admHelpHTML: () => "",
    admFoldHTML: (_k: string, title: string, _s: string, body: string) => title + body,
  })();
}

/* ========================================================================= */

let restoreEnv: () => void = () => {};
beforeAll(async () => {
  restoreEnv = setFuzzEnv();
  await setupDb();
});
afterAll(async () => {
  restoreEnv();
  await teardownDb();
});

/** POST /api/admin/promos/ as the signed-in owner. */
async function post(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/admin/promos/route");
  const res = await POST(makeRequest("/api/admin/promos/", { method: "POST", body, cookie: adminCookieHeader() }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

describe("the promo route: «Создать» never rewrites a code that is there", () => {
  beforeEach(async () => {
    await exec("truncate promo_code_uses, promo_codes restart identity cascade");
  });

  const LIVE = {
    code: "SUVI10", kind: "percent" as const, value: 10, minSubtotal: 30,
    startsAt: null, endsAt: "2026-10-31T23:59:59.000Z", maxUses: 50, active: true, note: "осень",
  };

  it("refuses `create` for a code that exists — 409 `exists`, and the code is untouched", async () => {
    await upsertPromo(LIVE);
    const out = await post({
      create: true, code: "suvi10", kind: "fixed", value: "5", minSubtotal: "", endsAt: null, maxUses: "", note: "", active: true,
      scope: "order", scopeValue: null,
    });
    expect(out.status).toBe(409);
    expect(out.body).toEqual({ ok: false, error: "exists" });

    const kept = (await getPromo("SUVI10"))!;
    expect(kept.kind).toBe("percent");
    expect(kept.value).toBe(10);
    expect(kept.minSubtotal).toBe(30);
    expect(kept.maxUses).toBe(50);
    expect(kept.note).toBe("осень");
    expect(kept.endsAt).toBe("2026-10-31T23:59:59.000Z");
  });

  it("makes a code that is not there yet", async () => {
    const out = await post({
      create: true, code: "NEW15", kind: "percent", value: "15", minSubtotal: "", endsAt: null, maxUses: "", note: "", active: true,
      scope: "order", scopeValue: null,
    });
    expect(out.status).toBe(200);
    expect((out.body.promo as { code: string; value: number }).code).toBe("NEW15");
    expect((await getPromo("NEW15"))!.value).toBe(15);
  });

  it("«Сохранить» on an open code (no `create`) still edits it", async () => {
    await upsertPromo(LIVE);
    const out = await post({
      code: "SUVI10", kind: "percent", value: "12", minSubtotal: "30", endsAt: LIVE.endsAt, maxUses: "50", note: "осень", active: true,
      scope: "order", scopeValue: null,
    });
    expect(out.status).toBe(200);
    expect((await getPromo("SUVI10"))!.value).toBe(12);
  });
});

describe("the form: «Создать» says so, and a taken code gets a sentence and a way to it", () => {
  const blank = () => build<() => Record<string, unknown>>(["blankPromo"], {})();

  it("a new code's body carries `create: true`; an open code's does not", () => {
    const S: Record<string, unknown> = { promoForm: { ...blank(), code: "suvi10" } };
    expect(build<() => Record<string, unknown>>(PAYLOAD, { S })().create).toBe(true);

    S.promoForm = build<(p: unknown) => Record<string, unknown>>(["promoFormFrom"], { S })({
      code: "SUVI10", kind: "percent", value: 10, minSubtotal: 0, endsAt: null, maxUses: null, note: null, active: true,
      scope: "order", scopeValue: null,
    });
    expect(build<() => Record<string, unknown>>(PAYLOAD, { S })().create).toBeUndefined();
  });

  it("on 409 `exists`: the sentence, «Открыть его» on the code that is there, and the list asked again", async () => {
    const S: Record<string, unknown> = { promoForm: { ...blank(), code: "suvi10" }, promoFormErr: "" };
    const sent: Array<Record<string, unknown>> = [];
    const reloads: unknown[] = [];
    const scope = {
      S,
      SRV: { admin: true },
      apiSend: (_url: string, _method: string, body: Record<string, unknown>) => {
        sent.push(body);
        return Promise.resolve({ status: 409, body: { ok: false, error: "exists" } });
      },
      loadAdminPromos: (force: unknown) => { reloads.push(force); },
      render: () => {},
      toast: () => {},
      PROMO_SAVE_ERRS: new Function(`${decl("PROMO_SAVE_ERRS")} return PROMO_SAVE_ERRS;`)(),
    };
    const savePromo = build<() => void>(["savePromo", ...PAYLOAD, "promoProblem", "promoNum", "promoDraftClear"], {
      ...scope, ADM_FOLD: {}, admFoldToggle: () => {}, refocus: () => {}, PROMO_FOCUS: {},
    });
    savePromo();
    await new Promise((r) => setTimeout(r, 0));

    expect(sent[0].create).toBe(true);
    expect(S.promoFormErr).toBe("Такой промокод уже есть.");
    expect((S.promoForm as Record<string, unknown>).dup).toBe("SUVI10");
    expect(reloads).toEqual([true]);

    const html = formHTML(S);
    expect(html).toContain('data-admpromoedit="SUVI10"');
    expect(nodes(html, "RU")).toEqual(expect.arrayContaining(["Такой промокод уже есть.", "Открыть его"]));
    // the button that saves still says «Создать промокод» — the form was not turned into an edit behind his back
    expect(html).toContain("data-admpromosave>Создать промокод<");
  });

  for (const [lang, want] of [["EN", ["This promo code already exists.", "Open it"]], ["ET", ["Selline sooduskood on juba olemas.", "Ava see"]]] as const) {
    it(`${lang}: the refusal and its button are translated`, () => {
      const S = { promoForm: { ...blank(), code: "SUVI10", dup: "SUVI10" }, promoFormErr: "Такой промокод уже есть." };
      const got = nodes(formHTML(S), lang);
      expect(got).toEqual(expect.arrayContaining([...want]));
    });
  }
});

/* ========================================================================= */

describe("a REM-CART code opens in the form and saves (map-defects #11)", () => {
  /* The second abandoned-cart letter mints REM-CART-… codes, scope 'cart'
     (db/migrations/197). The form loaded one without its basket lines and
     posted it without them, so validatePromo refused every save with
     `bad_scope_lines` — which had no sentence, so the owner read «Не
     получилось сохранить промокод.» and could not change so much as the date. */
  const UUID = "3f2a9c1e-7b4d-4e8a-9f0c-2d6b1a5e8c47";
  const LINES = ["kmrepair", "davines-oi-shampoo"];

  beforeEach(async () => {
    await exec("truncate promo_code_uses, promo_codes restart identity cascade");
  });

  it("the form carries the basket lines through a save, and the route keeps them", async () => {
    const made = await upsertPromo({
      code: "REM-CART-7K2Q9X", kind: "percent", value: 10, minSubtotal: 0,
      startsAt: null, endsAt: "2026-10-01T20:59:59.000Z", maxUses: 1, active: true, note: "Брошенная корзина",
      scope: "cart", scopeValue: UUID, scopeLines: LINES,
    });
    const S: Record<string, unknown> = {};
    S.promoForm = build<(p: unknown) => Record<string, unknown>>(["promoFormFrom"], { S })(made);
    const body = build<() => Record<string, unknown>>(PAYLOAD, { S })();

    expect(body.scope).toBe("cart");
    expect(body.scopeLines).toEqual(LINES);
    expect(validatePromo(body).ok, JSON.stringify(validatePromo(body))).toBe(true);

    const out = await post(body);
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    const kept = (await getPromo("REM-CART-7K2Q9X"))!;
    expect(kept.scope).toBe("cart");
    expect(kept.scopeValue).toBe(UUID);
    expect(kept.scopeLines).toEqual(LINES);
  });

  it("a code of any other scope sends no basket lines", () => {
    const S: Record<string, unknown> = { promoForm: { ...build<() => Record<string, unknown>>(["blankPromo"], {})(), code: "X1", scope: "brand", scopeValue: "Davines" } };
    expect("scopeLines" in build<() => Record<string, unknown>>(PAYLOAD, { S })()).toBe(false);
  });

  it("the form says what a cart code is, in the panel's language", () => {
    const html = build<(f: unknown) => string>(["promoScopeFormHTML", "admSegHTML", "promoBad", "promoHintHTML"], {
      S: { promoQ: "" },
      esc,
      PROMO_SCOPE_ROWS: [["order", "Весь заказ"], ["brand", "Бренд"], ["product", "Товар"]],
    })({ kind: "percent", scope: "cart", scopeValue: UUID });
    expect(nodes(html, "RU")).toContain("Код из письма о брошенной корзине: скидка только на товары этой корзины.");
    expect(html).not.toContain(UUID);
    for (const lang of ["ET", "EN"] as const) {
      expect(nodes(html, lang).filter((t) => CYR.test(t)), lang).toEqual([]);
    }
  });

  it("`bad_scope_lines` has a sentence of its own, translated", () => {
    const errs = new Function(`${decl("PROMO_SAVE_ERRS")} return PROMO_SAVE_ERRS;`)() as Record<string, string>;
    const line = errs.bad_scope_lines;
    expect(line, "the refusal falls through to «Не получилось сохранить промокод.»").toBeTruthy();
    for (const lang of ["ET", "EN"]) expect(trText(line, lang, false), lang).not.toMatch(CYR);
  });
});

describe("switching the kind empties the discount (map-defects #11)", () => {
  const setKind = (f: Record<string, unknown>, k: string) =>
    build<(f: Record<string, unknown>, k: string) => void>(["promoSetKind"], {})(f, k);

  it("150 € does not become 150 %", () => {
    const f: Record<string, unknown> = { kind: "fixed", value: "150" };
    setKind(f, "percent");
    expect(f).toMatchObject({ kind: "percent", value: "" });
    // …so «Создать» answers with the sentence about the size, never a quiet 150 %
    const S = { promoForm: { ...build<() => Record<string, unknown>>(["blankPromo"], {})(), ...f, code: "X150" } };
    expect(validatePromo(build<() => Record<string, unknown>>(PAYLOAD, { S })())).toEqual({ ok: false, error: "bad_value" });
  });

  it("10 % does not quietly become 10 €, and tapping the chip that is on changes nothing", () => {
    const f: Record<string, unknown> = { kind: "percent", value: 10 };
    setKind(f, "percent");
    expect(f.value).toBe(10);
    setKind(f, "fixed");
    expect(f).toMatchObject({ kind: "fixed", value: "" });
  });

  it("the kind chips go through it", () => {
    expect(src).toContain("promoSetKind(S.promoForm, d.promokind)");
    // the change handler of the <select> the chips replaced is gone, not left to disagree
    expect(src).not.toContain(`t.matches('[data-promof="kind"]')`);
  });
});
