#!/usr/bin/env node
/**
 * Manual helper: migrate the in-memory database of an ALREADY RUNNING dev
 * server (`npm run dev`, DB_DRIVER=pglite). The Playwright suite itself does
 * NOT need this — it uses `GET /api/e2e/bootstrap/` as its webServer
 * readiness URL, which migrates automatically on every poll
 * (playwright.config.ts, src/app/api/e2e/bootstrap/route.ts, docs/testing.md).
 *
 * Why this script exists at all: `DB_DRIVER=pglite npm run migrate`
 * (tools/migrate.mjs) migrates a throwaway PGlite instance living in *that*
 * short-lived process, then exits — a separate process from your dev server,
 * so the dev server's own in-memory database never sees those migrations
 * (src/lib/db.ts caches one PGlite instance per process on `globalThis`; two
 * processes never share it). This script instead logs into the *running*
 * server as the admin and asks it to migrate itself over HTTP, via the real
 * admin endpoint (`POST /api/admin/migrate`, docs/backend.md) — the same
 * request the admin screen's own "Migrate" fallback makes.
 *
 * Usage:
 *   node tools/e2e-bootstrap.mjs                        # http://localhost:3300, $ADMIN_PASSWORD
 *   node tools/e2e-bootstrap.mjs http://localhost:3300 'the password'
 *   ADMIN_PASSWORD='the password' node tools/e2e-bootstrap.mjs
 *
 * The target server must already be running with DB_DRIVER=pglite, and its
 * SESSION_SECRET / ADMIN_PASSWORD_HASH must match the password given here —
 * see docs/backend.md "Setting it up" for a `DB_DRIVER=pglite npm run dev`
 * one-liner, and `node tools/hash-password.mjs` for making the hash.
 */
const baseUrl = (process.argv[2] || process.env.E2E_BOOTSTRAP_URL || "http://localhost:3300").replace(/\/+$/, "");
const password = process.argv[3] || process.env.ADMIN_PASSWORD;

if (!password) {
  console.error(
    "Usage: node tools/e2e-bootstrap.mjs [baseUrl] [password]\n" +
      "  (or set ADMIN_PASSWORD in the environment)\n\n" +
      "Migrates the in-memory PGlite database of an already-running\n" +
      "`npm run dev` / `next start` server — see the comment at the top of\n" +
      "this file for why a plain `npm run migrate` does not reach it.",
  );
  process.exit(1);
}

async function main() {
  const login = await fetch(`${baseUrl}/api/admin/login/`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!login.ok) {
    const body = await login.text();
    throw new Error(`admin login failed (${login.status}): ${body.slice(0, 300)}`);
  }
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  if (!cookie) throw new Error("admin login did not set a session cookie");

  const res = await fetch(`${baseUrl}/api/admin/migrate/`, { method: "POST", headers: { cookie } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(`migrate failed (${res.status}): ${JSON.stringify(body)}`);
  }

  console.log(
    body.applied?.length
      ? `Applied ${body.applied.length} migration(s): ${body.applied.join(", ")}`
      : "Already up to date — nothing to apply.",
  );
}

main().catch((err) => {
  console.error("[e2e-bootstrap]", err instanceof Error ? err.message : err);
  process.exit(1);
});
