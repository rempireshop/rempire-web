#!/usr/bin/env node
/**
 * Generates every icon the three web manifests (public/shop2/*.webmanifest)
 * and index.html point at — from the tower mark exactly as the header draws
 * it: tower() in public/shop2/app.js, i.e. its TOWER_D path in its VB
 * viewBox, ink (#1c1a00) on a white square, well padded. Nothing is redrawn
 * here; the path is read out of app.js at run time so the app icon can never
 * drift from the logo on the page.
 *
 * Rendered with Playwright's Chromium (the same one the e2e suite uses), not
 * a separate rasteriser: an HTML page that inlines the SVG is screenshotted
 * at the icon's exact size, so the PNG is the header's own rendering of the
 * same path.
 *
 * Output, all in public/shop2/icons/:
 *   icon-192.png, icon-512.png             purpose "any": tower 62 % of the square
 *   icon-maskable-192.png, -512.png        purpose "maskable": tower 58 %, which keeps
 *                                          its whole diagonal inside the 80 % safe-zone
 *                                          circle a launcher may mask the icon to
 *   apple-touch-icon-180.png               iOS home screen (Safari rounds the corners)
 *   favicon-32.png                         tab icon for browsers that skip SVG favicons
 *   favicon.svg                            tab icon: transparent, ink; white in a dark UI
 *
 * Not part of `prebuild`: the icons only need regenerating if the mark itself
 * changes, so this runs by hand, once.
 *
 *   node tools/gen-pwa-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const APP = path.join(ROOT, "public", "shop2", "app.js");
const OUT_DIR = path.join(ROOT, "public", "shop2", "icons");

/* --ink in public/shop2/styles.css — the header draws the tower in currentColor */
const INK = "#1c1a00";

const PNGS = [
  { name: "icon-192.png", size: 192, tower: 0.62 },
  { name: "icon-512.png", size: 512, tower: 0.62 },
  { name: "icon-maskable-192.png", size: 192, tower: 0.58 },
  { name: "icon-maskable-512.png", size: 512, tower: 0.58 },
  { name: "apple-touch-icon-180.png", size: 180, tower: 0.62 },
  { name: "favicon-32.png", size: 32, tower: 0.84 },
];

function readTower() {
  const app = fs.readFileSync(APP, "utf8");
  const d = (app.match(/var TOWER_D = "([^"]+)"/) || [])[1];
  const vb = (app.match(/var VB = "([^"]+)"/) || [])[1];
  if (!d || !vb) {
    throw new Error("gen-pwa-icons: could not find TOWER_D / VB in public/shop2/app.js — the tower mark moved; point this tool at it.");
  }
  const [, , w, h] = vb.split(/\s+/).map(Number);
  return { d, vb, ratio: w / h };
}

/* The square: white page, the tower centred, `tower` of the square tall.
   Width follows from the viewBox ratio rather than `auto`, so the box is
   the same in every engine. */
function iconHTML({ d, vb, ratio }, size, tower) {
  const h = Math.round(size * tower);
  const w = Math.round(h * ratio);
  return '<!doctype html><html style="background:#fff"><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;width:' + size + 'px;height:' + size + 'px;display:grid;place-items:center;background:#fff">' +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '" width="' + w + '" height="' + h + '" style="display:block">' +
    '<path d="' + d + '" fill="' + INK + '"/></svg></body></html>';
}

/* The SVG favicon: the same mark on a transparent square, so it sits on
   whatever the tab strip is — and turns white when that strip is dark. */
function faviconSVG({ d, vb, ratio }) {
  const S = 64;
  const h = S * 0.84;
  const w = h * ratio;
  const x = (S - w) / 2;
  const y = (S - h) / 2;
  const n = (v) => v.toFixed(2).replace(/\.?0+$/, "");
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + S + ' ' + S + '" role="img" aria-label="REMPIRE">\n' +
    '  <style>@media (prefers-color-scheme: dark) { path { fill: #ffffff; } }</style>\n' +
    '  <svg x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) + '" viewBox="' + vb + '">\n' +
    '    <path d="' + d + '" fill="' + INK + '"/>\n' +
    '  </svg>\n' +
    '</svg>\n';
}

async function main() {
  const tower = readTower();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ deviceScaleFactor: 1, colorScheme: "light" });
    const page = await context.newPage();
    for (const { name, size, tower: frac } of PNGS) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(iconHTML(tower, size, frac));
      const out = path.join(OUT_DIR, name);
      await page.screenshot({ path: out, type: "png", clip: { x: 0, y: 0, width: size, height: size } });
      console.log(`gen-pwa-icons: wrote ${path.relative(ROOT, out)} (${size}x${size})`);
    }
  } finally {
    await browser.close();
  }

  const svgOut = path.join(OUT_DIR, "favicon.svg");
  fs.writeFileSync(svgOut, faviconSVG(tower));
  console.log(`gen-pwa-icons: wrote ${path.relative(ROOT, svgOut)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
