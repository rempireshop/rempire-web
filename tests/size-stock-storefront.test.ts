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
  /** the owner's own «Наличие» — the product-level word, beside the map */
  stock?: string;
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
    /* `soldOut(p)` rather than `p.stock === "out"` since 19.09.2026: the two
       disagreed for a product whose volumes were all counted to zero while the
       product word stayed «in», and the page then offered «выберите другой
       объём» over an empty picker (audit F33). soldOut() already covers the
       owner's word, so nothing this test protected has been given up. */
    expect(screen).toContain("var prodGone = soldOut(p) || soloGone;");
    // …and the block that takes it is the one with «Сообщить о наличии»
    expect(screen).toMatch(/\(prodGone\s*\n?\s*\? '<div class="pdp__oos">/);
  });

  it("the restored basket refuses a volume counted to zero, not only a dead product", () => {
    /* `resumeCart()` reads the «вы оставили корзину» letter's payload, days
       after it was written. Its own comment claims «the same backstop
       addToCart() has» — which was true when it was written and stopped being
       true when addToCart() grew the per-size check, two branches that merged
       without a conflict (audit F32). Until then the letter brought the sold-out
       volume back and the checkout refused the whole order at the last tap. */
    const resume = slice("resumeCart");
    expect(resume).toContain('if (known.stock === "out") return;');
    expect(resume).toContain("if (sizeOut(known, size)) return;");
  });

  it("marks a basket line whose PRODUCT went out, not only one whose size did", () => {
    /* Same failure r23 fixed for sizes — the checkout refusing a basket with
       nothing to say which line is the problem — left in place for the product
       word itself (audit F34). The product is asked first: «Этого объёма сейчас
       нет» is misleading when there is no other volume to move to. */
    const note = slice("lineNoteHTML");
    const product = note.indexOf("soldOut(cp)");
    const size = note.indexOf("sizeOut(cp, l.size || 0)");
    expect(product).toBeGreaterThan(-1);
    expect(size).toBeGreaterThan(-1);
    expect(product).toBeLessThan(size);
    // an existing dictionary key, so no new sentence had to be translated
    expect(note).toContain("Товара нет в наличии");
  });

  it("the in-place patch gives up and re-renders when that row has to change", () => {
    // patchPdp() keeps the focused button on an ordinary tap; the buy row is
    // the one thing it cannot patch
    expect(slice("patchPdp")).toContain('document.querySelector(".pdp__oos--size")');
  });
});

/* ---------------------------------------------------------------------------
   What the SEARCH ENGINE is told (r25).

   The storefront half above stopped the shop from SELLING a size at zero. It
   left the head alone, and the head is a second claim about the same fact:
   setHead() rewrites #ldjson with a `Product` offer on every product render,
   and Googlebot indexes the rendered DOM rather than the static file. Until
   this it read `p.stock === "out"` — the owner's product-level word only —
   so the 153 products with one volume or none said **InStock** while their
   own page printed «нет в наличии» and offered «Сообщить о наличии» instead
   of a buy button.

   That is the one structured-data error that costs more than having none:
   Google drops the item from the merchant surfaces, and a shopper who clicks
   an «in stock» result onto a page that will not sell bounces.
--------------------------------------------------------------------------- */
describe("the offer the head publishes", () => {
  function sold(p: Product): boolean {
    return (
      new Function(
        "P",
        `${slice("sizeStockOf")}
         ${slice("sizeOut")}
         ${slice("soldOut")}
         return soldOut(P);`,
      ) as (p: Product) => boolean
    )(p);
  }

  it("a lone volume counted to zero is sold out — the case the page already shows", () => {
    // the 29 one-size products (migration 194) and the 124 with no size at all
    expect(sold({ id: "x", sizes: ["250 мл"], stockVar: { "250 мл": "out" } })).toBe(true);
    expect(sold({ id: "x", stockVar: { "": "out" } })).toBe(true);
  });

  it("a ladder counted to zero all the way down is sold out", () => {
    const allOut = { "75 мл": "out", "250 мл": "out", "500 мл": "out" };
    expect(sold({ id: "x", sizes: SIZES, stockVar: allOut })).toBe(true);
  });

  it("one rung still on the shelf is NOT sold out — the product is for sale", () => {
    expect(sold({ id: "x", sizes: SIZES, stockVar: { "75 мл": "out", "250 мл": "out", "500 мл": "in" } })).toBe(false);
    expect(sold({ id: "x", sizes: SIZES, stockVar: { "75 мл": "out", "250 мл": "out", "500 мл": "low" } })).toBe(false);
  });

  /* The 17.09.2026 decision, restated where it is easiest to get backwards:
     an uncounted size is not an empty one. Reading absence as «out» here would
     publish OutOfStock for most of the catalogue — the opposite failure, and
     the one nobody would notice until the impressions went. */
  it("says nothing about a ladder nobody has counted", () => {
    expect(sold({ id: "x", sizes: SIZES, stockVar: null })).toBe(false);
    expect(sold({ id: "x", stockVar: null })).toBe(false);
    expect(sold({ id: "x", sizes: SIZES, stockVar: { "75 мл": "out" } })).toBe(false);
    expect(sold({ id: "x", stockVar: {} })).toBe(false);
  });

  it("the owner's own «Наличие» still decides on its own", () => {
    expect(sold({ id: "x", stock: "out", sizes: SIZES, stockVar: null })).toBe(true);
    expect(sold({ id: "x", stock: "low", sizes: SIZES, stockVar: null })).toBe(false);
  });

  it("setHead() publishes that answer, not p.stock, in the offer and the snippet", () => {
    const head = slice("setHead");
    expect(head).toContain("var pGoneSeo = soldOut(p);");
    // the Product offer Googlebot reads off the rendered DOM
    expect(head).toContain('availability: "https://schema.org/" + (pGoneSeo ? "OutOfStock" : "InStock")');
    // …and the sentence the result listing prints under it
    expect(head).toContain('trText(pGoneSeo ? "нет в наличии"');
    // the old rule must be gone from both, or one of them still lies
    expect(head).not.toContain('(p.stock === "out" ? "OutOfStock" : "InStock")');
  });
});
