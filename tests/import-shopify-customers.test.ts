/**
 * tools/import-shopify-customers.mjs — the Shopify store's customers, brought
 * over on the night of the launch (Dim, 28.09.2026, option B).
 *
 * Every person below is invented: the addresses are on example.com, the
 * streets and phones are made up. The real export is personal data and never
 * comes near the repository.
 *
 * What is proved here, against the real schema in PGlite and the shop's own
 * code rather than a copy of it:
 *   · each Shopify column lands where the shop itself would have put it —
 *     the imported address is what getCustomer() and GET /api/account/me hand
 *     the checkout as «Доставка по умолчанию»: the country and the door, no
 *     delivery method (Dim, 28.09.2026, option b — the storefront half is
 *     tests/acct-imported-door.test.ts);
 *   · every skip rule, the merge of a repeated e-mail, the phone and address
 *     rules, the countries the shop does not deliver to;
 *   · marketing = false for everyone, and no opt-out either;
 *   · a dry run writes nothing, a re-run changes nothing, an existing account
 *     is never touched, and a failure inside the write leaves nothing behind;
 *   · the imported customer signs in by e-mail code on the ordinary path and
 *     finds the one row the import made;
 *   · the printed report carries no e-mail, name, phone or address;
 *   · the tool's copies of the shop's rules answer like the originals.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import {
  getCustomer,
  isEmail as shopIsEmail,
  issueLoginCode,
  makeCustomerToken,
  normalizeEmail as shopNormalizeEmail,
  normalizeShipAddress,
  normalizeShipPref,
  recordLogin,
  updateCustomer,
} from "@/lib/customers";
import { DEFAULT_SHIPPING_RULES, EUROPE as SHOP_EUROPE, countryOff, shippingZone } from "@/lib/shipping";
import {
  CONFIRM_WORD,
  EUROPE,
  HOME_COUNTRIES,
  ImportError,
  SOURCE,
  addressOf,
  argsRefusal,
  buildImport,
  cleanPhone,
  cleanText,
  countriesOffFrom,
  defaultCountriesOff,
  formatReport,
  importCustomers,
  isEmail,
  normalizeEmail,
  parseArgs,
  readCustomersCsv,
  servedCountry,
} from "../tools/import-shopify-customers.mjs";
import { setupDb, teardownDb, TEST_SECRET } from "./helpers";

/* ---------- a Shopify export, invented --------------------------------------- */

const HEADER = [
  "Customer ID", "First Name", "Last Name", "Email", "Accepts Email Marketing", "Default Address Company",
  "Default Address Address1", "Default Address Address2", "Default Address City", "Default Address Province Code",
  "Default Address Country Code", "Default Address Zip", "Default Address Phone", "Phone", "Accepts SMS Marketing",
  "Total Spent", "Total Orders", "Note", "Tax Exempt", "Tags", "Accepts WhatsApp Marketing",
];

type Row = Partial<Record<(typeof HEADER)[number], string>>;

const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const csvOf = (rows: Row[]) => [HEADER.join(","), ...rows.map((r) => HEADER.map((h) => cell(r[h] ?? "")).join(","))].join("\r\n") + "\r\n";

const ANNA: Row = {
  "Customer ID": "9001", "First Name": "Anna", "Last Name": "Tamm", Email: "  Anna.Tamm@Example.COM ",
  "Accepts Email Marketing": "yes", "Default Address Company": "Tamm Invented OÜ",
  "Default Address Address1": "Merekalda tee 5", "Default Address Address2": "korter 12",
  "Default Address City": "Tallinn", "Default Address Country Code": "EE", "Default Address Zip": "10111",
  "Default Address Phone": "'+372 5550 0101", "Total Spent": "123.45", "Total Orders": "3",
  Note: "likes the pomade, call after five", Tags: "vip, salon",
};
const BORIS: Row = { "Customer ID": "9002", "First Name": "Boris", Email: "boris.invented@example.com", "Accepts Email Marketing": "no", Phone: "+37255500202" };
const KASK: Row = {
  "Customer ID": "9003", "Last Name": "Kaskinvent", Email: "kask.invented@example.com", "Accepts Email Marketing": "yes",
  "Default Address Address1": "Brivibas iela 10, dz. 3", "Default Address City": "Riga", "Default Address Country Code": "LV",
  "Default Address Zip": "LV-1011", "Default Address Phone": "123",
};
const NONAME: Row = { "Customer ID": "9004", Email: "noname.invented@example.com", "Accepts Email Marketing": "yes", Phone: "+37255500404" };
const NOMAIL: Row = { "Customer ID": "9005", "First Name": "Eve", "Last Name": "Nomailinvent", Phone: "+37255500505" };
const BADMAIL1: Row = { "Customer ID": "9006", "First Name": "Frank", "Last Name": "Bad", Email: "frank-at-example.com" };
const BADMAIL2: Row = { "Customer ID": "9007", "First Name": "Gina", "Last Name": "Bad", Email: "gina@localhost" };
/** Anna again, differently spelled — her own values stay, nothing of this one is needed. */
const ANNA_AGAIN: Row = {
  "Customer ID": "9008", "First Name": "Annabel", "Last Name": "Other", Email: "anna.tamm@example.com",
  "Accepts Email Marketing": "no", Phone: "+37255500808", "Default Address Address1": "Muu tee 1",
  "Default Address City": "Narva", "Default Address Country Code": "EE", "Default Address Zip": "20001",
};
/** Boris again — his first row had no address, so this one's fills it. */
const BORIS_AGAIN: Row = {
  "Customer ID": "9009", "First Name": "Boriss", Email: "BORIS.invented@example.com", "Default Address Address1": "Narva mnt 1",
  "Default Address City": "Tartu", "Default Address Country Code": "EE", "Default Address Zip": "51009",
};
const URSULA: Row = {
  "Customer ID": "9010", "First Name": "Ursula", "Last Name": "Statesinvent", Email: "ursula.invented@example.com",
  "Accepts Email Marketing": "yes", "Default Address Address1": "1 Invented St", "Default Address City": "Springfield",
  "Default Address Country Code": "US", "Default Address Zip": "12345", "Default Address Phone": "+1 555 010 0000",
};
const GORDON: Row = {
  "Customer ID": "9011", "First Name": "Gordon", "Last Name": "Britinvent", Email: "gordon.invented@example.com",
  "Default Address Address1": "10 Invented Row", "Default Address City": "London", "Default Address Country Code": "GB",
  "Default Address Zip": "SW1A 9ZZ",
};
const ILSE: Row = {
  "Customer ID": "9012", "First Name": "Ilse", "Last Name": "Halbinvent", Email: "ilse.invented@example.com",
  "Default Address Address1": "Tamme 3", "Default Address City": "Tartu", "Default Address Country Code": "EE",
};
const MART: Row = {
  "Customer ID": "9013", "First Name": "Mart", "Last Name": "Kaksinvent", Email: "mart.invented@example.com",
  Phone: "+37255500303", "Default Address Phone": "+37255500304",
};
const NELE: Row = { "Customer ID": "9014", "First Name": "Nele\t", "Last Name": "  Metsinvent ", Email: "nele.invented@example.com" };

const ROWS = [ANNA, BORIS, KASK, NONAME, NOMAIL, BADMAIL1, BADMAIL2, ANNA_AGAIN, BORIS_AGAIN, URSULA, GORDON, ILSE, MART, NELE];
const CSV = csvOf(ROWS);
const IMPORTED = [
  "anna.tamm@example.com", "boris.invented@example.com", "kask.invented@example.com", "ursula.invented@example.com",
  "gordon.invented@example.com", "ilse.invented@example.com", "mart.invented@example.com", "nele.invented@example.com",
];

/** Everything personal in the file above, as it is in the file and as it is stored. */
const PERSONAL = [
  ...ROWS.flatMap((r) =>
    ["First Name", "Last Name", "Email", "Default Address Company", "Default Address Address1", "Default Address Address2",
      "Default Address City", "Default Address Zip", "Default Address Phone", "Phone", "Note"].map((k) => (r[k] ?? "").trim()),
  ),
  ...IMPORTED,
  "Anna Tamm", "+372 5550 0101", "Merekalda tee 5, korter 12", "Nele Metsinvent",
].filter((v) => v.length >= 4);

/* ---------- the rig --------------------------------------------------------------- */

type Db = { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> };
/** The thin adapter the tool takes — the same one tests/go-live-reset.test.ts hands its tool. */
const db: Db = { query: async (sql, params) => ({ rows: await query(sql, params) }) };

type Stats = {
  total: number; withPhone: number; phoneFrom: { phone: number; address: number }; phoneUnusable: number;
  withAddress: number; countries: Record<string, number>; addressDropped: Record<string, number>;
  notServed: Record<string, number>; shopifyMarketing: number;
};
type Report = {
  mode: string; fileRows: number; absentColumns: string[];
  skipped: { noName: number; noEmail: number; badEmail: number; duplicate: number };
  inFile: number; existing: number; toCreate: Stats; countriesOff: string[]; sourceColumn: boolean; created: number; raced: number;
};

const run = async (opts: { apply?: boolean; csvText?: string; via?: Db } = {}) =>
  (await importCustomers(opts.via ?? db, { csvText: opts.csvText ?? CSV, apply: Boolean(opts.apply) })) as unknown as Report;

const count = async (table: string) => Number((await query<{ n: number }>(`select count(*)::int as n from ${table}`))[0].n);
const rowOf = async (email: string) => (await query<Record<string, unknown>>("select * from customers where email = $1", [email]))[0];
/** The whole customers table as one string — «nothing changed» means this is equal. */
const fingerprint = async () =>
  String(
    (await query<{ fp: string }>(
      "select md5(coalesce(string_agg(row_to_json(c)::text, ',' order by c.email), '')) as fp from customers c",
    ))[0].fp,
  );

const ANNA_PREF = {
  country: "EE", method: "", carrier: "", machine: "",
  address: { addr: "Merekalda tee 5, korter 12", zip: "10111", city: "Tallinn" },
};

describe("tools/import-shopify-customers.mjs", () => {
  beforeAll(async () => {
    process.env.SESSION_SECRET = TEST_SECRET;
    await setupDb();
  });
  afterAll(teardownDb);
  beforeEach(async () => {
    for (const t of ["loyalty_ledger", "customers", "login_codes", "mail_optouts", "carts", "stock_alerts", "events", "admin_audit"]) {
      await query(`delete from ${t}`);
    }
    await query("delete from settings where key = 'shipping_rules'");
  });

  /* ---------- the file -------------------------------------------------------- */

  it("reads Shopify's customer export and refuses a file that is not one — without quoting a row", () => {
    const { rows, absent } = readCustomersCsv(CSV) as { rows: Array<Record<string, string>>; absent: string[] };
    expect(rows.length).toBe(ROWS.length);
    expect(absent).toEqual([]);
    expect(rows[2].address1, "a quoted comma stays inside its field").toBe("Brivibas iela 10, dz. 3");
    // saved through Excel: a byte-order mark in front of the header changes nothing
    expect(readCustomersCsv("﻿" + CSV).rows).toEqual(rows);

    const notIt = "Handle,Title,Email\r\nsome-handle,Some Title,somebody.invented@example.com\r\n";
    expect(() => readCustomersCsv(notIt)).toThrow(ImportError);
    try {
      readCustomersCsv(notIt);
    } catch (err) {
      expect((err as Error).message).toContain("«First Name»");
      expect((err as Error).message).not.toContain("somebody.invented@example.com");
    }
    expect(() => readCustomersCsv("")).toThrow(/empty/);
  });

  /* ---------- the mapping ------------------------------------------------------ */

  it("maps every Shopify field onto the columns the shop reads", async () => {
    const report = await run({ apply: true });
    expect(report.created).toBe(IMPORTED.length);

    const anna = await rowOf("anna.tamm@example.com");
    expect(anna, "trimmed and lower-cased — the key everything here uses").toBeTruthy();
    expect(anna.name).toBe("Anna Tamm");
    expect(anna.phone, "Shopify's Excel apostrophe is not part of the number").toBe("+372 5550 0101");
    expect(anna.ship_pref).toEqual(ANNA_PREF);
    expect(normalizeShipPref(anna.ship_pref), "already in the shop's own normal form").toEqual(anna.ship_pref);
    expect(anna.marketing).toBe(false);
    expect(anna.marketing_at).toBeNull();
    expect(anna.marketing_source).toBeNull();
    expect(anna.marketing_off_at).toBeNull();
    expect(anna.source).toBe(SOURCE);
    expect(anna.lang, "the column's default — the export carries no language").toBe("RU");
    // what option B leaves in Shopify
    expect(anna.company, "no company").toBeNull();
    expect(anna.notes, "no note").toBeNull();
    expect(anna.birthday).toBeNull();
    expect(anna.tier).toBe("retail");
    expect(anna.last_login_at, "nobody has signed in yet").toBeNull();

    // the shop's reader sees the same: this is what the checkout starts from
    const c = await getCustomer("anna.tamm@example.com");
    expect(c?.name).toBe("Anna Tamm");
    expect(c?.phone).toBe("+372 5550 0101");
    expect(c?.shipPref).toEqual(ANNA_PREF);
    expect(c?.marketing).toBe(false);

    // a last name alone is a name; «Default Address Address1» with a comma in it stays one street
    const kask = await rowOf("kask.invented@example.com");
    expect(kask.name).toBe("Kaskinvent");
    expect(kask.ship_pref).toEqual({
      country: "LV", method: "", carrier: "", machine: "",
      address: { addr: "Brivibas iela 10, dz. 3", zip: "LV-1011", city: "Riga" },
    });
    // a tab in a name is folded like the account form folds it
    expect((await rowOf("nele.invented@example.com")).name).toBe("Nele Metsinvent");

    // no address → no preference at all: SQL null, «none set», not the JSON value null
    const nulls = await query<{ email: string }>("select email from customers where ship_pref is null order by email");
    expect(nulls.map((r) => r.email)).toEqual([
      "gordon.invented@example.com", "ilse.invented@example.com", "mart.invented@example.com",
      "nele.invented@example.com", "ursula.invented@example.com",
    ]);
    expect(await count("customers")).toBe(IMPORTED.length);
  });

  it("leaves out no name, no e-mail and a bad e-mail, and merges a repeated e-mail — first non-empty value wins", async () => {
    const report = await run({ apply: true });
    expect(report.fileRows).toBe(14);
    expect(report.skipped).toEqual({ noName: 1, noEmail: 1, badEmail: 2, duplicate: 2 });
    expect(report.inFile).toBe(IMPORTED.length);

    expect(await rowOf("noname.invented@example.com"), "no name — not imported").toBeUndefined();
    const emails = (await query<{ email: string }>("select email from customers order by email")).map((r) => r.email);
    expect(emails).toEqual([...IMPORTED].sort());

    // Anna's second row: her own name, phone and address stay
    const anna = await rowOf("anna.tamm@example.com");
    expect(anna.name).toBe("Anna Tamm");
    expect(anna.phone).toBe("+372 5550 0101");
    expect(anna.ship_pref).toEqual(ANNA_PREF);
    // Boris's first row had no address; the second row's fills it, his name and phone stay
    const boris = await rowOf("boris.invented@example.com");
    expect(boris.name).toBe("Boris");
    expect(boris.phone).toBe("+37255500202");
    expect(boris.ship_pref).toEqual({
      country: "EE", method: "", carrier: "", machine: "", address: { addr: "Narva mnt 1", zip: "51009", city: "Tartu" },
    });
  });

  it("takes «Phone» before «Default Address Phone», and leaves out a phone under seven digits", async () => {
    const report = await run({ apply: true });
    expect((await rowOf("mart.invented@example.com")).phone).toBe("+37255500303");
    expect((await rowOf("ursula.invented@example.com")).phone, "the address's phone when there is no other").toBe("+1 555 010 0000");
    expect((await rowOf("kask.invented@example.com")).phone, "«123» is not a phone").toBeNull();
    expect(report.toCreate.withPhone).toBe(4);
    expect(report.toCreate.phoneFrom).toEqual({ phone: 2, address: 2 });
    expect(report.toCreate.phoneUnusable).toBe(1);
  });

  it("keeps the customer and leaves out an address that is incomplete or in a country the shop does not deliver to", async () => {
    const report = await run({ apply: true });
    expect(report.toCreate.withAddress).toBe(3);
    expect(report.toCreate.countries).toEqual({ EE: 2, LV: 1 });
    expect(report.toCreate.addressDropped).toEqual({ incomplete: 1, no_country: 0, not_served: 2 });
    expect(report.toCreate.notServed).toEqual({ US: 1, GB: 1 });
    for (const e of ["ursula.invented@example.com", "gordon.invented@example.com", "ilse.invented@example.com"]) {
      const r = await rowOf(e);
      expect(r, e).toBeTruthy();
      expect(r.ship_pref, e).toBeNull();
    }
  });

  it("reads the countries switched off in «Настройки → Доставка» from the database, like the checkout", async () => {
    // Renat opens the UK and closes Latvia
    await query("insert into settings (key, value) values ('shipping_rules', $1::jsonb)", [JSON.stringify({ countriesOff: ["lv"] })]);
    const report = await run({ apply: true });
    expect(report.countriesOff).toEqual(["LV"]);
    expect((await rowOf("gordon.invented@example.com")).ship_pref).toEqual({
      country: "GB", method: "", carrier: "", machine: "",
      address: { addr: "10 Invented Row", zip: "SW1A 9ZZ", city: "London" },
    });
    expect((await rowOf("kask.invented@example.com")).ship_pref, "Latvia is off now").toBeNull();
    // the United States is no zone of the shop's at all, whatever the switch says
    expect((await rowOf("ursula.invented@example.com")).ship_pref).toBeNull();
  });

  /* ---------- consent ----------------------------------------------------------- */

  it("imports everybody with marketing = false even when Shopify says yes — and opts nobody out", async () => {
    const report = await run({ apply: true });
    expect(report.toCreate.shopifyMarketing, "Anna, Kask and Ursula said yes to Shopify").toBe(3);
    const yes = await query("select email from customers where marketing is distinct from false or marketing_at is not null or marketing_source is not null");
    expect(yes).toEqual([]);
    // «never opted in here» is not «opted out»: the stop list stays empty
    expect(await count("mail_optouts")).toBe(0);
    // and nothing else is set in motion: no code, no letter, no event, no audit row
    for (const t of ["login_codes", "carts", "stock_alerts", "events", "admin_audit", "loyalty_ledger"]) {
      expect(await count(t), t).toBe(0);
    }
  });

  /* ---------- dry run, re-run, existing accounts ------------------------------------ */

  it("writes nothing on a dry run — not even a transaction", async () => {
    const seen: string[] = [];
    const spy: Db = { query: async (sql, params) => (seen.push(sql), db.query(sql, params)) };
    const report = await run({ via: spy });
    expect(report.mode).toBe("dry");
    expect(report.toCreate.total).toBe(IMPORTED.length);
    expect(report.created).toBe(0);
    expect(await count("customers")).toBe(0);
    expect(seen.filter((s) => /\b(insert|update|delete|begin)\b/i.test(s))).toEqual([]);
  });

  it("is harmless run twice: the second run creates nothing and changes nothing", async () => {
    const first = await run({ apply: true });
    expect(first.created).toBe(IMPORTED.length);
    const before = await fingerprint();

    const dry = await run();
    expect(dry.existing).toBe(IMPORTED.length);
    expect(dry.toCreate.total).toBe(0);

    const second = await run({ apply: true });
    expect(second.created).toBe(0);
    expect(second.existing).toBe(IMPORTED.length);
    expect(await fingerprint()).toBe(before);
    expect(await count("customers")).toBe(IMPORTED.length);
  });

  it("never overwrites an account that already exists — name, phone, address, consent and all", async () => {
    // Boris signed in on the new shop before the import and filled his account himself
    await recordLogin("boris.invented@example.com", "ET");
    await updateCustomer("boris.invented@example.com", {
      name: "Boris Own",
      phone: "+37255509999",
      shipPref: { country: "EE", method: "parcel", carrier: "omniva", machine: "Some machine" },
    });
    await query("update customers set marketing = true, marketing_at = now(), marketing_source = 'account' where email = $1", [
      "boris.invented@example.com",
    ]);
    const mine = await rowOf("boris.invented@example.com");

    const report = await run({ apply: true });
    expect(report.existing).toBe(1);
    expect(report.created).toBe(IMPORTED.length - 1);
    expect(await rowOf("boris.invented@example.com"), "his own row, to the byte").toEqual(mine);
    expect((await rowOf("boris.invented@example.com")).source, "and not marked as imported").toBeNull();
  });

  /* ---------- the checkout and the sign-in -------------------------------------------- */

  it("hands the checkout the imported address as the saved default — GET /api/account/me", async () => {
    await run({ apply: true });
    const { GET } = await import("@/app/api/account/me/route");
    const res = await GET(
      new Request("https://rempireshop.com/api/account/me/", {
        headers: { cookie: `rmp_cust=${makeCustomerToken("anna.tamm@example.com")}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; customer: { name: string; phone: string; marketing: boolean; shipPref: unknown } };
    expect(body.ok).toBe(true);
    expect(body.customer.name).toBe("Anna Tamm");
    expect(body.customer.phone).toBe("+372 5550 0101");
    expect(body.customer.marketing).toBe(false);
    /* the country and the door with no method (Dim, 28.09.2026, option b):
       what applyAcctShipPref() opens the checkout on and fillSavedDoor()
       puts into the courier's boxes — tests/acct-imported-door.test.ts */
    expect(body.customer.shipPref).toEqual(ANNA_PREF);
    expect((body.customer.shipPref as { method: string }).method, "no delivery chosen for them").toBe("");
  });

  it("signs an imported customer in by e-mail code on the ordinary path — into the imported row, not a second one", async () => {
    await run({ apply: true });
    const before = await rowOf("anna.tamm@example.com");
    const { POST: login } = await import("@/app/api/account/login/route");

    const { code } = await issueLoginCode("anna.tamm@example.com");
    const res = await login(
      new Request("https://rempireshop.com/api/account/login/", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.77" },
        // typed the way people type it — the account is found all the same
        body: JSON.stringify({ email: " Anna.Tamm@example.com", code, lang: "ET" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie") || "").toContain("rmp_cust=v1.");
    const body = (await res.json()) as { ok: boolean; customer: { id: string; name: string; shipPref: unknown } };
    expect(body.ok).toBe(true);
    expect(body.customer.id).toBe(String(before.id));
    expect(body.customer.name).toBe("Anna Tamm");
    expect(body.customer.shipPref).toEqual(ANNA_PREF);

    const all = await query<{ n: number }>("select count(*)::int as n from customers where lower(email) = 'anna.tamm@example.com'");
    expect(all[0].n).toBe(1);
    const after = await rowOf("anna.tamm@example.com");
    expect(after.last_login_at).not.toBeNull();
    expect(after.lang).toBe("ET");
    expect(after.source, "signing in does not un-mark the import").toBe(SOURCE);
    expect(after.marketing).toBe(false);
    expect({ ...after, last_login_at: null, lang: "RU" }).toEqual(before);
  });

  /* ---------- refusals and the one transaction ------------------------------------------ */

  it("refuses --apply until migration 221 has run, and writes nothing", async () => {
    const noSource: Db = {
      query: async (sql, params) => {
        const r = await db.query(sql, params);
        return sql.includes("information_schema.columns") ? { rows: r.rows.filter((x) => x.column_name !== "source") } : r;
      },
    };
    const dry = await run({ via: noSource });
    expect(dry.sourceColumn).toBe(false);
    expect(formatReport(dry)).toContain("MISSING");
    await expect(run({ via: noSource, apply: true })).rejects.toThrow(/221_customer_source/);
    expect(await count("customers")).toBe(0);
  });

  it("writes in one transaction: a failure after the insert leaves nothing behind", async () => {
    const failing: Db = {
      query: async (sql, params) => {
        if (/c\.source = \$2 and c\.marketing = false/.test(sql)) throw new Error("the connection dropped");
        return db.query(sql, params);
      },
    };
    await expect(run({ via: failing, apply: true })).rejects.toThrow("the connection dropped");
    expect(await count("customers")).toBe(0);
    // and the connection is usable again — the transaction is not left open
    expect((await run({ apply: true })).created).toBe(IMPORTED.length);
  });

  it("asks for the confirmation word, and for --apply before it", () => {
    expect(argsRefusal(parseArgs(["--csv", "x.csv"]))).toBeNull();
    expect(argsRefusal(parseArgs(["--csv", "x.csv", "--apply", "--confirm", CONFIRM_WORD]))).toBeNull();
    expect(argsRefusal(parseArgs(["--csv", "x.csv", "--apply"]))).toContain(CONFIRM_WORD);
    expect(argsRefusal(parseArgs(["--csv", "x.csv", "--apply", "--confirm", "ИМПОРТ"]))).toContain(CONFIRM_WORD);
    expect(argsRefusal(parseArgs(["--csv", "x.csv", "--confirm", CONFIRM_WORD]))).toContain("--apply");
    expect(argsRefusal(parseArgs(["--apply", "--confirm", CONFIRM_WORD]))).toContain("--csv");
    expect(argsRefusal(parseArgs(["--csv", "x.csv", "--force"]))).toContain("--force");
    expect(() => parseArgs(["--csv"])).toThrow(ImportError);
  });

  /* ---------- what it prints ---------------------------------------------------------- */

  it("prints counts and country codes — never an e-mail, a name, a phone or an address", async () => {
    const dry = formatReport(await run(), { csvName: "customers_export.csv" });
    const done = formatReport(await run({ apply: true }), { csvName: "customers_export.csv" });
    const again = formatReport(await run({ apply: true }), { csvName: "customers_export.csv" });
    for (const text of [dry, done, again]) {
      for (const v of PERSONAL) expect(text, `the report shows «${v}»`).not.toContain(v);
    }
    expect(dry).toContain("To create: 8");
    expect(dry).toContain("countries: EE 2, LV 1");
    expect(dry).toContain("(GB 1, US 1)");
    expect(dry).toContain("DRY RUN");
    expect(dry).toContain(`--apply --confirm ${CONFIRM_WORD}`);
    expect(done).toContain("Created: 8");
    expect(again).toContain("Nothing to create");
  });

  /* ---------- the copies agree with the originals ---------------------------------------- */

  it("keeps its copies of the shop's rules in step with src/lib", async () => {
    const mails = [
      " A.B@Example.COM ", "a@b.co", "x@y", "no-at.example.com", "two@@example.com", "sp ace@example.com",
      "a@b.c", "ok+tag@sub.example.org", "", "UPPER@EXAMPLE.EE", `${"x".repeat(170)}@example.com`,
    ];
    for (const m of mails) {
      expect(normalizeEmail(m), m).toBe(shopNormalizeEmail(m));
      expect(isEmail(m), m).toBe(shopIsEmail(m));
    }

    // the name and the phone are cleaned the way the account form cleans them
    await recordLogin("mirror.invented@example.com");
    for (const v of ["  Anna\t\tTamm ", "Ülle\u0007Õun", "x".repeat(200), "   "]) {
      const saved = await updateCustomer("mirror.invented@example.com", { name: v, phone: v });
      expect(cleanText(v, 120), JSON.stringify(v)).toBe(saved?.name || null);
      expect(cleanText(v, 40), JSON.stringify(v)).toBe(saved?.phone || null);
    }
    expect(cleanPhone("'+372 5550 0101")).toBe("+372 5550 0101");
    expect(cleanPhone("555 01")).toBeNull();
    expect(cleanPhone("5550101")).toBe("5550101");

    // an address the tool keeps is one the shop's own normaliser keeps, unchanged
    const served = (cc: string) => servedCountry(cc, defaultCountriesOff() as string[]);
    for (const r of [ANNA, KASK, ILSE, BORIS_AGAIN, GORDON]) {
      const a = addressOf(
        {
          address1: r["Default Address Address1"] ?? "", address2: r["Default Address Address2"] ?? "",
          city: r["Default Address City"] ?? "", zip: r["Default Address Zip"] ?? "", country: r["Default Address Country Code"] ?? "",
        },
        served,
      ) as { pref?: { address: unknown } };
      if (a.pref) {
        expect(normalizeShipAddress(a.pref.address)).toEqual(a.pref.address);
        expect(normalizeShipPref(a.pref)).toEqual(a.pref);
      }
    }

    // the countries: the same zones and the same default switch-off as src/lib/shipping.ts
    expect([...EUROPE].sort()).toEqual([...SHOP_EUROPE].sort());
    expect(defaultCountriesOff()).toEqual([...(DEFAULT_SHIPPING_RULES.countriesOff ?? [])].sort());
    const off = defaultCountriesOff() as string[];
    for (const cc of [...HOME_COUNTRIES, ...SHOP_EUROPE, "US", "UA", "RU", "BY", "CA", "AU", "TR"]) {
      const shop = shippingZone(cc) !== "default" && !countryOff(DEFAULT_SHIPPING_RULES, cc);
      expect(servedCountry(cc, off), cc).toBe(shop);
    }
    // an array is authoritative, empty included; anything else keeps the default
    expect(countriesOffFrom({ countriesOff: [] }, off)).toEqual([]);
    expect(countriesOffFrom({ countriesOff: ["gb", "GB", "xx1"] }, off)).toEqual(["GB"]);
    expect(countriesOffFrom({}, off)).toEqual(off);
    expect(countriesOffFrom(null, off)).toEqual(off);
    expect(countriesOffFrom(JSON.stringify({ countriesOff: ["NO"] }), off)).toEqual(["NO"]);
  });

  it("builds the same customers from rows alone — the pure half, no database", () => {
    const { rows } = readCustomersCsv(CSV) as { rows: Array<Record<string, string>> };
    const built = buildImport(rows, { served: (cc: string) => servedCountry(cc, ["GB"]) }) as {
      customers: Array<{ email: string; shipPref: unknown }>;
      skipped: Record<string, number>;
    };
    expect(built.customers.map((c) => c.email)).toEqual(IMPORTED);
    expect(built.skipped).toEqual({ noName: 1, noEmail: 1, badEmail: 2, duplicate: 2 });
  });
});
