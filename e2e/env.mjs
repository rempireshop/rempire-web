/**
 * Single source of truth for the Playwright webServer's address and the
 * fixed test credentials — imported by playwright.config.ts, tools/e2e-build.mjs
 * and spec files that need to log in as the test admin, so the port and the
 * password live in exactly one place.
 *
 * Plain .mjs (not .ts) on purpose: tools/e2e-build.mjs runs as a standalone
 * `node` script with no TypeScript loader, and importing a .mjs file works
 * unchanged from playwright.config.ts and from *.spec.ts too.
 */
import { scryptSync } from "node:crypto";

/* 3417 is not a port anything else in this repo defaults to (dev/start use
   3300) — picked so the e2e server can run alongside a `next dev` someone
   else already has open, per docs/testing.md. */
export const E2E_PORT = Number(process.env.E2E_PORT || 3417);
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/* A fixed, well-known password — not a secret. It only ever guards the
   throwaway in-memory PGlite database this suite starts from empty on every
   run (DB_DRIVER=pglite, no PGLITE_PATH — see docs/testing.md), so there is
   nothing behind it worth protecting beyond the current test process. */
export const E2E_ADMIN_PASSWORD = "e2e-suite-admin-password";
export const E2E_SESSION_SECRET = "e2e-suite-session-secret-32-chars-long";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 };

/**
 * `scrypt$N$r$p$salt$key` — mirrors hashPassword() in src/lib/auth.ts /
 * tools/hash-password.mjs exactly (same params), so ADMIN_PASSWORD_HASH built
 * here verifies against the real route.
 *
 * Fixed salt, not `randomBytes`: playwright.config.ts is re-evaluated in
 * every worker process, and only the one call the root process makes to
 * build `webServer.env` actually reaches the running server — but a fixed
 * salt means every evaluation, anywhere, produces the same byte-identical
 * hash, so there is never a question of which one the server is holding.
 * Security is unaffected: see the comment on E2E_ADMIN_PASSWORD above.
 */
export function adminPasswordHash(password = E2E_ADMIN_PASSWORD) {
  const salt = Buffer.alloc(16, "rempire-e2e-salt");
  const key = scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$");
}
