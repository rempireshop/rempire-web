#!/usr/bin/env node
/**
 * public/shop2/app.js → public/shop2/app.min.js — the file the shop links.
 * `node tools/minify-shop2.mjs`, and automatically from `prebuild`, `predev`
 * and tools/e2e-build.mjs.
 *
 * ---- why ----------------------------------------------------------------
 *
 * app.js is one plain <script src> at the bottom of public/shop2/index.html,
 * and it is the whole shop: storefront and admin panel, 1.92 MB of source. No
 * screen exists until the browser has downloaded, parsed and run all of it,
 * so every byte of it is on the critical path of every page — the admin panel
 * most of all, which is what the owner opens twenty times a day. A quarter of
 * those bytes are comment prose written for people, and they cost the same
 * over the wire as code. Measured 09.09.2026, brotli -q11:
 *
 *     public/shop2/app.js       1 971 012 B on disk, 398 951 B compressed
 *     public/shop2/app.min.js   1 344 153 B on disk, 246 306 B     −38 %
 *
 * The transform is comments and indentation only — tools/lib/js-strip.mjs
 * says why it stops there and why the line breaks stay.
 *
 * ---- why the output is not committed ------------------------------------
 *
 * It is derived, and a derived file in git is a derived file that goes stale:
 * somebody edits app.js, forgets the tool, and the deploy serves last week's
 * code from a cached-looking address — which is exactly the failure this
 * repository already paid for once (tools/lib/asset-token.mjs, 06.09.2026).
 * So app.min.js is gitignored and rebuilt by every build, and the ?v= token
 * is derived from app.js, the source — assetToken() strips it in memory when
 * the built file is not on disk, so a fresh checkout and a built tree agree
 * about the token without the built file existing. See asset-token.mjs.
 *
 * ---- what this refuses to write -----------------------------------------
 *
 * Two checks, because a stripper that eats a byte of code ships a shop that
 * does not start:
 *
 *   · the output must parse — `new vm.Script`, the same parser that will run
 *     it, with no execution;
 *   · the output's literals must be the source's literals, in order and
 *     verbatim. Every string the shop prints, every regex it matches with,
 *     unchanged. This is the check that catches the one thing the scanner can
 *     get wrong: a `/` read as division where a regex was meant (or the other
 *     way round), which would take a slice of a pattern with it.
 *
 * A failure here fails the build. There is no half-written output: the file
 * is only written once both checks have passed.
 */
import { readFile, writeFile } from "node:fs/promises";
import { brotliCompressSync, constants } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { literals, stripJs } from "./lib/js-strip.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "public", "shop2", "app.js");
const OUT = path.join(ROOT, "public", "shop2", "app.min.js");

const source = await readFile(SRC, "utf8");
const built = stripJs(source);

try {
  new vm.Script(built, { filename: "app.min.js" });
} catch (e) {
  console.error("minify-shop2: the stripped file does not parse — " + e.message);
  console.error("public/shop2/app.min.js NOT written. tools/lib/js-strip.mjs is wrong about something in app.js.");
  process.exit(1);
}

const was = literals(String(source).replace(/\r\n?/g, "\n"));
const now = literals(built);
if (was.length !== now.length || was.some((v, i) => v !== now[i])) {
  const i = was.findIndex((v, k) => v !== now[k]);
  console.error("minify-shop2: the stripped file's literals are not app.js's literals.");
  console.error(`  ${was.length} in the source, ${now.length} in the output; first difference at #${i}:`);
  console.error("  source: " + JSON.stringify(String(was[i]).slice(0, 120)));
  console.error("  output: " + JSON.stringify(String(now[i]).slice(0, 120)));
  console.error("public/shop2/app.min.js NOT written.");
  process.exit(1);
}

await writeFile(OUT, built, "utf8");

/* Brotli at -q11 is what a static CDN stores; it is the number worth printing
   because it is the one a shopper's phone actually pulls down. */
const br = (b) =>
  brotliCompressSync(Buffer.from(b), {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: Buffer.byteLength(b) },
  }).length;
const kb = (n) => (n / 1024).toFixed(1) + " KB";
const from = String(source).replace(/\r\n?/g, "\n");
console.log(
  `minify-shop2: app.js ${kb(Buffer.byteLength(from))} → app.min.js ${kb(Buffer.byteLength(built))}` +
    `   (brotli ${kb(br(from))} → ${kb(br(built))}, −${Math.round((1 - br(built) / br(from)) * 100)}%)`,
);
