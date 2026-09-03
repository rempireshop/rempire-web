import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { adminPasswordHash, E2E_BASE_URL, E2E_PORT, E2E_SESSION_SECRET } from "./e2e/env.mjs";

/**
 * Rempire shop — end-to-end suite. See docs/testing.md for the full picture
 * (how the webServer boots an empty in-memory database, what the e2e-only
 * test hooks are and why they are safe, how to update screenshots, and what
 * this file's choices below are for).
 *
 * Quick orientation:
 *   - `npm run e2e` prepares first (tools/e2e-build.mjs — a plain Node
 *     script, not a shell one-liner, so it behaves the same on Windows and
 *     in CI: runs the SEO prerender + the two generated-file packers that
 *     `next build`'s own `prebuild` hook would otherwise run), then runs
 *     `playwright test`, which starts the app itself (`webServer` below,
 *     `next dev` — see that env block's own comment for why not `next
 *     build` + `next start`, which was tried first and does not work for
 *     this app's env-gated test hooks) against a fresh in-memory PGlite
 *     database (DB_DRIVER=pglite) — nothing to install, nothing left over
 *     afterwards.
 *   - `workers: 1` is deliberate, not a leftover default: every test talks to
 *     the *same* running server and the *same* in-memory database (there is
 *     no per-test reset), and several admin specs flip shop-wide switches
 *     (sets rail, chatbot FAB, hero, prices) that other specs read. Running
 *     serially is what makes that safe without every mutating test having to
 *     defend against a concurrent read elsewhere; it also means a failure's
 *     stack trace is never confused by an unrelated test running at the same
 *     moment. See docs/testing.md for the tradeoff.
 */

const webkitInstalled = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { webkit } = require("playwright-core");
    return existsSync(webkit.executablePath());
  } catch {
    return false;
  }
})();

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 8_000,
    toHaveScreenshot: {
      // Real, still-moving UI (two other agents are editing app.js/styles.css
      // in this same repo) plus normal cross-run font/AA jitter — generous on
      // purpose, see docs/testing.md "Visual snapshots". {platform} in the
      // path template below keeps Windows and Linux baselines separate, so
      // this does not have to paper over a whole different font stack too.
      maxDiffPixelRatio: 0.04,
      threshold: 0.25,
      animations: "disabled",
    },
  },
  // {-platform} matters: baselines made on this machine (Windows) and the
  // ones CI (Ubuntu) will need are kept as separate files instead of one
  // fighting the other — see docs/testing.md.
  snapshotPathTemplate: "{snapshotDir}/__screenshots__/{testFilePath}/{arg}{-projectName}{-platform}{ext}",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { open: "never" }], [process.env.CI ? "github" : "list"]],
  outputDir: "./test-results",

  use: {
    baseURL: E2E_BASE_URL,
    // app.js's guessLang() (cold load, no URL prefix, no saved preference)
    // falls back to the *browser's* language before it falls back to
    // Russian — and Chromium's own default locale is en-US, not ru. Every
    // "RU" case in this suite navigates to an unprefixed URL expecting
    // Russian (that is what "no prefix" means throughout app.js and
    // docs/seo.md), so the locale has to be pinned here or "RU" silently
    // becomes "whatever this machine's Chromium defaults to".
    locale: "ru-RU",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
  },

  webServer: {
    // `next dev`, not `next build` + `next start`. The latter was tried
    // first — it is closer to "realism" — and it silently breaks every
    // env-gated e2e-only route (src/app/api/account/code,
    // src/app/api/e2e/*): `next build` bakes `process.env.NODE_ENV` into a
    // compile-time constant via DefinePlugin, and it does so from its own
    // internal dev/build flag, never from the actual NODE_ENV environment
    // variable (node_modules/next/dist/build/define-env.js — verified by
    // inspecting the compiled route output, not assumed). Every `next build`
    // therefore ships with `process.env.NODE_ENV === "production"`
    // hard-coded, no matter what is set at build time or at `next start`
    // time — so a route gated on `NODE_ENV !== "production"` is dead-code
    // eliminated out of the bundle entirely, not just "off". `next dev` has
    // no such problem: it does not run the production minifier, and its
    // build-pipeline `dev` flag makes that same DefinePlugin line resolve to
    // "development" — which is what the gate actually needs. Full story,
    // including the one config-level escape hatch that exists and why it is
    // not used here, in tools/e2e-build.mjs's own comment and docs/testing.md.
    //
    // `npx` (not the "dev"/"start" package.json scripts) because those
    // hard-code --port 3300, which may already be busy with an unrelated
    // `next dev` someone else has open.
    command: `npx next dev --port ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/api/e2e/bootstrap/`,
    reuseExistingServer: !process.env.CI,
    // Generous: dev mode compiles each route on its first hit rather than
    // ahead of time, and the very first request here compiles the bootstrap
    // route's whole import chain (db/migrate/pglite).
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      DB_DRIVER: "pglite",
      SESSION_SECRET: E2E_SESSION_SECRET,
      ADMIN_PASSWORD_HASH: adminPasswordHash(),
      PAYMENT_PROVIDER: "mock",
      PUBLIC_BASE_URL: E2E_BASE_URL,
      E2E_EXPOSE_LOGIN_CODE: "1",
      E2E_BOOTSTRAP: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      // Force-cleared so a value in the ambient shell (or an inherited CI
      // secret) can never sneak in: the chatbot spec needs OPENAI_API_KEY
      // truly absent to see the assistant's own "disabled" state, and the
      // account/gift-card specs need RESEND_API_KEY truly absent so mail is
      // skipped rather than actually sent (docs/mail.md, docs/testing.md).
      OPENAI_API_KEY: "",
      RESEND_API_KEY: "",
    },
  },

  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 }, browserName: "chromium" } },
    // devices["iPad Mini"] / ["iPhone X"] set defaultBrowserType: "webkit"
    // (a real iPad/iPhone runs Safari) — browserName here overrides that back
    // to Chromium, which is what "3 projects, Chromium only in CI" (the task)
    // means by tablet/mobile: viewport + touch + UA emulation, still Chromium
    // underneath. Confirmed the hard way: every other spec in this suite
    // restricts itself to --project=desktop, so this device/engine mismatch
    // was never exercised until visual.spec.ts (deliberately the one file
    // that runs on all three) tried to launch a webkit that isn't installed.
    { name: "tablet", use: { ...devices["iPad Mini"], browserName: "chromium" } }, // 768×1024
    { name: "mobile", use: { ...devices["iPhone X"], browserName: "chromium" } }, // 375×812
    ...(webkitInstalled
      ? [{ name: "webkit-local", use: { ...devices["Desktop Safari"] } }]
      : []),
  ],
});
