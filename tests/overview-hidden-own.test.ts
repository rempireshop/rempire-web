/**
 * «Обзор → Сделать сегодня»: a product taken off sale is counted in the
 * hidden line, never in «N товаров заканчиваются» — the owner's own product
 * as much as a catalogue one.
 *
 * Verification pass on staging, 25.09.2026 (panel-overview): an own product
 * with «Показывать в магазине» off stayed in the ordinary row. The panel's
 * switch is one switch, but the server keeps it in two places — `hidden` on
 * the override row for a catalogue product, `active` on custom_products for
 * the owner's own — and qOverviewLowStock() only read the first.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import catalogueMin from "@/data/catalogue.min.json";
import { getOverviewSummary } from "@/lib/analytics";
import { createCustomProduct, setCustomProductActive } from "@/lib/custom-products";
import { query } from "@/lib/db";
import { setupDb, teardownDb, truncateAll, TEST_SECRET } from "./helpers";

const NOW = new Date("2026-06-15T12:00:00Z");
const CATALOGUE = catalogueMin as Array<{ id: string; n: string; b: string; s: string }>;

beforeAll(async () => {
  process.env.SESSION_SECRET = TEST_SECRET;
  await setupDb();
});
afterAll(teardownDb);
/* The catalogue file's own «мало» / «нет» count too since 26.09.2026
   (src/lib/stock-word.ts) — set to «в наличии» by hand here, so each case
   below starts from an empty list and counts only what it adds. */
beforeEach(async () => {
  await truncateAll();
  const ids = CATALOGUE.filter((p) => p.s !== "in").map((p) => p.id);
  await query(
    `insert into product_overrides (product_id, stock) values ${ids.map((_, i) => `($${i + 1}, 'in')`).join(", ")}`,
    ids,
  );
});

describe("«Заканчиваются» and the hidden line", () => {
  it("an own product switched off («Показывать в магазине» off) is in the hidden line, not the main one", async () => {
    const onSale = await createCustomProduct({ brand: "Acme", name: "Wax", cat: "styling", price: 9 });
    const off = await createCustomProduct({ brand: "Acme", name: "Clay", cat: "styling", price: 9 });
    await setCustomProductActive(off.id, false);
    await query("insert into product_overrides (product_id, stock) values ($1, 'low'), ($2, 'out')", [onSale.id, off.id]);

    const ov = await getOverviewSummary(NOW);
    expect(ov.lowStock.total, "a product off sale must not be in the figure he acts on").toBe(1);
    expect(ov.lowStock.items.map((i) => i.id)).toEqual([onSale.id]);
    expect(ov.lowStock.hidden).toBe(1);   // before: 0 — and total 2
    expect(ov.lowStock.hiddenItems).toEqual([{ id: off.id, name: "Clay", brand: "Acme", stock: "out" }]);
  });

  it("a catalogue product hidden on its override row goes the same way", async () => {
    const [a, b] = CATALOGUE.filter((p) => p.s === "in");
    await query("insert into product_overrides (product_id, stock) values ($1, 'low')", [a.id]);
    await query("insert into product_overrides (product_id, stock, hidden) values ($1, 'out', true)", [b.id]);

    const ov = await getOverviewSummary(NOW);
    expect(ov.lowStock.items.map((i) => i.id)).toEqual([a.id]);
    expect(ov.lowStock.total).toBe(1);
    expect(ov.lowStock.hidden).toBe(1);
    expect(ov.lowStock.hiddenItems.map((i) => i.id)).toEqual([b.id]);
  });

  it("switched back on, the own product is one to re-order again", async () => {
    const p = await createCustomProduct({ brand: "Acme", name: "Clay", cat: "styling", price: 9 });
    await setCustomProductActive(p.id, false);
    await query("insert into product_overrides (product_id, stock) values ($1, 'low')", [p.id]);
    expect((await getOverviewSummary(NOW)).lowStock.hidden).toBe(1);
    await setCustomProductActive(p.id, true);
    const ov = await getOverviewSummary(NOW);
    expect(ov.lowStock.hidden).toBe(0);
    expect(ov.lowStock.items.map((i) => i.id)).toEqual([p.id]);
  });
});
