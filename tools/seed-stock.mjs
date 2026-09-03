#!/usr/bin/env node
/**
 * Seeds stock_levels with one row per catalogue product×variant, so the
 * admin «Склад» table and the scanner have something to attach a quantity
 * and an EAN to. Quantities are left at 0 ("unknown", never "out" — see the
 * module doc in src/lib/inventory.ts for exactly why a bare seeded row must
 * never count as a real 0): actual counts come from goods-in scans or a
 * manual set in the admin, not from this script.
 *
 * EANs come from tools/harvest/products/<id>.json — the Shopify Admin API
 * dump the catalogue itself was partly built from (see
 * tools/build-catalogue-full.mjs). As of this writing every one of those
 * files carries `variants[].barcode: "NA"` — Renat's Shopify catalogue has
 * no real barcodes entered anywhere the Admin API could see (confirmed by
 * reading all 153 harvested variants; see ../rempire-api/docs/
 * BARCODE-SCANNING.md, "Barcode VALUES are not in the public Shopify data").
 * So this run seeds EAN-less rows for the whole catalogue — that is the
 * correct, honest result today, not a bug. Re-running it later (after a
 * fresh Admin API harvest, if Renat ever fills barcodes in on the Shopify
 * side) picks up any real values then, without touching an EAN a human has
 * since typed into the admin: an existing non-null ean is never overwritten.
 * The other way EANs get in — one scan at a time, in the admin's «Склад» /
 * scanner screen — needs no script at all.
 *
 *   npm run seed:stock                # against DATABASE_URL
 *   DB_DRIVER=pglite npm run seed:stock   # against an in-memory PGlite
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { migrate, sslFor } from "./migrate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

/** A plausible barcode: digits only, EAN-8 through a padded GTIN-14. Never "NA". */
function looksLikeBarcode(s) {
  return typeof s === "string" && /^\d{4,32}$/.test(s.trim());
}

/** Every (productId, variant) the catalogue has — variant '' when there are no sizes. */
function catalogueUniverse(catalogue, variants) {
  const out = [];
  for (const p of catalogue) {
    const v = variants[p.id];
    if (v && Array.isArray(v.sizes) && v.sizes.length) {
      v.sizes.forEach((size, i) => out.push({ productId: p.id, variant: size, variantIndex: i }));
    } else {
      out.push({ productId: p.id, variant: "", variantIndex: 0 });
    }
  }
  return out;
}

/**
 * The harvest file's own variant order is the best (only) link back to the
 * catalogue's size order — both ultimately came from the same Shopify
 * export. Mismatched counts mean the two lists cannot be lined up honestly,
 * so that product is left without an EAN rather than guessed at.
 */
function eanFor(harvestDir, productId, variantIndex, variantCount) {
  const file = path.join(harvestDir, `${productId}.json`);
  if (!fs.existsSync(file)) return null;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const list = data?.product?.variants;
  if (!Array.isArray(list) || !list.length) return null;
  if (list.length !== variantCount) return null; // can't line the two lists up safely
  const raw = list[variantIndex]?.barcode;
  return looksLikeBarcode(raw) ? raw.trim() : null;
}

async function connect() {
  if (process.env.DB_DRIVER === "pglite") {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite(process.env.PGLITE_PATH || undefined);
    return { db, close: () => db.close() };
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Put it in .env.local (see docs/backend.md) or run with DB_DRIVER=pglite.");
    process.exit(1);
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });
  await client.connect();
  return { db: client, close: () => client.end() };
}

async function main() {
  const { db, close } = await connect();
  try {
    await migrate(db, { log: (m) => console.log(m) });

    const catalogue = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/catalogue.min.json"), "utf8"));
    const variants = JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/catalogue.variants.json"), "utf8"));
    const harvestDir = path.join(ROOT, "tools/harvest/products");
    const universe = catalogueUniverse(catalogue, variants);

    let created = 0;
    let withEan = 0;
    let skippedEanConflict = 0;

    for (const { productId, variant, variantIndex } of universe) {
      const variantCount = (variants[productId]?.sizes || [""]).length;
      const ean = eanFor(harvestDir, productId, variantIndex, variantCount);
      if (ean) withEan++;

      try {
        const res = await db.query(
          `insert into stock_levels (product_id, variant, qty, low_threshold, ean, updated_at)
           values ($1, $2, 0, 2, $3, now())
           on conflict (product_id, variant) do update set
             ean = coalesce(stock_levels.ean, excluded.ean),
             updated_at = now()
           returning (xmax = 0) as inserted`,
          [productId, variant, ean],
        );
        if (res.rows?.[0]?.inserted) created++;
      } catch (err) {
        // Almost certainly the partial unique index on ean — two products
        // sharing one barcode (see BARCODE-SCANNING.md, "Risks, honestly").
        // Not fatal: that one row keeps whatever it had, everything else proceeds.
        console.warn(`seed-stock: ${productId}${variant ? ":" + variant : ""} — ${err.message || err}`);
        skippedEanConflict++;
      }
    }

    console.log(
      `seed-stock: ${universe.length} product×variant rows checked, ${created} created, ` +
        `${withEan} with a real EAN from the harvest${skippedEanConflict ? `, ${skippedEanConflict} skipped on a conflict` : ""}.`,
    );
    if (withEan === 0) {
      console.log(
        "seed-stock: 0 real EANs found — Renat's Shopify catalogue has none on record yet " +
          "(see the file header). Every code from here on comes from a scan in the admin.",
      );
    }
  } finally {
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { catalogueUniverse, eanFor, looksLikeBarcode };
