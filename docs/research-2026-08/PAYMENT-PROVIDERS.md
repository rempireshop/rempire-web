# Payment providers — is Montonio right for Rempire?

Researched 23.08.2026 against official pricing pages. Basis: €4,000/mo
online, 80 transactions, €50 AOV, Estonian OÜ, custom stack (API, not a
Shopify plugin), sells EE/LV/LT/FI and wants wider EU. All figures ex-VAT
(reclaimable — the company is VAT registered).

## Verdict

**Cheaper than Montonio exists. Better, for this shop, probably does not.**

Stay on **Montonio Core** unless PayPal turns out to be non-negotiable, or
we are willing to trade developer time for roughly €240/year.

## Cost at this volume

Mix (i) = 48 bank + 32 card. Mix (ii) = 80 card (today's reality on Shopify,
which offers no bank links at all).

| Provider | Mix (i) 60/40 | Mix (ii) 100% card |
|---|---|---|
| LHV direct + SEB/EveryPay cards | **€24.00** | **€54.00** |
| **Montonio Core** | **€44.43** | €82.59 |
| Montonio Core, refundable bank payments | €49.23 | €82.59 |
| Montonio Starter | €53.43 | €91.59 |
| MakeCommerce | €60.40 | €76.00 |
| Paysera | €65.00 | €107.00 |
| Mollie | €70.40 | €92.00 |
| Stripe (no EE bank links) | €80.00 | €80.00 |

Montonio Core arithmetic, mix (i): `14.99 + 48×0.05 + 1.29%×1600 +
32×0.20 = €44.43`. Mix (ii): `14.99 + 1.29%×4000 + 80×0.20 = €82.59`.

**A third mix is the one that matters.** Rempire is 100% cards today only
because Shopify Payments offers nothing else. Estonian shoppers prefer bank
links, so the realistic post-migration mix is nearer 80/20, where Montonio
Core costs **€31.71/mo**. Montonio's advantage grows as bank-link share
rises — which is exactly the direction this migration pushes.

## Two findings that overturn assumptions

**1. Montonio charges a flat fee per bank payment; MakeCommerce charges a
percentage.** €0.05 flat (Core) versus 0.9% + €0.05. At €50 AOV that is
**€0.05 vs €0.50 — ten times** the cost. Any intuition that "MakeCommerce is
the cheap Estonian one" is wrong for bank links; it is marginally cheaper on
pure cards only.

**2. Neither Montonio nor MakeCommerce supports PayPal.** Renat selected
PayPal as required in q16. See the open decision below.

## Why Montonio still wins on balance

- **One API covers what would otherwise be four integrations**: bank links
  across EE/LV/LT/FI/PL, cards (via Adyen), Apple/Google Pay, BNPL — *and*
  shipping labels with a parcel-machine picker for Omniva/DPD/SmartPosti at
  €1.99+/parcel with no monthly fee. Renat wants all three carriers plus
  courier; building those integrations ourselves is realistically 40–80
  hours, which dwarfs the ~€240/year saved by going direct.
- **Finnish bank links.** No Estonian bank pangalink reaches Finland. Rempire
  already offers free shipping to FI, so this is a live requirement.
- **Best published card rate of any aggregator here** (1.29% + €0.20).
- **Plain bank payments settle directly to the shop's own account** —
  minimal lock-in, which matters given the handover plan.
- KYC 1–2 business days; public docs and a sandbox.

## The cheaper route, and its catch

**LHV direct** is genuinely cheaper: €0 setup, €0 monthly, €0.05/tx, free
refunds, first six months free, one contract covering LHV, Swedbank, SEB,
Luminor, Coop, Citadele, Artea across all three Baltic states, plus bundled
delivery integrations.

The catches, in order of seriousness:

1. **Contract terms.** LHV's published e-commerce card conditions include a
   **10% pledge** (clause 14.3 — funds equal to 10% of average monthly
   transactions over the past six months) and allow the bank to **suspend
   payouts for up to six months after termination** (clause 12.7).
   Indefinite term, 30 days' notice. Read before signing.
2. **Legacy protocol.** Bank links use the old iPizza form-POST + RSA
   signing scheme, with no maintained .NET library — we would write and
   maintain the signing ourselves.
3. **Card rates are "by agreement"** — quote required, so the €24/mo figure
   assumes SEB/EveryPay card pricing alongside.
4. **No Finnish coverage.**

## Open decision: PayPal

Renat ticked PayPal in q16. Montonio does not support it. Three options:

1. **Drop it.** PayPal direct in Estonia is **3.4% + €0.35** — at €50 AOV
   that is €2.05 per order, a **4.1% effective rate, roughly triple** the
   card cost. Recommended unless customers actually ask for it.
2. **Montonio + a separate PayPal Business integration.** Extra integration,
   extra reconciliation, but keeps everyone happy.
3. **SEB/EveryPay instead**, which does support PayPal (€0.10/tx) with cards
   at 1.35% and published pricing.

Worth asking Renat how many customers have ever requested PayPal before
paying for it.

## Revolut Business — the one genuine rival on cards

Verified separately (Estonian locale pages, 23.08). An Estonian OÜ **can**
sign up self-serve, review in ~24h, and the Merchant API is fully public
with a sandbox and webhooks.

| | |
|---|---|
| Monthly | **€10** (Basic; no free plan in Estonia). Merchant API included |
| EEA consumer cards | **1% + €0.20** — better than Montonio's 1.29% |
| Commercial / international cards | 2.8% + €0.20 |
| Apple/Google Pay | included, no extra fee |
| Payout | 24h (first payout held 7 days), free to the Revolut Business account |
| Chargeback | €15, refunded if won. Arbitration loss **€475** |
| Refunds | free, but the original processing fee is not returned |

**At today's 100% cards it is genuinely cheaper**: `10 + 1%×4000 +
80×0.20` = **€66/mo** versus Montonio's €82.59 — about €17/month.

**But it loses the moment bank links appear, which is the entire point of
this migration.** Revolut's Pay by Bank covers **Lithuania and Finland
only — no Estonia, no Latvia, no LHV, Swedbank, SEB or Coop**. So every
Estonian transaction stays a card transaction. Compare:

| Mix | Montonio Core | Revolut |
|---|---|---|
| 100% cards (today) | €82.59 | **€66.00** |
| 60/40 | **€44.43** | €66.00 (no EE bank links) |
| 80/20 | **€31.71** | €66.00 |

It also has **no PayPal**, **no shipping labels**, and real settlement
lock-in: the Merchant account is a sub-account of the Revolut Business
account, so funds can only move into Revolut. Splitting cards to Revolut and
bank links to Montonio costs *more* than Montonio alone (€49.39 vs €44.43),
because Montonio's subscription still applies.

**Conclusion: not worth switching to, but worth knowing.** If bank-link
adoption disappoints after launch and the mix stays card-heavy, Revolut is
the fallback that saves ~€17/month.

*Caveat: the Revolut fee pages read are the version applying from 22.09.2026;
earlier figures may differ. Whether rates vary by plan is unclear — the page
says "starting from … based on your plan" but publishes one set of numbers.*

## Restricted-business check — cleared

PSP restricted-business lists routinely block **ingestible supplements** on
remote payments (SumUp's Estonian list names *toidulisandid* and tobacco;
others are similar). Hair/beard growth supplements would have been a real
exposure for a shop like this.

**Checked against the live catalogue on 23.08: zero ingestibles.** All 224
products are topical — shampoo, conditioner, styling, beard/face/body care,
perfume and merch. No capsules, tablets, gummies or food supplements in any
title, product type or description, in any language. No PSP onboarding risk
on this front, whichever provider we choose.

(Note for anyone re-checking: SumUp's **US** restricted list is far harsher
and bars "hair growth products" outright. That list is issued by SumUp Inc./
Fifth Third Bank and does **not** apply to an Estonian merchant.)

## For the physical shop

Renat's till has no software, and the platform will become the inventory
system. Two card-acceptance options worth pricing when that becomes real:

| | Revolut | SumUp |
|---|---|---|
| In-person rate | **0.8% + €0.02** (EEA consumer) | 1.69% PAYG → 0.89% on Payments Plus (€19/mo) |
| Cheapest hardware | Tap to Pay on iPhone (+€0.08/tx), Lite Terminal €139 | **Solo Lite €34**, Solo €79, Terminal €169 (ex VAT) |
| Monthly | €10 (Basic) | €0 |

Revolut wins on rate, SumUp on entry cost — Solo Lite at €34 is hard to beat
for a shop doing a handful of card sales a day, and its Payments Plus
break-even is stated as €2,800/mo in card volume, which this shop will not
clear. At low offline volume SumUp PAYG is likely cheaper overall; at higher
volume Revolut's rate wins. Decide with real offline numbers, not now.

## Providers that would be a mistake

- **Klarna** — Estonia is not a Klarna consumer market (its own
  purchase-country table lists FI but omits EE/LV/LT). Estonian customers
  could not use it.
- **Adyen** — no Baltic bank links at all, undisclosed minimum monthly
  invoice, approval-gated onboarding. Far below its target size.
- **Paysera** — its 0.90% "system fee" stacks on top of the card rate,
  making it the most expensive at 100% cards. No PayPal. Funds sit in a
  Paysera wallet costing €5/month.
- **Nexi Checkout / Nets Easy** — **confirmed dead three ways**: the live
  registration country picker offers only Sweden, Denmark, Norway, Germany,
  Austria and "Other"; the portal's own JS country enum is `SWE, DNK, NOR,
  DEU, AUT`; and Nexi's own vendor listing names those same five countries.
  It would not help even if available — **no Baltic bank links at all** (its
  payment-method enum has none; the only route to Estonian bank payments is
  Trustly, which needs a separate agreement). Contracting entity would be
  Nets Denmark A/S under Danish law. Lock-in is the harshest found:
  **12-month initial term auto-renewing for another 12 unless cancelled 3
  months before expiry**, plus a contractual right to raise fees **5% a year
  without notice**. Nets does sell a legacy card-only gateway in Estonia
  (Nets Estonia / iPay "E-Makseterminal", ex-EstCard, T+1 settlement) but
  cards only, quote required — which leaves bank links, wallets and PayPal
  still unsolved.
- **SumUp online** — signable in Estonia with a genuinely open REST API, but
  **2.10% online** (1.69% on Payments Plus at €19/mo) with no Baltic bank
  links. Wrong for this checkout; its in-person rate is worth keeping in
  mind for the shop. *Note: SumUp's own Estonian help centre says 0.99%
  in-person on Payments Plus while its product page says 0.89% — two
  official sources disagree.*
- **Mollie** — not a mistake, just no advantage: Baltic Pay by Bank costs
  €0.70/tx at €50 versus Montonio's €0.05, worse card rate (1.80%), only
  launched in the Baltics 01.06.2026, and does not publish which Estonian
  banks it covers.
- **Stripe** — cannot do Estonian bank links. Worth adding later as a second
  rail only if Western Europe becomes real; note its 1.5% headline covers
  only standard EEA consumer cards (premium/commercial are 2.8% + €0.25).

## Not verified — check before relying

- ~~Revolut, SumUp, Nexi~~ — **now verified** against Estonian-locale
  official pages; see the sections above. Remaining Revolut gaps: whether
  acquiring rates truly vary by plan, rolling-reserve triggers, contract
  term beyond monthly billing. Remaining SumUp gaps: non-EEA/commercial card
  rates, whether the 2.10% has a fixed component, payout/refund/chargeback
  fees, KYC turnaround. Nexi: all commercials remain quote-only.
- Montonio's exact per-parcel shipping price list (visible only after
  activation), contract length, notice period, payout fee.
- SEB bank-link per-transaction fee inside the modern e-commerce/EveryPay
  product ("according to agreement"). Note SEB has **two distinct products**:
  legacy standalone pangalink (€65 setup + 1%, min €0.13, max €3.20) and the
  modern e-commerce product (quote required).
- Card acquiring rates for LHV / Swedbank / Luminor — all quote required.
- Paysera's fee table shows a €0.40 system-fee cap while its page text says
  the fee is uncapped for cards; our Paysera figures assume the cap and may
  be understated.
- The 60/40 and 80/20 mixes are scenarios, not measured data. The widely
  cited "~80% bank link" figure traces to agency blogs, not primary research.

## Sources

montonio.com/pricing · help.montonio.com (supported banks, card payments,
refundable bank payments) · montonio.com/shipping · docs.montonio.com ·
maksekeskus.ee/hinnad + developer.makecommerce.net · lhv.ee/en/lhv-bank-link
+ LHV e-commerce card conditions + partners.lhv.ee/et/banklink ·
seb.ee e-commerce + pangalink · cooppank.ee bank link · Luminor price list ·
support.every-pay.com supported methods · stripe.com/ee/pricing +
docs.stripe.com/payments/pay-by-bank · mollie.com/en/pricing + Baltics
launch · adyen.com/pricing · paysera.com payment gateway fees ·
docs.klarna.com purchase countries · paypal.com/ee business fees ·
developer.sumup.com
