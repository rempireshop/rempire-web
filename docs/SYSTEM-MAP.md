# REMPIRE — system map

*This document lists every system in the platform: what it is for, who uses
it, how it works, how it is tested, and what state it is in. **Refreshed
05.11.2026 against `main` at `f6d2ca70`** (also `production`), from the code,
the migrations, the tools, the workflows and `docs/`. The first version was
written 06.09.2026 against `1a63cf8`. Since then 1 279 commits have changed
most sections: the live launch, the Shopify URL scheme, the admin redesign
«1a», refunds, invoices, newsletters, Web Push, Google sign-in, the Claude
connector, search cards, and the CPU and caching work of 30.10–03.11. The
06.09 version is in git history. Its «Q1…Q57» pointers into
`docs/SIMPLIFICATION-QUESTIONS.md` and its tap-count appendix no longer
describe the panel, so they are dropped here.*

**How to read a section.** Each section has four parts:

- **For / users**: what the system is for and who uses it.
- **How it works**: files, symbols, routes, tables and the migrations that
  created them, and environment variable *names*.
- **Tests**: the test files and specs that exist today.
- **State**: what works and what is known to be missing.

**Conventions.** There are no `app.js` line numbers: the file is about 60 000
lines and moves daily. Grep the quoted symbol or the quoted Russian label,
which are quoted verbatim. Environment variables are named, never valued; the
full list and their production state are in `README.md`. Where this map and
an older doc disagree, this map was checked against the code, and Appendix C
lists the known disagreements.

---

## 0. The platform at a glance

**Shape.** The platform is one Next.js 15 project (App Router, serverful) on
Vercel (project `rempire-web`, team «Rempire», functions in `fra1`). The shop
and the admin are **one vanilla-JS single-page app**:

- `public/shop2/app.js` (60 240 lines, 4.2 MB of source). Browsers download
  `app.min.js`, which `tools/minify-shop2.mjs` strips of comments. The ET and
  EN UI dictionaries are lifted out into `ui.et.js` and `ui.en.js`
  (`tools/lib/ui-lift.mjs`).
- `styles.css`, `admin.css`, `chat.js`, `boot.js` (an early
  `/api/account/me` request), `admin-sw.js` (the push service worker),
  `index.html`, and three web manifests.

These are served as static files. They talk to **104 API routes** under
`src/app/api/**` (56 of them under `/api/admin/`).

Next.js also serves:

- the request-time product and blog pages;
- the OG-card renderer;
- the sitemaps;
- the Merchant feeds;
- the Claude connector (`/api/mcp`, `/oauth/*`);
- the middleware.

Postgres (Railway) sits behind `src/lib/db.ts`; every test uses PGlite. **The
catalogue is not in the database.** It is generated files
(`public/shop/catalogue2.js` and `src/data/catalogue.*.json`, 220 products),
first built from the Shopify export. The database holds what the owner
changes on top (`product_overrides`) and the products he creates himself
(`custom_products`).

**Sizes.** 139 files in `src/lib` (with `payments/`, `shipping/` and `mcp/`
sub-folders), 67 SQL migrations (`001`…`228`) creating 32 tables, 16 e-mail
renderers, 408 vitest files, 78 Playwright specs, and 1 527 commits.

**External services.** Owners, sign-ins and costs are in `docs/accounts.md`.

| Service | Used for | Env var names |
|---|---|---|
| Vercel (Pro since 03.11.2026, meant to go back to Hobby) | hosting, CDN, two crons, builds of branch `production`, deploy hook | `DEPLOY_HOOK_URL`, platform `VERCEL_ENV` |
| Railway Postgres 18 | the database | `DATABASE_URL`, `DATABASE_POOL_MAX`, `DATABASE_SSL_CA`, `DATABASE_SSL_NO_VERIFY` |
| Montonio (live) | bank links, cards, wallets, refunds; parcel labels, pickup points, shipment status | `PAYMENT_PROVIDER`, `MONTONIO_ACCESS_KEY`, `MONTONIO_SECRET_KEY`, `MONTONIO_ENV` |
| Resend | every e-mail | `RESEND_API_KEY`, `RESEND_FROM`, `MAIL_REPLY_TO`, `RESEND_TO`, `DEV_ALERT_TO`, `MAIL_PENDING_PAYMENT`, `MAIL_RETRY_DELAY_MS` |
| OpenAI | shop chat, admin assistant, AI texts, AI search, photo cut-out, build-time search cards | `OPENAI_API_KEY`, `OPENAI_MODEL`, `PHOTO_CUTOUT`, `PHOTO_CUTOUT_TIMEOUT_MS`, `SEARCH_CARDS_*` |
| Cloudflare R2 `rempire-media` (public at `img.rempireshop.com`) | uploaded photos, videos, newsletter images, gift-card PDFs | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE`, `R2_PUBLIC_BASE_OLD` |
| Cloudflare DNS and Email Routing | `rempireshop.com` DNS; `info@` and `shop@` forwarded to the shop Gmail | — |
| Google Search Console | «Аналитика» search figures | `GSC_SERVICE_ACCOUNT_JSON`, `GSC_SITE_URL` |
| Google Cloud (Auth Platform) | customers' «Продолжить с Google» | `GOOGLE_CLIENT_ID` (public; no secret exists) |
| Google Merchant Center | reads `/feed/google-{en,ru}.xml` daily | — |
| Web Push (browser push services) | owner's «новый заказ» on his phone | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| Telegram | owner's order ping | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| IndexNow (Bing and others) | pings on every owner save | none; the key is public by design (`src/lib/indexnow.mjs`, `public/<key>.txt`) |
| Omniva public feed, DPD (optional) | pickup points when Montonio has none | `DPD_API_USER`, `DPD_API_PASS` |
| Cloudflare Web Analytics (optional) | second traffic counter | placeholder `CF_BEACON_TOKEN` in `index.html`, not an env var |

**Scheduled jobs.**

- Vercel crons (`vercel.json`, UTC): `/api/cron/flows/` at `0 7 * * *` and
  `/api/cron/events-retention/` at `30 3 * * *` (§19).
- GitHub Actions: the backup twice a day, the smoke suite three times a day,
  and the full e2e suite weekly (§23).

**Where things live.**

| Area | Path |
|---|---|
| storefront and admin SPA | `public/shop2/` |
| generated catalogue data | `public/shop/{catalogue2.js,content*.js,legal*.js,bundles.js,paylogos.js,shipping-data.js,img/,img/sq/,og/}`, `src/data/*.json` |
| API | `src/app/api/**/route.ts` |
| public request-time pages | `src/app/{,ru/,et/}products/[id]`, `src/app/{,ru/,et/}blogs/news[/[slug]]`, `src/app/cart/[...path]`, `src/app/feed/[file]`, `src/app/shop2/og/[file]`, `src/app/sitemap-{custom,products}.xml`, catch-all `src/app/[...path]` |
| connector | `src/app/api/mcp`, `src/app/oauth/{register,authorize,token}`, `src/app/.well-known/oauth-*`, `src/lib/mcp/` |
| edge | `src/middleware.ts`, `src/lib/middleware-matcher.ts`, `next.config.ts` (headers, rewrites, redirects) |
| libraries | `src/lib/**`, `src/emails/*` |
| SQL | `db/migrations/NNN_name.sql`, packed into `src/db/migrations.generated.ts` |
| tools | `tools/*.mjs`, `tools/lib/*.mjs`, `tools/chaos/`, `tools/harvest/` |
| tests | `tests/*.test.ts` (vitest), `e2e/*.spec.ts` (Playwright), `playwright{,.smoke,.perf}.config.ts`, `.github/workflows/*.yml` |
| handover page | `public/golive/index.html` + `src/lib/golive.ts` + `/api/golive` + `src/data/golive.json`, served as `/handover` on Dim's host only |
| legacy | `public/shop/index.html`, `app.js` and the 95 `public/shop/p/<id>/` pages: still on disk, every address 301s. `design/` holds the brand originals. |

**Index.**

| § | System |
|---|---|
| 1 | Admin panel shell |
| 2 | Storefront, routing, prerender, SEO, feeds |
| 3 | Catalogue and search |
| 4 | Cart, checkout, orders |
| 5 | Payments |
| 6 | Shipping |
| 7 | Inventory, scanner, salon till |
| 8 | Gift cards |
| 9 | Promo codes |
| 10 | Loyalty and partners |
| 11 | Customer accounts |
| 12 | Mail |
| 13 | AI |
| 14 | Blog and the Claude connector |
| 15 | Content and settings |
| 16 | Reviews |
| 17 | Analytics and reports |
| 18 | Notifications and alerts |
| 19 | Cron |
| 20 | Uploads and storage |
| 21 | Auth and sessions |
| 22 | Database and migrations |
| 23 | Testing and CI |
| 24 | Deploy, environments, CPU and caching |
| 25 | Retired surfaces |
| A | Known gaps |
| B | Stale comments in code |
| C | Docs vs code |

---

## 1. Admin panel — shell, navigation, autosave, journal, PWA

**For / users.** This is the one screen where Renat runs the shop from his
phone. Dim uses it for setup and checks; the e2e suite drives it too.

**How it works.**

- **Routes.** The panel is `/admin` and the scanner is `/admin/scan`
  (`ADMIN_PATH` and `SCAN_PATH` in `src/lib/shop-paths.mjs`). The old
  `/shop2/admin/` 301s there.
- **The gate.** `screenAdmin()` calls `admGateView()`:
  - `SRV.admin` true → the panel;
  - false → `admLoginScreen`;
  - pending → `admWaitScreen`.

  `probeAdmin()` asks `GET /api/admin/me/`, whose `configured` flag means a
  hash is present and `SESSION_SECRET` is usable. The demo panel appears only
  when no API answers at all.
- **Places.** `ADM_SECTIONS` holds «Обзор», «Заказы», «Товары» and «Салон».
  `ADM_MORE` («Ещё») holds:
  - «Клиенты» (и отзывы)
  - «Маркетинг» (промокоды, карты, письма — and «Рассылка» as its fourth tab)
  - «Блог»
  - «Аналитика»
  - «Подключения» (оплата, доставка, почта, Google)
  - «Настройки» (доставка, главная, компания)

  `ADM_SECTION_OF` maps 15 old keys as deep links, including `stock`,
  `reviews`, `gift`, `mail` and `news`. The assistant's «Открыть …» buttons
  and the e2e suite rely on them.
- **Phone layout.** A top bar `admTopHTML` (back, save status, assistant
  icon), a bottom bar `admBarHTML`, and «Ещё» as a page of its own
  (`admMorePageHTML`). Its foot holds «Язык панели», «Открыть магазин ↗» and
  «Выйти».
- **Desktop layout.** A sidebar `admSideHTML` (232 → 68 px, state in
  `localStorage["rempire-admin-panes"]`), which folds itself below 1 200 px
  when the assistant opens (`admNavAutoFold`).
- **Autosave (redesign «1a», Claude Design handoff of 25.09.2026,
  `docs/design/`).** `ADM_SAVE_POLICY` sets the timing:
  - numbers, codes and names save on blur or Enter;
  - text saves 1 s after typing stops;
  - switches and picks save at once.

  There is no «Сохранить» bar. The toast carries «Вернуть» for 6 s
  (`ADM_UNDO_WORD`, `ADM_UNDO_MS`). A held delete waits 5 s (`admHold`,
  `ADM_HOLD_MS`).
- **What still asks first.** These still raise a confirm card («Применить» or
  the action's verb / «Не надо»): shipping or cancelling an order
  (`order_status`), the manual status (`order_manual`), `invoice_paid`,
  `order_refund`, `pos_sale`, «Снять с продажи?» (`set_product_active`),
  `goods_pull`, deleting a size, a banner slide, a promo code or a set, the
  blog's delete/slug/publish/AI actions, newsletter send/delete/translate,
  and every assistant proposal.
- **Journal — server-side, undo from any device.** «Настройки → Журнал»
  (`admSetJournalHTML`) merges this browser's `DEMO.log` with
  `GET /api/admin/audit/?limit=100`.
  - `admin_audit` gained `prev` (migration `207_audit_prev.sql`, what the
    change replaced) and `device` (`225_audit_device.sql`, browser and
    phone/PC from the User-Agent).
  - `journalRows()` in `src/lib/audit-undo.ts` marks each row `undo`/`undone`,
    so «Вернуть» works on any device.
  - Sign-ins are folded under «Входы в админку».
  - Writes made through Claude carry `via: "claude"`.
- **Hide guard (since the 28.10 incident).** On 28.10, 75 products were hidden
  in five seconds. Now:
  - `goodsVisToggle` ignores a second press within 500 ms;
  - `PUT /api/admin/overrides/` refuses more than `HIDE_BURST = 10` hides a
    minute (429 `hide_burst`);
  - the daily cron mails when 8 or more in-stock products were hidden in a
    day (§18).
- **Trilingual UI.** Russian is the source. `translateTree()`/`trText()`
  rewrite text from `UI = {ET, EN}` plus the regex rules `UI_RX`. The build
  lifts the dictionary into `/shop2/ui.{et,en}.js`, which load lazily
  (`uiWant`/`uiWantAll`). Admin code that calls `trText(…, "ET")` before
  `uiWant` ran gets Russian back. `npm run i18n:gaps` must print 0.
- **PWA and push.** Three manifests (scopes `/`, `/admin`, `/admin/scan`).
  `public/shop2/admin-sw.js` handles push and notification clicks only; it
  has no fetch handler, so the panel has no offline mode. `next.config.ts`
  sends `Service-Worker-Allowed: /admin`. The Web Push side is §18.
- **Assistant.** The floating button is gone. On desktop it is a 52-px strip
  (`admStripHTML`) or a pane; on the phone, an icon in the top bar (§13).

**Tests.**

- e2e: `admin-shell`, `admin-sections`, `sweep-admin`, `admin-journal-r16`,
  `admin-lang-r20`, `admin-back`, `admin-assistant-fold`, `admin-switch`,
  `a11y`, `pwa`.
- vitest: the `admin-ux1a-*` files, `audit-undo-any-device`, `audit-device`,
  `hide-burst`, `push`, `admin-push-ui`, `admin-push-deeplink`, `push-badge`,
  `ui-lift`, `lazy-files`, `admin-door`, `journal-reason`,
  `admin-autosave-after-undo`.

**State.** Works; it has been the owner's daily tool since launch. Known
limits:

- one password and no roles;
- the panel is tested on Chromium only;
- the journal has no «Вернуть» for a mark-paid or a refund (by design: the
  confirm card is the safety).

---

## 2. Storefront, routing, prerender, SEO and feeds

**For / users.** This is the shop the customer sees, in three languages and
indexable. It also serves the files Google, Bing and AI crawlers read.
Shoppers, crawlers and Merchant Center use it.

**How it works.**

- **Address scheme (since 08.10.2026)** — `src/lib/shop-paths.mjs`
  (`publicPath()`/`parseShopPath()`; mirrored in app.js as `shopPathFor` /
  `shopRouteOf`).
  - English has no prefix, then `/ru` and `/et`; no page address ends in a
    slash.
  - Per-language handles: `CAT_HANDLES` (7 sections + `all`), `SUB_HANDLES`
    (10 subcollections) and `BRAND_HANDLES`.
  - `INFO_PATHS` (`/policies/*`, `/pages/contact`), `/blogs/news`,
    `/collections/sets[/<id>]` and `/products/gift-card`.
  - Internally the old short routes (`/p/<id>/`, `/c/hair/` …) are still
    the vocabulary.
  - The language cookie is `rempire_lang`.
- **Legacy redirects.** `legacyTarget()` in `src/lib/legacy-redirects.ts`
  answers one 301, with an `X-Rempire-Redirect` reason header. It covers:
  - `/shop2/…` and `/shop/…`;
  - Shopify's `/en-xx/` markets and spellings, `/blogs/blog`, account and
    checkout paths, `/sitemap_*.xml`, `*.atom`;
  - `/contact` and `/contact-us`;
  - a trailing slash.

  It also maps `?variant=` to `?size=` (`src/lib/shopify-variants.ts`,
  `src/data/shopify-variants.json`). It keeps utm/gclid and drops Shopify's
  `variant`, `country` and `currency`. A hidden product gets a 404, never a
  redirect.
- **Middleware** (`src/middleware.ts`) does four things:
  1. passes `/cart/<id>:<qty>` untouched;
  2. applies `legacyTarget()`;
  3. on an unprefixed GET whose cookie or `Accept-Language` asks for ru/et,
     answers a **302** to the twin (`Vary: Accept-Language, Cookie`,
     `private, no-store`); a crawler gets English;
  4. on a catalogue product page whose id is in `/api/overrides/hidden/`,
     answers 404 with a noindex shell (`seo-head` loaded lazily, 2.5 s
     timeout).
- **The matcher** (`src/lib/middleware-matcher.ts`, 03.11.2026, for CPU). The
  middleware never runs on `/api`, `/_next` or files. It skips every page at
  its canonical address, unless the request is unprefixed with a ru/et cookie
  or header. It always runs on products, on addresses that move, and on
  `sitemap_*`, `agents.md` and `*.atom`. A canonical page asked for with a
  trailing slash gets its 301 from `next.config.ts` instead
  (`src/data/slash-redirects.json`, generated).
- **`next.config.ts`.**
  - `trailingSlash: false`, `skipTrailingSlashRedirect: true`,
    `images.unoptimized`, `env.BUILD_AT`.
  - `outputFileTracingIncludes`: fonts and the tower SVG for `/api/**`, and
    `public/shop2/index.html` for all routes.
  - Rewrites: `prerenderedRewrites()` reads `src/data/prerendered-routes.json`
    (gitignored, written by the prerender) and maps `/` to
    `/shop2/index.html`. `/handover` is served only on host
    `rempireshop.diipsolutions.eu`, and `/golive/*` goes to an empty
    destination on every other host.
  - Redirects: on Dim's host everything except `/handover`, the panel, `/api`,
    `/_next` and files 301s to rempireshop.com.
  - Headers:
    - strict CSP everywhere (`script-src 'self'` plus Cloudflare Insights);
    - `camera=(self)` and `microphone=(self)`;
    - HSTS;
    - a looser CSP for `/api`, `/shop`, `/handover`;
    - `X-Robots-Tag: noindex` on every host except `(www.)rempireshop.com`;
    - `immutable` caching for `.js`/`.css` that carry a 12-hex `?v=`;
    - `frame-ancestors 'self'` for the mail and newsletter previews only.
- **Prerender.** `tools/prerender-shop2.mjs`, the last `prebuild` step, writes
  `public/shop2/{,ru/,et/}{c,b,p,info,sets,set,gift,blog,brands}/…/index.html`.
  `docs/seo.md` counts 831 pages at six subcollections; there are ten now.
  - The prices, stock, own products, owner SEO, page texts and blog come from
    the database at build time (`tools/lib/*-export.mjs`).
  - It also writes `sitemap.xml` (index) and `sitemap-N.xml`, `robots.txt`
    (`tools/lib/robots-policy.mjs`, production vs staging chosen by
    `PUBLIC_BASE_URL`), `llms.txt`, and the content-hash `?v=` token in
    `index.html` (`tools/lib/asset-token.mjs`).
  - `tools/check-prerender.mjs` checks the output.
  - The pages go stale until the next build, which is why the shop
    rebuilds itself (§24).
- **Request-time pages.**
  - `src/lib/product-page.ts` (own `c-…` products and anything not
    prerendered; hidden or unknown → 404 + noindex) and `src/lib/blog-page.ts`
    both use `s-maxage=60, stale-while-revalidate=300`.
  - The 404 is `src/lib/notfound-page.ts` (`no-store`). The catch-all
    `src/app/[...path]` serves the shell for browser-only screens and a real
    404 otherwise.
  - OG cards: `/shop2/og/{c-<id>,blog-<slug>}[.et|.en].png`
    (`src/lib/og-card.ts`, which contains a NUL byte, so use `grep -a`).
    Catalogue cards are `public/shop/og/*.jpg`; shop cards are
    `public/og-shop-{en,et,ru}.png` (`tools/og-shop.mjs`).
- **Sitemaps.** The index lists `sitemap-N.xml`, `/sitemap-products.xml`
  (catalogue minus hidden) and `/sitemap-custom.xml` (own products and posts
  published after the build).
- **robots.txt.** Production allows all crawlers, AI search *and* training
  bots included (`AI_BOTS`, Dim's decision). The AI *training* crawlers are
  refused anyway, by the Vercel Firewall (a dashboard setting since 03.11, not
  in the repository): GPTBot and CCBot get 403, OAI-SearchBot and browsers
  pass (checked 05.11.2026). It disallows `/admin`, `/api/`
  (re-allowing overrides, bundles, blog, reviews and carriers) and the
  checkout/cart/account/search screens. Staging is `Disallow: /`.
- **IndexNow.** `submitIndexNow()` in `src/lib/indexnow-ping.ts` runs after
  every owner save, fire-and-forget via `after()`, deduped for 10 min per
  URL, and only on the live shop. `node tools/indexnow-submit.mjs` submits
  the whole sitemap.
- **Verification tags.** `verificationMeta()` in `src/lib/seo-head.mjs` puts
  three Google tokens and `PINTEREST_DOMAIN_VERIFY` into every head. Titles
  and descriptions come from `src/lib/seo-copy.mjs`, copied into app.js by
  `tools/sync-seo-copy.mjs`.
- **Merchant feeds** (`src/app/feed/[file]/route.ts` over
  `src/lib/merchant-feed.ts`).
  - Files: `google-en.xml`, `google-et.xml` and `google-ru.xml`. EN and RU are
    registered in Merchant Center, which offers no Estonian.
    `google-local.xml` (`src/lib/local-inventory.ts`) answers 404 until
    `settings.gbp_store_code` is set.
  - Built live per request (`public, max-age=0, s-maxage=3600`): per-size
    prices and availability, shipping from the live rules, GTIN only when
    valid, sets as `g:is_bundle` items.
  - `feedIntro()` sends only the headline and first paragraph of a
    description (≤ 900 characters). This followed the 29.10
    «prescription drug» flags.
  - `googleImage()` swaps narrow photos for white squares from
    `public/shop/img/sq/`.
  - A feed must stay under Vercel's 4.5 MB response cap, and a test enforces
    it.
  - Checkout link: `/cart/<id>:<qty>` → `src/lib/merchant-cart.ts` → 302 to
    `?size=&buy=`.
- **Consent and the beacon.** The storefront shows a consent banner
  (`localStorage["rempire-consent"]`). `track()` sends `/api/track/` only
  after analytics consent. `mountCfBeacon()` loads Cloudflare's beacon only
  with a real token on rempireshop.com, after consent. The token is still a
  placeholder.

**Tests.**

- vitest: `shop-paths`, `legacy-redirects`, `middleware-matcher`,
  `dim-host-redirect`, `cache-headers`, `csp-default-src`, `hidden-cache`,
  `feed-cache`, `feed-squares`, `merchant-feed`, `merchant-cart`,
  `local-inventory-feed`, `indexnow`, `robots-policy`, `llms-txt`,
  `google-verification`, `og-card`, `og-pages`, `og-shop-cards`,
  `sitemap-lastmod`, `structured-data`, `seo-copy`, `seo-snippet`,
  `seo-brand-intros`, `seo-override`, `section-intros`, `subcollections`,
  `prerender-own-products`, `prerender-owner-seo`, `custom-product-page`,
  `blog-page`, `security-product-page`, `asset-token`, `asset-tracing`,
  `consent`, `storefront-offline`.
- e2e: `home`, `catalogue`, `product`, `sets`, `giftcard`, `blog`,
  `info-pages`, `seo`, `sweep-storefront`, `storefront-sweep-2`,
  `shop-subsection`, `a11y`, `pwa`; `smoke` against a deployed shop.

**State.** Works. 782 of the 849 sitemap pages were indexed by 23.10
(`docs/changelog.md`). For the remaining gaps, see Appendix A.

---

## 3. Catalogue and search

**For / users.** The 220 catalogue products with their sizes, prices, photos
and texts in three languages, plus the owner's products, and the search that
finds them. Renat edits; shoppers read and search.

**How it works.**

- **Generated files.** `public/shop/catalogue2.js` (each product carries its
  own subsection `sub`), `content{,.ru,.et}.js`, `src/data/catalogue.min.json`
  (220 products, 26 brands), `catalogue.variants.json` (per-size price
  ladders, read by orders, the feed, inventory, sets and the blog) and
  `catalogue.feed.json` (`npm run pack:feed`). The builders hard-code paths
  on Dim's machine.
- **Owner overrides** — `product_overrides`, one row per product:
  - `price`, `stock`, `seo_title`/`seo_desc`, `subcat`, `var_img`,
    `video_url` (`001`);
  - `gallery` (`003`);
  - `pro_price` (`100`);
  - `description` (`110`);
  - `seo_langs` (`130`);
  - **`sizes`** and **`hidden`** (`147`);
  - **`name`, `brand`, `cat`** (`224`, 26.10).

  They are written by `PUT /api/admin/overrides/`, which:
  - refuses a name the ET/EN pages cannot translate (`name_untranslatable`,
    `nameTranslatable()`/`TRANSLATABLE_TAILS` in `src/lib/product-name.ts`);
  - rebuilds the static pages after a rename;
  - drops the CDN tags (§24).

  They are published through `GET /api/overrides/`. Orders keep the name they
  were bought under; the page id never changes.
- **Subsections** (`src/lib/subsections.ts`). The subsection belongs to the
  product (`sub`/`sb` in the files, `subcat` override, `-` = none). It is no
  longer read off the name; the `SUBCATS` regexes only *suggest* one for a new
  product. There are 10 subcollection pages, and an empty one stays (noindex,
  out of the sitemap).
- **Own products** (`131_custom_products.sql`, ids `c-…`,
  `src/lib/custom-products.ts`). 1–12 sizes at 1–500 €. Routes:
  `GET|POST /api/admin/products/`, `GET|PUT|DELETE /api/admin/products/[id]/`.
  The panel's «Новый товар» form creates a visible product; the assistant and
  Claude create it **hidden** (`active:false`). Own products appear in the
  static grids too (since 26.10).
- **The editor.** `goodsEditor()` is one autosaving page, with no tabs and no
  save bar. Its sections, in order: «Что за товар», «В магазине», «Объёмы и
  цены», «Фото», «Фото по объёмам», «Видео», «Описание», and «Для Google»
  (folded). `ED_SEC_OF` maps the old tab keys. An ET/EN description or Google
  text that still holds Russian words is refused.
- **Sets («Наборы»).** `bundles` (`120_bundles.sql`, `src/lib/bundles.ts`;
  routes `GET /api/bundles/` and `GET|POST|PATCH|DELETE /api/admin/bundles/`).
  The static `public/shop/bundles.js` and `src/data/bundles.json` remain the
  offline copy and the prerender source. Sets are in the Merchant feed.
- **Stock word.** `src/lib/stock-word.ts` is the panel's «Заканчивается» rule
  on the server, held equal to app.js by `tests/overview-low-parity.test.ts`.
- **Search.** The shop's passes run in this order:
  1. names (with `SRCH_TYPE`/`searchTypeNames()`, which match an EN/ET type
     word against a name's Russian tail);
  2. descriptions;
  3. a concern table;
  4. **search cards**.

  If nothing matches, `askSearchAI` runs (`POST /api/search/`: model terms,
  never shown; same-origin, 12/min/IP; `src/lib/search-terms.ts`).
- **Search cards (since 01.11).** `tools/pack-search-cards.mjs`, in
  `prebuild`, has the model write a per-product card and answer every known
  shopper phrase. The phrases come from Search Console,
  `tools/search-intents.json` and the shop's own search log (3+ visits,
  published as hashes). Its output:
  - files `public/shop/search-{cards,qvec,terms}.json` (gitignored);
  - `CARD_VERSION=1`, `ANSWER_VERSION=2` (bump it to re-ask);
  - `text-embedding-3-small` at 256 dimensions.

  The model is called only on `VERCEL_ENV=production` or with
  `SEARCH_CARDS_GENERATE=1`, unchanged cards are reused, and the step always
  exits 0. `srchCardsWant()` loads `/shop/search-terms.json`; there is no
  function call per search. `npm run cards:snapshot` refreshes the test
  fixture. Plan step 3 (vector search, `/api/search/vec`) is not built
  (`docs/plan-2026-11-01-search-cards.md`).

**Tests.**

- vitest: `custom-products`, `security-custom-products`,
  `description-override`, `seo-override`, `bundles`, `bundles-db`, `api`,
  `override-name-brand-cat`, `override-sizes-hidden`, `product-name`,
  `subsections`, `subcollections`, `catalogue-variants`,
  `product-editor-values`, `admin-goods-stock-word`, `overview-low-parity`,
  `admin-ux1a-product*`, `admin-sets-1a`, `assistant-bundles`, `search`,
  `search-terms`, `search-cards`, `admin-search-all-langs`.
- e2e: `admin-editor`, `admin-editor-sizes`, `admin-products`,
  `sweep-admin-goods`, `admin`, `admin-bundles`, `sets`,
  `admin-search-langs`, `stats-search`, `desc-sections`.

**State.** Works. The catalogue files can still be regenerated only on Dim's
machine. The owner can now change everything else, including name, brand,
section, sizes and visibility. ET/RU texts are machine translations, partly
proofread. `catalogue.variants.json` decides which products the test suites
pick, so editing it re-points fixtures.

---

## 4. Cart, checkout and the order lifecycle

**For / users.** This turns a basket into a paid order the owner can ship,
message about, cancel or refund, with every euro recomputed on the server.
Shoppers check out; Renat works the order list and card; payment callbacks
are automatic.

**How it works.**

- **Cart.** Three line kinds: a product `{id,size,qty}`, `bundle:<id>`, and
  `gift:<amount>`. It is kept in `localStorage["rempire-shop-proto"]`.
  Abandoned-cart snapshots go to `POST /api/carts/` (`cart_writes`, `181`).
- **Checkout.** The steps are contact, delivery and payment. Payment options
  come from `PAYS[].k`: `bank` (bank logos from
  `GET /api/payments/methods/`), `card`, `wallet`, and for companies
  `payment.method:"invoice"`. One box takes a promo code or a gift card
  (`RMP-…`).
  - The newsletter tick and the company fields reach the order (`newsletter`,
    `company`).
  - `payNow()` sends `POST /api/orders/` with an `Idempotency-Key`, then
    `POST /api/payments/create/`, then redirects.
  - The receipt is `/checkout/done`.
  - The product page has an express «Купить через Apple Pay / G Pay» button
    (`btn--express`; `appleWallet()` picks the mark), which preselects
    `wallet`.
- **Server pricing.** `createOrder()`/`priceItems()` in `src/lib/orders.ts`:
  - catalogue base price + size ladder + override + own products + sets from
    the database + gift lines;
  - shipping via `computeShipping()`;
  - gift card, promo and points are only *quoted*;
  - partner pricing applies when the signed-in customer is a partner;
  - the VAT rate is stamped on the order (`orders.vat_rate`, `190`);
  - a gift amount not on sale is refused (`gift_unavailable`).
- **Idempotency.** `idempotency_keys` (`180`) and `src/lib/idempotency.ts`
  cover orders, POS, stock moves, refunds, customers, products, blog,
  reviews and newsletters (`docs/backend.md`).
- **Statuses.** `ORDER_STATUSES` = `new · paid · failed · shipped · delivered
  · cancelled · refunded`; `PAID_ORDER_STATUSES` = paid, shipped and
  delivered (`140`). `setOrderStatus()` accepts any member (`opts.unless`
  claims a move). It stamps `shippedAt`/`deliveredAt` once. Moving paid →
  cancelled or refunded returns stock (capped by what the ledger shows sold),
  and undoing that takes it back. A full refund voids gift cards the order
  bought.
- **Admin list.** `ADM_ORDER_FILTERS` holds the chips «Все · Отправить · В пути
  · По счёту · Возвраты · Придержаны». The order card has:
  - the step strip;
  - label, ship and delivered;
  - «Написать клиенту» (sent through `POST /api/admin/mail/send/`, **held
    10 s** so «Вернуть» can stop it, `src/lib/letter-hold.ts`);
  - «Отменить заказ», whose card says plainly that cancelling returns no
    money;
  - **«Вернуть деньги»**;
  - «Изменить статус вручную» (`order_manual`: «оплачен» runs the full
    settlement; «возврат» is the label only).
- **Refunds.** `POST /api/admin/orders/[id]/refund` handles partial or full
  refunds, gift card first, then the bank (`splitRefund`), through Montonio
  `POST /refunds`.
  - Montonio's refusals are shown in its own words
    (`src/lib/montonio-problems.ts`).
  - Everything after Montonio answers runs through `settleRefund()`
    (`src/lib/payments/settle.ts`).
  - Pending refunds are watched (`pending-refunds.ts`) and re-asked nightly
    (`refund-recheck.ts`).
  - Gift-card and loyalty refund lines: `151`, `214`.
- **Unpaid orders** (`runUnpaidOrders`, `src/lib/flows.ts`, **off by default**).
  - When on: a reminder after 3 days and a cancellation after 7.
  - Always, in the same pass: an unpaid web order whose customer paid a newer
    one within 24 h is cancelled silently (`reason:"reordered"`).
- **Company invoices.**
  - Code: `src/lib/invoices.ts`, `invoice-pdf.ts`, `invoice-dunning.ts`
    (migrations `141`, `145`).
  - Routes: `GET|POST /api/admin/orders/[id]/invoice` (paid / resend) and
    `/api/account/orders/[id]/invoice`.
  - Letters: invoice, reminder and cancelled.
  - IBAN and bank come from «Настройки → О компании».
- **Returns.** `POST /api/account/return-request` (`src/lib/returns.ts`,
  30-day window, stored in `shipping.returnRequest`; `150` is an index only).
- **Order status poll.** `POST /api/orders/status` (`{orderId, token}`, HMAC
  under `SESSION_SECRET`) answers paid yes/no for the receipt screen.
- **Messages.** `order_messages` (`111`); `GET /api/admin/orders/[id]/messages`.
  Incoming customer mail does not arrive here.

**Tests.**

- vitest: `orders`, `orders-digital`, `orders-carrier`, `order-messages`,
  `mail-send`, `checkout-parity`, `fuzz-money`, `order-cancelled-paid`,
  `orders-held-r26`, `orders-onway-r25`, `admin-refund-*`, `payments-refund*`,
  `invoices`, `invoice-pdf`, `invoice-dunning*`, `account-invoice`,
  `returns`, `returns-novapost`, `flows-unpaid`, `idempotency*`,
  `checkout-payonce`, `letter-hold`.
- e2e: `checkout`, `sweep-checkout`, `invoice`, `payments`,
  `checkout-wallet-account`, `admin-orders-r16`, `admin`.

**State.** Works live since 08.10.2026. Status changes have no transition
table. The rules live in `payments/settle.ts` («paid is a floor») and in the
admin order route.

---

## 5. Payments

**For / users.** Taking the money (bank links, cards, wallets) through
Montonio, giving it back, and turning «paid» into everything that must happen
exactly once. Shoppers pay; Renat refunds; Dim holds the keys.

**How it works.**

- **Provider choice** (`getProvider()` in `src/lib/payments/index.ts`):
  - `PAYMENT_PROVIDER=mock` → the mock;
  - `montonio` or unset → Montonio when its keys exist, otherwise
    `not_configured` (503). Payments are never silently mocked.
  - The payments mock has **no** production guard, so never set it on Vercel.
  - MakeCommerce was removed 07.09.2026.
- **Montonio Stargate** (`montonio.ts`).
  - `LIVE_BASE` when `MONTONIO_ENV=live`; the order goes out as an HS256 JWT
    (`jwt.ts`, 10 min).
  - `GET /api/payments/return/` (GET + POST) and the webhook
    `POST /api/payments/notify/` handle payments and the `refundToken`.
  - `token-guard.ts` asks Montonio on a uuid/accessKey mismatch instead of
    refusing. `methods.ts` caches bank logos for 6 h. `order-status.ts` signs
    the receipt-page poll.
- **The single door.** `settle.ts` (`settlePayment`, `settleRefund`,
  `recordProviderRefund`, `settleWithoutPayment`) over `apply.ts`:
  - «paid» is a floor;
  - an under- or wrong-currency payment is **held** (`payment.held`), not
    paid;
  - on the first «paid»: gift card or promo spent, points, purchase event,
    stock decrement, letters (`payments/mail-hook.ts`).
- **Refunds** arrive by webhook too. A refund made in Montonio's portal is
  recorded (`recordProviderRefund`).
- **Lost-webhook sweep.** `reconcile.ts` re-asks Montonio about unpaid orders
  aged 45 min to 2 weeks. It runs from the daily `/api/cron/flows/`;
  `/api/cron/payments-reconcile/` exists but has no `vercel.json` entry.
- **Readiness.** `GET /api/admin/montonio/` checks whether refundable bank
  payments are on (via `isRefundableType` on the newest bank-link order),
  carriers and contracts, the webhooks, and pending refunds. It writes
  `settings.montonio_readiness`, which «Подключения» and «Обзор» read.
- **Tools** (GET-only unless named): `tools/montonio-live-check.mjs`,
  `tools/fetch-montonio-tariffs.mjs --dry`, `tools/montonio-webhook.mjs
  list|register|delete`. Each takes keys from a temporary
  `.env.montonio-live.txt`.

**Tests.**

- vitest: `payments-montonio`, `payments-apply`, `payments-giftcard*`,
  `payments-reconcile`, `payments-token-guard`, `payments-settle-once`,
  `payments-double`, `payments-underpaid`, `payments-create`,
  `payments-montonio-refusal`, `montonio-problems`,
  `montonio-docs-payloads`, `montonio-live-check`, `montonio-evidence`,
  `fuzz-money`.
- e2e: `checkout` and `payments` via `PAYMENT_PROVIDER=mock`.

**State.** Live. Live keys and `MONTONIO_ENV=live` since 26.09.2026
(`docs/go-live.md`), real orders since 08.10. The e2e suite never touches
Montonio. The first live hour's checks are in `docs/montonio-untested.md`.
Montonio's raw 4xx bodies are visible only in Vercel's runtime logs.

---

## 6. Shipping

**For / users.** Charging the right delivery price in 25 countries, letting
the shopper pick a pickup point, and booking and printing the label from the
order card. Shoppers, Renat and carrier webhooks use it.

**How it works.**

- **Prices** (`src/lib/shipping.ts`, `shipping/country-prices.ts`).
  - The rules live in `settings.shipping_rules` with per-country cells. An
    empty cell means «Montonio's price» (`202`, which removed the frozen cells
    of `148`).
  - The carton is 25×18×8 cm, locker size S (`203`).
  - Code defaults: `freeFrom: 59`, `freeFromByCountry: {EU: 200}`, parcel EE
    5.47 / LV, LT 5.59, courier EE 10.84.
  - **Live** thresholds are Baltics 70 € and Finland plus the rest of Europe
    200 €. The storefront's first-paint mirror is
    `THRESH = {EE:70, LV:70, LT:70, FI:200, EU:200}` in app.js; keep it in
    step with the setting.
- **Countries and carriers.** `MONTONIO_COUNTRIES` lists 25 countries (the EU
  without CY and MT). `SHOP_CARRIERS` = omniva, smartpost, dpd, unisend and
  novapost. Nova Post is chip-only and never offered in EE/LV/LT; Venipak was
  removed 14.09. Editor: «Настройки → Доставка и оплата»
  (`docs/delivery-table.md`).
- **Pickup points.** `GET /api/shipping/points/` tries Montonio first, then
  the Omniva feed and the seed (`parcel-points.ts`; DPD with
  `DPD_API_USER`/`_PASS`). `point-search.ts` sorts by postcode. Montonio
  points have no coordinates.
- **Labels.** `POST /api/admin/shipments/` books the parcel with a slot claim.
  `registrationFailed` → 502, and the same route repairs it via `PATCH`. The
  declared weight is 0.9 kg (`declaredWeightKg()`).
  `GET /api/admin/shipments/[id]/label/?size=A4|A6` serves A4 with order info
  or bare A6 (`label-pdf.ts`). `shipment-adopt.ts` recovers a booking whose
  reply was lost.
- **Status.** The webhook `POST /api/shipping/notify/` (`webhook.ts`) and
  `shipment-sync.ts`: the carrier's first scan ships a paid order by itself
  (`ship-order.ts`). `syncStaleShipments` re-asks shipments that have been
  quiet for 12 h every night.
- **Auto-close** (`closeDeliveredOrders`, `src/lib/delivery.ts`). Defaults:
  `autoDays: 0`, `useCarrier: true`. «In transit / awaiting collection» keeps
  the order shipped, and a returned parcel is never closed. No letter is sent.
- **Carrier logos.** `GET /api/shipping/carriers/` (6 h).
- **Mock.** `SHIPPING_PROVIDER=mock` (`montonio-mock.ts`) works only when
  `NODE_ENV` is not production.

**Tests.**

- vitest: `shipping`, `shipping-rules`, `shipping-tariffs`,
  `shipping-montonio`, `shipping-label-pdf`, `parcel-points`,
  `shipping-webhook`, `shipment-poll`, `carrier-autoship`, `parcel-returned`,
  `delivery-close`, `shipment-booking-unknown`, `shipment-repair`,
  `shipping-country-prices`, `shipping-free-from`, `shipping-carrier-choice`,
  `shipping-real-weight`, `point-search*`, `tariff-vat`.
- e2e: `checkout`, `delivery-countries`, `info-pages`, `admin`.

**State.** Live. The first real booking was R-100098 on 26.09; the first Nova
Post order was R-100111. The parcel webhook must be registered at Montonio
with `tools/montonio-webhook.mjs`. Without it orders never close by themselves
and nothing complains.

---

## 7. Inventory, scanner and the salon till (POS)

**For / users.** Real counts per product and size, a phone scanner for goods
in and barcode binding, and the salon till, so web and salon share one stock.
Renat uses it, alongside the automatic web decrements and returns.

**How it works.**

- **Tables.** `stock_levels` and `stock_moves` (`090`). Move reasons:
  `sale_web`, `sale_pos`, `goods_in`, `adjust`, `return`, `edit` (`092`) and
  `writeoff` (`206`). One-size products sit on their named rows (`194`,
  `196`). The default low threshold is 1 (`215`).
- **Logic** (`src/lib/inventory.ts`). A variant is tracked only after a
  counting move. `move()` is atomic and clamps at 0. `setQty(…, {expect})`
  protects Claude's counts.
- **Routes.** `GET|PUT /api/admin/inventory/`,
  `GET|POST /api/admin/inventory/moves/` (Idempotency-Key),
  `GET /api/admin/inventory/lookup/?ean=`, `POST /api/admin/pos-orders/`,
  `GET /api/admin/pos-orders/[id]/receipt/`.
- **Scanner.** `/admin/scan` (its own manifest) plus the overlay from «Склад»
  and «Салон». It uses `BarcodeDetector`, or zxing vendored by
  `tools/copy-vendor.mjs`, or manual entry. «Списать» writes `writeoff`.
- **POS.** `POST /api/admin/pos-orders/` goes through `settlePayment()`, so
  points, the purchase event and an **e-mailed receipt** (`pos-receipt`) all
  happen. `pos_ref` (`093`) plus the Idempotency-Key make a double tap
  harmless.

**Tests.**

- vitest: `inventory`, `pos-orders`, `assistant-actions`, `admin-stock-1a`,
  `inventory-scanner`, `inventory-bind-route`, `low-threshold-one`,
  `one-size-stock-migration`, `pos-receipt-greeting`, `stock-r21`,
  `stock-history-fresh`.
- e2e: `scanner-app`, `salon-sale`, `sweep-admin-ops`.

**State.** Works. The camera path has no automated test.

---

## 8. Gift cards

**For / users.** A card of 25/50/75/100 € that arrives as a PDF by e-mail
and is spent at checkout, with the balance kept.

**How it works.**

- **Tables.** `gift_cards` and `gift_card_uses` (`020`; `151` adds
  `voided_at` and negative refund rows; `191` makes uses once-only).
- **Logic.** `src/lib/giftcards.ts`: codes `RMP-XXXX-XXXX`, valid 12 months,
  issued idempotently on «paid», redeemed atomically.
  - PDF: `src/lib/giftcard-pdf.ts` (A5, stored in R2 at
    `giftcards/<code>.pdf`, link `GET /api/giftcards/[code]/pdf/?t=` with an
    HMAC under `SESSION_SECRET`).
  - Balance check: `POST /api/giftcards/check/`.
- **Amounts.** `GIFT_AMOUNTS [25,50,75,100]`, on sale per
  `settings.gift_amounts` (default 25/50/100). The tile reads the setting.
- **Refunds.** `creditGiftCard` puts money back on the card; `voidGiftCards`
  cancels cards on a fully refunded order.
- **Admin.** «Маркетинг → Подарочные карты».

**Tests.**

- vitest: `giftcards`, `giftcard-pdf`, `giftcard-mail-pdf`, `gift-meta`,
  `payments-giftcard*`, `payments-refund-giftcard`, `giftcards-held`,
  `gift-loyalty-once`, `admin-gift-amounts`, `mail-giftcard-texts`.
- e2e: `giftcard`, `admin-giftcards`.

**State.** Works.

---

## 9. Promo codes

**For / users.** A code typed at checkout: percent, fixed euro or free
delivery, with limits, counted only when the order is paid.

**How it works.**

- **Tables.** `promo_codes` and `promo_code_uses` (`060`). Scope
  `order|brand|product` comes from `170`; `cart` with `scope_lines` from
  `197`.
- **Logic** (`src/lib/promos.ts`). A narrowed code discounts only the
  matching lines. `free_shipping` cannot be scoped.
- **Routes.** `POST /api/promos/check/` and
  `GET|POST|PATCH|DELETE /api/admin/promos/` (DELETE only for an unused code:
  409 `in_use`/`on_order`).
- **Abandoned-cart discount.** `runAbandonedCartsDiscount` mints `REM-CART-…`
  codes (defaults: 3 days, 5 %, basket from 100 €). It runs only when
  `flows.abandoned` is on, which is off by default.
- **Birthday codes.** `REM-BD-…` (§12).

**Tests.**

- vitest: `promos`, `promo-scope`, `promos-r21`, `admin-promo-form`,
  `admin-promo-scope-label`, `flows-cart-discount`, `fuzz-money`.
- e2e: `admin-promos`, `promo-scope`, `sweep-checkout`.

**State.** Works.

---

## 10. Loyalty and partners

**For / users.** A lower price for salons and masters, and points for retail
customers. **Both are off.**

**How it works.**

- **Defaults.** `DEFAULT_PRICING.partnersOn: false` (`src/lib/loyalty.ts`).
  `loyaltyOn() = partnersOn && loyalty.enabled`. With the switch off, nothing
  is earned, redeemed or drawn, and an approved partner is priced as retail.
  Nothing is deleted, so switching it back on restores every screen.
- **Tables.** `100_tiers_loyalty.sql` and `101`; refund lines come from
  `loyalty-lines.ts` (`214`).
- **Routes.** `GET /api/account/pricing/`, `POST /api/account/pro-request/`,
  `GET|POST /api/admin/customers/`, `GET|PATCH /api/admin/customers/[id]/`.
  The settings page is «Настройки → Цены и баллы».

**Tests.**

- vitest: `loyalty`, `loyalty-lines`, `partners`, `partners-switch`,
  `partner-race-r21`, `partner-day-r22`, `admin-partner-undo`,
  `account-flows`.

**State.** Built and off, by Renat's «later».

---

## 11. Customer accounts

**For / users.** Lets a customer see orders, invoices and receipts, save
details, sign in by code or with Google, ask for a return, and delete or
export their data.

**How it works.**

- **Code login** (`050_customers.sql`, `src/lib/customers.ts`). Cookie
  `rmp_cust`, 90 days, signed with `SESSION_SECRET`. The code is six digits,
  hashed, valid 15 min, 5 attempts.
  - `POST /api/account/code/`: 3 per 15 min per IP and per e-mail.
  - `POST /api/account/login/`: 20 per 15 min.
- **Google sign-in** (since 02.11.2026). `src/lib/google-signin.ts` uses OIDC
  implicit flow with `form_post` and no client secret.
  - Routes: `/api/account/google/start` and `/callback` (state cookie
    `rmp_gauth`).
  - Without `GOOGLE_CLIENT_ID` both answer 404 and `/api/overrides` says
    `google_signin:false`, so no button is drawn.
  - Both doors end in `signInCustomer()` (`src/lib/customer-signin.ts`).
  - Setup: `docs/google-login.md`.
- **Privacy** (`src/lib/account-privacy.ts`).
  - `GET|POST /api/account/delete` needs a typed e-mail confirmation and is
    refused while orders are open. It sets `223`'s `orders.account_erased_at`;
    orders are kept.
  - `GET /api/account/export` returns a JSON file.
- **Other routes.** `GET|PATCH /api/account/me/`, `POST /api/account/logout/`,
  `GET /api/account/orders/[id]/{invoice,receipt}`,
  `POST /api/account/return-request`, `POST /api/stock-alerts/`,
  `GET /api/carts/resume?t=` (HMAC-checked resume from the cart letter),
  `GET|POST /api/mail/unsubscribe/` (one HMAC per mailbox, RFC 8058
  one-click).
- **Customer source.** `customers.source` = `shopify` for imported customers
  (`221`).

**Tests.**

- vitest: `account-flows`, `account-privacy`, `acct-privacy-ui`,
  `google-signin`, `returns`, `resume-link`, `account-invoice`,
  `account-receipt`, `account-login-spent-code`, `account-rate-wait`,
  `account-code-e2e-hook`, `acct-default-delivery`, `acct-imported-door`,
  `import-shopify-customers`, `consent`.
- e2e: `account`, `account-privacy`, `account-settings`,
  `account-order-details`, `google-signin`, `addresses`.

**State.** Works. Google sign-in has been live since 02.11. The Google
consent screen shows «continue to rempireshop.com» until the optional brand
verification.

---

## 12. Mail

**For / users.** Every letter the shop sends, with the owner able to edit
subject, intro and signature, and the newsletter («Рассылка»).

**How it works.**

- **Sending** (`src/lib/mail.ts`). Resend REST with a 12 s timeout and one
  retry on 5xx or network error (`MAIL_RETRY_DELAY_MS`). It supports
  idempotency keys and attachments up to 8 MB. `kind` is `transactional`
  (default) or `marketing`. `quotaRefusal()` tells the daily quota apart from
  the per-second limit. Defaults: `RESEND_FROM` = `Rempire
  <shop@rempireshop.com>`, `MAIL_REPLY_TO` = `info@rempireshop.com`.
- **Templates** (16 renderers in `src/emails/`).

  | Letter | Sent by |
  |---|---|
  | `order-confirmed` | `onOrderPaid`; the pending variant only with `flows.pending` or `MAIL_PENDING_PAYMENT` |
  | `pos-receipt` | the till |
  | `order-shipped` | `ship-order.ts` |
  | `order-cancelled` (cancelled / refunded / refund_sent) | `onOrderClosed` |
  | `order-unpaid` | the unpaid-orders flow |
  | `gift-card` | gift-card issue, with the PDF attached |
  | `login-code` | the code login |
  | `partner-welcome` | partner approval |
  | `invoice`, `invoice-reminder`, `invoice-cancelled` | the invoice flow |
  | `abandoned-cart`, `abandoned-cart-discount`, `back-in-stock`, `birthday` | `flows.ts` |
  | `newsletter` | «Рассылка» |

  Shipped, cancelled, invoice and reply letters are held 10 s
  (`letter-hold.ts`). 14 templates have owner-editable texts
  (`settings.mail_texts`, `src/lib/mail-texts.ts`).
- **Flows** (`src/lib/flows.ts`, `FLOW_DEFAULTS`: **every switch off**).
  - abandoned cart after `abandonedHours` (3, settable from 1 to 168);
  - the discounted follow-up;
  - back-in-stock on the out→in move and in the daily sweep;
  - birthday `birthdayDays` early (0 = the day itself);
  - unpaid orders.

  Every run is recorded in `settings.flow_runs` («Последний запуск» in
  «Письма»). `docs/flows.md` covers this, including «Почему ничего не ушло».
- **Consent.** `src/lib/consent.ts`, `mail_optouts` (`052`): marketing letters
  skip opted-out addresses and carry `List-Unsubscribe` headers.
- **Budget.** `settings.mail_budget` (`{cap 100, reserve 30}`) with the
  counter `mail_sends_daily` (`201`, per UTC day and kind).
  - Transactional mail is always sent.
  - Marketing stops at `cap − reserve`. A newsletter that does not fit
    **parks** and is resumed by the daily cron.
  - The owner is told once a day by push and Telegram.
- **«Рассылка».** `src/lib/newsletters.ts` and `newsletter-blocks.ts`
  (`160`, `204`; blocks are img/text/btn/product/html).
  - Routes: `/api/admin/newsletters[/audience|/preview|/[id]/{preview,send,test}]`.
  - It sends two letters a second.
  - Images go to R2 `news/` as JPEG/PNG.
- **Admin routes.** `GET /api/admin/mail/preview/` (no admin check by design,
  rate-limited), `POST /api/admin/mail/test/` (20/h), `POST /api/admin/mail/send/`
  (30/h), `GET /api/admin/flows/`, `POST /api/admin/flows/run/`.

**Tests.**

- vitest: `emails`, `emails-compat`, `mail`, `mail-hooks`, `mail-texts*`,
  `mail-send`, `mail-preview`, `mail-budget`, `mail-flow-samples`,
  `letter-hold`, `letters-r22`, `consent`, `flows-run`, `flows-cart-discount`,
  `flows-unpaid`, `backstock-transitions`, `newsletters*`,
  `newsletter-blocks`, `upload-news`, `invoice-dunning*`, `admin-news-*`,
  `admin-mail-*`.
- e2e: `admin-mail`, `admin-newsletter`, `admin`, `admin-sections`.

**State.** Works. Resend's free tier is 100 letters a day and 3 000 a month;
there is no monthly counter in the shop. No delivery log is kept in the
database; use Resend's dashboard.

---

## 13. AI — assistant, text generator, chat, search, photo cut-out

**For / users.** Renat's assistant that proposes changes he confirms, the
three-language texts, the shop chat, and AI help for search.

**How it works.**

- **Model** (`src/lib/openai-chat.ts`). `DEFAULT_OPENAI_MODEL = "gpt-6-luna"`,
  overridable with `OPENAI_MODEL`. `reasoning_effort: "none"` is sent for
  reasoning models; the cap goes as `max_completion_tokens`.
- **Assistant** (`POST /api/assistant/`, `src/app/api/assistant/route.ts`,
  `PROMPT_V = 30`).
  - Shop mode: public, same-origin, 10 msg/min/IP, 400 tokens, catalogue
    slice and blog.
  - Admin mode: needs the admin cookie **and** an `Origin` header; 2 500
    tokens.
  - `sanitizeAction()` in `actions.ts` whitelists 39 action types: 5 shop and
    34 admin.
  - The admin ones include `set_price`, `set_size_prices`, `set_stock`,
    `stock_adjust`, `stock_set`, `set_seo`, `set_description`, `set_names`,
    `set_subcat`, `set_page_texts`, `set_home_brands`, `create_product`
    (hidden), `update_product`, `propose_bundle`, `set_bundle`,
    `delete_bundle`, `set_hero`, `set_content`, `create_promo`,
    `toggle_promo`, `set_shipping_rules`, `set_pricing`, `adjust_points`, the
    post actions (`draft_post`, `draft_from_materials`, `edit_post`,
    `publish_post`, `set_post_cover`, `add_post_photo`), `add_product_photo`,
    `export_report` and the toggles.
  - Every action is a proposal card, applied by the panel through the normal
    routes.
- **Text generator** (`POST /api/admin/ai/text/`, `AI_TASKS`).
  - 11 tasks: describe, translate, seo, reply, blog_outline, post_full,
    post_translate, post_edit, copy, newsletter, sections.
  - **200/h** per IP, shared with `/api/admin/blog/draft`. The panel says
    «Лимит ИИ на этот час — снова через N мин».
  - Prompts are in `src/lib/ai-prompts.ts`. Every call is journaled as
    `ai.text`.
- **Shop chat** (`public/shop2/chat.js`). `mountChat()` loads it only on
  screens ≥768 px, outside checkout/admin/scan, and when `settings.chatbot`
  is not off. It reads blog articles (`chat-blog-card`).
- **AI search.** `POST /api/search/` (§3).
- **Photo cut-out.** `POST /api/admin/upload/cutout/` (40/h) uses
  `gpt-image-2.5-sunburst` images/edits, only with `PHOTO_CUTOUT=openai`.
- **Build time.** The search cards (§3).

**Tests.**

- vitest: `ai-*`, `assistant-*` (actions, prompt, robust, photos,
  admin-auth, bundles, intent, probe, promo-terms, reply-lang,
  shop-catalogue, shop-guides, stock-more, texts), `admin-assistant-*`,
  `post-edit`, `security-assistant`, `openai-chat`, `photo-cutout`, `search`,
  `search-terms`, `chat-blog-card`.
- e2e: `admin-assistant*`, `admin-blog`, `admin-products`, `chatbot`,
  `sweep-admin`. All e2e runs are keyless.

**State.** Works with the key; the real model is unverified by CI. Live
checks are done by hand from a signed-in admin tab (`docs/assistant-work.md`).

---

## 14. Blog and the «Rempire» connector for Claude

**For / users.** Articles in three languages, written by Renat, by the
assistant, or by Renat's own Claude through the connector.

**How it works.**

- **The `posts` table** (`070`) has grown:
  - soft delete `deleted_at` (`195`);
  - cover focus and per-frame crops (`193`, `205`, `blog-cover.mjs`);
  - `tags_i18n` (`209`);
  - magazine fields `topic`, `featured`, `cover_w`/`cover_h`, `sources`
    (`227`, `blog-magazine.mjs`).
- **Libraries.** `src/lib/blog.ts` (sanitising, publish/unpublish/soft
  delete), `blog-draft.ts`, `blog-cards.ts`, `blog-html.mjs`, `blog-words.mjs`
  and `blog-cache.ts`.
- **Materials** (`blog_materials`, `228`, `src/lib/blog-materials.ts`).
  Sources an article is written *from*: pdf, image, link or text. Links are
  fetched through the SSRF guard (`safe-fetch.ts`, `blog-material-link.ts`);
  PDFs are read by `src/lib/pdf-text.ts`.
- **Routes.**
  - Admin: `GET|POST|PATCH|DELETE /api/admin/blog/`,
    `POST /api/admin/blog/draft` (a Russian draft from materials, or ET/EN
    translation; never publishes), `/api/admin/blog/materials`.
  - Public: `GET /api/blog/?lang&page` and `/api/blog/[slug]/`
    (`s-maxage=86400`, tag `blog`, dropped on every save).
- **Rebuild.** Publishing, unpublishing, deleting or editing a live article
  calls `requestRebuild()` (§24).
- **Connector** (since 20.10.2026; `docs/claude-connector.md`).
  - `POST /api/mcp` takes stateless JSON-RPC (240/min, 256 KB).
  - OAuth 2.1 with PKCE and DCR: `/oauth/register|authorize|token`,
    `/.well-known/oauth-authorization-server`,
    `/.well-known/oauth-protected-resource[/api/mcp]`. The sign-in is the
    admin password.
  - Tokens are HMAC-signed under `SESSION_SECRET` and carry a fingerprint of
    `ADMIN_PASSWORD_HASH`: code 300 s, access 1 h, refresh 90 days.
  - **20 tools** (`TOOLS` in `src/lib/mcp/tools.ts`):
    - read: `search_products`, `get_product`, `list_sections`, `list_posts`,
      `get_post`, `list_materials`, `get_material`, `get_upload_link`,
      `get_page_texts`, `get_brand_strip`;
    - write: `save_draft` (drafts only; a published article is refused),
      `save_material`, `save_product_google_text`, `save_product_description`,
      `save_product_name`, `save_product_price` (more than 30 % needs
      `confirm: true`, measured against the price before Claude's first change
      of the day), `save_product_stock` (needs the `was` count),
      `create_product` (always hidden), `save_page_text`, `save_brand_strip`.
  - Every write is journaled with `via: "claude"` and an undoable `prev`.
  - Claude cannot publish, delete, or see orders or customers.

**Tests.**

- vitest: `blog`, `blog-page`, `blog-cache`, `blog-cards`, `blog-card-*`,
  `blog-cover*`, `blog-magazine`, `blog-materials`, `blog-tags-lang`,
  `blog-topic-r23`, `blog-prerender-prices`, `admin-ux1a-blog`,
  `mcp-connector`, `rebuild`, `fuzz-routes`.
- e2e: `admin-blog`, `admin-blog-pictures`, `blog`, `blog-magazine`,
  `blog-materials`, `blog-files-simple`.

**State.** Works. Dim's Claude is the connected one today. Renat connects his
own after he sets his own panel password (handover row
`ho-claude-connector`), and the password change signs Dim's out.

---

## 15. Content and settings

**For / users.** The owner's texts and switches: the banner, the top strip,
the brand row, company details, page texts, legal pages, and the settings
pages.

**How it works.**

- **Storage.** `settings` (key → jsonb).
  - `PUT /api/admin/settings/` has per-key cleaners for `pricing`,
    `shipping_rules`, `mail_texts`, `mail_budget`, `gift_amounts`, `invoice`,
    `delivery`, `shipping_parcel`, `payment_banks`, `flows`, `page_texts`,
    `home_brands`, `hero` and `gbp_store_code`. `content` is cleaned when it
    is read (`mergeContent`).
  - `PUT` also accepts `undoOf`/`ref` for the journal.
  - `GET /api/overrides/` publishes `PUBLIC_SETTINGS`: chatbot, bundles, hero,
    flows, shipping, shipping_rules, content, gift_amounts, invoice,
    page_texts and home_brands, plus a computed `google_signin` and the
    public part of pricing.
  - System rows: `flow_runs`, `rebuild`, `backup_last`, `montonio_readiness`,
    `shipping_statuses`, `golive_states`, `content_report_day`, `gsc_cache`
    and `vat_rate`.
- **Settings pages** (`ADM_SET_PAGES`): «Доставка и оплата», «Главная
  страница», «О компании», «Тексты страниц», «Цены и баллы», «Оповещения на
  телефон», «Журнал».
- **Home page.** Switches «Полоска сверху», «Наборы» and «Чат-помощник»; the
  strip texts; «Строка брендов» (`settings.home_brands`,
  `src/lib/home-brands.ts`, one switch per brand); and the banner editor
  (`src/lib/hero.ts`: up to 5 slides of kind wide, half or product, with
  focus).
- **Page texts** (`settings.page_texts`, `src/lib/page-texts.mjs`). For every
  section and brand page, the Google title (≤ 70), description (≤ 170) and
  the line under the heading (≤ 1 200), ×3 languages. Saving triggers a
  rebuild. «Перевести на ET и EN» fills the other languages.
- **«О компании».** «Реквизиты» (incl. IBAN and bank for invoices), «Часы
  работы», «Страница „Контакты“», «Соцсети», «Счета для компаний», «Подпись
  в письмах», and «Отчёт для бухгалтера» (§17).
- **Defaults and legal.** `DEFAULT_CONTENT` in `src/lib/content.ts`, packed by
  `tools/pack-content.mjs`. Legal texts are `public/shop/legal.{ru,et,en}.js`
  (fallback `legal.js` via `tools/sync-legal-fallback.mjs`).
- **Other writers.** The assistant (`set_hero`, `set_content`,
  `set_home_brands`, `set_page_texts`) and Claude (`save_page_text`,
  `save_brand_strip`).

**Tests.**

- vitest: `content`, `page-texts`, `home-brands`, `hero-kinds`,
  `settings-audit-r21`, `admin-ux1a-settings`, `admin-content-page-scope`,
  `legal-structure`, `reports`, `content-report`.
- e2e: `admin`, `admin-page-texts`, `admin-home-brands`, `hero-kinds`,
  `admin-sections`, `sweep-admin`, `info-pages`.

**State.** Works. Legal texts still wait for a lawyer
(`docs/legal-review.md`).

---

## 16. Reviews

**For / users.** Real customer reviews on product pages, published only after
Renat approves them.

**How it works.**

- **Table.** `reviews` (`021`; `022` adds `email`, taken from a signed-in
  customer).
- **Logic** (`src/lib/reviews.ts`). 20–1 500 characters, honeypot, link and
  profanity filters, IP hash salted with `SESSION_SECRET`. Rate limits: 30/h
  before parsing, 3/h after validation.
- **Routes.** `GET|POST /api/reviews/` and `GET|PATCH /api/admin/reviews/`.
  Moderation tabs are «Новые · Опубликованные · Скрытые». «Сделать сегодня»
  names up to four pending reviewers (`overview-names.ts`).

**Tests.**

- vitest: `reviews`.
- e2e: `product`, `admin-sections`, `reviews-attribution`.

**State.** Works. `public/shop/reviews-pool.js` is an orphan.

---

## 17. Analytics and reports

**For / users.** Sales and visitor numbers for the owner, Search Console
figures, and the accountant's export.

**How it works.**

- **Events.** The `events` table (`080`) keeps 90 days.
  `POST /api/track/` accepts 60/min, ≤1 KB, drops bots, and runs only after
  analytics consent.
- **Sources** (app.js `AD_SOURCES`/`refHost()`). gclid/gbraid/wbraid or
  `utm_source=google-ads` is filed as `ads.google.com`;
  `utm_source=chatgpt-ads` as `ads.openai.com` (05.11). The source is kept per
  tab in `sessionStorage["rmp_ad"]`. «Вернулись по письму» comes from
  `cart_returns` (`213`).
- **Figures.** `src/lib/analytics.ts`, with days on the Tallinn calendar
  (`src/lib/day.ts`). Routes: `GET /api/admin/overview/` (plus
  `overview-extras.ts`: blog counts, integration problems, and `cronHealth`,
  stale after 26 h; plus `overview-names.ts`) and
  `GET /api/admin/analytics/?range=`.
- **Search Console.** `GET /api/admin/analytics/gsc/` (`src/lib/gsc.ts`,
  service-account JWT, `webmasters.readonly`, cached 24 h in
  `settings.gsc_cache`).
- **Reports.** `GET /api/admin/reports/orders/?month=` or `?from=&to=`,
  `format=json|csv|xlsx` (`src/lib/reports.ts`; CSV with a BOM and `;`; VAT
  per order from `orders.vat_rate`).

**Tests.**

- vitest: `track`, `events`, `overview*`, `analytics*`, `ad-source`, `gsc`,
  `reports`, `shop-day`, `admin-revenue-bars`, `admin-stale-figures`.
- e2e: `stats-search`, `admin-shell`.

**State.** Works. GSC has been connected since 25.10. Figures under-count
visitors who decline consent. There is no Google Analytics 4 on the site.

---

## 18. Notifications and alerts

**For / users.** Telling Renat that money arrived or something needs him, and
telling the developer when a build, a backup or a mass edit went wrong.

**How it works.**

- **Owner's order ping** (`pingOwner` in `src/lib/mail-hooks.ts`). Web Push
  and Telegram go out together. The e-mail to `RESEND_TO` goes only if no
  device took the push (`src/lib/notify.ts`). `RESEND_TO` has no default.
- **Web Push** (`src/lib/push.ts`). VAPID keys, `push_subscriptions` (`200`),
  `public/shop2/admin-sw.js`, routes `/api/admin/push[/subscribe|/unsubscribe|/test]`.
  Without keys, subscribe answers 503 and the button is never green. The
  panel page is «Настройки → Оповещения на телефон».
- **Owner alerts** (`src/lib/owner-alerts.ts`, `owner_alerts` `217`). Nine
  journal actions raise alerts, deduped, at most 10 per hour.
- **Build and data watches** (`src/lib/build-watch.ts`, run from the daily
  cron).
  - `runBuildWatch`: a deploy-hook or nightly build that never went live, or
    a hook nobody called for 26 h. It compares `BUILD_AT` with
    `settings.rebuild` and mails `DEV_ALERT_TO`.
  - `runHideWatch`: 8 or more in-stock products hidden in 24 h. Mails
    `RESEND_TO` + `DEV_ALERT_TO`.
  - `runBackupWatch`: `settings.backup_last` older than 36 h. Mails
    `DEV_ALERT_TO`.
- **Monday letter «Что поправить на сайте»** (`src/lib/content-report.ts`).
  Sent to `RESEND_TO` + `DEV_ALERT_TO`, and only when there are issues.
- **Drills.** `POST /api/admin/alert-drill/` for the build-watch path, and
  GitHub → Actions → «Alert drill» for GitHub's own failure mail.
  `GET|POST /api/admin/notify` reports the ping configuration and sends a
  test.

**Tests.**

- vitest: `push`, `push-badge`, `admin-push-*`, `owner-alerts`,
  `owner-notice`, `build-watch`, `hide-burst`, `content-report`,
  `mail-hooks`, `overview`.

**State.** Works. `DEV_ALERT_TO` defaults to `info@diipsolutions.eu` (Dim).
Decide at the handover whether that stays (Appendix A).

---

## 19. Cron jobs

**For / users.** Everything that must happen without a button. It runs
automatically on Vercel's production deployment only.

**How it works.**

- **`GET /api/cron/flows/`** (07:00 UTC, `maxDuration 60`) runs, in order:
  1. `runFlows`: abandoned cart, its discount follow-up, the back-in-stock
     sweep, birthdays;
  2. `runInvoiceDunning`;
  3. `runUnpaidOrders`;
  4. `syncStaleShipments`;
  5. `closeDeliveredOrders`;
  6. `runContentReport`;
  7. `runBuildWatch`;
  8. `runHideWatch`;
  9. `runBackupWatch`;
  10. `pruneCartWrites`;
  11. `reconcileUnpaidOrders`;
  12. `recheckPendingRefunds` (≤ 30 s);
  13. `resumeParkedNewsletters`.

  It answers one JSON summary of all of them.
- **`GET /api/cron/events-retention/`** (03:30 UTC) runs
  `runRebuild("nightly", {force: true})`, then deletes events older than 90
  days.
- **`/api/cron/payments-reconcile/`** is a route with no schedule. The flows
  cron does its work.
- **Auth.** Every cron route needs `Authorization: Bearer <CRON_SECRET>`
  (`timingSafeEqual`). Without the secret it answers 503; with a wrong one,
  401.
- **Panel controls.** «Маркетинг → Письма» → «Запустить сейчас»
  (`POST /api/admin/flows/run/`) runs the same flow functions. «Сделать
  сегодня» warns when the job has not run for 26 h.

**Tests.**

- vitest: `account-flows`, `flows-run`, `flows-unpaid`,
  `flows-cart-discount`, `events`, `payments-reconcile`, `delivery-close`,
  `shipment-poll`, `rebuild`, `build-watch`.

**State.** Works. Pro allows more frequent crons; none has been added. An
hourly `payments-reconcile` would be the first candidate, but the plan is to
return to Hobby.

---

## 20. Uploads and storage

**For / users.** Photos and videos the owner uploads from his phone,
newsletter pictures, and the gift-card PDFs.

**How it works.**

- **Storage** (`src/lib/storage.ts`). Cloudflare R2 over hand-rolled SigV4,
  key prefixes `products/ hero/ reviews/ blog/ videos/ giftcards/ news/`. The
  public base is `R2_PUBLIC_BASE` (`https://img.rempireshop.com` since
  21.09.2026). Old `pub-….r2.dev` URLs are still recognised via
  `R2_PUBLIC_BASE_OLD`; `tools/rehost-r2.mjs` moved stored URLs.
- **Images** (`src/lib/images.ts`). ≤ 12 MB; HEIC refused; EXIF stripped;
  WebP at 1 600 px plus a 400 px thumbnail; `processEmailImage` makes
  JPEG/PNG for mail.
- **Video** (`src/lib/video.ts`). MP4/MOV ≤ 60 MB, plus YouTube, Vimeo and
  Instagram links.
- **Routes.** `POST|DELETE|GET /api/admin/upload/` (kinds product, hero,
  review, blog, video, news; 60/h) and `POST /api/admin/upload/cutout/`
  (§13).

**Tests.**

- vitest: `upload`, `upload-news`, `storage`, `storage-rehost`, `video`,
  `photo-cutout`, `security-uploads`, `admin-video-upload-limit`,
  `media-probe`, `shop-media`.
- e2e: `admin-products`, `sweep-admin-goods`.

**State.** Works. Vercel's 4.5 MB request-body cap still applies and there is
no direct-to-bucket upload, so a large video cannot pass; the panel refuses
it before sending. Panel photos are not squared for Google, so they should be
uploaded at least 1 000 px on the short side. `@vercel/blob` is gone from the
code.

---

## 21. Auth and sessions

**For / users.** One owner password for the panel (and for the Claude
connector), a code or Google for customers, and test-only doors for the e2e
suite.

**How it works.**

- **Admin** (`src/lib/auth.ts`).
  - `ADMIN_PASSWORD_HASH` is a scrypt digest (N 16384, r 8, p 1) from
    `tools/hash-password.mjs`.
  - The cookie is `rmp_admin = v1.<expiry>.<HMAC>` under `SESSION_SECRET`:
    30 days, HttpOnly, SameSite=Lax, Secure except on localhost.
  - **The cookie does not depend on the password.** Changing
    `ADMIN_PASSWORD_HASH` keeps existing panel sessions until they expire;
    changing `SESSION_SECRET` ends them.
  - `requireAdmin()` guards every `/api/admin/*` route except `login`,
    `logout`, `me` and `mail/preview`, which `tests/fuzz-routes.test.ts`
    enforces.
  - Login backoff instead of a 429: 2 free tries, then a delay that doubles
    from 500 ms to 20 s. Failures are counted in `admin_audit`
    (`admin.login.failed` since the last `admin.login`, `192`).
- **Customers.** `rmp_cust` and Google (§11).
- **Connector.** OAuth reuses the admin password and its backoff (§14).
- **Rate limits.** In memory, per instance (`auth.rateLimit`,
  `payments/ratelimit.allow`), keyed on the first `x-forwarded-for`.
- **Test doors.** Two flags open them, and only when `NODE_ENV` is not
  production:
  - `E2E_BOOTSTRAP=1` opens `/api/e2e/bootstrap/` and the admin-only
    `/api/e2e/gift-card/` and `/api/e2e/mail/`;
  - `E2E_EXPOSE_LOGIN_CODE=1` puts the login code in the response.

**Tests.**

- vitest: `auth`, `fuzz-routes`, `security-*`, `account-code-e2e-hook`,
  `csp-default-src`, `mcp-connector`, `admin-door`, `assistant-admin-auth`.
- e2e: `sweep-admin`.

**State.** Works. There are no roles and no session revocation besides
rotating `SESSION_SECRET`. For what else that rotation breaks, see
`docs/RUNBOOK.md` §9.

---

## 22. Database and migrations

**For / users.** Where every order, setting and edit lives, and how the
schema reaches production without anyone running SQL by hand.

**How it works.**

- **Connection** (`src/lib/db.ts`). One `pg` pool per instance
  (`DATABASE_POOL_MAX`, default 5), or PGlite with `DB_DRIVER=pglite`. It
  strips NULs and casts jsonb. After any write to `product_overrides`,
  `settings`, `custom_products`, `stock_levels`, `stock_moves` or `bundles`,
  it drops the `shop-feed` CDN tag (§24).
- **TLS.** `sslFor()` in `db.ts` and in `tools/migrate.mjs` (the same rule
  twice): local host or `sslmode=disable` → no TLS;
  `DATABASE_SSL_NO_VERIFY=1` → TLS unverified; otherwise verified against
  `DATABASE_SSL_CA` or the public store (`docs/backend.md`). Railway signs
  with a private CA, so it needs one of the two. **Production runs with
  `DATABASE_SSL_NO_VERIFY=1` today.**
- **Tables** (32 plus `_migrations`):
  - `001`: settings, product_overrides, orders, admin_audit;
  - `020`/`021`: gift_cards, gift_card_uses, reviews;
  - `050`: customers, login_codes, carts, stock_alerts;
  - `052`: mail_optouts;
  - `060`: promo_codes, promo_code_uses;
  - `070`: posts;
  - `080`: events;
  - `090`: stock_levels, stock_moves;
  - `100`: loyalty_ledger;
  - `111`: order_messages;
  - `120`: bundles;
  - `131`: custom_products;
  - `141`: invoice_counters;
  - `160`: newsletters, newsletter_sends;
  - `180`: idempotency_keys;
  - `181`: cart_writes;
  - `200`: push_subscriptions;
  - `201`: mail_sends_daily;
  - `213`: cart_returns;
  - `217`: owner_alerts;
  - `228`: blog_materials.

  The other migrations add columns, indexes and data fixes.
- **Applying migrations.**
  - `tools/pack-migrations.mjs` packs them into
    `src/db/migrations.generated.ts` (in `prebuild`; `tests/migrations.test.ts`
    catches a stale pack).
  - `tools/migrate.mjs --if-configured` applies them in `postbuild` and
    records them in `_migrations`. **A failure is logged and the build goes
    on (exit 0).**
  - Manual: `GET|POST /api/admin/migrate/`.
- **Numbering.** `docs/build-contracts.md` defines ranges only up to 119.
  Later numbers are chronological. Two branches can add the same number
  without a git conflict, so check after merging.
- **Backups.** `.github/workflows/backup.yml`, twice a day: `pg_dump`,
  restore into a scratch Postgres 18 with row-count comparison, GPG AES-256,
  artifact kept 30 days. It stamps `settings.backup_last`. `docs/backup.md`
  has the procedure; `tools/db-backup.mjs` makes a local custom-format dump
  through Docker. Railway Hobby makes no backups of its own.
- **Password rotation.** `tools/rotate-db-password.mjs` changes the role
  itself. Changing `POSTGRES_PASSWORD` on Railway does not.

**Tests.** Every test applies the migrations on PGlite first (once per file,
since 30.10). Plus `tests/migrations.test.ts`, `shipping-migration`,
`bundles-db` and `one-size-stock-migration`.

**State.** Works. Production has been migrated by every deploy since
03.09.2026.

---

## 23. Testing and CI

**For / users.** Proving the shop still works after every change, without a
bank, a carrier or a mailbox. Dim and the agents run it; so do GitHub
Actions.

**How it works.**

- **vitest.** 408 files on PGlite (`vitest.config.ts`: `DB_DRIVER=pglite`,
  `fileParallelism: false`, 30 s test timeout). Routes are called directly
  and external fetches are stubbed. The fuzz layer
  `tests/fuzz-*.test.ts` sends a lighter sample to the money routes per push
  and the whole corpus with `FUZZ_FULL=1`. Locally the whole suite takes more
  than 10 minutes, and the fuzz-routes test's 180 s timeout measures the
  machine.
- **Playwright.**
  - `node tools/e2e-build.mjs` runs the prerender and the packers. Then
    `webServer: next dev --port 3417` (`E2E_PORT`) runs with PGlite, mock
    payment and shipping, `E2E_BOOTSTRAP=1`, `E2E_EXPOSE_LOGIN_CODE=1`, and
    OpenAI, Resend and Google keys forced empty. The bootstrap route is the
    readiness URL.
  - Projects: `desktop` 1280, `tablet` and `mobile` (Chromium),
    `mobile-safari` (WebKit iPhone 13, `SAFARI_SPECS` only) and
    `webkit-local` (local only).
  - Gating: `DESKTOP_ONLY`, `PHONE_IS_SAFARI` and `NO_TABLET` keep each spec
    on the projects that matter. `workers: 1`, because every test shares one
    database.
  - `smoke.spec.ts` and `perf-*` are never in the main suite; they have their
    own configs.
- **Smoke.** `npm run smoke -- <url>`: read-only GETs against a deployed shop
  (`playwright.smoke.config.ts`, 2 workers, 1 retry in CI).
- **CI** (`.github/workflows/ci.yml`).
  - Every push except docs-only: `checks`, which is typecheck + vitest in
    **3 shards**, ~5 min each, 20 min timeout.
  - Weekly (Mon 03:40 UTC) and «Run workflow»: also `e2e` in 4 Chromium
    shards (60 min timeout) and `safari` (WebKit).
  - A push cancels the previous push run, but never a full run.
  - Failure reports are uploaded as HTML only and kept 2 days.
- **Other workflows.**
  - `promote.yml`: CI green → fast-forward `production` → wait for Vercel →
    call `smoke.yml`.
  - `smoke.yml`: `deployment_status` success, 05:37/11:37/17:37 UTC, called
    by promote, or the button.
  - `backup.yml`: 01:17 and 13:43 UTC.
  - `alert-drill.yml`: the button.
- **Owner-proof build.** `tools/chaos-build.mjs` takes a snapshot of live
  build data (read-only, outside the repo) and replays about thirty
  owner-style edits (`scenario` entries). Each is followed by the real
  prerender and a lint of every page it wrote.

**State.** Works. Not automated:

- real Montonio (payments, labels, refunds);
- the real OpenAI model;
- the camera scanner;
- the admin on Safari;
- e-mail landing in an inbox.

The hand-run checklist `/test` was retired on 03.11.2026.

---

## 24. Deploy, environments, CPU and caching

**For / users.** Getting a tested commit onto rempireshop.com, rebuilding the
static pages when the owner's data changes, and staying inside Vercel's
limits. Dim and the workflows do this; the owner's edits trigger rebuilds.

**How it works.**

- **Environments.**
  - **Production** is rempireshop.com (and `www`, which redirects): Vercel
    project `rempire-web`, Production Branch **`production`**, region
    `fra1`.
  - **rempireshop.diipsolutions.eu** is the same deployment under Dim's
    domain: `/handover`, the panel, the API, and 301s for everything else.
  - **Previews** are any other branch, behind Vercel's deployment protection.
  - **Local:** `npm run dev` on 3300 and e2e on 3417.
- **Flow.** Push to `main` → CI → `promote.yml` fast-forwards `production`
  (never forced; it refuses when `production` is ahead) → Vercel builds →
  smoke. `vercel.json` `git.deploymentEnabled.main: false` stops `main`
  building by itself. Docs-only pushes run no CI and ride with the next code
  push.
- **Build.** `prebuild`: pack migrations, content, legal, feed and search
  cards; copy vendor files; minify; prerender. Then `next build`, then
  `postbuild` migrate. The prerender reads the database, so a build reflects
  today's data.
- **Rebuilds without code** (`src/lib/rebuild.ts`). `requestRebuild()` calls
  the Vercel Deploy Hook in `DEPLOY_HOOK_URL` (hook «rebuild-production» on
  branch `production`):
  - on blog publish, unpublish, delete and live edits;
  - on product renames;
  - on page-text saves.

  At most one build per 5 minutes (`MIN_GAP_MS`, state in `settings.rebuild`),
  plus a forced build nightly at 03:30 UTC. Only the live shop calls it.
- **CPU and caching measures (30.10–03.11.2026).** Vercel warned at 75 % and
  then 90 % of Hobby's 4 h Fluid Active CPU. The fixes:
  - the middleware matcher skips canonical pages (§2);
  - `/api/overrides/` and `/api/bundles/` are cached `s-maxage=86400` (600
    until 05.11, 20f9a66f) under the tag `shop-feed` (`src/lib/feed-cache.ts`), dropped by `db.ts` after any
    write to the six feed tables;
  - `/api/overrides/hidden/` is cached `s-maxage=86400` under the tag
    `hidden-products` (`src/lib/hidden-cache.ts`), dropped when `hidden`
    changes;
  - `/api/reviews/` is cached `s-maxage=86400` under the tag `reviews`
    (`src/lib/reviews-cache.ts`), dropped by any statement that writes
    `reviews` (`db.ts`); `POST /api/admin/migrate` drops all four tags;
  - the blog API is cached a day under the tag `blog`;
  - the middleware loads `seo-head` only for a hidden product's 404;
  - Dim's host 301s shop pages to the live domain.

  The project moved to **Pro on 03.11.2026** so it would not be paused. The
  handover note says it can go back to Hobby once the 30-day total is well
  under 4 h and under ~8 min a day (Vercel → Settings → Billing).
- **Domain and DNS.** The domain is registered at Zone.ee; DNS is on
  Cloudflare. `A @` → `76.76.21.21` and `CNAME www` → Vercel, both DNS only
  (`docs/launch-runbook.md` §6). There are records for Resend, Google
  verification, Email Routing MX and `img` (R2) — touch none of them.

**Tests.** `tests/middleware-matcher.test.ts`, `dim-host-redirect`,
`cache-headers`, `feed-cache`, `hidden-cache`, `rebuild` and `build-watch`;
the smoke suite after every promote.

**State.** Works. The repository is public and goes private at the handover,
and CI already fits the private-repo free minutes. For a deploy blocked by
CI, see `docs/RUNBOOK.md` §5.

---

## 25. Retired surfaces

These existed and are gone. History is in git.

| Surface | Retired | Notes |
|---|---|---|
| Questionnaire, design hub, prototypes, `@vercel/blob` forms | 07.09.2026 | `docs/audit/2026-09-07-cleanup.md`, `448cbd7`. The Blob store `rempire-qa` still exists on Diip's team (handover row `ho-blob-cleanup`). |
| `/shop2/…` address scheme | 08.10.2026 | 301 by `legacyShopTarget()` |
| `/guide` overview page | 25.10.2026 | — |
| `/test` acceptance checklist and `/api/testplan/` | 03.11.2026 | last in `9dd7e412` |
| `/cards`, `/golive` on rempireshop.com | 03.11.2026 | `/golive` data kept for `/handover` (`76c9fb2d`, `590e8dae`) |
| MakeCommerce stub, Venipak, the «Заполнить по тарифам Montonio» button | 07.09 / 14.09 / later | — |
| `/api/geo` | still routed | The storefront no longer calls it (only a comment in app.js mentions it). Candidate for removal. |
| `public/shop/` legacy SPA and 95 `p/<id>` pages | still on disk | Every address 301s |

---

## Appendix A — known gaps and open items (05.11.2026)

1. **Production database TLS is unverified.** `DATABASE_SSL_NO_VERIFY=1` is
   set; move to `DATABASE_SSL_CA` (RUNBOOK §9).
2. **Payments mock has no production guard.** `PAYMENT_PROVIDER=mock` on
   Vercel would take fake payments. The shipping mock does refuse production.
3. **Failed `postbuild` migrations do not fail the build.** A deploy can go
   live against a schema it expects but does not have. Check the build log
   for «migrate: failed».
4. **The AI-bot policy lives in two places.** `robots.txt` allows AI training
   bots (`tools/lib/robots-policy.mjs`, «open, training included»), but the
   Vercel Firewall refuses them (GPTBot, CCBot → 403; checked 05.11.2026).
   The firewall rule is a dashboard setting, outside the repository.
5. **`DEV_ALERT_TO` defaults to Dim's address.** It is set nowhere else.
   After the handover decide who gets developer alerts.
6. **`THRESH` in app.js mirrors the free-delivery setting** for first paint
   only. A changed «Бесплатно от» needs a code change to avoid a flash of
   the old number.
7. **Vercel's 4.5 MB body cap.** It limits uploads (videos) and feed size.
8. **The catalogue builders run only on Dim's machine** (hard-coded paths).
9. **`/api/cron/payments-reconcile/` is unscheduled.** Harmless (the flows
   cron does the work) but confusing.
10. **In-memory rate limits are per instance** and keyed on the first
    `x-forwarded-for`.
11. **No roles in the panel**, and no session revocation except rotating
    `SESSION_SECRET`.

## Appendix B — stale comments in code (fix when you next touch the file)

- `.github/workflows/ci.yml` and `smoke.yml` headers say Vercel deploys on a
  push to `main`. Since 29.10 `promote.yml` moves `production` and `main`
  does not build.
- `tools/montonio-webhook.mjs`, the feed and OG routes, and app.js
  `askSearchAI` say `trailingSlash` is on. It is off. API routes accept both
  spellings.
- `tools/montonio-webhook.mjs` header's `register` example names
  `rempireshop.diipsolutions.eu`. The live shop is `rempireshop.com`. Both
  work, because Dim's host does not redirect `/api`.
- `src/lib/subsections.ts` says six subcollections; there are ten.
- `tools/pack-search-cards.mjs` says nothing reads the cards; app.js reads
  `search-terms.json`.
- An app.js editor comment says name, brand and section are read-only.
  Migration 224 made them editable.
- `src/app/api/admin/shipments/route.ts` header still names Venipak.
- app.js `MANIFESTS` comment says scope `/shop2/admin/`.
- `src/lib/content.ts` header says «Настройки → Контент».
- The `mail/preview` route comment says the panel has no login.
- `src/lib/flows.ts` says the cron runs at 07:00 Tallinn. It runs at 07:00
  UTC.

## Appendix C — docs vs code

| Doc says | Code does |
|---|---|
| `docs/HOSTING.md`: Vercel Hobby; builds on every push to `main` | Pro since 03.11; builds `production` via `promote.yml` |
| `docs/backend.md`: `trailingSlash: true`; admin login «5 tries a minute per IP»; order statuses without `delivered` | `trailingSlash: false`; login backoff, no 429; `delivered` exists (`140`) |
| `docs/testing.md`: the `safari` job runs «on every push» | weekly and on the button |
| `docs/seo.md`: 831 pages, 6 subcollections | 10 subcollections |
| `docs/merchant-feed.md` («For the next developer»): sets not in the feed | sets have been in the feed since 26.10 (`g:is_bundle`) |
| `docs/mail.md` title: «ten templates» | 16 renderers |
| `docs/media.md`: public base `media.rempireshop.com` or `pub-….r2.dev` | `img.rempireshop.com` since 21.09 |
| `src/data/golive.json` `ho-db-backup`: «03:17 and 15:43 Tallinn» | 01:17 and 13:43 UTC (`backup.yml`). The same moments in winter time, one hour off in summer time. |
| `docs/SIMPLIFICATION-QUESTIONS.md`: Q-numbers into the 06.09 map | historical; this map no longer carries them |
