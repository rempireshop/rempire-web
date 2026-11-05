/* The shop's photos for Google, where the shop's own are too narrow.

   From 31.01.2027 Merchant Center refuses a product whose main image
   (g:image_link) is under 500 × 500 px (mail of 04.11.2026, «Image too small
   for upcoming enforcement»). The shop's photos are cut-outs trimmed to the
   bottle, so a tall bottle is 320 × 900: tall enough, too narrow. 204 of the
   320 feed lines were like that on 05.11.2026.

   For every public/shop/img/*.webp with a side under 500 this writes
   public/shop/img/sq/<name>.jpg: the cut-out on a white square, the product
   at 90 % of the side (Google: 75–90 %), side = max(500, long side / 0.9) —
   so a photo is only ever enlarged when its long side is under 450. The feed
   (src/lib/merchant-feed.ts) sends that square as g:image_link; the site keeps
   showing the cut-out, and Google already shows every product in a square
   tile, so it looks the same there.

   src/data/feed-squares.json lists the names that have one — the feed reads
   that list, never the disk (a route reading public/ at run time gets nothing
   on Vercel unless it is traced). tests/feed-squares.test.ts fails when a
   photo under 500 has no square or a square has gone stale, so re-run this
   after adding or replacing a photo:

     node tools/feed-squares.mjs            (npm run feed:squares)
*/
import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMG = path.join(ROOT, "public", "shop", "img");
const SQ = path.join(IMG, "sq");
const LIST = path.join(ROOT, "src", "data", "feed-squares.json");

export const MIN_SIDE = 500;
export const FILL = 0.9;

/** The square for one photo: white ground, product centred at FILL of the side. */
export async function squareOf(buf) {
  const m = await sharp(buf).metadata();
  const long = Math.max(m.width, m.height);
  const side = Math.max(MIN_SIDE, Math.ceil(long / FILL));
  const target = Math.round(side * FILL);
  const scale = target / long;
  const w = Math.max(1, Math.round(m.width * scale));
  const h = Math.max(1, Math.round(m.height * scale));
  const fg = await sharp(buf).resize(w, h, { kernel: "lanczos3" }).flatten({ background: "#ffffff" }).toBuffer();
  return sharp({ create: { width: side, height: side, channels: 3, background: "#ffffff" } })
    .composite([{ input: fg, left: Math.round((side - w) / 2), top: Math.round((side - h) / 2) }])
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
}

async function main() {
  await mkdir(SQ, { recursive: true });
  const files = (await readdir(IMG)).filter((f) => f.endsWith(".webp")).sort();
  const names = [];
  for (const f of files) {
    const buf = await readFile(path.join(IMG, f));
    const m = await sharp(buf).metadata();
    if (m.width >= MIN_SIDE && m.height >= MIN_SIDE) continue;
    const name = f.replace(/\.webp$/, "");
    await writeFile(path.join(SQ, name + ".jpg"), await squareOf(buf));
    names.push(name);
  }
  /* a square whose photo is now big enough, or gone, goes too */
  for (const f of await readdir(SQ)) {
    if (!names.includes(f.replace(/\.jpg$/, ""))) await rm(path.join(SQ, f));
  }
  await writeFile(LIST, JSON.stringify(names, null, 1) + "\n", "utf8");
  console.log(`${names.length} of ${files.length} photos under ${MIN_SIDE} px → public/shop/img/sq/, list in src/data/feed-squares.json`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
