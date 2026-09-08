import { defineConfig } from "@playwright/test";
import { smokeBaseUrl } from "./e2e/env.mjs";

/**
 * Rempire shop — the deployed-shop smoke suite. One spec, e2e/smoke.spec.ts;
 * see docs/testing.md § «Smoke tests against a deployed shop» for the whole
 * picture, and that spec's own header for the read-only rule it lives by.
 *
 * A second config rather than a fourth project in playwright.config.ts, and
 * the reason is mechanical rather than aesthetic: that config declares a
 * `webServer`, and Playwright starts a config's webServer whenever *any* of
 * its projects is about to run. A smoke project living there would boot a
 * `next dev` on port 3417 and an empty PGlite database before every run — for
 * a suite that never once talks to localhost. Splitting the file is what makes
 * "starts NO web server" true rather than merely intended.
 *
 * The other half of that split is the `testIgnore` in playwright.config.ts:
 * both configs point `testDir` at ./e2e, so without it `npm run e2e` would
 * collect smoke.spec.ts too and run every deployed-shop assertion against
 * localhost, where robots.txt, the sitemap host and the security headers are
 * all legitimately different. Two configs, one directory, one file each way.
 */

/* Read once, here, so the failure for a mistyped URL happens before Playwright
   has launched a browser and so every test in the run agrees about the host. */
const BASE_URL = smokeBaseUrl();

export default defineConfig({
  testDir: "./e2e",
  testMatch: /smoke\.spec\.ts$/,
  /* Generous next to the local suite's 30 s: these requests cross the public
     internet to a serverless function that may be cold, and a product page's
     first paint is an 845 KB app.js fetched for real rather than off a disk
     two inches away. A timeout here should mean "the shop is slow", which is
     worth knowing, not "the runner's link is ordinary". */
  timeout: 90_000,
  expect: { timeout: 15_000 },
  /* Every test in this file is a read, so nothing one test does can change
     what another one sees — which is the condition playwright.config.ts's
     `workers: 1` exists for and the reason this file does not need it. Held at
     two anyway: the far end is a real shop with real customers on it, and a
     smoke check has no business being the heaviest visitor of the minute. */
  fullyParallel: true,
  workers: 2,
  forbidOnly: !!process.env.CI,
  /* One retry in CI, none locally. The thing this suite watches is a network
     it does not own, and a single dropped TLS handshake at 3 a.m. must not
     read as "the shop is down" — a fault that survives a retry is a fault.
     Locally the first failure is the one you want to look at. */
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { open: "never", outputFolder: "playwright-report-smoke" }], [process.env.CI ? "github" : "list"]],
  /* Its own folder. The local suite writes traces and videos into
     ./test-results, and a smoke run that reused it would delete the artefacts
     of the e2e failure somebody is in the middle of reading. */
  outputDir: "./test-results-smoke",

  use: {
    baseURL: BASE_URL,
    /* Same reason as playwright.config.ts: guessLang() falls back to the
       *browser's* language before it falls back to Russian, and every
       unprefixed URL this suite asks for is expected to answer in Russian —
       that is what "no prefix" means in docs/seo.md. Chromium's own default is
       en-US, so without this the RU column of the page matrix would be
       measuring this machine's locale. */
    locale: "ru-RU",
    /* The consent banner, answered with «Только необходимое» before the first
       page load. Two reasons, and the second is the important one:

         · the bar is not on screen, so the pages are checked in the state a
           returning shopper sees rather than with a fixed bar over the footer;
         · with analytics declined, track() in app.js returns before it builds
           a body (see its own comment), so this suite never sends the
           `navigator.sendBeacon("/api/track/")` that every page view otherwise
           fires. A write to the real events table is exactly the kind of thing
           the read-only rule forbids, and declining is a cleaner way to stop
           it than intercepting it after the fact.

       The shape is `{v, analytics, at}` — consentRead() in app.js. */
    storageState: {
      cookies: [],
      origins: [
        {
          origin: BASE_URL,
          localStorage: [{ name: "rempire-consent", value: JSON.stringify({ v: 1, analytics: false, at: 0 }) }],
        },
      ],
    },
    /* Deliberately NOT `ignoreHTTPSErrors`. A certificate that has expired or
       stopped matching the host is precisely the class of deployment fault
       this suite exists to notice, and the staging domain's TLS is somebody
       else's renewal (docs/accounts.md). Let it fail. */
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
  },

  /* One project. The viewport matrix, the phone emulation and WebKit belong to
     the local suite, which can afford them: this one answers "is the thing
     that is deployed the thing we think is deployed", and that question has
     the same answer in every browser. Desktop Chromium is the shape most of
     the assertions here are about anyway — headers, XML, tokens and status
     codes, none of which have a viewport. */
  projects: [{ name: "smoke", use: { viewport: { width: 1280, height: 800 }, browserName: "chromium" } }],
});
