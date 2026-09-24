# Going live — the whole list

Written 18.09.2026, target **next week**. This is the spine; the detailed
documents it points at are written by the work itself and are named where they
exist.

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
audit. Where an item is already built, it says so.

This list is also a page — **`/golive/`** on the staging domain. Same items, the
owner shown on each one, the dependencies drawn, and the whole of stage 4 and 5
shut behind stage 0–3 because that is the rule: everything done on diipsolutions
before the domain moves. It is built from `src/data/golive.json`, which is
written out of this file, so this document stays the spine — but the page is
what gets worked from a phone, and it is where Claude ticks an item off as the
work lands (`PUT /api/golive/`). Change this file and the page's file together.

---

## Stage 0 — before anything else

| | | status |
|---|---|---|
| D | **Take a copy of the database and verify it reads back.** Railway's Backups tab is Pro-only (checked 23.09), so the copy is a file: `node --env-file=.env.railway.txt tools/db-backup.mjs` (pg_dump in Docker; `docs/go-live-reset.md` step 1). Restore proven on a test database 23.09. Everything below is reversible only from this. | to do |
| D | Confirm the production database is the same Railway instance staging uses. It is, as of 18.09 — worth re-confirming the day of. | confirmed 18.09 |

---

## Stage 1 — Montonio, which gates the most

Most of this is one meeting. Until it happens, several things below cannot be
finished, and two cannot even be tested.

| | | status |
|---|---|---|
| D R | **Finish the Montonio account** and obtain **live API keys**. Dim signed in with a «Juhataja» account and took the keys on 23.09. They live in a password manager — never in a chat, Telegram or an e-mail — and reach Vercel only on the day of the live check (Stage 4). | done 23.09 |
| R | **Activate «Refundable bank payments»** in live mode. It is a separate product and **cannot be activated in test mode at all** — their panel says so. «Bank payments» alone does not include refunds. This is why three refunds failed on 18.09; it was never our code and never the balance. **Only a Montonio account holding the «Juhataja» (manager) role or above can switch it on — Renat's account, not Dim's** (Montonio, in writing, 22.09.2026). It has a price: with refunds on, **payouts arrive one business day later and in the merchant's own company name.** **Requested 23.09 — the panel shows it «In review»; the live refund waits for «Completed».** | in review |
| D | **Set up the live Partner System** (looked at 23.09). Bank links and cards ready. Payment links (10 €/month) and BLIK (zloty only) are not needed. Omniva, DPD, SmartPosti and International Shipping (Nova Post) are on; **Unisend is off although the checkout offers it** — turn it on: parcel-machine hand-over, default size S, SMS return code on. Return codes on for Omniva and DPD too. Add-ons: «Parcel delay and risk notifications» yes (it flags a parcel nobody collects, which costs the delivery twice); tracking page and tracking e-mails no — the shop sends its own letters. Sender address Mardi 1, where returns come back. | in progress |
| D C | **Check the live account without money**: put the live pair in `.env.montonio-live` (gitignored), run `node --env-file=.env.montonio-live tools/montonio-live-check.mjs` and, for prices, `tools/fetch-montonio-tariffs.mjs --dry` with the same file; then delete the file. GET requests only. It says which payments and banks are on per country, whether every carrier the checkout offers can be booked, and whether the parcel webhook is registered. **Ran 23.09:** all 105 checkout routes bookable; 11 zloty-only Polish banks hidden by the checkout; the parcel webhook not yet registered. | done 23.09 |
| D C | **Register the parcel webhook** — Montonio has no screen for it, API only: `node --env-file=.env.montonio-live.txt tools/montonio-webhook.mjs register https://rempireshop.diipsolutions.eu/api/shipping/notify/` — trailing slash, or the POST is lost in a 308. Registered 23.09 with three events (`shipment.registered`, `shipment.registrationFailed`, `shipment.statusUpdated`; src/data/golive.json «shipping-webhook»). Re-point it at rempireshop.com when the domain moves. | done 23.09 |
| D | **Re-register the parcel webhook with the new event list (24.09).** Montonio's answer of 24.09.2026 gave the full enum — six events. The shop now subscribes four: the three above plus **`shipment.labelsCreated`** (`EVENTS` in `tools/montonio-webhook.mjs`); the two `labelFile.*` events are about label PDFs, which the shop makes synchronously, so they are not asked for (and are acknowledged and ignored if they ever arrive). Montonio has no «update webhook» call, so: `… tools/montonio-webhook.mjs list` (note the old id) → `… register https://…/api/shipping/notify/` → `… delete <old id>` → `list` again shows one webhook with four events. Between register and delete an event may arrive twice; the route is idempotent. **Not urgent**: the three registered events already cover everything that moves an order — and since 24.09 the daily cron re-asks Montonio (`GET /shipments/{id}`) for every shipment quiet for 12 hours and applies the answer as the webhook would (`syncStaleShipments`, `src/lib/shipping/shipment-sync.ts`), so a lost event costs at most a day — so this can wait for the domain move, which needs a `register` anyway — but it must be done then, with this list. Needs the live keys and Dim's OK; Claude did not run it. | to do |
| ~~D~~ | ~~Enable the PIN service on the DPD carrier account.~~ ~~Set `defaultLockerSize` on the SmartPosti contract.~~ **Cancelled 22.09** — Montonio's written answer of 22.09.2026: a drop-off / door code works **only on a merchant's own direct contract with the carrier**, is arranged with that carrier's help, and is aimed at marketplace platforms; **Omniva has no such option at all.** A normal merchant — which this shop is — **scans the printed label at the parcel machine** and the parcel goes. There is nothing to switch on, and a **blank drop-off code line is the normal outcome, not a fault.** The `dropOffPin` plumbing stays as it is: the panel and the A4 slip print a code only when one actually arrives. | cancelled |
| C | Rebuild the tariff mirror **with keys**, so locker prices come from the `parcelMachine` subtype instead of a subtype-blind row from an undocumented endpoint. `tools/fetch-montonio-tariffs.mjs` already prefers the right rate — it has only ever run without credentials. **Ran 23.09 with the live keys: the store's contract prices match the table in all 111 rows — nothing to overlay.** The checkout price is the calculator's price + 24 % VAT, rounded up to …,X9; the calculator shows prices without VAT. | done 23.09 |
| C | Produce the pricing grid — country × weight band × locker size — and the break-even flat price per zone. Tool and `docs/delivery-pricing.md` being built now. Done as `docs/montonio-routes.md`. | done 22.09 |
| R D | **Choose the flat price per zone** from that grid. Renat charges one price per country and absorbs the variance, so this is his margin decision, taken with real numbers instead of guesses. The tool names three candidates per country — break-even at a typical order, midpoint, and never-loses — and says which order size each one starts losing at. Cancelled: delivery follows Montonio's calculator — type, then carrier, each at its own price. | cancelled 22.09 |

---

## Stage 2 — what only Renat knows

| | | status |
|---|---|---|
| ~~R~~ | ~~Weigh the products.~~ **Cancelled 18.09** — the owner's decision, and the reasoning is worth keeping. Montonio bills `max(actualWeight, volumetricWeight)` and volumetric is dimensions ÷ 5000, so a 30×30×30 carton is 5.4 kg *whatever is inside it*. At this shop's parcel sizes the declared box is what gets paid for, not the contents. A small default carton captures nearly all of the saving with none of the work, and the rare heavy order is an accepted loss taken deliberately in exchange for one stable price. Nothing waits on this any more. | cancelled |
| R | ~~Which Kevin.Murphy sprays are pressurised aerosols.~~ **Closed by Dim, 19.09.2026: «forget about it, it's fine».** Nothing in the shop asks the question any more. | closed |
| R | Whether to give **Shopify collaborator access** to import existing products and customers. Optional. If it happens: **imported customers arrive with no marketing consent** (Dim, 18.09) — and that is not the same as opting them out. They have simply never opted in. | undecided |

---

## Stage 2b — Google Shopping, which carries free traffic

Found on 19.09.2026 and written down nowhere until then. Merchant Center
account `5819586565` («Rempire Tower Shop») is **live and earning**: 175 clicks
in 28 days from free listings, ad spend €0.00, 1.63K approved / 325 limited /
17 not approved. Every product in it is fed by **six `Shopify App API`
sources** of 328 products each — Estonia, Latvia, Lithuania and Finland in
English, a Russian one for Belarus/Georgia/Kazakhstan+3, and one covering 82
more countries. The overview's "1.97K products" is the same 328 items counted
once per market. "Found by Google", crawling `rempireshop.com`, has found **2**.

So the day Shopify is switched off, those six feeds stop updating, the listings
go stale and drop, and the free traffic goes with them. This is a go-live
dependency, not a later job.

| | | status |
|---|---|---|
| D R | **Where `rempireshop.com` points today, and which domain the account has claimed.** Decides whether the cutover is a feed swap or also a re-verification. Nothing else here can be planned until it is answered. | blocking |
| D | **Build a feed from the shop's own catalogue and add it beside the Shopify ones.** **Built 23.09:** three live feeds, `/feed/google-en.xml`, `-et.xml` and `-ru.xml`, answered by the shop on every fetch (`src/lib/merchant-feed.ts`) — every size its own item at the checkout's price, stock per size, hidden products left out, links always on rempireshop.com. The old `tools/build-merchant-feed.mjs` and its static file are gone. Left: on the switch day add them in Merchant Center beside the Shopify ones — `docs/merchant-feed.md`, steps A–F. The item ids are new, so Google reviews every item (1–3 days): beside, not instead. | built, not submitted |
| D | **Rewrite the shipping policies from the real Montonio prices.** They are Shopify's today — a flat €15.00, 4–12 days, one per country. **Covered by the feed since 23.09:** every item carries its own `g:shipping` per country — the cheapest locker and courier the checkout charges, 0 € from the free-delivery threshold — and an item's own shipping outranks the account's policies. The Shopify policies are deleted once the Shopify sources are (`docs/merchant-feed.md`, step C). | built, not submitted |
| D | Remove the Shopify feeds, **only after ours has run for a day**. The shop has ~224 products against Shopify's 328; worth seeing in advance which listings would vanish. | after |
| D | A week after the switch, compare the clicks with the 175 they were. A fall is nearly always products failing review, or feed shipping disagreeing with the page. | after |

---

## Stage 3 — the code, all of it Claude's

| | | status |
|---|---|---|
| C | The eight answered go-live decisions. Four shipping ones are being built now: declare a **small** default carton and read the required-dimensions flag, choose locker size at label time with an automated default, open the rest of Europe as an editable list, and show a refused registration instead of reporting success. No weight modelling — decided against on 18.09, see Stage 2. The per-shipment override is the safety valve and has to be one tap. All four built 18–19.09; since 23.09 the carton is 25 × 18 × 8 and the default locker S (migration 203). | done 19.09 |
| C | ~~The four payment ones~~ **Done, night of 19.09**: a short-paid order is held rather than marked paid (`payment.held`, `shortPayment` in `src/lib/payments/apply.ts`); both webhook checks tightened and a mismatch re-asks Montonio through `GET /orders/:uuid`; a nightly sweep picks up orders stuck unpaid because their notification never arrived (`src/lib/payments/reconcile.ts`). On 19.09 a held order also became findable from the list — its own badge, a «Придержаны» chip and a row in «Сделать сегодня». | done |
| C | Harden every path the sandbox cannot exercise, and write `docs/montonio-untested.md` — the honest inventory of what has never run and what must be checked by hand in the first live hour. | done |
| C | ~~Fix the **13 end-to-end failures**~~ **Done 18.09**, merge `0fbd940` — «thirteen red browser probes, two real bugs»; the other eleven were probes that had fallen behind the shop. The unit suite is 4400+ and green. The browser suite has not been run since: one more run belongs in «Final pass» below. | done |
| C | The go-live reset tool and `docs/go-live-reset.md`. Dry run by default, explicit confirmation to clear, asserts the keep-list survived. Tool, doc and `tests/go-live-reset.test.ts`. | done 19.09 |
| D C | ~~The Google Shopping feed is a Merchant Center risk and must not be submitted as it stands.~~ Found 18.09 by the SEO audit (staging host, file stock only, not in the build); Dim, 19.09.2026: not that one. **Replaced 23.09** by the live feeds above — stock from the overrides and the counted shelf, links on the live domain, nothing to run by hand. Nothing is submitted before the switch. | done 23.09 |
| C | Replace `public/shop/legal.js` — the fallback privacy policy still names **Shopify** as the data processor. Unreachable today, embarrassing on a live shop. | to do |
| C | ~~Correct the panel's «проверьте баланс в его панели»~~ **Done 18.09.** By Montonio's own documentation a refund with no money behind it is answered `200 PENDING`, never an HTTP error — so the panel was sending the owner to look at the one thing it could never be. Each documented refusal now carries three sentences of its own (`src/lib/montonio-problems.ts`), and a test stops any of them mentioning the balance again. | done |
| C | Final pass: regenerate the bundle and the prerender, full suite, push, and confirm `index.html` carries no `localhost:` and exactly two `boot.js` references. | at the end |

---

## Stage 4 — the switches, the day itself

In order. Several of these are only correct **together**.

| | | status |
|---|---|---|
| D | Set the live Montonio keys **and** the environment flag together. Half of this pair is worse than neither. Vercel → Production: `MONTONIO_ACCESS_KEY`, `MONTONIO_SECRET_KEY`, `MONTONIO_ENV=live`, then redeploy. Keep the sandbox pair for later checks. **Before this step, finish every /test check that pays in the sandbox** — after it, every order on staging is real money. | to do |
| D | Set `PUBLIC_BASE_URL`. Without it the prerender writes live URLs carrying `noindex` — the pages say «noindex, nofollow» today and `robots.txt` is the staging policy. **Not before the domain moves**: while the live keys are tried on diipsolutions, leave it unset — set to rempireshop.com while that domain is still on Shopify, it sends Montonio's payment confirmations to Shopify and orders never turn paid. | to do |
| D | Set `SESSION_SECRET`. It is now load-bearing for the order-status token that recovers an abandoned basket. Unset, it **fails closed silently**: basket recovery simply never works and nothing says so. Set: the panel login refuses without it, and the panel works on staging — same Vercel project. | done |
| C | Regenerate and deploy so the pages carry the production robots policy. Must happen **after** `PUBLIC_BASE_URL` is set, not before. | after D |
| D | **Run the reset tool** — dry run first, read it, then confirm. | after the snapshot |
| D | Switch on the unpaid-payment flow if wanted. It cancels after 7 days and releases the historic backlog **silently**, which is the behaviour chosen on 17.09. It is off today. | optional |
| D | Point the domain at Vercel — DNS is at **ASCIO**. | to do |
| D | Verify the function region is still `fra1`. Set in `vercel.json` and in the dashboard; they agree. | done 14.09 |
| D | Confirm the two cron schedules in `vercel.json` are what you want running against real customers. | to check |

---

## Stage 5 — the first hour live

| | | status |
|---|---|---|
| D | Work through `docs/montonio-untested.md` by hand. It exists because these paths **cannot** be proved in a sandbox: a real refund, a carrier actually refusing a registration, a real label PDF, phone and address validation the sandbox skips entirely. | after cutover |
| D | Place one real order, end to end, and refund it. This is the first time refunds will ever have run. | after cutover |
| C | Smoke the live site and compare against staging. | after cutover |
| D | Confirm something tells you when a payment webhook fails. | to check |

---

## Still undecided, not blocking

- A hidden **catalogue** product now drops out of «Мало»/«Нет», the «Склад» tab
  count and the assistant's low-stock answer, where before it nagged. Deliberate,
  and reversible in about five lines if Renat disagrees.
- **The second Fable 5.1 pass.** The first was done on 18.09: a regression
  review of the diff, 56 findings in `docs/audit-2026-09-18-findings.md`, more
  than forty of them closed — including the only serious one, a double refund on
  a mixed tender. The second, the go-live readiness pass, **moves to after
  launch week** (Dim, 19.09). It does not block the launch.
---

## What is already done, so nobody redoes it

The function region moved to Frankfurt (14.09). Twenty owner decisions from the
audit are built and merged (17.09). The whole of round 23 is merged and deployed:
the scanner, per-size stock, the blog cover, three panel bugs, both Montonio
audits, and two chip fixes — 171 test files, 3834 tests, green, at `df09a8e`.
Every shipping webhook was being silently discarded and now is not. The phone
country code was `372` for 28 of 32 destinations and now is not.
