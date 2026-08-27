# Live site — page-by-page audit

Studied 27.08.2026: collection, product, cart, search, checkout, footer.
Platform: Shopify **Dawn theme**, 221 products, EUR only, locales EN/ET/RU.
Purpose: know what the shop actually *does* so the rebuild drops nothing.
We are not copying its visual design.

## ⚠️ Legal identity — three names, two real companies

The site names a different seller in different documents. Both companies are
real and both are Renat's, verified against the Estonian business register:

| | Rempire Store OÜ | THEFLOW OÜ |
|---|---|---|
| Registry code | 12216136 | 16320586 |
| Status | Registrisse kantud (active) | Registrisse kantud (active) |
| VAT | **EE102723858** | **not VAT-registered** |
| Registered address | Paikuse, Pärnu | **Mardi 1, Tallinn** (the shop) |
| Owner/board | Renat Gayanov | Renat Gayanov |
| Activity | Juuksuriteenindus (96211) | Juuksuriteenindus (96211) |

Where each appears on the live site:

- **Shipping policy** — which is actually the full T&C and *defines the
  Seller* — says `REMPIRE (THEFLOW OÜ), reg. 16320586`.
- **Legal notice** says `Rempire Shop OÜ`, reg `12216136`, VAT `EE102723858`
  (that spelling matches no registered company; the real one is Rempire
  **Store** OÜ).
- **Terms of service** says `Rempire Store OÜ`.
- **Contact information** says trade name `Rempire Tower Shop`.
- Renat told us (q23, round 2) to use **Rempire Store OÜ**.

Why this blocks work rather than being trivia: the storefront states
"Taxes included" and publishes a VAT number, but the entity named as Seller
in the T&C is **not VAT-registered**. Invoices must name the real selling
entity, and the payment contract must be signed by the entity that receives
the money. **This needs Renat's accountant before invoicing or the Montonio
contract is built.** Do not guess.

Note: automated readings of the register claimed a deletion notice for both
companies; opening the register pages directly shows neither has one. Both
are active with annual reports filed through 2025.

## Global chrome

- Announcement bar, one static line: `Free shipping: EE, LV, LT, FI — from
  €50 | Rest of EU — from €200` — a **two-tier threshold**.
- Header: hamburger · 6 flat nav links (no dropdowns) · logo · language
  (EN/ET/RU) · country selector (~250 countries, all EUR — cosmetic only,
  real shipping is 25 countries) · search modal with predictive search ·
  `Log in` · cart with count bubble.
- Nav counts: Hair Care 128 · Hair Styling 23 · Beard Care 31 · Face Care 13
  · Body Care 1 · Merch 11.
- Add-to-cart opens a **notification popup** (not a drawer): `Item added to
  your cart` → `View cart` / `Check out` / `Continue shopping`.
- **No breadcrumbs anywhere on the site.**

## Collection page

H1 `Hair Care`, real indexable intro copy, `128 products`, numbered
pagination (**16/page**, `1 2 3 … 8`).

**There are no filters.** The wrapper class is literally
`facets-wrapper--no-filters`, confirmed across all six collections. The only
control is a sort select with 9 options, default **Best selling**: Featured ·
Most relevant · Best selling · A-Z · Z-A · Price ↑ · Price ↓ · Date ↑ ·
Date ↓. Facets *are* configured and working — but only on `/search`. This
looks like a theme misconfiguration rather than a decision.

Product card shows only: image (**swaps to image 2 on hover**), title,
price. No brand line, no availability, no quick-add, no badges.

## Product page

Order: H1 → price → `Taxes included. Shipping calculated at checkout.` →
**Size radio pills** (75ml / 250ml / 500ml) → quantity stepper with a live
`(0 in cart)` counter → `Add to cart` → express wallet button → description
→ Share. Related products load by AJAX under `You may also like`.

- **No tabs or accordions** — the entire description is one RTE blob with
  `<strong>` pseudo-headings (BENEFITS, USAGE, pH 4.8).
- **No INCI or ingredient list anywhere on the site.**
- No delivery estimate, no returns line, no reviews, no stock level.
- Gallery: 3 images, mobile slider with `1 / of 3` counter, lightbox with
  zoom. No thumbnails.
- **The pickup-availability widget is permanently broken** — it renders
  `Couldn't load pickup availability`; the endpoint returns empty because no
  pickup location is configured.
- Data present but never shown: SKU (`SYS4-BIOSHAMP-75ML`), product type
  (`Shampoo`), tags.

## Cart

A full page at `/cart`, no drawer. Rows: image, title, unit price, variant
line, quantity stepper (stepping to 0 removes), separate remove control,
line total. Footer: `Estimated total`, `Taxes included. Discounts and
shipping calculated at checkout.`, `Check out`, express wallets.

Empty state: `Your cart is empty` + `Continue shopping` + `Have an account?
Log in to check out faster.`

Not present: **no free-shipping progress bar**, no discount field (it is at
checkout), no cart note, no cross-sell.

## Search — the only place filters exist

Facets: **Availability** with counts (`In stock (61)`, `Out of stock (2)`),
**Price** with From/To inputs and the hint `The highest price is €36,00`,
and **Collection** with ~63 checkboxes. Sort has only 3 options here.
24 results/page.

The `Collection` facet is a dumping ground mixing five different axes —
brands (kevin.murphy 23, Paul Mitchell 20, davines 10), types (shampoo 13,
conditioner 9), claims (Vegan, Sulfate-Free, Hydrating), ingredients
(Spirulina, Squalane, Panthenol) and campaign tags (Fall Deals, new) — with
case-duplicates (`shine (3)` alongside `Shine (5)`). Model this properly
rather than importing it.

Zero-result state is one sentence: `No results found for "asd". Check the
spelling or use a different word or phrase.` Nothing else.

## Checkout

The link supplied was an expired session (302 to home). Captured structure
from a fresh test checkout instead — Shopify one-page checkout:
Contact (email + `Email me with news and offers`) → Delivery (**25
countries**, name, address, postal, city, phone, `Save this information for
next time`) → Shipping method (loads after address) → Payment → summary with
`Discount code` + `Apply`.

**No parcel-machine picker appears** — searched the bundle for Omniva,
SmartPost, Itella, parcel, pickup: zero hits (DPD appears twice). So parcel
machines are, at best, plain carrier rates without a locker chooser.

## Footer — thinner than expected

No menu columns at all. No newsletter form (disabled). One social link
(Instagram). 8 payment icons: Amex, Apple Pay, Diners, Discover, Google Pay,
JCB, Mastercard, Visa. Copyright `© 2026, Rempire Tower Shop · Powered by
Shopify`. Policy row: Refund · Privacy · Terms of service · Shipping ·
Legal notice · Contact information · **Cookie preferences** (reopens the
consent banner).

No address, phone, email, opening hours, About, FAQ or blog link in the
footer.

## Homepage

**The hero is an empty slideshow placeholder** — the section exists in the
theme with zero slides configured. This is why Renat asked for a proper hero
banner: he has been looking at a broken one. Then `Popular Products` and
`Latest Arrivals` carousels (both with good reusable intro copy) and `Top
Brands` tiles.

## Policy content that must survive

- Contact: `Rempire Tower Shop` · `+372 53035580` · `rempireshopinfo@gmail.com`
  · `REMPIRE, Mardi 1, 10145 Tallinn`.
- Refund: 30-day window, unused with tags, returns to Mardi 1, label issued
  after approval, *"Items sent back to us without first requesting a return
  will not be accepted."*, **"personal care goods (such as beauty products)"
  listed non-returnable**, separate EU 14-day cooling-off clause, refunds in
  10 business days. (The non-returnable clause contradicts the cooling-off
  clause — see the returns problem already logged in POLICIES-AUDIT.md.)
- Shipping policy defines **store pickup** properly: free collection, ID
  required, **7-day** window, then **€1.50 per day storage**.
- Legal notice carries the EU ODR link `https://ec.europa.eu/consumers/odr`.
- A blog exists at `/blogs/news` with one article — **orphaned**, linked from
  nowhere.

## What we must add — ranked

### Tier 1 — legal or business-critical

1. **The seven policy pages + cookie-preferences control.** We have none.
   Required in the EU; the cookie re-open link is a GDPR expectation.
2. **Legal identity block in the footer** — trade name, phone, email,
   address, registry code, VAT, ODR link. Blocked on the entity question
   above.
3. **Country-aware free shipping.** Our cart drawer shows one €50 progress
   bar; the real rule is €50 for EE/LV/LT/FI and **€200 for the rest of the
   EU**. As built, our bar would promise free shipping to a German customer
   at €50. Our checkout already handles both thresholds — the drawer must.
4. **Store pickup at Mardi 1 as a delivery method** (free, ID, 7 days, then
   €1.50/day). Their own T&C defines it and the live widget is broken. I had
   earlier decided to build pickup and default it off — this is evidence to
   turn it on. Renat was never asked, because I cut that question.
5. **Payment trust icons + express wallet on cart** (we now have express on
   the PDP only).

### Tier 2 — merchandising

6. Availability facet **with counts** on every filter (counts are what make
   a 221-product filter usable).
7. Numbered pagination + visible result count (we only have «показать ещё»).
8. A standalone `/cart` page alongside the drawer — real URL, returnable,
   accessible.
9. Sort must include **Best selling** (their default) and **Date, new to
   old**.
10. Price filter as From/To inputs plus a max-price hint.
11. Second product image on hover in the grid — for cosmetics that is the
    back label, real information.
12. Newsletter opt-in checkbox in checkout contact.
13. Reuse their `Popular Products` / `Latest Arrivals` intro copy — it is
    genuinely good and already SEO-indexed.

### Tier 3 — cheap wins

Share/copy-link on PDP · surface the orphaned blog · show SKU and product
type (both populated, never displayed) · richer zero-result state.

## Where we are already ahead — do not "restore" these

The live site has **no breadcrumbs**, **no collection filters**, **no
product accordions**, **no INCI anywhere**, **no brand on cards** (Shopify
`vendor` is `"Rempire Tower Shop"` on all 221 products, so brand lives only
inside title strings), **no delivery estimate on PDP**, **no reviews**, **no
stock levels**, **no cart drawer**, **no free-shipping progress**, **no
footer columns or newsletter**, a **broken hero**, and a **permanently
failing pickup widget**.

Two data problems to fix rather than inherit: **brand must become a real
field**, and the collection axis must be split into brand / category /
claim / ingredient / campaign instead of one 63-item list.

Caveat on our own accordions: we show Описание / Преимущества / Применение /
**Состав (INCI)** / Доставка и возврат. The site has no INCI data at all,
and the ingredient text found in 41% of product descriptions is prose inside
HTML, not structured fields. The Состав accordion will be empty for most
products until someone fills it — the AI assistant's first real job.
