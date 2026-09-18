/**
 * The per-volume price table, checked against the one thing nobody has to
 * look up to know: a bigger bottle is not cheaper than a smaller one.
 *
 * On 09.09.2026 thirty-four of the sixty-seven multi-size products failed
 * that. Davines RENEWING Shampoo read 100 мл — 17,40 € and 250 мл — 9 €;
 * Kevin.Murphy RE.STORE read 40 мл — 36 € and 200 мл — 7 €. The prices were
 * right and the volumes were right; they were paired the wrong way round,
 * because tools/build-catalogue-full.mjs called sortSizesAscending() one line
 * before it built `entry.prices`. The sort permutes sizes, variant images and
 * prices together — that is its whole job — but it cannot permute a field
 * that does not exist yet, so the volumes came out sorted and the prices
 * stayed in the order the store happened to list them.
 *
 * It was invisible for as long as the card carried a volume picker: a shopper
 * chose 250 мл and was quoted the price sitting next to it. The moment the
 * card started quoting the cheapest volume on its own (09.09.2026, the
 * owner's «размеры и мл не нужны»), it became a live mispricing — «В корзину»
 * would have put a 17,40 € bottle in the basket at 9 €.
 *
 * So the rule is asserted here rather than trusted, over the shipped file:
 * the generator can be fixed and re-broken, and this is the shape of the
 * damage either way.
 *
 * The same file went wrong a second way on 18.09.2026, and the last check
 * below is for that one. tools/build-catalogue-variants.mjs was written as a
 * *price* table — "67 of the 220 products are sold in several sizes" — and
 * skipped anything with fewer than two rungs. Since then this file has become
 * the server's size LADDER of record: catalogueUniverse() in
 * src/lib/inventory.ts builds «Склад» out of it, variantOf() in
 * src/lib/orders.ts prices and validates an order line against it, and
 * bundles.ts reads it for a set's parts. Twenty-nine curated products carry
 * exactly one labelled volume — Touchable is «250 мл», and the product page
 * prints «Размеры · 250 мл · 27 €» — and the skip told all three of them that
 * the product has no volumes at all.
 *
 * What that cost: the panel binds barcodes and writes counts against the
 * browser's label, so «Склад» drew TWO rows for each of the 29 — an empty
 * «один объём» row from the universe and the real one under the label,
 * carried only by the orphan-row branch (351 rows for 322 codes). And
 * stockStates()'s rule that a whole ladder must be counted before the shop
 * may say «нет в наличии» was being computed against a ladder the shop does
 * not have.
 *
 * So the ladders are compared rung for rung against the file the browser
 * actually runs. They are two halves of one catalogue; either may be
 * regenerated alone, and the moment they disagree the shelf and the shop are
 * counting different products.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import variants from "../src/data/catalogue.variants.json";

type Variant = { sizes: string[]; prices: number[] };
const TABLE = variants as Record<string, Variant>;

/** public/shop/catalogue2.js — the global CATALOGUE public/shop2/index.html
 *  loads, read the way tools/build-catalogue-variants.mjs reads it (the array
 *  literal, parsed as JSON) rather than evaluated: a test has no business
 *  running the storefront's script to find out what is in it. */
type FileProduct = { id: string; sizes?: string[] };
const BROWSER: FileProduct[] = (() => {
  const js = readFileSync(fileURLToPath(new URL("../public/shop/catalogue2.js", import.meta.url)), "utf8");
  const m = /const CATALOGUE = (\[[\s\S]*?\n\]);/.exec(js);
  if (!m) throw new Error("public/shop/catalogue2.js: no CATALOGUE array literal to read");
  return JSON.parse(m[1]) as FileProduct[];
})();

/** One product's ladder as either file spells it. `[""]` is «один объём» — a
 *  product with no volumes at all, which is the shape stock_levels stores it
 *  in and the shape catalogueUniverse() gives it a row under. */
const ladder = (sizes: string[] | undefined): string[] => (sizes && sizes.length ? sizes : [""]);

/** The number in «250 мл» / «100 г», or null for a size that is not a
 *  quantity at all — «белый / S» on a shirt, where bigger is not dearer. */
function quantity(size: string): number | null {
  const m = /^(\d+(?:[.,]\d+)?)\s*(мл|г)$/.exec(size.trim());
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

describe("src/data/catalogue.variants.json", () => {
  it("pairs every product's volumes with its own prices", () => {
    for (const [id, v] of Object.entries(TABLE)) {
      expect(Array.isArray(v.sizes), `${id}.sizes`).toBe(true);
      expect(Array.isArray(v.prices), `${id}.prices`).toBe(true);
      expect(v.prices.length, `${id}: ${v.sizes.length} sizes but ${v.prices.length} prices`)
        .toBe(v.sizes.length);
      /* One rung is a ladder — twenty-nine curated products have exactly one
         labelled volume, and the server has to know its name. Zero is not:
         an entry with no rungs says nothing the absence of the entry does
         not say, and catalogueUniverse() would give it a row under no label
         while the panel writes one under a label it cannot see. */
      expect(v.sizes.length, `${id} has no sizes at all — it does not belong in this file`)
        .toBeGreaterThan(0);
      for (const [i, s] of v.sizes.entries()) {
        expect(typeof s === "string" && s.trim() !== "", `${id}.sizes[${i}] is ${JSON.stringify(s)} — an unlabelled rung is «один объём», which this file does not carry`)
          .toBe(true);
      }
      for (const [i, p] of v.prices.entries()) {
        expect(Number.isFinite(p), `${id}.prices[${i}] is ${JSON.stringify(p)}`).toBe(true);
        expect(p, `${id}.prices[${i}] is not positive`).toBeGreaterThan(0);
      }
    }
  });

  /* The regression itself. Products whose sizes are not quantities — the
     merch «белый / S» pairs — are skipped rather than guessed at: there is no
     order between a shirt's colours, and asserting one would be inventing a
     rule the shop does not have. */
  it("never prices a bigger volume below a smaller one", () => {
    const wrong: string[] = [];
    let checked = 0;

    for (const [id, v] of Object.entries(TABLE)) {
      const q = v.sizes.map(quantity);
      if (q.some((n) => n === null)) continue;
      checked++;
      for (let i = 0; i < q.length - 1; i++) {
        for (let j = i + 1; j < q.length; j++) {
          const [qi, qj] = [q[i] as number, q[j] as number];
          const [pi, pj] = [v.prices[i], v.prices[j]];
          if (qj > qi && pj < pi) {
            wrong.push(`${id}: ${v.sizes[i]} costs ${pi} € but ${v.sizes[j]} costs ${pj} €`);
          }
        }
      }
    }

    /* Without this the check would pass on an empty table — the exact way a
       data test stops being a test. */
    expect(checked, "no volume-priced products found — the check would be vacuous")
      .toBeGreaterThan(20);
    expect(wrong, "a bigger volume priced below a smaller one").toEqual([]);
  });

  /* Not a rule about the world, a rule about this file: the shop's card and
     its product page both quote Math.min(prices) as the headline, so a table
     that is not sorted is a table where the two can disagree with the order
     the volumes are drawn in. */
  it("lists volumes smallest first, so the cheapest is the first price", () => {
    for (const [id, v] of Object.entries(TABLE)) {
      const q = v.sizes.map(quantity);
      if (q.some((n) => n === null)) continue;
      const sorted = [...(q as number[])].sort((a, b) => a - b);
      expect(q, `${id}: volumes out of order — ${v.sizes.join(", ")}`).toEqual(sorted);
      expect(v.prices[0], `${id}: the first price is not the cheapest`)
        .toBe(Math.min(...v.prices));
    }
  });

  /* The drift check. The browser reads public/shop/catalogue2.js and the
     server reads this file; the second is generated from the first, and the
     two are regenerated by separate commands (`npm run build:variants` after
     tools/build-catalogue-full.mjs), so nothing but this stops one from
     being shipped without the other. Rung for rung, in order — a renamed,
     added, dropped or reordered volume is a stock row under a label one side
     of the shop cannot find. */
  it("gives every product the same ladder the browser's catalogue does", () => {
    const drifted: string[] = [];

    for (const p of BROWSER) {
      const browser = ladder(p.sizes);
      const server = ladder(TABLE[p.id]?.sizes);
      if (JSON.stringify(browser) !== JSON.stringify(server)) {
        drifted.push(`${p.id}: catalogue2.js says ${JSON.stringify(browser)}, catalogue.variants.json says ${JSON.stringify(server)}`);
      }
    }

    expect(BROWSER.length, "public/shop/catalogue2.js parsed to nothing — the check would be vacuous")
      .toBeGreaterThan(100);
    expect(drifted, "the two catalogues disagree about a product's volumes — re-run `npm run build:variants`")
      .toEqual([]);
  });

  /* And the other direction: an id this file knows and the browser does not
     is a ladder no shopper can ever pick from, priced and counted against a
     product the shop no longer sells. */
  it("carries no product the browser's catalogue has dropped", () => {
    const known = new Set(BROWSER.map((p) => p.id));
    const orphans = Object.keys(TABLE).filter((id) => !known.has(id));
    expect(orphans, "id(s) in catalogue.variants.json that public/shop/catalogue2.js does not have")
      .toEqual([]);
  });
});
