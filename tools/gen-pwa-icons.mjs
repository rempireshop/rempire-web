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
 *   badge-96.png                           the status-bar mark on an Android push
 *   favicon.svg                            tab icon: transparent, ink; white in a dark UI
 *
 * And two at the site root, public/, for whoever asks the root without
 * reading the page's <link> tags — a browser opening a feed or an image
 * directly, Bing, link previews, a browser's history that still holds
 * Shopify's «R» (it 404'd here until 09.10.2026):
 *   favicon.ico                            16, 32 and 48 px, PNG inside, white square
 *   apple-touch-icon.png                   the same 180 px square as above
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
const ROOT_DIR = path.join(ROOT, "public");

/* The sizes inside /favicon.ico — a tab, a high-density tab, Windows/Google */
const ICO_SIZES = [16, 32, 48];

/* --ink in public/shop2/styles.css — the header draws the tower in currentColor */
const INK = "#1c1a00";

const PNGS = [
  { name: "icon-192.png", size: 192, tower: 0.62 },
  { name: "icon-512.png", size: 512, tower: 0.62 },
  { name: "icon-maskable-192.png", size: 192, tower: 0.58 },
  { name: "icon-maskable-512.png", size: 512, tower: 0.58 },
  { name: "apple-touch-icon-180.png", size: 180, tower: 0.62 },
  { name: "favicon-32.png", size: 32, tower: 0.84 },
  /* The push notification's `badge` — the little mark in the status bar,
     NOT the icon inside the notification. Android draws it from the ALPHA
     CHANNEL alone: it silhouettes whatever it is given and tints the result.
     An ordinary app icon is opaque across the whole square, so its silhouette
     IS the square — which is why the first push Renat got showed a white
     block and only turned into a tower when he opened it (21.09.2026).
     Transparent ground, therefore, and a shape that reads at 24dp: bigger
     than the app icon's 62 %, because there is no white square around it to
     give it room. 96px covers xxhdpi. */
  { name: "badge-96.png", size: 96, tower: 0.86, clear: true },
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
function iconHTML({ d, vb, ratio }, size, tower, clear) {
  const h = Math.round(size * tower);
  const w = Math.round(h * ratio);
  /* White on nothing for a badge: Android replaces the colour anyway, and the
     one consumer that does NOT tint draws it on a dark system bar. */
  const bg = clear ? "transparent" : "#fff";
  const fill = clear ? "#ffffff" : INK;
  return '<!doctype html><html style="background:' + bg + '"><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;width:' + size + 'px;height:' + size + 'px;display:grid;place-items:center;background:' + bg + '">' +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '" width="' + w + '" height="' + h + '" style="display:block">' +
    '<path d="' + d + '" fill="' + fill + '"/></svg></body></html>';
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

/* An .ico is a directory of images; each may be a whole PNG file (every
   browser since IE 11 reads that), so no BMP encoding is needed. */
function packIco(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, at);
    head.writeUInt8(size >= 256 ? 0 : size, at + 1);
    head.writeUInt16LE(1, at + 4);
    head.writeUInt16LE(32, at + 6);
    head.writeUInt32LE(data.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

async function main() {
  const tower = readTower();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ deviceScaleFactor: 1, colorScheme: "light" });
    const page = await context.newPage();
    for (const { name, size, tower: frac, clear } of PNGS) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(iconHTML(tower, size, frac, clear));
      const out = path.join(OUT_DIR, name);
      await page.screenshot({
        path: out, type: "png", omitBackground: !!clear,
        clip: { x: 0, y: 0, width: size, height: size },
      });
      console.log(`gen-pwa-icons: wrote ${path.relative(ROOT, out)} (${size}x${size})`);
    }
    /* favicon-32.png's proportions at every size of the root .ico */
    const icoPngs = [];
    for (const size of ICO_SIZES) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(iconHTML(tower, size, 0.84, false));
      icoPngs.push({ size, data: await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: size, height: size } }) });
    }
    const icoOut = path.join(ROOT_DIR, "favicon.ico");
    fs.writeFileSync(icoOut, packIco(icoPngs));
    console.log(`gen-pwa-icons: wrote ${path.relative(ROOT, icoOut)} (${ICO_SIZES.join("/")})`);
    const touchOut = path.join(ROOT_DIR, "apple-touch-icon.png");
    fs.copyFileSync(path.join(OUT_DIR, "apple-touch-icon-180.png"), touchOut);
    console.log(`gen-pwa-icons: wrote ${path.relative(ROOT, touchOut)} (180x180)`);
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
