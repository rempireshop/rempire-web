/**
 * POST /api/admin/upload with kind=news — a picture for «Рассылка», from
 * the owner's phone into the bucket, made for a mail program rather than for
 * the shop (src/lib/images.ts processEmailImage).
 *
 * Renat, 23.09.2026: «we need picture upload, Renat will not start getting
 * URLs». The route is the same door the product photos use; what differs is
 * what comes out of it, and that is what is pinned here, on real pictures run
 * through the real sharp:
 *   · a JPEG, never a WebP (Outlook draws WebP as a red cross), and a
 *     BASELINE JPEG (Outlook shows only the first pass of a progressive one);
 *   · a PNG only when the picture really is see-through;
 *   · 1200 px wide at most, never enlarged, upright, with no metadata;
 *   · one object under news/, no thumbnail;
 *   · the same locks as every other upload: the admin cookie, the bucket,
 *     the type read off the bytes, the 12 MB ceiling.
 * Only the bucket is a stub — every PUT is captured, body and headers.
 */
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { query } from "@/lib/db";
import { isAllowedKey } from "@/lib/storage";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const ORIGIN = "https://rempireshop.com";
const R2_ENV = {
  R2_ACCOUNT_ID: "acc123",
  R2_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  R2_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  R2_BUCKET: "rempire-media",
  R2_PUBLIC_BASE: "https://img.rempireshop.com",
};

let admin = "";

function setStorage(on: boolean) {
  for (const [k, v] of Object.entries(R2_ENV)) {
    if (on) process.env[k] = v;
    else delete process.env[k];
  }
}

interface Put { url: string; method: string; contentType: string; body: Buffer }

/** Records every request the route makes to the bucket, with what it stored. */
function stubBucket(status = 200) {
  const calls: Put[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init: RequestInit | undefined) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        url: String(url),
        method: (init?.method || "GET").toUpperCase(),
        contentType: h["content-type"] || "",
        body: init?.body ? Buffer.from(init.body as Uint8Array) : Buffer.alloc(0),
      });
      return new Response(status === 204 ? null : "", { status });
    }),
  );
  return calls;
}

function upload(file: Buffer, name: string, cookie = admin) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(file)], name));
  form.append("kind", "news");
  const headers: Record<string, string> = { "x-forwarded-for": "203.0.113.19" };
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}/api/admin/upload/`, { method: "POST", body: form, headers });
}

const photo = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 180, g: 120, b: 60 } } }).jpeg({ quality: 95 }).toBuffer();

/** A JPEG is progressive when its frame header is SOF2 (FF C2), baseline when SOF0 (FF C0). */
function jpegFrame(b: Buffer): "baseline" | "progressive" | "other" {
  for (let i = 2; i < b.length - 1; ) {
    if (b[i] !== 0xff) return "other";
    const marker = b[i + 1];
    if (marker === 0xc0) return "baseline";
    if (marker === 0xc2) return "progressive";
    i += 2 + b.readUInt16BE(i + 2);
  }
  return "other";
}

describe("admin upload — a picture for a letter", () => {
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

  /* ---------- the locks ------------------------------------------------------ */

  it("is the owner's: no cookie, no upload — and nothing reaches the bucket", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    const calls = stubBucket();
    expect((await POST(upload(await photo(40, 20), "a.jpg", ""))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("says the bucket is not set up rather than failing obscurely", async () => {
    setStorage(false);
    const { POST } = await import("@/app/api/admin/upload/route");
    const res = await POST(upload(await photo(40, 20), "a.jpg"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: "storage_not_configured" });
  });

  it("refuses what is not a picture, a HEIC, and a file over 12 MB — before the bucket", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    const calls = stubBucket();
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(64, 0x20)]);
    const bad = await POST(upload(pdf, "banner.jpg"));
    expect(bad.status).toBe(415);
    expect(await bad.json()).toMatchObject({ error: "bad_type" });

    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(32, 0)]);
    expect(await (await POST(upload(heic, "IMG_0001.HEIC"))).json()).toMatchObject({ error: "heic_unsupported" });

    const huge = await POST(upload(Buffer.alloc(13 * 1024 * 1024, 1), "huge.jpg"));
    expect(huge.status).toBe(413);
    expect(await huge.json()).toMatchObject({ error: "too_large" });
    expect(calls, "a refused picture still reached the bucket").toHaveLength(0);
  });

  it("needs no product id — a letter's picture belongs to no row yet", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    stubBucket();
    const res = await POST(upload(await photo(40, 20), "a.jpg"));
    expect(res.status).toBe(200);
  });

  /* ---------- what comes out ---------------------------------------------- */

  it("a phone photo: one baseline JPEG, 1200 px wide, under news/", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    const calls = stubBucket();
    const res = await POST(upload(await photo(3000, 1500), "Осенний баннер.JPG"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, width: 1200, height: 600, contentType: "image/jpeg" });
    expect(body.key).toMatch(/^news\/\d{13}-[a-z0-9-]+\.jpg$/);
    expect(isAllowedKey(body.key)).toBe(true);
    expect(body.url).toBe(`${R2_ENV.R2_PUBLIC_BASE}/${body.key}`);
    expect(body.thumbUrl, "a letter has no use for a thumbnail").toBeUndefined();

    // exactly one object, and it is what the answer says it is
    expect(calls.map((c) => c.method)).toEqual(["PUT"]);
    expect(calls[0].url).toContain(`/rempire-media/${body.key}`);
    expect(calls[0].contentType).toBe("image/jpeg");
    const stored = calls[0].body;
    expect(body.bytes).toBe(stored.length);
    const meta = await sharp(stored).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(1200);
    expect(jpegFrame(stored), "Outlook shows only the first pass of a progressive JPEG").toBe("baseline");

    const audit = await query<{ action: string; payload: { key: string; kind: string } }>(
      "select action, payload from admin_audit order by id desc limit 1",
    );
    expect(audit[0]).toMatchObject({ action: "media.upload", payload: { key: body.key, kind: "news" } });
  });

  it("a WebP goes in, a JPEG comes out — never the shop's own format", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    const calls = stubBucket();
    const webp = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#224466" } }).webp().toBuffer();
    const body = await (await POST(upload(webp, "banner.webp"))).json();
    expect(body.contentType).toBe("image/jpeg");
    expect(body.key).toMatch(/\.jpg$/);
    expect((await sharp(calls[0].body).metadata()).format).toBe("jpeg");
  });

  it("a see-through picture stays a PNG with its transparency; an opaque one with an alpha channel does not", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    const calls = stubBucket();
    const cutout = await sharp({ create: { width: 600, height: 300, channels: 4, background: { r: 200, g: 30, b: 30, alpha: 0.4 } } }).png().toBuffer();
    const a = await (await POST(upload(cutout, "logo.png"))).json();
    expect(a).toMatchObject({ contentType: "image/png", width: 600 });
    expect(a.key).toMatch(/\.png$/);
    const m = await sharp(calls[0].body).metadata();
    expect(m.format).toBe("png");
    expect(m.hasAlpha).toBe(true);

    const screenshot = await sharp({ create: { width: 600, height: 300, channels: 4, background: { r: 10, g: 10, b: 10, alpha: 1 } } }).png().toBuffer();
    const b = await (await POST(upload(screenshot, "screen.png"))).json();
    expect(b.contentType).toBe("image/jpeg");
  });

  it("never enlarges a small picture", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    stubBucket();
    expect(await (await POST(upload(await photo(300, 120), "small.jpg"))).json()).toMatchObject({ width: 300, height: 120 });
  });

  it("turns the picture upright and leaves no metadata in it", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    const calls = stubBucket();
    // a portrait phone shot stored landscape with «rotate 90°» in its EXIF, and a copyright line
    const tagged = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#808080" } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "Salon GPS here" } } })
      .toBuffer();
    const body = await (await POST(upload(tagged, "IMG_1234.jpg"))).json();
    expect(body).toMatchObject({ width: 200, height: 400 });
    const m = await sharp(calls[0].body).metadata();
    expect(m.exif, "the EXIF block survived").toBeUndefined();
    expect(m.orientation ?? 1).toBe(1);
  });

  it("keeps a letter's pictures small enough to download on a phone", async () => {
    const { POST } = await import("@/app/api/admin/upload/route");
    stubBucket();
    // noise is the worst case for a JPEG — a real photo comes out far smaller
    const noise = await sharp(Buffer.from(Array.from({ length: 1600 * 900 * 3 }, () => Math.floor(Math.random() * 256))), {
      raw: { width: 1600, height: 900, channels: 3 },
    }).png().toBuffer();
    const body = await (await POST(upload(noise, "noise.png"))).json();
    expect(body.contentType).toBe("image/jpeg");
    expect(body.width).toBe(1200);
    expect(body.bytes).toBeLessThan(1024 * 1024);
  });

  it("a letter's picture can be deleted by its key like any other upload", async () => {
    const { DELETE } = await import("@/app/api/admin/upload/route");
    const calls = stubBucket(204);
    const res = await DELETE(new Request(`${ORIGIN}/api/admin/upload/?key=${encodeURIComponent("news/1758600000000-banner.jpg")}`, {
      method: "DELETE",
      headers: { cookie: admin },
    }));
    expect(res.status).toBe(200);
    // no thumbnail to chase: a .jpg key has none
    expect(calls.map((c) => c.method)).toEqual(["DELETE"]);
  });
});
