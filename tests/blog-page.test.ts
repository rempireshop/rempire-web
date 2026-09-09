/**
 * A blog post published after the last build, everywhere the static
 * prerender used to be the only source:
 *
 *   · its page at request time — src/lib/blog-page.ts behind
 *     src/app/shop2/{,et/,en/}blog/[slug]/route.ts — carries the head the
 *     prerender writes (per-language Google pair with the Russian fallback,
 *     canonical, hreflang, OpenGraph with the card /shop2/og/blog-<slug>…png,
 *     BlogPosting JSON-LD), the article inside #prerender and the #blogpost /
 *     #blogdata snapshots hydrateBlog() paints from; a draft → 404 and noindex;
 *   · the listing at request time when the build wrote none;
 *   · the sitemap the app serves (src/app/sitemap-custom.xml/route.ts) names
 *     the posts the build did not, in three languages, and not the drafts.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { publishPost, upsertPost } from "@/lib/blog";
import { postsNotPrerendered } from "@/lib/blog-page";
import { createCustomProduct } from "@/lib/custom-products";
import { exec } from "@/lib/db";
import { setupDb, teardownDb } from "./helpers";

const LIVE = "https://rempireshop.com";
const STAGING = "https://rempireshop.diipsolutions.eu";

const POST = {
  title: { RU: "Как ухаживать за бородой зимой", ET: "Kuidas hooldada habet talvel", EN: "" },
  excerpt: { RU: "Три привычки на холодный сезон.", ET: "Kolm harjumust külmaks hooajaks." },
  body: { RU: "## Зима\n\nМасло **каждый день**.", ET: "## Talv\n\nÕli **iga päev**." },
  seoTitle: { RU: "Уход за бородой зимой: три привычки", ET: "Habeme talvine hooldus: kolm harjumust" },
  seoDesc: { RU: "Мороз сушит бороду — три привычки против этого.", ET: "Külm kuivatab habet — kolm harjumust selle vastu." },
  coverUrl: "/shop/img/night-rider-0.webp",
  coverAlt: { RU: "Паста", ET: "Pasta" },
  tags: ["борода", "зима"],
  products: ["system-4-bio-botanical-shampoo", "no-such-product"],
};

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });

async function postPage(seg: "" | "et" | "en", slug: string): Promise<Response> {
  const mod = seg === "et"
    ? await import("@/app/shop2/et/blog/[slug]/route")
    : seg === "en"
      ? await import("@/app/shop2/en/blog/[slug]/route")
      : await import("@/app/shop2/blog/[slug]/route");
  return mod.GET(new Request(`${LIVE}/shop2${seg ? "/" + seg : ""}/blog/${slug}/`), ctx(slug));
}
async function listPage(seg: "" | "et" | "en"): Promise<Response> {
  const mod = seg === "et"
    ? await import("@/app/shop2/et/blog/route")
    : seg === "en"
      ? await import("@/app/shop2/en/blog/route")
      : await import("@/app/shop2/blog/route");
  return mod.GET();
}

const title = (html: string) => (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] ?? "";
const meta = (html: string, key: string) =>
  (html.match(new RegExp(`<meta (?:name|property)="${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" content="([^"]*)"`)) || [])[1] ?? "";
const link = (html: string, attrs: string) => (html.match(new RegExp(`<link ${attrs}[^>]*href="([^"]*)"`)) || [])[1] ?? "";
function ldBlocks(html: string): Array<Record<string, unknown>> {
  return [...html.matchAll(/<script type="application\/ld\+json"([^>]*)>([\s\S]*?)<\/script>/g)].map((m) => ({
    attrs: m[1],
    ...(JSON.parse(m[2]) as Record<string, unknown>),
  }));
}
function jsonScript(html: string, id: string): Record<string, unknown> | null {
  const m = html.match(new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`));
  return m ? (JSON.parse(m[1]) as Record<string, unknown>) : null;
}

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = LIVE;
  await setupDb();
});
afterAll(teardownDb);
beforeEach(async () => {
  process.env.PUBLIC_BASE_URL = LIVE;
  vi.spyOn(console, "error").mockImplementation(() => {});
  // the three sample posts (071_blog_samples.sql) would be «published after the build» here too
  await exec("truncate posts, custom_products restart identity cascade");
});
afterEach(() => vi.restoreAllMocks());

describe("a post's page at request time", () => {
  it("ET: the head the prerender writes, from the row — the Estonian pair, the card, the article, the snapshots", async () => {
    const wax = await createCustomProduct({ brand: "Acme", name: "Wax", cat: "styling", sizes: ["50 мл", "100 мл"], prices: [9, 15] });
    const draftRow = await upsertPost({ ...POST, products: [...POST.products, wax.id] });
    // publishing bumps updated_at — the row as it is served is the one the stamps come from
    const post = (await publishPost(draftRow.id))!;
    const other = await upsertPost({ title: { RU: "Другая статья" } });
    await publishPost(other.id);
    const draft = await upsertPost({ title: { RU: "Черновик" } });
    void draft;

    const res = await postPage("et", post.slug);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("public, s-maxage=60, stale-while-revalidate=300");
    const html = await res.text();

    expect(html).toMatch(/^<!doctype html>\n<html lang="et">/);
    expect(title(html)).toBe("Habeme talvine hooldus: kolm harjumust — REMPIRE");
    expect(meta(html, "description")).toBe("Külm kuivatab habet — kolm harjumust selle vastu.");
    expect(meta(html, "robots")).toBe("index, follow, max-image-preview:large");
    expect(link(html, 'rel="canonical"')).toBe(`${LIVE}/shop2/et/blog/${post.slug}/`);
    expect(link(html, 'rel="alternate" hreflang="ru"')).toBe(`${LIVE}/shop2/blog/${post.slug}/`);
    expect(link(html, 'rel="alternate" hreflang="et"')).toBe(`${LIVE}/shop2/et/blog/${post.slug}/`);
    expect(link(html, 'rel="alternate" hreflang="en"')).toBe(`${LIVE}/shop2/en/blog/${post.slug}/`);
    expect(link(html, 'rel="alternate" hreflang="x-default"')).toBe(`${LIVE}/shop2/blog/${post.slug}/`);
    expect(meta(html, "og:type")).toBe("article");
    expect(meta(html, "og:locale")).toBe("et_EE");
    expect(meta(html, "og:title")).toBe(title(html));
    const stamp = Date.parse(post.updatedAt).toString(36);
    expect(meta(html, "og:image")).toBe(`${LIVE}/shop2/og/blog-${post.slug}.et.png?v=${stamp}`);
    expect(meta(html, "og:image:type")).toBe("image/png");
    expect(meta(html, "twitter:card")).toBe("summary_large_image");

    const ld = ldBlocks(html);
    const article = ld.find((o) => o["@type"] === "BlogPosting") as Record<string, unknown> & { author: { name: string }; mainEntityOfPage: { "@id": string } };
    expect(article).toBeTruthy();
    expect(article.attrs).toContain('data-seo="ldjson-page"');
    expect(article.headline).toBe("Kuidas hooldada habet talvel");
    expect(article.url).toBe(`${LIVE}/shop2/et/blog/${post.slug}/`);
    expect(article.mainEntityOfPage["@id"]).toBe(`${LIVE}/shop2/et/blog/${post.slug}/`);
    expect(article.image).toEqual([meta(html, "og:image")]);
    expect(article.datePublished).toBeTruthy();
    expect(article.description).toBe(meta(html, "description"));
    const crumbs = ld.find((o) => o["@type"] === "BreadcrumbList") as Record<string, unknown> & { itemListElement: Array<{ name: string; item?: string }> };
    // ET says «Blogi» — the owner's own word, settled 07.09.2026 (src/lib/seo-head.mjs T.ET.blog)
    expect(crumbs.itemListElement.map((i) => i.name)).toEqual(["Avaleht", "Blogi", "Kuidas hooldada habet talvel"]);
    expect(crumbs.itemListElement[1].item).toBe(`${LIVE}/shop2/et/blog/`);
    expect(html).not.toContain('id="ldjson"');

    // the article itself, for a crawler that reads the body
    expect(html).toContain('<div id="prerender">');
    expect(html).toContain('<h1 class="display h1">Kuidas hooldada habet talvel</h1>');
    expect(html).toContain('<img class="pre__img blog__cover" src="/shop/img/night-rider-0.webp" alt="Pasta"');
    expect(html).toContain("<h2>Talv</h2><p>Õli <strong>iga päev</strong>.</p>");
    expect(html).toContain("<li>борода</li><li>зима</li>");
    // «Tooted artiklist»: the catalogue product and the owner's own, never an id nobody has
    expect(html).toContain('<h2 class="display h1 blog__h2">Tooted artiklist</h2>');
    expect(html).toContain('href="/shop2/et/p/system-4-bio-botanical-shampoo/"');
    expect(html).toContain(`href="/shop2/et/p/${wax.id}/"`);
    expect(html).toContain('<span class="pre__nm">Wax</span><span class="pre__pr num">alates 9 €</span>');
    expect(html).not.toContain('href="/shop2/et/p/no-such-product/"');
    // «Teised artiklid», and the three-language nav
    expect(html).toContain('<h2 class="display h1 blog__h2">Teised artiklid</h2>');
    expect(html).toContain(`href="/shop2/et/blog/${other.slug}/"`);
    expect(html).not.toContain(draft.slug);
    expect(html).toContain(`<a href="/shop2/en/blog/${post.slug}/" hreflang="en">EN</a>`);

    // the snapshots app.js adopts before its first paint — the API's own shapes
    const snap = jsonScript(html, "blogpost") as { lang: string; stamp: number; post: Record<string, unknown> };
    expect(snap.lang).toBe("ET");
    expect(snap.stamp).toBe(Date.parse(post.updatedAt));
    expect(snap.post).toMatchObject({
      slug: post.slug, title: "Kuidas hooldada habet talvel", excerpt: "Kolm harjumust külmaks hooajaks.",
      bodyHtml: "<h2>Talv</h2><p>Õli <strong>iga päev</strong>.</p>", coverUrl: "/shop/img/night-rider-0.webp",
      seoTitle: "Habeme talvine hooldus: kolm harjumust", author: "Rempire",
    });
    const list = jsonScript(html, "blogdata") as { lang: string; posts: Array<{ slug: string }>; total: number };
    expect(list.lang).toBe("ET");
    expect(list.total).toBe(2);
    expect(list.posts.map((p) => p.slug).sort()).toEqual([other.slug, post.slug].sort());
    // the shell's own assets travel unchanged
    expect(html).toContain('<script src="/shop2/app.min.js?v=');
  });

  it("EN with no English pair: the Russian pair; no pair at all: the title and the excerpt; no excerpt: the text", async () => {
    const post = await upsertPost(POST);
    await publishPost(post.id);
    let html = await (await postPage("en", post.slug)).text();
    expect(html).toMatch(/^<!doctype html>\n<html lang="en">/);
    expect(title(html)).toBe("Уход за бородой зимой: три привычки — REMPIRE");
    expect(meta(html, "description")).toBe("Мороз сушит бороду — три привычки против этого.");
    expect(meta(html, "og:locale")).toBe("en_US");
    expect(meta(html, "og:image")).toContain(`/shop2/og/blog-${post.slug}.en.png?v=`);
    expect(html).toContain('<h2 class="display h1 blog__h2">Products from this article</h2>');

    const plain = await upsertPost({ title: { RU: "Паста, воск или глина" }, excerpt: { RU: "Три банки, три разных укладки." }, body: { RU: "Текст статьи." } });
    await publishPost(plain.id);
    html = await (await postPage("", plain.slug)).text();
    expect(title(html)).toBe("Паста, воск или глина — REMPIRE");
    expect(meta(html, "description")).toBe("Три банки, три разных укладки.");
    expect(meta(html, "og:image")).toContain(`/shop2/og/blog-${plain.slug}.png?v=`);

    const bare = await upsertPost({ title: { RU: "Только текст" }, body: { RU: "Первый абзац статьи.\n\nВторой." } });
    await publishPost(bare.id);
    html = await (await postPage("", bare.slug)).text();
    expect(meta(html, "description")).toBe("Первый абзац статьи. Второй.");
  });

  it("a staging base writes noindex and its own absolute URLs", async () => {
    process.env.PUBLIC_BASE_URL = STAGING;
    const post = await upsertPost(POST);
    await publishPost(post.id);
    const html = await (await postPage("et", post.slug)).text();
    expect(meta(html, "robots")).toBe("noindex, nofollow");
    expect(link(html, 'rel="canonical"')).toBe(`${STAGING}/shop2/et/blog/${post.slug}/`);
    expect(meta(html, "og:image")).toContain(`${STAGING}/shop2/og/blog-${post.slug}.et.png`);
  });

  it("a draft, an unpublished post and a slug nobody has → 404 with the noindex shell", async () => {
    const post = await upsertPost(POST);
    for (const seg of ["", "et", "en"] as const) {
      const res = await postPage(seg, post.slug);
      expect(res.status, seg || "ru").toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const html = await res.text();
      expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
      expect(html).toContain('<div id="app">');
      expect(html).not.toContain(post.slug);
    }
    await publishPost(post.id);
    expect((await postPage("et", post.slug)).status).toBe(200);
    const { unpublishPost } = await import("@/lib/blog");
    await unpublishPost(post.id);
    expect((await postPage("et", post.slug)).status).toBe(404);
    expect((await postPage("", "no-such-post")).status).toBe(404);
    expect((await postPage("", "x".repeat(200))).status).toBe(404);
  });
});

describe("the listing at request time", () => {
  it("lists the published posts with the head, the ItemList and the #blogdata snapshot; says so when there are none", async () => {
    const empty = await (await listPage("et")).text();
    expect(title(empty)).toBe("Blogi — REMPIRE");
    expect(empty).toContain('<p class="muted">Artikleid veel pole — vaata varsti uuesti.</p>');
    expect(empty).not.toContain('id="blogdata"');

    const post = await upsertPost(POST);
    await publishPost(post.id);
    await upsertPost({ title: { RU: "Черновик" } });
    const res = await listPage("et");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/^<!doctype html>\n<html lang="et">/);
    expect(link(html, 'rel="canonical"')).toBe(`${LIVE}/shop2/et/blog/`);
    expect(meta(html, "og:type")).toBe("website");
    expect(meta(html, "og:image")).toContain(`/shop2/og/blog-${post.slug}.et.png?v=`);
    expect(html).toContain('<h1 class="display h1">Blogi</h1>');
    expect(html).toContain(`<li><a class="pre__card blog__tile" href="/shop2/et/blog/${post.slug}/">`);
    expect(html).toContain('<span class="pre__nm">Kuidas hooldada habet talvel</span>');
    expect(html).not.toContain("chernovik");
    const ld = ldBlocks(html);
    const items = ld.find((o) => o["@type"] === "ItemList") as Record<string, unknown> & { itemListElement: Array<{ url: string; name: string }> };
    expect(items.numberOfItems).toBe(1);
    expect(items.itemListElement[0]).toMatchObject({ url: `${LIVE}/shop2/et/blog/${post.slug}/`, name: "Kuidas hooldada habet talvel" });
    const list = jsonScript(html, "blogdata") as { lang: string; posts: Array<{ slug: string; title: string }> };
    expect(list).toMatchObject({ lang: "ET", posts: [{ slug: post.slug, title: "Kuidas hooldada habet talvel" }] });
  });
});

describe("sitemap-custom.xml and the posts the build did not write", () => {
  it("names a published post in three languages, with the listing, and leaves the drafts out", async () => {
    const post = await upsertPost(POST);
    await publishPost(post.id);
    await upsertPost({ title: { RU: "Черновик" } });
    const { GET } = await import("@/app/sitemap-custom.xml/route");
    const xml = await (await GET()).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      `${LIVE}/shop2/blog/`, `${LIVE}/shop2/blog/${post.slug}/`,
      `${LIVE}/shop2/et/blog/`, `${LIVE}/shop2/et/blog/${post.slug}/`,
      `${LIVE}/shop2/en/blog/`, `${LIVE}/shop2/en/blog/${post.slug}/`,
    ]);
    expect(xml).toContain(`<lastmod>${post.updatedAt.slice(0, 10)}</lastmod>`);
    expect(xml).toContain("<priority>0.6</priority>");
    expect(xml).not.toContain("chernovik");
    expect((xml.match(/<xhtml:link/g) || []).length).toBe(24);
  });

  it("postsNotPrerendered() drops exactly the slugs the build recorded", () => {
    const posts = [{ slug: "a" }, { slug: "b" }, { slug: "c" }];
    expect(postsNotPrerendered(posts, ["a", "c"])).toEqual([{ slug: "b" }]);
    expect(postsNotPrerendered(posts, [])).toEqual(posts);
    expect(postsNotPrerendered([], ["a"])).toEqual([]);
  });
});
