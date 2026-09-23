/**
 * A full copy of the shop's Postgres, as a file on this computer.
 *
 * Railway only makes backups on the Pro plan (the Backups tab says so,
 * 23.09.2026), and the go-live clean-up (tools/go-live-reset.mjs) cannot be
 * undone — so this is the undo: `pg_dump`, run in Docker, so nothing needs
 * installing but Docker Desktop.
 *
 *   1. Railway → Postgres → Variables → copy DATABASE_PUBLIC_URL into
 *      .env.railway.txt in this folder as  DATABASE_URL=postgresql://…
 *      (`.env*` is gitignored; never paste the URL into a chat — it holds the
 *      password).
 *   2. node --env-file=.env.railway.txt tools/db-backup.mjs
 *   3. Keep the printed file; delete .env.railway.txt.
 *
 * The file lands OUTSIDE the repository (%USERPROFILE%\rempire-backups by
 * default, `--out <dir>` to change it): it holds customers' names, e-mails and
 * addresses and must never reach git. It is pg_dump's custom format — one file,
 * compressed, restorable table by table. The client is the server's own major
 * version (read first with `show server_version_num`), so the dump restores
 * into the same Postgres without version noise.
 *
 * Restore (only ever deliberately — it overwrites what it restores):
 *   docker run --rm -i -e PGURL postgres:<major>-alpine \
 *     sh -c 'pg_restore --clean --if-exists --no-owner --no-privileges -d "$PGURL"' < file.dump
 * with PGURL set to the database URL in the shell. docs/go-live-reset.md § 1.
 */
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Docker with the URL in the environment, never on a command line a process list shows. */
function docker(args, { url, input, output } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      env: { ...process.env, PGURL: url ?? "" },
      stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    if (output) child.stdout.pipe(output);
    else child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    if (input) {
      child.stdin.end(input);
    }
    child.on("error", reject);
    /* with a file behind stdout, «done» is when the file is flushed, not when
       docker exits — reading it back a moment early would count half a dump */
    const flushed = output ? new Promise((r) => output.on("finish", r)) : Promise.resolve();
    child.on("close", (code) => flushed.then(() => resolve({ code, out, err })));
  });
}

/** 170004 → 17. */
export function majorOf(versionNum) {
  const n = Number(String(versionNum).trim());
  return Number.isFinite(n) && n >= 100000 ? Math.floor(n / 10000) : null;
}

/** `pg_restore --list` → how many tables carry data. */
export function tablesWithData(list) {
  return String(list)
    .split(/\r?\n/)
    .filter((l) => / TABLE DATA /.test(l)).length;
}

/**
 * Railway shows two URLs for one database. DATABASE_URL names
 * `postgres.railway.internal`, which resolves only inside Railway's own
 * network — the first try on 23.09.2026 got exactly that. From this computer
 * only DATABASE_PUBLIC_URL (a `*.proxy.rlwy.net` host and port) answers.
 */
export function internalHost(url) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    return "DATABASE_URL is not a URL — copy the whole value, starting with postgresql://";
  }
  return /\.railway\.internal$/i.test(host)
    ? "This is Railway's INTERNAL address (postgres.railway.internal) — it only works inside Railway.\n" +
        "Copy DATABASE_PUBLIC_URL instead (Railway → Postgres → Variables) and put it after DATABASE_URL= in .env.railway.txt."
    : null;
}

export function backupName(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `rempire-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}_${p(now.getHours())}${p(now.getMinutes())}.dump`;
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.error("No DATABASE_URL. Put it in .env.railway.txt and run:\n  node --env-file=.env.railway.txt tools/db-backup.mjs");
    process.exit(2);
  }
  const why = internalHost(url);
  if (why) {
    console.error(why);
    process.exit(2);
  }
  const outArg = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : null;
  const dir = path.resolve(outArg || path.join(os.homedir(), "rempire-backups"));
  const repo = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]+$/, "");
  if (dir.toLowerCase().startsWith(repo.toLowerCase())) {
    console.error(`Refused: ${dir} is inside the repository — a dump holds customer data.`);
    process.exit(2);
  }
  mkdirSync(dir, { recursive: true });

  const probe = await docker(
    ["run", "--rm", "-e", "PGURL", "postgres:18-alpine", "sh", "-c", 'psql "$PGURL" -Atc "show server_version_num"'],
    { url },
  );
  const major = majorOf(probe.out);
  if (probe.code !== 0 || !major) {
    console.error("Could not reach the database:", probe.err.split(url).join("<url>").trim().slice(0, 400));
    process.exit(1);
  }
  const image = `postgres:${major}-alpine`;
  const file = path.join(dir, backupName());
  console.log(`Postgres ${major} — dumping with ${image} into ${file} …`);

  const dump = await docker(
    ["run", "--rm", "-e", "PGURL", image, "sh", "-c", 'pg_dump --format=custom --no-owner --no-privileges "$PGURL"'],
    { url, output: createWriteStream(file) },
  );
  if (dump.code !== 0) {
    console.error("pg_dump failed:", dump.err.split(url).join("<url>").trim().slice(0, 400));
    process.exit(1);
  }

  const list = await docker(["run", "--rm", "-i", image, "pg_restore", "--list"], { input: readFileSync(file) });
  const tables = tablesWithData(list.out);
  const mb = (statSync(file).size / 1024 / 1024).toFixed(2);
  if (list.code !== 0 || tables === 0) {
    console.error(`✗ The file does not read back (${list.err.trim().slice(0, 200)}). Do not rely on it.`);
    process.exit(1);
  }
  console.log(`✓ ${file}\n  ${mb} MB, ${tables} tables with data, read back by pg_restore.`);
  console.log("Keep this file. Delete .env.railway.txt now — it holds the database password.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
