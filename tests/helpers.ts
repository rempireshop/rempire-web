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
  await exec("truncate orders, product_overrides, settings, admin_audit restart identity");
}

export const TEST_SECRET = "test-session-secret-at-least-16-chars";
