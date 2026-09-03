#!/usr/bin/env node
/**
 * Refreshes src/data/montonio-tariffs.json — the fallback carrier tariffs
 * src/lib/shipping/tariffs.ts uses when the live quote is not available.
 *
 *   node tools/fetch-montonio-tariffs.mjs                    # EE, LV, LT, FI
 *   node tools/fetch-montonio-tariffs.mjs --countries ee,lv
 *   node tools/fetch-montonio-tariffs.mjs --dry               # print, write nothing
 *
 * WHY THIS USUALLY HAS NOTHING TO FETCH: unlike the carrier feeds
 * tools/fetch-parcel-points.mjs pulls from, Montonio publishes no public
 * per-carrier/country/size price list — montonio.com/pricing shows a rate
 * comparison table with the actual numbers replaced by dashes, gated behind a
 * signed-in merchant account (checked 03.09.2026, see docs/shipping.md §
 * «Тарифы Montonio»). The only real source is
 * `POST /shipping-methods/rates` (Shipping API v2), and it only answers for
 * carriers this store has *activated* in the Montonio partner portal — so
 * with no keys, or with keys but nothing switched on yet, there is nothing
 * machine-readable to fetch, and this script says so rather than pretending.
 *
 * With MONTONIO_ACCESS_KEY / MONTONIO_SECRET_KEY set (the same pair used for
 * payments and for src/lib/shipping/montonio.ts — MONTONIO_ENV defaults to
 * sandbox), it calls that endpoint for each country and *merges* the answer
 * into the existing JSON: every carrier/method Montonio actually quotes is
 * updated in place: everything else — including every row nobody has
 * activated yet — is left exactly as it was, sourced from the carriers' own
 * published price lists. Nothing is ever deleted by this script.
 */
import { createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "data", "montonio-tariffs.json");

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const countries = (
  args.includes("--countries") ? args[args.indexOf("--countries") + 1] : "ee,lv,lt,fi"
)
  .split(",")
  .map((c) => c.trim().toUpperCase())
  .filter(Boolean);

/** Same box every quote in this table is priced for — src/lib/shipping/tariffs.ts REFERENCE_PARCEL. */
const REFERENCE_PARCEL = { length: 30, width: 30, height: 30, weight: 5 };

const log = (...a) => console.log(...a);

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
      out.push({ carrier, country, method, price: Math.round(price * 100) / 100, currency: pick.currency || "EUR" });
    }
  }
  return out;
}

async function main() {
  const config = montonioConfig();
  const raw = await readFile(OUT, "utf8");
  const data = JSON.parse(raw);

  if (!config) {
    log("No MONTONIO_ACCESS_KEY / MONTONIO_SECRET_KEY in the environment — nothing to fetch live.");
    log("");
    log("This is normal until Renat has:");
    log("  1. activated carriers for the store in the Montonio partner portal");
    log("     (https://partner.montonio.com, or https://sandbox-partner.montonio.com to test), and");
    log("  2. put MONTONIO_ACCESS_KEY / MONTONIO_SECRET_KEY (the same pair used for payments and for");
    log("     src/lib/shipping/montonio.ts) in the environment — .env.local for `npm run dev`, or");
    log("     exported in the shell for this script — plus MONTONIO_ENV=live once production keys are issued.");
    log("");
    log(`Then re-run this script; it calls POST /shipping-methods/rates for ${countries.join(", ")}`);
    log("and updates only the carrier/method rows Montonio actually answers for — everything else in");
    log(`  ${path.relative(ROOT, OUT)}`);
    log("stays exactly as it is: the carriers' own published business-list prices, each with its own");
    log("source URL and date — see docs/shipping.md § «Тарифы Montonio» for how that table was built");
    log("and how to redo it by hand if a price list changes before this script has real keys to run with.");
    process.exitCode = 1;
    return;
  }

  log(`Fetching live Montonio rates (${config.env}) for ${countries.join(", ")}...`);
  let updated = 0;
  let touched = 0;
  for (const country of countries) {
    let body;
    try {
      body = await fetchRatesFor(config, country);
    } catch (err) {
      log(`  ${country}: failed — ${err.message}`);
      continue;
    }
    const rows = flatten(body, country);
    if (!rows.length) {
      log(`  ${country}: Montonio answered but quoted no carrier — nothing activated for this country yet.`);
      continue;
    }
    touched++;
    const today = new Date().toISOString().slice(0, 10);
    for (const row of rows) {
      const i = data.rates.findIndex(
        (r) => r.carrier === row.carrier && r.country === row.country && r.method === row.method,
      );
      const entry = {
        carrier: row.carrier,
        country: row.country,
        method: row.method,
        price: row.price,
        currency: row.currency,
        effectiveDate: today,
        vatIncluded: true,
        source: `live quote, POST /shipping-methods/rates (${config.env}), fetched ${today}`,
      };
      if (i >= 0) data.rates[i] = { ...data.rates[i], ...entry };
      else data.rates.push(entry);
      updated++;
      log(`  ${row.carrier} ${row.country} ${row.method}: ${row.price} ${row.currency} (live)`);
    }
  }

  if (!updated) {
    log("");
    log("Nothing came back from Montonio for any requested country — the static table is unchanged.");
    process.exitCode = touched ? 0 : 1;
    return;
  }

  data.compiledDate = new Date().toISOString().slice(0, 10);
  if (dry) {
    log(`\n--dry: would update ${updated} row(s) in ${path.relative(ROOT, OUT)}; nothing written.`);
    return;
  }
  await writeFile(OUT, JSON.stringify(data, null, 2) + "\n", "utf8");
  log(`\nWrote ${updated} updated row(s) to ${path.relative(ROOT, OUT)}.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
