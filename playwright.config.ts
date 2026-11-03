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
 *     in CI: runs the SEO prerender + the three generated-file packers that
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

/**
 * What Safari runs — the customer-facing specs, on BOTH WebKit projects.
 *
 * One constant rather than one regex per project, because the rule is one
 * rule: «the admin stays Chromium-only» (docs/testing.md § «Safari»). It was
 * written on `mobile-safari` only, and `webkit-local` — added earlier, for
 * poking at the shop by hand — went on running all sixty spec files. Two tests
 * in `admin-sections.spec.ts` could not hold on that project: they ask Desktop
 * Safari for a phone's bottom nav, and for a button to take focus from a
 * click, which WebKit deliberately does not give it. Nothing in CI runs
 * `webkit-local` (.github/workflows/ci.yml names its projects), so they were
 * red only on the machine of whoever had WebKit installed, and only in a run
 * that named no --project at all.
 */
const SAFARI_SPECS =
  /[\\/](catalogue|product|checkout|checkout-wallet-account|invoice|payments|storefront-sweep-2|home|blog|blog-magazine|sets|giftcard|account|account-settings|account-privacy|account-order-details|addresses|pwa|sweep-storefront|sweep-checkout|testplan)\.spec\.ts$/;

/** `e2e/<name>.spec.ts` for each name, as one pattern anchored on the separator. */
const specs = (...names: string[]) => new RegExp(`[\\\\/](${names.join("|")})\\.spec\\.ts$`);

/**
 * Never collected by this config. e2e/smoke.spec.ts runs against a deployed
 * shop from playwright.smoke.config.ts — its robots.txt, sitemap host and
 * security headers are legitimately different on a `next dev` on localhost.
 * The perf-* stopwatches print a table and assert nothing, so they run by
 * hand from playwright.perf.config.ts (`npm run e2e:perf`).
 */
const ALWAYS_IGNORED = [specs("smoke"), specs("perf-admin", "perf-open")];

/**
 * Which Chromium projects run a whole file, for the files whose every test
 * follows one rule (docs/testing.md § «Why most specs run on desktop only»): the panel
 * on desktop only, the shop on desktop and the phone. Written here, as
 * `testIgnore`, rather than as a `test.skip` in each file, so `--list` shows
 * what really runs and the CI shards split real work, not skipped tests.
 * A file that mixes the two — a panel test about the phone's own layout next
 * to desktop ones — keeps its gates per describe instead.
 */
const DESKTOP_ONLY = specs(
  "admin-customer-card", "admin-home-brands", "admin-lang-r20", "admin-search-langs",
  "blog-files-simple", "blog-materials", "salon-sale",
);
/** The shop's phone is Safari here: desktop + mobile-safari, no Chromium phone or tablet. */
const PHONE_IS_SAFARI = specs("invoice", "pwa");
/** Desktop + phone; a tablet run of these is a third pass over the same layout. */
const NO_TABLET = specs("blog", "sweep-checkout", "sweep-storefront");

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
  /* e2e/smoke.spec.ts runs against a deployed shop, from its own config
     (playwright.smoke.config.ts, `npm run smoke`); the two perf-* stopwatches
     run from playwright.perf.config.ts. See ALWAYS_IGNORED above. A project
     that sets its own `testIgnore` replaces this one, so each of those lists
     starts with ALWAYS_IGNORED too. */
  testIgnore: ALWAYS_IGNORED,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { open: "never" }], [process.env.CI ? "github" : "list"]],
  outputDir: "./test-results",

  use: {
    baseURL: E2E_BASE_URL,
    // The panel (/admin, an address with no language) opens in the owner's
    // saved language, else the browser's — app.js guessLang() — and every
    // admin spec reads Russian; Chromium's own default locale is en-US. The
    // storefront no longer reads it at all: since 08.10.2026 a storefront
    // page is in its address's language (English unprefixed, /ru, /et).
    locale: "ru-RU",
    /* Every test starts as a visitor who has already answered the consent
       banner (07.09.2026, docs/features.md § «Данные и cookie»): analytics
       allowed, banner gone. Without this the bar is on screen in all ~90
       crawl screens and every visual baseline, and the purchase-beacon tests
       would be measuring a shopper who never agreed to be measured — which
       is a fact about the banner, not about the checkout they are testing.
       The banner's own tests (e2e/storefront-sweep-2.spec.ts) clear this key
       for themselves and drive it from a genuine first visit. */
    /* …and has chosen English on the language switch once (the `rempire_lang`
       cookie). Since 08.10.2026 English is the unprefixed language and the
       edge sends a browser that asks for Russian — which this ru-RU browser
       does — from an unprefixed page to its /ru twin (src/middleware.ts). Every
       spec that means English opens an unprefixed address (shopUrl("/en", …)),
       and means it; the specs about that redirect clear the cookie. Russian
       pages carry their /ru prefix and are not affected, and the panel keeps
       its own language (the owner's saved choice / this browser's, RU). */
    storageState: {
      cookies: [
        {
          name: "rempire_lang", value: "en", domain: "localhost", path: "/",
          expires: -1, httpOnly: false, secure: false, sameSite: "Lax",
        },
      ],
      origins: [
        {
          origin: E2E_BASE_URL,
          localStorage: [{ name: "rempire-consent", value: JSON.stringify({ v: 1, analytics: true, at: 0 }) }],
        },
      ],
    },
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
      // the same idea for the carrier: «Создать этикетку» registers a parcel
      // with src/lib/shipping/montonio-mock.ts instead of Montonio, so the
      // order card's whole flow can be driven — no keys, no real parcels
      SHIPPING_PROVIDER: "mock",
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
      // …and «Продолжить с Google» off: e2e/google-signin.spec.ts asserts the
      // button is absent and the routes 404 without a client ID, and turns
      // the storefront half on for itself by answering the feed's flag
      GOOGLE_CLIENT_ID: "",
    },
  },

  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 }, browserName: "chromium" } },
    // devices["iPad Mini"] / ["iPhone X"] set defaultBrowserType: "webkit"
    // (a real iPad/iPhone runs Safari) — browserName here overrides that back
    // to Chromium, which is what "3 projects, Chromium only in CI" (the task)
    // means by tablet/mobile: viewport + touch + UA emulation, still Chromium
    // underneath. Without the override a spec that runs on all three tries to
    // launch a webkit that may not be installed.
    {
      name: "tablet",
      use: { ...devices["iPad Mini"], browserName: "chromium" }, // 768×1024
      testIgnore: [...ALWAYS_IGNORED, DESKTOP_ONLY, PHONE_IS_SAFARI, NO_TABLET],
    },
    {
      name: "mobile",
      use: { ...devices["iPhone X"], browserName: "chromium" }, // 375×812
      testIgnore: [...ALWAYS_IGNORED, DESKTOP_ONLY, PHONE_IS_SAFARI],
    },
    /* Safari, for real. devices["iPhone 13"] keeps its own defaultBrowserType
       ("webkit"), so this is the one project that runs the storefront on the
       engine every iPhone actually uses — 390×664, touch, iOS user agent —
       rather than Chromium wearing a phone's viewport. Scoped by testMatch to
       the customer-facing specs a phone matters for; the admin stays
       Chromium-only (docs/testing.md "Safari"). Deliberately NOT gated on
       webkitInstalled like webkit-local below: CI installs WebKit for its own
       `safari` job (.github/workflows/ci.yml, the Chromium shards pass
       --project explicitly), and locally `npx playwright install webkit` is
       the one-time step — a project that silently vanished when the browser
       was missing would hide exactly the failures it exists to find. */
    {
      name: "mobile-safari",
      use: { ...devices["iPhone 13"] },
      // anchored on the separator so admin-blog / admin-products stay out;
      // sweep-checkout is in for its one phone-layout test (the rest of that
      // file skips itself off the desktop project), and storefront-sweep-2
      // because its own beforeEach already asks for this project by name
      /* `testplan` is here for the same reason the storefront specs are: the
         acceptance checklist at /test/ is a page Renat fills in on an iPhone,
         so the engine that has to keep its answers between reloads is the one
         he actually uses — Safari, whose private mode is also the browser that
         refuses localStorage outright. */
      testMatch: SAFARI_SPECS,
    },
    /* Desktop Safari, when the browser happens to be installed: the storefront
       on the engine, at a laptop's width, for poking at something by hand. The
       same specs as mobile-safari and for the same reason — see SAFARI_SPECS
       above for what ran here before and why it could not pass. */
    ...(webkitInstalled
      ? [{ name: "webkit-local", use: { ...devices["Desktop Safari"] }, testMatch: SAFARI_SPECS }]
      : []),
  ],
});
