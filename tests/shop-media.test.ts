/**
 * gal() and media() — the two functions every product picture in the shop
 * goes through (the cards, the catalogue, the product page, «С этим
 * покупают», the cart lines and the admin's own rows).
 *
 * Renat, 17.09.2026: a hoodie he created himself had a «С этим покупают» row
 * of four products with names, prices and no pictures at all. gal() preferred
 * `p.gallery` whole whenever it had a length — so ONE photo row with no
 * usable url (which only the owner's own products can have; the catalogue
 * file is generated) made the list `[undefined]`, beat a perfectly good
 * `p.img`, and reached media() as `background-image:url('undefined')`: an
 * empty square under a real name and a real price.
 *
 * Both functions are small and self-contained, so they are sliced out of
 * public/shop2/app.js and run here against the shapes a product can really
 * have — the catalogue's, the owner's with photos, the owner's without, and
 * the broken ones in between.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

function sliceFn(name: string): string {
  const at = src.indexOf(`  function ${name}(`);
  if (at < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  const end = src.indexOf("\n  }", at);
  if (end < 0) throw new Error(`function ${name}() has no end`);
  return src.slice(at, end + 4);
}

type Product = { id?: string; img?: unknown; gallery?: unknown; fill?: string };
const sandbox = runInNewContext(`
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function tower(cls) { return '<svg class="' + cls + '"></svg>'; }
  ${sliceFn("gal")}
  ${sliceFn("media")}
  ({ gal: gal, media: media })
`) as { gal: (p: Product) => string[]; media: (p: Product, i: number, cls: string) => string };

const bg = (html: string) => /background-image:url\('([^']*)'\)/.exec(html)?.[1] ?? null;

describe("gal() — the photos a product really has", () => {
  it("a catalogue product: its own gallery, in order", () => {
    expect(sandbox.gal({ gallery: ["/a.webp", "/b.webp"], img: "/a.webp" })).toEqual(["/a.webp", "/b.webp"]);
  });
  it("a product with no gallery falls back to its one photo", () => {
    expect(sandbox.gal({ img: "/a.webp" })).toEqual(["/a.webp"]);
  });
  it("the owner's brand-new product falls back to the placeholder it was given", () => {
    expect(sandbox.gal({ img: "/brand/rempire-tower.svg" })).toEqual(["/brand/rempire-tower.svg"]);
  });
  it("a gallery with a hole in it does NOT beat the product's own photo", () => {
    // the sighting: one row with no url made the whole list [undefined]
    expect(sandbox.gal({ gallery: [undefined], img: "/brand/rempire-tower.svg" })).toEqual(["/brand/rempire-tower.svg"]);
    expect(sandbox.gal({ gallery: [null, ""], img: "/a.webp" })).toEqual(["/a.webp"]);
  });
  it("keeps the good photos out of a half-broken gallery", () => {
    expect(sandbox.gal({ gallery: ["", "/b.webp", null], img: "/a.webp" })).toEqual(["/b.webp"]);
  });
  it("accepts a list of photo objects as well as of urls", () => {
    expect(sandbox.gal({ gallery: [{ url: "/b.webp" }, { thumb: "/c.webp" }], img: "/a.webp" })).toEqual(["/b.webp"]);
  });
  it("nothing at all is an empty list, never [undefined]", () => {
    expect(sandbox.gal({})).toEqual([]);
    expect(sandbox.gal({ gallery: [] })).toEqual([]);
  });
});

describe("media() — what the card actually paints", () => {
  it("draws the photo", () => {
    expect(bg(sandbox.media({ gallery: ["/a.webp", "/b.webp"] }, 1, "ph card__img"))).toBe("/b.webp");
  });
  it("never paints url('undefined')", () => {
    for (const p of [{}, { gallery: [undefined] }, { gallery: [], img: "" }] as Product[]) {
      const html = sandbox.media(p, 0, "ph card__img");
      expect(html, "an empty square under a name and a price").not.toContain("undefined");
      expect(html, "a product with no photograph gets the shop's own mark").toContain("<svg");
    }
  });
  it("escapes the url — an uploaded name is data, not markup", () => {
    const html = sandbox.media({ gallery: ["/a'onerror=x.webp"] }, 0, "ph");
    expect(html).not.toContain("'onerror=");
  });
  it("keeps the merch crop", () => {
    expect(sandbox.media({ img: "/a.webp", fill: "cover" }, 0, "ph")).toContain("ph--cover");
  });
});
