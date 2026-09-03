# Rempire shop — feature / admin / assistant audit

Read-only audit, 03.09.2026. Scope: `public/shop2/` (storefront SPA + admin + chat),
`src/app/api/**`, `src/lib/**`, `src/emails/**`, `db/migrations/**`, compared against
`docs/features.md`, `docs/OPEN-QUESTIONS.md`, `docs/RENAT-ANSWERS.md`,
`docs/assistant-spec.md`, `docs/merchant-feed.md`, `docs/backend.md`, `docs/mail.md`,
`docs/payments.md`, `docs/shipping.md`, `docs/seo.md`, `docs/accounts.md`,
`docs/renat-feedback-2.md`, `docs/FOR-RENAT-2026-08-23.md`, `docs/proofread-report.md`.

Nothing was run (no dev server, no tests). Nothing was edited except this file.

**How to read the citations.** Other agents were writing to the tree throughout this audit
— `public/shop2/app.js` grew by ~360 lines and `src/lib/orders.ts` shifted twice while I
was reading — so **`app.js` and `chat.js` findings are anchored on function names and on
the quoted Russian string, not on line numbers**; grep for the symbol or the literal.
Line numbers are kept only for `src/**`, `tools/**` and the docs, where they were stable,
and are as of 03.09.2026.

Two things were in flight and are **not** covered below: the shipping branch
(`src/lib/shipping/`, `src/app/api/admin/shipments/`, `src/app/api/shipping/points/route.ts`
— read but not touched; internally consistent as of this reading) and a photo-upload
branch that appeared mid-audit (`src/app/api/admin/upload/`, `src/lib/images.ts`,
`src/lib/storage.ts`, `db/migrations/003_product_gallery.sql`). If the upload branch has
since landed, the "photos are not editable" rows in §2.4 need re-checking.

**Headline:** the storefront is genuinely further along than I expected — a shopper can
browse, filter, search, read a product in three languages, build a cart and walk a real
checkout that re-prices on the server, pays through Montonio and gets a confirmation
e-mail. The plumbing is configured and an end-to-end sandbox order went through on 03.09.

What is not finished is the layer *around* that: (a) payments are still on sandbox and the
provider decision is genuinely unmade, (b) the admin looks like a shop back-office but is
a demo shell with about a dozen real controls in it and a lot of fabricated numbers,
(c) three of six e-mail templates have no trigger, (d) roughly 340 Russian interface
strings never reach the ET/EN dictionary, and (e) several customer-facing surfaces —
the account screen, the promo code, the reviews — are mock-ups presented as working
features.

---

## Top 15 — must fix before a launch-quality QA pass

Ranked by "how badly does this break a real customer or a real euro".

| # | Problem | Where | Why it is on this list |
|---|---|---|---|
| 1 | **Montonio is wired to the sandbox, so no real money moves — and the fallback if its keys ever go missing is a forgeable mock.** `MONTONIO_ENV=sandbox` (`docs/accounts.md` env table, "✅ sandbox; e2e test order R-100002 paid 03.09"). Separately, `getProvider()` *silently* falls back to `MockProvider` when the keys are absent, and `mockSecret()` then falls back to the repo-visible literal `"rempire-mock-payments"`; `MockProvider.verifyNotification` accepts `{mockToken}` on the public `POST /api/payments/notify/`. | `docs/accounts.md` env table; `src/lib/payments/index.ts:28`, `src/lib/payments/mock.ts:33-35`, `mock.ts:98-107` | Going live needs Renat's own Montonio account, which is `docs/OPEN-QUESTIONS.md` C13 — still unanswered, and contested by `docs/renat-feedback-2.md:227-237` (see §5). Plus the four sandbox assumptions in `docs/payments.md:116-136` are unverified. And the silent degrade means a single missing env var turns into "anyone can mark orders paid" rather than a visible outage — `getProvider()` should throw in production, not fall back. |
| 2 | **`/api/assistant/` trusts `mode:"admin"` from the request body — no session check.** And `debug:"mini"` replaces the system prompt with a two-line generic one. The `Origin` check is skipped entirely when no `Origin` header is sent. | `src/app/api/assistant/route.ts:192` (`isAdmin`), `:208` (`debug`), `:169-183` (`if (origin) {…}`) | A `curl` with no `Origin` and `{"debug":"mini"}` turns the endpoint into a free general-purpose LLM proxy on the owner's OpenAI key. `mode:"admin"` additionally injects the **whole** catalogue into every prompt (~220 rows), multiplying the cost per abusive request. Rate limit is 10/min/IP in a per-instance `Map` (`route.ts:31-40`) — it resets on cold start and does not span Vercel instances. |
| 3 | **Half the mail system is unreachable, and replies to it bounce.** Sending itself works (`RESEND_API_KEY` ✅, e2e confirmation sent 03.09). But: `abandoned-cart`, `back-in-stock` and `birthday` have **no caller anywhere** — no scheduler, no carts table, no subscriber storage; the pending-payment letter can never fire because `orders.ts:683` calls `hook(order)` with one argument so `sendPending` is never passed; and `MAIL_REPLY_TO` is still unset while `@rempireshop.com` has no inbound mail, so a customer replying to an order confirmation gets a bounce. | `src/emails/*` (six templates, all trilingual) vs `src/lib/mail-hooks.ts` (three hooks); `src/lib/orders.ts:683`; `docs/mail.md:76-79`, `:191-193`; `docs/accounts.md` ("set `MAIL_REPLY_TO` before launch") | Cloudflare Email Routing was set up 03.09 for `info@`/`shop@`, but the nameservers are **not switched yet** — so replies bounce today. Three of six templates being dead also means the flow switches in §2.2 are decorative. |
| 4 | **Gift-card recipient details are silently dropped between cart and server.** `addGiftToCart` stores `meta:{name,email,message}` on the cart line; `orderPayload()` maps only `{id, variant, qty}`. The server has a `giftMeta()` reader waiting for it. | `addGiftToCart()` in `public/shop2/app.js` (build) vs `orderPayload()` in the same file (drop); `src/lib/orders.ts` `priceItems()` gift branch + `giftMeta()` (server side ready) | The card is always e-mailed to the **buyer** (`pick(card.recipient?.email, buyerEmail)`, `src/lib/mail-hooks.ts:198`) and the personal message is lost. The whole "подарите сразу получателю" promise on `/shop2/gift/` is dead. One-line fix. |
| 5 | **The promo code is client-side only.** `S.promo === "REMPIRE10"` grants a flat 10 %, computed in the browser. | `public/shop2/app.js` — the `applypromo` handler and `discount()` | The 10 % is shown in the summary but `discountCode` is only *passed* to `/api/orders`; there is no promo table and no admin promo editor. Two shoppers see two different totals depending on which number the server ends up trusting. Also: any shopper can read the code out of `app.js`. |
| 6 | **Demo reviews render on live product pages.** Deterministic fake reviews from `reviews-pool.js` show under ~2/3 of products with a small "Демо-отзывы" note. | `public/shop2/app.js` — `reviewsFor()`, `reviewsHTML()`; acknowledged in `docs/features.md:169-175` | Fabricated consumer reviews on a live shop are an EU Omnibus / consumer-protection problem, not a cosmetic one. The note does not fix it. Must be off before the domain switch. |
| 7 | **~340 Russian interface strings have no ET/EN translation** — see §4. Whole surfaces (checkout field errors, PDP fallback texts, search empty state, account screen, the entire admin) stay Russian on `/et/` and `/en/`. | the `UI = { ET: {...}, EN: {...} }` block in `public/shop2/app.js` | The three-language promise is the product's headline (`docs/assistant-spec.md:28`, `docs/RENAT-ANSWERS.md`). An Estonian shopper hits Russian at the exact moment they enter their address. |
| 8 | **The account / login screen is a pure mock that lies to the customer.** "Получить код" sets `S.loggedIn = true` on click — no e-mail, no code, no `customers` table. The "logged-in" screen then shows a hard-coded order `#1042` and a hard-coded promo `REMPIRE10`. | `screenAccount()` in `public/shop2/app.js`; the `data-login` branch of the delegated click handler | It is one of the five header icons, so every QA pass and every curious customer hits it in the first minute. Either wire a real passwordless login or remove the screen — shipping it as-is is worse than not having an account at all. |
| 9 | **Prototype scaffolding is still shipped into the shop page**: `feedback.js` (the 💬 comment FAB that POSTs to `/api/feedback/`) is loaded from `public/shop2/index.html`, and `vercel.json` sets `X-Robots-Tag: noindex, nofollow, noarchive` on `/(.*)`. | `public/shop2/index.html` (last `<script>`), `vercel.json:6` | Customers would see an internal feedback widget; and the global noindex header silently outranks every piece of SEO work if it survives the switch. `docs/seo.md:202-232` lists the switch steps — this is the one that fails loudest. |
| 10 | **The admin's "Настройки → Доставка" block quotes a different price table from the one checkout charges.** The panel prints `SHIP.EE` (carrier list prices: DPD parcel 4,50 €, Omniva 5,50 €, courier 9 €); checkout bills `SHIP_RULES` (`parcel EE 3,49`, `courier EE 5,99`) mirrored from `settings.shipping_rules`. | `SHIP` vs `SHIP_RULES` in `public/shop2/app.js`, rendered by `setupBlock("Доставка", …)` in `screenAdmin()`; server side `src/lib/shipping.ts:66-73` | The owner reads one number and the shop charges another. Compounded by #11. |
| 11 | **Shipping defaults are below cost outside Estonia and there is no admin editor for them.** `settings.shipping_rules` is seeded by migration 030 and read by `src/lib/shipping.ts:193` — nothing in the panel writes it. | `src/lib/shipping.ts:66-73`; acknowledged in `docs/shipping.md:49-58` ("ниже себестоимости") | LV/LT parcel bills 4,99 € against a 10,60–11,80 € list rate. Every Baltic order loses money and only a developer can change it. |
| 12 | **`settings.flows` is written but never read.** Toggling «Брошенная корзина» / «День рождения» / «Снова в наличии» persists a row nothing consumes, and the three templates have no scheduler and no subscriber storage. The PDP "оставьте почту" button is a toast with no request behind it. | `srvPush()` in `public/shop2/app.js` → `/api/admin/settings`; no reader for `flows` anywhere in `src/`; the `data-notify` branch of the click handler is a toast only; confirmed in `docs/mail.md:191-193` | Three of six e-mail templates are unreachable. The owner is given switches that do nothing. |
| 13 | **Two company identities and two registration numbers are live on the site.** Footer and admin print `Rempire Store OÜ · рег. 12216136 · KMKR EE102723858`; the legal pages still trade as `REMPIRE (THEFLOW OÜ) … registrikood 16320586`. Contact details are hard-coded in ~8 places. | `public/shop2/app.js` — `footer()` «Реквизиты», the checkout `.cotrust` list, and the Настройки «Реквизиты» block; `docs/proofread-report.md:329-333`; `docs/accounts.md:16` (domain registrant still THEFLOW OÜ) | Wrong legal identity on a selling site. Also `src/lib/notify.ts:54-55` still has `dim.novare@gmail.com` as the production fallback recipient. |
| 14 | **English legal pages and 115 English descriptions are broken text.** 77 clause numbers glued to the following word (`1.1Seller`), "at the Web Web store"; 115 of 220 EN descriptions carry `<meta>` word-splits. `LEGAL` (the EN fallback) also carries Russian titles over English bodies. | `public/shop/legal.js` (`{"shipping":{"title":"Доставка и оплата","html":"…<h1>Shipping policy</h1>"}}`); `docs/proofread-report.md:281-325` | `legalFor()` serves `LEGAL` for EN, so the English policy page shows a Russian heading over mangled English. |
| 15 | **Legal / info pages, `/sets/` and `/gift/` are not prerendered and not in the sitemap**; 125 of 220 products have no OG card. | `public/sitemap.xml` (765 URLs: products/categories/brands ×3 only); `next.config.ts` `prerenderedRewrites()` covers `p`/`c`/`b` only; `docs/seo.md:234-246` | The pages a shopper checks before paying (Доставка, Возврат, Условия) are invisible to Google and have no link preview. |

**Runner-up (not in the 15, but fix in the same pass):**

- **A payment amount mismatch is accepted, not rejected.** `src/lib/payments/apply.ts:99-111` marks the order paid and only sets `amountMismatch` + a `console.error`.
- **Number formatting is mostly fixed but leaks in two ways.** `eur()` and `num1()` in `public/shop2/app.js` are now language-aware — the `docs/proofread-report.md:250-279` finding has been addressed. What is left: ~10 places bypass `eur()` by concatenating `THRESH.x + " €"` directly (`grep 'THRESH\.[A-Z]* + " €"'` — the announce bar, the footer, both PDP shipping lines, the checkout free-shipping hint, the admin Настройки block and `freebarText()`), so English still reads "from 59 €" rather than "€59"; and two post-render `textContent` writes put Russian back after `translateTree()` has run (`grep '" из 5"'`).
- Social links disagree with the Organization JSON-LD: `footer()` in `app.js` → `instagram.com/rempire.shop/`, `facebook.com/Rempire.Official.Tallinn` vs `tools/prerender-shop2.mjs:391` → `instagram.com/rempireshop/`, `facebook.com/rempireshop/`.
- The footer contact is `rempireshopinfo@gmail.com` (`footer()`) while the admin's "Подключения" row promises `info@rempireshop.com` (the `apps` tab of `screenAdmin()`).
- `POST /api/admin/logout` requires no auth; there is no session revocation (30-day token, only kill switch is rotating `SESSION_SECRET`); `/api/admin/mail/preview` is deliberately unauthenticated.
- `src/lib/notify.ts:54-55` still has `dim.novare@gmail.com` as the production fallback recipient.
- There is **no VAT step anywhere** in the pricing chain (`docs/OPEN-QUESTIONS.md` B8 still open).

---

## 1. Feature completeness

Status key: **works** = end-to-end against the real API · **partial** = real but with a
named hole · **stub** = UI exists, nothing behind it · **demo** = deliberately fabricated
data.

### 1.1 Browsing and discovery

| Feature | Status | Evidence | Missing |
|---|---|---|---|
| Catalogue (220 products, 8 categories) | **works** | `public/shop/catalogue2.js` → `CATALOGUE`; `screenCatalog()` in `app.js` | Catalogue is a committed JS file, not a table. No product can be added, renamed or removed without a rebuild. |
| Infinite scroll / "показать ещё" | **works** | `patchCatalog()` in `app.js`, `observeSentinel()` in `app.js` | Prefix-matching append is careful and correct. |
| Filters (brand, stock, price, subcategory) | **works** | `filtered()` in `app.js`, `filterDrawer()` in `app.js`, `SUBCATS` in `app.js` | Subcategories are a hard-coded map keyed by name regex; only the per-product override is editable. |
| Sort (хиты / новинки / цена) | **works** | `screenCatalog()` in `app.js` | "Хиты продаж" is catalogue order, not sales data. |
| Search | **partial** | `searchResults()` in `app.js`, `screenSearch()` in `app.js` | Naive `stem()` + substring over brand+name only — descriptions are not searched. No typo tolerance, no synonyms. Empty state is Russian-only. |
| Brands page + per-brand pages | **works** | `screenBrands()` in `app.js`, `goBrand()` in `app.js`, 26 prerendered dirs ×3 langs | — |
| Product page | **works** | `screenProduct()` in `app.js` | Fallback "Применение"/"Состав (INCI)" copy says "Полный состав будет заполнен при переносе каталога" — that placeholder is still live. |
| Variants / size picker / colour+size split | **works** | `variantPicker()` in `app.js`, `splitVariants()` in `app.js`, `variantIndex()` in `app.js` | — |
| Photo per volume (`varImg`) | **works** | `applyDemoOverrides()` in `app.js`, editor `goodsEditor()` in `app.js` | Editable in admin and persisted to `product_overrides.var_img`. |
| "С этим покупают" | **works** | `complementsFor()` in `app.js`, `TYPE_MATES` in `app.js` | Heuristic, not sales-derived. Fine for launch. |
| Home hero / banner carousel | **works** | `heroHTML()` in `app.js`, `heroConf()` in `app.js` | Editable in admin + by the assistant, persisted to `settings.hero`. Best-finished admin feature in the build. |

### 1.2 Sets, gift card, reviews, video

| Feature | Status | Evidence | Missing |
|---|---|---|---|
| Наборы (bundles) | **works** | `allBundles()` in `app.js`, `screenBundle()` in `app.js`, `addBundleToCart()` in `app.js`, server pricing `src/lib/orders.ts:433-464`, data `src/data/bundles.json` (31 bundles) | Discount is a build-time constant (−12 %, `tools/bundles.config.mjs`); the admin can only show/hide the whole feature. The panel itself says "пока не согласовано с владельцем" — i.e. shipping an unapproved feature. |
| Подарочная карта — purchase | **partial** | `screenGift()` and `addGiftToCart()` in `public/shop2/app.js`; server `src/lib/orders.ts` — `priceItems()` gift branch, `giftTitle()`, and the `giftOnly` free-shipping check | **Recipient meta is dropped** — see top-15 #4. `docs/features.md:332` claims `gift:` is not priced yet; that is stale, it is implemented. |
| Подарочная карта — redeem | **works** | `applyGiftCode()` in `app.js`, `POST /api/giftcards/check/`, `src/lib/giftcards.ts` (`redeemGiftCard` uses a conditional `UPDATE … where balance >= $2`, so no double-spend), tables `db/migrations/020_gift_cards.sql` | Amounts fixed at `[25,50,100]` in two places (`GIFT_AMOUNTS` in `app.js`, `src/lib/giftcards.ts:24`) — not editable. |
| Отзывы — customer submit | **works** | `reviewFormHTML()` in `app.js`, `sendReview()` in `app.js`, `POST /api/reviews/`, `src/lib/reviews.ts` (honeypot, link/profanity filters, 20–1500 chars, 3/hour/IP, salted IP hash), `db/migrations/021_reviews.sql` | Nothing prompts a customer to leave one — the "оцените заказ" letter promised in `reviewsHTML()` does not exist as a template. |
| Отзывы — moderation | **works** | `admReviewsHTML()` in `app.js`, `moderateReview()` in `app.js`, `GET/PATCH /api/admin/reviews/` | — |
| Отзывы — demo pool | **demo** | `reviewsFor()` in `app.js`, `reviews-pool.js` | Top-15 #6. Trilingual pool exists (`REVIEWS_POOL[lang]`), so the fake data *is* localised — one of the few things that is. |
| Видео на товаре | **works** | `videoOf()` in `app.js`, `videoHTML()` in `app.js`, the «Видео» field of `goodsEditor()`, persisted via `pushOverride()` → `product_overrides.video_url` | `youtube-nocookie.com`, click-to-load. Nothing set in the catalogue yet. |

### 1.3 Cart, checkout, payment

| Feature | Status | Evidence | Missing |
|---|---|---|---|
| Cart drawer, three line kinds (product / bundle / gift) | **works** | `cartBody()` in `app.js`, `LINE_KIND` in `app.js`, `lineUnit()` in `app.js` | — |
| Free-shipping progress bar | **works** | `upsellHTML()` in `app.js`, `freebarText()` in `app.js` | Quotes `THRESH`, which is refreshed from the server rules (`refreshShipThresholds()` in `app.js`). Correct — but the *number* is the disputed 59 € (docs say 50 €). |
| Checkout — 3 steps, field validation, error routing | **works** | `screenCheckout()` in `app.js`, `payNow()` in `app.js`, `failStep()` in `app.js` | All validation messages Russian-only (§4). |
| Delivery: parcel / courier / pickup, per country | **works** | `deliveryPicker()` in `app.js`, `SHIP_RULES` in `app.js`, server `src/lib/shipping.ts` | Pickup shipped despite `docs/OPEN-QUESTIONS.md` A5 never being answered and the internal decision being "build it and default it **off**". |
| Parcel-machine picker with search | **partial** | `pointSheet()` in `app.js`, `loadPoints()` in `app.js`, `GET /api/shipping/points/`, `src/lib/parcel-points.ts` | Omniva EE/LV/LT live; SmartPosti EE from a seed file; **DPD empty** (needs `DPD_API_USER`/`DPD_API_PASS`); **Finland has zero points**. Documented at `docs/shipping.md:84-116`. |
| Order creation, server re-pricing | **works** | `POST /api/orders/` `src/app/api/orders/route.ts:15`, `src/lib/orders.ts` | Browser prices never trusted. 10/min/IP. Good. |
| Payment redirect | **works (sandbox)** | `POST /api/payments/create/`, `src/lib/payments/montonio.ts` (real, HS256, `exp` 600 s, store-key check at `:264`); `PAYMENT_PROVIDER=montonio`, `MONTONIO_ENV=sandbox` | Montonio code is genuinely good and an e2e order went through on 03.09. Still sandbox — see top-15 #1. MakeCommerce is a stub that throws `not_implemented` (`makecommerce.ts:34,38,42`), and which provider Rempire actually signs with is still undecided across four docs (§5). |
| Webhook / return handling, idempotency | **works** | `src/lib/payments/apply.ts` (paid is a floor `:113-118`; late "failed" recorded, not applied), `payments/notify`, `payments/return` | **Amount mismatch is accepted**, not rejected — `apply.ts:99-111` marks paid and only logs `amountMismatch`. |
| Bank pre-selection (`preferredProvider`) | **partial** | `BANK_CODES` in `app.js` | Codes are an assumption; `docs/payments.md:116-136` lists four things still to verify in sandbox. Harmless if wrong. |
| Receipt / done screen | **works** | `doneState()` in `app.js`, `screenDone()` in `app.js` | Reads `?n=&s=` from the bank redirect. Correct. |
| Invoice PDF | **missing** | — | Promised in `docs/FOR-RENAT-2026-08-23.md:39,55`. No generator, no template. |

### 1.4 Account, e-mail, chat, SEO, feed

| Feature | Status | Evidence | Missing |
|---|---|---|---|
| Account / login code | **stub** | `screenAccount()` in `public/shop2/app.js`; the `data-login` branch sets `S.loggedIn = true` | Top-15 #8. No e-mail is sent, no code is checked, no `customers` table exists. "Мои заказы" is a hard-coded `#1042`, "Мои промокоды" a hard-coded `REMPIRE10`. Pure mock-up. |
| Order-confirmed e-mail | **works** | `src/emails/order-confirmed.ts`, hook `onOrderPaid` ← `src/lib/payments/mail-hook.ts:18` | Wired, trilingual, and confirmed sending (e2e 03.09). Reply-to still bounces — top-15 #3. |
| Order-shipped e-mail | **works** | `src/emails/order-shipped.ts`, hook ← `src/app/api/admin/shipments/route.ts:115` | Fires on the status change. Five carrier tracking URLs hard-coded at `order-shipped.ts:83-103`. |
| Gift-card e-mail | **partial** | `src/emails/gift-card.ts`, `sendGiftCards()` `src/lib/mail-hooks.ts:188` | Sends, but always to the buyer — top-15 #4. |
| Abandoned-cart / birthday / back-in-stock | **stub** | `src/emails/abandoned-cart.ts`, `birthday.ts`, `back-in-stock.ts` | **No caller anywhere.** No carts table, no birthday column, no subscriber storage, no cron (`vercel.json` has headers only). |
| Pending-payment e-mail | **partial** | `onOrderCreated` ← `src/lib/orders.ts:682` | Gated on `MAIL_PENDING_PAYMENT`; `orders.ts:683` calls `hook(order)` with one argument, so `sendPending` is never passed — it can never fire as written. |
| Shop chatbot | **partial** | `public/shop2/chat.js` | Rule-based fallback is decent; AI path needs `OPENAI_API_KEY`. See §3. |
| Language switch + prefixed URLs | **works** | `LANG_OF_SEG`/`SEG_OF_LANG` in `app.js`, `routeFromPath()` in `app.js`, `pathFor()` in `app.js` | RU unprefixed, `/et/`, `/en/`; `/shop2/ru/*` 301s to the bare path (`next.config.ts`). Solid. The **content** behind the switch is the problem (§4). |
| SEO prerender | **works** | `tools/prerender-shop2.mjs`, `next.config.ts` `prerenderedRewrites()`, 765 sitemap URLs, hreflang cluster, Product JSON-LD, runtime `setHead()` in `app.js` | Covers `p`/`c`/`b`/home ×3 languages. Missing: info pages, `/sets/`, `/gift/`, brands index; 125 products with no OG card. Sitemap is built for `rempireshop.com` while the site lives on `rempireshop.diipsolutions.eu`. |
| Legal / info pages | **partial** | `screenInfo()` in `app.js`, `legalFor()` in `app.js`, `LEGAL`/`LEGAL_RU`/`LEGAL_ET` | Shell-only (no prerender, no sitemap). EN falls back to `LEGAL`, which mixes Russian titles with mangled English bodies. Awaiting the lawyer pass (`docs/OPEN-QUESTIONS.md` B9, still open). |
| Google merchant feed | **partial** | `tools/build-merchant-feed.mjs` → `public/feed/google-shopping.xml` (308 KB) | Static snapshot; must be regenerated by hand after every catalogue change (`docs/merchant-feed.md:70-71`). `docs/merchant-feed.md:63-66` tells you to submit the **staging** URL, which is force-noindexed by `vercel.json` — Merchant Center will reject the landing pages. |
| Redirect map from the old shop | **missing** | `docs/redirect-map.csv` (1638 rows) | The CSV exists; nothing implements it. `docs/seo.md:231-232`: "separate work". |

---

## 2. Admin coverage

The admin is a screen inside the storefront SPA (`screenAdmin()` in `app.js`), not a
separate app. Nine tabs: Обзор, Заказы, Товары, Клиенты, Отзывы, Аналитика, Письма,
Подключения, Настройки. It self-labels as a demo (the `.adm__note` line at the top of `screenAdmin()`).

Persistence has exactly one bridge to the server: `srvPush()` in `app.js`, which
only fires when `SRV.admin === true`. Signed out, everything lands in `localStorage`
under `rempire-admin-demo` and is **overwritten** by `adoptServer()` the
next time the server answers.

### 2.1 Editable and persisted to Postgres

| Thing | Where in the UI | Storage | Notes |
|---|---|---|---|
| Price | Товары → товар → «Цена, €» (`goodsEditor()` in `app.js`) | `product_overrides.price` via `PUT /api/admin/overrides` | Range 1–500 client-side, 0–100000 server-side. |
| Stock | Товары → «Наличие» in `goodsEditor()` | `product_overrides.stock` | Enum `in`/`low`/`out` only — **no quantity, no decrement**. `docs/FOR-RENAT-2026-08-23.md:45-46` promises automatic stock decrement; it does not exist. |
| SEO title / description | Товары → «SEO для Google» in `goodsEditor()` | `product_overrides.seo_title` / `seo_desc` | Plus the "Сгенерировать с ИИ" button (`data-admseogen`). |
| Subcategory | Товары → «Подкатегория» in `goodsEditor()` | `product_overrides.subcat` | Options come from the hard-coded `SUBCATS` map in `app.js`. |
| Photo per volume | Товары → «Фото по объёмам» in `goodsEditor()` | `product_overrides.var_img` | — |
| Video link | Товары → «Видео» in `goodsEditor()` | `product_overrides.video_url` via `pushOverride()` | — |
| Hero banner (≤5 slides, 3 languages, link target, image, interval, on/off, reorder) | Настройки → «Главный баннер» (`admHeroCard()` in `app.js`) | `settings.hero` via `PUT /api/admin/settings` | The most complete editor in the panel. Preview → confirm → journal → undo. |
| Shop chat on/off | Настройки → «ИИ-чат для покупателей» (`data-admchatbot`) | `settings.chatbot` | Read by `chatAllowed()` in `chat.js` from localStorage, mirrored via `/api/overrides`. |
| Sets shown/hidden | Настройки → «Наборы на сайте» (`data-admbundles`) | `settings.bundles` | — |
| Order status (paid / shipped / cancelled / refunded) | Заказы → заказ → кнопки (`orderDetailSrv()`, the `data-admstatus` buttons) | `orders.status` + `admin_audit` via `PATCH /api/admin/orders/[id]` | Real, and it triggers the shipped e-mail. |
| Order note | Заказы → «Заметка» (`data-admnote` / `data-admnotesave`) | `orders.notes` | — |
| Create shipment + label PDF | Заказы → «Создать отправление» (`srvShipmentBlock()` in `app.js`) | `orders.shipping.montonio`, `POST /api/admin/shipments` | Requires Montonio Shipping keys; refuses unpaid orders. |
| Review moderation | Отзывы → Опубликовать / Отклонить (`moderateReview()` in `app.js`) | `reviews.status` via `PATCH /api/admin/reviews` | — |

### 2.2 Persisted server-side but read by nothing

| Thing | Where | Storage | Problem |
|---|---|---|---|
| E-mail flow switches (брошенная корзина / день рождения / снова в наличии) | Письма → «Включить»/«Выключить» (the `data-admflow` rows in `screenAdmin()`; written by `srvPush()`) | `settings.flows` | Nothing in `src/` reads `flows`. No scheduler, no subscriber storage. The switch is decorative. |

### 2.3 localStorage-only (lost on another browser, overwritten by the server)

| Thing | Where |
|---|---|
| The whole change journal / undo log (`DEMO.log`, 40 entries) | Настройки → «Журнал изменений» — the `DEMO.log` rows in `screenAdmin()` |
| Every override made while **signed out** | any editor — `srvPush()` no-ops without `SRV.admin === true` |

Note: `admin_audit` on the server records order status/note/shipment changes, but **not**
price/stock/SEO overrides — those go through `PUT /api/admin/overrides`, which writes the
row but not an audit entry. So the panel's own journal and the server's audit log cover
different things and neither is complete.

### 2.4 Not editable at all — hard-coded

| Thing an owner will want to change | Where it is frozen |
|---|---|
| Product name, brand, description | `public/shop/catalogue2.js` (`CATALOGUE`), `public/shop/content*.js`. The description `<textarea>` at the bottom of `goodsEditor()` is **not wired to anything** — typing in it and pressing Сохранить does nothing. |
| Adding / deleting a product | nowhere. No upload path, no `products` table. The assistant *promises* it (`adminAnswer()` in `app.js`, and `adminPrompt()` in `src/app/api/assistant/route.ts`). |
| Photos (upload, reorder, crop) | nowhere. Only "which existing gallery photo maps to which volume". |
| Categories, category names, category intros | `CAT_NAMES` in `catalogue2.js`; `CAT_INTROS` in `app.js`; `SUBCATS` in `app.js` |
| Brands, brand logos | derived from `CATALOGUE`; `BRAND_LOGOS` in `app.js` |
| Set contents, set discount | `tools/bundles.config.mjs` + `npm run build:bundles` |
| Promo codes | the `applypromo` branch in `app.js` — `REMPIRE10`, 10 %, client-side |
| Shipping prices and free-shipping thresholds | `src/lib/shipping.ts:66-73` (server default), `src/lib/orders.ts:183` (a second copy), `SHIP` + `SHIP_RULES` + `THRESH` in `public/shop2/app.js` (a third and fourth copy). Four places, no editor. |
| Payment settings (provider, methods, bank list) | `PAYS` in `app.js`, `BANKS` in `app.js`, `BANK_CODES` in `app.js`, `PAYMENT_PROVIDER` env |
| E-mail texts | `src/emails/*.ts` — hard-coded TS dictionaries. The admin can preview and test-send only (`mailCard()` in `app.js`). |
| Legal texts | `public/shop/legal*.js`, generated by `tools/build-content.mjs` |
| Contact details (phone, e-mail, address) | `footer()`, `screenSearch()` and the checkout `.cotrust` list in `public/shop2/app.js`; `src/emails/layout.ts:52-58`; `src/emails/common.ts:132,140,148`; `src/lib/mail.ts:17-18` |
| Company / legal details (OÜ name, reg. no, KMKR) | `footer()` «Реквизиты» and the Настройки «Реквизиты» block in `public/shop2/app.js`; `src/emails/layout.ts:52-58` |
| Opening hours | **do not exist anywhere on the site** |
| Social links | `footer()` in `app.js` and `tools/prerender-shop2.mjs:391` (JSON-LD `sameAs`) — and they disagree |
| Announcement bar text | `headerHTML()` in `public/shop2/app.js` (`.hdr__announce`) |
| Store-wide SEO texts (home title/description, category intros) | `tools/prerender-shop2.mjs` |
| Customers | no `customers` table. The Клиенты tab is `fakeCustomers()` derived from `fakeOrders()`. The «Промокод» button is `data-admedit` → toast "В демо правка не сохраняется". |
| Analytics | the `stats` tab of `screenAdmin()` is entirely literal numbers. |
| Languages | `LANGS` in `app.js`; Настройки shows a read-only list. |
| Gift-card amounts | `GIFT_AMOUNTS` in `app.js`, `src/lib/giftcards.ts:24` |
| VAT | **there is no VAT handling anywhere in `src/`.** No rate, no breakdown, no OSS. `docs/OPEN-QUESTIONS.md` B8 is still open. |

Every row in Настройки rendered by `setupBlock()` carries an «Изменить»
link that is `data-admedit` → the same toast. Доставка, Оплата, Языки, Письма and
Реквизиты all look editable and are not.

### 2.5 Admin auth

Single owner password: `ADMIN_PASSWORD_HASH` (`scrypt$N$r$p$salt$key`,
`src/lib/auth.ts:124-146`), stateless HMAC session cookie `rmp_admin`, 30 days,
`HttpOnly; SameSite=Lax`, `Secure` off localhost. `verifyPassword` and
`verifySessionToken` both use `timingSafeEqual`. Good crypto.

Weaknesses: no revocation (`POST /api/admin/logout` clears the cookie and requires no
auth — `logout/route.ts:8`); a leaked token is valid for 30 days and rotating
`SESSION_SECRET` is the only kill switch; login rate limit is 5/min/IP in a per-instance
`Map` (`auth.ts:161`); `GET /api/admin/me` reveals `configured` before auth;
`/api/admin/mail/preview` is deliberately unauthenticated (comment at
`admin/mail/preview/route.ts:10-13`).

**There are no roles.** `docs/RENAT-ANSWERS.md:176` records "multi-user admin is v1 scope,
not later" with roles Владелец / Товары / Заказы / Тексты, and
`docs/FOR-RENAT-2026-08-23.md:73-75` promises "каждому своя роль". One password exists.

---

## 3. Assistant coverage

Two modes share one endpoint, `src/app/api/assistant/route.ts` (prompt version 11,
`gpt-4.1-mini`, `temperature 0.4`, `max_tokens 350`, `response_format: json_object`).

### 3.1 Admin actions that exist

Whitelisted in `sanitizeAction()` (`src/app/api/assistant/actions.ts:94-153`), applied
client-side after a preview card (`confirmCard()` in `app.js`) and an explicit
«Применить» (`data-admapply`):

| Action | Bounds enforced server-side |
|---|---|
| `set_price` | known id, number 1–500, rounded to cents |
| `set_stock` | known id, `in`/`low`/`out` |
| `set_seo` | known id, title ≤70, description ≤170, at least one non-empty |
| `toggle_flow` | `abandoned`/`birthday`/`backstock`, boolean |
| `toggle_chatbot` | boolean |
| `toggle_bundles` | boolean |
| `set_hero` | `sanitizeHero()` `actions.ts:66-93` — ≤5 slides, per-field length caps, `go` restricted to a closed vocabulary, `image` must be a known product id or an `https://` / `/shop/` URL, `interval` clamped 2000–30000. Objects are **rebuilt field by field**, not filtered — the right way. |

`briefHero()` (`actions.ts:150-164`) strips backticks and newlines from the owner's own
banner text before it re-enters the prompt. Good injection hygiene.

### 3.2 Admin capabilities with no assistant action

- `set_subcat`, `set_varimg`, `set_video` — all three exist in `demoApply()` in `app.js`
  and in the goods editor, but are **not** in `sanitizeAction()`.
  The assistant cannot propose them.
- Order status change, order note, create shipment, print label.
- Review moderation (approve / reject).
- Test-send an e-mail.
- Shipping rules / prices / free-shipping thresholds.
- Everything in §2.4 — which is most of what a shop owner actually asks for.

### 3.3 What the admin prompt promises that does not exist

`adminPrompt()` (`route.ts:125`) tells the model to describe as *standing abilities*:
"every uploaded photo gets background removal and the Rempire watermark; every text is
written SEO-optimised in Russian, Estonian and English". None of that is implemented —
there is no upload path at all. The offline fallback `adminAnswer()` in `app.js` says
the same thing in Russian. So the assistant will confidently accept "добавь новый товар —
вот фото" and nothing will happen.

`docs/assistant-spec.md:7` states the contract as "it must be able to change everything
the admin can change… products, prices, stock, orders, categories, banners, texts, legal
pages, shipping settings, discounts." Seven of those nine are outside the whitelist.
`docs/assistant-spec.md:3` still says "build starts when the real backend exists" — the
spec is stale relative to what shipped.

### 3.4 Shop-side (customer) bot

`public/shop2/chat.js`. Rule-based by default; switches to the model when
`GET /api/assistant/` reports `enabled`.

Handled intents:

| Intent | Path |
|---|---|
| Recommend / find | `match()` `chat.js:86` — category keywords, product-type keywords, "до N €" budget, free-text token scoring; AI path returns `product_ids` rendered as cards |
| Assemble a set | `match()` set branch `chat.js:93-103` (≤3 items within budget) |
| Gift suggestion | `chat.js:104-112` |
| Add to cart (≤5 ids) | `runAction()` `chat.js:228-236` → synthesises a `[data-add]` click so the shop's own handler runs |
| Open product / category | `chat.js:237-239` |
| Open cart / go to checkout | `chat.js:240-241` |

Cannot do: apply a promo or gift code, change quantity, remove a line, pick a delivery
method or parcel machine, answer "где мой заказ" (no order lookup), quote stock for a
specific size, hand off to a human. It also cannot see the current cart — the model is
never told what is in it.

Prompt guards (`shopPrompt()` `route.ts:88-114`): never recommend `stock: "out"`, never
invent products or prices, steer off-topic back, "no prices" in the reply text, answer in
the requested language. The catalogue slice is keyword-scored down to ~24–60 rows
(`relevantLines()` `route.ts:69-87`) — sensible for a mini model.

### 3.5 Abuse posture — weaknesses, ranked

1. **`isAdmin` comes from the request body** (`route.ts:192`). No cookie check, no
   `requireAdmin`. Anyone can request admin mode. Server-side *writes* are still gated by
   `rmp_admin` on `/api/admin/*`, so this is not a direct data-write hole — but it hands
   out the admin system prompt, the full 220-row catalogue, and the fabricated business
   figures on request, at maximum tokens per call.
2. **`debug: "mini"` bypasses both system prompts** (`route.ts:208`), replacing them
   with two generic lines. That is an unauthenticated general-purpose LLM proxy on the
   owner's OpenAI key. There is no reason for this to ship.
3. **The origin check is opt-in.** `if (origin) { … }` (`route.ts:169-183`) — a request
   with no `Origin` header (curl, any server-side client) skips it entirely.
4. **Rate limit is weak.** 10/min/IP in a module-level `Map` (`route.ts:31-40`): resets on
   cold start, independent per Vercel instance, and the map is never pruned (unbounded
   growth per warm instance). Same pattern in `auth.ts:161`, `ratelimit.ts:9`.
5. **No spend cap and no usage logging.** Nothing records how many calls were made or by
   whom; `console.error` on upstream failure is the only trace.
6. Minor, and handled correctly: replies are HTML-escaped on both sides (`esc()` in `chat.js`, and `askAdminAI()` in `app.js`); `heroArt()` escapes and `%27`-encodes the banner image URL
   before it enters a `style` attribute, and `heroGoAttr()` escapes its target. No injection found in the action-render path.

`docs/assistant-spec.md:39-43` requires "the assistant never touches: payment provider
settings, domain/DNS, legal page content" — all three are correctly outside the
whitelist. That part of the spec is honoured.

---

## 4. Trilingual gaps

The mechanism: Russian is the source; every template renders RU; when `S.lang` is ET or
EN, `translateTree()` in `app.js` walks the text nodes of four slots
(`hdrSlot`, `bodySlot`, `navSlot`, `ovl`) and rewrites each trimmed text node whose full
value is a key in `UI[lang]`, or which matches one of the `UI_RX` regex rules. Product
name tails get `trName()`. Attributes `placeholder`/`aria-label`/`title`/`label` are
translated too.

**Dictionary health is good; coverage is not.**

- `UI.ET` and `UI.EN` each hold **423 keys**, and the two sets are **identical** — no key
  is present in one language and missing from the other.
- No empty values, no value equal to its Russian key, no value still containing Cyrillic.
- 39 `UI_RX` rules, all with both `ET` and `EN` branches.
- The duplicate `"Новинки"` key reported in `docs/proofread-report.md` is still present.

Against that, **701 distinct Russian visible-text fragments** appear in `app.js` outside
the dictionary block, and **340 of them resolve to neither an exact key nor a regex rule
— identically for ET and EN.** (Method: extract every string literal containing Cyrillic
outside lines 66–700, split on HTML tags, test each fragment against the 423 keys and the
39 rules. Attribute-boundary artefacts inflate the raw count somewhat; the grouped list
below is the filtered, real set.)

### 4.1 Customer-facing, untranslated

| Area | Examples — grep the literal in `public/shop2/app.js` |
|---|---|
| **Checkout field errors** — the worst offender, they appear exactly when an Estonian shopper is typing their address | «Впишите имя и фамилию — их напечатают на посылке.», «Впишите улицу и дом.», «Впишите индекс.», «Впишите город.», «Впишите телефон…», «Проверьте номер — похоже, в нём не хватает цифр.» |
| **Checkout step failures** | «Проверьте e-mail — на него придёт подтверждение заказа», «Заполните данные доставки», «Укажите фирму и регистрационный номер» |
| **Checkout misc** | «Название фирмы и рег. номер», «REMPIRE10 — скидка 10%», «Тариф курьера DPD в Финляндию — предварительный…», «Точная цена по Европе зависит от страны — 26–56 € по прайсу DPD.» |
| **E-mail validation** | «Введите e-mail — на него придёт подтверждение заказа.», «В адресе не хватает знака @.» |
| **PDP fallback copy** | «Применение», «Состав (INCI)», «Полный состав будет заполнен при переносе каталога.», «Размеры и уход», «Стирать при 30° наизнанку…», «Фирменная футболка Rempire…», «Профессиональное средство из салонного ассортимента…» |
| **PDP controls** | «Размер — » / «Объём — » (the rendered node is «Объём — 150 мл», and there is no `UI_RX` rule for it), «Товара сейчас нет. Оставьте почту — напишем, когда появится.» |
| **Colour names** | белый / жёлтый / чёрный / розовый / серый / красный / синий / зелёный (`COLOUR_RU`) — these render inside the variant picker |
| **Search** | «Популярные запросы:» and its chips (шампунь, борода, парфюм, футболка), «Проверьте написание или посмотрите категории:», «Напишите нам — поможем подобрать замену:» |
| **Account screen (whole)** | «Вход без пароля — пришлём код на почту…», «Доставка по умолчанию», «Подставим это при следующем заказе…», «Пакомат по умолчанию — », «−10% ко дню рождения · до 30.09», «активен» |
| **Brands page** | «Марки, с которыми работает салон Rempire…» |
| **Country / carrier labels** | «Другая страна Европы», «Курьер DPD по Европе» |
| **Splash** | «Пропустить заставку» |

Two things my first pass flagged are in fact covered and should not be chased:
«Цвет принта — » is a dictionary key, and «Отзывы пока недоступны — база подключается.
Как только она заработает, новые отзывы появятся здесь сами.» is one long key — the
extractor had cut both at a string-literal boundary.

### 4.2 `chat.js` — outside the dictionary entirely

`translateTree()` only walks `hdrSlot`, `bodySlot`, `navSlot` and `ovl`. `chat.js`
appends its root straight to `document.body`, so **nothing in the chat widget is ever
touched by the dictionary.** It carries its own `T = {RU, ET, EN}` table
(`chat.js:30-64`), which covers title/hint/hello/chips/buttons/placeholder — but these
are hard-coded Russian and stay Russian in all three languages:

- `aria-label="Чат с помощником"` on the FAB and on the panel (`.sbot__fab`, `.sbot__panel`)
- `aria-label="Закрыть"` on the close button (`.sbot__x`)
- `aria-label="Отправить"` on the send button (`.sbot__send`)
- the price prefix `"от "` in `productRow()`

### 4.3 Admin panel — Russian-only, but it has a language switcher

The admin header renders an RU/ET/EN switcher (`admHeader()`, and `screenAdmin()` repeats
it for the signed-in header — both build it from `LANGS`), and essentially none of the
panel is in the dictionary. Roughly 200 of the 340 missing fragments are admin strings — every tab
intro, every KPI label, the goods editor («Основное», «Цена, €», «Раздел»,
«Подкатегория», «Фото по объёмам», «SEO для Google», «Заголовок (до 60 знаков)»,
«Описание (до 155 знаков)», «Русский — эстонский и английский пишутся сами»), the
order detail («Собран», «Передан в доставку», «Доставлен», «Напечатать наклейку»,
«Письмо с трек-номером», «Вернуть деньги»), the whole Настройки tab, the assistant's
canned answers (`adminAnswer()` in `app.js`) and every action-log line (`actionText()`
`app.js`).

If Renat only ever works in Russian this is cosmetic — but the switcher promises
otherwise, and pressing ET today produces a half-Estonian screen.

### 4.4 Content and legal

- Product descriptions: `CONTENT` (EN, the source), `CONTENT_RU`, `CONTENT_ET` — all
  three present, all 220 products. **But** RU/ET are machine translations "pending a
  native proofread" (`content.ru.js` header), and 115 of 220 EN descriptions still carry
  `<meta>` word-splits (`docs/proofread-report.md:281-325`).
- Legal pages: `LEGAL_RU`, `LEGAL_ET` exist; **there is no `LEGAL_EN`** — English falls
  back to `LEGAL`, whose entries pair a Russian `title` with an English `html` body
  (`public/shop/legal.js`: `{"shipping":{"title":"Доставка и оплата","html":"…<h1>Shipping
  policy</h1>…"}}`). `public/shop2/index.html` loads `legal.ru.js` and `legal.et.js` but
  no EN file — because there isn't one.
- E-mail templates: genuinely trilingual, a `Record<Lang, Strings>` per file
  (`order-confirmed.ts:46`, `order-shipped.ts:37`, `abandoned-cart.ts:37`,
  `back-in-stock.ts:39`, `birthday.ts:71`, `gift-card.ts:54`), `normalizeLang` defaults to
  `ru`. This is the best-localised part of the system.
- `public/shop2/index.html` has no ET/EN `<title>`, meta description or OG tags
  (`docs/proofread-report.md:281-325`) — the ET/EN home pages are prerendered separately
  under `/et/` and `/en/`, so this affects the shell fallback only.

---

## 5. Doc-vs-code deltas worth acting on

Things the docs say that the code contradicts, or vice versa.

| Doc claim | Code |
|---|---|
| `docs/features.md:332-350` — «Строка `gift:<amount>` — ещё не оценивается», thrown as `unknown_item` | **Stale.** Implemented in `priceItems()` in `src/lib/orders.ts`, and gift-only orders correctly ship free via the `giftOnly` check. |
| `docs/assistant-spec.md:3` — "build starts when the real backend exists" | **Stale.** The assistant shipped (route, whitelist, tests). |
| `docs/FOR-RENAT-2026-08-23.md:22` — «бесплатная доставка от 50 €» | Built default is **59 €** (`src/lib/shipping.ts:66`), and `docs/OPEN-QUESTIONS.md` D16 (which threshold) is still officially open. |
| `docs/FOR-RENAT-2026-08-23.md:45-46` — «Остаток товара уменьшается автоматически» | Stock is a three-value enum with no quantity and no decrement (`db/migrations/001_core.sql`). |
| `docs/FOR-RENAT-2026-08-23.md:39,55` — automatic invoice PDF by e-mail | No generator, no template. |
| `docs/FOR-RENAT-2026-08-23.md:42-43` — one-button parcel label | Exists only for Montonio Shipping, which is unconfigured; DPD/Omniva/SmartPosti direct APIs need carrier contracts that have not been obtained (`docs/shipping.md:84-116`). |
| `docs/FOR-RENAT-2026-08-23.md:57-60` — birthday / abandoned-cart / review-request letters on a schedule | No scheduler, no subscriber storage, and no review-request template at all. |
| `docs/FOR-RENAT-2026-08-23.md:73-75` — per-person roles | One password, one cookie, no user table. |
| `docs/OPEN-QUESTIONS.md` A5 — pickup "not answered; we will build it and default it **off**" | Pickup is live and always free in EE (the `pickup` row of `SHIP.EE` and of `DELIVERY`; `docs/shipping.md:46-47`). |
| `docs/OPEN-QUESTIONS.md` A6 — reviews "not answered" | Built in full, plus demo reviews on live pages. |
| `docs/OPEN-QUESTIONS.md` B8 — VAT / OSS | No VAT step anywhere in the pricing chain. |
| `docs/merchant-feed.md:63-66` — submit the staging feed URL to Merchant Center | The staging domain is force-noindexed by `vercel.json` and `tools/prerender-shop2.mjs:42`; landing-page checks will fail. |
| `docs/payments.md:3` — Montonio | `docs/renat-feedback-2.md:227-237` rules Montonio out below ~20 orders/month and names MakeCommerce — which is a stub. `docs/accounts.md:27` still says "after pick". The provider decision is genuinely unmade. |
| `docs/accounts.md` env table — **this file was rewritten during the audit** | As of 03.09 everything is set: `DATABASE_URL` (Railway, migrations applied), `SESSION_SECRET`, `ADMIN_PASSWORD_HASH`, `PUBLIC_BASE_URL`, `PAYMENT_PROVIDER=montonio` (sandbox), `RESEND_API_KEY`, `OPENAI_API_KEY`. So the §1–§2 "works" rows really are running. What is *not* done: `MAIL_REPLY_TO`, the Cloudflare nameserver switch, Merchant Center, GA4, and Montonio live. |

---

## 6. Suggested QA sequencing

1. Close #2 and #9 first — they are security/abuse and scaffolding, not features, and #9
   is a two-line deletion. Add the production guard from #1 (make `getProvider()` throw
   rather than fall back to the mock) in the same pass.
2. The environment is already configured (`docs/accounts.md`, 03.09) — Postgres, admin
   login, Resend and Montonio sandbox all live, with an e2e order behind them. So QA can
   start against staging now; only the Montonio **live** switch and `MAIL_REPLY_TO` are
   outstanding on the config side.
3. Fix #4 (one line) and #5, then run a full checkout: product + bundle + gift card, each
   delivery method, each country, both a promo and a gift code.
4. Decide the shipping numbers (#10, #11) — they are a business decision, not a bug, and
   they block the announce bar, the footer, the PDP, the admin and the checkout at once.
   The provider decision (§5, four docs disagree) blocks #1 the same way.
5. Do the i18n pass (#7) as one batch: ~340 dictionary entries plus the `THRESH + " €"`
   concatenations and the two post-render `textContent` writes. Much cheaper in one
   sitting than screen by screen.
6. Decide #8 — wire a real passwordless login or delete the account screen.
7. Turn off the demo reviews (#6) and clear the demo copy out of the admin before anyone
   outside the team sees the panel.
