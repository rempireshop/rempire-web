# Storefront QA sweep — the shopper's side, RU / ET / EN

06–07.09.2026, branch `r-shopqa` off `1a63cf8`. Scope: everything a *customer*
touches under `/shop2/` — home, catalogue, product, cart, checkout, receipt,
account, sets, gift card, blog, the legal pages, search, the language switch
and the chat bubble. The admin panel, the scanner, «Склад», `payNow()` and the
company-invoice fields belong to other agents this week and were **tested and
reported, never edited**.

The client's read going in was that the customer area *"is already good"*.
That is broadly right and this sweep says so with evidence: the existing crawl
(≈90 screens × 3 languages) passes clean at 1280, 768 and 375 px, a fresh
360-px pass found no horizontal overflow anywhere, and a full text scan of
every ET and EN view found **zero** Cyrillic left in the interface. What it was
not right about is a short list of things that only show up when you drive the
screens rather than read them: a purchase counted three times, an account
quoting a delivery price the till does not charge, a keyboard shopper dropped
on `<body>` at every checkout step, and one page with no head of its own.
Twelve bugs are fixed here, each with a test that fails without the fix, plus one
dead-code sweep.

---

## 1. The map

### 1.1 Screens and the URLs that reach them

`routeFromPath()` (`public/shop2/app.js:20917`) turns a path into `S.screen`;
`pathFor()` turns state back into a path. Every route exists three times — no
prefix = Russian (and the `x-default`), `/shop2/et/…`, `/shop2/en/…`.

| Screen | URL | Drawn by |
|---|---|---|
| `home` | `/shop2/` | `screenHome()` |
| `catalog` | `/shop2/c/<cat>/` (8 categories incl. `all`), `/shop2/b/<brand-slug>/` (26 brands) | `screenCatalog()` |
| `product` | `/shop2/p/<id>/` | `screenProduct()` |
| `search` | `/shop2/search?q=…` | `screenSearch()` |
| `brands` | `/shop2/brands/` | `screenBrands()` |
| `bundles` / `bundle` | `/shop2/sets/`, `/shop2/set/<id>/` | `screenBundles()` / `screenBundle()` |
| `gift` | `/shop2/gift/` | `screenGift()` |
| `blog` / `blogpost` | `/shop2/blog/`, `/shop2/blog/<slug>/` | `screenBlog()` / `screenBlogPost()` |
| `info` | `/shop2/info/{shipping,returns,terms,privacy,contact}/` | `screenInfo()` → `screenDelivery()` / `screenContact()` |
| `account` | `/shop2/account/` | `screenAccount()` |
| `checkout` | `/shop2/checkout/` — **only with a non-empty cart** | `screenCheckout()` |
| `done` | `/shop2/done/?n=…&s=paid\|failed\|pending` — only with that query | `screenDone()` |

Two things that are *not* screens:

* **The cart** is a drawer (`S.cartOpen`) over whatever screen is open, never a
  route. `robots.txt` still disallows `/shop2/cart` — harmless, but it guards a
  page that does not exist.
* **Order tracking has no `/track` page.** «Отследить» in the account's order
  row is an `<a href>` straight to the carrier's own tracking URL
  (`app.js:8512`), and the «отправлен» e-mail carries the same link. There is
  nothing of ours to QA there beyond the link being present and `rel=noopener`,
  which it is.

There is **no 404 screen**: every unrecognised `/shop2/…` path falls through
`routeFromPath()`'s cascade to `S.screen = "home"`, served HTTP 200. See
Question 4.

### 1.2 How content reaches each screen

`tools/prerender-shop2.mjs` writes 810 static pages (3 languages × 270). The
rewrite order in `next.config.ts` is: prerendered file → Next's own dynamic
route → the shell (`/shop2/:path+ → /shop2/index.html`).

| Screen | Static page? | Request-time fallback |
|---|---|---|
| home, category, brand, product, the 5 info pages, sets, set, gift | yes, per language | product only: `src/app/shop2/{,et/,en}/p/[id]/route.ts` for owner-added custom products |
| blog listing + post | only when the build had a database | `src/app/shop2/…/blog[/[slug]]/route.ts` |
| **brands** | **never** — no `brandsPage()` in the prerender, no `brands` in `prerenderedRewrites()`, no `src/app/shop2/brands` | none: the shell |
| search, account, checkout, done | no, by design | none: the shell |

APIs the shopper's side calls: `/api/overrides/` and `/api/bundles/` at boot;
`/api/geo/` on first paint; `/api/track/` on view / search / product / add /
checkout / purchase; `/api/blog/…` on the blog; `/api/reviews/` on a product;
`/api/stock-alerts/` from «Сообщить о наличии»; `/api/shipping/points/`,
`/api/payments/methods/`, `/api/promos/check/`, `/api/giftcards/check/`,
`/api/carts/`, `/api/orders/`, `/api/payments/create/` in the checkout;
`/api/giftcards/<code>/pdf/` on the receipt; the five `/api/account/*` calls in
the account; `/api/assistant/` from the chat bubble.

### 1.3 SEO heads and sitemaps

`setHead()` (`app.js:17476`) rewrites `<title>`, the description, the
canonical, the four hreflang links, `og:*` and `<html lang>` on every
client-side render, and injects a `Product` JSON-LD on a product page only.
The static head (title, description, robots, canonical, hreflang×4, OG×8,
Twitter×3, Organization + WebSite JSON-LD) is written between the
`<!-- seo:start -->` markers by the prerender through `src/lib/seo-head.mjs`,
which the request-time routes import too, so static and dynamic pages share one
head format.

`robots.txt`, `sitemap.xml` and `sitemap-1.xml` (810 URLs) are all written by
the prerender; `sitemap-custom.xml` is a live route for products and posts
created since the last build. Checkout, cart, account, admin, scan, done and
search are guarded out of the sitemap by an explicit regex and disallowed in
`robots.production.txt`. `/shop2/brands/` is in neither — it is crawlable and
un-sitemapped (Question 3).

---

## 2. What was driven, and where

Everything below ran against a real server (`next dev`, in-memory PGlite, mock
payment and shipping providers) on this branch's own port.

| Area | Viewports | Languages | Evidence |
|---|---|---|---|
| Home, all 8 categories, all subcategories, all 26 brand pages, 25 seeded product pages (sizes, gallery, video, reviews, notify-me), sets, set, gift, blog, 5 info pages, search (empty / blank / hit / miss / huge / emoji / markup / RTL), cart drawer, checkout, account, unknown URLs | 1280, 768, 375 | RU, ET, EN | `e2e/sweep-storefront.spec.ts` — 60 tests, all green |
| Cart arithmetic, promo codes (garbage, case, whitespace, expired, below minimum), gift cards (garbage, real, over-value), 5 randomised product × delivery × contact × outcome orders, contact validation, the free-shipping threshold, a whole checkout at phone width | 1280 + 375 for the phone-layout case | RU, ET, EN | `e2e/sweep-checkout.spec.ts` — run together with the crawl across the three Chromium projects: 77 passed, 31 skipped |
| Home, product, catalogue, checkout, account, sets, gift card, blog, info pages, chat, SEO heads, PWA manifests, axe accessibility, security headers | 1280 desktop + 390 iPhone 13 on **WebKit** | RU, ET, EN | the named specs, all green |
| **360 px** — home, catalogue, brand, brands, product, sets, gift, blog, all 5 info pages, account, search | 360×640 | RU, ET, EN | no horizontal overflow on any of the 45 views (scratch pass, not kept as a spec: `sweep-storefront` already guards ≤480 px at 375) |
| The 12 bugs fixed here | 1280, 375, 390 WebKit | RU, ET, EN | `e2e/storefront-sweep-2.spec.ts` — 16 tests × 3 projects |

**Dumb-user paths walked by hand.** Empty and invalid e-mail, phone and name;
five wrong login codes in a row then the right one; removing the last cart
line; a deep link to `/shop2/checkout/` with an empty basket; a double tap on
«В корзину»; the quantity stepper past both ends; a promo code the shop does
not know; a gift-card-shaped code that is not a card; a mangled
percent-encoding in four different addresses; back and forward four steps each
way across home → category → product → checkout; a reload mid-checkout.

Every one of them behaves. Worth recording because they are the cases that
usually rot:

* removing the last line closes the drawer instead of leaving an empty one
  open, and clears the badge;
* `/shop2/checkout/` with an empty basket renders the home screen rather than a
  payment form (the URL stays put — Question 5);
* a double tap adds quantity 2 on one line, not two lines;
* «−» is disabled at 1 and removal is only ever through «Убрать»;
* after five wrong codes the right code is refused with «Слишком много попыток
  — запросите новый код» and «Назад» is offered, not a dead end;
* back/forward restores `home → catalog → product → checkout` in order and the
  cart survives every hop.

**Power-user paths.** Keyboard-only checkout (7 tabs from the top of the page
to the e-mail box — Question 6), Cyrillic / Latin / typo search, filter
combinations with brand + in-stock, shared deep links into every screen kind,
a signed-in shopper's profile landing after step 1 was already painted.

---

## 3. The language sweep

Two passes over every ET and EN view — the 18 static screens plus the product
page with its review form, the cart drawer, the filter drawer, all three
checkout steps, the parcel-point sheet, a rejected promo, and all three
receipt states.

**Pass 1 — Cyrillic outside content.** Every visible text node and every
`aria-label`, `placeholder`, `title` and `alt`, minus the containers that carry
Russian by design (product and brand names, catalogue descriptions, reviews,
blog bodies, cart-line names, the wordmark, and what the shopper typed).

> **Result: zero leaks in ET and zero in EN**, before and after the fixes
> below. The one that did exist — the `<meta name="description">` of
> `/shop2/brands/` — is fixed in `f8a3926`.

**Pass 2 — stray English on an Estonian view.** Collected the interface text of
every screen in ET and in EN and compared; anything byte-identical is a
candidate. The whole list, read by eye:

* `"Merch"`, `"Blog"`, `"Admin"` — deliberate. `app.js:950` carries the
  reasoning for «Blog» in Estonian in the owner's own words: *«Blog», not
  «Ajaveeb»*. Left alone; see Question 8 for the one loose end.
* `"75 ml"`, `"50 ml"`, `"30 g"`, `"white / S"`, `"S-M"` — sizes and variant
  codes.
* `"Rempire Store OÜ"`, `"12216136 · KMKR EE102723858"`, `"Mardi 1, 10145
  Tallinn"`, `"info@rempireshop.com"`, `"© 2026 Rempire Store OÜ"` — company
  details.
* `"Omniva · SmartPosti · DPD · Venipak · Unisend"`, `"Visa, Mastercard"`,
  `"Apple Pay / Google Pay"` — carrier and scheme names.
* `"E-mail"` on the account screen — the same word in all three languages,
  including Russian.

Nothing here is a dictionary leak. `node tools/i18n-gaps.mjs` prints **0
untranslated** and ET/EN key parity is exact after every change in this branch.

---

## 4. Bugs fixed

Twelve, across fourteen commits, plus the dead-code sweep. Every one has a test
that fails on the commit before it — verified by stashing the fix and re-running, not assumed.

**Carried over from the previous session, verified and committed here** (the
work existed uncommitted in the worktree; each piece was read, checked and
proven before it was committed):

| # | What a shopper saw | Commit |
|---|---|---|
| 1 | A share link a messenger mangled (`/shop2/search/?q=%E0`) threw `URIError` out of the router during boot: nothing painted, and the prerendered page stayed lying under the app for the rest of the session. | `6933a0c` |
| 2 | «+» in the cart drawer priced a set or a gift-card line through the first catalogue product — «×2 = 18 €» on a 34,90 € set — until the next full rebuild. | `9e5d795` |
| 3 | The filter drawer's «Показать N товаров» was repainted in Russian on an ET/EN catalogue the moment a checkbox was ticked. | `9e5d795` |
| 4 | The field notes drawn on blur skipped the dictionary, so a keyboard user tabbing through an Estonian checkout read Russian. | `9e5d795` |
| 5 | On the account screen the blur that removed the e-mail error moved «Получить код» 29 px out from under the finger, and the first tap did nothing. | `9e5d795` |
| 6 | A signed-in shopper's own address was not in the box on a cold checkout: «Далее» a moment too early said «Введите e-mail», a moment later went through on a box that looked empty. | `80fd305` |
| 7 | An all-gift-card order let «Далее — оплата» through without the recipient's address, then the pay button sent the shopper back a step. | `80fd305` |
| 8 | The chat bubble greeted a first visit to `/shop2/et/` in Russian and printed «9 €» on the English shop that says «€9». | `2ca2aef` |

Nothing was left half-written; the four generated files the e2e prebuild
touches (`public/shop2/index.html`, `src/data/content.default.json`,
`src/data/blog.prerendered.json`, `src/db/migrations.generated.ts`) were
restored and never committed.

**Found by this sweep:**

| # | What a shopper saw | Commit |
|---|---|---|
| 9 | **Every paid order was counted three times.** `doneState()` fires the `purchase` beacon and then caches itself in `S.done` — but only `finishDemo()` ever filled that cache, so on the one path the comment is about, a real return from the bank, the receipt recomputed on every render: the two boot answers (`/api/overrides/`, `/api/bundles/`) alone made it three. Measured, not inferred: 3 identical `{"type":"purchase","value":41.9}` beacons per receipt. | `ddde144` |
| 10 | **The account quoted delivery prices the till does not charge.** «Доставка по умолчанию» still read the frozen demo `SHIP` table: «Курьер до двери (DPD) 9 €» against the checkout's 10,84 €, «Пакомат Omniva 5,50 €» against 5,47 €. Now priced by `SHIP_RULES`, the same rules the server bills on — with the basket left out of it, because a standing preference is not a quote for today's cart. | `baba21e` |
| 11 | **«Бренды» carried a Russian description in every language.** It is the one shopper page with no prerendered head, so `/shop2/et/brands/` and `/shop2/en/brands/` are served the Russian shell and `setHead()` set only their title. Its own opening sentence is its description now — one string, already in the dictionary. | `f8a3926` |
| 12 | **A keyboard shopper was dropped on `<body>` at every checkout step.** The render that opens a step destroys the button that was pressed, and unlike every neighbouring control (`data-dm`, `data-carrier`, `data-paym`, `data-bank`, and `failStep()` itself) `data-step` never called `refocus()`. Three times per order, each time tabbing past the announce bar and the whole header again. Focus now lands on the heading of the step that opened. | `a668290` |
| 13 | **Dead hooks removed.** `data-repeat` (a «Повторить заказ» that was scaffolded and never built — translations and all), `data-dot` (the hero dots the staging review removed, handler and paint helper both still there), `data-method` (superseded by `data-dm` + `data-carrier`, with `S.method`/`S.machine`/`methodIdx()`/`method()` and a `[data-machine]` change branch behind it) and a `d.cardsize` click-swallower that was unreachable twice over. | `618ce03` |

**Test-side, same branch:**

* `693cb4f` — the ET blog listing's breadcrumb measurement was reading a
  detached node (`boundingBox()` → `null`) because two boot answers swap
  `<main>` within ~100 ms of the tiles. This is test flake, not a product bug:
  a repaint is not a defect. The measurement now reads the crumbs and the
  column edge in one layout pass in the page and retries until a render is not
  in flight, which also closes the quieter half of the race (a box from before
  the swap compared against an edge from after it).
* `c52ab54`, `6fd6766` — `e2e/storefront-sweep-2.spec.ts`, 16 tests.
* `097940d` — the checkout↔server parity unit test lifts `shipRulePrice()` too.
* `e5a57f8` — the sweep-2 spec now actually reaches `mobile-safari`, which its
  own skip rule already asked for. Its purchase-beacon test stands down on
  WebKit: an intercepted `sendBeacon` there has no body at all
  (`postData()` and `postDataBuffer()` both `null` — checked).

### Not a bug, checked and cleared

* **The gift tile's «25, 50 или 100 €».** Hard-coded on purpose, with the
  reasoning at `app.js` ~5784: the tile names the three the shop has always
  sold, the buttons on `/gift/` are the ones `settings.gift_amounts` decides.
  See Question 1 — it is a copy decision, not a defect.
* **75 € surviving in a cart after the owner hides it.** Also deliberate, and
  commented: validation is against `GIFT_AMOUNTS` (the four the *server*
  accepts) so a card already in a basket keeps its price. A shopper cannot
  newly add a hidden denomination — `data-addgift` only ever carries
  `giftAmountsOn()`.
* **Dead *controls*.** A cross-check the other way round — every `data-*`
  emitted in `app.js`, `chat.js` and `index.html` against the delegate's
  selector list — found none. Every clickable element has a handler.
* **A double tap on «В корзину».** One line, quantity 2. Correct.

---

## 5. For the other agents

Tested from the shopper's side, not touched:

1. **Payments.** `GET /api/payments/methods/` answers **503** when Montonio is
   not configured, and Chromium logs every non-2xx fetch as a console error —
   so a real shopper opening the checkout on a shop without keys gets a red
   line in their console. `app.js` already falls back to its built-in bank list
   and shows nothing wrong. A `200 + {ok:false}` would keep the shopper's
   console clean. (The e2e sweep has to allow-list this one status on this one
   route to stay green.)
2. **Promo codes.** `POST /api/promos/check/` answers **400** for a code whose
   shape is unusable (`"!!!"` normalises to empty) but **200 + {ok:false}** for
   one that is merely unknown or expired. Both are "the shopper mistyped a
   code"; only one of them is a console error. `app.js` already treats the two
   identically, so this is purely server-side tidiness.
3. **Newsletter consent (invoice/checkout owner).** The checkbox «Хочу получать
   новости и скидки» at `app.js:9580` sets `S.newsletter` and **nothing reads
   it** — not `orderPayload()`, not any call. A shopper ticks a consent box and
   nothing anywhere records it. The column exists (`customers.marketing`, used
   by the birthday and abandoned-cart jobs) and the account screen's own
   checkbox writes it through `PATCH /api/account/me`; the checkout one has no
   session to write through for a guest, and `POST /api/orders` only *looks up*
   a customer, never creates one. Deliberately **not fixed here** — where a
   guest's consent lands is a flow decision with a GDPR edge. Question 2.
4. **Admin-side dead hooks**, same audit, left for whoever owns that file:
   `data-admship` and `data-admcustdemote` (in the delegate's selector, no
   handler, no emitter) and `data-admedit` (a stub handler that toasts «В демо
   правка не сохраняется» with nothing left that can reach it).

---

## 6. Questions for Dim

1. **The gift tile.** It says «25, 50 или 100 €» in fixed text while the
   buttons on `/gift/` follow your «Маркетинг → Подарочные карты» switches. If
   you ever switch 25 off or 75 on, the tile and the page disagree. Leave the
   sentence as a promise about the range, or make it list whatever is actually
   on sale?
2. **The newsletter tick at checkout.** Right now it does nothing at all (§5.3).
   Three ways out: (a) drop the checkbox and keep the consent in the account
   only; (b) create or update a customer row on every order so a guest's tick
   is stored; (c) keep it, but only show it to a shopper who is signed in.
   Which?
3. **`/shop2/brands/` has no page of its own.** A crawler that does not run JS
   gets the home page's title, description and a canonical pointing at
   `/shop2/` — at all three language prefixes, because unprerendered paths fall
   back to the Russian shell. It is also absent from the sitemap. Options:
   prerender it like the category pages (a build change), drop it from the nav
   and keep it as an in-app convenience, or leave it. Which?
4. **There is no 404.** `/shop2/anything-at-all/` answers 200 and quietly shows
   the home page. Kind to a shopper with a broken link, confusing to Google
   (soft-404s get de-indexed and can drag neighbours down). Add a small «Такой
   страницы нет» screen with a 404 status, or keep the current behaviour?
5. **`/shop2/checkout/` with an empty basket** renders the home screen but
   leaves `/shop2/checkout/` in the address bar, so the canonical and the tab
   title describe a page the shopper is not on. Rewrite the URL to `/shop2/`,
   or leave it?
6. **Seven Tab presses** separate the top of the checkout page from the e-mail
   box — the logo, the language switch, «← В магазин» and the step headings all
   come first. A «Перейти к оформлению» skip link would make it one. Add one?
7. **«Доставка по умолчанию» in the account does not reach the checkout.** The
   block says «Подставим это при следующем заказе»; the method and the parcel
   machine chosen there are written to `S.acctMethod`/`S.acctMachine` and never
   read again, and its machine list is a static one, not the live parcel points
   the checkout uses. Its prices are honest again as of `baba21e`, but the
   promise is not kept. Wire it up (a real feature: which of the live carriers,
   what happens when the saved machine closes), or take the sentence out?
8. **«Blog» in Estonian.** Your word, and the nav, footer, breadcrumbs, `<h1>`,
   SEO titles and sitemap labels all follow it — but the shop's own sentences
   decline it as *Blogi*: «Blogi pole ajutiselt saadaval», «Tagasi Blogisse»,
   «kontrolli aadressi Blogis». Fine as is, or should the label be «Blogi» so
   the section has one name?
9. **A stale success toast next to a fresh error.** Type a wrong login code and
   «Код отправлен — проверьте почту ✓» is still on screen under «Код не подошёл
   — проверьте цифры». Should a new error clear the standing toast?
10. **The gift card's «Скачать PDF» on the receipt.** It is a plain `<a>` to
    `/api/giftcards/<code>/pdf/?t=…`. If the shopper closes that page the link
    is gone — the code is in the e-mail, but the printable card is not. Should
    the account screen list gift cards bought from that address?

---

## 7. Ten polish items deliberately NOT done

Each is a design or wording change, so each waits for you. Ordered by what I
think a shopper would feel first.

1. **The checkout has no skip link**, so the keyboard path to the first field
   is seven tabs long (Question 6). Focus now lands correctly *between* steps;
   getting *into* the form is still a hike.
2. **A step that refuses says nothing out loud.** `failStep()` moves focus to
   the bad field and marks it, but the field note is the only announcement; a
   short live-region line («Проверьте e-mail») would tell a screen-reader user
   what happened as well as where they are.
3. **The rejected-promo box keeps focus where it was.** «Код не найден —
   проверьте написание.» appears, the typed code stays, but the cursor does
   not go back to the field — one more click before a correction.
4. **The catalogue's `<meta name="description">` after a client-side
   navigation** falls back to the shop-wide one instead of the category's. The
   prerendered page a crawler actually fetches is correct, so this is
   cosmetic — but it is one line if you want the two paths identical.
5. **The receipt is chromeless**, so there is no language switch on it. A
   shopper who lands there from a bank in the wrong language cannot change it
   without leaving the page.
6. **Two full renders land ~100 ms after the first paint** on every screen
   (`/api/overrides/` and `/api/bundles/` each end in `render()`). It is
   invisible on a fast machine and it is why a test measuring geometry had to
   be taught to retry; on a slow phone it is a tap that can land on a node
   about to be replaced. Scoping those two answers the way the checkout already
   scopes its own probes would remove the class.
7. **The account's parcel-machine list is a different list from the
   checkout's** — static names against the live `/api/shipping/points/` (part
   of Question 7, but worth its own line: the two lists can name different
   machines in the same town).
8. **The order rows in «Мои заказы» have no repeat-order button** even though
   the translations for one are already in the dictionary in all three
   languages. The hook was removed as dead (`618ce03`); the feature is a
   decision, not a bug.
9. **«Пакомат DPD / Omniva / SmartPosti» in the account now all show the same
   price**, because the live rules carry one parcel price unless you set
   per-carrier ones. Honest, but three identical rows read oddly next to the
   checkout's single «Пакомат» row plus carrier chips.
10. **The gift-card denominations appear in three places** — the tile's
    sentence, `/gift/`'s buttons and the checkout's validation — with three
    different sources of truth (fixed text, `settings.gift_amounts`, the
    server's `GIFT_AMOUNTS`). It works today; it is the kind of thing that
    drifts.

---

## 8. How to re-run this

```bash
node tools/e2e-build.mjs
E2E_PORT=4017 npx playwright test e2e/storefront-sweep-2.spec.ts --project=desktop --project=mobile --project=mobile-safari
E2E_PORT=4017 npx playwright test e2e/sweep-storefront.spec.ts e2e/sweep-checkout.spec.ts --project=desktop --project=mobile --project=tablet
npx vitest run
git checkout -- public/shop2/index.html src/data/content.default.json src/data/blog.prerendered.json src/db/migrations.generated.ts
```

The account specs request a login code, and that route allows three per IP per
fifteen minutes. Against a dev server that has been up a while, a fourth
re-run of the same spec fails on a missing code rather than on the shop —
restart the server (the limiter's buckets are in memory) instead of chasing it.
