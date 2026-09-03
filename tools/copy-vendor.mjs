/* Copies the parts of node_modules/leaflet that the browser actually needs
   into public/vendor/leaflet/, so the parcel-machine map (UX fix 8,
   public/shop2/app.js, "Карта" toggle in the pakomat picker) can load it as a
   same-origin <script src> / <link> — /shop2/ ships `script-src 'self'`
   (next.config.ts), so a CDN script tag would simply be blocked.

   Runs in `prebuild`, before the prerender; idempotent, and safe to skip if
   leaflet is not installed (a fresh checkout that has not run `npm install`
   yet should not fail prebuild over a map nobody has opened). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

/** Copies a fixed file list from `srcDir` to `outDir`, skipping (and warning
 *  about, never failing the build over) anything missing on either side. */
function copyFiles(label, srcDir, outDir, files) {
  if (!fs.existsSync(srcDir)) {
    console.warn(`copy-vendor: ${srcDir} not found — run \`npm i\` first. Skipping ${label} (it will lazy-load nothing until then).`);
    return;
  }
  for (const [, destDir] of files) fs.mkdirSync(path.join(outDir, destDir), { recursive: true });

  let copied = 0;
  for (const [rel] of files) {
    const from = path.join(srcDir, rel);
    const to = path.join(outDir, rel);
    if (!fs.existsSync(from)) {
      console.warn(`copy-vendor: missing ${rel} under ${srcDir} — ${label}'s own layout may have changed.`);
      continue;
    }
    fs.copyFileSync(from, to);
    copied++;
  }
  console.log(`copy-vendor: ${copied}/${files.length} ${label} files copied to ${path.relative(ROOT, outDir)}/`);
}

/* leaflet: the parcel-machine map (UX fix 8, public/shop2/app.js, "Карта"
   toggle in the pakomat picker) as a same-origin <script src> / <link> —
   /shop2/ ships `script-src 'self'` (next.config.ts), so a CDN script tag
   would simply be blocked.

   Only the built, minified UMD bundle and its stylesheet — not the ESM
   build, not the source maps, not the layer-switcher icons the shop's map
   never shows. Just the five marker/shadow images leaflet.css itself
   references by a relative `images/...` URL, which is why they have to land
   in an `images` folder next to it and not loose in the vendor root. */
copyFiles(
  "leaflet",
  path.join(ROOT, "node_modules", "leaflet", "dist"),
  path.join(ROOT, "public", "vendor", "leaflet"),
  [
    ["leaflet.js", "."],
    ["leaflet.css", "."],
    [path.join("images", "marker-icon.png"), "images"],
    [path.join("images", "marker-icon-2x.png"), "images"],
    [path.join("images", "marker-shadow.png"), "images"],
  ],
);

/* zxing: the barcode scanner's fallback decoder for browsers with no native
   BarcodeDetector (iOS Safari) — inventory agent, public/shop2/app.js
   scanner screen. Same CSP reason as leaflet: same-origin only. One
   self-contained UMD file (it bundles @zxing/library itself, global
   `ZXingBrowser`), lazy-loaded only when the camera scanner actually opens —
   see openScanner() in app.js. No stylesheet, no source map. */
copyFiles(
  "zxing",
  path.join(ROOT, "node_modules", "@zxing", "browser", "umd"),
  path.join(ROOT, "public", "vendor", "zxing"),
  [["zxing-browser.min.js", "."]],
);
