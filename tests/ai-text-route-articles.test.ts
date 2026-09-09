/**
 * POST /api/admin/ai/text for the article generator and the «✨» texts —
 * OpenAI stubbed at fetch, same idiom as tests/ai-text-route.test.ts. What
 * is pinned is the route's own work around the model: the per-task token
 * budget, the catalogue slice offered for the topic and the answer's
 * products — the list it names and the cards it placed in the body alike —
 * filtered against exactly that slice, the body through the blog's HTML
 * allowlist, the caps on every field, a cut article refused rather than
 * saved half-written, a fenced answer still read.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const HOST = "rempireshop.com";

function req(body: unknown, cookie: string) {
  return new NextRequest(`${ORIGIN}/api/admin/ai/text/`, {
    method: "POST",
    headers: { "content-type": "application/json", host: HOST, cookie },
    body: JSON.stringify(body),
  });
}

/** A chat completion whose message is `content` (a string as the model wrote it). */
function completion(content: string, finish = "stop") {
  return new Response(
    JSON.stringify({ model: "gpt-4.1-mini", choices: [{ message: { content }, finish_reason: finish }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const ARTICLE = {
  title: "Как ухаживать за бородой зимой",
  excerpt: "Зимой борода сохнет. Три привычки, которые это исправляют.",
  body: "<p>Зимой борода становится суше.</p><h2>Масло каждый вечер</h2><p>Proraso <strong>Beard Oil</strong> после умывания.</p><ul><li>капля</li><li>две</li></ul><script>alert(1)</script><p onclick=\"x()\">Заходите на Mardi 1.</p>",
  tags: ["борода", "ЗИМА", "уход", "масло", "бальзам", "шестой", "седьмой"],
  seoTitle: "Уход за бородой зимой: три привычки",
  seoDescription: "Мороз и отопление сушат бороду. Масло вечером, бальзам утром — и борода доживёт до весны мягкой.",
  products: ["proraso-beard-oil-azur-lime-30ml", "not-in-the-slice", "system-4-bio-botanical-shampoo"],
};

describe("POST /api/admin/ai/text — post_full, post_translate, copy", () => {
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

  it("post_full: a bigger token budget, the catalogue slice for the topic in the prompt, and the answer shaped and filtered", async () => {
    const fetchMock = vi.fn(async () => completion(JSON.stringify(ARTICLE)));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "post_full", lang: "RU", input: { topic: "уход за бородой зимой" } }, admin));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // the request: room for a whole article, and beard products offered for a beard topic
    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const payload = JSON.parse(String((init as RequestInit).body));
    expect(payload.max_tokens).toBe(4500);
    expect(payload.response_format).toEqual({ type: "json_object" });
    const userMsg = payload.messages[1].content as string;
    expect(userMsg).toContain("Topic: уход за бородой зимой");
    expect(userMsg).toMatch(/proraso-beard-oil-azur-lime-30ml \| Proraso/);
    expect(userMsg).not.toContain("not-in-the-slice");

    // the answer: every field the editor has, capped and cleaned
    const t = body.text;
    expect(t.title).toBe(ARTICLE.title);
    expect(t.excerpt).toBe(ARTICLE.excerpt);
    expect(t.body).toContain("<h2>Масло каждый вечер</h2>");
    expect(t.body).toContain("<strong>Beard Oil</strong>");
    expect(t.body).toContain("<ul><li>капля</li><li>две</li></ul>");
    expect(t.body.toLowerCase()).not.toContain("<script");
    expect(t.body).not.toContain("onclick");
    expect(t.tags).toEqual(["борода", "зима", "уход", "масло", "бальзам"]);   // five, lowercase
    expect(t.seo).toEqual({ title: ARTICLE.seoTitle, description: ARTICLE.seoDescription });
    // only ids from the slice the model was offered — the shampoo was not offered for a beard topic
    expect(t.products).toEqual(["proraso-beard-oil-azur-lime-30ml"]);
  });

  it("post_full: the products the editor already picked are offered too, and come back if mentioned", async () => {
    const fetchMock = vi.fn(async () => completion(JSON.stringify({ ...ARTICLE, products: ["system-4-bio-botanical-shampoo"] })));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({
      task: "post_full", lang: "RU",
      input: { topic: "уход за бородой зимой", products: [{ id: "system-4-bio-botanical-shampoo", brand: "System 4", name: "Bio Botanical Shampoo — шампунь" }] },
    }, admin));
    const body = await res.json();
    expect(body.text.products).toEqual(["system-4-bio-botanical-shampoo"]);
    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(String((init as RequestInit).body)).messages[1].content).toContain("system-4-bio-botanical-shampoo | System 4 | Bio Botanical Shampoo — шампунь");
  });

  /* The article places its own product cards in the body — the editor's own
     `<a data-product>` marker. A card is a link to a product page, so an id
     the model invented is a dead link in a published article that the owner
     could only find by reading it: the ids in the body are filtered against
     the same slice the answer's `products` is, and a card that loses its id
     loses its tag too, keeping whatever words were inside. */
  it("post_full: a card for a product that was offered survives, one for anything else does not", async () => {
    const body =
      '<p>Зимой борода сохнет.</p>' +
      '<p><a data-product="proraso-beard-oil-azur-lime-30ml"></a></p>' +          // offered for this topic
      '<p><a data-product="system-4-bio-botanical-shampoo"></a></p>' +            // real, but not in this slice
      '<p><a data-product="proraso-beard-oil-2000ml">Масло на два литра</a></p>'; // never existed
    vi.stubGlobal("fetch", vi.fn(async () => completion(JSON.stringify({ ...ARTICLE, body, products: [] }))));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "post_full", lang: "RU", input: { topic: "уход за бородой зимой" } }, admin));
    expect(res.status).toBe(200);
    const t = (await res.json()).text;
    expect(t.body).toContain('<a data-product="proraso-beard-oil-azur-lime-30ml">');
    expect(t.body, "a card for a product this topic was never offered").not.toContain("system-4-bio-botanical-shampoo");
    expect(t.body, "a card for a product that does not exist").not.toContain("proraso-beard-oil-2000ml");
    // the tag went, its words stayed — an article never loses text to this
    expect(t.body).toContain("Масло на два литра");
    expect(t.body).toContain("<p>Зимой борода сохнет.</p>");
  });

  it("post_full: a body with no cards is left exactly as the allowlist wrote it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completion(JSON.stringify(ARTICLE))));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "post_full", lang: "RU", input: { topic: "уход за бородой зимой" } }, admin));
    const t = (await res.json()).text;
    expect(t.body).not.toContain("data-product");
    expect(t.body).toContain("<h2>Масло каждый вечер</h2>");
  });

  it("post_full: a card for a product the editor itself picked is kept — that list is offered too", async () => {
    const body = '<p>Мойте голову.</p><p><a data-product="system-4-bio-botanical-shampoo"></a></p>';
    vi.stubGlobal("fetch", vi.fn(async () => completion(JSON.stringify({ ...ARTICLE, body, products: [] }))));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({
      task: "post_full", lang: "RU",
      input: { topic: "уход за бородой зимой", products: [{ id: "system-4-bio-botanical-shampoo", brand: "System 4", name: "Bio Botanical Shampoo — шампунь" }] },
    }, admin));
    expect((await res.json()).text.body).toContain('<a data-product="system-4-bio-botanical-shampoo">');
  });

  it("post_full: a cut article is refused as `truncated`, never handed back half-written", async () => {
    const cut = JSON.stringify(ARTICLE).slice(0, 200);
    vi.stubGlobal("fetch", vi.fn(async () => completion(cut, "length")));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "post_full", lang: "RU", input: { topic: "борода" } }, admin));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("truncated");
  });

  it("post_full: a fenced answer is still read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completion("```json\n" + JSON.stringify(ARTICLE) + "\n```")));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "post_full", lang: "RU", input: { topic: "борода" } }, admin));
    expect(res.status).toBe(200);
    expect((await res.json()).text.title).toBe(ARTICLE.title);
  });

  it("post_full: 400s without a topic, before any model call", async () => {
    vi.stubGlobal("fetch", () => { throw new Error("must not call OpenAI without a topic"); });
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "post_full", lang: "RU", input: {} }, admin));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_topic");
  });

  it("post_translate: the same shape back, HTML cleaned, the Google pair capped, no products key", async () => {
    const et = { title: "Kuidas hooldada habet talvel", excerpt: "Kolm harjumust.", body: "<p>Talvel muutub habe kuivemaks.</p><h2>Õli</h2><img src=x onerror=alert(1)>", tags: ["habe", "talv"], seoTitle: "T".repeat(90), seoDescription: "D".repeat(200) };
    const fetchMock = vi.fn(async () => completion(JSON.stringify(et)));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({
      task: "post_translate", lang: "ET",
      input: { sourceLang: "RU", title: ARTICLE.title, excerpt: ARTICLE.excerpt, body: ARTICLE.body, tags: ["борода"], seoTitle: ARTICLE.seoTitle, seoDescription: ARTICLE.seoDescription },
    }, admin));
    expect(res.status).toBe(200);
    const t = (await res.json()).text;
    expect(t.title).toBe(et.title);
    expect(t.body).toContain("<h2>Õli</h2>");
    expect(t.body).not.toContain("onerror");
    expect(t.seo.title).toHaveLength(70);
    expect(t.seo.description).toHaveLength(170);
    expect(t.tags).toEqual(["habe", "talv"]);
    expect(t).not.toHaveProperty("products");
    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(String((init as RequestInit).body)).max_tokens).toBe(4500);
  });

  it("post_translate: refuses the source language as the target", async () => {
    vi.stubGlobal("fetch", () => { throw new Error("must not call OpenAI"); });
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "post_translate", lang: "RU", input: { sourceLang: "RU", title: "x", body: "<p>y</p>" } }, admin));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("same_language");
  });

  it("copy: a small budget, and the answer shaped to the banner's own caps", async () => {
    const fetchMock = vi.fn(async () => completion(JSON.stringify({ eyebrow: "Только сейчас", title: "−20 % на бороду и всё что рядом с ней в этом сезоне", sub: "Масла и бальзамы.", cta: "Смотреть" })));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "copy", lang: "RU", input: { kind: "hero", hint: "скидка на бороду" } }, admin));
    expect(res.status).toBe(200);
    const t = (await res.json()).text;
    expect(t.eyebrow).toBe("Только сейчас");
    expect(t.title).toHaveLength(40);
    expect(t.sub).toBe("Масла и бальзамы.");
    expect(t.cta).toBe("Смотреть");
    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(String((init as RequestInit).body)).max_tokens).toBe(400);
  });

  it("copy: an unknown kind is refused before the model is called", async () => {
    vi.stubGlobal("fetch", () => { throw new Error("must not call OpenAI"); });
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "copy", lang: "RU", input: { kind: "slogan", hint: "x" } }, admin));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("bad_kind");
  });

  it("the short tasks keep their 900-token budget", async () => {
    const fetchMock = vi.fn(async () => completion(JSON.stringify({ title: "t", h2: ["a"], metaTitle: "m", metaDescription: "d" })));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/admin/ai/text/route");
    await POST(req({ task: "blog_outline", lang: "RU", input: { topic: "x" } }, admin));
    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(String((init as RequestInit).body)).max_tokens).toBe(900);
  });
});
