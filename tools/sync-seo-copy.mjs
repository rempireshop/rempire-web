#!/usr/bin/env node
/**
 * src/lib/seo-copy.mjs → public/shop2/app.js
 *
 *   node tools/sync-seo-copy.mjs           copy the block into app.js
 *   node tools/sync-seo-copy.mjs --check   exit 1 if app.js's copy differs
 *
 * The titles, meta descriptions and link-preview texts of the home page, the
 * sections, the brands, the blog list and the product-title rule live in
 * src/lib/seo-copy.mjs. The prerender and the request-time pages import it;
 * the shop's own script cannot import anything, so it carries a copy of the
 * block between the `seo-copy` markers. Edit the module, then run this. The
 * prerender refuses to write pages while the two differ, and
 * tests/seo-copy.test.ts fails.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { seoCopyBlock, spliceSeoCopyBlock } from "./lib/seo-copy-block.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src", "lib", "seo-copy.mjs");
const APP = path.join(ROOT, "public", "shop2", "app.js");

const block = seoCopyBlock(await readFile(SRC, "utf8"));
if (block === null) throw new Error("src/lib/seo-copy.mjs has lost its seo-copy markers");
const app = await readFile(APP, "utf8");
const now = seoCopyBlock(app);
if (now === block) {
  console.log("sync-seo-copy: app.js already carries the current block");
  process.exit(0);
}
if (process.argv.includes("--check")) {
  console.error("sync-seo-copy: public/shop2/app.js's copy of src/lib/seo-copy.mjs is out of date — run node tools/sync-seo-copy.mjs");
  process.exit(1);
}
await writeFile(APP, spliceSeoCopyBlock(app, block), "utf8");
console.log("sync-seo-copy: app.js updated (" + block.split("\n").length + " lines)");
