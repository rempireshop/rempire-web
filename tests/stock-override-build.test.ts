/**
 * «Нет в наличии» set by hand must reach the STATIC page — audit F31, 19.09.2026.
 *
 * `product_overrides` carries three things the owner sets in the panel: the
 * price, «Показывать в магазине», and the stock word. The build read the first
 * two and left the third to `public/shop/catalogue2.js`, which is a file
 * exported from the old shop and knows nothing about what he did this morning.
 *
 * So a product he had marked «нет в наличии» was written into
 * `/shop2/p/<id>/` as «В наличии», with `schema.org/InStock` in its Product
 * JSON-LD and «в наличии» in its meta description, and was corrected only once
 * `app.js` had booted and `setHead()` had rewritten the head from the live
 * feed. Google runs JavaScript, so Google would eventually see the truth; the
 * first paint, a reader with scripts off, and anything that reads the markup
 * rather than the page never do. The reverse case is the one that costs money:
 * a product the FILE calls «out» that he has put back on sale is advertised as
 * gone.
 *
 * The rule is `overriddenStock()` in src/lib/seo-head.mjs and the fold is
 * `withOwnerStock()` beside it — one function, so the build, the live page and
 * anything else asking «is this in stock» cannot answer differently. What the
 * build still cannot know is a COUNTED zero: it has no stock_levels and no
 * ladder, and `getOverrides()` in src/lib/orders.ts is where a count outranks
 * the manual word. The half the owner sets by hand is the half he expects to
 * see, and it is now the half the build honours.
 */
import { describe, expect, it } from "vitest";
import { overriddenStock, withOwnerStock } from "@/lib/seo-head.mjs";
import { overrideRow } from "../tools/lib/overrides-export.mjs";

const SERUM = "system-4-bio-botanical-serum";
const SHAMPOO = "system-4-bio-botanical-shampoo";
const SOAP = "handmade-soap-666";

type Product = { id: string; stock: string; price: number };
const CATALOGUE: Product[] = [
  { id: SERUM, stock: "in", price: 8 },
  { id: SHAMPOO, stock: "in", price: 9 },
  { id: SOAP, stock: "out", price: 9 },
];

describe("overriddenStock — the owner's word over the file's", () => {
  it("keeps the file's word when he has never touched the product", () => {
    expect(overriddenStock("in", undefined)).toBe("in");
    expect(overriddenStock("in", null)).toBe("in");
    expect(overriddenStock("out", {})).toBe("out");
  });

  it("keeps the file's word when the row exists for another reason", () => {
    /* A row is written when he changes the price alone; `stock` is null then,
       and null is not a word — it is «I have not said». */
    expect(overriddenStock("in", { price: 14.5, stock: null })).toBe("in");
  });

  it("takes each of the three words he can actually set", () => {
    expect(overriddenStock("in", { stock: "out" })).toBe("out");
    expect(overriddenStock("in", { stock: "low" })).toBe("low");
    expect(overriddenStock("out", { stock: "in" })).toBe("in");
  });

  it("ignores anything that is not one of the three", () => {
    /* The direction that shows the file's own word rather than inventing one,
       the same way forSale() shows a product when it cannot tell. */
    expect(overriddenStock("in", { stock: "нет" })).toBe("in");
    expect(overriddenStock("in", { stock: true })).toBe("in");
    expect(overriddenStock("in", { stock: 0 })).toBe("in");
  });

  it("reads the row the build makes of a Postgres row", () => {
    expect(overrideRow({ price: null, sizes: null, hidden: false, stock: "out" }).stock).toBe("out");
    expect(overrideRow({ price: null, sizes: null, hidden: false, stock: null }).stock).toBe(null);
    /* A column that has grown a value nobody here knows about is not a word. */
    expect(overrideRow({ price: null, sizes: null, hidden: false, stock: "preorder" }).stock).toBe(null);
  });
});

describe("withOwnerStock — what the build hands every page", () => {
  it("marks the one product he took off the shelf, and leaves the rest alone", () => {
    const out = withOwnerStock(CATALOGUE, { [SERUM]: { stock: "out" } }) as Product[];
    expect(out.map((p) => [p.id, p.stock])).toEqual([
      [SERUM, "out"],
      [SHAMPOO, "in"],
      [SOAP, "out"],
    ]);
  });

  it("puts a product the FILE calls sold out back in stock when he says so", () => {
    const out = withOwnerStock(CATALOGUE, { [SOAP]: { stock: "in" } }) as Product[];
    expect(out.find((p) => p.id === SOAP)!.stock).toBe("in");
  });

  it("returns the very same objects where nothing changed", () => {
    /* Not an optimisation worth writing a test for on its own — it is how the
       build keeps every other property of a product (photo, sizes, seo pair)
       without this fold having to know they exist. */
    const out = withOwnerStock(CATALOGUE, { [SERUM]: { stock: "out" } }) as Product[];
    expect(out[1]).toBe(CATALOGUE[1]);
    expect(out[0]).not.toBe(CATALOGUE[0]);
    expect(CATALOGUE[0].stock).toBe("in");
  });

  it("changes nothing at all when there is no table to ask", () => {
    /* A build with no DATABASE_URL: fetchProductOverrides() returns {} and
       this run writes exactly the pages it wrote before the column was read. */
    expect(withOwnerStock(CATALOGUE, {})).toEqual(CATALOGUE);
    expect(withOwnerStock(CATALOGUE, null)).toEqual(CATALOGUE);
  });

  it("is the line the build actually runs", () => {
    /* The build cannot be imported — it is a top-level-await program that
       writes 813 files — so this reads the one line that folds the word in.
       If it is ever inlined again, this fails and says where to look. */
    const src = require("node:fs").readFileSync(
      require("node:url").fileURLToPath(new URL("../tools/prerender-shop2.mjs", import.meta.url)),
      "utf8",
    ) as string;
    expect(src).toContain("const CATALOGUE = withOwnerStock(CATALOGUE_FILE, PRODUCT_OVERRIDES);");
  });
});
