#!/usr/bin/env node
/**
 * Prebuild step for the e2e suite, cross-platform — the SEO layer
 * (`tools/prerender-shop2.mjs`) and the three generated-file packers
 * (`db/migrations/*.sql` → `src/db/migrations.generated.ts`, `DEFAULT_CONTENT`
 * → `src/data/content.default.json`, `LEGAL`'s keys →
 * `src/data/legal-slugs.json`) that `npm run build`'s own `prebuild`
 * hook normally runs before `next build`. Playwright's webServer runs `next
 * dev`, not `next build` — see the long comment below for why that is not a
 * downgrade so much as the only correct choice here — and `next dev` never
 * runs `prebuild` on its own, so this script is what stands in for it.
 *
 *   node tools/e2e-build.mjs
 *
 * Why a plain Node script and not `PUBLIC_BASE_URL=... npm run prerender`:
 * that `VAR=value cmd` shell syntax is bash-only and breaks on Windows
 * cmd.exe, which is what `npm run` shells out to by default there (this repo
 * is developed on Windows — see docs/testing.md). Setting the env in
 * `child_process.spawn`'s `env` option sidesteps shell syntax entirely and
 * behaves the same in CI (Linux) and locally (Windows).
 *
 * ---- why `next dev`, not `next build` + `next start` ----------------------
 * `next build` was the first thing tried here, and it silently broke every
 * env-gated e2e-only route (src/app/api/account/code, src/app/api/e2e/*):
 * they all 404'd no matter what NODE_ENV was passed to `next start`
 * afterwards. Tracing it into the compiled output
 * (`.next/server/app/api/e2e/bootstrap/route.js`) showed the entire gated
 * branch had been dead-code-eliminated — and `node_modules/next/dist/build
 * /define-env.js` explains why: Next's build sets the DefinePlugin value for
 * `process.env.NODE_ENV` from its own internal `dev` boolean (`dev ||
 * config.experimental.allowDevelopmentBuild ? 'development' : 'production'`),
 * never from the actual `NODE_ENV` environment variable. A `next build`
 * output therefore always has `process.env.NODE_ENV === "production"` baked
 * in as a compile-time constant — setting NODE_ENV at build time OR at
 * `next start` time changes nothing, because by the time `next start` runs
 * there is no `process.env.NODE_ENV` read left in the bundle to change; it
 * was replaced with the literal string "production" during `next build`,
 * for every build, unconditionally, unless `next.config.ts` opts in with
 * `experimental.allowDevelopmentBuild` — a config change out of scope for
 * this suite (next.config.ts is owned by other agents' work — see
 * docs/build-contracts.md) and not something to carry into the real deploy
 * config just to make a test double work.
 *
 * `next dev` has no such problem: `dev` is `true`, so the same DefinePlugin
 * line resolves `process.env.NODE_ENV` to `"development"` — which is exactly
 * what the account-code route's `NODE_ENV !== "production"` gate needs to
 * stay true — and dev mode does not run the production minifier that turns
 * "now provably false" branches into dead code that gets stripped, so even
 * routes with no NODE_ENV dependency behave exactly like their source.
 * `E2E_BOOTSTRAP` / `E2E_EXPOSE_LOGIN_CODE` were never at risk from this —
 * only `NODE_ENV` gets the special DefinePlugin treatment — but the whole
 * point of the double gate (docs/testing.md) is that the NODE_ENV half has
 * to be a *real*, live check, and only `next dev` gives it one.
 *
 * The trade-off: dev mode is slower to compile (routes compile on first hit,
 * not ahead of time — playwright.config.ts's webServer.timeout is generous
 * to cover that) and ships React's development bundle rather than the
 * production-minified one. Functionally the app is identical either way;
 * this suite is testing behavior, not bundle size.
 */
import { spawn } from "node:child_process";
import { E2E_BASE_URL } from "../e2e/env.mjs";

const env = {
  ...process.env,
  DB_DRIVER: "pglite",
  PUBLIC_BASE_URL: E2E_BASE_URL,
  NEXT_TELEMETRY_DISABLED: "1",
};

const steps = [
  ["node", ["tools/pack-migrations.mjs"]],
  ["node", ["tools/pack-content.mjs"]],
  ["node", ["tools/pack-legal.mjs"]],
  ["node", ["tools/copy-vendor.mjs"]],
  /* public/shop2/app.min.js — what the shell links and therefore the only
     copy of the shop a browser in this suite ever runs. Gitignored, so
     without this step `next dev` serves a 404 for it and every spec fails on
     an empty page. Before the prerender, which reads the shell it patches. */
  ["node", ["tools/minify-shop2.mjs"]],
  ["node", ["tools/prerender-shop2.mjs"]],
];

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: "inherit", shell: true });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`))));
    child.on("error", reject);
  });
}

for (const [cmd, args] of steps) {
  console.log(`[e2e-build] ${cmd} ${args.join(" ")}`);
  await run(cmd, args);
}
