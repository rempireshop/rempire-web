#!/usr/bin/env node
/**
 * Does public/shop2/app.js carry the current src/lib/desc-format.mjs block?
 *
 *   node tools/sync-desc-format.mjs           say so; print the block to paste when it does not
 *   node tools/sync-desc-format.mjs --check   exit 1 when the copies differ
 *
 * The description renderer (headings, lists, bold — see the header of
 * src/lib/desc-format.mjs) is one block of code with three users: the shop's
 * own script, the prerender and the request-time product page. The shop's
 * script cannot import, so it carries a copy between the `desc-format`
 * markers. This tool only compares and prints: app.js is CRLF in a Windows
 * checkout and one stray CR flips the whole file's line endings in git, so
 * the copy is pasted by hand (an editor that keeps the file's line endings).
 * tests/desc-format.test.ts and the prerender refuse a stale copy.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { descFormatBlock } from "./lib/seo-copy-block.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const block = descFormatBlock(await readFile(path.join(ROOT, "src", "lib", "desc-format.mjs"), "utf8"));
if (block === null) throw new Error("src/lib/desc-format.mjs has lost its desc-format markers");
const now = descFormatBlock(await readFile(path.join(ROOT, "public", "shop2", "app.js"), "utf8"));
if (now === block) {
  console.log("sync-desc-format: app.js carries the current block");
  process.exit(0);
}
console.error("sync-desc-format: public/shop2/app.js's copy of src/lib/desc-format.mjs is " + (now === null ? "missing" : "out of date"));
if (!process.argv.includes("--check")) console.log(block);
process.exit(1);
