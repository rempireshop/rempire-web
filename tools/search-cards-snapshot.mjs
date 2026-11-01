#!/usr/bin/env node
/**
 * Copies the live shop's search cards (/shop/search-terms.json, written by
 * tools/pack-search-cards.mjs on every production build) into
 * tests/fixtures/search-terms.json, so the search tests and the bench measure
 * the search with the cards the shoppers actually get.
 *
 *   npm run cards:snapshot            from https://rempireshop.com
 *   npm run cards:snapshot -- <base>  from another deployment
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = (process.argv[2] || "https://rempireshop.com").replace(/\/+$/, "");
const r = await fetch(base + "/shop/search-terms.json");
if (!r.ok) {
  console.error(`cards:snapshot: ${base} answered ${r.status}`);
  process.exit(1);
}
const j = await r.json();
if (!j || !j.c || !Array.isArray(j.ids)) {
  console.error("cards:snapshot: not a search-terms file");
  process.exit(1);
}
writeFileSync(join(ROOT, "tests/fixtures/search-terms.json"), JSON.stringify(j));
console.log(`cards:snapshot: ${Object.keys(j.c).length} cards, ${Object.keys(j.a || {}).length} answers, built ${j.built}`);
