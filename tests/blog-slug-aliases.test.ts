/**
 * An article's old address (migration 229_blog_slug_aliases.sql).
 *
 * 09.11.2026, Search Console «Не найдено (404)»: the System 4 article's first
 * address, /ru/blogs/news/system-4-shampoo-guide, still ranked at 3.8 in
 * Google and opened «страница не найдена» — its slug had been changed after
 * it went live. Now a published article that gets a new slug keeps its old
 * one: that address answers 301 to the article in the same language, and no
 * other article can take it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deletePost, getRenamedSlug, publishPost, unpublishPost, upsertPost } from "@/lib/blog";
import { exec, query } from "@/lib/db";
import { setupDb, teardownDb } from "./helpers";

const LIVE = "https://rempireshop.com";

const POST = {
  title: { RU: "Шампуни System 4: какой выбрать", ET: "System 4 šampoonid", EN: "System 4 shampoos" },
  excerpt: { RU: "Четыре шампуня.", ET: "Neli šampooni.", EN: "Four shampoos." },
  body: { RU: "## Кожа головы\n\nТекст.", ET: "## Peanahk\n\nTekst.", EN: "## Scalp\n\nText." },
  tags: ["system 4"],
  products: [],
};

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });

async function postPage(seg: "ru" | "et" | "", slug: string, search = ""): Promise<Response> {
  const mod = seg === "et"
    ? await import("@/app/et/blogs/news/[slug]/route")
    : seg === "ru"
      ? await import("@/app/ru/blogs/news/[slug]/route")
      : await import("@/app/blogs/news/[slug]/route");
  return mod.GET(new Request(`${LIVE}${seg ? "/" + seg : ""}/blogs/news/${slug}${search}`), ctx(slug));
}

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = LIVE;
  await setupDb();
});
afterAll(teardownDb);
beforeEach(async () => {
  process.env.PUBLIC_BASE_URL = LIVE;
  vi.spyOn(console, "error").mockImplementation(() => {});
  await exec("truncate posts, post_slug_aliases, custom_products restart identity cascade");
});
afterEach(() => vi.restoreAllMocks());

describe("a published article that gets a new slug", () => {
  it("answers 301 at its old address, in every language, to its new one — the query rides along", async () => {
    const post = await upsertPost({ ...POST, slug: "system-4-shampoo-guide" });
    await publishPost(post.id);
    const moved = await upsertPost({ ...POST, id: post.id, slug: "shampuni-system-4" });
    expect(moved.slug).toBe("shampuni-system-4");

    for (const [seg, prefix] of [["ru", "/ru"], ["et", "/et"], ["", ""]] as const) {
      const res = await postPage(seg, "system-4-shampoo-guide");
      expect(res.status, seg || "en").toBe(301);
      expect(res.headers.get("location"), seg || "en").toBe(`${prefix}/blogs/news/shampuni-system-4`);
      expect(res.headers.get("vercel-cache-tag")).toBeTruthy();
      expect((await postPage(seg, "shampuni-system-4")).status, seg || "en").toBe(200);
    }
    const utm = await postPage("ru", "system-4-shampoo-guide", "?utm_source=google&x=1");
    expect(utm.headers.get("location")).toBe("/ru/blogs/news/shampuni-system-4?utm_source=google&x=1");
  });

  it("a second rename still lands in one hop; taking an old address back makes it the page again", async () => {
    const post = await upsertPost({ ...POST, slug: "first" });
    await publishPost(post.id);
    await upsertPost({ ...POST, id: post.id, slug: "second" });
    await upsertPost({ ...POST, id: post.id, slug: "third" });
    expect((await postPage("ru", "first")).headers.get("location")).toBe("/ru/blogs/news/third");
    expect((await postPage("ru", "second")).headers.get("location")).toBe("/ru/blogs/news/third");

    const back = await upsertPost({ ...POST, id: post.id, slug: "first" });
    expect(back.slug).toBe("first");
    expect((await postPage("ru", "first")).status).toBe(200);
    expect((await postPage("ru", "third")).headers.get("location")).toBe("/ru/blogs/news/first");
    const rows = await query<{ slug: string }>("select slug from post_slug_aliases order by slug");
    expect(rows.map((r) => r.slug)).toEqual(["second", "third"]);
  });

  it("a save that keeps the slug records nothing", async () => {
    const post = await upsertPost({ ...POST, slug: "same" });
    await publishPost(post.id);
    await upsertPost({ ...POST, id: post.id, title: { ...POST.title, RU: "Новый заголовок" } });
    expect(await query("select 1 from post_slug_aliases")).toHaveLength(0);
  });

  it("keeps its old address taken: a new article with that title becomes «…-2»", async () => {
    const post = await upsertPost({ ...POST, slug: "beard-winter" });
    await publishPost(post.id);
    await upsertPost({ ...POST, id: post.id, slug: "beard-oil" });
    const other = await upsertPost({ ...POST, slug: "beard-winter" });
    expect(other.slug).toBe("beard-winter-2");
  });
});

describe("what stays a 404", () => {
  it("a draft that was never published records no old address", async () => {
    const draft = await upsertPost({ ...POST, slug: "draft-one" });
    await upsertPost({ ...POST, id: draft.id, slug: "draft-two" });
    await publishPost(draft.id);
    expect((await postPage("ru", "draft-one")).status).toBe(404);
    expect((await postPage("ru", "draft-two")).status).toBe(200);
  });

  it("an old address of an article that is unpublished or deleted", async () => {
    const post = await upsertPost({ ...POST, slug: "old" });
    await publishPost(post.id);
    await upsertPost({ ...POST, id: post.id, slug: "new" });
    expect((await postPage("et", "old")).status).toBe(301);

    await unpublishPost(post.id);
    const off = await postPage("et", "old");
    expect(off.status).toBe(404);
    expect(await off.text()).toContain('<meta name="robots" content="noindex, nofollow">');

    await publishPost(post.id);
    expect((await postPage("et", "old")).status).toBe(301);
    await deletePost(post.id);
    expect((await postPage("et", "old")).status).toBe(404);
  });

  it("a live article always wins over an old address with the same slug", async () => {
    const a = await upsertPost({ ...POST, slug: "shared" });
    await publishPost(a.id);
    await upsertPost({ ...POST, id: a.id, slug: "a-now" });
    /* By hand, the way 229's own rows could meet a live article: the slug of
       one article and the old address of another. */
    const b = await upsertPost({ ...POST, slug: "b-live" });
    await publishPost(b.id);
    await query("update posts set slug = 'shared' where id = $1", [b.id]);
    expect((await postPage("ru", "shared")).status).toBe(200);
    expect(await getRenamedSlug("shared")).toBe("a-now");
  });
});

describe("a deploy whose migration 229 has not run yet", () => {
  it("still saves and renames an article, and an unknown address is still a 404 with noindex", async () => {
    const post = await upsertPost({ ...POST, slug: "before" });
    await publishPost(post.id);
    await exec("alter table post_slug_aliases rename to post_slug_aliases_away");
    try {
      const moved = await upsertPost({ ...POST, id: post.id, slug: "after" });
      expect(moved.slug).toBe("after");
      const fresh = await upsertPost({ ...POST, slug: "another" });
      expect(fresh.slug).toBe("another");
      const res = await postPage("ru", "before");
      expect(res.status).toBe(404);
      expect(await res.text()).toContain('<meta name="robots" content="noindex, nofollow">');
      expect((await postPage("ru", "after")).status).toBe(200);
    } finally {
      await exec("alter table post_slug_aliases_away rename to post_slug_aliases");
    }
  });
});

describe("229's own rows — the addresses Search Console showed on 09.11.2026", () => {
  const sql = readFileSync(fileURLToPath(new URL("../db/migrations/229_blog_slug_aliases.sql", import.meta.url)), "utf8");
  const seed = sql.slice(sql.indexOf("insert into post_slug_aliases"));

  it("point each old address at the live article, and skip a target the database does not have", async () => {
    const s4 = await upsertPost({ ...POST, slug: "shampuni-system-4-o1-o2-o3-o4-kakoy-vybrat-i-kak-uhazhivat-za-kozhey-golovy" });
    await publishPost(s4.id);
    const toner = await upsertPost({ ...POST, slug: "aha-bha-toner-cosrx-ili-anua-kak-vybrat-i-polzovatsya" });
    await publishPost(toner.id);
    await exec(seed);
    await exec(seed); // a second run changes nothing

    const rows = await query<{ slug: string }>("select slug from post_slug_aliases order by slug");
    expect(rows.map((r) => r.slug)).toEqual(["aha-bha-toner", "kak-vybrat-shampun-po-tipu-kozhi-golovy", "system-4-shampoo-guide"]);
    expect((await postPage("ru", "system-4-shampoo-guide")).headers.get("location")).toBe(
      "/ru/blogs/news/shampuni-system-4-o1-o2-o3-o4-kakoy-vybrat-i-kak-uhazhivat-za-kozhey-golovy",
    );
    expect((await postPage("", "aha-bha-toner")).headers.get("location")).toBe(
      "/blogs/news/aha-bha-toner-cosrx-ili-anua-kak-vybrat-i-polzovatsya",
    );
    expect((await postPage("et", "uhod-za-borodoy-zimoy")).status).toBe(404);
  });
});
