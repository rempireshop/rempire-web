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
import { splitBlocks } from "@/lib/blog-cards";
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
    /* only ids from the slice the model was offered — the shampoo was not
       offered for a beard topic, the invented id never existed; the oil it
       named got its card, after the paragraph that names it, and a second
       product from the slice fills the article up to the minimum (src/lib/
       blog-cards.ts), so `products` is the cards as they stand */
    expect(t.products[0]).toBe("proraso-beard-oil-azur-lime-30ml");
    expect(t.products).toHaveLength(2);
    expect(t.products).not.toContain("system-4-bio-botanical-shampoo");
    expect(t.products).not.toContain("not-in-the-slice");
    expect(t.body).toContain('<p>Proraso <strong>Beard Oil</strong> после умывания.</p><p><a data-product="proraso-beard-oil-azur-lime-30ml"></a></p>');
    expect(t.body).toContain(`<p><a data-product="${t.products[1]}"></a></p>`);
    expect(userMsg, "the second card is for a product the model was offered").toContain(`${t.products[1]} | `);
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
    expect(body.text.products).toContain("system-4-bio-botanical-shampoo");
    expect(body.text.body).toContain('<a data-product="system-4-bio-botanical-shampoo">');
    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(String((init as RequestInit).body)).messages[1].content).toContain("system-4-bio-botanical-shampoo | System 4 | Bio Botanical Shampoo — шампунь");
  });

  /* The cards are the route's promise, not the model's (Dim, 10.09.2026):
     an article that came back with none gets 2–4 of the products it was
     offered, after the paragraphs they belong to, never two in a row, never
     inside a heading or a list, one of them near the end — and the ids the
     model named, in either shape, get theirs first. */
  it("post_full: an article without cards leaves with 2–4 of the slice's products in it, placed by the rules", async () => {
    const fetchMock = vi.fn(async () => completion(JSON.stringify({ ...ARTICLE, products: [] })));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "post_full", lang: "RU", input: { topic: "уход за бородой зимой" } }, admin));
    expect(res.status).toBe(200);
    const t = (await res.json()).text as { body: string; products: string[] };
    const cards = [...t.body.matchAll(/<a data-product="([^"]+)"/g)].map((m) => m[1]);
    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(cards.length).toBeLessThanOrEqual(4);
    expect(new Set(cards).size).toBe(cards.length);
    expect(t.products).toEqual(cards);
    // the oil the text names by brand and name, right after that paragraph
    expect(t.body).toContain('<p>Proraso <strong>Beard Oil</strong> после умывания.</p><p><a data-product="proraso-beard-oil-azur-lime-30ml"></a></p>');
    const blocks = splitBlocks(t.body);
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i].html.includes("data-product") && blocks[i - 1].html.includes("data-product"), `two cards in a row: ${blocks[i - 1].html}${blocks[i].html}`).toBe(false);
    }
    for (const b of blocks) if (b.tag !== "p") expect(b.html, `a card inside <${b.tag}>`).not.toContain("data-product");
    expect(blocks.slice(Math.floor((blocks.length * 2) / 3)).some((b) => b.html.includes("data-product")), "no card in the last third").toBe(true);
    expect(t.body.endsWith("<p>Заходите на Mardi 1.</p>"), "the article no longer ends in words").toBe(true);
    // every one of them is a product the model was offered
    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const userMsg = JSON.parse(String((init as RequestInit).body)).messages[1].content as string;
    for (const id of cards) expect(userMsg).toContain(`${id} | `);
  });

  it("post_full: `products` as {id, after} is read too — the card goes after the paragraph the hint points at", async () => {
    const body = "<p>Первый абзац о зиме.</p><h2>Масло</h2><p>Второй абзац о масле.</p><h2>Бальзам</h2><p>Третий абзац о бальзаме.</p><p>Четвёртый, заключительный.</p>";
    vi.stubGlobal("fetch", vi.fn(async () => completion(JSON.stringify({
      ...ARTICLE, body,
      products: [{ id: "proraso-beard-oil-azur-lime-30ml", after: "Масло" }, { id: "proraso-wood-spice-beard-balm-100ml", after: 3 }],
    }))));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "post_full", lang: "RU", input: { topic: "уход за бородой зимой" } }, admin));
    const t = (await res.json()).text as { body: string; products: string[] };
    expect(t.body).toContain('<p>Второй абзац о масле.</p><p><a data-product="proraso-beard-oil-azur-lime-30ml"></a></p>');
    expect(t.body).toContain('<p>Третий абзац о бальзаме.</p><p><a data-product="proraso-wood-spice-beard-balm-100ml"></a></p>');
    expect(t.products).toEqual(["proraso-beard-oil-azur-lime-30ml", "proraso-wood-spice-beard-balm-100ml"]);
  });

  /* «Показывать в магазине» off, or the stock set to «нет» — by hand or by
     the count (product_overrides): neither is offered to the model, and a
     card the model wrote for one anyway does not survive. A recommendation
     to buy what cannot be bought is a dead end in a published article. */
  it("post_full: a hidden product and one out of stock are neither offered nor placed", async () => {
    const { upsertOverride } = await import("@/lib/orders");
    await upsertOverride("proraso-beard-oil-azur-lime-30ml", { hidden: true });
    await upsertOverride("proraso-wood-spice-beard-balm-100ml", { stock: "out" });
    const body =
      '<p>Зимой борода сохнет.</p>' +
      '<p><a data-product="proraso-beard-oil-azur-lime-30ml"></a></p>' +
      '<p>Бальзам утром.</p>' +
      '<p><a data-product="proraso-wood-spice-beard-balm-100ml"></a></p>' +
      '<p>Заходите на Mardi 1.</p>';
    const fetchMock = vi.fn(async () => completion(JSON.stringify({ ...ARTICLE, body, products: ["proraso-beard-oil-azur-lime-30ml", "proraso-wood-spice-beard-balm-100ml"] })));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "post_full", lang: "RU", input: { topic: "уход за бородой зимой" } }, admin));
    expect(res.status).toBe(200);
    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const userMsg = JSON.parse(String((init as RequestInit).body)).messages[1].content as string;
    expect(userMsg, "a hidden product was offered").not.toContain("proraso-beard-oil-azur-lime-30ml");
    expect(userMsg, "a product out of stock was offered").not.toContain("proraso-wood-spice-beard-balm-100ml");
    expect(userMsg).toMatch(/proraso-beard-oil-[a-z0-9-]+ \| Proraso/);   // the other oils still are
    const t = (await res.json()).text as { body: string; products: string[] };
    expect(t.body).not.toContain("proraso-beard-oil-azur-lime-30ml");
    expect(t.body).not.toContain("proraso-wood-spice-beard-balm-100ml");
    expect(t.products).not.toContain("proraso-beard-oil-azur-lime-30ml");
    expect(t.products).not.toContain("proraso-wood-spice-beard-balm-100ml");
    // and the article still has its cards — the next best of the slice
    expect(t.products.length).toBeGreaterThanOrEqual(2);
    for (const id of t.products) expect(userMsg).toContain(`${id} | `);
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

  it("post_full: the text around the cards is left exactly as the allowlist wrote it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => completion(JSON.stringify(ARTICLE))));
    const { POST } = await import("@/app/api/admin/ai/text/route");
    const res = await POST(req({ task: "post_full", lang: "RU", input: { topic: "уход за бородой зимой" } }, admin));
    const t = (await res.json()).text;
    // the cards out again, the article is the sanitiser's own
    expect(t.body.replace(/<p><a data-product="[^"]+"><\/a><\/p>/g, "")).toBe(
      "<p>Зимой борода становится суше.</p><h2>Масло каждый вечер</h2><p>Proraso <strong>Beard Oil</strong> после умывания.</p><ul><li>капля</li><li>две</li></ul><p>Заходите на Mardi 1.</p>",
    );
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
