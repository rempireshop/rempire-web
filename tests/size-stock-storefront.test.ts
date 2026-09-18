/**
 * The storefront half of the 17.09.2026 decision — «show the product, hide the
 * empty size».
 *
 * The server half shipped that week: getOverrides() fills `stockByVariant` in
 * src/lib/orders.ts, createOrder() refuses a line whose size is at zero, and
 * the product stopped disappearing the moment one of its volumes sold out.
 * The storefront half did not. `stockByVariant` appeared six times in
 * orders.ts and **zero times in public/shop2/app.js** — the field rode the
 * public feed and no client read it. Setting a size to 0 changed nothing on
 * its page; the shopper basketed it and was refused at the checkout with
 * «Товара не хватает на складе» (Renat, 18.09.2026, on
 * /shop2/p/young-again-dry-conditioner/).
 *
 * The rule these tests pin down is the one that is easy to get backwards:
 *
 *   counted to zero  → unavailable, and said so;
 *   counted, in/low  → for sale, exactly as before;
 *   NEVER COUNTED    → for sale, exactly as before.
 *
 * The third is the whole point. A size nobody has counted is absent from the
 * map, and absent is not empty — the shelf has no opinion and the owner's own
 * «Наличие» stands, which is how the server reads it too (the module doc in
 * src/lib/inventory.ts). Reading absence as «out» would grey out most of the
 * shop and sell less than before the decision was made.
 *
 * The shop is a vanilla-JS IIFE with no DOM here, so — like
 * tests/admin-toship.test.ts and tests/checkout-parity.test.ts — the deciding
 * functions are **sliced out of public/shop2/app.js by source text** and run
 * against stubs. Retyping them would test this file instead of the shop, and
 * the slice fails loudly the day app.js renames one of them.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_JS = fileURLToPath(new URL("../public/shop2/app.js", import.meta.url));
const src = readFileSync(APP_JS, "utf8");

/** Cut `function <name>(…) { … }` out of app.js by brace matching. */
function slice(name: string): string {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}

/** A catalogue product as applyDemoOverrides() leaves it. */
type Product = {
  id: string;
  cat?: string;
  sizes?: string[];
  prices?: number[];
  price?: number;
  stockVar?: Record<string, string> | null;
};

const SIZES = ["75 мл", "250 мл", "500 мл"];

/** The four one-line helpers every case below is decided by. */
const HELPERS = `
  ${slice("sizeStockOf")}
  ${slice("sizeOut")}
  ${slice("firstSizeIdx")}
  ${slice("sizeGoneText")}
  ${slice("sizePickOtherText")}
`;

function helpers() {
  // The body is this repository's own source plus fixed stub text — no input
  // of any kind is interpolated into it.
  return new Function(
    "P",
    `${HELPERS}
     return {
       state: function (i) { return sizeStockOf(P, i); },
       out: function (i) { return sizeOut(P, i); },
       first: function () { return firstSizeIdx(P); },
       gone: function () { return sizeGoneText(P); },
       other: function () { return sizePickOtherText(P); }
     };`,
  ) as (p: Product) => {
    state: (i: number) => string | null;
    out: (i: number) => boolean;
    first: () => number;
    gone: () => string;
    other: () => string;
  };
}

describe("one size's word, off the map the server already publishes", () => {
  const run = helpers();

  it("reads the size LABEL, not the index — the key an order line carries", () => {
    const h = run({ id: "x", sizes: SIZES, stockVar: { "75 мл": "in", "500 мл": "out" } });
    expect(h.state(0)).toBe("in");
    expect(h.out(2)).toBe(true);
  });

  it("says nothing about a size nobody has counted — absent is not empty", () => {
    const h = run({ id: "x", sizes: SIZES, stockVar: { "75 мл": "out" } });
    // the 250 and the 500 are missing from the map: no opinion, still for sale
    expect(h.state(1)).toBeNull();
    expect(h.state(2)).toBeNull();
    expect(h.out(1)).toBe(false);
    expect(h.out(2)).toBe(false);
    // …and the one that WAS counted, to zero, is the only one refused
    expect(h.out(0)).toBe(true);
  });

  it("says nothing at all about a product nobody has counted", () => {
    for (const map of [null, undefined]) {
      const h = run({ id: "x", sizes: SIZES, stockVar: map });
      expect(h.state(0)).toBeNull();
      expect(h.out(0)).toBe(false);
    }
  });

  it("«мало» is a size that is FOR SALE — it may not be mistaken for empty", () => {
    const h = run({ id: "x", sizes: SIZES, stockVar: { "75 мл": "low" } });
    expect(h.state(0)).toBe("low");
    expect(h.out(0)).toBe(false);
  });

  it("a product with no sizes is keyed by '' — the shelf's unlabelled row", () => {
    expect(run({ id: "x", stockVar: { "": "out" } }).out(0)).toBe(true);
    expect(run({ id: "x", stockVar: { "": "in" } }).out(0)).toBe(false);
    // a map that knows some other label says nothing about this product
    expect(run({ id: "x", stockVar: { "75 мл": "out" } }).out(0)).toBe(false);
  });

  it("refuses anything that is not one of the three words", () => {
    const h = run({ id: "x", sizes: SIZES, stockVar: { "75 мл": "OUT", "250 мл": "" } });
    expect(h.state(0)).toBeNull();
    expect(h.state(1)).toBeNull();
  });

  it("an index past the end reads the last rung, as sizePrice() does", () => {
    const h = run({ id: "x", sizes: SIZES, stockVar: { "500 мл": "out" } });
    expect(h.out(9)).toBe(true);
  });
});

describe("the size a product page opens on", () => {
  const run = helpers();

  it("skips a volume counted to zero — the product must not read as gone", () => {
    expect(run({ id: "x", sizes: SIZES, stockVar: { "75 мл": "out" } }).first()).toBe(1);
    expect(run({ id: "x", sizes: SIZES, stockVar: { "75 мл": "out", "250 мл": "out" } }).first()).toBe(2);
  });

  it("stays on the first rung where nothing is counted, or nothing is left", () => {
    expect(run({ id: "x", sizes: SIZES, stockVar: null }).first()).toBe(0);
    // every size empty: the product's own word is «нет в наличии» and the page
    // shows the «Сообщить о наличии» block, so the rung no longer matters
    const allOut = { "75 мл": "out", "250 мл": "out", "500 мл": "out" };
    expect(run({ id: "x", sizes: SIZES, stockVar: allOut }).first()).toBe(0);
  });

  it("does not skip a volume nobody has counted", () => {
    expect(run({ id: "x", sizes: SIZES, stockVar: { "250 мл": "in" } }).first()).toBe(0);
  });
});

describe("the words the shopper reads", () => {
  const run = helpers();

  it("says «объём» about cosmetics and «размер» about a t-shirt", () => {
    expect(run({ id: "x", cat: "hair" }).gone()).toBe("Этого объёма сейчас нет");
    expect(run({ id: "x", cat: "merch" }).gone()).toBe("Этого размера сейчас нет");
    expect(run({ id: "x", cat: "hair" }).other()).toBe("Выберите другой объём.");
    expect(run({ id: "x", cat: "merch" }).other()).toBe("Выберите другой размер.");
  });

  /* translateTree() rewrites whole text nodes, so each of these has to reach
     the DOM as one literal and be one key in both tables. */
  it("every one of them is a key in the Estonian and the English table", () => {
    for (const ru of [
      "Этого объёма сейчас нет",
      "Этого размера сейчас нет",
      "Выберите другой объём.",
      "Выберите другой размер.",
    ]) {
      expect(src.split(`"${ru}":`).length - 1, ru).toBe(2);
    }
  });
});

describe("the size picker", () => {
  /** variantPicker() against stubs — the markup, not the DOM. */
  function picker(p: Product, sizeIdx: number): string {
    const body = `
      ${HELPERS}
      ${slice("splitVariants")}
      ${slice("variantIndex")}
      ${slice("variantPicker")}
      function esc(s) { return String(s); }
      function colourRu(c) { return c; }
      var S = { size: IDX };
      return variantPicker(P, P.sizes || []);
    `;
    return (new Function("P", "IDX", body) as (p: Product, i: number) => string)(p, sizeIdx);
  }

  it("greys a counted-empty volume and marks it aria-disabled", () => {
    const html = picker({ id: "x", sizes: SIZES, stockVar: { "500 мл": "out" } }, 0);
    // the empty one
    expect(html).toContain('class="size size--out" data-size="2"');
    expect(html).toMatch(/data-size="2"[^>]*aria-disabled="true"/);
    // …and the two beside it are untouched
    expect(html).toMatch(/class="size" data-size="0"/);
    expect(html).not.toMatch(/data-size="0"[^>]*aria-disabled/);
  });

  it("leaves a volume nobody has counted exactly as it was", () => {
    const html = picker({ id: "x", sizes: SIZES, stockVar: { "75 мл": "in" } }, 0);
    expect(html).not.toContain("size--out");
    expect(html).not.toContain("aria-disabled");
  });

  it("keeps the empty volume PRESSABLE — an inert button reads as a broken one", () => {
    const html = picker({ id: "x", sizes: SIZES, stockVar: { "500 мл": "out" } }, 0);
    // aria-disabled, never the `disabled` attribute: the tap has to land so the
    // page can say what is wrong (same idiom as the cart stepper's «−»)
    expect(html).not.toMatch(/data-size="2"[^>]*\sdisabled/);
    expect(html).toContain('data-size="2"');
  });

  it("a merch colour is gone only when every size printed on it is", () => {
    const merch = ["white / S", "white / M", "black / S", "black / M"];
    const html = picker(
      { id: "t", cat: "merch", sizes: merch, stockVar: { "white / S": "out", "white / M": "out", "black / S": "out" } },
      0,
    );
    // white: both sizes counted out → the colour itself is gone
    expect(html).toMatch(/data-vcolour="white"[^>]*aria-disabled="true"/);
    // black: M is still there → the colour stays on offer
    expect(html).not.toMatch(/data-vcolour="black"[^>]*aria-disabled/);
    // the size row is judged against the colour now chosen, which is white
    expect(html).toMatch(/data-vsize="S"[^>]*aria-disabled="true"/);
    expect(html).toMatch(/data-vsize="M"[^>]*aria-disabled="true"/);
  });

  it("…and the same sizes under a colour that still has them are not greyed", () => {
    const merch = ["white / S", "white / M", "black / S", "black / M"];
    const html = picker(
      { id: "t", cat: "merch", sizes: merch, stockVar: { "white / S": "out", "white / M": "out", "black / S": "out" } },
      3, // "black / M"
    );
    expect(html).toMatch(/data-vsize="S"[^>]*aria-disabled="true"/);
    expect(html).not.toMatch(/data-vsize="M"[^>]*aria-disabled/);
  });
});

describe("the card quotes a volume it can actually sell", () => {
  /** cardSizeIdx() against stubs — prices straight off `prices`. */
  function cardIdx(p: Product): number {
    const body = `
      ${HELPERS}
      ${slice("cardSizeIdx")}
      function byId() { return P; }
      function shownPrice(pp, i) { return pp.prices[i]; }
      return cardSizeIdx(P.id);
    `;
    return (new Function("P", body) as (p: Product) => number)(p);
  }

  const prices = [9, 16, 25];

  it("still the cheapest where nothing is counted", () => {
    expect(cardIdx({ id: "x", sizes: SIZES, prices, stockVar: null })).toBe(0);
  });

  it("passes over a volume counted to zero — its «В корзину» baskets this one", () => {
    expect(cardIdx({ id: "x", sizes: SIZES, prices, stockVar: { "75 мл": "out" } })).toBe(1);
    expect(cardIdx({ id: "x", sizes: SIZES, prices, stockVar: { "75 мл": "out", "250 мл": "out" } })).toBe(2);
  });

  it("does not pass over a volume nobody has counted", () => {
    expect(cardIdx({ id: "x", sizes: SIZES, prices, stockVar: { "250 мл": "out" } })).toBe(0);
  });

  it("falls back to the cheapest when every volume is gone", () => {
    const allOut = { "75 мл": "out", "250 мл": "out", "500 мл": "out" };
    // the product's own word is «нет в наличии» by then and the card shows no
    // button at all, so the rung only has to be a sane one
    expect(cardIdx({ id: "x", sizes: SIZES, prices, stockVar: allOut })).toBe(0);
  });
});

describe("the wire, and the two screens that read it", () => {
  it("the storefront reads `stockByVariant` off the feed — the whole bug", () => {
    /* It appeared six times in src/lib/orders.ts and none at all here, which
       is exactly what «setting to 0 changes nothing on the shop page» was.
       Asserted on the source because adoptServer() is the feed's own merge
       and has no seam short of a browser. */
    expect(src).toContain("o.stockByVariant");
    expect(src).toContain("DEMO.stockVar[id] = o.stockByVariant");
  });

  it("nothing counted to zero can be basketed, whatever button sent it", () => {
    // addToCart() is the one door every «В корзину» in the shop comes through
    expect(slice("addToCart")).toContain("if (sizeOut(byId(id), si))");
  });

  it("the basket says so on the line, where «Убрать» is one tap away", () => {
    const note = slice("lineNoteHTML");
    expect(note).toContain("sizeOut(cp, l.size || 0)");
    expect(note).toContain("cline__gone");
  });

  it("the product page drops the buy row, the express button and the sticky bar", () => {
    const screen = slice("screenProduct");
    expect(screen).toContain("var volGone = !prodGone && sizeOut(p, S.size);");
    // one branch covers «В корзину», «Купить через G Pay» and «Другие способы»
    expect(screen).toContain("pdp__oos--size");
    expect(screen).toContain('(prodGone || volGone ? "" :');
  });

  /* «Выберите другой объём.» needs another one to exist. A product with one
     volume or none, whose single shelf row is at zero, is the PRODUCT being
     gone — it gets the block it always had, and the stock alert behind it is
     product-keyed, so the letter really does come. */
  it("a lone volume at zero is the product being gone, not a volume", () => {
    const screen = slice("screenProduct");
    expect(screen).toContain("var soloGone = sizes.length < 2 && sizeOut(p, S.size);");
    expect(screen).toContain('var prodGone = p.stock === "out" || soloGone;');
    // …and the block that takes it is the one with «Сообщить о наличии»
    expect(screen).toMatch(/\(prodGone\s*\n?\s*\? '<div class="pdp__oos">/);
  });

  it("the in-place patch gives up and re-renders when that row has to change", () => {
    // patchPdp() keeps the focused button on an ordinary tap; the buy row is
    // the one thing it cannot patch
    expect(slice("patchPdp")).toContain('document.querySelector(".pdp__oos--size")');
  });
});
