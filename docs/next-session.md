# Where we stopped — 18→19.09.2026

Two parts: the night's work, and what Dim's own pass over `/test/` on the
morning of the 19th turned up. The night is the second half of this file and it
has not changed.

## The morning of 19.09: Dim went through the plan

**38 checks in one sitting, 194 answers stored, nothing left unanswered.** He
found **8 bad and 3 skip** — everything below comes from that list, and every
one of them is now closed except the three that need the live Montonio keys.

- **The A4 label came out blank, and had since 13.09.** The band under the
  sticker — order number, recipient, tracking number, and a drop-off code only
  on the rare occasion one arrives (Montonio, in writing, 22.09.2026: a door
  code needs the merchant's own direct contract with the carrier and Omniva has
  none, so a blank code line is normal) —
  is drawn with three TTFs read off disk, and `/api/admin/shipments/**` was
  never added to `outputFileTracingIncludes`. On Vercel nothing under `public/`
  reaches a function unless the tracer is told, `readAsset()` threw
  `asset_missing`, and `drawSlipSafely()` swallowed it exactly as designed. The
  suite and a developer's disk cannot see this: there `process.cwd()` is the
  repository. The list is gone — 85 of 102 routes can reach a font reader
  through their imports, so «nearly all of them» was always the honest answer
  and the keys are now `/api/**`, `/shop2/**` and the two sitemaps. A test walks
  the same import graph and fails if a route ever falls outside them again.
- **Lockers outside the Baltics existed in the data and nowhere on screen.**
  Ренат opened every country DPD serves on 18.09 and the server has allowed
  them since; the storefront asked about the ZONE (`S.country`, five values,
  «EU» for a continent) and `CARRIERS_BY_COUNTRY.EU` is empty. Italy really has
  12 048 DPD points on our own keys. Every reader asks `orderCountry()` now.
  With it came a real problem: Poland is 33 603 points, Germany 10 106 — not a
  list to download onto a phone. `/api/shipping/points/` caps its answer at
  1 500 and takes `?q=`, filtering on the six-hour cache it already holds; the
  picker sends what the shopper types there and says how many there really are.
- **The account priced another country with this country's numbers.** Its rows
  came from the draft's country and its prices from `shipRulePrice()`, which
  read the checkout's. The function takes the country now, and the account
  block finally has the second select — until today «Другая страна Европы» was
  as far as a customer could get.
- **A refund that Montonio has only accepted now says so everywhere.** Montonio
  answers `200 PENDING` and confirms days later; voiding the cards an order
  sold, the points and the «возврат» status all wait for that webhook, and
  should. What was wrong: the panel promised «карта будет аннулирована» in the
  present tense, «Выпущенные карты» was a once-per-session cache nothing ever
  dropped, and the customer's own «Мои заказы» said nothing at all while the
  letter «Возврат отправлен» sat in their inbox. All three fixed. A hole found
  beside them: a voided card stayed in the account and its PDF still printed
  the full face value — 50 € no till will take. Gone from the list, 410 on the
  link.
- **«Скрытые заканчиваются» now leads to those products.** It opened the whole
  catalogue, where a hidden product sorts behind everything on sale and usually
  past the 40-row cap. It opens «Каталог → Скрытые» and names them.
- **The blog list framed every cover square.** The 1200/630 rule was written
  for the article's own cover; the tile carries a different class, so the crop
  the owner dragged was applied to a square and app.js then repainted it wide.
- **Montonio refused a refund in words its own documentation does not list** —
  «Payment intent … cannot be refunded at this time» — so the panel could only
  quote it in English. It is read now, narrowly: the two causes are the refunds
  guide's own preconditions and nothing beyond them is claimed.
- **The two he could not run at all.** «Заказ, за который заплатили не
  полностью» needs Montonio to underpay and the sandbox will not, so
  `tools/seed-held-order.mjs` makes one by copying a real paid order (guarded:
  no `--yes`, no write, and it prints the host). «Вернуть деньги второй раз»
  needs a first refund that worked, which the sandbox never gives — he asked me
  to run it instead, so it is a test now, in the shape he actually meets it:
  the first press refused, the second must say the same words, write no row and
  carry the same idempotency key.

**The plan is 196 checks**: six marked for re-test, two new (a locker in another
European country, and what the customer sees while a refund is on its way).
`order-paid-short` is open again with «Дим создаёт заказ» as its first step.

## The afternoon of 19.09: «Товары», and one thing found in Merchant Center

He asked for the products section to be brought up to the standard of an
ordinary back office, and sent a screenshot of the «Склад» filter chips
circled with the words «No counts». A survey found fourteen defects of that
class; the worst of them was not a count.

- **The product editor threw away unsaved work without asking.** It keeps no
  draft in `S` — every field is read off the DOM at «Сохранить» — so «← Товары»,
  «Отмена» and the phone's back gesture each cleared a price, three
  descriptions, six SEO boxes, the size ladder and any reordered photos, on one
  mis-tap at the top of a five-pane form. It asks now, with the card the blog
  editor has used since 12.09, on all three exits. And three of the four
  buttons in the photo strip edited that draft while the save bar stayed blank.
- **Counts everywhere they were missing**: «Каталог» chips (zeros included),
  the «Склад» tab badge's zero, and a header number that follows the tab
  instead of always counting the shop's catalogue.
- **«Нет в наличии» and «Нет» counted different things** — the manual flag
  against the counted shelf — so one bottle could be both, and a custom product
  (hard-coded `stock: "in"`) could never appear under the chip at all.
- «Каталог» search folds now (`kevin murphy`, `un tangled`, `300 мл` all found
  nothing before); an empty result has a way out of itself; the list turns its
  own page. «Наборы» has a count, an actionable empty state and 44×44 reorder
  buttons. A refused barcode keeps the editor open instead of arriving as a
  toast over the product list after «Сохранено ✓».
- **The assistant's draft to a customer had no money on it.** Asked «what is
  the price of the item» it answered «the price details for this item are not
  provided here» — correctly: the order went over as titles and quantities. It
  now carries per-line prices, the total, the delivery line and its cost, the
  tracking number and anything refunded, each with its currency.

- **The gift card's letter was the one letter the owner could not write.**
  `MAIL_TEXT_TEMPLATES` listed twelve and this was not one of them, so the row
  added to «Письма» that afternoon opened on nothing — and, because
  `mailTpl()` falls back to the first row for a key it does not know, the
  button from «Оформление» landed on «Заказ принят». It is editable now, with
  its defaults lifted word for word from the old text so nothing a customer
  receives changed. The one sentence that stayed automatic is the opening,
  because whether there is a giver is data, not wording — it steps aside the
  moment he writes his own. A test now keeps the panel's list of letters and
  `MAIL_TEXT_TEMPLATES` the same set; neither side can see the other.
- **The go-live list had drifted.** Dim went through `/golive/` and six rows
  were still «todo» for work finished days before: weighing (cancelled 18.09),
  the aerosols (closed 19.09), the payment decisions (built the night of the
  19th), the thirteen e2e failures (fixed 18.09, merge `0fbd940`), the
  «проверьте баланс» copy (removed 18.09) and the hidden-stock question
  (decided 19.09). Blocking items: **22 → 16**. The second Fable pass moves to
  after launch week.

**Merchant Center — a go-live dependency nobody had written down.** The account
(`5819586565`, «Rempire Tower Shop») is live and earning: 175 clicks in 28 days
on free listings, ad spend €0. Every product in it is fed by **six Shopify App
API sources**, 328 products each, one per market (EE/LV/LT/FI in English, a
Russian one for BY/GE/KZ+3, and one covering 82 more countries) — 1.97K
"products" is the same 328 items counted per market. "Found by Google" crawling
`rempireshop.com` has found **2**. So the day Shopify is switched off, those
feeds stop updating and the free traffic goes with them. Its shipping policies
are Shopify's flat €15.00 / 4–12 days per country, nothing like the real
Montonio prices, and that mismatch is what suspends accounts. Our own
`public/feed/google-shopping.xml` is committed, served publicly, built on
03.09 from the OLD `public/shop/catalogue2.js` with the staging domain, and
connected to nothing.

## The night of 18→19.09

`origin/main` was `12a396b`. **186 test files, 4318 tests, 0 failures**, `tsc`
clean, 814 prerendered pages with 0 failures, `untranslated: 0` at ET/EN parity.
29 commits overnight, four agent branches merged, everything pushed.

This replaced the plan written at 22:40; `docs/night-plan-2026-09-19.md` is what
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
  puts back one.
- **After his pass of 19.09 midday:** nothing is waiting on him but Montonio and
  one command — `DATABASE_URL=… node tools/seed-held-order.mjs --yes` against
  the stand, so «Заказ, за который заплатили не полностью» has an order to be
  tested on. Everything else on that list is built and back in the plan.

## The test plan that night: 191 checks

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
