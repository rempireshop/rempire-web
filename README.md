# rempire-web

The REMPIRE shop: storefront and admin panel, one Next.js 15 project.
**Live at `https://rempireshop.com`** since 08.10.2026 22:55 (it replaced the
Shopify shop on the same domain). Since 09.10.2026 02:25 it answers on
Shopify's own address scheme — English unprefixed, `/ru/…`, `/et/…` — so
every old Shopify link and search result still lands on its page. Staging is
`https://rempireshop.diipsolutions.eu` (closed to search engines).

**Start here:** [`docs/SYSTEM-MAP.md`](docs/SYSTEM-MAP.md) — every system, who
it is for, how it works, how it is tested, what state it is in.
[`docs/HOSTING.md`](docs/HOSTING.md) — what Vercel does and what Railway does.
[`docs/GLOSSARY.md`](docs/GLOSSARY.md) — one agreed name per thing.

## Shape

The shop and the admin are **one vanilla-JS single-page app** —
`public/shop2/app.js` plus its stylesheets — served as static files and
talking to ~70 JSON routes under `src/app/api/**`. Next.js is the server: the
API, the request-time product/blog pages, the OG-card renderer, the sitemap
and the two cron jobs. There are **no React pages**; `src/app/layout.tsx`
exists for the day one is added.

| Concern | Choice |
|---|---|
| Framework | Next.js 15 App Router, serverful (static export is not possible — see `next.config.ts`) |
| Language | TypeScript for `src/**` and `tools/**`; plain ES5-ish JS for `public/shop2/app.js` |
| Storefront/admin UI | hand-written JS + CSS in `public/shop2/` — no framework, no build step |
| Styling (Next side) | Tailwind CSS 4, tokens in `src/app/globals.css` |
| Database | Postgres (Railway) via `src/lib/db.ts`; PGlite in memory for every test |
| Package manager | npm (`package-lock.json`; CI runs `npm ci` on Node 22) |
| Hosting | Vercel — see `docs/HOSTING.md` |

## Running it

```bash
npm ci
npm run dev          # http://localhost:3300 — the English home page
npm run typecheck
npm test             # vitest, in-memory PGlite, no services needed
npm run e2e          # Playwright; builds the e2e fixture first
```

`npm run dev` works with an empty `.env.local`: without `DATABASE_URL` the
shop falls back to demo/localStorage mode. Every environment variable is
listed by NAME in `docs/accounts.md` and `docs/backend.md`; values live in the
Bitwarden vault and in Vercel, never in this repository.

Generated things that must be rebuilt when their sources change:
`npm run prerender` (~830 static shop pages, written under `public/shop2/`
and served at the addresses below), `npm run pack:migrations`
(`db/migrations/*.sql` → `src/db/migrations.generated.ts`), the minified
`app.min.js` and the `?v=` asset token in `public/shop2/index.html`
(`tools/lib/asset-token.mjs`). All run automatically in `prebuild`; after a
merge that touches `app.js`, re-derive the token or `tests/asset-token.test.ts`
goes red.

## Routes

Every address is built by one module, `src/lib/shop-paths.mjs`; the old
ones are answered by `src/lib/legacy-redirects.ts` with exactly one 301.

```
/  /ru  /et               home (English unprefixed, as on Shopify)
/products/<id>            a product; ?size=<size> picks a size
/collections/<handle>     a section, brand or subcollection — per-language
                          handles (hair-care / uhod-za-volosami / juuksehooldus …)
/collections/brands       all brands
/collections/sets[/<id>]  curated sets
/pages/contact            contact
/policies/<name>          shipping-policy, refund-policy, privacy-policy,
                          terms-of-service
/blogs/news[/<slug>]      the blog
/products/gift-card       gift card
/search /cart /checkout /account
                          state screens, noindex
/admin  /admin/scan       the admin panel and the stock scanner
/cart/<id>:<qty>          Merchant Center's checkout link → product + basket
/feed/google-{en,et,ru}.xml
                          Merchant Center feeds (daily fetch)
/shop2/…  /en-fi/… …      old addresses: one 301 to the page above
/api/**                   ~70 JSON routes: catalogue overrides, cart,
                          checkout, payments, shipping, orders, admin,
                          assistant, cron — both with and without a trailing
                          slash, never redirected (payment webhooks POST here)
```

No trailing slash anywhere else (`trailingSlash: false`); the language comes
only from the path, and an unprefixed page sends a Russian or Estonian browser
a 302 to its twin (with `Vary`), never a crawler.

## Search engines

`docs/seo.md` is the reference: titles and descriptions (`src/lib/seo-copy.mjs`),
JSON-LD (one Offer per size with delivery and returns, taken from the
Merchant feed), hreflang, sitemaps, `robots.txt` (AI search and training bots
allowed), `/llms.txt`, and IndexNow (`node tools/indexnow-submit.mjs`, key
file at the site root; the admin pings on every save).

## Testing

- `npm test` — ~350 vitest files (~7 000 tests, ~15 min) against PGlite;
  routes are called directly and external HTTP is stubbed. Includes a fuzz layer (`tests/fuzz-*.test.ts`) that
  throws a fixed corpus of hostile input at every route.
- `npm run e2e` — Playwright, Chromium in four CI shards plus a WebKit job for
  the customer-facing specs. `docs/testing.md` has the local recipes.
- `node tools/i18n-gaps.mjs` — must print 0. The admin and shop UI are Russian
  in the source and translated to ET/EN by a dictionary in `app.js`.
- CI (`.github/workflows/ci.yml`) runs typecheck, unit tests and e2e. It does
  **not** deploy; Vercel deploys on its own trigger.

## Committing and deploying

Vercel Hobby only builds commits authored by the account owner, so every
commit here is authored as:

```
Rempire Store <324390963+rempireshop@users.noreply.github.com>
```

A push to `main` of `github.com/rempireshop/rempire-web` (a private
repository) builds and deploys to production. Each push stores a full copy of
the deployment, and Hobby has a 10 GB cap — batch changes into one push.
The build is `prebuild` (pack migrations, content, legal and feed, copy
vendor files, minify, prerender) → `next build` → `postbuild` (apply
migrations when `DATABASE_URL` is set). After a deploy, run the smoke suite
against the live site: `npm run smoke -- https://rempireshop.com`.

The go-live record is `docs/launch-runbook.md` (steps 0–8 and «The URL
move») and the owner's `/golive` page.

## Brand

The 2025 identity is the **tower badge** (`rempire_logo_2025`): rook tower,
REMPIRE TOWER arc, "est 2018", "666 ways", script slogan. Source vectors in
`public/brand/` (badge + lockup, dark/white) and `design/` (AI/PDF originals,
PNG renders). `public/brand/rempire-tower.svg` is the tower mark extracted
verbatim from the badge (path 0, bbox `292.24 171.22 265.18 409.8`) — do not
redraw it; re-extract if the brand file changes. Brand ink: `#1c1a00`.
The motion system is `docs/design/MOTION.md`.

### Font licensing — read before production

`Korolev Bold.otf` (Device Fonts) and `VodkaBrush-Regular.otf` arrived as
desktop OTFs from the client's Dropbox. Desktop licences usually do **not**
cover web embedding. Confirm or buy webfont licences (and convert to woff2)
before the public launch. VodkaBrush is not used on the site; it lives in
`design/` only.

## History

Until 21.08.2026 this repository was a questionnaire for the owner (`/qa`,
`/qa2`), a design-review hub (`/demo`) and eight design prototypes
(`/prototypes/*`). All of that was deleted on 07.09.2026 —
`docs/audit/2026-09-07-cleanup.md` says what went and what it removed from the
attack surface. Anything you need from it is in git history at `448cbd7`.
