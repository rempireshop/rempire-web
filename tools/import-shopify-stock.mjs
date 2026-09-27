#!/usr/bin/env node
/**
 * import-shopify-stock.mjs — the launch-day stock import: every size's count
 * in Shopify becomes its counted stock in the new shop's «Склад».
 *
 * Dim, 26.09.2026 (option 1b): the count of each size comes over from Shopify,
 * and «мало» shows only on the last unit (migration 215 made 1 the default
 * threshold). This is the draft that was dry-run on 26.09.2026
 * (Rempire/shopify-stock-2026-09-26/import-draft.mjs) brought into the repo,
 * with one change of source: instead of a list scraped from the Shopify admin
 * and matched by title, it reads Shopify's own inventory export, whose Handle
 * IS the catalogue id here (tools/build-catalogue-full.mjs built the catalogue
 * from the same store's handles, normId() below).
 *
 *   node tools/import-shopify-stock.mjs --csv <export.csv>
 *       dry run from the file alone — no network
 *   RMP_ADMIN_COOKIE=… node tools/import-shopify-stock.mjs --csv <export.csv> --base https://<shop>
 *       dry run + a read-only look at the live «Склад»: before → after per row
 *   RMP_ADMIN_COOKIE=… node tools/import-shopify-stock.mjs --csv <export.csv> --base https://<shop> --apply --confirm ИМПОРТ
 *       writes
 *
 * WHERE THE CSV COMES FROM: Shopify admin → Products → Inventory → Export →
 * «All variants», CSV for Excel/Numbers or plain CSV. Two layouts exist and
 * both are read (formats below); nothing else about the file is assumed.
 *
 *   · row per location (Shopify's inventory export since 2023): Handle, Title,
 *     Option1 Name/Value … Option3 Name/Value, SKU, [HS Code, COO,] Location,
 *     [Bin name,] Incoming, Unavailable, Committed, Available, On hand — the
 *     last five may carry « (not editable)» / « (current)» after the name, and
 *     «On hand (new)» (the column you would type into) is ignored.
 *   · one column per location (the older export): Handle, Title, Option…,
 *     SKU, then one column per location holding the AVAILABLE count; there is
 *     no on-hand figure in it, so --use onHand refuses it.
 *
 * WHAT IT WRITES, AND THROUGH WHICH DOOR: the shop's own, one row at a time —
 *   POST /api/admin/inventory/moves/  { productId, variant, qty, reason: "adjust", ref }
 *     → setQty() in src/lib/inventory.ts: an absolute set («останется N»), one
 *       ledger row, reason «ручная правка», ref «Импорт из Shopify», actor admin;
 *     → a 0 is a real count: the size is tracked from then on and reads «нет»;
 *     → 0 → N fires «Сообщить, когда появится» for that product — which is why
 *       this runs AFTER tools/go-live-reset.mjs (it empties the test requests);
 *     → the owner's manual «нет в наличии» still beats any count.
 * The go-live reset runs WITHOUT --stock (docs/go-live-reset.md, step 6): the
 * 153 barcodes stay bound, and because every count here is absolute, the test
 * sales left in the history do not change the result.
 *
 * A RETRY IS SAFE: setQty is absolute, and every request carries an
 * Idempotency-Key derived from (this CSV, the owner rows, the options, the
 * shelf row), so running the same import twice replays the stored answers
 * instead of writing a second ledger row. A new CSV is a new run.
 *
 * HAND DECISIONS — «owner rows»: a shelf row Shopify cannot be matched to one
 * for one (our card has one row where Shopify has three sizes, or colours
 * where Shopify has colour × size). tools/shopify-stock-owner-rows.json holds
 * the two Dim decided on 26.09.2026; --owner-rows <file> reads another. A row
 * is either a fixed `qty` or a `sum` over the export's rows of one handle,
 * optionally only those with one option value (a colour). An owner row wins
 * over anything matched automatically for the same shelf row.
 *
 * Options
 *   --csv <file>              Shopify's inventory export (required)
 *   --base <url>              the shop, for the live «Склад» and for --apply
 *   --apply --confirm ИМПОРТ  write (needs --base and RMP_ADMIN_COOKIE)
 *   --use available|onHand    which Shopify figure becomes the count (default available:
 *                             onHand also counts units promised to unfulfilled Shopify orders)
 *   --location <name>         which Shopify location, when the export has more than one
 *   --owner-rows <file|none>  default tools/shopify-stock-owner-rows.json
 *   --ref <text>              the reason shown in «История склада» (default «Импорт из Shopify»)
 *   --only <id,id>            only these catalogue ids
 *   --skip-zero               do not write 0 counts (those sizes stay untracked instead of «нет»)
 *   --log <file>              where --apply writes its log (default: next to the CSV)
 *
 * Environment
 *   RMP_ADMIN_COOKIE          the value of the `rmp_admin` cookie of a signed-in panel
 *                             (DevTools → Application → Cookies). Never printed, never written.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

export const CONFIRM_WORD = "ИМПОРТ";
export const DEFAULT_REF = "Импорт из Shopify";
/** stock_levels.low_threshold's default since migration 215 — «мало» on the last unit. */
export const DEFAULT_LOW = 1;
export const DEFAULT_OWNER_ROWS = path.join(HERE, "shopify-stock-owner-rows.json");
const ADMIN_COOKIE = "rmp_admin";

/* ---------- CSV ----------------------------------------------------------- */

/** Quoted fields, doubled quotes, embedded newlines, CRLF — the same parser
    tools/build-catalogue-full.mjs reads Shopify's product export with. */
export function parseCSV(text) {
  const src = String(text).replace(/^﻿/, "");
  const out = [];
  let row = [], cur = "", inQ = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
      } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); out.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur.length || row.length) { row.push(cur); out.push(row); }
  return out.filter((r) => r.some((c) => c.trim() !== ""));
}

/** «Available (not editable)» → «available»; «On hand (current)» → «on hand»; «On hand (new)» stays itself. */
function headKey(h) {
  return String(h).trim().toLowerCase().replace(/\s*\((not editable|current)\)\s*$/, "");
}

/* Columns that describe the variant rather than hold a count — everything
   else in an old-style export is a location. */
const DESCRIPTIVE = new Set([
  "handle", "title", "option1 name", "option1 value", "option2 name", "option2 value",
  "option3 name", "option3 value", "sku", "hs code", "coo", "bin name", "barcode",
]);

/** A count cell: an integer, or null for «not stocked» / blank / anything else. */
function count(cell) {
  const s = String(cell ?? "").trim();
  if (!/^-?\d+$/.test(s)) return null;
  return Number(s);
}

export class ImportError extends Error {}

/**
 * Shopify's inventory export → one row per variant at the chosen location.
 *
 * Returns { format, locations, location, rows, notStocked } where a row is
 * { handle, title, options: [values], sku, available, onHand, line }.
 * `onHand` is null in the old layout, which has no such figure.
 */
export function readInventoryCsv(text, { location = "" } = {}) {
  const table = parseCSV(text);
  if (!table.length) throw new ImportError("the CSV is empty");
  const head = table[0].map(headKey);
  const at = (name) => head.indexOf(name);
  const H = {
    handle: at("handle"), title: at("title"), sku: at("sku"),
    opts: [at("option1 value"), at("option2 value"), at("option3 value")],
    location: at("location"), available: at("available"), onHand: at("on hand"),
  };
  if (H.handle < 0) {
    throw new ImportError(
      "no «Handle» column — this is not Shopify's inventory export (Products → Inventory → Export). " +
        `Columns found: ${table[0].join(", ")}`,
    );
  }

  const perLocation = H.location >= 0 && H.available >= 0;
  let format, locations, pick;
  if (perLocation) {
    format = "row per location";
    locations = [...new Set(table.slice(1).map((r) => String(r[H.location] ?? "").trim()).filter(Boolean))];
  } else {
    if (H.location >= 0 || H.available >= 0) {
      throw new ImportError("the CSV has a «Location» or an «Available» column but not both — a layout this tool does not know");
    }
    format = "column per location";
    locations = table[0].map((h, i) => ({ h: String(h).trim(), i })).filter((c) => c.h && !DESCRIPTIVE.has(headKey(c.h))).map((c) => c.h);
    if (!locations.length) throw new ImportError("no location column after SKU — nothing holds a count");
  }
  if (location) {
    if (!locations.includes(location)) {
      throw new ImportError(`no location «${location}» in the CSV — it has: ${locations.map((l) => `«${l}»`).join(", ")}`);
    }
    pick = location;
  } else if (locations.length === 1) {
    pick = locations[0];
  } else {
    throw new ImportError(
      `the CSV has ${locations.length} locations — say which with --location: ${locations.map((l) => `«${l}»`).join(", ")}`,
    );
  }
  const locCol = perLocation ? -1 : table[0].findIndex((h) => String(h).trim() === pick);

  const rows = [];
  const notStocked = [];
  table.slice(1).forEach((r, k) => {
    const handle = String(r[H.handle] ?? "").trim();
    if (!handle) return;
    if (perLocation && String(r[H.location] ?? "").trim() !== pick) return;
    const options = H.opts
      .map((i) => (i >= 0 ? String(r[i] ?? "").trim() : ""))
      .filter((v) => v && v !== "Default Title");
    const available = count(perLocation ? r[H.available] : r[locCol]);
    const onHand = perLocation && H.onHand >= 0 ? count(r[H.onHand]) : null;
    const base = {
      handle,
      title: H.title >= 0 ? String(r[H.title] ?? "").trim() : "",
      options,
      sku: H.sku >= 0 ? String(r[H.sku] ?? "").trim() : "",
      line: k + 2,
    };
    if (available === null) {
      notStocked.push(base);
      return;
    }
    rows.push({ ...base, available, onHand });
  });
  return { format, locations, location: pick, rows, notStocked };
}

/* ---------- the catalogue -------------------------------------------------- */

/** Three Captain Fawcett handles carry a literal ® — tools/build-catalogue-full.mjs strips it. */
export const normId = (h) => String(h).replace(/[^\x20-\x7e]/g, "");

const ws = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** «250ml», «250 ml», «250 мл» → «250ml»; «50 g»/«50 г» → «50g» — tools/build-catalogue-full.mjs ruSize() in reverse. */
export function normSize(s) {
  return ws(s).toLowerCase()
    .replace(/(\d)\s*(ml|мл)\b/g, "$1ml").replace(/(\d)\s*мл/g, "$1ml")
    .replace(/(\d)\s*(gr|g|г)\b/g, "$1g").replace(/(\d)\s*г(?![a-zа-я])/g, "$1g")
    .replace(/(\d)\s*(pcs|шт)\.?/g, "$1pcs")
    .replace(/\s*\/\s*/g, "/").replace(/\s+/g, "");
}

/** { ids: Set, ladders: {id: [size labels]}, names: {id: "Brand Name"} } from src/data. */
export function loadCatalogue(root = ROOT) {
  const min = JSON.parse(fs.readFileSync(path.join(root, "src/data/catalogue.min.json"), "utf8"));
  const list = Array.isArray(min) ? min : min.items;
  const variants = JSON.parse(fs.readFileSync(path.join(root, "src/data/catalogue.variants.json"), "utf8"));
  const ladders = {};
  for (const [id, v] of Object.entries(variants)) if (v && Array.isArray(v.sizes)) ladders[id] = v.sizes.slice();
  return {
    ids: new Set(list.map((p) => p.id)),
    ladders,
    names: Object.fromEntries(list.map((p) => [p.id, `${p.b} ${p.n}`])),
  };
}

/**
 * Which shelf row one Shopify variant is. `{ size }` — the label the shelf
 * keys it by ("" for a product with no sizes) — or `{ unsure }` with why.
 * `siblings` is how many rows the same handle has in the export.
 */
export function sizeMatch(ladder, options, siblings) {
  const v = options.join(" / ");
  if (!ladder || !ladder.length) {
    if (siblings === 1) return { size: "", how: v ? `no sizes here; Shopify's only variant «${v}»` : "no sizes" };
    return { unsure: `no sizes here, but Shopify has ${siblings} variants` };
  }
  if (!v) {
    if (ladder.length === 1) return { size: ladder[0], how: "single size" };
    return { unsure: `Shopify has no variant name, the sizes here are ${ladder.map((s) => `«${s}»`).join(", ")}` };
  }
  const nv = normSize(v);
  const exact = ladder.filter((s) => normSize(s) === nv);
  if (exact.length === 1) return { size: exact[0], how: exact[0] === v ? "exact" : "normalised" };
  // «Black / S-M» against the size «S-M»: one option on its own
  if (options.length > 1) {
    const parts = options.map(normSize);
    const hit = ladder.filter((s) => parts.includes(normSize(s)));
    if (hit.length === 1) return { size: hit[0], how: "one option of several", near: true };
  }
  // a unit-less number («400» on BODY.BUILDER) against «400 мл»
  if (/^\d+$/.test(v)) {
    const hit = ladder.filter((s) => normSize(s).replace(/[a-z]+$/, "") === v);
    if (hit.length === 1) return { size: hit[0], how: "number without a unit", near: true };
  }
  return { unsure: `no size «${v}» among ${ladder.map((s) => `«${s}»`).join(", ")}` };
}

/* ---------- owner rows ------------------------------------------------------ */

/**
 * The hand decisions file → [{ productId, variant, qty? , sum?, decided, seen }].
 * Refuses anything it cannot read exactly — a decision that is silently
 * misread is worse than one that stops the run.
 */
export function readOwnerRows(text) {
  const doc = JSON.parse(text);
  const rows = Array.isArray(doc) ? doc : doc && Array.isArray(doc.rows) ? doc.rows : null;
  if (!rows) throw new ImportError("owner rows: expected { rows: [...] } or an array");
  return rows.map((r, i) => {
    const where = `owner row ${i + 1}`;
    if (!r || typeof r !== "object") throw new ImportError(`${where}: not an object`);
    const productId = String(r.productId ?? "").trim();
    if (!productId) throw new ImportError(`${where}: no productId`);
    const variant = r.variant == null ? "" : String(r.variant);
    const hasQty = r.qty !== undefined;
    const hasSum = r.sum !== undefined;
    if (hasQty === hasSum) throw new ImportError(`${where} (${productId}): give exactly one of qty or sum`);
    if (hasQty && !(Number.isInteger(r.qty) && r.qty >= 0)) throw new ImportError(`${where} (${productId}): qty must be a whole number ≥ 0`);
    if (hasSum) {
      if (!r.sum || typeof r.sum !== "object" || typeof r.sum.handle !== "string" || !r.sum.handle.trim()) {
        throw new ImportError(`${where} (${productId}): sum needs a handle`);
      }
      if (r.sum.option !== undefined && (typeof r.sum.option !== "string" || !r.sum.option.trim())) {
        throw new ImportError(`${where} (${productId}): sum.option must be a non-empty string`);
      }
    }
    return {
      productId,
      variant,
      ...(hasQty ? { qty: r.qty } : { sum: { handle: r.sum.handle.trim(), ...(r.sum.option ? { option: r.sum.option.trim() } : {}) } }),
      decided: typeof r.decided === "string" ? r.decided : "",
      seen: typeof r.seen === "string" ? r.seen : "",
    };
  });
}

/* ---------- the plan ---------------------------------------------------------- */

const keyOf = (productId, variant) => `${productId}\u0001${variant}`;
const labelOf = (r) => `${r.productId}${r.variant ? " · " + r.variant : ""}`;
const fromOf = (r) => `${r.title || r.handle}${r.options.length ? " · " + r.options.join(" / ") : ""}`;

/**
 * Export + catalogue + hand decisions → what would be written.
 *
 *   plan       [{ productId, variant, qty, from, source: "shopify" | "owner" }]
 *   skipped    [{ productId, variant, qty, from, why }] — matched, deliberately not written
 *   decide     [{ handle, productId?, from, qty, why }] — needs a person: ambiguous or two-on-one
 *   unknown    [{ handle, from, qty }] — a Shopify handle the new catalogue does not have
 *   untouched  [id] — catalogue products no Shopify row and no owner row reached
 *   ownerRows  [{ productId, variant, qty|null, how, seen, decided, problem? }]
 *
 * @param {{ inventory: any, catalogue: any, ownerRows?: any[], use?: string, only?: Set<string> | null, skipZero?: boolean }} opts
 */
export function buildPlan({ inventory, catalogue, ownerRows = [], use = "available", only = null, skipZero = false }) {
  if (use !== "available" && use !== "onHand") throw new ImportError("--use must be available or onHand");
  if (use === "onHand" && inventory.rows.some((r) => r.onHand === null)) {
    throw new ImportError("this export has no «On hand» figure (the old layout holds «Available» only) — use --use available");
  }
  const qtyOf = (r) => Math.max(0, Math.trunc(Number(r[use]) || 0));

  const siblings = new Map();
  for (const r of inventory.rows) siblings.set(r.handle, (siblings.get(r.handle) || 0) + 1);

  const auto = [];
  const decide = [];
  const unknown = [];
  for (const r of inventory.rows) {
    const productId = normId(r.handle);
    if (!catalogue.ids.has(productId)) {
      unknown.push({ handle: r.handle, from: fromOf(r), qty: qtyOf(r) });
      continue;
    }
    const m = sizeMatch(catalogue.ladders[productId], r.options, siblings.get(r.handle));
    if (m.unsure) {
      decide.push({ handle: r.handle, productId, from: fromOf(r), qty: qtyOf(r), why: m.unsure });
      continue;
    }
    auto.push({ productId, variant: m.size, qty: qtyOf(r), from: fromOf(r), how: m.how, source: "shopify" });
  }

  // two Shopify rows on one shelf row: nobody can say which count is right
  const byKey = new Map();
  for (const a of auto) {
    const k = keyOf(a.productId, a.variant);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(a);
  }
  const single = [];
  for (const list of byKey.values()) {
    if (list.length === 1) single.push(list[0]);
    else for (const a of list) decide.push({ handle: a.productId, productId: a.productId, from: a.from, qty: a.qty, why: `${list.length} Shopify rows land on the one shelf row «${labelOf(a)}»` });
  }

  // hand decisions: computed from this export, and they win
  const owned = new Map();
  const ownerOut = [];
  for (const o of ownerRows) {
    const k = keyOf(o.productId, o.variant);
    const base = { productId: o.productId, variant: o.variant, seen: o.seen, decided: o.decided };
    if (!catalogue.ids.has(o.productId)) {
      ownerOut.push({ ...base, qty: null, how: "", problem: "not a product in the catalogue — not written" });
      continue;
    }
    if (o.qty !== undefined) {
      ownerOut.push({ ...base, qty: o.qty, how: "fixed by hand" });
      owned.set(k, { productId: o.productId, variant: o.variant, qty: o.qty, from: "decided by hand", source: "owner" });
      continue;
    }
    const want = o.sum.option ? o.sum.option.toLowerCase() : null;
    const hits = inventory.rows.filter(
      (r) => normId(r.handle) === normId(o.sum.handle) && (!want || r.options.some((v) => v.toLowerCase() === want)),
    );
    if (!hits.length) {
      ownerOut.push({
        ...base,
        qty: null,
        how: "",
        problem: `no row of handle «${o.sum.handle}»${want ? ` with the option «${o.sum.option}»` : ""} in this export — not written`,
      });
      continue;
    }
    const qty = hits.reduce((s, r) => s + qtyOf(r), 0);
    const how = `sum of ${hits.map((r) => `${r.options.join(" / ") || "—"} ${qtyOf(r)}`).join(" + ")}`;
    ownerOut.push({ ...base, qty, how });
    owned.set(k, { productId: o.productId, variant: o.variant, qty, from: `decided by hand: ${how}`, source: "owner" });
  }
  const ownedProducts = new Set([...owned.values()].map((o) => o.productId));

  const plan = [];
  const skipped = [];
  for (const a of single) if (!owned.has(keyOf(a.productId, a.variant))) plan.push(a);
  for (const o of owned.values()) plan.push(o);
  // what a hand decision already answers is not a question any more
  const stillDecide = decide.filter((d) => !ownedProducts.has(d.productId));
  const decidedByHand = decide.filter((d) => ownedProducts.has(d.productId));

  const kept = [];
  for (const p of plan) {
    if (only && !only.has(p.productId)) continue;
    if (skipZero && p.qty === 0) {
      skipped.push({ ...p, why: "--skip-zero" });
      continue;
    }
    kept.push(p);
  }
  kept.sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : a.variant < b.variant ? -1 : a.variant > b.variant ? 1 : 0));

  const reached = new Set([...kept, ...skipped].map((p) => p.productId));
  for (const d of stillDecide) reached.add(d.productId);
  const untouched = [...catalogue.ids].filter((id) => !reached.has(id) && !(only && !only.has(id))).sort();

  return {
    plan: kept,
    skipped,
    decide: only ? stillDecide.filter((d) => only.has(d.productId)) : stillDecide,
    decidedByHand,
    unknown,
    untouched,
    ownerRows: ownerOut,
  };
}

/* ---------- the live «Склад» -------------------------------------------------- */

const STATE_WORD = { in: "в наличии", low: "мало", out: "нет" };
export const stateOf = (qty, threshold) => (qty <= 0 ? "out" : qty <= threshold ? "low" : "in");

/**
 * Plan + the levels GET /api/admin/inventory/ answered (or null) → each row
 * with `before`, `after`, `onShelf`, plus the warnings the dry run prints.
 */
export function compareWithShelf(plan, levels) {
  const live = levels ? new Map(levels.map((l) => [keyOf(l.productId, l.variant), l])) : null;
  const warnings = { notOnShelf: [], overwrite: [], offSale: [], threshold: [] };
  const counts = { in: 0, low: 0, out: 0 };
  const rows = plan.map((p) => {
    const l = live ? live.get(keyOf(p.productId, p.variant)) : undefined;
    const t = l ? Number(l.lowThreshold) : DEFAULT_LOW;
    const after = stateOf(p.qty, Number.isFinite(t) ? t : DEFAULT_LOW);
    counts[after]++;
    const row = {
      ...p,
      after,
      onShelf: live ? Boolean(l) : null,
      before: l ? (l.tracked ? String(l.qty) : "не считали") : live ? "НЕТ СТРОКИ" : "?",
    };
    if (live && !l) warnings.notOnShelf.push(row);
    if (l && Number(l.lowThreshold) !== DEFAULT_LOW) warnings.threshold.push({ ...row, threshold: l.lowThreshold });
    if (l && l.tracked && Number(l.qty) !== p.qty) warnings.overwrite.push(row);
    if (l && l.offSale) warnings.offSale.push(row);
    return row;
  });
  return { rows, counts, warnings, live: Boolean(live) };
}

/* ---------- printing ------------------------------------------------------------ */

export function formatDryRun({ csvName, inventory, use, ref, run, built, compared, ownerFile }) {
  const L = [];
  const { rows, counts, warnings } = compared;
  L.push(
    `Shopify export ${csvName} · ${inventory.format} · location «${inventory.location}» · ` +
      `${inventory.rows.length} variant row(s) · count from «${use}» · run ${run}`,
  );
  L.push(`Reason in «История склада»: «${ref}»${ownerFile ? ` · hand decisions: ${ownerFile}` : ""}`);
  L.push("");
  L.push(`${rows.length} shelf row(s) to set, ${built.skipped.length} skipped.`);
  L.push(
    `After: ${counts.in} «${STATE_WORD.in}», ${counts.low} «${STATE_WORD.low}», ${counts.out} «${STATE_WORD.out}» ` +
      `(per size; «мало» = at or under the row's own threshold, default ${DEFAULT_LOW}).`,
  );
  for (const r of rows) {
    L.push(`  ${labelOf(r)}: ${r.before} → ${r.qty} (${STATE_WORD[r.after]})   ← ${r.from}`);
  }
  if (built.ownerRows.length) {
    L.push("");
    L.push("Hand decisions (owner rows):");
    for (const o of built.ownerRows) {
      const what = o.problem ? `NOT WRITTEN — ${o.problem}` : `${o.qty} (${o.how})`;
      L.push(`  ${labelOf(o)}: ${what}${o.seen ? `   [on ${o.seen}]` : ""}`);
    }
  }
  if (built.skipped.length) {
    L.push("");
    L.push("Skipped:");
    for (const s of built.skipped) L.push(`  ${labelOf(s)} (${s.qty}) — ${s.why}`);
  }
  if (built.decide.length) {
    L.push("");
    L.push(`${built.decide.length} Shopify row(s) NEED A DECISION and are not written — add an owner row or count them in «Склад»:`);
    for (const d of built.decide) L.push(`  ${d.productId || d.handle} ← ${d.from} (${d.qty}) — ${d.why}`);
  }
  if (built.decidedByHand.length) {
    L.push(`${built.decidedByHand.length} Shopify row(s) are answered by the hand decisions above instead of one to one.`);
  }
  if (built.unknown.length) {
    L.push("");
    L.push(`${built.unknown.length} Shopify row(s) have a handle the new shop's catalogue does not have (not written):`);
    for (const u of built.unknown) L.push(`  ${u.handle} ← ${u.from} (${u.qty})`);
  }
  if (built.untouched.length) {
    L.push("");
    L.push(`${built.untouched.length} catalogue product(s) had no Shopify row and keep what they have: ${built.untouched.join(", ")}`);
  }
  if (inventory.notStocked.length) {
    L.push(`${inventory.notStocked.length} variant row(s) are «not stocked» at this location and were ignored.`);
  }
  if (compared.live) {
    if (warnings.notOnShelf.length) {
      L.push("");
      L.push(`${warnings.notOnShelf.length} row(s) have no «Склад» row under that label (a size renamed in the panel?) — SKIPPED on --apply:`);
      for (const r of warnings.notOnShelf) L.push(`  ${labelOf(r)}`);
    }
    if (warnings.threshold.length) {
      L.push("");
      L.push(`${warnings.threshold.length} row(s) have a «мало» threshold other than ${DEFAULT_LOW} (set by hand, or migration 215 not applied):`);
      for (const r of warnings.threshold.slice(0, 20)) L.push(`  ${labelOf(r)}: ${r.threshold}`);
      if (warnings.threshold.length > 20) L.push("  …");
    }
    if (warnings.overwrite.length) {
      L.push("");
      L.push(`${warnings.overwrite.length} row(s) are already counted in the shop and will be OVERWRITTEN:`);
      for (const r of warnings.overwrite) L.push(`  ${labelOf(r)}: ${r.before} → ${r.qty}`);
    }
    if (warnings.offSale.length) {
      L.push(`${warnings.offSale.length} row(s) belong to products hidden from the shop (the count is kept, nothing shows).`);
    }
  }
  return L.join("\n");
}

/* ---------- writing ----------------------------------------------------------------- */

/** One run = one CSV + one set of hand decisions + one set of options. */
export function runId({ csvText, ownerText = "", use, ref, location }) {
  return crypto
    .createHash("sha256")
    .update([csvText, ownerText, use, ref, location].join("\u0001"))
    .digest("hex")
    .slice(0, 16);
}

/** A key src/lib/idempotency.ts accepts: [A-Za-z0-9._:-], 8–200 characters. */
export function idemKey(run, row) {
  return `shopify-import:${run}:${crypto.createHash("sha256").update(keyOf(row.productId, row.variant)).digest("hex").slice(0, 24)}`;
}

function adminHeaders(cookie, extra = {}) {
  return { cookie: `${ADMIN_COOKIE}=${cookie}`, accept: "application/json", ...extra };
}

/**
 * @typedef {(url: string, init: any) => Promise<Response>} FetchLike
 */

/**
 * The live «Склад» — every row, read-only. Throws with the reason on anything but 200 ok.
 *
 * @param {{ base: string, cookie: string, fetchImpl?: FetchLike }} opts
 */
export async function readShelf({ base, cookie, fetchImpl = fetch }) {
  const res = await fetchImpl(`${base}/api/admin/inventory/?filter=all&limit=1000`, {
    headers: adminHeaders(cookie),
    redirect: "manual",
  });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  if (res.status === 401) throw new ImportError(`401 from ${base}/api/admin/inventory/ — RMP_ADMIN_COOKIE is not a signed-in panel on that address`);
  if (!json || !json.ok || !Array.isArray(json.levels)) throw new ImportError(`could not read «Склад» on ${base}: HTTP ${res.status}`);
  return json.levels;
}

/**
 * Writes the plan, one POST per shelf row. A row the live «Склад» does not
 * have is skipped (the route would CREATE a row under that label — a stray
 * shelf line nothing sells from). Stops at the first 401: re-running replays
 * the finished rows and continues with the rest.
 *
 * @param {{ rows: any[], base: string, cookie: string, ref: string, run: string, fetchImpl?: FetchLike,
 *           pause?: number, sleep?: (ms: number) => Promise<void>, say?: (line: string) => void }} opts
 */
export async function applyPlan({ rows, base, cookie, ref, run, fetchImpl = fetch, pause = 60, sleep, say = () => {} }) {
  const wait = sleep || ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  const log = [];
  let done = 0, failed = 0, replayed = 0, stopped = false;
  for (const r of rows) {
    if (r.onShelf === false) {
      log.push({ productId: r.productId, variant: r.variant, qty: r.qty, result: "skipped: no shelf row" });
      continue;
    }
    const body = { productId: r.productId, variant: r.variant, qty: r.qty, reason: "adjust", ref };
    const res = await fetchImpl(`${base}/api/admin/inventory/moves/`, {
      method: "POST",
      headers: adminHeaders(cookie, { "content-type": "application/json", "idempotency-key": idemKey(run, r) }),
      body: JSON.stringify(body),
      redirect: "manual",
    });
    let json = null;
    try { json = await res.json(); } catch { /* not json */ }
    if (res.status === 401) {
      log.push({ productId: r.productId, variant: r.variant, qty: r.qty, result: "401" });
      say("401 — the panel session ended; stopping. Run the same command again: finished rows replay, the rest continue.");
      stopped = true;
      break;
    }
    if (json && json.ok) {
      done++;
      if (json.replayed) replayed++;
      const x = json.result || {};
      log.push({ productId: r.productId, variant: r.variant, qty: r.qty, result: "ok", qtyBefore: x.qtyBefore, qtyAfter: x.qtyAfter, replayed: Boolean(json.replayed) });
      say(`  ✓ ${labelOf(r)}: ${x.qtyBefore} → ${x.qtyAfter}${json.replayed ? " (replay)" : ""}`);
    } else {
      failed++;
      log.push({ productId: r.productId, variant: r.variant, qty: r.qty, result: "error", status: res.status, error: json && json.error });
      say(`  ✗ ${labelOf(r)}: HTTP ${res.status} ${(json && json.error) || ""}`);
    }
    if (pause) await wait(pause); // gentle on a serverless database pool
  }
  return { done, failed, replayed, stopped, log };
}

/* ---------- CLI ------------------------------------------------------------------------ */

export function parseArgs(argv) {
  const out = { csv: "", base: "", apply: false, confirm: "", use: "available", location: "", ownerRows: DEFAULT_OWNER_ROWS, ref: DEFAULT_REF, only: null, skipZero: false, log: "", help: false, unknown: "" };
  const need = (i, name) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new ImportError(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--csv") out.csv = need(i++, a);
    else if (a === "--base") out.base = need(i++, a).replace(/\/+$/, "");
    else if (a === "--apply") out.apply = true;
    else if (a === "--confirm") out.confirm = need(i++, a);
    else if (a === "--use") out.use = need(i++, a);
    else if (a === "--location") out.location = need(i++, a);
    else if (a === "--owner-rows") out.ownerRows = need(i++, a);
    else if (a === "--ref") out.ref = need(i++, a);
    else if (a === "--only") out.only = new Set(need(i++, a).split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--skip-zero") out.skipZero = true;
    else if (a === "--log") out.log = need(i++, a);
    else if (a === "--help" || a === "-h") out.help = true;
    else out.unknown = a;
  }
  return out;
}

/** Why this command may not write — null when it may. Nothing is read or sent before this passes. */
export function applyRefusal(args, cookie) {
  if (!args.apply) return null;
  if (!args.base) return "--apply needs --base <the shop's address>";
  if (!/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(args.base)) return "--base must be https:// (or http://localhost)";
  if (!cookie) return "--apply needs RMP_ADMIN_COOKIE (the rmp_admin cookie of a signed-in panel)";
  if (args.confirm !== CONFIRM_WORD) return `--apply needs --confirm ${CONFIRM_WORD} — it is a real write to the shop's stock`;
  return null;
}

const USAGE = `import-shopify-stock — Shopify's inventory export → counted stock in «Склад».

  node tools/import-shopify-stock.mjs --csv <export.csv>                               dry run, no network
  RMP_ADMIN_COOKIE=… node tools/import-shopify-stock.mjs --csv <export.csv> --base <shop>   + before → after from the live «Склад»
  RMP_ADMIN_COOKIE=… node tools/import-shopify-stock.mjs --csv <export.csv> --base <shop> --apply --confirm ${CONFIRM_WORD}

  --use available|onHand   --location <name>   --owner-rows <file|none>   --ref <text>
  --only <id,id>           --skip-zero         --log <file>

The export: Shopify admin → Products → Inventory → Export. Run AFTER the go-live reset
(without --stock) and as the last step before DNS — docs/go-live.md, the day, step 4.`;

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`import-shopify-stock: ${err.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (args.help) return console.log(USAGE);
  if (args.unknown) {
    console.error(`Unknown argument: ${args.unknown}\n\n${USAGE}`);
    process.exit(2);
  }
  if (!args.csv) {
    console.error(`--csv <file> is required.\n\n${USAGE}`);
    process.exit(2);
  }
  const cookie = process.env.RMP_ADMIN_COOKIE || "";
  const refusal = applyRefusal(args, cookie);
  if (refusal) {
    console.error(`import-shopify-stock: ${refusal}`);
    process.exit(2);
  }

  const csvText = fs.readFileSync(args.csv, "utf8");
  const inventory = readInventoryCsv(csvText, { location: args.location });
  const ownerFile = args.ownerRows && args.ownerRows !== "none" ? args.ownerRows : "";
  const ownerText = ownerFile ? fs.readFileSync(ownerFile, "utf8") : "";
  const ownerRows = ownerText ? readOwnerRows(ownerText) : [];
  const catalogue = loadCatalogue();
  const built = buildPlan({ inventory, catalogue, ownerRows, use: args.use, only: args.only, skipZero: args.skipZero });
  const run = runId({ csvText, ownerText, use: args.use, ref: args.ref, location: inventory.location });

  let levels = null;
  if (args.base && cookie) {
    levels = await readShelf({ base: args.base, cookie });
    console.log(`«Склад» on ${args.base}: ${levels.length} shelf rows, ${levels.filter((l) => l.tracked).length} already counted.`);
  } else if (args.base) {
    console.log("No RMP_ADMIN_COOKIE — a dry run from the export alone, with no live comparison.");
  }
  const compared = compareWithShelf(built.plan, levels);
  console.log(
    formatDryRun({
      csvName: path.basename(args.csv),
      inventory,
      use: args.use,
      ref: args.ref,
      run,
      built,
      compared,
      ownerFile: ownerFile ? path.relative(process.cwd(), ownerFile) || ownerFile : "",
    }),
  );

  if (!args.apply) {
    console.log(`\nDRY RUN — nothing was written. Add --base <shop> --apply --confirm ${CONFIRM_WORD} (with RMP_ADMIN_COOKIE) to write.`);
    return;
  }
  if (!compared.rows.length) {
    console.error("\nNothing to write — refusing an empty import.");
    process.exit(1);
  }
  console.log(`\nWriting ${compared.rows.filter((r) => r.onShelf !== false).length} row(s) to ${args.base} …`);
  const out = await applyPlan({ rows: compared.rows, base: args.base, cookie, ref: args.ref, run, say: (s) => console.log(s) });
  const logFile = args.log || path.join(path.dirname(path.resolve(args.csv)), `import-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(logFile, JSON.stringify({ base: args.base, run, use: args.use, ref: args.ref, location: inventory.location, ...out }, null, 1));
  console.log(`\n${out.done} written (${out.replayed} replays), ${out.failed} failed${out.stopped ? ", STOPPED at a 401" : ""}. Log: ${logFile}`);
  process.exit(out.failed || out.stopped ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof ImportError ? `import-shopify-stock: ${err.message}` : err);
    process.exit(err instanceof ImportError ? 2 : 1);
  });
}
