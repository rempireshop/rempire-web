#!/usr/bin/env node
/**
 * Builds src/data/postcode-geo.json — where a postcode IS, roughly, for the
 * one kind of pickup point that has a place but no postcode: Omniva's.
 *
 *   node tools/postcode-geo.mjs          # rewrite the file from the seed
 *   node tools/postcode-geo.mjs --dry    # print what it would write
 *
 * Why it exists (Дим, /test 24.09.2026, «Доставка по умолчанию»): «Searching
 * in Estonia according to postal code does not find "nearest" or almost
 * anything close to (I searched for 10120).» He was on Omniva. Montonio's
 * `postalCode` for an Omniva point is the machine's own terminal code — 96001
 * for Tallinn's Balti Jaam, 9908 for a Riga Rimi — never a postcode (the
 * public feed says the same of its ZIP; docs/shipping.md), so the search that
 * orders the list nearest-postcode-first put Kihnu, Vormsi and Ruhnu (88999,
 * 91999, 93999) at the top for a Tallinn city-centre code. What Omniva's
 * points DO have is coordinates. So a typed postcode is turned into a place —
 * the middle of every committed point whose postcode starts the same way —
 * and Omniva's machines are ordered by their distance from it
 * (src/lib/shipping/point-search.ts, and its mirror in public/shop2/app.js).
 *
 * Built from src/data/parcel-points.seed.json: every row carrying both a real
 * postcode and coordinates — today SmartPosti's 356 Estonian machines and
 * Omniva's 32 Estonian post offices (whose seed ZIP, unlike a machine's, is
 * the office's postcode). No row of the seed gives a Latvian or Lithuanian
 * postcode a place, so those two countries have no entry and a postcode typed
 * over an Omniva list there falls back to the word search. One centre per
 * two- and three-digit prefix, rounded to about a hundred metres.
 *
 * tests/point-search-estonia.test.ts fails when this file and the seed drift
 * apart, and when app.js's POSTCODE_GEO is not this file to the digit.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEED = path.join(ROOT, "src/data/parcel-points.seed.json");
const OUT = path.join(ROOT, "src/data/postcode-geo.json");

/** The prefix lengths a typed postcode is matched at, longest first at run time. */
export const PREFIXES = [2, 3];

/**
 * `{ EE: { "10": [59.43, 24.752], "101": [59.432, 24.761], … } }` from the
 * seed's points. Pure, so the test can hold the committed file to it.
 */
export function buildPostcodeGeo(points) {
  const sums = {};
  for (const p of points) {
    const zip = String(p.zip ?? "").replace(/\D/g, "");
    if (zip.length < 4 || typeof p.lat !== "number" || typeof p.lng !== "number") continue;
    const cc = String(p.country ?? "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) continue;
    for (const n of PREFIXES) {
      const key = zip.slice(0, n);
      const s = ((sums[cc] ??= {})[key] ??= [0, 0, 0]);
      s[0] += p.lat; s[1] += p.lng; s[2] += 1;
    }
  }
  const out = {};
  for (const cc of Object.keys(sums).sort()) {
    out[cc] = {};
    for (const key of Object.keys(sums[cc]).sort()) {
      const [lat, lng, n] = sums[cc][key];
      out[cc][key] = [Math.round((lat / n) * 1000) / 1000, Math.round((lng / n) * 1000) / 1000];
    }
  }
  return out;
}

async function main() {
  const seed = JSON.parse(await readFile(SEED, "utf8"));
  const geo = buildPostcodeGeo(seed.points ?? []);
  // one prefix per line — a two-number array spread over four lines is noise
  const text = "{\n" + Object.entries(geo).map(([cc, t]) =>
    `  ${JSON.stringify(cc)}: {\n` +
    Object.entries(t).map(([k, v]) => `    ${JSON.stringify(k)}: [${v[0]}, ${v[1]}]`).join(",\n") +
    "\n  }").join(",\n") + "\n}\n";
  const counts = Object.entries(geo).map(([cc, t]) => `${cc} ${Object.keys(t).length}`).join(", ");
  if (process.argv.includes("--dry")) {
    process.stdout.write(text);
    console.error(`postcode-geo: ${counts} (dry run, nothing written)`);
    return;
  }
  await writeFile(OUT, text);
  console.log(`postcode-geo: ${counts} → ${path.relative(ROOT, OUT)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
