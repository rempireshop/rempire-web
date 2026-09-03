/** Shared test rig: a fresh in-memory Postgres with the migrations applied. */
import { migrate } from "../tools/migrate.mjs";
import { closeDb, exec, query } from "@/lib/db";

/** Applies db/migrations/*.sql to the PGlite instance src/lib/db.ts owns. */
export async function setupDb(): Promise<string[]> {
  process.env.DB_DRIVER = "pglite";
  return migrate({
    query: async (sql: string, params?: unknown[]) => ({ rows: await query(sql, params) }),
    exec,
  });
}

export async function teardownDb(): Promise<void> {
  await closeDb();
}

/** Wipes the data without re-running the migrations. */
export async function truncateAll(): Promise<void> {
  // `cascade`: order_messages (111_order_messages.sql) has a foreign key onto
  // orders, so a plain truncate of orders alone is refused by Postgres — this
  // wipes it (and anything else with a fk onto one of these) along the way.
  await exec(
    "truncate orders, product_overrides, settings, admin_audit, stock_levels, stock_moves restart identity cascade",
  );
}

export const TEST_SECRET = "test-session-secret-at-least-16-chars";
