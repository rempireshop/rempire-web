# Shopify vs custom stack — cost comparison

Researched 22.08.2026 against official pricing pages (all sources at the
bottom). Basis: Rempire Store OÜ, ~€4,000/mo online card volume assumed
(AOV €50 → 80 transactions — assumption), Shopify Basic assumed (their
actual plan is NOT publicly detectable — confirm against their invoice).
FX €1 = $1.1687. Prices ex-VAT.

Feeds the «Сколько это будет стоить» section on `/demo`. The client-facing
version rounds; this is the precise record.

## Shopify today

| Component | Monthly | Annual billing | Status |
|---|---|---|---|
| Basic plan | €32 | €24 | Verified (IE+FI pages agree; DE page shows €39/€29 — Estonia's exact figure needs their admin) |
| Grow plan (if they're on it) | €92 | €69 | Verified |
| Shopify Payments, Basic, EEA online cards | ~1.9–2.0% + €0.25 | | Range — country-specific, confirm in admin |
| Third-party gateway surcharge | 2% (Basic) / 1% (Grow) | | Verified — applies to Montonio-inside-Shopify; exempt only Shopify Payments, Shop Pay, PayPal Express, manual |
| Translation app (T Lab Pro, 5 AI langs) | $11.99 ≈ €10.30 | | Verified; Weglot alternative €29–79 |
| Review app (Judge.me) | €0–12.80 | | Verified |
| SEO app (SearchPie) | €0–33.40 | | Verified prices; usage unknown |
| Card fees on €4,000 via Shopify Payments | ≈ €96–100 | | Computed from range above |

**Totals: lean ≈ €130/mo · heavier ≈ €200/mo.** If they run Montonio inside
Shopify today, add ~€40–55 (the 2% surcharge makes that combination
materially worse than Shopify Payments on Basic).

## New stack (same volume; 60% bank links / 40% cards assumed)

| Component | Monthly | Status |
|---|---|---|
| Vercel Pro | $20 ≈ €17.10 | **Hobby is explicitly non-commercial** (fair-use guidelines) — Pro is the floor unless the frontend moves to a commercial-free-tier host |
| Railway (ASP.NET + small Postgres) | ≈ €4.30–8.60 | $5 plan incl. $5 usage; consumption estimated |
| Cloudflare R2 | €0 | 10GB + generous ops free, zero egress — 225 products fits easily |
| Resend | €0 | 3,000/mo, 100/day cap — transactional only; **marketing campaigns need Pro $20 or another tool** |
| Claude API assistant (Haiku 4.5, one light user) | ≈ €2–8 | $1/$5 per MTok verified; volume estimated |
| Montonio Core | €14.99 | Verified (Starter €11.99 has worse rates). Note: Montonio's advertised Shopify-plugin rates do NOT apply to API integrations |
| Bank links 48 × €0.05 | €2.40 | €0.15/txn if refund-capable variant |
| Cards 1.29% + €0.20 on €1,600 | €27.04 | Verified rates |
| Domain/DNS | ≈ €1.50 | Estimate |

**Total ≈ €69–87/mo.** Montonio shipping labels ("from €1.99/parcel") exist
in both scenarios → excluded from the delta.

## Delta

| Scenario | Shopify | New | Saving/yr |
|---|---|---|---|
| Conservative (lean Basic + Shopify Payments) | ~€130 | ~€87 | **~€520** |
| Optimistic (monthly billing + paid apps) | ~€200 | ~€69 | **~€1,570** |
| Currently on Montonio-in-Shopify (2% surcharge) | ~€175–225 | ~€69–87 | ~€1,200–1,800 |

## The honest framing (for Dmitri, and for the pitch)

Running-cost savings alone do **not** justify a custom build — development
dwarfs €500–1,500/yr for years. The real case is:

1. **The 2% structural argument.** On Shopify Basic, any non-Shopify payment
   method carries a 2% platform surcharge, which cancels Montonio's bank-link
   advantage. Off Shopify, bank links cost ~€0.05–0.15 flat — and Baltic
   customers prefer them. This is a fee structure Shopify cannot match.
2. **Capability**: owner-editable site, admin assistant, SEO control — the
   things Renat actually asked for.
3. Savings are the cherry, not the cake. Presented to Renat as 40–130 €/mo
   with the caveat that his invoice decides where in the range he sits.

## Caveats (12)

1. Actual plan + app stack unknown → comparison shifts ~€70/mo. Get invoice.
2. Estonia's Shopify Payments card rate unverified (1.6–2.0% + €0.25 across
   eurozone pages).
3. Eurozone plan prices differ by country (IE/FI €32/€24 vs DE €39/€29).
4. AOV €50 / 80 txns assumed; fixed fees scale with order count.
5. 60/40 bank/card split assumed.
6. €0.05 bank links are non-refundable variant; refundable €0.15; card
   dispute fee €20.
7. Montonio Shopify-plugin rates ≠ API-integration rates.
8. Vercel Hobby cannot host a commercial store (fair-use terms).
9. Railway usage could reach $10–15 with a chatty app.
10. Resend free = transactional only; campaigns need paid or another tool
    (Shopify Email's cheap campaigns disappear at migration).
11. Not compared: development cost, maintenance (dominant real cost),
    POS for offline sales, app-equivalent features to rebuild, €288 annual
    prepay for Shopify annual pricing.
12. Claude estimate is one light user on Haiku; Sonnet-class ≈ 3× (still
    <€25/mo).

## Sources

shopify.com/{ie,fi,de}/pricing · help.shopify.com supported-countries ·
help.shopify.com third-party-transaction-fees · montonio.com/pricing ·
vercel.com/pricing + fair-use guidelines · railway.com/pricing ·
developers.cloudflare.com/r2/pricing · resend.com/pricing ·
platform.claude.com Claude API pricing · apps.shopify.com (T Lab, Judge.me,
SearchPie) · weglot.com/pricing

## Amendment 23.08

Client-facing /demo now shows Montonio as 50-85 EUR/mo and the new-stack
total as 60-110 EUR/mo: the refundable bank-link rate (0.15) replaces the
non-refundable 0.05 (a cosmetics shop must be able to refund), and the upper
bound assumes the current all-cards reality (1.29% + 0.20 on 4,000 EUR + 80
txns = ~68 EUR + 14.99 subscription). Savings restated as ~30-140 EUR/mo
with bank-link adoption named as the lever. Rates re-verified against
montonio.com/pricing on 23.08.2026 (unchanged).
