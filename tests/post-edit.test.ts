/**
 * «Исправь статью» — the chat assistant's edit_post (Dim, 20.10.2026: the
 * assistant has to be able to fix an article that already exists; the first
 * case was a Kevin.Murphy shampoo article whose products were plain words,
 * not links into the shop).
 *
 *   - the assistant may propose it only for the article open in the editor,
 *     and the request it carries is the owner's own words (actions.ts);
 *   - POST /api/admin/ai/text task post_edit offers the products the text
 *     names, turns href="product:ID" into the product's page in the
 *     article's language, drops any id it did not offer, and refuses an
 *     answer that lost a good part of the article;
 *   - the panel runs it per language, cards and pictures lifted out and put
 *     back, all or nothing, and saves with «Вернуть» on the toast (app.js).
 *
 * OpenAI is a stubbed fetch, as in tests/ai-text-route.test.ts.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { AiInputError, buildPostEditPrompt, isAiTask } from "@/lib/ai-prompts";
import { mentionedProducts } from "@/lib/catalogue-slice";
import { editPostWithAsk, sanitizeAction, sanitizeEditPost } from "@/app/api/assistant/actions";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const APP = read("../public/shop2/app.js");
const ASSISTANT_ROUTE = read("../src/app/api/assistant/route.ts");

describe("mentionedProducts — the products an article's text names", () => {
  it("finds a product by its own name, dots, hyphens and case not counting, in the order the text names them", () => {
    const ids = mentionedProducts("<p>Для сухих волос — HYDRATE-ME.WASH, для тонких — Angel Wash.</p>").map((p) => p.id);
    expect(ids).toEqual(["kevin-muprhy-hydrate-me-wash", "kevin-murphy-angel-wash"]);
  });

  it("gives the words to the longer name where two overlap, and still finds the shorter one standing alone", () => {
    const only = mentionedProducts("<p>Blonde.Angel.Wash для блондинок.</p>").map((p) => p.id);
    expect(only).toEqual(["kevin-muprhy-blonde-angel-wash"]);
    const both = mentionedProducts("<p>Blonde.Angel.Wash, а потом Angel.Wash.</p>").map((p) => p.id);
    expect(both).toEqual(["kevin-muprhy-blonde-angel-wash", "kevin-murphy-angel-wash"]);
  });

  it("finds two names that stand side by side", () => {
    const ids = mentionedProducts("<li>Angel.Wash Angel.Rinse</li>").map((p) => p.id);
    expect(ids).toEqual(["kevin-murphy-angel-wash", "kevin-murphy-angel-rinse"]);
  });

  it("names nothing for a text about no product", () => {
    expect(mentionedProducts("<p>Мойте голову тёплой водой.</p>")).toEqual([]);
  });
});

describe("buildPostEditPrompt", () => {
  const input = {
    ask: "сделай товары ссылками на магазин",
    title: "Kevin.Murphy: какой выбрать шампунь",
    body: "<p>Angel.Wash для тонких волос.</p>",
    products: [{ id: "kevin-murphy-angel-wash", brand: "Kevin.Murphy", name: "ANGEL.WASH — шампунь" }],
  };

  it("is a task the route knows", () => {
    expect(isAiTask("post_edit")).toBe(true);
  });

  it("carries the owner's words, the article and the products a link may point at", () => {
    const { system, user } = buildPostEditPrompt("RU", input);
    expect(user).toContain("«сделай товары ссылками на магазин»");
    expect(user).toContain("kevin-murphy-angel-wash | Kevin.Murphy | ANGEL.WASH — шампунь");
    expect(user).toContain("<p>Angel.Wash для тонких волос.</p>");
    expect(system).toContain('<a href="product:ID">');
    expect(system).toMatch(/word for word/);
    expect(system).toContain("Never write a web address of your own");
    expect(system).toContain('"summary"');
  });

  it("says plainly there is nothing to link when no product is offered", () => {
    const { user } = buildPostEditPrompt("RU", { ...input, products: [] });
    expect(user).toMatch(/PRODUCTS: none/);
  });

  it("refuses a request with no words or no article", () => {
    expect(() => buildPostEditPrompt("RU", { ...input, ask: "  " })).toThrow(AiInputError);
    expect(() => buildPostEditPrompt("RU", { ...input, body: "" })).toThrow(AiInputError);
  });
});

describe("edit_post in the chat assistant", () => {
  const known = new Set<string>();

  it("is the article open on the owner's screen, or nothing", () => {
    expect(sanitizeEditPost({ what: "ссылки на товары" }, "kevin-murphy-shampoo")).toEqual({ slug: "kevin-murphy-shampoo", what: "ссылки на товары" });
    expect(sanitizeEditPost({ slug: "kevin-murphy-shampoo" }, "kevin-murphy-shampoo")).toEqual({ slug: "kevin-murphy-shampoo", what: "" });
    expect(sanitizeEditPost({ slug: "another-post" }, "kevin-murphy-shampoo")).toBeNull();
    expect(sanitizeEditPost({ what: "x" }, "")).toBeNull();
    expect(sanitizeAction({ type: "edit_post", what: "x" }, known, true, { openPostSlug: "" })).toBeNull();
    expect(sanitizeAction({ type: "edit_post", what: "x" }, known, true, { openPostSlug: "a-post" })).toEqual({ type: "edit_post", slug: "a-post", what: "x" });
    // never for a shopper
    expect(sanitizeAction({ type: "edit_post" }, known, false, { openPostSlug: "a-post" })).toBeNull();
  });

  it("carries the owner's own words, and is not offered without them", () => {
    const a = { type: "edit_post", slug: "a-post", what: "ссылки" };
    expect(editPostWithAsk(a, "сделай товары ссылками")).toEqual({ ...a, ask: "сделай товары ссылками" });
    expect(editPostWithAsk(a, "   ")).toBeNull();
    // other actions pass through untouched
    const other = { type: "publish_post", slug: "a-post", publish: true };
    expect(editPostWithAsk(other, "опубликуй")).toBe(other);
  });

  it("is described to the model only when an article is open, and no longer refused there", () => {
    expect(ASSISTANT_ROUTE).toContain('{"type":"edit_post","what":"<one short Russian line: what will change>"}');
    expect(ASSISTANT_ROUTE).toContain("ask him to open that article in «Блог» and ask again");
    expect(ASSISTANT_ROUTE).not.toContain("There is no action that rewrites the text of an article that exists");
    expect(ASSISTANT_ROUTE).toMatch(/editPostWithAsk\(draftPostWithAsk\(sanitizeAction\(/);
  });
});

describe("an article's products — forty in the list, eight on the shelf (20.10.2026)", () => {
  it("the editor offers up to forty and says the shelf shows the first eight", () => {
    expect(APP).toContain("var BLOG_PRODUCTS_MAX = 40;");
    expect(APP).toContain('"Товары в статье — внизу покажем карточками первые 8"');
    expect(APP).toContain("В статье уже 40 товаров — больше не поместится.");
    expect(APP).not.toMatch(/d\.products\.length < 12/);
    // the shelf itself is unchanged: the first eight the owner picked
    expect(APP).toContain("var featured = productsById(post.products).slice(0, 8);");
  });
});

describe("the panel", () => {
  it("applies edit_post in the article editor, never through the journal", () => {
    expect(APP).toMatch(/if \(pa\.type === "edit_post"\) \{ applyEditPost\(pa\); return; \}/);
    const fn = APP.slice(APP.indexOf("function applyEditPost(a)"), APP.indexOf("function blogPatchCover("));
    expect(fn).not.toMatch(/demoApply|journalNote|DEMO\.log/);
    // all or nothing, then saved, with «Вернуть» on the toast
    expect(fn).toContain("blogEditRestore(d, was)");
    expect(fn).toContain('blogAutosave("change")');
    expect(fn).toMatch(/undo: function \(\)/);
  });

  it("sends each language with its cards and pictures lifted out, and puts them back", () => {
    const fn = APP.slice(APP.indexOf("function blogEditLang(d, L, ask)"), APP.indexOf("function blogEditSnapshot(d)"));
    expect(fn).toContain('task: "post_edit", lang: L');
    expect(fn).toContain("blogCardsOut(d.body[L])");
    expect(fn).toContain("blogFigsOut(src.html)");
    expect(fn).toContain("blogFigsIn(txt(tx.body), figs.figs)");
  });

  it("says what the card will do, in all three languages", () => {
    expect(APP).toContain('return "Исправить статью «" + eTitle + "»"');
    expect(APP).toMatch(/\[\/\^Исправить статью «\(\.\+\)»\(\.\*\)\$\/, \{ ET: "Parandada artiklit «\$1»\$2", EN: "Fix the article “\$1”\$2" \}\]/);
    for (const s of ["Исправляю русский текст…", "Статья исправлена — проверьте текст ✓", "Откройте эту статью в «Блоге» и попросите ещё раз"]) {
      expect(APP.split(`"${s}":`).length, s).toBe(3); // the ET and the EN dictionary
    }
  });
});

/* The panel's own functions, cut out of app.js and run against stubs — the
   order of the calls, the all-or-nothing rollback and «Вернуть». */
function sliceFn(name: string): string {
  const at = APP.indexOf(`function ${name}(`);
  if (at < 0) throw new Error("app.js has no " + name);
  let depth = 0;
  for (let i = APP.indexOf("{", at); i < APP.length; i++) {
    if (APP[i] === "{") depth++;
    else if (APP[i] === "}" && --depth === 0) return APP.slice(at, i + 1);
  }
  throw new Error("no end for " + name);
}
type Reply = { status: number; body: Record<string, unknown> };
function panel(replies: Record<string, Reply>) {
  const calls: Array<{ lang: string; input: Record<string, string> }> = [];
  const toasts: Array<{ msg: string; undo?: { undo: () => void } }> = [];
  const saves: string[] = [];
  const S: Record<string, unknown> = { adminTab: "blog", adminBlogGen: null };
  const env = {
    S, ADM_FOLD: { "blog-ai": true },
    admFoldToggle: () => {}, render: () => {}, blogReadForm: () => {}, uiWant: () => Promise.resolve(),
    blogAutosave: (ev: string) => { saves.push(ev); },
    toast: (msg: string, undo?: { undo: () => void }) => { toasts.push({ msg, undo }); },
    txt: (v: unknown) => (typeof v === "string" ? v : ""),
    apiSend: (_u: string, _m: string, b: { lang: string; input: Record<string, string> }) => {
      calls.push(b);
      return Promise.resolve(replies[b.lang]);
    },
    blogCardsOut: (h: string) => ({ html: h, cards: [] as string[] }),
    blogCardsIn: (h: string) => h,
    blogFigsOut: (h: string) => ({ html: h, figs: [] }),
    blogFigsIn: (h: string) => h,
    blogCleanHtml: (h: string) => h,
    byIdOrNull: (id: string) => (id.startsWith("km-") ? { id } : null), findCustom: () => null,
    BLOG_PRODUCTS_MAX: 40,
    blogGenErrText: () => "Не получилось — попробуйте ещё раз",
  };
  const src = ["blogEditErrText", "blogEditLang", "blogEditSnapshot", "blogEditRestore", "applyEditPost"].map(sliceFn).join("\n");
  const run = new Function(...Object.keys(env), `${src}\nreturn applyEditPost;`)(...Object.values(env)) as (a: unknown) => void;
  return { S, run, calls, toasts, saves };
}
const draft = () => ({
  slug: "km-shampuni", products: [] as string[],
  title: { RU: "Шампуни", ET: "Šampoonid", EN: "" },
  excerpt: { RU: "", ET: "", EN: "" },
  body: { RU: "<p>Angel.Wash — ru</p>", ET: "<p>Angel.Wash — et</p>", EN: "" },
});
const ok = (body: string): Reply => ({ status: 200, body: { ok: true, text: { title: "", excerpt: "", body, summary: "" } } });
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("the panel's applyEditPost, run", () => {
  it("edits every language that has text, saves, and «Вернуть» puts it all back", async () => {
    const p = panel({ RU: ok('<p><a href="/ru/products/x">Angel.Wash</a> — ru</p>'), ET: ok('<p><a href="/et/products/x">Angel.Wash</a> — et</p>') });
    const d = draft();
    p.S.adminBlogEdit = d;
    p.run({ type: "edit_post", slug: "km-shampuni", ask: "сделай товары ссылками" });
    for (let i = 0; i < 10; i++) await settle();
    expect(p.calls.map((c) => c.lang)).toEqual(["RU", "ET"]); // EN is empty — not sent
    expect(p.calls[0].input.ask).toBe("сделай товары ссылками");
    expect(d.body.RU).toContain('href="/ru/products/x"');
    expect(d.body.ET).toContain('href="/et/products/x"');
    expect(p.saves).toEqual(["change"]);
    const last = p.toasts[p.toasts.length - 1];
    expect(last.msg).toBe("Статья исправлена — проверьте текст ✓");
    last.undo!.undo();
    expect(d.body).toEqual(draft().body);
    expect(p.saves).toEqual(["change", "change"]);
  });

  it("is all or nothing: a language that fails puts every language back and saves nothing", async () => {
    const p = panel({ RU: ok("<p>изменено</p>"), ET: { status: 502, body: { ok: false, error: "lost_text" } } });
    const d = draft();
    p.S.adminBlogEdit = d;
    p.run({ type: "edit_post", slug: "km-shampuni", ask: "исправь" });
    for (let i = 0; i < 10; i++) await settle();
    expect(d.body).toEqual(draft().body);
    expect(p.saves).toEqual([]);
    expect(p.toasts.pop()!.msg).toBe("Помощник потерял часть текста — статья не изменена, попробуйте ещё раз");
  });

  it("lists the products it linked under «Товары в статье», past the old twelve, known ones only", async () => {
    const links = Array.from({ length: 15 }, (_, i) => `<a href="/ru/products/km-${i}">KM ${i}</a>`).join(", ");
    const p = panel({ RU: ok(`<p>${links} и <a href="/ru/products/unknown">чужой</a></p>`), ET: ok("<p>Angel.Wash — et, muudetud</p>") });
    const d = draft();
    d.products = ["km-0"];
    p.S.adminBlogEdit = d;
    p.run({ type: "edit_post", slug: "km-shampuni", ask: "сделай товары ссылками" });
    for (let i = 0; i < 10; i++) await settle();
    expect(d.products).toHaveLength(15);
    expect(d.products.slice(0, 3)).toEqual(["km-0", "km-1", "km-2"]);
    expect(d.products).not.toContain("unknown");
  });

  it("touches nothing when the article is not the one open", () => {
    const p = panel({});
    p.S.adminBlogEdit = { ...draft(), slug: "another" };
    p.run({ type: "edit_post", slug: "km-shampuni", ask: "исправь" });
    expect(p.calls).toEqual([]);
    expect(p.toasts[0].msg).toBe("Откройте эту статью в «Блоге» и попросите ещё раз");
  });
});

const ORIGIN = "https://rempireshop.com";
function req(body: unknown, cookie: string) {
  return new NextRequest(`${ORIGIN}/api/admin/ai/text/`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "rempireshop.com", cookie },
    body: JSON.stringify(body),
  });
}
function completion(content: unknown, finish = "stop") {
  return new Response(JSON.stringify({
    model: "gpt-6-luna",
    choices: [{ message: { content: JSON.stringify(content) }, finish_reason: finish }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { status: 200, headers: { "content-type": "application/json" } });
}

const ARTICLE = [
  "<p>Kevin.Murphy делает шампуни под разные волосы, и выбрать легко, если знать, что вам нужно.</p>",
  "<h2>Для тонких волос</h2>",
  "<p>Angel.Wash мягко очищает и не утяжеляет — подходит для тонких и окрашенных волос, которым нужен объём без тяжести.</p>",
  "<h2>Для сухих волос</h2>",
  "<p>Hydrate-Me.Wash увлажняет и подходит для сухих, жёстких волос — после него волосы мягче и легче расчёсываются.</p>",
  "<p>Спросите мастера на Mardi 1 — он подскажет, какой шампунь ваш, и покажет, как им пользоваться.</p>",
].join("");

describe("POST /api/admin/ai/text — post_edit", () => {
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const input = { ask: "сделай товары ссылками на магазин", title: "Kevin.Murphy: какой выбрать шампунь", excerpt: "", body: ARTICLE };

  it("offers the products the article names and turns product:ID into this language's product page", async () => {
    let sent = "";
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body).messages[1].content;
      return completion({
        title: input.title,
        excerpt: "",
        body: ARTICLE
          .replace("<p>Angel.Wash", '<p><a href="product:kevin-murphy-angel-wash">Angel.Wash</a>')
          .replace("<p>Hydrate-Me.Wash", '<p><a href="product:kevin-murphy-made-up">Hydrate-Me.Wash</a>'),
        summary: "Сделал ссылками 2 товара",
      });
    });
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "post_edit", lang: "RU", input }, admin));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(sent).toContain("kevin-murphy-angel-wash | Kevin.Murphy");
    expect(sent).toContain("kevin-muprhy-hydrate-me-wash | Kevin.Murphy");
    expect(j.text.body).toContain('<a href="/ru/products/kevin-murphy-angel-wash">Angel.Wash</a>');
    // an id the route never offered is no link — its words stay
    expect(j.text.body).toContain("<p>Hydrate-Me.Wash увлажняет");
    expect(j.text.body).not.toContain("product:");
    expect(j.text.summary).toBe("Сделал ссылками 2 товара");
  });

  it("writes the English page without a language prefix", async () => {
    vi.stubGlobal("fetch", async () => completion({
      title: "x", excerpt: "", body: ARTICLE.replace("<p>Angel.Wash", '<p><a href="product:kevin-murphy-angel-wash">Angel.Wash</a>'), summary: "",
    }));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const j = await (await POST(req({ task: "post_edit", lang: "EN", input }, admin))).json();
    expect(j.text.body).toContain('<a href="/products/kevin-murphy-angel-wash">Angel.Wash</a>');
  });

  it("refuses an answer that lost a good part of the article", async () => {
    vi.stubGlobal("fetch", async () => completion({ title: "x", excerpt: "", body: "<p>Angel.Wash для тонких волос.</p>", summary: "" }));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "post_edit", lang: "RU", input }, admin));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("lost_text");
  });

  it("lets a shorter article through when the owner asked for one", async () => {
    vi.stubGlobal("fetch", async () => completion({ title: "x", excerpt: "", body: "<p>Angel.Wash для тонких волос.</p>", summary: "" }));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "post_edit", lang: "RU", input: { ...input, ask: "сократи статью до одного абзаца" } }, admin));
    expect(res.status).toBe(200);
  });

  it("refuses a cut answer as truncated", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
      model: "gpt-6-luna",
      choices: [{ message: { content: '{"title":"x","body":"<p>Angel' }, finish_reason: "length" }],
      usage: {},
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "post_edit", lang: "RU", input }, admin));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("truncated");
  });

  it("400s a request with no words", async () => {
    vi.stubGlobal("fetch", () => { throw new Error("must not call OpenAI"); });
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "post_edit", lang: "RU", input: { ...input, ask: "" } }, admin));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_ask");
  });
});
