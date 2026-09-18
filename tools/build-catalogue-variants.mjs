#!/usr/bin/env node
/**
 * Writes src/data/catalogue.variants.json — the per-size table the server
 * needs to price, count and validate an order without trusting the browser.
 *
 * src/data/catalogue.min.json carries one price per product ("from 9 €"), but
 * 67 of the 220 products are sold in several sizes at very different prices
 * (75 ml 9 €, 500 ml 25 €), and another 29 are sold in exactly one NAMED size
 * ("250 мл") whose label the shop puts on the product page, on the cart line
 * and on the shelf row. The full table lives in the generated storefront
 * catalogue; this pulls the two fields the order maths needs out of it.
 *
 *   node tools/build-catalogue-variants.mjs
 *
 * Every product with at least one labelled size goes in, one rung or nine.
 * This was a `sizes.length < 2` skip until 18.09.2026, back when the file was
 * only a price table and one rung had no price to disagree with the base. It
 * has since become the server's size LADDER of record — catalogueUniverse()
 * in src/lib/inventory.ts builds «Склад» from it, variantOf() in
 * src/lib/orders.ts refuses a size that is not on it — and a skipped rung
 * meant the server believed 29 products had no sizes at all while the panel
 * bound barcodes and wrote counts under their labels: two shelf rows per
 * product, one of them empty. tests/catalogue-variants.test.ts compares the
 * two files rung for rung so the halves cannot drift apart again.
 *
 * Re-run after tools/build-catalogue-full.mjs. Source and output are both
 * generated files — do not hand-edit either.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "public", "shop", "catalogue2.js");
const OUT = path.join(ROOT, "src", "data", "catalogue.variants.json");

const js = fs.readFileSync(SRC, "utf8");
const match = js.match(/const CATALOGUE = (\[[\s\S]*?\n\]);/);
if (!match) {
  console.error(`Could not find the CATALOGUE array in ${SRC}`);
  process.exit(1);
}

const catalogue = JSON.parse(match[1]);
const out = {};
for (const p of catalogue) {
  /* An unlabelled rung is «один объём» — the product has no sizes, and the
     server says so by having no entry here at all (knownLadder() in
     src/lib/inventory.ts, variantOf() in src/lib/orders.ts). Writing it in
     would be an entry that means nothing its absence does not mean. */
  if (!Array.isArray(p.sizes) || !p.sizes.some((s) => String(s ?? "").trim())) continue;
  const prices = Array.isArray(p.prices) ? p.prices : [];
  out[p.id] = {
    sizes: p.sizes,
    prices: p.sizes.map((_, i) => Number(prices[i] ?? p.price)),
  };
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`${OUT}: ${Object.keys(out).length} products with sizes (of ${catalogue.length}).`);
