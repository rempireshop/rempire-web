/* Download and cut the photographs for the products added by
   build-catalogue-full.mjs. Source URLs come straight from the admin export
   (tools/harvest/new-images.json). Cosmetics get the same adaptive flood-fill
   sweep as refit-cutouts.mjs — per-image tolerance, stop at the cliff; merch
   keeps its frame (model shots) and is only resized. */

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const run = promisify(execFile);
const ROOT = "C:/Users/Dmitri.MARKIT/source/repos/rempire-web";
const IMGDIR = path.join(ROOT, "public", "shop", "img");
const WORK = "C:/Users/DMITRI~1.MAR/AppData/Local/Temp/claude/C--Users-Dmitri-MARKIT-source-repos-Rempire/d86fba33-c4c4-4dad-a0f6-a1d47ab1c4e3/scratchpad/cutout-new";
const FUZZ = [3, 5, 7, 9, 12];
const STEP_COST = 0.985;

/* Per-image escape hatch, the same one refit-cutouts.mjs and recut-classic.py
   carry — keyed `${slug}-${idx}`, and it wins over the sweep.

   A white flip-top cap on white paper defeats the cliff detector: STEP_COST is
   a budget against the WHOLE product, so eating a cap that is ~3% of the bottle
   costs ~1.1% a step, never trips it, and the sweep climbs to 9% and bites the
   top off (Renat, 13.09.2026: «у шампуней срезан верх бутылки»). Measured on
   the cached originals, cap-band fill of the top 12% of the object: fuzz 9
   (what shipped) 0.56-0.61 · fuzz 3 0.78-0.86 · source ~0.87. Every slug below
   is shot on pure white, where a 3% flood still clears the paper.

   Three further Paul Mitchell photographs were damaged too and are restored
   from the rembg-era blobs in git (6a9a649). They are deliberately NOT here:
   the sweep already picks 3 for all three, so no tolerance saves them —
   clear-essential-shampoo-0 and clear-jelly-mask-0 are shot on a grey gradient
   a 3% flood cannot clear, and curl-twirl-around-cream-serum-0 has a
   transparent cap the flood walks through at any tolerance. */
const OVERRIDE = Object.fromEntries([
  "paul-mitchell-awapuhi-conditioner-0",
  "paul-mitchell-awapuhi-shampoo-0",
  "paul-mitchell-clear-styling-glaze-0",
  "paul-mitchell-color-protect-conditioner-0",
  "paul-mitchell-color-protect-shampoo-0",
  "paul-mitchell-extra-body-daily-shampoo-0",
  "paul-mitchell-forever-blonde-conditioner-0",
  "paul-mitchell-forever-blonde-shampoo-0",
  "paul-mitchell-shampoo-two-0",
  "paul-mitchell-sheer-hydration-conditioner-0",
  "paul-mitchell-sheer-hydration-shampoo-0",
  "paul-mitchell-super-smooth-conditioner-0",
  "paul-mitchell-super-smooth-shampoo-0"
].map(k => [k, 3]));

const manifest = JSON.parse(await readFile(path.join(ROOT, "tools/harvest/new-images.json"), "utf8"));
const catSrc = await readFile(path.join(ROOT, "public/shop/catalogue2.js"), "utf8");
const CATALOGUE = new Function(catSrc + "\nreturn CATALOGUE;")();
const catOf = new Map(CATALOGUE.map(p => [p.id, p.cat]));

await mkdir(WORK, { recursive: true });

async function opaqueAt(tmp, corner, fuzz) {
  const { stdout } = await run("magick", [
    tmp, "-alpha", "set", "-bordercolor", corner, "-border", "2",
    "-channel", "RGBA", "-fuzz", `${fuzz}%`, "-fill", "none",
    "-floodfill", "+0+0", corner, "+channel",
    "-shave", "2x2", "-alpha", "extract", "-format", "%[fx:mean*w*h]", "info:"
  ]);
  return Number(stdout.trim());
}

const jobs = [];
for (const [slug, urls] of Object.entries(manifest)) {
  urls.forEach((url, idx) => jobs.push({ slug, idx, url, merch: catOf.get(slug) === "merch" }));
}
console.error(`${jobs.length} images`);

const report = [];
async function one(j) {
  const dest = path.join(IMGDIR, `${j.slug}-${j.idx}.webp`);
  try { await stat(dest); report.push({ ...j, status: "exists" }); return; } catch (e) {}
  const tmp = path.join(WORK, `${j.slug}-${j.idx}.src`);
  try { await stat(tmp); } catch (e) {
    const u = j.url.replace(/(\?|&)width=\d+/, "") + (j.url.includes("?") ? "&" : "?") + "width=1200";
    const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!r.ok) { report.push({ ...j, status: `http ${r.status}` }); return; }
    await writeFile(tmp, Buffer.from(await r.arrayBuffer()));
  }
  if (j.merch) {
    await run("magick", [tmp, "-resize", "900x900>", "-quality", "86", dest]);
    report.push({ ...j, status: "resized" });
    return;
  }
  const { stdout: cornerOut } = await run("magick", [tmp, "-format", "%[pixel:p{2,2}]", "info:"]);
  const corner = cornerOut.trim();
  const counts = [];
  for (const f of FUZZ) counts.push(await opaqueAt(tmp, corner, f));
  let pick = 0;
  for (let i = 1; i < FUZZ.length; i++) {
    if (counts[i] >= counts[i - 1] * STEP_COST) pick = i; else break;
  }
  const fuzz = OVERRIDE[`${j.slug}-${j.idx}`] || FUZZ[pick];
  await run("magick", [
    tmp, "-alpha", "set", "-bordercolor", corner, "-border", "2",
    "-channel", "RGBA", "-fuzz", `${fuzz}%`, "-fill", "none",
    "-floodfill", "+0+0", corner, "+channel",
    "-shave", "2x2", "-trim", "+repage",
    "-bordercolor", "none", "-border", "24",
    "-resize", "900x900>", "-quality", "86", dest
  ]);
  report.push({ ...j, status: "cut", fuzz });
}

let done = 0;
const POOL = 6;
async function worker() {
  while (jobs.length) {
    const j = jobs.shift();
    try { await one(j); } catch (e) { report.push({ ...j, status: "err " + e.message.slice(0, 80) }); }
    done++;
    if (done % 20 === 0) console.error(`  ${done}`);
  }
}
await Promise.all(Array.from({ length: POOL }, worker));

const bad = report.filter(r => !/^(cut|resized|exists)$/.test(r.status));
console.log(JSON.stringify({
  total: report.length,
  cut: report.filter(r => r.status === "cut").length,
  resized: report.filter(r => r.status === "resized").length,
  exists: report.filter(r => r.status === "exists").length,
  failed: bad.map(r => `${r.slug}-${r.idx}: ${r.status}`)
}, null, 1));
