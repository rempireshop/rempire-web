import { readFileSync, readdirSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { query } from "@/lib/db";
import { setupDb, teardownDb } from "./helpers";

describe("migrations", () => {
  beforeAll(async () => {
    const applied = await setupDb();
    expect(applied.length).toBeGreaterThan(0);
    expect(applied[0]).toBe("001_core.sql");
  });
  afterAll(teardownDb);

  it("creates every core table", async () => {
    const rows = await query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const names = rows.map((r) => r.table_name);
    for (const t of ["settings", "product_overrides", "orders", "admin_audit", "_migrations"]) {
      expect(names).toContain(t);
    }
  });

  it("keeps out of the other agents' migration ranges", async () => {
    // 001–009 is backend-core's; reviews and gift cards belong to 020–029.
    const core = readFileSync(new URL("../db/migrations/001_core.sql", import.meta.url), "utf8").toLowerCase();
    expect(core).not.toMatch(/create table[^;]*\breviews\b/);
    expect(core).not.toMatch(/create table[^;]*\bgift_cards\b/);

    const mine = readdirSync(new URL("../db/migrations/", import.meta.url)).filter((f) => /^00[1-9]_/.test(f));
    expect(mine).toContain("001_core.sql");
  });

  it("is idempotent — a second run applies nothing", async () => {
    const again = await setupDb();
    expect(again).toEqual([]);
  });

  it("hands out uuid ids and R-1000xx numbers from the sequence", async () => {
    const first = await query<{ id: string; number: string; status: string; currency: string }>(
      "insert into orders (email, name) values ($1, $2) returning id, number, status, currency",
      ["a@example.com", "A"],
    );
    const second = await query<{ number: string }>(
      "insert into orders (email, name) values ($1, $2) returning number",
      ["b@example.com", "B"],
    );
    expect(first[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(first[0].number).toMatch(/^R-1000\d\d$/);
    expect(first[0].status).toBe("new");
    expect(first[0].currency).toBe("EUR");
    expect(Number(second[0].number.slice(2))).toBe(Number(first[0].number.slice(2)) + 1);
  });

  it("refuses an unknown status and an unknown stock state", async () => {
    await expect(
      query("insert into orders (email, name, status) values ($1, $2, $3)", ["c@example.com", "C", "posted"]),
    ).rejects.toBeTruthy();
    await expect(
      query("insert into product_overrides (product_id, stock) values ($1, $2)", ["x", "maybe"]),
    ).rejects.toBeTruthy();
  });
});

/* Cleanup 07.09.2026 — audit M9. TLS verification used to be switched off by a
   substring of DATABASE_URL: a host ending .rlwy.net or .railway.app was
   exempted silently, so renaming the database host changed whether the shop
   checked who it was talking to, and no review of the environment variables
   could see it. One variable decides now, in both the app and the migrator,
   and these two must never drift apart again. */
describe("who decides whether the database certificate is verified", () => {
  const cases: Array<[string, string]> = [
    ["postgres://u:p@containers-us-west-1.rlwy.net:5432/railway", "the old auto-exempt host"],
    ["postgres://u:p@monorail.proxy.railway.app:1234/railway", "the other old auto-exempt host"],
    ["postgres://u:p@db.example.com:5432/shop?sslmode=require", "any other provider"],
  ];

  it("only DATABASE_SSL_NO_VERIFY does — never the host name", async () => {
    const { sslFor } = await import("@/lib/db");
    for (const [url, what] of cases) {
      expect(sslFor(url, {}), what).toEqual({ rejectUnauthorized: true });
      expect(sslFor(url, { DATABASE_SSL_NO_VERIFY: "1" }), what)
        .toEqual({ rejectUnauthorized: false });
      // anything but exactly "1" is not the flag
      for (const v of ["", "0", "true", "yes"]) {
        expect(sslFor(url, { DATABASE_SSL_NO_VERIFY: v }), `${what} / ${v}`)
          .toEqual({ rejectUnauthorized: true });
      }
    }
  });

  /* Railway signs its Postgres certificate with a CA it generates per
     database, so the public trust store cannot verify it. DATABASE_SSL_CA is
     how that connection becomes authenticated rather than merely encrypted —
     the alternative, DATABASE_SSL_NO_VERIFY=1, gives up on the question. */
  it("DATABASE_SSL_CA verifies against the provider's own CA, and giving up still wins over it", async () => {
    const { sslFor } = await import("@/lib/db");
    const CA = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n";
    const url = cases[0][0];

    // trimmed, because a certificate pasted into a dashboard arrives with stray newlines
    expect(sslFor(url, { DATABASE_SSL_CA: CA })).toEqual({ rejectUnauthorized: true, ca: CA.trim() });
    expect(sslFor(url, { DATABASE_SSL_CA: `\n  ${CA}  \n` })).toEqual({ rejectUnauthorized: true, ca: CA.trim() });
    // whitespace-only is not a certificate
    expect(sslFor(url, { DATABASE_SSL_CA: "   " })).toEqual({ rejectUnauthorized: true });
    // an explicit "do not verify" is never quietly upgraded by a stale CA
    expect(sslFor(url, { DATABASE_SSL_CA: CA, DATABASE_SSL_NO_VERIFY: "1" }))
      .toEqual({ rejectUnauthorized: false });
    // and neither variable turns TLS on where the rules above turned it off
    expect(sslFor("postgres://u:p@localhost/shop", { DATABASE_SSL_CA: CA })).toBeUndefined();
  });

  it("a local server and an explicit sslmode=disable stay plaintext", async () => {
    const { sslFor } = await import("@/lib/db");
    for (const url of ["postgres://u:p@localhost:5432/shop", "postgres://u:p@127.0.0.1/shop", "postgres://u:p@[::1]/shop"]) {
      expect(sslFor(url, {}), url).toBeUndefined();
    }
    expect(sslFor("postgres://u:p@db.example.com/shop?sslmode=disable", {})).toBeUndefined();
  });

  it("tools/migrate.mjs answers exactly the same — the build must not use a looser rule than the app", async () => {
    const { sslFor } = await import("@/lib/db");
    const { sslFor: migratorSslFor } = await import("../tools/migrate.mjs");
    const envs: Array<Record<string, string | undefined>> = [
      {}, { DATABASE_SSL_NO_VERIFY: "1" }, { DATABASE_SSL_NO_VERIFY: "0" },
      { DATABASE_SSL_CA: "-----BEGIN CERTIFICATE-----x" },
      { DATABASE_SSL_CA: "-----BEGIN CERTIFICATE-----x", DATABASE_SSL_NO_VERIFY: "1" },
    ];
    for (const [url] of [...cases, ["postgres://u:p@localhost/shop", ""] as [string, string]]) {
      for (const env of envs) {
        expect(migratorSslFor(url, env), url).toEqual(sslFor(url, env));
      }
    }
  });
});
