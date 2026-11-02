/**
 * The shop chat reads the blog — «blogs become the source of truth for
 * product choice» (Dim, 02.11.2026).
 *
 * Two halves. The ranking and the digest are pure (src/app/api/assistant/
 * blog-digest.ts) and are pinned first on articles built in memory: which
 * question finds which article, and which finds none. Then the route
 * (shopPrompt in src/app/api/assistant/route.ts), with OpenAI stubbed at
 * fetch and the articles in PGlite: the digest is in the prompt only when an
 * article fits, the article the shopper opened the chat from is always in it,
 * the answer carries the article back as data, and a blog that cannot be read
 * leaves the chat answering exactly as it did before.
 *
 * The fixtures are cut-down copies of the shop's real articles of 02.11.2026
 * (the Kevin.Murphy shampoo guide and «Борода зимой»), product ids from the
 * catalogue file. The «no database at all» case is its own file,
 * tests/assistant-shop-guides-nodb.test.ts — it needs a database that never
 * existed, which this one cannot also be.
 */
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* The blog's two reads the chat makes, with a switch that breaks them — the
   rest of @/lib/blog (the writes these tests publish with) stays real. */
const blogDown = vi.hoisted(() => ({ on: false }));
vi.mock("@/lib/blog", async (orig) => {
  const real = await orig<typeof import("@/lib/blog")>();
  return {
    ...real,
    publishedStamp: async () => {
      if (blogDown.on) throw new Error("blog source down");
      return real.publishedStamp();
    },
    listPublishedFull: async (n?: number) => {
      if (blogDown.on) throw new Error("blog source down");
      return real.listPublishedFull(n);
    },
  };
});

import {
  articleOfAnswer,
  buildEntry,
  DIGEST_CAP,
  rankArticles,
  renderDigest,
  resetGuideCache,
  shopGuides,
  type GuideEntry,
} from "@/app/api/assistant/blog-digest";
import { resetRateLimits } from "@/lib/auth";
import { publishPost, upsertPost, type Post } from "@/lib/blog";
import { refreshBlogCache } from "@/lib/blog-cache";
import { exec, query } from "@/lib/db";
import { upsertOverride } from "@/lib/orders";
import { setupDb, teardownDb } from "./helpers";

/* ---------- the articles ------------------------------------------------- */

const KM = "kak-vybrat-shampun-kevin-murphy-pod-svoi-volosy";
const BEARD = "uhod-za-borodoy-zimoy";
const SUPPLY = "oficialnye-postavki";

type Fixture = Pick<Post, "slug" | "title" | "excerpt" | "body" | "tags" | "tagsI18n" | "products" | "coverUrl">;

const FIXTURES: Fixture[] = [
  {
    slug: KM,
    title: {
      RU: "Как выбрать шампунь Kevin.Murphy под свои волосы",
      ET: "Kuidas valida Kevin.Murphy šampoon oma juustele",
      EN: "How to choose a Kevin.Murphy shampoo for your hair",
    },
    excerpt: {
      RU: "Разбираемся, как выбрать шампунь Kevin.Murphy не наугад, а под состояние и особенности волос.",
      ET: "Kuidas valida Kevin.Murphy šampoon juuste seisundi järgi, mitte huupi.",
      EN: "How to choose a Kevin.Murphy shampoo based on your hair's condition, rather than guessing.",
    },
    body: {
      RU:
        "<p>«Мне нужен какой-нибудь хороший шампунь Kevin.Murphy» — так у нас в салоне начинается очень много разговоров. У марки двенадцать шампуней, и каждый решает свою задачу.</p>" +
        "<h2>Шпаргалка: проблема → пара → что добавить</h2><ul>" +
        '<li><strong>Тонкие волосы без объёма, окрашенные</strong> → <a href="/ru/products/kevin-murphy-angel-wash">Angel.Wash</a> + <a href="/ru/products/kevin-murphy-angel-rinse">Angel.Rinse</a> → маска <a href="/ru/products/kevin-murphy-angel-masque">Angel.Masque</a>.</li>' +
        '<li><strong>Тонкие и редеющие с возрастом</strong> → <a href="/ru/products/kevin-muprhy-plumping-wash">Plumping.Wash</a> + <a href="/ru/products/kevin-muprhy-plumping-rinse">Plumping.Rinse</a>.</li>' +
        '<li><strong>Сухие, тусклые, «пересушенные»</strong> → <a href="/ru/products/kevin-muprhy-hydrate-me-wash">Hydrate-Me.Wash</a> + <a href="/ru/products/kevin-murphy-hydrate-me-rinse">Hydrate-Me.Rinse</a>.</li>' +
        '<li><strong>Окрашенные, цвет быстро тускнеет</strong> → <a href="/ru/products/kevin-murphy-everlasting-colour-wash">Everlasting.Colour Wash</a> + <a href="/ru/products/kevin-murphy-everlasting-colour-rinse">Everlasting.Colour Rinse</a>.</li>' +
        "</ul>" +
        "<h2>Тонкие волосы и объём: Angel и Plumping</h2>" +
        "<h3>Angel.Wash — тонкие, хрупкие, окрашенные</h3>" +
        '<p>Самый «лёгкий» шампунь линейки. Если волосы тонкие и при этом окрашенные — начинайте с Angel. В пару — <a href="/ru/products/kevin-murphy-angel-rinse">Angel.Rinse</a>, раз в неделю вместо кондиционера — <a href="/ru/products/kevin-murphy-angel-masque">Angel.Masque</a>.</p>' +
        '<p><a href="/ru/products/kevin-murphy-angel-wash">Kevin.Murphy Angel.Wash</a></p>',
      ET: '<h2>Värvitud juuksed</h2><p>Kui juuksed on värvitud, vaata <a href="/et/products/kevin-murphy-everlasting-colour-wash">EVERLASTING.COLOUR WASH</a> poole.</p>',
      EN:
        "<h2>Consider your hair's condition, not just its type</h2>" +
        '<p>If your hair is coloured, take a look at <a href="/products/kevin-murphy-everlasting-colour-wash">EVERLASTING.COLOUR WASH</a>: the name itself suggests it.</p>' +
        '<p>For fine hair with no volume start with <a href="/products/kevin-murphy-angel-wash">ANGEL.WASH</a>.</p>',
    },
    tags: ["шампунь", "уход за волосами", "окрашенные волосы", "кудрявые волосы"],
    tagsI18n: { ET: ["šampoon", "juuksehooldus", "värvitud juuksed"], EN: ["shampoo", "haircare", "coloured hair", "curly hair"] },
    products: [
      "kevin-murphy-angel-wash", "kevin-murphy-angel-rinse", "kevin-murphy-angel-masque",
      "kevin-muprhy-plumping-wash", "kevin-muprhy-plumping-rinse",
      "kevin-muprhy-hydrate-me-wash", "kevin-murphy-hydrate-me-rinse",
      "kevin-murphy-everlasting-colour-wash", "kevin-murphy-everlasting-colour-rinse",
    ],
    coverUrl: "https://img.rempireshop.com/blog/1792512767530-km.webp",
  },
  {
    slug: BEARD,
    title: {
      RU: "Борода зимой: как сохранить её увлажнённой и здоровой",
      ET: "Kuidas hoida habet talvel niisutatuna ja tervena",
      EN: "Beard Care in Winter: Keep It Hydrated and Healthy",
    },
    excerpt: {
      RU: "Как ухаживать за бородой в холодное время года, чтобы она не пересыхала.",
      ET: "Kuidas hooldada habet külmal ajal, et see ei kuivaks.",
      EN: "How to care for your beard in cold weather to prevent dryness.",
    },
    body: {
      RU:
        "<p>Зимой борода подвергается дополнительному стрессу из-за холода, ветра и сухого воздуха в помещениях.</p>" +
        "<h2>Почему борода пересыхает зимой</h2><p>Холодный воздух снижает естественную влажность волос и кожи.</p>" +
        "<h2>Выбор средств для зимнего ухода</h2>" +
        "<p>Для зимнего ухода подойдут масло и бальзам. Например, масло Proraso Beard Oil Wood Spice с ароматом кедра и цитрусовых помогает сохранить волосы мягкими.</p>" +
        '<p><a data-product="proraso-beard-oil-wood-spice-cedar-wood-citrus-fragrance-30ml" href="/shop2/p/proraso-beard-oil-wood-spice-cedar-wood-citrus-fragrance-30ml/">Proraso Beard Oil Wood Spice — масло для бороды — 15 €</a></p>' +
        "<p>Хороший пример — густое масло, которое расходуется медленно, а пахнет спокойно:</p>" +
        '<p><a data-product="captain-fawcett-beard-oil-cf-332-private-stock" href="/shop2/p/captain-fawcett-beard-oil-cf-332-private-stock/">Captain Fawcett Private Stock</a></p>' +
        "<h2>Как правильно наносить средства</h2>" +
        "<p>Для бальзама Proraso Wood &amp; Spice характерна лёгкая текстура, которая не утяжеляет волосы.</p>" +
        '<p><a data-product="proraso-wood-spice-beard-balm-100ml" href="/shop2/p/proraso-wood-spice-beard-balm-100ml/">Proraso Wood &amp; Spice — бальзам для бороды — 16 €</a></p>',
      ET:
        "<h2>Miks habe talvel kuivab</h2><p>Külm õhk ja radiaatorid kuivatavad habet.</p>" +
        "<p>Näiteks Proraso Beard Oil Wood Spice hoiab habeme pehmena.</p>",
      EN:
        "<h2>Why Beards Dry Out in Winter</h2><p>Cold air reduces the natural moisture of hair and skin.</p>" +
        "<p>For example, Proraso Beard Oil Wood Spice helps keep the beard soft.</p>",
    },
    tags: ["борода", "уход за бородой", "зима", "сухость"],
    tagsI18n: { ET: [], EN: [] },
    products: [
      "captain-fawcett-beard-oil-cf-332-private-stock",
      "proraso-wood-spice-beard-balm-100ml",
      "proraso-beard-oil-wood-spice-cedar-wood-citrus-fragrance-30ml",
    ],
    coverUrl: "/shop/img/captain-fawcett-beard-oil-cf-332-private-stock-0.webp",
  },
  {
    // an article about the shop itself, no products — and the word «доставка» in its excerpt
    slug: SUPPLY,
    title: { RU: "Официальные поставки. Ежедневно в работе студии REMPIRE", ET: "Ametlikud tarned", EN: "Official supplies" },
    excerpt: { RU: "Все товары — от официальных дистрибьюторов; доставка по Эстонии и Европе.", ET: "", EN: "" },
    body: { RU: "<p>Все товары мы закупаем у официальных дистрибьюторов и сами работаем с ними в студии.</p>", ET: "", EN: "" },
    tags: [],
    tagsI18n: { ET: [], EN: [] },
    products: [],
    coverUrl: null,
  },
];

/** A fixture as the row the blog reads back — what buildEntry() is handed in the shop. */
function asPost(f: Fixture): Post {
  return {
    id: f.slug, status: "published", coverAlt: { RU: "", ET: "", EN: "" }, coverFocus: null,
    seoTitle: { RU: "", ET: "", EN: "" }, seoDesc: { RU: "", ET: "", EN: "" }, author: "Rempire",
    publishedAt: "2026-10-20T00:00:00.000Z", createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z",
    // the magazine fields (227_blog_magazine) — none of them matter to the ranking
    topic: "hair", topicChosen: false, featured: false, coverW: null, coverH: null,
    showSources: false, sources: [], minutes: { RU: 0, ET: 0, EN: 0 },
    ...f,
  };
}

const ENTRIES: GuideEntry[] = FIXTURES.map((f) => buildEntry(asPost(f)));
const top = (q: string | string[]) => rankArticles(ENTRIES, Array.isArray(q) ? q : [q]).ranked.map((r) => r.entry.slug);
const IN_STOCK = () => "in";

/* ---------- ranking ------------------------------------------------------ */

describe("which article fits a question (rankArticles)", () => {
  it("«тонкие окрашенные волосы без объёма» → the Kevin.Murphy shampoo guide", () => {
    expect(top("тонкие окрашенные волосы без объёма")[0]).toBe(KM);
  });

  it("«борода зимой сохнет» → the beard-in-winter article", () => {
    expect(top("борода зимой сохнет")).toEqual([BEARD]);
  });

  it("nothing at all for «доставка в Финляндию» — one excerpt word is not a guide", () => {
    expect(top("доставка в Финляндию")).toEqual([]);
  });

  it("nothing for a greeting, a stop-word question or one word every hair article shares", () => {
    expect(top("привет")).toEqual([]);
    expect(top("что вы посоветуете?")).toEqual([]);
    expect(top("")).toEqual([]);
  });

  it("reads Estonian and English questions too", () => {
    expect(top("habe kuivab talvel")[0]).toBe(BEARD);
    expect(top("thin coloured hair with no volume")[0]).toBe(KM);
    expect(top("värvitud juuksed")[0]).toBe(KM);
  });

  it("keeps the article of the conversation for a follow-up that names no subject of its own", () => {
    expect(top(["борода зимой сохнет", "а что лучше: масло или бальзам?"])[0]).toBe(BEARD);
  });

  it("stays tiny: a hundred questions over the index in well under a frame", () => {
    const t = performance.now();
    for (let i = 0; i < 100; i++) top("тонкие окрашенные волосы без объёма");
    expect(performance.now() - t).toBeLessThan(200);
  });
});

/* ---------- the digest --------------------------------------------------- */

describe("what the prompt is shown of an article (renderDigest)", () => {
  const km = ENTRIES.find((e) => e.slug === KM)!;
  const beard = ENTRIES.find((e) => e.slug === BEARD)!;
  const digest = (e: GuideEntry, q: string, stockOf = IN_STOCK, lang: "RU" | "ET" | "EN" = "RU") => {
    const r = rankArticles(ENTRIES, [q]);
    return renderDigest(e, lang, r.q, r.rare, stockOf);
  };

  it("names the article, its sections, and the advice for this need first, with the ids", () => {
    const d = digest(km, "тонкие окрашенные волосы без объёма");
    const lines = d.split("\n");
    expect(lines[0]).toBe(`ARTICLE ${KM} — «Как выбрать шампунь Kevin.Murphy под свои волосы»`);
    expect(lines[1]).toMatch(/^Sections: Шпаргалка/);
    expect(lines[2]).toBe(
      "- Тонкие волосы без объёма, окрашенные → Angel.Wash [kevin-murphy-angel-wash] + Angel.Rinse [kevin-murphy-angel-rinse] → маска Angel.Masque [kevin-murphy-angel-masque].",
    );
    expect(d.length).toBeLessThanOrEqual(DIGEST_CAP);
  });

  it("gives a product card on its own to the heading it stands under", () => {
    expect(digest(km, "angel")).toContain("- Angel.Wash — тонкие, хрупкие, окрашенные [kevin-murphy-angel-wash]");
  });

  it("finds a product the text names without a link, and the one a card after a sentence introduces", () => {
    const d = digest(beard, "борода зимой сохнет");
    expect(d).toMatch(/Proraso Beard Oil Wood Spice с ароматом кедра[^\n]*\[proraso-beard-oil-wood-spice-cedar-wood-citrus-fragrance-30ml\]/);
    expect(d).toMatch(/Хороший пример — густое масло[^\n]*\[captain-fawcett-beard-oil-cf-332-private-stock\]/);
  });

  it("marks what is sold out right now, and drops what the shop does not know", () => {
    const out = (id: string) => (id === "captain-fawcett-beard-oil-cf-332-private-stock" ? "out" : "in");
    const r = rankArticles(ENTRIES, ["борода зимой"]);
    const d = renderDigest(beard, "RU", r.q, r.rare, out, { known: (id) => id !== "proraso-wood-spice-beard-balm-100ml" });
    expect(d).toContain("[captain-fawcett-beard-oil-cf-332-private-stock:out]");
    expect(d).not.toContain("proraso-wood-spice-beard-balm-100ml");
  });

  it("is written in the shopper's language, from that language's text", () => {
    const d = digest(km, "coloured hair", IN_STOCK, "EN");
    expect(d.split("\n")[0]).toBe(`ARTICLE ${KM} — «How to choose a Kevin.Murphy shampoo for your hair»`);
    expect(d).toContain("EVERLASTING.COLOUR WASH [kevin-murphy-everlasting-colour-wash]");
  });

  it("holds a big guide to the cap, the lines that answer the question kept", () => {
    const many = asPost({
      ...FIXTURES[0],
      body: {
        ...FIXTURES[0].body,
        RU: FIXTURES[0].body.RU + Array.from({ length: 40 }, (_, i) =>
          `<p>Совет номер ${i + 1} про мытьё головы — <a href="/ru/products/kevin-muprhy-hydrate-me-wash">Hydrate-Me.Wash</a>.</p>`).join(""),
      },
    });
    const e = buildEntry(many);
    const r = rankArticles([e, ...ENTRIES.slice(1)], ["тонкие окрашенные волосы без объёма"]);
    const d = renderDigest(e, "RU", r.q, r.rare, IN_STOCK);
    expect(d.length).toBeLessThanOrEqual(DIGEST_CAP);
    expect(d).toContain("Тонкие волосы без объёма, окрашенные");
  });
});

describe("the article an answer carries back (articleOfAnswer)", () => {
  const bySlug = new Map(ENTRIES.map((e) => [e.slug, e]));

  it("is the slug the model named, as a card in the shopper's language", () => {
    const { card, reply } = articleOfAnswer(BEARD, "Масло каждый день.", bySlug, "ET");
    expect(card).toEqual({ slug: BEARD, title: "Kuidas hoida habet talvel niisutatuna ja tervena", cover: FIXTURES[1].coverUrl });
    expect(reply).toBe("Масло каждый день.");
  });

  it("never a slug the shop does not have", () => {
    expect(articleOfAnswer("kak-ya-pridumal-statyu", "Ок.", bySlug, "RU").card).toBeNull();
    expect(articleOfAnswer("<script>", "Ок.", bySlug, "RU").card).toBeNull();
  });

  it("turns the old bare link at the end of the reply into the card, and takes it off the sentence", () => {
    const { card, reply } = articleOfAnswer(undefined, `Зимой борода сохнет — вот статья про это: /blogs/news/${BEARD}`, bySlug, "RU");
    expect(card?.slug).toBe(BEARD);
    expect(reply).toBe("Зимой борода сохнет — вот статья про это.");
  });

  it("leaves a link in the middle of a sentence where it is", () => {
    const text = `Прочитайте /ru/blogs/news/${BEARD} и возьмите масло.`;
    const { card, reply } = articleOfAnswer(undefined, text, bySlug, "RU");
    expect(card?.slug).toBe(BEARD);
    expect(reply).toBe(text);
  });
});

describe("the pinned article (shopGuides)", () => {
  it("is always the first digest, even for a question no article fits", () => {
    const g = shopGuides(ENTRIES, { lang: "RU", turns: ["доставка в Финляндию"], pinned: BEARD, stockOf: IN_STOCK });
    expect(g.offered).toEqual([BEARD]);
    expect(g.block.split("\n")[0]).toMatch(new RegExp(`^ARTICLE ${BEARD} — .*the customer opened the chat from this article`));
    // …and it leaves the plain list, which keeps the others
    expect(g.list).not.toContain(BEARD);
    expect(g.list).toContain(KM);
  });

  it("leads, and the best other match may join it", () => {
    const g = shopGuides(ENTRIES, { lang: "RU", turns: ["тонкие окрашенные волосы без объёма"], pinned: BEARD, stockOf: IN_STOCK });
    expect(g.offered).toEqual([BEARD, KM]);
  });

  it("is ignored when it is not a published article", () => {
    const g = shopGuides(ENTRIES, { lang: "RU", turns: ["доставка в Финляндию"], pinned: "chernovik", stockOf: IN_STOCK });
    expect(g.offered).toEqual([]);
    expect(g.block).toBe("");
  });
});

/* ---------- the route ---------------------------------------------------- */

const ORIGIN = "https://rempireshop.com";
let ipN = 0;
function ask(messages: string[] | string, extra: Record<string, unknown> = {}) {
  ipN += 1;
  const list = (Array.isArray(messages) ? messages : [messages]).map((content, i, a) => ({
    role: i % 2 === (a.length - 1) % 2 ? "user" : "assistant",
    content,
  }));
  return new NextRequest(`${ORIGIN}/api/assistant/`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "rempireshop.com", origin: ORIGIN, "x-real-ip": `198.51.100.${(ipN % 250) + 1}` },
    body: JSON.stringify({ messages: list, lang: "RU", ...extra }),
  });
}
function stubOpenAI(reply: Record<string, unknown>) {
  const sent: Array<{ messages: Array<{ role: string; content: string }> }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(
      JSON.stringify({ model: "gpt-6-luna", choices: [{ message: { content: JSON.stringify(reply) } }] }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }));
  return sent;
}
/** The SALON GUIDES section of a prompt, header to the blank line after it — "" when there is none. */
function guidesOf(prompt: string): string {
  const at = prompt.indexOf("\nSALON GUIDES");
  if (at < 0) return "";
  const end = prompt.indexOf("\n\n", prompt.indexOf("\nARTICLE", at) + 1);
  return prompt.slice(at, end < 0 ? undefined : end);
}

describe("POST /api/assistant — the shop chat recommends from the blog", () => {
  const savedKey = process.env.OPENAI_API_KEY;
  // sold out in the shop right now, whatever the catalogue file says
  const SOLD_OUT = "kevin-murphy-angel-masque";

  beforeAll(async () => {
    process.env.OPENAI_API_KEY = "sk-test-dummy";
    await setupDb();
    await exec("truncate posts restart identity cascade");
    for (const f of FIXTURES) {
      const row = await upsertPost({ ...f, slug: f.slug });
      await publishPost(row.id);
    }
    // written before the first question: the route keeps live stock for a minute
    await upsertOverride(SOLD_OUT, { stock: "out" });
    resetGuideCache();
  });
  afterAll(async () => {
    await teardownDb();
    if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = savedKey;
  });
  beforeEach(() => {
    blogDown.on = false;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetRateLimits();
  });

  it("puts the matching guide in the prompt, with the rule to recommend from it", async () => {
    const sent = stubOpenAI({ reply: "В нашем гайде для тонких окрашенных волос — пара Angel.", product_ids: [] });
    const { POST } = await import("@/app/api/assistant/route");
    expect((await POST(ask("тонкие окрашенные волосы без объёма, что взять?"))).status).toBe(200);
    const prompt = sent[0].messages[0].content;
    const block = guidesOf(prompt);
    expect(block).toContain(`ARTICLE ${KM} — «Как выбрать шампунь Kevin.Murphy под свои волосы»`);
    expect(block).toContain("Angel.Wash [kevin-murphy-angel-wash] + Angel.Rinse [kevin-murphy-angel-rinse]");
    // sold out in the shop right now — marked, so the model never offers it
    expect(block).toContain(`[${SOLD_OUT}:out]`);
    expect(prompt).toContain("A SALON GUIDE is the salon's own advice and the source of truth");
    // the article it is offered as a guide is not listed a second time
    expect(prompt).toMatch(/OTHER BLOG ARTICLES/);
    expect(prompt.split("\n").filter((l) => l.startsWith(`${KM}|`))).toEqual([]);
  });

  it("adds nothing for a question no article fits — the prompt is today's", async () => {
    const sent = stubOpenAI({ reply: "Доставляем в Финляндию.", product_ids: [] });
    const { POST } = await import("@/app/api/assistant/route");
    const body = await (await POST(ask("доставка в Финляндию"))).json();
    const prompt = sent[0].messages[0].content;
    expect(guidesOf(prompt)).toBe("");
    expect(prompt).not.toContain("SALON GUIDE");
    // the plain list is still there, all three, as before
    expect(prompt).toContain(`${KM}|Как выбрать шампунь Kevin.Murphy под свои волосы`);
    expect(prompt).toContain(`${BEARD}|`);
    expect(body.article).toBeUndefined();
  });

  it("costs about a thousand tokens at most when guides are in", async () => {
    const sent = stubOpenAI({ reply: "ок", product_ids: [] });
    const { POST } = await import("@/app/api/assistant/route");
    await POST(ask("тонкие окрашенные волосы без объёма"));
    await POST(ask("доставка в Финляндию"));
    const [withG, without] = sent.map((s) => s.messages[0].content);
    const block = guidesOf(withG);
    const rule = withG.split("\n").find((l) => l.startsWith("- A SALON GUIDE")) ?? "";
    expect(rule).not.toBe("");
    // what only a matched question pays: the block, the rule, the word «OTHER »
    const extra = block.length + rule.length + 1 + "OTHER ".length;
    // eslint-disable-next-line no-console
    console.info(`[guides] prompt ${without.length} chars without, ${withG.length} with; the guides add ${extra} chars`);
    // at ~3.5 characters a token for this mix of Russian and ids, 3,600 characters is ~1,000 tokens
    expect(extra).toBeLessThan(3600);
  });

  it("returns the article as data — slug, title in the shopper's language, cover — and holds the products to the stock", async () => {
    stubOpenAI({
      reply: "В нашем гайде советуем пару Angel и маску раз в неделю.",
      product_ids: ["kevin-murphy-angel-wash", "kevin-murphy-angel-rinse", SOLD_OUT],
      article: KM,
    });
    const { POST } = await import("@/app/api/assistant/route");
    const body = await (await POST(ask("тонкие окрашенные волосы без объёма", { lang: "EN" }))).json();
    expect(body.article).toEqual({
      slug: KM,
      title: "How to choose a Kevin.Murphy shampoo for your hair",
      cover: "https://img.rempireshop.com/blog/1792512767530-km.webp",
    });
    expect(body.product_ids).toEqual(["kevin-murphy-angel-wash", "kevin-murphy-angel-rinse"]);
  });

  it("refuses an article the model invented, and still answers", async () => {
    stubOpenAI({ reply: "Возьмите масло.", product_ids: [], article: "statya-kotoroy-net" });
    const { POST } = await import("@/app/api/assistant/route");
    const body = await (await POST(ask("борода зимой сохнет"))).json();
    expect(body.article).toBeUndefined();
    expect(body.reply).toBe("Возьмите масло.");
  });

  it("makes the old bare link a card too", async () => {
    stubOpenAI({ reply: `Зимой борода сохнет — вот статья: /blogs/news/${BEARD}`, product_ids: [] });
    const { POST } = await import("@/app/api/assistant/route");
    const body = await (await POST(ask("борода зимой сохнет"))).json();
    expect(body.article?.slug).toBe(BEARD);
    expect(body.reply).toBe("Зимой борода сохнет — вот статья.");
  });

  it("always includes the pinned article, whatever the question", async () => {
    const sent = stubOpenAI({ reply: "ок", product_ids: [] });
    const { POST } = await import("@/app/api/assistant/route");
    await POST(ask("а что из этого мне взять?", { article: BEARD }));
    const block = guidesOf(sent[0].messages[0].content);
    // line 0 is empty, 1 is the block's header, 2 the first article
    expect(block.split("\n")[2]).toMatch(new RegExp(`^ARTICLE ${BEARD} — .*opened the chat from this article`));
  });

  it("reads the follow-up in the light of the turns before it", async () => {
    const sent = stubOpenAI({ reply: "ок", product_ids: [] });
    const { POST } = await import("@/app/api/assistant/route");
    await POST(ask(["борода зимой сохнет", "Берите масло.", "а бальзам нужен?"]));
    expect(guidesOf(sent[0].messages[0].content)).toContain(`ARTICLE ${BEARD}`);
  });

  it("sees an edited article at once after a save (refreshBlogCache)", async () => {
    const sent = stubOpenAI({ reply: "ок", product_ids: [] });
    const { POST } = await import("@/app/api/assistant/route");
    await POST(ask("борода зимой сохнет"));
    expect(guidesOf(sent[0].messages[0].content)).toContain("«Борода зимой: как сохранить её увлажнённой и здоровой»");

    const rows = await query<{ id: string }>("select id from posts where slug = $1", [BEARD]);
    await upsertPost({ id: rows[0].id, ...FIXTURES[1], title: { ...FIXTURES[1].title, RU: "Борода зимой: масло каждый день" } });
    refreshBlogCache();
    await POST(ask("борода зимой сохнет"));
    expect(guidesOf(sent[1].messages[0].content)).toContain("«Борода зимой: масло каждый день»");
  });

  it("…and on another instance, within a minute, by the published set's stamp", async () => {
    const sent = stubOpenAI({ reply: "ок", product_ids: [] });
    const { POST } = await import("@/app/api/assistant/route");
    await POST(ask("борода зимой сохнет"));
    const rows = await query<{ id: string }>("select id from posts where slug = $1", [BEARD]);
    // a save made elsewhere: no refreshBlogCache() reaches this instance
    await upsertPost({ id: rows[0].id, ...FIXTURES[1], title: { ...FIXTURES[1].title, RU: "Борода зимой: бальзам и масло" } });
    await POST(ask("борода зимой сохнет"));
    expect(guidesOf(sent[1].messages[0].content)).not.toContain("бальзам и масло");
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
    await POST(ask("борода зимой сохнет"));
    expect(guidesOf(sent[2].messages[0].content)).toContain("«Борода зимой: бальзам и масло»");
  });

  it("still answers when the blog cannot be read — no guides, no list, no error", async () => {
    blogDown.on = true;
    resetGuideCache();
    const sent = stubOpenAI({ reply: "Возьмите масло для бороды.", product_ids: ["proraso-beard-oil-wood-spice-cedar-wood-citrus-fragrance-30ml"] });
    const { POST } = await import("@/app/api/assistant/route");
    const res = await POST(ask("борода зимой сохнет"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reply).toBe("Возьмите масло для бороды.");
    expect(body.product_ids).toEqual(["proraso-beard-oil-wood-spice-cedar-wood-citrus-fragrance-30ml"]);
    expect(body.article).toBeUndefined();
    const prompt = sent[0].messages[0].content;
    expect(prompt).not.toContain("SALON GUIDES");
    expect(prompt).not.toContain("BLOG ARTICLES");
    blogDown.on = false;
    resetGuideCache();
  });
});
