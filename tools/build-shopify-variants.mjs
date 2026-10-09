#!/usr/bin/env node
/**
 * Writes src/data/shopify-variants.json — every Shopify variant id Google
 * still holds, onto the product and the size it is in this shop.
 *
 * Until Merchant Center approves the shop's own feeds (/feed/google-*.xml),
 * it keeps serving Shopify's product sources, and two of their links carry a
 * Shopify VARIANT id — a number that means nothing here:
 *
 *   · the «Checkout» link, `/cart/shopify_ZZ_<product>_<variant>:1` (and
 *     Shopify's own permalink form, `/cart/<variant>:1`) — answered by
 *     src/lib/merchant-cart.ts;
 *   · the landing link, `/en-lv/products/<handle>?variant=<variant>&…` —
 *     answered by src/lib/legacy-redirects.ts, which turns `variant` into the
 *     `?size=` the product page opens on.
 *
 * Both look the variant up in this table:
 *
 *   { "<variant id>": { "p": "<product id>", "s": "<size slug>" } }
 *
 * `p` is the catalogue product (catalogue.min.json). `s` is the `?size=` the
 * product page reads — sizeSlug() of a label of the product's ladder in
 * catalogue.variants.json, the same slug src/lib/merchant-feed.ts writes into
 * its own links and ids. `s` is left out when there is no size to choose (the
 * product is sold here in one size or none) and when the Shopify size is one
 * this shop does not sell; the cart then puts the one size in the basket, or
 * opens the product page and lets the shopper choose.
 *
 * Input: a Merchant Center product export (Products → All products → ⋮ →
 * Download, tab-separated, header row). Columns are found by their header —
 * `id`, `link`, `size`, `title` — and the product by the handle in `link`.
 *
 *   node tools/build-shopify-variants.mjs <export.tsv>
 *
 * Prints how many variants resolved, how many found their size, and every one
 * that did not resolve. Re-run with a newer export, or after the catalogue
 * changes (tools/build-catalogue-variants.mjs); the output is generated — do
 * not hand-edit it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "data", "shopify-variants.json");
const CATALOGUE = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "data", "catalogue.min.json"), "utf8"));
const LADDERS = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "data", "catalogue.variants.json"), "utf8"));
const IDS = new Set(CATALOGUE.map((p) => p.id));

const file = process.argv[2];
if (!file) {
  console.error("usage: node tools/build-shopify-variants.mjs <merchant-center-export.tsv>");
  process.exit(2);
}

/* ---------- reading the export ------------------------------------------ */

/** Tab-separated, with "quoted" cells that may hold tabs, newlines and "" (descriptions do). */
function parseTsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
      continue;
    }
    if (c === '"' && cur === "") quoted = true;
    else if (c === "\t") {
      row.push(cur);
      cur = "";
    } else if (c === "\n") {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = "";
    } else if (c !== "\r") cur += c;
  }
  if (cur !== "" || row.length) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/* ---------- the shop's own spellings ------------------------------------- */

/** src/lib/legacy-redirects.ts — a handle as the catalogue spells it. */
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** src/lib/merchant-feed.ts and public/shop2/app.js — «250 мл» → «250ml», «white / S» → «white-s». */
const sizeSlug = (label) =>
  String(label).toLowerCase().replace(/\s+/g, "").replace(/мл/g, "ml").replace(/г/g, "g")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The catalogue product a Shopify handle names, or null. */
function productOf(handle) {
  const d = safeDecode(handle).toLowerCase();
  if (IDS.has(d)) return d;
  const s = slugify(d);
  return IDS.has(s) ? s : null;
}

/**
 * A product's ladder as the feed spells it: each label with the `?size=` its
 * link carries — a second label with the same slug takes `-<n>`, as in
 * planFeed() in src/lib/merchant-feed.ts.
 */
function ladderOf(productId) {
  const sizes = (LADDERS[productId] && LADDERS[productId].sizes) || [];
  const taken = new Set();
  return sizes.map((label, i) => {
    let slug = sizeSlug(label) || "v" + (i + 1);
    if (taken.has(slug)) slug += "-" + (i + 1);
    taken.add(slug);
    return { label, slug, plain: sizeSlug(label) };
  });
}

/** «250 мл» → { n: 250, unit: "ml" }; «100» → { n: 100, unit: "" }; null for «white / S». */
function measure(s) {
  const m = /^(\d+(?:[.,]\d+)?)\s*(ml|мл|g|г|gr)?$/i.exec(String(s).trim());
  if (!m) return null;
  const u = (m[2] || "").toLowerCase();
  return { n: Number(m[1].replace(",", ".")), unit: u === "мл" ? "ml" : u === "г" || u === "gr" ? "g" : u };
}

/**
 * Which of the product's sizes a Shopify variant is: its `size` cell, else the
 * end of its title («… white / S», «… 150ml», «BODY.BUILDER 400») — spelled
 * the shop's way, then by amount, then (for clothes sold here by colour only)
 * by colour. Null when none fits, or when two would.
 */
function matchSize(ladder, variant) {
  const one = (list) => (list.length === 1 ? list[0] : null);
  const exact = (cand) => one(ladder.filter((r) => r.plain && r.plain === sizeSlug(cand)));
  const byAmount = (cand) => {
    const want = measure(cand);
    if (!want) return null;
    return one(ladder.filter((r) => {
      const got = measure(r.label);
      return got && got.n === want.n && (!got.unit || !want.unit || got.unit === want.unit);
    }));
  };
  const tail = /([^\s/]+)\s*\/\s*([^\s/]+)\s*$/.exec(variant.title);
  const option = tail ? tail[1] + " / " + tail[2] : "";
  const amount = (/(\d+(?:[.,]\d+)?\s*(?:ml|мл|g|г|gr)?)\s*$/i.exec(variant.title) || [])[1] || "";
  for (const cand of variant.sizes) {
    const hit = exact(cand);
    if (hit) return hit;
  }
  if (option) {
    const hit = exact(option);
    if (hit) return hit;
  }
  for (const cand of [...variant.sizes, amount].filter(Boolean)) {
    const hit = byAmount(cand);
    if (hit) return hit;
  }
  if (tail) {
    const colour = sizeSlug(tail[1]);
    const hit = one(ladder.filter((r) => r.plain === colour || r.plain.startsWith(colour + "-")));
    if (hit) return hit;
  }
  return null;
}

/* ---------- the table ---------------------------------------------------- */

const rows = parseTsv(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
const head = rows[0].map((h) => h.trim().toLowerCase());
const col = (name, fallback) => (head.indexOf(name) >= 0 ? head.indexOf(name) : fallback);
const C = { id: col("id", 1), link: col("link", 19), size: col("size", 28), title: col("title", 0) };

/** variant id → what the export says about it, merged over its rows (one per feed label). */
const variants = new Map();
const notShopify = new Set();
for (const r of rows.slice(1)) {
  if (r.length < 2) continue;
  const id = (r[C.id] || "").trim();
  const link = r[C.link] || "";
  const m = /^shopify_[A-Za-z]{2}_(\d+)_(\d+)$/.exec(id);
  if (!m) {
    if (id) notShopify.add(id + "  " + link);
    continue;
  }
  const [, shopifyProduct, vid] = m;
  const v = variants.get(vid) || { vid, shopifyProduct, handles: new Set(), sizes: new Set(), title: "", link };
  const handle = (/\/products\/([^/?#]+)/.exec(link) || [])[1];
  if (handle) v.handles.add(handle);
  const size = (r[C.size] || "").trim();
  if (size) v.sizes.add(size);
  if (!v.title) v.title = (r[C.title] || "").trim();
  variants.set(vid, v);
}

/** How many variants Shopify had of each of its products — in this export. */
const perShopifyProduct = new Map();
for (const v of variants.values()) perShopifyProduct.set(v.shopifyProduct, (perShopifyProduct.get(v.shopifyProduct) || 0) + 1);

const out = {};
const unresolved = [];
const noSize = [];
const tally = { variants: variants.size, resolved: 0, sized: 0, oneSize: 0, sizeNotSold: 0 };
const productsResolved = new Set();
const productsSized = new Set();
for (const v of [...variants.values()].sort((a, b) => (a.vid < b.vid ? -1 : 1))) {
  const product = [...v.handles].map(productOf).find(Boolean);
  if (!product) {
    unresolved.push(`${v.vid}  ${[...v.handles].join(" ") || "(no handle)"}  «${v.title}»`);
    continue;
  }
  tally.resolved++;
  productsResolved.add(product);
  const ladder = ladderOf(product);
  const entry = { p: product };
  const hit = ladder.length ? matchSize(ladder, { sizes: [...v.sizes], title: v.title }) : null;
  const shopifyOne = perShopifyProduct.get(v.shopifyProduct) === 1;
  if (ladder.length > 1 && hit) {
    entry.s = hit.slug;
    tally.sized++;
    productsSized.add(product);
  } else if (ladder.length <= 1 && (shopifyOne || hit || !ladder.length)) {
    /* One size here, or none: there is nothing to choose. */
    tally.oneSize++;
  } else {
    /* A size this shop does not sell. Without `s` the landing link opens the
       product on its first size, and the cart opens the product page — or,
       for a product sold here in ONE size, puts that size in the basket:
       listed below, so a re-run that meets one can decide what it wants. */
    tally.sizeNotSold++;
    noSize.push(`${v.vid}  ${product}  shopify «${[...v.sizes].join("/") || v.title}»  here: ${ladder.map((r) => r.label).join(", ")}`);
  }
  out[v.vid] = entry;
}

/* One variant per line: a diff of a re-run reads as the variants that changed. */
const body = Object.entries(out).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(",\n");
fs.writeFileSync(OUT, "{\n" + body + "\n}\n");

console.log(`${path.relative(ROOT, OUT)}: ${Object.keys(out).length} variants`);
console.log(`  Shopify variant ids in the export:  ${tally.variants} (of ${perShopifyProduct.size} Shopify products)`);
console.log(`  resolved to a product of the shop:  ${tally.resolved} (${productsResolved.size} products)`);
console.log(`  · size matched (s):                 ${tally.sized} (${productsSized.size} products)`);
console.log(`  · one size here or none, no s:      ${tally.oneSize}`);
console.log(`  · a size the shop does not sell:    ${tally.sizeNotSold}`);
for (const line of noSize) console.log("      " + line);
console.log(`  did not resolve:                    ${unresolved.length}`);
for (const line of unresolved) console.log("      " + line);
if (notShopify.size) {
  console.log(`  rows whose id is not a Shopify one:  ${notShopify.size}`);
  for (const line of notShopify) console.log("      " + line);
}
