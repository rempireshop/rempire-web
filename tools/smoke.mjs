#!/usr/bin/env node
/**
 * Runs the deployed-shop smoke suite (e2e/smoke.spec.ts,
 * playwright.smoke.config.ts) against a base URL you name.
 *
 *   npm run smoke                                   # staging
 *   npm run smoke -- https://rempireshop.com        # the live shop
 *   npm run smoke -- --headed --debug               # any playwright flag
 *
 * Why a Node script rather than a bare `playwright test` in package.json: the
 * base URL reaches the config through an environment variable, and the
 * `VAR=value cmd` syntax that would set it is bash-only — it breaks on the
 * Windows cmd.exe that `npm run` shells out to, and this repository is
 * developed on Windows (docs/testing.md, and tools/e2e-build.mjs, which exists
 * for the same reason). Setting it in `child_process.spawn`'s `env` sidesteps
 * shell syntax entirely, so the one documented invocation above is the same
 * sentence on a laptop and in CI. `SMOKE_BASE_URL` still works if you prefer
 * to export it; the argument simply wins.
 *
 * The suite itself is strictly read-only — see the header of e2e/smoke.spec.ts
 * for the rule and for how it is enforced. There is nothing to install, no
 * server to start and no database: it is a browser and a handful of GETs
 * pointed at a shop that is already running.
 */
import { spawn } from "node:child_process";
import { SMOKE_STAGING_URL, normaliseBaseUrl } from "../e2e/env.mjs";

/* The base URL, if given at all, is the FIRST argument; everything after it is
   handed to Playwright untouched, so `--headed`, `-g robots` and friends work
   exactly as they do for the local suite. Position rather than "the first
   thing that is not a flag", because `-g 404` has a value that is not a flag
   either and picking it out of the middle would silently point the run at
   https://404 — which, alarmingly, is a URL Node is willing to parse. */
const argv = process.argv.slice(2);
const target = argv[0] && !argv[0].startsWith("-") ? argv[0] : "";
const passThrough = target ? argv.slice(1) : argv;

const base = normaliseBaseUrl(target || process.env.SMOKE_BASE_URL || SMOKE_STAGING_URL);

/* Said out loud, every run. A smoke suite is the one suite where "which shop
   did that just talk to?" is a question worth never having to ask. */
console.log(`[smoke] ${base}${target ? "" : "  (default — pass a URL to point somewhere else)"}`);

const child = spawn(
  "npx",
  ["playwright", "test", "--config=playwright.smoke.config.ts", ...passThrough],
  { env: { ...process.env, SMOKE_BASE_URL: base }, stdio: "inherit", shell: true },
);
child.on("exit", (code) => process.exit(code === null ? 1 : code));
child.on("error", (err) => {
  console.error(`[smoke] could not start playwright: ${err.message}`);
  process.exit(1);
});
