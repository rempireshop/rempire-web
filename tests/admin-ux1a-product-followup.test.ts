/**
 * The product card of direction 1a — the two things put back after the
 * coordinator's review of 25.09.2026 (Dim's rule: «nothing gets lost»).
 *
 *   · «Для Google»: «✨ Заполнить автоматически · все три языка» stays the main
 *     button, and each language's pair has its own small «✨ Заполнить только
 *     по-…» again — the old single-language fill, same hook (data-admseogen),
 *     same handler, same POST /api/admin/ai/text/ per language.
 *   · q41: «N человек ждут — получат письмо» under «Наличие» — how many unsent
 *     «Сообщить о наличии» rows the product has, counted by the server in
 *     GET /api/admin/overrides/ (`waiting`), so the owner knows a letter goes
 *     out when he puts it back. With «Товар снова в наличии» off in «Письма»
 *     the line says the letter will NOT go.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken } from "@/lib/auth";
import { exec } from "@/lib/db";
import { addStockAlert, markStockAlertSent, pendingStockAlertCounts, pendingStockAlerts } from "@/lib/customers";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

const raw = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
const app = raw.replace(/\r\n?/g, "\n");

function block(start: number, what: string): string {
  if (start < 0) throw new Error(`public/shop2/app.js no longer has ${what}`);
  let depth = 0;
  for (let i = app.indexOf("{", start); i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}" && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error(`unterminated ${what}`);
}
const fn = (name: string) => block(app.indexOf(`function ${name}(`), `function ${name}`);
function lineDecl(name: string): string {
  const m = new RegExp(`^  var ${name} = .*;$`, "m").exec(app);
  if (!m) throw new Error(`public/shop2/app.js no longer declares ${name} on one line`);
  return m[0].trim();
}
function sliceLiteral(marker: string, terminator: string): string {
  const at = app.indexOf(marker);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${marker}`);
  const end = app.indexOf(terminator, at);
  return app.slice(at + marker.length, end + terminator.length).replace(/;\s*$/, "");
}

type Lang = "ET" | "EN";
type Rule = [RegExp, Record<Lang, string>];
const UI = runInNewContext("(" + sliceLiteral("var UI = ", "\n  };") + ")") as Record<Lang, Record<string, string>>;
const UI_RX = runInNewContext("(" + sliceLiteral("var UI_RX = ", "\n  ];") + ")") as Array<Rule | undefined>;
function trText(s: string, lang: Lang): string {
  if (UI[lang][s]) return UI[lang][s];
  for (const e of UI_RX) {
    if (!e) continue;
    const m = s.match(e[0]);
    if (m) return e[1][lang].replace(/\$(\d)/g, (_, n: string) => m[+n] ?? "");
  }
  return s;
}
const CYR = /[А-Яа-яЁё]/;

/* ---- 1. «Для Google»: one language at a time, again ------------------------ */

describe("«Для Google»: «все три языка» first, and each language's own fill back", () => {
  const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const body = new Function("esc", "S", "admLangBarHTML", "admLangHas", "ED_LANGS",
    `${lineDecl("ED_SEO_FILL")}\n${fn("edSeoPair")}\n${fn("edSeoBody")}\nreturn edSeoBody;`,
  )(esc, { goodsSeoLang: "et" }, () => "<div data-langbar></div>", () => false, []) as (p: unknown, id: string) => string;
  const html = body({ id: "touchable", brand: "Kevin.Murphy", seoOv: {} }, "touchable");

  it("keeps «все три языка» as the one main button of the fold", () => {
    expect(html.match(/data-admseoall="touchable"/g) ?? []).toHaveLength(1);
    expect(html).toContain("✨ Заполнить автоматически · все три языка");
  });

  it("gives every language pair its own link — the old data-admseogen hook, naming its language", () => {
    for (const [code, word] of [["ru", "по-русски"], ["et", "по-эстонски"], ["en", "по-английски"]] as const) {
      const pair = new RegExp(`<div class="adm-edlang" data-edseopair="${code}"[^>]*>(.*?)<label`).exec(html);
      expect(pair, `no «${code}» pair`).not.toBeNull();
      expect(pair![1]).toContain(`data-admseogen="touchable" data-edseofill="${code}"`);
      expect(pair![1]).toContain(`✨ Заполнить только ${word}`);
    }
    // the link lives in its pair, so only the language on screen shows one
    expect(/data-edseopair="et">/.test(html) && /data-edseopair="ru" hidden>/.test(html)).toBe(true);
  });

  it("fills the link's own language — the tab on screen only when a button names none", () => {
    const at = app.indexOf("if (d.admseogen !== undefined || d.admseoall !== undefined) {");
    const branch = block(at, "the SEO fill branch");
    expect(branch).toContain('t.getAttribute("data-edseofill") || S.goodsSeoLang || "ru"');
    expect(branch).toContain('d.admseoall !== undefined ? ["RU", "ET", "EN"]');
    // …and the click reaches that branch: the hook is in the one delegated selector
    expect(app).toMatch(/closest\("[^"]*\[data-admseogen\][^"]*"\)/);
  });

  it("says each link in Estonian and English", () => {
    for (const s of ["✨ Заполнить только по-русски", "✨ Заполнить только по-эстонски", "✨ Заполнить только по-английски"]) {
      for (const L of ["ET", "EN"] as const) expect(CYR.test(trText(s, L)), `${L}: ${s}`).toBe(false);
    }
  });
});

/* ---- 2. q41: «N человек ждут — получат письмо» ------------------------------ */

describe("q41: the card says how many people wait for the product", () => {
  const plSrc = fn("pl");
  const make = (waiting: Record<string, number>, backstock: boolean) => new Function("S", "DEMO",
    `${plSrc}\n${fn("edWaitText")}\nreturn edWaitText;`,
  )({ goodsWaiting: waiting }, { flows: { backstock } }) as (p: unknown) => string;

  it("counts in Russian — 1 ждёт, 2–4 человека, 5+ человек, 21 ждёт again", () => {
    const t = make({ a: 1, b: 3, c: 5, d: 11, e: 21, f: 0 }, true);
    expect(t({ id: "a" })).toBe("1 человек ждёт — получит письмо");
    expect(t({ id: "b" })).toBe("3 человека ждут — получат письмо");
    expect(t({ id: "c" })).toBe("5 человек ждут — получат письмо");
    expect(t({ id: "d" })).toBe("11 человек ждут — получат письмо");
    expect(t({ id: "e" })).toBe("21 человек ждёт — получит письмо");
    // nobody waits, an unknown product, a new one: no line at all
    expect(t({ id: "f" })).toBe("");
    expect(t({ id: "zzz" })).toBe("");
    expect(t({ id: "new", isNew: true })).toBe("");
  });

  it("does not promise a letter that is switched off in «Письма»", () => {
    const t = make({ a: 2 }, false);
    expect(t({ id: "a" })).toBe("2 человека ждут — но письмо «Товар снова в наличии» выключено");
  });

  it("reads in Estonian and English, every form", () => {
    const on = make({ a: 1, b: 3, c: 7 }, true), off = make({ a: 1, b: 3, c: 7 }, false);
    for (const t of [on, off]) {
      for (const id of ["a", "b", "c"]) {
        const ru = t({ id });
        for (const L of ["ET", "EN"] as const) {
          const out = trText(ru, L);
          expect(CYR.test(out), `${L}: «${ru}» → «${out}»`).toBe(false);
          expect(out).toMatch(/^\d+ /);
        }
      }
    }
  });

  it("stands under «Наличие», and a count that arrives later is patched in place, never a render", () => {
    expect(fn("edSecShop")).toContain("stock + edWaitHTML(p)");
    const paint = fn("edWaitPaint");
    expect(paint).toContain("el.textContent = t");
    expect(paint).toContain("translateTree(el)");
    expect(paint).not.toMatch(/\brender\(/);
    expect(fn("waitAdopt")).toContain("edWaitPaint()");
  });

  it("is read with the salon prices, again when a card opens, and after the stock word changes", () => {
    expect(fn("loadProOverrides")).toContain("waitAdopt(r.body.waiting)");
    const open = block(app.indexOf("if (d.admgoods !== undefined) {"), "the card-open branch");
    expect(open).toContain("loadWaiting(false)");
    // the letters go inside that very PUT (upsertOverride → runBackInStock): ask after it
    expect(fn("edWrite")).toMatch(/set_stock[\s\S]*?\.then\(function \(r\) \{ if \(edOk\(r\)\) loadWaiting\(true\); return r; \}\)/);
    expect(fn("loadWaiting")).toContain('apiJson("/api/admin/overrides/")');
  });
});

/* ---- the server: GET /api/admin/overrides/ carries `waiting` ------------------ */

describe("GET /api/admin/overrides/ counts the people waiting, per product", () => {
  const ORIGIN = "https://rempireshop.com";
  let admin = "";
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate stock_alerts, product_overrides, settings restart identity cascade");
  });

  it("pendingStockAlertCounts(): unsent rows only, grouped by product", async () => {
    const P = "system-4-bio-botanical-shampoo", Q = "kevin-murphy-un-tangled-spray";
    for (const email of ["a@example.com", "b@example.com", "c@example.com"]) {
      expect(await addStockAlert({ email, productId: P, lang: "RU" })).toBe(true);
    }
    expect(await addStockAlert({ email: "a@example.com", productId: Q, lang: "ET" })).toBe(true);
    // asking twice is one subscription (stock_alerts_uniq)
    expect(await addStockAlert({ email: "a@example.com", productId: Q, lang: "EN" })).toBe(true);
    const first = (await pendingStockAlerts(P))[0];
    expect(await markStockAlertSent(first.id)).toBe(true);
    expect(await pendingStockAlertCounts()).toEqual({ [P]: 2, [Q]: 1 });
  });

  it("answers `waiting` next to the map, admin only", async () => {
    const { GET } = await import("@/app/api/admin/overrides/route");
    await addStockAlert({ email: "x@example.com", productId: "system-4-bio-botanical-shampoo", lang: "RU" });
    const res = await GET(new Request(`${ORIGIN}/api/admin/overrides/`, { headers: { cookie: admin } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.waiting).toEqual({ "system-4-bio-botanical-shampoo": 1 });
    expect(typeof body.overrides).toBe("object");

    const anon = await GET(new Request(`${ORIGIN}/api/admin/overrides/`));
    expect(anon.status).toBe(401);
  });

  it("an empty shop answers an empty map, not a missing one", async () => {
    const { GET } = await import("@/app/api/admin/overrides/route");
    const body = await (await GET(new Request(`${ORIGIN}/api/admin/overrides/`, { headers: { cookie: admin } }))).json();
    expect(body.waiting).toEqual({});
  });

  it("the public feed does not carry it — who waits for what is the shop's own business", async () => {
    const { GET } = await import("@/app/api/overrides/route");
    await addStockAlert({ email: "x@example.com", productId: "system-4-bio-botanical-shampoo", lang: "RU" });
    const body = await (await GET()).json();
    expect(body.waiting).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("x@example.com");
  });
});
