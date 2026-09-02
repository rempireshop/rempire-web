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
  const fuzz = FUZZ[pick];
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
