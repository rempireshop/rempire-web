/* The full active catalogue (219 products) from the admin CSV export,
   superseding the 95-product prototype subset. The 95 existing entries are
   kept verbatim — their images, RU names, sizes and prices are already
   curated; only NEW handles get generated entries.

   Outputs:
     public/shop/catalogue2.js  — full catalogue (existing 95 + ~124 new)
     public/shop/content.js     — EN descriptions for ALL active products
     tools/harvest/new-images.json — id -> [source urls] for the cutout fleet
     (new entries get name = EN title minus vendor; RU names arrive with the
      translation pass into names.ru inside content translations) */

import { readFile, writeFile } from "node:fs/promises";
import { parse } from "node:path";
import path from "node:path";
import fs from "node:fs";

const ROOT = "C:/Users/Dmitri.MARKIT/source/repos/rempire-web";
const CSV = "C:/Users/DMITRI~1.MAR/AppData/Local/Temp/claude/C--Users-Dmitri-MARKIT-source-repos-Rempire/d86fba33-c4c4-4dad-a0f6-a1d47ab1c4e3/scratchpad/exports/products_export_1.csv";

// ---------- tiny CSV parser (quoted fields, embedded newlines) ----------
function parseCSV(text) {
  const rows = []; let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
      else if (c !== "\r") cur += c;
    }
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const raw = await readFile(CSV, "utf8");
const rows = parseCSV(raw);
const H = rows[0];
const col = name => H.indexOf(name);
const C = {
  handle: col("Handle"), title: col("Title"), body: col("Body (HTML)"), vendor: col("Vendor"),
  type: col("Type"), tags: col("Tags"), status: col("Status"),
  o1name: col("Option1 Name"), o1val: col("Option1 Value"),
  o2val: col("Option2 Value"),
  price: col("Variant Price"), qty: col("Variant Inventory Qty"),
  imgSrc: col("Image Src"), imgPos: col("Image Position"),
  seoT: col("SEO Title"), seoD: col("SEO Description"),
};

// group rows by handle
const byHandle = new Map();
for (const r of rows.slice(1)) {
  const h = r[C.handle]; if (!h) continue;
  if (!byHandle.has(h)) byHandle.set(h, []);
  byHandle.get(h).push(r);
}

// active = status 'active' on the first row of the handle
const active = [...byHandle.entries()].filter(([h, rs]) => rs[0][C.status] === "active");
console.log("active handles:", active.length);

// existing curated catalogue
const catSrc = await readFile(path.join(ROOT, "public/shop/catalogue.js"), "utf8");
const CATALOGUE = new Function(catSrc + "\nreturn CATALOGUE;")();
const CAT_NAMES = new Function(catSrc + "\nreturn CAT_NAMES;")();
const existing = new Map(CATALOGUE.map(p => [p.id, p]));

// ---------- brand extraction (Vendor is the shop name for 204/219) ----------
const BRANDS = [
  ["Kevin.Murphy", /kevin\.?\s?murphy|young\.again|plumping\.wash/i],
  ["System 4", /system\s?4/i],
  ["Paul Mitchell", /paul mitchell|\bmitch\b/i],
  ["Davines", /davines/i],
  ["Captain Fawcett", /captain fawcett|fawcett/i],
  ["Proraso", /proraso/i],
  ["Gatsby", /gatsby/i],
  ["Cosrx", /cosrx/i],
  ["Anua", /\banua\b/i],
  ["Lumin Skin", /lumin/i],
  ["Gummy", /gummy/i],
  ["Xerjoff", /xerjoff/i],
  ["Creed", /\bcreed\b/i],
  ["Tom Ford", /tom ford/i],
  ["Versace", /versace/i],
  ["Guerlain", /guerlain/i],
  ["Christian Dior", /dior/i],
  ["Roja", /\broja\b/i],
  ["Byredo", /byredo/i],
  ["Yumain", /yumain/i],
  ["LANEIGE", /laneige/i],
  ["Nature Republic", /nature republic/i],
  ["CBD Daily", /cbd daily/i],
  ["Maison Francis Kurkdjian", /kurkdjian|baccarat rouge/i],
  ["Kilian", /kilian/i],
];
function findBrand(title, tags, vendor) {
  const hay = title + " " + tags;
  for (const [canon, re] of BRANDS) if (re.test(hay)) return canon;
  return "Rempire"; // REMPIRE merch and own products
}

/* The store's own Type field misfiles plenty (ANGEL.MASQUE typed as gel,
   Clear Essential Shampoo tagged into fragrance) — the brand is the reliable
   signal, keywords only refine within it. */
const HAIR_BRANDS = /^(Kevin\.Murphy|Davines|Paul Mitchell|System 4|CBD Daily|Lumin Skin|Gummy)$/;
const SKIN_BRANDS = /^(Cosrx|Anua|LANEIGE|Nature Republic)$/;
const PARF_BRANDS = /^(Byredo|Kilian|Maison Francis Kurkdjian|Xerjoff|Creed|Tom Ford|Versace|Guerlain|Christian Dior|Roja)$/;
const STYLING_RE = /session\.spray|anti\.gravity|bedroom\.hair|doo\.over|killer\.waves|shimmer|powder|\bwax\b|clay|paste|pomade|putty|\bgel\b|sea salt|texturizing/i;
function decideCat(brand, title, base) {
  if (base === "merch") return base;
  const n = title.toLowerCase();
  if (PARF_BRANDS.test(brand)) return /body wash|soap|body lotion/.test(n) ? "body" : "perfume";
  if (brand === "Yumain") return "body"; // tattoo aftercare
  if (SKIN_BRANDS.test(brand)) return "face";
  if (HAIR_BRANDS.test(brand)) return STYLING_RE.test(n) ? "styling" : "hair";
  if (brand === "Captain Fawcett")
    return /beard|moustache|mustache|shav/i.test(n) ? "beard" : "styling";
  if (brand === "Gatsby") return "styling";
  return base;
}

// ---------- category mapping from Type/Tags ----------
function mapCat(type, tags, title) {
  const t = (type + " " + tags + " " + title).toLowerCase();
  if (/t-shirt|tshirt|merch|oversized|decor|v-neck/.test(t)) return "merch";
  if (/perfume|parfum|cologne|edp|edt|fragrance/.test(t)) return "perfume";
  if (/beard|after ?shave|shaving|moustache|mustache/.test(t)) return "beard";
  if (/soap|body wash|body lotion|deodorant|body/.test(t) && !/hair|body_hair/.test(type.toLowerCase())) return "body";
  if (/skin|face|toner|cleanser|moisturi|cream|serum(?!.*hair)|eye|lip|mask(?!.*hair)/.test(t) && !/hair/.test(t)) return "face";
  if (/styling|paste|gel|wax|pomade|clay|powder|putty|fiber|glaze/.test(t)) return "styling";
  return "hair";
}

function ruSize(v) {
  return String(v)
    .replace(/(\d+(?:[.,]\d+)?)\s*ml\b/i, "$1 мл")
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:g|gr)\b/i, "$1 г")
    .trim();
}

function ruTypeOne(t) {
  if (/shampoo/.test(t)) return "шампунь";
  if (/conditioner|\brinse\b/.test(t)) return "кондиционер";
  if (/mask|masque/.test(t)) return "маска";
  if (/patch/.test(t)) return "патчи";
  if (/serum/.test(t)) return "сыворотка";
  if (/toner/.test(t)) return "тоник";
  if (/spray|mist/.test(t)) return "спрей";
  if (/\boil\b/.test(t)) return "масло";
  if (/balm|balsam/.test(t)) return "бальзам";
  if (/paste/.test(t)) return "паста";
  if (/\bwax\b/.test(t)) return "воск";
  if (/powder/.test(t)) return "пудра";
  if (/\bgel\b/.test(t)) return "гель";
  if (/cream/.test(t)) return "крем";
  if (/foam/.test(t)) return "пенка";
  if (/lotion/.test(t)) return "лосьон";
  return "";
}
// the store's own Type field misfiles some products (Conditioner rows typed
// Shampoo) — the title wins, Type is only the fallback
function ruType(type, title) {
  return ruTypeOne(title.toLowerCase()) || ruTypeOne(type.toLowerCase());
}

/* Three Captain Fawcett handles carry a literal ® — history URLs
   percent-encode it and every id lookup after popstate misses. ASCII-only
   ids everywhere; assemble-translations applies the same strip to the
   translation chunks that were cut before this rule existed. */
const normId = h => h.replace(/[^\x20-\x7e]/g, "");

const newImages = {};
const content = {};
const out = [];
let kept = 0, added = 0, imgJobs = 0;

for (const [rawH, rs] of active) {
  const h = normId(rawH);
  const first = rs[0];
  if (h === "delivery" || first[C.type] === "delivery") continue; // shipping-fee pseudo-product
  const body = first[C.body];
  if (body && body.length > 40) content[h] = body;

  if (existing.has(h)) {
    // keep curated entry but refresh stock from the live export
    const e = { ...existing.get(h) };
    const q = rs.reduce((s, r) => s + (parseInt(r[C.qty]) || 0), 0);
    e.stock = q <= 0 ? "out" : q <= 2 ? "low" : "in";
    out.push(e); kept++; continue;
  }

  const title = first[C.title];
  const brand = findBrand(title, first[C.tags] || "", first[C.vendor] || "");
  let name = title.replace(/\s*[-–—]\s*For (Wo)?men\s*$/i, "").replace(/\s+/g, " ").trim();
  const rt = ruType(first[C.type] || "", title);
  if (rt && !name.includes(rt)) name = name + " — " + rt;

  const cat = decideCat(brand, title, mapCat(first[C.type] || "", first[C.tags] || "", title));

  // variants: rows with a price
  const vars = rs.filter(r => r[C.price]);
  const prices = vars.map(r => parseFloat(r[C.price])).filter(n => !isNaN(n));
  const price = prices.length ? Math.min(...prices) : 0;
  const qty = vars.reduce((s, r) => s + (parseInt(r[C.qty]) || 0), 0);
  const o1 = [...new Set(vars.map(r => r[C.o1val]).filter(v => v && v !== "Default Title"))];

  // images ordered by position
  const imgs = rs.filter(r => r[C.imgSrc]).sort((a, b) => (+a[C.imgPos] || 9) - (+b[C.imgPos] || 9)).map(r => r[C.imgSrc]);
  const uniq = [...new Set(imgs)].slice(0, 3);
  if (uniq.length) { newImages[h] = uniq; imgJobs += uniq.length; }

  const entry = {
    id: h, brand, name, cat,
    price, img: "/shop/img/" + h + "-0.webp",
    stock: qty <= 0 ? "out" : qty <= 2 ? "low" : "in",
  };
  if (uniq.length > 1) {
    entry.img2 = "/shop/img/" + h + "-1.webp";
    entry.gallery = uniq.map((_, i) => "/shop/img/" + h + "-" + i + ".webp");
  }
  if (o1.length > 1) {
    entry.sizes = o1.map(ruSize);
    const pMap = {}; vars.forEach(r => { const v = r[C.o1val]; if (v && r[C.price]) pMap[v] = parseFloat(r[C.price]); });
    entry.prices = o1.map(v => pMap[v] ?? price);
    if (entry.prices.some(p2 => p2 !== price)) entry.priceFrom = true;
  }
  const seoT = first[C.seoT], seoD = first[C.seoD];
  if (seoT || seoD) entry.seo = { t: seoT || "", d: seoD || "" };
  out.push(entry); added++;
}

// stable order: the FULL curated set first, in its own order (incl. the two
// deliberately-included drafts absent from "active"), then new grouped by cat
const catOrder = ["hair", "styling", "beard", "face", "body", "perfume", "merch"];
const refreshed = new Map(out.filter(p => existing.has(p.id)).map(p => [p.id, p]));
const curated = CATALOGUE.map(p => refreshed.get(p.id) || p);
const newOnes = out.filter(p => !existing.has(p.id))
  .sort((a, b) => catOrder.indexOf(a.cat) - catOrder.indexOf(b.cat) || a.brand.localeCompare(b.brand));
const finalList = [...curated, ...newOnes];

const header = "/* Generated by tools/build-catalogue-full.mjs from the admin export of " +
  new Date().toISOString().slice(0, 10) + " — the FULL active catalogue. The first " + kept +
  " entries are the curated prototype set, preserved verbatim. */\n";
const js = header +
  "const CAT_NAMES = " + JSON.stringify(CAT_NAMES, null, 1) + ";\n" +
  "const CATALOGUE = " + JSON.stringify(finalList, null, 1) + ";\n";
await writeFile(path.join(ROOT, "public/shop/catalogue2.js"), js, "utf8");
await writeFile(path.join(ROOT, "tools/harvest/new-images.json"), JSON.stringify(newImages, null, 1), "utf8");

// content.js grows to all active products (sanitization happens in build-content pass 2)
console.log(JSON.stringify({ kept, added, total: finalList.length, imgJobs, contentEntries: Object.keys(content).length }, null, 1));

// hand raw EN bodies to the translator fleet
await writeFile(path.join(ROOT, "tools/harvest/bodies-en.json"), JSON.stringify(content), "utf8");
