/**
 * Move every photo address already in the database off the old R2 host.
 *
 * On 21.09.2026 the bucket gained a custom domain. Cloudflare's own console
 * says of the address it replaces: «This URL is rate-limited and not
 * recommended for production. Cloudflare features like Access and Caching are
 * unavailable.» Changing `R2_PUBLIC_BASE` fixes the NEXT upload; the hundreds
 * of photos the owner has already uploaded carry the old address inside the
 * rows that reference them, and go on being fetched from the rate-limited
 * host for ever unless something rewrites them.
 *
 * The object keys do not change, so nothing is re-uploaded and nothing can be
 * lost: this only edits text. Both addresses serve the same bytes while the
 * old one is enabled, so there is no moment where a page is broken — and
 * `rehost()` in src/lib/storage.ts covers whatever this misses.
 *
 * It finds the columns itself rather than naming them. A photo URL can sit in
 * a jsonb gallery, in an article's HTML, in a letter's body or in the settings
 * blob, and a list typed here would be a list that goes stale the first time
 * somebody adds a column.
 *
 *   DATABASE_URL=… node tools/rehost-r2.mjs            # what it WOULD change
 *   DATABASE_URL=… node tools/rehost-r2.mjs --yes      # change it
 *
 * PowerShell does not accept `VAR=value cmd`. There:
 *   $env:DATABASE_URL = "…"; node tools/rehost-r2.mjs
 */
import { Client } from "pg";

const FROM = (process.env.R2_PUBLIC_BASE_OLD || "https://pub-cb5b2acfd95a42a89fe5b418936afeea.r2.dev")
  .trim().replace(/\/+$/, "");
const TO = (process.env.R2_PUBLIC_BASE || "https://img.rempireshop.com").trim().replace(/\/+$/, "");
const APPLY = process.argv.includes("--yes");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}
if (FROM === TO) {
  console.error(`Both addresses are ${TO} — nothing to do.`);
  process.exit(1);
}

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

/* Say which database this is before touching it — the connection string is
   easy to get wrong and this edits every row it matches. */
const who = await db.query("select current_database() as db, inet_server_addr()::text as host");
console.log(`database: ${who.rows[0].db} on ${who.rows[0].host || "(local socket)"}`);
console.log(`   from: ${FROM}\n     to: ${TO}\n`);

/* Text-ish columns only. jsonb is cast to text, rewritten and cast back —
   the old address contains no character JSON would have to escape, so the
   round trip is exact. */
const cols = await db.query(
  `select table_name, column_name, data_type
     from information_schema.columns
    where table_schema = 'public'
      and data_type in ('text', 'character varying', 'jsonb', 'json')
    order by table_name, column_name`,
);

let rowsTotal = 0;
const hits = [];
for (const { table_name: t, column_name: c, data_type: d } of cols.rows) {
  const asText = d === "jsonb" || d === "json" ? `"${c}"::text` : `"${c}"`;
  let n = 0;
  try {
    const r = await db.query(
      `select count(*)::int as n from "${t}" where ${asText} like $1`,
      [`%${FROM}%`],
    );
    n = r.rows[0].n;
  } catch (err) {
    console.log(`  ?  ${t}.${c} — could not be read (${String(err.message).split("\n")[0]})`);
    continue;
  }
  if (!n) continue;
  hits.push({ t, c, d, n });
  rowsTotal += n;
  console.log(`  ${String(n).padStart(5)} rows  ${t}.${c} (${d})`);
}

if (!hits.length) {
  console.log("Nothing carries the old address. Either it has already run, or the base is wrong.");
  await db.end();
  process.exit(0);
}

console.log(`\n${rowsTotal} rows across ${hits.length} columns.`);
if (!APPLY) {
  console.log("Nothing was changed. Run it again with --yes to apply.");
  await db.end();
  process.exit(0);
}

/* One transaction: a half-rewritten gallery is worse than an unrewritten one. */
await db.query("begin");
try {
  for (const { t, c, d, n } of hits) {
    const expr = d === "jsonb" || d === "json"
      ? `replace("${c}"::text, $1, $2)::${d}`
      : `replace("${c}", $1, $2)`;
    const asText = d === "jsonb" || d === "json" ? `"${c}"::text` : `"${c}"`;
    const r = await db.query(
      `update "${t}" set "${c}" = ${expr} where ${asText} like $3`,
      [FROM, TO, `%${FROM}%`],
    );
    console.log(`  ${String(r.rowCount).padStart(5)} rows  ${t}.${c}${r.rowCount === n ? "" : `  (expected ${n})`}`);
  }
  await db.query("commit");
  console.log("\nDone. The old address still serves the same bytes, so nothing is broken either way.");
} catch (err) {
  await db.query("rollback");
  console.error("\nRolled back — nothing was changed.");
  console.error(err);
  process.exitCode = 1;
}
await db.end();
