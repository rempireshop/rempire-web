#!/usr/bin/env node
/**
 * Generates the two PNG icons public/shop2/manifest.webmanifest points at,
 * from the brand badge (public/brand/rempire-badge-dark.svg — the dark mark
 * meant for a light background, which is exactly what an app-icon square
 * is). Not part of `prebuild`: the icons only need regenerating if the badge
 * artwork itself changes, unlike catalogue/content/migrations which change
 * on every edit — so this runs by hand, once.
 *
 *   node tools/gen-pwa-icons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const SRC = path.join(ROOT, "public", "brand", "rempire-badge-dark.svg");
const OUT_DIR = path.join(ROOT, "public", "shop2", "icons");

const SIZES = [192, 512];
/* The badge is wider than tall (835×717) — fit it inside a safe zone rather
   than stretch it, so it still reads correctly once a launcher masks the
   icon into a circle or a rounded square. */
const SAFE_ZONE = 0.72;

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`gen-pwa-icons: ${SRC} not found.`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const size of SIZES) {
    const inner = Math.round(size * SAFE_ZONE);
    const badge = await sharp(SRC, { density: 384 })
      .resize(inner, inner, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .toBuffer();
    const out = path.join(OUT_DIR, `icon-${size}.png`);
    await sharp({ create: { width: size, height: size, channels: 4, background: "#ffffff" } })
      .composite([{ input: badge, gravity: "center" }])
      .png()
      .toFile(out);
    console.log(`gen-pwa-icons: wrote ${path.relative(ROOT, out)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
