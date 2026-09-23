#!/usr/bin/env node
/* Writes src/data/catalogue.feed.json — the photos and the plain-text
   descriptions the Google Merchant Center feed needs and cannot read from
   public/ at run time. Why, and what is in it: tools/lib/feed-data.mjs.

     node tools/pack-feed.mjs

   Runs in `prebuild`, so a deployment always carries the texts and photos of
   the catalogue it ships. Idempotent: the file is only rewritten when its
   content would change. Re-run by hand after tools/build-catalogue-full.mjs
   or after editing public/shop/content*.js — tests/merchant-feed.test.ts
   says so when it has been forgotten. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFeedData, serialiseFeedData } from "./lib/feed-data.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "data", "catalogue.feed.json");

const data = buildFeedData(ROOT);
const text = serialiseFeedData(data);
const before = existsSync(OUT) ? readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : null;
const ids = Object.keys(data);
const noText = ids.filter((id) => !data[id].d.EN && !data[id].d.RU && !data[id].d.ET).length;
if (before === text) {
  console.log(`pack-feed: ${path.relative(ROOT, OUT)} unchanged (${ids.length} products)`);
} else {
  writeFileSync(OUT, text, "utf8");
  console.log(`pack-feed: wrote ${path.relative(ROOT, OUT)} — ${ids.length} products, ${noText} without any text, ${Math.round(text.length / 1024)} KB`);
}
