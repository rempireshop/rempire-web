/**
 * The blog as a magazine (Dim, 02.11.2026 — canvas-banner/project/BlogHome,
 * BlogPhone and Article): the topic each article sits under, its read time,
 * the six fields of 227_blog_magazine.sql as a save carries them, the static
 * builders the prerender and the request-time page share
 * (src/lib/blog-magazine.mjs), and app.js's twin of what it cannot import.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const nextCache = vi.hoisted(() => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/cache", () => nextCache);

import {
  allProductsWord, articleStaticHTML, articlesWord, BLOG_TOPICS, cardHTML, cleanSources, gridHTML, guessTopic,
  homeStaticHTML, isNarrow, masonry, minutesWord, pickFeatured, publicListItem, publicPost, readMinutes, readNext,
  SOURCE_MAX_LEN, SOURCES_MAX, STR, TOPIC_NAMES, wordCount,
} from "@/lib/blog-magazine.mjs";
import { BlogError, catOfProduct, getPostById, listPublished, publishPost, readMagazineInput, upsertPost } from "@/lib/blog";
import { magazineFields } from "../tools/lib/blog-export.mjs";
import { exec } from "@/lib/db";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

/* ---------- the topic guess ------------------------------------------------ */

describe("guessTopic — which chip an article nobody sorted sits under", () => {
  const g = (title: string, extra: Record<string, unknown> = {}) => guessTopic({ title: { RU: title }, ...extra }, catOfProduct);

  it("sorts the six articles the shop had on 02.11.2026 the way a reader would", () => {
    expect(g("Как выбрать шампунь Kevin.Murphy под свои волосы")).toBe("hair");
    expect(g("AHA/BHA-тонер: Cosrx или Anua — как выбрать и пользоваться")).toBe("skin");
    expect(g("Официальные поставки. Ежедневно в работе студии REMPIRE")).toBe("studio");
    expect(g("Шампуни System 4 №1, №2, №3, №4: какой выбрать")).toBe("hair");
    expect(g("Паста, воск или глина: чем они отличаются на самом деле")).toBe("styling");
    expect(g("Борода зимой: как сохранить её увлажнённой и здоровой")).toBe("beard");
  });

  it("reads «кожа головы» as the scalp — a hair article, not a skin one", () => {
    expect(g("Перхоть и кожа головы: что делать")).toBe("hair");
    expect(g("Сухая кожа лица зимой")).toBe("skin");
  });

  it("reads Estonian and English titles and tags too", () => {
    expect(g("Habemeõli talvel")).toBe("beard");
    expect(g("How to pick a pomade")).toBe("styling");
    expect(guessTopic({ title: { RU: "Зимний уход" }, tags: ["борода"] }, catOfProduct)).toBe("beard");
  });

  it("lets the products' own sections decide when the words do not", () => {
    // free-hold and night-rider are Styling in the catalogue
    expect(g("Новинки месяца", { products: ["free-hold", "night-rider"] })).toBe("styling");
    // …but words in the title outweigh one product from elsewhere
    expect(g("Масло для бороды", { products: ["free-hold"] })).toBe("beard");
  });

  it("puts an article that points nowhere under «Студия»", () => {
    expect(g("Что-то совсем другое")).toBe("studio");
    expect(guessTopic({}, catOfProduct)).toBe("studio");
    expect(guessTopic(null, catOfProduct)).toBe("studio");
  });

  it("knows the shop's sections from the catalogue file, and nothing for an id it does not have", () => {
    expect(catOfProduct("free-hold")).toBe("styling");
    expect(catOfProduct("c-owner-made")).toBe("");
  });
});

/* ---------- read time -------------------------------------------------------- */

describe("readMinutes — «9 мин чтения», from the words", () => {
  it("counts words, not tags, entities or punctuation", () => {
    expect(wordCount("<h2>Раз два</h2><p>три&nbsp;четыре — <strong>пять</strong></p>")).toBe(5);
    expect(wordCount("<script>var a = 1 2 3</script><p>одно</p>")).toBe(1);
    expect(wordCount("## Заголовок\n\nМаркдаун тоже")).toBe(3);
  });

  it("rounds up at 200 words a minute, never says 0 for an article with words, 0 for none", () => {
    const words = (n: number) => "<p>" + "слово ".repeat(n) + "</p>";
    expect(readMinutes(words(1))).toBe(1);
    expect(readMinutes(words(200))).toBe(1);
    expect(readMinutes(words(201))).toBe(2);
    expect(readMinutes(words(1801))).toBe(10);
    expect(readMinutes("")).toBe(0);
    expect(readMinutes("<p> </p>")).toBe(0);
  });

  it("says it in each language", () => {
    expect(minutesWord(9, "RU")).toBe("9 мин чтения");
    expect(minutesWord(9, "ET")).toBe("9 min lugemist");
    expect(minutesWord(9, "EN")).toBe("9 min read");
    expect(articlesWord(1, "RU")).toBe("1 статья");
    expect(articlesWord(3, "RU")).toBe("3 статьи");
    expect(articlesWord(6, "RU")).toBe("6 статей");
    expect(articlesWord(21, "RU")).toBe("21 статья");
    expect(articlesWord(1, "ET")).toBe("1 artikkel");
    expect(articlesWord(6, "EN")).toBe("6 articles");
    expect(allProductsWord(34, "RU")).toBe("Все 34 товара");
    expect(allProductsWord(34, "EN")).toBe("All 34 products");
  });
});

/* ---------- the fields as a save carries them -------------------------------- */

describe("readMagazineInput — absent keeps, wrong is refused", () => {
  it("keeps everything a save does not mention", () => {
    expect(readMagazineInput({})).toEqual({
      topic: undefined, featured: undefined, coverW: null, coverH: null, showSources: undefined, sources: undefined,
    });
  });

  it("takes one of the five topics, hands null/\"\" back to the guess, refuses anything else", () => {
    for (const t of BLOG_TOPICS) expect(readMagazineInput({ topic: t }).topic).toBe(t);
    expect(readMagazineInput({ topic: null }).topic).toBeNull();
    expect(readMagazineInput({ topic: "" }).topic).toBeNull();
    for (const bad of ["perfume", "Hair", 5, {}, "studio "]) {
      expect(() => readMagazineInput({ topic: bad }), String(bad)).toThrow(BlogError);
    }
  });

  it("takes a cover size only as a pair of whole pixels", () => {
    expect(readMagazineInput({ coverW: 1600, coverH: 1067 })).toMatchObject({ coverW: 1600, coverH: 1067 });
    expect(readMagazineInput({ coverW: 1600 })).toMatchObject({ coverW: null, coverH: null });
    expect(readMagazineInput({ coverW: 0, coverH: 10 })).toMatchObject({ coverW: null, coverH: null });
    expect(readMagazineInput({ coverW: "x", coverH: 10 })).toMatchObject({ coverW: null, coverH: null });
    expect(readMagazineInput({ coverW: 99999, coverH: 10 })).toMatchObject({ coverW: null, coverH: null });
  });

  it("takes the switches only as booleans", () => {
    expect(readMagazineInput({ featured: true, showSources: false })).toMatchObject({ featured: true, showSources: false });
    expect(readMagazineInput({ featured: "yes", showSources: 1 })).toMatchObject({ featured: undefined, showSources: undefined });
  });

  it("cleans the sources: one line each, short, no repeats, twelve at most", () => {
    expect(cleanSources(["  Буклет\nKevin.Murphy, PDF ", "Буклет Kevin.Murphy, PDF", "", 5, null, "tallinnavesi.ee"]))
      .toEqual(["Буклет Kevin.Murphy, PDF", "tallinnavesi.ee"]);
    expect(cleanSources(["x".repeat(500)])[0]).toHaveLength(SOURCE_MAX_LEN);
    expect(cleanSources(Array.from({ length: 30 }, (_, i) => "Материал " + i))).toHaveLength(SOURCES_MAX);
    expect(cleanSources("not a list")).toEqual([]);
    expect(readMagazineInput({ sources: ["a", "a", " b "] }).sources).toEqual(["a", "b"]);
  });
});

/* ---------- stored, and read back ---------------------------------------------- */

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  await setupDb();
});
afterAll(teardownDb);

describe("the six fields in the row (227_blog_magazine.sql)", () => {
  beforeEach(async () => {
    nextCache.revalidateTag.mockReset();
    await exec("truncate posts restart identity cascade");
  });

  const make = (title: string, extra: Record<string, unknown> = {}) =>
    upsertPost({
      title: { RU: title },
      body: { RU: "<p>" + "слово ".repeat(450) + "</p>", ET: "", EN: "<p>three short words</p>" },
      coverUrl: "/shop/img/night-rider-0.webp",
      ...extra,
    });

  it("a new article with no topic is the guess — and stays the guess as it grows", async () => {
    const p = await make("Паста или глина");
    expect(p.topic).toBe("styling");
    expect(p.topicChosen).toBe(false);
    const q = await upsertPost({ id: p.id, title: { RU: "Масло для бороды" }, body: p.body, coverUrl: p.coverUrl });
    expect(q.topic).toBe("beard");
    expect(q.topicChosen).toBe(false);
  });

  it("a chosen topic is stored, kept through a save that does not mention it, and null hands it back", async () => {
    const p = await make("Паста или глина", { topic: "studio" });
    expect(p).toMatchObject({ topic: "studio", topicChosen: true });
    const kept = await upsertPost({ id: p.id, title: { RU: "Паста или глина" }, body: p.body, coverUrl: p.coverUrl });
    expect(kept).toMatchObject({ topic: "studio", topicChosen: true });
    const back = await upsertPost({ id: p.id, title: { RU: "Паста или глина" }, body: p.body, coverUrl: p.coverUrl, topic: null });
    expect(back).toMatchObject({ topic: "styling", topicChosen: false });
  });

  it("reads the time per language, from the text that language's page shows", async () => {
    const p = await make("Чтение");
    // RU 450 words → 3 min; ET empty → the Russian text is what it shows → 3; EN 3 words → 1
    expect(p.minutes).toEqual({ RU: 3, ET: 3, EN: 1 });
    const list = await listPublished(1, 10);
    expect(list.posts).toHaveLength(0);   // a draft is nobody's list
    await publishPost(p.id);
    const live = await listPublished(1, 10);
    expect(live.posts[0].minutes).toEqual({ RU: 3, ET: 3, EN: 1 });
    expect((live.posts[0] as unknown as Record<string, unknown>).body).toBeUndefined();
  });

  it("holds «На главной блога» to three, and an article already on keeps its place", async () => {
    const a = await make("Один", { featured: true });
    await make("Два", { featured: true });
    await make("Три", { featured: true });
    await expect(make("Четыре", { featured: true })).rejects.toMatchObject({ code: "featured_full" });
    // the fourth as a draft without the switch is fine, and so is a save of one already on
    const d = await make("Четыре");
    expect(d.featured).toBe(false);
    const again = await upsertPost({ id: a.id, title: { RU: "Один" }, body: a.body, coverUrl: a.coverUrl, featured: true });
    expect(again.featured).toBe(true);
    await expect(upsertPost({ id: d.id, title: { RU: "Четыре" }, body: d.body, coverUrl: d.coverUrl, featured: true }))
      .rejects.toMatchObject({ code: "featured_full" });
    // one switched off makes room
    await upsertPost({ id: a.id, title: { RU: "Один" }, body: a.body, coverUrl: a.coverUrl, featured: false });
    const now = await upsertPost({ id: d.id, title: { RU: "Четыре" }, body: d.body, coverUrl: d.coverUrl, featured: true });
    expect(now.featured).toBe(true);
  });

  it("lists the carousel's articles wherever they fall in the list — published ones only", async () => {
    const on = await make("Наверху", { featured: true });
    const draft = await make("Черновик наверху", { featured: true });
    for (let i = 0; i < 3; i++) await publishPost((await make("Статья " + i)).id);
    await publishPost(on.id);
    const list = await listPublished(1, 2);
    expect(list.featured.map((p) => p.slug)).toEqual([on.slug]);
    expect(list.featured.map((p) => p.slug)).not.toContain(draft.slug);
  });

  it("the cover's size follows the cover: kept while the picture is the same, gone with it", async () => {
    const p = await make("Обложка", { coverW: 1600, coverH: 1067 });
    expect(p).toMatchObject({ coverW: 1600, coverH: 1067 });
    const same = await upsertPost({ id: p.id, title: { RU: "Обложка" }, body: p.body, coverUrl: p.coverUrl });
    expect(same).toMatchObject({ coverW: 1600, coverH: 1067 });
    // a new picture set by the assistant or by Claude, with no size: none, rather than the old photo's shape
    const other = await upsertPost({ id: p.id, title: { RU: "Обложка" }, body: p.body, coverUrl: "/shop/img/free-hold-0.webp" });
    expect(other).toMatchObject({ coverW: null, coverH: null });
    const gone = await upsertPost({ id: p.id, title: { RU: "Обложка" }, body: p.body, coverUrl: null, coverW: 10, coverH: 10 });
    expect(gone).toMatchObject({ coverUrl: null, coverW: null, coverH: null });
    // …and a new article without a cover keeps no size at all
    const bare = await upsertPost({ title: { RU: "Без обложки" }, coverW: 800, coverH: 600 });
    expect(bare).toMatchObject({ coverW: null, coverH: null });
  });

  it("stores «Показать в статье, из чего она написана» and its lines, and the public answer names them only when it is on", async () => {
    const p = await make("Источники", { sources: ["Буклет Kevin.Murphy, PDF", "tallinnavesi.ee"] });
    expect(p).toMatchObject({ showSources: false, sources: ["Буклет Kevin.Murphy, PDF", "tallinnavesi.ee"] });
    expect(publicPost(p, "RU", "").sources).toEqual([]);
    const on = await upsertPost({ id: p.id, title: { RU: "Источники" }, body: p.body, coverUrl: p.coverUrl, showSources: true });
    expect(on.sources).toHaveLength(2);
    expect(publicPost(on, "RU", "").sources).toEqual(["Буклет Kevin.Murphy, PDF", "tallinnavesi.ee"]);
    // a save that does not carry them keeps them
    const kept = (await getPostById(p.id))!;
    expect(kept).toMatchObject({ showSources: true, sources: ["Буклет Kevin.Murphy, PDF", "tallinnavesi.ee"] });
  });

  it("the build reads the same fields the same way (tools/lib/blog-export.mjs)", () => {
    const post = { title: { RU: "Масло для бороды" }, body: { RU: "<p>раз два</p>", ET: "", EN: "" }, coverUrl: "/x.webp", products: [] };
    expect(magazineFields(post, { topic: null, featured: null, cover_w: 800, cover_h: 1100, show_sources: true, sources: [" a ", "a"] }))
      .toEqual({
        topic: "beard", topicChosen: false, featured: false, coverW: 800, coverH: 1100, showSources: true, sources: ["a"],
        minutes: { RU: 1, ET: 1, EN: 1 },
      });
    // a database without the columns yet (the first deploy's prerender runs before its migration)
    expect(magazineFields(post, {})).toMatchObject({ topic: "beard", featured: false, coverW: null, sources: [] });
    expect(magazineFields({ ...post, coverUrl: null }, { cover_w: 800, cover_h: 1100 })).toMatchObject({ coverW: null, coverH: null });
  });
});

/* ---------- which articles go where ---------------------------------------------- */

describe("the carousel, «Читать дальше» and the grid's columns", () => {
  const P = (slug: string, extra: Record<string, unknown> = {}) => ({ slug, title: slug, topic: "hair", ...extra });

  it("the carousel: the marked ones (three at most), else the newest alone", () => {
    const posts = [P("a"), P("b", { featured: true }), P("c", { featured: true })];
    expect(pickFeatured(posts).map((p: { slug: string }) => p.slug)).toEqual(["b", "c"]);
    expect(pickFeatured([P("a"), P("b")]).map((p: { slug: string }) => p.slug)).toEqual(["a"]);
    expect(pickFeatured([], [P("x"), P("y"), P("z"), P("w")]).map((p: { slug: string }) => p.slug)).toEqual(["x", "y", "z"]);
    expect(pickFeatured([])).toEqual([]);
  });

  it("«Читать дальше»: two of the same topic, the newest others after them, never the article itself", () => {
    const posts = [P("a", { topic: "beard" }), P("me"), P("b", { topic: "beard" }), P("c"), P("d")];
    expect(readNext(P("me"), posts).map((p: { slug: string }) => p.slug)).toEqual(["c", "d"]);
    expect(readNext(P("me", { topic: "skin" }), posts).map((p: { slug: string }) => p.slug)).toEqual(["a", "b"]);
    expect(readNext(P("me", { topic: "beard" }), [P("me"), P("a", { topic: "beard" }), P("x")]).map((p: { slug: string }) => p.slug))
      .toEqual(["a", "x"]);
  });

  it("each card goes under the shortest column, by the shape its cover really has", () => {
    const tall = { coverUrl: "/t.webp", coverW: 800, coverH: 1200 };
    const wide = { coverUrl: "/w.webp", coverW: 1200, coverH: 400 };
    // three columns, then the fourth under the shortest (the wide one's)
    expect(masonry([tall, tall, wide, wide], 3)).toEqual([[0], [1], [2, 3]]);
    // no cover is a 4:5 tile; a cover with no size is the old 1200×630 frame
    expect(masonry([{}, { coverUrl: "/x" }, { coverUrl: "/x" }, tall], 3)).toEqual([[0], [1, 3], [2]]);
  });

  it("a page out of a PDF (narrow, or upright) is never stretched across the banner", () => {
    expect(isNarrow({ coverUrl: "/p.webp", coverW: 828, coverH: 1170 })).toBe(true);
    expect(isNarrow({ coverUrl: "/p.webp", coverW: 1600, coverH: 1600 })).toBe(true);
    expect(isNarrow({ coverUrl: "/p.webp", coverW: 1600, coverH: 1067 })).toBe(false);
    expect(isNarrow({ coverUrl: "/p.webp" })).toBe(false);
  });
});

/* ---------- the static pages --------------------------------------------------------- */

describe("the static builders (prerender and request-time page)", () => {
  const hrefOf = (slug: string) => "/ru/blogs/news/" + slug;
  const item = (slug: string, extra: Record<string, unknown> = {}) => publicListItem({
    slug, title: { RU: "Статья " + slug }, excerpt: { RU: "Анонс " + slug }, coverUrl: null, coverAlt: {},
    coverFocus: null, coverW: null, coverH: null, tags: [], tagsI18n: {}, publishedAt: "2026-10-20T10:00:00Z",
    topic: "beard", minutes: { RU: 4 }, products: ["a", "b"], ...extra,
  }, "RU");

  it("a card without a cover is the beige tile with its title; with one, the picture in its own shape", () => {
    const bare = cardHTML(item("x"), "RU", hrefOf, 0);
    expect(bare).toContain('<span class="bmag__none" aria-hidden="true"><span class="bmag__noneeye">Борода</span><span class="bmag__nonet">Статья x</span></span>');
    expect(bare).not.toContain("<img");
    const pic = cardHTML(item("y", { coverUrl: "/c.webp", coverW: 900, coverH: 1200 }), "RU", hrefOf, 1);
    expect(pic).toContain('<img class="bmag__img" src="/c.webp" alt="" width="900" height="1200" loading="lazy"');
    expect(pic).toContain('style="order:1"');
    // an older cover nobody measured: the old frame, still a reserved box
    const old = cardHTML(item("z", { coverUrl: "/c.webp" }), "RU", hrefOf, 2);
    expect(old).toContain('class="bmag__img bmag__img--frame"');
    expect(old).toContain('width="1200" height="630"');
  });

  it("the home: the featured story on top, the rest in the grid, every article for a crawler, no script controls", () => {
    const posts = [item("a", { featured: true }), item("b", { topic: "hair" }), item("c")];
    const html = homeStaticHTML({ posts, featured: [], code: "ET", hrefOf, total: 3 });
    expect(html).toContain('<section class="bmag-hero" aria-label="Esiletõstetud artiklid">');
    expect(html).toContain('<a class="bmag-hero__btn" href="/ru/blogs/news/a">Loe artiklit</a>');
    expect(html).toContain('<h1 class="bmag__h">Blogi</h1><span class="bmag__n">3 artiklit</span>');
    // only the topics the blog has, «Kõik» first
    expect(html).toContain("<li>Kõik</li><li>Juuksed</li><li>Habe</li></ul>");
    expect(html).toContain('href="/ru/blogs/news/b"');
    expect(html).toContain('href="/ru/blogs/news/c"');
    expect(html.match(/class="blog__tile bmag__card"/g)).toHaveLength(2);
    // the chips, the carousel marks and «Спросите помощника» are app.js's alone — the chat is desktop-only
    expect(html).not.toContain("<button");
    expect(html).not.toContain("bmag__ask");
  });

  it("the article: byline, lead, strip with «Все N товаров», the sources box only when there are sources", () => {
    const base = {
      slug: "s", title: "Заголовок", excerpt: "Лид.", coverUrl: "/c.webp", coverW: 828, coverH: 1170, coverAlt: "", coverFocus: null,
      author: "Rempire", publishedAt: "2026-10-20T10:00:00Z", topic: "hair", minutes: 9, sources: [] as string[],
    };
    const strip = [{ href: "/ru/products/a", img: "/shop/img/a-0.webp", name: "Angel.Wash", price: "от 6 €" }];
    const html = articleStaticHTML({
      post: base, code: "RU", blogHref: "/ru/blogs/news", hrefOf, bodyShown: "<h2>Раздел</h2>", strip, productCount: 34,
      next: [item("n1", { coverUrl: "/n.webp", coverFocus: "fill 20 30" })], tagsHTML: "", shelfId: "post-products",
    });
    expect(html).toContain('<figure class="bmag-post__cover bmag-post__cover--narrow"><img class="bmag-post__img" src="/c.webp" alt="Заголовок" width="828" height="1170" fetchpriority="high"');
    expect(html).toContain('<nav class="bmag-post__crumbs" aria-label="Блог"><a href="/ru/blogs/news">Блог</a> / <span>Волосы</span></nav>');
    expect(html).toContain('<p class="bmag-post__by"><span>Команда салона Rempire</span> · <span>20.10.2026</span> · <span>9 мин чтения</span></p>');
    expect(html).toContain('<p class="bmag-post__lead">Лид.</p>');
    expect(html).toContain('<a class="bmag-strip__all" href="#post-products">Все 34 товара</a>');
    expect(html).toContain('<span class="bmag-strip__nm">Angel.Wash</span><span class="bmag-strip__pr num">от 6 €</span>');
    expect(html).toContain('<div class="acc__rich blog__body"><h2>Раздел</h2></div>');
    expect(html).not.toContain("bmag-src");
    expect(html).toContain('<h2 class="bmag-next__h">Читать дальше</h2>');
    expect(html).toContain('style="object-position:20% 30%"');
    const withSources = articleStaticHTML({
      post: { ...base, sources: ["Буклет, PDF", "tallinnavesi.ee"] }, code: "EN", blogHref: "/blogs/news", hrefOf, bodyShown: "",
      strip: [], productCount: 0, next: [], tagsHTML: "", shelfId: "post-products",
    });
    expect(withSources).toContain('<aside class="bmag-src" aria-label="Written from"><span class="bmag-src__h">Written from</span><span>Буклет, PDF · tallinnavesi.ee</span></aside>');
    expect(withSources).not.toContain("<a href=\"Буклет");   // names, never a file link
    expect(withSources).toContain("<span>Rempire salon team</span>");
  });

  it("the grid HTML keeps every card's place in the articles' order (`order`) for the one-column phone", () => {
    const items = ["a", "b", "c", "d"].map((s) => item(s));
    const html = gridHTML(items, "RU", hrefOf);
    for (let i = 0; i < 4; i++) expect(html).toContain(`style="order:${i}"`);
    expect(html.match(/class="bmag__col"/g)).toHaveLength(3);
  });
});

/* ---------- the twin in public/shop2/app.js -------------------------------------------- */

describe("app.js draws the same magazine", () => {
  const app = readFileSync(fileURLToPath(new URL("../public/shop2/app.js", import.meta.url)), "utf8");
  const slice = (name: string): string => {
    const start = app.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`app.js has no function ${name}()`);
    let depth = 0;
    for (let i = app.indexOf("{", start); i < app.length; i++) {
      if (app[i] === "{") depth++;
      else if (app[i] === "}" && --depth === 0) return app.slice(start, i + 1);
    }
    throw new Error("unbalanced " + name);
  };
  const sliceVar = (name: string): string => {
    const start = app.indexOf(`var ${name} = `);
    return app.slice(start, app.indexOf(";", start) + 1);
  };

  it("the same five topics, in the same order, with the same Russian names", () => {
    const t = new Function(`${sliceVar("BLOG_TOPICS")} ${sliceVar("BLOG_TOPIC_RU")} return { BLOG_TOPICS, BLOG_TOPIC_RU };`)() as {
      BLOG_TOPICS: string[]; BLOG_TOPIC_RU: Record<string, string>;
    };
    expect(t.BLOG_TOPICS).toEqual(BLOG_TOPICS);
    for (const k of BLOG_TOPICS) expect(t.BLOG_TOPIC_RU[k]).toBe((TOPIC_NAMES as Record<string, { RU: string }>)[k].RU);
  });

  it("the same masonry and the same «Читать дальше»", () => {
    const fns = new Function(`${slice("bmagDims")} ${slice("bmagMasonry")} ${slice("bmagReadNext")} return { bmagMasonry, bmagReadNext };`)() as {
      bmagMasonry: (i: unknown[], c: number) => number[][]; bmagReadNext: (p: unknown, l: unknown[]) => unknown[];
    };
    const cases = [
      [{ coverUrl: "/t", coverW: 800, coverH: 1200 }, { coverUrl: "/t", coverW: 800, coverH: 1200 }, { coverUrl: "/w", coverW: 1200, coverH: 400 }, {}],
      [{}, { coverUrl: "/x" }, { coverUrl: "/x" }, { coverUrl: "/y", coverW: 100, coverH: 100 }, {}, {}],
    ];
    for (const c of cases) expect(fns.bmagMasonry(c, 3)).toEqual(masonry(c, 3));
    const posts = [{ slug: "a", topic: "beard" }, { slug: "me", topic: "hair" }, { slug: "b", topic: "hair" }, { slug: "c", topic: "skin" }];
    expect(fns.bmagReadNext(posts[1], posts)).toEqual(readNext(posts[1], posts));
  });

  /* The static page says these in its own words (STR); app.js says them in
     Russian and translateTree() turns them into ET and EN from its UI table —
     the two must be the same sentences, or the page changes its words the
     moment the shop boots. */
  it("every interface sentence has the same ET and EN words in both places", () => {
    const keys = ["featured", "read", "topics", "all", "askEye", "askText", "askBtn", "team", "inThis", "inThisLabel", "sources", "askPost", "next", "none"] as const;
    const table = (code: "ET" | "EN") => {
      const m = app.match(new RegExp(`\\n    ${code}: \\{`));
      return m && m.index !== undefined ? app.slice(m.index) : "";
    };
    for (const code of ["ET", "EN"] as const) {
      const t = table(code);
      for (const k of keys) {
        const ru = (STR.RU as Record<string, string>)[k], want = (STR[code] as Record<string, string>)[k];
        const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        expect(t, `${code} ${k}`).toMatch(new RegExp(`"${esc(ru)}":\\s*"${esc(want)}"`));
      }
      for (const topic of BLOG_TOPICS) {
        const names = (TOPIC_NAMES as Record<string, Record<string, string>>)[topic];
        expect(t, `${code} ${topic}`).toContain(`"${names.RU}": "${names[code]}"`);
      }
    }
  });

  it("draws the ask card and «Спросить об этой статье» only where the chat exists, and never on the static page", () => {
    expect(slice("bmagCanAsk")).toContain("chatWanted()");
    expect(slice("bmagCanAskPost")).toContain('typeof window.openChatAbout === "function"');
    expect(slice("screenBlog")).toContain("bmagGridHTML(items, bmagCanAsk())");
    expect(slice("screenBlogPost")).toContain("bmagCanAskPost()");
    expect(slice("blogAskChat")).toContain("window.openChatAbout(slug,");
  });

  it("the chips filter in the browser, over the list the page already holds", () => {
    const s = slice("screenBlog");
    expect(s).toContain("posts.filter(function (p) { return p.topic === topic; })");
    expect(app).toContain("if (d.blogchip !== undefined) {");
  });
});
