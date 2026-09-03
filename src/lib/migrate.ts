/**
 * Apply pending migrations from the embedded list (src/db/migrations.generated.ts,
 * packed at build time). Same rules as tools/migrate.mjs, which is the CLI
 * twin for local use: each file runs as one batch, and is recorded in
 * `_migrations` by file name.
 */
import { exec, query } from "@/lib/db";
import { MIGRATIONS } from "@/db/migrations.generated";

export async function migratePending(): Promise<{ applied: string[]; pending: string[] }> {
  await exec(
    `create table if not exists _migrations (
       name       text primary key,
       applied_at timestamptz not null default now()
     );`,
  );
  const done = new Set((await query<{ name: string }>("select name from _migrations")).map((r) => r.name));
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.name)) continue;
    await exec(m.sql);
    await query("insert into _migrations (name) values ($1)", [m.name]);
    applied.push(m.name);
  }
  return { applied, pending: [] };
}

export async function migrationStatus(): Promise<{ applied: string[]; pending: string[] }> {
  await exec(`create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now());`);
  const done = new Set((await query<{ name: string }>("select name from _migrations")).map((r) => r.name));
  const names = MIGRATIONS.map((m) => m.name);
  return { applied: names.filter((n) => done.has(n)), pending: names.filter((n) => !done.has(n)) };
}
