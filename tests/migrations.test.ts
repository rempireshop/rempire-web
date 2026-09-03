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
