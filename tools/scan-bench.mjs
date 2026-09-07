/**
 * tools/scan-bench.mjs — how well does the scanner actually read a barcode?
 *
 * Dim, after the Samsung Galaxy S21 FE: «We need a good scanner which works
 * from first time.» That is not something to tune by feel on one phone in one
 * stockroom, so this is the measuring instrument: it paints real EAN-13
 * barcodes into a real camera-sized frame at a range of distances, angles,
 * blurs and light levels, then runs the SAME vendored zxing decoder the
 * scanner falls back to (public/vendor/zxing/zxing-browser.min.js — the one
 * Samsung Internet always uses and the one Chrome hands over to when Play
 * Services' barcode module is missing) over each candidate framing.
 *
 * What it answers, in numbers:
 *   - which crop the decoder reads best (the band under the scan line, its
 *     size, and whether upscaling it helps);
 *   - how small a code can get — in pixels per barcode module, which is the
 *     only distance-independent way to say "how far away" — before the read
 *     rate falls off;
 *   - what a degree of tilt, a pixel of blur, a dark stockroom or a glare
 *     stripe costs;
 *   - what one decode pass costs in milliseconds, which is what the decode
 *     cadence has to be built on.
 *
 * Not a test: it makes no assertions and CI does not run it. It is run by
 * hand when the camera pipeline is being changed, and its numbers are
 * written into docs/audit/*-scanner.md so the next change argues with data.
 *
 *   node tools/scan-bench.mjs                 # the default sweep
 *   node tools/scan-bench.mjs --quick         # a third of the images
 *   node tools/scan-bench.mjs --json out.json # also dump every cell
 *
 * Headless Chromium has no camera and no BarcodeDetector, so this measures
 * the zxing half only. That is the half that matters: it is the floor under
 * every phone, and the native detector is strictly better where it works.
 */
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const ZXING = fileURLToPath(new URL("../public/vendor/zxing/zxing-browser.min.js", import.meta.url));
const QUICK = process.argv.includes("--quick");
const JSON_AT = (() => {
  const i = process.argv.indexOf("--json");
  return i > 0 ? process.argv[i + 1] : "";
})();

/* The sweep. Each axis is one thing the owner does with his hands, expressed
   the way it reaches the decoder:

   - `mpx`  modules per pixel — how wide one bar is on the sensor. A 13-digit
            EAN is 95 modules plus quiet zones, so mpx 2 means the code is
            ~190 px wide in the frame: an arm's length away on a 100 ml
            bottle. mpx 4–5 is the code filling the middle third.
   - `deg`  how far off horizontal the bottle is held.
   - `blur` motion and focus, in pixels of gaussian.
   - `dark` how much light the stockroom is not giving (0 = studio, 0.75 = a
            shelf with the light behind you).
   - `glare` a specular stripe across the label, which is what a bottle does. */
const FOCUS = process.argv.includes("--focus");
const MPX = QUICK ? [1.5, 2.5, 4] : FOCUS ? [1.6, 2, 2.6, 3.4, 4.5] : [1.2, 1.6, 2, 2.6, 3.4, 4.5];
const DEG = QUICK ? [0, 12] : [0, 6, 14, 25];
const BLUR = QUICK ? [0, 1.5] : FOCUS ? [0, 0.7, 1.4] : [0, 0.7, 1.4, 2.2];
/** A dark stockroom, as a camera actually sees one: the sensor gains up, so
    the picture is darker AND noisier AND softer (a longer exposure smears the
    hand). Modelling it as a uniform dimming alone measures nothing — the
    binariser normalises that away, which is exactly what the first run of
    this harness showed (dark 0.55 read no worse than dark 0). */
const DARK = QUICK ? [0] : [0, 0.55];
const GLARE = QUICK ? [false] : FOCUS ? [false] : [false, true];
/** How far off the middle of the frame the label sits, as a fraction of the
    short side — the owner aiming by hand, not by crosshair. */
const OFF = QUICK || FOCUS ? [0] : [0, 0.14];

/* The candidate framings. `full` and `crop76x44@2` are what the scanner does
   today (scanFullCanvas / scanCropCanvas in public/shop2/app.js); everything
   else is a candidate. Geometry is written the way app.js writes it so a
   winner can be moved across without re-deriving anything. */
const PIPES = [
  { id: "full@1280", kind: "full", cap: 1280 },
  { id: "full@native", kind: "full", cap: 0 },
  { id: "crop76x44@2", kind: "crop", w: 0.76, h: 0.44, up: 2, base: "side" },
  { id: "crop76x44@1", kind: "crop", w: 0.76, h: 0.44, up: 1, base: "side" },
  { id: "crop92x60@1", kind: "crop", w: 0.92, h: 0.60, up: 1, base: "side" },
  { id: "crop92x60@2", kind: "crop", w: 0.92, h: 0.60, up: 2, base: "side" },
  { id: "sq100x100@1", kind: "crop", w: 1.0, h: 1.0, up: 1, base: "side" },
  { id: "wide100x55@1", kind: "crop", w: 1.0, h: 0.55, up: 1, base: "frame" },
  { id: "wide100x75@1", kind: "crop", w: 1.0, h: 0.75, up: 1, base: "frame" },
  /* Turning the band back the other way before decoding. zxing's OneD reader
     walks horizontal rows and TRY_HARDER only adds a 90° retry, so a bottle
     held at 25° is unreadable by every framing above; the question is whether
     one extra pass on a pre-rotated copy buys that back. */
  { id: "crop92x60@1 rot+13", kind: "crop", w: 0.92, h: 0.60, up: 1, base: "side", rot: 13 },
  { id: "crop92x60@1 rot-13", kind: "crop", w: 0.92, h: 0.60, up: 1, base: "side", rot: -13 },
];

/* The two hint sets, priced against each other. zxing's TRY_HARDER makes the
   OneD reader walk far more rows of the image and retry them rotated; it
   costs several times a plain pass, and the only question worth asking is
   whether one slow chance beats four fast ones at the same wall clock. */
const BUDGET_MS = 1000;   // "does it read first time" = within a second of aiming

const FRAME = { w: 1920, h: 1080 };

const page = await (async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const p = await ctx.newPage();
  await p.goto("about:blank");
  await p.addScriptTag({ path: ZXING });
  p.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
  p.__close = () => browser.close();
  return p;
})();

const ok = await page.evaluate(() => !!(window.ZXingBrowser && window.ZXingBrowser.BrowserMultiFormatReader));
if (!ok) { console.error("the vendored zxing bundle did not define ZXingBrowser — run `node tools/copy-vendor.mjs`"); await page.__close(); process.exit(1); }

const rows = await page.evaluate(async ({ MPX, DEG, BLUR, DARK, GLARE, OFF, PIPES, FRAME }) => {
  /* ---- EAN-13, drawn from the spec so every image carries a code the
     decoder can check the check digit of. 95 modules: 101 · 6×7 · 01010 ·
     6×7 · 101, the left six in L or G parity per the first digit. */
  const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
  const R = L.map((s) => s.split("").map((c) => (c === "0" ? "1" : "0")).join(""));
  const G = R.map((s) => s.split("").reverse().join(""));
  const PARITY = ["000000", "001011", "001101", "001110", "010011", "011001", "011100", "010101", "010110", "011010"];
  function checkDigit(d12) {
    let s = 0;
    for (let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 === 0 ? 1 : 3);
    return String((10 - (s % 10)) % 10);
  }
  function ean13Modules(d12) {
    const digits = d12 + checkDigit(d12);
    const par = PARITY[Number(digits[0])];
    let bits = "101";
    for (let i = 1; i <= 6; i++) bits += (par[i - 1] === "0" ? L : G)[Number(digits[i])];
    bits += "01010";
    for (let i = 7; i <= 12; i++) bits += R[Number(digits[i])];
    bits += "101";
    return { bits, text: digits };
  }

  /** One camera frame: grey room, the label somewhere near the middle, the
      code on it at `mpx` pixels per module, turned `deg`, `blur` px soft,
      `dark` stops down, with or without a glare stripe. */
  function paintFrame(spec) {
    const { bits } = ean13Modules(spec.digits);
    const mpx = spec.mpx;
    const codeW = bits.length * mpx;            // 95 modules
    const quiet = 10 * mpx;                      // the quiet zone the spec asks for
    const codeH = Math.max(24, codeW * 0.32);    // a real label is about a third as tall as it is wide
    const labelW = codeW + quiet * 2, labelH = codeH + mpx * 14;

    // the label, painted at its own size first so the rotation and the blur
    // work on one bitmap rather than on 95 separate rectangles
    const lab = document.createElement("canvas");
    lab.width = Math.ceil(labelW); lab.height = Math.ceil(labelH);
    const lc = lab.getContext("2d");
    lc.fillStyle = "#ffffff"; lc.fillRect(0, 0, lab.width, lab.height);
    lc.fillStyle = "#111111";
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] === "1") lc.fillRect(quiet + i * mpx, mpx * 2, mpx, codeH);
    }

    const f = document.createElement("canvas");
    f.width = FRAME.w; f.height = FRAME.h;
    const c = f.getContext("2d", { willReadFrequently: true });
    c.fillStyle = "#8a8a86"; c.fillRect(0, 0, f.width, f.height);   // the stockroom wall
    c.save();
    c.translate(f.width / 2, f.height / 2 + (spec.off || 0) * Math.min(f.width, f.height));
    c.rotate((spec.deg * Math.PI) / 180);
    // low light lengthens the exposure: the hand smears a little more
    const soft = spec.blur + (spec.dark ? spec.dark * 1.2 : 0);
    if (soft) c.filter = `blur(${soft}px)`;
    c.drawImage(lab, -lab.width / 2, -lab.height / 2);
    c.restore();
    if (spec.glare) {
      const g = c.createLinearGradient(0, f.height * 0.35, 0, f.height * 0.65);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "rgba(255,255,255,0.62)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g; c.fillRect(0, 0, f.width, f.height);
    }
    if (spec.dark) {
      c.fillStyle = `rgba(0,0,0,${spec.dark})`; c.fillRect(0, 0, f.width, f.height);
      // …and the sensor gain that darkness forces: shot noise over the whole
      // frame, which is what actually stops a binariser finding an edge
      const amp = spec.dark * 70;
      const img = c.getImageData(0, 0, f.width, f.height), d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * amp;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      c.putImageData(img, 0, 0);
    }
    return f;
  }

  /** Mean luminance of the middle band, 0–255 — the number an auto-torch
      would have to trigger on. */
  function meanLuma(frame) {
    const s = 64;
    const t = document.createElement("canvas"); t.width = s; t.height = s;
    const tc = t.getContext("2d", { willReadFrequently: true });
    const side = Math.min(frame.width, frame.height);
    tc.drawImage(frame, (frame.width - side) / 2, (frame.height - side) / 2, side, side, 0, 0, s, s);
    const d = tc.getImageData(0, 0, s, s).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return sum / (d.length / 4);
  }

  /** The canvas a pipeline hands the decoder — the same arithmetic
      scanCropCanvas()/scanFullCanvas() do in public/shop2/app.js. */
  const scratch = {};
  function pipeCanvas(frame, pipe) {
    const vw = frame.width, vh = frame.height;
    const c = scratch[pipe.id] || (scratch[pipe.id] = document.createElement("canvas"));
    if (pipe.kind === "full") {
      const scale = pipe.cap && vw > pipe.cap ? pipe.cap / vw : 1;
      const w = Math.round(vw * scale), h = Math.round(vh * scale);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      c.getContext("2d", { willReadFrequently: true }).drawImage(frame, 0, 0, w, h);
      return c;
    }
    const base = pipe.base === "frame" ? vw : Math.min(vw, vh);
    const baseH = Math.min(vw, vh);
    const cw = Math.round(base * pipe.w), ch = Math.round(baseH * pipe.h);
    const sx = Math.round((vw - cw) / 2), sy = Math.round((vh - ch) / 2);
    const up = pipe.up;
    if (c.width !== cw * up || c.height !== ch * up) { c.width = cw * up; c.height = ch * up; }
    const cc = c.getContext("2d", { willReadFrequently: true });
    if (pipe.rot) {
      cc.save();
      cc.translate(c.width / 2, c.height / 2);
      cc.rotate((-pipe.rot * Math.PI) / 180);
      cc.drawImage(frame, sx, sy, cw, ch, -c.width / 2, -c.height / 2, c.width, c.height);
      cc.restore();
      return c;
    }
    cc.drawImage(frame, sx, sy, cw, ch, 0, 0, c.width, c.height);
    return c;
  }

  const Z = window.ZXingBrowser;
  const F = Z.BarcodeFormat || {};
  // the scanner's own hint set: 2 = POSSIBLE_FORMATS, 3 = TRY_HARDER
  const formats = [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.QR_CODE].filter((x) => x !== undefined);
  const hints = new Map();
  if (formats.length) hints.set(2, formats);
  hints.set(3, true);
  const reader = new Z.BrowserMultiFormatReader(hints);
  const hintsFast = new Map();
  if (formats.length) hintsFast.set(2, formats);
  const readerFast = new Z.BrowserMultiFormatReader(hintsFast);

  const out = [];
  let n = 0;
  for (const mpx of MPX) for (const deg of DEG) for (const blur of BLUR) for (const dark of DARK) for (const glare of GLARE) for (const off of OFF) {
    // a different code per image, so a lucky cache can never be the reason
    const digits = String(400000000000 + (n++ % 90000) * 7).slice(0, 12);
    const spec = { digits, mpx, deg, blur, dark, glare, off };
    const frame = paintFrame(spec);
    const want = (() => { const { text } = ean13Modules(digits); return text; })();
    const luma = meanLuma(frame);
    for (const pipe of PIPES) {
      const canvas = pipeCanvas(frame, pipe);
      const t0 = performance.now();
      let got = "";
      try { const r = reader.decodeFromCanvas(canvas); got = r ? r.getText() : ""; } catch (e) { got = ""; }
      const ms = performance.now() - t0;
      // the same frame without TRY_HARDER, to price the hint
      const t1 = performance.now();
      let gotFast = "";
      try { const r2 = readerFast.decodeFromCanvas(canvas); gotFast = r2 ? r2.getText() : ""; } catch (e) { gotFast = ""; }
      const msFast = performance.now() - t1;
      out.push({ mpx, deg, blur, dark, glare, off, luma: Math.round(luma), pipe: pipe.id,
        px: canvas.width + "x" + canvas.height,
        hit: got === want, ms: Math.round(ms), hitFast: gotFast === want, msFast: Math.round(msFast) });
    }
  }
  return out;
}, { MPX, DEG, BLUR, DARK, GLARE, OFF, PIPES, FRAME });

await page.__close();

/* ---------------- the report ------------------------------------------- */
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(0).padStart(3) + "%" : "  —");
const by = (rs, k) => {
  const m = new Map();
  for (const r of rs) { const v = String(r[k]); if (!m.has(v)) m.set(v, []); m.get(v).push(r); }
  return m;
};
const rate = (rs, f = "hit") => pct(rs.filter((r) => r[f]).length, rs.length);
const avg = (rs, f) => (rs.reduce((s, r) => s + r[f], 0) / (rs.length || 1)).toFixed(0);

console.log(`\nscan-bench — ${rows.length} decodes over ${rows.length / PIPES.length} frames of ${FRAME.w}×${FRAME.h}` +
  (QUICK ? " (quick sweep)" : ""));

console.log("\n== read rate by framing (all conditions) ==");
console.log("framing          canvas         read   read(no TRY_HARDER)  ms   ms(fast)");
for (const pipe of PIPES) {
  const rs = rows.filter((r) => r.pipe === pipe.id);
  console.log(pipe.id.padEnd(16) + String(rs[0].px).padEnd(15) +
    rate(rs) + "   " + rate(rs, "hitFast") + "               " + avg(rs, "ms").padStart(3) + "  " + avg(rs, "msFast").padStart(6));
}

/* The number that answers the actual question. A frame the decoder misses is
   not the end of the scan — the hand moves and another frame arrives — so
   what decides whether a code reads "first time" is how many independent
   chances fit into the second the owner holds the phone still, times how
   good each chance is. p over n passes = 1 − (1 − p)^n. */
const within = (rs, field, msField, tickMs) => {
  const p = rs.filter((r) => r[field]).length / (rs.length || 1);
  const perPass = Math.max(tickMs, rs.reduce((s, r) => s + r[msField], 0) / (rs.length || 1));
  const n = Math.max(1, Math.floor(BUDGET_MS / perPass));
  return { p, n, perPass, within: 1 - Math.pow(1 - p, n) };
};
console.log(`\n== the one that matters: P(read) within ${BUDGET_MS} ms of aiming ==`);
console.log("framing           per-frame  pass ms  passes/s   TRY_HARDER   plain hints");
const scored = [];
for (const pipe of PIPES) {
  const rs = rows.filter((r) => r.pipe === pipe.id);
  const hard = within(rs, "hit", "ms", 0), fast = within(rs, "hitFast", "msFast", 0);
  scored.push({ id: pipe.id, hard, fast });
  console.log(pipe.id.padEnd(17) + (hard.p * 100).toFixed(0).padStart(8) + "%" +
    hard.perPass.toFixed(0).padStart(9) + String(hard.n).padStart(10) +
    (hard.within * 100).toFixed(0).padStart(12) + "%" +
    ((fast.within * 100).toFixed(0) + "% (" + fast.n + "×" + (fast.p * 100).toFixed(0) + "%)").padStart(16));
}
const best = scored.slice().sort((a, b) => Math.max(b.hard.within, b.fast.within) - Math.max(a.hard.within, a.fast.within))[0];
console.log(`\nbest framing by P(read within ${BUDGET_MS} ms): ${best.id}` +
  ` — ${best.hard.within >= best.fast.within ? "with" : "without"} TRY_HARDER`);

const SHOW = [best.id, "crop76x44@2", "full@1280"].filter((v, i, a) => a.indexOf(v) === i);
for (const key of ["mpx", "deg", "blur", "dark", "glare", "off"]) {
  console.log(`\n== read rate by ${key} ==`);
  const heads = [...by(rows, key).keys()];
  console.log("framing".padEnd(16) + heads.map((h) => (key + " " + h).padStart(11)).join(""));
  for (const id of SHOW) {
    const rs = rows.filter((r) => r.pipe === id);
    console.log(id.padEnd(16) + heads.map((h) => rate(rs.filter((r) => String(r[key]) === h)).padStart(11)).join(""));
  }
}

console.log("\n== mean frame luminance (0–255) by `dark` — what an auto-torch trigger sees ==");
for (const [k, rs] of by(rows, "dark")) console.log(`  dark ${k}: luma ${avg(rs, "luma")}, read ${rate(rs.filter((r) => r.pipe === best.id))}`);

console.log("\n== one decode pass, ms (the floor under the decode cadence) ==");
for (const pipe of PIPES) {
  const rs = rows.filter((r) => r.pipe === pipe.id).map((r) => r.ms).sort((a, b) => a - b);
  console.log("  " + pipe.id.padEnd(16) + "median " + String(rs[Math.floor(rs.length / 2)]).padStart(4) +
    "   p90 " + String(rs[Math.floor(rs.length * 0.9)]).padStart(4) + "   max " + String(rs[rs.length - 1]).padStart(4));
}

/* The loop alternates two framings, so the pair is what actually runs. On the
   SAME frame, "either" says whether the second framing catches anything the
   first missed — if it does not, half the passes are being spent for nothing
   and one framing twice as often is strictly better. */
const pair = (a, b) => {
  const ra = rows.filter((r) => r.pipe === a), rb = rows.filter((r) => r.pipe === b);
  let both = 0, either = 0, onlyB = 0;
  for (let i = 0; i < ra.length; i++) {
    if (ra[i].hit && rb[i].hit) both++;
    if (ra[i].hit || rb[i].hit) either++;
    if (!ra[i].hit && rb[i].hit) onlyB++;
  }
  return { both, either, onlyB, n: ra.length };
};
console.log("\n== alternating two framings on the same frame ==");
for (const b of PIPES.filter((p) => p.id !== "full@1280")) {
  const p = pair("full@1280", b.id);
  console.log(`  full@1280 + ${b.id.padEnd(14)} either ${pct(p.either, p.n)}   both ${pct(p.both, p.n)}` +
    `   only the second ${pct(p.onlyB, p.n)}`);
}

/* A code held crooked is the one wall nothing above gets over (deg 25 reads
   at 0% everywhere). One extra pass on a band turned back 13° is the cheapest
   thing that could fix it — this says whether it does. */
console.log("\n== a pre-rotated pass, by how crooked the bottle is held ==");
{
  const degs = [...by(rows, "deg").keys()];
  const trio = ["crop92x60@1", "crop92x60@1 rot+13", "crop92x60@1 rot-13"].filter((id) => rows.some((r) => r.pipe === id));
  console.log("framing".padEnd(22) + degs.map((d) => ("deg " + d).padStart(9)).join(""));
  for (const id of trio) {
    const rs = rows.filter((r) => r.pipe === id);
    console.log(id.padEnd(22) + degs.map((d) => rate(rs.filter((r) => String(r.deg) === d)).padStart(9)).join(""));
  }
  if (trio.length === 3) {
    const a = rows.filter((r) => r.pipe === trio[0]), b = rows.filter((r) => r.pipe === trio[1]), cc = rows.filter((r) => r.pipe === trio[2]);
    console.log("any of the three".padEnd(22) + degs.map((d) => {
      const idx = a.map((r, i) => i).filter((i) => String(a[i].deg) === d);
      const hit = idx.filter((i) => a[i].hit || b[i].hit || cc[i].hit).length;
      return pct(hit, idx.length).padStart(9);
    }).join(""));
  }
}

/* «Прочитать дважды» — the two-frame confirmation. It cannot be measured as
   accuracy here (zxing validates EAN-13's check digit, so a wrong read is
   already all but impossible); what it can be measured as is delay: the
   second agreeing pass has to arrive before the hand moves, and the chance
   of two agreeing passes inside the same second is the square-ish of one. */
console.log(`\n== what a two-frame confirmation costs, at the best framing ==`);
{
  const rs = rows.filter((r) => r.pipe === best.id);
  const one = within(rs, "hit", "ms", 0);
  const twoP = Math.pow(one.p, 2);   // two consecutive passes must both read
  const two = 1 - Math.pow(1 - twoP, Math.max(1, Math.floor(one.n / 2)));
  console.log(`  one pass ${(one.p * 100).toFixed(0)}%, ${one.n} passes in ${BUDGET_MS} ms` +
    `  →  confirm on 1 frame: ${(one.within * 100).toFixed(0)}%   confirm on 2: ${(two * 100).toFixed(0)}%`);
  console.log(`  (a check-digit format — EAN-8/13, UPC-A/E, CODE_128 — is already validated by the decoder)`);
}

if (JSON_AT) { writeFileSync(JSON_AT, JSON.stringify(rows, null, 1)); console.log(`\nevery cell → ${JSON_AT}`); }
console.log("");
