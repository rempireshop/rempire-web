# Audit 18.09.2026 — findings on the range `b6cbe37..9b7f48d`

Answer to `docs/audit-2026-09-18-brief.md`. Written 18.09.2026, late evening, from a detached
worktree pinned at `9b7f48d` (170 commits, 68 merges, 290 files, +56 102 / −3 003). Every
`file:line` below is that tree's. Nothing in `rempire-web` was changed except this file; nothing
was committed.

**How it was done.** Ten read-only passes, one per attention area of the brief — server-side
merges, `app.js` merges, test fixtures, mirrors, Montonio against its documentation (all 13
pages fetched live), idempotency, sandbox stand-ins, the owner's decisions, stock/storefront,
blog/tools/auth/letters — each returning raw findings with evidence. Every finding rated MED or
worse was then re-read by the coordinator against the tree; the stock findings were executed
as probes outside the worktree against the worktree's own `src/` (a probe that passes *is* the
confirmation). The full unit suite was run three times under load: 180 files, 4 171 tests,
green each time (399 s, 449 s, 359 s). Area suites were re-run by the passes (Montonio 228,
stand-ins 136, stock 394, decisions 382, parity 580, idempotency 82, blog/auth/letters 262 —
all green).

**Severity.** MED-HIGH: money or goods move wrongly in a sequence that occurs in normal
operation · MED: a real order, customer or the owner is misled, or a count is corrupted ·
LOW: bounded, cosmetic, or needs an unlikely sequence · INFO: for the record. No finding
reached HIGH.

**Verdicts.** **new** · **known-deferred** (line in `docs/audit-2026-09-14-deferred.md`) ·
**contradicts a decision** (which) · **already fixed** (commit).

**Totals.** 56 findings: 1 MED-HIGH · 10 MED · 7 MED-LOW · 6 LOW-MED · 31 LOW · 1 INFO.
Verdicts: 50 new · 3 contradict a decision (all partial) · 1 known-deferred · 1 already fixed
inside the range and reported only because the documents still say otherwise (F17) · 1 INFO
without a verdict (F30). Plus: 7 places the brief is wrong, 2 named candidates for the
intermittent unit failure, 16 deferred entries (21 lines) whose reason no longer holds, 8
accepted residuals from the decision check (§ 7), and 6 things outside the range noticed in
passing (§ 9).

---

## 0. Where the brief is wrong about the code

1. **`src/lib/og-card.ts` holds one NUL byte, not 418** — counted byte by byte at `b6cbe37`,
   at `9b7f48d` and in the checkout. One is enough for `grep` to call the file binary, so the
   advice (`grep -a`) stands; the number does not.
2. **The salon till's `pos_ref` + unique index date from 14.09 20:08, not 07.09.**
   `git log --all -S pos_ref` has exactly one origin, `515c85e` (r19-pos), merged into `main` on
   17.09 09:26 — inside this range. The 14.09 audit was right when it was written; it was stale
   by the time it was read on 18.09. The example holds, the date does not.
3. **The deliberate double `promo_consume_failed` guard is not in `src/app/api/orders/route.ts`.**
   That file contains no promo logic. The pair is `src/lib/payments/apply.ts:231`
   (`order.channel === "pos"`) and `:266` (`kind === "label"`), both early returns.
4. **The 90-second lease's premise is false.** `src/lib/idempotency.ts:111-117` and
   `180_idempotency.sql` justify `LEASE_MS = 90_000` as «longer than the longest budget any
   route in this shop asks for (`maxDuration = 60`)». Only `admin/flows/run`, `admin/login` and
   `cron/flows` declare a `maxDuration`; none of the six keyed routes does, `vercel.json` has no
   `functions` block, and `docs/HOSTING.md:73` says Fluid compute allows 300 s. See F7.
5. **«Unpaid orders cancel after 7 days» is implemented and switched off** — `src/lib/flows.ts:119`
   `unpaid: false`, `:1221` returns `"disabled"`; `docs/go-live.md:94` lists the switch as an
   optional owner step. Not a defect; "implemented" is not "running", and the floor date (D9)
   is not stamped until the switch flips.
6. **`docs/audit-2026-09-14-deferred.md` is not in the tree the brief describes** — it was
   committed in `78ceb7a`, after `9b7f48d`. Trivial; it cost the first hour of the run.
7. Where the brief was doubted and is right: the phone table is 32/32 correct against ITU
   E.164; `app.js` sends no key for products, blog or reviews; `tests/shipping-parcel.test.ts`
   guards `PARCEL_DEFAULT`, `LOCKER_SIZES`, the 22-country list and their mirrors;
   `src/data/testplan.json` has 187 items; the deferred file has 73 entries.

---

## 1. The intermittent unit failure — two candidates, neither reproduced

Three full runs on 18.09 evening were green, so this is by reading. In order of likelihood:

**Candidate 1 — unit tests that dial out to the internet (F50).** `tests/fuzz-harness.ts:289-299`
`setFuzzEnv()` sets fake `R2_ACCOUNT_ID = "fuzz-account"` and the four other `R2_*` variables;
`installFetchStub()` (`:344-369`) is what stops a real `fetch`. Seven files call the first and
never the second: `tests/giftcards-audit-r19.test.ts`, `tests/payments-double.test.ts`,
`tests/flows-run.test.ts`, `tests/gift-loyalty-once.test.ts`, `tests/payments-refund.test.ts`,
`tests/payments-refund-giftcard.test.ts`, `tests/payments-settle-once.test.ts`. In the first two,
a paid order that carries a gift card reaches `storeGiftCardPdf()` → `putObject()`
(`src/lib/giftcard-pdf.ts:523-534`, `src/lib/storage.ts:291-309`) — `storageConfigured()` is true
under the fuzz env — and a **real signed PUT** goes to
`https://fuzz-account.r2.cloudflarestorage.com/…` with no timeout on the fetch. It is awaited:
`src/lib/payments/settle.ts:64` → `notifyOrderPaid` → `onOrderPaid` → `sendGiftCards`. In all three
runs the stack traces show it failing fast (`ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE`, six
per run: three tests in `giftcards-audit-r19`, one in `payments-double`); on a network that
drops the connection instead of refusing it, the test waits for the TCP timeout and trips the
30 s `testTimeout` (`vitest.config.ts:15`). Both files are in the range (`109243d`, r19-giftcards;
`payments-double` last touched before it). The harness's own rule — «A host this stub does not
know is a hole in the stub, not a licence to dial out» (`fuzz-harness.ts:364-366`) — is
violated by not installing the stub at all.

**Candidate 2 — real timers in `tests/assistant-probe.test.ts:203-236`.** `inFlight()` resolves
the stubbed fetch after 5 ms and reads results after 40 ms with real timers; on a loaded
worker the second turn can land after the read and `:245` sees `turns: 1` instead of 2.

If the failure appears again, the file name decides between the two; neither is a product
fault, both are one line to close (install the stub; use fake timers).

---

## 2. Findings — money and goods

### F1 · MED-HIGH · new — «Вернуть деньги» retried on a mixed card + bank order pays the customer twice

**Claim.** The gift-card half's reference is derived from the card ledger *as it stands*, the
money half's key from `orders.payment.refunds`. The card credit commits in its own transaction;
the fold into `orders.payment` is a later statement. In the window between the two — the exact
state the route's own test describes — a retry re-splits the same amount, credits the card
again under a new reference and sends the remainder to Montonio under a new key.

**Evidence — ours.** `src/app/api/admin/orders/[id]/refund/route.ts:216-222` — `giftLeftTotal =
min(Σ g.left, giftPaidTotal − giftRefundedTotal(payment))`, where `g.left` comes from
`giftPaidByOrders()` (`src/lib/giftcards.ts:610-633`, `left = max(0, sum(amount))` over the card
ledger); `:222` `splitRefund(amount, giftLeftTotal)` puts the card first
(`src/lib/payments/refund.ts:190-194`); `:270-282` the money half goes to Montonio under
`refundIdempotencyKey(order.id, refundsOf(order.payment).length, split.money)`; `:370`
`giftRefundRef(order.id, refundsOf(current.payment).length, split.gift)`; `:371`
`creditGiftCard()` commits alone (`giftcards.ts:556-598`); the fold happens afterwards
(`:384-396` → `src/lib/payments/settle.ts:105-109`).
**Evidence — the rule it breaks.** The route's own comment `:207-214`: «a ledger the two disagree
on can never credit a card twice»; `refund.ts:271-281`: «whatever killed the first attempt, the
ledger it left behind is the one the retry counts, so the same tap twice derives the same
ref». Both hold only while the two ledgers agree. `tests/gift-loyalty-once.test.ts:87-94`
describes precisely this window («a function killed between the two writes», «a 503 out of
settleRefund()») and `:270-288` pins a 409 — on a **card-only** order, where the re-split lands
on `no_provider_ref` (`route.ts:256`). No test has a mixed payment.

**Scenario.** Order 100 € = 30 € card + 70 € bank. Refund 20 €: split {gift 20, money 0}; card
+20 commits; the fold fails (`recorded_failed` 503 at `:454-463`, or the function dies). Owner
presses again for 20 €: `g.left` = 10, split {gift 10, money 10}; Montonio refunds 10 € real
money under a fresh key, the card takes +10 under a fresh ref. Customer: 40 € for a 20 € refund;
`orders.payment` records 20.

**Consequence.** Money leaves twice. Precondition rare (a failed fold after a successful credit)
but it is the case the derived reference was built for, and the test that guards it cannot see
the money half.
**How checked.** Read by two passes (agent, coordinator) end to end; not executed. Confidence high.

### F2 · MED · new — a set (набор) is sold with a part whose size is counted to zero; the paid decrement clamps at 0

**Claim.** `createOrder()` gates a `bundle:<id>` line's parts on the product word only; a part
whose specific rung is tracked and empty is accepted, priced and paid. The storefront mirrors
the hole.

**Evidence — ours.** `src/lib/orders.ts:1091-1108` — bundle branch:
`const state = o?.hidden ? "out" : (o?.stock ?? BY_ID.get(part.id)?.s)`; `variantStates` (built
`:1031-1040` for exactly this) is never consulted for a part. `public/shop2/app.js:10270-10293`
`bundleItemStock()` returns `(p && p.stock) || it.stock || "in"`; `addBundleToCart()`
(`:35545-35551`) is gated on `bundleStock(b)` only and never passes through `addToCart()`. The
part's rung *is* written on the line (`:1103-1107`), so the decrement
(`src/lib/payments/apply.ts:647-662` via `stockUnitsOf`, `src/lib/inventory.ts:465-474`) hits the
empty rung and clamps (`inventory.ts:364-367`, `:512-516`) — a `delta 0` «sale» and a console line.
**Evidence — the rule.** Decision D12 («a counted-empty size is greyed and unbuyable»); plain-line
gate `orders.ts:1218-1219` `if (sizeState === "out") throw new OrderError("out_of_stock", …)`;
`tests/size-stock-storefront.test.ts:307-310` «nothing counted to zero can be basketed, whatever
button sent it» — sets do not come through that button. `deferred:10` and `:54` list the readers
to close; all were closed for plain lines only.

**Consequence.** A paid order for a set containing a bottle the shelf says is gone; found when
packing; substitute or refund; a zero-delta sale in the ledger.
**How checked.** Executed probe: second rung counted to 1 and sold to 0 → `stockByVariant` out; a
plain line of that size refused `out_of_stock`; a set holding `{variant: 1}` of it accepted,
`parts[0].variant` the empty rung, decrement leaves qty 0 with a `delta 0` move. Not fixed later
(`bca9784` changed which ladder prices a part; `src/lib/bundles.ts:267` still `o?.stock ?? p?.s`).

### F3 · MED · new — «Оплачен» after a cancel or refund never re-takes a set's parts, nor a one-size line written before 18.09

**Claim.** The *return* on cancel/refund expands every line through `stockUnitsOf()` (a set
becomes its parts; a nameless one-size line becomes its labelled shelf row); the *re-take* on
the journal undo still walks `kind === "product"` lines with the raw stored `item.variant`. Two
halves of one rule, written by three r19 branches, put side by side at a hand resolution, then
widened on one side only. This is the closest thing to the brief's «fourth one».

**Evidence — ours.** Return: `src/lib/orders.ts:1961-1985` `for (const unit of stockUnitsOf(item))
… move({ delta: unit.qty, reason: "return" … })`. Re-take: `:2027-2049` — `:2032`
`if (item.kind !== "product" || !item.qty) continue;` `:2033` `refLedger(after.number, item.id,
item.variant ?? "")` `:2037` `variant: item.variant ?? ""`. Helper: `src/lib/inventory.ts:452-476`
(`shelfVariant()` `:433-438` maps a nameless one-rung line onto its label); its own doc `:405-421`
lists decrement, refund and till — not the re-take.
**Evidence — the merge.** `5cff57a` (r19-orders) wrote the product-only re-take; `515c85e`
(r19-pos) introduced `stockUnitsOf()` for the return and the decrement (`git log -S`, one
origin); `1de4c26` (r19-products) wrote a third version; `ea83389` = `06b9a8e` + `1de4c26`,
hand-resolved (`git show --cc` hunks in `orders.ts` and `inventory.ts`): dropped `hasReturnMove`,
kept the `refLedger` loop, lifted `reason: … "sale_pos" : "sale_web"` from the losing side, added
the comment `:2024-2026`. `82d489d` (r24-onesize-old-lines, «все три пути ходят через эту
функцию») added `shelfVariant()` inside `stockUnitsOf()` and touched only `inventory.ts` +
`tests/inventory.test.ts` — the fourth path does not go through it. Tests: `tests/inventory.test.ts:699,
:714, :727` (undo, plain product fixture); `:750` (a set is returned per part) has no undo twin.

**Consequence.** A paid order with a набор — or a one-size product line placed before 18.09, or
any stored line whose `variant` is `''` while the shelf row is labelled — cancelled by mistake
and put back to «оплачен» from the journal: the parts went +N at the cancel and are never taken
off again. «Склад» overstated for good; `stockStates()` keeps the product «в наличии»; a later
real refund adds the parts a second time. Owner symptom: «остатки не сходятся» on the products
sold in sets.
**How checked.** Executed probe for the one-size line: rung 5 → paid −1 → 4 → cancelled → 5 →
«оплачен» again → still 5 (expected 4), exactly one `sale_web` move. Set half by reading `:2032`.
Not fixed later: every commit to `orders.ts` after `ea83389` leaves `:2027-2049` unchanged.

### F4 · MED · new — a refund whose answer is lost records nothing; the retry's refusal says the amount «должна быть в списке возвратов», where it is not; a different amount is a second refund

**Evidence — ours.** `src/app/api/admin/orders/[id]/refund/route.ts:270-282` (call) →
`:283-324` (catch: `order.refund_failed` audit row + 502, **no ledger write**) → `:327-351`
(ledger write only on success). `src/lib/payments/montonio.ts:45` `REQUEST_TIMEOUT_MS = 15_000`
→ `provider_unreachable`. The retry re-derives the same key (`refund.ts:253-257`, stable *because*
nothing was recorded) and Montonio refuses it, correctly; `src/lib/montonio-problems.ts:128-138`
then tells the owner «Закройте карточку и откройте заказ заново: сумма должна быть в списке
возвратов». The only writer of a webhook-borne refund is `src/app/api/payments/notify/route.ts:155-247`.
`refundRefusalContext()` (`route.ts:112-130`) already calls `GET /orders/:uuid` in that catch block
and counts `refunds.length` — the array that holds the missing refund's `uuid`, `amount`, `status`.
**Evidence — the contract.** Refunds guide: a webhook is sent «when the status of a refund
changes» — typically the next business day, up to ten days for an under-funded refund;
`400 Order uuid […] already has a refund with same idempotency key`; reference `GET /orders/{uuid}`
returns `refunds: [{ uuid, amount, status, … }]`.

**Consequence.** Money has left; the card shows the full amount refundable; no customer letter
(`:402-412` runs on success only); `pendingRefunds()` does not list it (`src/lib/payments/pending-refunds.ts:74-80`
reads the ledger). If the owner, seeing nothing in the list, tries a *different* amount, `seq` is
unchanged and `amount` differs → a new key → a real second refund. Bounded: the same amount is
refused; the full amount is blocked by `left` once the webhook lands.
**How checked.** Read by two passes; the catch block and the message text re-read by the
coordinator. Not in the deferred list. Confidence high on the code path, medium on webhook timing
(the guide does not say whether creation itself counts as a change).

### F5 · MED-LOW · new — a synchronous carrier registration has a 10-second client timeout; a timeout after Montonio registered the parcel orphans it

**Evidence — ours.** `src/lib/shipping/montonio.ts:49` `REQUEST_TIMEOUT_MS = 10_000`, `:251`
`AbortSignal.timeout`, `:254-255` any throw → `unreachable`; `:1232` `synchronous` defaults to
true. `src/app/api/admin/shipments/route.ts:238-262`: «nothing was booked, so the button must
work again at once» — `releaseShipmentSlot()`, 502, nothing stored. A 409 becomes `rejected`
«409 …» → `reason: "unknown"` → «Перевозчик отказал и назвал причину сам: «409 …»». Payments use
15 s for the same kind of round trip (`payments/montonio.ts:45`).
**Evidence — the contract.** Reference, `POST /shipments`: `synchronous` — «the response will
include the final registration status» (Montonio waits for the carrier); responses `201`, `409
Shipment already exists`, `500`; no list/search endpoint among the thirteen through which an
orphan's id could be recovered. Sandbox guide: carriers are mocked — the 10 s has only ever been
measured against a mock.

**Consequence.** One slow live registration → «не удалось» → second press → either a second paid
parcel or a permanent 409 with no recovery path in the panel. Probability unknown (carrier
latency is undocumented); cost is a parcel or a stuck order.
**How checked.** Read by two passes. Not in the deferred list.

### F6 · MED-LOW · new — after a lost answer the scanner cannot tell «retry» from «the next identical bottle», so a genuine +1 replays the old one while the screen says ✓

**Evidence — ours.** `public/shop2/app.js:30313-30314` `if (STOCK_MOVE.sig !== sig) STOCK_MOVE =
{ sig, key: idemNewKey() }` — the memo is keyed on the body; cleared only on a definite answer
(`:30325`); left in place when `apiJson()` rejects (dead connection or a non-JSON gateway page,
`:30904-30910`). The scanner's next scan of the same code sends a byte-identical body
(`scanCommitMove`, `:29117-29124`: same `productId`, `variant`, `delta`, `reason`, `ref: "сканер"`)
→ same key → the server replays the first answer (`src/app/api/admin/inventory/moves/route.ts:93`,
`src/lib/idempotency.ts:323-329`) → `scanMoveToast()` says «Приход +1 ✓» (`:29128`) and the shelf
does not move. The rejection handler says only «Не удалось сохранить» and re-arms the scanner
(`:29134-29144`). Same shape for the assistant's «Применить» (`:14512-14523`) and the panel's ±
(`:31267-31279`).
**Evidence — the rule.** `180_idempotency.sql` («two identical «+1 приход» bodies are two real
bottles»); `tests/stock-r21.test.ts:495` pins the memo being kept on a lost answer — its premise
(«what follows is a RETRY») is what the scanner cannot guarantee.

**Scenario.** Delivery of six identical bottles; scan 3 lands but the answer is lost; scan 4 →
same body → replay → «✓» → shelf reads 5 after six bottles.
**Consequence.** Count off by one per lost answer during a delivery, shown as success.
**How checked.** Read by two passes (memo, scanner, route, helper). Whether it bites depends on
what the owner does after the toast.

### F7 · MED-LOW · new — the lease can take over a live request, and a function killed after its work committed re-runs the work as a second order

**Evidence — ours.** `src/lib/idempotency.ts:331-337` a `running` row older than `LEASE_MS` is
taken over (`:224-240`); the original holder's `finish()` becomes a no-op (`:260-267`;
`tests/idempotency.test.ts:306-354`). No keyed route declares a `maxDuration` (brief error 4).
«Only success is remembered» (`:343-351`, `:357-362`) plus a reservation that is not
transactional with the work (`180_idempotency.sql`, «that separation is the whole design»)
means a crash between the work's commit and `finish()` leaves a `running` row that a retry
re-runs after 90 s. Per route, what is committed before `finish()`: orders — the row
(`src/lib/orders.ts:1670-1696`, autocommit) and for «По счёту» the invoice number, blob and
letter (`src/lib/invoices.ts:213-222`, `:505-512`); moves — one `withTx` (`inventory.ts:498-510`);
products/blog/reviews — the row. POS is protected by `pos_ref` (`saleAlreadyRung`,
`pos-orders/route.ts:270-295`). The same double-run happens without a crash if `finish()` itself
fails (`:374-383`: row stays `running`, client gets 201).
**Evidence — the client.** `POST /api/orders` is sent with no timeout (`app.js:16258`,
`:16068-16072`), so a live tab cannot retry while the first request runs; the slow-but-alive case
needs a client-side failure while the function keeps working, then a tap after 90 s.

**Consequence.** A second order — for «По счёту» a second numbered invoice mailed — or a second
stock movement, from a function kill in a window of one statement. Low probability, real
money/mail when it happens.
**How checked.** Helper, routes, `db.ts` (`query` is autocommit `:163`, `withTx` a separate client
`:167-186`), takeover test — read. Not executed.

### F8 · LOW-MED · new — a one-size order paid before 18.09 and refunded or cancelled after inflates the count

**Evidence.** Before `f1ee6c3`/migration 194, a web sale of one of the 29 went to `('id','')`;
in the state 194 itself describes as typical (`194_one_size_stock_rows.sql:17-32`: the `''` row
was the seeder's zero, untracked), `move()` skipped the sale (`inventory.ts:499-507`). A refund
after 18.09 returns through `stockUnitsOf()` → the labelled rung, which *is* tracked
(`orders.ts:1961-1985`, the only guard `:1971` `isTracked` on the rung) → `+qty` onto a shelf that
never lost it. `82d489d`'s message («Заказ, оплаченный ДО 194, уже уменьшил строку ''») is true
only if `''` had been counted.
**Consequence.** Over-count by the refunded quantity for every such order — a handful at most.
**How checked.** Executed probe: rung 5, old-shaped line, pre-fix decrement on `''` skipped, refund
→ 6.

### F9 · LOW-MED · new — the `''` shelf row that migration 194 folded away can be recreated by the assistant and by the raw moves route

**Evidence.** `src/app/api/assistant/actions.ts:1107-1119` `const variant = oneLine(x.variant,
120)` for `stock_adjust`/`stock_set`, no ladder lookup; the prompt says «variant: only if the
product has sizes» (`route.ts:500-501`) while the CATALOGUE block lists sizes only for `c-`
products (`:356`, `:427`) — for the 29 the model has no rung to name; `app.js:14503-14506`
`variant: a.variant || ""`; `src/app/api/admin/inventory/moves/route.ts:88` `variant = body.variant
== null ? "" : String(body.variant)` passed as is; `applyMove()` creates the row
(`inventory.ts:347-352`). The read side resolves an empty size to the rung (`orders.ts:874-877`,
`inventory.ts:433-438`); nothing does on the write side. Against 194's promise `:34-36` («from
here on both halves key on the label»).
**Consequence.** «приход 6 штук Touchable» by chat/voice lands on `('touchable','')`, which
becomes tracked; web sales keyed to «250 мл» are skipped again while that rung is untracked;
«Склад» shows two rows again — the bug 194 fixed, recurring.
**How checked.** Read (agent); the row creation is `applyMove()`'s insert-if-missing. Not executed.

### F10 · LOW-MED · new (residue of `deferred:12`) — a page reload after a lost answer drops both the key and `pendingOrder`; the restored basket makes a second order

**Evidence.** `orderIdem` and `pendingOrder` are module variables (`app.js:16028`, `:16188`);
`persist()` writes `{cart, lang}` only (`:8584-8586`); the comment `:16183-16184` says so («a
reload is a new visit, and the first order is then the cron's to let go»). On an iPhone a
backgrounded tab is reloaded by Safari; a shopper who saw «Магазин не ответил» (`:16283`) may
pull to refresh. For «По счёту» the first order already numbered and mailed an invoice
(`invoices.ts:213-222`, `:512`).
**Consequence.** Two orders and two invoices for one company purchase; for a bank order the
first stays `new` (the 7-day cancel — F0.5 — is off). `deferred:12` asked for the server key and
got it; the reload case is what remains, and «the cron's to let go» presumes a switch that is off.

### F11 · LOW · new — «По счёту»: a failure after the order INSERT and before the invoice is written answers 500, releases the key, and the retry creates a second order

**Evidence.** `createOrder` inserts (`orders.ts:1670-1696`), then `issueInvoice` (`:1702-1705`) →
`nextInvoiceNumber` (`invoices.ts:213-222`, its own statement) and `update orders set invoice …`
(`:505-509`); none in a transaction with the INSERT; a throw → route 500
(`orders/route.ts:163-164`) → `runOnce` deletes the row (`idempotency.ts:357-362`) → the retry
under the same key runs `createOrder` again. Order #1 sits as `new` with a company block and no
invoice.

---

## 3. Findings — what the owner is told in the first live week

### F12 · MED · new — «Возврат денег покупателю» goes green on a card-paid order while bank-link refunds are still off

**Evidence — ours.** `src/app/api/admin/montonio/route.ts:78-91` `newestPaidRef()` — newest order
in a paid status with a payment ref, **no filter on `payment->>'method'`**; `src/lib/payments/montonio.ts:514-531`
`fetchOrder()` maps `paymentStatus, grandTotal, currency, availableForRefund, isRefundableType,
refunds[]` and drops `paymentMethodType`; `route.ts:31-33` asserts «`isRefundableType: false` on
a real paid bank-link order is the switch being off» without establishing the order is a
bank-link one; `src/lib/montonio-problems.ts:700-705` `refundable === true` → «Возвраты включены:
«Вернуть деньги» в карточке заказа работает» (green). The test fixture stores `method:
"paymentInitiation"` (`tests/montonio-docs-payloads.test.ts:540`), a value production never writes
(`PaymentMethodKind` is `bank|card|wallet`, `types.ts:27`).
**Evidence — the contract.** Reference `GET /orders/{uuid}` example: `"isRefundableType": false`
— «will be true if you enabled refunds in montonio **(and the user paid with a refundable
method)**», beside `"paymentMethodType": "cardPayments"`. Refunds guide: Payment Initiation needs
«Bank payment refunds» enabled in the Partner System; cards, Apple Pay, Google Pay, MobilePay,
BLIK, BNPL are «enabled by default». `docs/go-live.md:48` names this product as the cause of the
three refusals of 18.09.

**Consequence.** Newest paid order a card or wallet → the one row this screen exists for is green
from then on while «Refundable bank payments» is off; the first bank-link customer asking for
money back gets `exceeds the total amount refundable [0]`. One predicate fixes it (sample only
`method = 'bank'`, or read `paymentMethodType === "paymentInitiation"` and report `unknown`
otherwise).
**How checked.** Route SQL, `fetchOrder()` mapping and the row text re-read by the coordinator.
Introduced `d0e5594`, unchanged at `9b7f48d`.

### F13 · MED · new — «Montonio сообщает о посылках» is green for *any* registered webhook; URL, trailing slash and events are not checked, and three documents disagree on which events to tick

**Evidence — ours.** `src/app/api/admin/montonio/route.ts:165-171` `webhookRegistered: webhooks ===
null ? null : webhooks.length > 0`; `src/lib/shipping/montonio.ts:1529-1548`
`fetchMontonioWebhooks()` returns `{ id, url, events }` per webhook — discarded. Nothing compares
`url` to `${PUBLIC_BASE_URL}/api/shipping/notify/` (`next.config.ts:225` `trailingSlash: true`;
`src/app/api/shipping/notify/route.ts:42-43` «a POST without it becomes a 308») or inspects
`events`. `docs/shipping.md:813-815` and `:1077-1078` tell Renat to tick **one** event
(`shipment.statusUpdated`); `docs/shipping.md:1006` says `shipment.registrationFailed` is needed
too; `docs/montonio-untested.md:101-102` says at least three. The per-order
`shipment.registration_failed` journal row (`notify/route.ts:131-150`) fires only if that event
is delivered.
**Evidence — the contract and the test.** Reference `GET /webhooks` fields `id, url, enabledEvents`;
the reference's own example — pinned verbatim as the route test's fixture
(`tests/montonio-docs-payloads.test.ts:227-235`: `url: "http://partner.montonio/shipmentEvents"`,
`enabledEvents: ["shipment.registered"]`) — is asserted `webhookRegistered === true` (`:742`).
The test pins the false positive.

**Consequence.** A webhook left on the staging host, pasted without the slash, or subscribed only
to `shipment.registered` shows «Настроено: заказ сам станет «Доставлен»…». Orders never close by
themselves, `registrationFailed` never reaches the journal, `settings.shipping_statuses` stays
empty — the silent state `docs/montonio-shipping-audit.md § 1.1` was written about, now behind a
green tick. Bounded by the nightly `GET /shipments/{id}` poll (`src/lib/delivery.ts:215-228`) for
delivered/returned only. The domain move in `/golive/` makes «old URL still registered» a likely
day-one state.
**How checked.** Route and reader re-read by the coordinator; two passes reached it independently.

### F14 · MED · new — wrong keys (401/403) or a timeout are shown as «Проверяем…» / «Пока не знаем … как только пройдёт первая оплата», never as «Montonio не узнал ключи»; the go-live script claims otherwise

**Evidence — ours.** `route.ts:132-138` five `.catch(() => null)`; `src/lib/payments/methods.ts:262-265`
(`!res.ok` → null), `payments/montonio.ts:501-504`, `shipping/montonio.ts:1506-1509`, `:1544-1547`
— status codes logged and dropped; `montonio-problems.ts:713-715` `null` → «Пока не знаем … Как
только пройдёт первая оплата, эта строка скажет точно»; `:738-740` «Проверяем…» with no end
condition. `ReadinessState.bankPayments` and `.carriers` are computed (`route.ts:181-183`) and
never rendered as rows (`montonio-problems.ts:653-767`); the problems test pins the row list as
exactly `["env","refunds","ship_webhook"]`. `route.ts:206-218` writes the all-null answer over
`settings.montonio_readiness`; no reader exists (grep) — harmless today. The readiness route has
no test with a 401 (`tests/montonio-docs-payloads.test.ts:721-768`).
**Evidence — the contract and the doc.** Refunds guide errors: `401 STORE_NOT_FOUND - double check
your access key`, `403 INVALID_TOKEN - double check your secret key`. `docs/montonio-untested.md:124-127`:
«Live keys with `MONTONIO_ENV=sandbox` answer `401 STORE_NOT_FOUND`; a mismatched secret answers
`403 INVALID_TOKEN`. **Both now say so in the panel, in three languages.**» — true only inside a
refund attempt (`montonio-problems.ts:268-271`) or a booking attempt (`:598-599`), i.e. after the
owner has already tried to move money or a parcel. `docs/go-live.md:89`: «Half of this pair is
worse than neither.»

**Consequence.** On Sunday the keys and `MONTONIO_ENV` are set by hand. With one half wrong the
pre-customer check (`docs/montonio-untested.md` Part 3.1) shows two grey rows and «as soon as the
first payment goes through» — none will, because `POST /orders` answers 401 too. The two sentences
for exactly this exist (`bad_access_key`, `bad_secret_key`, `montonio-problems.ts:192-221`); the
probe never lets a status reach them.
**How checked.** Every probe's error path and the row builder re-read by the coordinator.

### F15 · MED · contradicts decision E1 (panel side) — after a refused registration the order card tells the owner to «Отложите этикетку и создайте её заново», which the server refuses by design; and the card is not refreshed on the refusal

**Evidence — ours.** `public/shop2/app.js:18265` (card hint, under the «Перевозчик не принял»
badge `:18259`): «Montonio отметил отправление как непринятое: трек-номера не будет и посылку по
этой этикетке не примут. **Отложите этикетку и создайте её заново.**» Server:
`src/app/api/admin/shipments/route.ts:170` `if (registrationRefused(existing)) return
refusedResponse(existing);` precedes `:171` `if (existing.dismissed)` — a dismissed refused
shipment gets the same 502; `src/lib/montonio-problems.ts:496-498` says a second press is useless
and to pass the correction to Dim; the label route answers 409 (`[id]/label/route.ts:70-76`).
`tests/montonio-docs-payloads.test.ts:668-676` pins the second-press refusal. On the 502 the panel
only `render()`s (`app.js:32062`) and reloads orders on success only (`:32050`), so the badge and
the stored refusal appear only after a later refresh — right after the refusal the card still
offers «Создать этикетку».
**Evidence — the decision.** Brief, 18.09: «a refused carrier registration is shown on the order
(stored, then reported as 502 `registration_failed`; a second press repeats the refusal by
design)». The hint was written 17.09 (`:18220-18224`), before that decision, and was not updated
by `928597f` or `3be3ae6`.

**Consequence.** Owner with the parcel in hand follows the card: «Отложить», then «Вернуть
этикетку»/«Создать этикетку», a 2.6-second toast each time (F16), never the instruction to write
to Dim.
**How checked.** Both sides re-read by the coordinator.

### F16 · MED · new — every trilingual explanation lives in a 2.6-second toast; the journal never prints the reason; the fallback sentence points to the journal

**Evidence — ours.** `toast()` `app.js:35438-35443` — 2 600 ms without an undo. Refund refusal
`:31943` `toast(srvMsg(r.body) || REFUND_ERR[err] …)`; label refusal `:32061-32062`; the pending
line appended to the toast `:31917-31921`. The journal renders `AUDIT_WORDS[action] + ": " +
number` and nothing else (`auditTextHTML`, `:23093-23101` — `payload.reason`, `.detail`, `.code`
never printed). The `provider_rejected` fallback `:31833`: «Montonio не принял возврат. Причина —
в журнале заказа.» — the journal shows «Возврат не прошёл: R-100042».
**Evidence — the doc.** `docs/montonio-untested.md` Part 3.4 («Send Dim the quoted line verbatim»)
and Part 4 («quote Montonio verbatim as the fallback»); the quote (≤ 300 chars,
`payments/montonio.ts:127`) is on screen for 2.6 s on a phone and otherwise only in the raw audit
JSON.

**Consequence.** The «fail informatively» investment is not re-readable: the owner sees a sentence
vanish, opens the journal, finds a label and a number, and writes «не прошло». `detail` and
`reason` are in the database; no screen shows them.

### F17 · MED (doc) · already fixed in code, doc not — `docs/montonio-untested.md`, the payments audit and the shipping audit are stale about what landed on 18.09

The doc is the first-hour script. At `9b7f48d`:
- Part 3.1 (`:138-143`) and Part 4 (`:227`) say the panel half was **not applied** and send the
  owner to a JSON route. It landed the same day in **`928597f`**: `loadMontonio()` and the rows
  (`app.js:17004-17014`, `:21839-21848`), `srvMsg()` (`:31809-31812`), the replaced
  `provider_rejected` sentence (`:31833`), `pendingMessages` (`:31917-31921`), `registration_failed`
  handling (`:32055-32063`), journal labels with ET/EN (`:23061-23063`, `:534-537`, `:3344-3347`).
- Payments audit A1 «Still to do — `app.js:30714` still says «проверьте баланс»» — done in `928597f`.
- S6 «Nothing. We never read the flag and never send dimensions» and D6 — done in **`3be3ae6`**
  (`parcelDimensionsRequired()` `shipping/montonio.ts:388-416`, metres `:1199-1207`,
  `tests/shipping-parcel.test.ts:339-353`); the shipping audit's § 4 table `:301-303` still says
  «never read».
- S7 «Nothing», D7, Part 2 `:105-106` («accept that the A4 slip's drop-off code will be blank»)
  and Part 3.3 `:175-176` — `lockerSize` is now sent (`3be3ae6`; `montonio.ts:1149-1150`,
  `parcel.ts:139`); § 4 table `:303` still says «never sent».
- S11 reads as a precondition («rebuild the mirror with keys **before** offering lockers outside
  EE/LV/LT»); the lockers were opened first on the owner's decision.
- Part 5 «None is applied» — D6 and D7 are.
- Part 3.3 `:177-178` («watch the order … should move it to «Доставлен» by itself») does not say
  the order must be in «Отправлен» first (`notify/route.ts:159` closes only from `shipped`).
No commit after `d0e5594` touches the file.

### F18 · MED · new — `/golive/` and `GET /api/golive/` are public and hand the launch's open safeguards to anyone

**Evidence — ours.** `src/app/api/golive/route.ts:47-57`: `const signedIn = isAdmin(req); if
(!signedIn) return Response.json({ ok: true, plan: PLAN, signedIn: false, states: {}, gate: gate({}) })`
— the full item text of `src/data/golive.json` (35 items) to a reader with no session; the
header `:9-14` argues «GET is PUBLIC … no more secret than /guide/»; `tests/golive-route.test.ts:316`
pins it. `next.config.ts:98` adds `golive` to the public rewrites; `public/golive/index.html` is a
static file with OG tags for link previews (`:9-18`) and a `noindex` meta (`:8`), but `/golive/`,
`/test/` and `/guide/` are absent from `NO_INDEX_PATHS` (`tools/prerender-shop2.mjs:1961-1965`),
so `robots.txt` does not disallow them.
**Evidence — what it says.** `session-secret` («Без него всё закрывается молча: возврат корзины
просто не работает, и никто об этом не скажет»), `webhook-alarm` («…Молчание в этом месте
выглядит ровно как «заказов нет»»), `refunds-live» («…18.09 не прошли три возврата»), `same-db`
(«боевая база — тот же Railway, что у стенда»), `domain-dns` («DNS лежит в ASCIO»),
`live-keys-env`, `code-legal` (privacy policy still names Shopify), `crons`, `region-fra1`.

**Consequence.** During launch week an unauthenticated reader learns that a failed payment
notification raises no alarm, which environment variables are unset, that refunds do not work
live, that staging and production share one database, and which registrar holds the domain
(where a transfer-phishing call starts). No credential; a map. The route already has
`isAdmin(req)`; the «usable before sign-in» case is the page's localStorage half, which needs
the list on the device, not the world.
**How checked.** Route, page, `next.config`, `NO_INDEX_PATHS`, `golive.json` re-read by the
coordinator. Design intent recorded in the route header; reported because the content is
operational, not editorial.

### F19 · MED-LOW · new — the `order.refund_stuck` branch of the real webhook route has no test, and writes its journal row *before* the fold, so a 503 retry writes it twice

**Evidence.** `src/app/api/payments/notify/route.ts:206-220` writes `order.refund_stuck`, then
`:222-246` `settleRefund()` — a throw answers 503 (`:244-245`), Montonio redelivers, the row is
written again. `order.refund_stuck` occurs in no file under `tests/` (grep); the documented
`refundStatusDescription` token is exercised only through `verifyRefundNotification` +
`readRefundStatusDescription` in isolation (`tests/montonio-docs-payloads.test.ts:316-333`).
`docs/montonio-untested.md:52` and Part 4 present the path as pinned.
**Consequence.** The one journal row that explains a stuck refund (`INSUFFICIENT_FUNDS`,
`EXPIRED`) is the least-covered piece of the chain and can appear twice.

### F20 · MED-LOW · new — the 10-day clock restarts on every webhook for the same refund; the countdown text is only ever fed 0

**Evidence.** `pendingRefunds()` computes age from the ledger entry's `at`
(`src/lib/payments/pending-refunds.ts:45-49`, `:90-99`, `overdue: hours >= 10 × 24`);
`foldRefund()` merges `{ ...r, ...entry }` by `ref` (`refund.ts:214-223`) and every webhook
carries `at: new Date().toISOString()` (`notify/route.ts:229`) — including a PENDING retry notice.
`refundPendingText(hoursOld)` is called only with `0` (`refund/route.ts:439`);
`REFUND_PENDING_WATCH_HOURS` and `refundsWorthLookingAt()` have no caller in `src/`; the problems
test drives the countdown with 72 h and 264 h that production never supplies.
**Evidence — the contract.** Refunds guide: «PENDING — … If a previous attempt failed (e.g. due to
insufficient funds), the system will retry automatically.» Whether each retry sends a webhook is
not documented.
**Consequence.** `overdue` means «10 days since the last notice», not «since the refund». Mitigated:
when Montonio gives up it sends CANCELED (+ `EXPIRED`), which drops the entry and writes
`order.refund_stuck`; the flag matters only when that final webhook is lost — the case it was
built for.

### F21 · MED-LOW · new (unverifiable until a real label exists) — the label normaliser has no size sanity check, `?size=A6` is not a fallback for a mis-recognised file, and `/Rotate` is dropped

**Evidence.** `src/lib/shipping/label-pdf.ts:124-152` identifies «the label» purely structurally
(page → single `/Form` child → … innermost single-child form) and draws it scaled to the sheet
(`:414-430`) with no check that the form's box is label-sized; a real label whose own form holds
exactly one nested form (a logo block) is unwrapped one level too far. Both `A4` and `A6` run the
same walk (`[id]/label/route.ts:141`), so the doc's «the A6 option is the fallback»
(`docs/montonio-untested.md` Part 3.3) does not hold for that failure, and the untouched file is
unreachable from the panel. `/Rotate` is deleted (`:425-427`) without being applied;
`sheetWithSlip` (`:358-373`) does not honour it. `tests/shipping-label-pdf.test.ts:26-47` builds the
exact 1.85× double nesting the code expects (unchanged since `22070cf`, before the range); the
sandbox generates dummy labels.
**Consequence.** Possible first-label outcome: a fragment on both paper sizes; recoverable with
Dim; the owner cannot get the raw PDF himself.

### F22 · LOW-MED · new — an international number whose calling code is not one of the 32 destinations (+7, +380, +375, +1 …) is sent under the destination's code with the foreign code left inside `phoneNumber`

**Evidence.** `src/lib/shipping/montonio.ts:919-924` the international branch scans `PHONE_PREFIX`
only; `:933-936` the fallback keeps every digit under the destination's code.
`tests/shipping-montonio.test.ts:889-890` pins `"+9715551234"` to DE → `{ 49, "9715551234" }` as
correct (the fallback written in as the contract). Reference: `phoneNumber` — «the phone number
without the phone county code»; shipments guide: «A common issue causing this
[`registrationFailed`] is an incorrect receiver phone number»; sandbox skips validation.
**Consequence.** A Russian, Ukrainian or Belarusian mobile in Tallinn — plausible for a RU-default
shop — books as `372 79991234567`: `registrationFailed` or a collection SMS to nobody; with
`PATCH /shipments/{id}` deferred (D8) the owner's path is «write to Dim». Cheap to close (a wider
longest-match on international form).

### F23 · LOW-MED · new — `shipment.registrationFailed` on the webhook is keyed on an inferred `data.status` word; `eventType` is logged and never tested

**Evidence.** `src/app/api/shipping/notify/route.ts:139` `if (String(seen.word).toLowerCase() ===
"registrationfailed")`; `src/lib/shipping/webhook.ts:129-134` never gates on `eventType`. The four
fixtures modelling the event (`tests/montonio-docs-payloads.test.ts:431-441`, `:628-636`,
`:693-702`; `tests/shipping-webhook.test.ts:362-385`) are all the *registered* example edited to
`status: "registrationFailed"`. The shipments guide prints no failed synchronous response and
the webhooks guide prints no `registrationFailed` webhook; the only sample is `shipment.registered`
with `data.status: "registered"`. The synchronous-response reading (`shipments/route.ts:80-84`)
is well founded («the response will include the final registration status»); the webhook reading
is an inference.
**Consequence.** If the live webhook carries the shipment at `pending` with the failure only in
`eventType`, no `shipment.registration_failed` journal row — the owner finds out from the
customer. One-line hardening (`|| event.event.toLowerCase() === "shipment.registrationfailed"`),
not applied.

### F24 · LOW · contradicts decision E2 (partial) — a per-unit weight estimate is still computed and sent with every parcel

**Evidence.** Decision: «one small default carton, **no weight modelling** — deliberately, because
Montonio bills `max(actual, volumetric)` … so the box is what is paid for». Code:
`src/lib/shipping/montonio.ts:948-953` `estimateWeightKg = min(30, max(0.3, 0.4 × units + 0.2))`;
`:1172` `parcel.weight = opts.weight > 0 ? opts.weight : estimateWeightKg(order)` on every
`POST /shipments`; the panel never sends a weight. The carton is ≈ 1.1 kg volumetric
(`src/lib/shipping/parcel.ts:164-171`), so for three or more units the *estimate* (1.4 kg, 2.2 kg,
3.0 kg) is the chargeable weight, not the box. Kept knowingly: `parcel.ts:55-57` «no
basket-to-weight estimator beyond the one that already exists». `a5ff864` («Вес товаров больше
не нужен») is docs-only.
**Consequence.** The decision's premise («the box is what is paid for») holds for one- and
two-unit orders only; the shop's cost per parcel scales with the line count by a guessed
0.4 kg per unit. Customer unaffected (flat price per country). Declaring 0.6 kg for a heavy parcel
would invite a surcharge, so the estimator is not obviously wrong — it is not what the decision
says.

### F25 · LOW · contradicts decision D2 (partial) — the panel renamed «Топ товаров»/«Бренды» to the value of goods; the admin assistant is still told the same list is «revenue»

**Evidence.** `app.js:21469`, `:21503` renamed with the hint «…а не полученные деньги» (ET
`:1558`, `:1579`; EN `:4343`, `:4364`). `app.js:16983-16991` `analyticsForAI()` posts
`topProductsByRevenue…{revenue}`; `src/app/api/assistant/route.ts:458-459`: `revenue ${…} €, …
Best-selling by revenue: … (${p.revenue} €)`; the source is `qTopProductsByRevenue`
(`src/lib/analytics.ts:213-222`), price × qty before order discount, points and gift cards.
**Consequence.** Renat asks the assistant «что приносит больше всего денег» and is told, in euros
and as revenue, the number the panel was just relabelled to stop calling money — on an order
with a 20 % promo the two disagree by exactly the discount.

### F26 · LOW · new — `labelFile.*` and `shipment.labelsCreated` events are read as shipment statuses; a label file's `data.id` is looked up as a shipment

**Evidence.** `src/lib/shipping/webhook.ts:129-134` `shipmentId: pick("shipmentId", "id")`,
`status: pick("status", …)`, no `eventType` gate; `notify/route.ts:91-118` records «ready»/«failed»
into `settings.shipping_statuses` and writes a first-sighting `shipment.status` row. Noise only:
`looksDelivered("ready")` is false, the order never moves, the route answers 200
`unknown_shipment`. Only if those events are ticked (F13).

### F27 · LOW · new — the shipping webhook route and library assert facts from the *payments* guide

**Evidence.** `src/app/api/shipping/notify/route.ts:23-27` and `src/lib/shipping/webhook.ts:145-146`
say Montonio «retries a failed delivery for 48 hours and expects 200/201». That sentence is the
Stargate webhooks guide's; the Shipping v2 webhooks guide documents the body `{ payload }`, the
secret-key signature, two source IPs and the ten-webhook limit — nothing on retries, attempt
counts or the expected response code (checked twice). The 503-on-database-blip strategy
(`notify/route.ts:95`, `:110`, `:165`) may therefore be a lost event rather than a redelivery;
delivered/returned are re-derived by the nightly poll, a lost `registrationFailed` is moot while
bookings are synchronous. A guess written as a fact, in the file whose header says guesses are
the bug.

### F28 · LOW · new — three small locker-size inconsistencies

1. `src/lib/shipping/parcel.ts:236-238` (and `:293`) say the seed is `L`; `PARCEL_DEFAULTS.lockerSize`
   is `"M"` (`:169`, header `:104-111`). Comment only.
2. `shipments/route.ts:298-300` remembers the size when `takesLockerSize(shipment.carrier)` (the
   carrier from Montonio's *reply*) but `montonio.ts:1149-1150` only *sent* it when
   `takesLockerSize(carrier)` (the *hint*). An order whose stored carrier is empty and whose point
   id is a Montonio UUID (`carrierHint()` → `""`, `:1092-1107`) books SmartPosti without a size and
   then records one as chosen; the audit row (`:309`) claims it too.
3. The suggestion is carrier-blind across Unisend/SmartPosti (the reference prints one enum
   `XS S M L XL` for the three carriers and no per-carrier restriction — not a contradiction, a
   risk the docs do not rule out). `GET /carriers` returns `contracts[].defaultLockerSize`, the
   safety net `docs/go-live.md:50` asks the owner to set; the probe does not read it.

### F29 · LOW · new — four smaller Montonio-path gaps

- **A PENDING money half followed by a card refusal** leaves a pending ledger entry with no
  `order.refund_pending` journal row and no `pendingMessages` (`refund/route.ts` order: provider
  `:271` → money ledger `:336` → card `:371` → return 409 `:374` → letter `:403` → journal `:424`).
  Needs the card voided between the pre-check `:236-248` and the credit — rare.
- **Enabled methods and contracted carriers are computed and never rendered** (`route.ts:149`,
  `:181-183`; no row in `montonio-problems.ts:653-767`); `docs/montonio-untested.md` Part 3.1
  («the enabled methods list contains `paymentInitiation`») can only be checked in the raw JSON.
- **`fetchOrder()` pins an absent `availableForRefund` as `0`** and an absent `isRefundableType`
  as unknown (`tests/payments-montonio-refusal.test.ts:209-215`); the reference prints both on
  every order. Cosmetic («0 €» on the 502 body) — the refusal `reason` comes from Montonio's
  message (`montonio-problems.ts:255-266`).
- **No Montonio-signed `VOIDED` token goes through the real notify route** in any test; the
  chain is mapping (`tests/payments-montonio.test.ts:292`) + the mock provider's «failed» ticket
  (`tests/fuzz-money.test.ts:278-283`). Right by construction (`apply.ts:725-731`).

### F30 · INFO — two comments the documentation contradicts, both harmless today

- `src/lib/shipping/parcel.ts:29-33`, `:180-187`: «the documented `bufferApplied` is a further 25 %
  on top of ÷5000». The reference: `bufferApplied` — «Buffer percentage applied to **height** for
  stacking» (15 %); `volumetricWeight` has no printed formula, only the example 20×15×10 cm →
  0.75 kg (÷4000 for a single item). Display only («около N кг»); `tools/lib/delivery-pricing.mjs:220-236`
  reads the real `chargeableWeight`, which is the right way; `docs/montonio-questions.md § 6`
  already asks.
- `src/lib/montonio-problems.ts:593-600` keyword matching: any message containing `pickupPoint` →
  `bad_point` («Пакомата из заказа у Montonio нет…»), any containing `address` → `bad_address`;
  a 400 such as «shippingMethod.type must be one of … courier, pickupPoint» would tell the owner to
  pick another locker. The reference documents only «Input data validations failed» for 400s;
  the file's own rule (`:21-24`) is to quote when unsure. Raw text still shown as `detail`.

---

## 4. Findings — storefront, build, mirrors

### F31 · MED-LOW · new — the build reads the owner's price and «Показывать в магазине» but not his stock word

**Evidence.** `product_overrides.stock` exists (`001_core.sql:35`) and is folded live by
`getOverrides()` (`src/lib/orders.ts:622`, `:690-694`) with the counted state. The build's reader
`tools/lib/overrides-export.mjs:116` (new in the range, r26) selects `product_id, price, sizes,
hidden` — no `stock`; `tools/prerender-shop2.mjs:885` `stock: p.stock` from `catalogue2.js`,
`:921-923` chip, `:1077` featured filter, `:1315`/`:1388` sets; `src/lib/seo-head.mjs:645`, `:673`
meta description and `schema.org/InStock|OutOfStock` from the same file value. Live,
`app.js:34281` `setHead()` uses `soldOut(p)`; `src/lib/product-page.ts:157-159` the same rule.
`tests/grid-hidden-r26.test.ts` guards `hidden` only. `tools/build-merchant-feed.mjs:30,90,97`
also reads file stock (the feed's staging host is known; the stock source is a separate point).
**Consequence.** A product the owner set «нет в наличии», or counted to zero, is served as
«В наличии»/InStock in static HTML, meta description and Product JSON-LD until `app.js` boots
and rewrites the head; the reverse for a file-«out» product put back on sale. Google renders JS;
no-JS scrapers, the first paint and feed readers see the snapshot. r26 unified `hidden` for the
build; `stock` is the one override it still ignores.

### F32 · LOW · new — `resumeCart()` claims «the same backstop addToCart() has», but `addToCart` gained a per-size backstop and `resumeCart` did not

**Evidence.** `app.js:15470-15476` (`aa44a2f`, r21-settings): «…the same backstop addToCart() has:
nothing out of stock enters the basket…» — `if (known.stock === "out") return;` only, then
`S.cart.push(…)` (`:15482`). `app.js:35506-35514` (`48cc8ca`, r23-sizestock): `if (sizeOut(byId(id),
si)) { toast(sizeGoneText(…)); return; }` — «the one place it has to be said». `sizeOut(` is
called at 8665, 8693, 10129, 11422, 12208-12210, 14571-14588, 31106, 34790-34822, 35514 —
`resumeCart` is absent. The basket then says it (`:11421-11423`, «said, not enforced») and the
server refuses the line.
**Consequence.** The «вы оставили корзину» letter brings back a volume counted to zero after it
was basketed; the shopper removes it by hand at the last step. No money. Two branches, merged
without a conflict, each right on its own.

### F33 · LOW · new — «this product cannot be bought» is three expressions; `soldOut()` says it is «the same three-way screenProduct() makes», and is not in the case its own comment names

**Evidence.** `app.js:12208-12210` (`prodGone = p.stock === "out" || soloGone`, `volGone`);
`:34790` the patch copy; `:8668-8694` `soldOut()` (`d54ce0b`, r25-seo, merged `97b0c2e` without a
conflict): manual out, or `p.stockVar` and *every* size out. Multi-size, all counted out,
`p.stock === "in"`: `soldOut` true, `prodGone` false, `volGone` true → the page draws «выберите
другой объём» (`:12253-12255`) with nothing to pick, the head draws `OutOfStock` (`:34247`,
`:34279-34283`). Only in the «one bottle, two rows» state; the cost is drift on the next edit.

### F34 · LOW · new — a basket line whose *product* went «Нет в наличии» after it was basketed is not marked

**Evidence.** `app.js:11421-11424` `lineNoteHTML()` marks only `sizeOut(cp, l.size || 0)`;
`adoptServer()` drops hidden lines only (`:31009-31011`); the server refuses with one sentence
naming no line (`ORDER_ERRS.out_of_stock`, `:16083`; `orders.ts:1174-1175`). The failure `48cc8ca`
fixed for sizes («nothing to say WHICH of three lines») remains for the product word.

### F35 · LOW · new — an owner ladder of one *unlabelled* rung splits the shelf key from the order key on the 29

**Evidence.** `inventory.ts:821-841` `ladderLabels()` turns `[{size:"",price}]` into `[""]`;
`orders.ts:838-843` `overrideLadder()` turns it into `null` and `variantOf()` falls back to the
file ladder, whose single rung is named — the order line says «250 мл», the sale lands on an
untracked rung and is skipped, the count under `''` never moves. The editor produces the shape
(«×» on the last row → `szRows.push({ size: "", price: "" })`, `app.js:36348-36351`);
`cleanSizes()` keeps an empty label (`orders.ts:307-314`); 194 skips such products (`:129-137`).
**How checked.** Executed: count 5 on `''`, order line = the rung, decrement «skipped», qty still
5; after zeroing `''` by hand the order *is* refused — no overselling, no decrement.

### F36 · LOW · new — the blog sanitizer twin: `HTML_DROP` has `xml`, `BLOG_TAGS_DROP` does not; nothing feeds one body through both

**Evidence.** `src/lib/blog-html.mjs:233-236` `"script", "style", "iframe", "object", "embed",
"noscript", "template", "svg", "math", "head", "title", "xml"`; `app.js:11179-11182` the same list
without `XML`. Everything else agrees mechanically (allowed tags, alias, `FIG_VALUES`, `MAX_DEPTH`,
`PRODUCT_ID_RE`, `<a>/<img>/<figure>` attribute rules, URL filters).
`tests/blog-panel-shop.test.ts:277-292` slices the client tables alone; `tests/blog-figure-r22.test.ts`
compares the server module with itself (`70d37a5` «он сравнивает модуль сам с собой»). The
`data-fig` drift went unnoticed for a round for exactly this reason.
**Consequence.** A bare `<xml>` block keeps its text in the editor preview and loses it in the
saved article. Small; the next attribute will drift the same way.

### F37 · LOW · new — the admin journal has no Russian word for seven server audit actions; two are new in the range

**Evidence.** `app.js:23039` `AUDIT_WORDS` (45 keys) lacks `return.handled` (`5862c54`, r22-panel)
and `golive.save` (`667e401`) from this range, and `order.refund`, `invoice.cancelled`,
`invoice.reminded`, `giftcards.voided`, `testplan.save` from before it; none of those payloads
carries `line`, so `auditTextHTML()` (`:23093-23101`) prints the raw code — «order.refund:
R-100042». The client also holds three words the server never writes (`product.show`,
`customer.created`, `customer.partner_added`). Money events appear as dotted English codes,
against the plain-Russian rule.

### F38 · LOW · new — `ORDER_ERRS` has no sentence for 12 `OrderError` codes

**Evidence.** `app.js:16079-16126` vs codes thrown in `orders.ts`/`invoices.ts`/`bundles.ts`:
`unknown_item` (`orders.ts:1169`), `too_many_items` (`:1022`), `bad_qty` (`:1082`), `bad_item`,
`gift_unknown`, and the admin-side `bad_name/bad_price/bad_stock/bad_status/bad_video/no_invoice/not_digital`;
the fallback is the generic «попробуйте ещё раз» loop the `bundle_unknown` fix was about.
Shopper-reachable only for `unknown_item` (a custom product deleted while its line sat in a
basket; `adoptServer` drops such lines at boot, so only the race window).

### F39 · LOW · new — stale prose after the 22-country opening

`app.js:6820` `ftrShipLine` «230 пакоматов в 4 странах» (written `797c1a2`, 14.09; the seed alone
holds 1 796 points, Montonio 10 432 — `tests/shipping-point-kind.test.ts:16`; pickup now in 22
countries). `docs/delivery-table.md:53-57`, `:97`, `:115` still describe the Venipak column and the
«Наценка» field, both removed 14.09 (`app.js:7381-7386`); last touched `7600af6`, 17.09.

### F40 · LOW · new — «Доставка по умолчанию» in the account offers fewer carriers than the checkout

`app.js:6752-6776` SHIP rows vs `:7058-7078` `CARRIERS_BY_COUNTRY`: LV/LT account = Omniva only
(checkout: omniva, dpd, unisend, novapost); FI = SmartPosti only (+dpd); EE lacks unisend/novapost;
none of the 18 DPD countries opened 18.09 has an account row. A customer cannot store a
Unisend/Nova Post/DPD locker as default. No test.

### F41 · LOW · new — the settings write queue serialises and a rejected PUT frees it, but a PUT that never settles holds every later settings write for the page's life

`app.js:30933-30949` `settingsWrite.then(go, go)` / `queued.then(noop, noop)`; `apiJson()`
(`:30903-30909`) is a bare `fetch` with no `AbortController`; 14 settings PUTs go through it. The
comment admits it («A write that never answers holds the queue»). The journal has already said
«Сохранено ✓» for each (optimistic `demoApply`). Browsers fail a stalled fetch eventually —
minutes, not forever.

### F42 · LOW · new — «no «снова в наличии» at a counted zero» is implemented twice, differently

`src/lib/flows.ts:617-630` `runBackInStock()` → `countedOut()` `:645-653` holds the letter only
when the count is «out» (`851649a`, r22-letters); `sweepBackInStock()` `:660-712` (`1de4c26`,
r19-products) holds it unless the merged state is «in» (`:708-709`). At a counted «мало» the hook
sends, the sweep does not. Harmless today (a letter at «мало» is truthful); drift on the next edit.

### F43 · LOW · new — `tools/prerender-shop2.mjs:343-350` says a failed translation lift «falls back to Russian for all three languages»; since `520999a`/`2b9991a` (`:385-398`) it is fatal, `process.exit(1)`

The delivery-page and returns-paragraph lifts (`:401-445`) still warn and fall back, so the header
is wrong only for the translation tables — the ones whose failure once wrote 542 Russian pages.

---

## 5. Findings — go-live tools, login, letters

### F44 · LOW · new — the Phase-B gate holds only in the page; `PUT /api/golive/` stores any status for any item

`src/lib/golive.ts:269-276` `gate()` only computes; `saveGoliveStates()` `:314-318` writes without
consulting it; `src/app/api/golive/route.ts:111-134` cleans, merges, audits `locked` — no refusal;
`public/golive/index.html:206-208` is the only enforcer; the route header `:19-26` says the `gate`
field is for «a curl, a script, Claude marking an item off from a terminal» — the caller the
lock does not bind. No test for «PUT a phase-B done while locked». Organisational.

### F45 · LOW · new (corrects a comment) — the login ladder throttles per connection, not per attacker

`src/lib/auth.ts:236-241` promises «a MACHINE reaches the ceiling within a dozen tries and is
then held to about three guesses a minute». `src/app/api/admin/login/route.ts:93-98` reads the
delay *before* the password check and writes the failure row *after*; `:25-29` «deliberately no
429»; `rateLimit()` is not called. *k* parallel requests each read the same count, each wait the
same ≤ 20 s, each is one guess: *k* × 3/min, bounded by scrypt CPU (~100 ms/guess) and platform
concurrency. `tests/auth.test.ts:186-236` measures sequential attempts only. Does not contradict
the decision (a delay, never a lockout); corrects what the comment says the delay buys. A strong
password is the real protection.

### F46 · LOW · new — go-live reset: the before-snapshot is taken outside the transaction, so panel activity during the run rolls the clear back

`tools/go-live-reset.mjs:657` `snapshot()` precedes `:700` `begin`; `:733-738` `verify(before,
after)` → rollback → `ResetRefused(["NOTHING WAS CHANGED …"])`; `verify()` `:588-603` fingerprints
`admin_audit` and the kept settings. One `admin.login` row (the owner signing in), one
`golive.save` row (Dim ticking `run-reset` on `/golive/` from his phone while the tool runs), any
setting saved — refusal. Safe direction; on the morning it reads like a failure.
`docs/go-live-reset.md:17-20` names «когда кто-то оформляет заказ» but not «close the panel and
the go-live page first».

### F47 · LOW · new — go-live reset deletes real-but-unconsented people without listing them

`tools/go-live-reset.mjs:517-521` the dry run lists only `customers where marketing = true`
(≤ 50); `DELETE_ORDER` (`:345-362`) includes `customers`, `loyalty_ledger`, `stock_alerts`;
`formatReport` prints `stock_alerts` only as a count. `docs/go-live-reset.md:396-420` and the
brief establish a real customer with **no** consent as an expected shape — invisible to the list
by construction. A real early account or a «сообщите, когда появится» address goes silently.
Bounded: orders are test data by decision.

### F48 · LOW · new (comment overstates) — overlapping flow runs are deduplicated by Resend, not by the shop's stamps; an overlapping birthday run leaves an orphan promo code

`src/app/api/cron/flows/route.ts:6-7` «Idempotent: every send stamps its row before the letter
leaves». The stamps are unconditional updates after a shared SELECT: `src/lib/flows.ts:499,503`
`update carts set reminded_at = now() where id = $1` (no `and reminded_at is null`), `:1041`
birthday, `:1271-1276` `unpaidRemindedAt`. What stops the second letter is
`src/lib/mail.ts:299` `Idempotency-Key` (`cart:<id>`, `bday:<id>:<year>`, `stock:<id>`,
`unpaid:<number>`) — Resend's 24-hour window. `promoForBirthday()` (`:1032`) mints a code per
attempt; `dropBirthdayPromo()` runs only on `res.skipped` (`:1067-1068`). The unpaid *cancel* is
atomic (`unless`, `:1313`). At this volume none in practice.

### F49 · LOW · new (latent) — `.gitignore` omits `public/shop2/blog/`, and a blog OG card on disk is never redrawn after the focal point moves

`.gitignore:16-28` ignores every other prerendered directory but not `blog/`
(`tools/prerender-shop2.mjs:1542`); `:851` `if (existsSync(f)) continue;` skips `drawBlogCard()`
when `public/shop/og/blog-<slug>.jpg` exists, and the `.gitignore` comment invites committing
`og/*.jpg` — a committed card would keep the old crop after the owner drags the point. Today
nothing is tracked (`git ls-files`); Vercel builds from a clean clone. The exposure is a future
`git add -A` on a machine that ran the prerender against the real database.

---

## 6. Findings — tests and the test plan

### F50 · LOW-MED · new — unit tests dial out to the internet (candidate 1 for the intermittent failure)

See § 1. Seven files apply `setFuzzEnv()` and never `installFetchStub()`; in
`tests/giftcards-audit-r19.test.ts` (in range) and `tests/payments-double.test.ts` the paid-order
hook makes a real signed PUT to `fuzz-account.r2.cloudflarestorage.com` with no timeout, awaited
by the route. Green here only because the host refuses the TLS handshake at once. On CI the same
code dials out on every run.

### F51 · LOW · new — real timers in `tests/assistant-probe.test.ts:203-236` (candidate 2)

See § 1.

### F52 · LOW · new — the test plan disagrees with its own marking rule for four items

`src/lib/testplan.ts:74-81`: `redo` = the behaviour changed; `new` = the check did not exist.
`392326d` (r22-unsub) rewrote the unsubscribe step in `mail-backstock`, `mail-abandoned` and
`mail-birthday` (`deferred:106` anticipated «would invalidate those three checks»); only
`mail-backstock` carries `"mark": "redo"` (`src/data/testplan.json:4579`); `mail-abandoned`
(`:4601`, sentence `:4620`) and `mail-birthday` (`:4648`, sentence `:4668`) carry no mark, so an
«ok» given before 17.09 15:38 still counts for a step that no longer exists. `order-search-server`
(`:3052`) and `order-return-handled` (`:3559`), added by `5862c54`, carry no `"mark": "new"` —
the twelve other range-added items all do. Not a merge loss (three-way per-item diff of
`ddc44eb`, the only testplan merge with hunks, is clean); the marking branches simply did not
mark them. Verified by reading the JSON.

### F53 · LOW · new — `tests/shipping-webhook.test.ts`: the flat invented token still carries 14 of 20 cases, and one of them pins a store-scoping guard the documented token cannot trigger

`token()` (`:30-43`, flat: `accessKey`, `event`, top-level `status`/`merchantReference`) vs
`guideToken()` (`:261-299`, the documented envelope). The route-level describe (`:89-248`, 12 cases)
is flat only; the documented shape covers 6. `:142-148` asserts a 400 on `accessKey:
"someone-elses-store"` — the documented token has no `accessKey` (`webhook.ts:164` `if
(claims.accessKey && …)`, shipping audit § 2.1: «can never fire»); `:150-167` spells
`AWAITING_COLLECTION`, a vocabulary Montonio does not use. Today nothing is hidden (the reader
tolerates both shapes, `webhook.ts:109-135`); dropping the flat fallbacks would remove six
behaviours (`returned`, redelivery, `unknown_shipment`, never-shipped, no reference, unconfigured
keys) with the suite green. The regression guard for the nested shape does exist
(`:345-360` posts the documented token to the real route and asserts `delivered`).

### F54 · LOW · known-deferred (`deferred:116`) — `tests/shipping-rules.test.ts` flipped from «one below-cost parcel cell» to «none» on a justification 18.09 made false

Old `:380-382` `.toHaveLength(1)` → new `:566-586` `.toEqual([])`, comment `:567-578` «the checkout
offers no parcel machine in any of those countries» — since `3be3ae6` it does, in 22. Consistent
with the decision (the rate screen edits the stored row; uneditable «Пакомат» cells are not
policed, `deferred:116`) and the accepted residual (locker prices approximate until the 21.09
rebuild). Reported because the *reason in the test* is stale.

### F55 · LOW · new (fragility) — six test files slice `app.js` with a naive `indexOf("function X(")`

`tests/shop-lost-answer.test.ts:29-38`, `tests/shipping-audit-r21.test.ts:45-54`,
`tests/held-cart-r22.test.ts:240-249`, `tests/assistant-probe.test.ts:33-42` (same idiom in
`blog-panel-shop`, `checkout-payonce`, `checkout-parity`). `tests/shipping-admin-preview.test.ts:27-39`
had to anchor on `"\n  function"` because `app.js:7090` quotes `function deliveryPageHTML(ctx) {`
in a comment above the definition (`:7105`). Every other sliced name resolves exactly once today.
CRLF: every in-range `app.js` reader normalises or brace-matches; no `";\n"` anchor remains.

### F56 · LOW · new — coverage gaps worth naming

- A takeover that creates a second **order** at route level (helper-level only); a handler that
  throws after a partial commit; two takers racing for an expired lease; a reload.
- A mixed card + Montonio refund retry (F1) — the only refund-retry test is card-only.
- The scanner's «lost answer, then a new identical scan» (F6) — `tests/stock-r21.test.ts:495`
  asserts the opposite premise.
- `tests/one-size-stock-migration.test.ts` seeds `stock_levels.qty` with no ledger rows; the
  «adds the two counts» case (10 + 6 = 16) asserts the fold on an invariant the fixture never
  establishes; the case that would show F8 is in no test.
- The expired label-URL retry (`[id]/label/route.ts:85-100`) — no test mentions expiry.
- `tests/checkout-parity.test.ts` compares client vs server for `parcel + carrier` in EE/FI only;
  the 18 new countries are covered by mirror equality, not by a parity case.
- Montonio error *bodies* are invented (`tests/payments-montonio-refusal.test.ts:58-60` admits
  it); only the messages are documented. Bounded by `montonioErrorText()`'s tolerant reading.
- `tools/lib/delivery-pricing.sample.json` — hand-written 18.09 (`43c4285`), documented shape,
  invented numbers, says so in its `_comment`, consumed only under `--dry-run`. Fine.

---

## 7. Observations from the decision check (INFO — accepted shapes, recorded so nobody re-audits)

No decision of 17.09 or 18.09 is contradicted by its implementation beyond F15, F24 and F25.
Residuals the decisions themselves accept:
- **D17** order search: `%` and `_` are not escaped (`orders.ts:2093-2097`) — over-matching only;
  the result is capped at 100 with no «показаны первые 100» line (`app.js:31631`).
- **D13** `new` is read as a *definite* «not paid» (`order-status.ts:86-91`): a shopper who paid
  and reopens the shop in the seconds before the webhook settles gets the basket back. No token
  expiry; the held record ages out after a day (`app.js:33586`).
- **D4** a human with scripting off presses twice (`unsubscribe/route.ts:295-305`); the RFC 8058
  one-click is unchanged; the three testplan checks were reworded accordingly.
- **D6** the bound is 30 writes per address per Tallinn day (`customers.ts:850-861`), not per
  owner of the address: a stranger can still overwrite or delete a real customer's snapshot within
  it (`deferred:60`, `:138` reduced, not closed).
- **D19** the ladder covers the admin password only; the customer code login keeps a per-IP
  in-memory limiter (`account/login/route.ts:38-39`) plus a durable five-attempt code kill
  (`customers.ts:39`, `:281-293`); the panel keeps a dead 429 branch (`app.js:31493`).
- **D18** «Возвраты N» counts the newest 100 loaded orders (`app.js:17695-17698`); «Обзор» counts
  the whole table (`analytics.ts:759-762`) — diverges once the shop passes 100 orders.
- **D1** the funnel has no `channel = 'web'` filter; a POS sale can never fire the client
  beacon, so the effect is the same; invoice orders and shoppers who never returned from the bank
  are not counted either — «allowed to drop».
- **E9** no import code exists; the rule is written down (`docs/go-live-reset.md:401-423`), and
  every flow already distinguishes `marketing = true` (newsletter, birthday) from the stop list
  (abandoned cart) — an imported customer with no consent gets no newsletter and no birthday
  letter, and a cart reminder only if they leave a basket.

---

## 8. Deferred list — entries whose reason no longer holds, or that this range fixed

| line | entry | at 9b7f48d |
|---|---|---|
| 10, 54 | per-size display on the storefront | **done** — `48cc8ca` + `d54ce0b`; every reader listed there verified except sets (F2) |
| 12 | no dedup for a network failure on the first `POST /api/orders/` | **done** — `1adc19d`/`4b87180`; the reload case remains (F10) |
| 16 | `POST /api/payments/create/` starts a second Montonio order | **premise gone** — Montonio reuses an order by `merchantReference` (orders guide; `docs/montonio-payments-audit.md § A5`; comment corrected `e108459`). Close, do not reopen |
| 20 | `API.ok === false → finishDemo()` | **done** — removed by `525cb0b` (r19-pwa), kept at `1dd9fc4`; no `noApi` survives |
| 22 | `POST /api/orders/` has no server-side idempotency | **done** — migration 180, `src/lib/idempotency.ts` |
| 24 | random `gc:<uuid>` gift-card refund ref | **done** — `giftRefundRef()` derived (`refund.ts:287-290`, 17.09); F1 is the narrower residue |
| 26 | admin «Отметить оплаченным» settles outside `settlePayment` | **already false at b6cbe37** — goes through `applyPaymentResult`/`claimOrderPaid` (`apply.ts:760-763`); the entry was stale when written |
| 46 | `bundles.ts expand()` prices from the file only | **done** — `bca9784`, `tests/bundles-db.test.ts:209-232, 341-360` |
| 72 | `redeemGiftCard` guard is a SELECT, not a unique key | **done** — migration 191 |
| 82 | prerender degrades silently | **done** — fatal since `520999a`; header comment stale (F43) |
| 94 | one counted size condemns the product | **done** — `0349cec`, `tests/stock-ladder-partial.test.ts` |
| 98, 112 | stock moves carry no idempotency key | **done** — migration 180 + `stockMoveSend()`; F6 is the residue |
| 118 | order search filters 100 loaded orders | **done** — `5862c54` (server search) |
| 120 | «Возвраты» counter can never fall | **done** — `doneAt`, «Обработано» |
| 122 | backing out of the bank page loses the basket | **done** — `735d13c`, public order-status endpoint |
| 128, 142, 144, 152 | points adjust / blog post / review / product creation without a key | **done** — 191 (points), 180 (routes; the three content routes await client minting, as the brief says) |

Everything else on the list was re-checked by the passes that touched its area and still holds
(14, 30, 34, 40, 48, 60, 74, 76, 78, 84, 104, 106, 108, 110, 116, 124, 126, 130-140, 148-150).
Delete (F17 area) now shares line 14's exposure exactly: `deletePost()` (`src/lib/blog.ts:496-506`)
flips `status = 'draft'` and stamps `deleted_at`; the build filters on `status` alone; a deleted
slug answers 404 (not 410); the public API's `max-age=60, stale-while-revalidate=600` can serve
the deleted JSON for up to ten more minutes.

---

## 9. Outside the range — noticed in passing, not counted

All pre-date `b6cbe37` (blamed); listed because the shop goes live next week.

1. **The return window is written as two numbers.** 30 days: `src/lib/returns.ts:41`
   `RETURN_WINDOW_DAYS`, `public/shop/legal.{ru,et,en}.js` («30-дневная политика возврата»),
   `app.js:11989` returnsAskHTML. 14 days: `app.js:7275` inside `deliveryPageHTML()` («У вас есть
   14 дней с момента получения…», worded as the shop's own offer, prerendered into `/info/shipping/`
   in three languages), the product accordion `:12272-12281` («14 дней на возврат по закону ЕС»),
   the checkout trust list `:16726`. Blame 31.08–08.09.
2. **Invoice payment term**: `settings.invoice.dueDays` reaches the checkout and the receipt live
   (`app.js:7822-7833`, `src/lib/invoices.ts:76`); `app.js:7268` (delivery page, prerendered) and
   `:7793` (the admin's «Так увидит клиент» list) hard-code «7 дней».
3. **`src/lib/seo-head.mjs` `T` drifted from the `app.js` dictionary** in four cells: ET stock words
   `vähe`/`pole saadaval` (`:392`) vs `viimased`/`otsas` (`app.js:183`); the ET tax line (`:394` vs
   `app.js:238`); EN «Shipping is calculated» (`:427`) vs «Delivery is calculated» (`app.js:3059`).
   Static ET page says «pole saadaval», the rendered DOM says «otsas». Blame 04.09.
4. **Cancel-then-refund never reverses loyalty points.** `settle.ts:138-163` voids sold cards at the
   refund door because a cancel-then-refund cannot make the status move; the points reversal
   hangs solely off that move (`orders.ts:2001-2010` `wasPaid && status === "refunded"`); the cancel
   path deliberately leaves points (`:1998`); the refund route accepts a cancelled order whose blob
   says paid (`refund/route.ts:133-137`, `:165`). Both halves merged in `b6cbe37` itself. A customer
   refunded after a cancel keeps the earned points and loses the spent ones (1 point = 1 €).
5. **Six duplicate keys in the `var UI` ET/EN dictionaries** (`app.js:786/2840`, `1860/1990`,
   `2113/2216`, `3597/5616`, `4643/4773`, `4894/4997`); last wins; the newer text is the one shown;
   one pair is dead. Blame 03.09–13.09.
6. **`public/shop2/chat.js:118-126` `CATS_KW` is an older copy of `src/lib/catalogue-slice.ts:31-39`**
   (`маск|scalp|перхот`, `лак|gel`, `кож[аеиу]`, `лосьон`, `edt`, `усы|moustache` missing) — «маска для
   лица» classifies differently with and without an OpenAI key.

---

## 10. What was checked and found clean

- **Merges.** All 68 reviewed with `git show --cc` (46 empty, 22 with hunks); the two
  hand-resolved routes reconstructed three-way — `src/app/api/orders/route.ts` at `4b87180` kept
  `proven` from main inside the `runOnce` wrapper from the branch (only re-wrapped comments
  differ); `src/app/api/admin/shipments/route.ts` at `ed0aa3e` is the exact union of both sides.
  `1dd9fc4` (r19-pwa) is the one «same bug, two names» in `app.js` (`lost` vs `noApi`) and was
  resolved by hand, correctly. No function or variable defined twice in any scope of `app.js`
  (1 905 names), `chat.js`, or the inline scripts of `/test/` and `/golive/`; no duplicate `case`;
  no data-attribute handled by two click guards; the 14 prerender slice anchors match exactly once;
  `node --check` passes. Migrations: the generated pack matches the folder byte for byte after CRLF
  normalisation; both runners record by file name, so the edits to `052` (comment) and `120`
  (seed prices, paired with `121` for an existing database) are safe; the late `093` and `121`
  run on the next deploy and depend only on `orders`/`bundles`.
- **Idempotency.** Key alone as primary key with the route beside it; cross-route reuse refused as
  `mismatch`; replay returns the stored status and body byte for byte (no cookies to lose);
  fingerprint is `sha256(raw body)` and the web client signs the same string; failed rows deleted
  immediately; 48 h retention swept on the success path; POS `pos_ref` and `runOnce` agree in every
  reachable ordering; `redeemGiftCard`/`creditGiftCard`/`adjustLoyaltyPoints` answer `already` on a
  unique violation; the admin points PATCH derives a Tallinn-day ref. 82 tests on real PGlite.
- **Montonio wire shapes.** `POST /orders`, `POST /refunds` (body `{ data }`, amount 2 dp, key,
  600 s exp), `GET /orders/:uuid` Bearer 1 h, `GET /stores/payment-methods`, refund token claims by
  their documented names (`refundUuid`, `refundStatus`, `refundStatusDescription`, `orderUuid` —
  the brief's names would have been the bug), `POST /shipments` (metres, kg 2 dp, receiver fields,
  `lockerSize` on `shippingMethod`, `type: "pickupPoint"` + UUID everywhere, `products[].quantity`
  ≤ 999), `GET /shipping-methods` constraints, `POST /shipping-methods/rates` (cm), pickup points,
  carriers, webhooks, labels (enums, 5-minute URL retry), the shipping webhook envelope and
  `data`-nested claims, HS256 with the secret key, `exp` with 60 s tolerance, four base URLs — all
  match the fetched pages. Phone table 32/32. `montonio-problems.ts` patterns robust to bracket
  contents, case, whitespace and JSON wrapping; RU/ET/EN present everywhere; raw text bounded to
  300 chars and escaped at every sink.
- **Decisions.** All 20 of 17.09 and E1, E3, E4, E8, E9 of 18.09 traced route → lib → SQL → panel
  text; E5–E7 verified absent with no half-implementation. 382 tests green.
- **Stock.** The per-size wire, the size picker, the card price rung, JSON-LD, the assistant, the
  per-size checkout refusal; migration 194's fold (sums of disjoint ledgers, barcode moved before
  the `''` row is dropped, idempotent, re-keys `stock_moves`); the hidden predicate is one function
  (`seo-head.mjs:326`) across the build, the middleware, the sitemap and the article shelf; the
  «В пути» chip counts and filters `shipped` only, agreeing with the server; the held-basket token
  (HMAC-SHA256 under `SESSION_SECRET`, constant-time, checked before the DB, uniform 404, POST
  only, `{ok, paid}`); delivery prices and free-from thresholds mirror the server cell for cell in
  all 25 priced countries.
- **Mirrors guarded by a test that compares both copies**: `SHIP_RULES`, `MONTONIO_PRICE`, the
  country sets, `PARCEL_DEFAULT`, `LOCKER_SIZES`, `CARRIERS_BY_COUNTRY`, promo/discount arithmetic
  with the 170 scope, size pricing, the hidden predicate, the cover-focus twin, content regexes,
  free-from seeds, the delivery page renderer, banks, point kinds, the variants file, the UI
  dictionaries' shape. Unguarded but agreeing today: status vocabularies, skip reasons, ledger
  reasons, analytics ranges, pricing bounds (three copies), gift amounts (three copies), mail
  limits, content defaults, subsections, category names, SEO snippet rules, carrier names, the
  loyalty earn preview, money rounding, the order-number regex, receipt states, test-plan and
  go-live counts (187 / 35, both PNG cards current).
- **Blog, assistant, tools.** Cover focus validated, clamped and applied identically on six readers
  (the SPA twin is run against the module); `deleted_at` filtered on every read but `slugExists()`
  (so a deleted slug stays taken; new article → `-2`); the open article reaches the prompt as
  `slug|status|title` only, a photo action can target only the owner's own articles, every
  assistant verb behind the admin session; the reset tool's plan names every table in the schema,
  runs one transaction, verifies the keep-list before commit, refuses on the wrong phrase, an
  unknown table or a live gift card, and its test runs the real SQL; the pricing grid writes only
  `output/`; the go-live PUT is admin-only, bounded and audited; the login ladder is durable,
  account-keyed, cleared on success and never a lockout; every marketing letter carries the
  unsubscribe URL and RFC 8058 headers; Tallinn days everywhere a letter or a key depends on one.
- **Test fixtures.** All 127 in-range test files opened, diffed or scanned; every external
  contract fixture other than those named in F53/F56 is documentation-shaped; no assertion was
  loosened other than F54; no `it.skip`/`.todo`/`.only`/env-gated silent pass in `tests/`; the four
  module mocks are one-seam wrappers around the real implementation; no stub `sql`.

---

## 11. Method notes

- Ten investigation passes → one report each in the session scratchpad
  (`findings-*.md`), then a coordinator re-read of every MED-or-worse claim against the tree and
  four executed probes (F2, F3, F8, F35) run outside the worktree against its `src/`
  (`scratchpad/audit-probe/tests/probe.test.ts`). Nothing was run against a database other than
  in-memory PGlite; no Montonio call was made.
- Where a pass and the coordinator disagreed on severity the lower figure was kept, except F1,
  where the money consequence decided it.
- Not verified from the tree: Montonio's live behaviour on a declared weight above the box's
  volumetric weight (F24), carrier registration latency (F5), whether each refund retry sends a
  webhook (F20), the Vercel function limit in production (`docs/HOSTING.md:73` says Fluid compute,
  300 s; brief error 4).
