# Go-live readiness pass — 27.09.2026

Two read-only passes on Opus 5.5 (Dim's choice), over main at 6d75be1, after the
first live hour of 26.09.2026 (staging on live Montonio keys). Not a code audit:
what can go wrong on launch day and in the first weeks. **A** = launch day,
configuration, domain, search engines. **B** = money, orders, shipping, letters,
operations. Paths are relative to the repo.

Corrections by the lead after reading both:
- A/G3 says there is no import tool and no data source. The tool exists outside the
  repo (`Rempire/shopify-stock-2026-09-26/import-draft.mjs`, dry-run tested 26.09,
  322 rows, option 1b) and Shopify was read through Dim's logged-in admin. The rest
  of G3 stands: run the reset **without `--stock`** (keeps 153 bound barcodes; the
  import sets counts absolutely), and the golive text «после обнуления: оно стирает
  склад» is wrong for the default reset.

## Verdicts

- **A:** a date can be picked now, at least 3 working days out. The code is ready;
  the written procedure of the day is not — four steps would harm or cannot run
  (G1–G4).
- **B:** taking money is ready (bank link, card, Google Pay settled live; lost
  webhooks caught by the return page and the daily reconcile). Giving money back is
  not proven, and the «Деньги возвращены» letter never goes after a PENDING refund
  completes (B1).

## Part B — money and operations

| # | Sev | Finding | Evidence | Owner | Fix |
|---|---|---|---|---|---|
| B1 | MUST | «Деньги возвращены» never sent when a PENDING refund completes: the webhook updates the existing entry, `applied` stays false, the letter is gated on `applied`; the «Возврат отправлен» letter promises a second one | `src/lib/payments/refund.ts:311`, `src/lib/payments/settle.ts:200-207`, `src/emails/texts.ts:219`; no route test PENDING→SUCCESSFUL (`tests/payments-refund.test.ts:535-580`) | claude | Send `refunded` on the not-done → done transition; route test |
| B2 | MUST | Sandbox data under live keys until the reset: a sandbox-paid courier order's «Создать этикетку» books a real paid parcel; sandbox refunds (R-100050, R-100054…) turn «overdue» ~29.09 and paint «Подключения»/«Обзор» red; nightly 404 noise. After the reset the live-hour orders are gone and their refund webhooks are ignored | `src/lib/montonio-problems.ts:1149`, `src/app/api/payments/notify/route.ts:202-205` | dim | Let R-100095/96 settle and check them; note the live orders for the accountant; then reset; Renat presses nothing on old orders |
| B3 | MUST | Refunds after the daily payout may stall: Montonio funds refunds from the store balance; unfunded → PENDING (INSUFFICIENT_FUNDS) → cancelled after 10 days. `docs/payments.md:955-957` says same-day refunds are refused — disproved live | — | dim asks Montonio; renat follows | Ask how to fund (top-up / netting); fallback: bank transfer + «возврат» by hand |
| B4 | MUST | Nobody decided how courier parcels leave the salon; Montonio cannot order a pickup via API; not on /go-live | `docs/montonio-untested.md` S12 | renat / dim | Recurring pickup or drop-off routine per carrier |
| B5 | DAY | Webhook address must not redirect: `notificationUrl` from `PUBLIC_BASE_URL`; apex↔www redirect = lost POST; «Подключения» stays green | `src/lib/payments/index.ts:51-62`, `src/app/api/payments/create/route.ts:172-173` | dim | PUBLIC_BASE_URL = Vercel's primary domain; webhook on the same host; POST to /api/payments/notify/ answers 400 not 308; keep the staging domain attached |
| B6 | DAY | Stock import order and side effects: reset → dry run → apply → DNS; Shopify sells until DNS — freeze its checkout when counts are read; back-in-stock letters: none (reset empties `stock_alerts`); 322 POSTs fine (no admin rate limit, idempotency per row) | `src/lib/inventory.ts:622`, `src/lib/flows.ts:1086-1098` | dim / claude | — |
| B7 | DAY | Automatic letters default off. «Сообщить, когда появится» sign-ups are accepted while the flow is off and silently never answered; unpaid flow off → R-100097 and abandoned checkouts stay «новый» for ever. Turn nothing on before the reset | `src/lib/flows.ts:159-175, 625-640, 1762`, `src/app/api/stock-alerts/route.ts` | renat / dim | After the reset: «снова в наличии» + «неоплаченные» on; cart and birthday Renat's call |
| B8 | DAY | «Отправлен» tracking letter unproven live; held 10 s in `after()`; if cut short it is never sent and nothing sweeps it | `src/lib/letter-hold.ts:171-190` | dim | Check once on R-100098 or the first real parcel |
| B9 | WEEK | Nothing re-checks a pending refund; a lost SUCCESSFUL webhook leaves the order «оплачен», stock and points unreturned; day 10 falsely says «Montonio отменил — верните заново», and «Вернуть деньги» answers already_refunded | `src/lib/payments/reconcile.ts:107-120`, `src/app/api/admin/orders/[id]/refund/route.ts:404-406` | claude | Nightly: pending > 24 h → read Montonio's refund list → apply through the existing recorder |
| B10 | WEEK | A late PENDING notice can overwrite a DONE refund (`{...r, ...entry}`) | `src/lib/payments/refund.ts:307-310` | claude | Never move done/failed back to pending |
| B11 | WEEK | Nothing alerts a human (golive «webhook-alarm»): stuck/failed refund, payment found by reconcile, carrier refusal by webhook, returned parcel, cron not running | `src/lib/mail-hooks.ts:223-250` | claude | Push/Telegram for those; «Обзор» red when the last flows run is > 26 h old |
| B12 | WEEK | One failing parcel blocks the nightly re-check: `checkedAt` not written on error; 20 sandbox 404s take all 20 slots | `src/lib/shipping/shipment-sync.ts:408-409, 438-443` | claude | Record the time on error too |
| B13 | WEEK | «Доставлен» only closes an order already «Отправлен»; a forgotten press = no tracking letter | `src/lib/shipping/shipment-sync.ts:292` | claude | «Сделать сегодня» nudge when the carrier says in transit/delivered on a paid order. **28.09.2026, owner's decision:** the carrier's scan now ships the paid order itself (`src/lib/ship-order.ts`, `applyShipmentUpdate`); the nudge stays only for what the scan cannot close (a word outside `inTransit`/`awaitingCollection`/`delivered`, or an order shipped and taken back by hand) |
| B14 | WEEK | Returned (uncollected) parcel is silent; only counted in the cron JSON; the daily log line omits delivered/returned/payment check | `src/lib/delivery.ts:220-223`, `src/app/api/cron/flows/route.ts:40-55` | claude | Journal row + push; counts in the log line |
| B15 | WEEK | Refund stock rules Renat must know: full refund returns every line to stock (write off unsellable by hand); partial moves neither stock nor points | — | renat | Tell Renat |
| B16 | WEEK | Vercel Hobby forbids commercial use; Pro not on /go-live | `docs/HOSTING.md:17-20` | dim | Decide Pro |
| B17 | WEEK | No `maxDuration` on the refund route (15 s + 15 s), the payment webhook, the label route — if Fluid compute is off, 10 s could stop the webhook between «оплачен» and stock/letters | — | dim checks; claude | `maxDuration = 60` |
| B18 | NICE | Never run live: Omniva, SmartPosti, Unisend, Nova Post, courier booking, refusal + «Отправить заново», a non-DPD label PDF | — | — | — |
| B19 | NICE | Failed customer letters only logged (`src/lib/mail.ts:496-513`); `docs/accounts.md:70` says RESEND_TO unset; A4 label asks for a drop-off code that never comes; open «Подключения» after the reset | — | — | — |

Audit 18.09 status: F1, F2, F3, F4 closed; F15 closed in code, never run live; F16
partly closed (refusals still a 2.6 s toast, reason an English token).

## Part A — launch day and configuration

| # | Sev | Finding | Evidence | Owner | Fix |
|---|---|---|---|---|---|
| G1 | BLOCKER | The documented order «PUBLIC_BASE_URL not before the domain moves» is wrong: PUBLIC_BASE_URL is already the staging host; DNS first = rempireshop.com serves staging robots `Disallow: /` + noindex during the rebuild; orders in that window get staging notify URLs | `docs/go-live.md:118,120`, `src/data/golive.json:676,707`, `next.config.ts:327-336` | claude docs, dim runs | Set PUBLIC_BASE_URL=https://rempireshop.com → Redeploy → DNS the moment it is READY |
| G2 | BLOCKER | Reset command cannot connect as written: `.env.local` has no DATABASE_URL; step 1 deletes `.env.railway.txt` before the reset; Railway's private CA fails strict TLS | `docs/go-live-reset.md:51,82`, `tools/go-live-reset.mjs:997-1003`, `tools/migrate.mjs:82-88` | claude doc, dim rehearses | `node --env-file=.env.railway.txt tools/go-live-reset.mjs` with `DATABASE_SSL_NO_VERIFY=1` (or CA); delete the file at the end of the day; dry run the day before |
| G3 | BLOCKER* | Stock import vs reset: default reset keeps stock; `--stock` destroys 153 barcodes; golive text wrong (*see correction above) | `tools/go-live-reset.mjs:331-353, 773`, `src/data/golive.json:742` | claude + renat | Reset without `--stock`; import tool into the repo; Shopify inventory CSV export as the source |
| G4 | BLOCKER | Test products and prices live on the storefront and in the Merchant feed: `c-davienness-nelya-shampun` «50 кг» 500 €, `c-davines-cheap-price_699`/`_96`, `c-rempire-hoodie_xxs` 1 € vs `_xxl` 100 €, «Davines Очень классный» 10 €; the €1 product; reset keeps custom products, overrides, promo codes | `/feed/google-en.xml` on staging | renat + dim | Delete test products, fix hoodie prices, review promo codes and newsletter drafts |
| G5 | MUST | Adding rempireshop.com + www to the Vercel project (www → apex) is on no list; `go-live.md:123` says DNS at ASCIO | — | dim, claude docs | — |
| G6 | MUST | DNS keep-list incomplete: img.rempireshop.com (R2), resend._domainkey, send.rempireshop.com, _dmarc; rollback values A 23.227.38.65, www CNAME shops.myshopify.com (TTL 300) | — | claude doc | — |
| G7 | MUST | Vercel Hobby non-commercial; live money since 26.09 | `docs/HOSTING.md:18-21,70` | dim | Decide Pro |
| G8 | MUST | `public/shop/legal.js` names Shopify 22×, loaded on every page | `public/shop2/index.html:170` | claude | Replace |
| G9 | MUST | Footer admin link still there | `public/shop2/app.js:14327` | claude | Remove in the push the day before |
| G10 | MUST | /go-live deadlocked: phase-A `google-feed`/`google-shipping` can only finish after DNS; `code-legal`/`code-final` todo; `live-keys-env` still todo; «regenerate» is really a Redeploy | `src/lib/golive.ts:276-283` | claude | Restate statuses and phases |
| G11 | MUST | Final pass not run: unit + e2e, local `PUBLIC_BASE_URL=https://rempireshop.com npm run prerender && npm run prerender:check` (not committed) | — | claude | — |
| G12 | MUST | Live-hour orders are real money; the reset deletes them and later refund webhooks are ignored | `src/app/api/payments/notify/route.ts:198-204` | dim | Confirm refunds completed; keep Montonio's report; cancel DPD 3888e013 if never handed over |
| G13 | DAY | Reset time: flows cron `0 7 * * *` UTC fires 10:00–10:59 Tallinn (09:00–09:59 after 25.10); doc says 09:00 | `docs/go-live-reset.md:18-20` | — | Reset before 10:00 or after 11:00 |
| G14 | DAY | Order: reset → unpaid on → stock import → PUBLIC_BASE_URL + Redeploy → DNS → webhook → smoke → first order → Merchant Center → Search Console | — | — | — |
| G15 | DAY | Keep the staging host attached ≥ 6 weeks (old notify URLs, Renat's home-screen app and push); open «Подключения» after the reset | `src/lib/overview-extras.ts:77-80` | — | — |
| G16 | DAY | Renat signs in again on rempireshop.com/admin (cookie per host), home screen, notifications | — | renat | — |
| G17 | DAY | Leave Shopify's domain alone until Merchant step E; legacy redirects verified on staging; watch Shopify orders 72 h | — | dim | — |
| G18 | DAY | Production smoke: `npm run smoke -- https://rempireshop.com` | — | claude | — |
| G19 | WEEK | No automatic backups on Railway Hobby | — | dim | Weekly `db-backup` or Railway Pro |
| G20 | WEEK | Lost payments found once a day; `webhook-alarm` open; missing CRON_SECRET = silent 503 | `src/app/api/cron/flows/route.ts:87-99` | dim / claude | Daily log check (and B11) |
| G21 | WEEK | `sitemap-custom.xml` lists hidden custom products (404 pages) | `src/lib/custom-products.ts:484-489` | claude | Filter hidden |
| G22 | WEEK | Merchant Center dip during the overlap (variant mismatch, review 1–3 days) | — | — | — |
| G23 | WEEK | Export Shopify orders and customers before cancelling the plan | — | dim | — |
| G24 | NICE | Legacy redirects 2 hops; `/` is a 307 | `next.config.ts:389` | — | — |
| G25 | NICE | `/api/testplan/` public (plan text, no answers) | — | — | — |
| G26 | NICE→MUST | Order numbers restart at 100001 after the reset — reuses R-100095…98 already in the live Montonio account | `tools/go-live-reset.mjs:800` | claude | Continue after the highest number |
| G27 | NICE | Leftover staging URLs (canonicals of /shop/p/*, og:url on /golive/ /test/ /guide/ /cards/, `public/shop/emails/*.html`, `metadataBase` in `layout.tsx:5`) | — | — | — |
| G28 | NICE | `.env.railway.txt`, `.env.montonio-live.txt` on disk since 23.09 | — | dim | Delete after the day |
| G29 | OK | SESSION_SECRET set; never rotate it (gift-card PDFs, order tokens, sessions) | — | — | — |
| G30 | NICE | Docs drift (go-live.md vs golive.json; next-session.md 19.09; `.env.montonio-live` vs `.txt`) | — | claude | — |

Audit 18.09 status: F12, F13, F14, F18 closed; F17 open (docs only:
`docs/montonio-untested.md:81, 241, 373, 403, 414`, and 3.3 does not say the order
must be «Отправлен» before a delivered event closes it).

Verified fine: legacy Shopify redirects; three Google verification tags + DNS TXT;
X-Robots-Tag keyed to the host; both crons daily (reconcile, shipment re-check,
invoice dunning, paused newsletters ride the flows cron); the webhook tool enforces
path and trailing slash; `/api/e2e/*` 404 in production.

## The day, corrected (A §3)

T-1: docs fixed and /go-live restated; legal.js + footer link in one push; unit +
e2e + local production prerender check; stock-import dry run rehearsed; test
products deleted, hoodie prices fixed, promo codes reviewed; `DATABASE_SSL_NO_VERIFY=1`
in `.env.railway.txt`, reset dry run, one `db-backup`; Vercel env checked (CRON_SECRET,
RESEND_API_KEY, RESEND_TO, SESSION_SECRET, DATABASE_SSL_*, PAYMENT_PROVIDER unset);
rempireshop.com + www added in Vercel (www 308 → apex), DNS values noted; Pro decided;
live hour closed out (G12).

The day (Tue–Thu, from ~08:30 Tallinn):
1. Backup (`node --env-file=.env.railway.txt tools/db-backup.mjs`).
2. Reset: dry run, read, `--clear --confirm "…"` **without `--stock`**; dry run again; open «Подключения». Before 10:00.
3. Unpaid flow on (and «снова в наличии»).
4. Stock import: Shopify export → dry run → apply; last before DNS.
5. `PUBLIC_BASE_URL=https://rempireshop.com` → Redeploy → READY; no orders on staging from here.
6. DNS immediately: apex A + www CNAME to Vercel's values, DNS-only; nothing else touched. Verify 200 without x-robots-tag, www 308, robots/sitemap on rempireshop.com, one `/products/…` 301, `/feed/google-en.xml` 200.
7. Smoke: `npm run smoke -- https://rempireshop.com`.
8. Parcel webhook: `tools/montonio-webhook.mjs list` → `register https://rempireshop.com/api/shipping/notify/` → «Подключения» green → delete the old id.
9. Renat: sign in at rempireshop.com/admin, home screen, notifications.
10. First real order (bank link, salon pickup); refund next business day.
11. Merchant Center step B (docs/merchant-feed.md); Shopify sources untouched.
12. Search Console: sitemap + request indexing.
13. Shopify orders checked at 12:00, 18:00, next morning; delete the two `.env` files.

Rollbacks: pg_restore from step 1; PUBLIC_BASE_URL back + Redeploy or Instant
Rollback; DNS back to A 23.227.38.65 / CNAME shops.myshopify.com; re-register the
staging webhook.
