/**
 * src/lib/video.ts — what may be stored in `product_overrides.video_url`, and
 * what the bytes of an uploaded video have to look like.
 *
 * The tests below are written the way the field is actually attacked: not
 * "does a YouTube link parse" but "does a javascript: URL with a YouTube link
 * glued on the end get through", which is exactly what a regex that SEARCHES
 * instead of parsing lets past.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanVideoUrl, MAX_VIDEO_BYTES, parseProductVideo, sniffVideo, VideoError } from "@/lib/video";

const R2_ENV = {
  R2_ACCOUNT_ID: "acc123",
  R2_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
  R2_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  R2_BUCKET: "rempire-media",
  R2_PUBLIC_BASE: "https://media.rempireshop.com",
};
function setStorage(on: boolean) {
  for (const [k, v] of Object.entries(R2_ENV)) {
    if (on) process.env[k] = v;
    else delete process.env[k];
  }
}

/** An ISO base media file header with the given major brand. */
function ftyp(brand: string, extra = 32): Buffer {
  return Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftyp"), Buffer.from(brand), Buffer.alloc(extra, 0)]);
}

describe("parseProductVideo", () => {
  beforeEach(() => setStorage(true));
  afterEach(() => setStorage(false));

  it("takes every YouTube address a share button produces", () => {
    for (const url of [
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
    ]) {
      const v = parseProductVideo(url);
      expect(v, url).toMatchObject({ kind: "yt", id: "dQw4w9WgXcQ" });
      expect(v!.embed).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    }
  });

  it("takes Vimeo, by id", () => {
    expect(parseProductVideo("https://vimeo.com/123456789")).toMatchObject({ kind: "vimeo", id: "123456789" });
    expect(parseProductVideo("https://player.vimeo.com/video/123456789")).toMatchObject({ kind: "vimeo" });
    expect(parseProductVideo("https://vimeo.com/notanumber")).toBeNull();
  });

  /* ---------- Instagram ----------------------------------------------------- */

  it("takes an Instagram reel and turns it into the /embed/ address", () => {
    const v = parseProductVideo("https://www.instagram.com/reel/C8xYzAbCdEf/");
    expect(v).toMatchObject({ kind: "instagram", shape: "reel", id: "C8xYzAbCdEf" });
    expect(v!.embed).toBe("https://www.instagram.com/reel/C8xYzAbCdEf/embed/");
    expect(v!.page).toBe("https://www.instagram.com/reel/C8xYzAbCdEf/");
  });

  it("takes a post, an account-prefixed link, the plural /reels/ and a tracking query", () => {
    expect(parseProductVideo("https://www.instagram.com/p/C8xYzAbCdEf/")).toMatchObject({ shape: "p" });
    expect(parseProductVideo("https://instagram.com/reel/C8xYzAbCdEf")).toMatchObject({ shape: "reel" });
    expect(parseProductVideo("https://www.instagram.com/rempire.tallinn/reel/C8xYzAbCdEf/")).toMatchObject({
      kind: "instagram",
      id: "C8xYzAbCdEf",
    });
    expect(parseProductVideo("https://www.instagram.com/reels/C8xYzAbCdEf/")).toMatchObject({ shape: "reel" });
    // ?igsh=… is what the app's own «Copy link» appends
    expect(parseProductVideo("https://www.instagram.com/reel/C8xYzAbCdEf/?igsh=MXY5")).toMatchObject({
      id: "C8xYzAbCdEf",
    });
  });

  it("refuses an Instagram address that is not a reel or a post", () => {
    for (const url of [
      "https://www.instagram.com/rempire.tallinn/",
      "https://www.instagram.com/",
      "https://www.instagram.com/explore/tags/hair/",
      "https://www.instagram.com/a/b/reel/C8xYzAbCdEf/", // two segments deep — not a shape we know
      "https://www.instagram.com/reel/",
    ]) {
      expect(parseProductVideo(url), url).toBeNull();
    }
  });

  /* ---------- our own uploaded file ----------------------------------------- */

  it("takes an .mp4 in our own bucket and nothing else that ends in .mp4", () => {
    const ours = `${R2_ENV.R2_PUBLIC_BASE}/videos/touchable/1756900000000-clip.mp4`;
    expect(parseProductVideo(ours)).toMatchObject({ kind: "file", embed: ours });
    expect(parseProductVideo(`${R2_ENV.R2_PUBLIC_BASE}/videos/touchable/1756900000000-clip.mov`)).toMatchObject({
      kind: "file",
    });
    // somebody else's host, however plausible
    expect(parseProductVideo("https://media.example.com/videos/x.mp4")).toBeNull();
    // our host, but not the videos/ prefix — a photo key must not become a <video>
    expect(parseProductVideo(`${R2_ENV.R2_PUBLIC_BASE}/products/touchable/1-a.webp`)).toBeNull();
    // and no traversal out of the prefix
    expect(parseProductVideo(`${R2_ENV.R2_PUBLIC_BASE}/videos/../products/a.webp`)).toBeNull();
  });

  it("cannot accept an uploaded file when there is no bucket configured", () => {
    const ours = `${R2_ENV.R2_PUBLIC_BASE}/videos/touchable/1-clip.mp4`;
    setStorage(false);
    expect(parseProductVideo(ours)).toBeNull();
    // the link shapes keep working — they never needed the bucket
    expect(parseProductVideo("https://youtu.be/dQw4w9WgXcQ")).toMatchObject({ kind: "yt" });
  });

  /* ---------- what it refuses ------------------------------------------------ */

  it("refuses a scheme that is not http(s), however the provider is smuggled in", () => {
    for (const url of [
      "javascript:alert(1)",
      "javascript:alert(1)#youtube.com/watch?v=dQw4w9WgXcQ",
      "javascript:alert(1)//www.instagram.com/reel/C8xYzAbCdEf/",
      "data:text/html,<script>alert(1)</script>",
      "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "  javascript:alert(1)  ",
    ]) {
      expect(parseProductVideo(url), url).toBeNull();
    }
  });

  it("refuses a page that merely mentions a provider, and anything that is not a URL", () => {
    for (const url of [
      "https://evil.example.com/?u=https://youtu.be/dQw4w9WgXcQ",
      "https://evil.example.com/instagram.com/reel/C8xYzAbCdEf/",
      "not a url",
      "youtu.be/dQw4w9WgXcQ", // no scheme at all
      "",
      "   ",
      `https://youtu.be/${"a".repeat(600)}`,
    ]) {
      expect(parseProductVideo(url), url).toBeNull();
    }
    expect(parseProductVideo(null)).toBeNull();
    expect(parseProductVideo(42)).toBeNull();
    expect(parseProductVideo({ url: "https://youtu.be/dQw4w9WgXcQ" })).toBeNull();
  });
});

describe("cleanVideoUrl", () => {
  beforeEach(() => setStorage(true));
  afterEach(() => setStorage(false));

  it("keeps the address it was given when it is one we can play", () => {
    expect(cleanVideoUrl("  https://youtu.be/dQw4w9WgXcQ  ")).toBe("https://youtu.be/dQw4w9WgXcQ");
    expect(cleanVideoUrl("https://www.instagram.com/reel/C8xYzAbCdEf/")).toBe(
      "https://www.instagram.com/reel/C8xYzAbCdEf/",
    );
  });

  it("an empty field clears the override rather than failing", () => {
    expect(cleanVideoUrl(null)).toBeNull();
    expect(cleanVideoUrl("")).toBeNull();
    expect(cleanVideoUrl("   ")).toBeNull();
  });

  it("throws rather than storing something the shop cannot render", () => {
    expect(() => cleanVideoUrl("javascript:alert(1)")).toThrow(VideoError);
    expect(() => cleanVideoUrl("https://example.com/video")).toThrow(VideoError);
  });
});

describe("sniffVideo", () => {
  it("recognises MP4 and QuickTime by the ftyp brand, not by the name", () => {
    expect(sniffVideo(ftyp("isom"))).toBe("video/mp4");
    expect(sniffVideo(ftyp("mp42"))).toBe("video/mp4");
    expect(sniffVideo(ftyp("avc1"))).toBe("video/mp4");
    expect(sniffVideo(ftyp("qt  "))).toBe("video/quicktime");
    // an iPhone's HEVC container is a video, but not one we accept
    expect(sniffVideo(ftyp("heic"))).toBeNull();
  });

  it("refuses anything without an ftyp box, and anything too short to have one", () => {
    expect(sniffVideo(Buffer.from("%PDF-1.7\nnot a video at all"))).toBeNull();
    expect(sniffVideo(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull(); // a JPEG
    expect(sniffVideo(Buffer.alloc(4))).toBeNull();
    expect(sniffVideo(new Uint8Array(0))).toBeNull();
  });

  it("caps the upload at 60 MB", () => {
    expect(MAX_VIDEO_BYTES).toBe(60 * 1024 * 1024);
  });
});
