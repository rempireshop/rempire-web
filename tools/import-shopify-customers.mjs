#!/usr/bin/env node
/**
 * import-shopify-customers.mjs — the Shopify store's customers become accounts
 * in the new shop, once, on the night of the launch.
 *
 * THE DECISION (Dim, 28.09.2026 — option B). Only customers WITH A NAME (first
 * or last) come over, and of each only three things:
 *
 *   · the e-mail — the most important: an account here IS its e-mail, found
 *     and signed into by a code sent to it (src/lib/customers.ts);
 *   · the phone, if there is one;
 *   · the default address, if there is one the shop can deliver to.
 *
 * NO MARKETING CONSENT. Every imported customer gets marketing = false,
 * whatever Shopify's «Accepts Email Marketing» says (Dim, 18.09.2026: they
 * never opted in HERE). That is not an opt-out either — nothing goes into
 * mail_optouts; they have simply never said yes to this shop. No orders, no
 * notes, no tags, no totals, no company, no login codes, no letters, no events.
 *
 *   node --env-file=.env.railway.txt tools/import-shopify-customers.mjs --csv <export.csv>
 *       DRY RUN — reads the file and the database, prints counts, writes nothing
 *   node --env-file=.env.railway.txt tools/import-shopify-customers.mjs --csv <export.csv> --apply --confirm ИМПОРТ-КЛИЕНТОВ
 *       writes, in ONE transaction
 *   DB_DRIVER=pglite node tools/import-shopify-customers.mjs --csv <export.csv>
 *       the same dry run against an empty in-memory database
 *
 * WHERE THE CSV COMES FROM: Shopify admin → Customers → Export → «All
 * customers», «Plain CSV file»; Shopify e-mails it. Its header:
 *   Customer ID, First Name, Last Name, Email, Accepts Email Marketing,
 *   Default Address Company, Default Address Address1, Default Address Address2,
 *   Default Address City, Default Address Province Code, Default Address
 *   Country Code, Default Address Zip, Default Address Phone, Phone, Accepts
 *   SMS Marketing, Total Spent, Total Orders, Note, Tax Exempt, Tags, Accepts
 *   WhatsApp Marketing
 * First Name, Last Name and Email are required; the rest is read when present.
 *
 * THE FILE IS PERSONAL DATA. Nothing here prints an e-mail, a name, a phone
 * or an address — counts and country codes only, in the dry run, in the
 * result and in every error. A database error is reported by its code alone:
 * Postgres quotes the offending value in its message, and that value would be
 * somebody's address.
 *
 * WHAT A ROW BECOMES — the columns the shop itself writes, cleaned the way the
 * account form cleans them; only `source` and the method-less default address
 * are the import's own:
 *
 *   email      Email, trimmed and lower-cased (normalizeEmail)
 *   name       «First Last» — either alone is enough; control characters out,
 *              spaces folded, 120 characters (updateCustomer's own cleaning)
 *   phone      Phone, else Default Address Phone. Kept as written — the shop
 *              stores the phone as typed and splits it only when it books a
 *              parcel (splitPhone, src/lib/shipping/montonio.ts) — minus the
 *              apostrophe Shopify puts in front of a «+» for Excel. Under seven
 *              digits it is not a phone (the checkout's phoneOk) and is left out.
 *   ship_pref  «Доставка по умолчанию» (051_customer_ship_pref.sql): the only
 *              place the shop keeps a customer's address. The country and the
 *              door, and NO delivery method — {country, method: "", carrier:
 *              "", machine: "", address: {addr, zip, city}} (Dim, 28.09.2026,
 *              option b: the import chooses nobody's delivery). The checkout
 *              opens on that country with its usual method and fills the
 *              courier's three boxes with the address when the shopper picks
 *              «Курьер» himself (app.js applyAcctShipPref / fillSavedDoor);
 *              the account block shows the country with no row ticked, and its
 *              «Курьер до двери» row comes up with the address in it.
 *              normalizeShipPref() in src/lib/customers.ts keeps this shape
 *              only with a whole address. addr = Address1 and Address2 joined
 *              by «, ». Kept only WHOLE (street, postcode and city —
 *              normalizeShipAddress) and only in a country the shop delivers
 *              to; otherwise the address is left out and the customer still
 *              comes over.
 *   marketing  false. Always. marketing_at / marketing_source stay null.
 *   source     'shopify' (221_customer_source.sql)
 *   lang       the column's default, RU — the export carries no language, and
 *              the first sign-in sets it from the shop they sign in from
 *
 * SKIPPED ROWS, in this order, each counted: no name (neither first nor last);
 * a name but no e-mail — an account is found by its e-mail, so there is no way
 * in for such a customer; an e-mail that is not one. A second row with an
 * e-mail already seen is merged into the first: the first non-empty value of
 * each field wins.
 *
 * A RE-RUN IS HARMLESS. An e-mail that already has a row in `customers` is
 * never touched — not the name, not the phone, not the address, not the
 * consent. On the night the go-live reset has just emptied the table
 * (docs/go-live-reset.md), so everything is new; run it twice and the second
 * run creates nothing. Somebody who signs in on the new shop before the import
 * keeps the account they made.
 *
 * Signing in afterwards is the ordinary path: POST /api/account/code, then
 * /api/account/login → recordLogin(), whose upsert finds the imported row by
 * its e-mail and moves only last_login_at and lang. No second row, nothing
 * of the import overwritten.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCSV } from "./import-shopify-stock.mjs";
import { launcherFrom, maskUrl } from "./go-live-reset.mjs";
import { migrate, sslFor } from "./migrate.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

export const CONFIRM_WORD = "ИМПОРТ-КЛИЕНТОВ";
/** customers.source of an imported row (221_customer_source.sql). */
export const SOURCE = "shopify";
/** The checkout's phoneOk(): fewer digits than this is not a phone number. */
export const PHONE_MIN_DIGITS = 7;

export class ImportError extends Error {}

/* ---------- the shop's own rules, mirrored ------------------------------- */
/* A tool is plain Node and cannot import src/lib/*.ts, so the four rules an
   imported row has to obey are repeated here — and
   tests/import-shopify-customers.test.ts runs each one against the original
   on the same inputs, so the two cannot drift apart unnoticed. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const CONTROL = /\p{Cc}/u;

/** normalizeEmail() in src/lib/customers.ts. */
export function normalizeEmail(v) {
  return String(v ?? "").trim().toLowerCase().slice(0, 160);
}

/** isEmail() in src/lib/customers.ts. */
export function isEmail(v) {
  const s = normalizeEmail(v);
  return s.length >= 5 && EMAIL_RE.test(s);
}

/** text() in src/lib/customers.ts — control characters out, spaces folded, capped. */
export function cleanText(v, max) {
  if (typeof v !== "string") return null;
  const s = v.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
  return s || null;
}

/** The phone as the shop keeps it (updateCustomer: text(v, 40)), or null when it is not one. */
export function cleanPhone(v) {
  // Shopify writes «'+372 …» so that Excel keeps the plus — the quote is not the number's
  const s = cleanText(String(v ?? "").replace(/^\s*'/, ""), 40);
  if (!s) return null;
  return s.replace(/\D/g, "").length >= PHONE_MIN_DIGITS ? s : null;
}

/** The four countries with a row of their own in the shipping rules (shippingZone). */
export const HOME_COUNTRIES = ["EE", "LV", "LT", "FI"];
/** EUROPE in src/lib/shipping.ts — the countries the «Другие страны Европы» row prices. */
export const EUROPE = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "FR", "DE", "GR", "HU", "IE", "IT", "LU", "MT", "NL", "PL",
  "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "CH", "GB",
];

/** DEFAULT_SHIPPING_RULES.countriesOff — the countries Montonio has no route to. */
export function defaultCountriesOff(root = ROOT) {
  const data = JSON.parse(fs.readFileSync(path.join(root, "src/data/montonio-tariffs.json"), "utf8"));
  return Array.isArray(data.notServed) ? data.notServed.map((c) => String(c).toUpperCase()).sort() : [];
}

/**
 * The stored shipping rules' `countriesOff`, read the way src/lib/shipping.ts
 * reads it: an array is authoritative (an empty one included — «deliver
 * everywhere»), anything else keeps the default.
 */
export function countriesOffFrom(value, fallback) {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  const off = v && typeof v === "object" && !Array.isArray(v) ? v.countriesOff : undefined;
  if (!Array.isArray(off)) return [...fallback];
  return [...new Set(off.map((c) => String(c ?? "").trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))].sort();
}

/**
 * Does the shop deliver to this country? A zone the rules price (the four
 * home countries and Europe — shippingZone() is not «default»), and not
 * switched off: createOrder() refuses an order to a country that is
 * (`country_off`), so a default address there would only fill the checkout
 * with a delivery it cannot take.
 */
export function servedCountry(cc, off) {
  const c = String(cc ?? "").trim().toUpperCase();
  if (!HOME_COUNTRIES.includes(c) && !EUROPE.includes(c)) return false;
  return !off.includes(c);
}

/* ---------- the file ----------------------------------------------------- */

/** Our name → Shopify's column. */
const COLS = {
  first: "First Name",
  last: "Last Name",
  email: "Email",
  marketing: "Accepts Email Marketing",
  address1: "Default Address Address1",
  address2: "Default Address Address2",
  city: "Default Address City",
  country: "Default Address Country Code",
  zip: "Default Address Zip",
  addressPhone: "Default Address Phone",
  phone: "Phone",
};
const REQUIRED = ["first", "last", "email"];

/**
 * Shopify's customer export → one plain object per row, keyed by COLS.
 * Refuses a file that is not that export — the message names the columns it
 * found (a header is not personal data) and nothing below the header.
 *
 * @param {string} text
 * @returns {{ rows: Array<Record<string, string>>, absent: string[] }}
 */
export function readCustomersCsv(text) {
  const table = parseCSV(text);
  if (!table.length) throw new ImportError("the CSV is empty");
  const head = table[0].map((h) => String(h).replace(/^﻿/, "").trim().toLowerCase());
  const at = {};
  for (const [key, name] of Object.entries(COLS)) at[key] = head.indexOf(name.toLowerCase());
  const missing = REQUIRED.filter((k) => at[k] < 0);
  if (missing.length) {
    throw new ImportError(
      `no ${missing.map((k) => `«${COLS[k]}»`).join(", ")} column — this is not Shopify's customer export ` +
        `(Customers → Export → All customers → Plain CSV). Columns found: ${table[0].join(", ")}`,
    );
  }
  const rows = table.slice(1).map((r) => {
    /** @type {Record<string, string>} */
    const o = {};
    for (const key of Object.keys(COLS)) o[key] = at[key] >= 0 ? String(r[at[key]] ?? "") : "";
    return o;
  });
  return { rows, absent: Object.keys(COLS).filter((k) => at[k] < 0).map((k) => COLS[k]) };
}

/* ---------- a row → a customer -------------------------------------------- */

/** The first usable phone of the two columns: { phone, from } or { phone: null, unusable }. */
function phoneOf(row) {
  let unusable = false;
  for (const [raw, from] of [[row.phone, "phone"], [row.addressPhone, "address"]]) {
    if (!String(raw ?? "").trim()) continue;
    const phone = cleanPhone(raw);
    if (phone) return { phone, from };
    unusable = true;
  }
  return { phone: null, from: null, unusable };
}

/**
 * The default address as «Доставка по умолчанию» — the country and the door,
 * no method (see ship_pref at the top) — or why there is none:
 * { pref } | { none: true } | { dropped: "incomplete" | "no_country" | "not_served", country? }.
 */
export function addressOf(row, served) {
  const a1 = cleanText(row.address1, 160);
  const a2 = cleanText(row.address2, 160);
  const addr = cleanText([a1, a2].filter(Boolean).join(", "), 160);
  const zip = cleanText(row.zip, 160);
  const city = cleanText(row.city, 160);
  if (!addr && !zip && !city) return { none: true };
  if (!addr || !zip || !city) return { dropped: "incomplete" };
  const country = String(row.country ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return { dropped: "no_country" };
  if (!served(country)) return { dropped: "not_served", country };
  return { pref: { country, method: "", carrier: "", machine: "", address: { addr, zip, city } } };
}

const said = (v) => /^(yes|true|1)$/i.test(String(v ?? "").trim());

/**
 * The rows → the customers to import, and the count of every row left out.
 *
 *   customers  [{ email, name, phone, phoneFrom, phoneUnusable, shipPref, addressWhy, addressCountry, shopifyMarketing }]
 *   skipped    { noName, noEmail, badEmail, duplicate }
 *
 * @param {Array<Record<string, string>>} rows
 * @param {{ served: (cc: string) => boolean }} opts
 */
export function buildImport(rows, { served }) {
  const skipped = { noName: 0, noEmail: 0, badEmail: 0, duplicate: 0 };
  const byEmail = new Map();
  for (const row of rows) {
    const name = cleanText([String(row.first ?? "").trim(), String(row.last ?? "").trim()].filter(Boolean).join(" "), 120);
    if (!name) {
      skipped.noName++;
      continue;
    }
    if (!String(row.email ?? "").trim()) {
      skipped.noEmail++;
      continue;
    }
    const email = normalizeEmail(row.email);
    // a control character is nothing a mailbox has — and nothing Postgres should be handed
    if (CONTROL.test(email) || !isEmail(email)) {
      skipped.badEmail++;
      continue;
    }
    const ph = phoneOf(row);
    const ad = addressOf(row, served);
    const seen = byEmail.get(email);
    if (seen) {
      // the same person twice: whatever the first row left empty, a later one may fill
      skipped.duplicate++;
      if (!seen.phone && ph.phone) Object.assign(seen, { phone: ph.phone, phoneFrom: ph.from, phoneUnusable: false });
      if (!seen.shipPref && ad.pref) Object.assign(seen, { shipPref: ad.pref, addressWhy: null, addressCountry: null });
      if (!seen.shipPref && !seen.addressWhy && ad.dropped) Object.assign(seen, { addressWhy: ad.dropped, addressCountry: ad.country ?? null });
      if (!seen.phone && ph.unusable) seen.phoneUnusable = true;
      seen.shopifyMarketing = seen.shopifyMarketing || said(row.marketing);
      continue;
    }
    byEmail.set(email, {
      email,
      name,
      phone: ph.phone,
      phoneFrom: ph.from,
      phoneUnusable: !ph.phone && Boolean(ph.unusable),
      shipPref: ad.pref ?? null,
      addressWhy: ad.dropped ?? null,
      addressCountry: ad.country ?? null,
      shopifyMarketing: said(row.marketing),
    });
  }
  return { customers: [...byEmail.values()], skipped };
}

/** Counts over a list of customers — the only thing about them anybody sees. */
export function statsOf(customers) {
  const inc = (m, k) => {
    m[k] = (m[k] || 0) + 1;
  };
  const s = {
    total: customers.length,
    withPhone: 0,
    phoneFrom: { phone: 0, address: 0 },
    phoneUnusable: 0,
    withAddress: 0,
    countries: {},
    addressDropped: { incomplete: 0, no_country: 0, not_served: 0 },
    notServed: {},
    shopifyMarketing: 0,
  };
  for (const c of customers) {
    if (c.phone) {
      s.withPhone++;
      s.phoneFrom[c.phoneFrom]++;
    } else if (c.phoneUnusable) s.phoneUnusable++;
    if (c.shipPref) {
      s.withAddress++;
      inc(s.countries, c.shipPref.country);
    } else if (c.addressWhy) {
      s.addressDropped[c.addressWhy]++;
      if (c.addressWhy === "not_served") inc(s.notServed, c.addressCountry);
    }
    if (c.shopifyMarketing) s.shopifyMarketing++;
  }
  return s;
}

/* ---------- the database -------------------------------------------------- */

async function rows(db, sql, params) {
  const res = await db.query(sql, params);
  return (res && res.rows) || [];
}

async function one(db, sql, params) {
  return (await rows(db, sql, params))[0] || {};
}

/** Which of the columns this tool writes the `customers` table has. */
async function readSchema(db) {
  const cols = new Set(
    (
      await rows(
        db,
        `select column_name from information_schema.columns
          where table_schema = current_schema() and table_name = 'customers'`,
      )
    ).map((r) => String(r.column_name)),
  );
  const optouts = (
    await rows(
      db,
      `select 1 from information_schema.tables where table_schema = current_schema() and table_name = 'mail_optouts'`,
    )
  ).length > 0;
  return { customers: cols.has("email"), source: cols.has("source"), shipPref: cols.has("ship_pref"), optouts };
}

/** countriesOff as the shop reads it today: settings.shipping_rules, else the default. */
async function readCountriesOff(db, fallback) {
  const r = await one(db, "select value from settings where key = 'shipping_rules'");
  return countriesOffFrom(r.value, fallback);
}

/** The e-mails of `emails` that already have a row — compared lower-cased, like the app keys them. */
async function existingEmails(db, emails) {
  if (!emails.length) return new Set();
  const found = await rows(
    db,
    `select lower(c.email) as email
       from customers c
       join jsonb_array_elements_text($1::jsonb) as e(v) on e.v = lower(c.email)`,
    [JSON.stringify(emails)],
  );
  return new Set(found.map((r) => String(r.email)));
}

/**
 * The e-mails of `emails` whose owner deleted their account in «Мой кабинет»
 * (mail_optouts kind 'account_deleted', 223_account_erasure.sql). Their row is
 * gone from customers, so existingEmails() cannot see them — without this a
 * re-run after launch would bring back a person who asked to be erased. The
 * reset never clears mail_optouts, so the rule outlives it too.
 */
async function erasedEmails(db, emails) {
  if (!emails.length) return new Set();
  const found = await rows(
    db,
    `select lower(o.email) as email
       from mail_optouts o
       join jsonb_array_elements_text($1::jsonb) as e(v) on e.v = lower(o.email)
      where o.kind = 'account_deleted'`,
    [JSON.stringify(emails)],
  );
  return new Set(found.map((r) => String(r.email)));
}

/**
 * Read the file and the database; with `apply`, write — in one transaction.
 * Returns a report of counts (no personal data in it). Throws ImportError when
 * it will not write; by then nothing has been written or it was rolled back.
 *
 * @param {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }} db
 * @param {{ csvText: string, apply?: boolean, defaultOff?: string[] }} opts
 */
export async function importCustomers(db, { csvText, apply = false, defaultOff = defaultCountriesOff() }) {
  const csv = readCustomersCsv(csvText);
  const schema = await readSchema(db);
  if (!schema.customers || !schema.shipPref) {
    throw new ImportError("this database has no customers table with ship_pref — not the shop's database, or not migrated. Nothing was written.");
  }
  const off = await readCountriesOff(db, defaultOff);
  const built = buildImport(csv.rows, { served: (cc) => servedCountry(cc, off) });
  const existing = await existingEmails(db, built.customers.map((c) => c.email));
  const erased = schema.optouts ? await erasedEmails(db, built.customers.map((c) => c.email)) : new Set();
  const toCreate = built.customers.filter((c) => !existing.has(c.email) && !erased.has(c.email));

  const report = {
    mode: apply ? "apply" : "dry",
    fileRows: csv.rows.length,
    absentColumns: csv.absent,
    skipped: built.skipped,
    inFile: built.customers.length,
    existing: existing.size,
    erased: erased.size,
    toCreate: statsOf(toCreate),
    countriesOff: off,
    sourceColumn: schema.source,
    created: 0,
    raced: 0,
  };
  if (!apply) return report;

  if (!schema.source) {
    throw new ImportError(
      "customers.source is missing — migration 221_customer_source.sql has not run on this database. It runs with " +
        "the deploy (npm run build → tools/migrate.mjs --if-configured), or from the panel: POST /api/admin/migrate. " +
        "Nothing was written.",
    );
  }
  if (!toCreate.length) return report; // a re-run: everybody is already there

  /* One statement for all of them, inside one transaction with a proof before
     the commit. `ship_pref` is left out of an object that has none, so the
     column is SQL null — «none set» — and not the JSON value null. */
  const payload = toCreate.map((c) => {
    const o = { email: c.email, name: c.name, phone: c.phone };
    if (c.shipPref) o.ship_pref = c.shipPref;
    return o;
  });
  await db.query("begin");
  try {
    const made = await rows(
      db,
      `insert into customers (email, name, phone, ship_pref, marketing, source)
       select x.email, x.name, x.phone, x.ship_pref, false, $2
         from jsonb_to_recordset($1::jsonb) as x(email text, name text, phone text, ship_pref jsonb)
       on conflict (email) do nothing
       returning email`,
      [JSON.stringify(payload), SOURCE],
    );
    const madeEmails = made.map((r) => String(r.email));
    /* Every row this statement says it created is there, marked as imported,
       and carries no consent of any kind. Anything else and nothing is kept. */
    const proof = await one(
      db,
      `select count(*)::int as n
         from customers c
         join jsonb_array_elements_text($1::jsonb) as e(v) on e.v = c.email
        where c.source = $2 and c.marketing = false and c.marketing_at is null and c.marketing_source is null`,
      [JSON.stringify(madeEmails), SOURCE],
    );
    if (Number(proof.n) !== madeEmails.length) {
      await db.query("rollback");
      throw new ImportError(
        `the check before the commit failed (${madeEmails.length} inserted, ${Number(proof.n)} found as imported ` +
          "without consent) — rolled back, nothing was written.",
      );
    }
    await db.query("commit");
    report.created = madeEmails.length;
    // an address that signed in between the look and the write: left alone, like any existing one
    report.raced = toCreate.length - madeEmails.length;
    return report;
  } catch (err) {
    if (!(err instanceof ImportError)) {
      try {
        await db.query("rollback");
      } catch {
        /* the driver may already have aborted it */
      }
    }
    throw err;
  }
}

/* ---------- printing ------------------------------------------------------- */

const list = (m) =>
  Object.entries(m)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([k, n]) => `${k} ${n}`)
    .join(", ") || "—";

/**
 * The report as text: counts and country codes, nothing else.
 *
 * @param {any} report
 * @param {{ csvName?: string, csvArg?: string, url?: string, pglite?: boolean, launcher?: string }} [opts]
 */
export function formatReport(report, { csvName = "", csvArg = "<export.csv>", url = "", pglite = false, launcher = "node" } = {}) {
  const L = [];
  const t = report.toCreate;
  const sk = report.skipped;
  L.push(`Shopify customer export ${csvName} · ${report.fileRows} row(s)`);
  L.push(`Database: ${pglite ? "in-memory PGlite (empty — DB_DRIVER=pglite)" : maskUrl(url)}`);
  if (report.absentColumns.length) L.push(`Columns not in this file (read as empty): ${report.absentColumns.join(", ")}`);
  L.push("");
  L.push("Left out:");
  L.push(`  ${sk.noName} row(s) without a name (neither first nor last)`);
  L.push(`  ${sk.noEmail} row(s) with a name but no e-mail — an account is found by its e-mail`);
  L.push(`  ${sk.badEmail} row(s) whose e-mail is not an e-mail address`);
  L.push(`  ${sk.duplicate} row(s) repeating an e-mail — merged into the first (the first non-empty value wins)`);
  L.push("");
  L.push(`${report.inFile} customer(s) in the file; ${report.existing} already in the database — left exactly as they are.`);
  if (report.erased) L.push(`${report.erased} deleted their account in «Мой кабинет» — never imported again.`);
  L.push(`${report.mode === "apply" ? "Created" : "To create"}: ${report.mode === "apply" ? report.created : t.total}`);
  L.push(
    `  with a phone: ${t.withPhone} (from «Phone» ${t.phoneFrom.phone}, from «Default Address Phone» ${t.phoneFrom.address})` +
      (t.phoneUnusable ? ` · ${t.phoneUnusable} left without one: under ${PHONE_MIN_DIGITS} digits` : ""),
  );
  L.push(
    `  with a default address: ${t.withAddress} — kept with its country, no delivery method chosen for them; ` +
      "the checkout fills it in when they pick «Курьер»",
  );
  L.push(`    countries: ${list(t.countries)}`);
  const d = t.addressDropped;
  if (d.not_served || d.incomplete || d.no_country) {
    L.push(
      `  address left out, the customer still imported: ${d.not_served} in a country the shop does not deliver to (${list(t.notServed)}) · ` +
        `${d.incomplete} incomplete (street, postcode and city go together) · ${d.no_country} without a country`,
    );
  }
  L.push(
    `  marketing consent: none — Shopify's «Accepts Email Marketing» was «yes» for ${t.shopifyMarketing} of them, ` +
      "and every one comes over with marketing = false all the same (Dim, 18.09 and 28.09).",
  );
  L.push("  not carried over: orders, notes, tags, totals, company, language (RU until the first sign-in).");
  L.push("");
  L.push(`The shop does not deliver to: ${report.countriesOff.join(" ") || "— (every country open)"} (settings → Доставка, else the default).`);
  L.push(
    `customers.source (migration 221): ${report.sourceColumn ? "present" : "MISSING — --apply refuses until the deploy has run it"}.`,
  );
  L.push("");
  if (report.mode === "apply") {
    L.push(
      report.created
        ? `Done, in one transaction: ${report.created} customer(s) created, marked source = '${SOURCE}', marketing = false.`
        : "Nothing to create — every customer in the file already has an account. Nothing was written.",
    );
    if (report.raced) L.push(`${report.raced} e-mail(s) got an account of their own during the run and were left alone.`);
  } else {
    L.push("DRY RUN — nothing was written. To write:");
    L.push(`  ${launcher} tools/import-shopify-customers.mjs --csv ${csvArg} --apply --confirm ${CONFIRM_WORD}`);
  }
  return L.join("\n");
}

/* ---------- CLI ------------------------------------------------------------ */

export function parseArgs(argv) {
  const out = { csv: "", apply: false, confirm: "", help: false, unknown: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new ImportError(`${a} needs a value`);
      i++;
      return v;
    };
    if (a === "--csv") out.csv = need();
    else if (a.startsWith("--csv=")) out.csv = a.slice("--csv=".length);
    else if (a === "--apply") out.apply = true;
    else if (a === "--confirm") out.confirm = need();
    else if (a.startsWith("--confirm=")) out.confirm = a.slice("--confirm=".length);
    else if (a === "--help" || a === "-h") out.help = true;
    else out.unknown = a;
  }
  return out;
}

/** Why this command may not run — null when it may. Nothing is read before this passes. */
export function argsRefusal(args) {
  if (args.unknown) return `unknown argument: ${args.unknown}`;
  if (!args.csv) return "--csv <file> is required — Shopify's customer export";
  if (args.apply && args.confirm !== CONFIRM_WORD) return `--apply needs --confirm ${CONFIRM_WORD} — it writes to the shop's customers`;
  if (!args.apply && args.confirm) return "--confirm without --apply does nothing. Add --apply when you mean it.";
  return null;
}

const USAGE = `import-shopify-customers — Shopify's customer export → accounts in the shop (Dim, 28.09.2026, option B).

  node --env-file=.env.railway.txt tools/import-shopify-customers.mjs --csv <export.csv>        dry run: counts only
  node --env-file=.env.railway.txt tools/import-shopify-customers.mjs --csv <export.csv> --apply --confirm ${CONFIRM_WORD}
  DB_DRIVER=pglite node tools/import-shopify-customers.mjs --csv <export.csv>                    against an empty in-memory database

Only customers with a name; e-mail, phone, default address; marketing = false for everyone.
The export: Shopify → Customers → Export → All customers → Plain CSV (it arrives by e-mail).
After the go-live reset — docs/go-live.md, the day, step 4b.`;

/* The errors node-postgres gives when the server's certificate chain ends in a
   CA Node does not trust — Railway's own, every time (docs/backend.md). */
const TLS_UNTRUSTED = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
]);

async function connect() {
  if (process.env.DB_DRIVER === "pglite") {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite(process.env.PGLITE_PATH || undefined);
    await migrate(db);
    return { db, close: () => db.close(), url: "", pglite: true };
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new ImportError(
      "DATABASE_URL is not set. Start the tool with the file from docs/go-live-reset.md, step 1:\n" +
        "  node --env-file=.env.railway.txt tools/import-shopify-customers.mjs --csv <export.csv>\n" +
        "(or DB_DRIVER=pglite for an empty in-memory database).",
    );
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });
  try {
    await client.connect();
  } catch (err) {
    if (err && TLS_UNTRUSTED.has(err.code)) {
      throw new ImportError(
        `could not verify the database's certificate (${err.code}). Railway signs it with its own CA.\n` +
          "Add one line to .env.railway.txt — DATABASE_SSL_NO_VERIFY=1 — or DATABASE_SSL_CA with Railway's CA,\n" +
          "and run the same command again. Nothing was changed.",
      );
    }
    throw err;
  }
  return { db: client, close: () => client.end(), url, pglite: false };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`import-shopify-customers: ${err.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (args.help) return console.log(USAGE);
  const refusal = argsRefusal(args);
  if (refusal) {
    console.error(`import-shopify-customers: ${refusal}\n\n${USAGE}`);
    process.exit(2);
  }
  const csvText = fs.readFileSync(args.csv, "utf8");
  const { db, close, url, pglite } = await connect();
  try {
    let report;
    try {
      report = await importCustomers(db, { csvText, apply: args.apply });
    } catch (err) {
      if (err instanceof ImportError) throw err;
      /* Postgres quotes the value it choked on, and here that value is a
         customer's e-mail or address: the code is enough to look it up. */
      throw new ImportError(
        `database error ${(err && err.code) || "(no code)"} — its text is withheld because it can quote customer data. ` +
          "Nothing was written (the transaction was rolled back).",
      );
    }
    console.log(
      formatReport(report, {
        csvName: path.basename(args.csv),
        csvArg: /\s/.test(args.csv) ? `"${args.csv}"` : args.csv,
        url,
        pglite,
        launcher: launcherFrom(process.execArgv),
      }),
    );
  } finally {
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof ImportError ? `import-shopify-customers: ${err.message}` : err);
    process.exit(err instanceof ImportError ? 2 : 1);
  });
}
