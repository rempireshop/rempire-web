#!/usr/bin/env node
/**
 * «Кого и куда Montonio вообще возит, и почём» — the whole grid, written down.
 *
 *   node tools/montonio-route-grid.mjs              # → docs/montonio-routes.md
 *   node tools/montonio-route-grid.mjs --out PATH
 *   node tools/montonio-route-grid.mjs --countries PL,DE
 *
 * Why this exists. Until 22.09.2026 the shop's picture of Montonio was one
 * price per country per method, quoted for one box, and nobody could see what
 * had been left out. Three things were invisible:
 *
 *   1. **Size.** Outside EE/LV/LT/FI/SE the price moves with the parcel. DPD's
 *      four drawers to Poland are 6.00 / 8.40 / 10.80 / 14.40 € ex VAT — the
 *      table carried only the last of them, because `REFERENCE_PARCEL` is a
 *      30 cm cube and a 30 cm cube only fits the biggest drawer.
 *   2. **Carriers.** Montonio reaches Poland with three carriers by courier and
 *      two by locker; the shop offered one.
 *   3. **Reach.** Greece has no locker at all from Estonia. Hungary and Romania
 *      have one only through Nova Post.
 *
 * Where the numbers come from. `GET /v2/contract-prices` — public, no auth,
 * the same endpoint `tools/fetch-montonio-tariffs.mjs` builds the shop's table
 * from and the same one montonio.com's own shipping calculator calls. The
 * route matrix and the size tiers below are lifted from that calculator's
 * bundle, so "which carrier reaches which country" is Montonio's answer rather
 * than ours. Verified 22.09.2026 against the calculator's own screen for
 * EE → PL, both delivery options, all four sizes: identical to the cent.
 *
 * What it is NOT. Not a price the shop bills from — nothing imports this and
 * nothing should. `src/data/montonio-tariffs.json` remains the billing table.
 * This is the map you read before changing that table, and the evidence for
 * what a change would be worth.
 */
import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { ALL_COUNTRIES, CARRIERS } from "./lib/montonio-routes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONTRACT_PRICES = "https://shipping.montonio.com/api/v2/contract-prices";
const SOURCE_COUNTRY = "EE";

/** Read from the mirror rather than restated, so the two can never drift. */
const MIRROR = JSON.parse(readFileSync(path.join(ROOT, "src", "data", "montonio-tariffs.json"), "utf8"));
const VAT = 1 + MIRROR.vatRateEE;
const incl = (n) => Math.round(Number(n) * VAT * 100) / 100;

/* The matrix and the tiers live next door so a test can hold the shop to
   them — tools/lib/montonio-routes.mjs has the provenance. */

/* ---------- arguments ------------------------------------------------------ */

const argv = process.argv.slice(2);
const val = (flag, dflt = null) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`
Карта Montonio: какой перевозчик куда возит из Эстонии и сколько стоит.

  --countries PL,DE   только эти страны (по умолчанию — все 25)
  --out PATH          куда писать (по умолчанию docs/montonio-routes.md)

Ключи не нужны: эндпоинт публичный, тот же, что у калькулятора Montonio.
`);
  process.exit(0);
}
const only = (val("--countries", "") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const countries = only.length ? ALL_COUNTRIES.filter((c) => only.includes(c)) : ALL_COUNTRIES;
const outPath = path.resolve(ROOT, val("--out", path.join("docs", "montonio-routes.md")));

/* ---------- the pull -------------------------------------------------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function quote(carrier, method, country, [, length, width, height, weight]) {
  const qs = new URLSearchParams({
    carrierCode: carrier,
    shippingMethod: method,
    source: SOURCE_COUNTRY,
    destination: country,
    weight: String(weight),
    length: String(length),
    width: String(width),
    height: String(height),
  });
  const res = await fetch(`${CONTRACT_PRICES}?${qs}`, { headers: { accept: "application/json" } });
  if (!res.ok) return null;
  const body = await res.json();
  if (!Array.isArray(body) || !body.length) return null;
  /* More than one tier can match; the dearest is the one that must not be
     undersold — same reasoning as methodCeiling() in src/lib/shipping/tariffs.ts. */
  const row = body.reduce((a, b) => (Number(a.pricePerParcel) > Number(b.pricePerParcel) ? a : b));
  const ex = Number(row.pricePerParcel);
  return Number.isFinite(ex) ? { ex, incl: incl(ex), maxWeight: row.maxWeight ?? null } : null;
}

const grid = {};
let asked = 0;
for (const country of countries) {
  grid[country] = { pickupPoint: {}, courier: {} };
  for (const [carrier, cfg] of Object.entries(CARRIERS)) {
    for (const method of ["pickupPoint", "courier"]) {
      if (!cfg[method].includes(country)) continue;
      const rows = [];
      for (const tier of cfg.tiers) {
        const got = await quote(carrier, method, country, tier);
        asked += 1;
        await sleep(70);
        if (got) rows.push({ tier: tier[0], ...got });
      }
      if (rows.length) grid[country][method][carrier] = rows;
    }
  }
  process.stderr.write(`${country} `);
}
process.stderr.write(`\n${asked} quotes\n`);

/* ---------- the document ---------------------------------------------------- */

/**
 * What the shop's own table says today for exactly this carrier and route —
 * per carrier rather than per country on purpose. A per-country «cheapest»
 * would print Nova Post's number for Poland, and Nova Post is a chip that is
 * deliberately never a price basis (`CHIP_ONLY_CARRIERS`), so the figure would
 * not be the one any shopper is charged. Lined up against the four tiers, this
 * column is where the `REFERENCE_PARCEL` gap shows: outside the Baltics our
 * row is the **L** number, because a 30 cm cube fits nothing smaller.
 */
function mirrorPrice(country, method, carrier) {
  const want = method === "pickupPoint" ? "parcel" : "courier";
  const code = carrier.toLowerCase();   // the mirror writes `novapost`, the API `novaPost`
  const row = MIRROR.rates.find((r) => r.country === country && r.method === want && r.carrier === code);
  return row ?? null;
}

const today = new Date().toISOString().slice(0, 10);
const out = [];
out.push("# Montonio из Эстонии: кто, куда и почём");
out.push("");
out.push(`Собрано ${today} инструментом \`tools/montonio-route-grid.mjs\`. Цены — **с НДС ${Math.round(MIRROR.vatRateEE * 100)} %**;`);
out.push("под каждой в скобках то, что отвечает Montonio, то есть без налога.");
out.push("");
out.push("Источник — `GET /v2/contract-prices`, публичный, без ключей: тот же эндпоинт, из которого");
out.push("строится `src/data/montonio-tariffs.json`, и тот же, который зовёт калькулятор на");
out.push("montonio.com. Матрица маршрутов и размеры ячеек взяты из самого калькулятора, поэтому");
out.push("«кто куда возит» — это ответ Montonio, а не наша догадка.");
out.push("");
out.push("**Этот файл ничем не биллится.** Его никто не импортирует и не должен: магазин считает");
out.push("по `src/data/montonio-tariffs.json`. Это карта, которую читают перед тем, как ту таблицу");
out.push("менять.");
out.push("");
out.push("`ПАКОМАТ` — «Courier delivers to a pickup point», `КУРЬЕР` — «…to the recipient's address».");
out.push("Колонка «в магазине» — что стоит в нашей таблице сейчас, для сравнения.");
out.push("");

for (const country of countries) {
  const g = grid[country];
  if (!Object.keys(g.pickupPoint).length && !Object.keys(g.courier).length) continue;
  out.push(`## ${country}`);
  out.push("");
  out.push("| | перевозчик | XS | S | M | L | в магазине |");
  out.push("|---|---|---|---|---|---|---|");
  for (const [method, label] of [["pickupPoint", "ПАКОМАТ"], ["courier", "КУРЬЕР"]]) {
    const entries = Object.entries(g[method]).sort((a, b) => a[1][0].ex - b[1][0].ex);
    if (!entries.length) {
      out.push(`| **${label}** | — маршрута нет — | | | | | |`);
      continue;
    }
    entries.forEach(([carrier, rows], i) => {
      const cell = (t) => {
        const r = rows.find((x) => x.tier === t);
        return r ? `${r.incl.toFixed(2)}<br><sub>${r.ex.toFixed(2)}</sub>` : "—";
      };
      const ours = mirrorPrice(country, method, carrier);
      out.push(`| ${i === 0 ? `**${label}**` : ""} | ${carrier} | ${cell("XS")} | ${cell("S")} | ${cell("M")} | ${cell("L")} | ${ours ? ours.price.toFixed(2) : "—"} |`);
    });
  }
  out.push("");
}

await writeFile(outPath, `${out.join("\n")}\n`, "utf8");
console.log(`${path.relative(ROOT, outPath)} — ${countries.length} стран, ${asked} запросов`);
