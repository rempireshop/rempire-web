/**
 * Single source of truth for the Playwright webServer's address, the fixed
 * test credentials and — since 08.09.2026 — the addresses of the two *deployed*
 * shops the smoke suite is pointed at. Imported by playwright.config.ts,
 * playwright.smoke.config.ts, tools/e2e-build.mjs, tools/smoke.mjs and spec
 * files that need to log in as the test admin, so the port, the password and
 * the hosts live in exactly one place.
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

/* ------------------------------------------------------------------------ */
/* The deployed shops — for the smoke suite only                             */
/* ------------------------------------------------------------------------ */

/**
 * Everything above this line describes a throwaway server on localhost.
 * Everything below describes the two **real** deployments, and the smoke suite
 * (e2e/smoke.spec.ts, playwright.smoke.config.ts) is the only thing that reads
 * it. Nothing here is a secret — both are public addresses anybody can type
 * into a browser — which is deliberate and is what lets the GitHub workflow
 * run without a single repository secret.
 *
 * They live in this file rather than in the smoke config because that is what
 * this file is: a task asked for the port and the credentials to stay in one
 * place, and a hostname the tests make decisions about is the same kind of
 * fact. `SMOKE_PRODUCTION_URL` in particular is not decoration — the suite has
 * to know which host is the live shop to know which robots policy and which
 * `X-Robots-Tag` to demand (docs/seo.md, "The three noindex layers"), and
 * next.config.ts's own allowlist is written against exactly this host.
 */
export const SMOKE_STAGING_URL = "https://rempireshop.diipsolutions.eu";
export const SMOKE_PRODUCTION_URL = "https://rempireshop.com";

/**
 * A base URL in the one shape the suite compares against: a scheme, a host,
 * no trailing slash and no path. Every expected canonical, sitemap `<loc>` and
 * `Sitemap:` line in the smoke suite is built by pasting a path onto this, so
 * a stray slash typed on the command line would otherwise turn into a wrong
 * expectation rather than into a wrong URL — which is much harder to read in a
 * failure message. A bare host ("rempireshop.com") is given https:// because
 * that is the only scheme either deployment answers on.
 */
export function normaliseBaseUrl(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("smoke: a base URL is required — see docs/testing.md § «Smoke tests».");
  /* A host with no dot in it is almost certainly an option's value that landed
     in the wrong place, and the check has to be made on what was typed rather
     than on what `new URL()` made of it: `new URL("https://404")` does not
     throw, it decides 404 is a compressed IPv4 address and hands back the
     hostname 0.0.1.148 — dots and all. localhost is the one real exception. */
  const typedHost = text.replace(/^https?:\/\//i, "").split(/[/:?#]/)[0];
  if (!typedHost.includes(".") && typedHost !== "localhost") {
    throw new Error(`smoke: "${text}" does not look like a host — did an option's value land here?`);
  }
  const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`smoke: the base URL must be an origin, not a page — got ${text}`);
  }
  return url.origin;
}

/**
 * Where the smoke suite points. `SMOKE_BASE_URL` wins; staging is the default
 * because it is the deployment nobody has to think twice about — pointing at
 * the live shop is a thing you should have to type (tools/smoke.mjs, and the
 * `target` input on .github/workflows/smoke.yml, both make you).
 */
export function smokeBaseUrl() {
  return normaliseBaseUrl(process.env.SMOKE_BASE_URL || SMOKE_STAGING_URL);
}

/**
 * Is this base the live shop? The one question that decides whether the suite
 * demands the open robots policy and no `X-Robots-Tag`, or the closed policy
 * and `noindex, nofollow`. Written to match the `missing: [{ type: "host" }]`
 * rule in next.config.ts exactly — `www.` included, nothing else — because the
 * whole point of that rule is that a host nobody thought about is closed, and
 * a looser test here would quietly bless the one case it exists to catch.
 */
export function isProductionBase(baseUrl) {
  return /^(www\.)?rempireshop\.com$/.test(new URL(baseUrl).host);
}
