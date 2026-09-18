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
| R D | **Choose the flat price per zone** from that grid. Renat charges one price per country and absorbs the variance, so this is his margin decision, taken with real numbers instead of guesses. | blocked on the grid |

---

## Stage 2 — what only Renat knows

| | | status |
|---|---|---|
| R | **Weigh the products.** The catalogue holds no weight for any of 220 items; 113 carry a volume and nothing else. International prices move with weight, so until this exists a flat price per zone is a bet on every heavy order. The 14 own-brand products have no public data by definition. | open since 14.09 |
| R | **Which Kevin.Murphy sprays are pressurised aerosols.** Carriers restrict them — this decides whether they may be shipped abroad at all, separately from price. | open since 14.09 |
| R | Whether to give **Shopify collaborator access** to import existing products and customers. Optional. If it happens: **imported customers arrive with no marketing consent** (Dim, 18.09) — and that is not the same as opting them out. They have simply never opted in. | undecided |

---

## Stage 3 — the code, all of it Claude's

| | | status |
|---|---|---|
| C | The eight answered go-live decisions. Four shipping ones are being built now: read the required-dimensions flag and declare a carton, choose locker size at label time with an automated default, open the rest of Europe as an editable list, and show a refused registration instead of reporting success. | in progress |
| C | The four payment ones: hold an order paid short instead of marking it paid, tighten the two webhook checks and ask Montonio on a mismatch, and sweep for orders stuck unpaid because a notification never arrived. | queued |
| C | Harden every path the sandbox cannot exercise, and write `docs/montonio-untested.md` — the honest inventory of what has never run and what must be checked by hand in the first live hour. | in progress |
| C | Fix the **13 end-to-end failures** that already exist on main. The unit suite has been green throughout at 3834 tests; the browser suite has been quietly red and nobody was looking. | in progress |
| C | The go-live reset tool and `docs/go-live-reset.md`. Dry run by default, explicit confirmation to clear, asserts the keep-list survived. | in progress |
| C | Replace `public/shop/legal.js` — the fallback privacy policy still names **Shopify** as the data processor. Unreachable today, embarrassing on a live shop. | to do |
| C | Correct the panel's «проверьте баланс в его панели» — it names the one cause of a refused refund that is impossible. Exact replacement already written. | to do |
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
- The two Fable 5.1 passes agreed on 17.09 — a regression review of the diff, and
  a go-live readiness pass. Waiting on the owner's re-test of the marked checks.
  This document overlaps the second one heavily; the review is still worth running
  because it reads what was written, not what was intended.

---

## What is already done, so nobody redoes it

The function region moved to Frankfurt (14.09). Twenty owner decisions from the
audit are built and merged (17.09). The whole of round 23 is merged and deployed:
the scanner, per-size stock, the blog cover, three panel bugs, both Montonio
audits, and two chip fixes — 171 test files, 3834 tests, green, at `df09a8e`.
Every shipping webhook was being silently discarded and now is not. The phone
country code was `372` for 28 of 32 destinations and now is not.
