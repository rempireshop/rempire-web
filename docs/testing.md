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
test-only doors" below. WebKit is not installed on this machine
(`npx playwright install webkit` would add it); the config adds a
`webkit-local` project automatically when it detects it is, so
`npx playwright test --project=webkit-local` works the moment it exists —
CI stays Chromium-only regardless (`.github/workflows/ci.yml`).

Nothing is left running afterwards and nothing is written outside this repo:
the database is in memory, the app runs on port 3417 (picked to stay clear of
`npm run dev`'s 3300), and Playwright kills it when the run ends.

## The test-only doors, and why each is safe

Two environment variables and the routes they gate exist in this codebase
*only* for this suite, all named `e2e` or `E2E_*` so they are easy to find and
easy to be suspicious of:

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

2. **`E2E_BOOTSTRAP=1`** gates three routes:
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
   - `GET /api/e2e/mail/?template=…&to=…` — **is** behind `requireAdmin` too,
     for the same reason (it hands back customers' addresses). It reads an
     in-memory ring of the last 50 letters `sendMail()` was *asked* to send —
     recipient, subject and template tag, never a body — filled in
     `src/lib/mail.ts` behind the same two gates. It exists because the letters
     are owner-editable now (`settings.mail_texts`, docs/mail.md) and the only
     regression worth fearing is the preview and the real send drifting apart:
     with no Resend key there is no mailbox to check, no `mail_log` table
     (deliberately, docs/mail.md) and no screen that shows a subject line.
     `e2e/admin-mail.spec.ts` is the only caller.

   `tools/e2e-bootstrap.mjs` is a related but separate thing: a manual CLI for
   a *human* running `npm run dev` locally who wants the running dev server's
   in-memory database migrated (the same "separate process" problem as
   above, solved by logging in as admin over HTTP and calling the real
   `POST /api/admin/migrate`). Playwright does not use it.

Neither variable ever appears outside `playwright.config.ts`'s `webServer.env`
block. A production deploy sets none of them, and even a copy-paste mistake
that did would still be caught by the `NODE_ENV`/`requireAdmin` half of each
gate. `tests/fuzz-routes.test.ts` asserts exactly that for all three routes
("keeps all three e2e doors shut …").

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
`admin-shell.spec.ts` is the second: the panel's navigation is a *different
control* on a phone (a sticky bottom bar and an «Ещё» sheet) than on a laptop
(a foldable sidebar), and the owner's own machine is the phone — so that one
runs on desktop and mobile, and only that one among the admin specs.

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
  other's images. The baselines committed in this repo right now are Windows
  only (this session ran locally, not in CI) — there is no Linux baseline yet
  for any of the three `visual.spec.ts` tests.
  `toHaveScreenshot()` does not treat a missing baseline as "nothing to
  compare" — even in CI it writes the actual screenshot as a brand-new
  baseline and still fails the assertion ("A snapshot doesn't exist …
  writing actual"), which is not a real visual regression but reads as one on
  every single CI run until someone notices and commits the generated image.
  Each test in `visual.spec.ts` therefore calls `skipIfNoBaseline(testInfo,
  name)` first: under `process.env.CI`, if `testInfo.snapshotPath(name, {
  kind: "screenshot" })` — the same resolution `snapshotPathTemplate` drives —
  does not exist on disk yet, the test is skipped with a message naming the
  missing file, instead of failing. Local runs (no `CI` env var) are
  unaffected and keep comparing/writing exactly as before.
  **Generate the real Linux baselines once**, from CI itself or a Linux
  container — running `npm run e2e:update` from a plain Windows checkout
  cannot produce them, `{platform}` in the template always reflects the
  machine that ran it — and commit the resulting
  `e2e/__screenshots__/**/*-linux.png` files (the Windows ones stay; they are
  what this machine's own runs compare against). After that, CI compares
  Linux-to-Linux, `skipIfNoBaseline` never triggers again, and the
  generous-but-not-infinite threshold above is doing real work, not just
  papering over a missing file.

## Real bugs this suite found while being built

Four, all reported to the team as they were found — app.js/styles.css were
off limits while this suite was itself being built, per the brief — and all
four since fixed directly in those two files. Each has its own regression
coverage now instead of the workaround it briefly needed.

- **Reviews accordion collapsed shut on "Оставить отзыв."** `acc()` (app.js)
  always emitted `<details>` with no `open` attribute, and the review-form
  actions go through the general `render()` full-rebuild rather than a
  targeted patch — so the whole Reviews section visibly closed the moment a
  shopper clicked the button that was supposed to reveal the form. Fixed by
  persisting the accordion's own open state in `S.revAccOpen` — synced from
  the native `toggle` event, same idiom as the order summary's own
  `S.sumOpen`, and set explicitly by the actions that trigger a render — and
  rendering `open` from it in `acc()`. `e2e/product.spec.ts`'s reviews test
  now asserts `open` stays on `details.acc` throughout — and that focus
  lands in the name field right after «Оставить отзыв» — with no
  reopen-and-retry needed.
- **Pickup checkout could not complete.** The order payload's `customer.name`
  came from `S.ship.name`, which the UI never collected for the "Самовывоз"
  method (that field was only rendered for parcel/courier) — every pickup
  order 400ed with `bad_name`. Fixed by always rendering and requiring the
  contact block (name, e-mail, phone) regardless of delivery method
  (`shipRequired()` and the checkout step-2 body in app.js), leaving only the
  postal address courier-only. `e2e/checkout.spec.ts`'s "checkout — pickup"
  test drives a pickup order through the mock provider to a paid receipt.
- **A set in the cart did not survive a reload.** Restoring the cart from
  `localStorage` ran before `DEMO` was assigned (cart-restore is near the top
  of app.js; `var DEMO = {...}` is ~4700 lines later), and the restore filter
  called `bundleById()` → `allBundles()` → `DEMO.bundles` for any bundle
  line — throwing, which aborted the *whole* filter and emptied `S.cart`, not
  just the bundle line. Fixed by guarding `allBundles()` against `DEMO` not
  being initialised yet, plus a `try`/`catch` around the restore filter so a
  throw there can never again wipe a saved cart. `e2e/sets.spec.ts` now adds
  a product and a set, reloads for real, and checks both lines survive.
- **…and then it did not survive the sets moving into the database.** With the
  sets in `bundles` (docs/features.md), the restore filter's `bundleById()`
  check was worse than a throw: on a cold load the real list has not arrived
  from `/api/bundles/` yet, and the static `public/shop/bundles.js` the page
  ships with knows nothing about a set Renat made in the admin since the last
  deploy — so every such line was quietly dropped and the shopper's cart
  emptied. Fixed by not deciding at restore time at all: a bundle line is kept
  as it is, and `loadBundles()` prunes it once the answer lands — the only
  moment the shop can honestly say a set no longer exists. Caught by
  `e2e/admin-bundles.spec.ts`, which buys a set that exists only in the
  database.
- **Home page brand-strip text failed WCAG AA color contrast** (`#b0afa6` on
  white, 2.2:1 against a 4.5:1 requirement). Fixed by switching
  `.brandstrip__it` to the design system's own muted-text token
  (`var(--muted)`, ~5.4:1 on white) instead of the one-off
  `rgba(28,26,0,.35)` that flattened to it — same quiet grey, passing
  contrast. `e2e/accessibility.spec.ts`'s `home` test now passes.

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

## The storefront sweep

`e2e/sweep-storefront.spec.ts` (the crawl) and `e2e/sweep-checkout.spec.ts`
(the randomised cart/checkout) are a different shape from the rest of this
suite: instead of asserting one behaviour each, they walk *every* customer
screen in RU/ET/EN and hold each one to the same standing checks — no
`pageerror`, no `console.error` outside a tiny commented allowlist, no
`undefined`/`NaN`/`[object Object]`/`null`/`{{` visible anywhere, no
horizontal scroll at 375px, no Cyrillic left in the ET/EN chrome, an `alt` on
every `<img>`, no duplicate element ids, and every price in `eur()`'s exact
format. Shared plumbing is `e2e/sweep-shop-helpers.ts` (not a `.spec.ts`, so
Playwright never collects it); it also holds `SWEEP_SEED`, the one number that
makes the product picks and the ten random orders reproducible — every
assertion message ends with the screen, the language and that seed.

Both run on `--project=desktop` **and** `--project=mobile` (the crawl fully,
the checkout for its one layout test), which is the exception to
"most specs run on desktop only" above: the horizontal-scroll rule only means
anything on a phone. The crawl navigates client-side through the app's own
`popstate` router rather than reloading for each of ~250 screens — a cold load
re-parses 845 KB of `app.js` plus the catalogue — and still does a real
`page.goto` for one screen of each kind per language, so the boot path stays
covered.

One environment note: `next dev` serves this suite, and every `next dev` in
this checkout shares one `.next` directory. With a second dev server running
(someone's `npm run dev`, or another agent's own Playwright run), a route
manifest rebuild can make unrelated API routes answer 404 or 500 for a few
seconds — which the sweep correctly reports as a console error on whichever
screen was in flight. If a sweep run fails only on `/api/track/`,
`/api/overrides/` or `/api/reviews/` with a 404/500, check for a second
`next dev` before looking for a bug.

## The blog editor (`e2e/admin-blog.spec.ts`)

Desktop-only, four tests, ~25 s. The admin's article body is a
`contenteditable` (docs/blog.md), so this spec drives it the way a person
does — click into the box, type, press a toolbar button — and then reads the
published article back off the storefront: a heading, bold, a list, a
picture and the inline product card that `<a data-product>` becomes.

Three things about it that are not obvious and are worth keeping:

* **Order of the steps is deliberate.** «Картинка» and «Товар» go first, into
  an empty box: both leave the caret in a fresh paragraph of their own. The
  three formatting buttons follow, and the list is last. Browsers genuinely
  disagree about what Enter does at the end of a heading and at the end of a
  list item, and this order never has to care. The one place it cannot be
  avoided — the line after the heading — toggles «Заголовок» back off if the
  heading stuck, and asserts the count either way.
* **`execCommand("bold")` writes `<b>` in Chromium**, not `<strong>`. That is
  fine and expected: the allowlist maps it on save, so the box is asserted
  for `strong, b` and the *stored* HTML for `<strong>`.
* **The pasted picture URL is a local `/shop/img/…` path**, not an
  `https://example/…` one. An unreachable host makes the browser log a
  network error, and `assertClean()` fails on it — correctly. The https
  branch (and the refusal of `http:` and `javascript:`) is unit-tested in
  `tests/blog.test.ts` instead.

The same file also covers the three sample articles seeded by
`db/migrations/071_blog_samples.sql` — listed and readable in all three
languages, and one of them read in full on desktop and at 375 px. **A new
migration needs `npm run pack:migrations` before it exists for this suite:**
the server applies migrations from the committed
`src/db/migrations.generated.ts` (via `/api/e2e/bootstrap/`), and `next dev`
never regenerates it. A sample-post test failing with "missing from the feed"
almost always means that command was not run.

The escaping half of the blog stays in `e2e/sweep-admin-ops.spec.ts` — it
types the HTML bomb into the box rather than filling a textarea now, and
asserts the shop prints it instead of running it.

`[data-co-delivery]` carries `data-points-loading="N"` — the number of
carrier feeds still in flight for the selected country (`pointsLoadingCount()`
in app.js). The checkout sweep waits for `0` before touching the delivery
radios: every feed that lands re-patches the block, and on a slow runner that
went on longer than Playwright's actionability wait.

## The admin shell (`e2e/admin-shell.spec.ts`)

The redesigned panel's own information architecture, and the only admin spec
that runs on **both** projects — the point of the redesign is that Renat works
from an iPhone, so the phone half is the half worth testing
(docs/design/admin-handoff-README.md, docs/features.md § «Админка»).

Six tests: the phone's sticky 64-px bottom bar and its «Ещё» sheet; the desktop
sidebar folding 232 → 68 px; **all thirteen old tab keys still opening their
section** (that matrix is the contract the assistant's «Открыть …» buttons and
the rest of this suite depend on); the assistant opening from its floating
button, answering and folding away; «Обзор» counting a real paid order into
«Сделать сегодня» with the right plural; the «Заказы» chips plus the ship flow
end to end (confirm card → toast with «Отменить» → a line in the journal); and
the «Склад» ± stepper with its undo.

Two things about locators, both consequences of the redesign:

* **Both navs are always in the DOM** — the desktop sidebar and the phone
  bottom bar — with one hidden in CSS. Every nav locator therefore ends in
  `:visible`, including `loginAsAdmin` (`e2e/fixtures.ts`) and `tab()`
  (`e2e/sweep-helpers.ts`).
* **Seven old keys are sub-tabs now**, so reaching one is two clicks:
  `tab()` knows the map (`SECTION_OF`) and does both, which is why every
  existing `tab(page, "stock")` / `"reviews"` / `"mail"` call site still reads
  the same.

The stepper test leaves `PRODUCT_2` counted at 500 in a `finally`-shaped tail,
for the same reason `sweep-admin-ops.spec.ts` does: the first ± is what makes a
variant *counted* at all, and from then on every spec that buys it decrements
the same number.

## The product editor (`e2e/admin-editor.spec.ts`)

The other spec that runs on both projects, for the same reason: the editor is
five tabs over one form, and a phone is where the owner uses it.

The shape it pins is the one the redesign changed. **Every pane is in the DOM
at once and the inactive ones carry `hidden`** — so a spec that types into a
field must open that field's tab first, which is what the local `edTab()`
helper does (and why `openGoods()` in `sweep-admin-goods.spec.ts` now lands on
«Размеры и цены» rather than assuming `[data-edprice]` is on screen). One
assertion exists purely for that mechanism: type into «Google», look at
«Основное», come back, and the text is still there. It is the reason the panes
stay mounted — the form keeps no draft in `S` and reads every field off the
DOM at save time — so a regression there is silent data loss, not a cosmetic
bug.

The end-to-end half saves a size price, a salon price, a stock count and a
barcode with **one** press of «Сохранить», then reads all four back from three
different places: `/api/overrides/` and the real product page for the price,
`/api/admin/inventory/` and the «Склад» tab for the count and the code. The
stock travels as a relative move, so the count is asserted as a delta — same
rule as `scanner-app.spec.ts`, same `PRODUCT_2`, and the `finally` puts the
price back and leaves the shelf at 500.

The destructive slot is «Снять с продажи», not «Удалить»: a catalogue product
has no DELETE route (docs/features.md § «Товар»). The test walks it through
the confirm card both ways — «Отмена» leaves the editor open and changes
nothing, «Снять» toasts with an «Отменить» that really puts the product back
on sale.

## The «Ещё» sections (`e2e/admin-sections.spec.ts`)

The third spec that runs on **both** projects, and for the plainest reason:
the reviews queue, the letters and the change journal are what Renat opens on
his phone. One test walks every one of the six sections on whichever viewport
it is running, asserting three things per screen — the section's own content is
on it, nothing spills sideways (`scrollWidth - clientWidth <= 1`, because a
panel that scrolls horizontally is a panel whose bottom bar cannot be tapped),
and no `pageerror` fired along the way.

The other four tests are one real, server-verified action each, because a
screen that draws but whose buttons do nothing is the failure this file exists
to catch: a Pro request approved **from the row** (the point of the redesign) and
read back off `/api/admin/customers/`; a review published, its undo offered on
the toast and its line found in the journal; a promo code created; 75 €
switched on and then found on `/gift/` **in a fresh browser context** (same
cache reason as `admin.spec.ts`'s `freshStorefrontPage()`); a letter's subject
saved through the confirm card and read back out of `settings.mail_texts`; a
post published and withdrawn; a delivery tariff changed through the confirm
card and taken back from the journal.

Those four are desktop-only (`test.skip` on the mobile project): one write per
action is enough, and every one of them mutates shop-wide state that other spec
files read. Each `describe` has its own fake IP — admin login is 5/min.

Its own local `section()` helper knows the one navigation difference between
the viewports: all six of these live in the desktop sidebar but behind the
phone's «Ещё» sheet, so on 375 px it opens the sheet first. It waits for
whichever nav this viewport draws before counting — after a reload the shell is
a frame or two behind, and an immediate count of zero sent a desktop run
looking for a button that is not there.

## The admin fuzz sweep

`e2e/sweep-admin.spec.ts` (sign-in, the tab matrix — every old section key,
`gift` included since phase 3, asserted through the new five-place IA —
banner, content, settings, the change journal), `e2e/sweep-admin-goods.spec.ts` (goods editor, delivery
prices, promo codes) and `e2e/sweep-admin-ops.spec.ts` (warehouse, register,
customers, blog) are one exploratory sweep split three ways for runtime —
19 tests, ~3 minutes, desktop only. They share `e2e/sweep-helpers.ts`, which
is where the interesting part lives: every step ends in `assertClean()`, which
fails on an uncaught page error, on any `console.error` outside a four-entry
allowlist, on any 5xx, on a visible `undefined`/`NaN`/`[object Object]`/`null`/
`{{`, and on a duplicate element id. Product samples come from a seeded PRNG
(`prng(20260904)`), so a failure names the same five products next time.
`PRODUCT`/`PRODUCT_2` are excluded from that sample and every test reverts what
it changed, same discipline as `admin.spec.ts`. Run it with
`npx playwright test e2e/sweep-admin*.spec.ts --project=desktop`.

**Where the settings cards live now.** Phase 3 turned «Настройки» into an
index of six sub-pages, so `openSettings(page, sub)` in `sweep-helpers.ts`
takes the page it wants: `home` (the banner, the announcement bar and the
sets/chat switches), `company` (the shop's own details and the reports card),
`delivery` (the tariff grid — and its «Сохранить» goes through the confirm
card now), `prices`, `langs`, `journal`. The two shop-wide switches are
`<button aria-pressed>` rather than links whose label flips, so a test that
wants to know their state reads the attribute.

## Наборы: the two specs

`e2e/sets.spec.ts` covers the shopper's side in all three languages (the sets
landing, one set's page, add to cart, the checkout line breaking out the
components) and then, in its own `test.describe`, the **switch**: with
«Наборы на сайте» off, nothing about sets may be left anywhere — no nav entry,
no footer link, no home rail, no catalogue rail, no `[data-go-bundle]` in
«с этим покупают» or in the search, and no «Наборы» crumb on the gift-card page
(the gift card itself stays reachable — it is not a set). Both `/shop2/sets/`
and `/shop2/set/<id>/` must still answer, with «Наборы сейчас недоступны»
rather than a 404 or a silent bounce home. The last part of that test seeds a
saved cart into `localStorage` (`rempire-shop-proto`, the key app.js persists
to) and pays for it: hiding the shelf must not take a basket away from
somebody standing at the till. It flips a shop-wide switch, so it puts it back
in a `finally`, same rule as `admin.spec.ts`.

`e2e/admin-bundles.spec.ts` covers the owner's side: build a set from two
products in «Товары → Наборы», see it on `/shop2/sets/`, buy it and check the
total is the set's own price plus delivery; change the price and watch the
storefront follow; be refused when the set is not cheaper than its parts; hide
it (off the shelf, address still answering); delete it (with the confirm strip
first). Serial, desktop only, and each test has its own fake IP through its own
nested `describe` — the file signs in six times and admin login is 5/min per
IP. The set it creates (`e2e-set`) is deleted by the fifth test, so the file
leaves the shop with exactly the sets it started with.

Run either with
`E2E_PORT=3444 npx playwright test e2e/sets.spec.ts --project=desktop`.

Note for whoever runs these locally: the suite's `next dev` writes to `.next`,
so a second Next process started against the same checkout (another agent, a
stray `next dev`, a `next build` running alongside) corrupts it and the server
starts answering 404/500 for routes that are perfectly fine. If specs fail at
`loginAsAdmin` or a route that passed a minute ago, check for a second
`next` process before looking at the code.

## The gift card: the digital checkout and the PDF (`e2e/giftcard.spec.ts`)

Three per-language tests (buy a card, read its code back through the test-only
lookup, redeem it on a second order) plus one Russian-only test for the shape of
an all-gift-card checkout and the printable card:

* step 2's header reads **«Получатель»**, and inside it there is no country
  select, no `[data-dm]` method, no `[data-pointopen]` and no `[data-shipf="addr"]`
  — the assertions are `toHaveCount(0)`, because "the field is not there" is the
  feature, not "the field is empty";
* «отправить мне на почту, а не получателю» (`[data-gifttome]`) is **checked** on
  arrival; the test unchecks it and fills `[data-giftto="email"]`, which is the
  path where the address is required;
* the summary carries one delivery row saying «Электронная доставка» and *not*
  «Доставка — …», and the total is the card's face value with nothing added;
* the receipt shows `[data-giftpdf]` — «Скачать подарочную карту (PDF)». Its
  `href` is fetched **with the page's own request context** (`page.request.get`),
  which is the only way to assert on a response the browser would hand to a PDF
  viewer: 200, `application/pdf`, and the bytes really start `%PDF-`. The same
  URL with the token replaced answers 404;
* then the owner's side, in a second browser context so the shopper's cookies
  are untouched: the order card says «Электронная доставка» with the recipient's
  address under it, has no delivery row in «Состав», and offers the card's PDF.

`payOrder()` from `fixtures.ts` cannot drive this checkout — it fills a courier
address, and here those fields do not exist — so the spec has its own
`payDigitalOrder()`. That is also why the three per-language tests changed: an
all-gift-card basket has taken the delivery step away from them too.

Unit backstops, none of which need a browser: `tests/orders-digital.test.ts`
(delivery priced 0, `not_digital` refused, a mixed basket unchanged),
`tests/giftcard-pdf.test.ts` (the token, and the PDF read back — see below) and
`tests/giftcard-mail-pdf.test.ts` (the letter's attachment, the e2e sink's
record of it, and the download route's 200/404).

**How «the text is really on the card» is tested.** `tests/giftcard-pdf.test.ts`
carries about fifty lines of PDF reader: inflate every stream in the file, pair
each embedded font with its `/ToUnicode` CMap through the font dictionaries, then
decode the `<hex> Tj` runs of the page's content stream with the CMap of whatever
`Tf` selected. That is a real extraction — it catches a wrong date, a lost code
and a Cyrillic glyph that came out as `.notdef`, none of which an assertion on
the file's length would. A second test reads every `Tm` baseline back and checks
it sits inside the printable inset, in all three languages and with a message
long enough to wrap: that is the guard against a layout that runs off the sheet.

The mail sink (`src/lib/mail.ts`, read back through `GET /api/e2e/mail/`) records
attachment **names** alongside the recipient, subject and template — never the
bytes, same rule as the body.

## Files

| Path | What |
| --- | --- |
| `playwright.config.ts` | Projects, `webServer`, screenshot config — read its own comments first |
| `e2e/env.mjs` | Port, base URL, fixed test admin password + its hash |
| `e2e/fixtures.ts` | Shared constants/helpers every spec imports: `LANGS`, `PRODUCT`/`PRODUCT_2`/`BUNDLE`, `waitForScreen`, `loginAsAdmin`, `ipHeaders`, `tr()` (the RU→ET/EN dictionary lookups actually used, copied verbatim from `app.js`'s own `UI` table — see that file's own comment before adding to it) |
| `e2e/*.spec.ts` | One file per area of the task brief — each has its own top-of-file comment for anything not obvious from this document |
| `e2e/scanner-app.spec.ts` | The standalone scanner route `/shop2/scan/`, desktop + mobile — see below |
| `e2e/sweep-helpers.ts` | The admin sweep's watchdog (`assertClean`), seeded PRNG and admin plumbing — not a spec file |
| `e2e/__screenshots__/` | Visual baselines — see above |
| `tools/e2e-build.mjs` | Cross-platform prebuild step for the suite — SEO prerender + generated-file packers, ahead of `next dev` (env vars via `child_process`, not shell syntax) |
| `tools/e2e-bootstrap.mjs` | Manual: migrate an already-running `npm run dev` server's in-memory database |
| `src/app/api/e2e/bootstrap/route.ts`, `src/app/api/e2e/gift-card/route.ts`, `src/app/api/e2e/mail/route.ts` | The three test-only routes — see above |
| `e2e/giftcard.spec.ts` | The gift card: three languages of buy → issue → redeem, plus «Электронная доставка» and the printable PDF — see above |
| `tests/giftcard-pdf.test.ts`, `tests/giftcard-mail-pdf.test.ts`, `tests/orders-digital.test.ts` | The card as a file, the letter that carries it, and the order that pays no delivery |
| `e2e/sets.spec.ts`, `e2e/admin-bundles.spec.ts` | The sets: the shopper's side plus the «Наборы на сайте» switch, and the owner's «Товары → Наборы» CRUD — see above |
| `e2e/admin-shell.spec.ts` | The redesigned panel's shell: five places, the phone bar and «Ещё» sheet, the sidebar fold, all thirteen old tab keys as deep links, the assistant FAB, the confirm card, the toast's undo — see above |
| `e2e/admin-editor.spec.ts` | The redesigned «Товар»: five tabs, the sticky save bar, a size price + salon price + stock + barcode saved once and read back from the shop, «Склад» and the inventory route, and the destructive action through the confirm card — see below |
| `e2e/admin-mail.spec.ts` | «Письма»: the owner edits an ET subject and intro, applies, and the same text comes back out of the preview **and** out of a real paid order's confirmation (docs/mail.md) |
| `e2e/admin-sections.spec.ts` | The six «Ещё» sections after the phase-3 redesign: every one drawing on desktop **and** on a phone with no page error and no sideways scroll, plus one real action each — approve a Pro request from the row, publish a review with its undo, create a promo code, switch a gift denomination on and see it on `/gift/`, save a letter's subject, publish a post, change a tariff through the confirm card and take it back from the journal — see above |
| `e2e/blog.spec.ts` | The storefront blog, desktop **and** mobile: tiles show the pointer, an article's crumbs start where the listing's do and its product cards keep their foot row whole (ET), and home → Blog → article paints from the idle prefetch / sessionStorage while `/api/blog/` is held for 4 s (docs/blog.md «Откуда берутся данные») |
| `tests/account-code-e2e-hook.test.ts`, `tests/assistant-admin-auth.test.ts` | vitest backstops referenced above |
| `.github/workflows/ci.yml` | CI — typecheck + unit tests in one job, the e2e suite sharded into 3 parallel jobs (each with its own server and database); see its own comments |

## Фаззинг API (`tests/fuzz-*.test.ts`)

Отдельный слой поверх обычных unit-тестов: он не проверяет, что маршрут делает
правильно, — он проверяет, что **никакой** запрос не может его сломать. Всё
внутри `npm test`, PGlite, без сети, ~25 секунд.

| Файл | Что делает |
| --- | --- |
| `tests/fuzz-harness.ts` | Общая оснастка: корпус «злых» значений, сборка запросов, проверки ответа, заглушка `fetch`, фикстуры (заказ, клиент, статья, отзыв, промокод, подарочная карта) |
| `tests/fuzz-routes.test.ts` | Каждый маршрут `src/app/**/route.ts` — `/api/**`, страницы товаров `/shop2/{,et/,en/}p/[id]/` и `/sitemap-custom.xml`, — каждый экспортируемый метод |
| `tests/fuzz-money.test.ts` | Инварианты денег и склада через настоящие маршруты |

**Детерминированность.** Корпус фиксированный, а не случайный: те же значения в
том же порядке на каждой машине, поэтому падение воспроизводится со второго
запуска без ярлыка «мигает». Там, где полный корпус на каждое поле был бы
слишком долгим, берётся окно из восьми значений, сдвинутое по номеру поля
(`window()`), — маршруты про деньги (`deep: true`) всё равно видят корпус
целиком.

**Что бросается в каждый маршрут.** Пустое тело, пустая строка, битый JSON,
`null`/число/строка/массив вместо объекта, тело на 2 МБ, объект глубиной 120,
чужой `content-type`; каждое поле (и вложенное — `customer.name`,
`items.0.qty`) по очереди заменяется на `null`, число вне диапазона `double`,
пустую строку, строку в 10 000 знаков, эмодзи + RTL + zero-width + NUL,
`<script>`, `'; DROP TABLE orders; --`, `../../etc/passwd`, `javascript:`,
`=cmd|' /C calc'!A0`, почту-мусор; каждый `[id]` — на неизвестный,
отрицательный, огромный, не-uuid, с URL-кодированными слэшами; параметры
запроса — дублированные, огромные, `limit=0/-1/1e9`.

**Что утверждается на каждом ответе** (`checkResponse`):

- **нет 5xx.** База поднята, все внешние сервисы заглушены — значит
  единственный законный 5xx это «в этом деплое нет ключа» (503
  `not_configured` / `no_api_key` / `storage_not_configured`, 501
  `not_implemented`). `db_unavailable` и `server_error` в этом наборе всегда
  означают баг: запрос дошёл до Postgres в виде, который тот отказался
  выполнить;
- **нет стектрейса**: ни строки `at …`, ни `node_modules/`, ни абсолютного
  пути в теле ответа;
- **4xx — это `{ok:false, error:"код"}`**, а не текст для человека;
- обработчик, который **бросил** исключение, — тоже нарушение: `call()` ловит
  его и записывает как 599, чтобы один прогон нашёл все такие места сразу, а
  не падал на первом.

**Замки.** Отдельные тесты проходят по всем маршрутам с `auth` и требуют
401/403 без куки, с мусорной кукой (`rmp_admin=%`), с подделанной подписью, с
истёкшей сессией, с покупательской кукой на админском маршруте и наоборот
(`rmp_cust` и `rmp_admin` подписаны под разными префиксами — см.
`src/lib/customers.ts`); cron — без заголовка, с чужим секретом, без `Bearer`
и при вовсе не настроенном `CRON_SECRET`. Две структурные проверки не дают
набору отстать от кода: «фаззится каждый маршрут на диске» сверяет таблицу с
`src/app/api/**`, а «заперт каждый маршрут под `/api/admin/`» читает файлы и
требует `requireAdmin` везде, кроме `login`/`logout`/`me`/`mail/preview`.

**Деньги и склад** (`fuzz-money`) проходят весь настоящий путь — `POST
/api/orders/` → `POST /api/payments/create/` → `POST /api/payments/notify/` с
настоящим подписанным билетом mock-провайдера — и утверждают: цену считает
сервер, а не браузер; количество вне 1…99 отклоняется, а не обрезается; скидка
может обнулить заказ, но не увести его в минус; подарочная карта списывается
ровно один раз и никогда ниже нуля; промокод считается только на переходе в
`paid`; баллы не превышают `redeemMaxPct`; повторный вебхук ничего не проводит
второй раз, а поздний `failed` не снимает `paid`; склад не уходит в минус;
`settings.pricing` зажимается; лимиты отвечают 429 и не задевают второй IP.

**Заглушка сети.** `installFetchStub()` отвечает за OpenAI, Resend, Telegram,
R2 и перевозчиков; неизвестный хост не набирается, а записывается — отдельный
тест требует, чтобы список остался пустым. Переменные окружения ставятся на
время файла и возвращаются в `afterAll` (`setFuzzEnv()` отдаёт функцию
восстановления): vitest гоняет файлы последовательно в одном процессе, и
оставленный `RESEND_API_KEY` поменял бы то, что видит следующий файл.

## PWA manifests (`e2e/pwa.spec.ts`)

Three tests: the storefront links the shop manifest
(`/shop2/manifest.webmanifest`, name «Rempire», scope `/shop2/`, no admin or
scanner wording anywhere in it) while all three manifests are fetched and
checked for distinct ids; the admin route swaps the `<link rel="manifest">`
to `/shop2/admin.webmanifest` («Админка», scope `/shop2/admin/`) and back when
the owner returns to the shop; and `/shop2/scan/` swaps to
`/shop2/scanner.webmanifest` («Сканер», scope `/shop2/scan/`) for a stranger
too — the swap has to happen *before* the login, or the owner could not
install the app and then sign in inside it — while the screen behind it is the
admin login card, and signing in there raises the scanner in place. See
`syncAppManifest()` in app.js and the PWA section of docs/inventory.md for why
there are three apps at all.

## The scanner app (`e2e/scanner-app.spec.ts`)

One test, desktop **and** mobile — the route exists for a phone, so it is
tested on one. It walks the two jobs the owner's «Сканер» icon exists for, in
one pass: an unknown code → «К какому товару?» → search «tangled» → one tap on
the flat `PRODUCT_2 | 40 мл` row (`data-scanbind`, the redesign's one-tap
bind) → bound; then the same code again → the product card → «+» «+» →
«Принять +3» → the toast says «Приход +3 ✓», the card comes back with the new
remainder («на складе N») and the stepper back at 1, `/api/admin/inventory/`
holds three more than it did, and the «Склад» tab — searched by the barcode
itself, which also proves the binding stuck — shows the same number. The two
action buttons are asserted to carry the stepper's number, because they are
patched in place rather than repainted (`scanPaintLabels()`) and a label that
drifted from the number would be a lie about what the tap is going to do.

Headless Chromium has no camera, so it drives the manual-entry field. That is
not a workaround for the test's benefit: it is the same door a bluetooth/USB
handheld scanner types into and the one the owner falls back to on a scuffed
label, and everything downstream of "a code arrived" (`handleScanCode()`) is
shared with the camera path.

The count is asserted as a **delta**, never as an absolute: `PRODUCT_2` is the
one fixture product the suite is allowed to count (fixtures.ts), and
`sweep-admin-ops.spec.ts` sets absolute values on the same row. A fresh
`Date.now()`-derived EAN per run keeps the two from ever colliding on
`ean_taken`.

Do not use `clearToast()` from `sweep-helpers.ts` while the scanner overlay is
up unless the toast is above it — `.scanoverlay` is `--z-scan: 95` and the
toast is 70. It *is* above it now (`body.is-scanning .toast`, added with this
route because a confirmation the owner cannot see is not a confirmation), and
that is worth knowing before someone lowers it again.
