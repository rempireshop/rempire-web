/**
 * Each cover frame its own point and zoom — the parts that need a database
 * and sharp. The vocabulary, the arithmetic, the twin in app.js and the
 * editor's handlers are in tests/blog-cover.test.ts.
 *
 * «Рамки связаны — двигаешь одну, двигаются другие. Их надо двигать и
 * настраивать ОТДЕЛЬНО, и чтобы можно было увеличить» — the owner,
 * 23.09.2026. What is pinned here:
 *
 *   · 205_blog_cover_frames.sql leaves ONE rule on the column, and that rule
 *     takes every framing the panel can write and refuses the rest;
 *   · an article framed before today (one point) reads back as all three
 *     frames on that point at zoom 1, and a save that moves nothing keeps its
 *     bytes; a per-frame framing survives the row, the admin route, the
 *     public API and the save's cache purge;
 *   · the page built at request time wears each frame's own setting — the
 *     article's cover the article's, a tile the list's;
 *   · the social card cuts the square's own point and zoom out of the photo,
 *     to the pixel.
 */
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const nextCache = vi.hoisted(() => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/cache", () => nextCache);

import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { getPostById, publishPost, upsertPost } from "@/lib/blog";
import { BLOG_CACHE_TAG } from "@/lib/blog-cache";
import { coverImgStyle, readCoverFocus, writeCoverFocus } from "@/lib/blog-cover.mjs";
import { exec, query } from "@/lib/db";
import { drawCard, resetCardCache } from "@/lib/og-card";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const LONG = "fill list 50 30 140 post 50 40 100 og 62.5 50 200";

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
  process.env.PUBLIC_BASE_URL = ORIGIN;
  await setupDb();
});
afterAll(teardownDb);
beforeEach(async () => {
  resetRateLimits();
  resetCardCache();
  nextCache.revalidateTag.mockReset();
  // the sample posts (071_blog_samples.sql) are published — start from none
  await exec("truncate posts restart identity cascade");
});

const post = (title: string, coverFocus: unknown) =>
  upsertPost({
    title: { RU: title, ET: title + " ET", EN: title + " EN" },
    body: { RU: "<p>Текст.</p>", ET: "<p>Tekst.</p>", EN: "<p>Text.</p>" },
    coverUrl: "/shop/img/night-rider-0.webp",
    coverFocus,
  });

describe("the column after 205_blog_cover_frames.sql", () => {
  it("carries exactly one rule about cover_focus — the old one is gone, not standing beside the new", async () => {
    const rows = await query<{ conname: string }>(
      `select conname from pg_constraint
        where conrelid = 'posts'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%cover_focus%'`,
    );
    expect(rows.map((r) => r.conname)).toEqual(["posts_cover_focus_check"]);
  });

  it("takes a per-frame framing and every one-point value there already is", async () => {
    for (const v of [LONG, "fit list 0 0 300 post 100 100 100 og 33.3 66.7 150", "fill 62 28", "fit 0 100", "fill 33.3 0.5"]) {
      await query(`insert into posts (slug, title, cover_focus) values ($1, '{"RU":"x"}'::jsonb, $2)`, ["s-" + Math.random().toString(36).slice(2), v]);
    }
    expect((await query<{ n: number }>("select count(*)::int as n from posts"))[0].n).toBe(5);
  });

  it("refuses what no reader could read", async () => {
    for (const bad of ["fill list 50 30 099 post 50 40 100 og 62 50 200", "fill list 50 30 301 post 50 40 100 og 62 50 200",
      "fill 62.25 28", "fill list 50 30 140 post 50 40 100", "zoom 1 2", "fill 101 0"]) {
      await expect(query(`insert into posts (slug, title, cover_focus) values ('bad', '{"RU":"x"}'::jsonb, $1)`, [bad]), bad).rejects.toThrow();
    }
  });
});

describe("the row: a framing goes in and comes out as it was", () => {
  it("an article framed before today reads back as all three frames on its one point, at zoom 1", async () => {
    const p = await post("Старая обложка", "fill 62 28");
    const back = (await getPostById(p.id))!;
    expect(back.coverFocus).toBe("fill 62 28");
    expect(readCoverFocus(back.coverFocus)).toEqual({
      fill: true, list: { x: 62, y: 28, z: 1 }, post: { x: 62, y: 28, z: 1 }, og: { x: 62, y: 28, z: 1 },
    });
    // …and a row written by hand before the panel wrote it for us reads the same way
    await query("update posts set cover_focus = 'fit 10 90' where id = $1", [p.id]);
    expect((await getPostById(p.id))!.coverFocus).toBe("fit 10 90");
  });

  it("each frame's point and zoom survive the round trip", async () => {
    const p = await post("Три рамки", LONG);
    expect((await getPostById(p.id))!.coverFocus).toBe(LONG);
  });

  it("the panel's object is normalised on the way in; frames that agree are stored as one point", async () => {
    const a = await post("Объект", { fill: true, list: { x: 50, y: 30, z: 1.4 }, post: { x: 50, y: 40, z: 1 }, og: { x: 62.5, y: 50, z: 2 } });
    expect(a.coverFocus).toBe(LONG);
    const b = await post("Согласны", "fill list 20 80 100 post 20 80 100 og 20 80 100");
    expect(b.coverFocus).toBe("fill 20 80");
    const c = await post("Мусор", "fill list 50 30 999 post 1 1 100 og 1 1 100");
    expect(c.coverFocus).toBeNull();
  });
});

describe("saving from the panel — the admin route, the public API and the cache purge", () => {
  const admin = () => `${ADMIN_COOKIE}=${makeSessionToken()}`;
  const send = (method: string, body: unknown) =>
    new Request(`${ORIGIN}/api/admin/blog/`, {
      method, headers: { "content-type": "application/json", cookie: admin() }, body: JSON.stringify(body),
    });

  it("a live article saved with its frames apart: stored, served to every language, and every cached copy dropped", async () => {
    const live = (await publishPost((await post("Живая", "fill 50 50")).id))!;
    const { PATCH } = await import("@/app/api/admin/blog/route");
    const res = await PATCH(send("PATCH", { id: live.id, title: { RU: "Живая", ET: "Живая ET", EN: "Живая EN" }, coverFocus: LONG }));
    expect(res.status).toBe(200);
    expect((await res.json()).post.coverFocus).toBe(LONG);
    expect(nextCache.revalidateTag.mock.calls.filter((c) => c[0] === BLOG_CACHE_TAG)).toHaveLength(1);

    const one = await import("@/app/api/blog/[slug]/route");
    const list = await import("@/app/api/blog/route");
    for (const code of ["RU", "ET", "EN"]) {
      const a = await one.GET(new Request(`${ORIGIN}/api/blog/${live.slug}/?lang=${code}`), { params: Promise.resolve({ slug: live.slug }) });
      expect((await a.json()).post.coverFocus, code).toBe(LONG);
      const l = await list.GET(new Request(`${ORIGIN}/api/blog/?lang=${code}&page=1`));
      expect((await l.json()).posts[0].coverFocus, code).toBe(LONG);
    }
  });

  it("an older panel's one point is still taken — every frame on it", async () => {
    const draft = await post("Черновик", null);
    const { PATCH } = await import("@/app/api/admin/blog/route");
    const res = await PATCH(send("PATCH", { id: draft.id, title: { RU: "Черновик" }, coverFocus: "fill 50 20" }));
    expect((await res.json()).post.coverFocus).toBe("fill 50 20");
  });
});

describe("the page built at request time wears each frame's own setting", () => {
  it("the article's cover by the article frame, a tile under it by the list frame", async () => {
    const other = (await publishPost((await post("Другая", "fill list 10 20 250 post 90 80 100 og 50 50 100")).id))!;
    const main = (await publishPost((await post("Главная", LONG)).id))!;
    const { GET } = await import("@/app/shop2/blog/[slug]/route");
    const html = await (await GET(new Request(`${ORIGIN}/shop2/blog/${main.slug}/`), { params: Promise.resolve({ slug: main.slug }) })).text();

    const cover = /<img class="pre__img blog__cover"[^>]*>/.exec(html)?.[0] ?? "";
    expect(cover).toContain(`style="${coverImgStyle(LONG, "post")}"`);
    expect(cover).not.toContain("scale(");

    const tile = new RegExp(`<a class="pre__card blog__tile" href="[^"]*${other.slug}/">(<img[^>]*>)`).exec(html)?.[1] ?? "";
    expect(tile).toContain(`style="${coverImgStyle(other.coverFocus, "list")}"`);
    expect(tile).toContain("transform:scale(2.5);transform-origin:10% 20%");
    // #blogpost carries the whole string, for the SPA that adopts it
    expect(html).toContain(`"coverFocus":"${LONG}"`);
  });
});

describe("the social card cuts the square's own point and zoom", () => {
  /* 1600×800, red, with a green 400×400 block in the top-left corner. The
     square in the panel at x 0, y 0, zoom 2 shows exactly that block; at
     zoom 1 it shows the left 800×800, a quarter of it green. */
  async function photo(): Promise<Buffer> {
    const green = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 0, g: 200, b: 0 } } }).png().toBuffer();
    return sharp({ create: { width: 1600, height: 800, channels: 3, background: { r: 200, g: 0, b: 0 } } })
      .composite([{ input: green, left: 0, top: 0 }]).png().toBuffer();
  }
  async function pixel(png: Buffer, left: number, top: number): Promise<"green" | "red" | "other"> {
    const [r, g] = await sharp(png).extract({ left, top, width: 1, height: 1 }).raw().toBuffer();
    return g > 150 && r < 60 ? "green" : r > 150 && g < 60 ? "red" : "other";
  }
  /* og-card.ts puts the photo in a 518×518 box at (56, 56). */
  const BOX = [[70, 70], [315, 315], [560, 560], [560, 70], [70, 560]] as const;

  it("zoomed 2× into the top-left corner: the whole box is the green block", async () => {
    const png = await drawCard({
      eyebrow: "Blog", title: "Три рамки", foot: "", photo: await photo(), fit: "cover",
      focus: "fill list 90 90 300 post 90 90 300 og 0 0 200",
    });
    for (const [x, y] of BOX) expect(await pixel(png, x, y), `${x},${y}`).toBe("green");
  });

  it("the same corner at zoom 1: the box shows the left square of the photo, a quarter of it green", async () => {
    const png = await drawCard({
      eyebrow: "Blog", title: "Три рамки", foot: "", photo: await photo(), fit: "cover",
      focus: "fill list 0 0 300 post 0 0 300 og 0 0 100",
    });
    expect(await pixel(png, 70, 70)).toBe("green");
    expect(await pixel(png, 560, 560)).toBe("red");
    expect(await pixel(png, 560, 70)).toBe("red");
  });

  it("the other frames' zooms never reach it — the list and the article are the page's business", async () => {
    const a = await drawCard({ eyebrow: "B", title: "T", foot: "", photo: await photo(), fit: "cover", focus: "fill list 0 0 300 post 0 0 300 og 0 0 100" });
    const b = await drawCard({ eyebrow: "B", title: "T", foot: "", photo: await photo(), fit: "cover", focus: writeCoverFocus({ fill: true, x: 0, y: 0 }) });
    expect(a.equals(b)).toBe(true);
  });
});
