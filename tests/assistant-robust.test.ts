/**
 * The assistant never shows raw JSON. What the owner saw — a draft_post cut
 * by max_tokens, printed into the panel as `{"reply":"Написал черновик…"` —
 * is pinned here at the route: OpenAI is stubbed at fetch with a cut, a
 * fenced or a prefixed answer, and what comes back is a sentence, a retry
 * flag, and (for the cut article) the short draft_post the panel writes
 * the rest of. Plus the two things the prompt now carries: the photos the
 * panel attached, and the blog list a slug comes from.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { upsertPost } from "@/lib/blog";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const HOST = "rempireshop.com";
let ipN = 0;
const freshIp = () => `203.0.113.${(ipN++ % 200) + 1}`;

function req(body: unknown, cookie: string) {
  return new NextRequest(`${ORIGIN}/api/assistant/`, {
    method: "POST",
    headers: { "content-type": "application/json", host: HOST, origin: ORIGIN, cookie, "x-forwarded-for": freshIp() },
    body: JSON.stringify(body),
  });
}

/** Records what the route sends to OpenAI and answers with `content` as the model wrote it. */
function stubOpenAI(content: string, finish = "stop") {
  const sent: Array<{ max_tokens: number; messages: Array<{ role: string; content: string }> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(
      JSON.stringify({ model: "gpt-4.1-mini", choices: [{ message: { content }, finish_reason: finish }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }));
  return sent;
}

const FULL_DRAFT = {
  reply: "Написал черновик статьи об уходе за бородой зимой на трёх языках — посмотрите в «Блоге».",
  product_ids: [],
  tab: "blog",
  action: {
    type: "draft_post",
    title: { RU: "Как ухаживать за бородой зимой", ET: "Kuidas hooldada habet talvel", EN: "Winter beard care" },
    excerpt: { RU: "Три привычки.", ET: "Kolm harjumust.", EN: "Three habits." },
    body: { RU: "# Зима\n\nЗимой борода становится суше — виновата не только погода, но и отопление в помещении, и вода из-под крана." },
  },
};

describe("POST /api/assistant — what comes back is always a sentence", () => {
  let admin = "";
  const savedKey = process.env.OPENAI_API_KEY;

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    process.env.OPENAI_API_KEY = "sk-test-dummy";
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
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a full draft_post cut by max_tokens becomes the short form — the reply is the model's sentence, the action a topic", async () => {
    const text = JSON.stringify(FULL_DRAFT);
    stubOpenAI(text.slice(0, text.indexOf("отопление")), "length");
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req({ mode: "admin", messages: [{ role: "user", content: "напиши статью про уход за бородой зимой" }] }, admin));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.v).toBe(20);
    expect(body.reply).toBe(FULL_DRAFT.reply);
    expect(body.reply).not.toMatch(/[{}]/);
    expect(body.truncated).toBe(true);
    expect(body.retry).toBeUndefined();
    expect(body.action).toEqual({ type: "draft_post", topic: "Как ухаживать за бородой зимой", lang: "RU", hint: "" });
    expect(body.tab).toBe("blog");
  });

  it("an answer cut inside the reply itself: a sentence with a plain-Russian ending and a retry, never the raw text", async () => {
    stubOpenAI('{"reply":"Ставлю цену 9 € для Kevin.Murphy PLUMPING.WASH и ещё', "length");
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req({ mode: "admin", messages: [{ role: "user", content: "подними цену" }] }, admin));
    const body = await res.json();
    expect(body.reply).toMatch(/^Ставлю цену 9 €/);
    expect(body.reply).toContain("оборвался");
    expect(body.reply).not.toMatch(/[{}"]/);
    expect(body.retry).toBe(true);
    expect(body.action).toBeNull();
  });

  it("an answer that is not JSON at all: the fallback sentence and a retry", async () => {
    stubOpenAI("Извините, я не могу помочь с этим.");
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req({ mode: "admin", messages: [{ role: "user", content: "привет" }] }, admin));
    const body = await res.json();
    expect(body.reply).toContain("спросите ещё раз");
    expect(body.reply).not.toMatch(/[{}]/);
    expect(body.retry).toBe(true);
  });

  it("a fenced answer and one with prose around it are read like a clean one", async () => {
    const clean = { reply: "Ставлю цену 9 € — подтвердите.", product_ids: [], tab: "goods", action: { type: "set_price", id: "system-4-bio-botanical-shampoo", value: 9 } };
    stubOpenAI("Вот:\n```json\n" + JSON.stringify(clean) + "\n```\nГотово.");
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req({ mode: "admin", messages: [{ role: "user", content: "цена 9" }] }, admin));
    const body = await res.json();
    expect(body.reply).toBe(clean.reply);
    expect(body.action).toEqual(clean.action);
    expect(body.retry).toBeUndefined();
    expect(body.truncated).toBeUndefined();
  });

  it("a reply that is itself JSON text is replaced by the fallback sentence", async () => {
    stubOpenAI(JSON.stringify({ reply: '{"reply":"вложенный","action":{}}', product_ids: [], tab: "" }));
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req({ mode: "admin", messages: [{ role: "user", content: "что-то" }] }, admin));
    const body = await res.json();
    expect(body.reply).not.toContain("{");
    expect(body.retry).toBe(true);
  });

  it("the admin gets room for its longest honest action; the shop chat keeps a small cap", async () => {
    const sentAdmin = stubOpenAI(JSON.stringify({ reply: "ок", product_ids: [], tab: "" }));
    const { POST } = await import("@/app/api/assistant/route");
    await POST(req({ mode: "admin", messages: [{ role: "user", content: "привет" }] }, admin));
    expect(sentAdmin[0].max_tokens).toBe(1500);
    vi.unstubAllGlobals();
    const sentShop = stubOpenAI(JSON.stringify({ reply: "ок", product_ids: [] }));
    await POST(req({ messages: [{ role: "user", content: "привет" }] }, ""));
    expect(sentShop[0].max_tokens).toBe(400);
  });

  it("the prompt asks for a topic, not an article — and says the panel writes the rest", async () => {
    const sent = stubOpenAI(JSON.stringify({ reply: "ок", product_ids: [], tab: "" }));
    const { POST } = await import("@/app/api/assistant/route");
    await POST(req({ mode: "admin", messages: [{ role: "user", content: "напиши статью" }] }, admin));
    const system = sent[0].messages[0].content;
    expect(system).toContain('{"type":"draft_post","topic":');
    expect(system).toMatch(/NEVER write the article inside this JSON/);
    expect(system).toMatch(/opens it in the blog editor/);
    expect(system).not.toContain('"body":{"RU":"# Зимний уход за бородой');
  });
});

describe("POST /api/assistant — photos and posts in the prompt", () => {
  let admin = "";
  const savedKey = process.env.OPENAI_API_KEY;
  const KEY = "products/inbox/1757000000000-img-4321.webp";

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    process.env.OPENAI_API_KEY = "sk-test-dummy";
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
  });
  afterEach(() => vi.unstubAllGlobals());

  it("an attached photo is named in the prompt with the two photo actions, and its action passes the door", async () => {
    const sent = stubOpenAI(JSON.stringify({
      reply: "Ставлю фото главным — подтвердите.", product_ids: [], tab: "goods",
      action: { type: "add_product_photo", id: "system-4-bio-botanical-shampoo", key: KEY, main: true },
    }));
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req({
      mode: "admin",
      messages: [{ role: "user", content: "вот фото для Bio Botanical Shampoo, сделай главным" }],
      attachments: [{ key: KEY, name: "IMG_4321.jpg" }],
    }, admin));
    const body = await res.json();
    expect(body.action).toEqual({ type: "add_product_photo", id: "system-4-bio-botanical-shampoo", key: KEY, main: true });
    const system = sent[0].messages[0].content;
    expect(system).toContain(`${KEY} | IMG_4321.jpg`);
    expect(system).toContain('"type":"add_product_photo"');
    expect(system).toContain('"type":"set_post_cover"');
  });

  it("without an attachment the photo actions are not offered, and one proposed anyway is refused", async () => {
    const sent = stubOpenAI(JSON.stringify({
      reply: "ок", product_ids: [], tab: "goods",
      action: { type: "add_product_photo", id: "system-4-bio-botanical-shampoo", key: KEY, main: true },
    }));
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req({ mode: "admin", messages: [{ role: "user", content: "поставь фото" }] }, admin));
    expect((await res.json()).action).toBeNull();
    const system = sent[0].messages[0].content;
    expect(system).not.toContain('"type":"add_product_photo"');
    expect(system).toMatch(/ask him to attach it/);
  });

  it("a key the panel did not upload is refused even when another one was", async () => {
    stubOpenAI(JSON.stringify({
      reply: "ок", product_ids: [], tab: "goods",
      action: { type: "add_product_photo", id: "system-4-bio-botanical-shampoo", key: "products/inbox/9-somebody-else.webp", main: true },
    }));
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req({ mode: "admin", messages: [{ role: "user", content: "фото" }], attachments: [{ key: KEY }] }, admin));
    expect((await res.json()).action).toBeNull();
  });

  it("a message about the blog carries the post list — drafts included — so a slug can be named", async () => {
    await upsertPost({ title: { RU: "Черновик про бороду", ET: "", EN: "" }, slug: "chernovik-pro-borodu" });
    const sent = stubOpenAI(JSON.stringify({ reply: "ок", product_ids: [], tab: "blog", action: { type: "publish_post", slug: "chernovik-pro-borodu", publish: true } }));
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req({ mode: "admin", messages: [{ role: "user", content: "опубликуй статью про бороду" }] }, admin));
    expect((await res.json()).action).toEqual({ type: "publish_post", slug: "chernovik-pro-borodu", publish: true });
    expect(sent[0].messages[0].content).toContain("chernovik-pro-borodu|draft|Черновик про бороду");

    // …and a message about prices does not pay for the list
    vi.unstubAllGlobals();
    const sent2 = stubOpenAI(JSON.stringify({ reply: "ок", product_ids: [], tab: "" }));
    await POST(req({ mode: "admin", messages: [{ role: "user", content: "какая выручка" }] }, admin));
    expect(sent2[0].messages[0].content).not.toContain("chernovik-pro-borodu");
  });
});
