# Going live — the whole list

Written 18.09.2026; **restated 27.09.2026** after the go-live readiness pass
(`docs/audit-2026-09-27-readiness.md`), whose corrected order of the day is
Stage 4 below. This is the spine; the detailed documents it points at are
written by the work itself and are named where they exist.

Three columns of responsibility, and the rule is that **Claude does everything
that can be done in the repository**. What is left for a person is left because
it needs a credential, a physical object, or a judgement only the owner can make.

| | who |
|---|---|
| **C** | Claude Code — code, tools, documents, verification |
| **D** | Dim — accounts, credentials, infrastructure, the decisions |
| **R** | Renat — the shop's own facts: weights, prices, what he sells |

Nothing here is a surprise: every item comes from reading Montonio's own
documentation against our code, from the owner's acceptance testing, or from the
audits. Where an item is already built, it says so.

This list is also a page — **`/golive/`** on the staging domain. Same items, the
owner shown on each one, the dependencies drawn, and **phase B (the day and
after) shut behind phase A (stages 0–3 and the day before)**, because that is
the rule: everything done on diipsolutions before the domain moves. Since
27.09.2026 nothing in phase A waits for DNS any more — the Merchant Center feeds
and the first real order moved to the day, where they belong — so phase A can
actually close. It is built from `src/data/golive.json`, which is written out of
this file, so this document stays the spine — but the page is what gets worked
from a phone, and it is where Claude ticks an item off as the work lands
(`PUT /api/golive/`). Change this file and the page's file together.

---

## Stage 0 — before anything else

| | | status |
|---|---|---|
| D | **Take a copy of the database and verify it reads back.** Railway's Backups tab is Pro-only (checked 23.09), so the copy is a file: `.env.railway.txt` with **two** lines — `DATABASE_URL=<Railway's DATABASE_PUBLIC_URL>` and `DATABASE_SSL_NO_VERIFY=1` (the reset tool needs it: Railway signs its certificate with its own CA) — then `node --env-file=.env.railway.txt tools/db-backup.mjs` (pg_dump in Docker; `docs/go-live-reset.md` step 1). Restore proven on a test database 23.09. The file is kept until the **end** of launch day. | done 23.09; again T-1 and on the morning |
| D | Confirm the production database is the same Railway instance staging uses. It is, as of 18.09 — worth re-confirming the day of. | confirmed 18.09 |

---

## Stage 1 — Montonio, which gates the most

| | | status |
|---|---|---|
| D R | **Finish the Montonio account** and obtain **live API keys**. Dim signed in with a «Juhataja» account and took the keys on 23.09. They live in a password manager — never in a chat, Telegram or an e-mail. | done 23.09 |
| R | **Activate «Refundable bank payments»** in live mode — a separate product that cannot be activated in test mode at all. **Montonio confirmed by e-mail on 23.09 that refunds are active** for Rempire Shop. Payouts now arrive the next business day, as one sum in the company's name — reconcile against Montonio's report. | done 23.09 |
| D | **Set up the live Partner System.** Omniva, DPD, SmartPosti, Unisend, International Shipping (Nova Post) on; SMS return codes on Omniva, DPD and Unisend; Unisend parcel-machine hand-over, default size S; «Parcel delay and risk notifications» active. Checked in the live account 25.09. | done 25.09 |
| D C | **Check the live account without money**: `node --env-file=.env.montonio-live.txt tools/montonio-live-check.mjs` and `tools/fetch-montonio-tariffs.mjs --dry` with the same file. GET requests only. All 105 checkout routes bookable; 11 zloty-only Polish banks hidden. (The file on disk is `.env.montonio-live.txt` — older lines here said `.env.montonio-live`.) | done 23.09 |
| D C | **Register the parcel webhook** — API only: `node --env-file=.env.montonio-live.txt tools/montonio-webhook.mjs register https://rempireshop.diipsolutions.eu/api/shipping/notify/` — trailing slash, or the POST is lost in a 308. Re-registered 25.09 with the four events (`shipment.registered`, `shipment.registrationFailed`, `shipment.statusUpdated`, `shipment.labelsCreated`). Moving it to rempireshop.com is step 8 of the day. | done 25.09 |
| ~~D~~ | ~~Enable the PIN service on the DPD carrier account; `defaultLockerSize` on SmartPosti.~~ **Cancelled 22.09** — Montonio, in writing: a drop-off code works only on a merchant's own direct carrier contract; a normal merchant scans the printed label at the parcel machine. A blank drop-off code line is normal. | cancelled |
| C | Rebuild the tariff mirror **with keys**. Ran 23.09 with the live keys: the contract prices match the table in all 111 rows. The checkout price is the calculator's price + 24 % VAT, rounded up to …,X9. | done 23.09 |
| C | The pricing grid — `docs/montonio-routes.md`. The flat price per zone was cancelled 22.09: delivery follows Montonio's calculator. | done 22.09 |
| D | **The live keys and `MONTONIO_ENV=live` in Vercel → Production**, together, and a redeploy. From then on every order on staging is real money. | done 26.09 |
| D C | **The live hour on staging**, orders R-100095…R-100098: bank link, card and Google Pay settled; a cancelled payment; a full and a partial refund sent; a real DPD parcel-machine label (R-100098). Not proven live: a refund reaching the customer and «Деньги возвращены», a carrier refusal, Omniva / SmartPosti / Unisend / Nova Post, a courier booking, the «Отправлен» letter — Stage 5. | done 26.09 |
| D | **Ask Montonio how a refund is funded after the daily payout** (readiness B3). Montonio pays refunds out of the store's balance; after the payout it can be empty → PENDING (INSUFFICIENT_FUNDS) → cancelled after 10 days. `docs/payments.md` says a same-day refund is refused — the live hour disproved that. Fallback until they answer: a bank transfer to the customer and «возврат» by hand. Does not hold the launch. | to ask |

---

## Stage 2 — what only Renat knows

| | | status |
|---|---|---|
| ~~R~~ | ~~Weigh the products.~~ **Cancelled 18.09** — every label declares one weight, 0.9 kg; Montonio prices by the real weight (24.09). `MONTONIO_PRICES_VOLUMETRIC` in `src/lib/shipping/parcel.ts` is the switch if that changes. | cancelled |
| R | ~~Which Kevin.Murphy sprays are pressurised aerosols.~~ **Closed by Dim, 19.09.2026.** | closed |
| R | ~~Whether to give Shopify collaborator access to import existing products and customers.~~ **Not needed — decided by Dim, 28.09.2026:** products come from the catalogue (already built from the Shopify store), stock from the inventory export (option 1b, the day, step 4), customers from the customer export (option B, the day, step 4b) — Dim exports both from the Shopify admin himself. **Imported customers arrive with no marketing consent** (Dim, 18.09) — which is not the same as opting them out. | decided 28.09 |

---

## Stage 2b — Google Shopping, which carries free traffic

Merchant Center account `5819586565` («Rempire Tower Shop») is **live and
earning** — 175 free clicks in 28 days, every product fed by **six `Shopify App
API` sources**. The day Shopify is switched off those feeds stop updating, so
this is a go-live dependency, not a later job.

| | | status |
|---|---|---|
| D R | Where `rempireshop.com` points and which domain the account has claimed: Shopify today; claimed by a DNS TXT record (Cloudflare) and meta tags the shop now carries itself. The switch is a feed swap, not a re-verification. | done 23.09 |
| D | **The shop's own feeds**: `/feed/google-en.xml`, `-et.xml`, `-ru.xml`, built live on every fetch (`src/lib/merchant-feed.ts`). Adding them in Merchant Center needs rempireshop.com to serve the new shop — **step 11 of the day**, not a phase-A item. | built 23.09 |
| D | **Shipping in Merchant Center** — covered by the feed: every item carries its own `g:shipping`, which outranks the account's flat €15 policies. The Shopify policies go with the Shopify sources (Stage 5). | covered 23.09 |

---

## Stage 3 — the code, all of it Claude's

| | | status |
|---|---|---|
| C | The eight answered go-live decisions (four shipping, four payment). Built 18–19.09; carton 25 × 18 × 8, default locker S (migration 203). | done 19.09 |
| C | Harden every path the sandbox cannot exercise, and `docs/montonio-untested.md`. | done |
| C | The 13 end-to-end failures — merge `0fbd940`. | done 18.09 |
| C | The go-live reset tool and `docs/go-live-reset.md`. **27.09:** order numbers continue after the highest one instead of restarting at R-100001 (the live hour's numbers are already in the live Montonio account); the command carries `--env-file=.env.railway.txt` and says which line is missing when Railway's certificate cannot be verified. **28.09:** `--test-content` (every promo code, set, post, newsletter and own product with its edits and stock rows, listed by name in the dry run, `--keep-product <id>` to spare one) and the storefront hiding the blog and «Наборы» while they are empty. | done |
| C | **`public/shop/legal.js`** — it held the old Shopify store's policies, naming Shopify as the data processor 22 times, on every page. It is not dead weight (the router's list of policy pages, the Russian titles ET/EN translate, the last-resort text), so it was replaced: now the shop's own Russian pages word for word, written from `legal.ru.js` by `tools/sync-legal-fallback.mjs`, a test keeps the two identical. | done 27.09 |
| C | **The Shopify stock import tool** — `tools/import-shopify-stock.mjs`, reading Shopify's own inventory export; the two merch decisions of 26.09 in `tools/shopify-stock-owner-rows.json`. On the 26.09 capture: 322 rows, the same as the draft. | done 27.09 |
| C | ~~«Проверьте баланс в его панели»~~ — removed 18.09; each documented refusal has its own sentences (`src/lib/montonio-problems.ts`). | done |
| C | **Final pass** — T-1, below. | the day before |

---

## Stage 3b — the day before (T-1)

Everything here can be done while rempireshop.com is still on Shopify, which is
why it is phase A on `/golive/`.

| | | status |
|---|---|---|
| C | **Final pass, one push**: the whole unit suite and the e2e suite; a local production prerender check — `PUBLIC_BASE_URL=https://rempireshop.com npm run prerender && npm run prerender:check` (not committed; put the generated files back); `index.html` has no `localhost:` and exactly two `boot.js` references. **The same push removes the footer «Админка» link** (`.ftr__admin` in `public/shop2/app.js`) — Renat is told first and uses `/admin`. | to do |
| D R | **Delete everything made during the checks — the reset does it.** Decided 28.09.2026 (Dim): every promo code, set, blog post and newsletter, and all eight own products (`c-…`, none of them in Shopify) with their price edits and stock rows, are test data; so are every stock count, stock move and barcode on staging, and all seven gift cards. The reset takes them with `--test-content --stock --gift-cards-are-test-cards`; the dry run with `--stock --test-content` lists every code, set, post title, newsletter subject and own product by name — Dim and Renat read the list and approve it (a real own product Renat adds before the day is kept with `--keep-product <id>`). **Stays:** imported products and their prices and edits, settings, letter texts, delivery prices, the bank list; the stock comes back from Shopify right after (step 4 of the day). Blog and «Наборы» hide themselves while there is no published post / active set and come back by themselves with the first one. Nothing by hand. After the reset, `/feed/google-en.xml` shows no own product. | to do |
| D R | **The last meeting with Renat.** 1) Which automatic letters go on right after the reset: unpaid orders, back in stock, abandoned cart, the abandoned-cart discount, birthday. 2) How courier parcels leave — Montonio cannot order a pickup by API: a recurring pickup per carrier in the Montonio account, or a drop-off. 3) How a refund is paid after the payout (Stage 1, last row). 4) What Renat must know: a full refund returns every line to stock (write off the unsellable by hand), a partial one moves neither stock nor points; the footer link goes, sign in at `rempireshop.com/admin`. | to do |
| D | **Close out the live-hour orders** (R-100095…R-100098 are real money; the reset deletes them and later refund notices for them are ignored): the refunds completed in Montonio; Montonio's report kept for the accountant; the DPD parcel 3888e013 cancelled if never handed over. Renat presses nothing on old orders — «Создать этикетку» on a sandbox-paid order books a real parcel. The sandbox refunds turning «overdue» ~29.09 are expected until the reset. | to do |
| D | **Rehearse the reset**: `.env.railway.txt` (two lines), one `db-backup`, a dry run — `node --env-file=.env.railway.txt tools/go-live-reset.mjs --stock --test-content`; read the TEST CONTENT list with Renat. | to do |
| D C | **Rehearse the stock import**: Shopify → Products → Inventory → Export (all variants, CSV); `node tools/import-shopify-stock.mjs --csv <file> --base https://rempireshop.diipsolutions.eu` with `RMP_ADMIN_COOKIE`. Writes nothing. «NEED A DECISION» should be empty. | to do |
| D | **Vercel environment**: `CRON_SECRET`, `RESEND_API_KEY`, `RESEND_TO`, `SESSION_SECRET` (never rotate), `DATABASE_SSL_*`, `MONTONIO_ENV=live` + the live pair; `PAYMENT_PROVIDER` unset. `PUBLIC_BASE_URL` is the staging host today and changes only on the day. Crons (`vercel.json`): flows `0 7 * * *` UTC = 10:00 Tallinn (09:00 after 25.10), events retention `30 3 * * *`. Region `fra1`. | to do |
| D | **Add `rempireshop.com` and `www.rempireshop.com` in Vercel** (Settings → Domains): www → 308 → apex; apex is the address `PUBLIC_BASE_URL` will name, so Montonio's notices arrive with no redirect. `rempireshop.diipsolutions.eu` stays attached with **no** redirect. Write down the A and CNAME values Vercel asks for. «Invalid configuration» until DNS moves is normal. | to do |
| D | **DNS at Cloudflare** (not ASCIO — that is only the registrar): TTL 300 on `A @` and `CNAME www`; note the rollback values `A @ 23.227.38.65`, `CNAME www shops.myshopify.com`. The keep-list, untouched on the day: `TXT google-site-verification`, `MX route1–3.mx.cloudflare.net` + SPF, `resend._domainkey`, `send` (MX + TXT) and `rsend`, `_dmarc`, `img.rempireshop.com` (R2 photos). | to do |
| D | **Vercel plan**: Hobby forbids commercial use (`docs/HOSTING.md`). **Decided 27.09.2026 (Dim): stay on Hobby for now**; revisit if Vercel writes about commercial use, a third cron is needed, the functions hit Hobby's limits, or a second person needs the project. | decided |

---

## Stage 4 — the day, in order

Tuesday to Thursday, from about 08:30 Tallinn time. **In order** — several steps
are only correct together. On `/golive/` each is its own numbered row.

1. **Backup.** `node --env-file=.env.railway.txt tools/db-backup.mjs` — a ✓ line
   and dozens of tables. No ✓ — stop.
2. **Reset — before 10:00 or after 11:00 Tallinn** (the flows cron fires in the
   10:00 hour; the 09:00 hour after 25.10). Dry run **with `--stock
   --test-content`**, read it (the TEST CONTENT list by name), paste the
   printed line — `--clear --confirm "…" --stock --test-content
   --gift-cards-are-test-cards` (decided 28.09.2026: the stock counts, moves
   and the 10 barcodes are test data too; step 4 writes the real counts into
   the empty «Склад»). Dry run again: `0` everywhere under CLEAR, STOCK and
   TEST CONTENT. No «Блог» and no «Наборы» on the storefront. Open
   «Подключения». Order numbers continue after the highest one.
   `docs/go-live-reset.md`.
3. **Automatic letters on** — exactly what the meeting with Renat agreed
   («Маркетинг → Письма»), never before the reset.
4. **Stock from Shopify — the last thing before DNS.** A fresh export
   (Shopify → Products → Inventory → Export → all variants, CSV), then:

   ```
   RMP_ADMIN_COOKIE=<rmp_admin cookie of a signed-in panel> \
     node tools/import-shopify-stock.mjs --csv <export.csv> --base https://rempireshop.diipsolutions.eu
   … the same --apply --confirm ИМПОРТ
   ```

   (PowerShell: `$env:RMP_ADMIN_COOKIE="…"` first.) The dry run prints
   before → after per size, what needs a decision, what has no shelf row and
   what gets overwritten; `--apply` writes each count absolutely through
   `POST /api/admin/inventory/moves/` («ручная правка», «Импорт из Shopify»),
   one idempotency key per row — a second run replays, it does not write
   twice. Formats read: Shopify's inventory export with a row per location
   (`Location`, `Available`, `On hand`, with or without «(not editable)» /
   «(current)»; «On hand (new)» ignored) or the older one with a column per
   location (available only). Hand decisions: `tools/shopify-stock-owner-rows.json`
   (`--owner-rows <file>` for another). «мало» only on the last unit
   (threshold 1, migration 215). Right after the reset, which ran with
   `--stock`: «Склад» is empty, every size reads «не считали → N» and nothing
   is overwritten; until this runs the storefront shows the manual in/low/out
   marks. After the reset also because the reset empties the
   test «Сообщить, когда появится» requests. Shopify keeps selling until DNS:
   an order there after the export is written off by hand (step 13).

4b. **Customers from Shopify («Покупатели из Shopify») — right after step 4,
   still before DNS.** Decided 28.09.2026 (Dim, option B): only customers with
   a name (first or last); their e-mail, their phone if there is one, and their
   default address if the shop delivers to its country. The address is kept
   with its country and **no delivery method** (Dim, 28.09, option b): the
   checkout opens on their country with its usual method, and the address
   fills the courier's three boxes only when they pick «Курьер» themselves; in
   the account «Доставка по умолчанию» shows the country with no row ticked.
   **No marketing consent:** everyone arrives with `marketing = false`, whatever
   Shopify says (Dim, 18.09) — and nobody is opted out either. No orders, notes,
   tags or totals. The export: Shopify → Customers → Export → All customers →
   Plain CSV; Shopify e-mails the file. Then:

   ```
   node --env-file=.env.railway.txt tools/import-shopify-customers.mjs --csv <customers_export.csv>
   … the same --apply --confirm ИМПОРТ-КЛИЕНТОВ
   ```

   The dry run prints counts and country codes only — never an e-mail, a name,
   a phone or an address. `--apply` writes everyone in one transaction, marked
   `customers.source = 'shopify'` (migration 221, which the deploy runs). An
   e-mail that already has an account is never touched, so a second run creates
   nothing, and nobody gets a code or a letter. After the reset, because the
   reset deletes every customer row; before DNS, so nobody signs in to an empty
   account first. On the 28.09 export: 428 rows → 391 customers, 307 with a
   phone, 316 with an address (3 more in the US/UK and 3 incomplete left out,
   the customers kept); 33 rows without a name and 4 without an e-mail skipped.

5. **`PUBLIC_BASE_URL=https://rempireshop.com` → Redeploy → READY.** That
   redeploy is the «regenerate»: canonicals, robots and sitemap for the live
   domain. **No orders on staging from here** — Montonio's notice and return
   addresses already name rempireshop.com, which is still Shopify.
6. **DNS at once**: `A @` and `CNAME www` to Vercel's values, «DNS only» (grey
   cloud); nothing else touched. Verify: `https://rempireshop.com/shop2/` 200
   with no `x-robots-tag`; `www` → 308 → apex; `/robots.txt` and `/sitemap.xml`
   on rempireshop.com; one `/products/…` → 301; `/feed/google-en.xml` 200; a
   POST to `/api/payments/notify/` answers **400, not 308**.
7. **Smoke**: `npm run smoke -- https://rempireshop.com`.
8. **Parcel webhook**: `node --env-file=.env.montonio-live.txt tools/montonio-webhook.mjs list`
   → `… register https://rempireshop.com/api/shipping/notify/` → «Подключения»
   green → `… delete <old id>` → `list` shows one webhook, four events.
9. **Renat** signs in at `rempireshop.com/admin` (the session is per address),
   adds it to the home screen again, switches notifications on there.
10. **First real order** on rempireshop.com — bank link, «Самовывоз в салоне»;
    refund it the next business day and see «Деньги возвращены» arrive.
11. **Merchant Center**, `docs/merchant-feed.md` step B: our three feeds beside
    the Shopify sources; the Shopify sources untouched.
12. **Search Console**: submit `https://rempireshop.com/sitemap.xml`, request
    indexing.
13. **Shopify orders** at 12:00, 18:00 and the next morning (72 hours in all) —
    fulfil and write off by hand; Shopify's domain untouched until Merchant
    step E. **At the end of the day delete `.env.railway.txt` and
    `.env.montonio-live.txt`.**

**Rollbacks.** The database: `pg_restore` from step 1 (`docs/go-live-reset.md`,
«Если всё-таки надо откатиться»). The build: `PUBLIC_BASE_URL` back to
`https://rempireshop.diipsolutions.eu` + Redeploy, or Vercel's Instant Rollback.
DNS: `A @ 23.227.38.65`, `CNAME www shops.myshopify.com`. The parcel webhook:
register the staging address again.

---

## Stage 5 — after the switch

| | | status |
|---|---|---|
| D | **What the live hour did not prove** (`docs/montonio-untested.md`): a refund reaching the customer and «Деньги возвращены»; the «Отправлен» letter on the first real parcel; a carrier refusal and «Отправить заново»; Omniva, SmartPosti, Unisend, Nova Post, a courier booking, a non-DPD label. Each on the first real order where it comes up. | after the switch |
| D C | **Every morning**, until something reports failures by itself: «Обзор» and «Подключения», and the flows cron's line in the Vercel log (no `CRON_SECRET` = a silent 503). Silence looks exactly like «no orders». | daily |
| D | **Keep the staging address** attached, no redirect, at least 6 weeks: notices for older orders, Renat's home-screen app, old push subscriptions. | 6 weeks |
| D | **Remove the Shopify feeds and shipping policies** — only once ours are «Approved» (`docs/merchant-feed.md`, C–E). | after review |
| D | **A week later compare the clicks** with the 175 they were (`docs/merchant-feed.md`, F). | a week later |
| D | **A database copy once a week** — Railway Hobby makes none (`tools/db-backup.mjs`), or Railway Pro. | weekly |
| D R | **Hand the services' billing to Renat** in the first month (`docs/renat-services.md`): Railway on the company card (an unpaid Railway bill stops the shop), OpenAI to the shop's account with a ~$10 limit and a new `OPENAI_API_KEY` + Redeploy, Zone.ee renewal date and registrant Rempire Store OÜ, Montonio invoices and delay e-mails, Shopify orders and customers exported before the plan is cancelled, the Telegram bot handed over through BotFather. | first month |

---

## Still undecided, not blocking

- A hidden **catalogue** product lives only under «Скрытые» (Dim, 26.09.2026).
- **The go-live readiness pass** was done on 27.09.2026 (Opus 5.5, Dim's
  choice): `docs/audit-2026-09-27-readiness.md`. The first pass (18.09, 56
  findings, `docs/audit-2026-09-18-findings.md`) has more than forty closed.
- After launch: the Estonian subsection words in the section titles
  (Search Console, 21.09).

---

## What is already done, so nobody redoes it

The function region moved to Frankfurt (14.09). Twenty owner decisions from the
audit are built and merged (17.09). The whole of round 23 is merged and deployed:
the scanner, per-size stock, the blog cover, three panel bugs, both Montonio
audits, and two chip fixes. Every shipping webhook was being silently discarded
and now is not. The phone country code was `372` for 28 of 32 destinations and
now is not. The live hour of 26.09 took real money by bank link, card and
Google Pay on the staging shop.
