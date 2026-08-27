/* Brand marks arrive at wildly different shapes: a circular badge is square
   and 76% ink, a wordmark is 3.7:1 and 7% ink. Sizing them with `contain`
   therefore fits their BOUNDING BOX, not their visual weight — which is why
   Captain Fawcett looked tiny next to Kevin.Murphy.

   This renders every mark onto one canvas of identical aspect, scaled to fit,
   then shrinks the visually heavy ones toward a common ink area. Correction is
   capped at 1 so nothing is ever enlarged past its fit — a mark can only get
   smaller, never overflow — and floored so a dense badge stays legible.

   Everything is also recoloured to a single ink, so the row is one material. */

import { readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const run = promisify(execFile);
const DIR = "C:/Users/Dmitri.MARKIT/source/repos/rempire-web/public/shop/brands";
const SRC = path.join(DIR, "src");          // untouched originals
const INK = "#1c1a00";

const CANVAS_W = 480, CANVAS_H = 160;       // 3:1, matches the CSS box
const BOX_W = 456, BOX_H = 136;             // padding inside the canvas
const CORRECTION_POWER = 0.35;              // gentle pull toward equal ink
const MIN_CORRECTION = 0.68;

const id = async (f, fmt) => (await run("magick", [f, "-format", fmt, "info:"])).stdout.trim();

const files = (await readdir(SRC)).filter(f => /\.(webp|png|jpg|jpeg)$/i.test(f));
const marks = [];

for (const f of files) {
  const src = path.join(SRC, f);
  const trimmed = path.join(DIR, "_t-" + f.replace(/\.\w+$/, ".png"));
  /* True monochrome, not a fill: alpha is the existing transparency MULTIPLIED
     by inverted luminance, so dark strokes stay opaque and the white interior
     of a badge becomes transparent. Colorizing instead turned Captain
     Fawcett's crest into a solid disc, because its interior white was opaque
     pixels rather than transparency. */
  await run("magick", [
    src, "-trim", "+repage",
    "(", "+clone", "-alpha", "extract", ")",
    "(", "-clone", "0", "-alpha", "off", "-colorspace", "gray", "-negate", ")",
    "(", "-clone", "1", "-clone", "2", "-compose", "multiply", "-composite", ")",
    "-delete", "1,2",
    "(", "-clone", "0", "-fill", INK, "-colorize", "100", ")",
    "-delete", "0", "+swap",
    "-compose", "CopyOpacity", "-composite",
    trimmed
  ]);
  const [w, h] = (await id(trimmed, "%w %h")).split(" ").map(Number);
  // ink coverage = mean of the alpha channel, extracted as its own image
  const alphaTmp = trimmed.replace(".png", "-a.png");
  await run("magick", [trimmed, "-alpha", "extract", alphaTmp]);
  const ink = Number(await id(alphaTmp, "%[fx:mean]"));
  await run("cmd", ["/c", "del", alphaTmp]).catch(() => {});
  const sFit = Math.min(BOX_W / w, BOX_H / h);
  marks.push({ f, trimmed, w, h, ink, sFit, areaAtFit: ink * (w * sFit) * (h * sFit) });
}

// common target = geometric mean of the fitted ink areas
const target = Math.exp(marks.reduce((a, m) => a + Math.log(m.areaAtFit), 0) / marks.length);

for (const m of marks) {
  const raw = Math.pow(target / m.areaAtFit, CORRECTION_POWER);
  const corr = Math.min(1, Math.max(MIN_CORRECTION, raw));
  const w = Math.round(m.w * m.sFit * corr);
  const h = Math.round(m.h * m.sFit * corr);
  const out = path.join(DIR, m.f.replace(/\.\w+$/, ".webp"));
  await run("magick", [
    m.trimmed, "-resize", `${w}x${h}!`,
    "-background", "none", "-gravity", "center",
    "-extent", `${CANVAS_W}x${CANVAS_H}`,
    "-quality", "92", out
  ]);
  await run("cmd", ["/c", "del", m.trimmed]).catch(() => {});
  console.log(
    m.f.padEnd(26),
    `ink ${m.ink.toFixed(3)}`.padEnd(11),
    `corr ${corr.toFixed(2)}`.padEnd(11),
    `-> ${w}x${h} on ${CANVAS_W}x${CANVAS_H}`
  );
}
console.log("\ntarget ink area:", Math.round(target));
