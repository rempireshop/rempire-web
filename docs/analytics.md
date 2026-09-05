# Analytics — sales, traffic and search (analytics agent)

What the admin's **«Обзор»** and **«Аналитика»** tabs show, where every number
comes from, and the two things that need a one-time setup step from Renat:
Google Search Console and (optionally) the Cloudflare traffic beacon.

## The «Обзор» tab — the first screen, and all of it real

Every figure on the Overview comes from one call, `GET /api/admin/overview/`
(`getOverviewSummary()` in `src/lib/analytics.ts`). Nothing on that screen is
invented any more: it used to mix a real catalogue count with a hard-coded
«3 заказа сегодня» and a random «вчера — 5», which is worse than showing
nothing — the owner had no way to tell which half to believe. The banner at
the top of the panel no longer says the customers or the figures are a demo,
because they are not; the one thing still made up, once he is signed in, is
the sample order list shown while the shop has taken no orders at all, and the
banner says exactly that.

| Card / block | What it means for Renat |
| --- | --- |
| **Заказы сегодня** | How many paid orders were placed today, with «вчера — N» underneath. |
| **Выручка за 7 дней** | Sum of `total` over the last 7×24 hours of paid orders, and the same figure ÷ 7 as the daily average. |
| **Товаров в каталоге** | `catalogue.min.json`, the catalogue the shop actually ships — always was real. |
| **Заканчиваются** | How many products are «мало» or «нет», with «из них нет в наличии — N» underneath. |
| **Требует внимания** | Four queues only the owner can empty, each linking to the tab that empties it: orders paid but not yet shipped, partner (pro) requests waiting for a decision, reviews waiting for moderation, and shoppers subscribed to «сообщить о поступлении» whose letter has not gone out. All four at zero reads «Ничего не ждёт — всё разобрано.» |
| **Последние заказы** | The five newest orders, from `/api/admin/orders/`, as before. |
| **Заканчиваются на складе** | The first six of the same low-stock list as the card above. |

Three decisions behind those numbers, all of them visible on screen and all
three written down in the block comment above `getOverviewSummary()`:

- **Which date.** `orders` has no `paid_at` column
  (`db/migrations/001_core.sql`) — only `created_at`, and `updated_at`, which
  moves again on every note and status change. So «заказы сегодня» means
  *orders placed today that have been paid*, never "orders whose payment
  landed today". The line under the cards says so: «Заказы и выручка — только
  оплаченные, по дате заказа.»
- **Which statuses count as paid.** `paid`, `shipped` **and** `delivered`
  (`PAID_STATUSES`, top of `src/lib/analytics.ts`). Pressing «Отправлен» or
  «Доставлен» must not make today's count and today's revenue fall over in
  front of the owner, which is what a strict `status = 'paid'` does in a shop
  that ships the same day. `cancelled` and `refunded` stay out: that money
  left again. The partial index behind these queries was rebuilt with the
  third status in `db/migrations/140_order_delivered.sql`.
  The «Аналитика» tab below reads the same constant for every money figure,
  so the two tabs agree by construction.
- **Which stock.** Not a query of its own: `getOverrides()`
  (`src/lib/orders.ts`) already merges the numeric levels over the manual
  в наличии/мало/нет override, tracked variants only — see the module doc in
  `src/lib/inventory.ts` for what "tracked" means. Reading that is what makes
  «Заканчиваются» agree with the badge in the shop by construction, instead
  of being a second opinion about the same thing.

Day boundaries are **UTC**, the same convention `rangeBounds("today")` already
uses for the «Сегодня» pill. Estonia is one or two hours ahead, so a sale made
after 22:00/23:00 local counts towards tomorrow — worth knowing, and better
than two different definitions of «сегодня» in one panel.

Without a backend behind it (the standalone prototype, or a browser that is
not signed in) the Overview keeps the demo numbers it always had, and the
banner calls them a demo. If the call itself fails while signed in, the panel
falls back to the same demo numbers and says so in one line rather than
showing zeros that would read as "you have sold nothing".

## What Renat sees on «Аналитика», and what it means

Four range pills — **Сегодня / 7 дней / 30 дней / 90 дней** — pick a trailing
window ending now (not a calendar period: "30 дней" is the last 30×24 hours).
Since the phase-3 redesign the top of the screen is four KPI cells, a bar per
day of the window and two short lists («Топ товаров», «Искали, но не нашли»);
everything else below is the same table it always was.
Every KPI card also shows the change against the *immediately preceding*
window of the same length, so "7 дней" compares against the 7 days before
that.

| Card / section | What it means for Renat |
| --- | --- |
| **Выручка** | Sum of `total` on orders placed in the window that were paid — `paid`, or `shipped` / `delivered` once the owner pressed «Отправлен» and «Доставлен» (`PAID_STATUSES`, the same rule as the Overview). Includes shipping and any promo/gift-card discount already taken off — it is the money that actually arrived and stayed; `cancelled` and `refunded` are out. |
| **Заказы** | Count of the same paid / shipped / delivered orders placed in the window. |
| **Средний чек** | Выручка ÷ Заказы. |
| **Из корзины в заказ** | Paid orders ÷ distinct visitor sessions that viewed at least one page — "out of every 100 people who opened the shop, this many bought something." Called «Конверсия» before the redesign; same number. |
| **Выручка по дням** | One bar per calendar day of the window (at most a fortnight of them), labelled with its weekday; today's bar is the ink one. Same paid orders. |
| **Воронка** | How many *sessions* (not page views) reached each step: opened the shop → looked at a product → added to cart → opened checkout → finished a purchase. Each bar is a hard floor under the next — normal, since not everyone who looks buys. |
| **Топ товаров по выручке / по просмотрам** | Which products earned the most money, and separately which were looked at the most — the two lists are often different. |
| **Бренды: что приносит деньги** | Same idea, rolled up by brand. |
| **Смотрят, но не покупают** | Products someone opened in the window but nobody added to a cart or bought — candidates for a better photo, a lower price or a rewritten description. |
| **Популярные запросы / Ищут, но не находят** | What people typed into the shop's own search box, and separately the terms that came back with zero results — a request for a product page, a redirect, or a spelling variant to catch. |
| **Промокоды** | Each code's uses and the euro it took off, from the same table the promo-codes tab manages. |
| **Устройства / Страны / Откуда приходят** | Phone vs. computer, which country the visitor's IP resolved to, and which outside site sent them (Google, Instagram, a direct visit shows as nothing). |
| **Ещё цифры** | Brошенные корзины (a cart with an e-mail that never became an order), chat opens, and gift cards sold/redeemed in the window. |
| **Заканчиваются на складе** | The same low/out-of-stock list as the Overview tab, with a straight link into the goods editor for each one. |
| **Google Search Console** | See below — needs a one-time setup step. |

Loading and empty states: while a range is being fetched the tab shows
«Загружаем…»; a shop with no visits yet in the chosen window shows «Данных
пока нет — они появятся после первых заходов.» instead of a wall of zeros.

## Where the numbers come from — the short version

Two sources, on purpose:

- **Money** (revenue, AOV, revenue-by-day, top products/brands by revenue,
  promo usage, gift cards) is computed straight from the `orders`,
  `promo_code_uses` and `gift_card*` tables — the same tables the Orders and
  Promo Codes tabs already use. It is never affected by an ad blocker and
  never double-counted.
- **Behaviour** (funnel, views, search, traffic split, chat opens) comes from
  the new `events` table (`db/migrations/080_events.sql`), filled by the
  storefront's own `POST /api/track` beacon.

## The events table and the beacon

`events` is one row per thing that happened: a page view, a product view, an
internal search, an add-to-cart, a checkout opening, a purchase, or a chat
open. Written by:

- **The storefront** (`public/shop2/app.js`, `track()` near `esc()`) —
  `navigator.sendBeacon("/api/track/", …)`, fire-and-forget, never blocks a
  render or a navigation. Called from: the router (`go()`, the `popstate`
  handler and once at boot — one "view", plus a "product" when the screen is
  a product page), the search box (debounced 700 ms after typing stops), the
  add-to-cart handler, the moment checkout opens, the receipt screen when the
  bank confirms payment (`s=paid`), and `chat.js`'s open button (through
  `window.__rmpTrack`, the one deliberate bridge between the two files).
- **The server**, once, from the single paid transition in
  `src/lib/payments/apply.ts` — a `purchase` row with the reserved session id
  `"server"`, written the moment an order actually becomes paid, regardless
  of whether the shopper's browser ever sent anything.

**Which purchase row is used where.** Both the client's beacon and the
server's write a `type: 'purchase'` row, and that is deliberate, not a
duplicate to clean up:

- The **client's** row (a real, random `sid`) feeds only the funnel's last
  bar — "how many sessions got as far as a finished purchase." It is a lower
  bound: `/api/track` is a plausible target for an ad blocker, and a closed
  tab or a flaky connection can lose it.
- The **server's** row (`sid: "server"`) is written once, exactly on the
  transition, and is excluded from every session-shaped count precisely
  *because* its sid is not a real session. Revenue itself does not even read
  it — the money figures above come straight from `orders` — but it is the
  first thing to check if a day's revenue ever needs cross-referencing
  against the event log independently of the orders table.

### Privacy

- No cookie, ever. `sid` is a random id the storefront keeps in
  `sessionStorage` — gone the moment the tab closes, never synced between
  tabs or devices, never sent to a cookie.
- No name, e-mail, address or order number in `events`. The purchase row
  carries a euro amount and (for the server row) the order's own id — nothing
  that identifies a person browsing.
- `ref` is a bare referrer **host** (`google.com`), never a full URL — a
  Google search's own query string, which can carry what someone typed, is
  never captured.
- Bots and crawlers are recognised by User-Agent and never written at all
  (`src/lib/events.ts` `isBotUA`).
- **90-day retention.** Rows older than 90 days are deleted by
  `GET/POST /api/cron/events-retention` (same `CRON_SECRET` bearer-token door
  as `/api/cron/flows`, registered in `vercel.json`), and — belt and
  suspenders, in case that schedule is ever missing from a given hosting
  plan — by a roughly 1-in-2000 chance sweep inside `POST /api/track` itself
  (`maybeSweepOldEvents`). Either way, nobody's browsing history from three
  months ago is still sitting in the database.

### The assistant

When the owner asks a sales question in the panel's «Помощник» ("сколько
продали за неделю", "какой товар лучше идёт"), `analyticsForAI()`
(`public/shop2/app.js`, beside `heroForAI()`) sends a 30-day summary along
with the question — revenue, orders, AOV, conversion and the top 5 products
and search terms. `briefAnalytics()` in
`src/app/api/assistant/actions.ts` re-shapes it before it reaches the prompt,
the same way `briefHero()` does for the banner. No new action type: the
assistant can talk about the numbers, not change anything here.

## Setting up Google Search Console

The Search Console block needs a **service account** — a robot Google
account that can read (never write) your Search Console data. One-time
setup, about five minutes.

**Done on 05.09.2026** (under rempireshopinfo@gmail.com): Google Cloud
project **«Rempire shop»** (`rempire-shop`), the «Google Search Console API»
enabled in it, service account **gsc-reader@rempire-shop.iam.gserviceaccount.com**
added to the `sc-domain:rempireshop.com` property as a *Restricted* user.
What is left is step 2 (Dim creates the JSON key —
[Keys tab](https://console.cloud.google.com/iam-admin/serviceaccounts/details/104247251027055176481/keys?project=rempire-shop)
→ Add key → Create new key → JSON) and step 4 (the two variables on Vercel),
then a redeploy.

1. In the [Google Cloud console](https://console.cloud.google.com/), create
   (or reuse) a project, then **IAM & Admin → Service Accounts → Create
   service account**. Any name (e.g. "rempire-analytics") is fine.
   Then **APIs & Services → Library → «Google Search Console API» → Enable**
   in that same project — without it every call answers 403 «API … has not
   been used in project … or it is disabled».
2. Open the new service account → **Keys → Add key → Create new key → JSON**.
   A `.json` file downloads — this is the only copy Google gives you.
3. In [Search Console](https://search.google.com/search-console), open the
   **rempireshop.com** property (a *domain* property, not the URL-prefix
   one — the site is added there as `sc-domain:rempireshop.com`) →
   **Settings → Users and permissions → Add user**. Paste in the service
   account's e-mail address (the `client_email` field inside the JSON file,
   looks like `...@...iam.gserviceaccount.com`). **Restricted** permission is
   enough — this only ever reads.
4. Set two environment variables (Vercel project settings, or `.env.local`
   for a local run):
   - `GSC_SERVICE_ACCOUNT_JSON` — the **entire contents** of the downloaded
     JSON file, pasted as one value.
   - `GSC_SITE_URL` — `sc-domain:rempireshop.com`.

Without those two variables the block shows one line: «Добавьте сервисный
аккаунт как пользователя в Search Console → см. docs/analytics.md» — the
rest of the tab works normally either way. A key variable that is set but is
not Google's JSON file (half a paste, the file's path instead of its
contents, a key without `client_email`/`private_key`) answers `bad_key`, and
both «Аналитика» and «Подключения» say the key cannot be read — so a bad
paste is told apart from "nobody set it up yet". Vercel reads variables at
build time: after adding or changing them, **redeploy** (Deployments →
⋯ → Redeploy); a push with no file changes does not build. Once both are set, the tab shows
the last 28 full days (Search Console itself lags 2–3 days, so the window
ends 3 days back rather than yesterday): clicks, impressions, CTR, average
position, and the top 20 queries and top 20 pages. The answer is cached in
`settings.gsc_cache` for 24 hours (`src/lib/gsc.ts`) — Search Console's own
numbers do not move faster than that, so nothing is lost by not asking more
often, and it keeps the shop well inside Google's API quota.

No dependency was added for this — the OAuth token is a JWT signed by hand
with Node's built-in `node:crypto` (`RS256`), exactly the way
`src/lib/payments/jwt.ts` signs Montonio's tokens with `HS256`.

## The Cloudflare traffic beacon

A second, independent traffic-overview widget — Cloudflare's own dashboard,
outside this admin panel, useful as a sanity check against the numbers above
(and it works even if a visitor's browser blocks `/api/track`, since it is a
different, unrelated request).

The token lives in a `<meta name="cf-beacon">` tag in the head of
`public/shop2/index.html` (and, through it, every prerendered page —
`tools/prerender-shop2.mjs` copies the same head assets onto all of them),
holding a **placeholder**:

```html
<meta name="cf-beacon" content="CF_BEACON_TOKEN">
```

The beacon `<script>` itself is not in the shell any more: `mountCfBeacon()`
in `public/shop2/app.js` reads the meta at boot and appends
`https://static.cloudflareinsights.com/beacon.min.js` with that token — but
**only with a real token and only on `rempireshop.com`** (or a subdomain).
With the placeholder, on localhost or on a `*.vercel.app` preview nothing is
loaded at all. That gate is what the old static tag lacked: Cloudflare refuses
a report from an origin it has no site for, and Safari turns that CORS refusal
into an uncaught script error on every page ("XMLHttpRequest cannot load …
due to access control checks") — noise for every iPhone on staging and a
red run for the e2e sweep on `--project=mobile-safari` (docs/testing.md).

To turn it on: **Cloudflare dashboard → Web Analytics → Add a site** (needs
no DNS change — "JavaScript snippet" mode, not the proxied kind), enter
`rempireshop.com`, and Cloudflare hands back a token. Replace the literal
text `CF_BEACON_TOKEN` in `public/shop2/index.html` with it and deploy.
Turning it on is purely additive, never a regression.

`next.config.ts`'s Content-Security-Policy allows
`static.cloudflareinsights.com` (the script) and `cloudflareinsights.com`
(where the beacon itself reports) in `script-src`/`connect-src`, **for
`/shop2/*` only** — the strict policy everywhere else is untouched.

## Env vars (document here, never commit values)

| Name | Needed for | Notes |
| --- | --- | --- |
| `GSC_SERVICE_ACCOUNT_JSON` | the GSC block | the whole downloaded key file's JSON text, one value |
| `GSC_SITE_URL` | the GSC block | `sc-domain:rempireshop.com` |
| `CRON_SECRET` | the retention job | shared with `/api/cron/flows` — already documented in docs/flows.md/docs/backend.md |
| `CF_BEACON_TOKEN` | *(not an env var)* | a literal placeholder inside `public/shop2/index.html` — see above, not read from the environment |

## API

| Route | What it does |
| --- | --- |
| `POST /api/track/` | Public. `{sid, type, path?, productId?, value?, lang?, ref?}`, ≤ 1 KB. 60/minute/IP. Always 204 for anything it could not use (bad JSON, unknown `type`, a bot User-Agent, no database) — a beacon caller never reads the body anyway. `ua_class` and `country` come from the request's own headers, never the body. |
| `GET /api/admin/overview/` | requireAdmin. Everything on the «Обзор» tab: `{orders:{today,yesterday}, revenue7d:{total,perDay,orders}, lowStock:{total,low,out,items}, attention:{ordersToShip,proRequests,reviewsPending,stockAlerts}}`. No parameters — the windows are fixed (today, yesterday, the last 7×24 h). `no-store`; 503 `db_unavailable` when there is no database. |
| `GET /api/admin/analytics/?range=today\|7d\|30d\|90d` | requireAdmin. Everything on the tab except the GSC block, one `Promise.all` of small indexed queries (`src/lib/analytics.ts`). |
| `GET /api/admin/analytics/gsc/` | requireAdmin. `{ok:false,error:"not_configured"}` (200 — an ordinary state, not a failure) when the env above is not set; `{ok:false,error:"fetch_failed"}` (502) if Google's API errors; otherwise the cached-or-live summary. |
| `GET`/`POST /api/cron/events-retention/` | `authorization: Bearer <CRON_SECRET>`, same shape as `/api/cron/flows`. Deletes `events` rows older than 90 days. Registered in `vercel.json` at 03:30 daily. |

## Tests

`npm test` (vitest, on PGlite):

- `tests/track.test.ts` — the beacon route: validation, the 1 KB cap, bot
  filtering, the 60/minute limiter, and that `ua_class`/`country` come from
  headers even when the body tries to say otherwise.
- `tests/events.test.ts` — `src/lib/events.ts` directly (clamping, dropped
  bad values, the search-term/result-count convention, `deleteOldEvents`),
  and the retention cron route's auth.
- `tests/overview.test.ts` — `getOverviewSummary()` and its route: a fresh
  database is all zeros (no invented «вчера — 5»); today apart from yesterday
  across the UTC boundary; an order still counted after it is marked
  «Отправлен»; the seven-day sum and its ÷ 7 average; low stock from a real
  count where there is one and from the manual override elsewhere, with the
  count winning for the same product; an override for a product the catalogue
  no longer carries ignored; and each of the four attention queues counting
  only what is genuinely still waiting.
- `tests/analytics.test.ts` — `getAnalyticsSummary()` against seeded orders
  and events: the KPIs and their previous-period deltas, an order still
  counted in every money figure after it is marked «Отправлен» (with
  `cancelled` and `refunded` kept out), the revenue/brand breakdowns from
  real order line items, the funnel's session counting (and that the
  server's `sid:"server"` purchase row is excluded from it), viewed-but-not-
  bought, the search-term/zero-result split, promo/gift-card/cart/stock
  reads, and the traffic split.
- `tests/gsc.test.ts` — signs a real RS256 JWT against a throwaway keypair
  generated in the test and verifies the signature Google's own verifier
  would check, stubs the two Google endpoints, and checks the 24 h
  `settings.gsc_cache` round trip (including that it correctly expires).
- `tests/payments-apply.test.ts` — the authoritative purchase row: written
  once on the transition into paid, never again on a webhook retry, never on
  a failed or pending result, and never able to stop the payment itself from
  being recorded if the tracking call throws.

Also: `npm run typecheck`, `node --check public/shop2/app.js`,
`node --check public/shop2/chat.js`, `npm run build`.
