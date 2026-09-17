/**
 * A price the owner typed in «Товары»: is the number on the chip the number
 * the server bills?
 *
 * The storefront paints a volume's price from p.prices[i] after
 * applyDemoOverrides() has folded the owner's edits in; src/lib/orders.ts
 * prices the same volume again, from scratch, when the order is written. The
 * two used to part company on every product with volumes:
 *
 *   · a bare price override shifted every volume on the server («the override
 *     plus what this volume costs over the base») and only the first one in
 *     the browser, so «500 мл» was shown at the file's price and charged at
 *     the shifted one;
 *   · with a ladder the owner had saved, a later first-rung price edit
 *     travels as a bare `set_price` (edLadderMoved() in public/shop2/app.js),
 *     which the browser painted onto prices[0] and the server ignored in
 *     favour of the ladder's old first rung.
 *
 * Same method as tests/checkout-parity.test.ts: the two storefront functions
 * are sliced out of app.js by source text rather than retyped, so a rename or
 * a rewrite fails loudly here instead of drifting quietly.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import variants from "@/data/catalogue.variants.json";
import { createOrder, upsertOverride } from "@/lib/orders";
import { setupDb, teardownDb, truncateAll } from "./helpers";

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

type Min = { id: string; b: string; n: string; c: string; p: number; s: string };
const CATALOGUE = catalogueMin as Min[];
const VARIANTS = variants as Record<string, { sizes: string[]; prices: number[] }>;

/** A real product with more than one volume, in stock, as the shop's own
    catalogue file carries it (p.price === prices[0] === catalogue.min's p). */
const min = CATALOGUE.find((p) => p.s === "in" && (VARIANTS[p.id]?.sizes.length ?? 0) > 1)!;
const SIZES = VARIANTS[min.id].sizes;
const PRICES = VARIANTS[min.id].prices;

type Ladder = Array<{ size: string; price: number }>;

/** What the shopper is shown for every volume, from the shop's own code. */
function shopPrices(demo: { price?: number; sizes?: Ladder }): number[] {
  const body = `
    var SRCH_GEN = 0, SRCH_IX = {};
    function galleryUrls() { return null; }
    ${slice("baseOf")}
    ${slice("applyDemoOverrides")}
    ${slice("sizePrice")}
    ${slice("shopHidden")}
    var BASE = CATALOGUE.map(baseOf);
    /* applyDemoOverrides() walks the file's own products as well as CATALOGUE,
       so that a product the owner has HIDDEN — dropped from CATALOGUE, but
       still openable in the editor — is priced from its saved values and not
       from the generated file. These are the two names app.js keeps beside
       shopHidden(), spelled the same way. Nothing is hidden in this rig, so
       that pass adds no rows; the names simply have to exist. */
    var FILE_PRODUCTS = CATALOGUE.slice(), FILE_BASE = BASE.slice();
    applyDemoOverrides();
    var p = CATALOGUE[0], out = [];
    var n = p.sizes && p.sizes.length ? p.sizes.length : 1;
    for (var i = 0; i < n; i++) out.push(sizePrice(p, i));
    return { prices: out, sizes: p.sizes || [""] };
  `;
  // app.js's own source plus fixed stub text — nothing is interpolated in.
  const run = new Function("CATALOGUE", "DEMO", body) as (
    c: unknown[],
    d: Record<string, unknown>,
  ) => { prices: number[]; sizes: string[] };
  const product = {
    id: min.id,
    brand: min.b,
    name: min.n,
    cat: min.c,
    price: PRICES[0],
    prices: PRICES.slice(),
    sizes: SIZES.slice(),
    priceFrom: true,
    img: "/shop/img/x.webp",
    stock: min.s,
  };
  const DEMO: Record<string, unknown> = {
    price: demo.price != null ? { [min.id]: demo.price } : {},
    sizes: demo.sizes ? { [min.id]: demo.sizes } : {},
    proPrice: {},
    stock: {},
    seo: {},
    varimg: {},
    video: {},
    desc: {},
    gallery: {},
  };
  const out = run([product], DEMO);
  expect(out.sizes.length, "the sliced code changed shape").toBe(out.prices.length);
  return out.prices;
}

const customer = { name: "Мария Тамм", email: "maria@example.com", phone: "+372 5555 5555" };

/** What the server actually charges for one volume of the same product. */
async function billed(variant: string): Promise<number> {
  const made = await createOrder({
    lang: "ru",
    items: [{ id: min.id, variant, qty: 1 }],
    customer,
    shipping: { method: "parcel", country: "EE" },
  });
  return made.items[0].price;
}

describe("the chip and the bill agree about a price the owner typed", () => {
  beforeAll(setupDb);
  afterAll(teardownDb);
  beforeEach(truncateAll);

  it("with no override at all", async () => {
    const shown = shopPrices({});
    for (let i = 0; i < SIZES.length; i++) expect(await billed(SIZES[i])).toBeCloseTo(shown[i], 2);
  });

  /* The override is «−2 € on this product», and the server reads it as −2 €
     on every volume. The browser used to apply it to the first one only. */
  it("with a bare price override, on every volume and not just the smallest", async () => {
    const typed = Math.round((PRICES[0] - 2) * 100) / 100;
    await upsertOverride(min.id, { price: typed });
    const shown = shopPrices({ price: typed });
    expect(shown[0]).toBeCloseTo(typed, 2);
    for (let i = 0; i < SIZES.length; i++) {
      expect(await billed(SIZES[i]), `${SIZES[i]} is shown at ${shown[i]}`).toBeCloseTo(shown[i], 2);
    }
  });

  /* «+ Размер» saved a ladder; later only the first rung's price was changed,
     which the editor sends as a plain `set_price` — the ladder in the row
     still holds the old first number. This is honest today only because
     mapOverride() puts the `price` column back onto rung 0 when the ladder is
     read (sizesWithPrice), which is exactly the sort of invariant that gets
     deleted by accident: the ladder and the price column are one fact stored
     twice, and this test is what says so out loud. */
  it("with a saved ladder whose first rung was re-priced afterwards", async () => {
    const ladder: Ladder = [
      { size: "100 мл", price: 20 },
      { size: "250 мл", price: 30 },
    ];
    await upsertOverride(min.id, { sizes: ladder });
    await upsertOverride(min.id, { price: 17 });
    const shown = shopPrices({ sizes: ladder, price: 17 });
    expect(shown).toEqual([17, 30]);
    expect(await billed("100 мл")).toBeCloseTo(17, 2);
    expect(await billed("250 мл")).toBeCloseTo(30, 2);
  });

  /* The ladder alone — no bare edit after it — keeps charging the rungs the
     owner typed, which is what it always did. */
  it("with a saved ladder and nothing else", async () => {
    const ladder: Ladder = [
      { size: "A", price: 11 },
      { size: "B", price: 12 },
    ];
    await upsertOverride(min.id, { sizes: ladder });
    expect(shopPrices({ sizes: ladder, price: 11 })).toEqual([11, 12]);
    expect(await billed("A")).toBeCloseTo(11, 2);
    expect(await billed("B")).toBeCloseTo(12, 2);
  });
});
