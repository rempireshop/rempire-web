/** Shared test rig: a fresh in-memory Postgres with the migrations applied. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrate, MIGRATIONS_DIR } from "../tools/migrate.mjs";
import { closeDb, exec, query } from "@/lib/db";

/* ---------- the migrated template -----------------------------------------
   30.10.2026: 174 test files each built a new PGlite and ran every migration
   (222 files) — over a second apiece locally, more on GitHub, the largest
   single cost of the suite. Now the first setupDb() of a run migrates a
   database once, dumps it to a file in the OS temp folder, and every later
   fresh database starts from that dump (src/lib/db.ts reads the seed).

   The file's name is a hash of the migrations, the runner and PGlite's
   version, so a changed or added migration can never be served stale; it is
   also rebuilt when older than SNAPSHOT_MAX_AGE_MS, so rows a migration
   stamps with now() are as fresh as they were before. setupDb() still
   returns every migration the database got, seeded or applied, so
   «expect(applied).toContain("070_blog.sql")» holds either way.
   TEST_DB_SNAPSHOT=0 switches it off. */
const SNAPSHOT_MAX_AGE_MS = 30 * 60_000;
const g = globalThis as unknown as { __rempireDb?: unknown; __rempirePgliteSeed?: Blob };

type Snapshot = { file: string; list: string };

function snapshotPaths(): Snapshot {
  const h = createHash("sha256");
  for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith(".sql")).sort()) {
    h.update(f).update("\0").update(fs.readFileSync(path.join(MIGRATIONS_DIR, f))).update("\0");
  }
  h.update(fs.readFileSync(path.join(MIGRATIONS_DIR, "..", "..", "tools", "migrate.mjs")));
  try {
    h.update(fs.readFileSync(path.join(MIGRATIONS_DIR, "..", "..", "node_modules", "@electric-sql", "pglite", "package.json")));
  } catch {
    /* no version to mix in — the migrations alone still key it */
  }
  const base = path.join(os.tmpdir(), `rempire-test-db-${h.digest("hex").slice(0, 16)}`);
  return { file: base + ".tar.gz", list: base + ".json" };
}

function readSnapshot(s: Snapshot): { blob: Blob; applied: string[] } | null {
  try {
    if (Date.now() - fs.statSync(s.file).mtimeMs > SNAPSHOT_MAX_AGE_MS) return null;
    const applied = JSON.parse(fs.readFileSync(s.list, "utf8")) as string[];
    return { blob: new Blob([fs.readFileSync(s.file)]), applied };
  } catch {
    return null;
  }
}

/** Migrates a throwaway PGlite and writes its dump; parallel writers are safe (rename). */
async function writeSnapshot(s: Snapshot): Promise<void> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    const applied = await migrate({ query: (sql: string, params?: unknown[]) => db.query(sql, params), exec: (sql: string) => db.exec(sql) });
    const dump = await db.dumpDataDir("gzip");
    const tmp = `${s.file}.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmp, Buffer.from(await dump.arrayBuffer()));
    fs.writeFileSync(`${tmp}.json`, JSON.stringify(applied));
    fs.renameSync(`${tmp}.json`, s.list);
    fs.renameSync(tmp, s.file);
  } finally {
    await db.close();
  }
}

/** Applies db/migrations/*.sql to the PGlite instance src/lib/db.ts owns. */
export async function setupDb(): Promise<string[]> {
  process.env.DB_DRIVER = "pglite";
  let seeded: string[] = [];
  // only a database about to be created can start from the template
  if (!g.__rempireDb && !process.env.PGLITE_PATH && process.env.TEST_DB_SNAPSHOT !== "0") {
    const s = snapshotPaths();
    let snap = readSnapshot(s);
    if (!snap) {
      await writeSnapshot(s);
      snap = readSnapshot(s);
    }
    if (snap) {
      g.__rempirePgliteSeed = snap.blob;
      seeded = snap.applied;
    }
  }
  try {
    const applied = await migrate({
      query: async (sql: string, params?: unknown[]) => ({ rows: await query(sql, params) }),
      exec,
    });
    return [...seeded, ...applied];
  } finally {
    delete g.__rempirePgliteSeed;
  }
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
