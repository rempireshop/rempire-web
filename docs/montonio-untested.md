# Montonio: what has never run, and what to check in the first live hour

**Written 18.09.2026 · branch `r23-live-ready`.** English on purpose: this is the
engineer-to-engineer inventory. The owner-facing Russian version of the same
facts lives in `docs/payments.md` § 5a and `docs/shipping.md`.

---

## Why this document exists

On 18.09.2026 the owner opened Montonio's Partner System and found that
**«Refundable bank payments» is a separate product from «Bank payments»**, and
that its activation panel says:

> Product activation unavailable in test mode. Switch to live mode to proceed.

The same is true of Shipping and of several other products. So:

- three refunds that failed in testing were never going to work;
- **the refund path cannot be exercised in the sandbox even once**;
- a shop with «Bank payments» on and «Refundable bank payments» off looks
  perfect until the first customer asks for money back.

Everything below follows from that. The rule this branch works to: a path we
cannot run must be **right by construction** (built from the documentation's own
payloads, not from what our code happens to produce), must **fail informatively**
when it is wrong, and must **tell the owner what is missing before a customer is
standing in front of him**.

---

## Part 1 — What the sandbox cannot prove

One row per thing that has never run. «Stands in» is the test that exists
instead; every one of them is built from a payload printed on a Montonio page,
not from our own output.

> Why that distinction matters, in one sentence: the shipping webhook handler
> was broken for months because its test fixture was written flat to match the
> code, while the real payload nests everything under `data`. The suite was
> green the whole time. (`docs/montonio-shipping-audit.md` § 1.1)

### Payments

| # | Never run | Why it cannot run | Stands in for it |
|---|---|---|---|
| P1 | **A refund reaching a customer** | «Refundable bank payments» cannot be activated in test mode at all. Without it `isRefundableType` is `false` on every bank-link order. | `tests/montonio-docs-payloads.test.ts` → the guide's own `POST /refunds` 200 body, mapped to `pending`; `tests/payments-refund.test.ts` for the ledger |
| P2 | **A bank link, at all** | Dim, 08.09.2026: the sandbox Partner System says «Bank payments» is unavailable for test mode. The whole `paymentInitiation` method is a request shape we have never seen answered. | `tests/payments-montonio.test.ts` — that `payment.method: "paymentInitiation"` and the chosen `preferredProvider` go out correctly |
| P3 | **`availableForRefund` above 0** | Needs settled funds. «The funds have arrived to the merchant's settlement account in Montonio. This typically takes 1 business day.» Sandbox settles nothing. | The reference's own `GET /orders/:orderUuid` body, read by `fetchOrder()` — `tests/montonio-docs-payloads.test.ts` |
| P4 | **`isRefundableType: true`** | Same product switch as P1. | Same test; and `GET /api/admin/montonio/` surfaces the live value (Part 4) |
| P5 | **A refund refused by Montonio** — all five documented HTTP refusals | The account never gets far enough to produce four of the five; the fifth (bad keys) is not worth breaking a working sandbox for | `tests/payments-montonio-refusal.test.ts` (Montonio's five verbatim messages) + `tests/montonio-problems.test.ts` (one distinct action per refusal, RU/ET/EN) |
| P6 | **A refund webhook carrying `refundStatusDescription`** | It only arrives after a real refund. `INSUFFICIENT_FUNDS` in particular can never be produced in sandbox. | The refunds guide's own decoded `refundToken`, signed fresh — `tests/montonio-docs-payloads.test.ts`, including the `PENDING / INSUFFICIENT_FUNDS` variant |
| P7 | **A refund cancelled after ten days of PENDING** | Nothing pends in sandbox | `refundPendingText()` counts the clock down; `pendingRefunds()` lists them; `tests/montonio-problems.test.ts` |
| P8 | **`VOIDED`** — a bank taking back a payment it had reported as PAID | Only happens with real Payment Initiation | `mapMontonioStatus("VOIDED") → failed` in `tests/payments-montonio.test.ts`, and the refusal to downgrade a paid order in `tests/fuzz-money.test.ts` |
| P9 | **An underpaid order** (`payment.amountMismatch`) | The sandbox always pays the asked amount | `tests/payments-apply.test.ts` and `tests/payments-underpaid.test.ts`. **Decided 18.09.2026 and implemented 19.09.2026 (r27-pay-decisions): the order is HELD, not fulfilled** — see Part 5, D2 |
| P10 | **A lost webhook** and the order that stays unpaid because of it | Sandbox delivers everything | `tests/payments-reconcile.test.ts` drives the nightly sweep against a scripted `GET /orders/:orderUuid`. **Decided 18.09.2026, implemented 19.09.2026** — see Part 5, D3 |
| P11 | **`ABANDONED`** after `expiresIn` | We never send `expiresIn`, and sandbox orders are paid immediately | `mapMontonioStatus` handles the word. See Part 5, D4 |
| P12 | **The real enabled-methods list** | Depends entirely on which products this store has activated | `GET /api/admin/montonio/` reads it live; the guide's own response is pinned in `tests/montonio-docs-payloads.test.ts` |

### Shipping

| # | Never run | Why it cannot run | Stands in for it |
|---|---|---|---|
| S1 | **A carrier refusing a parcel** (`registrationFailed`) | Sandbox guide: «It doesn't make actual calls to carrier APIs and provides mocked responses instead.» The state is unreachable, not merely untested. | `tests/montonio-docs-payloads.test.ts` → a `POST /shipments` reply with `status: "registrationFailed"` through the real route, plus the webhook event; `tests/montonio-problems.test.ts` for the words |
| S2 | **Phone-number validation** | Sandbox guide: «The POST /shipments endpoint skips phone number and address validation.» Every wrong `phoneCountryCode` we ever sent passed. | `tests/shipping-montonio.test.ts` (`splitPhone` across all 32 destinations, fixed 18.09.2026) + S1's refusal path |
| S3 | **Address validation** | Same sentence | Same |
| S4 | **A real label PDF** | Sandbox guide: «The system generates dummy labels.» `normaliseLabelPdf()` has never seen a real Montonio label. | `tests/shipping-label-pdf.test.ts` rebuilds the same nesting with pdf-lib. An unrecognised file is served unchanged, so the failure is soft |
| S5 | **A real tracking number and a real `shipment.statusUpdated` vocabulary** | Nothing ships | `settings.shipping_statuses` records every word that ever arrives (`src/lib/shipping/webhook.ts`); the delivered/returned allow-list is still a guess and is marked as one |
| S6 | **`constraints.parcelDimensionsRequired: true`** | Needs a live carrier/method combination that has it | Nothing. We never read the flag and never send dimensions — see Part 5, D6 |
| S7 | **A SmartPosti drop-off code** (`dropOffPin`) | Needs `lockerSize` or a contract `defaultLockerSize`, neither of which exists in sandbox | Nothing. See Part 5, D7 |
| S8 | **`PATCH /shipments/{id}`** — the documented repair for a failed registration | Not implemented at all | Nothing. The refusal message tells the owner to pass the correction to Dim rather than to press again — see Part 5, D8 |
| S9 | **The parcel-events webhook being registered** | It is a manual step in the Partner System; nothing in this shop can notice it was skipped | `GET /api/admin/montonio/` asks `GET /webhooks` and reports it |
| S10 | **Which carriers this store is actually contracted for** | Sandbox contracts are not live contracts | `GET /api/admin/montonio/` reads `GET /carriers` (`hasMontonioContract`, `contracts[]`) |
| S11 | **A locker outside the Baltics being priced correctly** | The tariff mirror built without keys is subtype-blind | `docs/montonio-shipping-audit.md` § 3.1. Rebuild the mirror **with keys** before offering lockers outside EE/LV/LT |

### Products that cannot be activated in test mode at all

Owner-verified in the Partner System, 18.09.2026:

- **Refundable bank payments** → P1, P4, P5, P6, P7
- **Shipping** → the whole of the shipping table above
- «and several others» — the owner's words. Whatever else is on that list, the
  rule is the same: a product that cannot be switched on in test cannot be
  tested, and the first evidence will be a live customer.

---

## Part 2 — Before go-live: what only the owner can do

Nothing in the code can do any of these. In the order they bite.

- [ ] **Switch on «Refundable bank payments»** in the Partner System, in
      **live** mode. Without it no refund on a bank-link order will ever work.
      This is the single most important line in this document.
- [ ] **Switch on Shipping** in live mode, and the carriers used: Omniva, DPD,
      SmartPosti, Unisend, Nova Post.
- [ ] **Register the parcel-events webhook**: Partner System → Shipping →
      Webhooks → `https://<the live domain>/api/shipping/notify/`.
      **The trailing slash matters** — `trailingSlash` is on in
      `next.config.ts`, and a POST without it becomes a 308.
      Events: at least `shipment.registered`, `shipment.registrationFailed`,
      `shipment.statusUpdated`.
      (The *payment* webhook needs nothing: `notificationUrl` rides on every
      order.)
- [ ] **Set a `defaultLockerSize` on the SmartPosti contract**, or accept that
      the A4 slip's drop-off code will be blank (S7).
- [ ] **Business verification** for production API keys.
- [ ] Confirm the **live** `GET /stores/payment-methods` list is not empty. The
      guide: «if empty that means the paymentMethods have not been enabled for
      you store, contact customer support».

### Environment, on Vercel

- [ ] `MONTONIO_ACCESS_KEY` — **live** key
- [ ] `MONTONIO_SECRET_KEY` — **live** key, from the same pair
- [ ] `MONTONIO_ENV=live`
- [ ] `PUBLIC_BASE_URL=https://<the live domain>` — without it a proxy's `Host`
      header decides where Montonio sends the payment confirmation
- [ ] `SESSION_SECRET`
- [ ] `PAYMENT_PROVIDER` **unset** (or `montonio`) — never `mock`
- [ ] Redeploy. Vercel env changes need a rebuild, and both Vercel and CI skip a
      push with no file changes.

> Keys are per-environment and cannot be mixed. Live keys with
> `MONTONIO_ENV=sandbox` answer `401 STORE_NOT_FOUND`; a mismatched secret
> answers `403 INVALID_TOKEN`. Both now say so in the panel, in three
> languages.

---

## Part 3 — The first live hour, in order

Do these in this order. Each one is the cheapest way to learn something the
sandbox could not tell us.

### 3.1 Before any customer

- [ ] **Open «Подключения» in the panel.** Its Montonio rows are fed by
      `GET /api/admin/montonio/`, which is on this branch; the panel half is a
      patch handed to Dim separately, because `public/shop2/app.js` was owned
      by another agent on 18.09.2026. Until it is applied, read the same
      answer straight from the route (it is admin-only, so open it in the
      browser you are already logged into the panel with). Three things:
  - [ ] `env` says **live**
  - [ ] the enabled methods list contains `paymentInitiation` (bank links)
  - [ ] **`refundableBankPayments`** — this is the one. `false` means the
        product is off and no refund will work. `unknown` means there is no
        paid order to read it from yet, which is normal before the first sale.
- [ ] Shipping, on the same row: carriers listed, and
      **`webhookRegistered: true`**. If it is `false`, orders will never close
      by themselves and nothing else will tell you.

### 3.2 One real order, bought with your own money

- [ ] Place a real order in the shop. A small one — it will be refunded.
- [ ] Pay it with a **bank link** (not a card): that is the method most
      customers use and the only one whose refundability is in doubt.
- [ ] Back in the shop, the address should be `/shop2/done/?n=R-…&s=paid` and
      the order should read «оплачен» in the panel.
- [ ] The confirmation e-mail should arrive.
- [ ] Open «Подключения» again: `refundableBankPayments` now reads from this
      order. **If it says `false`, stop and fix the Partner System.**

### 3.3 The parcel

- [ ] On that order press **«Создать этикетку»**.
  - If it succeeds: a tracking code appears. Note that the **first real label
    PDF has never been through `normaliseLabelPdf()`** (S4) — open it and check
    it is one label on the page and not a 3.4× enlargement with half of it cut
    off. If it is wrong, the A6 option (`?size=A6`) is the fallback.
  - If it is refused: the panel now says **why**, in your language, and the
    order journal has a `shipment.registration_failed` row. The parcel exists
    at Montonio but is not registered — **do not press the button again**, it
    will repeat the same refusal by design.
- [ ] Check the **drop-off code** on the A4 slip. Blank means S7: set
      `defaultLockerSize` on the contract.
- [ ] Hand the parcel over and watch the order: within a day or two the
      `shipment.statusUpdated` webhook should move it to «Доставлен» by itself.
      If it never does, S9 (the webhook) or S5 (an unknown status word) is why;
      `settings.shipping_statuses` will show which.

### 3.4 The refund — the whole point of this document

- [ ] **Wait one business day.** Montonio: «The funds have arrived to the
      merchant's settlement account… This typically takes 1 business day.» A
      same-day refund will be refused and that is **normal**, not a fault.
- [ ] Press **«Вернуть деньги»** on that order. Read what happens:

| What the panel says | What it means | What to do |
|---|---|---|
| Refund recorded, and the pending line («деньги ещё не у покупателя») | Montonio accepted it but has not paid it out | Nothing. Check the order again tomorrow. It becomes a stuck refund only after a day |
| «Montonio пока нечего возвращать… доступно к возврату 0 €» | Either the funds have not settled, or **«Refundable bank payments» is off** | Wait a business day; if it repeats, the product is off — Part 2 |
| «Montonio готов вернуть не больше X €» | You asked for more than is left | Enter a smaller amount |
| «Этот возврат уже принят Montonio» | **The first attempt worked.** This is not a failure | Reload the order. Do not press again |
| «Montonio не узнал магазин» / «отверг подпись» | Wrong keys, or sandbox keys on live | Dim fixes the environment. Nothing was taken |
| «Montonio не принял возврат и назвал причину сам: "…"» | A refusal this shop has not been taught | Send Dim the quoted line verbatim |

- [ ] A day later, check the refund actually landed. If it is still pending:
      `GET /api/admin/montonio/` lists it under `pending` with its age.
      **Montonio cancels a refund it cannot fund after 10 days.**

### 3.5 What to watch for the rest of the first day

- [ ] The order journal for `order.refund_failed`, `order.refund_pending`,
      `order.refund_stuck` and `shipment.registration_failed` rows. All four are
      new and all four are things that used to happen silently.
- [ ] `settings.shipping_statuses` (via `GET /api/admin/settings/`) — the real
      carrier vocabulary, which nobody has ever seen.
- [ ] `settings.montonio_readiness` — the dated snapshot of what the shop
      believed it could do, written on every «Подключения» load.

---

## Part 4 — What this branch built instead of the tests it could not run

| Built | Where | What it replaces |
|---|---|---|
| One vocabulary of documented failures, RU/ET/EN, with «quote Montonio» as the fallback for anything unrecognised | `src/lib/montonio-problems.ts` | One Russian sentence that named the one cause the API cannot produce |
| Each refund refusal answered with its own `reason` + `messages`, and an audit row carrying the reason | `src/app/api/admin/orders/[id]/refund/route.ts` | `provider_rejected` and nothing else |
| A pending refund reported as pending, journalled, and listable afterwards | same route + `src/lib/payments/pending-refunds.ts` | «возврат ушёл» for a refund Montonio may cancel in ten days |
| `refundStatusDescription` carried off the webhook and journalled as `order.refund_stuck` | `src/lib/payments/refund.ts`, `src/lib/payments/montonio.ts`, `src/app/api/payments/notify/route.ts` | the reason disappearing into a ledger `detail` field |
| A refused shipment registration answered as a refusal, stored anyway, journalled, and repeated on a second press | `src/app/api/admin/shipments/route.ts` | «Этикетка готова ✓» for a parcel that will never move |
| `shipment.registrationFailed` written to the journal per order, not once per new word | `src/app/api/shipping/notify/route.ts` | one line in a settings blob |
| A readiness probe: enabled methods, `isRefundableType` from a real order, carriers and contracts, registered webhooks, stuck refunds — recorded in `settings.montonio_readiness` | `src/app/api/admin/montonio/route.ts` | nothing at all |
| A label refused for a shipment the carrier never registered, with the same words | `src/app/api/admin/shipments/[id]/label/route.ts` | `POST /label-files` failing inside Montonio with nothing to explain it |
| Every documented payload above, pinned | `tests/montonio-docs-payloads.test.ts`, `tests/montonio-problems.test.ts` | fixtures written to match our own code |
| The panel half — one sentence per refusal, the pending line, the readiness rows | **not applied**: `public/shop2/app.js` was another agent's on 18.09.2026. The exact patch (10 hunks, `node --check` and `i18n-gaps` clean) is in the hand-off report | — |

### Does Montonio expose which products are active?

**Partly, and not the one that matters.**

- **Yes, for payment methods.** `GET /stores/payment-methods` returns *only* the
  methods the store has enabled, each as a key of `paymentMethods`
  (`paymentInitiation`, `cardPayments`, `mobilePay`, `blik`, `bnpl`,
  `hirePurchase`). Key present = product on. The guide states what empty means
  and nothing more: «if empty that means the paymentMethods have not been
  enabled for you store, contact customer support».
- **No, for anything else.** The Stargate API reference documents six paths in
  total — `/stores/payment-methods`, `/orders`, `/orders/:orderUuid`,
  `/refunds`, `/payment-links`, `/sessions` — and no store, product or
  activation resource among them. **«Refundable bank payments» has no
  endpoint.** Its only trace anywhere in the API is one boolean on one order:
  > `"isRefundableType": false, // will be true if you enabled refunds in montonio (and the user paid with a refundable method)`
  > — API reference § Get Order by UUID
  So the readiness route probes the newest paid order rather than asking a
  question that has no answer, and reports `unknown` (not `false`) when there is
  no order to ask about.
- **Yes, for shipping.** `GET /carriers` carries `hasMontonioContract` and the
  shop's own `contracts[]` per country; `GET /webhooks` says whether the
  parcel-events URL was ever registered.

---

## Part 5 — Decisions still open

Each of these is written out in full in the two audits. None is applied,
because each changes what counts as paid, what is refunded, what is trusted
from a webhook, or what the shop charges.

| # | Open question | Written up in |
|---|---|---|
| ~~D1~~ | ~~Strict `accessKey` / `uuid` checks on the order token~~ · **done 19.09.2026** (r27-pay-decisions). Both checks tightened; a mismatch asks `GET /orders/:uuid` instead of refusing — `src/lib/payments/token-guard.ts`, `tests/payments-token-guard.test.ts` | payments audit § A4 |
| ~~D2~~ | ~~**Hold an underpaid order instead of fulfilling it** (P9)~~ · **done 19.09.2026**. `payment.held` + an `order.payment_held` journal row; no stock, no cards, no letter — `src/lib/payments/apply.ts`, `tests/payments-underpaid.test.ts` | payments audit § A6 |
| ~~D3~~ | ~~A reconcile pass over `GET /orders/:orderUuid` for lost webhooks (P10)~~ · **done 19.09.2026**. Nightly, through the same `settlePayment()` door — `src/lib/payments/reconcile.ts`, `/api/cron/payments-reconcile/`, `tests/payments-reconcile.test.ts` | payments audit § B1 |
| D4 | Send `expiresIn`, matched to the unpaid-order cron (P11) | payments audit § B2 |
| D5 | Enforce Montonio's own 0.05 € refund floor in the panel | payments audit § C3 |
| D6 | Read `constraints.parcelDimensionsRequired` and declare a carton (S6) | shipping audit § 1.6 |
| D7 | `lockerSize`, or `defaultLockerSize` on the contract (S7) | shipping audit § 4 |
| D8 | Implement `PATCH /shipments/{id}` so a refused parcel can be repaired from the panel (S8) | shipping audit § 1.5 |
| D9 | **A pending refund still sends the customer «Деньги возвращены».** `notifyOrderClosed()` fires for anything that is not `failed`, so a refund Montonio has only accepted — and may cancel in ten days — is announced to the customer as done. Changing it changes what a customer is told about money, so it is a decision, not a fix | this branch, `src/app/api/admin/orders/[id]/refund/route.ts` |
| D10 | Drop non-EUR banks from the checkout list | payments audit § C2 |

---

## Part 6 — The two-line summary, for the day itself

1. **Turn on «Refundable bank payments» in live mode before the first sale.**
   Nothing in the code can do it, nothing in the sandbox can prove it, and the
   first customer to ask for money back is how you would otherwise find out.
2. **Register the shipping webhook, with the trailing slash.** Otherwise
   parcels are delivered and orders never close, and nothing complains.
