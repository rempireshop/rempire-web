# Questions for Montonio — for the call with Harri

Written 18.09.2026, after reading the Shipping v2 and Stargate documentation
against our integration. Every question states what we already observed, so it
can be answered in one pass rather than two.

Shop: Rempire, Tallinn. Cosmetics, 3–5 orders a month, going live next week.
Sells EE/LV/LT/FI today, wants to sell across Europe.

**Priority 1 blocks going live. Priority 2 costs money if we guess wrong.
Priority 3 is confirmation.**

**Answers, 24.09.2026.** Montonio support answered Dim's follow-up letter of
22.09.2026 (the one to Harri, which numbered its questions differently: its
«1. Mahukaal» is § 6 here, «(4.3) tagastussilt» § 11, «(5.1) webhookid» § 13,
«(5.3) registrationFailed» § 10, «3. contract-prices» § 7). Each answer is
quoted briefly under the question it answers, with what the code did about it.
The full text is kept outside the repo; the hard evidence Dim gathered the
same day to read the answer against is verbatim in
`docs/montonio-evidence-2026-09-24.txt` (the live calculator bundle's route
entries and live `GET /v2/contract-prices` answers).

---

## Priority 1 — we cannot go live without these

### 1. Refunds cannot be tested at all before going live

«Refundable bank payments» cannot be activated in test mode — the Partner System
says *«Product activation unavailable in test mode. Switch to live mode to
proceed.»* We tried three refunds in sandbox and all three were refused.

- Is «Refundable bank payments» enabled on our live account, and if not, what
  activates it and does it cost anything?
- Is it correct that «Bank payments» alone gives **no** refunds at all?
- **Is there any way to exercise a refund before we are live with real
  customers?** Right now our first ever refund will be a real customer's money.

### 2. Bank payments themselves appear untestable in sandbox

Our notes from 08.09 say the sandbox reports bank payments as unavailable. If
that is right, then payment initiation — the method most of our customers will
use — has never once been answered by Montonio in testing.

- Can payment initiation be tested in sandbox at all? If not, what do you
  recommend a merchant do to gain confidence before the first real order?
- Is there a test bank, a simulator, or a staged live mode?

### 3. A locker booked as a pickup point — what is charged, and does the label work?

This decides whether we can sell outside the Baltics.

`GET /shipping-methods` gives `shippingMethod.type` only `courier` or
`pickupPoint`, with `parcelMachine` as a **subtype**. Your points list types DPD
points as `parcel_machine` or `pickup_point` — Italy 692 lockers among 12 048
points, Poland 12 360 among 33 603.

- If we create a shipment with `type: "pickupPoint"` and the customer's chosen
  point is a **locker**, is it charged at the `parcelMachine` subtype rate or the
  `parcelShop` rate?
- Does the label and the drop-off flow work normally for a locker booked this
  way?
- Is there anything else we must send so the carrier treats it as a locker?

### 4. Which carriers and which countries do we actually have contracts for?

`GET /carriers` carries `hasMontonioContract` and a `contracts[]` per country,
and `POST /shipping-methods/rates` *"only returns rates for carriers with
Montonio contracts"*.

- Please confirm, per carrier, which countries our account can sell to today.
- Is anything pending or needing activation on our side?

**Answers, 24.09.2026 — how international prices work, per carrier.**
Montonio: «International shipments have different logic behind prices for
different carriers: DPD: depending on the route, either a flat rate, weight
only, or a box size category (XS/S/M/L) — not a volumetric weight divisor.
SmartPosti has courier deliveries only and there pricing is based on real
weight tier. Novapost as in point one [real weight].»

*«SmartPosti has courier deliveries only» was read against Montonio's own route
matrix, not on its own* — on its own it would strip the SmartPosti lockers in
Latvia, Lithuania and Finland. The live calculator bundle (evidence file, § 1):

```
[W.SMARTPOSTI]:{…routes:{[X.PICKUP_POINT]:{[de]:[...q,Fe],…},[X.COURIER]:{[de]:[...q,Fe,...ig],…}}…
Decoded: q=[EE,LV,LT], Fe=FI, ig=21 EU countries. SmartPosti pickupPoint EE->[EE,LV,LT,FI]; courier EE->[EE,LV,LT,FI]+21 EU.
```

and live `contract-prices` (§ 2, ex-VAT):

```
smartpost LV pickupPoint -> "pricePerParcel":3.95 "pricingStrategy":"flat" "size":null
smartpost FI pickupPoint -> "pricePerParcel":7.5 "pricingStrategy":"flat" "size":null
smartpost SE pickupPoint -> NONE ([])
smartpost PL pickupPoint -> NONE ([])
smartpost DE pickupPoint -> NONE ([])
smartpost SE courier -> "pricePerParcel":22.7 "pricingStrategy":"weightBased" "size":null
```

So the sentence means **international beyond SmartPosti's own network**: its
lockers are EE, LV, LT and FI (flat price), everywhere else it is a courier
priced by real-weight tier. The shop offers exactly that and nothing was
removed: `CARRIERS_BY_COUNTRY` / `COURIER_CARRIERS` in `public/shop2/app.js`
match the matrix row for row (111 carrier × country × method rows, no
mismatch; Nova Post is left out of EE/LV/LT on purpose), and
`tests/montonio-evidence.test.ts` holds `tools/lib/montonio-routes.mjs`, the
tariff mirror and the offer to this evidence. The one drift between the bundle
and our copy is deliberate: the bundle lists DPD lockers in Romania, and
`contract-prices` answers `[]` for them (direct contract only), so the shop does
not sell them. Staging's points API agrees: SmartPosti points exist in EE (351),
LV (231), LT (301) and FI (1777), and none in SE, PL or DE.

---

## Priority 2 — these cost real money if we guess

### 5. Does `rate` include VAT?

Our two price sources disagree and nothing in the reference says. We currently
treat `POST /shipping-methods/rates` as **excluding** VAT and add 24 %.

- Is that right? Does it differ per country or per carrier?

### 6. Volumetric weight

We believe you bill `max(actualWeight, volumetricWeight)` with volumetric =
L × W × H ÷ 5000, based on `calculationDetails.estimatedParcels[]`.

- Is the divisor 5000 for every carrier and every country, or does it vary?
- Is `bufferApplied` something we control or influence?

This matters more than weight for us: our parcels are a few bottles, so the
declared box is what gets paid for. We are choosing a small default carton
because of it.

**Answers, 24.09.2026.** «Volumetric divisor — confirmed `4000` in
`VolumetricWeightHelper`. For a single parcel item there is 0% height padding,
so 20×15×10cm / 4000 = 0.75kg exactly … For multiple items in one shipment,
the helper adds 15% padding to the combined stacked height before dividing …
Important to know is that our pricing for time being takes into account real
weight. If that will change, then we'd let them know.»

So the divisor we inferred was right, and the premise of this question — that
Montonio bills `max(actual, volumetric)` — was wrong for the price. What
changed (commit «Доставка: цена по настоящему весу…»):

- `MONTONIO_PRICES_VOLUMETRIC = false` in `src/lib/shipping/parcel.ts` is the
  one switch that brings the volumetric rule back if Montonio announces it;
  `chargeableKg()` and `declaredWeightKg()` follow it, and so does the panel's
  copy (`PARCEL_PRICES_VOLUMETRIC`).
- A label now declares **0.9 kg (`ORDINARY_PARCEL_KG`) whatever the box**. Before,
  it declared the volumetric weight of the box on the card — 0.9 kg for the
  default carton, but **6 kg** for a 40 × 30 × 20 «Другая коробка», i.e. the
  6 kg tier on a real-weight tariff.
- The tariff mirror (quoted at 0.9 kg, 25 × 18 × 8) did not move: 0.9 kg is
  now read as a real weight in the same ≤ 1 kg tier. The evidence shows it —
  asked at **0.5 kg** on 24.09, every weight-priced line answers the price the
  mirror holds for 0.9 kg:

```
smartpost PL courier -> "pricePerParcel":12.88 "pricingStrategy":"weightBased" "size":null
dpd DE courier -> "pricePerParcel":19.2 "pricingStrategy":"weightBased" "size":null
```

- For a typical order (1–2 bottles, 0.5–1 kg) in the default carton the
  difference real vs volumetric is **0 €** on every route. It only matters for
  a bigger box (e.g. 40 × 30 × 20 with a kilo in it, courier to Germany:
  SmartPosti 17.55 € on real weight against 22.23 € on volume; DPD 23.81 €
  against 32.74 €).

`bufferApplied` (our second bullet) is the 15 % stacked-height padding for
several items; the shop always sends one item, so it is 0.

### 7. `GET /v2/contract-prices` — is it supported?

Our tariff mirror has been built from this endpoint. It is **not in the
documentation**, needs no key, and returns a single `pickupPoint` price with no
subtype breakdown.

- Is it a supported endpoint we may rely on, or the public calculator's internal
  backend that could change without notice?
- Should we move entirely to `POST /shipping-methods/rates` with keys?

**Answers, 24.09.2026.** Asked in the 22.09 letter as «if `contract-prices` ever
changes, please tell us»: «Yes, we'll let you know!» Not a promise that the
endpoint is supported API, but a promise of warning. The mirror still comes
from it; the 23.09 run with the live keys matched all 111 rows, and
`tests/montonio-evidence.test.ts` pins today's live answers.

### 8. Locker size and the drop-off code

Renat reported the drop-off code missing from SmartPosti labels. The guide says
that with neither a request `lockerSize` nor a contract `defaultLockerSize`, *no
code is issued at all*.

- Where exactly is `defaultLockerSize` set on the contract, and what values does
  it take?
- Does locker size change the **price**, and if so by how much?
- For DPD you mention a PIN service on the carrier account — how do we enable it?

**Answers, 24.09.2026 (price half).** DPD abroad is priced «either a flat rate,
weight only, or a box size category (XS/S/M/L) — not a volumetric weight
divisor». Which one, route by route, is in `contract-prices` itself, and our
carton is DPD's **XS** where the category applies (evidence § 2):

```
dpd PL pickupPoint -> "pricePerParcel":6 "pricingStrategy":"sizeBased" "size":"XS"
dpd DE pickupPoint -> "pricePerParcel":13.2 "pricingStrategy":"sizeBased" "size":"XS"
dpd FI pickupPoint -> "pricePerParcel":9.99 "pricingStrategy":"flat" "size":null
dpd SE pickupPoint -> "pricePerParcel":10.99 "pricingStrategy":"flat" "size":null
```

Every `sizeBased` row of the mirror is `dpd … parcel … XS`, equal to the
calculator's XS cell (`docs/montonio-routes.md`). A bigger box saved in
«Коробка магазина» moves a DPD locker abroad into S/M/L, and the panel warns
about exactly that. (The drop-off code half was answered on 22.09 — not for a
normal merchant.)

---

## Priority 3 — confirmation

### 9. Refund timing and the pending state

The guide says a refund with no settled funds returns `200 PENDING` and retries
for up to ten days, then cancels, with `refundStatusDescription:
INSUFFICIENT_FUNDS` arriving on the webhook.

- Confirm funds take about one business day to settle before a refund can draw
  on them.
- When a pending refund is finally cancelled, do we get a webhook for that too?

### 10. Repairing a refused shipment

- Is `PATCH /shipments/{id}` the right way to correct a shipment that came back
  `registrationFailed`, and which fields can be corrected?
- The most common cause you see is a bad phone or address — is there validation
  we can run *before* booking?

**Answers, 24.09.2026.** «Yes, that's exactly the right and recommended approach
and you don't need to create a new shipment. `registrationFailed` is one of three
states from which a shipment can be updated via PATCH, and PATCH automatically
triggers a new registration attempt with the carrier. If the attempt fails
again, the shipment simply stays in that same `registrationFailed` state
(nothing is lost), and you can just try again. This fits well with the "one
clear button" solution you described.»

Done (commit «Отказ перевозчика чинится той же кнопкой…»): «Создать этикетку»
on a refused parcel asks `GET /shipments/{id}` first (Montonio also retries on
its own, and PATCH on a shipment registered since would register it again),
then PATCHes the SAME shipment with the receiver, parcel and shipping method
rebuilt from the order as it stands now; refused again is the same message, and
the next press tries again. Never a new shipment. Validation before booking
(the second bullet) was not answered.

### 11. Nova Post returns

We were told Nova Post supports no returns at all.

- Is that still true? It affects whether we offer it outside the Baltics.

**Answers, 24.09.2026.** «Returns are currently not supported, we are waiting
behind Nova Post's development.» Still true, and a *not yet*. The shop already
says so where a customer can see it (the «без возврата» card in checkout, the
terms); since 24.09 the order card's return line says it too on a Nova Post
order, instead of «код на возврат присылает перевозчик». **Still pending from
Montonio**: the separate answer on the **DPD return label** (asked as 4.3 in the
22.09 letter).

### 12. Anything else that differs between sandbox and live

We know sandbox skips phone and address validation, does not call carriers, and
generates dummy labels.

- Is there anything else that behaves differently, which a merchant typically
  discovers only after going live?

---

## Asked later — the letter of 22.09.2026

### 13. Parcel webhooks — who registers them, which events, what retries

Asked in the 22.09 letter as (5.1). **Answers, 24.09.2026.** The merchant
registers the webhook with `POST /webhooks`; the full event enum is
`shipment.registered`, `shipment.registrationFailed`, `shipment.statusUpdated`,
`shipment.labelsCreated`, `labelFile.ready`, `labelFile.creationFailed`.
«Retry policy: 15 attempts total. The first retry happens after about 10
seconds, and the interval grows exponentially, so all 15 attempts play out over
roughly 1.5–2 days. Since you rely solely on the webhook for tracking, we'd
still recommend occasionally polling shipment status via GET as a backup.»

Done: the shop subscribes four events (`tools/montonio-webhook.mjs` EVENTS —
the three it had plus `labelsCreated`); the two `labelFile.*` events are about
label PDFs, which the shop makes synchronously, and are acknowledged and
ignored. Because a retried event can arrive two days late, a webhook no longer
moves a parcel backwards. The daily cron re-asks `GET /shipments/{id}` for every
shipment quiet for 12 hours and applies the answer as the webhook would
(`syncStaleShipments`). **The live webhook was registered on 23.09 with three
events and must be registered again with four** — `docs/go-live.md`.

---

## Also useful

- Do you notify merchants when an API or an endpoint changes?
- Is there a status page or a channel for incidents?
- Who do we contact when a payment webhook stops arriving?

**Answer, 24.09.2026, to the first bullet:** for `contract-prices` — «Yes,
we'll let you know!» (§ 7). The other two were not answered.
