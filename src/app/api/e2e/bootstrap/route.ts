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
import { query } from "@/lib/db";
import { migratePending } from "@/lib/migrate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The one setting this route seeds, and why.
 *
 * «Партнёры и баллы» (`settings.pricing.partnersOn`) is OFF on a fresh shop
 * since 07.09.2026 — Dim's answer, docs/loyalty.md. Most of this suite is
 * about a shop that HAS the programme: salon prices in the editor and on the
 * product page, «Одобрить Pro» in «Клиенты», the points row on «Доставка и
 * оплата», «Использовать баллы» at checkout. Rather than have every one of
 * those specs turn the switch on for itself (and race the others doing the
 * same), the suite's shop is simply a shop where the owner switched it on —
 * which is what those specs have always been describing.
 *
 * The DEFAULT is covered where it belongs: tests/partners-switch.test.ts and
 * tests/loyalty.test.ts (vitest, no bootstrap) prove the off state end to end,
 * and e2e/admin-sweep-4.spec.ts turns the switch off and back on in the panel.
 *
 * `on conflict do nothing`: a spec that has changed `pricing` keeps its own
 * row, and a re-poll of this readiness URL never undoes it.
 */
async function seedE2ESettings(): Promise<void> {
  try {
    await query(
      `insert into settings (key, value) values ('pricing', $1::jsonb)
       on conflict (key) do nothing`,
      [JSON.stringify({ partnersOn: true })],
    );
  } catch (err) {
    console.error("[api/e2e/bootstrap] seed failed:", err);
  }
}

export async function GET() {
  if (process.env.NODE_ENV === "production" || process.env.E2E_BOOTSTRAP !== "1") {
    return Response.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  try {
    const result = await migratePending();
    await seedE2ESettings();
    return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/e2e/bootstrap] migrate failed:", err);
    return Response.json({ ok: false, error: "db_unavailable" }, { status: 503 });
  }
}
