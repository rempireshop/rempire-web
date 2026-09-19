# Where we stopped — the night of 18→19.09.2026

`origin/main` is `12a396b`. **186 test files, 4318 tests, 0 failures**, `tsc`
clean, 814 prerendered pages with 0 failures, `untranslated: 0` at ET/EN parity.
29 commits overnight, four agent branches merged, everything pushed.

This replaces the plan written at 22:40; `docs/night-plan-2026-09-19.md` is what
was intended, this is what happened.

## The three payment decisions are done

The only part of Dim's twenty-eight decisions that was still unbuilt.

- **An order paid short is held, not paid.** No stock moves, no gift card is
  minted, no receipt letter goes; the order card warns in three languages,
  naming both figures and the one button that ends it. The agent refused the
  audit's own recommended shape and was right to: it wrote `status: "paid"` on
  the blob while leaving the order at `new`, which is exactly the shape the code
  already calls «a settlement that died half-way», so Montonio's next retry
  would have completed the fulfilment the hold exists to prevent.
- **Both webhook checks are tightened, and a mismatch asks Montonio.** The store
  key was compared only when present; the order id was never compared at all.
  On a mismatch the shop now asks `GET /orders/:uuid` and acts on the answer —
  503 when Montonio cannot be reached, so the webhook comes back.
- **A nightly sweep finds payments whose notification was lost.** Its own route
  exists; it also rides the existing flows cron, because Vercel Hobby allows two
  scheduled jobs and both slots are taken. That makes the Pro upgrade a go-live
  item — it already was, for a different reason: Hobby forbids commercial use.

**A trap that came with it, closed the same night:** a held order keeps the
status «новый», and the 7-day unpaid cancel selects exactly that status. The
flow is off today and Dim's decision of 17.09 is that it goes on — so the moment
it did, an order somebody really paid for, just not in full, would have been
chased for a week and then cancelled. One predicate, in the one place all three
queries read it, proved by reverting it and watching the test fail.

## The audit: 41 of 56 findings closed

Including the only MED-HIGH and nine of the ten MEDs. The ones worth naming:

- **«Вернуть деньги» paid twice** on a mixed card + bank order after a failed
  fold. Both references now derive from one blob written in one statement. 15
  new tests, 14 of which fail on the old code.
- **A refund whose answer was lost** is now found: the retry asks Montonio,
  adopts anything its `refunds[]` shows that we never recorded, and says so.
- **A set was sold with a part counted to zero.** The id list handed to the
  per-size map contained `bundle:<id>`, which has no shelf row, so the map never
  held a single part of any set. The gate was there; it had nothing to read.
- **«Оплачен» after a cancel never re-took a set's parts** — «остатки не
  сходятся» permanently on everything sold in sets. This is the audit's answer
  to «find the fourth merge», and it was real.
- **The readiness screen told the truth** about wrong keys, about refunds being
  off, and about a parcel webhook pointing anywhere at all. This is what Dim
  will be looking at on Sunday when the live keys go in.
- **Loyalty points now come back when you cancel first and refund after** — the
  order Renat actually does them in. The customer had been keeping the points
  the sale earned and losing the ones they spent, at 1 point = 1 €.
- **The intermittent failure had THREE causes, not the two the audit named,
  and all three are closed.** Nine test files set the fuzz environment and
  never installed the fetch stub, so every paid order carrying a gift card
  made a real signed PUT to a fake R2 host on every run, including CI. The
  second was a test measuring the machine's clock. The third showed itself at
  02:14 in a full run: the login-ladder test, which had already been fixed on
  18.09 for a clock race. That fix was right — it stopped comparing Node's
  clock with Postgres's — but underneath it the «success» floor is a
  timestamp truncated to a whole millisecond, and four failure rows inserted
  with `now()` land inside that same millisecond often enough to matter. When
  they do the ladder counts none of them and reads 0 instead of 1000. They go
  in a second later now.
- **The assistant stopped calling the goods figure «revenue».** The panel was
  renamed on 17.09 to say the value of goods in orders, and the model was
  still handed that same list as «Best-selling by revenue» — so «что приносит
  больше всего денег» was answered with the number the panel had just stopped
  calling money (F25).

Plus the two owner answers of 22:55: **the return window is 30 days everywhere**
(three places said 14, in three languages, including the prerendered delivery
page) and **the per-unit weight estimate is gone** — the declared parcel is the
carton, one number, whatever the line count.

## What is still open from the audit

Nothing here is urgent; each is written up in
`docs/audit-2026-09-18-findings.md` under its own number.

- **F5** — a synchronous carrier registration has a 10-second client timeout,
  and a timeout after Montonio registered the parcel orphans it with no way to
  find it again. Needs Montonio's answer on registration latency before a number
  can be chosen; it is on the Monday list.
- **F6** — after a lost answer the scanner cannot tell a retry from the next
  identical bottle, so a genuine +1 replays the old one while the screen says ✓.
  Needs a real decision about what the scanner should do, not a patch.
- **F7, F10, F11** — the idempotency lease can take over a live request, and a
  reload after a lost answer can make a second order (and, for «По счёту», a
  second numbered invoice). All need design, all are low-probability.
- **F21** — the label normaliser has no size sanity check. Unverifiable until a
  real label exists, which is Sunday at the earliest.
- **F40 — done, 19.09.** He approved it: the account's «Доставка по
  умолчанию» is now built from CARRIERS_BY_COUNTRY, the same table the
  checkout offers from and one a mirror test guards, so it cannot fall behind
  again. It also took 26 lines of hand-written rows and a 23-line price helper
  with it — those prices had been dead for a while, the screen prices through
  the rules — and the three places that asked that table whether the shop
  serves a country, which is why a Polish address could not be picked there.
- **F26, F29, F53, F55, F56** — noise and coverage gaps.
- **§ 9.5 — done after this list was written:** the three duplicate keys are
  gone from the ET and EN dictionaries. Each kept the value that was already
  winning, so nothing on screen changed.

## Waiting on Dim, not on us

- **Sunday 21.09, with Renat:** the live Montonio keys. Then rebuild the tariff
  table (`node tools/delivery-pricing.mjs --units 3`) — the locker prices are
  still quoted for a 30×30×30 box and the shop now declares a fraction of that.
- **Monday 22.09, Harri at Montonio:** the draft is in Gmail and needs the time.
  Six questions were added to it overnight, all from reading the code against
  the documentation — the volumetric divisor (`/4000` reproduces their one
  worked example, `/5000` does not), what `bufferApplied` is applied to, whether
  a valid key with no Shipping product answers 200-with-nothing or 401, whether
  Montonio normalises a stored webhook URL, whether `shipment.statusUpdated` can
  ever carry a registration failure, and whether `paymentMethodType` is stable.
  **And the one that decides the parcel weight:** whether `actualWeight` means
  what we declared or what the carrier's scale reads.
- **Decisions he settled on the morning of 19.09, all four built:** the
  pending-refund letter is now two letters (`order-refund-sent`, its own
  template in «Письма»); the Google Shopping feed stays out of the build and is
  not submitted; the refund adoption stays exactly as built; and the scanner
  keeps under-counting but says «это уже записано — на складе N» instead of
  claiming a movement. Two new checks for the last two, 193 in the plan.
- **…and the last three, settled the same morning and built:** the account
  carrier list above; a hidden product is counted apart from «заканчиваются»
  rather than dropped, so a bottle hidden BECAUSE it ran out still shows
  somewhere; and a refund now credits only what the sale actually took — the
  shelf had one, the order wanted two, the sale stopped at zero, the refund
  puts back one. **Nothing is waiting on him but Montonio.**

## The test plan: 191 checks

Four new ones — the second press of «Вернуть деньги», an order paid short, the
nightly reconcile, and cancelling an order with a set and putting it back — plus
marks and new expectations on seven existing checks. Its own rules refused four
of my drafts (six expected results per item, sixteen words per line), so the
script that writes it now checks them before writing.

## One behaviour change worth a conversation

A **failed** refund attempt now reads Montonio's own `refunds[]` and writes down
anything this shop has no record of. If that covers the order's full value the
order flips to «возврат», the gift cards it sold are voided and the customer is
mailed — as a side effect of a button that answered «не удалось». That is
exactly what the lost webhook would have done and the money really did leave, so
it is true rather than surprising. It should still not be a surprise on the
first live refund.
