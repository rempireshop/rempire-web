#!/usr/bin/env node
/**
 * Migration runner. Plain SQL files in db/migrations/NNN_name.sql, applied in
 * filename order, each one recorded in _migrations so it never runs twice.
 *
 *   npm run migrate                 # against DATABASE_URL (Postgres)
 *   DB_DRIVER=pglite npm run migrate  # against an in-memory PGlite (smoke test)
 *
 * Tests import { migrate } and hand it their own PGlite instance.
 *
 * Whole files are executed as one statement batch, so dollar-quoted blocks
 * ($$ … $$) and semicolons inside strings are safe — no naive splitting.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = path.join(HERE, "..", "db", "migrations");

/** db.query(sql, params) → { rows }; db.exec(sql) when the driver has it. */
async function rows(db, sql, params) {
  const res = await db.query(sql, params);
  return (res && res.rows) || [];
}

async function runBatch(db, sql) {
  if (typeof db.exec === "function") return db.exec(sql); // PGlite
  return db.query(sql); // node-postgres: simple query protocol, multi-statement
}

/**
 * Apply every pending migration. Returns the list of files it applied.
 * @param {{query: Function, exec?: Function}} db
 * @param {{dir?: string, log?: (msg: string) => void}} [opts]
 */
export async function migrate(db, opts = {}) {
  const dir = opts.dir || MIGRATIONS_DIR;
  const log = opts.log || (() => {});

  await runBatch(
    db,
    `create table if not exists _migrations (
       name       text primary key,
       applied_at timestamptz not null default now()
     );`,
  );

  const done = new Set((await rows(db, "select name from _migrations")).map((r) => r.name));
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    log(`→ ${file}`);
    await runBatch(db, sql);
    await db.query("insert into _migrations (name) values ($1)", [file]);
    applied.push(file);
  }
  return applied;
}

/**
 * TLS everywhere except a local server, and the certificate is verified —
 * against DATABASE_SSL_CA when the provider signs its own, otherwise against
 * Node's trust store. DATABASE_SSL_NO_VERIFY=1 is the last resort: encrypted
 * but unauthenticated, set knowingly or not at all.
 *
 * Same rule, same words as src/lib/db.ts — keep the two in step;
 * tests/migrations.test.ts fails if they drift. The host substring that used
 * to switch verification off by itself was removed on 07.09.2026;
 * docs/audit/2026-09-07-cleanup.md says why, and docs/backend.md says what to
 * do if a deploy's postbuild migrate cannot verify the certificate.
 *
 * @param {string} url
 * @param {Record<string, string | undefined>} [env]
 */
export function sslFor(url, env = process.env) {
  if (/localhost|127\.0\.0\.1|\[::1\]/.test(url)) return undefined;
  if (/[?&]sslmode=disable/.test(url)) return undefined;
  const ca = (env.DATABASE_SSL_CA ?? "").trim();
  if (env.DATABASE_SSL_NO_VERIFY === "1") return { rejectUnauthorized: false };
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}

async function main() {
  const driver = process.env.DB_DRIVER || "pg";
  const log = (m) => console.log(m);

  if (driver === "pglite") {
    const { PGlite } = await import("@electric-sql/pglite");
    const db = new PGlite(process.env.PGLITE_PATH || undefined);
    const applied = await migrate(db, { log });
    console.log(applied.length ? `Applied ${applied.length} migration(s) to PGlite.` : "PGlite already up to date.");
    await db.close();
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    // `--if-configured` is what the postbuild hook uses: a build without a
    // database (staging, previews, local) must not fail because of it.
    if (process.argv.includes("--if-configured")) {
      console.log("migrate: DATABASE_URL not set, nothing to do.");
      return;
    }
    console.error("DATABASE_URL is not set. Put it in .env.local (see docs/backend.md) or run with DB_DRIVER=pglite.");
    process.exit(1);
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });
  await client.connect();
  try {
    const applied = await migrate(client, { log });
    console.log(applied.length ? `Applied ${applied.length} migration(s).` : "Database already up to date.");
  } finally {
    await client.end();
  }
}

// Run only when invoked directly (`node tools/migrate.mjs`), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    if (process.argv.includes("--if-configured")) {
      // postbuild: a database that is unreachable at build time must not take
      // the whole deploy down — the app degrades to demo mode and the admin
      // can run POST /api/admin/migrate once the database is reachable.
      console.error("migrate: failed, continuing the build (run migrations later via /api/admin/migrate).");
      process.exit(0);
    }
    process.exit(1);
  });
}
