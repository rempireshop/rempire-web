/**
 * The owner's own products («c-…», custom_products) in the static grids
 * (Dim, 26.10.2026: «Fix the SEO gap»). Their pages are request-time
 * (src/lib/product-page.ts); until now every list tools/prerender-shop2.mjs
 * writes — sections, brands, subcollections, the shelf under a product — was
 * the catalogue file's alone, so Google's copy of «Воск для усов» lacked the
 * Maharajah wax that shoppers saw.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ownCard } from "../tools/lib/overrides-export.mjs";

const PRE = readFileSync(fileURLToPath(new URL("../tools/prerender-shop2.mjs", import.meta.url)), "utf8");

describe("ownCard — a custom_products row as the card the grid draws", () => {
  it("carries the id, brand, name, section, its subsection, the first price and the first photo", () => {
    expect(ownCard({
      id: "c-captain-fawcett-maharajah-moustache-wax", brand: "Captain Fawcett", name: "Maharajah Moustache Wax", cat: "beard",
      subcat: "mw", sizes: [], prices: [15], gallery: [{ url: "https://img.rempireshop.com/a.webp", alt: "" }], active: true,
    })).toEqual({
      id: "c-captain-fawcett-maharajah-moustache-wax", brand: "Captain Fawcett", name: "Maharajah Moustache Wax", cat: "beard",
      sub: "beard/mw", price: 15, img: "https://img.rempireshop.com/a.webp", stock: "in", custom: true,
    });
  });

  it("keeps a size ladder, «от» when the prices differ, the tower without a photo, none without a subsection", () => {
    const c = ownCard({ id: "c-x", brand: "B", name: "N", cat: "styling", subcat: null, sizes: '["100 мл","250 мл"]', prices: "[12,24]", gallery: null });
    expect(c).toMatchObject({ sub: "", sizes: ["100 мл", "250 мл"], prices: [12, 24], priceFrom: true, img: "/brand/rempire-tower.svg" });
  });
});

describe("the prerender lists them — after the catalogue's, in every grid", () => {
  it("reads the active ones and adds them to the list the grids are drawn from", () => {
    expect(PRE).toContain("const OWN_ON_SALE = (await fetchOwnProducts()).filter(p => CAT_NAMES[p.cat]);");
    expect(PRE).toContain("const LISTED = [...ON_SALE, ...OWN_ON_SALE];");
  });
  it("draws sections, brands, subcollections and the shelf under a product from it", () => {
    expect(PRE).toContain('const list = c === "all" ? LISTED : LISTED.filter(p => p.cat === c);');
    expect(PRE).toContain("const list = LISTED.filter(p => p.brand === b);");
    expect(PRE).toContain("const list = LISTED.filter(p => p.cat === cat && SUBS.with(p, ownSubcat(p)).includes(sub));");
    expect(PRE).toContain("const others = LISTED.filter(x => x.cat === p.cat && x.id !== p.id).slice(0, 8);");
    expect(PRE).toContain("return !LISTED.some(p => p.cat === cat && SUBS.with(p, ownSubcat(p)).includes(sub));");
  });
  it("only ever asks for the rows a stranger can open", () => {
    const src = readFileSync(fileURLToPath(new URL("../tools/lib/overrides-export.mjs", import.meta.url)), "utf8");
    expect(src).toContain("select * from custom_products where active = true");
  });
});
