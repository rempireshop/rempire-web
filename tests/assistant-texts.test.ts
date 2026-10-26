/**
 * «Помощник» with the Claude connector's capabilities (Dim, 26.10.2026:
 * «Помощник needs to have same capabilities like Claude has»): Google texts
 * in three languages, a product's description, a catalogue product's name,
 * brand and section, prices per size, and the section and brand page texts —
 * as actions the panel confirms, held to the connector's own checks
 * (src/lib/mcp/tools.ts), and with the product or page the owner means read
 * into the prompt so a text can be translated, not only written anew.
 *
 * What is pinned:
 *   · each action is rebuilt with bounds, and a language that fails the
 *     shop's checks (Russian on the Estonian page, «нет данных», HTML) is
 *     dropped; nothing left, no action — and the route says so;
 *   · a catalogue product's rename that a language could not say is refused;
 *     the owner's own product is renamed through update_product;
 *   · a brand page is written under the shop's spelling of the brand;
 *   · the prompt carries the open product's texts and the named page's;
 *   · the panel lays a description and a Google pair over what the product
 *     has, language by language.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { namesAsAsked, sanitizeAction } from "@/app/api/assistant/actions";
import { namedPages, namedProductIds } from "@/app/api/assistant/named";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { exec } from "@/lib/db";
import type { CatRow } from "@/lib/catalogue-slice";
import { setDescriptionOverride } from "@/lib/product-descriptions";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const ROWS = catalogueMin as CatRow[];
const known = new Set([...ROWS.map((r) => r.id), "c-flawless-lotion"]);
const products = new Map([...ROWS.map((r) => [r.id, { name: r.n, brand: r.b }] as const), ["c-flawless-lotion", { name: "Lotion — лосьон", brand: "FLAWLESS" }] as const]);
const brands = new Set(ROWS.map((r) => r.b));
const opts = { products, brands };
const act = (a: unknown) => sanitizeAction(a, known, true, opts) as Record<string, unknown> | null;

describe("the action door — the connector's checks on the assistant's texts", () => {
  it("set_seo: three languages, each held to its language; a failing one is dropped, the old Russian shape still works", () => {
    const a = act({
      type: "set_seo", id: "kevin-murphy-angel-wash",
      seo: {
        RU: { title: "Kevin.Murphy ANGEL.WASH — шампунь для объёма", description: "Мягкий шампунь для тонких окрашенных волос." },
        ET: { title: "Kevin.Murphy ANGEL.WASH — šampoon", description: "Õrn шампунь peentele juustele." },
        en: { title: "Kevin.Murphy ANGEL.WASH — volumising shampoo", description: "A gentle shampoo for fine, coloured hair." },
      },
    });
    expect(a).toMatchObject({ type: "set_seo", id: "kevin-murphy-angel-wash", title: "Kevin.Murphy ANGEL.WASH — шампунь для объёма" });
    expect(Object.keys(a!.seo as object)).toEqual(["RU", "EN"]);
    expect(act({ type: "set_seo", id: "kevin-murphy-angel-wash", title: "Заголовок", description: "Описание." })).toMatchObject({ seo: { RU: { t: "Заголовок", d: "Описание." } } });
    expect(act({ type: "set_seo", id: "kevin-murphy-angel-wash", seo: { EN: { title: "T", description: "No further product details are given." } } })).toBeNull();
  });

  it("set_description: any product, plain text per language; HTML, Russian on the Estonian page and «нет данных» are left out", () => {
    const a = act({
      type: "set_description", id: "kevin-murphy-angel-wash",
      value: {
        RU: "Мягкий шампунь для тонких волос.\n\nПодходит для окрашенных волос.",
        ET: "<p>Õrn šampoon.</p>",
        EN: "A gentle shampoo for fine hair.",
      },
    });
    expect(a).toEqual({ type: "set_description", id: "kevin-murphy-angel-wash", value: { RU: "Мягкий шампунь для тонких волос.\n\nПодходит для окрашенных волос.", EN: "A gentle shampoo for fine hair." } });
    expect(act({ type: "set_description", id: "kevin-murphy-angel-wash", value: { ET: "Õrn шампунь." } })).toBeNull();
    expect(act({ type: "set_description", id: "made-up", value: { RU: "Текст." } })).toBeNull();
  });

  it("set_names: a catalogue product's name every language can say; the owner's own goes through update_product", () => {
    expect(act({ type: "set_names", id: "kevin-murphy-angel-wash", name: "ANGEL.WASH Gentle — шампунь для волос", cat: "hair" }))
      .toEqual({ type: "set_names", id: "kevin-murphy-angel-wash", name: "ANGEL.WASH Gentle — шампунь для волос", cat: "hair" });
    expect(act({ type: "set_names", id: "kevin-murphy-angel-wash", name: "ANGEL.WASH — эликсир свежести" })).toBeNull();
    expect(act({ type: "set_names", id: "kevin-murphy-angel-wash", cat: "kitchen" })).toBeNull();
    expect(act({ type: "set_names", id: "c-flawless-lotion", name: "Bond Lotion — лосьон для укладки" }))
      .toEqual({ type: "update_product", id: "c-flawless-lotion", name: "Bond Lotion — лосьон для укладки" });
  });

  it("set_size_prices: named sizes, 1–500 € each, never twice", () => {
    expect(act({ type: "set_size_prices", id: "system-4-bio-botanical-shampoo", prices: [{ size: "250 мл", price: "16,90" }] }))
      .toEqual({ type: "set_size_prices", id: "system-4-bio-botanical-shampoo", prices: [{ size: "250 мл", price: 16.9 }] });
    expect(act({ type: "set_size_prices", id: "system-4-bio-botanical-shampoo", prices: [{ size: "250 мл", price: 0 }] })).toBeNull();
    expect(act({ type: "set_size_prices", id: "system-4-bio-botanical-shampoo", prices: [{ size: "250 мл", price: 9 }, { size: "250 МЛ", price: 10 }] })).toBeNull();
  });

  it("set_page_texts: a section or a brand the shop has, under the shop's spelling; «» gives a field back; a failing field is dropped", () => {
    const a = act({
      type: "set_page_texts",
      value: {
        cat: { beard: { RU: { intro: "Масла и бальзамы для бороды." }, ET: { title: "Habemehooldus — масло" } }, kitchen: { RU: { intro: "x" } } },
        brand: { "kevin.murphy": { EN: { description: "Australian hair care, in stock in Tallinn.", title: "" } }, "Nobody": { RU: { intro: "x" } } },
      },
    });
    expect(a).toEqual({
      type: "set_page_texts",
      value: {
        cat: { beard: { RU: { intro: "Масла и бальзамы для бороды." } } },
        brand: { "Kevin.Murphy": { EN: { desc: "Australian hair care, in stock in Tallinn.", title: "" } } },
      },
    });
    expect(act({ type: "set_page_texts", value: { cat: { kitchen: { RU: { intro: "x" } } } } })).toBeNull();
  });
});

/* the live test of 26.10.2026: the reply promised «ANGEL.WASH Volume — шампунь
   для волос», the action carried «ANGEL.WASH — шампунь для волос» */
describe("namesAsAsked — a rename leaves with the name the owner dictated", () => {
  const model = { type: "set_names", id: "kevin-murphy-angel-wash", name: "ANGEL.WASH — шампунь для волос" };
  it("puts back the words the model dropped", () => {
    expect(namesAsAsked(model, "Переименуй этот товар в ANGEL.WASH Volume — шампунь для волос"))
      .toEqual({ ...model, name: "ANGEL.WASH Volume — шампунь для волос" });
    expect(namesAsAsked(model, "назови его «ANGEL.WASH Volume — шампунь для волос»."))
      .toEqual({ ...model, name: "ANGEL.WASH Volume — шампунь для волос" });
  });
  it("leaves the model's name when he dictated none, a Russian head, or one no language can say", () => {
    expect(namesAsAsked(model, "сделай название понятнее")).toBe(model);
    expect(namesAsAsked(model, "переименуй в Чёрное мыло — ручная работа")).toBe(model);
    expect(namesAsAsked(model, "переименуй в ANGEL.WASH — эликсир")).toBe(model);
    const price = { type: "set_price", id: "x", value: 9 };
    expect(namesAsAsked(price, "в ANGEL.WASH Volume — шампунь")).toBe(price);
  });
});

describe("what the owner means — the product and the page read into the prompt", () => {
  it("finds the open product first, then the products his words name; a section or brand his words name", () => {
    expect(namedProductIds("переведи описание", ROWS, "kevin-murphy-angel-wash")).toEqual(["kevin-murphy-angel-wash"]);
    expect(namedProductIds("переведи описание Bio Botanical Shampoo на эстонский", ROWS, "")[0]).toBe("system-4-bio-botanical-shampoo");
    expect(namedProductIds("какая выручка за неделю", ROWS, "")).toEqual([]);
    expect(namedPages("перепиши текст раздела Борода", ["Kevin.Murphy"])).toEqual([{ page: "section", key: "beard" }]);
    expect(namedPages("сделай заголовок для страницы Kevin.Murphy", ["Kevin.Murphy", "Davines"])).toEqual([{ page: "brand", key: "Kevin.Murphy" }]);
  });
});

describe("POST /api/assistant — the texts reach the prompt, and a refused text is said", () => {
  let admin = "";
  let ipN = 0;
  const req = (body: unknown) => new NextRequest(`${ORIGIN}/api/assistant/`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "rempireshop.com", origin: ORIGIN, cookie: admin, "x-forwarded-for": `203.0.113.${(ipN++ % 200) + 1}` },
    body: JSON.stringify(body),
  });
  const completion = (content: unknown) => new Response(
    JSON.stringify({ model: "test", choices: [{ message: { content: JSON.stringify(content) } }], usage: {} }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(async () => {
    delete process.env.OPENAI_API_KEY;
    await teardownDb();
  });
  beforeEach(async () => {
    resetRateLimits();
    process.env.OPENAI_API_KEY = "sk-test-dummy";
    vi.spyOn(console, "error").mockImplementation(() => {});
    await truncateAll();
    await exec("truncate custom_products");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("the open product's description and the named page's texts are in the system prompt", async () => {
    await setDescriptionOverride("kevin-murphy-angel-wash", { RU: "Свой текст Рената про ANGEL.WASH." });
    let system = "";
    vi.stubGlobal("fetch", vi.fn(async (_u: string, init: { body: string }) => {
      system = JSON.parse(init.body).messages[0].content;
      return completion({ reply: "ok", product_ids: [], action: null });
    }));
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req({ mode: "admin", product: "kevin-murphy-angel-wash", messages: [{ role: "user", content: "переведи описание и текст раздела Борода на эстонский" }] }));
    expect(res.status).toBe(200);
    expect(system).toContain("THE PRODUCT OPEN ON THE OWNER'S SCREEN");
    expect(system).toContain("never ask which one");
    expect(system).toContain("Свой текст Рената про ANGEL.WASH.");
    expect(system).toContain("PAGES THE OWNER MEANS");
    expect(system).toContain("Habemehooldusvahendid");   // the beard section's standard Estonian line
    expect(system).toContain('"type":"set_page_texts"');
    expect(system).toContain("шампунь, кондиционер");     // the type words a rename may use
  });

  it("a text the checks refused leaves no card and says why", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completion({
      reply: "Перевёл описание — подтвердите.",
      product_ids: [],
      action: { type: "set_description", id: "kevin-murphy-angel-wash", value: { ET: "Õrn шампунь peentele juustele." } },
    })));
    const { POST } = await import("@/app/api/assistant/route");
    const res = await (await POST(req({ mode: "admin", messages: [{ role: "user", content: "переведи описание ANGEL.WASH" }] }))).json();
    expect(res.action).toBeNull();
    expect(res.reply).toContain("не прошёл проверку магазина");
    expect(res.retry).toBe(true);
  });
});

describe("the panel lays the assistant's texts over what the product has (public/shop2/app.js)", () => {
  const APP = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
  const sliceFn = (name: string): string => {
    const start = APP.indexOf(`  function ${name}(`);
    if (start < 0) throw new Error(name);
    let depth = 0;
    for (let i = APP.indexOf("{", start); i < APP.length; i++) {
      if (APP[i] === "{") depth++;
      else if (APP[i] === "}" && --depth === 0) return APP.slice(start, i + 1);
    }
    throw new Error(name);
  };
  const fns = new Function(`
    var SEO_LANGS = ["RU", "ET", "EN"];
    ${["seoNorm", "seoMerge", "descMerge"].map(sliceFn).join("\n")}
    return { seoMerge: seoMerge, descMerge: descMerge };
  `)() as { seoMerge: (c: unknown, l: unknown) => unknown; descMerge: (c: unknown, v: unknown) => unknown };

  it("a language the assistant left out keeps its own", () => {
    expect(fns.descMerge({ RU: "Ру", ET: "Ee" }, { EN: "En" })).toEqual({ RU: "Ру", ET: "Ee", EN: "En" });
    expect(fns.seoMerge({ RU: { t: "T", d: "D" } }, { ET: { t: "Et", d: "Ed" } })).toEqual({ RU: { t: "T", d: "D" }, ET: { t: "Et", d: "Ed" } });
  });

  it("the open product travels with the question; each text action has its own way in", () => {
    expect(APP).toContain('post: blogOpenForAI(), product: S.adminEdit && S.adminEdit !== "new" ? String(S.adminEdit) : null })');
    expect(APP).toContain('if (pa.type === "set_size_prices") { applySizePrices(pa); return; }');
    expect(APP).toContain('admSetWhenReady(function () { admSetApply(pa, "Тексты страниц сохранены"); render(); });');
    expect(sliceFn("seoOfAction")).toContain("if (a.seo && typeof a.seo === \"object\") return seoMerge(cur, a.seo);");
    expect(APP).toContain('if (act && !act.preview && typeof admTextPreview === "function") act.preview = admTextPreview(act);');
  });
});
