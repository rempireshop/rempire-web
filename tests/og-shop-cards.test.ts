/**
 * The shop's own link-preview cards — public/og-shop-{en,et,ru}.png, drawn by
 * tools/og-shop.mjs (Dim's design and line «JUUKSED. HABE. STIIL.», 08.10.2026)
 * — and where they are used.
 *
 * Until 09.10.2026 a shared home page showed the staging poster «НОВЫЙ МАГАЗИН
 * … черновик для Рената», which was also the Organization `image`; a shared
 * section or brand showed whichever product sorted first; a policy page the
 * tower with no name (SEO audit §1A b, W7, T15). Now every page with no
 * picture of its own carries the card in its own language, a product, a set
 * and an article keep theirs, and the Organization's picture is the logo.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { headBlock, LANGS, OG_FALLBACK, OG_H, OG_W, ogShopCard, ORG_IMAGE, ROBOTS_OPEN } from "@/lib/seo-head.mjs";

const file = (rel: string) => fileURLToPath(new URL("../public" + rel, import.meta.url));
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const PRERENDER = read("../tools/prerender-shop2.mjs");

/** Width and height out of a PNG's IHDR chunk. */
function pngSize(buf: Buffer): [number, number] {
  expect(buf.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe("the cards on disk", () => {
  it("one per language, each 1200×630 PNG, and the old name is the English one", () => {
    for (const l of LANGS) {
      const rel = ogShopCard(l.code);
      expect(rel).toBe("/og-shop-" + l.tag + ".png");
      expect(existsSync(file(rel)), rel).toBe(true);
      expect(pngSize(readFileSync(file(rel))), rel).toEqual([OG_W, OG_H]);
    }
    expect(readFileSync(file(OG_FALLBACK)).equals(readFileSync(file(ogShopCard("EN"))))).toBe(true);
  });

  it("the generator is committed and draws the approved line in all three languages", () => {
    const tool = read("../tools/og-shop.mjs");
    expect(tool).toContain('head: ["Juuksed. Habe.", "Stiil."]');
    expect(tool).toContain('head: ["Hair. Beard.", "Style."]');
    expect(tool).toContain('head: ["Волосы. Борода.", "Стиль."]');
  });

  it("the Organization's picture is the logo, a file that exists — not a link-preview card", () => {
    expect(ORG_IMAGE).toMatch(/^\/brand\/.+\.svg$/);
    expect(existsSync(file(ORG_IMAGE))).toBe(true);
    expect(PRERENDER).toContain("image: abs(ORG_IMAGE),");
    expect(PRERENDER).not.toContain("image: abs(OG_FALLBACK)");
  });
});

describe("which page shows which card", () => {
  it("home, sections, brands, the brands landing, the policy pages and the gift card: the language card", () => {
    expect(PRERENDER).toContain('image: ogPick(ogShopCard(code)), imageAlt: "REMPIRE", ogType: "website",');
    expect(PRERENDER.match(/image: ogPick\(ogShopCard\(code\)\)/g)?.length).toBeGreaterThanOrEqual(6);
    // no page asks for the tower alone or for the old poster by name any more
    expect(PRERENDER).not.toMatch(/ogPick\(OG_DEFAULT\)|ogPick\(OG_FALLBACK\)|, OG_FALLBACK\)|, OG_DEFAULT\)/);
    // a product keeps its own card
    expect(PRERENDER).toContain("image: ogPick(productCard(p)),");
  });

  it("the 404 and the request-time blog list fall back to the language card too", () => {
    expect(read("../src/lib/notfound-page.ts")).toContain("image: base + ogShopCard(lang.code),");
    expect(read("../src/lib/blog-page.ts")).toContain(": base + ogShopCard(code),");
  });

  it("the home page's link preview carries its own §1A(b) pair, the title stays the title", () => {
    const html = headBlock({
      base: "https://rempireshop.com", robots: ROBOTS_OPEN, lang: LANGS[1], seg: "et", rest: "/",
      title: "T", desc: "D", ogTitle: "OG T", ogDesc: "OG D",
      image: "https://rempireshop.com" + ogShopCard("ET"), imageAlt: "REMPIRE", ogType: "website", jsonld: [], ldMain: false,
    });
    expect(html).toContain("<title>T</title>");
    expect(html).toContain('<meta name="description" content="D">');
    expect(html).toContain('<meta property="og:title" content="OG T" data-seo="og:title">');
    expect(html).toContain('<meta property="og:description" content="OG D" data-seo="og:description">');
    expect(html).toContain('<meta name="twitter:title" content="OG T" data-seo="twitter:title">');
    expect(html).toContain('<meta property="og:image" content="https://rempireshop.com/og-shop-et.png" data-seo="og:image">');
    expect(html).toContain('<meta property="og:image:type" content="image/png">');
  });
});
