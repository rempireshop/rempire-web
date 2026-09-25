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
import { exec } from "@/lib/db";
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
    expect(body.v).toBe(28);   // r28: a promo code's date and cap only when the owner names them
    expect(body.reply).toBe(FULL_DRAFT.reply);
    expect(body.reply).not.toMatch(/[{}]/);
    expect(body.truncated).toBe(true);
    expect(body.retry).toBeUndefined();
    // …with the owner's own words on it (draftPostWithAsk): they, not the model's topic line, decide the subject
    expect(body.action).toEqual({
      type: "draft_post", topic: "Как ухаживать за бородой зимой", lang: "RU", hint: "",
      ask: "напиши статью про уход за бородой зимой",
    });
    expect(body.tab).toBe("blog");
  });

  /* …and the mirror image. ai-json closes a cut document by dropping the
     unfinished member, so an action that REPLACES A WHOLE LIST comes back as
     a shorter list — a banner missing its last slides, a set missing its last
     products, a product missing its last sizes. Applying that salvage deletes
     exactly the part the model never got to write. */
  describe("an action that replaces a whole list is dropped when the answer was cut", () => {
    function cutAt(doc: unknown, marker: string) {
      const text = JSON.stringify(doc);
      const at = text.indexOf(marker);
      expect(at, `the fixture no longer contains ${marker}`).toBeGreaterThan(0);
      return text.slice(0, at + marker.length + 8);
    }

    const slide = (id: string, ru: string) => ({
      id,
      eyebrow: { RU: "Только сейчас", ET: "Ainult praegu", EN: "Right now" },
      title: { RU: ru, ET: "Talv", EN: "Winter" },
      sub: { RU: "Масла, бальзамы и воски.", ET: "Õlid, palsamid ja vahad.", EN: "Oils, balms and waxes." },
      cta: { RU: "Смотреть", ET: "Vaata", EN: "Shop now" },
      go: "cat:beard",
      image: "proraso-wood-spice-beard-balm-100ml",
      on: true,
    });

    it("set_hero: the banner's other slides are not deleted by a cut answer", async () => {
      const doc = {
        reply: "Поменял второй слайд — посмотрите и подтвердите.",
        product_ids: [], tab: "setup",
        action: { type: "set_hero", value: { slides: [slide("s1", "Зима"), slide("s2", "Скидка"), slide("s3", "Наборы")], interval: 6000 } },
      };
      stubOpenAI(cutAt(doc, '"s3"'), "length");
      const { POST } = await import("@/app/api/assistant/route");
      const body = await (await POST(req({ mode: "admin", messages: [{ role: "user", content: "поменяй второй слайд баннера" }] }, admin))).json();
      expect(body.action, "a cut banner was offered as the whole banner").toBeNull();
      expect(body.truncated).toBe(true);
      // the model's own sentence stands, with the panel's «оборвался» after it
      expect(body.reply).toMatch(/^Поменял второй слайд/);
      expect(body.reply).toContain("оборвался");
      expect(body.retry).toBe(true);
    });

    it("set_bundle: the set keeps the products the answer never reached", async () => {
      const items = [
        { id: "proraso-wood-spice-beard-balm-100ml", variant: 0, qty: 1 },
        { id: "system-4-bio-botanical-shampoo", variant: 0, qty: 1 },
        { id: "system-4-bio-botanical-serum", variant: 0, qty: 1 },
      ];
      const doc = {
        reply: "Добавил сыворотку в набор.",
        product_ids: [], tab: "goods",
        action: { type: "set_bundle", id: "nabor-boroda", items, price: 39.9 },
      };
      stubOpenAI(cutAt(doc, "system-4-bio-botanical-serum"), "length");
      const { POST } = await import("@/app/api/assistant/route");
      const body = await (await POST(req({ mode: "admin", messages: [{ role: "user", content: "добавь сыворотку в набор" }] }, admin))).json();
      expect(body.action, "a cut set was offered as the whole set").toBeNull();
      expect(body.reply).toContain("оборвался");
    });

    it("update_product: the size ladder is not shortened by a cut answer", async () => {
      const { createCustomProduct } = await import("@/lib/custom-products");
      const p = await createCustomProduct({
        brand: "Proraso", name: "Beard Balm — бальзам для бороды", cat: "beard",
        sizes: ["50 мл", "100 мл", "250 мл"], prices: [9.9, 14.9, 24.9],
      });
      const doc = {
        reply: "Поднял цену за 50 мл.",
        product_ids: [], tab: "goods",
        action: {
          type: "update_product", id: p.id,
          sizes: [{ size: "50 мл", price: 11.9 }, { size: "100 мл", price: 14.9 }, { size: "250 мл", price: 24.9 }],
        },
      };
      stubOpenAI(cutAt(doc, '"250 мл"'), "length");
      const { POST } = await import("@/app/api/assistant/route");
      const body = await (await POST(req({ mode: "admin", messages: [{ role: "user", content: "подними цену за 50 мл" }] }, admin))).json();
      expect(body.action, "a cut size ladder was offered as the whole ladder").toBeNull();
      expect(body.reply).toContain("оборвался");
      await exec("truncate custom_products");
    });

    it("an action that carries no list is still salvaged — set_price is whole or it is nothing", async () => {
      const doc = {
        reply: "Ставлю цену 9 € для Kevin.Murphy PLUMPING.WASH — подтвердите, и она применится.",
        product_ids: [], tab: "goods",
        action: { type: "set_price", id: "system-4-bio-botanical-shampoo", value: 9 },
      };
      const text = JSON.stringify(doc) + ' , "extra":';
      stubOpenAI(text, "length");
      const { POST } = await import("@/app/api/assistant/route");
      const body = await (await POST(req({ mode: "admin", messages: [{ role: "user", content: "подними цену" }] }, admin))).json();
      expect(body.action).toEqual({ type: "set_price", id: "system-4-bio-botanical-shampoo", value: 9 });
    });
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

  it("an attached photo is named in the prompt with the three photo actions, and its action passes the door", async () => {
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
    // …and the one that was missing: a picture INSIDE an article (18.09.2026)
    expect(system).toContain('"type":"add_post_photo"');
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
    expect(system).not.toContain('"type":"add_post_photo"');
    /* «assistant is not able to add cover photos or photos to articles although
       it says it does» — Renat, 18.09.2026. The old line asked the model to
       request a photo; it did not forbid the sentence that says one is already
       in, which is what he was reading. */
    expect(system).toMatch(/there is NO photo action at all/);
    expect(system).toMatch(/Never say a photo is added/);
    expect(system).toMatch(/attach the photo with the «Фото» button/);
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

/**
 * «it also loses the context and each time creates a new blog post, instead of
 * updating an already created blog post» — Renat, 18.09.2026.
 *
 * The panel now says which article is open in the blog editor while he types,
 * and that is what a follow-up is about. These cover the round trip: the block
 * reaches the prompt, an action with no slug of its own lands on that article,
 * and a photo action that could not be aimed leaves the reply saying so rather
 * than claiming the photo is in.
 */
describe("assistant — the article the owner has open", () => {
  const HOST_ = HOST;
  const KEY = "blog/1757000000001-cover.webp";
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

  it("names the open article in the prompt and forbids a second draft of it", async () => {
    const sent = stubOpenAI(JSON.stringify({ reply: "ок", product_ids: [], tab: "blog" }));
    const { POST } = await import("@/app/api/assistant/route");
    await POST(req({
      mode: "admin",
      messages: [{ role: "user", content: "сделай короче" }],
      post: { slug: "uhod-za-borodoy", title: "Уход за бородой", status: "draft" },
    }, admin));
    const system = sent[0].messages[0].content;
    expect(system).toContain("uhod-za-borodoy|draft|Уход за бородой");
    expect(system).toMatch(/NEVER answer a request about this article with draft_post/);
    // …and it is honest about the one thing it cannot do from the chat
    expect(system).toMatch(/There is no action that rewrites the text of an article that exists/);
  });

  it("puts a cover on the open article when the model named no slug", async () => {
    await upsertPost({ title: { RU: "Уход за бородой" }, slug: "uhod-za-borodoy" });
    stubOpenAI(JSON.stringify({
      reply: "Ставлю обложку — подтвердите.", product_ids: [], tab: "blog",
      action: { type: "set_post_cover", key: KEY },
    }));
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req({
      mode: "admin",
      messages: [{ role: "user", content: "вот обложка" }],
      attachments: [{ key: KEY, name: "IMG.jpg" }],
      post: { slug: "uhod-za-borodoy", title: "Уход за бородой", status: "draft" },
    }, admin));
    const body = await res.json();
    expect(body.action).toEqual({ type: "set_post_cover", slug: "uhod-za-borodoy", key: KEY });
    // the sentence is left alone: the photo really is going in
    expect(body.reply).toBe("Ставлю обложку — подтвердите.");
  });

  it("adds a photo inside the open article", async () => {
    await upsertPost({ title: { RU: "Уход за бородой" }, slug: "uhod-za-borodoy" });
    stubOpenAI(JSON.stringify({
      reply: "Поставлю в конец статьи.", product_ids: [], tab: "blog",
      action: { type: "add_post_photo", key: KEY },
    }));
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req({
      mode: "admin",
      messages: [{ role: "user", content: "добавь это фото в статью" }],
      attachments: [{ key: KEY, name: "IMG.jpg" }],
      post: { slug: "uhod-za-borodoy", title: "Уход за бородой", status: "draft" },
    }, admin));
    expect((await res.json()).action).toEqual({ type: "add_post_photo", slug: "uhod-za-borodoy", key: KEY });
  });

  /* The sentence and the action are written together; when the action is
     dropped the sentence is all the owner has, and it used to say the photo
     was in. */
  it("says the photo was NOT added when the action could not be aimed", async () => {
    await upsertPost({ title: { RU: "Уход за бородой" }, slug: "uhod-za-borodoy" });
    stubOpenAI(JSON.stringify({
      reply: "Добавил фото в статью.", product_ids: [], tab: "blog",
      action: { type: "add_post_photo", slug: "statya-kotoroy-net", key: KEY },
    }));
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req({
      mode: "admin",
      messages: [{ role: "user", content: "добавь фото в статью" }],
      attachments: [{ key: KEY, name: "IMG.jpg" }],
    }, admin));
    const body = await res.json();
    expect(body.action).toBeNull();
    expect(body.reply).toContain("Фото я не поставил");
  });

  it("leaves an ordinary reply alone — only a real photo action is corrected", async () => {
    stubOpenAI(JSON.stringify({
      reply: "Фото лучше прикрепить кнопкой «Фото».", product_ids: [], tab: "blog", action: null,
    }));
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(req({ mode: "admin", messages: [{ role: "user", content: "добавь фото" }] }, admin));
    const body = await res.json();
    expect(body.reply).toBe("Фото лучше прикрепить кнопкой «Фото».");
  });

  it("ignores a post the panel could not name properly", async () => {
    const sent = stubOpenAI(JSON.stringify({ reply: "ок", product_ids: [], tab: "" }));
    const { POST } = await import("@/app/api/assistant/route");
    await POST(req({
      mode: "admin",
      messages: [{ role: "user", content: "что по заказам" }],
      post: { slug: "../escape", title: "x" },
    }, admin));
    expect(sent[0].messages[0].content).not.toMatch(/THE ARTICLE THE OWNER IS LOOKING AT/);
  });
});
