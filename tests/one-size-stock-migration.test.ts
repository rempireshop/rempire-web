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
import { ADMIN_COOKIE, hashPassword, makeSessionToken, resetRateLimits } from "@/lib/auth";
import { exec, query } from "@/lib/db";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

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

/**
 * db/migrations/196_one_volume_ladder_rows.sql — the rows 194 had to leave
 * behind (audit 18.09.2026, F35).
 *
 * 194 skipped every product whose ladder the owner had typed himself, on the
 * stated grounds that knownLadder() reads his ladder first «so their counts
 * were never under '' to begin with». True of every saved ladder except one:
 * «один объём», a single rung with no label, which the editor leaves behind
 * when «×» takes the last named row away. ladderLabels() read that as the ''
 * row and overrideLadder() read it as «not a ladder» and fell through to the
 * file, whose one rung is named — so «Склад» counted under '' while the cart
 * wrote «250 мл», and the paid sale went looking for a count under a name
 * nobody had used and was skipped in silence.
 *
 * ladderLabels() now says «not a ladder» too, so both halves read the file's
 * rung; 196 carries the counts the split had already written across, with
 * 194's own arithmetic.
 */
describe("196_one_volume_ladder_rows", () => {
  const M196 = "196_one_volume_ladder_rows.sql";

  beforeAll(async () => {
    await setupDb();
  });
  afterAll(teardownDb);

  beforeEach(async () => {
    await exec("truncate stock_levels, stock_moves, product_overrides restart identity cascade");
  });

  async function replay196() {
    await query("delete from _migrations where name = $1", [M196]);
    const applied = await setupDb();
    expect(applied, "196 did not replay").toContain(M196);
  }

  async function saveLadder(productId: string, sizes: Array<{ size: string | null; price: number }>) {
    await query("insert into product_overrides (product_id, sizes) values ($1, $2::jsonb)", [
      productId,
      JSON.stringify(sizes),
    ]);
  }

  it("moves the «один объём» count onto the volume the product is actually sold in", async () => {
    await saveLadder(ONE, [{ size: "", price: 27 }]);
    await seedLevel(ONE, "", 5, 3, "4900000000011");
    await replay196();

    expect(await levels(ONE)).toEqual([
      { product_id: ONE, variant: rung(ONE), qty: 5, low_threshold: 3, ean: "4900000000011" },
    ]);
  });

  it("adds the two counts together, and re-keys the history that explains them", async () => {
    await saveLadder(TWO, [{ size: null, price: 19 }]);
    await seedLevel(TWO, rung(TWO), 4, 2, null);
    await seedLevel(TWO, "", 3, 9, null);
    await query(
      "insert into stock_moves (product_id, variant, delta, reason, actor) values ($1, '', 3, 'goods_in', 'test')",
      [TWO],
    );
    await replay196();

    expect(await levels(TWO)).toEqual([
      { product_id: TWO, variant: rung(TWO), qty: 7, low_threshold: 2, ean: null },
    ]);
    // trackedKeys() reads the ledger to decide whether a row is counted at all
    const moves = await query<{ variant: string }>("select variant from stock_moves where product_id = $1", [TWO]);
    expect(moves.map((m) => m.variant)).toEqual([rung(TWO)]);
  });

  it("leaves a ladder whose rungs the owner NAMED exactly where it is", async () => {
    // his label is the key both halves already read — nothing to move, and
    // moving it would be this migration inventing a rung he did not type
    await saveLadder(ONE, [{ size: "флакон", price: 27 }]);
    await seedLevel(ONE, "", 9, 2, null);
    await replay196();

    expect(await levels(ONE)).toEqual([
      { product_id: ONE, variant: "", qty: 9, low_threshold: 2, ean: null },
    ]);
  });

  it("leaves a product with a real ladder in the file alone, saved or not", async () => {
    await saveLadder(MULTI, [{ size: "", price: 12 }]);
    await seedLevel(MULTI, "", 3, 2, null);
    await replay196();

    expect(await levels(MULTI)).toEqual([
      { product_id: MULTI, variant: "", qty: 3, low_threshold: 2, ean: null },
    ]);
  });

  it("is a no-op where nobody saved «один объём»", async () => {
    await seedLevel(ONE, rung(ONE), 4, 2, null);
    await replay196();
    expect(await levels(ONE)).toEqual([
      { product_id: ONE, variant: rung(ONE), qty: 4, low_threshold: 2, ean: null },
    ]);
  });
});

/**
 * …and the two doors that could write the row back (audit 18.09.2026, F9).
 *
 * 194 promised that «from here on both halves key on the label». The READ side
 * kept it — variantOf() names the rung on the order line, stockUnitsOf() names
 * it at the moment the goods move — and the WRITE side did not: the raw moves
 * route passed the body's size through untouched and applyMove() creates a row
 * for whatever it is handed. «Приход 6 штук Touchable» typed or spoken into
 * the assistant names no volume, because the CATALOGUE block the model is
 * shown lists sizes only for the owner's own goods — so it landed on
 * ('touchable','') , that row became tracked, «Склад» drew one bottle twice
 * and every web sale of it, keyed to «250 мл», was skipped as untracked.
 */
describe("a count with no volume on it lands on the volume the product has", () => {
  const ORIGIN = "https://rempireshop.com";
  let admin = "";

  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    process.env.ADMIN_PASSWORD_HASH = hashPassword("a long enough password");
    await setupDb();
    admin = `${ADMIN_COOKIE}=${makeSessionToken()}`;
  });
  afterAll(teardownDb);

  beforeEach(async () => {
    resetRateLimits();
    await exec("truncate stock_levels, stock_moves, product_overrides, idempotency_keys restart identity cascade");
  });

  function post(body: unknown) {
    return new Request(`${ORIGIN}/api/admin/inventory/moves/`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: admin, "x-forwarded-for": "203.0.113.7" },
      body: JSON.stringify(body),
    });
  }

  it("POST /api/admin/inventory/moves/ with no size writes the labelled row", async () => {
    const { POST } = await import("@/app/api/admin/inventory/moves/route");
    const res = await POST(post({ productId: ONE, delta: 6, reason: "goods_in", ref: "чат" }));
    expect(res.status).toBe(200);

    expect(await levels(ONE)).toEqual([
      { product_id: ONE, variant: rung(ONE), qty: 6, low_threshold: 2, ean: null },
    ]);
  });

  it("…and «останется N штук» the same way", async () => {
    const { POST } = await import("@/app/api/admin/inventory/moves/route");
    expect((await POST(post({ productId: ONE, qty: 4, reason: "adjust" }))).status).toBe(200);
    expect((await levels(ONE)).map((r) => [r.variant, r.qty])).toEqual([[rung(ONE), 4]]);
  });

  it("leaves a product with a real ladder on the '' row, as before", async () => {
    // two rungs are a choice nothing here may make for the owner
    const { POST } = await import("@/app/api/admin/inventory/moves/route");
    expect((await POST(post({ productId: MULTI, delta: 2, reason: "goods_in" }))).status).toBe(200);
    expect((await levels(MULTI)).map((r) => r.variant)).toEqual([""]);
  });

  it("follows the owner's own ladder above the file's", async () => {
    // his single named rung is the key «Склад» draws the row under
    await query("insert into product_overrides (product_id, sizes) values ($1, $2::jsonb)", [
      MULTI,
      JSON.stringify([{ size: "500 мл", price: 25 }]),
    ]);
    const { POST } = await import("@/app/api/admin/inventory/moves/route");
    expect((await POST(post({ productId: MULTI, delta: 2, reason: "goods_in" }))).status).toBe(200);
    expect((await levels(MULTI)).map((r) => r.variant)).toEqual(["500 мл"]);
  });

  it("passes a named size through untouched", async () => {
    const { POST } = await import("@/app/api/admin/inventory/moves/route");
    const size = TABLE[MULTI].sizes[1];
    expect((await POST(post({ productId: MULTI, variant: size, delta: 1, reason: "goods_in" }))).status).toBe(200);
    expect((await levels(MULTI)).map((r) => r.variant)).toEqual([size]);
  });
});
