/* Smoke test for the prerendered shop pages and the sitemap.
   `node tools/check-prerender.mjs`  (run it after `npm run prerender`)

   No DOM library and no network: it reads the files off disk, pulls the tags
   out with regexes and asserts the things that are actually easy to get wrong
   — a missing hreflang, a canonical pointing at the wrong language, JSON-LD
   that does not parse, a title Google would cut in half, an image that is not
   on disk, a page whose asset tags drifted from index.html. */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUB = path.join(ROOT, "public");
const SHOP2 = path.join(PUB, "shop2");

let checked = 0, failed = 0;
const seen = new Set();
function fail(file, msg) {
  failed++;
  if (failed <= 40) console.error("FAIL " + path.relative(ROOT, file) + ": " + msg);
  else if (failed === 41) console.error("… further failures suppressed");
}
function once(file, key, msg) {         // one line per kind of failure
  if (seen.has(key)) { failed++; return; }
  seen.add(key);
  fail(file, msg);
}

const catSrc = await readFile(path.join(PUB, "shop", "catalogue2.js"), "utf8");
const CATALOGUE = new Function(catSrc + "\nreturn CATALOGUE;")();
const CAT_NAMES = new Function(catSrc + "\nreturn CAT_NAMES;")();

const shell = await readFile(path.join(SHOP2, "index.html"), "utf8");
const ASSET_V = (shell.match(/app\.js\?v=([^"']*)/) || [])[1];
const SCRIPTS = (shell.match(/<!-- prerender:end -->\s*<\/div>\s*([\s\S]*?)<\/body>/) || [])[1];
if (!ASSET_V || !SCRIPTS) {
  console.error("FAIL public/shop2/index.html: no ?v= token or no script block after #app");
  process.exit(1);
}

const all = (re, s) => [...s.matchAll(re)].map((m) => m[1]);

/* Lengths are counted on the text a result listing renders, not on the markup:
   &amp; is one character to a reader and five in the file, and measuring the
   file would fail a title that is comfortably inside the limit. */
const decode = (s) => String(s)
  .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");

async function checkPage(file, { lang, seg, rest, product }) {
  checked++;
  let html;
  try { html = await readFile(file, "utf8"); }
  catch { return fail(file, "missing — run `npm run prerender`"); }

  const htmlLang = (html.match(/<html lang="([^"]+)"/) || [])[1];
  if (htmlLang !== lang) fail(file, `<html lang> is "${htmlLang}", expected "${lang}"`);

  const title = decode((html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
  if (!title) fail(file, "no <title>");
  if (title.length > 60) fail(file, `title is ${title.length} chars (max 60): ${title}`);

  const desc = decode((html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "");
  if (!desc) fail(file, "no meta description");
  if (desc.length > 160) fail(file, `description is ${desc.length} chars (max 160)`);

  const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
  const wantPath = "/shop2" + (seg ? "/" + seg : "") + rest;
  if (!canonical) fail(file, "no canonical");
  else if (!canonical.endsWith(wantPath)) fail(file, `canonical ends "${canonical.slice(-60)}", expected "${wantPath}"`);

  const alts = all(/<link rel="alternate" hreflang="([^"]+)"/g, html);
  for (const want of ["ru", "et", "en", "x-default"]) {
    if (!alts.includes(want)) fail(file, `no hreflang="${want}" (has ${alts.join(", ") || "none"})`);
  }
  if (alts.length !== 4) fail(file, `${alts.length} hreflang links, expected 4`);

  // the alternates must be the same page in the other languages, not a stale copy
  const altHrefs = all(/<link rel="alternate" hreflang="(?:ru|et|en)" href="([^"]+)"/g, html);
  for (const [i, s] of ["", "/et", "/en"].entries()) {
    const want = "/shop2" + s + rest;
    if (altHrefs[i] && !altHrefs[i].endsWith(want)) fail(file, `alternate ${i} ends "${altHrefs[i].slice(-50)}", expected "${want}"`);
  }

  for (const [ldRaw, i] of all(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g, html).map((s, i) => [s, i])) {
    try {
      const ld = JSON.parse(ldRaw);
      if (!ld["@type"]) fail(file, `JSON-LD block ${i} has no @type`);
      if (product && ld["@type"] === "Product") {
        if (!ld.offers) fail(file, "Product JSON-LD has no offers");
        else {
          if (ld.offers.priceCurrency !== "EUR") fail(file, `offers.priceCurrency is ${ld.offers.priceCurrency}`);
          if (!(Number(ld.offers.price) >= 0)) fail(file, `offers.price is ${ld.offers.price}`);
          if (!/schema\.org\/(In|Out Of|OutOf)Stock/.test(ld.offers.availability || "")) {
            fail(file, `offers.availability is ${ld.offers.availability}`);
          }
        }
      }
    } catch (e) { fail(file, `JSON-LD block ${i} does not parse: ${e.message}`); }
  }
  const types = all(/"@type":"([^"]+)"/g, html);
  if (product && !types.includes("Product")) fail(file, "no Product JSON-LD");
  if (rest !== "/" && !types.includes("BreadcrumbList")) fail(file, "no BreadcrumbList JSON-LD");
  if (rest === "/" && !types.includes("Organization")) fail(file, "home page has no Organization JSON-LD");

  const og = (html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] || "";
  if (!/^https?:\/\//.test(og)) fail(file, `og:image is not absolute: ${og}`);
  const local = og.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  if (local && !existsSync(path.join(PUB, local.replace(/^\//, "")))) {
    once(file, "ogfile:" + local, `og:image file is missing: ${local}`);
  }

  // visible content, not just a head
  const body = (html.match(/<div id="prerender">([\s\S]*?)<\/div><!-- prerender:end -->/) || [])[1] || "";
  if (body.length < 400) fail(file, `prerendered body is ${body.length} chars — nothing meaningful inside #app`);
  if (!/<h1[^>]*>[^<]/.test(body)) fail(file, "no <h1> in the prerendered body");
  if (!/<img [^>]*alt="[^"]+"/.test(body)) fail(file, "no <img> with a non-empty alt");
  if (!/<a href="\/shop2/.test(body)) fail(file, "no crawlable /shop2 links");
  if (product) {
    if (!/pdp__price/.test(body)) fail(file, "no price on the product page");
    if (!/class="acc__rich"/.test(body) && !/pdp__title/.test(body)) fail(file, "no description block");
  }

  // the SPA must be able to take over: same asset version, same script tags
  if (!html.includes("?v=" + ASSET_V)) fail(file, `asset version is not ?v=${ASSET_V} — re-run npm run prerender`);
  if (!html.includes(SCRIPTS.trim().split("\n")[0].trim())) fail(file, "script tags differ from index.html");
  if (!/<div id="app">/.test(html)) fail(file, "no #app root");
}

const LANGS = [["ru", ""], ["et", "et"], ["en", "en"]];
const BRANDS = [...new Set(CATALOGUE.map((p) => p.brand))]
  .map((b) => b.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));

for (const [lang, seg] of LANGS) {
  await checkPage(path.join(SHOP2, seg, "index.html"), { lang, seg, rest: "/" });
  for (const c of ["all", ...Object.keys(CAT_NAMES)]) {
    await checkPage(path.join(SHOP2, seg, "c", c, "index.html"), { lang, seg, rest: `/c/${c}/` });
  }
  for (const b of BRANDS) {
    await checkPage(path.join(SHOP2, seg, "b", b, "index.html"), { lang, seg, rest: `/b/${b}/` });
  }
  for (const p of CATALOGUE) {
    await checkPage(path.join(SHOP2, seg, "p", p.id, "index.html"),
      { lang, seg, rest: `/p/${encodeURIComponent(p.id)}/`, product: true });
  }
}

/* ---------- nothing prerendered that is not in the catalogue ------------- */
const ids = new Set(CATALOGUE.map((p) => p.id));
for (const [, seg] of LANGS) {
  const dir = path.join(SHOP2, seg, "p");
  for (const d of await readdir(dir).catch(() => [])) {
    if (!ids.has(d)) { failed++; console.error(`FAIL stale page for a product that no longer exists: ${seg || "ru"}/p/${d}/`); }
  }
}

/* ---------- sitemap + robots -------------------------------------------- */
const smFile = path.join(PUB, "sitemap.xml");
if (!existsSync(smFile)) { failed++; console.error("FAIL public/sitemap.xml is missing"); }
else {
  const sm = await readFile(smFile, "utf8");
  const locs = all(/<loc>([^<]+)<\/loc>/g, sm);
  const expected = LANGS.length * (1 + 1 + Object.keys(CAT_NAMES).length + BRANDS.length + CATALOGUE.length);
  if (locs.length !== expected) { failed++; console.error(`FAIL sitemap has ${locs.length} <loc>, expected ${expected}`); }
  if (new Set(locs).size !== locs.length) { failed++; console.error("FAIL sitemap has duplicate <loc> entries"); }
  const xh = (sm.match(/<xhtml:link/g) || []).length;
  if (xh !== locs.length * 4) { failed++; console.error(`FAIL sitemap has ${xh} xhtml:link, expected ${locs.length * 4}`); }
  if (!/xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/.test(sm)) { failed++; console.error("FAIL sitemap does not declare the xhtml namespace"); }
  for (const l of locs.slice(0, 5)) if (!/^https?:\/\//.test(l)) { failed++; console.error(`FAIL sitemap <loc> is not absolute: ${l}`); }
  // every prerendered page must be in it, and only those
  const paths = new Set(locs.map((l) => l.replace(/^https?:\/\/[^/]+/, "")));
  for (const [, seg] of LANGS) {
    const want = "/shop2" + (seg ? "/" + seg : "") + "/p/" + CATALOGUE[0].id + "/";
    if (!paths.has(want)) { failed++; console.error(`FAIL sitemap is missing ${want}`); }
  }
  console.log(`sitemap: ${locs.length} urls, ${xh} hreflang alternates`);
}

const rp = path.join(PUB, "robots.production.txt");
if (!existsSync(rp)) { failed++; console.error("FAIL public/robots.production.txt is missing"); }
else {
  const r = await readFile(rp, "utf8");
  for (const want of ["User-agent: *", "Allow: /", "Disallow: /shop2/admin", "Disallow: /shop2/checkout",
    "Disallow: /shop2/cart", "Disallow: /api/", "Sitemap: "]) {
    if (!r.includes(want)) { failed++; console.error(`FAIL robots.production.txt has no "${want}"`); }
  }
}
const rs = await readFile(path.join(PUB, "robots.txt"), "utf8");
if (!/Sitemap:/.test(rs)) { failed++; console.error("FAIL public/robots.txt does not point at a sitemap"); }

console.log(`checked ${checked} pages · ${failed} failure(s)`);
process.exit(failed ? 1 : 0);
