/**
 * The one database door. Everything server-side goes through query() and
 * withTx() — no ORM, plain SQL with $1 placeholders.
 *
 *   const rows = await query<{ id: string }>("select id from orders where email = $1", [email]);
 *   await withTx(async (q) => { await q("update …"); await q("insert …"); });
 *
 * Two drivers:
 *   - Postgres (default) via `pg`, one Pool cached on globalThis so a warm
 *     serverless instance reuses its connections instead of opening new ones
 *     on every request;
 *   - PGlite (in-memory Postgres) when DB_DRIVER=pglite — the test suite and
 *     a quick local run without a server.
 *
 * jsonb: pass JSON.stringify(value) and cast in SQL ($1::jsonb). node-postgres
 * turns a JS array into a Postgres array literal, which is not what jsonb
 * wants, so never hand it a bare array.
 *
 * numeric: both drivers hand numerics back as strings (no silent precision
 * loss). Callers that want numbers convert — src/lib/orders.ts does.
 */
import type { Pool, PoolClient } from "pg";

export type Row = Record<string, unknown>;
export type Querier = <T = Row>(sql: string, params?: unknown[]) => Promise<T[]>;

type RawResult = { rows: unknown[] };
type Raw = {
  kind: "pg" | "pglite";
  query: (sql: string, params?: unknown[]) => Promise<RawResult>;
  batch: (sql: string) => Promise<void>;
  tx: <T>(fn: (q: Querier) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};

const MISSING_URL =
  "DATABASE_URL is not set. Add it to .env.local (or the Vercel project env) — " +
  "see docs/backend.md. For a database-free run use DB_DRIVER=pglite.";

/* A module-level variable is not enough: in dev, Next re-evaluates modules on
   every edit, and in serverless each module instance would open its own pool.
   globalThis survives both. */
const g = globalThis as unknown as { __rempireDb?: Promise<Raw> };

/** TLS on unless the server is local; verified unless told otherwise. */
function sslFor(url: string) {
  if (/localhost|127\.0\.0\.1|\[::1\]/.test(url)) return undefined;
  if (/[?&]sslmode=disable/.test(url)) return undefined;
  // Railway's Postgres (TCP proxy *.rlwy.net / *.railway.app) presents a
  // self-signed certificate, so verification is off for those hosts only;
  // every other provider is verified unless DATABASE_SSL_NO_VERIFY=1.
  const selfSigned = /@[^/?#]*\.(rlwy\.net|railway\.app)(:\d+)?(\/|$)/i.test(url);
  return { rejectUnauthorized: !selfSigned && process.env.DATABASE_SSL_NO_VERIFY !== "1" };
}

async function makePg(): Promise<Raw> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error(MISSING_URL);

  const pg = (await import("pg")).default;
  const pool: Pool = new pg.Pool({
    connectionString: url,
    ssl: sslFor(url),
    // Serverless: a handful of sockets per instance, dropped when idle.
    max: Number(process.env.DATABASE_POOL_MAX || 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", (err) => console.error("[db] idle client error:", err.message));

  return {
    kind: "pg",
    query: (sql, params) => pool.query(sql, params as unknown[]),
    batch: async (sql) => {
      await pool.query(sql); // simple query protocol: several statements at once
    },
    async tx<T>(fn: (q: Querier) => Promise<T>): Promise<T> {
      const client: PoolClient = await pool.connect();
      try {
        await client.query("begin");
        const q: Querier = async <T2>(sql: string, params?: unknown[]) =>
          (await client.query(sql, params as unknown[])).rows as T2[];
        const out = await fn(q);
        await client.query("commit");
        return out;
      } catch (err) {
        try {
          await client.query("rollback");
        } catch {
          /* the connection is already gone; the transaction died with it */
        }
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/* PGlite is a devDependency and must never end up in the production bundle, so
   the specifier is assembled at run time — the bundler sees an expression, not
   a module to pull in. This path only runs when DB_DRIVER=pglite, i.e. in tests
   and in a local run without a Postgres server. */
async function makePglite(): Promise<Raw> {
  const spec = ["@electric-sql", "pglite"].join("/");
  const mod = (await import(/* webpackIgnore: true */ spec)) as {
    PGlite: new (dataDir?: string) => PgliteDb;
  };
  const db = new mod.PGlite(process.env.PGLITE_PATH || undefined);
  return {
    kind: "pglite",
    query: (sql, params) => db.query(sql, params as unknown[]),
    batch: async (sql) => {
      await db.exec(sql);
    },
    async tx<T>(fn: (q: Querier) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        const q: Querier = async <T2>(sql: string, params?: unknown[]) =>
          (await tx.query(sql, params as unknown[])).rows as T2[];
        return fn(q);
      });
    },
    close: () => db.close(),
  };
}

type PgliteTx = { query: (sql: string, params?: unknown[]) => Promise<RawResult> };
type PgliteDb = {
  query: (sql: string, params?: unknown[]) => Promise<RawResult>;
  exec: (sql: string) => Promise<unknown>;
  transaction: <T>(fn: (tx: PgliteTx) => Promise<T>) => Promise<T>;
  close: () => Promise<void>;
};

function driver(): Promise<Raw> {
  if (!g.__rempireDb) {
    g.__rempireDb = (process.env.DB_DRIVER === "pglite" ? makePglite() : makePg()).catch((err) => {
      // A failed connection must not be cached, or every later request in this
      // instance would replay the same rejected promise.
      g.__rempireDb = undefined;
      throw err;
    });
  }
  return g.__rempireDb;
}

/** Run one statement. Returns the rows (empty array for writes). */
export async function query<T = Row>(sql: string, params?: unknown[]): Promise<T[]> {
  const db = await driver();
  const res = await db.query(sql, params);
  return (res.rows || []) as T[];
}

/**
 * Run a batch of statements (a whole .sql file, dollar-quoted blocks and all).
 * No parameters — never build one of these out of user input.
 */
export async function exec(sql: string): Promise<void> {
  const db = await driver();
  await db.batch(sql);
}

/** Run several statements as one transaction; throwing rolls the lot back. */
export async function withTx<T>(fn: (q: Querier) => Promise<T>): Promise<T> {
  const db = await driver();
  return db.tx(fn);
}

/** Which driver is live — handy in health checks and tests. */
export async function driverKind(): Promise<"pg" | "pglite"> {
  return (await driver()).kind;
}

/** Close the pool (tests, scripts). Next never calls this. */
export async function closeDb(): Promise<void> {
  const pending = g.__rempireDb;
  g.__rempireDb = undefined;
  if (pending) await (await pending).close();
}

/** True when a database is reachable — routes use it to degrade politely. */
export async function dbReady(): Promise<boolean> {
  try {
    await query("select 1");
    return true;
  } catch {
    return false;
  }
}
