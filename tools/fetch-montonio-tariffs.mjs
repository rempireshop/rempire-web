#!/usr/bin/env node
/**
 * Rebuilds src/data/montonio-tariffs.json — what a delivery costs Rempire,
 * which src/lib/shipping/tariffs.ts uses when the per-store live quote is not
 * available, and which the admin's «Заполнить по тарифам Montonio» button
 * prices from.
 *
 *   node tools/fetch-montonio-tariffs.mjs                    # every destination
 *   node tools/fetch-montonio-tariffs.mjs --countries ee,lv
 *   node tools/fetch-montonio-tariffs.mjs --dry               # print, write nothing
 *
 * TWO SOURCES, in this order of trust:
 *
 *   1. **Per-store rates** — `POST /shipping-methods/rates` (Shipping API v2),
 *      authenticated with MONTONIO_ACCESS_KEY / MONTONIO_SECRET_KEY. This is
 *      the only source that knows what *this* store pays: its plan, its
 *      activated carriers, any negotiated override. Used when keys are set.
 *
 *   2. **Montonio's own published contract prices** —
 *      `GET https://shipping.montonio.com/api/v2/contract-prices
 *           ?carrierCode&shippingMethod&source&destination&weight&length&width&height`
 *      No auth. This is the endpoint behind Montonio's public shipping
 *      calculator (https://shipping-calculator.montonio.com, linked from
 *      help.montonio.com/en/articles/219852-shipping-with-montonio-contracts);
 *      it answers with the standard Montonio-contract price list — the rows it
 *      returns carry `storeId: ""` and `contractId: null`, i.e. no store's
 *      own deal, the list every merchant on Montonio contracts starts from.
 *      Prices come back **excluding VAT** (the calculator prints "+VAT" under
 *      each one); this script stores them with Estonian VAT added, because the
 *      shelf price they are compared against includes VAT too.
 *
 * This replaces the previous premise of this file, which was that "Montonio
 * publishes no public per-carrier/country/size price list" and that with no
 * keys there was nothing machine-readable to fetch. That was true of
 * montonio.com/pricing (dashes, gated) and is false of the calculator's
 * endpoint. The table this script now writes is Montonio's own money, not the
 * carriers' list prices it used to hold — see docs/shipping.md
 * § «Тарифы Montonio».
 *
 * A route Montonio does not serve answers HTTP 400
 * `contract_prices_no_applicable_tier`; a route it knows but has no
 * Montonio-contract price for (a direct-contract-only carrier, e.g. Venipak,
 * or Omniva to Finland) answers `[]`. Neither is worth listing combination by
 * combination — nine carriers × two methods × thirty-two countries is mostly
 * noise about carriers that simply do not operate somewhere. What the output
 * records instead is the shape a reader actually needs: `notServed`, the
 * destinations the checkout offers and Montonio will not quote *at all*;
 * `coverage`, where each carrier that has any price does have one; and
 * `noMontonioContractPrice`, the carriers Montonio quotes nowhere from
 * Estonia, which is what "direct contract only" means in practice.
 */
import { createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "data", "montonio-tariffs.json");

/** Public contract-price endpoint — no auth, live prices, always the live host. */
const CONTRACT_PRICES = "https://shipping.montonio.com/api/v2/contract-prices";
/** Rempire ships out of Estonia; every row in the table is a route from EE. */
const SOURCE_COUNTRY = "EE";
/** Estonian VAT, as in src/data/montonio-tariffs.json's own `vatRateEE`. */
const VAT_EE = 0.24;

/** Montonio's `carrierCode` values, from the calculator bundle's own enum. */
const CARRIERS = ["omniva", "smartpost", "dpd", "venipak", "unisend", "novaPost", "latvian_post", "inpost", "orlen"];

/**
 * Everywhere the checkout can send a parcel: the four countries with a row of
 * their own (public/shop2/app.js COUNTRIES) plus every country behind «Другая
 * страна Европы» (app.js EUROPE_ISO). Anything Montonio will not quote lands
 * in `notServed` so the gap is written down rather than guessed at.
 */
const DESTINATIONS = [
  "EE", "LV", "LT", "FI",
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "FR", "DE", "GR", "HU", "IE", "IT", "LU", "MT", "NL", "PL",
  "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "CH", "GB",
];

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const countries = (
  args.includes("--countries") ? args[args.indexOf("--countries") + 1] : DESTINATIONS.join(",")
)
  .split(",")
  .map((c) => c.trim().toUpperCase())
  .filter(Boolean);

/** Same box every quote in this table is priced for — src/lib/shipping/tariffs.ts REFERENCE_PARCEL. */
const REFERENCE_PARCEL = { length: 30, width: 30, height: 30, weight: 5 };

const log = (...a) => console.log(...a);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const withVat = (n) => round2(Number(n) * (1 + VAT_EE));

/* ---------- minimal HS256 JWT, mirroring src/lib/payments/jwt.ts ----------
   Duplicated on purpose: every tools/*.mjs script here is a standalone node
   process (no ts-node, no bundler), so it carries its own tiny copy of
   whatever sliver of the app it needs — see tools/fetch-parcel-points.mjs for
   the same pattern applied to the carrier feeds. */
function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function signHs256(payload, secret, expiresInSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + expiresInSeconds };
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const claims = b64url(Buffer.from(JSON.stringify(body)));
  const input = `${header}.${claims}`;
  const sig = b64url(createHmac("sha256", secret).update(input).digest());
  return `${input}.${sig}`;
}

function montonioConfig() {
  const accessKey = process.env.MONTONIO_ACCESS_KEY?.trim();
  const secretKey = process.env.MONTONIO_SECRET_KEY?.trim();
  if (!accessKey || !secretKey) return null;
  const env = process.env.MONTONIO_ENV?.trim() === "live" ? "live" : "sandbox";
  const base =
    env === "live" ? "https://shipping.montonio.com/api/v2" : "https://sandbox-shipping.montonio.com/api/v2";
  return { accessKey, secretKey, env, base };
}

/* ---------- source 2: Montonio's published contract prices ---------------- */

/**
 * One carrier/method/destination. Returns a row, `null` when Montonio knows
 * the route but has no Montonio-contract price for it (`[]` — direct contract
 * only), or `"unserved"` when it will not quote the route at all (HTTP 400).
 */
async function contractPrice(carrierCode, shippingMethod, destination) {
  const qs = new URLSearchParams({
    carrierCode,
    shippingMethod,
    source: SOURCE_COUNTRY,
    destination,
    weight: String(REFERENCE_PARCEL.weight),
    length: String(REFERENCE_PARCEL.length),
    width: String(REFERENCE_PARCEL.width),
    height: String(REFERENCE_PARCEL.height),
  });
  const res = await fetch(`${CONTRACT_PRICES}?${qs}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 400) return "unserved";
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  if (!Array.isArray(body) || !body.length) return null;
  // More than one tier can match a parcel (size bands); the dearest is the one
  // that must not be undersold, same reasoning as methodCeiling() in tariffs.ts.
  const row = body.reduce((a, b) => (Number(a.pricePerParcel) > Number(b.pricePerParcel) ? a : b));
  const ex = Number(row.pricePerParcel);
  if (!Number.isFinite(ex)) return null;
  return {
    carrier: carrierCode.toLowerCase(),
    country: destination,
    method: shippingMethod === "courier" ? "courier" : "parcel",
    price: withVat(ex),
    priceExVat: round2(ex),
    currency: String(row.currency || "EUR"),
    vatIncluded: true,
    /** What Montonio charges the merchant for the return leg; null = not priced. */
    returnPrice: row.returnPrice == null ? null : withVat(row.returnPrice),
    pricingStrategy: String(row.pricingStrategy || ""),
    size: row.size ?? null,
    maxWeightKg: row.maxWeight ?? null,
    effectiveDate: String(row.updatedAt || "").slice(0, 10) || undefined,
  };
}

async function fetchContractTable(dests) {
  const rates = [];
  for (const destination of dests) {
    for (const carrier of CARRIERS) {
      for (const method of ["pickupPoint", "courier"]) {
        let r;
        try {
          r = await contractPrice(carrier, method, destination);
        } catch (err) {
          log(`  ${carrier} ${destination} ${method}: failed — ${err.message}`);
          continue;
        }
        // "unserved" (HTTP 400) and null ([]) both mean "no price here"; the
        // summaries below are built from what *did* come back, so an absent
        // row says it once instead of nine hundred times.
        if (r && r !== "unserved") rates.push(r);
      }
    }
  }
  return rates;
}

/** Where each carrier that has any price does have one, and who has none at all. */
function summarise(rates, dests) {
  const priced = new Set(rates.map((r) => r.country));
  const coverage = {};
  for (const r of rates) {
    coverage[r.carrier] = coverage[r.carrier] ?? { parcel: [], courier: [] };
    if (!coverage[r.carrier][r.method].includes(r.country)) coverage[r.carrier][r.method].push(r.country);
  }
  for (const c of Object.keys(coverage)) {
    coverage[c].parcel.sort();
    coverage[c].courier.sort();
  }
  return {
    notServed: dests.filter((c) => !priced.has(c)).sort(),
    coverage,
    noMontonioContractPrice: CARRIERS.map((c) => c.toLowerCase())
      .filter((c) => !coverage[c])
      .sort(),
  };
}

/* ---------- source 1: this store's own rates ------------------------------ */

async function fetchRatesFor(config, country) {
  const token = signHs256({ accessKey: config.accessKey }, config.secretKey, 3600);
  const res = await fetch(`${config.base}/shipping-methods/rates`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({
      destination: country,
      parcels: [
        {
          items: [
            {
              length: REFERENCE_PARCEL.length,
              width: REFERENCE_PARCEL.width,
              height: REFERENCE_PARCEL.height,
              dimensionUnit: "cm",
              weight: REFERENCE_PARCEL.weight,
              weightUnit: "kg",
              quantity: 1,
            },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

/** carriers[].shippingMethods[].subtypes[] -> one row per carrier+method, preferring parcelMachine/standard. */
function flatten(body, country) {
  const out = [];
  for (const carrierRow of body.carriers ?? []) {
    const carrier = String(carrierRow.carrierCode ?? "").toLowerCase();
    if (!carrier) continue;
    for (const sm of carrierRow.shippingMethods ?? []) {
      const method = sm.type === "courier" ? "courier" : "parcel";
      const preferred = method === "parcel" ? "parcelMachine" : "standard";
      const subtypes = sm.subtypes ?? [];
      const pick = subtypes.find((s) => s.code === preferred) ?? subtypes[0];
      const price = Number(pick?.rate);
      if (!pick || !Number.isFinite(price)) continue;
      out.push({ carrier, country, method, price: round2(price), currency: pick.currency || "EUR" });
    }
  }
  return out;
}

/* ---------- main ---------------------------------------------------------- */

async function main() {
  const raw = await readFile(OUT, "utf8");
  const data = JSON.parse(raw);
  const today = new Date().toISOString().slice(0, 10);

  log(`Fetching Montonio's published contract prices for ${countries.length} destination(s)...`);
  const rates = await fetchContractTable(countries);
  if (!rates.length) {
    log("Montonio quoted nothing at all — the table is unchanged. Check network access to");
    log(`  ${CONTRACT_PRICES}`);
    process.exitCode = 1;
    return;
  }
  for (const r of rates) {
    log(
      `  ${r.carrier} ${r.country} ${r.method}: ${r.price} ${r.currency} incl. VAT` +
        (r.returnPrice == null ? " (return not priced)" : ` (return ${r.returnPrice})`),
    );
  }

  // Only the requested countries are rebuilt; rows for other countries stay.
  const asked = new Set(countries);
  const kept = (data.rates ?? []).filter((r) => !asked.has(String(r.country).toUpperCase()));
  data.rates = [...kept, ...rates].sort(
    (a, b) =>
      String(a.country).localeCompare(String(b.country)) ||
      String(a.carrier).localeCompare(String(b.carrier)) ||
      String(a.method).localeCompare(String(b.method)),
  );
  const summary = summarise(data.rates, countries);
  data.notServed = summary.notServed;
  data.coverage = summary.coverage;
  data.noMontonioContractPrice = summary.noMontonioContractPrice;
  data.compiledDate = today;
  data.priceSource = `GET ${CONTRACT_PRICES} (public, no auth), source=${SOURCE_COUNTRY}`;

  const config = montonioConfig();
  let overlaid = 0;
  if (config) {
    log(`\nOverlaying this store's own rates (${config.env})...`);
    for (const country of countries) {
      let body;
      try {
        body = await fetchRatesFor(config, country);
      } catch (err) {
        log(`  ${country}: failed — ${err.message}`);
        continue;
      }
      for (const row of flatten(body, country)) {
        const i = data.rates.findIndex(
          (r) => r.carrier === row.carrier && r.country === row.country && r.method === row.method,
        );
        const entry = {
          ...(i >= 0 ? data.rates[i] : {}),
          ...row,
          effectiveDate: today,
          vatIncluded: false,
          source: `live quote, POST /shipping-methods/rates (${config.env}), fetched ${today}`,
        };
        if (i >= 0) data.rates[i] = entry;
        else data.rates.push(entry);
        overlaid++;
        log(`  ${row.carrier} ${row.country} ${row.method}: ${row.price} ${row.currency} (this store)`);
      }
    }
    if (!overlaid) {
      log("  Montonio answered but quoted no carrier — nothing activated for these countries yet.");
    }
  } else {
    log("\nNo MONTONIO_ACCESS_KEY / MONTONIO_SECRET_KEY set, so the table holds Montonio's standard");
    log("contract prices rather than this store's. They differ if Renat's plan or a negotiated rate");
    log("differs from the list — activate the carriers in https://partner.montonio.com, export the");
    log("key pair (plus MONTONIO_ENV=live) and re-run to overlay the store's own numbers.");
  }

  if (dry) {
    log(`\n--dry: would write ${data.rates.length} row(s) to ${path.relative(ROOT, OUT)}; nothing written.`);
    return;
  }
  await writeFile(OUT, JSON.stringify(data, null, 2) + "\n", "utf8");
  log(`\nWrote ${data.rates.length} row(s) to ${path.relative(ROOT, OUT)}.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
