# Montonio Shipping v2 — pre-production audit

Read against the whole of `https://docs.montonio.com/api/shipping-v2` on 18.09.2026:
the [Overview](https://docs.montonio.com/api/shipping-v2/overview), the
[API reference](https://docs.montonio.com/api/shipping-v2/reference) (one page, every
endpoint), and all five guides —
[webhooks](https://docs.montonio.com/api/shipping-v2/guides/webhooks),
[shipping methods](https://docs.montonio.com/api/shipping-v2/guides/shipping-methods),
[shipments](https://docs.montonio.com/api/shipping-v2/guides/shipments),
[labels](https://docs.montonio.com/api/shipping-v2/guides/labels),
[sandbox](https://docs.montonio.com/api/shipping-v2/guides/sandbox).

The reference lists exactly thirteen endpoints and nothing else:

| | |
|---|---|
| `GET /carriers` | `POST /shipping-methods/filter-by-parcels` |
| `GET /shipping-methods` | `POST /shipping-methods/rates` |
| `GET /shipping-methods/pickup-points` | `POST /shipments` · `PATCH /shipments/{id}` · `GET /shipments/{id}` |
| `GET /shipping-methods/courier-services` | `POST /label-files` · `GET /label-files/{id}` |
| | `POST /webhooks` · `GET /webhooks` · `DELETE /webhooks/{id}` |

Organised by consequence. **Fixed on this branch** and **Recommended (not
implemented)** are marked on every item; nothing that changes what a customer is
charged, or that needs a decision about which product we buy from Montonio, was
touched.

---

## 1. Wrong, and it costs money or breaks an order

### 1.1 Every shipping webhook is silently thrown away — **FIXED**

The webhooks guide prints the decoded JWT in full. The status, the order
reference and the tracking number are **inside a `data` object**, not at the top
level:

```json
{ "eventId": "…", "shipmentId": "87f55147-…", "created": "…",
  "data": { "id": "…", "status": "registered", "merchantReference": "order 1",
            "parcels": [ { "carrierParcelId": "CC548936341EE", … } ], … },
  "eventType": "shipment.registered", "iat": …, "exp": … }
```

`readEvent()` — now at `src/lib/shipping/webhook.ts:115`, and at `:93` before
this branch — looked only at the top level of the claims and at a
`claims.shipment` object that does not exist:

```ts
status: pick("status", "shipmentStatus", "state"),
orderRef: pick("merchantReference", "orderReference", "orderNumber"),
```

So `status` and `orderRef` came back `""` on every real notification.
`recordShipmentStatus()` returns early on an empty word
(`src/lib/shipping/webhook.ts:271`), and the route answers
`{ ok: true, ignored: "no_status" }` with HTTP 200
(`src/app/api/shipping/notify/route.ts:96-99`) — understood, nothing written, no
redelivery.

Consequences, all three of them silent:

* `settings.shipping_statuses` — the field notebook this endpoint exists for —
  would have stayed empty for ever. The whole point of the route
  (`src/app/api/shipping/notify/route.ts:31-37`) never happened.
* No order is ever auto-closed from a webhook. `delivered` arrives, is read as
  `""`, and the order sits in «В пути» until the nightly cron polls
  `GET /shipments/{id}` or `autoDays` expires.
* `shipment.registrationFailed` — the event that says the carrier **refused the
  parcel** — is discarded the same way. A shipment booked asynchronously that
  the carrier rejects is invisible to this shop.

**Why it was not caught:** `tests/shipping-webhook.test.ts:30-38` builds the
fixture token flat —

```ts
signHs256({ event: "shipment.statusUpdated", shipmentId: …, merchantReference: …, status: "delivered" }, …)
```

— so the code was written to match the test fixture rather than the documented
payload, and the suite has been green the whole time. The fixture was invented;
the docs had a full worked example.

Fixed: `readEvent()` now searches `claims.data` (the documented home) as well as
the top level, and reads the tracking number from `data.parcels[0].carrierParcelId`.
`orderId` is accepted alongside `merchantReference` because Montonio's own
example token still encodes the older spelling. The flat shape keeps working, so
nothing that already passed regressed.

### 1.2 `phoneCountryCode` is Estonia's for 28 of the 32 countries we ship to — **FIXED**

`receiver.phoneCountryCode` and `receiver.phoneNumber` are **required** for both
`courier` and `pickupPoint` shipments (reference § Create Shipment → receiver).
The shipments guide names the failure mode outright: *"A common issue causing
this [`registrationFailed`] is an incorrect receiver phone number."*

`PHONE_PREFIX` at `src/lib/shipping/montonio.ts:771` held four entries —
`EE 372, LV 371, LT 370, FI 358` — and `splitPhone()` at
`src/lib/shipping/montonio.ts:810` fell back to `"372"` for everything else:

```ts
phoneCountryCode: PHONE_PREFIX[String(country || "").toUpperCase()] ?? "372",
```

The checkout sells to 32 destinations (`tools/fetch-montonio-tariffs.mjs:91-95`).
A German customer typing `0151 23456789` was booked as `+372 015123456789`; an
Italian, a Pole, a Czech — all Estonian. A carrier that validates the number
rejects the shipment; one that does not simply cannot reach the customer with
the collection SMS.

This is the single thing most likely to appear only in production. The
[sandbox guide](https://docs.montonio.com/api/shipping-v2/guides/sandbox) says
plainly: *"The POST /shipments endpoint skips phone number and address
validation."* Every sandbox booking we have ever made passed with a wrong
country code.

Fixed: `PHONE_PREFIX` now covers all 32 destinations, and `splitPhone()` was
restructured so that a bigger table is safe. A number written in international
form (`+…` or `00…`) has its code detected from the whole table, longest match
first. A bare number keeps the destination country's code, and is still scanned
for the four prefixes this function has always recognised bare — `372`, `371`,
`370`, `358` — and for no others. Extending that scan to all 32 would have been
worse than the bug: `45…` is Denmark's calling code *and* a complete Danish
number, `39…` is Italy's *and* an Italian mobile, so a whole-table scan
truncates real subscriber numbers.

Deliberately **not** done: nothing touches a national trunk `0`. Germany drops it
(`0151…` → `+49 151…`), Italy keeps it for landlines (`06…` → `+39 06…`), and a
per-country rule is exactly the kind of invention that put `372` on a German
parcel to begin with. So `0151 23456789` to Germany now books as `+49
015123456789` — the country code is right, the trunk zero is still there. That
residue is a known, narrower risk, and it belongs with 1.4/1.5: the documented
cure for a number a carrier will not take is `PATCH /shipments/{id}`, which we
do not have yet.

### 1.3 `products[].quantity` is not clamped to the documented maximum — **FIXED**

Reference § Create Shipment → products: *"quantity — Product quantity. Max value
is 999."* The product mapper (`src/lib/shipping/montonio.ts:1078-1086`) did
`Math.max(1, Math.round(Number(i.qty) || 1))` with no ceiling. One oversized line
makes Montonio answer 400 and **the entire shipment fails to book** — the
products array is tracking-page and pick-list metadata, so losing the exact
count on one absurd line is strictly better than losing the parcel. Clamped to
999.

### 1.4 A shipment the carrier refused is reported to the owner as success — **RECOMMENDED**

We book with `synchronous: true` by default (`src/lib/shipping/montonio.ts:1094`).
The shipments guide: *"the response will include the final registration status"* —
`registered` **or** `registrationFailed`.

`createMontonioShipment()` copies the status through verbatim
(`src/lib/shipping/montonio.ts:1120`) and `POST /api/admin/shipments`
(`src/app/api/admin/shipments/route.ts:117-147`) never looks at it: it stores the
row, writes `shipment.create` to the journal and answers `ok: true`. Renat sees
«этикетка создана» for a parcel the carrier turned down. The follow-up
`POST /label-files` then fails, or produces a label for a parcel that is not
registered.

Not fixed here because it needs a product decision: refuse the booking and
release the slot (the parcel really does exist at Montonio, just unregistered),
or store it and show a red step on the card. Either way the fix belongs with
`PATCH /shipments/{id}` below — the two are one feature.

### 1.5 `PATCH /shipments/{id}` is the documented repair for a failed registration, and we never call it — **RECOMMENDED**

Shipments guide: *"you can update the Shipment, and the system will
automatically attempt to register the Shipment again"*, for shipments in
`registrationFailed` or `registered`. The worked example is exactly a corrected
receiver phone number.

Nothing in `src/lib/shipping/montonio.ts` issues a PATCH. Combined with 1.1 and
1.4, a shipment that fails registration is (a) not reported by webhook, (b)
reported to the owner as a success, and (c) unfixable from the panel. The parcel
is paid for and will never move.

### 1.6 `constraints.parcelDimensionsRequired` is never read — **RECOMMENDED**

`GET /shipping-methods` returns, per carrier/method/country, a
`constraints.parcelDimensionsRequired` boolean, and the reference puts a Note
next to it: *"When true, the length, width, and height fields must be provided
for each parcel in the shipment request… Always check the flag in the API
response."*

`fetchMontonioPickupCarriers()` (`src/lib/shipping/montonio.ts:336-357`) and
`resolveCourierService()` (`src/lib/shipping/montonio.ts:930-940`) both parse the
`/shipping-methods` response and both read only `shippingMethods[].type`;
`constraints` is dropped. `POST /api/admin/shipments` never passes
`length`/`width`/`height` (`src/app/api/admin/shipments/route.ts:117-120`), so
`createMontonioShipment()` sends `parcels: [{ weight }]` alone
(`src/lib/shipping/montonio.ts:1063-1068`).

Where the flag is true, every booking on that route gets a 400. Not fixed because
picking a box to declare is a decision about the shop's packaging, not a wrong
constant — and inventing dimensions to satisfy a validator can move a parcel into
a different size tier, which is a price change. Recommendation: read the flag,
and either surface a required dimensions input on the order card or store a
default carton in settings.

---

## 2. Wrong, but harmless

### 2.1 The `accessKey` check on the shipping webhook can never fire

`src/lib/shipping/webhook.ts:161-165` refuses a token whose `accessKey` claim
names another store, "the same check, in the same place, as the payment
webhook's `verifyToken()`". The documented shipping webhook JWT carries
`eventId`, `shipmentId`, `created`, `data`, `eventType`, `iat`, `exp` — and no
`accessKey`. The check is written `if (claims.accessKey && …)`, so it is a no-op
rather than a bug, and the signature is still the real boundary: only a holder of
our secret can mint one. Left as it is — it costs nothing and it is correct if
Montonio ever adds the claim.

### 2.2 The returns comment miscounts the sub-paths

`src/lib/shipping/montonio.ts:596-601` enumerates the API as "/carriers,
/shipping-methods and its three sub-paths, /shipments, /label-files, /webhooks —
and nothing else". There are **four** sub-paths: `pickup-points`,
`courier-services`, `filter-by-parcels`, `rates`. The conclusion the comment
draws is still right: there is no returns endpoint, no return shipment, no return
label and no return webhook anywhere in the reference.

### 2.3 The label URL comment omits the expiry that actually matters

`src/lib/shipping/montonio.ts:1214-1221` says the URL is "a pre-signed S3 link — no
Authorization header". True, and incomplete: the reference puts a Note on both
`POST /label-files` and `GET /label-files/{id}` — *"Once the label is created,
the label URL will last 5 minutes, after which it will no longer be accessible.
To get a fresh URL, make a new request."* We store that URL on the order
(`src/app/api/admin/shipments/[id]/label/route.ts:82`), so the stored one is dead
five minutes later — but the route already tries the stored URL and falls through
to a fresh label on any failure
(`src/app/api/admin/shipments/[id]/label/route.ts:69-85`), so behaviour is
correct. Only the comment is short of the fact.

### 2.4 `GET /label-files/{id}` was removed as "never wired up"

`src/lib/shipping/montonio.ts:1209-1212` records that the fetch-an-existing-label
call was deleted because "the panel simply asks for the label again". That is a
defensible choice given the 5-minute expiry — a fresh `POST` is genuinely the
cheaper path. Worth knowing that it is also the documented way to recover from
`labelFile.ready` if label generation ever moves to the async flow.

---

## 3. Things we do that the docs do not mention

### 3.1 The tariff mirror is built from an undocumented, unauthenticated endpoint

`tools/fetch-montonio-tariffs.mjs:61` fetches
`GET https://shipping.montonio.com/api/v2/contract-prices?carrierCode&shippingMethod&source&destination&weight&length&width&height`
with no Authorization header. **This endpoint does not appear anywhere in the
Shipping v2 reference.** It is the backend of Montonio's public shipping
calculator, and the file says so honestly
(`tools/fetch-montonio-tariffs.mjs:19-30`).

It works, and it is the only source of prices when no keys are set — but it is
outside the contract. If Montonio changes or removes it, `src/data/montonio-tariffs.json`
silently stops being rebuildable, and the run exits 1 with "Montonio quoted
nothing at all" (`tools/fetch-montonio-tariffs.mjs:292-297`), which is the right
failure. The documented alternative is `POST /shipping-methods/rates`, which the
same script already uses as source 1 (`tools/fetch-montonio-tariffs.mjs:234-262`)
— but that one needs keys and, per the reference Note, *"only returns rates for
carriers with Montonio contracts."*

One consequence worth naming, because it touches question 1 below:
`contract-prices` takes a single `shippingMethod=pickupPoint` and returns one
price. The documented `/shipping-methods/rates` splits that into **per-subtype**
rates — `parcelMachine`, `parcelShop`, `postOffice` each with their own `rate`.
So when the mirror is built without keys, a country's "parcel" cost is
subtype-blind: it may be the parcel-shop price where the shop actually sells a
locker. With keys, `flatten()` prefers `parcelMachine`
(`tools/fetch-montonio-tariffs.mjs:272-274`) and the number is right.

### 3.2 Dropping a rate of exactly `0`

`src/lib/shipping/montonio.ts:503-514` drops any subtype whose `rate` is `0`,
on the observed grounds that Montonio answers `"rate": "0"` for a carrier/method
pair the store has no priced tier for. The docs never mention a zero rate; what
they do say is that carriers without a Montonio contract are simply **absent**
from the response. The guard is sound defensive coding and the reasoning written
next to it is correct about the consequence (a €0 basis would have become a
shelf price). Keep it, but it is observed behaviour, not documented behaviour.

### 3.3 Reading `type` locally instead of asking for it

`fetchOneCarrier()` (`src/lib/shipping/montonio.ts:359-376`) never sends the
documented `type` query parameter and filters in
`fetchMontonioPickupPoints()` instead (`src/lib/shipping/montonio.ts:410-417`).
Deliberate and right — it makes the six-hour cache one entry per carrier+country
instead of one per carrier+country+type.

---

## 4. What the docs require that we do not do at all

| Requirement | Doc | Our code |
|---|---|---|
| Read `constraints.parcelDimensionsRequired` and send dimensions when true | reference § Get shipping methods, Note | never read — `src/lib/shipping/montonio.ts:329`, `:933` |
| React to `shipment.registrationFailed` | webhooks guide, event table | event discarded — see 1.1 |
| Repair a failed shipment with `PATCH /shipments/{id}` | shipments guide § Updating a Shipment | no PATCH anywhere |
| `lockerSize` for Unisend / Latvian Post / SmartPosti | reference § Create Shipment → shippingMethod | never sent — `src/lib/shipping/montonio.ts:1040-1047` |
| `parcelHandoverMethod` for Unisend | reference § Create Shipment → shippingMethod | never sent |
| Check `additionalServices` before requesting one | reference § Get pickup points, Note | we request none, so nothing to check |

`lockerSize` is worth a line of its own. It is optional, and omitting it falls
back to the contract's `defaultLockerSize` — but the shipments guide
§ Marketplaces and drop-off codes says that for **SmartPosti**, with neither a
request value nor a contract default, *"no code is issued at all"*. The A4 label
slip prints that code (`src/lib/shipping/label-pdf.ts:39`, `:225`) and Renat
asked for it specifically (13.09.2026, «no drop-off code for the locker is
shown»). So: either set `defaultLockerSize` on the SmartPosti contract in the
Partner System, or start sending `lockerSize`. This is a purchasing decision —
locker size is a price tier — so it is a recommendation, not a fix.

Two smaller notes from the same section, both in our favour: **Omniva** needs
nothing enabled — for an EE→EE parcel-machine shipment, `dropOffPin` is a copy of
`carrierParcelId`. And **DPD** needs the PIN service enabled on the carrier
account.

---

## 5. Comments in our code that the documentation contradicts

Listed separately and on purpose. Each one is a confident sentence that is
false, and a wrong guess written confidently is worse than no comment at all:
each of these stopped somebody from going and looking.

### 5.1 "`GET /shipments/<id>` … was written and never called … Removed 07.09.2026"

`src/lib/shipping/montonio.ts:1128-1137`, which is the corrected note; the false
one stood there until today. The function it said had been removed is defined
immediately below it — `getMontonioShipment()` at
`src/lib/shipping/montonio.ts:1142` — and it has two callers:
`src/lib/delivery.ts:217-219` (the nightly close) and
`src/app/api/admin/shipments/[id]/label/route.ts:106` (filling in a missing
drop-off pin). The comment describes a state of the world that was reversed and
never un-written. **Corrected on this branch.**

### 5.2 "the vocabulary of that field is not in the reference we have"

`src/lib/delivery.ts:86-96` and, repeating it,
`src/lib/shipping/webhook.ts:1-40`. It is in the reference. The
[Overview](https://docs.montonio.com/api/shipping-v2/overview) prints the whole
shipment lifecycle — `pending`, `registered`, `registrationFailed`,
`labelsCreated`, `inTransit`, `awaitingCollection`, `delivered`, `returned` — and
the shipments guide repeats it: *"the status can change from registered to
inTransit, awaitingCollection, delivered, or returned."*

The irony is that `src/lib/delivery.ts:118-124`, a couple of dozen lines below
the claim, quotes that exact list and cites the doc page for it. Two comments in
one file, disagreeing about whether the docs answer the question.

The allow-list itself (`looksDelivered`/`looksReturned`,
`src/lib/delivery.ts:108-137`) is **correct against the documented vocabulary**:
`delivered` matches, `returned` matches, and — importantly —
`awaitingCollection` does not match either, which is right, because a parcel
waiting in a locker has not reached the customer. So the code is fine and only
the justification was invented. **Comments corrected on this branch; the
allow-list is untouched.**

### 5.3 "Montonio's webhook guide … does not print a sample of the claims"

`src/lib/shipping/webhook.ts:93-114`. The guide prints a complete decoded token,
nested `data` object and all, plus a `switch (decoded.eventType)` example and a
`decoded.data.status === 'registered'` example. This is the comment that caused
finding 1.1: because the claim names were believed to be unknowable, they were
guessed at, the guesses were encoded in the test fixture, and the fixture made
the guesses look right. **Corrected on this branch.**

### 5.4 Comments the docs **confirm** — checked, and correct

Worth recording so nobody re-audits them:

* `src/lib/shipping/montonio.ts:106-114` — pickup points carry no coordinates.
  Correct: the reference's field list for `GET /shipping-methods/pickup-points`
  is `id, name, type, streetAddress, locality, postalCode, carrierCode,
  additionalServices`, and no more.
* `src/lib/shipping/montonio.ts:140-143` — shipment dimensions are **metres**.
  Correct, and counter-intuitive: reference § Create Shipment → parcels says
  *"height should be measured in meters"*, three times.
* `src/lib/shipping/montonio.ts:427` — rate-quote dimensions are **centimetres**.
  Also correct, and yes, the two endpoints really do differ:
  `POST /shipping-methods/rates` takes `items[].dimensionUnit` with `cm` as the
  default, which `fetchMontonioRates()` sends explicitly
  (`src/lib/shipping/montonio.ts:484`). The one that has no unit field at all —
  `POST /shipping-methods/filter-by-parcels` — is metres, like `/shipments`.
* `src/lib/shipping/montonio.ts:19-22` — auth is a Bearer JWT with `accessKey`
  and `exp`, HS256. Exactly the reference § Authentication table. The one-hour
  TTL at `src/lib/shipping/montonio.ts:47` is the documented recommendation.
* `src/lib/shipping/montonio.ts:594-609` — there is no returns API. Confirmed
  against all thirteen endpoints.

---

## The six questions, answered

**1. `parcelMachine` versus `pickupPoint`.** Confirmed, and the framing can be
made sharper than "a pricing product". `parcelMachine` was never a shipping
method: reference § Create Shipment gives `shippingMethod.type` exactly two legal
values, `courier` and `pickupPoint`, and `POST /shipping-methods/rates` gives its
`shippingMethodType` query parameter the same two. `parcelMachine` lives one
level down, as a `subtypes[].code` under a `pickupPoint` method and as a pickup
point's own `type`. The endpoint the 400s came from — `contract-prices`, § 3.1 —
is undocumented, but its `shippingMethod` parameter is plainly the same
two-valued thing: it answers for `pickupPoint` and `courier` and rejects a
subtype, in Estonia exactly as everywhere else. Which is why DPD's 358 Estonian
lockers were never evidence of anything: the 400 was about the parameter, never
about the hardware.
**A DPD locker anywhere is booked as `{ type: "pickupPoint", id: <the point's
UUID> }`** — reference § Get pickup points: *"id — The unique identifier of the
pickup point. Use this as the shippingMethod.id when creating a shipment"* — and
that is already what `src/lib/shipping/montonio.ts:1042` does. It is priced at the
`parcelMachine` subtype's own `rate`, distinct from `parcelShop` and
`postOffice`; the label is made from `shipmentIds` alone and does not know the
subtype exists. **Nothing in the API blocks lockers outside the Baltics.** The
one real caveat is ours, not Montonio's: see 3.1 — a mirror built without keys
prices `pickupPoint` as a single number and may be quoting the parcel-shop tier.

**2. `carrierCode` case sensitivity.** The documentation never prints the enum —
every example uses `omniva`, and the only complete list anywhere is the one in
Montonio's own 400 message, quoted at `src/lib/shipping/montonio.ts:69-74`:
`smartpost, dpd, venipak, omniva, unisend, latvian_post, inpost, orlen,
novaPost, postnord`. Against that list, `SHOP_CARRIERS`
(`src/lib/shipping/country-prices.ts:105`) = `omniva, smartpost, dpd, unisend,
novapost`: four are lowercase on both sides and correct, and `novapost` is the
only one needing translation, which `MONTONIO_WIRE_CODE`
(`src/lib/shipping/montonio.ts:82`) does. `tools/fetch-montonio-tariffs.mjs:83`
spells it `novaPost` directly. **No other carrier code is wrong**, and the
round-trip is safe: responses are lowercased on the way in
(`src/lib/shipping/montonio.ts:336`, `:496`, `:939`) and re-cased on the way out.

**3. An order- or shipment-status endpoint.** `GET /shipments/{shipmentId}`
exists, is documented, **and we already call it** — `getMontonioShipment()` at
`src/lib/shipping/montonio.ts:1142`, from `src/lib/delivery.ts:219` and
`src/app/api/admin/shipments/[id]/label/route.ts:106`. The earlier analysis that
concluded otherwise is the stale comment at
`src/lib/shipping/montonio.ts:1128-1137`; there is no hole here, only a comment
that said there was. The reference even recommends this endpoint by name for
picking up a late `dropOffPin`: *"Wait for the registered status (via the
registration webhook or by polling GET /shipments/{id})"*.

**4. Webhooks.** Yes — six events: `shipment.registered`,
`shipment.registrationFailed`, `shipment.statusUpdated`,
`shipment.labelsCreated`, `labelFile.ready`, `labelFile.creationFailed`, up to 10
webhooks per store, sent from `35.156.245.42` and `35.156.159.169`. We do verify
them, correctly: HS256 with our own secret, via `verifyHs256()`
(`src/lib/shipping/webhook.ts:156`), which is what the guide requires
(*"The token is signed with your Secret Key and needs to be validated"*). What we
did **not** do was read the payload — see 1.1, now fixed. What we still do not do
is act on `shipment.registrationFailed` (1.4/1.5).

**5. Label creation and tracking.** To be bookable a shipment needs
`shippingMethod{type,id}`, `parcels[].weight`, and a receiver with `name`,
`phoneCountryCode` and `phoneNumber` — plus `streetAddress`, `locality`,
`postalCode`, `country` when the method is `courier`. We send all of them
(`src/lib/shipping/montonio.ts:1049-1095`), and the conditional address is
correctly conditional (`:1056-1061`). Two things were wrong in shape:
`phoneCountryCode` (1.2) and unclamped `products[].quantity` (1.3), both fixed.
One thing is conditionally mandatory and never sent: dimensions when
`parcelDimensionsRequired` is true (1.6). Labels are right — `POST /label-files`
with `shipmentIds`, `pageSize`, `labelsPerPage`, `orderLabelsBy`, `synchronous`
(`src/lib/shipping/montonio.ts:1191-1198`), every value inside the documented
enums, and the 5-minute URL expiry is survived by the retry at
`src/app/api/admin/shipments/[id]/label/route.ts:69-85`.

**6. Sandbox versus live.** The sandbox guide names four differences, and the
first is the one that will bite:

* *"The POST /shipments endpoint skips phone number and address validation."*
  Every wrong `phoneCountryCode` we have ever sent passed in sandbox. This is
  finding 1.2, and it is why it counted as a fix rather than a nicety.
* *"It doesn't make actual calls to carrier APIs and provides mocked responses
  instead."* So `registrationFailed` has never happened to us —
  the paths at 1.4 and 1.5 are not merely untested, they are unreachable in
  sandbox.
* *"The system generates dummy labels."* `normaliseLabelPdf()`
  (`src/lib/shipping/label-pdf.ts`) rewrites a real Montonio label into one
  label per sheet. It has never seen a real one. A file it does not recognise is
  served unchanged (`src/app/api/admin/shipments/[id]/label/route.ts:126-130`),
  so the failure is soft — but the A4 order slip Renat asked for may not appear
  on the first live label.
* Tracking shows nothing real, because nothing ships.

Plus one the guide does not spell out: `contract-prices` (3.1) is always fetched
from the **live** host with no auth, regardless of `MONTONIO_ENV`
(`tools/fetch-montonio-tariffs.mjs:60-61`). The mirror is live-priced even in a
sandbox checkout — which is what we want, and worth knowing.

---

## What changed on this branch

Fixed — all three are a wrong constant, a wrong field path, or a missing
documented bound. None of them changes what a customer is charged.

1. `src/lib/shipping/webhook.ts` — read the claims out of `data`, per the
   documented payload.
2. `src/lib/shipping/montonio.ts` — `PHONE_PREFIX` covers every destination;
   `splitPhone()` only detects a prefix on an internationally-written number.
3. `src/lib/shipping/montonio.ts` — `products[].quantity` clamped to 999.
4. Comments at `src/lib/shipping/montonio.ts:1128`, `src/lib/delivery.ts:86`,
   `src/lib/shipping/webhook.ts:93` corrected.

Recommended, not implemented — each needs a decision, or moves money:

1. Act on `shipment.registrationFailed` and expose `PATCH /shipments/{id}`
   (1.4, 1.5). Highest value now that the webhook payload is readable.
2. ~~Read `constraints.parcelDimensionsRequired` and declare a carton (1.6).~~
   **Done on `r24-shipping`, 18.09.2026.** The flag is read per
   carrier/method/country (`parcelDimensionsRequired()` in
   `src/lib/shipping/montonio.ts`) and, where it is true, the shop's declared
   carton goes out in metres. The carton is `settings.shipping_parcel`
   (`src/lib/shipping/parcel.ts`), 25 × 18 × 10 cm by default and editable in
   the panel, with a one-tap per-parcel override on the order card.
3. ~~Set `defaultLockerSize` on the SmartPosti contract, or send `lockerSize`~~
   **Half done on `r24-shipping`.** `lockerSize` is now sent, chosen at label
   time from a default derived from the last twenty labels. The contract's own
   `defaultLockerSize` is still worth setting as the safety net and the panel
   says so — that half is in Montonio's Partner System and is the owner's.
4. Rebuild the tariff mirror **with keys**, so locker prices come from the
   `parcelMachine` subtype rather than a subtype-blind `contract-prices` row
   (3.1). ~~Do this before offering lockers outside the Baltics.~~ The lockers
   were opened first, on the owner's decision of 18.09.2026 knowing the prices
   are approximate — a wrong tier lands on the margin and never on the
   customer, because the shop charges one fixed price per country. It is still
   the first thing to re-check once the keys land.
5. **New, found while doing 2.** `fetchMontonioRates()` discards
   `calculationDetails.estimatedParcels[]`, and that block is where Montonio
   states `chargeableWeight` as *«max of actual and volumetricWeight»*. The
   reference's own worked example is 20 × 15 × 10 cm → `volumetricWeight` 0.75
   kg, which is 3000 cm³ over 4000 — or over 5000 with the documented
   `bufferApplied` on top. Either way the divisor is **not** documented, only
   the example. Reading that block would let the shop see what it is actually
   billed for instead of inferring it.
