/**
 * The blog: markdown safety, slugs, storage (PGlite), and the two route
 * surfaces — public read-only and admin CRUD, both driven with plain
 * Requests exactly as Next would call them.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { exec } from "@/lib/db";
import {
  deletePost,
  getPostById,
  getPostBySlug,
  getPublishedBySlug,
  listAllPosts,
  listPublished,
  markdownToHtml,
  pickLang,
  publishPost,
  slugify,
  uniqueSlug,
  unpublishPost,
  upsertPost,
} from "@/lib/blog";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

/* ---------- markdown → safe HTML ------------------------------------------ */

describe("markdownToHtml — the safe subset", () => {
  it("renders headings, paragraphs, bold and italic", () => {
    expect(markdownToHtml("# Заголовок\n\nОбычный **жирный** и *курсив*.")).toBe(
      "<h1>Заголовок</h1><p>Обычный <strong>жирный</strong> и <em>курсив</em>.</p>",
    );
  });

  it("renders __bold__ and _italic_ the same as **bold** and *italic*", () => {
    expect(markdownToHtml("__x__ and _y_")).toBe("<p><strong>x</strong> and <em>y</em></p>");
  });

  it("renders lists, a blockquote, a heading level and a paragraph together", () => {
    const html = markdownToHtml("## Раздел\n\n- один\n- два\n\n> цитата\n\nАбзац.");
    expect(html).toBe("<h2>Раздел</h2><ul><li>один</li><li>два</li></ul><blockquote><p>цитата</p></blockquote><p>Абзац.</p>");
  });

  it("renders an ordered list", () => {
    expect(markdownToHtml("1. первый\n2. второй")).toBe("<ol><li>первый</li><li>второй</li></ol>");
  });

  it("renders a link and an image with a safe URL", () => {
    expect(markdownToHtml("[текст](https://example.com/a)")).toBe(
      '<p><a href="https://example.com/a" target="_blank" rel="noopener noreferrer">текст</a></p>',
    );
    expect(markdownToHtml("![альт](https://example.com/a.png)")).toBe(
      '<p><img src="https://example.com/a.png" alt="альт" loading="lazy"></p>',
    );
  });

  it("accepts a same-site relative link without target=_blank", () => {
    expect(markdownToHtml("[тут](/shop2/c/beard/)")).toBe('<p><a href="/shop2/c/beard/">тут</a></p>');
  });

  /* ---- the XSS cases ------------------------------------------------------ */

  it("never lets a literal <script> tag through, whatever the source looks like", () => {
    const html = markdownToHtml("<script>alert(document.cookie)</script>");
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes an inline HTML tag typed by hand instead of interpreting it", () => {
    const html = markdownToHtml('Look <img src=x onerror="alert(1)"> out');
    expect(html).not.toMatch(/<img[^>]*onerror/i);
    expect(html).toContain("&lt;img");
  });

  it("rejects a javascript: link, leaving the text visible instead of a live <a>", () => {
    const html = markdownToHtml("[click me](javascript:alert(1))");
    expect(html).not.toContain("<a ");
    expect(html).toContain("click me");
  });

  it("rejects a data: and a vbscript: link the same way", () => {
    for (const url of ["data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)"]) {
      const html = markdownToHtml(`[x](${url})`);
      expect(html).not.toContain("<a ");
    }
  });

  it("rejects an unsafe image src the same way", () => {
    const html = markdownToHtml("![x](javascript:alert(1))");
    expect(html).not.toContain("<img");
  });

  it("rejects a protocol-relative //host URL (an https: escape hatch)", () => {
    const html = markdownToHtml("[x](//evil.example/a)");
    expect(html).not.toContain("<a ");
  });

  it("escapes stray angle brackets and quotes in ordinary text", () => {
    expect(markdownToHtml("5 < 10 and 10 > 5, say \"hi\"")).toContain("5 &lt; 10 and 10 &gt; 5, say &quot;hi&quot;");
  });

  it("cannot produce an on*= attribute even via a crafted image alt", () => {
    const html = markdownToHtml('![x" onerror="alert(1)](https://example.com/a.png)');
    expect(html).not.toMatch(/\son\w+\s*=/i);
  });

  it("treats an unsupported construct (a table, raw HTML) as plain escaped text", () => {
    const html = markdownToHtml("| a | b |\n| - | - |");
    expect(html).not.toContain("<table");
    expect(html).toContain("| a | b |");
  });

  it("is empty for empty input", () => {
    expect(markdownToHtml("")).toBe("");
    expect(markdownToHtml("   \n\n  ")).toBe("");
  });
});

/* ---------- pickLang -------------------------------------------------------- */

describe("pickLang", () => {
  it("returns the requested language, falling back to Russian, then to whatever exists", () => {
    expect(pickLang({ RU: "ру", ET: "et", EN: "en" }, "ET")).toBe("et");
    expect(pickLang({ RU: "ру", ET: "", EN: "en" }, "ET")).toBe("ру");
    expect(pickLang({ RU: "", ET: "", EN: "en" }, "RU")).toBe("en");
    expect(pickLang(null, "RU")).toBe("");
    expect(pickLang({ RU: "ру", ET: "", EN: "" }, "xx")).toBe("ру"); // unknown lang code -> RU
  });
});

/* ---------- slugify --------------------------------------------------------- */

describe("slugify", () => {
  it("transliterates Cyrillic to readable Latin", () => {
    expect(slugify("Как ухаживать за бородой")).toBe("kak-uhazhivat-za-borodoy");
  });

  it("transliterates Estonian diacritics", () => {
    expect(slugify("Habemeõli ja hooldus")).toBe("habemeoli-ja-hooldus");
  });

  it("lower-cases, collapses punctuation into single dashes, trims edges", () => {
    expect(slugify("  Hello,   World!! ")).toBe("hello-world");
    expect(slugify("--leading and trailing--")).toBe("leading-and-trailing");
  });

  it("falls back to the given default when nothing Latin-safe survives", () => {
    expect(slugify("???")).toBe("post");
    expect(slugify("")).toBe("post");
    expect(slugify("!!!", "article")).toBe("article");
  });

  it("caps length at 80 characters", () => {
    expect(slugify("а".repeat(200)).length).toBeLessThanOrEqual(80);
  });
});

/* ---------- storage (PGlite) ------------------------------------------------ */

describe("blog storage", () => {
  beforeAll(async () => {
    const applied = await setupDb();
    expect(applied).toContain("070_blog.sql");
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate posts restart identity");
  });

  it("creates a draft with a slug derived from the Russian title", async () => {
    const post = await upsertPost({ title: { RU: "Уход за бородой зимой" }, body: { RU: "текст" } });
    expect(post.status).toBe("draft");
    expect(post.slug).toBe("uhod-za-borodoy-zimoy");
    expect(post.publishedAt).toBeNull();
    expect(post.author).toBe("Rempire");
  });

  it("de-duplicates a slug that collides with an existing one", async () => {
    const a = await upsertPost({ title: { RU: "Уход за бородой" } });
    const b = await upsertPost({ title: { RU: "Уход за бородой" } });
    const c = await upsertPost({ title: { RU: "Уход за бородой" } });
    expect(a.slug).toBe("uhod-za-borodoy");
    expect(b.slug).toBe("uhod-za-borodoy-2");
    expect(c.slug).toBe("uhod-za-borodoy-3");
  });

  it("uniqueSlug() excludes the post's own row when re-checked on an edit", async () => {
    const post = await upsertPost({ title: { RU: "Заголовок" } });
    expect(await uniqueSlug(post.slug, post.id)).toBe(post.slug);
    expect(await uniqueSlug(post.slug)).not.toBe(post.slug); // no exclusion -> collides with itself
  });

  it("edits fields on an existing post without touching its status", async () => {
    const created = await upsertPost({ title: { RU: "Заголовок" }, tags: ["a"] });
    const edited = await upsertPost({ id: created.id, title: { RU: "Новый заголовок" }, tags: ["a", "b"] });
    expect(edited.id).toBe(created.id);
    expect(edited.status).toBe("draft");
    expect(edited.title.RU).toBe("Новый заголовок");
    expect(edited.tags).toEqual(["a", "b"]);
  });

  it("keeps the existing slug on an edit that does not name a new one — a published link must not move", async () => {
    const created = await upsertPost({ title: { RU: "Первый заголовок" } });
    const published = await publishPost(created.id);
    expect(published?.slug).toBe(created.slug);
    const edited = await upsertPost({ id: created.id, title: { RU: "Совсем другой заголовок" } });
    expect(edited.slug).toBe(created.slug);
  });

  it("accepts an explicit slug on an edit and re-validates it", async () => {
    const created = await upsertPost({ title: { RU: "Заголовок" } });
    const edited = await upsertPost({ id: created.id, slug: "My Custom Slug!" });
    expect(edited.slug).toBe("my-custom-slug");
  });

  it("throws a not_found error editing an id that does not exist", async () => {
    await expect(upsertPost({ id: "00000000-0000-0000-0000-000000000000", title: { RU: "x" } }))
      .rejects.toThrow();
  });

  it("publishes, keeping publishedAt across a republish, and unpublishes without losing it", async () => {
    const created = await upsertPost({ title: { RU: "Заголовок" } });
    const published = await publishPost(created.id);
    expect(published?.status).toBe("published");
    expect(published?.publishedAt).not.toBeNull();
    const firstPublishedAt = published?.publishedAt;

    const unpublished = await unpublishPost(created.id);
    expect(unpublished?.status).toBe("draft");
    expect(unpublished?.publishedAt).toBe(firstPublishedAt); // kept — "was live until…"

    const republished = await publishPost(created.id);
    expect(republished?.publishedAt).toBe(firstPublishedAt); // not bumped to now()
  });

  it("soft-deletes: back to draft AND forgets publishedAt, unlike unpublish", async () => {
    const created = await upsertPost({ title: { RU: "Заголовок" } });
    await publishPost(created.id);
    const deleted = await deletePost(created.id);
    expect(deleted?.status).toBe("draft");
    expect(deleted?.publishedAt).toBeNull();
    // the row survives — it can be published again, unlike a hard delete
    const again = await getPostById(created.id);
    expect(again).not.toBeNull();
  });

  it("publishPost/unpublishPost/deletePost return null for an id that does not exist", async () => {
    const bogus = "00000000-0000-0000-0000-000000000000";
    expect(await publishPost(bogus)).toBeNull();
    expect(await unpublishPost(bogus)).toBeNull();
    expect(await deletePost(bogus)).toBeNull();
  });

  it("lists only published posts, newest published first, and hides the body", async () => {
    const a = await upsertPost({ title: { RU: "Первая" }, body: { RU: "текст a" } });
    const b = await upsertPost({ title: { RU: "Вторая" }, body: { RU: "текст b" } });
    await upsertPost({ title: { RU: "Черновик — остаётся невидимым" } }); // never published
    await publishPost(a.id);
    await new Promise((r) => setTimeout(r, 2)); // ensure a strictly later published_at
    await publishPost(b.id);

    const { posts, total } = await listPublished(1, 10);
    expect(total).toBe(2);
    expect(posts.map((p) => p.slug)).toEqual([b.slug, a.slug]);
    expect(posts[0]).not.toHaveProperty("body");
  });

  it("paginates listPublished", async () => {
    for (let i = 0; i < 3; i++) {
      const p = await upsertPost({ title: { RU: `Статья ${i}` } });
      await publishPost(p.id);
    }
    const page1 = await listPublished(1, 2);
    expect(page1.posts).toHaveLength(2);
    expect(page1.total).toBe(3);
    const page2 = await listPublished(2, 2);
    expect(page2.posts).toHaveLength(1);
  });

  it("getPublishedBySlug returns null for a draft — public code must not be able to tell drafts from missing slugs", async () => {
    const draft = await upsertPost({ title: { RU: "Черновик" } });
    expect(await getPublishedBySlug(draft.slug)).toBeNull();
    expect(await getPublishedBySlug("does-not-exist-at-all")).toBeNull();

    await publishPost(draft.id);
    const live = await getPublishedBySlug(draft.slug);
    expect(live?.slug).toBe(draft.slug);
    expect(live?.body.RU).toBeDefined(); // the single-post read DOES carry the body
  });

  it("listAllPosts (admin) includes drafts and published, newest edited first, no body", async () => {
    const a = await upsertPost({ title: { RU: "А" } });
    const b = await upsertPost({ title: { RU: "Б" } });
    await publishPost(b.id);
    const all = await listAllPosts();
    expect(all.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
    expect(all.every((p) => !("body" in p))).toBe(true);
  });

  it("getPostBySlug finds a post regardless of status (admin use)", async () => {
    const draft = await upsertPost({ title: { RU: "Черновик" } });
    expect((await getPostBySlug(draft.slug))?.id).toBe(draft.id);
  });

  it("caps the number of tags and products, and drops duplicate tags", async () => {
    const post = await upsertPost({
      title: { RU: "Заголовок" },
      tags: Array.from({ length: 20 }, (_, i) => `тег${i % 5}`), // 4 duplicates x5
      products: Array.from({ length: 20 }, (_, i) => `product-${i}`),
    });
    expect(post.tags).toHaveLength(5);
    expect(post.products).toHaveLength(12);
  });
});

/* ---------- public API ------------------------------------------------------ */

const ORIGIN = "https://rempireshop.com";

describe("GET /api/blog/", () => {
  beforeAll(async () => {
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate posts restart identity");
  });

  it("lists only published posts, resolved to the requested language", async () => {
    const post = await upsertPost({
      title: { RU: "Заголовок", ET: "Pealkiri" },
      excerpt: { RU: "Анонс" },
      tags: ["борода"],
    });
    await publishPost(post.id);
    const draft = await upsertPost({ title: { RU: "Невидимый черновик" } });
    void draft;

    const { GET } = await import("@/app/api/blog/route");
    const res = await GET(new Request(`${ORIGIN}/api/blog/?lang=ET`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.posts).toHaveLength(1);
    expect(body.posts[0].title).toBe("Pealkiri");
    expect(body.posts[0].excerpt).toBe("Анонс"); // ET excerpt not set -> RU fallback
    expect(body.posts[0].tags).toEqual(["борода"]);
  });

  it("answers ok:true with an empty list rather than an error when the database is unreachable", async () => {
    await teardownDb();
    const { GET } = await import("@/app/api/blog/route");
    const res = await GET(new Request(`${ORIGIN}/api/blog/`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, posts: [], degraded: true });
    await setupDb();
  });
});

describe("GET /api/blog/[slug]/", () => {
  beforeAll(async () => {
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    await exec("truncate posts restart identity");
  });

  it("renders bodyHtml server-side and answers 404 for a draft or a missing slug alike", async () => {
    const post = await upsertPost({ title: { RU: "Заголовок" }, body: { RU: "**жирный**" } });
    const { GET } = await import("@/app/api/blog/[slug]/route");

    const beforePublish = await GET(new Request(`${ORIGIN}/api/blog/${post.slug}/`), {
      params: Promise.resolve({ slug: post.slug }),
    });
    expect(beforePublish.status).toBe(404);
    expect((await beforePublish.json()).error).toBe("not_found");

    const missing = await GET(new Request(`${ORIGIN}/api/blog/never-existed/`), {
      params: Promise.resolve({ slug: "never-existed" }),
    });
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toBe("not_found");

    await publishPost(post.id);
    const live = await GET(new Request(`${ORIGIN}/api/blog/${post.slug}/`), {
      params: Promise.resolve({ slug: post.slug }),
    });
    expect(live.status).toBe(200);
    const body = await live.json();
    expect(body.post.bodyHtml).toBe("<p><strong>жирный</strong></p>");
    expect(body.post.slug).toBe(post.slug);
  });
});

/* ---------- admin API -------------------------------------------------------- */

describe("admin blog API — auth", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    resetRateLimits();
    await truncateAll();
  });

  it("turns away every verb without the admin cookie", async () => {
    const { GET, POST, PATCH, DELETE } = await import("@/app/api/admin/blog/route");
    expect((await GET(new Request(`${ORIGIN}/api/admin/blog/`))).status).toBe(401);
    expect(
      (await POST(new Request(`${ORIGIN}/api/admin/blog/`, { method: "POST", body: "{}" }))).status,
    ).toBe(401);
    expect(
      (await PATCH(new Request(`${ORIGIN}/api/admin/blog/`, { method: "PATCH", body: "{}" }))).status,
    ).toBe(401);
    expect(
      (await DELETE(new Request(`${ORIGIN}/api/admin/blog/?id=x`, { method: "DELETE" }))).status,
    ).toBe(401);
  });

  it("a forged cookie is turned away the same as no cookie", async () => {
    const { GET } = await import("@/app/api/admin/blog/route");
    const res = await GET(new Request(`${ORIGIN}/api/admin/blog/`, { headers: { cookie: `${ADMIN_COOKIE}=garbage` } }));
    expect(res.status).toBe(401);
  });
});

describe("admin blog API — CRUD", () => {
  let admin = "";
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    resetRateLimits();
    await truncateAll();
  });

  function send(method: string, body: unknown, cookie = admin) {
    return new Request(`${ORIGIN}/api/admin/blog/`, {
      method,
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(body),
    });
  }

  it("creates a draft, edits it, publishes it, unpublishes it, then soft-deletes it", async () => {
    const { GET, POST, PATCH, DELETE } = await import("@/app/api/admin/blog/route");

    const created = await POST(send("POST", { title: { RU: "Заголовок" }, body: { RU: "текст" } }));
    expect(created.status).toBe(200);
    const post = (await created.json()).post;
    expect(post.status).toBe("draft");

    const edited = await PATCH(send("PATCH", { id: post.id, excerpt: { RU: "Новый анонс" } }));
    expect((await edited.json()).post.excerpt.RU).toBe("Новый анонс");

    const publishedBySlug = await PATCH(send("PATCH", { slug: post.slug, publish: true }));
    expect((await publishedBySlug.json()).post.status).toBe("published");

    const listedPublic = await (await import("@/lib/blog")).listPublished(1, 10);
    expect(listedPublic.posts.map((p) => p.id)).toContain(post.id);

    const unpublished = await PATCH(send("PATCH", { id: post.id, publish: false }));
    expect((await unpublished.json()).post.status).toBe("draft");

    const deleted = await DELETE(
      new Request(`${ORIGIN}/api/admin/blog/?id=${post.id}`, { method: "DELETE", headers: { cookie: admin } }),
    );
    expect(deleted.status).toBe(200);
    expect((await deleted.json()).post.status).toBe("draft");

    const list = await GET(new Request(`${ORIGIN}/api/admin/blog/`, { headers: { cookie: admin } }));
    const posts = (await list.json()).posts;
    expect(posts.map((p: { id: string }) => p.id)).toContain(post.id); // soft delete keeps the row
  });

  it("GET ?id= and ?slug= both return the full post, 404 for an unknown one", async () => {
    const { GET, POST } = await import("@/app/api/admin/blog/route");
    const created = await POST(send("POST", { title: { RU: "Заголовок" }, body: { RU: "текст" } }));
    const post = (await created.json()).post;

    const byId = await GET(new Request(`${ORIGIN}/api/admin/blog/?id=${post.id}`, { headers: { cookie: admin } }));
    expect((await byId.json()).post.slug).toBe(post.slug);

    const bySlug = await GET(new Request(`${ORIGIN}/api/admin/blog/?slug=${post.slug}`, { headers: { cookie: admin } }));
    expect((await bySlug.json()).post.id).toBe(post.id);

    const missing = await GET(new Request(`${ORIGIN}/api/admin/blog/?id=00000000-0000-0000-0000-000000000000`, { headers: { cookie: admin } }));
    expect(missing.status).toBe(404);
  });

  it("PATCH with no id and no slug is rejected", async () => {
    const { PATCH } = await import("@/app/api/admin/blog/route");
    const res = await PATCH(send("PATCH", { title: { RU: "x" } }));
    expect(res.status).toBe(400);
  });

  it("DELETE with no id is rejected", async () => {
    const { DELETE } = await import("@/app/api/admin/blog/route");
    const res = await DELETE(new Request(`${ORIGIN}/api/admin/blog/`, { method: "DELETE", headers: { cookie: admin } }));
    expect(res.status).toBe(400);
  });
});
