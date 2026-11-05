/**
 * Google's photo floor: from 31.01.2027 Merchant Center refuses a product
 * whose g:image_link is under 500 × 500 px. tools/feed-squares.mjs gives every
 * shop photo under that a white square in public/shop/img/sq/, listed in
 * src/data/feed-squares.json, and the feed sends the square (googleImage() in
 * src/lib/merchant-feed.ts). These checks keep the three in step: a photo
 * added or replaced without re-running the tool fails here, not in Merchant
 * Center two months later.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import squares from "@/data/feed-squares.json";
import { googleImage } from "@/lib/merchant-feed";

const IMG = path.join(process.cwd(), "public", "shop", "img");
const SQ = path.join(IMG, "sq");
const listed = new Set(squares as string[]);

describe("the white squares for Google", () => {
  it("exist for every shop photo under 500 px, and only for those", async () => {
    const small: string[] = [];
    for (const f of readdirSync(IMG).filter((f) => f.endsWith(".webp"))) {
      const m = await sharp(readFileSync(path.join(IMG, f))).metadata();
      if (m.width! < 500 || m.height! < 500) small.push(f.replace(/\.webp$/, ""));
    }
    expect([...listed].sort(), "re-run node tools/feed-squares.mjs").toEqual(small.sort());
    expect(readdirSync(SQ).map((f) => f.replace(/\.jpg$/, "")).sort()).toEqual(small.sort());
  }, 60_000);

  it("are squares of at least 500 px", async () => {
    for (const name of listed) {
      const m = await sharp(readFileSync(path.join(SQ, name + ".jpg"))).metadata();
      expect(m.width, name).toBe(m.height);
      expect(m.width!, name).toBeGreaterThanOrEqual(500);
    }
  }, 60_000);

  it("leave no feed item with a main photo under 500 px", async () => {
    const driver = process.env.DB_DRIVER;
    const url = process.env.DATABASE_URL;
    delete process.env.DB_DRIVER; // the catalogue files as they are — no owner overrides
    delete process.env.DATABASE_URL;
    try {
      const { GET } = await import("@/app/feed/[file]/route");
      for (const file of ["google-en.xml", "google-ru.xml"]) {
        const res = await GET(new Request(`https://rempireshop.com/feed/${file}`), { params: Promise.resolve({ file }) });
        const xml = await res.text();
        const links = [...xml.matchAll(/<g:image_link>([^<]+)<\/g:image_link>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
        expect(links.length, file).toBeGreaterThan(100);
        const tooSmall: string[] = [];
        for (const link of new Set(links)) {
          const rel = new URL(link).pathname;
          if (!rel.startsWith("/shop/img/")) continue;
          const m = await sharp(readFileSync(path.join(process.cwd(), "public", rel))).metadata();
          if (m.width! < 500 || m.height! < 500) tooSmall.push(`${rel} ${m.width}x${m.height}`);
        }
        expect(tooSmall, file).toEqual([]);
      }
    } finally {
      process.env.DB_DRIVER = driver;
      if (url !== undefined) process.env.DATABASE_URL = url;
    }
  }, 120_000);

  it("replace only a listed shop photo, keeping the origin it came with", () => {
    const name = [...listed][0];
    expect(existsSync(path.join(SQ, name + ".jpg"))).toBe(true);
    expect(googleImage(`/shop/img/${name}.webp?v=5`)).toBe(`/shop/img/sq/${name}.jpg`);
    expect(googleImage(`https://rempireshop.com/shop/img/${name}.webp`)).toBe(`https://rempireshop.com/shop/img/sq/${name}.jpg`);
    expect(googleImage("/shop/img/not-a-listed-photo-0.webp?v=5")).toBe("/shop/img/not-a-listed-photo-0.webp?v=5");
    expect(googleImage("https://img.rempireshop.com/products/x/1.webp")).toBe("https://img.rempireshop.com/products/x/1.webp");
  });
});
