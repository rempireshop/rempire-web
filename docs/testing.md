# End-to-end tests

Playwright drives a real, running copy of the shop against an empty in-memory
database (`DB_DRIVER=pglite`, no server to install) and a mock payment
provider — nothing here needs a network, a real bank, or a mailbox. Unit
tests (`npm test`, vitest) are a separate, faster layer; see the root of this
file for what moved there instead of into a browser test and why.

## Running it locally

```bash
npx playwright install chromium   # once, or after a Playwright version bump
npm run e2e                       # build, then run the whole suite (Chromium, 3 viewports)
npm run e2e:ui                    # same, in Playwright's interactive UI mode
npm run e2e:update                # same, and rewrite the visual baselines
npx playwright test e2e/checkout.spec.ts        # one file
npx playwright test --project=mobile            # one viewport
npx playwright show-report                      # open the last HTML report
```

`npm run e2e` is two steps chained: `node tools/e2e-build.mjs` (a plain Node
script, not `VAR=value cmd`, so it behaves the same on Windows and in CI — see
that file's own comment) runs the SEO prerender and the two generated-file
packers that `next build`'s own `prebuild` hook would otherwise run, then
`playwright test` starts the app itself via `webServer` in
`playwright.config.ts` — `next dev`, deliberately, not `next build` + `next
start`; both files' own comments have the full story, short version in "The
three test-only doors" below. WebKit is not installed on this machine
(`npx playwright install webkit` would add it); the config adds a
`webkit-local` project automatically when it detects it is, so
`npx playwright test --project=webkit-local` works the moment it exists —
CI stays Chromium-only regardless (`.github/workflows/ci.yml`).

Nothing is left running afterwards and nothing is written outside this repo:
the database is in memory, the app runs on port 3417 (picked to stay clear of
`npm run dev`'s 3300), and Playwright kills it when the run ends.

## The three test-only doors, and why each is safe

Three things exist in this codebase *only* for this suite, all named `e2e`
or `E2E_*` so they are easy to find and easy to be suspicious of:

1. **`E2E_EXPOSE_LOGIN_CODE=1`** — `src/app/api/account/code/route.ts`. The
   customer login flow has no password, only a code mailed to the address
   (`docs/flows.md`), and this suite runs with no `RESEND_API_KEY` (mail is
   skipped, never sent — `docs/mail.md`). With the flag on, the response to
   "send me a code" carries the raw code alongside the normal `{ok:true}` —
   the *only* place it ever does. Double-gated: the flag must be `"1"` **and**
   `NODE_ENV` must not be `"production"`.

   That second half is *why this suite's webServer runs `next dev`, not `next
   build` + `next start`* (`playwright.config.ts`, `tools/e2e-build.mjs`).
   `next build` was tried first and looked like the better, more realistic
   choice — until it turned out to make this exact gate permanently closed,
   for a reason with nothing to do with what env vars are set at runtime:
   `next build` bakes `process.env.NODE_ENV` into a compile-time constant via
   webpack's DefinePlugin, and the value it bakes in comes from Next's own
   internal "is this a dev server or a build" flag, never from the actual
   `NODE_ENV` environment variable
   (`node_modules/next/dist/build/define-env.js`: `'process.env.NODE_ENV':
   dev || config.experimental.allowDevelopmentBuild ? 'development' :
   'production'` — confirmed by inspecting the compiled output of this exact
   route, not assumed from reading that line alone). Every `next build`,
   this repo's or anyone else's, therefore ships with
   `process.env.NODE_ENV === "production"` hard-coded into the bundle — so a
   branch gated on `NODE_ENV !== "production"` is not just "off" at runtime,
   it is dead-code-eliminated out of the compiled route entirely, and setting
   `NODE_ENV` at build time or at `next start` time changes nothing, because
   there is no `process.env.NODE_ENV` read left to change. (There is one
   config-level escape hatch — `experimental.allowDevelopmentBuild` in
   `next.config.ts` — deliberately not used: that file is shared, owned by
   other agents' work right now, docs/build-contracts.md, and a build-mode
   flag is not something to carry into the real deploy config just to make a
   test double work.) `next dev` has no such problem — its own `dev` flag is
   `true`, so that same DefinePlugin line resolves to `"development"`, which
   is exactly what this gate needs, and dev mode does not run the production
   minifier that turns a provably-false branch into removable dead code in
   the first place.

   `tests/account-code-e2e-hook.test.ts` is the unit-level proof this never
   leaks — including with `NODE_ENV=production` and the flag left on by
   mistake (that test calls the route handler directly with `vi.stubEnv`, no
   bundling involved, so it is unaffected by any of the above).

2. **`E2E_BOOTSTRAP=1`** gates two routes:
   - `GET /api/e2e/bootstrap/` — applies pending migrations and is also what
     `playwright.config.ts` polls as the webServer's readiness URL. Why a
     route and not just running `npm run migrate` first: `DB_DRIVER=pglite`
     with no `PGLITE_PATH` is a pure in-memory database that lives inside
     *one* Node process (`src/lib/db.ts` caches it on `globalThis`).
     `npm run migrate` in a separate process migrates a *different*,
     throwaway in-memory database and exits — the running server never sees
     it. Pointing Playwright's readiness check at this route instead of `/`
     turns the poll into the trigger: migration runs on every poll (a no-op
     once applied), and Playwright will not start any test until it has
     answered 2xx once — no race between "server accepts connections" and
     "schema exists." Not behind `requireAdmin`: a plain readiness probe has
     no way to attach a cookie, and the only thing this route can do is
     migrate the disposable database this same env var implies.
   - `GET /api/e2e/gift-card/?order=<id-or-number>` — **is** behind
     `requireAdmin`, because it hands back a real gift-card code. It exists
     because nothing else in the app can: the confirmation letter is skipped
     (no Resend key), the receipt screen never shows a code, and no existing
     admin route joins `gift_cards` back onto an order — see the route's own
     comment for the full chain. `e2e/giftcard.spec.ts` is the only caller.

   `tools/e2e-bootstrap.mjs` is a related but separate thing: a manual CLI for
   a *human* running `npm run dev` locally who wants the running dev server's
   in-memory database migrated (the same "separate process" problem as
   above, solved by logging in as admin over HTTP and calling the real
   `POST /api/admin/migrate`). Playwright does not use it.

None of the three ever appears outside `playwright.config.ts`'s `webServer.env`
block. A production deploy sets none of them, and even a copy-paste mistake
that did would still be caught by the `NODE_ENV`/`requireAdmin` half of each
gate.

## Fixed test credentials

`e2e/env.mjs` is the one file both `playwright.config.ts` and
`tools/e2e-build.mjs` import for the server's port, `SESSION_SECRET` and
`ADMIN_PASSWORD_HASH` (computed at config-load time from a fixed password
with a fixed salt — deliberately not random; see the comment there for why
determinism is the safer choice here, not a weaker one). None of it is a
secret: it only ever guards the empty, in-memory, thrown-away-on-exit
database this suite starts from on every run.

## Rate limits and test isolation

Several API routes are rate-limited per IP (`src/lib/auth.ts` `rateLimit()`):
admin login 5/min, orders 10/min, account codes 3/15min, and more. A
browser's own requests carry no `X-Forwarded-For`, so `clientIp()` falls back
to a constant — every spec would otherwise share *one* budget and starve
each other partway through a run. `e2e/fixtures.ts`'s `ipHeaders(n)` gives
each spec file (and, inside `checkout`/`account`/`giftcard`, each language
within it) its own fake address via `extraHTTPHeaders`, so the limiter sees
different callers exactly the way it would for two real shoppers — this is
not a bypass of the limiter, it is what the limiter is *for*.

The suite also runs **serially** (`workers: 1`, `fullyParallel: false` in
`playwright.config.ts`). This is deliberate, not a leftover default: every
test talks to the same running server and the same in-memory database — there
is no per-test reset — and several `admin.spec.ts` tests flip shop-wide
switches (the sets rail, the chatbot FAB, the hero, a product's price) that
other spec files assume are in their default state. Every such test reverts
what it changed before it finishes (see the comments at the top of
`admin.spec.ts`), which is what actually keeps the suite order-independent;
serial execution just means "revert before the next file starts" is enough
on its own, with no cross-file locking to get wrong. If this suite ever grows
enough to need real parallelism, that revert discipline is the thing to keep.

## Why most specs run on desktop only

`playwright.config.ts` defines three projects — desktop 1280×800, tablet
768×1024 (`iPad Mini`), mobile 375×812 (`iPhone X`) — because the task asked
for that matrix to exist and be usable
(`npx playwright test --project=mobile` works for any spec, any time).
Most spec files still open with a `test.skip(testInfo.project.name !==
"desktop", …)` guard, for two reasons together: business-logic correctness
(cart math, checkout flow, admin CRUD, i18n text) does not change with
viewport width, so tripling every one of those tests would only triple
runtime, not coverage; and several specs already multiply by *language*
(RU/ET/EN) internally, so the combination with a viewport axis too would
have made the suite minutes slower for no new bugs caught. `visual.spec.ts`
is the deliberate exception — screenshot comparison *is* about viewport size,
so it is the one file that runs on all three projects, and it is scoped to
ET only rather than trilingual to keep that from tripling again on top.

## Visual snapshots

`e2e/__screenshots__/` holds the baseline PNGs (`toHaveScreenshot`,
`playwright.config.ts`'s `snapshotPathTemplate`). Two things are deliberately
generous about them:

- **Threshold** (`expect.toHaveScreenshot` in the config): `maxDiffPixelRatio:
  0.04`, `threshold: 0.25`, animations disabled. The two other agents working
  in this repo right now are actively editing `app.js`/`styles.css`, so a
  baseline made this session is a snapshot of a moving target on purpose —
  generous tolerance is what keeps normal ongoing UI work from failing this
  file on font/anti-aliasing noise while still catching a real layout break.
- **Per-platform baselines**: the path template includes `{platform}`
  (`process.platform`), so Windows and Linux never compare against each
  other's images. The baselines in this repo right now were generated on
  Windows (this session ran locally, not in CI). **The first CI run will not
  have a Linux baseline and will fail on all three `visual.spec.ts` tests for
  that reason alone** — this is expected, not a regression. Fix it once by
  running `npm run e2e:update` in the same environment CI uses (or download
  the artifact CI produces on that failing run, since `trace`/`screenshot` on
  failure are both captured) and committing the new
  `e2e/__screenshots__/**/*-linux.png` files. After that, CI compares
  Linux-to-Linux and the generous-but-not-infinite threshold above is doing
  real work again, not just papering over a font stack.

## What could not be automated, and why

- **`/api/assistant` admin-mode-without-cookie is a 401, literally.** The
  route checks `OPENAI_API_KEY` *before* it checks the admin cookie
  (`if (!key) return … 503`, first line of `POST`) — and this suite
  deliberately runs with no key at all, specifically so `chatbot.spec.ts` can
  see the assistant's own graceful "no key" behavior (chat.js's `probeAI()`
  falls back to a rule-based reply client-side and never even calls the POST
  route that would 503). With no key, the route refuses *everyone* — admin or
  not — with 503, which is a strictly stronger refusal than a 401 but not the
  status code the task names. `e2e/security.spec.ts` asserts the real 503
  behavior with a comment explaining why; `tests/assistant-admin-auth.test.ts`
  is a fast, isolated vitest that configures a (fake, fetch-mocked) key and
  proves the literal 401-without-cookie behavior the task asked for, without
  needing a second Playwright server running with a different environment
  just for one status code.
- **Montonio bank links / real card payments.** Out of scope by the task's
  own design — `PAYMENT_PROVIDER=mock` is what stands in, and
  `checkout.spec.ts` exercises the full order→pay→receipt path through it,
  both the paid and the failed branch. There is no sandbox Montonio account
  wired into this suite, so the *real* provider integration
  (`docs/payments.md` §5, "как проверить песочницу") stays a manual check.
- **Parcel-machine picker uses a live carrier feed.** With no Montonio keys
  configured, `GET /api/shipping/points/` falls through to Omniva's own public
  API live (`src/lib/parcel-points.ts`), bounded by an `AbortSignal.timeout`
  and backed by a committed seed on any failure — so `checkout.spec.ts`'s
  picker test is not hitting a fake, but it is one HTTP hop this suite does
  not fully control the timing or content of. Generous but bounded timeouts
  are used there rather than a fixed sleep.

## Files

| Path | What |
| --- | --- |
| `playwright.config.ts` | Projects, `webServer`, screenshot config — read its own comments first |
| `e2e/env.mjs` | Port, base URL, fixed test admin password + its hash |
| `e2e/fixtures.ts` | Shared constants/helpers every spec imports: `LANGS`, `PRODUCT`/`PRODUCT_2`/`BUNDLE`, `waitForScreen`, `loginAsAdmin`, `ipHeaders`, `tr()` (the RU→ET/EN dictionary lookups actually used, copied verbatim from `app.js`'s own `UI` table — see that file's own comment before adding to it) |
| `e2e/*.spec.ts` | One file per area of the task brief — each has its own top-of-file comment for anything not obvious from this document |
| `e2e/__screenshots__/` | Visual baselines — see above |
| `tools/e2e-build.mjs` | Cross-platform prebuild step for the suite — SEO prerender + generated-file packers, ahead of `next dev` (env vars via `child_process`, not shell syntax) |
| `tools/e2e-bootstrap.mjs` | Manual: migrate an already-running `npm run dev` server's in-memory database |
| `src/app/api/e2e/bootstrap/route.ts`, `src/app/api/e2e/gift-card/route.ts` | The two test-only routes — see above |
| `tests/account-code-e2e-hook.test.ts`, `tests/assistant-admin-auth.test.ts` | vitest backstops referenced above |
| `.github/workflows/ci.yml` | CI — see its own comments for the ~10 minute budget and what runs when |
