# Questions for Montonio — for the call with Harri

Written 18.09.2026, after reading the Shipping v2 and Stargate documentation
against our integration. Every question states what we already observed, so it
can be answered in one pass rather than two.

Shop: Rempire, Tallinn. Cosmetics, 3–5 orders a month, going live next week.
Sells EE/LV/LT/FI today, wants to sell across Europe.

**Priority 1 blocks going live. Priority 2 costs money if we guess wrong.
Priority 3 is confirmation.**

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

### 7. `GET /v2/contract-prices` — is it supported?

Our tariff mirror has been built from this endpoint. It is **not in the
documentation**, needs no key, and returns a single `pickupPoint` price with no
subtype breakdown.

- Is it a supported endpoint we may rely on, or the public calculator's internal
  backend that could change without notice?
- Should we move entirely to `POST /shipping-methods/rates` with keys?

### 8. Locker size and the drop-off code

Renat reported the drop-off code missing from SmartPosti labels. The guide says
that with neither a request `lockerSize` nor a contract `defaultLockerSize`, *no
code is issued at all*.

- Where exactly is `defaultLockerSize` set on the contract, and what values does
  it take?
- Does locker size change the **price**, and if so by how much?
- For DPD you mention a PIN service on the carrier account — how do we enable it?

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

### 11. Nova Post returns

We were told Nova Post supports no returns at all.

- Is that still true? It affects whether we offer it outside the Baltics.

### 12. Anything else that differs between sandbox and live

We know sandbox skips phone and address validation, does not call carriers, and
generates dummy labels.

- Is there anything else that behaves differently, which a merchant typically
  discovers only after going live?

---

## Also useful

- Do you notify merchants when an API or an endpoint changes?
- Is there a status page or a channel for incidents?
- Who do we contact when a payment webhook stops arriving?
