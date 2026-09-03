#!/usr/bin/env node
/**
 * Writes src/data/catalogue.variants.json — the per-size price table the
 * server needs to price an order without trusting the browser.
 *
 * src/data/catalogue.min.json carries one price per product ("from 9 €"), but
 * 67 of the 220 products are sold in several sizes at very different prices
 * (75 ml 9 €, 500 ml 25 €). The full table lives in the generated storefront
 * catalogue; this pulls the two fields the order maths needs out of it.
 *
 *   node tools/build-catalogue-variants.mjs
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
  if (!Array.isArray(p.sizes) || p.sizes.length < 2) continue;
  const prices = Array.isArray(p.prices) ? p.prices : [];
  out[p.id] = {
    sizes: p.sizes,
    prices: p.sizes.map((_, i) => Number(prices[i] ?? p.price)),
  };
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`${OUT}: ${Object.keys(out).length} products with sizes (of ${catalogue.length}).`);
