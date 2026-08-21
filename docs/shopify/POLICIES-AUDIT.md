# rempireshop.com — policies & storefront audit

Date: 2026-08-21. Sources: the six /policies/* pages + homepage/footer.
Feeds `docs/SHOPIFY_AUDIT.md` (master prompt Phase 0) and the /qa questionnaire
hints. Renat confirms/corrects via /qa q16–q20, q23.

## Company data — INCONSISTENT on the live site

| Field | Values found | Where |
|---|---|---|
| Legal name | **Rempire Store OÜ** / **Rempire Shop OÜ** | terms-of-service / legal-notice |
| Trade name | Rempire Tower Shop | contact page, page titles |
| Registry code | 12216136 | consistent |
| VAT | EE102723858 | consistent |
| Address | Mardi 1, 10145 Tallinn | consistent |
| Phone | **+372 56237237** / **+372 53035580** | terms / contact page |
| Email | rempireshopinfo@gmail.com | consistent |
| Privacy contact | **blackboxestonia@gmail.com** | privacy-policy (stale third party?) |

→ Renat must state the correct set (q23). Verify against äriregister before
invoice templates are built. Never copy legal pages 1:1 — see contradictions.

## Payments — current state

Footer/terms list **cards only**: Visa, Mastercard, Amex, Diners, Discover,
JCB, Apple Pay, Google Pay — i.e. plain Shopify Payments. **No Baltic bank
links, no PayPal, no invoice payment.** Bank links are the default payment
habit in EE/LV/LT → adding them (Montonio) is a concrete, sellable
improvement over the current shop.

## Shipping — current state

- Checkout reportedly offers **DPD only** (Dmitri's observation; policy names
  no carrier at all — just "Seller or its authorized representative").
- Pickup points free; home delivery paid; price shown at checkout.
- **Free shipping: от 50 € EE/LV/LT/FI, от 200 € rest of EU.** Import these
  thresholds as configuration.
- Country selector allows ~the whole world (default Shopify markets) —
  almost certainly unintentional; q18 asks the real target countries.
- Pickup storage rule: 7 days, then 1.5 €/day.

## Returns — policy is self-contradictory

- 30-day window stated, 14-day EU cooling-off also stated.
- Shop **pays return shipping** and sends the label.
- Refund to original method within 10 business days.
- BUT the same page excludes "personal care goods (such as beauty products)"
  from returns — which is the entire catalogue. Classic template junk.
- New shop needs a legally coherent RU/ET/EN returns policy (EE consumer law:
  14-day distance-selling withdrawal; hygiene-seal exception only where
  applicable) + an admin returns workflow (q19 asks current practice).

## Privacy / GDPR

Shopify-derived but partially customized; GDPR Art. 6(1)(f), SCCs, data
rights listed. Marketing consent handled via unsubscribe. Contact email is
the stale blackboxestonia@gmail.com. New platform: rewrite with real
processor list (Vercel/Railway/Cloudflare/Montonio/Resend/analytics) and a
consent-gated tracking setup.

## Storefront facts

- Nav: Hair Care, Hair Styling, Beard Care, Face Care, Body Care, Merch.
- Top brands: Kevin Murphy, Korean Cosmetics, Davines, Lumin Skin, System 4,
  CBD Daily Haircare, Rempire merch.
- Languages live: EN / ET / RU (matches build plan — keep all three).
- **No newsletter signup exists** (q11 asks if wanted).
- No physical-store presentation on site despite Mardi 1 address (q20).

## Payment/shipping implementation take (for Dmitri)

**Montonio first, alone, is enough for v1:**

- One contract + one REST API covers: Baltic + Finnish **bank links**, cards,
  Apple/Google Pay — and **Montonio Shipping** creates DPD / Omniva /
  SmartPosti labels and serves parcel-machine lists. Current DPD-only setup
  is a subset of this; labels move from manual to one click in admin.
- Integration shape: create order via API → redirect to gateway → signed
  (JWT) webhook confirms payment → idempotent handler flips order to paid.
  Sandbox available without production credentials. Effort: days, not weeks,
  behind the payment-provider abstraction the master prompt already demands.
- Stripe: optional later for global cards/subscriptions; do NOT block v1 on
  it. PayPal: only if Renat insists (q16 will tell).
- Invoice payment (B2B): manual bank transfer + generated invoice PDF is
  enough for v1 if q8/q16 show demand.
