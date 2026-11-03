import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * The two stopwatches — e2e/perf-admin.spec.ts (how long each admin screen
 * renders) and e2e/perf-open.spec.ts (the requests a screen makes when it is
 * opened cold). They print a table and assert only that the screen came up,
 * so they are measuring instruments, not tests: a number that fails a build
 * tells you about the runner's mood. playwright.config.ts never collects them
 * (ALWAYS_IGNORED); this config collects nothing else.
 *
 *   npm run e2e:perf                                  (both, desktop)
 *   E2E_PORT=3817 npm run e2e:perf -- perf-open       (one, on a free port)
 *
 * The same web server, database and browser settings as the suite — only the
 * file list and the one project differ.
 */
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: /[\\/]perf-(admin|open)\.spec\.ts$/,
  projects: (base.projects ?? []).filter((p) => p.name === "desktop"),
});
