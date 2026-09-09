/* Smoke test for the prerendered shop pages and the sitemap.
   `node tools/check-prerender.mjs`  (run it after `npm run prerender`)

   No DOM library and no network: it reads the files off disk, pulls the tags
   out with regexes and asserts the things that are actually easy to get wrong
   — a missing hreflang, a canonical pointing at the wrong language, JSON-LD
   that does not parse, a title Google would cut in half, an image that is not
   on disk, a page whose asset tags drifted from index.html, and an asset
   token that no longer matches the files it versions. */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetToken, currentToken } from "./lib/asset-token.mjs";

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

const loadObj = async (file, name) => {
  try { return new Function(await readFile(path.join(PUB, "shop", file), "utf8") + "\nreturn " + name + ";")(); }
  catch { return null; }
};
const LEGAL = (await loadObj("legal.js", "LEGAL")) || {};
const LEGAL_SLUGS = Object.keys(LEGAL);
const BUNDLES = (await loadObj("bundles.js", "BUNDLES")) || [];

/* Every og:image the tool writes is meant to be a 1 200×630 file that is
   actually on disk — that is the whole promise behind declaring
   summary_large_image on every page. The set of distinct images is small
   (one card per product and per set, plus two shared ones), so each one is
   measured once with sharp rather than trusted. */
const OG_SEEN = new Map();      // absolute url -> local path
const PAGE_ROBOTS = new Set();  // the <meta name="robots"> values seen, which must be one value
let sharp = null;
try { ({ default: sharp } = await import("sharp")); } catch { /* dimensions unchecked */ }

const shell = (await readFile(path.join(SHOP2, "index.html"), "utf8")).replace(/\r\n?/g, "\n");
/* currentToken(), not a regex of its own: which tag carries the shared token
   is a rule, and a second copy of it here drifted the day the shell started
   linking the built app.min.js instead of app.js. */
const ASSET_V = currentToken(shell);
const SCRIPTS = (shell.match(/<!-- prerender:end -->\s*<\/div>\s*([\s\S]*?)<\/body>/) || [])[1];
if (!ASSET_V || !SCRIPTS) {
  console.error("FAIL public/shop2/index.html: no ?v= token or no script block after #app");
  process.exit(1);
}
/* The token is a hash of the files it versions (tools/lib/asset-token.mjs),
   so "is it current" is a question with an answer: recompute it. A mismatch
   means app.js, styles.css or one of the generated files was edited and the
   prerender has not run since — exactly the state that let the 06.09.2026
   wallet fix sit behind a cached address for thirteen hours. */
const WANT_V = await assetToken(shell, PUB);
if (ASSET_V !== WANT_V) {
  failed++;
  console.error(`FAIL public/shop2/index.html carries ?v=${ASSET_V} but its assets hash to ${WANT_V} ` +
    "— a versioned file changed after the last prerender. Re-run `npm run prerender`.");
}

const all = (re, s) => [...s.matchAll(re)].map((m) => m[1]);

/* Lengths are counted on the text a result listing renders, not on the markup:
   &amp; is one character to a reader and five in the file, and measuring the
   file would fail a title that is comfortably inside the limit. */
const decode = (s) => String(s)
  .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");

async function checkPage(file, { lang, seg, rest, product, blogPost, needImg = true, minBody = 400 }) {
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

  const meta = (html.match(/<meta name="robots" content="([^"]*)"/) || [])[1];
  if (!meta) fail(file, "no robots meta");
  else PAGE_ROBOTS.add(meta);

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

  /* The tag carries an attribute — id="ldjson" on a product page, otherwise
     data-seo="ldjson-page" — so the pattern has to allow one. It did not
     until 03.09, which meant every block matched nothing and none of the
     assertions below had ever run. */
  const blocks = all(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g, html);
  if (!blocks.length) fail(file, "no JSON-LD at all");
  const types = [];
  for (const [i, ldRaw] of blocks.entries()) {
    let ld;
    try { ld = JSON.parse(ldRaw); }
    catch (e) { fail(file, `JSON-LD block ${i} does not parse: ${e.message}`); continue; }
    if (!ld["@context"]) fail(file, `JSON-LD block ${i} has no @context`);
    if (!ld["@type"]) { fail(file, `JSON-LD block ${i} has no @type`); continue; }
    /* @type may be a list — the home page's Organization is also a Store
       (a real counter at Mardi 1 with pickup), which is how schema.org says
       to declare two types of one thing. Flatten it so `types.includes(…)`
       below still asks a simple question. */
    types.push(...(Array.isArray(ld["@type"]) ? ld["@type"] : [ld["@type"]]));
    if (ld["@type"] === "BreadcrumbList") {
      const items = ld.itemListElement || [];
      if (!items.length) fail(file, "BreadcrumbList has no itemListElement");
      items.forEach((it, n) => {
        if (it.position !== n + 1) fail(file, `BreadcrumbList item ${n} has position ${it.position}`);
        if (!it.name) fail(file, `BreadcrumbList item ${n} has no name`);
      });
    }
    if (ld["@type"] === "Product") {
      if (!ld.name) fail(file, "Product JSON-LD has no name");
      if (!ld.offers) fail(file, "Product JSON-LD has no offers");
      else {
        if (ld.offers.priceCurrency !== "EUR") fail(file, `offers.priceCurrency is ${ld.offers.priceCurrency}`);
        if (!(Number(ld.offers.price) >= 0)) fail(file, `offers.price is ${ld.offers.price}`);
        if (!/schema\.org\/(In|Out Of|OutOf)Stock/.test(ld.offers.availability || "")) {
          fail(file, `offers.availability is ${ld.offers.availability}`);
        }
        if (!/^https?:\/\//.test(ld.offers.url || "")) fail(file, `offers.url is not absolute: ${ld.offers.url}`);
      }
    }
    if (ld["@type"] === "ItemList") {
      if (!(ld.itemListElement || []).length) fail(file, "ItemList has no itemListElement");
    }
  }
  if (product && !types.includes("Product")) fail(file, "no Product JSON-LD");
  if (blogPost && !types.includes("BlogPosting")) fail(file, "no BlogPosting JSON-LD");
  if (rest !== "/" && !types.includes("BreadcrumbList")) fail(file, "no BreadcrumbList JSON-LD");
  if (rest === "/" && !types.includes("Organization")) fail(file, "home page has no Organization JSON-LD");

  /* setHead() in app.js deletes #ldjson on every screen that is not a
     catalogue product, and Googlebot reads the rendered DOM — so a Product
     block outside a product page must NOT carry that id or it is thrown away
     before anything reads it. */
  const idBlock = /<script type="application\/ld\+json" id="ldjson">/.test(html);
  if (idBlock !== rest.startsWith("/p/")) {
    fail(file, idBlock
      ? 'JSON-LD carries id="ldjson" on a page app.js is not going to rewrite — it will be deleted on boot'
      : 'the product page has no id="ldjson" block for app.js to rewrite in place');
  }

  /* The link preview. A page without one shares as a bare URL; a .webp one
     shares as a bare URL too, because Facebook, WhatsApp and LinkedIn will
     not read the format. So: present, absolute, on disk, a JPEG or a PNG,
     declared 1 200×630 and actually 1 200×630, and offered as a wide card. */
  const og = (html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] || "";
  if (!og) fail(file, "no og:image");
  else if (!/^https?:\/\//.test(og)) fail(file, `og:image is not absolute: ${og}`);
  if (/\.(webp|svg|gif)(\?|$)/i.test(og)) {
    once(file, "ogfmt:" + og, `og:image is a format link scrapers refuse: ${og}`);
  }
  const local = og.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  if (local && !existsSync(path.join(PUB, local.replace(/^\//, "")))) {
    once(file, "ogfile:" + local, `og:image file is missing: ${local}`);
  } else if (local) OG_SEEN.set(og, path.join(PUB, local.replace(/^\//, "")));
  const ogW = (html.match(/<meta property="og:image:width" content="(\d+)"/) || [])[1];
  const ogH = (html.match(/<meta property="og:image:height" content="(\d+)"/) || [])[1];
  if (ogW !== "1200" || ogH !== "630") fail(file, `og:image:width/height are ${ogW}×${ogH}, expected 1200×630`);
  const tw = (html.match(/<meta name="twitter:card" content="([^"]+)"/) || [])[1];
  if (tw !== "summary_large_image") fail(file, `twitter:card is "${tw}", expected summary_large_image`);

  // visible content, not just a head
  const body = (html.match(/<div id="prerender">([\s\S]*?)<\/div><!-- prerender:end -->/) || [])[1] || "";
  if (body.length < minBody) fail(file, `prerendered body is ${body.length} chars — nothing meaningful inside #app`);
  if (!/<h1[^>]*>[^<]/.test(body)) fail(file, "no <h1> in the prerendered body");
  if (needImg && !/<img [^>]*alt="[^"]+"/.test(body)) fail(file, "no <img> with a non-empty alt");
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

/* blog: unlike CATALOGUE/LEGAL_SLUGS/BUNDLES, there is no committed file that
   says which posts exist — the database is the only source of truth, and
   this script reads no network and no database (file header). So the set of
   slugs to check is read off the Russian pages themselves; `null` means "no
   /shop2/blog/ at all", which is exactly what a build with no DATABASE_URL
   (or no published post) writes — the whole blog section below is then
   skipped, the same way it is skipped for an empty BUNDLES. */
const BLOG_SLUGS = await readdir(path.join(SHOP2, "blog"), { withFileTypes: true })
  .then((es) => new Set(es.filter((e) => e.isDirectory()).map((e) => e.name)))
  .catch(() => null);
if (!BLOG_SLUGS) console.log("blog: no public/shop2/blog/ — nothing to check this run");

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
  /* The four screens that used to be shell-only. The paths are the ones
     app.js pushes in pathFor() — the singular /set/<id>/ beside the plural
     /sets/ — so a mismatch here is a mismatch with the router. */
  for (const slug of LEGAL_SLUGS) {
    /* A policy page has no photograph and app.js does not draw one either;
       the body is the legal text, which is thousands of characters. */
    await checkPage(path.join(SHOP2, seg, "info", slug, "index.html"),
      { lang, seg, rest: `/info/${slug}/`, needImg: false, minBody: 600 });
  }
  if (BUNDLES.length) {
    await checkPage(path.join(SHOP2, seg, "sets", "index.html"), { lang, seg, rest: "/sets/" });
    for (const b of BUNDLES) {
      await checkPage(path.join(SHOP2, seg, "set", b.id, "index.html"),
        { lang, seg, rest: `/set/${encodeURIComponent(b.id)}/`, product: true });
    }
  }
  /* The brands landing — a page of its own since 07.09.2026, so it is
     checked like the rest. No product photograph on it: it is a list of
     26 links. */
  await checkPage(path.join(SHOP2, seg, "brands", "index.html"),
    { lang, seg, rest: "/brands/", needImg: false, minBody: 200 });
  await checkPage(path.join(SHOP2, seg, "gift", "index.html"),
    { lang, seg, rest: "/gift/", minBody: 700 });
  // blog: skipped whole when BLOG_SLUGS is null (see its declaration above) —
  // a cover is optional, so needImg is off for both the listing and a post
  if (BLOG_SLUGS) {
    await checkPage(path.join(SHOP2, seg, "blog", "index.html"),
      { lang, seg, rest: "/blog/", needImg: false, minBody: 200 });
    for (const slug of BLOG_SLUGS) {
      await checkPage(path.join(SHOP2, seg, "blog", slug, "index.html"),
        { lang, seg, rest: `/blog/${encodeURIComponent(slug)}/`, needImg: false, minBody: 300, blogPost: true });
    }
  }
}

/* ---------- the OG cards are really 1200×630 ---------------------------- */
if (sharp) {
  let bad = 0;
  for (const [url, file] of OG_SEEN) {
    try {
      const m = await sharp(file).metadata();
      if (m.width !== 1200 || m.height !== 630) {
        failed++; bad++;
        console.error(`FAIL og:image ${url} is ${m.width}×${m.height} on disk, declared 1200×630`);
      }
    } catch (e) { failed++; bad++; console.error(`FAIL og:image ${url} does not open: ${e.message}`); }
  }
  console.log(`og:image: ${OG_SEEN.size} distinct cards, ${OG_SEEN.size - bad} at 1200×630`);
} else {
  console.log(`og:image: ${OG_SEEN.size} distinct cards (sharp missing — dimensions unchecked)`);
}

/* ---------- the policy slugs the request-time 404 believes in ------------
   src/lib/notfound-page.ts answers 404 for an `/shop2/info/<slug>/` that is
   not in src/data/legal-slugs.json, which tools/pack-legal.mjs writes from
   this same LEGAL. A JSON left behind by an edit to legal.js would 404 a
   policy page that is sitting right there on disk, so the two lists are
   compared rather than assumed — `npm run pack:legal` is the fix. */
{
  const file = path.join(ROOT, "src", "data", "legal-slugs.json");
  let generated = null;
  try { generated = JSON.parse(await readFile(file, "utf8")); }
  catch (e) { failed++; console.error(`FAIL src/data/legal-slugs.json does not read: ${e.message}`); }
  if (generated && [...generated].sort().join() !== [...LEGAL_SLUGS].sort().join()) {
    failed++;
    console.error(
      "FAIL src/data/legal-slugs.json is stale: it has [" + generated.join(", ") +
      "], public/shop/legal.js has [" + LEGAL_SLUGS.join(", ") + "] — run `npm run pack:legal`",
    );
  } else if (generated) {
    checked++;
    console.log(`legal slugs: ${LEGAL_SLUGS.length} in legal.js and in src/data/legal-slugs.json`);
  }
}

/* ---------- nothing prerendered that is not in the catalogue ------------- */
const stale = [
  ["p", new Set(CATALOGUE.map((p) => p.id)), "product"],
  ["set", new Set(BUNDLES.map((b) => b.id)), "set"],
  ["info", new Set(LEGAL_SLUGS), "policy page"],
  // the Russian slugs ARE the keep-set here (see BLOG_SLUGS above), so this
  // only ever flags et/en drifting from ru, not ru drifting from the database
  ...(BLOG_SLUGS ? [["blog", BLOG_SLUGS, "blog post"]] : []),
];
for (const [, seg] of LANGS) {
  for (const [kind, keep, what] of stale) {
    for (const d of await readdir(path.join(SHOP2, seg, kind)).catch(() => [])) {
      if (!keep.has(d)) {
        failed++;
        console.error(`FAIL stale page for a ${what} that no longer exists: ${seg || "ru"}/${kind}/${d}/`);
      }
    }
  }
}

/* ---------- sitemap + robots -------------------------------------------- */
let SITE_BASE = "";
const smFile = path.join(PUB, "sitemap.xml");
if (!existsSync(smFile)) { failed++; console.error("FAIL public/sitemap.xml is missing"); }
else {
  let sm = await readFile(smFile, "utf8");
  /* public/sitemap.xml is a sitemapindex: the pages live in sitemap-N.xml,
     so follow it rather than counting the index's own rows. Two entries are
     not files at all — sitemap-products.xml
     (src/app/sitemap-products.xml/route.ts), the catalogue's product pages
     minus the ones the owner has hidden since the build, and
     sitemap-custom.xml (src/app/sitemap-custom.xml/route.ts), his own
     products and the posts published after it. Both are expected in the index
     and skipped here, the same way the pages they name are not on disk
     either. */
  const ROUTED = ["sitemap-products.xml", "sitemap-custom.xml"];
  if (/<sitemapindex/.test(sm)) {
    const chunks = all(/<loc>([^<]+)<\/loc>/g, sm).map((u) => u.replace(/^https?:\/\/[^/]+\//, ""));
    for (const r of ROUTED) {
      if (!chunks.includes(r)) { failed++; console.error(`FAIL sitemapindex does not name ${r} (a sitemap the app serves)`); }
    }
    let joined = "";
    for (const c of chunks) {
      if (ROUTED.includes(c)) continue;
      const f = path.join(PUB, c);
      if (!existsSync(f)) { failed++; console.error(`FAIL sitemapindex points at a missing ${c}`); continue; }
      joined += await readFile(f, "utf8");
    }
    sm = joined;
  } else { failed++; console.error("FAIL public/sitemap.xml is not a sitemapindex — the prerender always writes one now"); }
  const locs = all(/<loc>([^<]+)<\/loc>/g, sm);
  SITE_BASE = (locs[0] || "").match(/^https?:\/\/[^/]+/)?.[0] || "";
  /* home + /c/all/ + the categories + the brand pages + the brands landing +
     the policy pages + the sets + the gift card + the blog. NOT the products:
     their pages are still written, but the rows that offer them to a crawler
     are served by src/app/sitemap-products.xml/route.ts, because whether a
     product is hidden is a question only the database can answer. */
  const perLang = 1 + 1 + Object.keys(CAT_NAMES).length + BRANDS.length + 1 +
    LEGAL_SLUGS.length + (BUNDLES.length ? BUNDLES.length + 1 : 0) + 1 +
    (BLOG_SLUGS ? BLOG_SLUGS.size + 1 : 0);
  const expected = LANGS.length * perLang;
  if (locs.length !== expected) { failed++; console.error(`FAIL sitemap has ${locs.length} <loc>, expected ${expected}`); }
  if (new Set(locs).size !== locs.length) { failed++; console.error("FAIL sitemap has duplicate <loc> entries"); }
  const xh = (sm.match(/<xhtml:link/g) || []).length;
  if (xh !== locs.length * 4) { failed++; console.error(`FAIL sitemap has ${xh} xhtml:link, expected ${locs.length * 4}`); }
  if (!/xmlns:xhtml="http:\/\/www\.w3\.org\/1999\/xhtml"/.test(sm)) { failed++; console.error("FAIL sitemap does not declare the xhtml namespace"); }
  for (const l of locs.slice(0, 5)) if (!/^https?:\/\//.test(l)) { failed++; console.error(`FAIL sitemap <loc> is not absolute: ${l}`); }
  // every prerendered page must be in it, and only those
  const paths = new Set(locs.map((l) => l.replace(/^https?:\/\/[^/]+/, "")));
  for (const [, seg] of LANGS) {
    const b = "/shop2" + (seg ? "/" + seg : "");
    const want = [
      // no product row here — src/app/sitemap-products.xml/route.ts serves those
      ...LEGAL_SLUGS.map((s) => b + "/info/" + s + "/"),
      ...(BUNDLES.length ? [b + "/sets/", ...BUNDLES.map((x) => b + "/set/" + x.id + "/")] : []),
      b + "/gift/",
      ...(BLOG_SLUGS ? [b + "/blog/", ...[...BLOG_SLUGS].map((s) => b + "/blog/" + s + "/")] : []),
    ];
    for (const w of want) if (!paths.has(w)) { failed++; console.error(`FAIL sitemap is missing ${w}`); }
  }
  /* A screen that needs a basket, a payment form or a login behind it must
     never be offered to a crawler — it renders empty without state, it is
     robots-disallowed, and asking for it spends crawl budget on nothing. */
  const NEVER = /^\/shop2(?:\/(?:et|en))?\/(?:checkout|cart|account|admin|done|search)\/?$/;
  for (const p of paths) {
    if (NEVER.test(p)) { failed++; console.error(`FAIL sitemap offers a screen that must never be indexed: ${p}`); }
  }
  console.log(`sitemap: ${locs.length} urls, ${xh} hreflang alternates`);
}

/* Three robots files: the two policies, and public/robots.txt which must be
   a copy of whichever one matches the base the pages were built against. A
   staging build with the open policy shipped beside it is how a half-built
   shop ends up in an index. */
const robotsFiles = {
  production: path.join(PUB, "robots.production.txt"),
  staging: path.join(PUB, "robots.staging.txt"),
};
const NO_INDEX = ["/shop2/admin", "/shop2/checkout", "/shop2/cart", "/shop2/account",
  "/shop2/done", "/shop2/search", "/api/"];

for (const [name, f] of Object.entries(robotsFiles)) {
  if (!existsSync(f)) { failed++; console.error(`FAIL public/robots.${name}.txt is missing`); continue; }
  const r = await readFile(f, "utf8");
  for (const want of [...NO_INDEX.map((p) => "Disallow: " + p), "User-agent: *", "Sitemap: "]) {
    if (!r.includes(want)) { failed++; console.error(`FAIL robots.${name}.txt has no "${want}"`); }
  }
}
if (existsSync(robotsFiles.production) && !/\nAllow: \/\n/.test(await readFile(robotsFiles.production, "utf8"))) {
  failed++; console.error("FAIL robots.production.txt does not open the site (no bare `Allow: /`)");
}
if (existsSync(robotsFiles.staging) && !/User-agent: \*\nDisallow: \/\n/.test(await readFile(robotsFiles.staging, "utf8"))) {
  failed++; console.error("FAIL robots.staging.txt does not close the site to general crawlers");
}

/* The layer that has to agree with robots.txt is the robots META, not the
   host: both come out of the same `LIVE` decision in the same run of the
   tool, so a disagreement means one of them was written by a different run.
   The sitemap host is a separate axis — a run with no PUBLIC_BASE_URL writes
   live URLs *and* noindex on purpose, and that is a state to report, not a
   contradiction. */
const rs = await readFile(path.join(PUB, "robots.txt"), "utf8");
if (!/Sitemap:/.test(rs)) { failed++; console.error("FAIL public/robots.txt does not point at a sitemap"); }
if (PAGE_ROBOTS.size > 1) {
  failed++;
  console.error(`FAIL the pages carry ${PAGE_ROBOTS.size} different robots metas ` +
    `(${[...PAGE_ROBOTS].join(" | ")}) — some are from an older run`);
}
const metaRobots = [...PAGE_ROBOTS][0] || "";
const wantName = /noindex/.test(metaRobots) ? "staging" : "production";
const wantFile = robotsFiles[wantName];
if (existsSync(wantFile) && rs.trim() !== (await readFile(wantFile, "utf8")).trim()) {
  failed++;
  console.error(`FAIL the pages say robots "${metaRobots}" but public/robots.txt is not the ${wantName} ` +
    "policy — they come from the same switch, so one of them is from an older run. Re-run `npm run prerender`.");
}
if (SITE_BASE && !rs.includes(SITE_BASE)) {
  failed++;
  console.error(`FAIL public/robots.txt points at a different host from the sitemap (${SITE_BASE})`);
}
console.log(`robots: ${wantName} policy, pages "${metaRobots}", base ${SITE_BASE || "?"}`);
if (SITE_BASE && wantName === "staging" && /(^|\.)rempireshop\.com$/i.test(new URL(SITE_BASE).hostname)) {
  console.log("        note: live URLs with noindex — this is what a run with no PUBLIC_BASE_URL writes.\n" +
    "        Safe, but not what should be deployed; set the variable and re-run.");
}

console.log(`checked ${checked} pages · ${failed} failure(s)`);
process.exit(failed ? 1 : 0);
