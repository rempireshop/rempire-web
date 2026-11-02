/**
 * Rewrite the stored article bodies that hold a shop link pasted from
 * another host.
 *
 * On 02.11.2026 the Russian Kevin.Murphy shampoo guide held eight links to
 * https://www.claudeusercontent.com/ru/products/… (the host of a Claude
 * artifact preview) and the Estonian System 4 guide one to the staging
 * host, each opening a new tab onto a dead page. From that commit on a save
 * stores the shop path (upsertPost runs localizeShopLinks()), and the page
 * already renders these rows right (renderPostBody runs it too). This
 * rewrites the rows themselves, so the editor, and anything else that reads
 * the stored body, sees the shop path as well.
 *
 * It runs exactly the function a save runs, so what it writes is what the
 * next save of the article would have written. Only `body` changes — not
 * the status, not updated_at. Before writing it saves every body it is about
 * to change to a JSON file, and each row is written only if it still holds
 * the body that was read: an article edited in the panel meanwhile stops the
 * whole run, rolled back.
 *
 *   DATABASE_URL=… node tools/repair-blog-links.mjs          # list what it WOULD change
 *   DATABASE_URL=… node tools/repair-blog-links.mjs --yes    # change it
 *
 * PowerShell does not accept `VAR=value cmd`. There:
 *   $env:DATABASE_URL = "…"; node tools/repair-blog-links.mjs
 *
 * TLS is decided the way the shop decides it (sslFor in src/lib/db.ts):
 * DATABASE_SSL_CA to verify against the provider's CA, DATABASE_SSL_NO_VERIFY=1
 * to encrypt without verifying.
 */
import { writeFileSync } from "node:fs";
import { Client } from "pg";
import { localizeShopLinks } from "../src/lib/blog-html.mjs";

const LANGS = ["RU", "ET", "EN"];
const A_OPEN = /<a\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi;

/**
 * What the repair would do to these rows: every row whose body changes, its
 * new body, and each changed <a> as a before/after pair. Pure, for the test.
 */
export function planRepair(rows) {
  const plan = [];
  for (const row of rows) {
    const body = row.body && typeof row.body === "object" ? row.body : {};
    const next = { ...body };
    const links = [];
    for (const l of LANGS) {
      if (typeof body[l] !== "string" || !body[l]) continue;
      const fixed = localizeShopLinks(body[l]);
      if (fixed === body[l]) continue;
      next[l] = fixed;
      const was = body[l].match(A_OPEN) || [];
      const now = fixed.match(A_OPEN) || [];
      was.forEach((tag, i) => { if (tag !== now[i]) links.push({ lang: l, before: tag, after: now[i] }); });
    }
    if (links.length) plan.push({ id: row.id, slug: row.slug, status: row.status, body, next, links });
  }
  return plan;
}

function sslFor(url) {
  if (/localhost|127\.0\.0\.1|\[::1\]/.test(url) || /[?&]sslmode=disable/.test(url)) return undefined;
  if (process.env.DATABASE_SSL_NO_VERIFY === "1") return { rejectUnauthorized: false };
  const ca = (process.env.DATABASE_SSL_CA || "").trim();
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const apply = process.argv.includes("--yes");
  const db = new Client({ connectionString: url, ssl: sslFor(url) });
  await db.connect();

  /* Say which database this is before touching it. */
  const who = await db.query("select current_database() as db, inet_server_addr()::text as host");
  console.log(`database: ${who.rows[0].db} on ${who.rows[0].host || "(local socket)"}\n`);

  const { rows } = await db.query("select id, slug, status, body from posts where deleted_at is null order by slug");
  const plan = planRepair(rows);
  for (const p of plan) {
    console.log(`${p.slug} (${p.status}) — ${p.links.length} link${p.links.length === 1 ? "" : "s"}`);
    for (const k of p.links) console.log(`  ${k.lang}  ${k.before}\n   →  ${k.after}`);
    console.log("");
  }
  if (!plan.length) {
    console.log(`Nothing to repair in ${rows.length} articles.`);
    await db.end();
    return;
  }
  const total = plan.reduce((n, p) => n + p.links.length, 0);
  console.log(`${total} links in ${plan.length} of ${rows.length} articles.`);
  if (!apply) {
    console.log("Nothing was changed. Run it again with --yes to apply.");
    await db.end();
    return;
  }

  const backup = `blog-links-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(backup, JSON.stringify(plan.map((p) => ({ id: p.id, slug: p.slug, body: p.body })), null, 2));
  console.log(`bodies as they were: ${backup}`);

  /* One transaction: either every article is repaired or none is. */
  await db.query("begin");
  try {
    for (const p of plan) {
      const r = await db.query(
        "update posts set body = $1::jsonb where id = $2 and deleted_at is null and body = $3::jsonb",
        [JSON.stringify(p.next), p.id, JSON.stringify(p.body)],
      );
      if (r.rowCount !== 1) throw new Error(`«${p.slug}» changed while this ran — nothing was written; run it again.`);
    }
    await db.query("commit");
    console.log("Done.");
  } catch (err) {
    await db.query("rollback");
    console.error("Rolled back — nothing was changed.");
    console.error(err);
    process.exitCode = 1;
  }
  await db.end();
}

if (String(process.argv[1] || "").replace(/\\/g, "/").endsWith("/repair-blog-links.mjs")) await main();
