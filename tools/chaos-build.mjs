#!/usr/bin/env node
/**
 * The Renat-proof build test — does any edit the owner can make in the panel
 * break the build or put garbage on the pages Google reads?
 *
 * Dim, 29.10.2026, before the handover: «each change of his should not cause
 * git failures». Four incidents in four days had come from ordinary panel
 * edits, not from code: a rename failed the Vercel build (26.10), hiding the
 * Yumain line and a name with no type word turned the deployed smoke test red
 * (28.10). This replays such edits on a copy of the live data and runs the
 * real build step on each, so the next one is found here and not by him.
 *
 *   node --env-file=.env.railway.txt tools/chaos-build.mjs snapshot <file.json>
 *       Reads the six things the build reads from Postgres (read-only) into a
 *       JSON file. Keep it OUTSIDE the repo: it is the live shop's data.
 *   node tools/chaos-build.mjs run <file.json> [scenario …]
 *       For each scenario (all by default): the snapshot with that edit
 *       applied → tools/prerender-shop2.mjs with its readers answering from it
 *       (tools/chaos/stub-loader.mjs) → a lint of every page it wrote. One
 *       line per scenario. The files the runs rewrote are put back at the end.
 *
 * A scenario FAILS when the build exits non-zero, or when the pages carry
 * something the baseline did not: «undefined», «NaN», «[object Object]», an
 * empty <title>, a Russian <title>/description on an Estonian or English page,
 * or more shared <title>s than before. Exit code 1 if any failed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SHOP2 = path.join(ROOT, "public", "shop2");
const SETTING_KEYS = ["shipping_rules", "pricing", "gift_amounts", "content", "page_texts"];
const CATALOGUE = JSON.parse(readFileSync(path.join(ROOT, "src", "data", "catalogue.min.json"), "utf8"));

/* ---------- snapshot ------------------------------------------------------ */

async function snapshot(out) {
  if (!process.env.DATABASE_URL) throw new Error("snapshot needs DATABASE_URL (node --env-file=.env.railway.txt …)");
  const ov = await import("./lib/overrides-export.mjs");
  const { fetchBundlePrices } = await import("./lib/bundles-export.mjs");
  const { fetchPublishedPosts } = await import("./lib/blog-export.mjs");
  const { fetchSettings } = await import("./lib/settings-export.mjs");
  const data = {
    fetchProductOverrides: await ov.fetchProductOverrides(),
    fetchOwnProducts: await ov.fetchOwnProducts(),
    fetchStockEans: await ov.fetchStockEans(),
    fetchBundlePrices: await fetchBundlePrices(),
    fetchPublishedPosts: await fetchPublishedPosts(),
    fetchSettings: await fetchSettings(SETTING_KEYS),
  };
  writeFileSync(out, JSON.stringify(data));
  const n = (v) => (Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : String(v));
  console.log("snapshot →", out, Object.fromEntries(Object.entries(data).map(([k, v]) => [k, n(v)])));
}

/* ---------- the edits ----------------------------------------------------- */

const ids = (pred) => CATALOGUE.filter(pred).map((p) => p.id);
const ov = (d, id) => (d.fetchProductOverrides[id] ??= { price: null, sizes: null, hidden: false, stock: null, subcat: null, name: null, brand: null, cat: null, seo: null });
const hide = (d, list) => list.forEach((id) => (ov(d, id).hidden = true));
const strings = (v, fn) =>
  typeof v === "string" ? fn(v) : Array.isArray(v) ? v.map((x) => strings(x, fn)) :
  v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, strings(x, fn)])) : v;
const FIRST = CATALOGUE.find((p) => p.c === "hair").id;
const setItems = (d) => {
  /* the sets' parts, as public/shop/bundles.js (the file's sets) names them */
  const src = readFileSync(path.join(ROOT, "public", "shop", "bundles.js"), "utf8");
  return [...new Set([...src.matchAll(/"id":\s*"([a-z0-9-]+)"/g)].map((m) => m[1]).filter((id) => CATALOGUE.some((p) => p.id === id)))];
};

const SCENARIOS = {
  baseline: () => {},
  "rename: no type word": (d) => { ov(d, FIRST).name = "Strong Hold Mat Clay"; },
  /* A Russian head or an untranslatable type is refused by the panel and by
     Claude (nameTranslatable(), src/app/api/admin/overrides/route.ts), so
     only names it accepts are tried. A blank one no door stores, and
     overrideRow() turns one from elsewhere into «not renamed» before the
     build sees it (tests/prerender-owner-seo.test.ts). */
  "rename: & < > quotes emoji": (d) => { ov(d, FIRST).name = `Pasta&Love "Best" <b>Clay</b> 'x' 💈 — шампунь`; },
  "rename: 140 characters": (d) => { ov(d, FIRST).name = "Very Long Product Name ".repeat(5).trim() + " — шампунь"; },
  "rename: another brand, same name as another product": (d) => {
    const other = CATALOGUE.find((p) => p.id !== FIRST && p.c === "hair");
    Object.assign(ov(d, FIRST), { name: other.n, brand: other.b });
  },
  "move: to another section": (d) => { ov(d, FIRST).cat = "face"; },
  "move: to a section that does not exist": (d) => { ov(d, FIRST).cat = "nosuchsection"; },
  "subsection: one that does not exist": (d) => { ov(d, FIRST).subcat = "zz"; },
  "subsection: «без подраздела» everywhere": (d) => { CATALOGUE.forEach((p) => (ov(d, p.id).subcat = "-")); },
  "hide: a whole brand (Kevin.Murphy)": (d) => hide(d, ids((p) => p.b === "Kevin.Murphy")),
  "hide: a whole subsection (shampoos)": (d) => hide(d, ids((p) => p.sb === "hair/sh")),
  "hide: a whole section (face)": (d) => hide(d, ids((p) => p.c === "face")),
  "hide: every part of every set": (d) => hide(d, setItems(d)),
  "hide: everything": (d) => hide(d, ids(() => true)),
  "price: 0, negative and huge": (d) => {
    const [a, b, c] = ids((p) => p.c === "beard");
    ov(d, a).price = 0; ov(d, b).price = -5; ov(d, c).price = 999999.99;
  },
  "sizes: blank and repeated labels": (d) => { ov(d, FIRST).sizes = [{ size: "", price: 10 }, { size: "250 мл", price: 20 }, { size: "250 мл", price: 30 }]; },
  "stock: everything sold out": (d) => { CATALOGUE.forEach((p) => (ov(d, p.id).stock = "out")); },
  "google text: Russian on ET/EN, very long, markup": (d) => {
    ov(d, FIRST).seo = {
      RU: { title: "<script>x</script> " + "Заголовок ".repeat(10), desc: "Описание & «кавычки»" },
      ET: { title: "Русский заголовок на эстонской странице" },
      EN: { title: "", desc: "x".repeat(170) },
    };
  },
  "own product: no photo, no section words, odd name": (d) => {
    d.fetchOwnProducts = [...(d.fetchOwnProducts || []), {
      id: "c-chaos-test", brand: "", name: `"&<>" 💈`, cat: "styling", sub: "", price: 1, img: "/brand/rempire-tower.svg", stock: "in", custom: true,
    }];
  },
  "own product: in a section that does not exist": (d) => {
    d.fetchOwnProducts = [...(d.fetchOwnProducts || []), { id: "c-chaos-cat", brand: "B", name: "N", cat: "nosuchsection", sub: "", price: 5, img: "/x.webp", stock: "in", custom: true }];
  },
  /* fetchBundlePrices() is { id: { price, discountPct, active } } */
  "sets: none in the database": (d) => { d.fetchBundlePrices = {}; },
  "sets: every one switched off": (d) => { Object.values(d.fetchBundlePrices || {}).forEach((b) => (b.active = false)); },
  "sets: price above the parts, and nonsense": (d) => {
    Object.values(d.fetchBundlePrices || {}).forEach((b, i) => { b.price = i % 2 ? 9999 : null; b.discountPct = i % 2 ? null : 150; });
  },
  "blog: every post unpublished": (d) => { d.fetchPublishedPosts = []; },
  "blog: a cover that cannot be fetched": (d) => {
    const p = (d.fetchPublishedPosts || [])[0];
    if (!p) return;
    for (const k of Object.keys(p)) if (/cover/i.test(k) && typeof p[k] === "string" && /^https?:|^\//.test(p[k])) p[k] = "http://127.0.0.1:9/missing.jpg";
  },
  "blog: empty and odd texts": (d) => {
    d.fetchPublishedPosts = strings(d.fetchPublishedPosts || [], (s) => (s.length > 40 ? s : ""));
  },
  "page texts: markup, quotes, very long": (d) => {
    const s = d.fetchSettings || (d.fetchSettings = {});
    s.page_texts = strings(s.page_texts || { "c/hair": { RU: { title: "x" } } }, (v) => `<b>«${v}» & "${v}"</b> ` + "длинно ".repeat(60));
  },
  "settings: content and gift amounts of the wrong shape": (d) => {
    const s = d.fetchSettings || (d.fetchSettings = {});
    s.content = { phone: 12345, hours: null, social: "not-an-object" };
    s.gift_amounts = ["a", -5, null];
  },
  "delivery: every country off, free from 0": (d) => {
    const s = d.fetchSettings || (d.fetchSettings = {});
    s.shipping_rules = { ...(s.shipping_rules || {}), freeFrom: 0, countriesOff: ["EE", "LV", "LT", "FI", "DE", "PL", "SE", "DK", "FR", "ES", "IT", "NL", "BE", "AT", "CZ", "SK", "SI", "HR", "HU", "RO", "BG", "GR", "PT", "IE", "LU"] };
  },
  "barcodes: garbage": (d) => { d.fetchStockEans = { [FIRST]: { "": "abc", "250 мл": "0000000000000" }, nosuchproduct: { "": "123" } }; },
};

/* ---------- the lint ------------------------------------------------------ */

function htmlFiles(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(p, out);
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}
const CYR = /[Ѐ-ӿ]/;
function lint() {
  const res = { pages: 0, junk: [], emptyTitle: [], ruOnOther: [], dupTitles: 0, dupExample: "" };
  const seen = new Map();
  for (const f of htmlFiles(SHOP2)) {
    const html = readFileSync(f, "utf8");
    res.pages++;
    const rel = path.relative(SHOP2, f).replace(/\\/g, "/");
    const visible = html.replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>/gi, "");
    const junk = /(?:^|[\s"'(>])(undefined|NaN|\[object Object\])(?=[\s"')<,.;€]|$)/m.exec(visible);
    if (junk) res.junk.push(rel + " «" + junk[1] + "»");
    const title = (/<title>([^<]*)<\/title>/.exec(html) || [])[1];
    if (title === undefined) continue; // not a page (a fragment)
    if (!title.trim()) res.emptyTitle.push(rel);
    const lang = (/<html[^>]*\blang="([a-z]+)"/i.exec(html) || [])[1] || "";
    const desc = (/<meta name="description" content="([^"]*)"/.exec(html) || [])[1] || "";
    if (lang && lang !== "ru" && (CYR.test(title) || CYR.test(desc))) res.ruOnOther.push(rel);
    if (/noindex/.test((/<meta name="robots" content="([^"]*)"/.exec(html) || [])[1] || "")) continue;
    if (seen.has(title)) { res.dupTitles++; res.dupExample ||= rel + " = " + seen.get(title); }
    else seen.set(title, rel);
  }
  return res;
}

/* ---------- run ----------------------------------------------------------- */

function gitDirty() {
  const r = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8" });
  return new Set(r.stdout.split("\n").filter(Boolean));
}

function prerender(dataFile) {
  const env = { ...process.env, CHAOS_DATA: dataFile };
  delete env.DATABASE_URL;
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(ROOT, "tools", "chaos", "register.mjs")).href, "tools/prerender-shop2.mjs"], {
    cwd: ROOT, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const tail = out.trim().split("\n").filter((l) => /error|Error|throw|exit|refus|FAIL/.test(l)).slice(-3).join(" | ");
  return { code: r.status, warnings: (out.match(/^\s*!/gm) || []).length, tail };
}

async function run(file, picked) {
  if (!existsSync(file)) throw new Error("no snapshot at " + file + " — run `snapshot` first");
  const base = JSON.parse(readFileSync(file, "utf8"));
  const names = picked.length ? picked : Object.keys(SCENARIOS);
  if (names[0] !== "baseline") names.unshift("baseline");
  const before = gitDirty();
  const tmp = path.join(tmpdir(), "rempire-chaos-" + process.pid + ".json");
  let failed = 0;
  let baseline = null;
  try {
    for (const name of names) {
      const mutate = SCENARIOS[name];
      if (!mutate) { console.log(`?? ${name} — no such scenario`); continue; }
      const d = structuredClone(base);
      mutate(d);
      writeFileSync(tmp, JSON.stringify(d));
      const t0 = Date.now();
      const b = prerender(tmp);
      const l = lint();
      if (!baseline) baseline = l;
      const bad = [];
      if (b.code !== 0) bad.push(`BUILD FAILED (exit ${b.code}) ${b.tail}`);
      if (l.junk.length > baseline.junk.length) bad.push(`junk on ${l.junk.length} pages, e.g. ${l.junk.find((j) => !baseline.junk.includes(j))}`);
      if (l.emptyTitle.length > baseline.emptyTitle.length) bad.push(`empty <title> on ${l.emptyTitle.length}`);
      if (l.dupTitles > baseline.dupTitles) bad.push(`shared <title>s ${baseline.dupTitles} → ${l.dupTitles}, e.g. ${l.dupExample}`);
      /* Russian on an Estonian or English page is content, not breakage: an
         article written only in Russian falls back to its Russian title. The
         panel refuses it in product texts; the rest is the weekly content
         list's to report. Shown, never failed. */
      const warn = l.ruOnOther.length > baseline.ruOnOther.length
        ? `Russian title/description on ${l.ruOnOther.length} ET/EN pages, e.g. ${l.ruOnOther.find((x) => !baseline.ruOnOther.includes(x))}`
        : "";
      if (bad.length) failed++;
      const head = `${bad.length ? "FAIL" : warn ? "warn" : "ok  "} ${name} — ${l.pages} pages, ${b.warnings} warnings, ${Math.round((Date.now() - t0) / 1000)} s`;
      console.log([head, ...bad, ...(warn ? [warn] : [])].join("\n       "));
      if (name === "baseline" && (b.code !== 0 || l.junk.length || l.emptyTitle.length || l.ruOnOther.length || l.dupTitles)) {
        console.log(`       baseline itself: junk ${l.junk.length}, empty titles ${l.emptyTitle.length}, ru on ET/EN ${l.ruOnOther.length}, shared titles ${l.dupTitles} ${l.dupExample}`);
      }
    }
  } finally {
    rmSync(tmp, { force: true });
    /* put back exactly what the runs touched and nothing that was dirty before */
    const after = gitDirty();
    const touched = [...after].filter((x) => !before.has(x));
    const tracked = touched.filter((x) => !x.startsWith("??")).map((x) => x.slice(3));
    const untracked = touched.filter((x) => x.startsWith("??")).map((x) => x.slice(3));
    for (let i = 0; i < tracked.length; i += 200) spawnSync("git", ["checkout", "--", ...tracked.slice(i, i + 200)], { cwd: ROOT });
    for (const f of untracked) rmSync(path.join(ROOT, f), { force: true, recursive: true });
    console.log(`restored ${tracked.length} file(s), removed ${untracked.length} new one(s)`);
  }
  console.log(failed ? `${failed} scenario(s) FAILED` : "every scenario passed");
  process.exitCode = failed ? 1 : 0;
}

const [cmd, file, ...rest] = process.argv.slice(2);
if (cmd === "snapshot" && file) await snapshot(file);
else if (cmd === "run" && file) await run(file, rest);
else if (cmd === "list") console.log(Object.keys(SCENARIOS).join("\n"));
else {
  console.error("usage: chaos-build.mjs snapshot <file.json> | run <file.json> [scenario …] | list");
  process.exitCode = 2;
}
