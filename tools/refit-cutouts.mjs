/* Re-cut the product photographs with a per-image flood tolerance.

   The catalogue build stripped every backing with one fixed `-fuzz 9%` flood
   from the corner. That is fine for a dark bottle on white, and wrong for a
   pale one: on Kevin.Murphy Powder.Puff — a near-white bottle on white — the
   flood found a light seam at the edge, walked inside and ate a crescent out
   of the product. The only guard was "did this empty the image", which a bite
   that leaves 80% of the bottle standing sails straight past.

   Removing background is monotonic in fuzz: raising it can only take more
   pixels. So sweep the tolerance and watch what each step costs. Clearing the
   JPEG halo around a clean edge costs very little; breaching the product costs
   a lot at once. Climb while each step is cheap and stop at the cliff, per
   image, instead of picking one number for ninety-five photographs. */

import { writeFile, mkdir, readFile, stat, rm, copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const run = promisify(execFile);
const ROOT = "C:/Users/Dmitri.MARKIT/source/repos/rempire-web/public";
const IMGDIR = path.join(ROOT, "shop", "img");
const WORK = "C:/Users/DMITRI~1.MAR/AppData/Local/Temp/claude/C--Users-Dmitri-MARKIT-source-repos-Rempire/d86fba33-c4c4-4dad-a0f6-a1d47ab1c4e3/scratchpad/cutout-work";
const FUZZ = [3, 5, 7, 9, 12];
const STEP_COST = 0.985;   // a step may cost 1.5% of the standing product
/* Three photographs are shot on a grey reflective surface rather than white
   paper, so the drop the sweep sees is the backdrop leaving, not the product
   being breached — and stopping short of it keeps a slab of grey behind the
   product. Checked each by eye against the alternative; these want the old
   tolerance. */
const OVERRIDE = {
  "creed-creed-aventus-cologne-50ml-0": 9,
  "handmade-soap-666-0": 9,
  "handmade-soap-rule-nr-1-0": 9
};
const ONLY = process.argv.slice(2).filter(a => !a.startsWith("-"));
const APPLY = process.argv.includes("--apply");

const src = await readFile(path.join(ROOT, "shop", "catalogue.js"), "utf8");
const CATALOGUE = new Function(src + "\nreturn CATALOGUE;")();

await mkdir(WORK, { recursive: true });

/* Every image the catalogue points at, minus merch: those are model shots kept
   with their frame, and cropping one leaves a floating torso. */
const wanted = new Map();     // file -> {slug, idx}
for (const p of CATALOGUE) {
  if (p.cat === "merch") continue;
  const files = [p.img].concat(p.imgs || []).filter(Boolean);
  for (const f of files) {
    const m = String(f).match(/\/shop\/img\/(.+)-(\d+)\.webp$/);
    if (m && !wanted.has(f)) wanted.set(f, { slug: m[1], idx: Number(m[2]) });
  }
}

const handles = new Map();
async function imageSrc(slug, idx) {
  if (!handles.has(slug)) {
    let images = null;
    try {
      const r = await fetch(`https://rempireshop.com/products/${slug}.json`, {
        headers: { "user-agent": "Mozilla/5.0" }
      });
      if (r.ok) images = (await r.json()).product.images.map(i => i.src);
    } catch (e) { /* recorded as a miss below */ }
    handles.set(slug, images);
  }
  const imgs = handles.get(slug);
  return imgs && imgs[idx] ? imgs[idx] : null;
}

/* Opaque pixels left after flooding at this tolerance, measured before the
   trim so every tolerance is counted on the same canvas. */
async function opaqueAt(tmp, corner, fuzz) {
  const { stdout } = await run("magick", [
    tmp, "-alpha", "set", "-bordercolor", corner, "-border", "2",
    "-channel", "RGBA", "-fuzz", `${fuzz}%`, "-fill", "none",
    "-floodfill", "+0+0", corner, "+channel",
    "-shave", "2x2", "-alpha", "extract", "-format", "%[fx:mean*w*h]", "info:"
  ]);
  return Number(stdout.trim());
}

const report = [];
let n = 0;
for (const [rel, { slug, idx }] of wanted) {
  n++;
  if (ONLY.length && !ONLY.includes(slug)) continue;
  const url = await imageSrc(slug, idx);
  if (!url) { report.push({ slug, idx, status: "no source" }); continue; }

  const tmp = path.join(WORK, `${slug}-${idx}.jpg`);
  try { await stat(tmp); } catch (e) {
    const r = await fetch(url.replace(/(\?|&)width=\d+/, "") + (url.includes("?") ? "&" : "?") + "width=1200",
      { headers: { "user-agent": "Mozilla/5.0" } });
    if (!r.ok) { report.push({ slug, idx, status: `http ${r.status}` }); continue; }
    await writeFile(tmp, Buffer.from(await r.arrayBuffer()));
  }

  const { stdout: cornerOut } = await run("magick", [tmp, "-format", "%[pixel:p{2,2}]", "info:"]);
  const corner = cornerOut.trim();

  const counts = [];
  for (const f of FUZZ) counts.push(await opaqueAt(tmp, corner, f));

  let pick = 0;
  for (let i = 1; i < FUZZ.length; i++) {
    if (counts[i] >= counts[i - 1] * STEP_COST) pick = i; else break;
  }
  const fuzz = OVERRIDE[`${slug}-${idx}`] || FUZZ[pick];
  // what the shipped 9% flood cost against the tolerance we would now choose
  const lost = counts[pick] ? 1 - counts[FUZZ.indexOf(9)] / counts[pick] : 0;

  report.push({
    slug, idx, fuzz, lostAt9: +(lost * 100).toFixed(1),
    counts: counts.map(c => Math.round(c / 1000))
  });

  if (APPLY) {
    const dest = path.join(IMGDIR, `${slug}-${idx}.webp`);
    await run("magick", [
      tmp, "-alpha", "set", "-bordercolor", corner, "-border", "2",
      "-channel", "RGBA", "-fuzz", `${fuzz}%`, "-fill", "none",
      "-floodfill", "+0+0", corner, "+channel",
      "-shave", "2x2", "-trim", "+repage",
      "-bordercolor", "none", "-border", "24",
      "-resize", "900x900>", "-quality", "86", dest
    ]);
  }
  if (n % 10 === 0) console.error(`  ${n}/${wanted.size}`);
}

const bitten = report.filter(r => r.lostAt9 >= 2).sort((a, b) => b.lostAt9 - a.lostAt9);
console.log(JSON.stringify({
  images: report.length,
  applied: APPLY,
  bitten: bitten.map(r => `${r.slug}-${r.idx}: fuzz ${r.fuzz}, 9% ate ${r.lostAt9}%`),
  failed: report.filter(r => r.status).map(r => `${r.slug}-${r.idx}: ${r.status}`)
}, null, 1));
