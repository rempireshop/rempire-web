/**
 * The two icons at the site root (tools/gen-pwa-icons.mjs writes them):
 * /favicon.ico and /apple-touch-icon.png, for whoever asks the root instead
 * of reading the page's <link> tags. Both 404'd after the move from Shopify,
 * so browsers kept showing Shopify's «R» (09.10.2026).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PUBLIC = path.join(__dirname, "..", "public");
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(png: Buffer): [number, number] {
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe("root icons", () => {
  it("favicon.ico holds the tower at 16, 32 and 48 px", () => {
    const ico = fs.readFileSync(path.join(PUBLIC, "favicon.ico"));
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const count = ico.readUInt16LE(4);
    const sizes: number[] = [];
    for (let i = 0; i < count; i++) {
      const at = 6 + 16 * i;
      const len = ico.readUInt32LE(at + 8);
      const off = ico.readUInt32LE(at + 12);
      const png = ico.subarray(off, off + len);
      expect(png.subarray(0, 8).equals(PNG_SIG)).toBe(true);
      expect(pngSize(png)).toEqual([ico[at], ico[at + 1]]);
      sizes.push(ico[at]);
    }
    expect(sizes).toEqual([16, 32, 48]);
    /* the 32 px image is the tab icon the pages link to, byte for byte */
    const at32 = 6 + 16;
    const png32 = ico.subarray(ico.readUInt32LE(at32 + 12), ico.readUInt32LE(at32 + 12) + ico.readUInt32LE(at32 + 8));
    expect(png32.equals(fs.readFileSync(path.join(PUBLIC, "shop2", "icons", "favicon-32.png")))).toBe(true);
  });

  it("apple-touch-icon.png is the 180 px home-screen icon", () => {
    const root = fs.readFileSync(path.join(PUBLIC, "apple-touch-icon.png"));
    expect(root.equals(fs.readFileSync(path.join(PUBLIC, "shop2", "icons", "apple-touch-icon-180.png")))).toBe(true);
    expect(pngSize(root)).toEqual([180, 180]);
  });
});
