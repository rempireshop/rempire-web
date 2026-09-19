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
| D | **Take a Railway snapshot and verify it exists.** Not "start one" — confirm it is there and restorable. Everything below is reversible only from this. | to do |
| D | Confirm the production database is the same Railway instance staging uses. It is, as of 18.09 — worth re-confirming the day of. | confirmed 18.09 |

---

## Stage 1 — Montonio, which gates the most

Most of this is one meeting. Until it happens, several things below cannot be
finished, and two cannot even be tested.

| | | status |
|---|---|---|
| D R | **Finish the Montonio account** and obtain **live API keys**. Planned for Sunday with Renat. | planned |
| D | **Activate «Refundable bank payments»** in live mode. It is a separate product and **cannot be activated in test mode at all** — their panel says so. «Bank payments» alone does not include refunds. This is why three refunds failed on 18.09; it was never our code and never the balance. | blocked on live mode |
| D | **Enable the PIN service on the DPD carrier account.** Without it the drop-off code does not issue. | to do |
| D | **Set `defaultLockerSize` on the SmartPosti contract.** Without it, and without a per-shipment size, *no drop-off code is issued at all* — Renat's complaint of 13.09. The per-shipment choice is being built; this is the safety net under it. | to do |
| C | Rebuild the tariff mirror **with keys**, so locker prices come from the `parcelMachine` subtype instead of a subtype-blind row from an undocumented endpoint. `tools/fetch-montonio-tariffs.mjs` already prefers the right rate — it has only ever run without credentials. | ready, needs keys |
| C | Produce the pricing grid — country × weight band × locker size — and the break-even flat price per zone. Tool and `docs/delivery-pricing.md` being built now. | in progress |
| R D | **Choose the flat price per zone** from that grid. Renat charges one price per country and absorbs the variance, so this is his margin decision, taken with real numbers instead of guesses. The tool names three candidates per country — break-even at a typical order, midpoint, and never-loses — and says which order size each one starts losing at. | blocked on the grid |

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
| D | **Build a feed from the shop's own catalogue and add it beside the Shopify ones.** `tools/build-merchant-feed.mjs` exists but writes from the old `public/shop/catalogue2.js` with the staging domain, and nothing in the build runs it — `public/feed/google-shopping.xml` is dated 03.09 and was submitted nowhere. Repoint it at shop2, give it the live domain, run it in `prebuild`. Beside, not instead: while both are there they can be compared. | blocking |
| D | **Rewrite the shipping policies from the real Montonio prices.** They are Shopify's today — a flat €15.00, 4–12 days, one per country — against real prices of roughly €5–60 by country and carrier. A feed that disagrees with the product page is the commonest cause of suspension, and it would surface on the day of the switch. | blocking |
| D | Remove the Shopify feeds, **only after ours has run for a day**. The shop has ~224 products against Shopify's 328; worth seeing in advance which listings would vanish. | after |
| D | A week after the switch, compare the clicks with the 175 they were. A fall is nearly always products failing review, or feed shipping disagreeing with the page. | after |

---

## Stage 3 — the code, all of it Claude's

| | | status |
|---|---|---|
| C | The eight answered go-live decisions. Four shipping ones are being built now: declare a **small** default carton and read the required-dimensions flag, choose locker size at label time with an automated default, open the rest of Europe as an editable list, and show a refused registration instead of reporting success. No weight modelling — decided against on 18.09, see Stage 2. The per-shipment override is the safety valve and has to be one tap. | in progress |
| C | ~~The four payment ones~~ **Done, night of 19.09**: a short-paid order is held rather than marked paid (`payment.held`, `shortPayment` in `src/lib/payments/apply.ts`); both webhook checks tightened and a mismatch re-asks Montonio through `GET /orders/:uuid`; a nightly sweep picks up orders stuck unpaid because their notification never arrived (`src/lib/payments/reconcile.ts`). On 19.09 a held order also became findable from the list — its own badge, a «Придержаны» chip and a row in «Сделать сегодня». | done |
| C | Harden every path the sandbox cannot exercise, and write `docs/montonio-untested.md` — the honest inventory of what has never run and what must be checked by hand in the first live hour. | in progress |
| C | ~~Fix the **13 end-to-end failures**~~ **Done 18.09**, merge `0fbd940` — «thirteen red browser probes, two real bugs»; the other eleven were probes that had fallen behind the shop. The unit suite is 4400+ and green. The browser suite has not been run since: one more run belongs in «Final pass» below. | done |
| C | The go-live reset tool and `docs/go-live-reset.md`. Dry run by default, explicit confirmation to clear, asserts the keep-list survived. | in progress |
| D C | **The Google Shopping feed is a Merchant Center risk and must not be submitted as it stands.** `tools/build-merchant-feed.mjs` hardcodes the **staging** host, reads stock from the generated catalogue alone, and is **not in `prebuild`** — so it is only as fresh as the last manual run. Submitted today every `g:link` would point at a `noindex` host, and `g:availability` is the field that gets Merchant Center accounts suspended. Found 18.09 by the SEO audit. **Decided by Dim, 19.09.2026: not now.** The feed stays out of the build and nothing is submitted; the question is re-opened once the shop is live and the stock numbers have settled. Nothing to do before launch. | decided: not now |
| C | Replace `public/shop/legal.js` — the fallback privacy policy still names **Shopify** as the data processor. Unreachable today, embarrassing on a live shop. | to do |
| C | ~~Correct the panel's «проверьте баланс в его панели»~~ **Done 18.09.** By Montonio's own documentation a refund with no money behind it is answered `200 PENDING`, never an HTTP error — so the panel was sending the owner to look at the one thing it could never be. Each documented refusal now carries three sentences of its own (`src/lib/montonio-problems.ts`), and a test stops any of them mentioning the balance again. | done |
| C | Final pass: regenerate the bundle and the prerender, full suite, push, and confirm `index.html` carries no `localhost:` and exactly two `boot.js` references. | at the end |

---

## Stage 4 — the switches, the day itself

In order. Several of these are only correct **together**.

| | | status |
|---|---|---|
| D | Set the live Montonio keys **and** the environment flag together. Half of this pair is worse than neither. | to do |
| D | Set `PUBLIC_BASE_URL`. Without it the prerender writes live URLs carrying `noindex` — the pages say «noindex, nofollow» today and `robots.txt` is the staging policy. | to do |
| D | Set `SESSION_SECRET`. It is now load-bearing for the order-status token that recovers an abandoned basket. Unset, it **fails closed silently**: basket recovery simply never works and nothing says so. | to do |
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
