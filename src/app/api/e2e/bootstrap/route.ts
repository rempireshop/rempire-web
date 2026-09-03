/**
 * GET /api/e2e/bootstrap/ — TEST-ONLY readiness probe for the Playwright
 * webServer (playwright.config.ts).
 *
 * Why this route exists: the suite runs with DB_DRIVER=pglite, an in-memory
 * Postgres that lives only inside the running `next start`/`next dev`
 * process (src/lib/db.ts). `npm run migrate` in a *separate* process — the
 * normal way to apply db/migrations/*.sql — would migrate a different,
 * throwaway in-memory database and leave the server's own schema empty
 * (docs/testing.md explains this in full). The server needs its migrations
 * applied from inside itself, exactly once, before any spec runs.
 *
 * Playwright's `webServer.url` option polls a URL until it answers 2xx and
 * only then starts the tests (see playwright-core's isURLAvailable — 200..403
 * counts, everything else keeps retrying). Pointing that option at this route
 * turns the readiness probe into the migration trigger: every poll runs
 * migratePending(), which is a no-op once the schema exists, so repeated
 * polls (or a manual reload) are harmless. There is no race with the first
 * real spec: Playwright will not consider the server "up" — and so will not
 * start the browser — until this route itself has returned 2xx once.
 *
 * Deliberately NOT behind requireAdmin: Playwright's own readiness probe is a
 * plain unauthenticated GET with no way to attach a cookie, and gating this
 * on the admin session would make it un-pollable by the one caller it exists
 * for. That is safe here because the only thing it does is apply schema
 * migrations to a database that, by construction (gate below), is always the
 * disposable in-memory one from this test run — never anything with real
 * data in it.
 *
 * Gated the same way as every other e2e-only door in this app (see
 * /api/account/code, /api/e2e/gift-card): NODE_ENV must not be "production"
 * AND E2E_BOOTSTRAP must be exactly "1". Both are set only in the Playwright
 * webServer env, never in a real deploy.
 */
import { migratePending } from "@/lib/migrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV === "production" || process.env.E2E_BOOTSTRAP !== "1") {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  try {
    const result = await migratePending();
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/e2e/bootstrap] migrate failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
