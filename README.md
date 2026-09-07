# rempire-web

The REMPIRE shop: storefront and admin panel, one Next.js 15 project.
Live-ish at `https://rempireshop.diipsolutions.eu/shop2/`; production domain
`rempireshop.com` still points at the old Shopify shop until the switch.

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
npm run dev          # http://localhost:3300 — / redirects to /shop2/
npm run typecheck
npm test             # vitest, in-memory PGlite, no services needed
npm run e2e          # Playwright; builds the e2e fixture first
```

`npm run dev` works with an empty `.env.local`: without `DATABASE_URL` the
shop falls back to demo/localStorage mode. Every environment variable is
listed by NAME in `docs/accounts.md` and `docs/backend.md`; values live in the
Bitwarden vault and in Vercel, never in this repository.

Two generated things are committed and must be rebuilt when their sources
change: `npm run prerender` (810 static shop pages under `public/shop2/`) and
`npm run pack:migrations` (`db/migrations/*.sql` → `src/db/migrations.generated.ts`).
Both run automatically in `prebuild`.

## Routes

```
/                    → 307 to /shop2/
/shop2/…             the shop and the admin (one static shell + prerendered pages)
/shop2/{,et/,en/}p/… a custom product's page, rendered per request
/shop/…              legacy: 95 prerendered product pages that hand the visitor
                     on to their /shop2/ twin (they carry shared link previews —
                     see docs/redirect-map.csv), plus redirects for the other
                     old screens
/api/**              ~70 JSON routes: catalogue overrides, cart, checkout,
                     payments, shipping, orders, admin, assistant, cron
```

## Testing

- `npm test` — 79 vitest files against PGlite; routes are called directly and
  external HTTP is stubbed. Includes a fuzz layer (`tests/fuzz-*.test.ts`) that
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

A push to `main` of `github.com/rempireshop/rempire-web` builds and deploys.
The build is `prebuild` (pack migrations, pack content, copy vendor files,
prerender) → `next build` → `postbuild` (apply migrations when `DATABASE_URL`
is set). The switch-day checklist lives in `docs/seo.md` and
`docs/SYSTEM-MAP.md` §24.

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
