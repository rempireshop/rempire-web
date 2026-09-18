# Montonio Payments (Stargate) — pre-production audit

**Date:** 18.09.2026 · **Branch:** `r23-montonio-payments` · **Base:** `main` @ `d666439`

Every page of Montonio's payments documentation was read in full and quoted from the
page itself, not from memory:

| Page | URL |
| --- | --- |
| Payments overview / Lifecycle of an Order / Lifecycle of a Refund | <https://docs.montonio.com/api/stargate/overview> |
| Integration checklist | <https://docs.montonio.com/api/stargate/checklist> |
| Display payment methods | <https://docs.montonio.com/api/stargate/guides/payment-methods> |
| Create and validate an Order | <https://docs.montonio.com/api/stargate/guides/orders> |
| Refund an Order | <https://docs.montonio.com/api/stargate/guides/refunds> |
| Listen to webhooks | <https://docs.montonio.com/api/stargate/guides/webhooks> |
| Embedded Cards / Embedded BLIK / Financing / Payment links / Payouts | `…/guides/embedded-cards`, `…/embedded-blik`, `…/financing`, `…/payment-links`, `…/payouts` |
| UI widgets | <https://docs.montonio.com/api/stargate/widgets> |
| API reference (URLs, Authentication, all endpoints) | <https://docs.montonio.com/api/stargate/reference> |
| API changes | <https://docs.montonio.com/api/stargate/changes> |
| Help centre: refunds process, refundable bank payments, merchantReference | <https://help.montonio.com/en/articles/74974>, `…/212753`, `…/253363` |

Ordered by consequence. **Part A** is money that can be taken or lost. **Part B** breaks an
order. **Part C** is non-conforming but harmless today. Every finding cites the doc page for
the requirement and `file:line` for ours.

Each finding is marked **[FIXED]** (done on this branch, with tests) or **[DECIDE]** (written
out exactly, deliberately *not* implemented, because it changes how money moves).

---

## Part A — could take or lose real money

### A1. The three refunds of 18.09.2026 were not a balance problem, and the message that said so is wrong · **[FIXED]**

**What the owner saw.** Three refunds, three refusals:

- «Вернуть деньги целиком» → *"Montonio refused the refund"*
- «Вернуть часть денег» → *"Montonio refused the refund — check the balance in its panel."*
- «Вернуть деньги с подарочной картой» → same

**What that sentence actually is.** It is ours, not Montonio's. `public/shop2/app.js:30714`
maps one API error code to one Russian sentence:

```js
provider_rejected: "Montonio отказал в возврате — проверьте баланс в его панели.",
```

and `provider_rejected` is thrown by `src/lib/payments/montonio.ts:432` for **any** non-2xx
HTTP status from `POST /refunds`. Montonio's own status code and message were read into a
local variable, logged, and dropped (`montonio.ts` before this branch: `console.error(…,
res.status, text.slice(0, 500))`, then `throw new PaymentError("provider_rejected")`).
The owner could not act on «refused» because nothing that identified the refusal survived
the throw.

**Why the balance cannot be the cause.** The refunds guide is explicit that an empty
settlement account does not produce an HTTP error at all. It produces a **successful**
request whose refund sits in `PENDING`:

> PENDING — The refund has been created and is awaiting processing. If a previous attempt
> failed (e.g. due to insufficient funds), the system will retry automatically.
> — [Refunds → Refund statuses](https://docs.montonio.com/api/stargate/guides/refunds)

> INSUFFICIENT_FUNDS — The settlement account lacks sufficient funds to process the refund.
> — [Refunds → Refund status descriptions](https://docs.montonio.com/api/stargate/guides/refunds)

and the help centre puts a clock on it:

> "The refund will remain in this status for up to 10 days" … if funds do not accumulate,
> "the refund will be canceled."
> — [Refunds process overview](https://help.montonio.com/en/articles/74974-refunds-process-overview)

`refundStatusDescription` is carried on the **refund webhook**, not on the create response.
So a no-balance refund is `200 OK` + `{"status":"PENDING"}` → our
`mapMontonioRefundStatus()` (`montonio.ts:184`) → `"pending"` → the panel says «вернули
часть / в обработке», never «отказал». **A refusal the owner saw is by definition not the
balance.**

**What it can be.** The guide lists every HTTP refusal `POST /refunds` throws, and there are
exactly five:

| Code | Montonio's message (verbatim) |
| --- | --- |
| 400 | `Order uuid [xxxxxxxx-…] already has a refund with same idempotency key` |
| 400 | `Refund amount [1000] exceeds the total amount refundable [10]` |
| 400 | `amount is under the min allowed amount: 0.05EUR` |
| 401 | `STORE_NOT_FOUND - double check your access key` |
| 403 | `INVALID_TOKEN - double check your secret key` |

All three of the owner's refunds failed — full, partial and gift-card — on different amounts.
That rules out the 0.05 € minimum and makes a per-amount problem unlikely. It leaves three
systematic candidates, and the documentation says which one is overwhelmingly likely:

> To refund an order, the following requirements must be met:
> - You are using a payment method which supports refunds. These are:
>   **Payment Initiation - EUR only + you must have enabled Bank payment refunds in the
>   Partner System**
>   Card Payments, Apple Pay, Google Pay, MobilePay, BLIK, BNPL, Financing - refunds are
>   enabled by default
> - **The funds have arrived to the merchant's settlement account in Montonio. This
>   typically takes 1 business day.**
> — [Refunds → requirements](https://docs.montonio.com/api/stargate/guides/refunds)

Until either holds, Montonio reports `availableForRefund: 0` on the order, and **every**
refund amount — 30 €, 10 €, 5 € — is "over the refundable total". One precondition, three
identical `400 Refund amount [X] exceeds the total amount refundable [0]`. That fits the
evidence exactly; 401/403 would fit too but would also have broken order *creation*, and
orders were being created fine.

The two fields that settle it are on an endpoint this integration had never called:

> `"availableForRefund": 50,`
> `"isRefundableType": false, // will be true if you enabled refunds in montonio (and the user paid with a refundable method)`
> — [API reference → Get Order by UUID, example response](https://docs.montonio.com/api/stargate/reference)

**Is our request correctly shaped?** Yes. Field by field against
[Refunds → Token contents](https://docs.montonio.com/api/stargate/guides/refunds):

| Doc | Required | Ours | Verdict |
| --- | --- | --- | --- |
| `accessKey` | yes | `montonio.ts:405` | ✅ |
| `orderUuid` | yes | `montonio.ts:406` ← `orders.payment.ref`, which is Montonio's `uuid` from `POST /orders` (`montonio.ts:365`) and re-confirmed from the order token's `uuid` (`montonio.ts:616`) | ✅ |
| `amount` | yes, ≤ 2 decimals | `montonio.ts:407`, rounded by `money()` (`montonio.ts:77`) | ✅ |
| `idempotencyKey` | yes | `montonio.ts:408` | ✅ (see A3) |
| `iat` | yes | stamped by `signHs256` (`jwt.ts:59`) | ✅ |
| `exp` | yes, ~10 min | `TOKEN_TTL_SECONDS = 600` (`montonio.ts:42`) | ✅ |
| header `alg: HS256`, `typ: JWT` | yes | `jwt.ts:63` | ✅ |
| body `{ "data": "<jwt>" }` to `POST /refunds` | — | `montonio.ts:416-421` | ✅ |
| base URL | sandbox/live | `montonio.ts:38-39`, `montonio.ts:72` | ✅ |

**The code asks correctly. The account was not ready to answer.** This is the owner's to
fix — but not by the thing the panel told him, and it is a defect that he was told the wrong
thing.

**Fixed on this branch:**

- `montonioErrorText()` (`src/lib/payments/montonio.ts:105`) turns Montonio's answer into one
  line — `HTTP 400 · Refund amount [30] exceeds the total amount refundable [0]`.
- `PaymentError` gains a `detail` field (`src/lib/payments/types.ts:150`). `code` and
  `message` are untouched, so every existing caller and test reads the same string.
- `refundPayment` and `createPayment` attach it (`montonio.ts:352-354`,
  `montonio.ts:428-432`) and log it with the order number.
- `MontonioProvider.fetchOrder()` (`montonio.ts:480`) calls `GET /orders/:orderUuid` with the
  Bearer JWT the reference prescribes, and reads `paymentStatus`, `availableForRefund`,
  `isRefundableType` and the `refunds` array. It returns `null` — never throws — on anything.
- The admin route (`src/app/api/admin/orders/[id]/refund/route.ts:271-299`) puts `detail` plus
  `montonioStatus` / `availableForRefund` / `isRefundableType` on the 502 body **and** into an
  `order.refund_failed` audit row, so the next refusal is legible in the panel's own journal
  rather than in a Vercel log.
- The lookup happens **only after** Montonio has already refused. It cannot block a refund
  that would have worked, and a lookup that fails changes nothing.

Tests: `tests/payments-montonio-refusal.test.ts` (all five documented refusals, the
200-PENDING non-refusal, the Bearer JWT shape, and `fetchOrder` never throwing).

**Still to do — one line, in a file this branch must not touch.** `public/shop2/app.js:30714`
still says «проверьте баланс». It is the last place the wrong cause is asserted. The exact
replacement, for whoever owns that file next:

```js
provider_rejected: "Montonio не принял возврат. Причина записана в журнале заказа — скорее всего деньги ещё не дошли на счёт магазина (это занимает 1 рабочий день) или в Montonio не включены возвраты для банковских ссылок.",
```

and, where the toast is raised (`app.js:30812`), append the server's `detail` when there is
one so the five refusals are told apart:

```js
toast((REFUND_ERR[err] || "Не удалось оформить возврат") + (r.body && r.body.detail ? "\n" + r.body.detail : ""));
```

**And one thing for Renat, in the Partner System, before the first live refund:**
turn on **Bank payment refunds**. Without it, `isRefundableType` stays `false` for every
bank-link order — which is most of this shop's orders — and no refund through this panel will
ever work, live or sandbox.

---

### A2. `docs/payments.md` asserts the same wrong cause · **[FIXED, doc only]**

`docs/payments.md:855-1043` (§ 11) documents the refund path well, but its list of
requirements omits both of Montonio's own preconditions — refundable-bank-payments and the
one-business-day settlement — and its «Чего нельзя проверить в песочнице» section concludes
that a sandbox refund fails because there is no balance. By the refunds guide, no balance
does not fail; it pends. The section is corrected on this branch and now names the two
preconditions and the five HTTP refusals.

---

### A3. Our idempotency key is compatible, and stronger than what Montonio asks for · **no change**

> `idempotencyKey` — yes — string — A unique key that you generate for each refund request.
> This key is used to recognize subsequent retries of the same request. **How you generate
> the keys is up to you but we recommend using V4 UUIDs.**
> — [Refunds → Token contents](https://docs.montonio.com/api/stargate/guides/refunds)

> 400 — `Order uuid […] already has a refund with same idempotency key`

Ours: `refundIdempotencyKey(order.id, refundsOf(order.payment).length, split.money)`
(`src/lib/payments/refund.ts:242`, called at `…/refund/route.ts:267`). It is
`sha256("rempire-refund|<orderId>|<seq>|<amount>")` reshaped into a syntactically valid v4
UUID (version nibble `4`, variant nibble `8|9|a|b`).

**Verdict: conforming.** Montonio only *recommends* a v4 UUID, and it uses the key as an
opaque string scoped to the order (`Order uuid [X] already has a refund with same idempotency
key`). Our key is unique per (order, ledger position, amount), which is exactly the
uniqueness the endpoint needs, and it is *derived* rather than drawn — which is the point:
a retry after a lost answer re-derives the same key and asks Montonio about the refund it
already made, instead of making a second one. A random UUID per attempt would have satisfied
the letter of the doc and deduplicated nothing.

One caveat worth knowing, and it is Montonio's behaviour, not ours: the 400 on a duplicate
key is a **refusal**, not a replay of the original refund. So a genuine retry after a lost
answer will now surface as
`HTTP 400 · Order uuid […] already has a refund with same idempotency key` — which, thanks to
A1, the owner can now read as *"the first attempt worked"* rather than as *"it failed"*.
The correct response to that message is to reload the order, not to press the button again.
(The refund webhook will have recorded it under Montonio's own `uuid` anyway —
`…/notify/route.ts:154-220`.)

The comment above `refundIdempotencyKey()` used to say the v4 shape is what "Montonio's
refunds guide asks for". The guide *recommends* it. Corrected on this branch.

---

### A4. The order token's `uuid` is never checked against the order we started · **[DECIDED 18.09.2026 — done, differently]**

> **Outcome.** Dim's answer was «tighten both, and on a mismatch ask Montonio
> rather than refuse». The strict version written out below was **not** the one
> applied: refusing a token that fails a check is how a customer who really paid
> is told they have not, and `fetchOrder()` — which did not exist when this
> recommendation was written — lets a mismatch be a question instead. Both
> checks are now made, both report rather than throw, and
> `guardTokenChecks()` (`src/lib/payments/token-guard.ts`) asks
> `GET /orders/:orderUuid` and acts on the answer: confirmed → settle on
> Montonio's own figures; not paid → ignore (200); no answer → 503 so the
> webhook is redelivered. The mismatch is journalled as `order.token_mismatch`
> either way. Tests: `tests/payments-token-guard.test.ts`.

> ```js
> if (
>     decoded.paymentStatus === 'PAID' &&
>     decoded.uuid === montonioOrderId &&
>     decoded.accessKey === 'MY_ACCESS_KEY'
> ) { // payment completed }
> ```
> — [Orders → Validating the returned Order Token](https://docs.montonio.com/api/stargate/guides/orders)

Three checks. We do one and a half (`src/lib/payments/montonio.ts:597-621`):

- `paymentStatus` — read and mapped (`montonio.ts:615`). ✅
- `accessKey` — compared, **but only when present**: `if (claims.accessKey && claims.accessKey
  !== this.config.accessKey)` (`montonio.ts:607`). A validly signed token with no `accessKey`
  claim at all passes. ⚠️
- `uuid` vs the order UUID we stored — **not checked at all**. The order is found by
  `merchantReference` (`montonio.ts:610`, `…/notify/route.ts:68`) and `payment.ref` is then
  *overwritten* from the token (`apply.ts:677`).

**Consequence.** Bounded, but real. The token is HS256-signed with our secret, so a forgery
needs the secret, and with the secret everything is lost anyway. What the missing `uuid`
check leaves open is **replay of a legitimately issued token**: `order-token` travels in a
URL, so it lands in browser history, in the `Referer` of anything the receipt page loads, and
in any log that records query strings. An old `PAID` token replayed at
`/api/payments/return/` re-settles that order — which `applyPaymentResult`'s
`alreadyPaid`/`claimOrderPaid` guards already make a no-op (`apply.ts:742`,
`orders.ts:1836`) — so today the damage is nil. It stops being nil the moment
`merchantReference` is ever reused, which Montonio explicitly supports (A5).

**The exact change, not applied:**

```ts
// src/lib/payments/montonio.ts, verifyToken()
if (claims.accessKey !== this.config.accessKey) throw new PaymentError("token_foreign");
```

and, in `applyPaymentResult` (`src/lib/payments/apply.ts:677`), refuse rather than overwrite
when the order already carries a different `payment.ref` and the token is not for it:

```ts
const stored = storedRef(order);
if (stored && result.providerRef && stored !== result.providerRef && !wasPaid) {
  // a token for a Montonio order this shop did not start for this order row
  return { status: "unchanged", keptPaid: false, alreadyPaid: false, payment };
}
```

**Why it is not applied.** Both tighten what the shop will accept as proof of payment. If
Montonio ever omits `accessKey` on a live token — and the shipping half of the same API
already has tokens with different claim sets — the first change turns a paid order into an
unpaid one, silently, on the one path that matters. This needs a sandbox token captured from
the live account before it goes in, not a guess.

---

### A5. A second payment on one order: Montonio prevents it; our code's comment says otherwise · **no change, but the comment is wrong**

`src/lib/payments/apply.ts:699-720` used to state:

> "POST /api/payments/create/ will start a fresh payment for an order whose first one is
> still in flight, so a shopper CAN pay twice."

**The documentation contradicts this.**

> `merchantReference` — The order reference in the merchant's system … **This value must be
> unique for each order of a store. If you use the same value for multiple orders, the
> existing order will be updated.**
> — [Orders → Order data structure](https://docs.montonio.com/api/stargate/guides/orders)

and, from the help centre article that page links to:

> If you send the same `merchantReference` … we will reuse an existing order. If the order has
> not yet been paid for, we will replace the details of the order (including the amount) and
> give you a new payment URL … **If an order with this merchantReference has already been
> paid for, the API will throw an error.**
> — [How to use the merchantReference parameter](https://help.montonio.com/en/articles/253363-how-to-use-the-merchantreference-parameter-when-creating-orders)

We send our own order number as `merchantReference` (`montonio.ts:308`, and
`types.ts:66`). So a second `POST /api/payments/create/` for the same order does **not** create
a second Montonio order: it replaces the pending one and returns the same `uuid`. There is no
second payment to take, and `payment.ref` cannot be clobbered by one, because the reference
never changes. The `isRepeat` branch (`apply.ts:722`) is therefore dead in practice for
Montonio — harmless, and worth keeping for a provider that behaves differently.

**What the same paragraph opens instead**, and this is the part to watch:

> "Reusing orders while changing the amount may allow your customers to complete orders by
> paying a smaller amount than intended."

Our create route always reads `order.total` off the row (`…/create/route.ts:82`,
`payments/order.ts:110-128`), and a shopper cannot change the row — so this is not
reachable from the storefront. It becomes reachable if an admin edits an order's total while a payment is in
flight: the shopper's already-open Montonio page would still be for the old amount, or a
re-create would lower it. Mitigation already present: `apply.ts:685-697` flags
`payment.amountMismatch` when the token's `grandTotal` differs from ours. Mitigation missing:
it flags and **still marks the order paid**. See A6.

**The hole the brief asked about — "no status endpoint existed to check the first" — is
closed by documentation, not by code.** `GET /orders/:orderUuid` does exist
([API reference](https://docs.montonio.com/api/stargate/reference)) and this branch now has a
client for it (`montonio.ts:480`). See B1 for where else to use it.

---

### A6. An underpaid order is marked paid and flagged, not held · **[DECIDED 18.09.2026 — done]**

> **Outcome.** Dim chose to hold the order and be told; he turned down the
> middle option (mark paid, hold only the cards) by name, because it lets the
> parcel go, which cannot be undone, while holding a card that could be
> reissued in seconds. Implemented in `src/lib/payments/apply.ts` — and **not**
> in the shape sketched below, which writes `status: "paid"` on the blob: that
> would make `halfSettled()` read the held order as a settlement that died
> half-way and finish the fulfilment off on Montonio's very next retry. The
> blob says `pending` and carries `held`. Tests:
> `tests/payments-underpaid.test.ts`.

`src/lib/payments/apply.ts:685-697`: when the signed token's `grandTotal` differs from
`orders.total` by more than a cent, the code writes `payment.amountMismatch`, logs, and then
falls straight through into the `paid` transition — stock off the shelf, gift cards minted
and e-mailed, points earned, confirmation letter sent.

The comment is honest about it ("Take the payment, flag the difference loudly"), and for an
**over**payment that is right. For an underpayment it is the failure mode Montonio itself
warns about in A5.

**The exact change, not applied** (`apply.ts`, inside the `result.status === "paid"` branch,
before `deps.setOrderStatus`):

```ts
if (payment.amountMismatch && result.amount! < expected! - 0.009) {
  // money arrived, but less than the order is worth: record it, do not fulfil it
  await record({ ...payment, status: "paid", underpaid: payment.amountMismatch });
  return { status: "unchanged", keptPaid: false, alreadyPaid: false, payment };
}
```

plus an order-card warning in the panel, the same shape as `payment.rejected`.

**Why it is not applied.** It changes the transition into paid — the single most
consequential branch in the shop. A false positive (a rounding difference we have not thought
of, a currency conversion, a service fee netted off) would leave a genuinely paid customer
with no confirmation letter and no gift cards, which is worse than a flagged underpayment on
an order card. It wants a decision and a sandbox test with a deliberately mismatched amount,
not a confident guess.

---

## Part B — breaks an order

### B1. Nothing ever asks Montonio what it thinks · **partly [FIXED]**

> Get Order by UUID — The endpoint returns details about the order and its `paymentStatus`.
> **You can use it to double-check the status of the order and its payment.** In order to use
> this endpoint, you need to save the Order UUID returned by the `POST /orders` endpoint in
> your database.
> — [API reference → Get Order by UUID](https://docs.montonio.com/api/stargate/reference)

We do save the UUID (`…/create/route.ts:164-171` → `orders.payment.ref`) and, until this
branch, never used it. Every belief this shop holds about a payment comes from a token that
was pushed at it. That is fine while tokens arrive; it leaves nothing at all when one does
not — a webhook lost for 48 hours, a shopper who closed the tab, an order stuck at «не
оплачен» that Montonio considers `PAID`.

`fetchOrder()` now exists (`montonio.ts:480`) and is wired into the refund-refusal path.

**Not wired (deliberate, [DECIDE]):**

- **A reconcile pass** · **[DECIDED 18.09.2026 — done 19.09.2026]**. Built exactly as
  described: `src/lib/payments/reconcile.ts`, `/api/cron/payments-reconcile/`, settling through
  the existing `settlePayment()` door and nothing else. The cron slot turned out not to be
  available — Vercel's Hobby plan allows two jobs and both are taken (`docs/HOSTING.md`) — so
  the sweep rides at the end of `/api/cron/flows/` and the route stands ready for its own
  hourly entry on Pro. Tests: `tests/payments-reconcile.test.ts`.
- **A pre-flight check in `POST /api/payments/create/`.** Before starting a payment on an
  order that already has a `payment.ref`, ask Montonio whether that order is already `PAID`.
  Given A5 this is belt-and-braces (Montonio would refuse the create anyway), and it puts a
  network round-trip on the checkout's hot path. Recommended only if the reconcile pass above
  is not built.

---

### B2. `expiresIn` is never sent, so a started payment blocks the order for 30 minutes · **[DECIDE]**

> `expiresIn` — The number of minutes that the order can be paid for. The default is 30
> minutes, minimum 5 minutes, and maximum 44640 minutes (31 days). … The order will be
> abandoned if it is not paid within this time frame.
> — [Orders → Order data structure](https://docs.montonio.com/api/stargate/guides/orders)

Our payload (`montonio.ts:306-321`) omits it, so every order gets 30 minutes. That interacts
with «Оплатить ещё раз» (`…/create/route.ts:85-100`): a shopper who abandons at the bank
leaves a `PENDING` Montonio order, and the retry reuses the same `merchantReference` — which
is documented to replace it and hand back a fresh `paymentUrl` (A5), so the retry works. But
until `ABANDONED` fires, `paymentStatus` stays `PENDING`, and any reconcile pass (B1) must not
read that as "still trying" for an order the shop has since cancelled.

Recommendation: send `expiresIn` explicitly, matched to whatever the unpaid-order cron uses
(`src/lib/flows.ts`, `UNPAID_STATUSES`), so the two clocks agree. Not applied because the two
clocks are a product decision, not a doc conformance one.

---

### B3. A refund webhook for a *second* payment would not find its order · **[DECIDE]**

`getOrderByPaymentRef()` (`src/lib/orders.ts:1758-1766`) matches `payment->>'ref'` only. If
`apply.ts:722`'s `isRepeat` branch ever fires, the second payment's UUID lives at
`payment.repeat.ref` and a refund webhook naming it (`…/notify/route.ts:169`) logs
"refund for an unknown order" and answers 200 — the refund is silently invisible to the shop.

Per A5 this branch is unreachable with Montonio. The one-line hardening, if the branch is
kept:

```sql
select * from orders
 where payment->>'ref' = $1 or payment->'repeat'->>'ref' = $1
 order by created_at desc limit 1
```

Not applied: it widens a lookup used by a money path, on a branch that the documentation says
cannot occur.

---

## Part C — non-conforming, no consequence today

### C1. Webhook verification — conforming, with two omissions · mostly ✅

> Both token types are JWTs signed with your Secret Key using HS256 and are verified the same
> way. … **You must verify the JWT signature using your Secret Key** to ensure the webhook is
> authentic and has not been tampered with. Never trust webhook data without verification.
> — [Listen to webhooks](https://docs.montonio.com/api/stargate/guides/webhooks)

| Requirement | Ours | |
| --- | --- | --- |
| HS256, our Secret Key | `jwt.ts:44-46`, `jwt.ts:92` | ✅ |
| Constant-time signature compare | `jwt.ts:96` (`timingSafeEqual`) | ✅ — better than the docs ask |
| Reject any other `alg` (`alg:none`, RS256-with-HMAC-key downgrade) | `jwt.ts:90` | ✅ — the docs never mention this; we do it |
| `orderToken` vs `refundToken`, same URL | `montonio.ts:581-594`, `…/notify/route.ts:48-60` | ✅ |
| Respond 200/201 | `…/notify/route.ts:77`, `:134`, `:176`, `:209` | ✅ — including a duplicate and a token for an order we do not have |
| Ask for a redelivery when a retry could help | 503 on a database blip (`…/notify/route.ts:72`, `:92`, `:172`, `:218`), 429 when rate-limited (`:34`), 400 only for a token that cannot be verified (`:63`, `:164`) | ✅ — the split is exactly right: retryable ≠ 200 |
| Retries for 48 h / 13 attempts — handle duplicates | `foldRefund()` (`refund.ts:203`), `claimOrderPaid()` (`orders.ts:1836`) | ✅ |
| "Use the order UUID or refund UUID to deduplicate" | refund ledger keys on Montonio's `uuid` (`refund.ts:209`) | ✅ |
| Verify `accessKey` | `montonio.ts:558`, `:607` — **only when present** | ⚠️ A4 |
| Verify `uuid` against the order | not done | ⚠️ A4 |
| Expiry | `jwt.ts:110-116`, 60 s clock tolerance — **but a token with no `exp` claim is accepted forever** | ⚠️ below |

**The missing-`exp` hole.** `jwt.ts:111` is `if (typeof exp === "number")`. The docs mark `exp`
as required on the tokens *we* send and show it on every token Montonio sends (order tokens
~4 h, refund tokens 7 days). A token that somehow carried no `exp` would never expire here.
Same risk class as A4 — tightening it could reject a real token — so:

```ts
// src/lib/payments/jwt.ts, verifyHs256(), guarded by an opts flag so signing is unaffected
if (opts.requireExp && typeof exp !== "number") throw new JwtError("jwt_expired");
```

**[DECIDE]**, called with `requireExp: true` from `verifyToken`/`verifyRefundNotification`
only.

**Not a finding, but worth recording:** the webhook IP allowlist
(`35.156.245.42`, `35.156.159.169`) needs nothing from us — Vercel has no WAF in front of this
project and `vercel.json` configures none. `docs/payments.md:79` already notes to allowlist
them if Cloudflare is ever put in front.

---

### C2. Payment-method availability by country and currency · ✅ with one latent gap

> `preferredCountry` — The preferred country for the methods list of the payment gateway.
> Defaults to the merchant's country. Available values are `EE`, `LV`, `LT`, `FI`, `PL`.
> 📝 Note: For international banks (e.g., Revolut, N26, Wise), **you must set
> `preferredCountry` to match the country of the payment methods displayed to the customer.**
> — [Orders → Method Options for Payment Initiation](https://docs.montonio.com/api/stargate/guides/orders)

**Conforming.** The chips the shopper sees are `banksForCountry(deliveryCountry)`
(`public/shop2/app.js:7796`), and the same country goes out as `preferredCountry`
(`…/create/route.ts:146-157` → `montonio.ts:285`, gated by `BANK_COUNTRIES` at
`montonio.ts:51`, which is exactly the doc's five values). List shown and list requested are
the same list, which is what the note demands.

**The retry screen showing the wrong country's banks is already fixed** —
`src/lib/payments/receipt.ts:71-114` carries `c=<delivery country>` onto the receipt so the
retry screen narrows to the same country the checkout did (17.09.2026). If the owner still
sees it, the cause is a cached `app.min.js`, not this logic.

**The latent gap: currency is dropped.** `GET /stores/payment-methods` returns
`supportedCurrencies` on both the country group and each bank —

> Payment method / Supported currencies: Bank Payments EUR, PLN · Card Payments EUR, PLN ·
> MobilePay EUR · BLIK PLN · Buy Now Pay Later EUR · Hire Purchase EUR
> — [Display payment methods](https://docs.montonio.com/api/stargate/guides/payment-methods)

— and `mapBanks()` (`src/lib/payments/methods.ts:71-83`) reads only `code`, `name`,
`logoUrl`. The shop is EUR-only (`payments/order.ts:123`), so today nothing can go wrong. The
day a Polish bank appears in the list, a EUR order would be offered a PLN-only bank. One line
when it matters:

```ts
// methods.ts mapBanks(), inside the per-bank loop
const ccy = Array.isArray(b.supportedCurrencies) ? b.supportedCurrencies.map(String) : [];
if (ccy.length && !ccy.includes("EUR")) continue;
```

**«Bank link cannot be cancelled, bank card can.»** Correct, and it is Montonio's design, not
ours. A card authorisation can be voided; a Payment Initiation transfer, once signed at the
bank, is a completed transfer — the only way back is a refund, and that refund is exactly the
one that needs **Bank payment refunds** switched on (A1). The docs say the same thing from the
other side: `VOIDED` — "An order previously marked as PAID was rejected by the bank" — "can
only happen with the `paymentInitiation` payment method"
([overview](https://docs.montonio.com/api/stargate/overview)).

---

### C3. Everything else checked, field by field · ✅

**`POST /orders` payload** against
[Orders → Order data structure](https://docs.montonio.com/api/stargate/guides/orders):

| Doc field | Required | Ours (`montonio.ts:306-321`) |
| --- | --- | --- |
| `accessKey` | ✳ | ✅ :307 |
| `merchantReference` | ✳ | ✅ :308 — our order number |
| `returnUrl` | ✳ | ✅ `…/create/route.ts:151` |
| `notificationUrl` | ✳ | ✅ `…/create/route.ts:152` |
| `grandTotal` | ✳ | ✅ :312, 2dp |
| `currency` | ✳ EUR or PLN | ✅ :311 |
| `exp` | ✳ ~10 min | ✅ `jwt.ts:60` |
| `payment.method` | ✳ | ✅ :315 — `paymentInitiation` / `cardPayments` |
| `payment.amount` | ✳ = grandTotal | ✅ :317 |
| `payment.currency` | ✳ = order currency | ✅ :318 |
| `payment.methodDisplay` | — | ✅ :316 |
| `payment.methodOptions.preferredProvider` | — | ✅ :286, BIC from the chip |
| `payment.methodOptions.preferredCountry` | — | ✅ :285 |
| `payment.methodOptions.preferredLocale` | — | ✅ :284 |
| `payment.methodOptions.paymentDescription` | — | ✅ :283 `REMPIRE <number>` |
| `payment.methodOptions.paymentReference` | — | ✅ correctly **omitted** — "Banks validate this number strictly and payments will start failing if this number is not formatted correctly" |
| `locale` | ✳ (`de en et fi lt lv pl ru`) | ✅ :313 via `LOCALES` (`montonio.ts:48`) |
| `billingAddress` / `shippingAddress` | — | ✅ :322-325 |
| `lineItems[].name/quantity/finalPrice` | all required if present | ✅ :326-332 |
| `expiresIn` | — | ⚠️ omitted, B2 |
| `sessionUuid` | only for embedded cards | n/a — we redirect, we do not embed |

**Response handling** (`montonio.ts:357-365`): `paymentUrl` required, `uuid` stored. ✅
The `paymentStatus`/`availableForRefund`/`isRefundableType`/`refunds` also present in that
response are ignored — harmless, and now readable via `fetchOrder()`.

**Status mapping** (`montonio.ts:145-171`) against
[overview → Lifecycle of an Order](https://docs.montonio.com/api/stargate/overview): every one
of `PENDING PAID VOIDED PARTIALLY_REFUNDED REFUNDED ABANDONED AUTHORIZED` is handled, and
anything unknown maps to `pending`, never to `failed`. ✅ The choice to keep a `VOIDED` order
paid and surface it to a human (`montonio.ts:132-139`, `apply.ts:726-731`) is right: Montonio
e-mails the merchant, and an automatic cancellation of a paid order is not something code
should decide.

**Refund status mapping** (`montonio.ts:184-198`) against
[Refunds → Refund statuses](https://docs.montonio.com/api/stargate/guides/refunds): all five
handled, unknown → `pending`. ✅

**Refund constraints** — "minimum amount for a refund is 0.05 €", "total amount of refunds
cannot exceed the `grandTotal`", "only to the original payer". Our route enforces a 0.01
minimum (`…/refund/route.ts:182`), which is **looser** than Montonio's 0.05 €: a 0.02 € refund
is accepted by us and refused by Montonio with `amount is under the min allowed amount:
0.05EUR`. Since A1 now surfaces that message this is self-explaining, but the honest guard is
one constant:

```ts
// …/refund/route.ts:182 — Montonio's own floor, so the panel refuses before the network does
if (!(amount >= 0.05) || amount > left + 0.005) return bad("bad_amount", 400, { left });
```

**[DECIDE]** — it makes a currently-possible refund impossible, which is a rule change, not a
bug fix. Note the gift-card half is unaffected: a card credit never touches Montonio
(`…/refund/route.ts:242`).

The `grandTotal` ceiling is respected from a different direction: we measure against
`refundValue()` = `orders.total` + what a gift card paid (`settle.ts:210`), and the money half
after `splitRefund()` (`refund.ts:179`) can never exceed `orders.total`, which is the
`grandTotal` Montonio holds. ✅

**Authentication** (`GET` endpoints) against
[API reference → Authentication](https://docs.montonio.com/api/stargate/reference):

> GET endpoints require a JWT in the `Authorization` header. … Both GET and POST JWTs must
> contain your Access Key … minimum required payload: `accessKey`, `exp` … We recommend
> setting this to 1 hour.

`methods.ts:54-58` sends `Bearer <HS256 {accessKey, exp}>` with a 1-hour TTL
(`methods.ts:30`), and `fetchOrder()` now does the same (`montonio.ts:484-486`,
`montonio.ts:44`). ✅ The comment at the head of `methods.ts` used to say this shape was
inferred from sample responses "not by the Orders API's signed-body pattern" — the reference
page now states it outright, so the inference was right. Corrected on this branch.

**Base URLs** `montonio.ts:38-39` — exact match for both environments. ✅

---

## The five questions, answered

**1. Webhook verification.** Montonio signs both `orderToken` and `refundToken` as HS256 JWTs
with the store's Secret Key, delivered as a JSON POST body to `notificationUrl`; the endpoint
must answer 200/201 or be retried 13 times over 48 hours. We verify the signature in constant
time, reject any `alg` other than HS256, honour `exp` with 60 s tolerance, reject a token
carrying another store's `accessKey`, route `refundToken` to the refund path, answer 200 for
everything understood and 400 only for a token that cannot be checked. Two documented checks
are missing: `accessKey` is only compared when the claim is present, and `uuid` is never
compared to the order we started (A4, C1). A webhook that fails verification results in a 400
and no state change — an unverified webhook can never mark an order paid. No, a shop cannot
be told an unpaid order is paid, today.

**2. Idempotency.** Montonio requires an `idempotencyKey` per refund request and *recommends*
a v4 UUID; a repeat of the same key against the same order is refused with
`400 … already has a refund with same idempotency key`. Our derived key is a valid v4 UUID by
shape and unique per (order, ledger position, amount) — compatible, and better than random,
because a retry after a lost answer re-derives the same key instead of paying twice. See A3.

**3. A second payment on one order.** A status endpoint **does** exist — `GET /orders/:orderUuid`
— and this branch now has a client for it. But the hole it was meant to close is not there:
Montonio treats `merchantReference` as unique per store and *reuses* the order, replacing a
pending one and refusing outright if it is already paid. So a second `POST /api/payments/create/`
cannot start a second, independent Montonio order and cannot take a second payment. What
remains is the amount-lowering warning in Montonio's own help centre, unreachable from the
storefront but reachable by an admin edit — see A5 and A6.

**4. Payment method availability.** `GET /stores/payment-methods` returns the store's enabled
methods with `paymentInitiation.setup` keyed by `EE/LV/LT/FI/PL`, each with
`supportedCurrencies` and a bank list. We request it correctly (Bearer JWT), narrow the chips
to the delivery country and send the same country as `preferredCountry` — which is exactly
what the docs demand for international banks. The retry screen's wrong-country bug was fixed
on 17.09.2026 (`receipt.ts:71-114`). One latent gap: we drop `supportedCurrencies` (C2). The
uncancellable bank link is Montonio's design — a signed transfer has no void, only a refund.

**5. Going live.** There is no separate "go live" page; the
[Integration checklist](https://docs.montonio.com/api/stargate/checklist) is it, and it is
short. Full table below.

---

## Go-live: every sandbox↔production difference, checked against our code

| What changes | Doc | Ours | Status |
| --- | --- | --- | --- |
| **Base URL** `sandbox-stargate` → `stargate` | [API reference → API URLs](https://docs.montonio.com/api/stargate/reference) | `montonio.ts:38-39`, switched by `MONTONIO_ENV` (`montonio.ts:68`, `montonio.ts:72`) | ✅ one env var |
| **API keys** are per-environment and cannot be mixed | [Help centre — sandbox keys](https://help.montonio.com/en/articles/27851-where-to-find-sandbox-api-keys) | `MONTONIO_ACCESS_KEY` / `MONTONIO_SECRET_KEY` (`montonio.ts:62-64`) | ✅ — **set all three together**; live keys on `MONTONIO_ENV=sandbox` give `401 STORE_NOT_FOUND` |
| Production keys need business approval | Help centre | — | ⚠️ **owner action**, not yet done |
| **Webhook URL registration** | "you include a `notificationUrl` in the JWT payload" — [Webhooks](https://docs.montonio.com/api/stargate/guides/webhooks) | sent per order, `…/create/route.ts:152` | ✅ **nothing to register.** (The *shipping* webhook is different and must be registered by hand — `docs/shipping.md`.) |
| **Return URL allowlisting** | Not required anywhere in the docs; `returnUrl` is per order and echoed back as `merchantReturnUrl` | `…/create/route.ts:151` | ✅ nothing to register |
| **Webhook source IPs** `35.156.245.42`, `35.156.159.169` | [Webhooks](https://docs.montonio.com/api/stargate/guides/webhooks) | no WAF; `vercel.json` has none | ✅ — revisit only if Cloudflare is added |
| `PUBLIC_BASE_URL` must be the real domain | implied — the gateway must be told a stable public URL | `payments/index.ts:51-62`, falls back to the request origin | ⚠️ **must be set in production**, otherwise a proxy's `Host` decides where Montonio sends the money confirmation |
| **Bank payment refunds** must be enabled in the Partner System | [Refunds → requirements](https://docs.montonio.com/api/stargate/guides/refunds) | nothing in code can do this | 🔴 **owner action — this is A1** |
| Which countries/methods the store has enabled | [Display payment methods](https://docs.montonio.com/api/stargate/guides/payment-methods): "if it is empty, contact customer support" | `GET /api/payments/methods/` shows it live | ⚠️ check the live list is not empty on day one |
| `ABANDONED` needs enabling for merchants who joined before 2023-08-29 | [overview, footnote 2](https://docs.montonio.com/api/stargate/overview) | `mapMontonioStatus` handles it either way (`montonio.ts:154`) | ✅ n/a — new account |
| `AUTHORIZED` is opt-in, enterprise only | [overview, footnote 3](https://docs.montonio.com/api/stargate/overview) | mapped to `pending` (`montonio.ts:151`) | ✅ safe either way |
| Settlement takes ~1 business day before a refund is possible | [Refunds → requirements](https://docs.montonio.com/api/stargate/guides/refunds) | not modelled anywhere | ⚠️ tell the owner: **a same-day refund will be refused**, and that is normal |
| Sandbox limits: bank links unavailable, dummy shipping labels, no real settlement | `docs/payments.md:158` (owner-verified), shipping sandbox page | — | ✅ already documented |
| `PAYMENT_PROVIDER` must not be `mock` in production | `payments/index.ts:30-42` | mock is reachable only by explicit opt-in | ✅ |
| `SESSION_SECRET` | needed for the receipt's order-status token (`order-status.ts:44`) | | ⚠️ must be set |

**Vercel checklist, concretely:** `MONTONIO_ACCESS_KEY`, `MONTONIO_SECRET_KEY`,
`MONTONIO_ENV=live`, `PUBLIC_BASE_URL=https://rempireshop.ee`, `SESSION_SECRET`,
`PAYMENT_PROVIDER` unset (or `montonio`). Nothing in `vercel.json` needs changing for
payments; if the reconcile pass of B1 is built, it needs a `crons` entry.

---

## What this branch changed, and what it did not

**Changed (safe — none of it alters how money moves):**

| File | What |
| --- | --- |
| `src/lib/payments/types.ts:150` | `PaymentError` carries `detail`; `code` and `message` unchanged |
| `src/lib/payments/montonio.ts:105` | `montonioErrorText()` — Montonio's status + message as one line |
| `src/lib/payments/montonio.ts:352-354`, `:428-432` | that line is attached to the thrown error and logged with the order number |
| `src/lib/payments/montonio.ts:480` | `fetchOrder()` — `GET /orders/:orderUuid`, read-only, never throws |
| `src/app/api/admin/orders/[id]/refund/route.ts:271-299` | the refusal carries `detail` + Montonio's own view of the order, and writes an `order.refund_failed` audit row |
| `docs/payments.md` § 11 | the two real refund preconditions and the five refusals; the balance claim removed |
| `tests/payments-montonio-refusal.test.ts` | new |
| `tests/payments-refund.test.ts:173-180` | the stub's "no balance" refusal replaced with a documented one |

**Not changed — each needs a decision:** A4 (strict `accessKey` / `uuid` checks), A6
(hold an underpaid order), B1 (reconcile pass), B2 (`expiresIn`), B3 (`payment.repeat.ref`
lookup), C1 (`requireExp`), C2 (drop non-EUR banks), C3 (0.05 € floor), and the two
`public/shop2/app.js` lines in A1.

**Decided 18.09.2026 and implemented 19.09.2026 on `r27-pay-decisions`:** A4, A6 and B1's
reconcile pass — see the outcome note under each. B2, B3, C1, C2 and C3 are still open.

---

## Where the brief turned out to be wrong

1. **"a sandbox account simply has no balance to refund from, which would make this the
   owner's to fix and not a defect."** Half right. The account almost certainly is not ready —
   but no balance does not produce a refusal, it produces a `PENDING` refund and a `200`. The
   refusal is one of five documented HTTP errors, the most likely being
   `availableForRefund: 0` because the funds have not settled and/or bank-payment refunds are
   not enabled. And it *is* a defect that the panel asserted a cause the API cannot produce.

2. **"`POST /api/payments/create/` will start a second, independent Montonio order … and no
   status endpoint existed."** Both halves are wrong. `merchantReference` is unique per store
   and Montonio reuses the order — replacing it if unpaid, refusing if paid — so there is no
   second payment to take. And `GET /orders/:orderUuid` has been documented in the API
   reference all along; we simply never called it.

3. **"a retry screen showed banks for the wrong country."** Real, and already fixed on
   17.09.2026 by carrying `c=<country>` onto the receipt (`src/lib/payments/receipt.ts:71-114`).
   If it still happens, it is a stale `app.min.js`, not this code.

4. **"`refundIdempotencyKey` is ours, not necessarily theirs."** It is ours, and it is better
   than theirs: Montonio only *recommends* a v4 UUID and a random one per attempt would
   deduplicate nothing.
