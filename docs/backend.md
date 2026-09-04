# Backend — database, admin session, orders

What runs behind the shop: one Postgres database, one admin password, and a
handful of JSON endpoints. The storefront works without any of it — see
"Without the API" at the bottom — so this can be switched on gradually.

## Environment variables

Never commit values. Locally they go in `.env.local` (git-ignored); on Vercel,
into the project's environment settings.

| Name | Needed for | Notes |
| --- | --- | --- |
| `DATABASE_URL` | everything that stores data | `postgres://user:pass@host/db?sslmode=require`. TLS is on and the certificate is verified for any non-local host. |
| `SESSION_SECRET` | admin sign-in | Random, at least 16 characters. Changing it signs everyone out. `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"` |
| `ADMIN_PASSWORD_HASH` | admin sign-in | scrypt digest, see below. The password itself is never stored. |
| `DB_DRIVER` | tests, local runs | `pglite` runs an in-memory Postgres instead of connecting to a server. Never set this in production. |
| `PGLITE_PATH` | optional | A folder for the PGlite driver to persist to; unset means memory only. |
| `DATABASE_POOL_MAX` | optional | Connections per serverless instance, default 5. |
| `DATABASE_SSL_NO_VERIFY` | optional | `1` turns off certificate verification — only for a provider whose CA is not in Node's trust store. |

Other agents own `RESEND_API_KEY`, `RESEND_FROM`, `MAIL_REPLY_TO`,
`PAYMENT_PROVIDER`, `MONTONIO_*`, `OPENAI_API_KEY`, `PUBLIC_BASE_URL`, and the
five `R2_*` for photo uploads (docs/media.md).

## Setting it up

```bash
npm install
npm run migrate                 # applies db/migrations/*.sql to DATABASE_URL
DB_DRIVER=pglite npm run migrate  # same, against a throwaway in-memory database
npm test                        # vitest, on PGlite — no server needed
```

`npm run migrate` applies every `db/migrations/NNN_name.sql` in filename order
and records each one in the `_migrations` table, so it is safe to re-run. Each
file is executed as a single batch, so dollar-quoted blocks and semicolons
inside strings are fine.

Migration number ranges (from `docs/build-contracts.md`): backend-core 001–009,
features 020–029, checkout/payments/shipping 030–039, mail 040–049.

### The admin password

```bash
node tools/hash-password.mjs            # asks for the password, prints the line
echo 'the password' | node tools/hash-password.mjs
```

It prints `ADMIN_PASSWORD_HASH=scrypt$16384$8$1$<salt>$<key>`. Copy that line
into `.env.local` and into Vercel. To change the password, generate a new hash
and replace the value — everyone stays signed in until the cookie expires,
because the session is signed with `SESSION_SECRET`, not with the password.

## Tables (`db/migrations/001_core.sql`, `002_order_discount_code.sql`)

- **`settings`** — `key` → `value` (jsonb). What the storefront reads: `chatbot`
  (bool), `bundles` (bool), `hero` (the home-page banner — `null` means the
  built-in slides in `app.js`, otherwise `{slides:[…], interval}`; see
  docs/features.md «Главный баннер»), `flows` (which automatic e-mails are on),
  `shipping` (tariff rules).
- **`product_overrides`** — one row per product the owner has edited: `price`,
  `stock` (`in`/`low`/`out`), `seo_title`, `seo_desc`, `subcat`, `var_img`,
  `video_url`, `gallery` (jsonb `[{url, thumb, alt}]`, the photos he uploaded —
  `db/migrations/003_product_gallery.sql`, see docs/media.md). Null means "no
  override, use the catalogue".
- **`bundles`** (`db/migrations/120_bundles.sql`) — the curated sets, one row
  each: `id` (slug — the URL `/shop2/set/<id>/` **and** the cart/order line
  `bundle:<id>`, never reused), `cat`, `name_ru|et|en`, `desc_ru|et|en`,
  `items` (jsonb `[{productId, variant, qty}]`), `price` **or** `discount_pct`,
  `image` (a product id or a URL, null = stack the item photos), `active`,
  `sort`. Nothing derived is stored: what the parts cost, the discount and the
  stock are recomputed from the catalogue and `product_overrides` on every
  read. Seeded with the eight sets `tools/bundles.config.mjs` used to generate,
  same ids and same prices, `on conflict do nothing`.
- **`orders`** — uuid `id`, human `number` (`R-100001`, from `order_number_seq`),
  `status` (`new`/`paid`/`failed`/`shipped`/`cancelled`/`refunded`), the customer,
  `items` and `shipping` as jsonb, the four money columns, `payment` as jsonb,
  `notes`, `discount_code`.
- **`admin_audit`** — who changed what, when.
- **`promo_codes`** / **`promo_code_uses`** — real promo codes
  (`db/migrations/060_promo_codes.sql`, `src/lib/promos.ts`). `code` is the
  primary key (A–Z, 0–9 and `-`, up to 24 characters); `kind` is
  `percent` / `fixed` / `free_shipping`; plus `value`, `min_subtotal`,
  `starts_at`, `ends_at`, `max_uses`, `used`, `active`, `note`. The uses table
  is append-only with a unique `(code, order_id)`, so a webhook retry cannot
  count the same order twice. Nothing is seeded — an empty table means the shop
  has no codes, which was the truth until Renat made one.

### How a discount code is priced

One box at the checkout takes two different things, and `createOrder` tells
them apart by shape: `RMP-XXXX-XXXX` is a gift card (`src/lib/giftcards.ts`),
anything else is looked up in `promo_codes`. Both are only **quoted** onto the
order — `discount` and `discount_code` — and both are **spent** on the single
transition into `paid` in `src/lib/payments/apply.ts`: the card's balance by
`redeemGiftCard`, the code's counter by `consumePromo`. A checkout abandoned on
the bank's page therefore costs the customer nothing and burns no promo use.

A `free_shipping` code comes back as a discount **equal to the delivery price**
rather than as a zeroed shipping line, so `shipping_price` keeps meaning "what
this parcel costs" and the receipt, the summary and the e-mail all print the
same three lines.

If the card has emptied or the code has run out between checkout and payment,
the order **stays paid** and the mismatch is written to `admin_audit` as
`giftcard_redeem_failed` / `promo_consume_failed`. The money arrived; settling a
few euro by hand is a better failure than an unpaid-looking paid order.

## Shared modules

- `src/lib/db.ts` — `query<T>(sql, params?)`, `withTx(fn)`, `exec(sql)` for
  batches. One `pg` Pool per instance, cached on `globalThis`; PGlite when
  `DB_DRIVER=pglite`. Numerics come back as strings from both drivers; jsonb
  parameters must be `JSON.stringify`d and cast (`$1::jsonb`) — node-postgres
  turns a bare JS array into a Postgres array, which jsonb will not accept.
- `src/lib/auth.ts` — `requireAdmin(req)` returns `null` for an admin and the
  401 `Response` otherwise. Cookie `rmp_admin` = `v1.<expiry>.<hmac-sha256>`,
  30 days, httpOnly, SameSite=Lax, Secure everywhere except plain-http
  localhost. Also `verifyPassword`, `rateLimit`, `clientIp`.
- `src/lib/orders.ts` — `createOrder`, `getOrder`, `getOrderByNumber`,
  `setOrderPayment`, `setOrderStatus`, plus `listOrders`, `setOrderNote`,
  `getOverrides`, `upsertOverride`, `getSettings`, `setSetting`, `writeAudit`.

### How an order is priced

`createOrder` never trusts the browser. It takes ids, a variant and a quantity,
then rebuilds every number from:

1. `src/data/catalogue.min.json` — the base price;
2. `src/data/catalogue.variants.json` — the per-size price, generated from the
   storefront catalogue by `node tools/build-catalogue-variants.mjs` (re-run it
   after `tools/build-catalogue-full.mjs`);
3. the `product_overrides` row, if any — an override price replaces the base
   price and keeps the size premium, so "−1 € on the 75 ml" does not give away
   16 € on the 500 ml;
4. `src/lib/shipping.ts` `computeShipping({country, method, subtotal, carrier})`;
   if that call throws, a flat fallback derived from its `DEFAULT_SHIPPING_RULES`
   (so the two cannot drift): parcel machine EE 5.47, courier EE 10.84, anything
   else 9.90, free over 59 € — sourcing in docs/shipping.md § «Тарифы Montonio»;
5. `src/lib/giftcards.ts` `applyGiftCard(code, total)` when it exists — it only
   **quotes** the discount. The card is spent when the payment is confirmed
   (`src/lib/payments/apply.ts`), never at checkout;
6. `src/data/bundles.json` for items whose id is `bundle:<id>`.

Items whose effective stock is `out` are refused (`out_of_stock`), as are
unknown products (`unknown_item`) and unknown bundles (`bundle_unknown`).
After the row is written, `src/lib/mail-hooks.ts` `onOrderCreated(order)` is
called if present; a failure there is logged and swallowed — the order is
already saved.

## API

All answers are JSON: `{ ok: true, … }` or `{ ok: false, error: "code" }`.
The site runs with `trailingSlash: true`, so call the paths with the slash
(`/api/orders/`).

### Public

| Route | What it does |
| --- | --- |
| `POST /api/orders/` | Body `{lang, items:[{id, variant?, qty}], customer:{name,email,phone}, shipping:{method, country, carrier?, pointId?, pointName?, address?}, discountCode?, notes?}` → `{ok, orderId, number, total}`. 10 per minute per IP, body capped at 16 KB (`too_large`, 413). `shipping` is rebuilt from a whitelist: `method` becomes one of `parcel`/`courier`/`pickup`, `country` two letters, `carrier` one of `omniva`/`smartpost`/`dpd`/`venipak` (lower-cased, anything else `null`), `pointId` ≤ 80 chars, `pointName` ≤ 160, `address` only `{addr,street,zip,city,house,flat}` at ≤ 160 chars each. Errors: `empty_order`, `bad_qty`, `bad_name`, `bad_email`, `unknown_item`, `out_of_stock`, `bundle_unknown`, `rate_limited`, `too_large`. |
| `GET /api/overrides/` | `{ok, overrides, settings}` — everything the storefront needs. `Cache-Control: s-maxage=30`. 503 `db_unavailable` when there is no database. |
| `GET /api/bundles/` | `{ok, bundles}` — the curated sets («Наборы»), **active only**, in `sort` order, each expanded against the catalogue and the owner's price/stock overrides: `{id, cat, title{RU,ET,EN}, desc{…}, items[{productId, variant, qty, brand, name, sizeLabel, price, stock}], sum, price, save, pct, stock, image, active, sort}`. `Cache-Control: s-maxage=30`, like `/api/overrides/`. 503 `db_unavailable` when there is no database — `app.js` then keeps the static `public/shop/bundles.js` it loaded with. The «Наборы на сайте» switch is *not* applied here: it is a storefront switch delivered with the settings, and keeping the two apart is what lets a set already in somebody's cart still be priced. |
| `POST /api/promos/check/` | `{code, subtotal?, shipping?}` → `{ok, code, kind, value, discount, freeShipping, minSubtotal}`, or `{ok:false, error}` with `bad_code`, `not_found`, `inactive`, `not_started`, `expired`, `used_up`, `min_subtotal` (which carries `minSubtotal`, so the shop can say «ещё 12 €»), `rate_limited`, `unavailable`. 20 a minute per IP, body capped at 2 KB. Read-only — the use is counted when the payment is confirmed, never here. |

### Admin (cookie `rmp_admin`)

| Route | What it does |
| --- | --- |
| `POST /api/admin/login/` | `{password}` → sets the cookie. 5 tries a minute per IP. |
| `POST /api/admin/logout/` | Clears the cookie. |
| `GET /api/admin/me/` | 200 when signed in, 401 otherwise; `configured` says whether the server has a password at all. |
| `PUT /api/admin/overrides/` | `{id, price?, stock?, seoTitle?, seoDesc?, subcat?, varImg?, videoUrl?, gallery?}`, or `{items:[…]}` for several. Only the keys sent are touched; `null` clears one. `GET` returns the map uncached. |
| `POST /api/admin/upload/` | multipart `file`, `kind=product\|hero\|review`, `productId?`/`reviewId?` → `{ok, url, thumbUrl, key, width, height, bytes}`. 60 an hour per session. `DELETE ?key=` removes one object, `GET` says whether the bucket is configured. See docs/media.md. |
| `PUT /api/admin/settings/` | `{chatbot:false}`, `{hero:{slides:[…],interval}}` or `{hero:null}`, `{flows:{…}}`, `{shipping_rules:{…}}` (docs/shipping.md — writing this key also drops the tariff cache so the next order bills the new price), `{key, value}` or `{settings:{…}}`. `GET` returns everything. |
| `GET/POST/PATCH/DELETE /api/admin/bundles/` | `GET` → `{ok, bundles}`, hidden ones included, in `sort` order. `POST {id, cat, title{RU,ET,EN}, desc{…}, items:[{productId, variant, qty}], price\|discountPct, image, active, sort}` creates or edits one; validated by `validateBundle()` in `src/lib/bundles.ts` — errors `bad_id`, `bad_cat`, `bad_name`, `bad_desc`, `few_items`, `too_many_items`, `unknown_product`, `dup_item`, `bad_variant`, `bad_qty`, `bad_price`, `price_too_high` (the set must cost less than its parts), `bad_discount`, `bad_image`, `bad_sort`. `PATCH {id, active}` shows or hides one, `PATCH {order:[id,…]}` reorders. `DELETE ?id=` removes one — unlike a promo code a set is a shop-window object, and the order keeps its own frozen copy of the line. Every write leaves an `admin_audit` row (`bundle.set` / `bundle.active` / `bundle.reorder` / `bundle.delete`). |
| `GET/POST/PATCH /api/admin/promos/` | `GET` → `{ok, promos}`, newest first. `POST {code, kind, value, minSubtotal, startsAt, endsAt, maxUses, active, note}` creates or edits one (`used` is never reset by an edit); errors `bad_code`, `bad_value`, `bad_min`, `bad_date`, `bad_uses`. `PATCH {code, active}` switches one on or off. There is no `DELETE`: a code that has been used is part of the order history. |
| `GET /api/admin/orders/?status=&q=&limit=` | Newest first; `q` matches number, e-mail, name or phone. |
| `GET/PATCH /api/admin/orders/<id>/` | The id is the uuid or the order number. `PATCH {status?, note?}`. |
| `GET /api/admin/audit/?limit=` | The change log, newest first. |

## Without the API

The storefront in `public/shop2/` is a static page that must keep working on
its own, so `app.js` *detects* the backend instead of assuming it:

- At boot it fetches `/api/overrides/`. Anything that is not a JSON answer — a
  404 page, an offline phone, the static export — is ignored silently and the
  shop carries on with its localStorage copy of the owner's changes.
- When the API does answer, the server wins: its prices, stock, SEO and
  settings replace the local copy, which stays behind as an offline cache.
- `GET /api/admin/me/` decides what the admin screen shows. 401 → a sign-in
  card («Войти», wrong-password state, «Выйти» once signed in). No API at all →
  the demo panel opens exactly as before, with no password.
- Signed in, every change the panel applies is also written through with
  `PUT /api/admin/overrides/` or `PUT /api/admin/settings/`, and undo re-sends
  the previous value.
- The orders tab reads `/api/admin/orders/`; if the server has no orders yet or
  does not answer, the demo list is shown instead and says so.

Bump the `?v=` token in `public/shop2/index.html` whenever `app.js`,
`styles.css` or `chat.js` changes, or browsers will keep the old file.

## Tests

`npm test` runs vitest against PGlite, so there is nothing to install and
nothing to clean up: migrations apply, `createOrder` recomputes totals and
refuses tampered prices and out-of-stock items, the login/logout cookie makes a
round trip, and `requireAdmin` turns away forged cookies.

## Migrations on deploy

`npm run build` now runs `tools/pack-migrations.mjs` before the build (embeds `db/migrations/*.sql`
into `src/db/migrations.generated.ts`) and `tools/migrate.mjs --if-configured` after it: when
`DATABASE_URL` is set in the build environment, pending migrations are applied as part of every
deploy; when it is not set (staging without a database, previews, local), the step prints one line
and exits 0. Manual fallback, admin-only: `GET /api/admin/migrate` (applied / pending) and
`POST /api/admin/migrate` (apply). Railway trial or Hobby Postgres: use `DATABASE_PUBLIC_URL`
(the TCP proxy) for Vercel; the internal `DATABASE_URL` only resolves inside Railway.
