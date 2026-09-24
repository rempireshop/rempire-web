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
 * Real Postgres (PGlite) and the real route for the server half; the browser
 * half is sliced out of public/shop2/app.js by source text and run over stubs
 * (the tests/promos-r21.test.ts technique), and its sentences go through the
 * panel's own translator.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { exec } from "@/lib/db";
import { getPromo, upsertPromo } from "@/lib/promos";
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

/** The promo form as the panel draws it, with its neighbours stubbed. */
function formHTML(S: Record<string, unknown>): string {
  return build<() => string>(["promoFormHTML"], {
    S,
    esc,
    PROMO_KIND_ROWS: [["percent", "Процент"], ["fixed", "Сумма в евро"], ["free_shipping", "Бесплатная доставка"]],
    promoScopeFormHTML: () => "",
    admDirtyCls: () => "",
    admBarNoteState: () => "",
    admBarNoteHTML: () => "",
  })();
}

/* ========================================================================= */

describe("the promo route: «Создать» never rewrites a code that is there", () => {
  let restoreEnv: () => void = () => {};
  beforeAll(async () => {
    restoreEnv = setFuzzEnv();
    await setupDb();
  });
  afterAll(async () => {
    restoreEnv();
    await teardownDb();
  });
  beforeEach(async () => {
    await exec("truncate promo_code_uses, promo_codes restart identity cascade");
  });

  async function post(body: Record<string, unknown>) {
    const { POST } = await import("@/app/api/admin/promos/route");
    const res = await POST(makeRequest("/api/admin/promos/", { method: "POST", body, cookie: adminCookieHeader() }));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

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
    expect(build<() => Record<string, unknown>>(["promoFormPayload"], { S })().create).toBe(true);

    S.promoForm = build<(p: unknown) => Record<string, unknown>>(["promoFormFrom"], { S })({
      code: "SUVI10", kind: "percent", value: 10, minSubtotal: 0, endsAt: null, maxUses: null, note: null, active: true,
      scope: "order", scopeValue: null,
    });
    expect(build<() => Record<string, unknown>>(["promoFormPayload"], { S })().create).toBeUndefined();
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
    const savePromo = build<() => void>(["savePromo", "promoFormPayload"], scope);
    savePromo();
    await new Promise((r) => setTimeout(r, 0));

    expect(sent[0].create).toBe(true);
    expect(S.promoFormErr).toBe("Такой промокод уже есть.");
    expect((S.promoForm as Record<string, unknown>).dup).toBe("SUVI10");
    expect(reloads).toEqual([true]);

    const html = formHTML(S);
    expect(html).toContain('data-admpromoedit="SUVI10"');
    expect(nodes(html, "RU")).toEqual(expect.arrayContaining(["Такой промокод уже есть.", "Открыть его"]));
    // the button that saves still says «Создать» — the form was not turned into an edit behind his back
    expect(html).toContain("data-admpromosave>Создать<");
  });

  for (const [lang, want] of [["EN", ["This promo code already exists.", "Open it"]], ["ET", ["Selline sooduskood on juba olemas.", "Ava see"]]] as const) {
    it(`${lang}: the refusal and its button are translated`, () => {
      const S = { promoForm: { ...blank(), code: "SUVI10", dup: "SUVI10" }, promoFormErr: "Такой промокод уже есть." };
      const got = nodes(formHTML(S), lang);
      expect(got).toEqual(expect.arrayContaining([...want]));
    });
  }
});
