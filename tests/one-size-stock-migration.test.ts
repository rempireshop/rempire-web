/**
 * db/migrations/194_one_size_stock_rows.sql.
 *
 * Twenty-nine products are sold in exactly one NAMED size — Touchable is
 * «250 мл» — and until 18.09.2026 tools/build-catalogue-variants.mjs skipped
 * every product with fewer than two rungs, so the server's ladder
 * (src/data/catalogue.variants.json) said they had no sizes at all. The panel
 * writes counts and binds barcodes against the browser's label; the shelf
 * universe, tools/seed-stock.mjs and a web sale all went through the server's
 * ladder and wrote under ''. One bottle, two rows.
 *
 * The generator is fixed, so both halves key on the label from here on. 194 is
 * for the rows the two of them already wrote, and these tests are the four
 * shapes it can find: the '' row alone, both rows together, a barcode on one
 * side or the other, and a product whose ladder the owner typed himself.
 *
 * The runner skips files recorded in _migrations, so to replay 194 against
 * hand-shaped rows these tests forget that one record and run setupDb() again
 * — which is exactly what a production database goes through on its next
 * deploy.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import variants from "@/data/catalogue.variants.json";
import { exec, query } from "@/lib/db";
import { setupDb, teardownDb } from "./helpers";

const MIGRATION = "194_one_size_stock_rows.sql";

const TABLE = variants as Record<string, { sizes: string[]; prices: number[] }>;

/** Two of the twenty-nine, read off the shipped ladder rather than spelled out
 *  here: if the file ever stops carrying them this should fail as a missing
 *  fixture, not pass as a migration that had nothing to do. */
const ONE = "touchable";
const TWO = "lumin-skin-recovery-oil";
/** A product with a real ladder of its own — 194 must not touch its rows. */
const MULTI = "system-4-bio-botanical-shampoo";

function rung(id: string): string {
  const v = TABLE[id];
  if (!v || v.sizes.length !== 1) {
    throw new Error(`tests/one-size-stock-migration.test.ts: "${id}" is not a one-size product any more`);
  }
  return v.sizes[0];
}

type Level = { product_id: string; variant: string; qty: number; low_threshold: number; ean: string | null };

async function levels(productId: string): Promise<Level[]> {
  return query<Level>(
    `select product_id, variant, qty::int as qty, low_threshold::int as low_threshold, ean
       from stock_levels where product_id = $1 order by variant`,
    [productId],
  );
}

async function seedLevel(productId: string, variant: string, qty: number, low = 2, ean: string | null = null) {
  await query(
    `insert into stock_levels (product_id, variant, qty, low_threshold, ean)
     values ($1, $2, $3, $4, $5)`,
    [productId, variant, qty, low, ean],
  );
}

/** Forget 194 and run the migrations again — the replay. */
async function replay() {
  await query("delete from _migrations where name = $1", [MIGRATION]);
  const applied = await setupDb();
  expect(applied, "194 did not replay").toContain(MIGRATION);
}

describe("194_one_size_stock_rows", () => {
  beforeAll(async () => {
    await setupDb();
  });
  afterAll(teardownDb);

  beforeEach(async () => {
    await exec("truncate stock_levels, stock_moves, product_overrides restart identity cascade");
  });

  it("renames the lone «один объём» row to the volume the product actually has", async () => {
    await seedLevel(ONE, "", 7, 3, "4900000000001");
    await replay();

    expect(await levels(ONE)).toEqual([
      { product_id: ONE, variant: rung(ONE), qty: 7, low_threshold: 3, ean: "4900000000001" },
    ]);
  });

  it("adds the two counts together where the panel had already written a labelled row", async () => {
    /* The panel counted 10 on the shelf; four went out through the web after
       that and were taken off the '' row, which is the only row the server
       knew how to decrement. 10 + (-4 applied to a row that started at 6) —
       the qtys are sums of disjoint sets of moves, so the merged row is their
       sum (090_inventory.sql). */
    await seedLevel(ONE, rung(ONE), 10, 2, null);
    await seedLevel(ONE, "", 6, 5, null);
    await replay();

    /* One row, and the labelled row's own «мало» threshold — the number Renat
       set on the row he can see. */
    expect(await levels(ONE)).toEqual([
      { product_id: ONE, variant: rung(ONE), qty: 16, low_threshold: 2, ean: null },
    ]);
  });

  it("carries a barcode across when only the «один объём» row had one", async () => {
    await seedLevel(TWO, rung(TWO), 1, 2, null);
    await seedLevel(TWO, "", 0, 2, "4900000000002");
    await replay();

    expect(await levels(TWO)).toEqual([
      { product_id: TWO, variant: rung(TWO), qty: 1, low_threshold: 2, ean: "4900000000002" },
    ]);
  });

  it("keeps the panel's barcode where both rows had a different one", async () => {
    /* stock_levels_ean_idx is unique over the non-null eans, so these cannot
       be the same code — two different codes for one bottle is an ambiguity
       no migration can settle, and the one Renat bound by scanning wins. */
    await seedLevel(TWO, rung(TWO), 4, 2, "4900000000003");
    await seedLevel(TWO, "", 1, 2, "4900000000004");
    await replay();

    expect(await levels(TWO)).toEqual([
      { product_id: TWO, variant: rung(TWO), qty: 5, low_threshold: 2, ean: "4900000000003" },
    ]);
    const loose = await query<{ n: string }>("select count(*)::text as n from stock_levels where ean = '4900000000004'");
    expect(loose[0].n, "the losing code is unbound, not left on a row of its own").toBe("0");
  });

  it("re-keys the ledger, so «учитывается» and the history follow the count", async () => {
    await seedLevel(ONE, "", 5, 2, null);
    await query(
      `insert into stock_moves (product_id, variant, delta, reason, actor)
       values ($1, '', 5, 'goods_in', 'test'), ($1, '', -2, 'sale_web', 'test')`,
      [ONE],
    );
    await replay();

    const moves = await query<{ variant: string; delta: number }>(
      "select variant, delta::int as delta from stock_moves where product_id = $1 order by delta",
      [ONE],
    );
    expect(moves.map((m) => m.variant)).toEqual([rung(ONE), rung(ONE)]);
  });

  it("leaves a product whose ladder the owner typed himself exactly as it was", async () => {
    /* knownLadder() reads product_overrides.sizes FIRST and always has
       (147_override_sizes_hidden.sql), so the shelf key for such a product was
       his rung before the generator was fixed and is his rung after it. There
       is nothing to move, and moving it would invent a rung he did not type. */
    await query(
      "insert into product_overrides (product_id, sizes) values ($1, $2::jsonb)",
      [ONE, JSON.stringify([{ size: "флакон", price: 27 }])],
    );
    await seedLevel(ONE, "", 9, 2, null);
    await replay();

    expect(await levels(ONE)).toEqual([
      { product_id: ONE, variant: "", qty: 9, low_threshold: 2, ean: null },
    ]);
  });

  it("does not touch a product that has a real ladder in the file", async () => {
    expect(TABLE[MULTI].sizes.length, `${MULTI} is no longer a multi-volume product`).toBeGreaterThan(1);
    await seedLevel(MULTI, "", 3, 2, null);
    await seedLevel(MULTI, TABLE[MULTI].sizes[0], 4, 2, null);
    await replay();

    const rows = await levels(MULTI);
    expect(rows.map((r) => [r.variant, r.qty])).toEqual(
      [["", 3], [TABLE[MULTI].sizes[0], 4]].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
  });

  it("is a no-op on a shop that never wrote either row", async () => {
    await replay();
    const rows = await query<{ n: string }>("select count(*)::text as n from stock_levels");
    expect(rows[0].n).toBe("0");
  });
});
