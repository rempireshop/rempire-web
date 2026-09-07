#!/usr/bin/env node
/**
 * What the shop's search finds, on real phrases — before and after.
 *
 *   node tools/search-bench.mjs            the two totals and what changed
 *   node tools/search-bench.mjs --misses   also every phrase that still finds nothing
 *   node tools/search-bench.mjs --gains    also every phrase the new search rescued
 *   node tools/search-bench.mjs --json     machine-readable
 *   node tools/search-bench.mjs "жирные волосы"   one phrase, with the products
 *
 * The phrases are in tools/search-queries.json: the Google Search Console
 * export of 07.09.2026 (554 queries, 28 days) and the concern phrases a
 * shopper uses about themselves, in all three languages.
 *
 * BEFORE is frozen here, on purpose (LEGACY below): the six lines
 * public/shop2/app.js carried on 07.09.2026, quoted verbatim, so the
 * comparison keeps meaning something a year from now. AFTER is not a copy —
 * it is **sliced out of app.js by source text** and run for real, so this
 * measures the shop and not a retyped idea of it. If app.js drops or renames
 * one of the functions, the slice fails loudly rather than measuring nothing.
 *
 * No network, no model: this is the free half of the search (docs/audit/
 * 2026-09-07-search.md). What the model adds sits on top of it and is
 * measured by hand in that report.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "public/shop2/app.js");
const src = readFileSync(APP, "utf8");

/* ---------- the shop's own data, as the browser gets it ------------------ */
const ctx = vm.createContext({});
function loadGlobals(file, names) {
  const code = readFileSync(join(ROOT, file), "utf8");
  vm.runInContext(code + "\n;" + names.map((n) => `this.${n}=${n};`).join(""), ctx);
}
loadGlobals("public/shop/catalogue2.js", ["CATALOGUE", "CAT_NAMES"]);
loadGlobals("public/shop/content.js", ["CONTENT"]);
loadGlobals("public/shop/content.ru.js", ["CONTENT_RU"]);
loadGlobals("public/shop/content.et.js", ["CONTENT_ET"]);

/* ---------- BEFORE: app.js as of 07.09.2026, quoted ---------------------- */
const LEGACY = `
  function stem(w) {
    return w.length > 5 ? w.slice(0, w.length - 2) : w.length > 4 ? w.slice(0, w.length - 1) : w;
  }
  function legacySearch(query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return [];
    var words = q.split(/\\s+/).map(stem);
    return CATALOGUE.filter(function (p) {
      var hay = (p.name + " " + p.brand + " " + CAT_NAMES[p.cat]).toLowerCase();
      for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) return false;
      return true;
    });
  }
  this.legacySearch = legacySearch;
`;
vm.runInContext(LEGACY, ctx);

/* ---------- AFTER: the real functions, cut out of app.js ----------------- */
/** `function <name>(…) { … }` by brace matching — the idiom in tests/checkout-parity.test.ts. */
export function slice(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has function ${name}()`);
  let depth = 0;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces around ${name}() in app.js`);
}
/** `var <NAME> = …;` up to the semicolon that closes it, by bracket matching. */
export function sliceVar(name) {
  const start = src.indexOf(`var ${name} = `);
  if (start < 0) throw new Error(`public/shop2/app.js no longer has var ${name}`);
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "[" || c === "{" || c === "(") depth++;
    else if (c === "]" || c === "}" || c === ")") depth--;
    else if (c === ";" && depth === 0) return src.slice(start, i + 1);
    else if (c === "/" && depth === 0 && src[i + 1] === "*") i = src.indexOf("*/", i) + 1;
  }
  throw new Error(`no closing ; for var ${name} in app.js`);
}

export const SEARCH_PARTS = {
  vars: ["SRCH_WIDEN", "SRCH_WIDE_MAX", "SRCH_SUFFIX_RU", "SRCH_SUFFIX_LAT", "SRCH_STOP",
    "SRCH_BRIDGE", "SRCH_CONCERNS", "SRCH_GEN"],
  fns: ["stem", "srchNorm", "srchStem", "srchWords", "srchGroups", "srchConcerns", "srchText",
    "srchIndex", "srchNameBlob", "srchBlob", "srchExtra", "searchNames", "searchWide"],
};

/** The whole search, lifted out of app.js and given the stubs it calls. */
export function buildSearch(context = ctx) {
  const body = `
    ${SEARCH_PARTS.vars.map(sliceVar).join("\n")}
    ${SEARCH_PARTS.fns.map(slice).join("\n")}
    function descOvText(p) { return ""; }
    function searchAll(query, aiTerms) {
      var q = String(query || "").trim().toLowerCase();
      if (!q) return [];
      var res = searchNames(q);
      if (res.length >= SRCH_WIDEN && !(aiTerms && aiTerms.length)) return res;
      return res.concat(searchWide(query, res, aiTerms));
    }
    this.searchAll = searchAll;
    this.searchNames = searchNames;
    this.srchNorm = srchNorm;
    this.srchStem = srchStem;
    this.srchGroups = srchGroups;
    this.srchConcerns = srchConcerns;
    this.srchBlob = srchBlob;
  `;
  vm.runInContext(body, context);
  return context;
}

/* ---------- the run ------------------------------------------------------ */
function main() {
  buildSearch();
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const one = argv.filter((a) => !a.startsWith("--")).join(" ");
  const before = (q) => ctx.legacySearch(q);
  const after = (q) => ctx.searchAll(q);

  if (one) {
    const b = before(one), a = after(one);
    console.log(`«${one}»  before ${b.length} · after ${a.length}`);
    for (const p of a.slice(0, 20)) {
      console.log(`  ${b.includes(p) ? " " : "+"} ${p.brand} — ${p.name}`);
    }
    return;
  }

  const QUERIES = JSON.parse(readFileSync(join(ROOT, "tools/search-queries.json"), "utf8"));
  const groups = [["concerns", QUERIES.concerns], ["gsc", QUERIES.gsc]];
  const report = {};
  for (const [name, list] of groups) {
    const rows = list.map((q) => ({ q, before: before(q).length, after: after(q).length }));
    const shrank = rows.filter((r) => r.after < r.before);
    report[name] = {
      queries: rows.length,
      foundBefore: rows.filter((r) => r.before > 0).length,
      foundAfter: rows.filter((r) => r.after > 0).length,
      rescued: rows.filter((r) => r.before === 0 && r.after > 0),
      stillEmpty: rows.filter((r) => r.after === 0),
      shrank,
    };
  }
  if (flags.has("--json")) {
    console.log(JSON.stringify(report, null, 1));
    return;
  }
  for (const [name, r] of Object.entries(report)) {
    const pc = (n) => ((100 * n) / r.queries).toFixed(1) + "%";
    console.log(
      `\n${name}: ${r.queries} phrases · found before ${r.foundBefore} (${pc(r.foundBefore)})` +
      ` → after ${r.foundAfter} (${pc(r.foundAfter)}) · rescued ${r.rescued.length}` +
      ` · still empty ${r.stillEmpty.length} · lost results ${r.shrank.length}`,
    );
    if (r.shrank.length) for (const s of r.shrank) console.log(`   LOST «${s.q}» ${s.before} → ${s.after}`);
    if (flags.has("--gains")) for (const g of r.rescued) console.log(`   + «${g.q}» → ${g.after}`);
    if (flags.has("--misses")) for (const m of r.stillEmpty) console.log(`   · «${m.q}»`);
  }
  const t0 = Date.now();
  for (const q of QUERIES.concerns) after(q);
  console.log(`\n${QUERIES.concerns.length} widened searches in ${Date.now() - t0} ms`);
}

if (process.argv[1] && process.argv[1].endsWith("search-bench.mjs")) main();
