#!/usr/bin/env node
/**
 * Writes public/shop/legal.js from public/shop/legal.ru.js.
 *
 *   node tools/sync-legal-fallback.mjs           # rewrite legal.js
 *   node tools/sync-legal-fallback.mjs --check   # exit 1 if it is out of step
 *
 * legal.js is `var LEGAL = {slug: {title, html}}` and three things read it:
 *
 *   · the list of policy pages. public/shop2/app.js routes /shop2/info/<slug>/
 *     only when LEGAL[slug] exists; tools/prerender-shop2.mjs writes one page
 *     per key; tools/pack-legal.mjs copies the keys into
 *     src/data/legal-slugs.json for the 404 page and the middleware;
 *   · the Russian titles the ET/EN headings are translated from where a
 *     language file has no title of its own;
 *   · the last resort: legalFor() falls back to LEGAL when the visitor's
 *     language has no page of its own. legal.ru.js, legal.et.js and
 *     legal.en.js carry every slug, so today that is only a language code
 *     the shop does not know (a stale value in the browser's storage).
 *
 * Until 27.09.2026 it was the policy text harvested from the old Shopify store
 * — English bodies under Russian titles, and a privacy policy naming Shopify
 * as the data processor 22 times — and every page of the shop loaded it
 * (audit 27.09.2026, G8). It is now the shop's own Russian pages, which name
 * the processors this shop really uses. Russian, because it is the language
 * the rest of the interface falls back to as well.
 *
 * One source, so the two cannot drift: edit legal.ru.js, run this, commit both.
 * tests/content.test.ts fails if they differ. Not part of the build — a build
 * that rewrites committed files is how a deploy ships something nobody
 * reviewed.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOP = path.join(HERE, "..", "public", "shop");
export const SRC = path.join(SHOP, "legal.ru.js");
export const OUT = path.join(SHOP, "legal.js");

const HEADER =
  "/* LEGAL — the shop's policy pages in Russian: the list of pages the router\n" +
  "   knows, the titles other languages translate, and the last-resort text.\n" +
  "   WRITTEN BY tools/sync-legal-fallback.mjs from public/shop/legal.ru.js,\n" +
  "   word for word — edit legal.ru.js and run it; tests/content.test.ts fails\n" +
  "   if the two differ. That tool's header says who reads this file and why\n" +
  "   it is no longer the text harvested from the old store (audit 27.09.2026,\n" +
  "   G8). */\n";

/** The object a `var NAME = {…};` file defines, evaluated the way every reader of it does. */
export function readVar(file, name) {
  return new Function(fs.readFileSync(file, "utf8") + "\nreturn " + name + ";")();
}

/** What legal.js must contain, byte for byte. */
export function legalFallbackSource(ru = readVar(SRC, "LEGAL_RU")) {
  if (!ru || typeof ru !== "object" || Array.isArray(ru) || !Object.keys(ru).length) {
    throw new Error("sync-legal-fallback: LEGAL_RU in public/shop/legal.ru.js is not an object of slug → page");
  }
  for (const [slug, page] of Object.entries(ru)) {
    if (!/^[a-z]+$/.test(slug)) throw new Error(`sync-legal-fallback: ${JSON.stringify(slug)} is not a slug the router can match`);
    if (!page || typeof page.title !== "string" || typeof page.html !== "string") {
      throw new Error(`sync-legal-fallback: LEGAL_RU.${slug} has no title/html`);
    }
  }
  return HEADER + "var LEGAL = " + JSON.stringify(ru) + ";\n";
}

function main() {
  const want = legalFallbackSource();
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : "";
  if (process.argv.includes("--check")) {
    if (have !== want) {
      console.error("public/shop/legal.js is out of step with legal.ru.js — run: node tools/sync-legal-fallback.mjs");
      process.exit(1);
    }
    console.log("public/shop/legal.js matches legal.ru.js.");
    return;
  }
  if (have === want) {
    console.log("public/shop/legal.js already matches legal.ru.js — nothing written.");
    return;
  }
  fs.writeFileSync(OUT, want, "utf8");
  console.log(`public/shop/legal.js written from legal.ru.js (${want.length} characters). Retokenise public/shop2/index.html.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
