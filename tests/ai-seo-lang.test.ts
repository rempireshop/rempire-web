/**
 * «✨ Заполнить автоматически · все три языка» on a product's «Для Google»
 * wrote the ESTONIAN pair in Russian (verification pass on staging,
 * 25.09.2026): the ET description of «Claude test товар — шампунь» came back
 * «Шампунь для ухода за волосами…», and «Bio Botanical Shampoo» got the ET
 * title «Nook Bio Botanical Shampoo — шампунь».
 *
 * The panel sends every language the same input — the catalogue's own row,
 * kept in Russian: the name with its Russian type tail («— шампунь») and the
 * Russian section name (CAT_NAMES). The prompt asked for Estonian once, and
 * then showed the model a Russian title as THE example of the shape
 * («System 4 Bio Botanical Shampoo — шампунь») in every language. The model
 * echoed the Russian words it was handed.
 *
 * So: each language is asked in its own words (the name's tail and the
 * section translated by the shop's own tables before the model sees them,
 * the example in the language asked for, the type word named), a Russian
 * tail the model still echoes into an ET/EN title is put into that language
 * by the same table, and an ET/EN answer that is Russian outside the
 * product's own name is refused rather than written into the Estonian or
 * English fields.
 *
 * The chain is run whole: the panel's own admSeoFill() (cut out of
 * public/shop2/app.js) → POST /api/admin/ai/text → a stubbed model. No
 * network.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { buildSeoPrompt, seoOffLanguage } from "@/lib/ai-prompts";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const HOST = "rempireshop.com";
const CYR = /[а-яё]/i;

const app = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
function slice(name: string): string {
  const start = app.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = app.indexOf("{", start); i < app.length; i++) {
    if (app[i] === "{") depth++;
    else if (app[i] === "}" && --depth === 0) return app.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}
function literal(marker: string): unknown {
  const at = app.indexOf(marker);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has ${marker}`);
  const end = app.indexOf("};", at);
  return runInNewContext("(" + app.slice(at + marker.length, end + 1) + ")");
}
const SEO_HOOKS = literal("var SEO_HOOKS = ") as Record<string, [string, string]>;

/* The two products of the report, as the panel holds them: the catalogue's
   Russian tail, the catalogue's Russian section. */
const SHAMPOO = { id: "system-4-bio-botanical-shampoo", name: "Bio Botanical Shampoo — шампунь", brand: "System 4", cat: "hair" };
const RUSSIAN_NAMED = { id: "c-claude-test", name: "Claude test товар — шампунь", brand: "Rempire", cat: "hair" };
const CAT_NAMES = { hair: "Уход за волосами", styling: "Стайлинг" };

describe("the product snippet prompt asks each language in its own words", () => {
  const input = { kind: "product", name: SHAMPOO.name, brand: SHAMPOO.brand, category: CAT_NAMES.hair };

  it("Estonian: the name's tail, the section and the example are Estonian — no Russian word reaches the model", () => {
    const { system, user } = buildSeoPrompt("ET", input);
    expect(user).toContain("Product name: Bio Botanical Shampoo — šampoon");
    expect(user).toContain("Category: Juuksehooldus");
    expect(user, "a Russian word in the Estonian request is a Russian word in the Estonian answer").not.toMatch(CYR);
    expect(system).toContain("in Estonian");
    expect(system).toContain("«šampoon»");
    expect(system).toContain("System 4 Bio Botanical Shampoo — šampoon");
    expect(system, "the Russian example taught the model the Russian tail").not.toContain("— шампунь");
    expect(system).toMatch(/never copy a Russian word/i);
  });

  it("English: the same, in English", () => {
    const { system, user } = buildSeoPrompt("EN", input);
    expect(user).toContain("Product name: Bio Botanical Shampoo — shampoo");
    expect(user).toContain("Category: Hair care");
    expect(user).not.toMatch(CYR);
    expect(system).toContain("«shampoo»");
    expect(system).toContain("System 4 Bio Botanical Shampoo — shampoo");
    expect(system).not.toContain("— шампунь");
  });

  it("Russian stays as it was — the catalogue's own words", () => {
    const { system, user } = buildSeoPrompt("RU", input);
    expect(user).toContain("Product name: Bio Botanical Shampoo — шампунь");
    expect(user).toContain("Category: Уход за волосами");
    expect(system).toContain("System 4 Bio Botanical Shampoo — шампунь");
    expect(system).not.toMatch(/never copy a Russian word/i);
  });

  it("a section given by its id, or one the tables do not know, is handled without inventing a name", () => {
    expect(buildSeoPrompt("ET", { ...input, category: "styling" }).user).toContain("Category: Viimistlus");
    expect(buildSeoPrompt("ET", { ...input, category: "Что-то своё" }).user).toContain("Category: Что-то своё");
  });

  it("a tail the shop cannot translate is not named as the type word — the model is told to translate it", () => {
    const { system, user } = buildSeoPrompt("ET", { ...input, name: "Face Scrub — скраб для лица" });
    expect(user).toContain("Product name: Face Scrub — скраб для лица");
    expect(system).not.toMatch(/What this product is, in Estonian/);
    expect(system).toMatch(/translate it, never copy it/);
  });
});

describe("seoOffLanguage — what counts as Russian in an Estonian or English snippet", () => {
  it("the owner's own name and brand may stay Russian; nothing else may", () => {
    const own = { name: "Claude test товар — шампунь", brand: "Rempire" };
    expect(seoOffLanguage("Rempire Claude test товар — šampoon\nÕrn šampoon igapäevaseks pesuks.", "ET", own)).toBe(false);
    expect(seoOffLanguage("Rempire Claude test товар — šampoon\nШампунь для ухода за волосами.", "ET", own)).toBe(true);
    expect(seoOffLanguage("Чёрное мыло 666\nHandmade soap.", "EN", { name: "Чёрное мыло 666" })).toBe(false);
  });

  it("the type word after « — » is not the owner's name: a tail left Russian is off, even one the shop cannot translate", () => {
    const scrub = { name: "Face Scrub — скраб для лица", brand: "Rempire" };
    expect(seoOffLanguage("Rempire Face Scrub — скраб для лица\nNäokoorija igapäevaseks kasutuseks.", "ET", scrub)).toBe(true);
    expect(seoOffLanguage("Rempire Face Scrub — näokoorija\nNäokoorija igapäevaseks kasutuseks.", "ET", scrub)).toBe(false);
  });

  it("a Russian snippet is never off — the catalogue is Russian", () => {
    expect(seoOffLanguage("Шампунь для ухода за волосами.", "RU", { name: "Bio Botanical Shampoo — шампунь" })).toBe(false);
  });
});

/* ---- the whole chain: the panel's button, the route, a stubbed model ----- */

type Asked = { lang: string; system: string; user: string };

/** A model that writes what it is told to — except where the case says it misbehaves the way staging did. */
function stubModel(answer: (a: Asked) => { title: string; description: string }) {
  const asked: Asked[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    const payload = JSON.parse(String(init.body));
    const system = String(payload.messages[0].content);
    const user = String(payload.messages[1].content);
    const lang = /product, in Estonian/.test(system) ? "ET" : /product, in English/.test(system) ? "EN" : "RU";
    const a = { lang, system, user };
    asked.push(a);
    return new Response(JSON.stringify({
      model: "gpt-4.1-mini",
      choices: [{ message: { content: JSON.stringify(answer(a)) } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }));
  return asked;
}

describe("«Заполнить автоматически · все три языка» — what is asked and what lands in each language's fields", () => {
  let admin = "";
  const savedKey = process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(async () => {
    await teardownDb();
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  });
  beforeEach(async () => {
    resetRateLimits();
    await truncateAll();
    process.env.OPENAI_API_KEY = "sk-test-dummy";
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Presses the button: admSeoFill() for all three languages, its apiSend going to the real route. */
  async function press(p: typeof SHAMPOO) {
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const fields: Record<string, { value: string; isConnected: boolean }> = {};
    for (const L of ["RU", "ET", "EN"]) for (const sel of SEO_HOOKS[L]) fields[sel] = { value: "было " + L, isConnected: true };
    const toasts: string[] = [];
    const sent: Array<{ lang: string; input: Record<string, unknown> }> = [];
    let finished!: () => void;
    const done = new Promise<void>((r) => { finished = r; });
    const apiSend = async (url: string, method: string, body: { lang: string; input: Record<string, unknown> }) => {
      sent.push({ lang: body.lang, input: body.input });
      const res = await POST(new NextRequest(`${ORIGIN}${url}`, {
        method, headers: { "content-type": "application/json", host: HOST, cookie: admin }, body: JSON.stringify(body),
      }));
      return { status: res.status, body: await res.json() };
    };
    const fill = new Function(
      "S", "document", "apiSend", "CAT_NAMES", "SEO_HOOKS", "txt", "admFill", "edLangStatePaint",
      "goodsNewPaint", "toast", "edAsTextNow", "SRV", "render",
      `${slice("txt")}\n${slice("admSeoFill")}\nreturn admSeoFill;`,
    )(
      { adminEdit: p.id }, { querySelector: (s: string) => fields[s] || null }, apiSend, CAT_NAMES, SEO_HOOKS,
      undefined, (el: { value: string }, v: string) => { el.value = v; }, () => {},
      () => {}, (m: string) => toasts.push(m), (_k: string, msg: string) => { toasts.push(msg); finished(); }, {}, () => {},
    ) as (p: unknown, langs: string[], btn: { disabled: boolean; textContent: string }) => void;
    const btn = { disabled: false, textContent: "✨ Заполнить автоматически" };
    fill(p, ["RU", "ET", "EN"], btn);
    await Promise.race([done, new Promise((r) => setTimeout(r, 3000))]);
    // the button is given back once all three have answered
    await vi.waitFor(() => expect(btn.disabled).toBe(false));
    const pair = (L: string) => ({ title: fields[SEO_HOOKS[L][0]].value, description: fields[SEO_HOOKS[L][1]].value });
    return { sent, toasts, pair };
  }

  it("a model that behaves: each language is asked in that language and each pair is written in it", async () => {
    const words: Record<string, [string, string]> = {
      RU: ["шампунь", "Мягкий шампунь для ежедневного мытья."],
      ET: ["šampoon", "Õrn šampoon igapäevaseks pesuks."],
      EN: ["shampoo", "A gentle shampoo for everyday washing."],
    };
    const asked = stubModel((a) => ({ title: `System 4 Bio Botanical Shampoo — ${words[a.lang][0]}`, description: words[a.lang][1] }));
    const { pair, sent } = await press(SHAMPOO);

    expect(sent.map((s) => s.lang).sort()).toEqual(["EN", "ET", "RU"]);
    expect(asked.map((a) => a.lang).sort()).toEqual(["EN", "ET", "RU"]);
    for (const a of asked) {
      expect(a.system, a.lang).toContain(`«${words[a.lang][0]}»`);
      if (a.lang !== "RU") expect(a.user, `the ${a.lang} request carried Russian words`).not.toMatch(CYR);
    }
    expect(pair("RU")).toEqual({ title: "System 4 Bio Botanical Shampoo — шампунь", description: words.RU[1] });
    expect(pair("ET")).toEqual({ title: "System 4 Bio Botanical Shampoo — šampoon", description: words.ET[1] });
    expect(pair("EN")).toEqual({ title: "System 4 Bio Botanical Shampoo — shampoo", description: words.EN[1] });
  });

  it("a model that echoes the Russian type word into the Estonian and English titles: the shop's own word replaces it", async () => {
    // what staging returned for ET: «Nook Bio Botanical Shampoo — шампунь»
    stubModel((a) => ({
      title: "System 4 Bio Botanical Shampoo — шампунь",
      description: a.lang === "ET" ? "Õrn šampoon igapäevaseks pesuks." : a.lang === "EN" ? "A gentle everyday shampoo." : "Мягкий шампунь.",
    }));
    const { pair } = await press(SHAMPOO);
    expect(pair("ET").title).toBe("System 4 Bio Botanical Shampoo — šampoon");
    expect(pair("EN").title).toBe("System 4 Bio Botanical Shampoo — shampoo");
    expect(pair("RU").title).toBe("System 4 Bio Botanical Shampoo — шампунь");
    for (const L of ["ET", "EN"]) expect(pair(L).title + pair(L).description, L).not.toMatch(CYR);
  });

  it("a model that answers the Estonian request in Russian: nothing Russian is written into the Estonian pair, and the owner is told", async () => {
    // staging: the ET description of «Claude test товар — шампунь» was «Шампунь для ухода за волосами…»
    stubModel((a) => ({
      title: "Rempire Claude test товар — шампунь",
      description: a.lang === "EN" ? "A gentle shampoo for everyday washing." : "Шампунь для ухода за волосами. Подходит для регулярного использования.",
    }));
    const { pair, toasts } = await press(RUSSIAN_NAMED);
    // the product's own name is the owner's words and stays; everything else must be the language asked
    expect(pair("EN")).toEqual({ title: "Rempire Claude test товар — shampoo", description: "A gentle shampoo for everyday washing." });
    expect(pair("ET"), "a Russian answer was stored as the Estonian snippet").toEqual({ title: "было ET", description: "было ET" });
    expect(pair("RU").description).toMatch(/^Шампунь для ухода/);
    expect(toasts).toContain("Не получилось — попробуйте ещё раз");
  });
});
