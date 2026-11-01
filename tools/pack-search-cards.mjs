#!/usr/bin/env node
/**
 * Search cards: what each product IS and what it is FOR, written once by the
 * model, so the shop's search stops depending on word lists somebody keeps
 * by hand (docs/plan-2026-11-01-search-cards.md).
 *
 * Renat, 01.11.2026: «shampoo» did not find a single Kevin.Murphy wash — their
 * names say only «— шампунь». The quick fix taught the search a table of
 * product types (SRCH_TYPE in public/shop2/app.js); Dim asked for a search
 * that needs no table at all. So the model reads every product's name and
 * descriptions ONCE, at build time, and writes for it:
 *
 *   type   2–6 terms per language naming what it is («shampoo», «šampoon»,
 *          «шампунь», «hair wash»)
 *   about  the phrases a shopper types when it is the right answer — purpose,
 *          hair or skin type, concern, when it is used («after shampoo»),
 *          what it goes with
 *   vec    those words as a meaning vector (text-embedding-3-small, 256
 *          numbers, int8, base64), for questions no word list foresees
 *
 * Written to public/shop/search-cards.json (gitignored), plus the vectors of
 * the known search phrases in public/shop/search-qvec.json. Nothing in the
 * shop reads either yet — this step only produces and publishes the data.
 *
 * Cost and failure:
 *  - A card is keyed by a hash of its inputs; an unchanged product reuses the
 *    card the live shop already serves (fetched from rempireshop.com), so a
 *    build pays only for what changed. Every product from scratch: ~220 calls.
 *  - The model runs here, on the build machine — never in a request, so the
 *    shop's function CPU is untouched.
 *  - It FAILS OPEN, always exit 0. No key, no network, a 500, a timeout: the
 *    cards it already has are written back and the build goes on. A deploy
 *    must never stop because OpenAI is having a bad day.
 *  - It only CALLS the model on a production build (VERCEL_ENV=production) or
 *    when SEARCH_CARDS_GENERATE=1 — a preview build or CI reuses, never pays.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { chatParams, openaiModel } from "./lib/openai-model.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public/shop/search-cards.json");
const OUT_Q = join(ROOT, "public/shop/search-qvec.json");
const LIVE = (process.env.SEARCH_CARDS_PREV_BASE || "https://rempireshop.com").replace(/\/+$/, "");

/** Bump to rewrite every card (a new prompt, a new shape). */
export const CARD_VERSION = 1;
export const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIMS = 256;
const DESC_MAX = 1500;
const BUDGET_MS = Number(process.env.SEARCH_CARDS_BUDGET_MS || 240_000);
const MAX_NEW = Number(process.env.SEARCH_CARDS_MAX || 400);
const POOL = 8;

const log = (s) => console.log("pack-search-cards: " + s);
const warn = (s) => console.warn("! pack-search-cards: " + s);

/* ---------- the products, as the build knows them -------------------------- */

function loadGlobals(file, names) {
  const ctx = vm.createContext({});
  vm.runInContext(readFileSync(join(ROOT, file), "utf8") + "\n;" + names.map((n) => `this.${n}=${n};`).join(""), ctx);
  return ctx;
}

export const plain = (html) =>
  String(html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ").trim().slice(0, DESC_MAX);

const tri = (v) => {
  if (!v) return {};
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return {}; } }
  return v && typeof v === "object" ? v : {};
};

async function readDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return { over: {}, own: [] };
  let pg;
  try { ({ default: pg } = await import("pg")); } catch { return { over: {}, own: [] }; }
  const { sslFor } = await import("./migrate.mjs");
  const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });
  try {
    await client.connect();
    // every column — the build runs before the migrations (overrides-export.mjs)
    const o = await client.query("select * from product_overrides");
    const over = {};
    for (const r of o.rows) over[r.product_id] = r;
    const c = await client.query("select * from custom_products where active = true order by created_at, id");
    return { over, own: c.rows };
  } catch (err) {
    warn("could not read the database (" + (err && err.message) + ") — the file's own names and texts this run");
    return { over: {}, own: [] };
  } finally {
    await client.end().catch(() => {});
  }
}

/** Every product the shop can show, with the words the model should read. */
export function productInputs({ CATALOGUE, CAT_NAMES, CONTENT, CONTENT_RU, CONTENT_ET }, over, own) {
  const out = [];
  for (const p of CATALOGUE) {
    const o = over[p.id] || {};
    const d = tri(o.description);
    out.push({
      id: p.id,
      name: (o.name && String(o.name).trim()) || p.name,
      brand: (o.brand && String(o.brand).trim()) || p.brand,
      cat: (o.cat && String(o.cat).trim()) || p.cat,
      ru: plain(d.RU || CONTENT_RU[p.id]), en: plain(d.EN || CONTENT[p.id]), et: plain(d.ET || CONTENT_ET[p.id]),
    });
  }
  for (const r of own) {
    const d = tri(r.description);
    out.push({ id: String(r.id), name: String(r.name || ""), brand: String(r.brand || ""), cat: String(r.cat || ""),
      ru: plain(d.RU), en: plain(d.EN), et: plain(d.ET) });
  }
  for (const x of out) x.section = CAT_NAMES[x.cat] || x.cat;
  return out.filter((x) => x.id && x.name);
}

export const inputHash = (x, model) =>
  createHash("sha256").update(JSON.stringify([CARD_VERSION, model, x.name, x.brand, x.cat, x.ru, x.en, x.et])).digest("hex").slice(0, 16);

/* ---------- the model ------------------------------------------------------- */

export function cardPrompt(x) {
  const system = [
    "You write search keywords for one product of REMPIRE, a men's grooming shop in Tallinn",
    "(hair care, styling, beard care, face care, body care, fragrance, merch).",
    "Shoppers search in Russian, Estonian and English. Answer with JSON only:",
    '{"type":{"ru":[],"et":[],"en":[]},"about":{"ru":[],"et":[],"en":[]}}',
    "type: 2-6 short terms per language naming WHAT the product is - its plain product type and the",
    "everyday words for it (en: shampoo, hair wash; ru: шампунь; et: šampoon, juuksešampoon).",
    "Estonian compounds as Estonians write them. No brand, no product line name.",
    "about: 5-15 short phrases per language a shopper might type when this product is the right answer:",
    "what it does, hair/skin/beard type, the problem it solves, when it is used (e.g. after shampoo,",
    "after shaving), what it is used with, scent family for a fragrance.",
    "Only what the name and description support - never invent a claim. Lower case, no full stops.",
  ].join("\n");
  const user = [
    `Name: ${x.name}`, `Brand: ${x.brand}`, `Section: ${x.section}`,
    x.ru && `Description (ru): ${x.ru}`, x.en && `Description (en): ${x.en}`, x.et && `Description (et): ${x.et}`,
  ].filter(Boolean).join("\n");
  return { system, user };
}

const LANGS = ["ru", "et", "en"];
/** The model's answer, kept to the shape and sizes the shop expects; null when it is not one. */
export function cleanCard(raw) {
  let j;
  try { j = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return null; }
  if (!j || typeof j !== "object") return null;
  const list = (v, max) => (Array.isArray(v) ? v : [])
    .map((s) => String(s == null ? "" : s).replace(/[\p{Cc}\p{Cf}]+/gu, " ").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 60))
    .filter(Boolean).slice(0, max);
  const card = { type: {}, about: {} };
  for (const L of LANGS) {
    card.type[L] = list(j.type && j.type[L], 6);
    card.about[L] = list(j.about && j.about[L], 15);
  }
  return LANGS.some((L) => card.type[L].length) ? card : null;
}

/** What the meaning vector is made of. */
export const embedText = (x, c) => [
  `${x.brand} ${x.name}`,
  ...LANGS.map((L) => [...c.type[L], ...c.about[L]].join(", ")),
].join("\n");

async function openai(path, body, key, ms) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch("https://api.openai.com/v1/" + path, {
      method: "POST", signal: ac.signal,
      headers: { authorization: "Bearer " + key, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(path + " " + r.status);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/** Unit vector → int8 → base64: 256 numbers in 344 characters. */
export function packVec(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  const b = Buffer.alloc(v.length);
  for (let i = 0; i < v.length; i++) b.writeInt8(Math.max(-127, Math.min(127, Math.round((v[i] / n) * 127))), i);
  return b.toString("base64");
}

async function embed(texts, key) {
  const out = [];
  for (let i = 0; i < texts.length; i += 100) {
    const j = await openai("embeddings", { model: EMBED_MODEL, dimensions: EMBED_DIMS, input: texts.slice(i, i + 100) }, key, 30_000);
    for (const d of j.data) out.push(packVec(d.embedding));
  }
  return out;
}

/* ---------- the run ---------------------------------------------------------- */

async function readPrev(file, url) {
  if (existsSync(file)) { try { return JSON.parse(readFileSync(file, "utf8")); } catch {} }
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 10_000);
  try {
    const r = await fetch(url, { signal: ac.signal });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Search phrases worth a vector ahead of time: the bench's, and the intents. */
function knownQueries() {
  const out = new Set();
  const add = (q) => { const k = String(q || "").toLowerCase().replace(/\s+/g, " ").trim(); if (k) out.add(k); };
  try {
    const j = JSON.parse(readFileSync(join(ROOT, "tools/search-queries.json"), "utf8"));
    for (const k of Object.keys(j)) if (Array.isArray(j[k])) j[k].forEach(add);
  } catch {}
  try {
    const j = JSON.parse(readFileSync(join(ROOT, "tools/search-intents.json"), "utf8"));
    for (const it of j.intents || []) add(it.q);
  } catch {}
  return [...out];
}

async function main() {
  const started = Date.now();
  const model = openaiModel();
  const cat = loadGlobals("public/shop/catalogue2.js", ["CATALOGUE", "CAT_NAMES"]);
  const data = { CATALOGUE: cat.CATALOGUE, CAT_NAMES: cat.CAT_NAMES };
  data.CONTENT = loadGlobals("public/shop/content.js", ["CONTENT"]).CONTENT;
  data.CONTENT_RU = loadGlobals("public/shop/content.ru.js", ["CONTENT_RU"]).CONTENT_RU;
  data.CONTENT_ET = loadGlobals("public/shop/content.et.js", ["CONTENT_ET"]).CONTENT_ET;

  const { over, own } = await readDb();
  const items = productInputs(data, over, own);

  const prev = (await readPrev(OUT, LIVE + "/shop/search-cards.json")) || {};
  const prevCards = prev.v === CARD_VERSION && prev.cards ? prev.cards : {};
  const prevQ = (await readPrev(OUT_Q, LIVE + "/shop/search-qvec.json")) || {};
  const qvec = prevQ.emb === EMBED_MODEL + "@" + EMBED_DIMS && prevQ.q ? prevQ.q : {};

  const key = (process.env.OPENAI_API_KEY || "").trim();
  const mayPay = Boolean(key) && (process.env.VERCEL_ENV === "production" || process.env.SEARCH_CARDS_GENERATE === "1");

  const cards = {};
  const todo = [];
  for (const x of items) {
    const h = inputHash(x, model);
    const old = prevCards[x.id];
    if (old && old.h === h && old.vec) cards[x.id] = old;
    else {
      if (old) cards[x.id] = old; // stale beats nothing until a fresh one lands
      todo.push({ x, h });
    }
  }

  let made = 0, failed = 0;
  if (mayPay && todo.length) {
    const queue = todo.slice(0, MAX_NEW);
    const fresh = [];
    const worker = async () => {
      while (queue.length && Date.now() - started < BUDGET_MS) {
        const { x, h } = queue.shift();
        try {
          const { system, user } = cardPrompt(x);
          const j = await openai("chat/completions", {
            ...chatParams(model, { maxTokens: 900, temperature: 0.2 }),
            response_format: { type: "json_object" },
            messages: [{ role: "system", content: system }, { role: "user", content: user }],
          }, key, 45_000);
          const card = cleanCard(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
          if (!card) { failed++; continue; }
          fresh.push({ x, h, card });
        } catch (err) {
          failed++;
          if (failed <= 3) warn(x.id + ": " + (err && err.message));
        }
      }
    };
    await Promise.all(Array.from({ length: POOL }, worker));
    try {
      const vecs = await embed(fresh.map((f) => embedText(f.x, f.card)), key);
      fresh.forEach((f, i) => { cards[f.x.id] = { h: f.h, ...f.card, vec: vecs[i] }; made++; });
    } catch (err) {
      warn("embeddings failed (" + (err && err.message) + ") — the new cards wait for the next build");
    }
    const missing = knownQueries().filter((q) => !qvec[q]);
    if (missing.length) {
      try {
        const v = await embed(missing, key);
        missing.forEach((q, i) => { qvec[q] = v[i]; });
      } catch (err) {
        warn("query vectors failed (" + (err && err.message) + ")");
      }
    }
  }

  const live = new Set(items.map((x) => x.id));
  for (const id of Object.keys(cards)) if (!live.has(id)) delete cards[id];
  writeFileSync(OUT, JSON.stringify({ v: CARD_VERSION, model, emb: EMBED_MODEL + "@" + EMBED_DIMS, built: new Date().toISOString(), cards }));
  writeFileSync(OUT_Q, JSON.stringify({ emb: EMBED_MODEL + "@" + EMBED_DIMS, q: qvec }));
  const have = Object.keys(cards).length;
  log(`${have}/${items.length} products carded (${made} new, ${failed} failed, ${todo.length - made} still to do)` +
    (mayPay ? "" : key ? " — not a production build, reused only" : " — no OPENAI_API_KEY, reused only") +
    ` · ${Object.keys(qvec).length} query vectors · ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("pack-search-cards.mjs")) {
  main().catch((err) => { warn("gave up (" + (err && err.stack || err) + ") — the build goes on without new cards"); });
}
