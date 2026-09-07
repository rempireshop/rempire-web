# The shopper's side — the eleven things Dim decided

07.09.2026, branch `r2-shop2` off `448cbd7`. The 06.09 sweep
(`docs/audit/2026-09-06-storefront-qa.md`) ended with ten questions and ten
polish items; Dim answered them, and this is what was built. Everything here is
the customer's half of the shop: the admin, the scanner, the invoice flow and
the payment-method logic inside `payNow()` belong to other agents this week and
were not touched.

Eleven decisions, eleven pieces of work, each with a test. Three of them turned
out to have a second half nobody had asked about — a soft 404 on product ids, a
skip link Safari cannot reach with the keyboard, an account preference that
could never match a real parcel machine — and those are written up here too,
because they are the difference between a feature that demonstrates and a
feature that works.

---

## 1. What was built

### 1. «Страница не найдена» — a real 404

Until today every unrecognised `/shop2/…` address answered **200 with the home
page**. That is a soft 404: Google indexes it, then drops it, and takes the
crawl budget of the pages around it; a customer following a stale link was left
wondering which page they were looking at.

Both halves say the same thing now, on the same address:

* **the request** — `src/app/shop2/[...path]/route.ts` → `src/lib/notfound-page.ts`:
  HTTP **404**, the shell patched into the 404 screen, `noindex, nofollow`, a
  canonical that is *this* address rather than the home page, and links home
  and to the catalogue, in the language of the path;
* **the script** — `routeFromPath()` ends on `S.screen = "notfound"`,
  `screenNotFound()` paints the same words, `pathFor()` never rewrites the
  address, and `setHead()` puts the robots meta to `noindex` on that screen
  only (and back to whatever the deploy decided everywhere else — the meta
  follows `PUBLIC_BASE_URL` at build, so it could not be hard-coded).

What is a 404 and what is not lives in one list, `isKnownShopPath()`, written
against app.js's own cascade so the two cannot drift. The screens that live
only in the browser still answer 200 with the shell; so do `p/<id>`,
`set/<id>` and `blog/<slug>`, because those ids live in a database and each has
its own route that 404s an id nobody has — guessing here from a build-time file
would 404 a post the owner published an hour ago. A category, a brand or a
policy slug that does not exist **is** a 404: all three are closed sets known
at build time.

**The second half nobody asked for:** `/shop2/p/<garbage>/` was still a soft
404 — `productPageResponse()` handed the shell at 200 to any id that was not a
`c-…` one. It now checks the catalogue: a real catalogue id still gets the
shell (that is the fresh-clone case, where the static file has not been
written yet), anything else gets the 404 with the noindex shell, exactly as a
hidden custom product already did.

**One thing that got worse, and it is Question 4 below:** a malformed escape
(`/shop2/b/%E0/`) now answers a bare **400** from Next, which refuses to decode
an un-decodable segment into a route parameter. `/shop2/p/%E0/` — the shape a
messenger actually mangles, since that is what the shop's own share button
produces — has done this ever since the request-time product page existed;
making every `/shop2/` path a route extends it to the rest. A mangled *query*
(`/search/?q=%E0`) still boots the shop exactly as before, and so does a
mangled id the SPA reaches by navigating.

### 2. The checkout with an empty basket

It drew the home screen and left `/shop2/checkout/` in the address bar, so a
reload put the shopper back "in a checkout" that cannot exist, and the tab
title and the canonical described a page they were not on. `routeHome()`
replaces the address with the shop's, in the language of the path — replaced,
never pushed, because there is nothing there to go Back to. The receipt without
an order in its query (`/shop2/done/` with no `?s=`) takes the same door.

### 3. The gift card's denominations come from the setting

«25, 50 или 100 €» was fixed text in three places — the tile on the home page,
`GIFT_DESC` (the page's description for a search engine) and the static
`/shop2/gift/` page the build writes — while the buttons on `/gift/` followed
`settings.gift_amounts`. Switch 25 off or 75 on and the shop advertised one
thing and sold another. And the checkout validated against the four amounts the
*server* allows, so a denomination the owner had switched off went through if
it was already sitting in a basket, or if the item id was posted by hand.

All four now read the one setting:

* `giftAmountsPhrase()` in app.js renders the amounts through `eur()`, so it is
  «25 €, 50 €, 100 €» in Russian and Estonian and «€25, €50, €100» in English
  with no dictionary entry needed at all — a list of prices has no words in it.
  The sentence around it stays a dictionary key, in its own text node.
* The meta description is built from two dictionary keys with the amounts
  between them (`giftDescText()`), which is the same shape
  `src/lib/seo-head.mjs`'s `giftDesc(amounts)` takes for the build.
* `tools/prerender-shop2.mjs` reads `settings.gift_amounts` alongside the
  shipping rules it already reads, so the static page names what is on sale.
  (It was listing all **four** allowed amounts, 75 included, whatever the
  setting said.)
* `createOrder()` checks a gift line against `giftAmountsOnSale()` —
  `settings.gift_amounts`, not the ceiling — and refuses with
  `gift_unavailable`: «Такой подарочной карты сейчас нет — выберите другую
  сумму». An empty answer from the settings read is treated as "could not ask"
  and sells as before: refusing every card because a database hiccup would be
  worse than the bug.

### 4. «Доставка по умолчанию» reaches the checkout

The block promised «Подставим это при следующем заказе» and did nothing: the
row and the machine were written to `S.acctMethod`/`S.acctMachine`, read by
nothing, and gone on the next reload.

Now the country, the method, the carrier and the parcel machine are saved for
that address (`rempire-ship-pref` in the browser, stamped with the e-mail that
saved it so a shared computer never hands one person's locker to the next) and
fill the checkout in — until the shopper picks a delivery themselves in this
order, after which their hand wins and nothing reaches over it (`S.shipPicked`).
A finished order clears that flag, so the next one starts from the preference
again. «Выйти» removes the saved row.

Nothing new is stored on the customer's row: there is no column for it, and the
value is a convenience rather than a fact about an order — every order still
carries its own method, carrier and point.

**The second half nobody asked for:** the account's parcel-machine list was the
static one in `public/shop/shipping-data.js` while the checkout's is the live
`/api/shipping/points/` feed (polish item 7 of the 06.09 sweep). A machine
saved from one list could not be found in the other, so the half of the promise
that matters most — «my locker» — would almost never have been kept. The
account draws the live list per carrier now, with the static names as the
stand-in while the feed is in flight, and the preference stores the **name**
rather than an index, because the list changes under an index. At the checkout
the saved name is matched against the live points; a machine that has closed
simply leaves the field unchosen instead of silently picking another.

### 5. The printable gift card in the account

The link existed only on the receipt, so closing that tab left the buyer with
the code in an e-mail and no card to print. `listCustomerOrders()` now carries
the cards each order issued, with the same signed `/api/giftcards/<code>/pdf/`
link the receipt and the letter use, and the account draws one row per card
under the order that bought it. The token is only ever handed to a request that
has already proved it owns the mailbox (the signed `rmp_cust` cookie behind
`/api/account/me`), so nothing new is exposed. The lookup is one query for the
whole page and fails to an empty list: a customer's orders must not disappear
because a card could not be read.

### 6. A skip link in the checkout

Seven Tab presses separated the top of the page from the e-mail box — the logo,
the three language buttons, «← В магазин» and the step headings all came first.
There is one now: off-screen until it takes focus, then the first thing a
keyboard shopper sees, and it puts the caret straight into the first control of
whichever step is open.

**The second half nobody asked for:** it started as the usual
`<a href="#coform">`, and the mobile-safari project failed on it. Safari does
not move Tab focus to links unless the reader has turned on full keyboard
access — so on the one browser every iPhone runs, a skip link written as an
anchor is unreachable by the very keyboard it exists for. It is a
`<button data-coskip>` now.

### 7. A fresh error clears the standing toast

Typing a wrong login code left «Код отправлен — проверьте почту ✓» sitting
under «Код не подошёл — проверьте цифры» for the rest of its 2.6 seconds.
Rather than a call at every error site, one rule in `renderImpl()`: a render
that paints an alert the previous render did not takes the standing toast down.
A toast raised *by* an action after its own render — `failStep()`'s «Проверьте
e-mail», «Добавлено: …» — is younger than the paint and is left alone, because
`toast()` runs after `render()` returns. The admin is out of it: its bar
carries «Отменить» for six seconds and an unrelated error must not swallow the
offer.

### 8. The Estonian blog is «Blogi»

One dictionary line in app.js drives the nav, the footer, the breadcrumbs, the
`<h1>`, the SEO title and the prerendered/sitemap labels; `src/lib/seo-head.mjs`
carries the same word for the request-time blog page. The shop's own sentences
already declined it — «Blogi pole ajutiselt saadaval», «Tagasi Blogisse»,
«kontrolli aadressi Blogis» — so the section has one name now.

### 9. «Бренды» is a real page

It was the one shopper page with no prerendered head: `/shop2/et/brands/` and
`/shop2/en/brands/` were served the Russian shell, so a crawler without
JavaScript read the home page's title, the home page's description and a
canonical pointing at `/shop2/`, and the page was in no sitemap at all.
`brandsPage()` writes it in all three languages — the same crumb, `<h1>` and
opening sentence `screenBrands()` draws, the 26 brands as real links (a second
crawlable path to those pages), `BreadcrumbList` + `ItemList` JSON-LD — and it
is in the sitemap at priority 0.5. 810 pages became **813**;
`next.config.ts` routes the new file, `check-prerender.mjs` checks it, and
`.gitignore` ignores it like every other generated page.

### 10. The newsletter tick is wired

The box at checkout set `S.newsletter` and **nothing read it** — a shopper
ticked a consent box and the shop recorded nothing anywhere.

`orderPayload()` carries it, and `POST /api/orders` writes it to
`customers.marketing` after the order exists — the same column the account
screen's own checkbox writes and the birthday and abandoned-cart jobs read —
creating the row for a guest who has never signed in. Consent only ever goes
**on** from there: not ticking a box at a checkout is not a withdrawal (the
shopper may have said yes in their account last month), and turning it off
stays in the account and in the panel.

**The admin side, kept as small as it could honestly be** (the admin shell
belongs to another agent this week): `marketing` on the customer row the API
already returns, a «Подписаны» chip beside the existing tier chips in
«Клиенты», a quiet badge on a subscribed customer's row, and a `marketing`
column in the CSV «Скачать CSV» already offers. That CSV is the subscriber
list until there is something to send from. No sender was built.

### 11. A consent banner

There was none. What the shop actually does with a visitor's device is short
enough to say plainly, so the banner says it:

* **necessary, always on** — the basket and the chosen language in
  `localStorage`, the "intro seen" flag, and, only for someone who signs in,
  the signed `rmp_cust` session cookie. Nothing to consent to and nothing to
  switch off: without them the shop cannot hold a basket.
* **visit statistics, off until allowed** — `track()` writes a random per-tab
  number into `sessionStorage` and posts it to `/api/track/` (no cookie, no
  name, no address, gone when the tab closes), and on the live domain
  Cloudflare Web Analytics. Both wait for an answer.
* **nothing else loads on its own** — the video is click-to-load and the
  parcel-point map fetches its tiles only when the shopper opens the map view.
  Said because it is true, not because it needs consent.

The choice lives under one key and is remembered; «Данные и cookie» in the
footer reopens the banner. It is a bar and not a modal — nothing about it is
urgent enough to take the shop away from someone who came to buy something — it
rides above the bottom nav on a phone so it cannot cover the way around the
shop, and it is **never drawn on the checkout or the receipt**, where on a
phone it would sit over «Оплатить».

Choosing «Только необходимое» is not decoration: `track()` returns before it
reads anything, and the Cloudflare beacon is not mounted. The authoritative
revenue figures are unaffected either way — those are written server-side on
the paid transition, not from the browser.

**The exact wording is in §4 below, for a lawyer to read.**

---

## 2. The two questions the tests answered for us

Two things were decided by evidence rather than by taste, and both are worth
recording because the obvious choice was the wrong one:

1. **The skip link is a button, not an anchor.** Measured on WebKit, not
   assumed: the mobile-safari project failed on `Tab` never reaching an
   `<a class="skip">`.
2. **The e2e suite runs as a visitor who has already answered the banner.**
   `playwright.config.ts` seeds the consent key for every project, in one
   place, so the bar is not on screen in all ~90 crawl screens and every visual
   baseline — and so the purchase-beacon tests are not quietly measuring a
   shopper who never agreed to be measured. The banner's own tests clear that
   key and drive a genuine first visit.

---

## 3. Questions for Dim

1. **Statistics are off until the visitor says yes.** That is the safe reading
   of the law — the shop stores a number on the device, and consent comes
   first — but it means Renat's visit figures only ever count people who
   pressed «Принять всё». The other way round (count everyone until they
   decline) gives fuller numbers and is what many shops do. Which, and what
   does the lawyer say?
2. **The banner's wording is mine, and plain.** It is in §4 word for word,
   in all three languages. A lawyer should read it before the shop opens —
   particularly whether «Конфиденциальность» (the existing policy page) has to
   say the same things at more length, and whether the consent needs a date and
   a version stored against it rather than just the choice.
3. **The newsletter has a list and no letters.** Consent is recorded, «Клиенты»
   can filter by it and the CSV carries it. Is a real newsletter (a template,
   a send, an unsubscribe link that works from the letter) wanted, or is
   exporting the list to whatever you already use enough?
4. **A mangled address answers a bare 400.** `/shop2/b/%E0/` — the shape a
   messenger sometimes makes of a shared link — is refused by the framework
   before the shop sees it, so the visitor gets Next's own blank error page
   instead of «Страница не найдена». Making it the shop's page means moving the
   catch-all behind a rewrite so nothing tries to decode the path; that is
   real work in the routing config. Worth it, or is a rare 400 acceptable?
5. **The saved parcel machine when it closes.** The account remembers a locker
   by name. If it is no longer in the carrier's list, the checkout leaves the
   field empty and the shopper picks again — no message, no explanation. Should
   it say something («Ваш пакомат больше не работает — выберите другой»)?
6. **The gift card refused at the till.** A card whose denomination you switch
   off is now refused at checkout even if it was already in someone's basket.
   That is what you asked for and it is the honest reading of "the setting
   decides what is sold" — but it means a basket that worked yesterday can stop
   working. Keep it strict, or let a card already in a basket through?
7. **«Подписаны» sits with the tier chips.** In «Клиенты» the filter row is
   «Все · Заявки Pro · Партнёры · Розница · Подписаны». A consent is not a
   tier; it is there because that is the row the eye goes to. If the admin
   agent's next pass gives customers a proper filter bar, it should move.
8. **The banner is 227 px tall on a phone.** That is about a third of the
   screen, once, on the first visit. It can be made shorter by moving the
   second sentence behind «Подробнее», at the cost of a fact being one tap
   away rather than on screen. Shorter, or as it is?

---

## 4. The consent banner, word for word

For the lawyer. Three languages, the same three blocks. `{…}` marks nothing —
this is the whole text; there is no small print elsewhere in the banner.

**Russian**

> **Что мы храним**
>
> Корзина и язык — в вашем браузере: без них магазин не работает. При входе в
> кабинет добавится защищённый cookie.
>
> Статистика посещений — по вашему выбору: случайный номер визита, без имени,
> исчезает вместе с вкладкой.
>
> [ Принять всё ] [ Только необходимое ] Конфиденциальность

**Estonian**

> **Mida me salvestame**
>
> Ostukorv ja keel on teie brauseris: ilma nendeta pood ei tööta. Kontole sisse
> logides lisandub turvaline küpsis.
>
> Külastusstatistika on teie valik: juhuslik külastusnumber, ilma nimeta, kaob
> koos vahekaardiga.
>
> [ Nõustun kõigega ] [ Ainult vajalik ] Konfidentsiaalsus

**English**

> **What we store**
>
> Your basket and language live in your browser: the shop cannot work without
> them. Signing in adds a secure session cookie.
>
> Visit statistics are up to you: a random visit number, no name attached, gone
> when the tab closes.
>
> [ Accept all ] [ Only what is needed ] Privacy

The region carries `aria-label="Данные и cookie"` (ET «Andmed ja küpsised», EN
«Data and cookies»), which is also the label of the footer link that reopens
it.

**What the wording is describing, so the lawyer can check it against the code:**

| what | where | when |
|---|---|---|
| the basket and the chosen language | `localStorage`, key `rempire-shop-proto` | always — the shop cannot hold a basket without it |
| "intro seen" | `sessionStorage` | always, until the tab closes |
| the delivery preference | `localStorage`, key `rempire-ship-pref` | only for a signed-in customer who set one; removed on «Выйти» |
| the consent itself | `localStorage`, key `rempire-consent` | once the visitor answers |
| the sign-in session | cookie `rmp_cust`, signed | only after signing in |
| a random visit number | `sessionStorage`, posted to `/api/track/` | **only after «Принять всё»** |
| Cloudflare Web Analytics | third party, on `rempireshop.com` only | **only after «Принять всё»** |
| YouTube | the video player | only when the shopper presses play |
| OpenStreetMap tiles | the parcel-point map | only when the shopper opens the map view |

Nothing in the visit statistics is a name, an e-mail or an address
(`db/migrations/080_events.sql`), and the number is gone when the tab closes.

---

## 5. Where the tests are, and what they found

Fourteen new test blocks in `e2e/storefront-sweep-2.spec.ts` — one `describe`
per decision, several of them repeated per language, so 24 more cases in each
of the three projects it runs on (desktop, the Chromium phone, mobile-safari):
that file went from 16 cases per project to 40. Seventeen more in a new
`tests/storefront-decisions.test.ts` for the halves with no screen. Four existing tests were changed rather than added to, because the
behaviour they pinned is the behaviour Dim asked to change:

| test | was | is |
|---|---|---|
| `sweep-storefront` — «unknown URLs» | an unknown path falls through to the home screen | it is a 404, screen and status |
| `storefront-sweep-2` — the malformed address | `/b/%E0/` renders the home screen | it is a clean 400, and the router's `safeDecode()` is exercised by a client-side navigation instead |
| `security-product-page` — the hostile id | the shell at 200 | the shell at **404**, `noindex`, `no-store` — and a real catalogue id still 200 |
| `blog-page`, `home`, `fixtures` — «Blog» | the Estonian label | «Blogi» |

One allow-list entry was added to the crawl's console watchdog
(`sweep-shop-helpers.ts`): Chromium logs the status of a document it just
loaded, so a page that is *meant* to be a 404 prints one console error.
Scoped to a `/shop2/` document — a 404 on a script, an image or an API call
still fails the sweep.

The state of the branch, every run in the foreground, every one green:

| command | result |
|---|---|
| `npx vitest run` | 80 files, **1621 passed** |
| `storefront-sweep-2`, desktop + mobile + mobile-safari | **118 passed**, 2 skipped (the beacon pair on WebKit — an intercepted `sendBeacon` there has no body) |
| `sweep-storefront` + `sweep-checkout`, desktop + tablet + mobile | **77 passed**, 31 skipped |
| home, product, catalogue, checkout, account, sets, giftcard, blog, info-pages, chatbot, seo, pwa, a11y, accessibility, security, visual — desktop + mobile-safari | **222 passed**, 1 skipped |
| `node tools/i18n-gaps.mjs` | 0 untranslated, ET/EN key parity exact |
| `node tools/check-prerender.mjs` | 813 pages, **0 failures** |
| `npx tsc --noEmit` | clean |
| `node --check public/shop2/app.js` | clean after every edit |

Two flakes seen once each and not reproducible, both pre-existing and neither
caused by anything here: `blog.spec.ts`'s pointer test failed once in a
sixteen-file batch and passes alone and in its own file on both projects (the
suite shares one database and the blog specs publish into it); and
`visual.spec.ts`'s three `webkit-local` cases "failed" on their very first run
because that project had no baselines at all — Playwright writes one and calls
it a failure the first time. Those three generated files were deleted rather
than committed: the repo ships Windows Chromium baselines only, on purpose
(`docs/testing.md` § «Visual snapshots»), and `webkit-local` is a local
convenience project.

## 6. How to re-run this

```bash
E2E_PORT=4017 node tools/e2e-build.mjs
E2E_PORT=4017 npx playwright test e2e/storefront-sweep-2.spec.ts --project=desktop --project=mobile --project=mobile-safari
E2E_PORT=4017 npx playwright test e2e/sweep-storefront.spec.ts e2e/sweep-checkout.spec.ts --project=desktop --project=tablet --project=mobile
npx vitest run
node tools/i18n-gaps.mjs
node tools/check-prerender.mjs
git checkout -- public/shop2/index.html src/data/content.default.json src/data/blog.prerendered.json src/db/migrations.generated.ts
```

The account specs request a login code, and that route allows three per IP per
fifteen minutes — restart the server rather than chasing a fourth re-run
(the limiter's buckets are in memory).
