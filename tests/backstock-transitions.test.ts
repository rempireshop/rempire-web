/**
 * «Товар снова в наличии» — when the letter goes, transition by transition.
 *
 * Renat on staging, 23.09.2026: «When it's "in stock" the letter arrives;
 * when it's "low" no letter goes out.» «Мало» is still for sale, so a product
 * (or a size) that comes back as «мало» has come back exactly as much as one
 * that comes back «в наличии» — and the person who asked to be told is owed
 * the letter either way. The owner's manual «Наличие» word only ever fired
 * the letter for «в наличии» (upsertOverride in src/lib/orders.ts).
 *
 * The rule, for both doors — the owner's own word in the panel (or the
 * assistant's set_stock, which is the same PUT) and the shelf count (scanner,
 * «Склад», a sale, a refund):
 *
 *   · out → in  and  out → low   the letter goes, once;
 *   · in → low  and  low → in    not a comeback — nothing from the hook;
 *   · never twice for one subscription, and never while the storefront still
 *     says «нет в наличии» (a counted zero, or «Снять с продажи»).
 *
 * Pending alerts on a product that is already on sale are the daily sweep's
 * (sweepBackInStock) — they exist only when the switch was off at the moment
 * it came back — and are not what these hooks are for.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exec, query } from "@/lib/db";
import { addStockAlert } from "@/lib/customers";
import { runBackInStock } from "@/lib/flows";
import { move, productStockStates, setQty } from "@/lib/inventory";
import { upsertOverride } from "@/lib/orders";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

/* In the catalogue file «в наличии», sold in three volumes (catalogue.variants.json). */
const PRODUCT = "system-4-bio-botanical-shampoo";
const SIZES = ["75 мл", "250 мл", "500 мл"];
/* …and one the catalogue file itself says is sold out. */
const FILE_OUT = "kevin-murphy-crystal-angel";
const EMAIL = "waiting@example.com";

/** Every letter Resend was asked to send since the last reset. */
const sent: Array<{ subject: string; to: string[] }> = [];

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  process.env.PUBLIC_BASE_URL = "https://test.rempireshop.com";
  await setupDb();
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.MAIL_RETRY_DELAY_MS = "0";
});

afterAll(async () => {
  delete process.env.RESEND_API_KEY;
  await teardownDb();
});

beforeEach(async () => {
  sent.length = 0;
  vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { subject: string; to: string[] };
    sent.push({ subject: body.subject, to: body.to });
    return new Response(JSON.stringify({ id: `msg_${sent.length}` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  await exec(
    "truncate customers, stock_alerts, mail_optouts, orders, settings, product_overrides, stock_levels, stock_moves restart identity cascade",
  );
  await query(`insert into settings (key, value) values ('flows', $1::jsonb)`, [JSON.stringify({ backstock: true })]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Somebody asks to be told — the way the product page asks (POST /api/stock-alerts). */
async function waiting(productId = PRODUCT): Promise<void> {
  expect(await addStockAlert({ email: EMAIL, productId, lang: "RU" })).toBe(true);
}
async function pending(): Promise<number> {
  const rows = await query<{ n: number }>("select count(*)::int as n from stock_alerts where sent_at is null");
  return Number(rows[0].n);
}

/* ---------- the owner's own word: «Наличие» in the panel ------------------ */

describe("the owner's «Наличие»: a comeback is out → in or out → low", () => {
  it("out → «мало» sends the letter — Renat's case", async () => {
    await upsertOverride(PRODUCT, { stock: "out" });
    await waiting();
    await upsertOverride(PRODUCT, { stock: "low" });
    expect(sent, "«мало» is on sale: the person waiting is owed the letter").toHaveLength(1);
    expect(sent[0].to).toEqual([EMAIL]);
    expect(await pending()).toBe(0);
  });

  it("out → «в наличии» sends it, as it always did", async () => {
    await upsertOverride(PRODUCT, { stock: "out" });
    await waiting();
    await upsertOverride(PRODUCT, { stock: "in" });
    expect(sent).toHaveLength(1);
  });

  it("a product the catalogue file says is sold out comes back at «мало» too", async () => {
    await waiting(FILE_OUT);
    await upsertOverride(FILE_OUT, { stock: "low" });
    expect(sent).toHaveLength(1);
  });

  it("in → «мало» is not a comeback: nothing goes", async () => {
    await upsertOverride(PRODUCT, { stock: "in" });
    await waiting();
    await upsertOverride(PRODUCT, { stock: "low" });
    expect(sent).toHaveLength(0);
  });

  it("«мало» → in is not a comeback either", async () => {
    await upsertOverride(PRODUCT, { stock: "low" });
    await waiting();
    await upsertOverride(PRODUCT, { stock: "in" });
    expect(sent, "a product that was on sale all along came «back»").toHaveLength(0);
  });

  it("out → «мало» → in → «мало»: one letter, never a second", async () => {
    await upsertOverride(PRODUCT, { stock: "out" });
    await waiting();
    await upsertOverride(PRODUCT, { stock: "low" });
    await upsertOverride(PRODUCT, { stock: "in" });
    await upsertOverride(PRODUCT, { stock: "low" });
    await upsertOverride(PRODUCT, { stock: "low" });
    expect(sent).toHaveLength(1);
  });

  it("…and a second sell-out and comeback does not write again to somebody already told", async () => {
    await upsertOverride(PRODUCT, { stock: "out" });
    await waiting();
    await upsertOverride(PRODUCT, { stock: "low" });
    await upsertOverride(PRODUCT, { stock: "out" });
    await upsertOverride(PRODUCT, { stock: "in" });
    expect(sent).toHaveLength(1);
  });

  it("saving a price, not the stock, sends nothing", async () => {
    await upsertOverride(PRODUCT, { stock: "out" });
    await waiting();
    await upsertOverride(PRODUCT, { price: 11 });
    expect(sent).toHaveLength(0);
    expect(await pending()).toBe(1);
  });

  it("the word does not outvote a counted zero: «мало» on an empty shelf waits", async () => {
    for (const size of SIZES) {
      await move({ productId: PRODUCT, variant: size, delta: 2, reason: "goods_in" });
      await move({ productId: PRODUCT, variant: size, delta: -2, reason: "sale_web" });
    }
    await upsertOverride(PRODUCT, { stock: "out" });
    await waiting();
    await upsertOverride(PRODUCT, { stock: "low" });
    expect(sent, "the shop wrote «снова в наличии» over a page that says «нет в наличии»").toHaveLength(0);
    // …still waiting for the day the shelf has something on it
    expect(await pending()).toBe(1);
  });
});

/* ---------- the shelf count: scanner, «Склад», sales, refunds ------------- */

describe("the count: a size back from zero is a comeback, a size moving between «мало» and «в наличии» is not", () => {
  /** Every size counted, and counted to `qty`. */
  async function shelf(qty: number): Promise<void> {
    for (const size of SIZES) await setQty(PRODUCT, size, qty, { reason: "adjust" });
  }

  it("a counted-out product: one size 0 → 1 («мало») sends the letter", async () => {
    await shelf(0);
    await waiting();
    await move({ productId: PRODUCT, variant: "250 мл", delta: 1, reason: "goods_in" });
    expect((await productStockStates([PRODUCT]))[PRODUCT], "the fixture is not at «мало»").toBe("low");
    expect(sent).toHaveLength(1);
  });

  it("…and a count typed on «Склад» (0 → 8) does the same", async () => {
    await shelf(0);
    await waiting();
    await setQty(PRODUCT, "75 мл", 8, { reason: "adjust" });
    expect(sent).toHaveLength(1);
  });

  it("in → «мало» (10 → 2) and «мало» → in (2 → 10) send nothing", async () => {
    await shelf(10);
    await waiting();
    await move({ productId: PRODUCT, variant: "75 мл", delta: -8, reason: "sale_web" });
    expect((await productStockStates([PRODUCT]))[PRODUCT]).toBe("low");
    await move({ productId: PRODUCT, variant: "75 мл", delta: 8, reason: "goods_in" });
    expect((await productStockStates([PRODUCT]))[PRODUCT]).toBe("in");
    expect(sent).toHaveLength(0);
  });

  it("0 → 1 → 5 on the shelf: one letter", async () => {
    await shelf(0);
    await waiting();
    await move({ productId: PRODUCT, variant: "500 мл", delta: 1, reason: "goods_in" });
    await move({ productId: PRODUCT, variant: "500 мл", delta: 4, reason: "goods_in" });
    await move({ productId: PRODUCT, variant: "75 мл", delta: 3, reason: "goods_in" });
    expect(sent).toHaveLength(1);
  });

  it("a full shelf does not talk past «Снять с продажи»: no letter while the page says «нет в наличии»", async () => {
    await shelf(0);
    await upsertOverride(PRODUCT, { stock: "out" });
    await waiting();
    await move({ productId: PRODUCT, variant: "75 мл", delta: 9, reason: "goods_in" });
    expect(sent, "a letter for a product the owner has taken off sale").toHaveLength(0);
    expect(await pending()).toBe(1);
    // …and it goes the moment the owner puts it back on sale
    await upsertOverride(PRODUCT, { stock: "in" });
    expect(sent).toHaveLength(1);
  });
});

/* ---------- never twice ---------------------------------------------------- */

describe("one subscription, one letter — even when two doors fire at once", () => {
  it("two runs at the same moment write once", async () => {
    await upsertOverride(PRODUCT, { stock: "out" });
    await waiting();
    await addStockAlert({ email: "second@example.com", productId: PRODUCT, lang: "EN" });
    await upsertOverride(PRODUCT, { stock: "in" }); // …which sends both
    expect(sent).toHaveLength(2);
    sent.length = 0;
    // both subscribers ask again while it is out, then two doors fire together
    await upsertOverride(PRODUCT, { stock: "out" });
    await waiting();
    await addStockAlert({ email: "second@example.com", productId: PRODUCT, lang: "EN" });
    await query("update product_overrides set stock = 'in' where product_id = $1", [PRODUCT]);
    await Promise.all([runBackInStock(PRODUCT), runBackInStock(PRODUCT)]);
    expect(sent.map((s) => s.to[0]).sort()).toEqual(["second@example.com", EMAIL].sort());
  });
});
