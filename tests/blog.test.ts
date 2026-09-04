/**
 * The blog: markdown safety, slugs, storage (PGlite), and the two route
 * surfaces — public read-only and admin CRUD, both driven with plain
 * Requests exactly as Next would call them.
 */
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { exec, query } from "@/lib/db";
import {
  deletePost,
  getPostById,
  getPostBySlug,
  getPublishedBySlug,
  LANGS,
  listAllPosts,
  listPublished,
  looksLikeHtmlBody,
  markdownToHtml,
  pickLang,
  publishPost,
  renderPostBody,
  sanitizeHtml,
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

/* ---------- sanitizeHtml — the visual editor's allowlist -------------------- */

describe("sanitizeHtml — what a body written in the editor is allowed to be", () => {
  it("keeps the tags the editor writes, and leaves them exactly as they were", () => {
    const html =
      "<p>Текст <strong>жирный</strong> и <em>курсив</em>.</p><h2>Раздел</h2>" +
      "<ul><li>один</li><li>два</li></ul><blockquote>цитата</blockquote>";
    expect(sanitizeHtml(html)).toBe(html);
  });

  it("drops a <script> together with everything inside it", () => {
    const html = sanitizeHtml("<p>до</p><script>alert(document.cookie)</script><p>после</p>");
    expect(html).toBe("<p>до</p><p>после</p>");
    expect(html.toLowerCase()).not.toContain("script");
    expect(html).not.toContain("alert");
  });

  it("drops <style> and <iframe> the same way — tag and contents both", () => {
    expect(sanitizeHtml("<style>p{color:red}</style><iframe src='https://evil.example'></iframe><p>a</p>"))
      .toBe("<p>a</p>");
  });

  it("drops every attribute that is not on the list — onerror included", () => {
    const html = sanitizeHtml('<img src="https://media.example/a.webp" onerror="alert(1)" alt="кот" class="x" style="width:9px">');
    expect(html).toBe('<img src="https://media.example/a.webp" alt="кот" loading="lazy">');
  });

  it("cannot be handed an on*= attribute on any tag at all", () => {
    expect(sanitizeHtml('<p onclick="alert(1)" onmouseover=alert(2)>текст</p>')).toBe("<p>текст</p>");
    expect(sanitizeHtml('<a href="https://example.com" onfocus="alert(1)">x</a>'))
      .toBe('<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>');
  });

  it("rejects a javascript:, data:, vbscript: or //host href — the text stays, the link goes", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "//evil.example/x",
    ]) {
      expect(sanitizeHtml(`<p><a href="${url}">жми</a></p>`)).toBe("<p>жми</p>");
    }
  });

  it("keeps an outside link with rel=noopener, and a same-site one without a target", () => {
    expect(sanitizeHtml('<p><a href="https://example.com/a">x</a></p>'))
      .toBe('<p><a href="https://example.com/a" target="_blank" rel="noopener noreferrer">x</a></p>');
    expect(sanitizeHtml('<p><a href="/shop2/p/night-rider/">x</a></p>'))
      .toBe('<p><a href="/shop2/p/night-rider/">x</a></p>');
  });

  it("takes an image only from https or from this shop's own path", () => {
    expect(sanitizeHtml('<img src="http://example.com/a.png" alt="">')).toBe("");
    expect(sanitizeHtml('<img src="javascript:alert(1)" alt="">')).toBe("");
    expect(sanitizeHtml('<figure><img src="/shop/img/night-rider-0.webp" alt="паста"></figure>'))
      .toBe('<figure><img src="/shop/img/night-rider-0.webp" alt="паста" loading="lazy"></figure>');
  });

  it("keeps the «Товар» marker, but only when its id could be a catalogue id", () => {
    expect(sanitizeHtml('<p><a data-product="night-rider" href="/shop2/p/night-rider/">Night.Rider</a></p>'))
      .toBe('<p><a data-product="night-rider" href="/shop2/p/night-rider/">Night.Rider</a></p>');
    expect(sanitizeHtml('<p><a data-product="../../etc/passwd">x</a></p>')).toBe("<p>x</p>");
    expect(sanitizeHtml('<p><a data-product="<script>">x</a></p>')).toBe("<p>x</p>");
  });

  it("cleans a paste from Word down to the text and the emphasis it carried", () => {
    const word =
      '<div class="WordSection1"><o:p></o:p><p class="MsoNormal">' +
      '<span style="font-family:Calibri"><b>Заголовок</b></span></p>' +
      "<table><tr><td>ячейка</td></tr></table></div>";
    expect(sanitizeHtml(word)).toBe("<p><strong>Заголовок</strong></p>ячейка");
  });

  it("maps the headings a paste uses onto the two the shop has", () => {
    expect(sanitizeHtml("<h1>раз</h1><h5>два</h5><i>три</i>"))
      .toBe("<h2>раз</h2><h3>два</h3><em>три</em>");
  });

  it("balances what the input did not: a stray close tag, an unclosed open one", () => {
    expect(sanitizeHtml("</p><p>текст")).toBe("<p>текст</p>");
    expect(sanitizeHtml("<p>a<strong>b</p>c")).toBe("<p>a<strong>b</strong></p>c");
  });

  it("does not choke on nested garbage — it stops nesting instead", () => {
    const deep = "<strong>".repeat(500) + "дно" + "</strong>".repeat(500);
    const html = sanitizeHtml(`<p>${deep}</p>`);
    expect(html).toContain("дно");
    expect(html.split("<strong>").length - 1).toBeLessThanOrEqual(24);
    expect(html.startsWith("<p>")).toBe(true);
    expect(html.endsWith("</p>")).toBe(true);
  });

  it("escapes text, and leaves an entity that was already there alone", () => {
    expect(sanitizeHtml("<p>5 &lt; 10 &amp; 10 &gt; 5</p>")).toBe("<p>5 &lt; 10 &amp; 10 &gt; 5</p>");
    expect(sanitizeHtml("<p>A & B</p>")).toBe("<p>A &amp; B</p>");
    expect(sanitizeHtml("<p>a < b</p>")).toBe("<p>a &lt; b</p>");
  });

  it("drops comments, doctypes and anything else that is not a tag", () => {
    expect(sanitizeHtml("<!doctype html><!-- <script>alert(1)</script> --><p>a</p>")).toBe("<p>a</p>");
  });

  it("is empty for empty input", () => {
    expect(sanitizeHtml("")).toBe("");
    expect(sanitizeHtml("   ")).toBe("   ");
  });
});

/* ---------- which renderer a stored body gets ------------------------------ */

describe("renderPostBody", () => {
  it("renders a body that opens with a block tag through the HTML allowlist", () => {
    expect(looksLikeHtmlBody("<h2>Раздел</h2><p>x</p>")).toBe(true);
    expect(renderPostBody('<p>текст</p><script>alert(1)</script>')).toBe("<p>текст</p>");
  });

  it("renders a body written before the editor changed as the markdown it is", () => {
    expect(looksLikeHtmlBody("## Раздел\n\nАбзац.")).toBe(false);
    expect(renderPostBody("## Раздел\n\nАбзац.")).toBe("<h2>Раздел</h2><p>Абзац.</p>");
  });

  it("a body that merely OPENS with a pasted tag is markdown — the tag is escaped, not run", () => {
    const html = renderPostBody("<script>alert(1)</script>\n\nОбычный абзац.");
    expect(html).toContain("&lt;script&gt;");
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).toContain("<p>Обычный абзац.</p>");
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

  it("stores the Google title and description per language, capped, and picks them per language with the Russian fallback", async () => {
    const post = await upsertPost({
      title: { RU: "Уход за бородой зимой" },
      seoTitle: { RU: "Уход за бородой зимой: три привычки", ET: "Habeme talvine hooldus: kolm harjumust", EN: "" },
      seoDesc: { RU: "Мороз сушит бороду. " + "я".repeat(200), ET: "Külm kuivatab habet." },
    });
    expect(post.seoTitle).toEqual({ RU: "Уход за бородой зимой: три привычки", ET: "Habeme talvine hooldus: kolm harjumust", EN: "" });
    expect(post.seoDesc.RU).toHaveLength(170);
    expect(post.seoDesc.ET).toBe("Külm kuivatab habet.");
    expect(post.seoDesc.EN).toBe("");

    const back = await getPostById(post.id);
    expect(back!.seoTitle.ET).toBe("Habeme talvine hooldus: kolm harjumust");
    // the ladder every public reader runs: this language → Russian → anything
    expect(pickLang(back!.seoTitle, "ET")).toBe("Habeme talvine hooldus: kolm harjumust");
    expect(pickLang(back!.seoTitle, "EN")).toBe("Уход за бородой зимой: три привычки");
    expect(pickLang(back!.seoDesc, "EN")).toBe(post.seoDesc.RU);

    // an edit replaces the whole set it was given — an emptied language really goes away
    const edited = await upsertPost({ id: post.id, title: { RU: "Уход за бородой зимой" }, seoTitle: { EN: "Winter beard care: three habits" } });
    expect(edited.seoTitle).toEqual({ RU: "", ET: "", EN: "Winter beard care: three habits" });
    expect(pickLang(edited.seoTitle, "ET")).toBe("Winter beard care: three habits");
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

  /* The body is the one field where a line break is content. It used to be
     cleaned like a title — `\s+` → " " — which turned every article into one
     endless line: a «## Масло каждый день» ended up inside the paragraph
     above it and the shop showed a wall of text. */
  it("keeps the line breaks in a body, so its headings and lists survive the save", async () => {
    const md = "Вступление.\n\n## Масло каждый день\n\nДве-три капли на ладонь.\n\n- один\n- два";
    const post = await upsertPost({ title: { RU: "Заголовок" }, body: { RU: md } });
    expect(post.body.RU).toBe(md);
    expect(renderPostBody(post.body.RU)).toBe(
      "<p>Вступление.</p><h2>Масло каждый день</h2><p>Две-три капли на ладонь.</p><ul><li>один</li><li>два</li></ul>",
    );
  });

  it("still squeezes a body's spaces and tabs, and never keeps more than one blank line", async () => {
    const post = await upsertPost({ title: { RU: "З" }, body: { RU: "а\t\tб   в\r\n\r\n\r\n\r\nг \n  д" } });
    expect(post.body.RU).toBe("а б в\n\nг\nд");
  });

  it("strips control characters from a body without touching its newlines", async () => {
    const post = await upsertPost({ title: { RU: "З" }, body: { RU: "а б​в\nг" } });
    expect(post.body.RU).toBe("а б в\nг");
  });

  it("keeps every other field on one line — a title with a newline in it is still one line", async () => {
    const post = await upsertPost({
      title: { RU: "Один\nдва" },
      excerpt: { RU: "анонс\nпродолжение" },
      seoTitle: { RU: "seo\nзаголовок" },
      coverAlt: { RU: "alt\nтекст" },
    });
    expect(post.title.RU).toBe("Один два");
    expect(post.excerpt.RU).toBe("анонс продолжение");
    expect(post.seoTitle.RU).toBe("seo заголовок");
    expect(post.coverAlt.RU).toBe("alt текст");
  });

  it("keeps a cover that is one of the shop's own pictures, not only an R2 URL", async () => {
    const post = await upsertPost({ title: { RU: "З" }, coverUrl: "/shop/img/night-rider-0.webp" });
    expect(post.coverUrl).toBe("/shop/img/night-rider-0.webp");
    const bad = await upsertPost({ title: { RU: "З2" }, coverUrl: "javascript:alert(1)" });
    expect(bad.coverUrl).toBeNull();
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

  it("answers 503 ok:false (with an empty list) when the database is unreachable — an outage must look like one", async () => {
    await teardownDb();
    const { GET } = await import("@/app/api/blog/route");
    const res = await GET(new Request(`${ORIGIN}/api/blog/`));
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body).toMatchObject({ ok: false, error: "unavailable", posts: [] });
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

  it("answers the Google title and description of the language asked for, and the Russian pair where that language has none", async () => {
    const post = await upsertPost({
      title: { RU: "Уход за бородой зимой", ET: "Habeme talvine hooldus" },
      excerpt: { RU: "Три привычки." },
      seoTitle: { RU: "Уход за бородой зимой: три привычки", ET: "Habeme talvine hooldus: kolm harjumust" },
      seoDesc: { RU: "Мороз сушит бороду — три привычки против этого.", ET: "Külm kuivatab habet — kolm harjumust selle vastu." },
    });
    await publishPost(post.id);
    const { GET } = await import("@/app/api/blog/[slug]/route");
    const read = async (lang: string) =>
      (await (await GET(new Request(`${ORIGIN}/api/blog/${post.slug}/?lang=${lang}`), { params: Promise.resolve({ slug: post.slug }) })).json()).post;

    const et = await read("ET");
    expect(et.seoTitle).toBe("Habeme talvine hooldus: kolm harjumust");
    expect(et.seoDesc).toBe("Külm kuivatab habet — kolm harjumust selle vastu.");
    const en = await read("EN");   // no English pair yet → the Russian one, never a blank
    expect(en.seoTitle).toBe("Уход за бородой зимой: три привычки");
    expect(en.seoDesc).toBe("Мороз сушит бороду — три привычки против этого.");
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

  it("takes the Google title and description per language on POST and PATCH, and hands them back whole", async () => {
    const { GET, POST, PATCH } = await import("@/app/api/admin/blog/route");
    const created = await POST(send("POST", {
      title: { RU: "Заголовок" },
      seoTitle: { RU: "Заголовок для Google", ET: "Pealkiri Google'i jaoks" },
      seoDesc: { RU: "Описание для Google" },
    }));
    expect(created.status).toBe(200);
    const post = (await created.json()).post;
    expect(post.seoTitle).toEqual({ RU: "Заголовок для Google", ET: "Pealkiri Google'i jaoks", EN: "" });
    expect(post.seoDesc).toEqual({ RU: "Описание для Google", ET: "", EN: "" });

    // the editor sends every field on a save (blogFieldsPayload in app.js) — the whole set, all three languages
    const edited = await PATCH(send("PATCH", {
      id: post.id, title: { RU: "Заголовок" },
      seoTitle: { RU: "Заголовок для Google", ET: "Pealkiri Google'i jaoks", EN: "Title for Google" },
      seoDesc: { RU: "Описание для Google", ET: "Kirjeldus Google'i jaoks", EN: "Description for Google" },
    }));
    expect(edited.status).toBe(200);
    expect((await edited.json()).post.seoTitle.EN).toBe("Title for Google");

    const back = await GET(new Request(`${ORIGIN}/api/admin/blog/?id=${post.id}`, { headers: { cookie: admin } }));
    const stored = (await back.json()).post;
    expect(stored.seoTitle).toEqual({ RU: "Заголовок для Google", ET: "Pealkiri Google'i jaoks", EN: "Title for Google" });
    expect(stored.seoDesc).toEqual({ RU: "Описание для Google", ET: "Kirjeldus Google'i jaoks", EN: "Description for Google" });
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

/* ---------- the three sample posts (db/migrations/071_blog_samples.sql) ----- */

describe("sample posts", () => {
  const SLUGS = [
    "uhod-za-borodoy-zimoy",
    "kak-vybrat-shampun-po-tipu-kozhi-golovy",
    "pasta-vosk-ili-glina",
  ];

  beforeAll(async () => {
    const applied = await setupDb();
    expect(applied).toContain("071_blog_samples.sql");
  });
  afterAll(teardownDb);

  it("seeds three published posts, filled in in all three languages", async () => {
    const { posts, total } = await listPublished(1, 10);
    expect(total).toBe(3);
    expect(posts.map((p) => p.slug).sort()).toEqual([...SLUGS].sort());

    for (const slug of SLUGS) {
      const post = await getPublishedBySlug(slug);
      expect(post, `no sample post at ${slug}`).not.toBeNull();
      expect(post!.coverUrl).toMatch(/^\/shop\/img\/[\w.-]+\.webp$/);
      expect(post!.products).toHaveLength(2);
      expect(post!.tags.length).toBeGreaterThan(0);
      expect(post!.author).toBe("Rempire");
      for (const l of LANGS) {
        expect(post!.title[l], `${slug} has no ${l} title`).not.toBe("");
        expect(post!.excerpt[l], `${slug} has no ${l} excerpt`).not.toBe("");
        expect(post!.seoTitle[l].length).toBeLessThanOrEqual(70);
        expect(post!.seoDesc[l].length).toBeLessThanOrEqual(170);
        // 250–400 words of real text, not a placeholder
        const words = post!.body[l].replace(/<[^>]*>/g, " ").split(/\s+/).filter(Boolean).length;
        expect(words, `${slug} ${l} is ${words} words`).toBeGreaterThanOrEqual(250);
        expect(words, `${slug} ${l} is ${words} words`).toBeLessThanOrEqual(400);
      }
    }
  });

  it("stores every sample body as HTML the sanitiser passes through untouched", async () => {
    for (const slug of SLUGS) {
      const post = await getPublishedBySlug(slug);
      for (const l of LANGS) {
        const body = post!.body[l];
        expect(looksLikeHtmlBody(body)).toBe(true);
        expect(renderPostBody(body), `${slug} ${l} does not survive the allowlist`).toBe(body);
        expect(body).toContain("<h2>");
        expect(body).toContain("<ul>");
        expect(body).toMatch(/<a data-product="[a-z0-9-]+"/);
      }
    }
  });

  it("points every sample at products and photos this shop really has", async () => {
    const catalogue = readFileSync(new URL("../public/shop/catalogue.js", import.meta.url), "utf8");
    for (const slug of SLUGS) {
      const post = await getPublishedBySlug(slug);
      for (const id of post!.products) expect(catalogue, `${slug} links a product that is gone: ${id}`).toContain(`"id": "${id}"`);
      expect(catalogue, `${slug}'s cover is not a catalogue photo`).toContain(post!.coverUrl as string);
      // and the product markers inside the bodies point at real ids too
      for (const l of LANGS) {
        const marked = post!.body[l].match(/data-product="([^"]+)"/g) || [];
        for (const m of marked) expect(catalogue).toContain(`"id": "${m.slice(14, -1)}"`);
      }
    }
  });

  it("is idempotent: running the seed a second time adds nothing and keeps an edit", async () => {
    const sql = readFileSync(new URL("../db/migrations/071_blog_samples.sql", import.meta.url), "utf8");
    const before = await getPublishedBySlug(SLUGS[0]);
    await upsertPost({ id: before!.id, title: { RU: "Ренат переписал заголовок", ET: "", EN: "" } });

    await exec(sql);

    const rows = await query<{ n: string | number }>("select count(*) as n from posts");
    expect(Number(rows[0].n), "the seed inserted a second copy").toBe(3);
    const after = await getPostById(before!.id);
    expect(after!.title.RU, "the seed overwrote an edited post").toBe("Ренат переписал заголовок");
  });
});
