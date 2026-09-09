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
 */
import { describe, expect, it } from "vitest";

import variants from "../src/data/catalogue.variants.json";

type Variant = { sizes: string[]; prices: number[] };
const TABLE = variants as Record<string, Variant>;

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
      expect(v.sizes.length, `${id} has fewer than two sizes — it does not belong in this file`)
        .toBeGreaterThan(1);
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
});
