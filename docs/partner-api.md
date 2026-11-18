# Partner API — what REMPIRE booking may ask the shop

REMPIRE booking (rempire.ee: the barbers' bookings, their app, their invoices)
lets a barber sell a shop product to a client in the chair, or take one for
himself. The booking app has no catalogue of its own. It asks this shop over
two routes under `/api/partner/`.

**This version only reads.** It finds products and matches a photo. It writes
nothing: no order, no stock move, no database row, no file in storage. There
is no migration. Booking a barber's sale in the shop is a later version.

Added 18.11.2026 (Phase C of the booking project).

## Auth

Every route needs

```
Authorization: Bearer <BOOKING_API_SECRET>
```

- `BOOKING_API_SECRET` is an env var, at least 16 characters, with the same
  value in this project's Vercel settings and in the booking app's host. The
  value is never written in the repository.
- Unset, or shorter than 16 characters: `503 {"error":"not_configured"}`.
- Missing, not `Bearer`, or another value: `401 {"error":"unauthorized"}`.
- The compare is constant-time (`src/lib/partner-auth.ts`).
- The admin cookie does not open these routes, and `src/middleware.ts` never
  sees `/api` at all.
- Every answer carries `cache-control: no-store`.

## Limits

Kept in memory by each serverless instance (`PARTNER_LIMITS` in
`src/lib/partner-auth.ts`, on the shop's own limiter `rateLimit()` in
`src/lib/auth.ts`). Nothing is written to keep them.

| Route | Limit | What counts |
|---|---|---|
| lookup | 120 requests a minute | every request with the right secret |
| identify | 20 a minute and 500 a day | only a photo that passed every check and goes to OpenAI |

- Over a limit: `429 {"error":"rate_limited"}` with `Retry-After` in seconds.
- One budget for the booking app, not one per address: a leaked key can be
  used from anywhere. A request without the right secret counts nowhere.
- Per instance: Vercel Fluid Compute reuses a warm instance, so for one
  barbershop this is usually one counter. A cold start or a second instance
  has its own, so the hard bound is 500 photo matches a day per instance alive
  at the same time.
- Cost of one photo match: the photo at `detail: low` plus the list of on-sale
  products (about 13 000 characters for the 220 catalogue products, a few
  thousand tokens) and at most 120 tokens out, on the shop's model
  (`gpt-6-luna` by default). That is roughly 0.05–0.1 US cents a photo, so a
  full day of 500 is well under 1 US$ per instance.

## Product

One row per size, keyed like «Склад» (`stock_levels`). `variant` is `""` for a
product sold in one unnamed size, otherwise the size label (`"250 мл"`). A
product sold in one named size is keyed by that label. Asked for with `""`, it
is still found.

```json
{
  "productId": "system-4-bio-botanical-shampoo",
  "variant": "250 мл",
  "name": "Bio Botanical Shampoo — шампунь",
  "variantLabel": "250 мл",
  "brand": "System 4",
  "photo": "https://rempireshop.com/shop/img/system-4-bio-botanical-shampoo-0.webp?v=5",
  "priceCents": 1600,
  "purchaseCents": null,
  "vatBp": 2400,
  "stock": 5,
  "barcode": "6417150000000"
}
```

| Field | Meaning |
|---|---|
| `name`, `variantLabel` | In the asked language (`lang`). `variant` never changes with it. |
| `photo` | Absolute, small (the owner's upload as its thumbnail). `null` when the product has no photo. |
| `priceCents` | Today's till price for that size, VAT included: `priceItems()` itself, the salon till. For a product the till will not sell today (hidden, or «нет в наличии»), the same price by the same rule (`sizePrices()` in `src/lib/merchant-feed.ts`). The shop has no sale prices. |
| `purchaseCents` | Always `null` in this version: the shop does not keep purchase prices yet. |
| `vatBp` | The shop's VAT rate in basis points (`settings.vat_rate`; 24 % is `2400`). |
| `stock` | The shelf count. `null` for a size nobody has counted yet. |
| `barcode` | The EAN bound to that size on «Склад», or `null`. |

## `GET /api/partner/products/lookup`

Exactly one of:

| Query | Finds |
|---|---|
| `?barcode=<code>` | The size that code is bound to, hidden products too. |
| `?q=<text>&limit=<1..20>` | Brand and name words in RU, ET or EN, every word required, at least 2 characters. On-sale products only. `limit` defaults to 10. |
| `?id=<productId>&variant=<size>` | That size, hidden products too. `variant` may be left out for a one-size product. |

Add `&lang=ru|et|en` for the language (default `ru`).

- `200 {"items":[Product, …]}`. An empty list when nothing matches.
- `400 {"error":"bad_request"}` for no selector, two selectors, a short `q`,
  `limit` outside 1–20, or an unknown `lang`.
- `429 {"error":"rate_limited"}`: see Limits.
- `500 {"error":"server_error"}`: ask again.

## `POST /api/partner/products/identify`

```json
{ "image": "data:image/jpeg;base64,…", "lang": "ru" }
```

- JPEG, PNG or WebP, at most 2 MB decoded. `lang` is optional.
- The shop's OpenAI key (`OPENAI_API_KEY`, model from `src/lib/openai-chat.ts`)
  gets the photo (`detail: low`) and a numbered list of the on-sale products:
  brand, name, sizes. Nothing else is sent: no prices, no stock. The photo is
  not stored.
- `200 {"items":[Product, … up to 3]}`, best first. When the model is unsure of
  the size, every size of that product is listed (still at most 3 rows).
  `[]` when nothing fits.
- `400 {"error":"bad_request"}`: not one of the three image types, or the bytes
  do not match the type.
- `413 {"error":"too_large"}`: over 2 MB.
- `429 {"error":"rate_limited"}`: see Limits.
- `503 {"error":"not_configured"}`: no `OPENAI_API_KEY`.
- `502 {"error":"upstream"}`: OpenAI could not be reached or refused.
- `500 {"error":"server_error"}`: ask again.

## Files

- `src/lib/partner-auth.ts`: the key and the limits
- `src/lib/partner-products.ts`: Product rows, the three lookups
- `src/lib/merchant-feed.ts`: `sizePhotos()` and `sizePrices()`
- `src/app/api/partner/products/lookup/route.ts`
- `src/app/api/partner/products/identify/route.ts`
- `tests/partner-api.test.ts`, and the routes are in `tests/fuzz-routes.test.ts`
