/**
 * POST/DELETE /api/admin/upload — the same handlers Next calls, driven with
 * plain Requests. sharp really runs (the pictures are generated here); only
 * the bucket is a stub, so nothing leaves the machine.
 */
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { sniffImage } from "@/lib/images";
import { query } from "@/lib/db";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const R2_ENV = {
  R2_ACCOUNT_ID: "acc123",
  R2_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  R2_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  R2_BUCKET: "rempire-media",
  R2_PUBLIC_BASE: "https://media.rempireshop.com",
};

let admin = "";

function setStorage(on: boolean) {
  for (const [k, v] of Object.entries(R2_ENV)) {
    if (on) process.env[k] = v;
    else delete process.env[k];
  }
}

/** Records every PUT/DELETE the route makes to the bucket. */
function stubBucket(status = 200) {
  const calls: { url: string; method: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init: unknown) => {
      const method = ((init as RequestInit | undefined)?.method || "GET").toUpperCase();
      calls.push({ url: String(url), method });
      return new Response(status === 204 ? null : "", { status });
    }),
  );
  return calls;
}

function upload(file: Buffer, name: string, fields: Record<string, string> = {}, cookie = admin) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(file)], name));
  for (const [k, v] of Object.entries({ kind: "product", productId: "touchable", ...fields })) {
    form.append(k, v);
  }
  const headers: Record<string, string> = { "x-forwarded-for": "203.0.113.9" };
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}/api/admin/upload/`, { method: "POST", body: form, headers });
}

/** An ISO base media file header — `isom`/`mp42`/… is MP4, `qt  ` QuickTime. */
const mp4 = (brand: string) =>
  Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftyp"), Buffer.from(brand), Buffer.alloc(64, 0)]);

const png = (w: number, h: number, alpha = true) =>
  sharp({ create: { width: w, height: h, channels: alpha ? 4 : 3, background: { r: 210, g: 40, b: 40, alpha: 0.6 } } })
    .png()
    .toBuffer();

describe("admin upload", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    resetRateLimits();
    setStorage(true);
    await truncateAll();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setStorage(false);
  });

  /* ---------- the guard ---------------------------------------------------- */

  it("turns away anyone without the admin cookie", async () => {
    const { POST, DELETE, GET } = await import("@/app/api/admin/upload/route");
    stubBucket();
    const body = await png(20, 20);
    expect((await POST(upload(body, "a.png", {}, ""))).status).toBe(401);
    expect(
      (await DELETE(new Request(`${ORIGIN}/api/admin/upload/?key=hero/1-a.webp`, { method: "DELETE" }))).status,
    ).toBe(401);
    expect((await GET(new Request(`${ORIGIN}/api/admin/upload/`))).status).toBe(401);
  });

  it("says the storage is not configured instead of failing obscurely", async () => {
    setStorage(false);
    const { POST, GET } = await import("@/app/api/admin/upload/route");
    const res = await POST(upload(await png(20, 20), "a.png"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "storage_not_configured" });

    const probe = await GET(new Request(`${ORIGIN}/api/admin/upload/`, { headers: { cookie: admin } }));
    expect(await probe.json()).toMatchObject({ ok: true, configured: false });
  });

  /* ---------- what it refuses ---------------------------------------------- */

  it("refuses a file over 12 MB before reading it", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    const calls = stubBucket();
    const res = await POST(upload(Buffer.alloc(13 * 1024 * 1024, 1), "huge.jpg"));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "too_large" });
    expect(calls).toHaveLength(0);
  });

  it("refuses anything that is not a picture, whatever it is called", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    stubBucket();
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 0x20)]);
    const res = await POST(upload(pdf, "photo.jpg")); // .jpg is a lie
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: "bad_type" });
  });

  it("names HEIC as the reason rather than «bad file»", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    stubBucket();
    // ftyp box with the heic brand — what an iPhone writes
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 0x18]),
      Buffer.from("ftypheic"),
      Buffer.alloc(32, 0),
    ]);
    expect(sniffImage(heic)).toBe("image/heic");
    const res = await POST(upload(heic, "IMG_0421.HEIC"));
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ error: "heic_unsupported" });
  });

  it("checks the kind and the owner id", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    stubBucket();
    const body = await png(20, 20);
    expect(await (await POST(upload(body, "a.png", { kind: "banner" }))).json()).toMatchObject({ error: "bad_kind" });
    expect(await (await POST(upload(body, "a.png", { productId: "" }))).json()).toMatchObject({ error: "bad_product" });
    expect(await (await POST(upload(body, "a.png", { kind: "review", productId: "" }))).json()).toMatchObject({
      error: "bad_review",
    });
  });

  // blog: a cover is uploaded before there is a post row to attach it to —
  // same as kind=hero, no productId/reviewId required.
  it("accepts kind=blog with no owner id and keys it under blog/", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    stubBucket();
    const res = await POST(upload(await png(40, 40), "Cover Shot.png", { kind: "blog", productId: "" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.key).toMatch(/^blog\/\d{13}-cover-shot\.webp$/);
    expect(body.url).toBe(`${R2_ENV.R2_PUBLIC_BASE}/${body.key}`);
  });

  it("stops after 60 uploads an hour", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    stubBucket();
    const tiny = await png(8, 8);
    for (let i = 0; i < 60; i++) {
      const res = await POST(upload(tiny, `a${i}.png`));
      expect(res.status).toBe(200);
    }
    const over = await POST(upload(tiny, "a61.png"));
    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ error: "rate_limited" });
  });

  /* ---------- the happy path ----------------------------------------------- */

  it("stores the photo and its thumbnail, and answers with both URLs", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    const calls = stubBucket();
    const res = await POST(upload(await png(2400, 1200), "Front Shot.png"));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.key).toMatch(/^products\/touchable\/\d{13}-front-shot\.webp$/);
    expect(body.url).toBe(`${R2_ENV.R2_PUBLIC_BASE}/${body.key}`);
    expect(body.thumbUrl).toBe(`${R2_ENV.R2_PUBLIC_BASE}/${body.key.replace(".webp", "-thumb.webp")}`);
    // 2400×1200 fits inside 1600 on its long side
    expect(body.width).toBe(1600);
    expect(body.height).toBe(800);
    expect(body.bytes).toBeGreaterThan(0);

    expect(calls.map((c) => c.method)).toEqual(["PUT", "PUT"]);
    expect(calls[0].url).toContain(`/rempire-media/${body.key}`);
    expect(calls[1].url).toContain("-thumb.webp");

    const audit = await query<{ action: string; payload: { key: string; kind: string } }>(
      "select action, payload from admin_audit order by id desc limit 1",
    );
    expect(audit[0].action).toBe("media.upload");
    expect(audit[0].payload.kind).toBe("product");
    expect(audit[0].payload.key).toBe(body.key);
  });

  it("never enlarges a small photo, and keeps its transparency", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    stubBucket();
    const res = await POST(upload(await png(300, 200, true), "cutout.png"));
    const body = await res.json();
    expect(body.width).toBe(300);
    expect(body.height).toBe(200);
  });

  it("puts the banner picture under hero/ with no product id", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    stubBucket();
    const res = await POST(upload(await png(1200, 600, false), "banner.png", { kind: "hero", productId: "" }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.key).toMatch(/^hero\/\d{13}-banner\.webp$/);
  });

  /* ---------- media: video ------------------------------------------------- */

  it("stores an MP4 under videos/ with its real content type and no thumbnail", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    const calls = stubBucket();
    const res = await POST(upload(mp4("isom"), "Reel Clip.MP4", { kind: "video" }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.key).toMatch(/^videos\/touchable\/\d{13}-reel-clip\.mp4$/);
    expect(body.url).toBe(`${R2_ENV.R2_PUBLIC_BASE}/${body.key}`);
    expect(body.contentType).toBe("video/mp4");
    expect(body.bytes).toBeGreaterThan(0);
    // one object, not two: a video has no thumbnail to make
    expect(calls.map((c) => c.method)).toEqual(["PUT"]);
    expect(body.thumbUrl).toBeUndefined();

    const audit = await query<{ action: string; payload: { key: string; kind: string } }>(
      "select action, payload from admin_audit order by id desc limit 1",
    );
    expect(audit[0].action).toBe("media.upload");
    expect(audit[0].payload.kind).toBe("video");
  });

  it("keeps a QuickTime file as .mov — an iPhone records those", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    stubBucket();
    const res = await POST(upload(mp4("qt  "), "IMG_0421.mov", { kind: "video" }));
    const body = await res.json();
    expect(body.key).toMatch(/\.mov$/);
    expect(body.contentType).toBe("video/quicktime");
  });

  /* The gate this whole branch exists for: the type is decided by the bytes,
     not by the extension and not by the Content-Type the browser attached. */
  it("refuses anything that is not an MP4 or a MOV, whatever it is called", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    const calls = stubBucket();
    for (const [name, bytes] of [
      ["clip.mp4", Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 0x20)])],
      ["clip.mp4", await png(20, 20)],                       // a real picture with a video name
      ["clip.mp4", mp4("heic")],                             // a container we do not accept
      ["clip.mp4", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(32, 0)])], // an AVI/WebM-ish header
    ] as Array<[string, Buffer]>) {
      const res = await POST(upload(bytes, name, { kind: "video" }));
      expect(res.status, name).toBe(415);
      expect(await res.json()).toMatchObject({ ok: false, error: "bad_video_type" });
    }
    expect(calls, "a refused video still reached the bucket").toHaveLength(0);
  });

  it("takes a video up to 60 MB where a photo stops at 12", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    stubBucket();
    // 20 MB: too big for a photo, fine for a video
    const big = Buffer.concat([mp4("isom"), Buffer.alloc(20 * 1024 * 1024, 0)]);
    expect((await POST(upload(big, "a.png"))).status).toBe(413);
    expect((await POST(upload(big, "a.mp4", { kind: "video" }))).status).toBe(200);

    const over = await POST(upload(Buffer.alloc(61 * 1024 * 1024, 1), "huge.mp4", { kind: "video" }));
    expect(over.status).toBe(413);
    expect(await over.json()).toMatchObject({ error: "too_large" });
  });

  it("needs a product id for a video, and says so once storage is missing", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    stubBucket();
    expect(await (await POST(upload(mp4("isom"), "a.mp4", { kind: "video", productId: "" }))).json()).toMatchObject({
      error: "bad_product",
    });
    setStorage(false);
    const res = await POST(upload(mp4("isom"), "a.mp4", { kind: "video" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "storage_not_configured" });
  });

  it("tells the panel both limits so it can name the right one", async () => {
    const { GET } = await import("@/app/api/admin/upload/route");
    const probe = await GET(new Request(`${ORIGIN}/api/admin/upload/`, { headers: { cookie: admin } }));
    expect(await probe.json()).toMatchObject({
      ok: true,
      configured: true,
      maxBytes: 12 * 1024 * 1024,
      maxVideoBytes: 60 * 1024 * 1024,
    });
  });

  /* ---------- delete ------------------------------------------------------- */

  it("deletes a key of ours, with its thumbnail, and refuses anything else", async () => {
    const { DELETE } = await import("@/app/api/admin/upload/route");
    const calls = stubBucket(204);
    const del = (key: string) =>
      new Request(`${ORIGIN}/api/admin/upload/?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers: { cookie: admin },
      });

    const ok = await DELETE(del("products/touchable/1756900000000-a.webp"));
    expect(ok.status).toBe(200);
    expect(calls.map((c) => c.method)).toEqual(["DELETE", "DELETE"]);
    expect(calls[1].url).toContain("-thumb.webp");

    for (const bad of ["../package.json", "secrets/a.webp", "/etc/passwd", ""]) {
      const res = await DELETE(del(bad));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: "bad_key" });
    }

    const audit = await query<{ action: string }>("select action from admin_audit where action = 'media.delete'");
    expect(audit).toHaveLength(1);
  });
});

/**
 * Where an uploaded photo ends up: product_overrides.gallery, through the two
 * override routes the storefront actually talks to.
 */
describe("product gallery override", () => {
  const PHOTO = {
    url: "https://media.rempireshop.com/products/touchable/1756900000000-a.webp",
    thumb: "https://media.rempireshop.com/products/touchable/1756900000000-a-thumb.webp",
    alt: "Kevin.Murphy Touchable",
  };

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    resetRateLimits();
    await truncateAll();
  });

  const put = (body: unknown) =>
    new Request(`${ORIGIN}/api/admin/overrides/`, {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: admin },
      body: JSON.stringify(body),
    });

  it("saves a gallery and hands it to the storefront", async () => {
    const admin_overrides = await import("@/app/api/admin/overrides/route");
    const res = await admin_overrides.PUT(put({ id: "touchable", gallery: [PHOTO] }));
    expect(res.status).toBe(200);
    expect((await res.json()).overrides.touchable.gallery).toEqual([PHOTO]);

    const publicRoute = await import("@/app/api/overrides/route");
    const body = await (await publicRoute.GET()).json();
    expect(body.overrides.touchable.gallery).toEqual([PHOTO]);
  });

  it("drops entries that are not usable as an image source", async () => {
    const admin_overrides = await import("@/app/api/admin/overrides/route");
    const res = await admin_overrides.PUT(
      put({
        id: "touchable",
        gallery: [
          PHOTO,
          { url: "javascript:alert(1)" },
          { url: "  " },
          { url: "/shop/img/local-0.webp" }, // a catalogue photo is fine
          "not an object",
        ],
      }),
    );
    const saved = (await res.json()).overrides.touchable.gallery;
    expect(saved).toHaveLength(2);
    expect(saved[1]).toEqual({ url: "/shop/img/local-0.webp", thumb: "/shop/img/local-0.webp", alt: "" });
  });

  it("keeps at most a dozen photos", async () => {
    const admin_overrides = await import("@/app/api/admin/overrides/route");
    const many = Array.from({ length: 20 }, (_, i) => ({ ...PHOTO, url: `${PHOTO.url}?${i}`, alt: String(i) }));
    const res = await admin_overrides.PUT(put({ id: "touchable", gallery: many }));
    expect((await res.json()).overrides.touchable.gallery).toHaveLength(12);
  });

  it("an empty list clears the override and gives the catalogue photos back", async () => {
    const admin_overrides = await import("@/app/api/admin/overrides/route");
    await admin_overrides.PUT(put({ id: "touchable", gallery: [PHOTO] }));
    const res = await admin_overrides.PUT(put({ id: "touchable", gallery: [] }));
    expect((await res.json()).overrides.touchable.gallery).toBe(null);
  });

  it("leaves the other overrides alone", async () => {
    const admin_overrides = await import("@/app/api/admin/overrides/route");
    await admin_overrides.PUT(put({ id: "touchable", price: 25.5, varImg: [0, 1] }));
    const res = await admin_overrides.PUT(put({ id: "touchable", gallery: [PHOTO] }));
    const row = (await res.json()).overrides.touchable;
    expect(row.price).toBe(25.5);
    expect(row.varImg).toEqual([0, 1]);
    expect(row.gallery).toEqual([PHOTO]);
  });

  /**
   * media: the same door for the video link. The panel refuses a bad one
   * before it is sent (parseVideo() in app.js), but the route is what a
   * script, a stale tab or a curl call reaches — so it refuses too, out loud,
   * instead of storing something that renders nothing.
   */
  describe("product video override", () => {
    beforeEach(() => setStorage(true));
    afterEach(() => setStorage(false));

    it("saves each shape the shop can play", async () => {
      const admin_overrides = await import("@/app/api/admin/overrides/route");
      for (const url of [
        "https://youtu.be/dQw4w9WgXcQ",
        "https://vimeo.com/123456789",
        "https://www.instagram.com/reel/C8xYzAbCdEf/",
        `${R2_ENV.R2_PUBLIC_BASE}/videos/touchable/1756900000000-clip.mp4`,
      ]) {
        const res = await admin_overrides.PUT(put({ id: "touchable", videoUrl: url }));
        expect(res.status, url).toBe(200);
        expect((await res.json()).overrides.touchable.videoUrl).toBe(url);
      }
    });

    it("refuses a javascript: URL and anything else it cannot render", async () => {
      const admin_overrides = await import("@/app/api/admin/overrides/route");
      for (const url of [
        "javascript:alert(1)",
        "javascript:alert(1)#youtube.com/watch?v=dQw4w9WgXcQ",
        "data:text/html,<script>alert(1)</script>",
        "https://evil.example.com/?u=https://youtu.be/dQw4w9WgXcQ",
        "https://media.example.com/videos/x.mp4",
        "not a url",
      ]) {
        const res = await admin_overrides.PUT(put({ id: "touchable", videoUrl: url }));
        expect(res.status, url).toBe(400);
        expect(await res.json()).toMatchObject({ ok: false, error: "bad_video" });
      }
      const row = await query<{ video_url: string | null }>("select video_url from product_overrides where product_id = 'touchable'");
      expect(row[0]?.video_url ?? null).toBeNull();
    });

    it("an empty value clears the link and takes the video block off the page", async () => {
      const admin_overrides = await import("@/app/api/admin/overrides/route");
      await admin_overrides.PUT(put({ id: "touchable", videoUrl: "https://youtu.be/dQw4w9WgXcQ" }));
      const res = await admin_overrides.PUT(put({ id: "touchable", videoUrl: "" }));
      expect((await res.json()).overrides.touchable.videoUrl).toBe(null);
    });
  });
});
