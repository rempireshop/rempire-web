/**
 * The files the shop fetches only when a screen needs one — perf, 09.10.2026.
 *
 * public/shop2/app.js fetches them itself (lazyFile, «the files the shop
 * fetches when it needs them»), with the ?v= token copied off its own tag, and
 * no tag in the shell names them any more. So three things have to stay true,
 * and nothing else would notice if one stopped being:
 *
 *   · every one of them is hashed into the shared token (LAZY_FILES in
 *     tools/lib/asset-token.mjs) — or a change to it ships behind an address
 *     browsers have been told to keep for a year;
 *   · app.js and that list name the same files;
 *   · the shell itself does not link them again.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LAZY_FILES, versionedAssets } from "../tools/lib/asset-token.mjs";

const ROOT = process.cwd();
const APP = readFileSync(path.join(ROOT, "public", "shop2", "app.js"), "utf8").replace(/\r\n?/g, "\n");
const SHELL = readFileSync(path.join(ROOT, "public", "shop2", "index.html"), "utf8").replace(/\r\n?/g, "\n");

/** The asset paths named inside app.js's lazy-file region. */
function lazyPathsInApp(): string[] {
  const from = APP.indexOf("  var LAZY = {}");
  const to = APP.indexOf("/* Cloudflare Web Analytics", from);
  expect(from, "app.js: the lazy-file region").toBeGreaterThan(0);
  expect(to, "app.js: the end of the lazy-file region").toBeGreaterThan(from);
  const region = APP.slice(from, to);
  return [...new Set([...region.matchAll(/"(\/shop2?\/[\w.-]+\.(?:js|css))"/g)].map((m) => m[1]))].sort();
}

describe("the files app.js fetches when a screen needs them", () => {
  it("are the files asset-token.mjs hashes into the shared token", () => {
    expect(lazyPathsInApp()).toEqual([...LAZY_FILES].sort());
  });

  it("are in the versioned set of the real shell, and the shell links none of them", () => {
    const urls = versionedAssets(SHELL);
    for (const file of LAZY_FILES) {
      expect(urls, file).toContain(file);
      // a tag would make every visitor download it again
      const tags = SHELL.replace(/<!--[\s\S]*?-->/g, "").match(new RegExp('(?:src|href)="' + file.replace(/[.]/g, "\\.") + "\\?", "g")) || [];
      if (!/\/shop2\/ui\.en\.js$/.test(file)) expect(tags, file).toEqual([]);
    }
  });

  it("exist — on disk, or as the build output of a file that does", () => {
    for (const file of LAZY_FILES) {
      const onDisk = existsSync(path.join(ROOT, "public", file));
      const built = /^\/shop2\/ui\.(?:et|en)\.js$/.test(file);
      expect(onDisk || built, file).toBe(true);
    }
  });
});
