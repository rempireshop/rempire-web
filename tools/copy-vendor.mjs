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
const SRC = path.join(ROOT, "node_modules", "leaflet", "dist");
const OUT = path.join(ROOT, "public", "vendor", "leaflet");

if (!fs.existsSync(SRC)) {
  console.warn("copy-vendor: node_modules/leaflet not found — run `npm i leaflet` first. Skipping (map view will lazy-load nothing until then).");
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, "images"), { recursive: true });

/* Only the built, minified UMD bundle and its stylesheet — not the ESM build,
   not the source maps, not the layer-switcher icons the shop's map never
   shows. Just the five marker/shadow images leaflet.css itself references by
   a relative `images/...` URL, which is why they have to land in an `images`
   folder next to it and not loose in the vendor root. */
const FILES = [
  ["leaflet.js", "."],
  ["leaflet.css", "."],
  [path.join("images", "marker-icon.png"), "images"],
  [path.join("images", "marker-icon-2x.png"), "images"],
  [path.join("images", "marker-shadow.png"), "images"]
];

let copied = 0;
for (const [rel] of FILES) {
  const from = path.join(SRC, rel);
  const to = path.join(OUT, rel);
  if (!fs.existsSync(from)) {
    console.warn("copy-vendor: missing " + rel + " in node_modules/leaflet/dist — leaflet's own layout may have changed.");
    continue;
  }
  fs.copyFileSync(from, to);
  copied++;
}

console.log("copy-vendor: " + copied + "/" + FILES.length + " leaflet files copied to public/vendor/leaflet/");
