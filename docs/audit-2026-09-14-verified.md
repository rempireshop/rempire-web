# Audit 14.09.2026 — verified

Every one of the 347 findings from the sweep was checked against the code, one agent per
subsystem. The ten marked critical were then re-checked a second time by fresh agents whose only
instruction was to kill them.

| | count |
|---|---|
| confirmed | 276 |
| refuted | 4 |
| duplicate of another finding | 59 |
| your decision, not a defect | 8 |

Confirmed by severity: critical 10 · high 82 · medium 120 · low 64.
Size of fix: one-line 56 · small 155 · medium 63 · large 2.

## How much to trust this

Only 4 of 347 were refuted on the first pass. That ratio is the signature of a reviewer agreeing
with what it reads rather than testing it, so the first pass alone is an upper bound.

The ten critical findings were therefore given to fresh agents told to kill them: check the
citations, look for a guard already on the path, and prove a real person can reach it. **All ten
survived, none was killed**, and each came back with the concrete path a customer or the owner
takes to hit it. Several were downgraded from critical to high, which is the re-check working in
both directions.

The 82 high and everything below have been checked once only. Treat them as likely, not certain.

## The ten worst, re-checked and standing

### [high] Promo codes discount gift-card face value, so a 100 € card can be bought for less than 100 €
**Who hits it.** A normal customer, no tampering. The /gift/ page sells cards (data-addgift, amounts 25/50/75/100 from settings.gift_amounts); the cart's own cartSum()/lineUnit() count the gift line at face value (app.js:7701,7709) and discount() (app.js:7949-7956) applies the promo percentage to it, so the browser shows the reduced total too. On the server createOrder calls priceItems (orders.ts:908-913 pushes the gift line at face value into the subtotal at :986), then discount = codeDiscount(input.discountCode, subtotal, shipPrice) (:1311) with no line-kind filter; codeDiscount (:425-452) only clamps to subtotal+shipping, and quoteFromPromo (promos.ts:180-182) sees one number. After payment, issueGiftCards (giftcards.ts:254-290) writes amount = balance = parseGiftItemId(item.id), i.e. the full face value, regardless of what was paid. So with any live code, e.g. SUVI10 at 10 %: basket = one 100 € card,

**What the code does.** The cited lines say what is claimed. priceItems builds gift lines with kind:"gift", price = money(amount), sum = money(amount*qty) and folds them into `retailSubtotal = lines.reduce(...)` like any product; createOrder passes that whole subtotal to codeDiscount, which forwards it to quotePromo → quoteFromPromo, whose only inputs are two numbers (goods, ship). Nothing between the cart and the database distinguishes a gift line from a product line for discount purposes: no filter in orders.ts, no `gift` mention in promos.ts, no column on promo_codes (code, kind, value, min_subtotal, starts_at, ends_at, max_uses, used, active, note) for excluded item kinds, and /api/promos/check just quotes agai

**Existing guard.** None. The gift-aware checks on this path (gift_unavailable at orders.ts:904, giftOnly/not_digital at :1288-1293) concern which denominations sell and whether delivery may be free; loyalty points are separately capped by `left` (:1333) but the promo itself has no base restriction.

**Fix.** In createOrder compute a goods-only base (`lines.filter(l => l.kind !== "gift")` sum) and pass that to codeDiscount instead of `subtotal`, mirroring it in app.js discount()/promoLive() so the checkout shows the same figure.

### [high] Per-size stock is collapsed to one product-level word, so a sold-out size is shown in stock, basketed and paid for
**Who hits it.** Owner path, normal workflow: in «Склад» Renat counts a multi-size product per size (67 catalogue products have sizes) — e.g. System 4 shampoo 75 мл = 0, 500 мл = 3. Each write is a goods_in/adjust move, so both variants are tracked. productStockStates (inventory.ts:541-566) aggregates them to "in"; getOverrides (orders.ts:533-538) stores that word under the product id; /api/overrides publishes it with no variant-level field at all. The storefront (public/shop2/app.js, every check is p.stock) prints «В наличии» and offers 75 мл unmarked in the size selector. The customer picks 75 мл and pays. priceItems (orders.ts:927-928) reads the product-level word "in" and accepts — the variant is only resolved afterwards (variantOf, ~line 947) and is checked for existence/price (bad_variant) but never for stock. On the paid transition, payments/apply.ts decrementStock calls move(-1) on 75 мл; applyMo

**What the code does.** inventory.ts:564 is exactly as cited: `states.every(s => s === "out") ? "out" : states.some(s => s === "low") ? "low" : "in"` — per-variant stock_levels rows are read, then collapsed to one word keyed on product_id alone. orders.ts:534 merges that word into the override record; src/app/api/overrides/route.ts serves it unchanged and carries no per-variant stock anywhere. The server-side order gate is orders.ts:927-928, product-level only, and runs before the variant is resolved. No cart endpoint, payment path, type, or DB constraint rechecks per-variant availability; stock_levels' `check (qty >= 0)` is never reached because applyMove clamps the delta first.

**Existing guard.** None on this path. Nearby guards exist but cover other things: bad_variant (orders.ts ~947) rejects a size not on the ladder (price tampering, not stock); o?.hidden (orders.ts:934) refuses a product taken off sale; bundle parts are checked at orders.ts:865-869 — also product-level. move()'s tracked-variant guard and the qty>=0 clamp prevent a negative shelf count but do not refuse or flag the sale

**Fix.** Return state per product_id::variant from productStockStates, publish it on /api/overrides, and after variantOf() in priceItems refuse a line whose own variant is "out"; as a stopgap, surface move()'s clampedNegative on a tracked variant as a visible flag on the order.

### [high] Migration 120 seeds styling-duo and hair-young-again below the generator's prices; the DB seed is what the shop charges
**Who hits it.** Customer path, no special state needed. public/shop2/app.js asks GET /api/bundles/ at boot and prefers it over the static file (app.js:9010-9118); the route returns listBundles() straight from the `bundles` table. So the set page /shop2/set/hair-young-again/ shows 39,90 €, and checkout charges the same number: src/lib/orders.ts:861-875 prices a «bundle:<id>» line from bundleDefs() → bundleDefsForOrders() → expand(), where a stored `price` wins unconditionally (src/lib/bundles.ts:~245: `stored_price != null ? stored_price : …`). validateBundle's `price_too_high` guard (bundles.ts:~400) only runs on admin writes — it never sees a seeded row. Migrations apply themselves on boot from src/db/migrations.generated.ts (src/lib/migrate.ts:20), the seed carries `on conflict (id) do nothing`, and no migration after 120 touches the table, so it cannot self-heal. Only caveat I cannot check from the r

**What the code does.** db/migrations/120_bundles.sql seeds styling-duo at 24.90 and hair-young-again at 39.90; src/data/bundles.json and public/shop/bundles.js say 33.9 and 78.9. Server-side catalogue agrees with the JSON: night-rider 11 + session-spray[1] 28 = 39, and young-again wash[1] 28 + rinse[1] 28 + oil 34 = 90 (src/data/catalogue.variants.json). Cause is datable: the seed was written 04.09 (cd8f4c1) from the generator output of that day; commit 73eeb33 on 09.09 ("Цены 34 товаров стояли не у своих объёмов") fixed swapped per-volume prices and regenerated bundles.js/bundles.json, but did not touch the SQL. The old numbers reproduce exactly under the pre-fix prices (29 × 0.88 → 24.90; 46 × 0.88 → 39.90), con

**Existing guard.** None on this path. validateBundle's price_too_high check guards admin writes only; the seed bypasses it, expand() trusts the stored price, and the numeric(10,2) check constraint only requires price >= 0.

**Fix.** Add db/migrations/121_bundles_price_fix.sql doing `update bundles set price = 33.90, updated_at = now() where id = 'styling-duo' and price = 24.90;` and the same for `hair-young-again` → 78.90 where price = 39.90 (the price guard keeps it from overwriting an edit Renat has since made), and correct the numbers in 120's seed for fresh deployments.

### [high] Per-size stock is collapsed to one word per product, so a sold-out size stays buyable and payable
**Who hits it.** Renat counts sizes separately — the Склад table and the editor's Остаток column are keyed product×size (src/lib/inventory.ts catalogueUniverse, and the editor copy "порог у каждого объёма свой", "«не учтено» — этот объём ещё ни разу не считали"). Take a multi-size product he has counted, e.g. System 4 Bio Botanical Shampoo (75/250/500 мл, public/shop/catalogue2.js). The 75 мл sells to 0; 250 and 500 still have units. productStockStates then returns "in" for the product (every()==="out" is false). GET /api/overrides publishes that one word; the catalogue feed carries one `stock` per product and no per-size figure at all. On the product page variantPicker() (public/shop2/app.js:12558-12570) renders every size chip identically — no disabled state, no «нет в наличии», because the browser has never been sent a per-size number. The customer taps 75 мл, adds to cart, pays. Server side, priceIte

**What the code does.** src/lib/inventory.ts:564 is exactly the cited line: `out[productId] = states.every(s => s === "out") ? "out" : states.some(s => s === "low") ? "low" : "in"` — per-variant stock_levels rows reduced to one StockState per product id. src/lib/orders.ts:533-534 feeds that into getOverrides(), which is what /api/overrides publishes and what priceItems checks at :928.

**Existing guard.** None on this path. The only stock gates in the order path are the three product-level `=== "out"` throws (orders.ts:865, 869, 928) and the hidden check at :934, all reading the same aggregated word. bad_variant (:951) guards price, not availability. move()'s negative clamp and the untracked-sale skip protect the ledger, not the sale. There is no per-variant recheck in any checkout route and no DB 

**Fix.** Carry per-size states in the public feed and check the chosen variant's own stock_levels row in priceItems before pricing the line, instead of the product-level aggregate.

### [medium] Refund retry mints a new idempotency key, so a lost response can pay a partial refund twice
**Who hits it.** Renat opens a paid order, taps «Вернуть деньги» for part of it (say 20 € of 60 €). Montonio accepts the refund but the answer is lost or slower than the 15 s AbortSignal.timeout (montonio.ts:331), so the route returns 502 provider_unreachable and nothing is written — settleRefund only runs on a provider answer. The panel's own toast tells him «Montonio не отвечает — попробуйте через минуту» (public/shop2/app.js:27435). He presses again; the route re-reads left = refundableAmount(value, order.payment), which still shows the whole remainder, and posts a second /refunds with a fresh randomUUID. Montonio sees an unrelated refund and sends another 20 €. A repeated FULL refund is not doubled — the second request exceeds the order's refundable amount at Montonio and returns provider_rejected — so only partial refunds actually pay twice. The refund webhook (api/payments/notify/route.ts:143) can 

**What the code does.** refund/route.ts:186 passes idempotencyKey: randomUUID() per attempt, and montonio.ts:313-326 signs it into the /refunds JWT; the code comment and docs/payments.md:895 both assert this is what stops a retried refund paying twice, which is false for a key regenerated each attempt. The only dedupe is Montonio's own refund uuid folded by foldRefund (payments/refund.ts) inside settleRefund (payments/settle.ts:77), which runs only after the provider answers. No pending ledger entry is written before the call, orders.payment is jsonb with no unique constraint, there is no advisory lock, and SRV.refundBusy is per-tab and cleared in the request's catch.

**Existing guard.** Partial only: the refund webhook records the first refund if it arrives before the retry (race), and Montonio's own per-order refundable cap makes a duplicated FULL refund come back provider_rejected. Neither stops a duplicated partial refund.

**Fix.** Derive the idempotency key deterministically from the refund's identity (e.g. orderId + refundedTotal-at-start + amount), or write a pending ledger entry with that key before calling Montonio and reuse it on retry.

### [medium] Dropped connection or Vercel 5xx during checkout shows the demo receipt and empties the cart, leaving a possible orphan unpaid order
**Who hits it.** The everyday route is not an edge 502 but a phone losing signal mid-request. Shopper fills checkout, taps «Оплатить»; payNow() (public/shop2/app.js:14050) sends POST /api/orders/; the server writes the order row; the response never arrives (mobile connection drops, or Vercel's nodejs function times out and returns its HTML error page). postJSON's fetch rejection handler / non-JSON handler (app.js:13908-13911) returns {offline:true}; app.js:14052 `if (res.offline) return finishDemo();`. Same at app.js:14083 for POST /api/payments/create/, where the order definitely exists. finishDemo() (app.js:14017) runs clearOrderState() — the basket, promo, gift card and applied loyalty points are wiped from S — sets apiSeen(false), and shows the receipt screen. Aggravator: API.ok is now false, so app.js:14037 makes every further «Оплатить» tap in that session short-circuit to the same demo screen with

**What the code does.** postJSON (app.js:13901-13912) maps three distinct things to the same {offline:true}: a 404/405/501, a rejected fetch, and any body r.json() cannot parse. The orders route itself is clean — every one of its own failures is JSON (429 rate_limited, 400 OrderError, 500 server_error, src/app/api/orders/route.ts), so only a platform error page or a dead connection can produce `offline`. Nothing on the path re-checks: no retry, no reconciliation against the order that may already have been written, no `API.ok === true` test before deciding this is demo mode. The claim's "fake «Заказ оформлен»" is half right: screenDone() (app.js:29055) does print that heading with a green tick, but for S.done={demo

**Existing guard.** Nothing prevents it, but three things cap the damage. The redirect to Montonio never happens, so no money moves and no paid-but-lost state exists. The orphan row is an ordinary unpaid order: src/lib/orders.ts writes no stock_moves at creation (inventory.ts holds every insert), gift cards and promo uses are only spent on payment confirmation (orders.ts:1378-1382), onOrderCreated mail is off by defa

**Fix.** Split postJSON's three cases: keep {offline:true} only for 404/405/501 (genuinely no API behind the page), and return a distinct {failed:true} for a rejected fetch or an unparseable body so payNow() keeps the basket, shows a retry toast instead of the demo receipt, and does not set API.ok=false.

### [medium] Lost response to POST /api/orders ends the checkout in the demo receipt, wiping the basket and leaving an unpaid order
**Who hits it.** A customer on a phone taps «Оплатить»; the POST reaches the server, `createOrder()` writes the row, and the connection then dies before the response body lands (mobile handover, or an edge 5xx HTML page that `r.json()` cannot parse). `fetch`/`r.json()` reject, postJSON returns `{offline:true}` (app.js:13908-13911, no signal, no timeout, nothing distinguishes it from a 404), and app.js:14052 takes `if (res.offline) return finishDemo();`. Nothing guards it: `API.ok` is `true` by then (boot probes call apiSeen(true)), but the branch never consults it. Amplifier: finishDemo calls `apiSeen(false)` (app.js:14018), so the guard at app.js:14037 (`if (API.ok === false) return finishDemo()`) short-circuits the next attempt in the same page session straight to the demo receipt without contacting the server at all, until some other probe (e.g. loadPointsFor) sets apiSeen(true) again.

**What the code does.** postJSON conflates three cases into `{offline:true}`: 404/405/501, an unparseable body, and any fetch rejection — so a request that was processed is indistinguishable from one that never arrived. finishDemo (app.js:14017-14022) calls clearOrderState(), which empties S.cart and clears pendingOrder, and it does NOT call holdCart() — unlike the real path at app.js:14098, so the basket is not parked against the order and restoreHeldCart() can never give it back. The receipt it shows is NOT a claim that the order is placed: the headline is «Заказ оформлен» but the body paragraph (app.js:29064) reads «Это демонстрация — настоящий заказ не создан» — self-contradictory, not a false confirmation. Ser

**Existing guard.** Server-side: createOrder() spends nothing (gift card, promo use, loyalty points and stock are all deferred to src/lib/payments/apply.ts), and src/lib/flows.ts already reminds on and auto-cancels unpaid orders — so the "orphan" is a state the shop handles routinely. Client-side there is no guard at all on this branch.

**Fix.** Distinguish transport failure from "no API here" in postJSON (e.g. return `{lost:true}` for a fetch/parse rejection) and, on the order POST, keep S.paying/pendingOrder, hold the cart and show a retry toast instead of finishDemo — reserve finishDemo for 404/405/501, and never let it set apiSeen(false) when API.ok was already true.

### [high] A transient network drop while the checkout opens latches API.ok=false for the rest of the visit, so «Оплатить» silently shows the demo receipt and empties the cart
**Who hits it.** Shopper on a phone opens /shop2 checkout (screenCheckout, :14332-14339, fires loadShipRules + loadPoints + loadPayMethods at once; loadPointsFor also fires fresh at :7871/:30948/:30955 when they change carrier or country at step 2). If connectivity drops for even a couple of seconds in that moment — lift, tunnel, Wi-Fi/cellular handover — the fetches REJECT and every .catch runs apiSeen(false). Note a server outage does NOT do this: a non-2xx goes through `r.ok ? r.json() : null` and returns early without touching apiSeen, so only a real network-layer rejection (or a body that fails r.json()) latches it. All four loaders are one-shot (shipRulesAsked, CARRIER_LOGOS.asked, PAYMETHODS.asked, POINTS.by[key] is filled with demoPoints on failure), there is no 'online' listener, no retry, no timer, and pushCart is itself gated off by `API.ok === false` (:13353), so nothing re-probes. The networ

**What the code does.** :6651 apiSeen writes API.ok with no direction bias, so false overwrites an earlier true permanently. :6745, :6908, :6933, :7117 are exactly the four .catch handlers claimed, each on a one-shot loader. :14037 in payNow short-circuits to finishDemo() before the order POST. screenDone (:29063) then renders the «Заказ оформлен» tick with only a muted sentence «Это демонстрация — настоящий заказ не создан» underneath — the only thing distinguishing it from a real receipt. The same logic is in the deployed app.min.js (:5852, :10726).

**Existing guard.** None on this path. The three readers of API.ok are pushCart (:13353), payNow (:14037) and apiSeen itself; finishDemo never reaches the server, so no API route, validator or DB constraint can intervene. Partial mitigation only: an HTTP error (4xx/5xx/503) does not latch false, and a signed-in shopper can un-latch it by switching tabs (acctRefresh at :13024).

**Fix.** Make the latch one-way per attempt rather than sticky — either drop apiSeen(false) from the four background loaders entirely (they already fall back silently on their own) and let only a real failed POST /api/orders/ decide demo mode, or in payNow re-probe before branching so the demo receipt is shown only when the order POST itself comes back offline.

### [high] Assistant's set_pricing patch merges over built-in defaults when the pricing row was never fetched, and PUTs the whole settings.pricing row
**Who hits it.** The owner opens the admin panel on his phone (lands on «Обзор»), taps the assistant FAB — the pane is rendered on every admin tab (public/shop2/app.js:16754-16758, body defaults to admOverviewHTML at :16745) — and says «подними скидку для салонов до 25 %» or «баллы начисляем 8 %». /api/assistant returns a PARTIAL patch by design (src/app/api/assistant/route.ts:398, sanitizePricing in src/app/api/assistant/actions.ts:800-830). The inline confirm card is applied at app.js:31902 → demoApply. S.pricingLoaded is only ever set inside loadAdminPricing (app.js:20877/20888/20893), and loadAdminPricing has exactly four call sites — admBanksHTML (:19281), admDeliveryCloseHTML (:19334), admPricingCard (:21081), goodsEditor (:24359). «Обзор» reaches none of them, and nothing else in the file writes S.pricingLoaded. So unless he happened to open «Настройки → Цены и баллы», «Доставка и оплата» or a pro

**What the code does.** app.js:28357-28362 — demoApply's set_pricing takes `entry.prev` from `cloneRules(S.pricingLoaded || normalisePricing(null))` and sets `S.pricingLoaded = mergePricing(S.pricingLoaded, a.value)`. mergePricing (:20847) calls normalisePricing on the base, which turns null into PRICING_DEFAULT (:20819 — partnersOn:false, proDiscountPct:20, proMinOrder:0, loyalty{enabled:true,earnPct:5,redeemMaxPct:30,minRedeem:5}). srvPush (:27160) then PUTs `{pricing: S.pricingLoaded}` — the full object, not the patch. Both cited lines say exactly what was claimed. Consequence: every field the owner never mentioned is silently rewritten to the built-in default — including partnersOn:false, which turns the whole 

**Existing guard.** None on the path. sanitizePricing and cleanPricing only clamp ranges; both explicitly document that the panel is responsible for the merge ("merged over the current settings" — route.ts:398; "The panel … merges this over what it already has" — actions.ts:793-797). admPricingCard has a skeleton guard that refuses to draw until S.pricingLoaded arrives (:21087), but that guard protects only the form 

**Fix.** In demoApply's set_pricing branch (and before the confirm card is offered), require S.pricingLoaded: call loadAdminPricing(true) and defer the apply until it lands, or make mergePricing return only the patched keys so srvPush PUTs a partial row that the server merges over the stored one.

### [high] A late assistant reply re-points (or empties) the confirm overlay already on screen
**Who hits it.** Owner only, and only through a several-second race — but a real one. On the phone: he opens the assistant sheet, types an actionable question ("разошли письмо о скидке", "удали набор X", "спиши 5 штук"), taps «→» (app.js:32604-32613 fires the fetch), then closes the sheet (tap the `.adm-scrim--phone`, app.js:16646 — S.admAi goes false, S.adminAsk is NEVER cleared; the only assignments are 32598/32604/34092) and goes to an order. He taps «Вернуть деньги» / «Отменить заказ» / «Оформить продажу» (31106-31160, 32436) — that sets pendingAction with overlay:true and renders the full-screen card. The reply then lands: askAdminAI's only gate is `if (S.adminAsk !== q) return;` (28588), which is still true, so 28589 `pendingAction = j.action || null;` overwrites it; admPaintAnswer (28566) rewrites only `[data-aians]` and there is no render() and no admin poll timer (the only setInterval in the fil

**What the code does.** All four citations are exact. One module-level `var pendingAction` (28474) is written by ~20 panel handlers with `overlay:true` and by askAdminAI (28589); screenAdmin draws the overlay straight from it (16754), the chat card is identity-checked (`pendingAction === a.action`, 16421) but the overlay is not; admPaintAnswer patches one node only (28566-28568); the apply handler (31810-31812) takes whatever the global holds at click time, with no check that it is the action the visible card was built from. Nothing on the path clears S.adminAsk on navigation, nothing locks the panel while a question is in flight, and the server never sees which card the owner looked at.

**Existing guard.** None on this path. `S.adminAsk !== q` only drops answers to superseded questions; the Escape handler (33579) and `[data-admcancel]` (31927) clear pendingAction but only if the owner cancels; the assistant pane's z-index blocks the reverse ordering, not this one.

**Fix.** Stop letting the assistant write the shared global: keep its proposal in S.adminAns.action only and have `[data-admapply]` resolve the action from the card it was clicked in (overlay -> a dedicated `overlayAction` variable, chat card -> S.adminAns.action), or at minimum have askAdminAI skip the write while `pendingAction && pendingAction.overlay` is on screen.

### [high] A single offline/non-JSON background POST latches API.ok=false and demo-modes the live checkout
**Who hits it.** Guest, courier/pickup/digital order (no parcel machine). Checkout loads fine, so API.ok=true. Typing the e-mail fires pushCart() (app.js:32963 -> 13352); its debounced POST /api/carts/ hits a mobile blip or one HTML 502/504 gateway page, which postJSON (13901) reports as {offline:true}, so 13373 sets apiSeen(false). Without a parcel machine, loadPointsFor never runs and every other probe has already spent its one-shot `asked` flag; there is no online listener and acctRefresh (13022) returns at once for a guest. With the network back, tapping «Оплатить» hits `if (API.ok === false) return finishDemo();` (14037): no order is created, clearOrderState() empties the basket, and the receipt reads «Заказ оформлен … Это демонстрация — настоящий заказ не создан». Nobody is charged and a reload resets API.ok to null, but the sale and the cart are gone and the owner never sees it.

**What the code does.** app.js:6650-6651 is `var API = { ok: null }` plus the symmetric setter `apiSeen`. The claim that no success path restores true is wrong: loadShipRules (6738), loadPointsFor (6905), loadCarrierLogos (6924) and loadPayMethods (7102) each call apiSeen(true) on success — but each is behind a one-shot `asked` flag, so a failure is never retried. pushCart (13373) really is asymmetric: apiSeen(false) on offline, never apiSeen(true) on success. The four fetch loaders only latch on a network rejection, since `r.ok ? r.json() : null` swallows HTTP errors without touching API.ok; postJSON is broader and returns offline for 404/405/501, a non-JSON body, or a rejection. payNow (14037) short-circuits to f

**Existing guard.** Partial only: the four fetch loaders ignore HTTP errors (r.ok ? r.json() : null), and /api/carts/ answers JSON 503 db_unavailable for DB outages, so a server-side failure does not latch. Nothing guards the network-rejection / non-JSON path, and there is no online event, no re-probe, and no server-side recheck because payNow never sends a request.

**Fix.** Call apiSeen(true) in pushCart's success branch, and in payNow always attempt POST /api/orders/, falling back to finishDemo() only when that response itself reports res.offline.

### [critical] Live bundles row sells 90 € of Kevin.Murphy for 39,90 € — the seeded price was never re-priced after the catalogue fix
**Who hits it.** Live proof, not inference: GET https://rempireshop.diipsolutions.eu/api/bundles/ returns, right now, {"id":"hair-young-again","price":39.9,"sum":90,"save":50.1} and {"id":"styling-duo","price":24.9,"sum":39,"save":14.1}. That route is listBundles({activeOnly:true}), so both rows exist, are active and are being served. Path: customer opens /shop2/set/hair-young-again/ (prerendered, in the sitemap), app.js swaps in the API list and draws 39,90 € with «−56 %» beside a crossed-out 90 €, adds line "bundle:hair-young-again"; at checkout src/lib/orders.ts:736 bundleDefs() reads the same table (DB wins over bundles.json) and bundlePrice() at :777 returns def.price verbatim, so the till charges 39,90 €. Renat packs wash 250 ml (28) + rinse 250 ml (28) + oil (34) and is paid 39,90. Qty is not capped at 1, so one order can take several. The same API answer also lists two sets Renat built himself ("

**What the code does.** The cited lines say what is claimed, but the claimed mechanism is wrong and the real one matters for the fix. db/migrations/120_bundles.sql does seed styling-duo 24.90 and hair-young-again 39.90 while src/data/bundles.json now has 33.9 and 78.9 — but at the migration's own commit (cd8f4c1) bundles.json said sum 29 / price 24.9 and sum 46 / price 39.9. The seed was byte-exact with the generator on the day it was written. Commit 73eeb33 then fixed 34 products whose prices sat against the wrong volumes (young-again wash/rinse 250 ml went 6 → 28, session-spray 400 ml 18 → 28) and regenerated public/shop/bundles.js and src/data/bundles.json to 33.90 / 78.90. Its own message says «подорожали два н

**Existing guard.** None. validateBundle's price_too_high only rejects a price at or above the parts' sum (no lower bound), and it guards admin writes only — the migration inserts raw SQL and orders.ts trusts the stored price.

**Fix.** Add db/migrations/121_bundles_reprice.sql that updates the two rows to 33.90 and 78.90 only while they still equal 24.90 and 39.90 (the conditional pattern 031_shipping_rules_ee_tariffs.sql already uses), so an admin edit Renat has since made is not overwritten; leave 120 as applied history.


# Everything else confirmed

## CRITICAL — 10

### assistant

**Late assistant reply silently re-points the confirm overlay already on screen**  
`pendingAction` (app.js:28474) is one global written by every panel overlay (31061, 31106-31240, 32125-32464) and by askAdminAI (28589), whose only guard is `S.adminAsk !== q`. The overlay is drawn from `pendingAction` at 16754, and admPaintAnswer (28566) repaints only `[data-aians]` without render(), so the stale overlay stays on screen while «Применить» (31811) applies the assistant's action instead.  
_Fix (small):_ Give the assistant its own slot (e.g. `S.adminAns.action`) and have data-admapply read the overlay's own action, or refuse to overwrite pendingAction while one with `overlay` is live.

**set_pricing from «Обзор» merges over built-in defaults and PUTs the whole row**  
loadAdminPricing is only reached from the pricing/banks/delivery cards and the goods editor (19281, 19334, 21081, 24359), never on «Обзор», so S.pricingLoaded is null; demoApply then does mergePricing(null, patch), which normalisePricing turns into PRICING_DEFAULT (partnersOn false, proDiscountPct 20, earnPct 5), and srvPush PUTs the whole object (27160). The journal's `prev` is captured from the same defaults, so undo restores them too.  
_Fix (small):_ Make the set_pricing confirm card await loadAdminPricing and refuse to apply while S.pricingLoaded is null.

### auth

**Refund retry sends a fresh idempotency key — a lost response can refund twice**  
refund/route.ts sends idempotencyKey: randomUUID() per attempt, and the only dedupe is `left = refundableAmount(...)` read from Postgres, which is written by settleRefund only after the provider answers. A refund that succeeds at Montonio but whose response is lost leaves left unchanged, so a second press sends a second, undeduplicable refund.  
_Fix (small):_ Derive the key deterministically from order id + amount + refund sequence (or persist a pending refund row before calling the provider).

### bundles

**Migration 120 seeds styling-duo and hair-young-again far below the generator's prices**  
db/migrations/120_bundles.sql seeds styling-duo 24.90 and hair-young-again 39.90, while src/data/bundles.json (the generator's own output) has 33.9 and 78.9; the other six rows match byte for byte. hair-young-again is 90 € of Kevin.Murphy sold for 39,90 €.  
_Fix (one-line):_ Correct the two seed prices, and any live rows still at them, to 33.90 and 78.90.

### promos

**Promo code discounts gift-card face value — buy a 100 € card for 90 €**  
priceItems pushes the gift line at face value (src/lib/orders.ts:908-913) into the subtotal (:986), and createOrder passes that whole subtotal to codeDiscount (:1311) with no line-kind filter; quoteFromPromo (src/lib/promos.ts:180-182) knows nothing about gift lines, while issueGiftCards mints the full face value on the paid transition. Every euro of discount on a gift line is a straight cash loss, repeatable while the code lives.  
_Fix (small):_ In createOrder, price the promo against the non-gift part of the subtotal only (and skip free_shipping/fixed on a gift-only basket).

### pwa

**One failed background probe latches API.ok=false and puts the live checkout into demo mode**  
app.js:6650 API.ok is set false by loadShipRules/loadPointsFor/loadCarrierLogos/loadPayMethods/pushCart failure handlers, all one-shot and none of them setting it back to true on a later success (pushCart's success branch calls nothing). payNow() at app.js:14037 then does `if (API.ok === false) return finishDemo();` — no request is sent, the basket is cleared and a demo receipt is shown.  
_Fix (small):_ Drop the sticky flag from payNow: always attempt the order POST, and only ever show the demo receipt on an explicit 404/405/501 from the orders route.

**An order POST whose answer is lost is answered with the demo receipt, orphaning a real order row**  
postJSON's rejection and non-JSON branches (app.js:13908-13911) both return {offline:true}, which cannot distinguish "never arrived" from "answer lost"; app.js:14052 `if (res.offline) return finishDemo();` then clears the cart, nulls pendingOrder and tells the customer it was a demonstration while the row exists in Postgres.  
_Fix (medium):_ Treat a lost answer as an error (retryable toast) rather than as demo, and keep pendingOrder so the retry pays the existing order.

### storefront

**A 502/504 or dropped connection shows a fake «Заказ оформлен» for an order that may really exist**  
postJSON (app.js:13901-13911) returns {offline:true} for a rejected fetch AND for any body r.json() cannot parse — which is what an edge 502/504 HTML page is — and payNow treats that as demo mode: `if (pay.offline) return finishDemo();` at :14083, after POST /api/orders/ already created the order. finishDemo (:14017) clears the cart, persists it and shows the green receipt.  
_Fix (small):_ In postJSON return {offline:true} only for 404/405/501; make a rejected fetch and an unparseable body a real error so payNow's catch shows «попробуйте ещё раз» instead of a receipt.

**No per-size stock: a sold-out volume is shown in stock, basketed and paid for**  
productStockStates collapses all variants into one word (src/lib/inventory.ts:564) — only "out" when every size is out — and that word is what the public feed carries (src/lib/orders.ts:533-538) and what the server itself checks when the order is placed (src/lib/orders.ts:928). A sold-out 500 ml on a product whose 75 ml has stock sells normally.  
_Fix (medium):_ Ship per-variant stock states in /api/overrides and check the ordered variant's state in createOrder, not the product-level word.

**One failed background probe latches API.ok=false, so «Оплатить» goes straight to the fake receipt**  
apiSeen(false) is called from the .catch of loadShipRules (:6745), loadCarrierLogos (:6933), loadPayMethods (:7117) and loadPointsFor (:6908) — all one-shot (shipRulesAsked, CARRIER_LOGOS.asked, PAYMETHODS.asked, POINTS.by cache) so none ever retries — and payNow short-circuits on `if (API.ok === false) return finishDemo();` at :14037 before posting anything. A tunnel at page load kills every order for the life of the page.  
_Fix (small):_ Drop the API.ok short-circuit from payNow (always try the POST), or only let an explicit 404/405/501 set the latch.

## HIGH — 82

### analytics

**Accountant export counts fully refunded orders as revenue and VAT**  
REPORTABLE_STATUSES at src/lib/reports.ts:167 includes 'refunded', and summarize() (reports.ts:285-289) sums r.total and r.vatAmount with no sign or status handling; setOrderStatus('refunded') never touches orders.total. The «Выручка»/«НДС» card therefore includes money that went back.  
_Fix (small):_ Exclude refunded rows from summarize(), or subtract them, and show them as a separate reversal line.

**Export rows do not foot — loyalty_discount is never selected or shown**  
total = subtotal + shipping − discount − loyalty_discount (orders.ts:1337) and loyalty_discount is its own column (migration 100:52), but reportOrderColumns() (reports.ts:261) does not select it and REPORT_COLUMNS has no column for it, so Subtotal + Shipping − Discount ≠ Total on every points order.  
_Fix (small):_ Select loyalty_discount and add a «Points» column to REPORT_COLUMNS and the XLSX/CSV writers.

**«Обзор → Сегодня» drops to zero when an order is marked delivered**  
The server field o.orders.today exists but grep finds no use of it in app.js; admOverviewHTML (app.js:15187-15194) re-sums today from the loaded orders accepting only paid||shipped and using browser-local midnight, so «Доставлен»/«Выдан» removes the sale from today's takings while «Аналитика» still shows it.  
_Fix (small):_ Include 'delivered' and use the Tallinn day (admShopDay) in the client loop, or price today's orders server-side and render that field.

**Partial refunds are never subtracted — analytics and the export still count the full total**  
A partial refund is written only to payment.refunds; the order keeps status paid and its original total, and refundedTotal() is used only in the refund/order routes and settle.ts — never in analytics.ts or reports.ts. Every «Выручка», VAT figure and export Total therefore includes refunded money.  
_Fix (medium):_ Deduct refundedTotal(payment) in the report row and in the revenue queries, or add a Refunded column and net total.

### assistant

**A max_tokens-truncated answer still yields a live action, and whole-list actions then delete the cut part**  
ai-json closeOpen() drops the unfinished member and closes the brackets; route.ts special-cases `truncated` only for draft_post (650-655) and runs sanitizeAction on the salvage regardless (656), while the «ответ обрезан» sentence is appended only when no action survived (662-665). For set_hero/set_bundle/update_product, which replace the whole list, the salvaged object is a shorter list.  
_Fix (small):_ Drop the action (or force retry) whenever `extracted.truncated` and the action type replaces a whole list.

**Customer chat's catalogue is the static file — stock is stale, so it recommends sold-out items**  
shopPrompt's CATALOGUE is relevantLines(question) (route.ts:266) and catalogue-slice.ts reads only src/data/catalogue.min.json, whose own header says live data is the caller's job; that file was last committed 2026-09-02, twelve days ago, while live stock lives in the overrides feed (api/overrides/route.ts:100-125). The prompt's «Never recommend items with stock out» is enforced against frozen data.  
_Fix (medium):_ Overlay the live stock/price overrides onto the slice before building the shop prompt.

**Changing one banner slide destroys the ET/EN text, eyebrow, subtitle and button of the others**  
heroForAI sends only id, title.RU, go, image and on per slide (app.js:28527-28537) and briefHero keeps that shape, yet the prompt demands the WHOLE banner back with all three languages written by the model (route.ts:434-436, 146-148). The model cannot preserve what it was never shown, and set_hero replaces the whole slide list.  
_Fix (medium):_ Send the full slide objects to the model, or merge the returned slides field-by-field over the stored ones for slides the owner did not ask to change.

**The owner's own products are invisible to the customer chat**  
customForPrompt() is gated on `isAdmin && !isMini` (route.ts:591), so on the shopper path custom.rows is empty; the shop prompt sees only the static catalogue and `known` (639-640) excludes custom ids, so a c-… product cannot even be returned as a card. Those products are live on the storefront via /api/overrides (customForFeed).  
_Fix (small):_ Run customForPrompt on the shopper path too and fold its rows into the CATALOGUE block and the `known` set.

### auth

**POST /api/carts lets anyone file a cart under someone else's address and get them mailed**  
With no customer cookie the route uses the body's address as written (carts/route.ts:51), saveCart upserts with recovered_at = null, and runAbandonedCarts selects purely on reminded_at/recovered_at/updated_at with only the unsubscribe set consulted — no consent column. Contents are not fully attacker-chosen: names and prices are rebuilt from the catalogue, only ids/sizes/quantities come from the body.  
_Fix (medium):_ Require a customer session or a verified-address marker before a cart row can earn a reminder letter.

**verifyPassword accepts any password when the stored hash's key segment is empty or non-base64**  
parts[5] decoding to an empty Buffer gives want.length 0; I verified scryptSync(..., 0, ...) returns a zero-length buffer without throwing and timingSafeEqual(empty, empty) is true, so line 151 returns true for every password. Reachable via a clipped or mangled ADMIN_PASSWORD_HASH, which /api/admin/me still reports as configured.  
_Fix (one-line):_ Reject the hash unless want.length === 32 (or at least > 0) before calling scryptSync.

### blog

**Delete/unpublish leaves the prerendered article live until the next deploy**  
deletePost/unpublishPost only set status='draft' (src/lib/blog.ts:753-776); the file public/shop2/blog/<slug>/index.html written by the prebuild prerender stays in the deployment and next.config.ts rewrites still point at it, so the full text keeps answering 200 for crawlers and link shares while the panel says «Статья удалена ✓».  
_Fix (medium):_ On unpublish/delete, either trigger a redeploy hook or make the blog routes win over the static file (stop prerendering /blog/ pages).

**Admin «Блог» shows «нет ни одной статьи» on 401/503**  
loadAdminBlog() sets S.adminBlog = [] for every non-200 and in .catch() (app.js:11386-11395); the route answers 401 on an expired cookie and 503 on a database outage, and admBlogScreen then renders the empty state inviting a new article.  
_Fix (small):_ Keep an error state in S and render «не удалось загрузить — обновите» instead of the empty state.

**Back gesture closes the editor and drops an unsaved article with no warning**  
admCloseTop() for the "blog" layer just does S.adminBlogEdit = null (app.js:30349) and the popstate handler calls it (app.js:30409); only the «← Блог» button runs blogReadForm()/blogDirty() (app.js:32730-32735), so a swipe-back throws the draft away.  
_Fix (small):_ Run the same blogDirty() confirm inside admCloseTop()'s blog branch.

**Inline product card keeps its old price and dead link once the product is gone**  
The stored marker is <a data-product=…>Name — 12,90 €</a> (app.js:11819-11821); blogCleanNode only swaps it for a live card when productsById finds the product, otherwise it falls through to the stored link (app.js:9946-9950), so a withdrawn product shows its old price to customers and links to a missing page.  
_Fix (medium):_ When the product is unknown, drop the link and keep only the plain words (or hide the stale price).

**Body over 20 000 characters is silently truncated while the panel says «Сохранено ✓»**  
upsertPost runs the body through trilingual(input.body, 20_000, true) which ends in .slice(0, max) (src/lib/blog.ts:554, 666) with no error or flag, and the client never compares the returned body with what it sent (app.js:12386-12390).  
_Fix (small):_ Refuse an over-length body with an error, or return a truncated flag and warn in the editor.

### bundles

**Prerendered set pages and their JSON-LD carry build-time prices, not the table's**  
tools/prerender-shop2.mjs reads BUNDLES out of public/shop/bundles.js at build time, and package.json prebuild has no step that regenerates that file from the bundles table, so an admin price edit never reaches the static HTML, title, meta or Offer.  
_Fix (medium):_ Add a prebuild step that writes public/shop/bundles.js from the bundles table, or render the set price only after /api/bundles/ answers.

**«Показывать в магазине» off is ignored inside sets — hidden product still shown and sold**  
`hidden` appears nowhere in src/lib/bundles.ts: expand() reads only o.price and o.stock, and the bundle branch of priceItems() (orders.ts:866-870) checks stock only, while a plain product line throws out_of_stock on o.hidden (orders.ts:934).  
_Fix (small):_ Treat o.hidden as stock "out" in expand() and in the bundle part loop in priceItems().

**A paid set never decrements its parts' stock**  
decrementStock() skips every line with kind !== "product" (payments/apply.ts:456) and the order line carries no parts, so stock_moves and stock_levels never see the goods leave; the matching 'return' move at orders.ts:1535 skips them too.  
_Fix (medium):_ Resolve the set's parts at payment (bundleDefsForOrders) and move each {productId, variant, qty × line qty}; mirror it in the return path.

### customers

**Customer «Потратил»/revenue counts unpaid and refunded orders**  
CUSTOMER_JOIN (src/lib/loyalty.ts:658-668) sums orders `where status not in ('cancelled','failed')`, so 'new' (the insert default, only ever moved by a provider verdict in apply.ts) and 'refunded' count as spend; every other money query uses PAID_STATUSES paid/shipped/delivered. NOT_A_PURCHASE at :788 gives avgOrder/topBrands the same wrong set, and no sweep cancels abandoned 'new' orders.  
_Fix (small):_ Use PAID_ORDER_STATUSES in CUSTOMER_JOIN and NOT_A_PURCHASE so a purchase means paid/shipped/delivered everywhere.

**Points are never reversed on a refund or cancellation**  
Grep of the repo shows loyalty_ledger has exactly three writers (earn/redeem/adjust in src/lib/loyalty.ts); setOrderStatus (orders.ts:1530-1571) returns stock and voids gift cards on paid→refunded and never touches the ledger, and refund.ts/settle.ts carry no points term (refundValue = total + gift). Redeemed points stay spent and earned points stay credited after a full refund.  
_Fix (medium):_ On paid→refunded, post a compensating ledger line for that order's earn and redeem rows (idempotent per order).

**Points earned on pre-discount subtotal; a gift card earns twice**  
settleLoyalty passes order.subtotal to earn (apply.ts:365-368), and orders.subtotal is the goods subtotal computed before discount and loyaltyDiscount are subtracted (orders.ts:990, 1337-1341), with gift-card lines priced at face value (orders.ts:905-915). So a 100 € gift card earns 5 points at sale and 5 more when it pays for a basket.  
_Fix (small):_ Earn on the amount actually paid for goods — subtotal minus discount and loyalty discount, excluding gift-card lines.

### giftcards

**A gift card is debited before anything durable is written, so a retry debits it again**  
On the provider path the redeem runs after setOrderStatus('paid'), so a webhook retry is safe. But settleWithoutPayment (zero-total orders) calls takeCoverage → redeemGiftCard BEFORE any order write (settle.ts:229-233), and redeemGiftCard has no order_id guard (giftcards.ts:433-456) — a 503 from the setOrderPayment that follows, or a double-tap on «Оплатить», debits the card a second time for the same order.  
_Fix (small):_ Before debiting, check gift_card_uses for a 'redeem' row with this order_id (the way loyalty.ts:341 does), and return that as already taken.

**Webhook and shopper return can both run the paid transition and mint the order's cards twice**  
Both routes read the order, applyPaymentResult derives wasPaid from that snapshot (apply.ts:481), setOrderStatus is an unconditional UPDATE (orders.ts:1506), and issueGiftCards' idempotency is a bare SELECT-then-INSERT (giftcards.ts:257-262) with no unique key on order_id. Two overlapping arrivals mint two sets of codes, mail both, and redeem/decrement twice (loyalty alone is protected by its own unique index).  
_Fix (medium):_ Make the paid transition conditional (update … where status <> 'paid' returning) and only continue when that row comes back.

**An all-gift-card basket writes the first card's recipient onto every card**  
For a gift-only order isDigital() is true and lineMeta() uses giftTo() for every gift line (app.js:13824), seeded from the first gift line (app.js:13491-13504), while the cart still shows each line's own recipient (app.js:10017). Two cards for two people are both issued and mailed to the first one.  
_Fix (small):_ Keep each gift line's own meta; use the step-2 form only for lines that carry no recipient, or show one recipient block per card.

**Loyalty points are earned on gift-card face value, so the same euro earns twice**  
earnLoyaltyPoints is given order.subtotal (apply.ts:366-368), which includes gift lines (orders.ts:986), and it is the quoted subtotal rather than what was actually paid — so buying a card earns points and spending it earns points again on the goods. Paying for a gift card with a gift card earns points on every cycle at no cost.  
_Fix (small):_ Earn on the subtotal of non-gift lines, net of what a gift card paid.

**A gift line of more than 20 is charged in full but only 20 cards are minted**  
createOrder allows qty up to 99 for any line and prices the gift line as amount×qty (orders.ts:858, 912), the cart stepper has no gift-specific cap (app.js:30898, CART_MAX_QTY 99), but issueGiftCards clamps to 20 (giftcards.ts:270) and nothing compares issued cards against the line's qty.  
_Fix (small):_ Refuse a gift line over the mint limit in createOrder, and make the limit one constant shared by both.

**An order paid with a since-voided card cannot be refunded, after the bank half has already gone**  
creditGiftCard refuses a voided card (giftcards.ts:532-539) and the refund route turns that into a 409 only after the provider refund was sent and recorded (refund/route.ts:184-235). A card is voided whenever the order that sold it is fully refunded (orders.ts:1563-1568) — reachable via a refund made in Montonio's own portal, which the admin's gift_used guard never sees.  
_Fix (medium):_ Check the card can take its share before calling the provider, and allow crediting a voided card (or paying that share out in money) when the order being refunded only spent it.

### i18n

**Blog «Перевести на ET и EN» sends whole article through a 900-token task, cut output saved**  
app.js:32834-32843 sends the full body as task "translate"; route.ts:78 gives translate max_tokens 900, and route.ts:399 refuses truncation only for post_full/post_translate/newsletter, so ai-json's repaired half-answer comes back 200 ok and is written into the draft.  
_Fix (small):_ Use post_translate (4500) for the body, or add "translate" to the truncated-refusal list in route.ts:399.

### invoices

**Lost response at checkout shows the demo receipt for a real order**  
postJSON maps any fetch rejection to {offline:true} (app.js:13911) and payNow's first line does `if (res.offline) return finishDemo()` (app.js:14052), which clears the basket and shows «Это демонстрация — настоящий заказ не создан». A dropped connection after the server wrote the order and mailed the numbered invoice produces exactly that.  
_Fix (small):_ Distinguish a transport failure from a 404/405/501 static host and show «не знаем, прошёл ли заказ — проверьте почту» instead of finishDemo().

**Dunning reminder is sent with a blank IBAN, bypassing invoiceSendBlock**  
invoiceSendBlock() is called only inside sendInvoiceMail() (invoices.ts:555-556); sendReminder() (invoice-dunning.ts:113-158) renders and sends renderInvoiceReminder directly, and the template's `pick(data.seller.iban)` returns "" with no fallback (layout.ts:143), so the company gets a payment demand with an empty IBAN row.  
_Fix (one-line):_ Call invoiceSendBlock(seller) in sendReminder() and skip the letter (stamping the reason) when it returns no_iban.

**A crash between the payment blob and the status write leaves the order half-settled forever**  
apply.ts writes setOrderPayment at :515 before setOrderStatus at :523, and alreadyPaid() returns true on payment.status === 'paid' alone (:386-395), so every retry stops at :521 with alreadyPaid — the status, stock, loyalty, purchase event and paid letter never happen and no screen can recover it.  
_Fix (medium):_ Make the retry path re-drive the settle steps when payment is paid but the order status has not moved, instead of returning early on the blob alone.

**Auto-cancel fires on invoices that were never delivered**  
cancelOrder() (invoice-dunning.ts:182-197) guards only on status and invoice.paidAt and the cancel branch keys on overdue days alone (:259-262); sentAt/sendError, written by issueInvoice at invoices.ts:504-505, are never read, so an order whose invoice letter was refused is cancelled and the company is mailed «счёт не оплачен». Its reminder half duplicates finding 2.  
_Fix (small):_ Skip (and flag for the owner) any invoice with sentAt === null in both the reminder and cancel branches.

### letters

**Back-in-stock alert is consumed even when the letter never left**  
sendStockAlerts (flows.ts:572) calls markStockAlertSent before sendRendered and every non-success falls into `else skipped += 1` (:593) with no un-stamp; the birthday flow at :848 does un-stamp on a skipped send. With no RESEND_API_KEY or a bad address the whole waiting list is silently burned and never retried.  
_Fix (small):_ Only stamp after res.ok, or clear sent_at when res.skipped, mirroring the birthday flow.

**Newsletter with every send failed is marked «отправлено» and locks forever**  
counts() puts failed rows outside `left` (newsletters.ts:613), so all-failed gives left=0, done=true and status 'sent' (:725-730); updateNewsletter and deleteNewsletter only touch status='draft' (:305-326) and claim() throws already_sent (:569), so the letter cannot be edited, deleted or re-sent.  
_Fix (small):_ Treat a run with sent=0 and failed>0 as not done — leave it in 'sending'/'draft' and let failed rows be requeued.

**Resumed newsletter mails people who unsubscribed while it was paused**  
audienceRows() is read once in claim() (newsletters.ts:564) and frozen into newsletter_sends; every later batch just selects status='queued' (:648) with no marketing or mail_optouts check. A send that stalls and is continued later mails addresses that opted out in between.  
_Fix (small):_ Re-check optedOutSet/marketing for each queued batch before sending and mark the opted-out rows skipped.

**POST /api/carts is unauthenticated — any address can be signed up for the cart letter**  
The route takes the address from the body when there is no session (carts/route.ts:51) behind only a 30/min in-memory per-IP limit, and runAbandonedCarts consults only the stop list, never customers.marketing (flows.ts:400). Harvested addresses can be made to receive branded marketing mail from the shop's domain.  
_Fix (medium):_ Only accept a body address for a session-less cart if that address already exists as a customer, or require marketing consent before the reminder is sent.

**Abandoned-cart letter prices lines differently from the checkout**  
cartSnapshot uses `VARIANTS[id] ?? own?.variants` and never overrideLadder (customers.ts:708), and a flat override replaces the rung price outright (:721), while priceLines uses the owner ladder and keeps the rung premium `money(o.price + (v.price - p.p))` (orders.ts:942-960). The letter's «Итого» can be far below what the customer is then charged.  
_Fix (medium):_ Have cartSnapshot call the same ladder/override pricing helper priceLines uses.

### orders

**Paid transition has no atomic guard — bank return and webhook can both settle one order**  
applyPaymentResult reads wasPaid from the caller's snapshot (apply.ts:481) and setOrderStatus is an unconditional UPDATE with no status predicate and no lock (orders.ts:1506-1517); both the return route and notify route fetch the order, then call settlePayment. Two concurrent arrivals both see status 'new' and both run redeemQuotedGiftCard, settleLoyalty, recordPurchase and decrementStock.  
_Fix (small):_ Make the move into paid a conditional UPDATE (`where id=$1 and status <> 'paid' returning *`) and run the side effects only when a row came back.

**Order set to «возврат» by hand still offers «Вернуть деньги» for the full amount**  
setOrderStatus writes nothing into payment.refunds, and both the refund route's settled() (refund/route.ts:80) and the card's admRefundView (app.js:14886) key off payment.status === 'paid' only — status is never consulted, so `left` is still the whole order and the button is still drawn.  
_Fix (small):_ Treat a hand-set «возврат» as a refund: either record a manual ledger entry on that transition, or refuse/warn in the refund route and hide the button when status is 'refunded'.

**Refund after «Отменить заказ» never voids the order's gift cards, and the panel says it did**  
settleRefund only moves to 'refunded' when the current status is in PAID_ORDER_STATUSES (settle.ts:111), and voidGiftCards runs only inside that move (orders.ts:1563) — a cancelled order keeps status 'cancelled', so the cards stay live, yet the route still returns `voided` from `out.fully` (refund/route.ts) and the confirm card promises the code is cancelled.  
_Fix (small):_ Void the sold cards on any full refund, not only on the status move, and report `voided` from what was actually voided.

**Undoing a cancellation never takes the returned stock back off the shelf**  
paid→cancelled adds +qty 'return' moves (orders.ts:1531-1553) with no inverse; the undo PATCH hits the `else if (status && status !== found.status)` branch because settled() is true for an already-paid order (route.ts:66-70,187), so it is a bare setOrderStatus. Every cancel/undo cycle adds the whole order to inventory.  
_Fix (medium):_ On cancelled/refunded → paid, re-run the decrement for tracked product lines (mirror of the 'return' move).

**«Вернуть деньги» mints a fresh idempotency key per attempt, so a retry refunds twice**  
refund/route.ts:191 passes `idempotencyKey: randomUUID()` on every attempt, with a comment claiming it makes a double tap harmless; a per-attempt key is exactly what lets Montonio treat a retry as a second refund, and `left` is read from a snapshot taken before the call.  
_Fix (one-line):_ Derive the key deterministically from order id + amount + refund sequence so a retry carries the same key.

**A network blip after the order is created shows «настоящий заказ не создан» and empties the basket**  
postJSON maps a fetch rejection and any non-JSON body (a 502/504) to {offline:true} (app.js:13901-13911); payNow treats that as "no backend" and calls finishDemo() after the payment POST (app.js:14083), which runs clearOrderState() — nulling pendingOrder and the cart — and shows the demo receipt saying no real order was created, while order R-… exists unpaid on the server.  
_Fix (small):_ Only treat 404/405/501 as offline; a fetch failure or 5xx after the order exists should show a retry-payment screen and keep pendingOrder.

### payments

**Second payment overwrites the first payment's Montonio reference**  
apply.ts:515 writes the whole blob (provider, ref, amount, at) and only then returns on wasPaid at :521; orders.ts:1481-1487 merges top-level keys with `||`, so `ref` is replaced. refund/route.ts:165 reads payment.ref as the only id a refund can be sent against, so the first payment becomes unrefundable and untraceable.  
_Fix (small):_ Return early on wasPaid before setOrderPayment, or record a repeat payment under a separate key instead of over the top-level blob.

**Return and webhook race: gift card and stock taken twice**  
Both doors read the order (return/route.ts:88, notify/route.ts:68) then settle from that snapshot; wasPaid comes from it (apply.ts:481) and setOrderStatus is an unconditional UPDATE with no old-status condition (orders.ts:1491-1515). Two simultaneous arrivals both take the !wasPaid branch and both redeem the gift card and decrement stock.  
_Fix (medium):_ Make the paid transition a conditional UPDATE (where status not in paid/shipped/delivered) and run the side effects only when it returned a row.

**Pending receipt says «деньги не списаны» and offers a retry while the first payment is live**  
create/route.ts:78-80 refuses only paid/shipped/delivered and cancelled/refunded, so an order with a payment in flight (status `new`) gets a second, independent Montonio order and nothing voids the first. app.js:29044-29046 shows «деньги не списаны … оплатите ещё раз» on exactly the PENDING state Montonio reports for a started, unsettled payment.  
_Fix (medium):_ Re-verify the stored payment.ref with the provider before creating a second payment, and soften the pending wording.

**Retried refund sends a second real refund — idempotency key regenerated per request**  
refund/route.ts:191 mints `idempotencyKey: randomUUID()` inside the handler, so each HTTP attempt is a distinct refund at Montonio; montonio.ts:306-308 claims the opposite. The only guard (:127 already_refunded) reads the ledger, which a timed-out first attempt never wrote.  
_Fix (small):_ Derive the key deterministically from order id and amount so a retry carries the same key.

**A PENDING refund immediately voids the gift cards the order sold**  
settle.ts:103 counts any non-failed entry — including `pending` — towards fullyRefunded, and :111-113 moves the order to `refunded`, which calls voidGiftCards (orders.ts:1557-1570; giftcards.ts sets balance 0 and voided_at). montonio.ts:122-132 says such a refund may sit PENDING ten days and then be CANCELED, and nothing un-voids the cards.  
_Fix (medium):_ Only count `done` entries towards the move into «возврат», or make the void reversible when a refund later reads failed.

**A REFUNDED order token books a second refund on top of the refund webhook**  
notify/route.ts:107-119 records a full refund for `Number(order.total)` under a synthetic ref whenever the order token says REFUNDED (montonio.ts:453), with no check against refundedTotal; foldRefund dedupes by `ref` alone (refund.ts:202-211), so the refund webhook's entry and this one both count. The ledger overstates the refund, a second customer letter goes out, and nothing is left refundable.  
_Fix (small):_ Record only refundValue(order) minus refundedTotal(order.payment), and skip when that is 0.

**Loyalty points spent on a refunded order are never returned**  
Points are spent on the paid transition (apply.ts:314-354) and no refund path touches the ledger — settleRefund writes ledger, audit, status and letter only (settle.ts:82-129) and the `refunded` transition returns stock and voids cards only (orders.ts:1531-1574). refundValue is total + gift (settle.ts:142-146), so the refund amount does not count the points either.  
_Fix (medium):_ Credit the order's loyaltyDiscount back on the move into `refunded`, and include it in refundValue.

**Refund webhook records and emails an amount that is not what Montonio sent back**  
notify/route.ts:171 clamps against `Number(order.total)` while refundedTotal includes gift-card refunds (refund.ts:140-146); every other calculation uses refundValue() = total + gift (settle.ts:102,142-146). After a 20 € card refund, a 30 € bank refund is clamped to 10 € and the customer's letter states that figure; :176 then discards the clamp when the remainder is 0.  
_Fix (small):_ Clamp against refundValue(order) and drop the `amount > 0 ? amount : note.amount` fallback.

### pos

**No idempotency on POST /api/admin/pos-orders/ — a lost answer makes the cashier ring the sale twice**  
route.ts POST runs createOrder → setOrderPayment → settlePayment on every call with nothing keyed to a client id, and posSend()'s catch only sets S.posErr and leaves the basket and the buttons ready (app.js ~26318). A retry after a timeout writes a second paid order, second points, second stock write-off and a second customer letter.  
_Fix (medium):_ Have the register generate a sale id per basket, send it, and make the route return the existing order when that id is already on a row.

**Price override on a product with a saved size ladder: the chip shows the new price, the bill uses the old**  
applyDemoOverrides sets p.prices[0] = DEMO.price (app.js ~26770) after the ladder is applied, but orders.ts:961 ignores o.price whenever ownLadder exists and charges ownLadder.prices[0]. edLadderMoved() saves a first-rung price edit as set_price, so exactly that combination is what the editor produces.  
_Fix (small):_ In priceItems(), let a bare price override replace rung 0 of an owner ladder (or stop the editor saving set_price when a ladder exists).

**Bare price override: server shifts every size, the register only patches the first — cash taken ≠ order total**  
orders.ts:963 charges money(o.price + (v.price − p.p)) for every size, while the browser patches only p.price and p.prices[0] (app.js ~26770-26772) and the chips/totals read p.prices[idx]. Any size but the first is shown at the file price and billed at the shifted one.  
_Fix (small):_ Apply the same shift to all rungs in applyDemoOverrides() so browser and server price identically.

**A size the owner adds or renames on a catalogue product can never be stocked, and its sales write nothing off**  
catalogueUniverse() builds the shelf from the generated VARIANTS file only (inventory.ts:592) — the owner ladder in product_overrides.sizes is never consulted — and getLevels maps that universe, so a renamed/added variant has no «Склад» row. Sales on it hit the untracked branch (inventory.ts ~417) and are skipped silently while the receipt says «остатки списаны».  
_Fix (medium):_ Build the universe from the effective ladder (owner override first) and migrate stock_levels rows when a size is renamed.

### privacy

**Admin assistant sends customer names and e-mails to OpenAI; policy says it does not**  
customersSummaryForPrompt() (route.ts:249) emits `name|email|tier|points` for 15 customers and is included when /балл|клиент|партнёр/i matches (route.ts:588); the block goes into the system prompt (route.ts:335) and on to api.openai.com. The published policy states «Тексты помощника готовит OpenAI — без передачи ему ваших персональных данных.»  
_Fix (small):_ Send an opaque id or a masked name instead of e-mail, or correct the policy sentence to admit the transfer.

**Unticking marketing in «Кабинет» does not stop the abandoned-cart letter**  
withdrawMarketingConsent() only sets customers.marketing=false (consent.ts:109-115) and writes no mail_optouts row, while runAbandonedCarts() selects from carts and filters solely through optedOutSet() (flows.ts:376-400) — it never joins customers.marketing. The customer keeps getting the cart letter after withdrawing.  
_Fix (small):_ Either have withdrawMarketingConsent() also insert a mail_optouts row, or make the cart query exclude addresses whose customers row has marketing = false.

**Typed search phrases stored 90 days; policy says statistics keep only page/language/country/device**  
trackSearch() posts the raw query as `path` (app.js:8289-8293) and events.ts:93 stores it lower-cased, and the search screen's view path is `/search/?q=<query>` (app.js:30189), so the phrase lands twice under the same sid for the 90-day window. The policy promises «сохраняются страница, язык, страна и тип устройства».  
_Fix (small):_ Drop the query string from the view path and either stop storing the phrase or disclose it in the policy.

### products

**Deleting a volume makes an old cart line bill the cheapest price and show "2" as the size**  
lineVariant (app.js:13803) sends the raw index while the storefront clamps it for display; variantOf (orders.ts:686-700) finds index 2 out of range in a 2-rung ladder, falls back to sizes.indexOf("2") = -1 and returns {label:"2", price:null}, so orders.ts:962 charges the product's base price. The shopper is quoted the clamped price and billed the first rung's.  
_Fix (small):_ Store the size LABEL on the cart line (or drop the line when the index no longer exists), and make variantOf refuse an unresolvable variant instead of pricing it at base.

**«Наличие» and «Снять с продажи» are silently overwritten for any counted product**  
getOverrides (orders.ts:533-538) re-derives stock from productStockStates and overwrites the manual override for every product with a tracked variant; the editor's select (app.js:23686, 23725) and «Снять с продажи» (app.js:31864) write only that override and are never disabled. The panel toasts success and the badge reverts on the next feed.  
_Fix (medium):_ Disable/relabel the «Наличие» select and offer a real write-off for tracked products, or let a manual "out" beat the derived state.

**A hidden catalogue product opens showing file values; saving a description wipes ET and EN**  
rebuildCatalogue (app.js:26674-26680) removes hidden products from CATALOGUE and applyDemoOverrides (26736) only walks CATALOGUE, so admEditProduct's FILE_PRODUCTS fallback (23464) returns an unpatched object — price, sizes, descOv and proPrice all show the file's values, and the desc save (31760) writes the three empty boxes over the stored override.  
_Fix (medium):_ Apply overrides to FILE_PRODUCTS too (or keep hidden products in a patched side list) so the editor always sees the owner's saved values.

**The «Салон, €» column shows the wrong wholesale price for every size but the first**  
The grid renders edSalonOf(price_i) = price_i x (1-pct) for rows i>0 (app.js:23852, 23862), while proUnitPrice (loyalty.ts:184) bills base x (1-pct) + (price_i - base). For pct 20, base 9, size 16 the grid says 12.80 and the shop charges 14.20.  
_Fix (one-line):_ Compute the read-only cell as edSalonOf(firstPrice) + (price_i - firstPrice), mirroring proUnitPrice.

**A saved salon price never comes back to the panel and can never be cleared**  
publicOverrides (api/overrides/route.ts:73) strips proPrice from the only feed the panel reads (app.js never GETs /api/admin/overrides), and adoptServer resets DEMO.proPrice = {} at 26867 and refills it only from the absent o.proPrice. The box shows empty with the default placeholder, and the clear branch at 31702 never fires because curPP is always null.  
_Fix (small):_ Have the panel GET /api/admin/overrides (admin-only) for proPrice, or add proPrice to an admin-authenticated feed and fill DEMO.proPrice from it.

### promos

**«Сколько раз» typed as text silently becomes «unlimited»**  
The field is a free-text input (public/shop2/app.js:21423, inputmode=numeric, not type=number); promoFormPayload does Math.trunc(Number(f.maxUses)) (:21484), NaN serialises to JSON null, and validatePromo treats null as no limit (src/lib/promos.ts:349-356) — the panel then says «использован 0» with no «из N». minSubtotal falls the same way to 0 via `|| 0` (:21482).  
_Fix (small):_ Parse both fields defensively in promoFormPayload and send the raw string, letting validatePromo refuse it with bad_uses/bad_min.

**Code that stops qualifying between «Применить» and «Оплатить» is dropped silently**  
The browser caches only {code,kind,value,minSubtotal} (app.js:11235) and recomputes the discount locally forever (:7947-7955); createOrder re-quotes and codeDiscount returns 0 on a failed quote (orders.ts:444) with no error, and the submit path never reads the server's total back — it goes straight to /api/payments/create and redirects (app.js:14051-14101). The customer first sees the higher amount on Montonio's page.  
_Fix (medium):_ Return the server's total/discount from POST /api/orders and, when it differs from the shown total, stop and re-render the summary instead of redirecting.

### pwa

**Scanner «Приход»/«Списание» and the «Склад» row save have no rejection path — buttons stick disabled**  
stockMoveSend (app.js:26329-26336) returns a promise that rejects when apiJson rejects (failed fetch, or non-JSON → throw "no-api"); scanCommitMove (25349) attaches only a fulfilment handler so S.scanBusy stays true forever, and the «Склад» save's Promise.all (app.js:26452-26456) has no .catch, leaving the button disabled on «Сохраняем…».  
_Fix (small):_ Add rejection handlers to both callers: clear the busy flag, re-render and toast «Не удалось сохранить».

**notifySend shows the green «Записали ✓» for a stock alert that was never sent**  
app.js:13386 — on res.offline it closes the form and toasts the byte-identical success message used at 13393, so a failed POST /api/stock-alerts/ is indistinguishable from a subscription. Nobody is subscribed and the customer is never told.  
_Fix (one-line):_ Route the offline branch to the same «Не получилось — попробуйте ещё раз» toast as the catch, keeping the form open.

**A failed parcel-point request substitutes invented demo point ids that go into real orders**  
loadPointsFor (app.js:6902-6908) falls back to demoPoints() on any non-200 or network error, minting ids like `omniva-demo-0` from the committed August machine list, caches them in POINTS.by so the live list is never re-asked, and src/lib/orders.ts:1221 stores pointId as free text with no validation against the carrier feed.  
_Fix (small):_ On a failed points fetch show an error and let the shopper retry instead of substituting the committed stand-in list on the live checkout.

### reviews

**Failed moderation PATCH is silent — toast still says «Отзыв опубликован»**  
moderateReview() mutates the list and raises the green toast before srvPush fires (app.js:11297-11319); apiJson throws on any non-JSON answer (app.js:26842), so a 504 HTML page or a dropped connection lands in the .catch at app.js:27152, which raises no toast and no rollback. The refetch it does call cannot correct anything either — loadAdminReviews keeps the existing list when it fails (app.js:11260).  
_Fix (small):_ In the moderate_review .catch, toast «Не получилось сохранить отзыв» and roll the local change back (admReviewApplyLocal with the previous status), as the non-200 branch already does.

**Tapping the stars last leaves «Отправить отзыв» disabled forever**  
The button is rendered disabled unless reviewReady() (app.js:10995) and its disabled flag is recomputed in exactly one place — the [data-revf] input branch (app.js:33036). The star handler at app.js:32702-32709 patches aria-checked and the «N из 5» label and returns with no render() and no button update, so a rating chosen after every other field leaves the button grey.  
_Fix (one-line):_ In the d.revstar branch, also set `[data-revsend]`.disabled = !reviewReady() (or call render()).

### settings

**Refused delivery-price save is shown as saved and left live in the panel**  
app.js:31890 runs demoApply(pa) (which at 28313 replaces SHIP_RULES and nulls S.shipDraft) and toasts «Тарифы доставки сохранены», and 31920-31922 sets S.admSetSaved, all before the PUT resolves; srvSaved's below_cost branch (app.js:~27008) only toasts the server's sentence and never restores the old table or the dirty bar.  
_Fix (medium):_ Apply the new rules only after a 200, and on a refusal restore the previous SHIP_RULES/draft and clear the «Сохранено ✓» state.

**«О компании» save writes the browser's whole document, wiping fields a failed load never learned**  
The confirm card shows a patch, but srvPush sends { content: DEMO.content } in full (app.js:27127) after DEMO.content = contentApply(contentConf(), patch) (28348-28352); contentConf() falls back to CONTENT_DEFAULT, whose iban/bankName are "". If /api/overrides failed once (adoptServer is the only place DEMO.content is filled, app.js:26965, and refreshFeeds skips the admin screen), one phone-number edit stores the defaults over the shop's real IBAN, address and social links.  
_Fix (medium):_ Send only the patch (the route can merge through mergeContent), or refuse to save the content document until a successful /api/overrides read has landed.

**Emptied «Бесплатно от» still promises free delivery in the strip, footer and product pages**  
refreshShipThresholds (app.js:6210-6218) only assigns THRESH when the resolved value is a finite number, so an explicit null (setShipDraftField 21316-21335) leaves the old figure in place, while threshold() (7714-7727) returns Infinity and the checkout charges. The announce bar (10145-10164), the footer (10400) and the product page keep quoting THRESH.  
_Fix (small):_ Let THRESH carry null and have the announce/footer/product lines drop the free-delivery sentence for that country.

**A failed GET /api/admin/settings draws built-in defaults as the shop's settings, and a save persists them**  
loadAdminPricing (app.js:20861-20894) sets S.pricingLoaded = normalisePricing(null) on a non-200 or a throw, leaves S.deliveryLoaded/S.banksLoaded unset, shows no error, and every call site passes force=false (19281, 19334, 21081, 24359) so it never retries. pricingDraft() clones that, and saving PUTs the defaults — partnersOn off, 20 % salon discount — over the real ones.  
_Fix (medium):_ Keep the card in an error state with a «Повторить» on a failed read instead of substituting PRICING_DEFAULT, and block the save until a real read has landed.

### shipping

**Label creation has no lock or idempotency key: a timed-out press books a second parcel**  
src/app/api/admin/shipments/route.ts reads the order, sees no shipment, calls Montonio at ~:95 and only writes the row at :112; there is no row lock and montonio.ts posts /shipments with merchantReference only. A request killed between the two leaves a booked, paid-for parcel with no record, so the next press books another.  
_Fix (medium):_ Send an idempotency key (or pre-claim the shipment slot on the order row with a conditional update) before calling Montonio.

### stock

**Un-cancelling a paid order returns stock but never takes it back off the shelf**  
setOrderStatus (orders.ts:1530-1553) posts a 'return' move on paid→cancelled/refunded, and nothing anywhere decrements on cancelled→paid — the only decrement is decrementStock() inside applyPaymentResult(), which runs once at the payment transition. Each cancel/uncancel cycle inflates the shelf by the order's quantities.  
_Fix (small):_ In setOrderStatus, when the new status is paid/shipped/delivered and the previous status was cancelled/refunded, post the mirror 'sale_web' (or 'adjust') moves for the tracked lines.

**Checkout only gates stock per product, so a size at zero can still be bought and paid for**  
priceItems uses one state per product id (orders.ts:927-928) and productStockStates aggregates variants as «out only if EVERY tracked variant is out» (inventory.ts:564), so a zeroed size in a product with any other size in stock passes. The sale move is then clamped to 0 and only a console line records it.  
_Fix (medium):_ Return per-variant states from inventory and refuse the line when the ordered (product, variant) is tracked and out.

**Nightly back-in-stock sweep reads the manual override, not the numeric stock the page shows**  
sweepBackInStock decides with `overrides.get(a.product_id) ?? p.stock` (flows.ts:551-554) — product_overrides.stock or the catalogue file — while the storefront state comes from the derived numeric stock (orders.ts:531-541). A product at numeric 0 whose override/file says «in» mails «снова в наличии» to every waiting customer and marks the alert spent.  
_Fix (small):_ Make sweepBackInStock ask productStockStates() first and fall back to the override only for products with no tracked variant.

**Sizes the owner adds or renames in the editor are invisible to «Склад» but still drive the badge**  
getLevels builds its universe from catalogue.variants.json plus custom products only (inventory.ts:664, 589-600) — product_overrides.sizes is never consulted — while productStockStates counts every tracked stock_levels row. A renamed or added size leaves an orphan row that keeps the product reading «в наличии» and can never be seen or corrected on «Склад».  
_Fix (medium):_ Build the inventory universe from the same ladder the editor and orders use (overrideLadder → custom variants → VARIANTS), and surface rows outside it as orphans.

### storefront

**«Сообщить о наличии» says «Записали ✓» when the request never reached the server**  
notifySend at app.js:13386 treats postJSON's offline value as success — closes the form, toasts «Записали — сообщим, когда появится ✓» and latches apiSeen(false) — and per finding 1 that value also covers a dropped connection and any edge error page. No stock_alerts row is written.  
_Fix (one-line):_ Show the failure toast on `offline` unless it is a genuine 404/405/501.

**Product page and footer keep promising «бесплатно от 59 €» after free shipping is switched off**  
refreshShipThresholds only writes back a finite number (app.js:6211-6217), so when the owner clears «Бесплатно от» (stored as null, admin :21326-21331, accepted at :6656) THRESH keeps the seeded 59. THRESH.EE is printed on the product page (:9294, :10810) and in the footer (:10400) while threshold() (:7714) correctly returns Infinity and the checkout bills delivery.  
_Fix (small):_ Give refreshShipThresholds an else branch that sets the country to null, and hide the marketing line when there is no floor.

**A cart saved before a size was deleted becomes unorderable with an unactionable error**  
Display clamps the stale index (sizePrice :7672, lineLabelParts :30645) so the cart looks healthy, but lineVariant (:13803) posts the raw l.size; variantOf (orders.ts:697-700) finds no such index or label, v.price is null and createOrder throws bad_variant (:952) — a code ORDER_ERRS does not list, so orderErrText (:13930) shows the generic «Не получилось оформить заказ — попробуйте ещё раз» forever.  
_Fix (small):_ Clamp or drop the stale index in the localStorage cart restore (and in lineVariant), and add bad_variant to ORDER_ERRS.

## MEDIUM — 120

### analytics

**«Из корзины в заказ» divides all paid orders (POS included) by consent-only sessions**  
conversion = ordersSummary.orders / funnel.sessions (analytics.ts:440); qOrdersSummary has no channel filter so salon orders count, while sessions are distinct sids on 'view' events and track() returns immediately without analytics consent (app.js:8141-8144). The ratio can read far above the truth and above 100 %.  
_Fix (small):_ Count only web-channel orders in the numerator and cap/label the figure as «по согласившимся посетителям».

**«Выручка по дням» skips days with no sale and still labels the last bar «сегодня»**  
qRevenueByDay groups by Tallinn day so only days with an order return a row (analytics.ts:203-212); admBarsHTML takes rows.slice(-14) and gives the last bar adm-wbar--now under the lead «самый правый — сегодня» (app.js:18447-18456, 18515). The «Обзор» strip does the 7-slot gap fill that this chart does not.  
_Fix (small):_ Fill missing days with zero rows before rendering, as the «Обзор» sparkline already does.

**«Топ товаров»/«Бренды» sum raw line subtotals; bundle and gift lines land raw**  
qTopProductsByRevenue and qBrandRevenue sum (item->>'sum') (analytics.ts:214-234), which is price×qty before order-level discount, loyalty and gift-card settlement, and excludes shipping; the brand query also drops items with an empty brand, so bundles and gift cards vanish from «Бренды» while appearing raw in «Топ товаров».  
_Fix (medium):_ Pro-rate order-level discounts onto lines, and label these blocks as goods value rather than money received.

**«Путь до покупки» promises the steps always decrease; the query cannot**  
qFunnel counts five independent count(distinct sid) filters over different event types with no subset relation (analytics.ts:236-258), while the screen's own lead says «Числа всегда убывают» (app.js:18540). Adding to cart from a catalogue card without opening a product page produces add_to_cart > product.  
_Fix (medium):_ Either compute each stage as a subset of the previous one, or drop the sentence promising the numbers always fall.

**CSV writes money with a period decimal into a ';' file aimed at et/ru Excel**  
csvCell formats numbers as v.toFixed(2) (reports.ts:340) while the delimiter and BOM are deliberately chosen for Estonian/Russian Excel (reports.ts:347-353), where the decimal separator is a comma; values like 31.05 are read as dates and others as text.  
_Fix (one-line):_ Use a comma decimal separator in csvCell when the delimiter is ';'.

**«Брошенные корзины» counts live baskets and excludes abandoned payments**  
qAbandonedCarts counts carts with updated_at in range and recovered_at null with no quiet period (analytics.ts:348-354), and createOrder calls markCartRecovered() before the shopper is sent to the bank (orders.ts:1385-1391, customers.ts:770-775), so a cart just saved counts while a genuinely abandoned payment does not.  
_Fix (small):_ Require updated_at older than, say, an hour, and clear recovered_at only when the order reaches paid.

**Past-month exports are recomputed at today's VAT rate**  
The route reads settings.vat_rate per request and passes it to listReportOrders for any month (reports/orders/route.ts:60-62); toReportRow stamps that rate onto every row, so after a rate change a re-export of an old month disagrees with what was filed.  
_Fix (medium):_ Store the rate on the order at creation, or keep an effective-date table and pick the rate by order date.

### assistant

**set_content/set_hero write back a boot-time snapshot the admin screen never refreshes**  
loadServerOverrides runs only at boot (27679) and from refreshFeeds, which returns early on the admin screen (27701); refreshAdmin reloads overview/orders/analytics/reviews only. srvPush then PUTs the whole `DEMO.content` / `DEMO.hero` (27127, 27120), so a long-lived admin tab silently reverts changes made from another device.  
_Fix (small):_ Refresh the overrides feed in refreshAdmin (it touches no form draft), or re-read hero/content before a whole-document PUT.

**Assistant stock moves are not journalled, but the prompt promises «отменить можно в журнале»**  
applyStockAction (app.js:12520-12529) POSTs to /api/admin/inventory/moves/ and toasts — no demoApply, no journal entry, no undo — while the admin prompt (route.ts:377) states as fact that every confirmed action lands in the journal where «Вернуть» takes it back. The panel's own stock moves do journal.  
_Fix (small):_ Either journal the assistant's stock move like the panel's own, or carve stock (and blog) out of the prompt's blanket undo promise.

**A stock move whose response is lost leaves no card and no way to tell if it landed; retry double-counts**  
The apply handler nulls pendingAction before any write (app.js:31811-31812), and applyStockAction's catch only toasts «попробуйте ещё раз»; POST /api/admin/inventory/moves/ applies a bare relative `delta` with no idempotency key or dedup (route.ts:83-99), so a repeat after a lost response is applied twice.  
_Fix (medium):_ Accept a client-generated move id and ignore a repeat, and keep the card until the write is acknowledged.

**One failed capability probe downgrades the assistant to canned answers for the page's life**  
chat.js:49-56 sets `aiEnabled = false` before the fetch with an empty catch, and the re-entry guard is `aiEnabled !== null`, so it never probes again; reply() then routes every message to rulesReply (308) and refreshHint only ever upgrades the hint. probeAdmAI (app.js:28518-28523) has the same shape via admAIAsked.  
_Fix (one-line):_ Reset the flag back to null in the catch so the next open/send re-probes.

**No in-flight guard: a second send can swap the confirm card under the owner's finger**  
askAdminAI (app.js:28570-28613) has no busy flag and no AbortController, and the chip (32598), send button (32599-32614) and Enter path all call it unconditionally; two sends of the same text both pass `S.adminAsk !== q`, so both set pendingAction and repaint the card in place.  
_Fix (small):_ Ignore a send while a request for the same question is in flight, and abort the previous one otherwise.

**`debug:"mini"` in the body gives any anonymous caller an unrestricted model on the shop's key**  
isMini is read straight off the request body with no gate (route.ts:557) and selects a system prompt with no topic restriction and no catalogue (607-609); the admin cookie check applies only to mode:"admin" (518-526) and the origin check runs only when an Origin header is present (484-497). Only the 10-req/min-per-IP limiter and 400 max tokens bound it.  
_Fix (one-line):_ Gate isMini behind the admin cookie or a dev-only env flag.

**set_content confirm card shows only block names for hours/social/contact/footer/legal, and bad hours wipe the day**  
contentActionText prints the block word alone for those five keys (app.js:28095-28097), so the owner confirms values he cannot see; sanitizeHours returns "" for anything it cannot parse (content.ts:231-238) and mergeContent writes that "" over the stored day (405). sanitizeContentPatch also accepts legal.* although the prompt never offers legal texts.  
_Fix (medium):_ Print the actual values in the card, and either reject an unparseable hours patch or leave the day untouched.

### auth

**Admin login lockout is a per-process Map, so it barely throttles anything on Vercel**  
rateLimit() is a module-scope Map (auth.ts:170-184); each lambda instance and each cold start has its own, so parallel connections each get a fresh 5/minute budget while the route header and the panel both present the limit as enforced. Only scrypt's ~100 ms per try actually slows a password guesser.  
_Fix (medium):_ Move the login counter to a shared store (Postgres row or Upstash) or add an escalating server-side delay keyed on the account.

**Blog admin section has no 401 branch: expired session shows no articles and cannot save**  
loadAdminBlog (app.js:11389) turns any non-200 into an empty list without clearing SRV.admin, and saveBlogFields/saveBlogDraft have no 401 path — they throw save_failed and show «Не получилось сохранить — попробуйте ещё раз.» forever. Every other loader does `if (r.status === 401) { SRV.admin = false; render(); }`.  
_Fix (small):_ Add the same 401 branch to loadAdminBlog and to the blog save/publish paths so the login card comes back with the draft still in state.

**A SESSION_SECRET under 16 chars passes the configured check, then breaks sign-in with a network error**  
secret() requires 16+ chars, but /api/admin/login only tests presence and then calls adminCookie(req) → makeSessionToken(), which throws after the password already verified; /api/admin/me still reports configured: true. The panel shows a server-not-responding message with nothing pointing at the secret.  
_Fix (small):_ Apply the same length rule in the route's not_configured gate and in /api/admin/me's `configured` flag.

**A correct login code is deleted before the cookie is minted, so a DB blip burns it**  
checkLoginCode deletes the row on success (customers.ts:291), then the route awaits recordLogin, listCustomerOrders and accountLoyaltySummary before makeCustomerToken; any failure in those returns 503 with no cookie and the code already gone, and the shopper is then told «Код не найден».  
_Fix (small):_ Mint the token and Set-Cookie right after the verdict, and let the profile/orders/loyalty fetch fail softly.

### blog

**Text typed during a save is marked saved and then silently dropped**  
saveBlogFields builds the payload at t=0 but calls blogMarkSaved(d) in the response handler (app.js:12382-12390), and blogSync keeps writing keystrokes into the same draft with no busy check, so the signature recorded as «saved» includes text that was never sent and blogDirty() then answers false.  
_Fix (small):_ Snapshot blogDraftSig(d) at send time and pass that snapshot to blogMarkSaved.

**Server-rendered article keeps the price baked in at insert time**  
The price is literal text in posts.body and renderPostBody() only sanitises (src/lib/blog.ts:507-510); only the SPA re-prices the card, so Google, the first paint and any API reader see the price as of the day the card was inserted.  
_Fix (medium):_ Store the marker without price text and render the price from the catalogue on both the client and blog-page.ts.

**«Товары из статьи» prints a flat price for the 57 products sold from a price**  
shelfProducts() hard-codes priceFrom: false (src/lib/blog-page.ts:266) while the renderer honours it; 57 of 220 catalogue products have several size prices (e.g. 9/16/25) and catalogue.min carries only the cheapest, so a crawler and a no-JS reader see «9 €» where the SPA says «от 9 €».  
_Fix (small):_ Set priceFrom from catalogue.variants.json the same way the custom branch does.

**Request-time «Товары из статьи» ignores product_overrides — old prices, hidden products listed**  
shelfProducts() resolves ids only against the static catalogue.min import (src/lib/blog-page.ts:57, 264-267) and never reads product_overrides, whose row carries both price and hidden (src/lib/orders.ts:174-189), so a repriced product shows its build-time price and a hidden one is still listed and linked.  
_Fix (medium):_ Fetch getOverrides() for the shelf ids and apply price and hidden, as product-page.ts does.

**Address box keeps following the title after the first save, but the slug no longer changes**  
slugAuto is never cleared after the first save (saveBlogFields sets id/slug/status only, app.js:12386-12388), so the title handler keeps rewriting d.slug and the visible box while blogFieldsPayload still sends slug: undefined and upsertPost deliberately keeps the row's existing slug (blog.ts:691-698) — the owner is shown an address the article does not have.  
_Fix (one-line):_ Clear d.slugAuto (or re-fill the box from p.slug) once the post has an id.

### bundles

**Deleting a seeded set wedges carts that hold it — checkout fails and the line never prunes**  
loadBundles() carries the set over from the static public/shop/bundles.js as inactive (app.js:9138-9141), so the prune at 9147 finds it and keeps the line, but the server has no row and throws bundle_unknown, which is not in ORDER_ERRS — the shopper only sees «попробуйте ещё раз».  
_Fix (small):_ Prune against the fresh list rather than the repopulated S.bundles, or drop the line when the server answers bundle_unknown.

**price_too_high is a write-time check only; a drifted set shows «−0 %» over a lower crossed-out sum**  
validateBundle() gates effective >= sum only on save (bundles.ts:410-414), while expand() recomputes sum from the live catalogue on every read and clamps save and pct to 0 (228-245); the card still prints price beside <s>sum</s> unconditionally (app.js:9183).  
_Fix (small):_ Hide the crossed-out sum and the badge when save <= 0, and flag such sets in the admin list.

**bundles.ts prices parts from the static variants file, ignoring the owner's saved size ladder**  
bundles.ts variantOf() reads only src/data/catalogue.variants.json and takes no ladder argument, while orders.ts prices a product line through overrideLadder(o); a rung the owner edited moves the product page but not the set's sum, «было» or the price_too_high gate.  
_Fix (medium):_ Pass overrideLadder(overrides[id]) into bundles.ts variantOf() in both expand() and validateBundle().

**Item quantities inside a set are never shown to the shopper**  
expand() multiplies by qty when summing, but the set page (app.js:9274-9289), the cart parts note (10009-10016) and the prerendered list print name · size · unit price with no count, so a ×2 item makes the crossed-out sum not add up.  
_Fix (small):_ Print « ×N » beside the part wherever qty > 1, as the admin editor already does.

**Hiding an admin-built set silently drops it from shoppers' carts**  
The carry-over at app.js:9138 looks the set up with bundleById(), which on a fresh load resolves against the static public/shop/bundles.js only — a set Renat created is not there, so it is not kept and the prune at 9147 deletes the cart line and persists.  
_Fix (small):_ Store the set's price and title on the cart line for fallback, or have /api/bundles/ also return sets the cart references.

**When /api/bundles/ fails, an admin-built set in the cart shows as «Набор», no photo, 0,00 €**  
loadBundles() returns early on a non-200 (app.js:9118), leaving S.bundles null so allBundlesRaw() falls back to the static file; a set not in that file makes lineUnit() return 0 and lineTitle() the bare kind word, so the cart total and free-shipping bar are wrong.  
_Fix (small):_ Use the price and title already stored on the cart line when the set cannot be resolved, instead of 0.

**Set editor offers the owner's own products, then the server rejects them as unknown_product**  
rebuildCatalogue() pushes active custom rows into CATALOGUE and the picker searches it via heroFind(), but validateBundle() resolves each item against BY_ID built from src/data/catalogue.min.json only (bundles.ts:115-116, 366-368), so a custom product fails the save.  
_Fix (medium):_ Load custom_products into the server-side lookup used by validateBundle()/expand(), or exclude custom rows from the set picker.

### customers

**Manual points adjustment has no idempotency; the retry double-credits**  
adjustLoyaltyPoints (loyalty.ts:369-384) is a bare insert with no order_id or request key, and the two partial unique indexes cover only earn/redeem rows that have an order_id. adjustCustomerPoints in app.js clears S.admCustBusy in the .catch and toasts «Сервер не отвечает», so a timed-out but committed write invites a second identical +N.  
_Fix (small):_ Send a client-generated request id with the adjust and dedupe on it in the ledger.

**«Одобрить Pro» claims the partner letter was sent without checking**  
approveCustomer (app.js:22787) passes the fixed string «Партнёр одобрен · письмо ушло» and admCustPatch toasts it on any 200/ok, never reading r.body.mail, while sendPartnerWelcome is best-effort and returns sent:false on a Resend failure. (The «+ Партнёр» path does check mail.sent; the tier switch's toast makes no letter claim, though its confirm dialog promises one.)  
_Fix (small):_ Have admCustPatch pick the toast from r.body.mail.sent, as applyAddPartner already does.

**Quoted points are not reserved: two unpaid orders can spend one balance**  
createOrder bakes the euro discount into the total (orders.ts:1319-1361) but writes nothing to the ledger; redeemLoyaltyPoints only runs on the paid transition and takes min(want, balance), so the second order to be paid keeps its discount with nothing taken — logged as loyalty_redeem_failed but never charged. The shop funds the difference.  
_Fix (medium):_ Either write a pending redeem line at checkout or re-quote the discount at the paid transition.

**Customer XLSX/CSV export silently stops at the newest 200 rows**  
The download hrefs (app.js:22636-22637) carry only ?format=, the route passes limit undefined, and listCustomersAdmin defaults to 200 ordered created_at desc (loyalty.ts:694-698) while the screen is fetched with limit=500. Latent until the shop passes 200 customers, then the file quietly drops the oldest.  
_Fix (one-line):_ Add &limit=1000 (and the active q/tier) to both export hrefs.

### giftcards

**A mint interrupted half-way can never be finished — the retry returns the partial set**  
issueGiftCards inserts one row per card with no transaction (giftcards.ts:264-291) while the retry path short-circuits on the first existing row (giftcards.ts:262). A process killed mid-loop leaves a paid order permanently short of cards, and the retry hook reports success.  
_Fix (medium):_ Mint inside withTx (src/lib/db.ts:255), or count expected vs existing cards before the early return.

**The partial-refund ceiling subtracts the gift lines' undiscounted face value**  
goodsPart = value − giftSoldValue (refund/route.ts:142), where value is what the customer actually gave (net of discounts, settle.ts:142-145) but giftSoldValue sums the raw gift line sums (refund/route.ts:87-89). With any order-wide discount the ceiling is short by the discount on the gift lines and the panel refuses refunds the owner owes.  
_Fix (small):_ Scale giftSoldValue by the order's discount ratio (or compute goodsPart from the discounted non-gift lines).

**The gift_card_uses row a refund depends on is written best-effort, after the money moved**  
redeemGiftCard debits the balance in one statement and inserts the ledger row in a second, swallowing failure to console.error (giftcards.ts:433-456). That row is not audit-only: refundValue (settle.ts:142-146) and giftPaidByOrders (giftcards.ts:488-511) are the only source of what a card paid, so a lost insert understates the refund and strands the customer's money.  
_Fix (small):_ Write the debit and the ledger row in one transaction (withTx).

### i18n

**Translate button says «Черновик готов» when only one of three requests succeeded**  
app.js:32849-32863 sets ok = true as soon as any one target string of any one field lands, and the toast is chosen on that flag; a 502 or rate_limit on the body call still yields the success toast with a Russian body left in place.  
_Fix (small):_ Track per-field success and report «часть не перевелась» when any job failed.

**EN chip "Gift under €50" ignores the cap and returns the most expensive perfumes**  
chat.js:121 requires digits straight after the keyword, so "under €50" gives cap = null; the gift branch (chat.js:145-150) then drops the price filter and sorts descending, showing the four dearest gift items. Fallback path only (AI off or /api/assistant failing), desktop only.  
_Fix (one-line):_ Allow an optional currency sign in the money() regex: /(?:до|kuni|under|alla)\s*€?\s*(\d+)/i.

**Language switch mid-question: stale answer lands in the new language's panel and its action runs**  
paintPanel clears log and convo on a real language change (chat.js:378) but the in-flight POST (chat.js:313-332) is not aborted and carries no language stamp, so it bubbles the old-language reply into the reset panel and calls runAction(j.action).  
_Fix (small):_ Stamp each request with lang() and drop the response (and its action) if lang() changed.

**One failed fetch leaves the «Письма» text editor a permanent skeleton**  
loadMailTexts (app.js:20084-20090) sets mailTextsAsked before the request and never clears it on failure; the only call site is loadMailTexts(false) at app.js:17244, so MAIL_TEXTS stays null for the life of the page with no retry and no error message.  
_Fix (one-line):_ Clear mailTextsAsked in the catch (and on a non-ok response) so the next render retries.

### invoices

**Dunning writes the whole invoice blob from a stale snapshot and can erase paidAt**  
saveInvoiceRecord is an unconditional full-blob replace (invoices.ts:287-289); the batch is read once (invoice-dunning.ts:249) and sendReminder stamps `{...invoice, remindedAt}` from that snapshot (:114-115), so a «Отметить оплаченным» landing mid-walk is overwritten with paidAt:null and the company is nagged. The cancel path re-reads, so only the reminder is exposed, and the window is seconds wide on a handful of orders.  
_Fix (small):_ Re-read the order in sendReminder (as cancelOrder does) and write remindedAt onto the fresh record, or update only that key in SQL.

**Invoice PDF and accountant export can differ by a cent on multi-line orders**  
invoiceLines sums per-line rounded net/vat (invoices.ts:444-446) while the export backs VAT out of the whole total in one step (reports.ts:48-53, :223); two 10,00 € lines at 22% give 16,40/3,60 on the PDF and 16,39/3,61 in the export. The file header at invoices.ts:30-33 asserts the two never disagree.  
_Fix (small):_ Compute the export row's net/vat with the same per-line rule (or foot the invoice totals off the order total) and correct the header comment.

**Export restates historical invoices at today's VAT rate**  
The route resolves one live settings.vat_rate and hands it to every row (reports/orders/route.ts:60-62, reports.ts:223), while each InvoiceRecord freezes vatRate at issue precisely so an old invoice is not reprinted differently (invoices.ts:228) and the PDF honours it. After a rate change every past-month export disagrees with the invoices already in customers' hands.  
_Fix (small):_ Use the order's own invoice.vatRate when present (falling back to the live rate) in toReportRow.

**«Счёт на оплату» letter omits the redeemed-points line, so its figures do not add up**  
renderInvoice builds its summary from totalsOf() (invoice.ts:154-155), which never reads order.loyaltyDiscount (common.ts:331-345), and totalRows emits only Скидка/Доставка/Итого (common.ts:354-390) while Итого is order.total with the points already subtracted — so on an order with points redeemed the listed rows do not foot to the total shown. The attached PDF does carry the points line (invoices.ts:440-443).  
_Fix (small):_ Pass the invoice's own line model (or order.loyaltyDiscount) into the letter's summary so a «Баллы» row is printed.

**«Отметить оплаченным» reports «письмо ушло» without checking that it did**  
markInvoicePaid awaits the notify hook and discards its result (invoices.ts:647-653); notifyOrderPaid returns true merely because the hook resolved (mail-hook.ts:17-38); the route's response carries no send status (route.ts:98-103) and app.js:27412 toasts «оплачен по счёту · письмо ушло» unconditionally.  
_Fix (small):_ Propagate onOrderPaid's {ok, skipped} through notifyOrderPaid and markInvoicePaid into the route response, and word the toast from it.

### letters

**Unpaid-order cancel overwrites a payment that lands mid-loop**  
runUnpaidOrders selects up to 100 stale orders once (flows.ts:1045) and calls setOrderStatus on each without re-reading; setOrderStatus writes `update orders set status = $2 where id = $1` (orders.ts:1506) with no expected-status guard, so a payment arriving during the walk is overwritten with 'cancelled' and the stock decrement is not returned. Narrow race but real; invoice-dunning already re-reads.  
_Fix (small):_ Re-read the order inside the loop and add `and status in ('new','failed')` to the cancel write.

**Back-in-stock letter quotes the catalogue file price, not the owner's**  
productsForAlerts takes `price: p.p` from BY_ID (customers.ts:851) and the sweep selects only `product_id, stock` from product_overrides (flows.ts:536), so the letter's price ignores product_overrides.price and contradicts the product page it links to. The finding's «цена актуальна на момент отправки» line does not exist in the template — the price is simply wrong.  
_Fix (small):_ Select price alongside stock in the sweep and let the override price win in productsForAlerts.

**Switching the unpaid flow on cancels the whole historic backlog in one pass**  
The reminder query is a closed band (flows.ts:1007-1008) but the cancel query has only `created_at <= cancelBefore` (:1052) and no reminder precondition, so on the first run after the switch goes on every old unpaid order is cancelled with no reminder ever sent — 100 per pass.  
_Fix (small):_ Require `payment->>'unpaidRemindedAt' is not null` on the cancel query (and optionally a floor date at the moment the flow was enabled).

**Unsubscribe happens on a plain GET, so a link scanner opts the customer out**  
GET /api/mail/unsubscribe verifies the token and calls optOut immediately (route.ts:162-170); the same URL is a plain <a href> in the letters, so Safe Links / prefetchers trigger the write, which also deletes pending stock_alerts for a backstock link (consent.ts:153).  
_Fix (small):_ Make GET render a confirm button that POSTs; keep the RFC 8058 one-click POST as is.

**«Сообщить о наличии» says «Записали ✓» when the request never reached the server**  
postJSON returns {offline:true} for a rejected fetch as well as for 404/405/501 (app.js:13908-13911), and notifySend treats offline as success with the green toast (app.js:13385-13387). A dropped connection shows a confirmation for a signup that was never stored.  
_Fix (one-line):_ Distinguish a rejected fetch from a 404/405/501 in postJSON and show the error toast for the former.

**Birthday code expires mid-morning on the day the letter calls «включительно»**  
ends_at is an instant `now + N days` (flows.ts:638) written at cron time, promos reject when `endsAt <= now` (promos.ts:155), and the letter prints only the calendar date with «до … включительно» (birthday.ts validUntil). The code dies partway through its last advertised day.  
_Fix (small):_ Round endsAt up to the end of that calendar day in Tallinn time before writing the promo.

**Admin birthday preview says 15 %, the shop sends 10 %**  
emails/index.ts:341 and :395 hard-code percent 15 for the preview while the live letter uses settings.flows.birthdayPercent, default 10 (flows.ts:102, :832). The owner sees a discount he is not giving, and his own chosen percent never appears in the preview.  
_Fix (one-line):_ Pass the stored flows.birthdayPercent into the preview renderer instead of the literal 15.

**«Отписаться» promises no more mailings, then back-in-stock letters keep coming**  
optOut only clears pending stock_alerts for kind 'backstock' (consent.ts:153) and sendStockAlerts never reads mail_optouts (flows.ts:559-596), while the unsubscribe page says «Рассылок на адрес … больше не будет». The code's intent is deliberate, but the page's promise is untrue.  
_Fix (small):_ Either check the stop list in sendStockAlerts or reword the done page to say waiting-list notices still arrive.

**Back-in-stock letter from the stock switch renders with whatever texts the process holds**  
runBackInStock (flows.ts:513-518), the path upsertOverride calls (orders.ts:607), never calls loadTexts(), while the sweep does (:528); the template does read the owner's override via mailText (back-in-stock.ts:114-149) from the process-global OVERRIDE (texts.ts:417). The owner's saved subject/intro are usually silently ignored on the primary path.  
_Fix (one-line):_ Add `await loadTexts()` at the top of runBackInStock.

### orders

**Admin order card's «Итого» does not match the lines above it — discount and points never drawn**  
The «Состав» block prints item lines plus one delivery line and then «Итого» = v.sum = o.total (app.js:15785, 27282), but the stored total is subtotal + shipping − discount − loyaltyDiscount (orders.ts:1337); no discount, promo code or points line is rendered anywhere on the card (admPaymentHTML shows only payment state and refunds).  
_Fix (small):_ Draw «Скидка», the code label and «Баллы» rows from the mapped order fields before «Итого».

**Auto-close after N days counts from updated_at, which any later write resets**  
closeDeliveredOrders compares the cutoff against row.updated_at (delivery.ts:197-199), and setOrderNote, setOrderPayment and saveShipmentOnOrder all set updated_at = now(); the shipping webhook calls saveShipmentOnOrder on every status event (shipping/notify:124), restarting the clock.  
_Fix (medium):_ Stamp a shippedAt into orders.shipping on the move to 'shipped' and measure the clock from that.

**«Создать этикетку» can book and pay for a second parcel when the row write fails**  
The route calls createMontonioShipment first and saveShipmentOnOrder second, and its only idempotency is reading shipping.montonio.shipmentId; on a save failure it returns store_failed with the shipment, so a second press finds no stored shipment and books another parcel.  
_Fix (medium):_ Reserve the shipment row before the carrier call (or retry the save and surface the tracking code as a blocking banner that disables the button).

**A refund reported through both Montonio doors is recorded twice, and the clamp is bypassed**  
The order-token REFUNDED branch records order.total under `montonio-order:<ref>` with no clamp (notify/route.ts:107-119), while the refund webhook records the same money under Montonio's refund id; foldRefund dedupes on ref only, and the refund door's clamp is undone by `amount > 0 ? amount : note.amount` (notify/route.ts:175), which falls back to the unclamped figure exactly when the clamp reduced it to 0.  
_Fix (small):_ Clamp both branches and skip recording when refundableAmount is already 0 instead of falling back to note.amount.

### payments

**Zero-total order charges the gift card before the order is safe**  
takeCoverage redeems the card first (settle.ts:229-231), then setOrderPayment and settlePayment run (:261-262); a throw between them becomes a 503 (create/route.ts:118-123) with the card already debited, and redeemGiftCard (giftcards.ts:423-458) has no per-order idempotency, so a retry debits it again.  
_Fix (medium):_ Make redeemGiftCard a no-op when a redeem row for (code, orderId) exists, and audit the 503 path.

**A cancelled order comes back as «не оплачен» and gets dunning letters**  
apply.ts:538-541 tests only `order.status !== "failed"`, so a late ABANDONED token (montonio.ts:104-108) flips a cancelled order to `failed`, and the unpaid cron selects status in ('new','failed') (flows.ts:946) and writes «Заказ ждёт оплаты» to a customer already told it was cancelled.  
_Fix (one-line):_ Skip the failed transition for `cancelled`/`refunded` orders and keep the token in payment.rejected.

**Gift-card half of a refund refused after the money left, and nobody is told**  
The provider refund is sent and recorded (refund/route.ts:185-223) before creditGiftCard (:231); a refusal returns 409 gift_credit_failed (:234) and skips notifyOrderClosed (:254-264). The panel string (app.js:27441) names only the card, and the customer is never told about the money that did go back — the ledger entry does exist on the order card.  
_Fix (small):_ Send the customer letter for the money part anyway and name the already-refunded amount in the panel message.

### pos

**Selling more than the shelf holds is accepted; the ledger records the clamped amount and the screen says «остатки списаны»**  
priceItems() refuses only stock === "out" (orders.ts:921-925), never the counted qty, and applyMove clamps delta to −qtyBefore and writes the clamped value into stock_moves (inventory.ts:350-367); move() only console.errors it. The sale succeeds and the receipt claims the stock was written off.  
_Fix (medium):_ Return the clamped/skipped lines from decrementPosStock and have the register say what was actually written off.

**The scanner adds to the basket with no stock check at all, not even the zero check the chips have**  
posAddProduct refuses only when the shelf row is tracked and qty <= 0 and never compares against what is already in the basket (app.js ~26100-26103); scanToCart (app.js ~25069-25082) pushes h.productId with the stepper quantity and checks nothing. Same overselling outcome as finding 4, reached through a door with no guard.  
_Fix (small):_ Route scanToCart through posAddProduct's check and compare the shelf against the basket quantity, not against zero.

**The e-mailed salon receipt never says how the sale was paid**  
setOrderPayment's return is discarded in route.ts:214, settle.ts:41 rebuilds the order as {...order, payment: outcome.payment}, and PaymentBlob (apply.ts) has no method field — so posMethod(order) in mail-hooks.ts returns "" and renderPosReceipt gets no method. The printable slip, which reads the DB row, does show it.  
_Fix (small):_ Re-read the order (or carry the method through) before settlePayment so the mail hook sees payment.method.

**A mistyped customer e-mail fails the sale with a message that never mentions the e-mail**  
createOrder throws bad_email for a malformed POS address (orders.ts ~1251), the route returns 400 with the code, and posSend maps only empty_order and bad_payment_method — everything else becomes «Не удалось оформить продажу — попробуйте ещё раз», which never succeeds on retry.  
_Fix (one-line):_ Map bad_email (and the other server codes) to a sentence naming the field.

**A scanned hidden product shows the FIRST catalogue product's name and price in the basket**  
byId() returns CATALOGUE[0] for an unknown id (app.js:7658) and a hidden product is dropped from CATALOGUE, while scanToCart pushes the real scanned id — so the basket line and the confirm card show a different product and its price. The sale itself is then refused by orders.ts (o.hidden → out_of_stock), surfacing as the generic error.  
_Fix (small):_ Make the POS paths use a null-returning lookup and refuse a line the catalogue does not have, with a clear message.

**The printed receipt's time is the server's UTC clock, not Tallinn's**  
when() in the receipt route calls toLocaleString("ru-RU", {...}) with no timeZone, so on Vercel's UTC Node function the slip prints 2-3 h early and, for late-evening sales, the wrong date. SHOP_TZ exists in src/lib/day.ts and is not used here.  
_Fix (one-line):_ Pass timeZone: SHOP_TZ to toLocaleString in the receipt route.

### privacy

**«Выйти» claims success before the cookie is cleared, and sessions cannot be revoked**  
acctLogout() (app.js:13260-13263) toasts «Вы вышли ✓» then fires an unawaited, unchecked fetch with no keepalive; the rmp_cust token is a self-contained HMAC (customers.ts:144-171) cleared only by that response's Set-Cookie, so a failed POST leaves a working session on a shared device.  
_Fix (small):_ Await the POST (or use keepalive), and only clear state and toast after it returns ok.

**An unauthenticated order re-subscribes any address that had unsubscribed**  
POST /api/orders is guest-open and orders/route.ts:82-84 calls recordMarketingConsent(order.email) on `newsletter: true`, which sets marketing = true and deletes the mail_optouts row (consent.ts:75-87) with no proof the poster owns the address.  
_Fix (medium):_ Only clear the stop list when the address matches a signed-in session or a verified order e-mail; otherwise record consent without deleting the opt-out.

**No way to erase a customer anywhere in the panel or the API**  
src/app/api/admin/customers/route.ts exports only GET/POST and [id]/route.ts only GET/PATCH; there is no `delete from customers` anywhere in src/. The policy's erasure text is the generic «Право на удаление» — the finding's «within one month» wording is not in the Russian page, but the gap is real.  
_Fix (large):_ Add an admin DELETE that anonymises the customer row and its cart/alert/consent traces while keeping the order records the law requires.

**Newsletter queue is frozen at claim time, so mid-send unsubscribes still get the letter**  
claim() reads audienceRows() once and inserts every address as 'queued' (newsletters.ts:563-590); resuming a 'sending' letter only bumps sending_at (:598) and the send loop mails whatever is still queued (:649-672) with no further consent read.  
_Fix (small):_ Re-check the stop list per batch in the send loop and mark newly opted-out rows skipped.

**/api/carts stores any e-mail a stranger types and the cart flow then mails it**  
carts/route.ts:51 takes `sessionEmail(req) ?? normalizeEmail(body.email)` with no ownership proof, saveCart() stores a row per address, and runAbandonedCarts() mails every such row that is not on the stop list (flows.ts:400-434). Only a 30/min/IP rate limit stands in the way.  
_Fix (medium):_ Only persist an anonymous body.email once an order or a login has proved the address, or skip cart mail for addresses never seen in orders/customers.

### products

**«+ Размер» / «×» discards the stock count, barcode and typed salon price in that pane**  
The handler at app.js:31355-31375 replaces the sizes pane wholesale and only edSizeRowsRead (23479-23487) carries values across — it reads data-edsz and data-edpx only, so data-edqty / data-edean re-render from the warehouse. goodsKeep, which does carry them, only runs inside renderImpl.  
_Fix (small):_ Collect the edqty/edean/edproprice values the way goodsKeep does before replaceWith, and write them back into the fresh pane.

**The goods editor toasts «Сохранено ✓» before the server answers and never rolls back**  
demoApply (app.js:28395-28405) mutates DEMO, writes the journal and saves localStorage before srvPush fires, and srvSaved (26998-27012) only toasts on failure — no rollback, no refetch. The panel and journal keep showing a price the server never took.  
_Fix (medium):_ Mark the journal entry pending and revert the local change (or refetch the feed) when srvSaved sees a non-ok answer.

**A lost answer on «Сохранить товар» lets the retry create a duplicate live product**  
customCreate's catch releases S.goodsBusy and invites a retry (app.js:24208), POST /api/admin/products (route.ts:39-64) has no idempotency key and no same-name check, and uniqueCustomId hands the retry a <base>-2 id. Both products are active and in the shop.  
_Fix (small):_ Send a client-generated idempotency key (or refuse a create whose brand+name already exists within a minute) and reload the product list on a network failure.

**Renaming a volume and typing its stock in one save race; the count can land on a ghost variant**  
The qty loop fires stock_adjust against the OLD label baked into data-edqty (app.js:31783-31790) and customUpdate's PUT goes out in the same tick (31801); syncVariantRows (inventory.ts:507-527) renames the row, so if the PUT lands first the adjust re-creates the old label as a fresh, wrong row.  
_Fix (medium):_ Await the product PUT before posting the stock moves, and key the move on the NEW label when the row was renamed in the same save.

**The products search promises «штрихкод» but never looks at a barcode**  
The placeholder at app.js:16147 says «Название, бренд, штрихкод» but admCatalogRows filters on (brand + name + id) only (16182); ean lives on S.stockLevels and is folded in only by the «Склад» filter (24576). Typing a barcode returns «Таких товаров нет».  
_Fix (small):_ Fold the product's stock-row eans into the haystack in admCatalogRows, or drop «штрихкод» from the placeholder in all three languages.

**A per-size photo choice is reverted by the next render**  
The data-vpick handler (app.js:31496-31503) only flips aria-current in the DOM and writes no state, while the row markup is rebuilt from galSizePick (23948) on every render — and galmain/galmove/galdel/galreset all call render(). The save reads the choice back out of the DOM, so the edit is simply gone.  
_Fix (small):_ Keep the per-size picks in a draft (like GAL.list) and render aria-current from that draft.

**A stock number typed before the warehouse list arrives is applied as a delta on top of the real count**  
The «Остаток» cell renders empty with placeholder «не учтено» whenever edStockFor finds no row, which is also the state while loadStockLevels is in flight (app.js:23838, 23873); on save qHas falls back to 0 (31783) and the posted delta is the full typed number, so a shelf of 7 becomes 10.  
_Fix (small):_ Disable the Остаток/Штрихкод cells (or show a loading placeholder) until S.stockLevels has landed.

### promos

**An order that got no discount still burns one of the code's uses**  
createOrder stores the typed code even when the quote failed and discount is 0 (orders.ts:1312), and redeemQuotedGiftCard takes the promo branch on the code alone, before the amount>0 guard (payments/apply.ts:191-192), so consumePromo bumps `used`. The «23 из 20» detail is wrong — the conditional UPDATE (promos.ts:261) stops the counter at max_uses and writes a promo_consume_failed row instead.  
_Fix (one-line):_ Only store discount_code on a non-POS order when the quote actually succeeded (or skip the promo branch when discount is 0 and the promo is not free_shipping).

**Saving a promo in the panel wipes its start date**  
promoFormPayload builds the whole body with no startsAt key (app.js:21476-21489; `startsAt`/`starts_at` appear nowhere in app.js), validatePromo turns the missing key into null (promos.ts:341) and upsertPromo writes `starts_at = excluded.starts_at` (:397). Only the assistant can set a start date (assistant/actions.ts:295), so any later edit of such a code makes it live early.  
_Fix (small):_ Add a start-date field to the promo form, or have the admin route keep the stored starts_at when the body omits the key.

**A promo code shaped RMP+8 can be created but never applied**  
The checkout routes by shape before validating — RMP-prefixed, 11 alphanumerics goes to applyGiftCode (app.js:32662-32666) and the shopper is told «Карта не найдена»; the server draws the same line (promos.ts:106-109) and validatePromo has no collision check, so the panel lists the code as active.  
_Fix (one-line):_ Refuse a code matching looksLikeGiftCode in validatePromo/normalisePromoCode so it cannot be created.

### pwa

**Scanner says the browser cannot scan when only the zxing script failed to download**  
iOS Safari has no BarcodeDetector, so startScanEngine takes scanNativeGaveUp("absent") (app.js:25924); if loadScript of zxing rejects, only reason==="silent" retries, and "absent" falls through to «Камера не поддерживается этим браузером» (app.js:25817) — which also claims Safari 17+ works. Owner-facing, and only on a failed script fetch.  
_Fix (small):_ Distinguish a load failure from an unsupported browser and show «не удалось загрузить распознавание — проверьте сеть» with a retry.

**Stock moves carry no idempotency key, so a retry after a lost answer double-counts the shelf**  
src/app/api/admin/inventory/moves/route.ts POST reads only productId/variant/delta|qty/reason/ref — no request id, no dedupe window — and the client cannot tell a lost answer from a request that never arrived, so the owner's natural retry applies the delta twice.  
_Fix (medium):_ Send a client-generated move id and have the route ignore a repeat of the same id within a short window.

**loadShipRules fetches /api/overrides/ without the no-store rule and overwrites the fresh boot copy**  
app.js:6736 is a bare `fetch("/api/overrides/")` while the file's own FEED_FETCH = {cache:"no-store"} (26838) exists precisely because the feed's stale-while-revalidate window hands the browser a copy up to two minutes old; screenCheckout() calls it on entry (14332) and applyShipRules merges the stale answer over the fresh one.  
_Fix (one-line):_ Pass FEED_FETCH to that fetch like the other two feed calls.

### reviews

**A reviews outage shows «Отзывов пока нет — станьте первым» and never retries**  
The GET route answers ok:true with an empty list and degraded:true on a database error (route.ts:48-52); app.js:10927 keeps only j.reviews and app.js:10930 collapses a rejected fetch to [] as well, and the guard at app.js:10922 (`S.dbReviews[id] !== undefined`) means the product is never asked again for the life of the tab.  
_Fix (small):_ Store a distinct «unknown» state for degraded/failed loads, render no reviews claim in it, and let loadReviews retry.

**The review draft survives a product change and is filed against the new product**  
Both product-change paths reset revOpen/revState/revAccOpen but not S.revForm (app.js:30800, app.js:33700); S.revForm is one global draft (app.js:7397) and sendReview posts `product: S.productId` read at send time (app.js:11030).  
_Fix (one-line):_ Clear S.revForm alongside the other review fields on both product-change paths.

**Rejected submissions burn the three-per-hour quota**  
rateLimit runs as the first statement of POST, before the body is parsed and long before validateReview (route.ts:56-85), and it increments on every call (auth.ts:182). Link and profanity rejections cannot be anticipated by the client, so three corrections leave the customer locked out for the hour.  
_Fix (small):_ Count only accepted submissions (call rateLimit after validateReview, or decrement/skip on a 400).

**«Сделать сегодня» keeps counting reviews already moderated**  
The dashboard reads o.attention.reviewsPending from the once-per-session overview cache (app.js:15125, guard at app.js:14792, only reset on logout/401), and the moderate_review branch returns on success without calling loadOverview(true) (app.js:27149) — unlike admOrdersChanged, which does invalidate it.  
_Fix (one-line):_ Call loadOverview(true) after a successful review moderation.

### settings

**No re-read after boot plus whole-document saves: a stale tab silently reverts a change made elsewhere**  
setSetting is an unconditional upsert of the whole jsonb value (orders.ts:626-632), the route carries no version or compare-and-set, the panel PUTs each document in full (app.js:27120/27127/27131), and adoptServer runs only from the boot fetch (26965) while refreshFeeds returns early on the admin screen (27700).  
_Fix (large):_ Re-read the settings when the admin screen regains focus, and refuse a save whose base copy is older than the stored row (updated_at or a version field).

**Server silently blanks an invalid KMKR, reg code, phone, e-mail or social link the panel still shows**  
mergeContent runs every stored value through sanitizeContentPatch on read (content.ts:381-400), which replaces a field failing REG_RE/VAT_RE/PHONE_RE/EMAIL_RE/URL_RE with "" (291-330); the panel validates only the IBAN (app.js:19708-19710) and says «Сохранено ✓» either way.  
_Fix (small):_ Mirror the five regexes in the panel and refuse the save with the field marked, as the IBAN already is.

**Saving «Главная страница» also publishes unsaved «О компании» edits**  
contentDirtyFor and contentRevert are page-scoped (app.js:20637-20654) but the data-contentsave handler sends contentDiff over the whole document (app.js:32156-32163), so a half-typed address left on «О компании» goes live with an announcement-strip save the bar described as «Верхняя полоска».  
_Fix (small):_ Filter the diff by the page whose save bar was pressed, the same way contentDirtyFor does.

**On a shop with no shipping_rules row the storefront quotes EE courier 6,89 € while the server bills 10,84 €**  
/api/overrides always sends shipping: {} (route.ts:33), so adoptServer's setShipRules (app.js:26957) runs and overwrites every courier cell with MONTONIO_PRICE.courier (6718-6721, EE 6.89), while the server with no row prices from DEFAULT_SHIPPING_RULES, whose courier EE is 10.84 (shipping.ts:196). Only affects a fresh database or preview deployment.  
_Fix (small):_ Treat an empty/missing rules object as «no rules» in adoptServer instead of running the whole-table reseed.

**A delivery price outside 0–99 € is dropped in silence; the box keeps showing it and the old number is saved**  
shipNum returns NaN out of range or unparseable (app.js:21238-21244) and every branch of setShipDraftField then returns without storing (21308-21309, 21321, 21335) — no message, no aria-invalid, and the input still displays what was typed.  
_Fix (small):_ Mark the field invalid and show why instead of returning silently (and raise the 99 € ceiling, which is below several real courier tariffs).

**PUT /api/admin/settings has no transaction and answers 503 even when every write succeeded**  
route.ts:78-144 loops setSetting + writeAuditSafe per key with no BEGIN/COMMIT, and the success response's getSettings() read-back sits inside the same try (145), so a failure there reports db_unavailable after the row was already written and the tariff cache reset.  
_Fix (small):_ Do the read-back outside the try (or answer ok without it) and wrap a multi-key body in one transaction.

### shipping

**Every rate save writes the whole table as explicit numbers, so cleared boxes never stay cleared**  
The save action carries cloneRules(shipDraft()) with full:true; demoApply runs setShipRules, which re-seeds methods from SHIP_RULES_DEFAULT and overwrites every courier cell from MONTONIO_PRICE, and srvPush PUTs cloneRules(SHIP_RULES) (app.js:6703-6731, 27131, 28311-28315). The stored row therefore always carries frozen numbers and never follows a later Montonio tariff change.  
_Fix (medium):_ PUT only the cells the owner actually set (the draft delta), leaving cleared cells absent so the server's Montonio fallback can run.

**A failed Montonio pickup-point lookup is cached at the CDN for an hour as "no points"**  
fetchMontonioPickupPoints returns null when every carrier fetch throws (montonio.ts:395-404); points/route.ts cannot tell that from an empty list, the public feeds cover only omniva/dpd/smartpost in EE/LV/LT (parcel-points.ts:37-48), and the empty answer still goes out with public, s-maxage=3600. Finnish and Unisend/Nova Post chips vanish for an hour after one slow minute.  
_Fix (small):_ When the Montonio lookup returned null and no feed answered, respond with cache-control: no-store (or a short max-age).

**A parcel to GR/HU/RO is priced 4,99 € from methods.parcel.default against a ~43 € courier cost**  
The tariff mirror has courier-only rows for GR/HU/RO, so methods.parcel has no cell there and no EU zone key; the chain in shipping.ts:637-646 lands on table.default = 4.99, and createOrder never checks that the method is available in that country. The checkout itself never offers parcel outside EE/LV/LT/FI (CARRIERS_BY_COUNTRY.EU is empty), so it takes a crafted body or an odd method string — which shipMethodOf defaults to "parcel".  
_Fix (small):_ Refuse (or reprice as courier) a parcel order to a country with no parcel tariff, instead of falling through to default.

**Courier prices are based on the cheapest carrier, but the label books whichever Montonio lists first**  
costBasis() returns cheapestCost for every courier (country-prices.ts:226-229), while firstCourierService walks Montonio's /shipping-methods candidates in the order returned and takes the first with a service id (montonio.ts:877-886); the panel posts only {orderId} (app.js:27578), so no carrier is ever chosen. Any courier dearer than the cheapest eats the margin.  
_Fix (medium):_ At label time pick the carrier the price was based on (cheapestCost for that country) rather than the first candidate.

**A below-cost save the server refuses is applied locally and toasted as saved**  
demoApply applies setShipRules, clears the draft and unshifts the journal line, then fires srvPush (app.js:28311-28315, 28395-28399), and the caller immediately toasts «Тарифы доставки сохранены» (31891); the below_cost branch at 27008 only shows a second toast and rolls nothing back. The panel then shows a price the shop is not charging.  
_Fix (small):_ Roll SHIP_RULES, the draft and the journal entry back when srvPush answers below_cost (or apply only after a 200).

**countriesOff is enforced only by the checkout dropdown; the server prices and accepts a switched-off country**  
countryOff() (shipping.ts:560-564) has no caller in src/ outside its own file, and createOrder reads country only for the invoice rule. europeOptionsHTML deliberately keeps a country the shopper already picked (app.js:6244-6250), so a stale tab or a direct POST buys a delivery to a country Montonio will not carry.  
_Fix (small):_ Call countryOff() in createOrder and refuse the order with a clear error.

**A shipment Montonio registered as failed is stored and shown as a finished label**  
createMontonioShipment only requires an id and stores body.status untouched (montonio.ts:1017-1032); admShipmentBoxHTML never reads mont.status and prints «Трек-номер появится, когда перевозчик примет посылку» (app.js:15654-15692). A registrationFailed shipment — later written by the webhook too — looks exactly like a good one.  
_Fix (small):_ Show mont.status in the shipment box (and warn on registrationFailed) instead of assuming the parcel is registered.

**The auto-«Доставлен» clock runs on orders.updated_at, which every carrier webhook resets**  
closeDeliveredOrders compares new Date(row.updated_at) against now - autoDays (delivery.ts:173, 197-200), and the notify route writes saveShipmentOnOrder on every status word, which sets updated_at = now() (montonio.ts:1145-1153, notify/route.ts:124). A parcel that reports progress more often than autoDays never closes.  
_Fix (medium):_ Stamp a shippedAt on the order when it goes to shipped and measure from that.

**Clearing «Бесплатно от» leaves the old free-delivery promise on product pages and the footer**  
refreshShipThresholds only copies a finite number into THRESH (app.js:6210-6218), while an emptied box stores an explicit null (21325-21333); the marketing lines keep printing the stale number even though the checkout bills correctly. The code comment acknowledges this trade-off, but the customer is told something untrue.  
_Fix (small):_ Let THRESH hold null and have the marketing sentences omit the free-delivery line when it is null.

**The below-cost guard polices parcel cells no screen can edit, so a tariff rise can lock every save**  
belowCostCells checks methods.parcel for every non-carrier-choice country (shipping.ts:533-540) and one failing cell refuses the whole PUT; admShipRowHTML emits only c:, m:courier: and free: keys (app.js:19548-19561), and the panel re-sends the stored parcel numbers because shipDraft() clones the current SHIP_RULES. After a Montonio parcel rise the owner has no box to raise.  
_Fix (small):_ Skip parcel cells the panel cannot edit in belowCostCells, or let the save drop a stale parcel cell back to the default.

### stock

**In-salon till has no idempotency: a lost reply lets the owner sell the same basket twice**  
POST /api/admin/pos-orders creates the order, settles it and runs decrementPosStock in one unkeyed request (route.ts:191-250, 50-70); nothing dedupes a retry, and the register only shows «Сервер не отвечает» and re-enables the button. A retry after a lost response makes a second order, a second stock write-off and a second receipt.  
_Fix (small):_ Have the register mint a request id per basket and store it on the order with a unique index, returning the existing order on a repeat.

**Scanner write-off on an uncounted bottle writes nothing yet toasts «Списание −N ✓»**  
scanCommitMove sends reason 'sale_pos' (app.js:25348); move() skips sale reasons on untracked variants and returns appliedDelta 0 (inventory.ts:411-420), the route still answers ok:true, and stockMoveSend collapses that to true so the success toast fires. Nothing is written and no ledger line appears.  
_Fix (small):_ Use reason 'adjust' for the scanner write-off, or surface result.skipped and tell the owner the bottle is not counted yet.

**Scanner card hard-codes tracked:true, so an uncounted bottle is shown as «на складе 0»**  
EanHit carries no `tracked` field (inventory.ts:158-160), yet scanLookup stores `tracked: true` for every hit (app.js:25299), so the card's «не учтено» branch (app.js:25013) is dead and a bound-but-never-counted bottle reads as an empty shelf.  
_Fix (one-line):_ Return `tracked` from byEan()/the lookup route and store it instead of the literal true.

**A product whose only counted size sells out disappears even though its uncounted sizes are full**  
productStockStates aggregates only variants with a counting move (inventory.ts:542-553), so a single tracked size at 0 makes `states.every(s => s === "out")` true and the whole product reads «нет в наличии»; checkout then refuses every size of it (orders.ts:928).  
_Fix (medium):_ Treat a product as out only when every size on its ladder is counted and out; otherwise fall back to the manual override.

**Webhook and return URL can both take the paid branch and decrement stock twice**  
wasPaid comes from the snapshot the caller already read (apply.ts:481), setOrderStatus updates with no status predicate and no row lock (orders.ts:1491-1515), and decrementStock has no per-order guard (apply.ts:527). Two simultaneous callers both see 'new' and both write the sale moves.  
_Fix (medium):_ Make the paid transition a conditional update (`... where id = $1 and status <> 'paid' returning *`) and run the side effects only when it returns a row.

**A dropped connection during a stock write leaves the scanner buttons disabled with no message**  
apiJson rejects on a network error and throws on a non-JSON reply (app.js:26838-26843); scanCommitMove sets S.scanBusy = true and clears it only inside .then with no .catch (app.js:25341-25356), so a lost reply greys out «Принять»/«Списать» permanently and shows nothing.  
_Fix (one-line):_ Add a .catch to scanCommitMove (and the other unguarded stockMoveSend call) that clears scanBusy and toasts the failure.

**The assistant can write a size that does not exist, creating an invisible tracked row**  
sanitizeAction takes `variant` as free text with no ladder check (actions.ts:1013, 1019-1020), the panel forwards it (app.js:12521-12523) and the moves route accepts String(body.variant). The resulting row is tracked and feeds productStockStates, but lies outside getLevels' universe so no screen can show or fix it.  
_Fix (small):_ Validate the assistant's variant against the product's ladder (and default an omitted one to the ladder's single size) before the action is offered.

**A shelf counted as empty cannot be recorded as 0 from the panel**  
stockCommit compares against 0 for an untracked row, so typing 0 yields qtyChanged false, no job and «Изменений нет» (app.js:26421, 26433); the editor grid instead sends delta 0, which move() rejects as bad_delta. Either way the row stays «не учтено» and the shop keeps advertising the product from the manual override.  
_Fix (small):_ Treat an untracked row's typed 0 as a real setQty(0) so the first count can be zero.

**A write-off clamped at zero is reported as fully applied, and its undo restores the full amount**  
move() clamps and reports appliedDelta/clampedNegative (inventory.ts:352-355), but stockMoveSend reduces the reply to a boolean (app.js:26330-26332) so the scanner toasts the full −N; the journal's undo entry is built from the requested delta (`delta: -a.delta`, app.js:28216-28217), so undoing a clamped assistant write-off puts back stock that never left.  
_Fix (small):_ Read appliedDelta/clampedNegative in stockMoveSend, toast the number actually applied, and build the journal's undo from appliedDelta.

### storefront

**Backing out of the bank page loses the basket; only the receipt URL can give it back**  
payNow parks the basket (holdCart) then clearOrderState() persists an empty cart before the redirect (:14098-14100); restoreHeldCart is called from one place only, doneState at :28845, and only when the return URL carries a non-paid status and the order id. Browser Back or a closed bank tab returns to an empty shop.  
_Fix (small):_ Restore the held cart on boot when no paid receipt has been seen for that order id, instead of only from the receipt URL.

**Cart drawer keeps stale rows after a background feed drops a line, so its buttons hit the wrong row**  
renderImpl only re-mounts the overlay when the overlay KIND changes (:29751-29758), but adoptServer splices S.cart twice (:26861, :26905) and loadServerOverrides then calls plain render() (:26977). The drawer keeps its old data-cline indices, which now point at different lines.  
_Fix (one-line):_ Force an overlay rebuild (reset ovlKey) whenever S.cart is filtered by a background answer.

**The abandoned-cart link re-adds sold-out products that addToCart would refuse**  
resumeCart (:13406-13435) checks only that the id is in CATALOGUE and caps qty; addToCart's backstop `if (byId(id).stock === "out")` (:30559) is bypassed. The line sits in the basket until POST /api/orders/ refuses the whole order with out_of_stock.  
_Fix (one-line):_ Apply the same stock !== "out" test per line in resumeCart.

**Gift-card page says the card «не сгорает» and, two paragraphs down, that it expires in a year**  
screenGift prints «Работает на весь магазин и не сгорает.» (:9369) and «Карта действует год со дня покупки.» (:9385); GIFT_VALID_MONTHS = 12 (src/lib/giftcards.ts:84) and giftValidUntil stamps the expiry, so the second line is the truth.  
_Fix (one-line):_ Drop «и не сгорает» from the intro.

**Cart-drawer «+» adds the product-page quantity and volume when it offers the open product**  
addToCart resolves size and qty from the screen when no sizeIdx is passed (:30563-30567), and the upsell pool does not exclude the product currently open (:29112) while its «+» passes a bare id (:29133). A row quoting 9 € can add three 500 ml bottles at 25 €.  
_Fix (small):_ Pass cardSizeIdx(p.id) and qty 1 explicitly from the upsell row, or exclude S.productId from the pool.

## LOW — 64

### analytics

**A failed refresh leaves stale analytics on screen with no marker**  
loadAnalytics (app.js:14685-14694) and loadOverview (14802-14804) only set err when there is no data to keep, so a refresh failure updates the timestamp and renders the old numbers with no banner and no «Повторить».  
_Fix (small):_ Keep the stale data but set a `stale` flag and show an «обновить не удалось» line with the age of the figures.

### assistant

**Shop assistant is told to end with a blog link; the widget renders it as dead text**  
shopPrompt asks for a bare relative path at the end of the reply (route.ts:275) with real slugs supplied (137-149), but chat.js renders `bubble("bot", esc(text) + cards)` (331) and builds no anchor anywhere, so the path appears as unclickable literal text.  
_Fix (small):_ Linkify a trailing /shop2/blog/<slug>/ into an anchor after escaping.

**Photos attached to the assistant are uploaded at once and orphaned in the bucket on reload**  
admAttachFiles uploads each file immediately to products/inbox/ (app.js:28635-28655); the only reference is S.adminAtt (7329), which is in-memory and not part of the persisted state (7629), and the only delete path is the × on a strip entry (28661-28666).  
_Fix (medium):_ Sweep products/inbox/ objects older than a day, or upload on apply rather than on attach.

**Chip tapped before the AI probe lands gives a canned answer and then a stuck «…»**  
The chip handler only fetches when admAI is already true (app.js:32598); admAI is null until probeAdmAI answers, and admAsstBodyHTML then renders adminAnswer(S.adminAsk) (16616). Once the probe sets admAI=true, admAnswerHTML returns "…" because S.adminAns is null (16418), with no retry button and no request ever sent.  
_Fix (small):_ Queue the chip's question and fire it when the probe resolves, or disable the chips until admAI is known.

### auth

**Unauthenticated mail preview overwrites the process-global mail texts real letters render from**  
The route calls loadMailTexts() on every anonymous request (preview/route.ts:63), and mail-texts.ts writes setMailTextsOverride(null) on any settings failure, so a preview landing on the same instance as a real letter render can swap the owner's subject/intro for the built-in defaults. Impact is wrong-but-valid wording, not a wrong recipient or amount.  
_Fix (small):_ Have loadMailTexts return the texts and pass them into the renderers instead of writing a module global, or leave the previous override in place on failure.

**Unsubscribe, cart-resume and login-code HMACs fall back to constants in the repo**  
consent.ts:194 and flows.ts:187 both return the literal "rempire-resume-cart" and customers.ts:232 falls back to "rempire-login-code" when SESSION_SECRET is absent or short — silent substitutions, not errors. Only reachable on a deployment configured without a proper secret, where admin and customer sign-in are already broken.  
_Fix (small):_ Throw (or refuse to mint the token) instead of substituting a constant when secret() is null.

**Two burnt codes exhaust the 3-per-15-min budget while the message says «подождите немного»**  
Five wrong guesses kill a code (CODE_MAX_ATTEMPTS) and each fresh code costs one of three per 15 minutes, and the storefront renders rate_limited as «Слишком много попыток — подождите немного» (app.js ACCT_ERRS) with no indication the wait is a quarter of an hour.  
_Fix (one-line):_ Say the actual wait in the rate_limited message on the account screen.

**Rate-limit map only evicts expired keys, so it can grow while traffic is live**  
auth.ts:179 sweeps only inside the new-bucket branch and deletes only entries whose window has closed, so with more than 5000 simultaneously live keys nothing is freed. The entries are tiny and the instance is recycled often, so the practical cost is small.  
_Fix (one-line):_ Evict the oldest entries too when the sweep frees nothing.

### blog

**Card price formatted in the panel's language, not the article's**  
blogProductPrice(p, L) translates «от» by L but formats the number with eur(), which keys on S.lang (app.js:7633-7638, 11911-11915), producing «от €7» in a Russian article written while the panel is in English.  
_Fix (one-line):_ Give eur() an explicit language argument and pass L from blogProductPrice.

**A lost response on a new-article save can create a duplicate post**  
The POST carries no idempotency key and apiSend is a bare fetch with no timeout or retry (app.js:12381-12384, 26846-26852); the failure message invites a retry, which inserts a second row with slug-2. Recoverable by the owner, who can delete the extra draft.  
_Fix (medium):_ Send a client-generated id (or reuse the draft's) so a retry updates instead of inserting.

**A partial PATCH blanks the whole article and answers 200 ok**  
fieldsOf() lifts every content key including undefined and upsertPost writes every column unconditionally (route.ts:144-155, blog.ts:718-730); the title_required guard is skipped when title is undefined on an existing id. No caller in the repo does this — the panel always sends the full payload and publish/unpublish uses the boolean branch — so it is a latent API hazard, not a reachable panel bug.  
_Fix (small):_ In the edit branch, only write the keys actually present in the request body.

**placeArticleCards does not cap or space the model's own inline cards**  
Step 1 keeps every known, unseen card and returns an inline one untouched with no count against max and no adjacency check (src/lib/blog-cards.ts:417-434); `have` starts at seen.size, so more than POST_CARDS_MAX cards, and two adjacent ones, both survive.  
_Fix (small):_ Count inline cards against max in step 1 and strip the ones over the cap or adjacent to another.

**A failed article OPEN reports «Не получилось сохранить»**  
openBlogEditor() shows the save-failure sentence on a failed GET and in its .catch() (app.js:12030, 12034) although nothing was being saved.  
_Fix (one-line):_ Use a separate «Не получилось открыть статью» message there.

### customers

**«+ Партнёр» can report a promotion over a write that did nothing**  
upsertPartner computes `promoted` from the pre-read `before`, not from the row re-read afterwards (loyalty.ts:962-987), so if recordLogin creates the row between the read and the `on conflict do nothing` insert, the tier stays retail while the route sends the welcome letter. Real, but the window is a few milliseconds.  
_Fix (one-line):_ Compute `promoted` from the re-read customer row's tier.

**Demoting a partner resurrects the Pro request he already approved**  
approveProCustomer sets tier and pro_approved_at but leaves pro_requested_at standing (loyalty.ts:889-893), and setCustomerTier's retail branch writes only the tier (:903-911), so the row again matches the pending predicate `pro_requested_at is not null and tier='retail'` and admCustBadge shows «Заявка Pro» for ever.  
_Fix (one-line):_ Clear pro_requested_at in approveProCustomer, as upsertPartner already does.

**A failed customer-card GET leaves a silent skeleton that refetches on every render**  
loadAdminCustomerDetail (app.js:22264-22276) handles only 401 and 200/ok, ends in .catch(noop), and has no busy flag; admCustomerCardHTML calls it on every render and returns the skeleton while detail is null, so a 503 gives endless grey bars and repeated requests. loadAdminCustomers, beside it, does set S.admCustErr.  
_Fix (small):_ Set an error flag on the non-ok and catch paths and add a _busy guard, like the list loader.

**Tier switch offers «Отменить» after the partner letter was already sent, and redo sends a second**  
The set_tier toast carries a journal undo entry (app.js:31913-31917, 28376-28381) whose redo re-PATCHes tier:'pro'; the route sends the welcome letter on any retail→pro flip ([id]/route.ts:186-194), so the undo leaves a letter the customer should not have and the redo posts a duplicate. «Одобрить Pro» deliberately has no undo for exactly this reason.  
_Fix (small):_ Drop the undo from the retail→pro direction, or suppress the letter when a welcome was already sent recently.

**Manual points deduction has no floor; balance can go negative**  
adjustLoyaltyPoints validates only |delta| ≤ 1 000 000 and inserts unconditionally (loyalty.ts:374-383), unlike redeemLoyaltyPoints which clamps to the balance; getLoyaltyBalance returns the raw sum, so the cabinet can show a negative balance. Needs an owner mistake to reach.  
_Fix (small):_ Clamp a negative adjust to the current balance, or warn in the panel before posting it.

**Redeem ceiling rounds up, so a basket can exceed redeemMaxPct**  
capFromSubtotal = eurosToPoints(subtotal * redeemMaxPct / 100) and eurosToPoints rounds to the nearest point (loyalty.ts:199-202, 402-403), so an 11.70 € basket at 30 % allows 4 points (34 %). Bounded at half a euro and still floored by what is left to pay.  
_Fix (one-line):_ Floor the cap instead of rounding, in both loyalty.ts and the checkout preview in app.js.

### giftcards

**«Выпущенные карты» shows a cancelled card as an ordinary spent one and still offers its PDF**  
admGiftRowHTML renders code, balance, recipient, date and the PDF link and never reads voidedAt (app.js:17019-17034), although the payload carries it (admin/giftcards/route.ts:40-44) and the order card badges the same card «Аннулирована» and drops its PDF (app.js:16024-16033).  
_Fix (one-line):_ Read c.voidedAt in admGiftRowHTML: badge it and hide the PDF button, like the order card does.

### i18n

**Client-only screens are served the raw Russian home shell with <html lang="ru">**  
notfound-page.ts:364 returns the unpatched shell for search/brands/account/checkout/done/admin/scan, and that shell is public/shop2/index.html — lang="ru", Russian title and canonical /shop2/, with the Russian home screen in #prerender. Visible only until app.js repaints, but the lang attribute and canonical are what a crawler or screen reader sees.  
_Fix (medium):_ Patch lang, title and canonical on the shell from the URL's language segment before returning it.

**trText's $n substitution reads Object.prototype — "constructor" prints JS source**  
app.js:5949 does a bare d[piece] on the UI.ET/UI.EN object literals, so d["constructor"], d["toString"], d["valueOf"] resolve up the prototype chain and String.replace stringifies them into the sentence; the empty-search message at app.js:12605 feeds the shopper's own query through that capture.  
_Fix (one-line):_ Use Object.prototype.hasOwnProperty.call(d, piece) ? d[piece] : … (and the same at the d[s] lookup on 5943).

**English/Estonian never render a singular: "1 products", "1 points", "1 locations"**  
The rules at app.js:5457, 5458, 5564, 5490 and 5599 take one replacement for any number, so «1 товар» becomes "1 products" / "1 toodet" — the literal-1 rule pattern the author used at app.js:5225 was not applied here.  
_Fix (small):_ Add literal-«1» rules ahead of each of the five general ones.

**Checkout company field reads "Reg. no номер" / "Reg-kood номер"**  
invoiceBlockHTML labels the field «Рег. номер» (app.js:7058); the dictionary only has the lowercase key «рег. номер» (app.js:1266/3819), so trText falls to the generic rule ^Рег\. (.+)$ (app.js:5571) and the untranslatable capture «номер» is handed back verbatim.  
_Fix (one-line):_ Add the capitalised key "Рег. номер" to both dictionaries.

**Estonian stock words differ between the prerendered page and the live app**  
seo-head.mjs:187 uses low "vähe" / out "pole saadaval" for the static chip and meta description, while app.js:181 translates the same chips to "viimased" / "otsas" once the app takes over.  
_Fix (one-line):_ Make one table the source of truth for the three stock words.

**Five UI_RX rules are unreachable — an earlier general rule matches first**  
trText returns on the first match (app.js:5941-5952), and ^Промокод (.+)$ at 5286 precedes the specific promo rules at 5831-5835 and 5860, while ^Письмо ушло (.+)$ at 5701 precedes 5729 — so the ET/EN panel shows e.g. "Promo code удалён: SUMMER".  
_Fix (small):_ Move the five specific rules above their general parent (and make i18n-gaps.mjs test only the first matching rule).

**<optgroup label> is in TR_ATTRS but the selector never collects those elements**  
TR_ATTRS includes "label" (app.js:5961) but the loop iterates root.querySelectorAll("[placeholder],[aria-label],[title]") (app.js:5994), so an element carrying only label is never visited and the four banner-picker group headings stay Russian.  
_Fix (one-line):_ Add [label] to the selector at app.js:5994.

**normalizeLang maps anything starting "es" to Estonian; order lang is never narrowed**  
layout.ts:210-211 really does return "et" for any value starting "es" (it is there to catch ISO "est", but "es-ES" falls in too), and orders.ts:1256 stores lang unnarrowed unlike customers.ts normalizeLangCode. Only reachable by a hand-built POST, not by the storefront.  
_Fix (one-line):_ Match "est" explicitly instead of "es", and narrow the order lang through normalizeLangCode.

**Duplicate keys in ET and EN dictionaries; one pair has two different English values**  
"продажа в салоне" appears twice in each table (EN app.js:4259 "in-store sale" vs 4380 "salon sale"; ET 1721/1842), and the long stock-threshold hint is duplicated at 1953/2056 and 4489/4592 — the object literal keeps only the later value.  
_Fix (one-line):_ Delete the dead earlier entries after picking the wording to keep.

### invoices

**A failed resend after a successful first send leaves no warning on the order card**  
resendInvoice keeps the old sentAt and only rewrites sendError (invoices.ts:589-593), but admInvoiceStateHTML chains `if (inv.sentAt) … else if (sendError === 'no_iban') … else if (sendError)` (app.js:15944-15960), so once sentAt is set neither warning line can ever render.  
_Fix (one-line):_ Make the sendError lines independent of the sentAt branch rather than else-if alternatives.

### letters

**Unpaid-order letter prints «Доставка — : бесплатно»**  
order-unpaid.ts:108 passes an empty shipLabel to totalRows, which always builds `${shipping} — ${shipLabel}` (common.ts:374-383), leaving a dangling dash in both the HTML and text parts. Other callers pass a real label.  
_Fix (one-line):_ Drop the « — label» part in totalRows when shipLabel is empty.

### orders

**Every discounted salon sale writes a false «promo_consume_failed» line into the journal**  
A POS sale stores discount_code = "POS -15%" (orders.ts:1309); on the paid transition isPromoCode() is just !looksLikeGiftCode(), so the label goes to consumePromo, normalisePromoCode rejects it on the '%' (promos.ts:100) and apply.ts:281 writes promo_consume_failed. No money is affected — only a false English alarm in the owner's journal.  
_Fix (one-line):_ Skip the promo/gift settlement when channel is 'pos' (or when the code is not a normalisable promo code).

**Order search filters only the 100 loaded orders while promising a full search**  
The panel fetches /api/admin/orders/?limit=100 once (app.js:27298) and admOrderRows filters that array in the browser; S.admOrderQ is never sent, though the API supports `q` with a SQL search over number/email/name/phone, and the screen prints «Ищем по всем заказам».  
_Fix (small):_ Send the typed query to the server (debounced) and render its answer instead of filtering the cached array.

**The «Возвраты» counter can never fall — nothing records that a request was answered**  
recordReturnRequest stores only {at} in shipping.returnRequest (returns.ts:146) and nothing ever writes an answered flag; both the chip (app.js:15322) and analytics.ts:657 count every delivered order with that key, so a request settled by conversation stays on the counter for ever.  
_Fix (small):_ Store a handledAt alongside `at`, set it from «Написать клиенту»/an explicit dismiss, and exclude it from both counts.

**A status PATCH the server rejected still leaves a journal line saying it happened**  
demoApply unshifts the journal entry and saves it before calling srvPush (app.js:28395-28399), and the order_status branch only toasts on failure (app.js:27060-27063) — the line and its «Вернуть» button stay, so the journal claims steps the server never took.  
_Fix (small):_ Remove (or mark failed) the journal entry when srvPush's PATCH does not return ok.

### pos

**«чек ушёл на почту» is printed on the address alone, not on the send succeeding**  
route.ts:239 sets mailed = !!settled.email; the send result from notifyOrderPaid is dropped in settle.ts:43. With Resend down or unconfigured the screen still promises a letter that never went.  
_Fix (small):_ Return the mail hook's result up through settlePayment and set mailed from it.

### privacy

**Customer card can date a letter-link unsubscribe with an older account untick**  
optOut() moves marketing_off_at only `when marketing` (consent.ts:149), and the card renders «Отписался по ссылке в письме · <marketingOffAt>» whenever optedOut is true (app.js:22569) while mail_optouts.at is never read (loyalty.ts exposes only a boolean). Owner-facing date only.  
_Fix (small):_ Return mail_optouts.at with the row and show that date for the link path.

**Gift-card PDF sits at a predictable key in a public R2 bucket**  
storeGiftCardPdf() writes `giftcards/<code>.pdf` public and immutable (giftcard-pdf.ts:45-47, 523-537) and fetchStoredGiftCardPdf() reads it over publicUrl() with no credentials, so the token gate on the route is bypassable by anyone holding the code — who can already redeem the card; the extra exposure is the sender/recipient names and message.  
_Fix (small):_ Add a random suffix to the storage key, or read the object through the S3 API instead of the public base.

**Birthday counter uses a 7-day window the run does not, and ignores letters already sent**  
flowCounters() loops a fixed 7 days and filters only birthday/marketing/stop-list (flows.ts:1314-1327), while runBirthdays() uses birthdayWindow(now, flows.birthdayDays) with a default of 0 — today only (flows.ts:709-722, :102) — and additionally skips rows stamped birthday_sent_year. The panel count and «отправлено» can disagree.  
_Fix (small):_ Build the counter from birthdayWindow(now, flows.birthdayDays) and add the birthday_sent_year clause.

**ConsentSource "admin" is unreachable — a label for a state nothing writes**  
The only call sites of the two consent writers are orders/route.ts:83 ("checkout") and account/me/route.ts:130-131 ("account"); the admin customer PATCH takes action/tier/notes/pointsDelta only, so CONSENT_SOURCE.admin = «в панели» (app.js:22566) can never render.  
_Fix (small):_ Either add a consent toggle to the admin customer PATCH or drop the unused source and its label.

**Consent and opt-out transactions lock customers/mail_optouts in opposite order**  
recordMarketingConsent() upserts customers then deletes mail_optouts (consent.ts:74-88); optOut() upserts mail_optouts then updates customers (:140-152). A genuine lock-order inversion, though it needs two transactions on the same address in the same instant, and Postgres aborts one — recordMarketingConsent swallows it silently, optOut surfaces a 503 the user can retry.  
_Fix (one-line):_ Touch customers first in optOut() too (or mail_optouts first in both) so the two agree on order.

### products

**A failed video upload is reported with the photo wording and no size pre-check**  
uploadVideo (app.js:23268-23278) has no MEDIA.maxBytes pre-check and maps a JSON-less 413 to "upload_failed", and VIDEO_ERR (23285-23291) has no upload_failed entry, so vidFail falls through to mediaErrText and prints the photo sentence. uploadPhoto does both checks (22928-22938).  
_Fix (small):_ Add a size pre-check and a payload_too_large / upload_failed entry to VIDEO_ERR with video wording.

**Every first save of a multi-size product with several photos writes a no-op varImg override**  
map2 is [0,0,…] from the rendered rows and gp.varImg is absent, so JSON.stringify(map2) !== "[]" always holds (app.js:31724-31731) and set_varimg fires with a journal line, a PUT and a «Сохранено ✓» even when nothing was touched.  
_Fix (one-line):_ Treat an all-zero map as equal to an absent varImg before deciding the override changed.

### promos

**Discounted salon sales write a promo_consume_failed audit row**  
A POS sale stores «POS -15%» in discount_code (orders.ts:1309) and settles through settlePayment (pos-orders/route.ts:219); isPromoCode is just !looksLikeGiftCode, so the promo branch runs, normalisePromoCode rejects the «%» and returns bad_code, and an audit row is written. Noise in the journal only — the sale and the money are unaffected.  
_Fix (one-line):_ Skip the promo branch when the stored code starts with «POS -» (or flag POS orders explicitly).

**A cancelled or refunded order never gives the promo use back**  
consumePromo has no inverse anywhere in src (only apply.ts calls it), and setOrderStatus returns stock and voids gift cards but touches neither promo_codes.used nor promo_code_uses (orders.ts:1531-1573). The campaign counter and the analytics figure stay high, and deletePromo keeps refusing the code.  
_Fix (small):_ Add a releasePromo(code, orderId) that deletes the use row and decrements `used`, called from the refund/cancel branch of setOrderStatus.

**Birthday flow leaves a dead single-use code behind on every skipped send**  
promoForBirthday upserts a fresh REM-BD code before the stamp and the send (flows.ts:649-661, :817, :826); a skipped send removes the stamp (:849) but nothing removes the code, so a missing RESEND_API_KEY produces one dead row per customer per daily run, in the list the owner manages by hand.  
_Fix (small):_ Mint the code only after the send reports ok, or delete the code when the send is skipped.

**«добавьте ещё на 0,00 €» stays on screen after the basket grows**  
On min_subtotal the browser drops promoInfo but keeps promoErr/promoMin (app.js:11239-11242) and promoErrText recomputes the shortfall against the live cart (:11200-11201); the error is only cleared by typing in the box, «убрать», or a finished order — never by a cart change.  
_Fix (one-line):_ Clear S.promoErr/S.promoMin whenever the cart changes, or hide the message once the shortfall reaches 0.

**«Удалить» on a code showing «использован 0» fails with «Код уже использован»**  
deletePromo also refuses when any order carries the code, paid or not (promos.ts:471-475), and discount_code is written at checkout before payment (orders.ts:1312); the panel offers «Удалить» on used===0 alone (app.js:21471) and the confirm card promises nobody has used it. Wrong sentence, no data harm.  
_Fix (small):_ Restrict the order check to paid orders, or return a distinct error the panel words as «код есть в незавершённом заказе».

### pwa

**On the ET/EN shop the admin and scanner URLs fall outside their manifests' scope, so install is not offered**  
pathFor() prefixes the language segment (app.js:30178), the footer «Админка» button is drawn in every language (10419), and admin.webmanifest/scanner.webmanifest declare scope /shop2/admin/ and /shop2/scan/ — so /shop2/et/admin/ is out of scope and Chrome discards the manifest. The owner can still reach the panel; only the install prompt is lost.  
_Fix (small):_ Force the admin and scan screens onto the unprefixed /shop2/ path, or widen the two manifests' scope to /shop2/.

**No storage listener: installed app and browser tab overwrite each other's basket**  
persist() writes the whole {cart, lang} object over the single localStorage key (app.js:7522, 7628-7630) and there is no storage listener anywhere in app.js, so two open contexts on the same phone can clobber each other's cart. Real but uncommon.  
_Fix (small):_ Listen for the storage event and reload S.cart from localStorage when another context writes it.

### reviews

**«Отменить» races the forward PATCH — the undone review can end up published**  
Both the moderation PATCH and the undo PATCH go through the same branch (app.js:27146) with no in-flight guard, sequence or expected-previous-status, and setReviewStatus is an unconditional UPDATE (reviews.ts:~295). Real, but it needs the first request to commit after the second, so it only bites on a genuinely stalled connection.  
_Fix (small):_ Ignore/queue an undo while the forward PATCH is in flight, or apply the last-tapped status after both settle.

**No idempotency — a lost response makes two identical reviews**  
sendReview's .catch keeps the draft and re-enables the button with «Сейчас не получилось сохранить» (app.js:11041) while addReview is a plain insert with no dedupe key (reviews.ts:~196). The duplicate lands in the pending queue, so the owner sees it before any customer does.  
_Fix (medium):_ Send a client-generated submission id and ignore a repeat of it, or dedupe on (product, email/ip_hash, text) within a few minutes.

**Moderation queue caps at 100 rows while the chips count the whole table**  
The admin route calls listReviews(status) with no limit, taking the default 100 (reviews.ts:233, admin route.ts:38), while reviewCounts() is an uncapped count(*) (reviews.ts:278). No paging control exists in admReviewsHTML, and the error state's «появятся здесь сами» promises a refresh nothing schedules (app.js:11332).  
_Fix (medium):_ Add paging or a «показаны первые 100» line, and drop the self-refresh promise from the error text.

**Product page computes ★ and «Отзывы (N)» from at most 30 rows, ignoring the server's avg/n**  
The route sends the true avg and count (route.ts:45) but app.js keeps only j.reviews (app.js:10927); the heading uses db.length (app.js:10838) and the star line averages the returned rows (app.js:10937-10938). Only wrong once a product passes 30 approved reviews.  
_Fix (small):_ Store j.avg/j.n with the rows and use them for the heading and the ★ line.

**A failed filter refetch leaves the previous status' rows on screen**  
The chip tap sets S.admRevFilter and calls loadAdminReviews(true) without clearing the list (app.js:32712), and a failed refetch only fills S.admReviews when it is empty (app.js:11260, 11266), so the old status' rows keep drawing under the new chip.  
_Fix (small):_ Clear S.admReviews (or mark it stale) on a filter change, and show the error state when the refetch fails.

### settings

**Delivery page error box is dead code — S.shipErr is only ever cleared**  
S.shipErr is declared at app.js:7405 and assigned only "" at 28314 and 32060; the render site at 19184 can therefore never show anything. Dead code, not a live failure — the refusal still reaches the owner as a toast.  
_Fix (one-line):_ Set S.shipErr from the below_cost reply in srvSaved so the refusal stays on the page.

**Tariff cache is dropped only in the instance that served the save**  
shipping.ts:216-218 holds the rules in module state for 60 s and resetShippingRulesCache() (route.ts:137-143) runs in the PUT's process only, so other warm serverless instances keep pricing from the stale copy for up to a minute after a price change.  
_Fix (small):_ Shorten the TTL, or stamp the settings row with updated_at and revalidate against it.

### shipping

**The «Другие страны Европы» courier box changes nothing for any country you can ship to**  
table[country] is read before table[zone] (shipping.ts:640-645) and parseShippingRules seeds a courier cell for all 25 served countries (:301), so the EU cell is reached only by the seven countries Montonio does not serve — which countriesOff switches off by default. The box is editable and effectively inert.  
_Fix (small):_ Hide the zone courier box, or make it write the 21 country cells it appears to govern.

**«Остальные страны» → Курьер says an empty box means free delivery, but it is always re-seeded to 9,90 €**  
The hint at app.js:19572 says «пусто — доставка бесплатна», yet setShipRules restores methods from SHIP_RULES_DEFAULT (courier.default 9.9) with no "default" key in the MONTONIO_PRICE loop (6709-6721), and parseShippingRules seeds courier.default on the server too (shipping.ts:301). The box cannot stay empty.  
_Fix (one-line):_ Either honour an empty default (store 0) or change the hint to say the cell falls back to 9,90 €.

**The last-resort fallback gives every country Estonia's 59 € free threshold**  
fallbackShipping uses one freeFrom (DEFAULT_SHIPPING_RULES.freeFrom ?? 59) and one non-EE price, ignoring freeFromByCountry: {EU: 200} (orders.ts:374-388). It only runs when the shipping module fails to load or computeShipping throws, so a 60 € Greek order would ship free — rare but real.  
_Fix (small):_ Give fallbackShipping the per-country threshold from DEFAULT_SHIPPING_RULES.freeFromByCountry.

### stock

**Stock history prints UTC timestamps and «Сегодня» starts at UTC midnight**  
The history row prints `String(m.at).slice(0,16).replace("T"," ")` with no conversion (app.js:24758) while the rest of the panel uses toLocaleString, and loadScanToday builds its `since` with setUTCHours(0,0,0,0) (app.js:25311-25313). Times read ~3h early and late-evening scans fall into the wrong day.  
_Fix (one-line):_ Format the move time with the same local-time helper as the journal and compute «Сегодня» from local midnight.

### storefront

**Cart upsell quotes p.price but adds the cheapest rung, so «и доставка бесплатно» can be false**  
applyDemoOverrides sets p.price = p.prices[0] (:26761) — first rung, not cheapest — and DEMO.price rewrites rung 0 (:26770-26773), so p.price can exceed min(p.prices). upsellHTML picks and prints on p.price (:29113-29133) while data-add with no size makes addToCart use cardSizeIdx, the cheapest (:8932-8942), so the add may not close the gap it promised.  
_Fix (small):_ Pick and print the upsell row on shownPrice(p, cardSizeIdx(p.id)), the same number the add will use.

**«Сначала дешевле» sorts on retail price while salon customers see their own prices**  
filtered() sorts on a.price / b.price (:8425-8427, :8437-8439) while cards print shownPrice, which prefers proPrice and honours a per-product proPrices override (:7686-7696, :8944-8947), so a pro customer's grid can come back visibly out of order.  
_Fix (small):_ Sort on shownPrice(p, cardSizeIdx(p.id)) instead of p.price.

**Product JSON-LD prefixes the origin onto already-absolute uploaded photo URLs**  
setHead builds `image: [location.origin + p.img]` (:29384), but applyDemoOverrides replaces p.img with the stored gallery URL (:26798-26805) and the admin stores the absolute R2 url, producing "https://shop...https://pub-....r2.dev/..." for every owner-uploaded photo.  
_Fix (one-line):_ Only prefix the origin when p.img starts with "/".


# Your decision, not a defect (8)

**[pos] Receipt language is the panel's own language and cannot be changed at the till**  
The code does what the finding says: posSend sends lang: S.lang and the language toggle sits in hdrSlot, hidden on admin screens (chromeless). Whether the till needs a per-sale language picker is Renat's call, not a defect.

**[auth] No session revocation: changing the admin password leaves live cookies valid**  
rmp_admin is `v1.<expiry>.<hmac>` bound to nothing but the clock, logout only clears the caller's cookie, and the customer token is the same design for 90 days — so a stolen signed-in phone stays signed in for up to 30 days unless SESSION_SECRET is rotated, which signs every customer out too. That is what the design chose, not a coding error.

**[auth] Shared carrier/Wi-Fi IP can spend a customer's 3-per-15-min code budget**  
code/route.ts:76 checks the per-IP bucket (3 per 15 min) before the per-address one, so shoppers behind one CGNAT or salon address share it; in practice the per-instance Map softens this, since each lambda has its own counters. Whether three per IP is too tight is the owner's call.

**[pwa] No service worker anywhere — the three installed apps are dead without network**  
Verified: grep for serviceWorker over public/, src/, tools/ returns nothing, public/shop2 has no sw.js, and all three manifests declare display standalone. That is accurate, but whether to build offline support is a scope decision, not a defect.

**[invoices] Unpaid invoice orders drop out of their month's export and reappear after it is filed**  
listReportOrders filters on REPORTABLE_STATUSES (no 'new', reports.ts:167) while the month window and the row's Date come from created_at (:274-283, :228), so an invoice issued in September and marked paid in October is absent from the September export and silently present in a later re-export of the same month. Whether the export should be cash- or invoice-dated is an accounting policy call for the owner and his accountant.

**[invoices] Auto-cancel is calendar-only, and after it «Отметить оплаченным» is refused**  
The cancel test is purely `overdue >= cancelAfterDays` (invoice-dunning.ts:259-262) — the shop has no bank feed, so it cannot know a late transfer arrived — and the invoice route then answers order_closed for a cancelled order (route.ts:92-94), so a payment received after the cancel cannot be booked. The cancel policy itself is the owner's decision; the inability to mark a cancelled invoice paid is the part worth fixing.

**[giftcards] A percentage promo discounts gift-card face value — store credit sold below par**  
Gift lines are priced into `lines` and counted in `subtotal` (orders.ts:905-914, 986), and codeDiscount hands that whole subtotal to quotePromo, which has no gift exclusion (orders.ts:1311, promos.ts:181). Four 100 € cards under a −20 % code cost 320 € and are spent later at 400 €; whether promos may apply to gift cards is Renat's call.

**[giftcards] «Действует до …» is printed on the card, the letter and the panel and enforced nowhere**  
giftValidUntil is derived for display only (giftcards.ts:97-105); checkGiftCard, applyGiftCard and redeemGiftCard test balance and voided_at and never created_at (373-380, 397-407, 433-438) — the module comment admits it. Whether old cards should stop paying, or the date should go, is the owner's decision.


# Refuted on the first pass (4)

**[pwa] /shop/content.js frozen outside the asset-token set and already drifted** — The exclusion at tools/lib/asset-token.mjs:36-38 is real and deliberate, but the drift claim is wrong: git shows public/shop/content.js and the `?v=c2` tag in index.html last changed in the same commit (6d46f64), so the file has not moved under its frozen token.

**[privacy] Unsubscribe token falls back to a key published in the repo** — signingKey() does fall back to "rempire-resume-cart" (consent.ts:192-195), but the scenario needs SESSION_SECRET unset or under 16 chars — and in that state makeCustomerToken() throws (customers.ts:145) and readCustomerToken() returns null, so no customer could sign in at all. A working shop always has the secret set, and a forged token only unsubscribes its own address.

**[giftcards] Gift-card letter silently skipped when the recipient address is unsendable** — The storefront's gift-email check and mail.ts's EMAIL_RX are the same pattern (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i), and recipients() splits on commas, so an address the /gift/ page accepts also passes the send side; the described silent skip needs a hand-posted order. Sending only to the recipient, with no copy to the buyer, is the documented design (mail-hooks.ts:336-338).

**[settings] Below-cost guard validates the whole table, so unrelated saves could be refused** — The whole-table validation is real (route.ts:83-98 + app.js:27131), but nothing puts below-cost cells in the stored row: DEFAULT_SHIPPING_RULES.carriers is carrierPriceTable() (= cost), parseShippingRules re-seeds courier from COUNTRY_PRICES, and migrations 148/149 write no carrier cells. The claimed «12 stored cells under the mirror» is not supported by anything in the repo.


# Subsystem notes

**pos** — The till route is honest about money but not about what it promises afterwards: no idempotency, a receipt screen that says «остатки списаны» and «чек ушёл на почту» without checking either, and only two of the server's error codes translated for the cashier. The worst two are the price mismatches between the browser catalogue and src/lib/orders.ts — the register can show one price and the order be written at another. Nothing here shows one customer another customer's data.

**promos** — Promo pricing on the server is honest and atomic, and the consume path is idempotent; the real damage is at the edges — gift-card lines are not excluded from the discount base, the checkout caches only the promo RULE and never reads the server's final total back, and the admin form silently drops the start date and turns an unparseable «uses» into «unlimited». Several findings describe the same two defects from different angles (1/2, 4/7, 9/15, 3+6/11). Nothing here shows one customer another customer's data.

**auth** — Sessions are stateless HMAC cookies and the only throttle is a per-process Map, so anything that depends on shared state (lockout, revocation) is decorative on Vercel. The genuinely expensive items are the refund retry (real money) and the zero-length-key hole in verifyPassword (any password opens the panel on a mangled env var). The rest are config foot-guns and wording, with one unauthenticated write path (carts) that lets a stranger make the shop mail strangers.

**pwa** — The shop2 app still carries its static-prototype "demo mode" wiring into a live shop: postJSON maps every network failure to {offline:true}, and several one-shot background probes latch API.ok=false, which routes the real checkout into finishDemo(). The scanner/stock write path has no rejection handler at all, so a dropped request leaves buttons dead. There is genuinely no service worker anywhere in the repo.

**invoices** — The invoice core (numbering, record, PDF, mark-paid door) is careful; the leaks are all at its edges — the dunning robot bypasses the IBAN/sent guards the issue path respects, the accountant export re-splits VAT at today's rate instead of the rate each invoice froze, and the client-side checkout cannot tell a lost connection from "no API here". Several findings were written twice from different angles; I collapsed those. Nothing here needs a rewrite — each confirmed item is a small, local fix.

**customers** — The customers subsystem is coherent and well-commented; the real defects cluster around money definitions (what counts as a purchase, what points are earned on) and around the loyalty ledger having no reversal path. Twelve of sixteen findings are real, two are duplicates within the file, and none is refuted outright — but several are low-impact edge cases rather than the critical items they were written as. The single most valuable fix is making the customer aggregate use the same paid-status list as every other money query.

**bundles** — Sets are a DB table since migration 120, but three older layers never caught up: the prerendered HTML and public/shop/bundles.js still come from the generator, src/lib/bundles.ts still prices parts from the static catalogue/variants files, and stock is still moved for product lines only. Two seeded prices in the migration contradict the generator output it claims to copy. Five of the sixteen findings are duplicates of earlier ones.

**orders** — The order lifecycle is well commented but leans on read-modify-write over snapshots throughout: the paid transition, the refund ledger and the stock moves all decide from an order fetched before the write, with no conditional UPDATE or lock anywhere. The stock side is one-directional — the paid→cancelled/refunded return move has no inverse — and the panel's «Итого», search and journal report things the server never confirmed.

**blog** — The blog write path is sound in the panel's own flow; almost every real defect is at a boundary — the static prerender layer, the request-time page that never consults the database, and the product-card text that is frozen into the stored body. Two findings describe the same admin empty-state bug. Nothing here exposes customer data.

**products** — The products subsystem's real fault line is that the admin panel reads the shop's PUBLIC feed and mutates a local copy first: anything the feed strips (proPrice) or overwrites (warehouse-derived stock) is invisible or silently ignored in the editor, and hidden catalogue products are dropped from CATALOGUE so their overrides are never applied to the object the editor opens. The second cluster is the size ladder: the cart and the order route address a volume by INDEX while the owner can delete a rung, and the sizes grid rebuilds itself outside render() and loses typed warehouse values. 12 of 16 findings hold; 2 are duplicates and 2 needed correction.

**payments** — The payment/refund core is carefully written and its idempotency rules mostly hold, but three real gaps survive: the payment blob is overwritten before the already-paid check, the refund idempotency key is minted per HTTP request, and the refund webhook's over-refund clamp uses the wrong total and is discarded exactly when it bites. Several findings restate the same defect, so the true count is about ten. Nothing here is reachable by an anonymous attacker; every case needs a double payment, a portal refund, or Renat pressing a button twice.

**privacy** — The consent plumbing itself (stop list, HMAC unsubscribe links, flow guards) is careful; the leaks are at its edges — the admin AI prompt, the unauthenticated write doors (/api/orders, /api/carts), and the missing erasure path. The published Russian policy says two things the code contradicts: that OpenAI gets no personal data, and that visit statistics store only page/language/country/device. Nothing here shows one customer another customer's data on the storefront.

**assistant** — Every finding in this file survived verification — the assistant subsystem is genuinely fragile. Two structural roots explain most of it: one global `pendingAction` shared by the chat card and every panel overlay, and "patch in, whole object out" writes built on client snapshots the admin screen never refreshes (hero, content, pricing). The storefront chat is fed only the static catalogue file, so its stock column and its product list are both wrong against the live shop.

**giftcards** — The gift-card module itself is careful (conditional UPDATEs, unambiguous codes), but everything around it is not: the card is money that no ledger guard, no transaction and no pricing rule treats as money. Most confirmed items are in the seams — the zero-total settle path, the paid-transition race, promos/loyalty counting a card's face value as goods, and the refund route's arithmetic. Expiry, promo-on-gift and one-recipient-per-order are genuine policy questions the owner must answer before anyone codes them.

**analytics** — The money figures are all built from orders.total with no notion of a refund, and the accountant export omits loyalty_discount, so the export neither foots nor matches what the shop kept. The «Обзор» today cell is re-summed in the browser with a different paid rule and a different day boundary than the server field it ignores. The rest are presentation/metric-definition issues on the «Аналитика» screen.

**reviews** — Ten of sixteen findings are real; five are re-statements of an earlier one. The pattern across the subsystem is the same twice over: local state is applied and announced before the server has confirmed anything (admin moderation), and an empty list is treated as proven truth rather than "unknown" (product page). The server-side limits (100 in the queue, 30 on the product page) are real but only bite at volumes this shop is years away from.

**storefront** — Every finding here holds up; nothing was refuted. The root of the three worst ones is the same design choice — `postJSON()` and the `API.ok` latch treat "no server behind this page" (the static prototype mode) and "the server had a bad moment" as the same thing, so a single network hiccup turns a real shop into a fake one. Fixing postJSON to only say `offline` on an explicit 404/405/501 (and never on a rejected fetch or a non-JSON body) closes findings 1, 3 and 4 at once.

**letters** — Verified all 16 against the cited files; 15 confirmed, 1 duplicate, none refuted outright (finding 7's "цена актуальна" line does not exist in the template, but its price bug does). The recurring pattern is stamp-before-send with no un-stamp and consent read once at the start of a run. The unpaid-order flow's cancel query is the single riskiest thing here: no reminder precondition, no lower date bound, no status guard on the write.

**stock** — The real theme is that stock is kept per (product, variant) but every consumer — checkout, the public badge, the admin table, the back-in-stock sweep — collapses or ignores the variant dimension, and the sizes ladder the editor now owns (product_overrides.sizes) was never wired into inventory. The second theme is unconfirmed writes: three separate paths (scanner write-off, clamped moves, POS retry, webhook race) report success or run twice without a per-write guard. Findings 5 and 6 are the same two defects as 2 and 4.

**settings** — The panel treats every settings screen as a whole-document, fire-and-forget write: it applies the change locally, says «Сохранено ✓» and only then fires the PUT, and it never re-reads the server after boot. That one shape is behind most of the confirmed findings (1, 3, 5, 9). The server side is sound apart from the whole-table below-cost guard and the per-process tariff cache.

**i18n** — Most findings are real but small: untranslated or half-translated strings, plural forms, dictionary duplicates. The two that actually matter are the blog translate button (900 output tokens cannot hold two translations of an article, and only post_full/post_translate/newsletter are refused when cut) and its "Черновик готов" toast firing on partial success. Nothing here leaks customer data or loses money.

**shipping** — Fourteen of the sixteen findings hold up; two are restatements of earlier ones (11 of 10, 12 of 9). The pricing core (quoteFromRules, country tables) is careful and well commented, but the seams around it are weak: the label route has no idempotency, the rate panel treats a server refusal as a success, and the settings row is always saved fully materialised, so every "empty box = Montonio price" promise dies at the first save.
