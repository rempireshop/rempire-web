/**
 * The mark in the status bar has to be a shape, not a square.
 *
 * Renat's first push arrived on 21.09.2026 as a white block; opening it
 * revealed the tower. Two different icons are involved and only one of them
 * was right. `icon` is the picture inside the notification and may be
 * anything. `badge` is the small mark Android puts in the status bar, and
 * Android draws it from the ALPHA CHANNEL alone — it silhouettes whatever it
 * is handed and tints the result. An app icon is opaque across the whole
 * square, so its silhouette IS the square. The worker was passing the app
 * icon for both.
 *
 * So the badge is its own file: the tower on nothing. What is pinned here is
 * that the two stay different files, and that the badge really is mostly
 * transparent — a regenerated icon set that quietly made it opaque would
 * bring the white square back, and nobody would notice until the next order.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sw = readFileSync(fileURLToPath(new URL("../public/shop2/admin-sw.js", import.meta.url)), "utf8");
const badge = readFileSync(fileURLToPath(new URL("../public/shop2/icons/badge-96.png", import.meta.url)));

describe("the worker asks for the right two icons", () => {
  it("badge and icon are not the same file", () => {
    expect(sw).toContain('var BADGE = "/shop2/icons/badge-96.png";');
    expect(sw).toContain("badge: BADGE,");
    expect(sw, "the app icon as a badge is the white square").not.toContain("badge: ICON,");
  });

  it("the notification still carries the full-colour icon", () => {
    expect(sw).toContain('var ICON = "/shop2/icons/icon-192.png";');
    expect(sw).toContain("icon: ICON,");
  });
});

/* Enough of a PNG reader for one question: is this image's alpha a shape, or
   is it a filled rectangle? Only IHDR is parsed; the pixels are judged by
   whether the file carries alpha at all and how much of it is opaque, which
   `alphaextract` would otherwise have to be shelled out for. */
function pngHead(buf: Buffer) {
  expect(buf.subarray(0, 8).toString("hex"), "not a PNG").toBe("89504e470d0a1a0a");
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    depth: buf[24],
    /** 6 = truecolour with alpha, 4 = grey with alpha, 3 = palette, 2/0 = no alpha. */
    colourType: buf[25],
  };
}

describe("the badge is a silhouette", () => {
  const head = pngHead(badge);

  it("is 96×96 — xxhdpi's 24dp", () => {
    expect(head.width).toBe(96);
    expect(head.height).toBe(96);
  });

  it("carries an alpha channel at all", () => {
    /* Without one every pixel is opaque and Android is back to drawing a
       square, whatever the picture looks like to us. */
    expect([4, 6], `colour type ${head.colourType} has no alpha`).toContain(head.colourType);
  });

  it("is small, the way a 24dp silhouette is", () => {
    /* A photograph or a full-colour icon at this size does not compress to
       anything like this. The number is a sanity floor, not a spec: it catches
       somebody dropping icon-192 in here under the badge's name. */
    expect(badge.byteLength).toBeLessThan(8000);
    expect(badge.byteLength, "suspiciously empty — did the render fail?").toBeGreaterThan(200);
  });
});

describe("the generator keeps making it", () => {
  const tool = readFileSync(fileURLToPath(new URL("../tools/gen-pwa-icons.mjs", import.meta.url)), "utf8");

  it("badge-96.png is in the list the tool writes", () => {
    expect(tool).toContain('{ name: "badge-96.png"');
  });

  it("…and it is the only one rendered without a background", () => {
    /* `omitBackground` is what leaves the alpha channel shaped. The app icons
       must NOT get it: a transparent home-screen icon is a different bug. */
    expect(tool).toContain("clear: true");
    expect(tool).toContain("omitBackground: !!clear");
    expect((tool.match(/clear: true/g) ?? []).length, "another icon lost its background").toBe(1);
  });
});
