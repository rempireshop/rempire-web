# rempire-web

The REMPIRE shop is a grooming shop and salon in Tallinn (owner: Renat). This
repository is the storefront and the owner's admin panel, in one Next.js 15
project. It has been **live at `https://rempireshop.com` since 08.10.2026,
22:55**, when it replaced the Shopify shop on the same domain. It answers on
Shopify's old address scheme: English with no prefix, then `/ru/…` and
`/et/…`. Old links and search results therefore still land on the right page.
Shopify itself was closed on 29.10.2026.

`rempireshop.diipsolutions.eu` is the same deployment under the current
developer's (Dim's) own domain. It now serves only `/handover`, the panel and
the API. Every shop page there answers with a 301 to rempireshop.com
(`next.config.ts`).

**Start here**

| | |
|---|---|
| [`docs/SYSTEM-MAP.md`](docs/SYSTEM-MAP.md) | Every system: what it is for, how it works, how it is tested, and its state |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | What to do when something breaks, step by step |
| [`docs/accounts.md`](docs/accounts.md) | Every external service, who owns it, who pays for it |
| [`docs/changelog.md`](docs/changelog.md) | What changed since launch, week by week |
| [`docs/GLOSSARY.md`](docs/GLOSSARY.md) | One agreed name per thing (Russian UI terms) |

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15.5 App Router, serverful. A static export is not possible: there are API routes, middleware and request-time pages. |
| UI | **One hand-written vanilla-JS single-page app**, `public/shop2/app.js` (about 60 000 lines), for both the storefront and the admin. It has its own `styles.css`, `admin.css` and `chat.js`, and no framework or bundler. Browsers download `app.min.js`, the same file with comments and indentation stripped (`tools/minify-shop2.mjs`). There are no React pages. `src/app/layout.tsx` exists for the day one is added. |
| Server | 104 API route handlers under `src/app/api/**`, request-time pages (products, blog, OG cards, sitemaps, feeds), and `src/middleware.ts` |
| Language | TypeScript in `src/**`. Plain ES5-style JS in `public/shop2/*.js`. Node ESM `.mjs` in `tools/**`. |
| Database | Postgres 18 on Railway via `src/lib/db.ts` (`pg`). Every test runs on PGlite in memory (`DB_DRIVER=pglite`). |
| Hosting | Vercel, project `rempire-web`, team «Rempire», functions in `fra1` (`vercel.json`). On the Pro plan since 03.11.2026. |
| Styling (Next side) | Tailwind CSS 4 is installed for the Next side. The shop's CSS is hand-written. |
| Package manager | npm (`package-lock.json`). CI runs `npm ci` on Node 22. |

## Running it locally

```bash
npm ci
npm run dev          # http://localhost:3300 — the English home page; predev minifies app.js first
npm run typecheck
npx vitest run tests/<file>.test.ts   # one unit-test file (the whole suite is slow, see Tests)
```

Put local settings in `.env.local`. It is git-ignored, and so is every
`.env*` file. **Never commit or paste values.**

- **No database at all.** The storefront still renders from the static
  catalogue files. Routes that need the database answer 503 `db_unavailable`.
  `app.js` falls back to its local copy and shows the demo panel when no API
  answers at all.
- **A throwaway in-memory database.** In `.env.local`, set `DB_DRIVER=pglite`,
  `E2E_BOOTSTRAP=1`, a `SESSION_SECRET` of at least 16 characters, and an
  `ADMIN_PASSWORD_HASH` made with `node tools/hash-password.mjs`. Start
  `npm run dev`, then open `http://localhost:3300/api/e2e/bootstrap/` once to
  migrate it. That route works only when `NODE_ENV` is not `production` and
  `E2E_BOOTSTRAP=1`. Alternatively, run `node tools/e2e-bootstrap.mjs`, which
  signs in and calls `POST /api/admin/migrate`. The data lives as long as the
  dev process does. To persist it, set `PGLITE_PATH` to a folder.
- **The live database.** Avoid it. If you must, read `docs/backend.md`
  («TLS to the database») first. `tools/db-backup.mjs` and
  `tools/rotate-db-password.mjs` each explain how to pass `DATABASE_URL`
  through a temporary `.env.*.txt` file that you delete afterwards.

Windows notes: the project is developed on Windows. Scripts are Node, not
`VAR=value cmd`, so they work in `cmd.exe`, Git Bash and CI alike. Never run
two `next dev` servers in one checkout, because they corrupt the shared
`.next` folder. A Playwright run you stopped halfway can leave `next dev`
alive on port 3417, and then every page answers 500. Kill it before the next
run.

## Scripts (`package.json`)

| Script | What it does |
|---|---|
| `dev` | `next dev --port 3300`. `predev` runs `tools/minify-shop2.mjs` first. |
| `build` | `next build`. `prebuild` and `postbuild` run around it (see Deploy). |
| `start` | `next start --port 3300` |
| `typecheck` | `tsc --noEmit` |
| `test` | `vitest run`, the whole unit suite on PGlite |
| `e2e` / `e2e:ui` / `e2e:perf` | `node tools/e2e-build.mjs`, then Playwright: the suite, the UI mode, or the two `perf-*` stopwatches (`playwright.perf.config.ts`) |
| `smoke` | `node tools/smoke.mjs <base-url>`: the read-only suite against a deployed shop. **No default target.** |
| `minify` | `app.js` → `app.min.js`, plus the lifted dictionaries `ui.et.js` and `ui.en.js` |
| `prerender` / `prerender:check` | Write the static shop pages (`tools/prerender-shop2.mjs`), then check them off disk (`tools/check-prerender.mjs`) |
| `migrate` | Apply `db/migrations/*.sql` to `DATABASE_URL`. Use `DB_DRIVER=pglite` for a throwaway run. |
| `pack:migrations` / `pack:content` / `pack:legal` / `pack:feed` | Regenerate committed generated files: `src/db/migrations.generated.ts`, `src/data/content.default.json`, the legal fallback, and `src/data/catalogue.feed.json` |
| `feed:squares` | Put narrow product photos onto white 500 px+ squares for Google (`public/shop/img/sq/`, `src/data/feed-squares.json`). **Run it after changing any photo in `public/shop/img/`.** |
| `cards:snapshot` | Copy the live `/shop/search-terms.json` to `tests/fixtures/` for the search tests |
| `i18n:gaps` | `tools/i18n-gaps.mjs`. It must print 0: every Russian UI string needs an ET and an EN entry. |
| `build:variants` / `build:bundles` | Regenerate `src/data/catalogue.variants.json` and the static sets file |
| `seed:stock` | `tools/seed-stock.mjs`: create stock rows for EANs |
| `delivery:pricing` / `montonio:routes` | Delivery-price research tools (`docs/delivery-pricing.md`, `docs/montonio-routes.md`) |

Other tools you will need (`node tools/<name>.mjs`):

- `hash-password`: makes `ADMIN_PASSWORD_HASH`.
- `db-backup`: a local `pg_dump` through Docker.
- `rotate-db-password`: changes the Postgres role's password.
- `montonio-live-check`: GET-only checks of the live Montonio account.
- `montonio-webhook`: list, register or delete the parcel webhook.
- `indexnow-submit`: submit the sitemap to IndexNow.
- `chaos-build`: replays 30 owner-style edits on a data snapshot, then builds and checks.
- `check-legacy-redirects`: walks old Shopify URLs.

The catalogue builders (`build-catalogue-full`, `assemble-translations`,
`cut-new-images`, `refit-cutouts`, `normalise-brandlogos`, and the `recut-*.py`
scripts) hard-code paths on Dim's machine. They are one-person tools.

## Environment variables

Names only. Values live in Vercel (rempire-web → Settings → Environment
Variables, Production). Changing a value needs a **Redeploy** before it takes
effect. The «In production» column is what the handover notes say as of
05.11.2026, not something the repository can show, so check it in Vercel.

| Name | What it is for | In production |
|---|---|---|
| `DATABASE_URL` | Postgres (Railway's public `DATABASE_PUBLIC_URL`). Orders, customers, the owner's edits, settings. The build also reads it: the prerender exports, plus `postbuild` migrations. | set |
| `DATABASE_SSL_CA` | PEM of Railway's private CA, so the TLS certificate is verified (`docs/backend.md`) | not set |
| `DATABASE_SSL_NO_VERIFY` | `1` = TLS without certificate verification. A fallback; replace it with `DATABASE_SSL_CA` (RUNBOOK §9). | set |
| `DATABASE_POOL_MAX` | Connections per instance (default 5) | — |
| `SESSION_SECRET` | ≥16 chars. Signs the admin cookie `rmp_admin`, the customer cookie `rmp_cust`, the Claude connector's OAuth tokens, the links in letters (unsubscribe, cart resume), the gift-card PDF links, the order-status token, and the Google sign-in state. It also salts review IP hashes. Rotating it has side effects (RUNBOOK §9). | set |
| `ADMIN_PASSWORD_HASH` | The one admin password, as a scrypt digest from `tools/hash-password.mjs`. Changing it also signs out the Claude connector. | set |
| `PUBLIC_BASE_URL` | Absolute links in letters, payment return URLs, the robots/noindex choice, the prerender base | `https://rempireshop.com` |
| `CRON_SECRET` | Bearer token Vercel Cron sends to `/api/cron/*`. Without it those routes answer 503. | set |
| `DEPLOY_HOOK_URL` | Vercel Deploy Hook on branch `production`. The nightly rebuild and the owner's publishes use it (`src/lib/rebuild.ts`). | set (hook «rebuild-production») |
| `PAYMENT_PROVIDER` | `montonio`, or `mock` for tests only. Unset means Montonio when its keys exist, otherwise payments are off. | `montonio` |
| `MONTONIO_ACCESS_KEY` / `MONTONIO_SECRET_KEY` / `MONTONIO_ENV` | Montonio payments **and** shipping. `MONTONIO_ENV=live` or `sandbox`. | live keys, `live` |
| `SHIPPING_PROVIDER` | `mock`, for tests only. Refused when `NODE_ENV=production`. | — |
| `DPD_API_USER` / `DPD_API_PASS` | Optional DPD pickup-point fallback | verify |
| `RESEND_API_KEY` | All e-mail | set |
| `RESEND_FROM` | Sender. Default `Rempire <shop@rempireshop.com>`. | default |
| `MAIL_REPLY_TO` | Reply-to. Default `info@rempireshop.com`. | set |
| `RESEND_TO` | The shop's own mailbox for the owner's «new order» letter (a fallback when no phone took the push), the hide-watch letter and the Monday content report. **No default:** unset means none of these is sent, and «Обзор» shows a warning. | `shop@rempireshop.com` expected, verify |
| `DEV_ALERT_TO` | Developer alerts: failed or missing builds, no backup for 36 h, mass hides, the Monday report copy. Default `info@diipsolutions.eu`. | default |
| `MAIL_PENDING_PAYMENT` / `MAIL_RETRY_DELAY_MS` | Send the «awaiting payment» letter at order creation; mail retry delay | — |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Owner's order ping to Telegram (`src/lib/notify.ts`) | set (bot is Renat's) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push to the owner's phone. The two keys are a pair from `npx web-push generate-vapid-keys`; replacing them drops every subscription. | verify |
| `OPENAI_API_KEY` | Shop chat, admin assistant, AI texts, AI search, photo cut-out, build-time search cards | set |
| `OPENAI_MODEL` | Override the chat model. Default `gpt-6-luna` (`src/lib/openai-chat.ts`). Do not pin gpt-4.1/4o: they shut down 14.01.2027. | unset |
| `PHOTO_CUTOUT` / `PHOTO_CUTOUT_TIMEOUT_MS` | `openai` turns on «Убрать фон» (`gpt-image-2.5-sunburst`) | `openai` |
| `SEARCH_CARDS_GENERATE` / `_BUDGET_MS` / `_MAX` / `_PREV_BASE` | Build-time search cards (`tools/pack-search-cards.mjs`). The model is called only on `VERCEL_ENV=production` or when `SEARCH_CARDS_GENERATE=1`. | defaults |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_PUBLIC_BASE` | Cloudflare R2 bucket `rempire-media` for uploads. The public base has been `https://img.rempireshop.com` since 21.09.2026. | set |
| `R2_PUBLIC_BASE_OLD` | Comma list of former public bases, so old photo URLs stay editable (default: the old `pub-….r2.dev`) | default |
| `GSC_SERVICE_ACCOUNT_JSON` / `GSC_SITE_URL` | Search Console figures in «Аналитика» (`src/lib/gsc.ts`) | set (25.10) |
| `GOOGLE_CLIENT_ID` | Customers' «Продолжить с Google». A public client ID; **no client secret exists**. Unset hides the button and makes the routes answer 404 (`docs/google-login.md`). | set (02.11) |
| `BUILD_AT` | Stamped by `next.config.ts` at build time. Do not set it. | — |
| `VERCEL_ENV`, `NODE_ENV`, `CI` | Set by the platform. `VERCEL_ENV=production` gates IndexNow, rebuilds and search-card generation. | — |

Test-only: `DB_DRIVER`, `PGLITE_PATH`, `E2E_BOOTSTRAP`,
`E2E_EXPOSE_LOGIN_CODE`, `E2E_PORT`, `E2E_BOOTSTRAP_URL`, `SMOKE_BASE_URL`,
`FUZZ_FULL`, `BLOG_SHOTS`, `CHAOS_DATA`, `OG_OUT`. Tool-only: `ADMIN_PASSWORD`
(`e2e-bootstrap`), `RMP_ADMIN_COOKIE` (`import-shopify-stock`), and
`SHOP_BASE` / `SHOPIFY_BASE` (`check-legacy-redirects`). Full inventory:
`grep -rhoE "process\.env\.[A-Z0-9_]+" src tools e2e`, plus `env("R2_…")` in
`src/lib/storage.ts`.

GitHub Actions secrets (repository → Settings → Secrets → Actions):
`BACKUP_DATABASE_URL` and `BACKUP_PASSPHRASE` (`docs/backup.md`).

## Tests

| Layer | Command | Notes |
|---|---|---|
| Unit / integration | `npm test` | 408 vitest files in `tests/`. They run on PGlite (`vitest.config.ts`: `DB_DRIVER=pglite`, `fileParallelism: false`). Routes are called directly and external HTTP is stubbed. **The full run takes more than 10 minutes locally.** Run single files while working (`npx vitest run tests/x.test.ts`) and mirror CI with `npx vitest run --shard=N/3`. `tests/fuzz-*.test.ts` throws a fixed hostile corpus at every route; `FUZZ_FULL=1` sends the whole corpus to the money routes (the weekly CI run does this). |
| Browser (e2e) | `npm run e2e` | 78 Playwright specs in `e2e/`. `tools/e2e-build.mjs` runs the prerender and the packers, then Playwright starts `next dev` on **port 3417** (`E2E_PORT` overrides it) with PGlite, the mock payment and shipping providers, and no OpenAI/Resend/Google keys. Projects: `desktop`, `tablet` and `mobile` (Chromium), `mobile-safari` (WebKit iPhone 13, customer specs only), and `webkit-local` (local only). `workers: 1`. Recipes and pitfalls: `docs/testing.md`. |
| Deployed smoke | `npm run smoke -- https://rempireshop.com` | `e2e/smoke.spec.ts` via `playwright.smoke.config.ts`. **Read-only GETs only.** It also works against an undeployed fix: `npm run smoke -- http://localhost:PORT -g <pattern>`. |
| Static pages | `npm run prerender && npm run prerender:check` | hreflang, canonical, JSON-LD, titles, images, asset token |
| Translations | `npm run i18n:gaps` | Must print 0 |
| Owner-proof build | `node tools/chaos-build.mjs` | 30 panel-style edits on a live-data snapshot, each followed by the real build and a page check |

Pipe caution: `npm run e2e | tail` exits 0 even when tests fail. Use
`set -o pipefail` or grep the summary.

## Deploy flow

```
push to main ──► CI (.github/workflows/ci.yml)
                   typecheck + vitest in 3 shards (~5 min each; docs-only pushes skip CI)
                 ──► green? «Promote to production» (promote.yml)
                       fast-forwards branch `production` to the tested commit
                       waits for Vercel's Production deployment of it (≤25 min), red if the build failed
                     ──► Vercel builds `production` → rempireshop.com
                     ──► smoke.yml (workflow_call) against rempireshop.com
```

- **Vercel's Production Branch is `production`** (Settings → Environments →
  Production → Branch Tracking). Only `promote.yml` pushes to it, never with
  force. `vercel.json` sets `git.deploymentEnabled.main: false`, so a push to
  `main` builds nothing on Vercel by itself. Other branches get preview
  deployments, which are behind Vercel's deployment protection.
- **The build:** `prebuild` runs the packers (migrations, content, legal,
  feed), the search cards, `copy-vendor`, the `app.js` minify, and the
  prerender. Then `next build`. Then `postbuild` runs
  `tools/migrate.mjs --if-configured`, which applies pending migrations. **A
  failed migration does not fail the build** (it exits 0 and logs). Apply
  later with `POST /api/admin/migrate`.
- **The owner's edits do not wait for CI.** Publishing an article, renaming a
  product or saving page texts calls the deploy hook (`DEPLOY_HOOK_URL`,
  `src/lib/rebuild.ts`: at most one build per 5 minutes, only on the live
  shop). The nightly cron forces one at 03:30 UTC. The hook builds the same
  `production` commit with new data.
- **The e2e suite does not run per push.** It runs weekly (Mondays 03:40
  UTC) and on Actions → CI → «Run workflow», so the repository fits the free
  Actions minutes once it is private. Run it by hand before a risky release.
- **Failures reach Dim.** A red CI or Promote run mails whoever pushed. A hook
  or nightly build that never went live, no backup for 36 hours, or 8+
  in-stock products hidden in a day mail `DEV_ALERT_TO` from the daily cron
  (`src/lib/build-watch.ts`). Actions → «Alert drill» proves the GitHub path.
  `POST /api/admin/alert-drill/` from a signed-in admin tab proves the
  build-watch path.
- **Batch your pushes.** Every deployment is a full copy on Vercel's storage.

Before pushing a change, see «Generated files» below. For a blocked deploy,
see RUNBOOK §5.

### Commit identity

Every commit is authored as
`Rempire Store <324390963+rempireshop@users.noreply.github.com>`. The
convention was adopted because of Vercel Hobby's rule that only the account
owner's commits deploy. `docs/HOSTING.md` notes that the rule may not even
apply to a personal repository. The convention stays: it costs nothing, and
the plan is to go back to Hobby (`docs/accounts.md`).

## Generated files that must be regenerated

These are committed. A stale copy turns a unit test red and blocks the deploy.

| Change | Then run | Test that catches it |
|---|---|---|
| `public/shop2/app.js`, `styles.css`, `chat.js` … | re-derive the `?v=` token in `public/shop2/index.html`. It is a content hash (`tools/lib/asset-token.mjs`), and `npm run prerender` rewrites it with `retokenise()`. Commit only the token change from that run. | `tests/asset-token.test.ts` |
| `db/migrations/*.sql` | `npm run pack:migrations` | `tests/migrations.test.ts` |
| catalogue texts or photos | `npm run pack:feed`. After a photo change also run `npm run feed:squares`. | `tests/merchant-feed.test.ts`, `tests/feed-squares.test.ts` |
| `src/lib/seo-copy.mjs` | `node tools/sync-seo-copy.mjs` (copies the block into `app.js`) | `tests/seo-copy.test.ts` |

A local build or prerender rewrites several committed generated files with
localhost values. Revert them before staging (`git status`, then
`git checkout -- <file>`). After a merge, regenerate `public/shop2/index.html`.
Two branches can add the same migration number without a git conflict, so
check `db/migrations/` after every merge.

## Scheduled jobs

| What | When (UTC) | Where |
|---|---|---|
| `/api/cron/flows/`: marketing letters, invoice dunning, unpaid orders, shipment sync, auto-delivered, content report, build/hide/backup watches, payment reconcile, refund re-check, parked newsletters | daily 07:00 | `vercel.json` |
| `/api/cron/events-retention/`: forced nightly rebuild via the deploy hook, then events older than 90 days deleted | daily 03:30 | `vercel.json` |
| `/api/cron/payments-reconcile/` | **not scheduled**. The flows cron runs the same functions. | route only |
| Database backup | 01:17 and 13:43 | `.github/workflows/backup.yml` |
| Smoke against rempireshop.com | 05:37, 11:37, 17:37, plus after every promote | `.github/workflows/smoke.yml` |
| Full CI with e2e | Mondays 03:40 | `.github/workflows/ci.yml` |

Each cron route needs `Authorization: Bearer <CRON_SECRET>`, which Vercel
sends by itself.

## Routes

Every public address is built by `src/lib/shop-paths.mjs`. Old addresses get
exactly one 301 from `src/lib/legacy-redirects.ts` (run by the middleware).

```
/  /ru  /et                     home (English unprefixed, as on Shopify)
/products/<id>[?size=<size>]    a product; ru/et prefixed
/collections/<handle>           section, subcollection or brand (per-language handles)
/collections/brands | sets[/<id>]
/products/gift-card             gift card
/policies/{shipping-policy,refund-policy,privacy-policy,terms-of-service}
/pages/contact                  (/contact, /contact-us → 301)
/blogs/news[/<slug>]            blog
/search /cart /checkout /checkout/done /account     screens (noindex)
/admin  /admin/scan             the owner's panel and the stock scanner (no prefix)
/cart/<id>:<qty>                Merchant Center checkout link → product + basket
/feed/google-{en,et,ru}.xml     Merchant feeds (EN and RU are registered in Merchant Center)
/feed/google-local.xml          local-inventory feed, 404 until a store code is set
/sitemap.xml  /robots.txt  /llms.txt  /<indexnow-key>.txt
/api/**                         104 JSON routes, with or without a trailing slash, never redirected
/api/mcp  /oauth/*  /.well-known/oauth-*      the «Rempire» connector for Claude
/handover                       Dim's handover page, only on rempireshop.diipsolutions.eu
/shop2/…  /en-xx/…  Shopify spellings          one 301 to the page above
```

Page addresses never end in a slash (`trailingSlash: false`). The language
comes only from the path. An unprefixed page sends a browser whose cookie or
`Accept-Language` asks for Russian or Estonian a 302 to its twin (with
`Vary`). A crawler with neither gets English.

## Where the docs are

Developer reference: `docs/SYSTEM-MAP.md`, `docs/RUNBOOK.md`,
`docs/accounts.md`, and the topic docs below.

- **Area references:** `backend.md` (database, TLS, API conventions,
  idempotency), `backup.md`, `testing.md`, `seo.md` (URLs, prerender,
  sitemaps, structured data, redirects), `merchant-feed.md`, `mail.md`,
  `flows.md`, `payments.md`, `shipping.md`, `inventory.md`, `loyalty.md`,
  `features.md` (sets, gift cards, reviews, video, banner), `blog.md`,
  `media.md`, `analytics.md`, `google-login.md`, `google-local-listings.md`,
  `claude-connector.md`, `assistant-spec.md` and `assistant-work.md`,
  `region-move.md`, `HOSTING.md`, `build-contracts.md`.
- **Montonio:** `montonio-payments-audit.md`, `montonio-shipping-audit.md`,
  `montonio-untested.md`, `montonio-routes.md`, `montonio-questions.md`.
- **Records:** `changelog.md` (since launch), `go-live.md`,
  `launch-runbook.md`, `go-live-reset.md`, the `audit-*.md` files and
  `docs/audit/`, `next-session.md` (state on 27.09), `design/` (admin redesign
  handoff, motion, design system).
- **For Renat, in Russian:** `renat-services.md`, `RENAT-WEEKLY.md`,
  `FOR-RENAT-2026-08-23.md`, `delivery-table.md`.
- The handover checklist is `src/data/golive.json` (phase C rows `ho-*`),
  shown at `/handover` on Dim's host.

Several docs describe the state at the time they were written. Where they
disagree with the code, the code wins. The known disagreements are listed in
`docs/SYSTEM-MAP.md`, Appendix C.

## Brand

The 2025 identity is the **tower badge** (`rempire_logo_2025`). The source
vectors are in `public/brand/` and `design/`.
`public/brand/rempire-tower.svg` is the tower mark extracted verbatim from
the badge. Do not redraw it. Brand ink: `#1c1a00`. Motion system:
`docs/design/MOTION.md`.

**Font licensing.** `Korolev Bold.otf` (Device Fonts) and
`VodkaBrush-Regular.otf` came as desktop OTFs from the client's Dropbox.
Desktop licences usually do not cover web embedding. Confirm or buy webfont
licences. VodkaBrush is not used on the site; it lives in `design/` only.

## History

Until 21.08.2026 this repository held a questionnaire for the owner and
design prototypes. They were deleted on 07.09.2026
(`docs/audit/2026-09-07-cleanup.md`, git `448cbd7`). The acceptance checklist
`/test` was removed on 03.11.2026 (last in `9dd7e412`). `/golive` and `/cards`
left rempireshop.com the same day.
