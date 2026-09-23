/**
 * One save, every language at once.
 *
 * «Изменения сначала видны по-русски, английский и остальные языки
 * подтягиваются довольно медленно» — Dim, 19.09.2026 (checklist item
 * `blog-cover-frame`). Every public blog answer sits on Vercel's CDN for a
 * minute and then stale for minutes more, one copy per address — so one per
 * language, each on its own clock — and no save ever told any of them. The
 * fix is src/lib/blog-cache.ts: every public answer is filed under one tag,
 * and every write a reader can see drops that tag.
 *
 * So this file pins both halves: that every public blog address, in all three
 * languages, answers under the tag (and is still cached — a reader between
 * saves must not pay for this), and that the panel's writes drop it exactly
 * when the public could see the change. next/cache is mocked — outside a
 * request it has no store to record a purge in.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const nextCache = vi.hoisted(() => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/cache", () => nextCache);

import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { publishPost, upsertPost } from "@/lib/blog";
import { BLOG_CACHE_TAG, refreshBlogCache } from "@/lib/blog-cache";
import { exec } from "@/lib/db";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const LANGS = [["", "RU"], ["et", "ET"], ["en", "EN"]] as const;

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
  process.env.PUBLIC_BASE_URL = ORIGIN;
  await setupDb();
});
afterAll(teardownDb);
beforeEach(async () => {
  resetRateLimits();
  nextCache.revalidateTag.mockReset();
  nextCache.revalidatePath.mockReset();
  // the three sample posts (071_blog_samples.sql) are published — start from none
  await exec("truncate posts restart identity cascade");
});
afterEach(() => vi.restoreAllMocks());

async function livePost() {
  const row = await upsertPost({
    title: { RU: "Уход за бородой зимой", ET: "Habeme talvine hooldus", EN: "Winter beard care" },
    body: { RU: "<p>Текст.</p>", ET: "<p>Tekst.</p>", EN: "<p>Text.</p>" },
    coverUrl: "/shop/img/night-rider-0.webp",
    coverFocus: "fill 50 20",
  });
  return (await publishPost(row.id))!;
}

/** The tags a response is filed under on the CDN. */
const tags = (res: Response) => String(res.headers.get("vercel-cache-tag") || "").split(",").map((t) => t.trim());

describe("every public blog answer, in every language, is filed under the tag a save drops", () => {
  it("the article and the list from the API — all three languages", async () => {
    const post = await livePost();
    const one = await import("@/app/api/blog/[slug]/route");
    const list = await import("@/app/api/blog/route");
    for (const [, code] of LANGS) {
      const a = await one.GET(new Request(`${ORIGIN}/api/blog/${post.slug}/?lang=${code}`), { params: Promise.resolve({ slug: post.slug }) });
      expect(a.status, code).toBe(200);
      expect(tags(a), `article ${code}`).toContain(BLOG_CACHE_TAG);
      // …and still cached between saves: nothing got slower for a reader
      expect(a.headers.get("cache-control"), code).toBe("public, max-age=60, stale-while-revalidate=600");

      const l = await list.GET(new Request(`${ORIGIN}/api/blog/?lang=${code}&page=1`));
      expect(tags(l), `list ${code}`).toContain(BLOG_CACHE_TAG);
      expect(l.headers.get("cache-control"), code).toBe("public, max-age=60, stale-while-revalidate=600");
    }
  });

  it("the article pages and the list pages built at request time — /shop2/, /shop2/et/, /shop2/en/", async () => {
    const post = await livePost();
    const pages = {
      "": [await import("@/app/shop2/blog/[slug]/route"), await import("@/app/shop2/blog/route")],
      et: [await import("@/app/shop2/et/blog/[slug]/route"), await import("@/app/shop2/et/blog/route")],
      en: [await import("@/app/shop2/en/blog/[slug]/route"), await import("@/app/shop2/en/blog/route")],
    } as const;
    for (const [seg] of LANGS) {
      const [article, listing] = pages[seg];
      const a = await article.GET(new Request(`${ORIGIN}/shop2${seg ? "/" + seg : ""}/blog/${post.slug}/`), { params: Promise.resolve({ slug: post.slug }) });
      expect(a.status, seg || "ru").toBe(200);
      expect(tags(a), `article /${seg}`).toContain(BLOG_CACHE_TAG);
      expect(a.headers.get("cache-control"), seg || "ru").toBe("public, s-maxage=60, stale-while-revalidate=300");

      const l = await listing.GET();
      expect(tags(l), `listing /${seg}`).toContain(BLOG_CACHE_TAG);
      expect(l.headers.get("cache-control"), seg || "ru").toBe("public, s-maxage=60, stale-while-revalidate=300");
    }
  });
});

describe("the panel's writes drop the tag — exactly when a reader could see the change", () => {
  const admin = () => `${ADMIN_COOKIE}=${makeSessionToken()}`;
  const send = (method: string, body: unknown) =>
    new Request(`${ORIGIN}/api/admin/blog/`, {
      method, headers: { "content-type": "application/json", cookie: admin() }, body: JSON.stringify(body),
    });
  const dropped = () => nextCache.revalidateTag.mock.calls.filter((c) => c[0] === BLOG_CACHE_TAG).length;

  it("a draft is the panel's business: creating and editing one purges nothing", async () => {
    const { POST, PATCH } = await import("@/app/api/admin/blog/route");
    const created = await POST(send("POST", { title: { RU: "Черновик" } }));
    expect(created.status).toBe(200);
    const draft = (await created.json()).post;
    expect((await PATCH(send("PATCH", { id: draft.id, title: { RU: "Черновик" }, coverFocus: "fill 50 20" }))).status).toBe(200);
    expect(nextCache.revalidateTag).not.toHaveBeenCalled();
  });

  it("publish, an edit of the live article, unpublish and delete each drop it once — every language together", async () => {
    const { POST, PATCH, DELETE } = await import("@/app/api/admin/blog/route");
    const draft = (await (await POST(send("POST", { title: { RU: "Статья" } }))).json()).post;

    expect((await PATCH(send("PATCH", { id: draft.id, publish: true }))).status).toBe(200);
    expect(dropped(), "publish").toBe(1);

    // the checklist's own case: the cover moved in «Заполнить рамку» and saved
    const edited = await PATCH(send("PATCH", { id: draft.id, title: { RU: "Статья" }, coverFocus: "fill 50 80" }));
    expect(edited.status).toBe(200);
    expect((await edited.json()).post.coverFocus).toBe("fill 50 80");
    expect(dropped(), "an edit of a published article").toBe(2);

    expect((await PATCH(send("PATCH", { id: draft.id, publish: false }))).status).toBe(200);
    expect(dropped(), "unpublish").toBe(3);

    expect((await PATCH(send("PATCH", { id: draft.id, publish: true }))).status).toBe(200);
    const gone = await DELETE(new Request(`${ORIGIN}/api/admin/blog/?id=${draft.id}`, { method: "DELETE", headers: { cookie: admin() } }));
    expect(gone.status).toBe(200);
    expect(dropped(), "delete").toBe(5);

    // one tag, never a list of paths: revalidatePath() drops Next's own path
    // tags, which a dynamic route's CDN copy is not filed under (blog-cache.ts)
    expect(nextCache.revalidatePath).not.toHaveBeenCalled();
  });

  it("a refused write purges nothing", async () => {
    const { PATCH } = await import("@/app/api/admin/blog/route");
    expect((await PATCH(send("PATCH", { id: "00000000-0000-0000-0000-000000000000", publish: true }))).status).toBe(404);
    expect((await PATCH(send("PATCH", { title: { RU: "x" } }))).status).toBe(400);
    expect(nextCache.revalidateTag).not.toHaveBeenCalled();
  });

  it("a purge that fails never fails the save — the row is already written", async () => {
    const post = await livePost();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    nextCache.revalidateTag.mockImplementation(() => { throw new Error("CDN unreachable"); });
    const { PATCH } = await import("@/app/api/admin/blog/route");
    const res = await PATCH(send("PATCH", { id: post.id, title: { RU: "Новый заголовок" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).post.title.RU).toBe("Новый заголовок");
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it("outside a request there is nothing to purge, and nothing is said about it", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    nextCache.revalidateTag.mockImplementation(() => {
      throw new Error("Invariant: static generation store missing in revalidateTag blog");
    });
    expect(() => refreshBlogCache()).not.toThrow();
    expect(errors).not.toHaveBeenCalled();
  });
});
