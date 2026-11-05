# Shopify catalogue audit — rempireshop.com

Run 22.08.2026 from the shop's public endpoints. No admin credentials were
needed. Reproduce with `bun tools/audit-shopify.mjs` (add `--save` to write a
full snapshot into `data/shopify-snapshot/`).

Complements `rempire-web/docs/shopify/POLICIES-AUDIT.md`, which covers the
policy pages, payments and shipping.

## Scale

| | |
|---|---|
| Products | **224** (sitemap lists 225 — one is unpublished or the "Delivery" item) |
| Variants | **434**, of which 70 products have more than one |
| Collections | **47** |
| CMS pages | 3 |
| Blog posts | 3 |
| Locale URL sets | **6** — `/`, `/et/`, `/ru/`, `/en-lv/`, `/en-lt/`, `/en-fi/` |
| Indexable URLs, counted | **1,686** (see `tools/url-inventory.mjs`) |

The catalogue is small enough that PostgreSQL full-text search will be more
than adequate — no case for a paid search service. It is also small enough
that a bad migration would be obvious, which is good news.

Three extra locales (`en-lv`, `en-lt`, `en-fi`) were not in the original plan
of EN/ET/RU. They are Shopify Markets variants, and together they account for
834 of the 1,686 legacy URLs — half the site. Decide deliberately whether to
keep Latvian, Lithuanian and Finnish market URLs or redirect them to the
English default; either is defensible, but leaving half the URL surface to
404 is not.

## The three real problems

### 1. Brand is not a field — it lives in collections

The `vendor` field, which should hold the brand, is useless:

| vendor | products |
|---|---|
| Rempire Tower Shop | 208 |
| REMPIRE | 15 |
| Delivery | 1 |

The actual brands are collections instead: `KEVIN MURPHY`, `DAVINES`,
`SYSTEM 4`, `LUMIN SKIN`, `CBD DAILY HAIRCARE`, `CAPTAIN FAWCETT`,
`KOREAN COSMETICS`.

Consequence: the importer cannot read brands from the product record. It has
to derive them from collection membership, and a human has to confirm the
mapping once. The new model gets a real `Brand` entity, which is also what
makes brand landing pages — and their SEO value — possible.

### 2. Collections mix three incompatible jobs

The 47 collections are simultaneously brands (`DAVINES`), categories
(`Shampoo`, `Conditioner`, `Beard Oil`), and merchandising
(`BLACK FRIDAY`, `Winter Deals`, `New Products`, `Popular Products`,
`Latest Arrivals`, `Shop all`, `All Products`, `Top Brands`).

There are also outright duplicates: **`BLACK FRIDAY` twice** and
**`REMPIRE MERCH` / `Rempire Merch`**.

The new model separates these into `Brand`, `Category` and `Collection`
(merchandising), which is what lets the storefront have a coherent menu and
lets Renat edit merchandising without touching the taxonomy.

### 3. `product_type` cannot be used as a taxonomy

62 distinct values across 224 products, inconsistently cased and mixed in
kind: `Shampoo` (40) and `styling` (12) alongside single-use values like
`REMPIRE Oversized T-shirt unisex with print`, plus `decor`, `delivery` and
two empty strings.

This needs a one-off mapping table from the 62 raw values onto the real
category tree (Hair Care, Hair Styling, Beard Care, Face Care, Body Care,
Merch, with subcategories). Budget an hour of human review, not an
algorithm.

## Data quality

**SKUs: 193 of 434 variants — 44% coverage.** This is the finding that
matters most, because Renat wants shop stock synced with the site, and stock
sync needs a stable identifier on both sides. Roughly 240 variants need SKUs
assigned before any sync can work. Question r2q3 on `/qa2` asks him about
this; the data already says "есть, но не у всех".

**Barcodes are not exposed publicly**, so coverage is unknown until we have
Admin API access. Assume it is no better than SKU coverage.

**Prices** run €0–330, averaging €23.29. The €0 entries need checking — they
are probably the "Delivery" line-item product and placeholders.

**No product is on sale.** Not one variant has `compare_at_price` set. So
there is no historical sale pricing to migrate, and the promotions engine
starts from a clean sheet. Worth remembering for EU price-disclosure rules:
the 30-day-lowest-price obligation only bites once discounting starts, so
the new platform should record price history from day one rather than
retrofitting it.

**Descriptions are better than expected**: average 1,518 characters, only
one product effectively empty. 91 products (41%) already contain
ingredients/INCI text. But it is all unstructured HTML — benefits, usage and
ingredients are prose inside `body_html`, not separate fields. Splitting
them into the structured fields the new product page wants is a genuine
content project, and the obvious first job for the AI assistant Renat asked
for: propose a structured split per product, he approves.

**Images are the weak point for a "premium" redesign.** 400 images across
224 products — an average of 1.8, and **152 products (68%) have exactly one
image**. No product has zero. A design that leans on generous photography
will look empty on two thirds of the catalogue. This is worth telling Renat
plainly before he picks a design direction, and it is why question r2q7 asks
whether he will reshoot.

## What still needs Admin API access

Public endpoints do not expose: inventory quantities, barcodes, cost prices,
customers, orders, discount codes, draft/unpublished products, or metafields.
Migration of customers and past orders — both of which Renat asked for —
cannot start until he provides a Shopify staff account or API credentials.

## Implications for the data model

- `Brand` as a first-class entity, populated from collection membership.
- `Category` tree separate from merchandising `Collection`.
- `ProductVariant.sku` nullable at import, with a report of what is missing
  and an admin view to fill the gaps.
- Structured `benefits` / `usage` / `ingredients` / `warnings` fields that
  can be empty at import and filled progressively.
- `PriceHistory` recorded from the first import.
- Locale handling for five URL prefixes, with an explicit decision recorded
  for `en-lv` and `en-lt`.
- A redirect table covering ~1,400 legacy URLs.
