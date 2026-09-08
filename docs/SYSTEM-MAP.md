# REMPIRE — system map

*The single source of truth for what the platform is made of, who each part is
for, how it works, how it is tested and what state it is in. Written 06.09.2026
against `main` at `1a63cf8` from the code, the migrations, the tools, the CI
workflow, every file under `docs/`, and a walk through the admin on the e2e build
(phone width, mock payment and mock shipping providers). Companion documents:
`docs/SIMPLIFICATION-QUESTIONS.md` (numbered questions for Dim, referenced below
as **Q1…Q57**) and `docs/RENAT-WEEKLY.md` (the owner's weekly routine, in
Russian).*

**How to read a section.** Every system has the same six headings: *What it is
for* (one sentence a shop owner understands) · *Who uses it* · *How it works*
(entry points in `public/shop2/app.js` with approximate line numbers, API routes,
libraries, tables and the migration that created them, environment variable
NAMES, external services) · *How to test it* (existing vitest / Playwright files
and a manual click path) · *State today* (works / partial / mock only / untested,
with evidence) · *Simplification candidates* (pointers into the questions file).

**Conventions.** Line numbers are as of `1a63cf8`; when they drift, grep the
quoted symbol or the quoted Russian label — labels are quoted verbatim from
`app.js`. Environment variables are named, never valued. "Works" means exercised
by a test *and* seen on the e2e build; "partial" names the hole; "mock only"
means the real provider has not been driven from this code yet; "untested" means
no automated test and not walked by hand.

---

## 0. The platform at a glance

**Shape.** One Next.js 15 (App Router, serverful) project on Vercel. The shop and
the admin are **one vanilla-JS single-page app** — `public/shop2/app.js`
(21 111 lines, 874 functions, 1.46 MB), `styles.css`, `admin.css`, `chat.js`,
`index.html` — served as static files and talking to ~72 JSON routes under
`src/app/api/**`. Postgres (Railway, `DATABASE_URL`) behind `src/lib/db.ts`;
PGlite in memory for every test. The catalogue itself is **not** in the
database: it is a generated file (`public/shop/catalogue2.js`, 220 products)
built once from the Shopify CSV export; the database holds what the owner
changes on top of it (`product_overrides`) and the products he creates himself
(`custom_products`).

**Sizes.** 71 API `route.ts` + 10 page routes under `src/app/shop2/**` + the
custom sitemap; 57 files in `src/lib`; 21 SQL migrations; 74 vitest files
(19 700 lines); 33 Playwright specs; 251 commits (149 authored as
«Rempire Store», the deploy identity).

**External services** (all documented in `docs/accounts.md`):

| Service | Used for | Env var names |
|---|---|---|
| Vercel (Hobby, project `rempire-web`, team Rempire — Hobby forbids commercial use, see `docs/HOSTING.md`) | hosting, cron, deploy on push to `main` | — |
| Railway Postgres | the database | `DATABASE_URL`, `DATABASE_POOL_MAX`, `DATABASE_SSL_CA`, `DATABASE_SSL_NO_VERIFY` |
| Montonio Stargate (sandbox now) | bank links, cards, wallets; **and** shipping labels, pickup points, tariffs | `PAYMENT_PROVIDER`, `MONTONIO_ACCESS_KEY`, `MONTONIO_SECRET_KEY`, `MONTONIO_ENV`, `PUBLIC_BASE_URL` |
| Resend | every e-mail | `RESEND_API_KEY`, `RESEND_FROM`, `MAIL_REPLY_TO`, `RESEND_TO`, `MAIL_PENDING_PAYMENT`, `MAIL_RETRY_DELAY_MS` |
| OpenAI | shop chat, admin assistant, text generation, photo cut-out | `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-4.1-mini`), `PHOTO_CUTOUT`, `PHOTO_CUTOUT_TIMEOUT_MS` |
| Cloudflare R2 | uploaded photos, videos, gift-card PDFs | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE` |
| Cloudflare DNS + Email Routing | `rempireshop.com` DNS (moved 03.09), `info@`/`shop@` → Gmail | — |
| Google Search Console | admin «Аналитика» block (not configured yet) | `GSC_SERVICE_ACCOUNT_JSON`, `GSC_SITE_URL` |
| Cloudflare Web Analytics (optional) | second traffic counter | literal placeholder `CF_BEACON_TOKEN` in `index.html`, not an env var |
| Telegram (optional) | owner ping on a paid order, questionnaire forwards | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| Vercel Blob `rempire-qa` | questionnaire + prototype feedback JSON (prototype phase) | `BLOB_READ_WRITE_TOKEN` (implicit, via `@vercel/blob`) |
| Omniva public feed, DPD (optional) | pickup points when Montonio has none | `DPD_API_USER`, `DPD_API_PASS` (`POSTI_API_KEY` reserved, unused) |

Other env names: `SESSION_SECRET`, `ADMIN_PASSWORD_HASH`, `CRON_SECRET`,
`DB_DRIVER`, `PGLITE_PATH`, `NODE_ENV`, `E2E_BOOTSTRAP`, `E2E_EXPOSE_LOGIN_CODE`,
`E2E_PORT`, `SHIPPING_PROVIDER`, `CI`. Full inventory: `grep -rhoE
"process\.env\.[A-Z0-9_]+" src tools e2e next.config.ts playwright.config.ts`.

**Scheduled jobs** (`vercel.json`): `/api/cron/flows/` daily `0 7 * * *` UTC;
`/api/cron/events-retention/` daily `30 3 * * *`. Hobby allows one run a day.

**Where things live.**

| Area | Path |
|---|---|
| storefront + admin SPA | `public/shop2/{index.html,app.js,styles.css,admin.css,chat.js,*.webmanifest,icons/}` |
| generated catalogue data | `public/shop/{catalogue2.js,content*.js,legal*.js,bundles.js,paylogos.js,shipping-data.js,img/,og/,p/}`, `src/data/*.json` |
| API | `src/app/api/**/route.ts` |
| request-time pages | `src/app/shop2/**/route.ts`, `src/app/sitemap-custom.xml/route.ts` |
| libraries | `src/lib/**` (payments and shipping have sub-folders), `src/emails/*` |
| SQL | `db/migrations/NNN_name.sql` → packed into `src/db/migrations.generated.ts` |
| build & data tools | `tools/*.mjs`, `tools/lib/*.mjs`, `tools/harvest/` |
| tests | `tests/*.test.ts` (vitest, PGlite), `e2e/*.spec.ts` (Playwright), `playwright.config.ts`, `.github/workflows/ci.yml` |
| legacy | `public/shop/` (old SPA + 95 share-link pages), `design/` (brand originals). The prototype surfaces — `src/app/{page,qa,qa2,demo}`, `src/components/*`, `public/prototypes/` — were deleted 07.09, §25 |

**Index of systems.** 1 Admin panel shell · 2 Storefront, prerender, SEO ·
3 Catalogue · 4 Cart, checkout, orders · 5 Payments · 6 Shipping ·
7 Inventory, scanner, POS · 8 Gift cards · 9 Promo codes · 10 Loyalty and
partners · 11 Customer accounts · 12 Mail · 13 AI · 14 Blog · 15 Content and
settings · 16 Reviews · 17 Analytics and reports · 18 Notifications · 19 Cron ·
20 Uploads and storage · 21 Auth and sessions · 22 Database and migrations ·
23 Testing and CI · 24 Deploy, environments, domain switch · 25 Prototype
leftovers · Appendix A tap counts · Appendix B broken or contradictory ·
Appendix C docs vs code.

---

## 1. Admin panel — shell, navigation, confirm / undo / journal, trilingual UI

**What it is for.** The one screen where Renat runs the shop from his phone:
orders, goods, the till, and everything else behind «Ещё».

**Who uses it.** Renat (daily, phone). Dim (setup, checks). The e2e suite.

**How it works.**
- Route `/shop2/admin/` inside the same SPA; `screenAdmin()` `app.js:10834`
  gates on `SRV.admin` (`null` → «Проверяем…» `admWaitScreen` :9760, `false` →
  login card `admLoginScreen` :9766, `true` → the panel). `probeAdmin()` :16278
  → `GET /api/admin/me/`.
- **Five places** (`ADM_SECTIONS` :9679): «Обзор», «Заказы» (with the
  paid-not-shipped badge), «Товары», «Салон», plus «Ещё» (`ADM_MORE` :9688):
  «Клиенты» (sub «и отзывы»), «Маркетинг» («промокоды · подарочные карты ·
  письма»), «Блог», «Аналитика», «Подключения», «Настройки» («доставка ·
  главная · компания · цены · языки · журнал»). Phone: sticky bottom bar
  `admBarHTML` :10671 + «Ещё» sheet `admMoreSheetHTML` :10684 (its foot: RU/ET/EN
  pills, «Магазин ↗», «Выйти»). Desktop: sidebar `admSideHTML` :10652,
  232 → 68 px, state in `localStorage["rempire-admin-panes"]`.
- The thirteen old section keys still work as deep links
  (`ADM_SECTION_OF` :9696: `stock→goods`, `reviews→people`, `gift/mail→promos`)
  — the assistant's «Открыть …» buttons and the e2e suite depend on them.
- **Confirm before apply.** `pendingAction = {…}` raises `admConfirmHTML` :10793
  (desktop card / phone bottom sheet; buttons «Применить» (or the action's own
  verb) / «Отмена»). Fourteen raisers, types: `order_status` ×2 («Отправлен»,
  «Отменить заказ»), `set_hero` ×2, `set_content` ×2, `set_shipping_rules`,
  `set_pricing`, `set_mail_texts`, `set_tier`, `add_partner`, `pos_sale`,
  `goods_pull`, `set_product_active`. Everything else applies at once with an
  undo on the toast (`paintToast` :18256, `admUndoToast`, 6 s).
- **Journal.** `demoApply()` :16382 writes an entry to `DEMO.log`, `srvPush()`
  :15955 sends the matching request; `demoUndo()` :16796 reverses; «Настройки →
  Журнал изменений» (`admSetJournalHTML` :11748) lists `DEMO.log` with «Вернуть».
  `DEMO` (incl. the log, capped at 40) lives in `localStorage["rempire-admin-demo"]`
  — **that list is per browser, not per shop**, and «Вернуть» can only act on
  it. Since 07.09.2026 the same page shows a second list under it: the
  server-side `admin_audit` (written by ~25 call sites), read through
  `GET /api/admin/audit/?limit=100` (`loadAudit()` / `AUDIT_WORDS` /
  `auditText()` in app.js), read-only, labelled «Журнал магазина», with one
  sentence saying why undo stops at the browser's own half.
- **One click delegate** `document.addEventListener("click")` :18481 with a
  ~230-entry `closest()` selector list at :18484 and a flat `if (d.xxx)` chain
  to :20170; inputs :20185–20470, selects/files :20526–20626. The attribute
  name *is* the action (`data-admlabel`, `data-admshipnow` …); 113 distinct
  `data-adm*` hooks exist.
- **Trilingual UI.** Russian is the source; templates render RU, then
  `translateTree()` :3898 rewrites text nodes and `placeholder/aria-label/
  title/label` from `UI = {ET:{…} :94–1821, EN:{…} :1822–3546}` plus regex rules
  `UI_RX` :3550–3818, via `trText()` :3866. Coverage is checked by
  `node tools/i18n-gaps.mjs` (must print 0). The admin's own strings are part of
  that dictionary (~1 700 keys per language are admin strings).
- **Assistant** lives in a floating button (`admFabHTML` :10786) → pane/sheet
  (`admAsstHTML` :10774); see §13.
- **PWA.** Three manifests; `syncAppManifest()` :14713 swaps the `<link
  rel=manifest>` to `admin.webmanifest` on this route so the phone installs
  «Админка» as its own icon. No service worker exists (no offline, no push).

**How to test it.** `e2e/admin-shell.spec.ts` (five places, phone bar, sidebar
fold, all thirteen deep links, assistant FAB, confirm card, undo toast, stepper),
`e2e/admin-sections.spec.ts` (every «Ещё» section on desktop and phone),
`e2e/sweep-admin.spec.ts` (sign-in, tab matrix, journal), `e2e/a11y.spec.ts`
(admin part), `e2e/pwa.spec.ts`; `tests/auth.test.ts`, `tests/api.test.ts`.
Manual: open `/shop2/admin/` on a phone → «Пароль» → «Войти» → the five buttons
at the bottom; «Ещё» opens the sheet; any change shows a toast with «Отменить»;
«Ещё → Настройки → Журнал изменений» lists it with «Вернуть».

**State today.** Works (walked 06.09 on the e2e build; screenshots in the
session scratchpad). Honest limits: one password, no roles (Renat's round-2
answer named three helpers — `docs/RENAT-ANSWERS.md` — nothing was built for
that); the journal is device-local; ~1 700 admin strings ×2 languages are
maintained although the owner reads Russian; the panel follows the *browser*
language on first open (an English phone shows «Admin sign-in»).

**Simplification candidates.** Q1 (duplicate scanner buttons), Q2 (two
«Отправлен» paths), Q13 (journal vs server audit), Q55 (admin languages),
Q33 (naming glossary), Q45 (badge/count triplication), Q50 (PWA hint box).

---

## 2. Storefront SPA, prerender and SEO

**What it is for.** The shop the customer sees — in three languages, indexable
by Google, with link previews that work in WhatsApp.

**Who uses it.** Shoppers; Google/scrapers (the prerendered files); Renat only
through «Открыть в магазине ↗».

**How it works.**
- **Boot** (`app.js`): globals loaded by `index.html` :118–132 (`CATALOGUE`,
  `BUNDLES`, `CONTENT*`, `LEGAL*`, `PAYLOGOS`, `SHIPPING_DATA`), the state object
  `S` :4636–4885, cart + language restored from `localStorage["rempire-shop-proto"]`
  :4921–4959, language precedence URL prefix → saved → browser → `/api/geo/`
  refinement (`guessLang` :4971, `firstPaint` :21041). `GET /api/overrides/`
  (`loadServerOverrides` :15927) and `GET /api/bundles/` (:16295) at boot;
  `hydrateBlog()` :21009 reads `#blogdata`/`#blogpost` out of the prerendered page.
- **Router**: `pathFor()` :18140, `navTo()` :18164, `go()` :18213,
  `routeFromPath()` :20810 (patterns :20825–20891: `p/<id>`, `c/<cat>`,
  `b/<brand>`, `search`, `info/<slug>`, `set/<id>`, `sets`, `gift`,
  `blog[/<slug>]`, `brands|account|admin|scan`, `done?s=`, `checkout`). Russian
  has no prefix; `/shop2/et/…`, `/shop2/en/…`; `/shop2/ru/…` 301s to bare.
- **Screens**: home `screenHome` :6747 (hero `heroHTML` :4053, brand strip,
  rails, sets, gift tile, categories); catalogue/brand `screenCatalog` :6938
  (`filtered` :5316, cards `cardHTML` :5450 with the per-card size listbox,
  infinite scroll `observeSentinel` :18404, filter drawer :17283); brands
  :6925; search :8427 (`searchResults` :5344, Russian stemmer); product
  `screenProduct` :7023 (gallery, variants `variantPicker` :8391, stock states,
  «Сообщить о наличии» → `POST /api/stock-alerts/`, description `descFor` :6826,
  reviews §16, video `videoHTML` :7354, «С этим покупают» :8366, share :20791);
  sets §3; gift §8; cart drawer :17271; checkout §4; receipt `screenDone` :17186;
  account §11; info/legal `screenInfo` :6872 (`legalFor` :6836, placeholders
  `cResolve` :6503, the delivery page `deliveryPageHTML` :4250 shared with the
  prerender); blog §14; chat widget `chat.js` §13.
- **Prerender** `tools/prerender-shop2.mjs` (`npm run prerender`, part of
  `prebuild`): 810 static pages (270 × 3 languages: 220 products, 8+1
  categories, 26 brands, home, 5 policy pages, 8 sets + landing, gift card) +
  blog pages when `DATABASE_URL` is present (`tools/lib/blog-export.mjs`), the
  live shipping/pricing settings for the delivery page
  (`tools/lib/settings-export.mjs`), OG cards (sharp, committed under
  `public/shop/og/`), `public/sitemap.xml` (index → `sitemap-1.xml` +
  `sitemap-custom.xml`), `public/robots.txt` chosen by `PUBLIC_BASE_URL` (open only
  on `*.rempireshop.com`). Head builders shared through `src/lib/seo-head.mjs`.
  Checker `tools/check-prerender.mjs` (`npm run prerender:check`).
  `next.config.ts` `prerenderedRewrites()` lists the ids on disk so local and
  Vercel agree; three noindex layers (header `X-Robots-Tag` by host, meta by
  base URL, robots.txt by base URL) — `docs/seo.md`.
- **Pages written at request time** (products/posts that did not exist at
  build): `src/app/shop2/{,et/,en/}p/[id]/route.ts` → `src/lib/product-page.ts`;
  `…/blog/[slug]/route.ts` + `…/blog/route.ts` → `src/lib/blog-page.ts`;
  link-preview PNGs `src/app/shop2/og/[file]/route.ts` → `src/lib/og-card.ts`;
  `src/app/sitemap-custom.xml/route.ts`.
- **Security headers / CSP** in `next.config.ts` `headers()`: `/shop2/*` gets
  `script-src 'self'` (no inline), `camera=(self)` for the scanner, HSTS; the
  mail preview frame is the one `frame-ancestors 'self'` exception;
  `/prototypes/*` gets `'unsafe-eval'`.
- **Google Merchant feed** `tools/build-merchant-feed.mjs` →
  `public/feed/google-shopping.xml`, a static snapshot regenerated by hand
  (`docs/merchant-feed.md`), base URL hard-coded in the script.
- **Redirect map from Shopify** `docs/redirect-map.csv` (1 638 rows) — **not
  implemented anywhere**; `next.config.ts` only redirects `/shop/*` → `/shop2/*`.
  The 95 legacy `public/shop/p/<id>/index.html` pages still exist with an inline
  `location.replace` hand-over.
- **Analytics beacon** `track()` :5172 → `POST /api/track/` (§17);
  Cloudflare beacon `mountCfBeacon()` :5198 only with a real token on
  `rempireshop.com`.

**How to test it.** e2e: `home`, `catalogue`, `product`, `checkout`, `sets`,
`giftcard`, `blog`, `info-pages`, `seo`, `sweep-storefront`, `visual`, `a11y`,
`accessibility`, `pwa` (all `*.spec.ts`), the `mobile-safari` project runs the
customer specs on WebKit; `tools/check-prerender.mjs` after `npm run prerender`;
vitest `tests/custom-product-page.test.ts`, `tests/blog-page.test.ts`,
`tests/og-card.test.ts`, `tests/seo-override.test.ts`,
`tests/security-product-page.test.ts`. Manual: open `/shop2/et/p/<id>/` with JS
disabled → real content; share a product link into WhatsApp → card.

**State today.** Works. Known gaps (all documented, none fixed): `brands` is the
one shell-only landing; the redirect map is a CSV nobody executes; the merchant
feed is a stale static file; no cookie/consent banner although YouTube/
Instagram/OSM/Cloudflare requests exist; no service worker behind the three
"apps"; the committed `public/shop2/index.html` carries the **e2e** base URL
(`http://localhost:3417`) in canonical/hreflang/JSON-LD — harmless because
`prebuild` rewrites it on Vercel, but it is the generated file the rules say to
restore before committing; `?v=i18n78` cache token is bumped by hand across 11
tags (one tag, `content.js?v=c2`, is on its own token).

**Simplification candidates.** Q31 (prototype routes), Q36 (merchant feed +
redirect map decision), Q37 (consent banner), Q40 (brands landing).

---

## 3. Catalogue — products, variants, sets, custom products, overrides, product texts

**What it is for.** The 220 products with their sizes, prices, photos and texts
in three languages — and the owner's way to change prices, stock, photos and
texts, or add a product of his own.

**Who uses it.** Renat (editor, «+ Товар»), Dim (the generated files),
shoppers (read).

**How it works.**
- **The catalogue is a build artefact.** `tools/build-catalogue-full.mjs` reads a
  Shopify admin CSV export and writes `public/shop/catalogue2.js` (+
  `content.js`); `tools/build-catalogue-variants.mjs` → `src/data/catalogue.
  variants.json` (per-size prices the server needs); `src/data/catalogue.min.json`;
  `tools/assemble-translations.mjs` → `content.ru.js`, `content.et.js`,
  `legal.*.js` (AI translations pending native proofread); images
  `public/shop/img/*.webp` cut by `tools/refit-cutouts.mjs`,
  `tools/cut-new-images.mjs`, `tools/recut-rembg.py` (ImageMagick / rembg);
  brand logos `tools/normalise-brandlogos.mjs`. **All of these tools hard-code
  absolute paths on Dim's machine** (`C:/Users/Dmitri.MARKIT/source/repos/
  rempire-web`, a scratchpad CSV) — they are one-person, one-machine tools.
  Subcategories are a hard-coded regex map (`SUBCATS`).
- **What the owner can change on a catalogue product** = one row in
  `product_overrides` (`001_core.sql`; columns added by `003` gallery, `100`
  `pro_price`, `110` `description`, `130` `seo_langs`, `147` `sizes`/`hidden`):
  `price`, `pro_price`, `stock` (`in|low|out` manual badge), `seo_title/seo_desc`
  (+ ET/EN pairs), `subcat`, `var_img`, `video_url`, `gallery`,
  `description {RU,ET,EN}`, **`sizes`** (the whole volume ladder
  `[{size,price}]`, `null` = the generated file's own — this is what makes
  «+ Размер» and «×» real; `price` stays rung 0 either way, reconciled in
  `mapOverride`/`overrideLadder`) and **`hidden`** (out of the catalogue, the
  search, the sets, the cart and `/shop2/p/<id>/`; the panel's own list keeps
  it with «Скрыт»).
  `PUT /api/admin/overrides/` (`src/app/api/admin/overrides/route.ts`,
  `orders.upsertOverride`, `product-descriptions.ts`, `product-seo.ts`);
  published by `GET /api/overrides/` (30 s cache, `pricing`/`proPrice`
  stripped). In `app.js`: `DEMO.*` layer + `applyDemoOverrides()` :15825,
  written through `srvPush()` (:15960–16018 `set_price`, `set_pro_price`,
  `set_stock`, `set_seo`, `set_subcat`, `set_varimg`, `set_gallery`,
  `set_description`).
- **What he cannot change**: name, brand, section, the size ladder — the
  editor shows them read-only (`edPaneMain` :14072; «+ Размер» rendered
  `disabled title="скоро"` :14202; «×» `disabled title="Объёмы заводит Дим"`
  :14197; the «Показывать в магазине» switch is `aria-disabled` and permanently
  on :14105). «Снять с продажи» = stock → «нет в наличии» via the confirm card.
- **Custom products** (`131_custom_products.sql`, ids `c-…`,
  `src/lib/custom-products.ts`): brand, name, section, sizes 1…12 with prices
  1…500 €, description, SEO, gallery; `GET|POST /api/admin/products/`,
  `GET|PUT|DELETE /api/admin/products/[id]/` (DELETE = hide). Served in
  `GET /api/overrides/` as `custom: […]`, merged into `CATALOGUE` by
  `adoptCustom()` :15773; page and OG card at request time (§2); in the shop
  they behave like catalogue products. Editor mode `S.adminEdit === "new"`:
  `goodsNewDraft()`, `edPaneMainOwn` :14031, `edPaneSizesOwn` :14123,
  `customCreate` :14442, `customUpdate` :14465.
- **The editor** `goodsEditor()` :14534 — five tabs `ED_TABS` :13934 «Основное ·
  Размеры и цены · Фото и видео · Описание · Google», all in the DOM (hidden
  panes), sticky bar «Сохранить»/«Сохранить товар» · «Отмена» · «Снять с
  продажи» (:14555–14568). «Размеры и цены» grid = Размер · Цена € · Салон € ·
  Остаток · Штрихкод — the last two write to inventory (§7) on the same save
  (`data-admsavegoods` :19203–19373). «Фото и видео» = gallery tiles (← → ★ ×,
  «✂ Убрать фон» when cut-out is enabled, «+ Фото с телефона», «Вернуть фото из
  каталога»), «Фото по объёмам», video chips «YouTube · Instagram · Загрузить».
  «Описание» = RU/ET/EN segment + «Написать черновик» · «Перевести с русского»
  · «Отменить». «Google» = per-language title/description + «Заполнить
  автоматически» · «все три языка».
- **Sets («Наборы»)** live in the `bundles` table (`120_bundles.sql`, seeded
  with the eight sets `tools/bundles.config.mjs` used to generate;
  `src/lib/bundles.ts`, `GET /api/bundles/`, `GET|POST|PATCH|DELETE
  /api/admin/bundles/`). Admin: «Товары → Наборы» `admSetsHTML` :10603 +
  `bundleFormHTML` :13031 («Новый набор», «Что внутри — минимум два товара»,
  price must be below the parts, «Скрыть/Показать», ↑↓, «Удалить набор»). Shop:
  `allBundles()` :5521 (respects the «Показывать наборы» switch, `settings.
  bundles`), `screenBundles` :5685, `screenBundle` :5700. Static
  `public/shop/bundles.js` / `src/data/bundles.json` remain as offline copy
  and prerender source (`npm run build:bundles`).
- **AI on product texts** (§13): `POST /api/admin/ai/text/` tasks `describe`,
  `translate`, `seo`, `copy{product_name}`; assistant actions `set_price`,
  `set_stock`, `set_seo`, `create_product`, `update_product`, `add_product_photo`.

**How to test it.** `tests/custom-products.test.ts`,
`tests/description-override.test.ts`, `tests/seo-override.test.ts`,
`tests/security-custom-products.test.ts`, `tests/bundles.test.ts`,
`tests/bundles-db.test.ts`, `tests/api.test.ts` (overrides); e2e
`admin-editor.spec.ts` (five tabs, one save → price/salon price/stock/barcode
read back), `admin-products.spec.ts` («+ Товар» end to end, hide/undo,
assistant `create_product`, the request-time page), `sweep-admin-goods.spec.ts`
(garbage in every field, Instagram video), `admin.spec.ts` (goods price →
storefront), `admin-bundles.spec.ts`, `sets.spec.ts`. Manual: «Товары» → row →
«Размеры и цены» → change «Цена» → «Сохранить» → open the product in the shop.

**State today.** Overrides and custom products: works. The catalogue itself:
frozen files, changeable only by Dim with tools that run on his machine only;
descriptions in ET/RU are machine translations awaiting a native proofread
(`docs/proofread-report.md`, `docs/i18n-report.md`); 152 of 224 products have
one photo (`docs/QUESTION-REVIEW.md`); Renat said he will reshoot everything.
Dead controls are visible in the editor (see above). The tab badge «Склад N»
on «Товары» counts the manual «мало/нет» flags (74 on a fresh database) until
the stock list has loaded, then the real count (`admLowCount` :10501).

**Simplification candidates.** Q19 (dead editor controls / two kinds of
product), Q20 (manual «Наличие» vs numeric stock), Q22 (three ways to make SEO
text), Q35 (sets), Q38 (75 € gift amount), Q41 («Товары N» header count).

---

## 4. Cart, checkout and the order lifecycle

**What it is for.** Turning a basket into a paid order the owner can ship,
message about, cancel or refund — with every euro recomputed on the server.

**Who uses it.** Shoppers (cart → checkout → receipt); Renat (order list and
card); automatic (payment callbacks).

**How it works.**
- **Cart** (`addToCart` :18312, drawer :17271): three line kinds — product
  `{id,size,qty}`, `bundle:<id>` with components, `gift:<amount>` with recipient
  meta; qty ≤ 9; persisted in `localStorage["rempire-shop-proto"]`; totals
  `total()` :5132 (free-shipping threshold, promo or gift discount, points).
- **Checkout** `screenCheckout()` :9501 — three steps «Контакт» (e-mail,
  «Хочу получать новости и скидки»), «Доставка» / «Получатель» (country incl.
  «Другая страна Европы» → ISO select; methods «Пакомат» / «Курьер до двери» /
  «Самовывоз — Mardi 1, Таллинн»; carrier chips; parcel-point sheet with list +
  Leaflet map; address fields), «Оплата» (`PAYS` :4572: «Банковская ссылка» with
  bank logos from `GET /api/payments/methods/`, «Банковская карта», «Apple Pay /
  Google Pay», «По счёту — для компаний»), summary with one box «Промокод или
  подарочная карта» and «Использовать баллы», then «Оплатить <total>».
- `payNow()` :9304 → `POST /api/orders/` (`orderPayload` :9216: ids, variant,
  qty, customer, shipping whitelist, `discountCode`, `redeemPoints`) →
  `POST /api/payments/create/` → `location.href = redirectUrl` (§5). If the API
  is absent (404/405/501/non-JSON) `finishDemo()` :9297 shows a *demo* receipt.
- **Server pricing** `src/lib/orders.ts` `createOrder()` / `priceItems()`:
  base price from `catalogue.min.json`, size premium from
  `catalogue.variants.json`, override price, custom-product rows, bundle
  definitions from the DB, gift lines, shipping via `computeShipping()`, gift
  card / promo *quoted* only, points quoted only, pro pricing when the signed-in
  customer is a partner. Refusals: `unknown_item`, `out_of_stock`,
  `bad_variant`, `bundle_unknown`, `not_digital`, `bad_qty`… Shipping blob rebuilt
  from a whitelist (`cleanShipping`). 10 orders/min/IP, 16 KB body.
- **Order rows** (`orders`, `001_core.sql` + `002` discount_code, `081/140`
  sales index, `091` channel, `100` customer_id/pricing_tier/loyalty_discount):
  uuid `id`, human `number` `R-100001…` from `order_number_seq`, `status`
  constrained by `140_order_delivered.sql` to `new · paid · failed · shipped ·
  delivered · cancelled · refunded` (`ORDER_STATUSES` `orders.ts:47`;
  `PAID_ORDER_STATUSES = paid|shipped|delivered` :53). **There is no transition
  table**: `setOrderStatus()` :1225 accepts any member; the de-facto rules are
  "paid is a floor" in `payments/apply.ts` and `handedOver()` in
  `src/app/api/admin/orders/[id]/route.ts:53`. Paid→`refunded|cancelled` puts
  product lines back on the shelf (`orders.ts:1246–1264`, bundles skipped).
- **Fulfilment in the admin** — list `admOrdersHTML` :10132 with chips
  `ADM_ORDER_FILTERS` :10119 «Новые · Этикетка готова · Отправлены · Доставлены ·
  Салон · Все» (a typed search silently ignores the chip, :10162) and the
  next-step button in the row (`admOrderStepBtn` :10177: «Выдан клиенту» /
  «Создать этикетку» / «Отправлен» / «Доставлен»); card `admOrderCardHTML` :10364
  with the four-step strip «Оплачен · Этикетка · Отправлен · Доставлен» (pickup:
  «Оплачен · Выдан»; hidden for salon, digital and closed orders), the primary
  button, «Написать клиенту», «Отменить заказ», the shipment box (§6), «Изменить
  статус вручную: оплачен · возврат» (`data-admstatus` :10395), «Состав»,
  «Покупатель», «Доставка», «Заметка» + «Сохранить заметку». Handlers:
  `d.admlabel` :18726 (label, no status change), `d.admshipnow` :18744 (confirm
  card «Отметить отправленным?» → `PATCH {status:"shipped"}` → letter),
  `d.admdelivered` :18727 (immediate, undo toast, no letter), `d.admordercancel`
  :18756 (confirm «Отменить заказ?»), `d.admstatus` :18718 (bare PATCH).
  `PATCH /api/admin/orders/[id]/`: `status:"paid"` on a not-yet-shipped order
  runs the **full payment settlement** as if a bank had paid (`applyPaymentResult`
  with `providerRef:"manual"` → gift card, promo, points, stock, letters);
  `status:"shipped"` sends «Заказ отправлен» once; `labelStep:false` parks the
  label (journal undo).
- **Messages to the customer** (`111_order_messages.sql`,
  `src/lib/order-messages.ts`): «Написать клиенту» opens `admOrderMsgHTML`
  :10474 (paste the customer's message, a prefilled draft `admOrderDraft`
  :10255, «Черновик помощника» → `POST /api/admin/ai/text/ {task:"reply"}`,
  «Отправить» → `POST /api/admin/mail/send/` — sent **immediately, no confirm
  card**, subject «Re: заказ <number>», both sides stored). Incoming customer
  mail does not arrive here; Renat pastes it.
- **Salon (POS) orders** `channel:'pos'` — §7. **Digital orders** (gift cards
  only): no delivery step, `shipping.method = "digital"`.

**How to test it.** `tests/orders.test.ts`, `tests/orders-digital.test.ts`,
`tests/orders-carrier.test.ts`, `tests/order-messages.test.ts`,
`tests/mail-send.test.ts`, `tests/checkout-parity.test.ts`,
`tests/fuzz-money.test.ts`, `tests/shipping-montonio.test.ts` (the PATCH
route); e2e `checkout.spec.ts` (methods, promo error, summary parity, mock pay
paid/failed, pickup), `sweep-checkout.spec.ts` (ten randomised orders, promo/gift
variants, thresholds, phone layout), `admin.spec.ts` (label → shipped with the
letter → delivered → journal undo), `admin-shell.spec.ts` (chips + ship flow),
`giftcard.spec.ts` (digital checkout). Manual (walked 06.09): «Заказы» → row →
«Создать этикетку» → «Открыть PDF (A4) ↗» → «Отправлен» → confirm «Отправлен» →
later «Доставлен».

**State today.** Works end to end with the mock provider; real Montonio sandbox
order R-100002 paid on 03.09 (`docs/accounts.md`). **Untested anywhere in a
browser:** «Отменить заказ» and the manual «возврат» — and both are misleading:
the cancel confirm card says «Деньги вернутся клиенту, письмо уйдёт
автоматически.» (`admCancelConfirmText` :10249) but **no refund is executed and
no cancellation letter exists** (mail hooks: created/paid/shipped/gift/login/
partner only); `refunded` is a bookkeeping status. Other contradictions: a
digital order shows «Отправлен» in the list but no steps in the card
(`admOrderStepBtn` :10185 vs `showSteps` :10370); the checkout's newsletter
checkbox (`S.newsletter` :20246) and the invoice company field (`S.invoiceCo`)
never reach `orderPayload` :9216; «Apple Pay / Google Pay» and «По счёту» both
post `method:"bank"` (:9328). No invoice PDF exists although
`docs/FOR-RENAT-2026-08-23.md` promised one.

**Simplification candidates.** Q2, Q3 (manual statuses / cancel text), Q4
(«По счёту» option), Q5 (wallet option), Q6 (reply flow), Q23 (chips), Q24
(«Доставлен» step), Q25 (confirm on «Отправлен»), Q26 (label buttons).

---

## 5. Payments

**What it is for.** Taking the money: bank links, cards and wallets through
Montonio, and turning "paid" into everything that must happen once.

**Who uses it.** Shoppers (hand-over to the bank page); automatic (return +
webhook); Dim (keys); Renat only sees «Оплачен».

**How it works.**
- Provider choice `src/lib/payments/index.ts` `getProvider()`: `PAYMENT_PROVIDER=
  mock` → mock (explicit only, needs `SESSION_SECRET`, refuses under
  production); `makecommerce` → stub that throws `not_implemented`; `montonio`
  or unset → Montonio if keys exist, else `not_configured` (503). Never a
  silent mock (audit C1 closed).
- **Montonio Stargate Orders API** `src/lib/payments/montonio.ts`: order signed
  as HS256 JWT (`payments/jwt.ts`, `exp` 10 min) → `POST …/orders` → redirect to
  `paymentUrl`; return `GET /api/payments/return/?order-token=`, webhook
  `POST /api/payments/notify/` (`{orderToken}`); both verified with
  `MONTONIO_SECRET_KEY` + store `accessKey`; status map `PAID|REFUNDED|
  PARTIALLY_REFUNDED → paid`, `PENDING|AUTHORIZED → pending`, `VOIDED|ABANDONED|
  CANCELLED|FAILED → failed`, unknown → pending. Sandbox vs live by
  `MONTONIO_ENV`. Bank logos: `GET /api/payments/methods/`
  (`payments/methods.ts`, Bearer JWT, 6 h cache). `BANK_CODES` :9254 (BICs sent
  as `preferredProvider`) are marked `ASSUMPTION` in the code.
- **Routes**: `POST /api/payments/create/` (20/min), `GET /api/payments/return/`
  (60/min → `/shop2/done/?n=&s=&t=&g=`), `POST /api/payments/notify/` (60/min,
  200 on replays), `GET /api/payments/mock/` (the two-button test bank).
- **The single paid transition** `src/lib/payments/apply.ts`
  `applyPaymentResult()`: paid is a floor (a late `failed` is recorded as
  `payment.rejected`, never applied); on first `paid`: `setOrderStatus(paid)` →
  redeem the quoted gift card **or** consume the promo (`giftcard_redeem_failed`
  / `promo_consume_failed` audit rows if the balance ran out) → loyalty redeem
  then earn → `events` purchase row → stock decrement (`sale_web`, product lines
  only). Amount mismatch is recorded (`payment.amountMismatch`) but the order is
  still paid. Then `payments/mail-hook.ts`: customer letter + owner ping once,
  gift cards issued on every arrival (idempotent).

**How to test it.** `tests/payments-montonio.test.ts`, `tests/payments-apply.
test.ts`, `tests/payments-giftcard.test.ts`, `tests/payments-giftcard-issue.
test.ts`, `tests/fuzz-money.test.ts`, `tests/loyalty.test.ts` (paid-only
settlement), `tests/inventory.test.ts` (decrement); e2e `checkout.spec.ts` via
`PAYMENT_PROVIDER=mock`. The real sandbox is a manual check
(`docs/payments.md` §5). Manual: checkout → «Оплатить» → bank page → back to
«Заказ оплачен».

**State today.** Mock: works. Montonio sandbox: works (one order 03.09).
**Live: not yet** — KYC pending on Renat's side, `MONTONIO_ENV=sandbox`. Money
never moves *back*: a Montonio refund arrives as `paid`, so a refund done in
the Montonio portal never changes the order; an under-payment reaches `paid`
(audit M8 open). MakeCommerce is a dead stub. The provider decision was
contested in `docs/renat-feedback-2.md` §12 (MakeCommerce recommended at this
volume) and settled on Montonio in code and env.

**Simplification candidates.** Q4, Q5, Q34 (remove MakeCommerce stub), Q3
(refund semantics).

---

## 6. Shipping

**What it is for.** Charging the right delivery price, letting the shopper pick
a parcel machine, and printing the label from the order card.

**Who uses it.** Shoppers (checkout); Renat («Создать этикетку», tariff editor);
automatic (feeds, caches).

**How it works.**
- **Prices** `src/lib/shipping.ts`: `settings.shipping_rules` (seeded by
  `030_shipping_rules.sql`, EE cells lifted by `031_shipping_rules_ee_tariffs.
  sql`), defaults `DEFAULT_SHIPPING_RULES` (parcel EE 5.47 / LV, LT, default 4.99;
  courier EE 10.84 / default 9.90; pickup 0; free from 59 €; markup 0),
  per-country overrides, per-carrier overrides, `shippingZone()` (real ISO
  country → `EE|LV|LT|FI|EU|default`); 60 s cache reset by the settings PUT.
  Storefront mirrors: `SHIP_RULES` :4182, `THRESH` :4126, delivery page
  `deliveryPageHTML` :4250.
- **Admin editor** «Настройки → Доставка и оплата» `admSetDeliveryHTML` :11624:
  grid Страна × (Пакомат € · Курьер € · Бесплатно от €) for EE, LV, LT, FI,
  «Другие страны Европы», «Остальные страны»; «Сохранить» (confirm card,
  `set_shipping_rules`); «Заполнить по тарифам Montonio» (`computeMontonioFillPatch`
  :12664 — a browser mirror of `src/lib/shipping/tariffs.ts`, working from the
  fallback table `src/data/montonio-tariffs.json`, round-up to «…,X9 €», markup
  fields); fold «Самовывоз, перевозчики и наценка» (per-carrier cells, «Наценка,
  %», «Наценка, €», switch «Разрешить снижать текущие цены», «Вернуть значения по
  умолчанию»); a read-only «Оплата» list. Live tariffs `GET /api/admin/shipping/
  rates/` (`fetchMontonioRates`, 24 h cache) refresh the hints when keys exist;
  `tools/fetch-montonio-tariffs.mjs` updates the fallback file.
- **Pickup points** `GET /api/shipping/points/?country=&carrier=`
  (`src/app/api/shipping/points/route.ts`, `src/lib/shipping/montonio.ts`,
  `src/lib/parcel-points.ts`): Montonio first (UUID ids, **no coordinates** —
  borrowed from feeds by name/zip), Omniva live feed, SmartPost from the seed
  `src/data/parcel-points.seed.json` (`tools/fetch-parcel-points.mjs`), DPD only
  with `DPD_API_USER/PASS`; CDN cache 1 h. Checkout: `CARRIERS_BY_COUNTRY` :4219,
  `pointSheet` :9035, Leaflet vendored by `tools/copy-vendor.mjs`.
- **Labels** — `POST /api/admin/shipments/` (`{orderId}`, paid orders only,
  idempotent, status untouched) → Montonio Shipping API v2 (`shipments`,
  `label-files`), weight estimated 0.4 kg/unit + 0.2; result merged into
  `orders.shipping.montonio` (`shipmentId`, `trackingCode`, `trackingUrl`,
  `dropOffPin`, `labelUrl`, `dismissed`). `GET /api/admin/shipments/[id]/label/
  ?size=A4|A6` proxies the PDF and repairs Montonio's double-nested form with
  pdf-lib (`src/lib/shipping/label-pdf.ts`). Admin: `srvCreateShipment` :16209,
  the box `admShipmentBoxHTML` :10328 («Отправление», «Трек-номер» +
  «Скопировать», «Код сдачи посылки», «Открыть PDF (A4) ↗», «A6 для
  термопринтера ↗», «Отследить ↗», «Этикетка отложена» / «Вернуть этикетку»).
  Mock for tests: `SHIPPING_PROVIDER=mock` → `src/lib/shipping/montonio-mock.ts`
  (tracking `MK…EE`, PIN 4821, a one-page PDF). Courier: «Отправлен» without a
  label sends the letter without a tracking code. Pickup: «Выдан клиенту».
- **Carrier logos** `GET /api/shipping/carriers/`
  (`src/app/api/shipping/carriers/route.ts`, `fetchMontonioCarriers()`): Montonio's
  `GET /carriers` — the only endpoint of theirs carrying a `logoUrl` — 6 h in the
  instance, `s-maxage=21600`, `503 not_configured` without keys. Checkout draws
  the mark plus the name in the carrier chip (`deliveryPicker`, `.carrier__logo`);
  a 404 or no keys leaves the colour dot. Dim, 08.09.2026.
- **Shipment webhook** `POST /api/shipping/notify/` (`{payload: <jwt>}`,
  `src/app/api/shipping/notify/route.ts`, `src/lib/shipping/webhook.ts`):
  `shipment.statusUpdated`, registered by hand in the partner system. Token
  verified like the payment webhook's (HS256, our secret, our accessKey); every
  distinct status word is recorded in `settings.shipping_statuses` (count, first,
  last, event, meaning, shipment) and its first sighting in `admin_audit`
  (`shipment.status`). `looksDelivered()`/`looksReturned()` — the white list in
  `src/lib/delivery.ts`, **a fallback until that row says what the real words
  are** — close a `shipped` order and never one that came back. 200 for anything
  understood, 400 for a bad token, 503 for our own database.
- Env: the same three `MONTONIO_*` as payments; `SHIPPING_PROVIDER`.

**How to test it.** `tests/shipping.test.ts` (rules, zones), `tests/shipping-
rules.test.ts`, `tests/shipping-tariffs.test.ts`, `tests/shipping-migration.
test.ts`, `tests/shipping-montonio.test.ts` (shipment body, PATCH flow, mock),
`tests/shipping-label-pdf.test.ts`, `tests/parcel-points.test.ts`,
`tests/shipping-webhook.test.ts` (signature, unknown status, redelivery),
`tests/orders-carrier.test.ts`; e2e `admin.spec.ts` (label → letter with
tracking link → delivered → undo), `checkout.spec.ts` (picker, live Omniva
feed), `info-pages.spec.ts` (prices on the delivery page follow the rules),
`sweep-admin-goods.spec.ts` (delivery prices), `admin-sections.spec.ts`
(tariff through the confirm card). Manual: order card → «Создать этикетку» →
box appears → «Открыть PDF (A4) ↗».

**State today.** Mock: works (walked 06.09). Montonio Shipping sandbox: keys
set, all carriers activated in the Montonio store 03.09 (`docs/accounts.md`),
but the sandbox "does not call carriers" — a real label has not been printed
from this code yet. The tariffs behind «Заполнить по тарифам Montonio» are the
carriers' public price lists, not Montonio's contract prices; LV/LT/EU prices are
below cost by design until Renat decides (`docs/shipping.md`). SmartPost points
are a frozen seed; Finland parcel machines depend on Montonio answering. The
assistant's `set_shipping_rules` silently drops `unisend`
(`src/app/api/assistant/actions.ts:181`).

**Simplification candidates.** Q26 (A4 vs A6), Q27 (the tariff editor), Q28
(carrier chips / EU rows), Q34 (dead exports).

---

## 7. Inventory, scanner and the salon till (POS)

**What it is for.** Real counts per product and size, a phone scanner to receive
goods and bind barcodes, and a way to sell from the shelf so web and salon share
one stock.

**Who uses it.** Renat (scanner icon, «Склад», «Салон»); automatic (web sales
decrement, cancellations return).

**How it works.**
- Tables `stock_levels` (product_id, variant label, qty, low_threshold, ean)
  and `stock_moves` (delta, reason `sale_web|sale_pos|goods_in|adjust|return`,
  ref, actor) — `090_inventory.sql`; `orders.channel` — `091_pos_channel.sql`.
  `src/lib/inventory.ts`: a variant is **tracked** only after a counting move
  (`goods_in|adjust|return`); untracked variants keep the manual badge; sales
  never make a variant tracked. `move()` is atomic and clamps at 0;
  `productStockStates()` feeds the shop badge through `getOverrides()`.
  `tools/seed-stock.mjs` creates rows for EANs (all Shopify barcodes were "NA").
- Routes (all `requireAdmin`): `GET|PUT /api/admin/inventory/`
  (`filter=all|low|out|untracked`; PUT = ean/threshold only), `GET|POST
  /api/admin/inventory/moves/` (relative `delta`+`reason` or absolute `qty`),
  `GET /api/admin/inventory/lookup/?ean=`, `POST /api/admin/pos-orders/`,
  `GET /api/admin/pos-orders/[id]/receipt/`.
- **«Товары → Склад»** `admStockHTML` :14733: «Сканировать» (and the header
  «Приёмка» :10521 — the same `data-scanopen`), PWA hint box, chips «Все · Мало ·
  Нет · Не учтено», search, rows sorted by quantity with a ± stepper
  (`data-stockstep` → immediate move + undo toast), «Править» (EAN, «Порог
  „мало“», «Остаток сейчас», reason), «История приёмок и продаж →», «Сканер
  отдельным приложением ↗».
- **Scanner** — the same overlay from «Склад»/«Салон» and the standalone route
  `/shop2/scan/` (`screenScan` :15266, admin-only, installs as «Сканер»):
  `scanMount()` :15196, engines `BarcodeDetector` or vendored zxing
  (`public/vendor/zxing/`, copied by `tools/copy-vendor.mjs`), manual field «или
  введите код вручную» + «Найти» (also the Bluetooth/USB wedge target). Found:
  «Найдено · <EAN>», name, «<size> · на складе N», giant stepper, «Принять +N»
  (`goods_in`) / «Списать −N» (`sale_pos`) / in salon mode «Добавить в продажу ·
  N», «Сканировать дальше». Unknown: «Код не привязан · <EAN>» → «К какому
  товару?» search → one tap on a product×size row binds (`PUT
  /api/admin/inventory/`) and re-looks the code up. Camera needs https and the
  `camera=(self)` permissions policy (`next.config.ts`).
- **Salon** `admSalonHTML` :15392: search «Название, бренд или штрихкод» → one
  chip per size («40 мл · 8 €», muted «Нет на складе») → «Корзина» with ± and
  «Убрать», «Скидка, %», «Почта клиента», «Телефон», hint «Покупатель не
  обязателен. С почтой клиент получит чек письмом.» → «Наличные» / «Терминал»
  → confirm «Оформить продажу?» → «Оформить» → receipt «Продажа оформлена ✓ ·
  N поз. · терминал · остатки списаны», «Чек для печати» (printable HTML),
  «Новая продажа». Server: creates a `channel:'pos'` order, `setOrderPayment
  ({provider:"pos"})`, `setOrderStatus("paid")`, decrements `sale_pos`.
  **It bypasses `applyPaymentResult`**: no `events` purchase row, no loyalty
  points, **no receipt letter** despite the hint above.
- Editor tie-in: «Размеры и цены» «Остаток» and «Штрихкод» columns save through
  the same routes (§3). Assistant: `stock_adjust`, `stock_set`, low-stock block
  in the prompt.

**How to test it.** `tests/inventory.test.ts`, `tests/pos-orders.test.ts`,
`tests/assistant-actions.test.ts` (stock actions), `tests/custom-products.
test.ts` (variant rename moves rows); e2e `scanner-app.spec.ts` (unknown → bind
→ +3 lands in «Склад»), `sweep-admin-ops.spec.ts` (warehouse, register),
`admin-shell.spec.ts` (± stepper + undo), `admin-editor.spec.ts` (count +
barcode from the editor). The camera path is not automated (headless has no
camera; the admin is Chromium-only in CI, so iOS Safari + zxing is untested by
CI). Manual (walked 06.09 by manual entry): `/shop2/scan/` → «Войти» → type an
unknown EAN → «Найти» → search «tangled» → tap the row → «Код привязан ✓» → «+»
→ «Принять +2» → «на складе 4».

**State today.** Works with manual entry and the ± steppers; camera path relies
on the docs' iOS 17+ note and has no automated coverage. Contradictions: the POS
hint promises a receipt letter that is never sent; «Списать −N» in the scanner
records a `sale_pos` move with **no order and no revenue** (the ledger says
"sold", analytics says nothing); POS sales earn no points and are missing from
the events funnel; the «Склад N» warning count means two different things
before and after the stock list loads (§3).

**Simplification candidates.** Q1, Q20, Q21 («Списать» semantics), Q29 (POS
extras: customer fields, discount, cash/terminal), Q50 (PWA hint).

---

## 8. Gift cards

**What it is for.** Selling a 25/50/100 € card that arrives as a PDF by e-mail
and is spent at checkout, balance kept.

**Who uses it.** Shoppers (buy, redeem); automatic (issue on payment); Renat
(amounts, issued list, PDF from the order card).

**How it works.** Shop page `/shop2/gift/` `screenGift` :5787 (amounts from
`giftAmountsOn()` :5760 = `settings.gift_amounts` ∩ `GIFT_AMOUNTS [25,50,75,100]`,
default `[25,50,100]`; recipient name/e-mail/message) → cart line
`gift:<amount>` → digital checkout (step «Получатель», «Отправить мне на почту, а
не получателю», no delivery). Tables `gift_cards`, `gift_card_uses`
(`020_gift_cards.sql`); `src/lib/giftcards.ts` (`issueGiftCards` idempotent per
order, `applyGiftCard` quote, `redeemGiftCard` atomic on the paid transition,
codes `RMP-XXXX-XXXX`, valid 12 months); PDF `src/lib/giftcard-pdf.ts` (pdf-lib,
A5, fonts in `public/fonts`, stored in R2 `giftcards/`, HMAC token link
`GET /api/giftcards/[code]/pdf/?t=`); `POST /api/giftcards/check/` (30/h);
letter `gift-card` with the PDF attached (`mail-hooks.issueOrderGiftCards`).
Receipt shows «Скачать подарочную карту (PDF)» (`g=` parameter from the
return route). Admin «Маркетинг → Подарочные карты» `admGiftScreenHTML` :10991:
«Номиналы в магазине» toggles (`set_gift_amounts`), a fixed «Оформление» note,
«Выпущенные карты» from `GET /api/admin/giftcards/`; order card «Карта PDF ↗»
(`giftcard-links.ts`). Checkout box shared with promo codes (`RMP` + 11 chars ⇒
card, :19950).

**How to test it.** `tests/giftcards.test.ts`, `tests/giftcard-pdf.test.ts`
(real PDF text extraction), `tests/giftcard-mail-pdf.test.ts`, `tests/gift-meta.
test.ts`, `tests/payments-giftcard.test.ts`, `tests/payments-giftcard-issue.
test.ts`, `tests/orders-digital.test.ts`; e2e `giftcard.spec.ts` (buy → code via
the e2e door → redeem; the digital checkout + PDF), `admin-sections.spec.ts`
(75 € switched on reaches `/gift/`). Manual: `/shop2/gift/` → «В корзину — 50 €»
→ pay → receipt button; then a second order with the code.

**State today.** Works. Nits: the gift tile hard-codes «25, 50 или 100 €»
(:5780, `GIFT_DESC` :17412) while the amounts are a setting; 75 € is accepted
by the checkout even when not offered; the admin cannot issue a card by hand
(deliberate).

**Simplification candidates.** Q11 (the gift tab), Q38.

---

## 9. Promo codes

**What it is for.** A code the customer types at checkout: percent, fixed euro
or free delivery, with limits — counted only when the order is paid.

**Who uses it.** Renat (create/toggle), shoppers, automatic (birthday codes).

**How it works.** Tables `promo_codes`, `promo_code_uses` (`060_promo_codes.
sql`), `src/lib/promos.ts` (quote at checkout, `consumePromo` once per order on
paid), `POST /api/promos/check/` (20/min), admin `GET|POST|PATCH
/api/admin/promos/` (no DELETE by design). Admin «Маркетинг → Промокоды»
`admPromosHTML` :12838 / form `promoFormHTML` :12801: «Код — латиница, цифры и
дефис», kinds «Процент · Сумма в евро · Бесплатная доставка», «Скидка, %», 
«Минимальный заказ, €», fold «Срок, число использований и заметка» (+ «✨
Написать заметку»), «Создать»/«Сохранить», row switch. Assistant: `create_promo`,
`toggle_promo`. Birthday flow mints `REM-BD-…` codes (§12).

**How to test it.** `tests/promos.test.ts`, `tests/fuzz-money.test.ts`; e2e
`admin.spec.ts` (new code works at checkout), `admin-sections.spec.ts`,
`sweep-admin-goods.spec.ts` (odd codes), `sweep-checkout.spec.ts`. Manual: «Ещё»
→ «Маркетинг» → «+ Промокод» → code, percent → «Создать» → use it in checkout.

**State today.** Works. On a phone the third kind chip is cut off (horizontal
scroll) — cosmetic.

**Simplification candidates.** Q17 (the ✨ note button), Q39 (form fields).

---

## 10. Loyalty and partners (salon pricing, points)

**What it is for.** A lower price for salons/masters (partners) and points for
retail customers who pay (1 point = 1 €).

**Who uses it.** Signed-in shoppers; Renat («Клиенты», «Настройки → Цены и
баллы»); automatic (earn/redeem on paid).

**How it works.** `100_tiers_loyalty.sql` (customers `tier|company|reg_code|
pro_requested_at|pro_approved_at|notes`, `product_overrides.pro_price`, orders
`customer_id|pricing_tier|loyalty_discount`, `loyalty_ledger` with earn/redeem
once per order); `src/lib/loyalty.ts` (`settings.pricing` = **`partnersOn
false`** + `proDiscountPct 20, proMinOrder 0, loyalty {enabled true, earnPct 5,
redeemMaxPct 30, minRedeem 5}`

**`partnersOn` is the one switch above both programmes** (07.09.2026, Dim:
default OFF, «Renat said later»). Off, `loyaltyOn()` is false everywhere —
nothing earned, nothing redeemed, an approved partner priced and recorded as
`retail`, `/api/account/pricing` answering retail — and the panel and the
storefront draw none of it: no tier chips or «+ Партнёр» in «Клиенты», no
points block or «Стать партнёром» in the cabinet, no «Использовать баллы» at
checkout, no «Салон, €» column in the editor. Nothing is deleted, so the
switch back on restores all five screens exactly. `publicPricing()` publishes
`partnersOn` (the storefront has to know what to draw) but never the discount
with bounds; `proUnitPrice`, `earn/redeemLoyaltyPoints`, `upsertPartner`, CSV).
Routes: `GET /api/account/pricing/`, `POST /api/account/pro-request/`,
`GET|POST /api/admin/customers/` (`?tier=`, `?format=csv`, «+ Партнёр»),
`GET|PATCH /api/admin/customers/[id]/` (`approve|reject|tier|notes|pointsDelta`),
`PUT /api/admin/settings {pricing}`. Partner letter `partner-welcome`
(`src/lib/partner-mail.ts`, once per day per address). Shop: «Цена для салонов»
chip, `loadProPricing()` :8623; checkout «Использовать баллы»; account «Стать
партнёром (салон/мастер)», «Баллы лояльности». Admin «Клиенты»
`admCustomersHTML` :13342 (lead text, chips «Все · Заявки Pro · Партнёры ·
Розница», «Скачать CSV», «Одобрить Pro»/«Отказать» in the row — immediate PATCH
+ letter, no confirm), card `admCustomerCardHTML` :13255 (KPIs, request block,
«Розница ↔ Партнёр» via confirm, «Начислить или списать баллы» → «Применить»,
«Заметка о клиенте» → «Сохранить заметку»), «+ Партнёр» form :13385. Settings
«Цены и баллы» `admPricingCard` :12491 (six numbers + one switch, saved through
the confirm card). Assistant: `set_pricing`, `adjust_points`.

**How to test it.** `tests/loyalty.test.ts` (43), `tests/partners.test.ts`,
`tests/account-flows.test.ts`; e2e `admin-sections.spec.ts` (approve from the
row; «+ Партнёр» → letter → partner sees «Цена для салонов»),
`sweep-admin-ops.spec.ts` (customers), `sweep-admin.spec.ts` (bounds). Manual:
«Ещё» → «Клиенты» → chip «Заявки Pro» → «Одобрить Pro».

**State today.** Works. Business fit is the open question: Renat answered
«Салоны/опт по другой цене — Нет, но хочу в будущем» (`docs/RENAT-ANSWERS.md`
round 2), yet both partner pricing and points are live and **points are on by
default** (5 % earn). POS sales earn nothing. Points show in order letters.

**Simplification candidates.** Q7 (row approval without confirm), Q10 (switch
the whole programme off by default / hide the page), Q15 (CSV exports).

---

## 11. Customer accounts (login by code, profile, carts, stock alerts)

**What it is for.** Letting a customer see orders and save details without a
password; and remembering carts and "tell me when it is back" requests.

**Who uses it.** Shoppers; automatic (flows); Renat sees the resulting queues.

**How it works.** `050_customers.sql` (`customers`, `login_codes`, `carts`,
`stock_alerts`); `src/lib/customers.ts` (cookie `rmp_cust` 90 days signed with
`SESSION_SECRET`, six-digit code hashed, 15 min, 5 attempts). Routes
`POST /api/account/code/` (3/15 min per IP and per e-mail), `POST /api/account/
login/`, `GET|PATCH /api/account/me/`, `POST /api/account/logout/`, `POST
/api/carts/` (abandoned-cart snapshot, no prices), `POST /api/stock-alerts/`.
Shop `screenAccount` :8491 («Получить код» → «Войти» → «Мои заказы», «Мои
данные» + «Сохранить», points, partner request, «Доставка по умолчанию»).
Orders are matched by e-mail, so guest orders appear after the first login.
`resumeCart()` :8817 restores a cart from the abandoned-cart letter link.

**How to test it.** `tests/account-flows.test.ts` (37), `tests/account-code-
e2e-hook.test.ts`, `tests/security-*`; e2e `account.spec.ts` (code via the
`E2E_EXPOSE_LOGIN_CODE` door, order visible, profile saved, logout). Manual:
«Кабинет» → e-mail → «Получить код» → code from the letter → «Войти».

**State today.** Works. Missing (documented): unsubscribe endpoint (link leads
to the profile checkbox), GDPR self-delete, the «Доставка по умолчанию» block
prices with the *old* `SHIP` table (:4091) not the live rules (agent finding);
the checkout newsletter checkbox is never sent (§4).

**Simplification candidates.** Q12 (flows), Q44 (account extras: default
delivery block, birthday field).

---

## 12. Mail

**What it is for.** Every letter the shop sends — order letters, the sign-in
code, the gift card, three optional marketing letters, the partner welcome —
with the owner able to edit subject, intro and signature.

**Who uses it.** Automatic (hooks, cron); Renat («Маркетинг → Письма»); Dim
(Resend account, DNS).

**How it works.** `src/lib/mail.ts` (Resend REST, one retry, idempotency keys,
attachments, e2e capture sink), renderers `src/emails/*.ts` (8 templates ×
RU/ET/EN, inline-CSS tables, dark-mode logos), `src/lib/mail-hooks.ts`
(`onOrderCreated` — off unless `settings.flows.pending` or
`MAIL_PENDING_PAYMENT`; `onOrderPaid` → «Заказ принят» + owner ping + gift cards;
`onOrderShipped` → «Заказ отправлен» with tracking), `src/lib/mail-texts.ts` +
`src/emails/texts.ts` (`settings.mail_texts`: subject/intro/signature per
letter per language, 7 placeholders, caps 200/1500/300), `src/lib/flows.ts`
(abandoned cart after 3 h, back-in-stock on the out→in move or the daily sweep,
birthday `settings.flows.birthdayDays` days early — 0, the day itself, by
default — with a minted promo, `settings.flows` switches, queue counters),
`src/lib/delivery.ts` (the same daily job closes a `shipped` order when
Montonio's own shipment status reads as delivered or after
`settings.delivery.autoDays` days — 0/never by default; no letter either way), `src/lib/notify.ts` (owner ping: Telegram + e-mail to `RESEND_TO`,
default `info@diipsolutions.eu`, from `REMPIRE QA <onboarding@resend.dev>` when
`RESEND_FROM` is unset — a different fallback from `mail.ts`'s
`Rempire <shop@rempireshop.com>`). Routes: `GET /api/admin/mail/preview/`
(unauthenticated by design, rate-limited; `?format=texts` feeds the editor),
`POST /api/admin/mail/test/` (20/h, subject `[test]`), `POST /api/admin/mail/
send/` (customer reply), `GET /api/admin/flows/` (counters), `GET /api/cron/
flows/`. Admin «Письма» `ADM_MAIL_ROWS` :11062 — seven rows: «Заказ принят»
(«сразу после оплаты», always), «Заказ отправлен» («когда вы нажмёте
„Отправлен“»), «Товар снова в наличии» (switch `backstock`), «Брошенная корзина»
(«через 3 часа», switch), «Скидка ко дню рождения» («за 3 дня до даты», switch),
«Код для входа», «Цены для салонов включены»; editor `admMailEditorHTML` :11104
(RU/ET/EN, «Тема письма», «Вступление — абзац под приветствием», «Подпись —
последняя строка письма», placeholder chips, live preview + full iframe,
«Сохранить» (confirm card), «Отправить мне тест», «Вернуть стандартный текст»).
`tools/render-emails.mjs` renders all letters to disk/PNG.

**How to test it.** `tests/emails.test.ts`, `tests/emails-compat.test.ts` (mail-
client rules), `tests/mail.test.ts`, `tests/mail-hooks.test.ts`, `tests/mail-
texts.test.ts`, `tests/mail-send.test.ts`, `tests/account-flows.test.ts`
(flows + cron auth), `tests/partners.test.ts`; e2e `admin-mail.spec.ts` (owner
text reaches a real paid order's letter), `admin.spec.ts` (shipped letter with
tracking link via `/api/e2e/mail/`), `admin-sections.spec.ts`. Manual: «Ещё» →
«Маркетинг» → «Письма» → row → «Адрес для теста» → «Отправить мне тест».

**State today.** Sending works (domain verified, key set; e2e confirmation sent
03.09). **Contradictions:** the birthday row says «за 3 дня до даты» but
`runBirthdays` selects today's birthdays (`flows.ts:477–481`; the Renat letter of
23.08 promised "за 3 дня до"); «через 3 часа» is really "next daily cron"
on Hobby; the «Товар снова в наличии» switch shows **on** by default in the
panel (`DEMO.flows` :15593) and in `GET /api/overrides/` `DEFAULT_SETTINGS`
(`overrides/route.ts:31`) while the sender's `FLOW_DEFAULTS` are all **off**
(`flows.ts:57–62`) — until Renat toggles it once, nothing is sent although the
switch looks on; the owner ping goes to Dim's address unless `RESEND_TO` is set
(`RESEND_TO` is absent from `docs/accounts.md`); no cancellation or refund
letter exists although the cancel card promises one (§4); no "leave a review"
letter although the product page implies one.

**Simplification candidates.** Q12 (marketing flows), Q14 (mail editor
chips), Q46 (owner ping recipient / Telegram decision).

---

## 13. AI — assistant, text generator, ✨ buttons, photo cut-out

**What it is for.** Renat's "chatbot that fixes things": answers in plain
Russian, proposes changes he confirms, writes product and blog texts in three
languages, drafts customer replies.

**Who uses it.** Renat (admin FAB, editor buttons); shoppers (the shop chat);
Dim pays the OpenAI bill.

**How it works.**
- **Model/env**: OpenAI chat completions, `OPENAI_MODEL ?? "gpt-4.1-mini"`,
  `temperature 0.4`, JSON mode; key `OPENAI_API_KEY` (currently Dim's account,
  to move to the shop account at launch — `docs/accounts.md`). Cost order of
  magnitude on mini: a description/SEO call 400–700 tokens, a whole article
  10–15 k tokens (≈ cents); every text call is logged to `admin_audit` as
  `ai.text` with token counts — visible only in the database.
- **Assistant** `POST /api/assistant/` (`src/app/api/assistant/route.ts`,
  `PROMPT_V 19`): shop mode public (same-origin, 10 msg/min/IP, `max_tokens`
  400, catalogue slice `src/lib/catalogue-slice.ts`, blog links, actions
  `add_to_cart|open_product|open_category|open_cart|checkout`); admin mode
  requires the admin cookie **and** an `Origin` header, `max_tokens` 1500, the
  whole catalogue + custom products + low stock + (on keywords) customers and
  posts + attached photo keys. `src/app/api/assistant/actions.ts`
  `sanitizeAction()` whitelists 30 types, admin ones: `set_price`, `set_stock`,
  `set_seo`, `toggle_flow`, `toggle_chatbot`, `toggle_bundles`, `set_hero`,
  `create_promo`, `toggle_promo`, `set_shipping_rules`, `set_content`,
  `set_pricing`, `adjust_points`, `stock_adjust`, `stock_set`, `draft_post`,
  `publish_post`, `set_post_cover`, `add_product_photo`, `create_product`,
  `update_product`, `export_report`, and — 07.09.2026, Dim: «assistant needs
  to be able to help there as well» — `propose_bundle` (products and a name
  for a set that does not exist; NO price and no id, applying it opens the
  set editor filled in) and `set_bundle` (an existing set changed, straight to
  `POST /api/admin/bundles` so `validateBundle()` still decides whether it is
  cheaper than its parts; the ids come from `bundleLinesForPrompt()`, read
  only when the message is about sets). Every action is *proposed* as a card and
  applied by the panel through the normal routes after «Применить»
  (`askAdminAI` :16933, `confirmCard` :16862, `applyBlogAction` :8327,
  `applyProductPhoto` :17028…). Replies that are not a sentence are replaced
  and offered «Спросить ещё раз» (`src/lib/ai-json.ts`). Attachments: the
  paper-clip uploads to R2 `products/inbox/` first.
- **Shop chat** `public/shop2/chat.js`: rule-based fallback when
  `GET /api/assistant/` says disabled; gated by `settings.chatbot`; tracks
  `chat` events. Its `<script>` is **not** in `index.html` — `mountChat()` in
  `app.js` adds it per render, and only on a wide screen (`min-width: 768px`)
  outside `checkout`/`admin`/`scan`, so a phone never downloads it at all
  (Dim, 07.09.2026). `chatAllowed()` in `chat.js` repeats the same rule for a
  widget already in the page: a window resized narrow, or a walk into the
  checkout, has to take it off screen.
- **Text generator** `POST /api/admin/ai/text/` (`requireAdmin`, 30/h, 128 KB):
  tasks `describe`, `translate`, `seo` (product or post), `reply` (signature
  appended from `settings.content`, never model text), `blog_outline`,
  `post_full` (4500 tokens, catalogue slice, refuses a cut article),
  `post_translate`, `copy` (`hero|announcement|contact_page|email_footer|
  promo_note|product_name`). Prompts in `src/lib/ai-prompts.ts` (house voice,
  "never invent a fact").
- **Where the buttons are**: product editor «Написать черновик», «Перевести с
  русского», «Заполнить автоматически», «все три языка»; blog «Написать статью
  целиком» (three calls → autosaved draft), «Только план по теме», «Перевести на
  ET и EN», «Заполнить автоматически»; order card «Черновик помощника»; ✨ sparks
  `admSparkHTML` :13673 on hero slide texts, the announcement bar, the contact
  page intro, the e-mail signature, the promo note, the new-product name («✨
  Подобрать название»).
- **Photo cut-out** `POST /api/admin/upload/cutout/` → `src/lib/photo-cutout.ts`,
  OpenAI `gpt-image-1` images/edits with transparent background, only when
  `PHOTO_CUTOUT=openai`; the «✂ Убрать фон» button appears only then.

**How to test it.** `tests/ai-prompts.test.ts`, `tests/ai-prompts-articles.
test.ts`, `tests/ai-json.test.ts`, `tests/ai-text-route.test.ts`, `tests/ai-text-
route-articles.test.ts`, `tests/assistant-actions.test.ts`, `tests/assistant-
prompt.test.ts`, `tests/assistant-robust.test.ts`, `tests/assistant-photos.
test.ts`, `tests/assistant-admin-auth.test.ts`, `tests/security-assistant.
test.ts`, `tests/photo-cutout.test.ts`; e2e (all with the model stubbed or
absent) `admin-blog.spec.ts`, `admin-shell.spec.ts` (assistant, JSON-looking
answers, photo attachment), `admin-products.spec.ts` (`create_product`),
`chatbot.spec.ts`, `security.spec.ts`, `sweep-admin.spec.ts` (prompt
injection). Manual: FAB → «Какие заказы ждут отправки?»; product → «Описание» →
«Написать черновик».

**State today.** Works with a key (`OPENAI_API_KEY` ✅ on Vercel). Not enabled:
`PHOTO_CUTOUT` (absent from `docs/accounts.md`) — the cut-out button never
shows. The e2e suite runs keyless, so the *real* model behaviour is unverified
by CI. The spec's promises of automatic watermarking and background removal
on every upload were withdrawn (`docs/assistant-work.md`). «Подключения» shows
the «ИИ-помощник» row **green** while its text says the model is not connected
(`admIntegrationRows` :11548).

**Simplification candidates.** Q16 (✨ sparks), Q17 (promo note spark), Q18
(assistant action scope), Q22 (one "fill everything" button), Q42 (photo
cut-out on/off), Q43 (shop chat).

---

## 14. Blog

**What it is for.** Articles in three languages that bring people from Google,
written by Renat or by the assistant.

**Who uses it.** Renat (editor), shoppers, Google.

**How it works.** `posts` table (`070_blog.sql`), three seeded articles
(`071_blog_samples.sql`); `src/lib/blog.ts` (slug, markdown → HTML for old
posts, `sanitizeHtml` allow-list, publish/unpublish/soft delete); public
`GET /api/blog/` and `/api/blog/[slug]/`; admin `GET|POST|PATCH|DELETE
/api/admin/blog/`; prerendered pages + request-time pages + `sitemap-custom.xml`
(§2); storefront `screenBlog` :6095, `screenBlogPost` :6148 with prefetch and
`sessionStorage` cache. Admin «Блог» `admBlogScreen` :11194 («+ Статья»), editor
`admBlogEditorScreen` :11225: RU/ET/EN segment, «Заголовок», cover «+ Обложка»,
toolbar «Заголовок · B · I · • Список · Ссылка · Картинка · Товар · Отменить»
(contenteditable, paste from Word cleaned), «Анонс», «Подпись к обложке»,
«Теги», «Товары в статье» + «Добавить», fold «Адрес, автор и текст для Google»
(«Заполнить автоматически», «все три языка»), cards «Публикация»
(«Опубликовать», «Сохранить черновик», «Сохранить и обновить», «Снять с
публикации», «Удалить статью» with confirm) and «Помощник» («Тема статьи»,
«Написать статью целиком», fold «Только часть» → «Только план по теме»,
«Перевести на ET и EN»). Saving and publishing are immediate — no journal, no
undo (documented).

**How to test it.** `tests/blog.test.ts`, `tests/blog-page.test.ts`,
`tests/ai-text-route-articles.test.ts`; e2e `admin-blog.spec.ts` (toolbar post
reaches the shop, SEO fill, post published after the build is a real page,
markdown post opens, «Написать статью целиком» stubbed, assistant path, seeded
posts), `blog.spec.ts`, `sweep-admin-ops.spec.ts` (HTML bomb escaped),
`admin-sections.spec.ts`, `info-pages.spec.ts` (listing route). Manual: «Ещё» →
«Блог» → «+ Статья» → «Тема статьи» → «Написать статью целиком» → «Опубликовать».

**State today.** Works. The three sample posts are published on the live
database and read as real editorial; blog pages prerendered at build keep the
build-time head until the next deploy (documented).

**Simplification candidates.** Q47 («Только часть» fold), Q48 (sample posts).

---

## 15. Content and settings (hero, announcement, company, legal, the settings pages, journal)

**What it is for.** The owner's texts and switches: the home banner, the top
strip, company details and hours, legal pages, and the six settings pages.

**Who uses it.** Renat; the prerender (company details for JSON-LD).

**How it works.** `settings` table (`001_core.sql`, key → jsonb), written by
`PUT /api/admin/settings/` (per-key sanitisers) and published (whitelist) by
`GET /api/overrides/`. Keys in use: `chatbot`, `bundles`, `hero`, `flows`,
`shipping_rules`, `pricing`, `content`, `mail_texts`, `gift_amounts`,
`gsc_cache`, `vat_rate` (dev-only). `src/lib/content.ts` `DEFAULT_CONTENT`
(company legalName/regCode/vatNumber/address/email/phone/iban, hours ×7 + note,
social, announcement text/short, contactPage, emailFooter, legal overrides) →
`tools/pack-content.mjs` → `src/data/content.default.json` for the prerender;
legal texts `public/shop/legal.{ru,et,en}.js` with `{{legalName}}`… placeholders
(`docs/legal-review.md`: lawyer pass pending). Admin «Настройки» index
`ADM_SET_PAGES` :11585 → «Доставка и оплата» (§6), «Главная страница»
(`admSetHomeHTML` :11693: switches «Показывать наборы», «ИИ-чат для
покупателей»; hero editor `admHeroCard` :12102 with slide form :12052 — five
slides × RU/ET/EN × eyebrow/title/sub/cta, «Куда ведёт кнопка», image,
«Смена слайдов, секунд», «Сохранить»/«Добавить слайд»/«Сбросить к стандартному»
through the confirm card; «Верхняя полоска» block), «О компании»
(`admContentCard` :12297 blocks «Реквизиты», «Часы работы», «Соцсети», «Страница
„Контакты“», «Подпись в письмах» + `reportsCard` :16343), «Цены и баллы» (§10),
«Языки» (read-only), «Журнал изменений» (§1). Assistant: `set_hero`,
`set_content`.

**How to test it.** `tests/content.test.ts`, `tests/api.test.ts`; e2e
`admin.spec.ts` (hero save/reset, content phone), `sweep-admin.spec.ts` (banner
garbage, content card, `javascript:` links), `admin-sections.spec.ts` (rebuilt
cards). Manual: «Ещё» → «Настройки» → «Главная страница» → «Изменить» a slide
→ «Сохранить» → «Применить».

**State today.** Works. Open content: hours are empty (Renat has not given
them), legal texts are AI translations awaiting a lawyer, the domain registrant
is still THEFLOW OÜ.

**Simplification candidates.** Q8 («Языки» page), Q9 (read-only payment list),
Q30 (hero editor scope), Q32 (announcement/content blocks), Q49 (`vat_rate`
stays hidden).

---

## 16. Reviews

**What it is for.** Real customer reviews on product pages, published only after
Renat approves them.

**Who uses it.** Shoppers (write/read); Renat («Клиенты → Отзывы»).

**How it works.** `reviews` table (`021_reviews.sql`), `src/lib/reviews.ts`
(20–1500 chars, links/profanity/honeypot filters, 3/h per IP, salted IP hash
only with `SESSION_SECRET`), `GET|POST /api/reviews/`, `GET|PATCH
/api/admin/reviews/`. Product page «Отзывы» accordion, «Оставить отзыв» →
«Отправить отзыв»; admin `admReviewsHTML` :7526 with tabs «Новые ·
Опубликованные · Отклонённые» and «Опубликовать» / «Скрыть» (immediate, undo
toast, journal `moderate_review`). The old demo review pool is orphaned
(`public/shop/reviews-pool.js`, not loaded).

**How to test it.** `tests/reviews.test.ts`; e2e `product.spec.ts` (empty state,
form validation), `admin-sections.spec.ts` (publish + undo). Manual: product →
«Оставить отзыв» → admin «Ещё» → «Клиенты» → «Отзывы» → «Опубликовать».

**State today.** Works. The `loadAdminReviews` loader fires for signed-out
visitors too (:7493, the only admin loader without the `SRV.admin` guard) —
harmless 401s.

**Simplification candidates.** none — keep as is.

---

## 17. Analytics and reports

**What it is for.** Sales and visitor numbers the owner can trust, a Search
Console block, and the accountant's monthly export.

**Who uses it.** Renat («Обзор», «Аналитика», «Отчёт для бухгалтера»); the
accountant; the assistant (30-day summary in its prompt).

**How it works.** `events` table (`080_events.sql`, 90-day retention by cron +
1-in-2000 sweep), `POST /api/track/` (60/min, ≤1 KB, bots dropped, `sid` in
`sessionStorage`, no cookie), storefront `track()` :5172 (view, product,
search, add_to_cart, checkout, purchase, chat); `src/lib/analytics.ts`
(`PAID_STATUSES paid|shipped|delivered`, UTC days, `getOverviewSummary`,
`getAnalyticsSummary`), routes `GET /api/admin/overview/`, `GET
/api/admin/analytics/?range=today|7d|30d|90d`, `GET /api/admin/analytics/gsc/`
(`src/lib/gsc.ts`, RS256 service-account JWT, 24 h cache in `settings.gsc_cache`);
reports `src/lib/reports.ts` (`GET /api/admin/reports/orders/?month=&format=
json|csv|xlsx`, VAT 24 % from `settings.vat_rate`, hand-rolled XLSX). Admin
«Обзор» `admOverviewHTML` :10029 («Сделать сегодня» queues, «Последние заказы»,
«Продажи» Сегодня / 7 дней), «Аналитика» `admStatsScreen` :11403 (range chips,
KPIs «Выручка · Заказы · Средний чек · Из корзины в заказ», bars, «Топ товаров»,
«Искали, но не нашли», then `admStatsMoreHTML` :11443: «Воронка», «Бренды»,
«Смотрят, но не покупают», «Что искали чаще всего», «Промокоды», «Откуда
приходят», «Ещё цифры», «Google: 28 дней»), «О компании → Отчёт для бухгалтера»
(«Месяц», «Скачать CSV», «Скачать XLSX»; assistant `export_report`). Cloudflare
beacon: placeholder in `index.html` :95.

**How to test it.** `tests/track.test.ts`, `tests/events.test.ts`,
`tests/overview.test.ts`, `tests/analytics.test.ts`, `tests/gsc.test.ts`,
`tests/reports.test.ts`, `tests/payments-apply.test.ts` (purchase row); e2e
`admin-shell.spec.ts` («Сделать сегодня» counts a paid order), `sweep-admin.
spec.ts` (reports download), `admin-sections.spec.ts`. Manual: «Ещё» →
«Аналитика» → «7 дней».

**State today.** Sales figures work (from `orders`). Behaviour figures work
but under-count: POS sales never write a purchase event; ad blockers can drop
`/api/track`; `track("purchase")` can fire again on re-render of the receipt
(agent finding, `doneState` :17136 vs `S.done` only set in demo). GSC: **not
configured** (service account exists, key + env pending). Cloudflare beacon:
placeholder. Day boundaries are UTC.

**Simplification candidates.** Q56 (which numbers), Q57 (GSC block), Q36
(beacon), Q51 (reports CSV vs XLSX).

---

## 18. Notifications

**What it is for.** Telling the customer what happened to the order or the
product, and telling Renat that money arrived.

**Who uses it.** Customers (letters), Renat (ping, badges), Dim (fallback
recipient today).

**How it works.** Customer side = the mail hooks and flows (§12) plus the
«Сообщить о наличии» subscription (§11). Owner side = `src/lib/notify.ts`
called from `onOrderPaid` (Telegram if `TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHAT_ID`;
e-mail to `RESEND_TO`) and from the prototype forms. In-app: the «Заказы» badge
(paid not shipped), «Сделать сегодня» rows (`ordersToShip`, `proRequests`,
`reviewsPending`, `stockAlerts`), tab warn counts. **No push notifications, no
service worker, no SMS.**

**How to test it.** `tests/mail-hooks.test.ts`, `tests/payments-giftcard-issue.
test.ts` (ping once), `tests/overview.test.ts`; manual: pay a mock order → check
the ping mailbox.

**State today.** Partial: Telegram not set (Renat has not answered
`docs/OPEN-QUESTIONS.md` «Telegram-уведомления»); `RESEND_TO` undocumented →
pings default to `info@diipsolutions.eu`; the ping's From falls back to
Resend's onboarding domain when `RESEND_FROM` is unset.

**Simplification candidates.** Q46.

---

## 19. Cron jobs

**What it is for.** The two things that must happen without anyone pressing a
button: the automatic letters and deleting old visitor events.

**Who uses it.** Automatic (Vercel).

**How it works.** `vercel.json` crons → `GET /api/cron/flows/` (`runFlows`:
abandoned carts, back-in-stock sweep, birthdays; `maxDuration 60`) and
`GET /api/cron/events-retention/` (90 days); both need `authorization: Bearer
<CRON_SECRET>` (Vercel adds it), 503 without the secret. Hobby: once a day, time
floats within the hour.

**How to test it.** `tests/account-flows.test.ts` (auth, idempotency),
`tests/events.test.ts`; manual `curl -H "authorization: Bearer …"
https://<host>/api/cron/flows/` → `{ok, abandoned, backstock, birthday}`.

**State today.** Works when `CRON_SECRET` is set (✅ per `docs/accounts.md`);
whether the daily run fires on the Rempire Vercel project has not been
verified in the docs (no log cited). Once a day makes «через 3 часа» untrue.

**Simplification candidates.** Q12.

---

## 20. Uploads and storage

**What it is for.** Photos and videos the owner uploads from the phone, the gift
PDFs, and (prototype phase) the questionnaire answers.

**Who uses it.** Renat (uploads), automatic (PDFs), Dim (buckets, tokens).

**How it works.** `src/lib/storage.ts` — Cloudflare R2 over hand-rolled SigV4,
key prefixes `products/ hero/ reviews/ blog/ videos/ giftcards/`, public URL
`R2_PUBLIC_BASE`; `src/lib/images.ts` (sharp: type sniffed from bytes, HEIC
refused with a message, ≤ 12 MB, EXIF/GPS stripped, WebP 1600 px + 400 px thumb);
`src/lib/video.ts` (MP4/MOV ≤ 60 MB, no transcode; YouTube/Vimeo/Instagram
links validated); `POST|DELETE|GET /api/admin/upload/` (kinds `product hero
review blog video`, 60/h per session), `POST /api/admin/upload/cutout/` (§13);
gift PDFs written to `giftcards/`. Admin: gallery tiles in the editor, «+
Обложка» in the blog, hero slide «Загрузить свою картинку», the assistant's
paper-clip. Prototype: `@vercel/blob` in `/api/submit` and `/api/feedback`
(private store `rempire-qa` on Diip's Vercel team — `docs/accounts.md` says
"⬜ migrate").

**How to test it.** `tests/upload.test.ts`, `tests/storage.test.ts` (SigV4
against the AWS example), `tests/video.test.ts`, `tests/photo-cutout.test.ts`,
`tests/security-uploads.test.ts`; e2e `admin-products.spec.ts` (upload with the
route stubbed), `sweep-admin-goods.spec.ts` (Instagram reel). Manual: product →
«Фото и видео» → «+ Фото с телефона» → «Сохранить» → shop.

**State today.** Works (R2 set 03.09). Caveats: Vercel serverless accepts
~4.5 MB per request, so a 12 MB photo or a 60 MB video cannot pass on Vercel
(the docs assume Railway for production); a video uploaded and then cancelled
stays in the bucket; `cleanGallery()` accepts any `https://` image host.

**Simplification candidates.** Q42, Q31 (Blob store retirement).

---

## 21. Auth and sessions

**What it is for.** One owner password for the admin; a code by e-mail for
customers; test-only doors for the e2e suite.

**Who uses it.** Renat, shoppers, CI.

**How it works.** `src/lib/auth.ts`: `ADMIN_PASSWORD_HASH` (scrypt, made by
`tools/hash-password.mjs`), cookie `rmp_admin = v1.<expiry>.<hmac>` signed with
`SESSION_SECRET`, 30 days, httpOnly, SameSite=Lax; `requireAdmin()` on every
`/api/admin/*` route except `login`, `logout`, `me`, `mail/preview` (enforced by
`tests/fuzz-routes.test.ts`); login 5/min per IP (per-instance map);
`GET /api/admin/me/` reports `configured`. Customers: `rmp_cust` (§11). Test
doors: `E2E_BOOTSTRAP=1` + non-production → `/api/e2e/bootstrap/` (migrate),
`/api/e2e/gift-card/` and `/api/e2e/mail/` (both also `requireAdmin`);
`E2E_EXPOSE_LOGIN_CODE=1` → the login code in the response. No password
shortcut, no query-string bypass — the suite logs in with the real route and a
fixed hash (`e2e/env.mjs`). Rate limits are in-memory per instance
(`auth.rateLimit`, `payments/ratelimit.allow`).

**How to test it.** `tests/auth.test.ts`, `tests/fuzz-routes.test.ts` (locks on
every route, cookie forgery, cross-cookie), `tests/security-*.test.ts`,
`tests/account-code-e2e-hook.test.ts`; e2e `security.spec.ts`, `sweep-admin.
spec.ts` (six wrong passwords then 429). Manual: wrong password → «Неверный
пароль»; six tries → «Слишком много попыток — подождите минуту.».

**State today.** Works. Open from the audit: no session revocation (M6), per-
instance limiters on a spoofable header (M3), sequential order numbers (L6),
`/api/admin/mail/preview` public by design (L4) and returning the owner's
saved mail texts. No roles for the helpers Renat named.

**Simplification candidates.** Q52 (roles: decide "no" explicitly).

---

## 22. Database and migrations

**What it is for.** Where every order, setting and override lives, and how the
schema reaches production without anyone running SQL by hand.

**Who uses it.** Automatic (build), Dim (`npm run migrate`), tests.

**How it works.** `src/lib/db.ts` (one `pg` pool per instance, PGlite when
`DB_DRIVER=pglite`, NUL stripping, jsonb casting); migrations `db/migrations/`:
`001_core` (settings, product_overrides, orders + `order_number_seq`,
admin_audit) · `002` discount_code · `003` gallery · `020` gift_cards +
gift_card_uses · `021` reviews · `030/031` shipping_rules setting · `050`
customers, login_codes, carts, stock_alerts · `060` promo_codes + uses · `070`
posts · `071` sample posts · `080` events + paid index · `081` sales index ·
`090` stock_levels + stock_moves · `091` orders.channel · `100` tiers/loyalty
(customers columns, pro_price, orders columns, loyalty_ledger) · `110`
description · `111` order_messages · `120` bundles (+ seed) · `130` seo_langs ·
`131` custom_products · `140` `delivered` status + rebuilt index ·
`147` product_overrides `sizes` + `hidden` (+ partial index). Packed by
`tools/pack-migrations.mjs` into `src/db/migrations.generated.ts` (`prebuild`),
applied by `tools/migrate.mjs --if-configured` (`postbuild`, only when
`DATABASE_URL` is set), tracked in `_migrations`; manual `GET|POST
/api/admin/migrate/` (no UI button; `tools/e2e-bootstrap.mjs` for a running dev
server). Number ranges per area in `docs/build-contracts.md`.

**How to test it.** `tests/migrations.test.ts`, `tests/shipping-migration.
test.ts`, `tests/bundles-db.test.ts`, every other test (migrations run on
PGlite first); manual `DB_DRIVER=pglite npm run migrate`.

**State today.** Works; production database migrated 03.09. The Railway host
match that disabled TLS verification by substring is gone (audit M9 closed
07.09) — `DATABASE_SSL_CA` / `DATABASE_SSL_NO_VERIFY` decide now, and Railway
needs one of them because it signs its Postgres certificate with a private CA.
Pool default 5 per instance.

**Simplification candidates.** none (keep).

---

## 23. Testing and CI

**What it is for.** Proving the shop still works after every change without
touching a bank, a carrier or a mailbox.

**Who uses it.** Dim and the agents; GitHub Actions.

**How it works.** **Unit/integration**: `npm test` = vitest, 74 files on
PGlite (routes called directly, external fetches stubbed; fuzz layer
`tests/fuzz-*.test.ts` throws a fixed corpus of hostile inputs at every route
and asserts no 5xx/stack traces; money invariants through the real routes).
**e2e**: `npm run e2e` = `node tools/e2e-build.mjs` (packers + prerender with
the e2e base URL) then Playwright with `webServer: next dev --port 3417`
(`E2E_PORT` overrides; `next build` cannot be used because `NODE_ENV` is baked
into the bundle — see `docs/testing.md`), `DB_DRIVER=pglite`,
`PAYMENT_PROVIDER=mock`, `SHIPPING_PROVIDER=mock`, `E2E_BOOTSTRAP=1`,
`E2E_EXPOSE_LOGIN_CODE=1`, no OpenAI/Resend keys; readiness URL is the bootstrap
route (migrates the in-memory DB). Projects: `desktop` 1280, `tablet`, `mobile`
375 (all Chromium), `mobile-safari` (WebKit iPhone 13, customer specs only),
`webkit-local`. `workers: 1`, serial, every mutating spec reverts what it
changed; per-spec fake IPs beat the rate limits; `e2e/fixtures.ts` holds
`PRODUCT`/`PRODUCT_2`/`BUNDLE` and the RU→ET/EN lookups. **CI**
(`.github/workflows/ci.yml`): `checks` (typecheck + vitest), `e2e` in 4 shards
(Chromium projects), `safari` (WebKit); ~15 min per shard; docs-only pushes
skip; **CI never deploys**. Visual baselines are Windows-only
(`e2e/__screenshots__`, `skipIfNoBaseline` in CI). Flakiness notes: a second
`next dev` in the same checkout corrupts `.next`; the parcel-point test hits
the live Omniva feed; agents in parallel must use their own port and worktree
(project memory: 3617/4117 conventions).

**How to test it.** `npm run typecheck && npm test`; `E2E_PORT=<port> npx
playwright test e2e/<spec>.spec.ts --project=desktop`; `node tools/i18n-gaps.mjs`
(0 gaps); `node --check public/shop2/app.js`.

**State today.** Works; ~1 100+ unit tests, 33 specs. Not covered: real Montonio
(payments and labels), real OpenAI, the camera scanner path, iOS Safari for the
admin, cancel/refund in the browser, Linux visual baselines.

**Simplification candidates.** Q53 (test runtime / sharding stays), none
functional.

---

## 24. Deploy, environments and the domain switch

**What it is for.** Getting a commit onto `rempireshop.diipsolutions.eu` today
and onto `rempireshop.com` on switch day, without touching the live Shopify
shop before then.

**Who uses it.** Dim (commits, env vars, DNS); Vercel (auto-deploy).

**How it works.** Vercel project `rempire-web` (team Rempire, Hobby, imported
03.09) builds on push to `main` of `github.com/rempireshop/rempire-web`.
**Hobby rule:** only commits authored by the account owner deploy, hence the
`Rempire Store <324390963+rempireshop@users.noreply.github.com>` author on
every commit. `npm run build` = `prebuild` (pack migrations, pack content, copy
vendor, prerender with `PUBLIC_BASE_URL`) → `next build` → `postbuild` (migrate
if `DATABASE_URL`). Environment variables: the table in `docs/accounts.md`
(`OPENAI_API_KEY`, `RESEND_*`, `MAIL_REPLY_TO`, `DATABASE_URL`, `SESSION_SECRET`,
`ADMIN_PASSWORD_HASH`, `PUBLIC_BASE_URL`=staging, `CRON_SECRET`, `PAYMENT_PROVIDER=
montonio`, `MONTONIO_*` sandbox, `R2_*` set; `GSC_*`, `TELEGRAM_*` pending).
Staging: `https://rempireshop.diipsolutions.eu/shop2/`. DNS for `rempireshop.com`
is on Cloudflare (nameservers switched 03.09) with `A @` and `www` still pointing
at Shopify; e-mail routing `info@`/`shop@` → the shop Gmail. **The switch**
(`docs/seo.md` "At the switch"): set `PUBLIC_BASE_URL=https://rempireshop.com`
(opens robots/meta, rebuilds 810 pages), verify the `X-Robots-Tag` host rule,
change `A`/`CNAME` to Vercel, submit `sitemap.xml`, request indexing, watch
hreflang, keep Shopify paid one more month, switch the salon card reader
(Shopify Payments dies with Shopify — `docs/renat-feedback-2.md` §12).
Redirects from the old URLs: `docs/redirect-map.csv`, not implemented.

**How to test it.** `PUBLIC_BASE_URL=https://rempireshop.com npm run prerender &&
npm run prerender:check` locally; after deploy `curl -sI …/shop2/ | grep -i
x-robots`, `robots.txt`, `sitemap.xml`.

**State today.** Staging deploys work. **Ambiguities to settle:**
`docs/accounts.md` names Railway as "production hosting" and Vercel as
"staging/previews only (Hobby is non-commercial)" while the code, the crons and
the deploy identity all assume Vercel — Hobby's terms and limits (daily cron,
4.5 MB bodies, function timeouts) shape several features; the OpenAI key is on
Dim's account; Montonio live keys need Renat's KYC; the domain registrant is
THEFLOW OÜ; the Vercel Blob store lives on Diip's team.

**Simplification candidates.** Q31, Q36, Q52, Q54 (hosting decision).

---

## 25. Prototype leftovers still deployed

**What it is for.** Nothing for the shop — these are the questionnaire and the
design review pages from August.

**Who uses it.** Nobody now (Renat answered both rounds; the design was chosen).

**How it works.** `/` client-redirects to `/demo/` (`src/app/page.tsx`); `/qa`
and `/qa2` (React questionnaire, `src/data/questions*.ts`, `src/components/
QaForm.tsx`) → `POST /api/submit/`; `/demo` (`DemoHub`) and `/prototypes/*`
(the eight design directions, React + Babel vendored, `'unsafe-eval'` CSP);
`/api/feedback/` (the 💬 widget of the prototypes); both routes write Vercel
Blob and forward to Telegram/e-mail; the old `/shop/` SPA (`public/shop/
index.html`, `app.js`, 95 `p/<id>` pages) is reached only through redirects;
`README.md` still describes the questionnaire phase with `bun`.

**How to test it.** `tests/fuzz-routes.test.ts` covers the two routes; nothing
else.

**State today (07.09.2026): gone.** Q31 was answered yes and everything above
was deleted — the two questionnaires, the hub, the prototypes, the vendored
React/Babel, the feedback widget, `POST /api/submit/` and `POST /api/feedback/`,
the five OG cards and all of `src/components/`. `/` is now a 307 to `/shop2/`,
the `'unsafe-eval'` carve-out is gone and `tests/security-product-page.test.ts`
forbids its return, and `README.md` has been rewritten. What was kept: the 95
legacy `/shop/p/` pages, because `docs/redirect-map.csv` and the shared link
previews point at them. Everything else is in git at `448cbd7`. Full record:
`docs/audit/2026-09-07-cleanup.md`.

**Simplification candidates.** Q31 — done.

---

## Appendix A — the weekly tasks, tap by tap (as walked on 06.09.2026)

Counted on a 375 px phone viewport, signed in (the cookie lasts 30 days;
sign-in is one field + «Войти»). "Tap" = one press in the admin; typing and the
phone's own dialogs are named separately.

| Task | Taps today | Path | Where it could be shorter |
|---|---|---|---|
| New parcel order → label → shipped | **6** (+ print) | «Заказы» → row → «Создать этикетку» → «Открыть PDF (A4) ↗» (PDF opens; print via the phone's share sheet) → «Отправлен» → confirm «Отправлен» | 3–4: label from the row, PDF auto-opens, no confirm when a label exists (Q25, Q26) |
| … → delivered later | **+4** | «Заказы» → chip «Отправлены» → row → «Доставлен» | 0 if the step is dropped or auto-closed (Q24) |
| Pickup order | **2** | «Заказы» → «Выдан клиенту» in the row | — |
| Answer a customer | **5** + paste | «Заказы» → (chip «Все» / search) → row → «Написать клиенту» → paste → «Черновик помощника» → «Отправить» | 3 if the reply panel opens with the draft from the row (Q6) |
| Change a price | **4** + typing | «Товары» → search → row → «Размеры и цены» → price → «Сохранить» | 3 via the assistant («поставь 12,90 на X» → «Применить») |
| Add an own product with 2 sizes + photo | **9** + typing + photo picker | «Товары» → «+ Товар» → brand, name, section → «Размеры и цены» → price → «+ Размер» → size, price → «Сохранить товар» → «+ Фото с телефона» → pick → «Сохранить» | 7: photo before the first save; sizes on the first tab (Q19) |
| Stock take, known barcode | **1–2 per item** | «Сканер» icon → aim → («+»…) → «Принять +N» | already minimal |
| Stock take, unknown barcode | **3** + typing | … → «К какому товару?» search → tap the row → «Принять +N» | — |
| Salon sale | **4** + typing | «Салон» → search (or «Сканировать») → size chip → «Терминал» → «Оформить» | 3 without the confirm; 2 with a default payment method (Q29) |
| Promo code | **5** + typing | «Ещё» → «Маркетинг» → «+ Промокод» → code, % → «Создать» | 4 if «Маркетинг» sits in the bar (Q23) |
| Blog post with AI | **6** + topic + cover picker | «Ещё» → «Блог» → «+ Статья» → «Тема статьи» → «Написать статью целиком» → «+ Обложка» → «Опубликовать» | 5 |
| Approve a partner | **2–4** | «Обзор» row «заявка на партнёрство» → «Одобрить Pro»; or «Ещё» → «Клиенты» → chip → «Одобрить Pro» | — (Q7 asks for a confirm, which adds one) |

## Appendix B — found broken or contradictory while mapping (for the other agents)

1. **Cancel card promises a refund and a letter that do not exist.**
   `public/shop2/app.js:10249–10250` («Деньги вернутся клиенту, письмо уйдёт
   автоматически.») — `setOrderStatus("cancelled")` only returns stock
   (`src/lib/orders.ts:1246–1264`); no refund call anywhere; no cancel template
   in `src/emails/`. Same for «возврат» (`refunded`): bookkeeping only.
2. **Montonio refunds never reach the shop.** `src/lib/payments/montonio.ts:84–86`
   maps `REFUNDED|PARTIALLY_REFUNDED` → `paid`; the `refundToken` webhook is
   refused (`:249`). A refund made in the Montonio portal leaves the order
   `paid` and in the accountant's export.
3. **«Товар снова в наличии» switch: three defaults, two truths.** Panel
   `DEMO.flows` `app.js:15593` and `GET /api/overrides/` `DEFAULT_SETTINGS`
   (`src/app/api/overrides/route.ts:31`) say `backstock: true`; the sender's
   `FLOW_DEFAULTS` (`src/lib/flows.ts:57–62`) say `false`. With no
   `settings.flows` row the switch looks on and nothing is sent.
4. **Birthday letter label vs behaviour.** Row says «за 3 дня до даты»
   (`app.js:11067`); `runBirthdays` selects today's birthdays
   (`src/lib/flows.ts:477–481`).
5. **POS hint promises a receipt letter.** «С почтой клиент получит чек
   письмом.» (`app.js:15430` area, `admSalonHTML`) — `src/app/api/admin/pos-
   orders/route.ts` sends nothing; it also bypasses `applyPaymentResult` (no
   points, no purchase event).
6. **Scanner «Списать −N» writes a `sale_pos` move with no order** — inventory
   shows a sale, revenue does not (`scanCommitMove`, `app.js:14879–14881`).
7. **Newsletter consent and invoice company are collected and dropped.**
   `S.newsletter` (`app.js:20246`) and `S.invoiceCo` (`:9314`) never enter
   `orderPayload()` (`:9216`).
8. **Two checkout options post the wrong method.** «Apple Pay / Google Pay»
   and «По счёту — для компаний» both send `method:"bank"` (`app.js:9328`,
   `PAYS` `:4572`); there is no invoice flow.
9. **Digital orders: list vs card disagree.** A paid gift-card-only order shows
   «Отправлен» in the list (`admOrderStepBtn` `:10185`) but the card hides
   every step (`showSteps` `:10370`).
10. **Owner ping defaults to Dim's address and Resend's onboarding sender.**
    `src/lib/notify.ts:54–55` (`RESEND_TO` → `info@diipsolutions.eu`,
    `RESEND_FROM` → `REMPIRE QA <onboarding@resend.dev>`); `RESEND_TO` is not in
    `docs/accounts.md`. `src/lib/mail.ts` uses a different `RESEND_FROM` fallback.
    **Fixed 07.09:** no default recipient at all — no `RESEND_TO`, no ping, and a
    log line saying so; the sender falls back to the shop's own verified
    address. `docs/audit/2026-09-07-cleanup.md`.
11. **`admin_audit` is written but never shown; `GET /api/admin/audit/` has no
    caller** (`app.js` grep). The panel's journal is `localStorage` per browser.
12. **`track("purchase")` can double-fire on a real receipt.** `doneState()`
    `app.js:17136` short-circuits on `S.done`, which only `finishDemo()` sets
    (`:9301`); the comment at `:17146–17150` claims the opposite.
13. **Assistant `set_shipping_rules` drops `unisend`.**
    `src/app/api/assistant/actions.ts:181` lists four carriers; `src/lib/orders.
    ts:977` and `src/lib/shipping/montonio.ts:50` list five.
14. **Dead controls in the product editor.** «+ Размер» `disabled title="скоро"`
    (`app.js:14202`), «×» `disabled title="Объёмы заводит Дим"` (`:14197`),
    «Показывать в магазине» permanently on (`:14105–14106`).
15. **Dead hooks.** `[data-admedit]` handler with no emitter (`:19918`),
    `[data-admship]`, `[data-admcustdemote]`, `[data-repeat]`, `[data-dot]`,
    `[data-method]`, `[data-machine]`, `data-promomore` (no reader);
    `data-cardsize` (`:18517`). Dead exports: `getMontonioShipment`,
    `fetchMontonioLabelFile`, `inventory.todaysMoves`, `db.dbReady/driverKind`,
    `blog.getPostByIdOrSlug`, `payments/methods.resetPaymentMethodsCache`,
    `tariffs.suggestShippingRulesFromTariffs` (only its browser mirror runs).
    **Fixed 07.09:** every dead export above removed, plus the MakeCommerce
    stub. `suggestShippingRulesFromTariffs` was **kept** — it is the checked
    twin of `computeMontonioFillPatch()` in `app.js` and its only test, so it
    is not dead. The dead click hooks are still open.
    `docs/audit/2026-09-07-cleanup.md`.
16. **«Подключения» squares that cannot be trusted.** «Письма клиентам ·
    Resend» is green until a test send fails (`app.js:11527`); «ИИ-помощник» is
    green while saying the model is not connected (`:11548`).
17. **Committed `public/shop2/index.html` carries the e2e base URL**
    (`http://localhost:3417` in canonical/hreflang/JSON-LD at HEAD) — a
    generated file that should have been restored before the commit.
18. **`flowCountsAsked` / `reportSummaryAsked` are one-shot** (`app.js:11775`,
    `:16337`): «Ждут письма: N» never refreshes in a session.
19. **`admLowCount` means two things** (`app.js:10501`): manual flags before the
    stock list loads, tracked counts after.
20. **Search box silently overrides the order chips** (`app.js:10162`).
21. **Two labels, one action, one screen:** «Приёмка» (`:10521`) and
    «Сканировать» (`:14739`) both `data-scanopen` on «Товары → Склад».
22. ~~**`ALLOWED_HOSTS` still lists `localhost:3000`**~~ — **stale row, not a
    bug.** It reads `localhost:3300`; fixed in `cdb6327`, recorded in
    `docs/audit/2026-09-06-admin-qa.md:156`. Re-checked 07.09.
23. ~~**TLS verification toggled by substring match on `DATABASE_URL`**~~ —
    **fixed 07.09.** The host match is gone; `DATABASE_SSL_CA` (verify against
    the provider's own CA) and `DATABASE_SSL_NO_VERIFY` (give up, loudly) are
    the only switches, in the app and the migrator alike, pinned against each
    other by `tests/migrations.test.ts`. `docs/backend.md`,
    `docs/audit/2026-09-07-cleanup.md`.
24. **Reply sending and Pro approval skip the confirm card** while cheaper
    actions require it (`app.js:18833`, `:13469`) — an inconsistency, not a bug.
25. **Docs promise things the code does not do** — see Appendix C.

## Appendix C — docs vs code (drift found while mapping)

| Doc says | Code does |
|---|---|
| `docs/FOR-RENAT-2026-08-23.md`: invoice PDF by e-mail, «Заказ ждёт в пакомате» letter, review request after a week, newsletters from the admin, roles per helper, birthday letter «за 3 дня до» | none of these exist; birthday is on the day |
| ~~`docs/assistant-work.md`: buttons «Сгенерировать описание», «Перевести на ET/EN», «SEO-тексты», «Составить ответ»~~ | **doc corrected 07.09** to the UI's «Написать черновик», «Перевести с русского», «Заполнить автоматически», «Черновик помощника» |
| ~~`docs/inventory.md`: «Открыть сканер» button on «Склад»~~ | **doc corrected 07.09** to «Приёмка» / «Сканировать» and «Сканер отдельным приложением ↗» |
| `docs/features.md` §2: amounts 25/50/100 | `GIFT_AMOUNTS` 25/50/75/100, default 25/50/100, setting `gift_amounts` |
| ~~`docs/accounts.md`: Railway = production hosting~~ | **corrected 07.09**: Vercel = production, Railway = the database. And Vercel Hobby forbids commercial use — `docs/HOSTING.md` |
| `docs/accounts.md` env table | `RESEND_TO`, `DATABASE_SSL_CA`, `DATABASE_SSL_NO_VERIFY` added 07.09; `PHOTO_CUTOUT`, `SHIPPING_PROVIDER`, `MAIL_PENDING_PAYMENT`, `DPD_API_*` still missing |
| `docs/mail.md` "five templates" | eight renderers (`gift-card`, `login-code`, `partner-welcome` added) |
| `docs/design/admin-handoff-README.md`: gift-card designs dark/light/own, payment switches | code: one PDF design, payment list read-only. (The three label rows — «Наклейка», «Отметить отправленным», 4th step — were corrected in the doc 07.09; `docs/GLOSSARY.md` is the list) |
| ~~`README.md`~~ | **rewritten 07.09** |
| `docs/OPEN-QUESTIONS.md` A5 "pickup default off" | pickup is live and free in EE |
