#!/usr/bin/env node
/* Every page of the production sitemap, to IndexNow (Bing, Yandex, Seznam,
   Naver …) in one go — run once after a deploy that moved or added pages,
   such as the move to Shopify's addresses of 08.10.2026.

     node tools/indexnow-submit.mjs --dry-run     lists what would be sent, sends nothing
     node tools/indexnow-submit.mjs               sends it
     node tools/indexnow-submit.mjs --sitemap https://rempireshop.com/sitemap.xml

   It reads https://rempireshop.com/sitemap.xml (an index: the static
   sitemap-N.xml files the prerender writes, sitemap-products.xml and
   sitemap-custom.xml, which the app answers live), keeps every <loc> on
   rempireshop.com, and POSTs them to https://api.indexnow.org/indexnow in
   batches of 10 000 with the shop's key (src/lib/indexnow.mjs).

   Before sending it reads the key file the engines will check
   (https://rempireshop.com/<key>.txt) and stops if it is not there or does
   not hold the key — every engine would answer 403 otherwise. The dry run
   does the same check, so it tells you whether a real run would work.

   Day-to-day changes need no run of this: the panel tells IndexNow itself
   when a product, an article or a set is saved (src/lib/indexnow-ping.ts).
   docs/seo.md § «IndexNow». */
import {
  INDEXNOW_KEY,
  INDEXNOW_KEY_LOCATION,
  indexNowBodies,
  postIndexNow,
  sitemapLocs,
} from "../src/lib/indexnow.mjs";
import { LIVE_ORIGIN } from "../src/lib/seo-head.mjs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run") || args.includes("-n");
const at = args.indexOf("--sitemap");
const SITEMAP = at >= 0 && args[at + 1] ? args[at + 1] : LIVE_ORIGIN + "/sitemap.xml";

async function text(url) {
  const res = await fetch(url, { headers: { "user-agent": "rempire-indexnow-submit" }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(url + " answered " + res.status);
  return res.text();
}

/** Every page URL under a sitemap or a sitemap index, once each, in order. */
async function collect(url, seen = new Set(), depth = 0) {
  if (depth > 2 || seen.has(url)) return [];
  seen.add(url);
  const { sitemaps, urls } = sitemapLocs(await text(url));
  const out = [...urls];
  for (const child of sitemaps) out.push(...(await collect(child, seen, depth + 1)));
  return out;
}

try {
  const all = await collect(SITEMAP);
  const bodies = indexNowBodies(all);
  const count = bodies.reduce((n, b) => n + b.urlList.length, 0);
  console.log(`indexnow: ${all.length} addresses in ${SITEMAP}, ${count} on rempireshop.com, ${bodies.length} request(s)`);

  let keyOk = false;
  try {
    keyOk = (await text(INDEXNOW_KEY_LOCATION)).trim() === INDEXNOW_KEY;
  } catch (err) {
    console.log("indexnow: key file not readable — " + err.message);
  }
  console.log(`indexnow: key file ${INDEXNOW_KEY_LOCATION} ${keyOk ? "holds the key" : "does NOT hold the key"}`);

  if (DRY) {
    for (const b of bodies) for (const u of b.urlList) console.log("  " + u);
    console.log("indexnow: dry run — nothing sent");
    process.exit(keyOk ? 0 : 1);
  }
  if (!keyOk) {
    console.error("indexnow: not sending — deploy public/" + INDEXNOW_KEY + ".txt first");
    process.exit(1);
  }
  if (!count) {
    console.error("indexnow: nothing to send");
    process.exit(1);
  }
  const results = await postIndexNow(all, { timeoutMs: 30000 });
  for (const r of results) console.log(`indexnow: ${r.status} for ${r.count} address(es)`);
  process.exit(results.every((r) => r.status === 200 || r.status === 202) ? 0 : 1);
} catch (err) {
  console.error("indexnow: " + (err && err.message ? err.message : err));
  process.exit(1);
}
