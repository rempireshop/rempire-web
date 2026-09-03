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
- **`orders`** — uuid `id`, human `number` (`R-100001`, from `order_number_seq`),
  `status` (`new`/`paid`/`failed`/`shipped`/`cancelled`/`refunded`), the customer,
  `items` and `shipping` as jsonb, the four money columns, `payment` as jsonb,
  `notes`, `discount_code`.
- **`admin_audit`** — who changed what, when.

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
4. `src/lib/shipping.ts` `computeShipping({country, method, subtotal, carrier})`
   when it exists, otherwise a flat fallback: parcel machine EE 3.49, courier EE
   5.99, anything else 9.90, free over 59 €;
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

### Admin (cookie `rmp_admin`)

| Route | What it does |
| --- | --- |
| `POST /api/admin/login/` | `{password}` → sets the cookie. 5 tries a minute per IP. |
| `POST /api/admin/logout/` | Clears the cookie. |
| `GET /api/admin/me/` | 200 when signed in, 401 otherwise; `configured` says whether the server has a password at all. |
| `PUT /api/admin/overrides/` | `{id, price?, stock?, seoTitle?, seoDesc?, subcat?, varImg?, videoUrl?, gallery?}`, or `{items:[…]}` for several. Only the keys sent are touched; `null` clears one. `GET` returns the map uncached. |
| `POST /api/admin/upload/` | multipart `file`, `kind=product\|hero\|review`, `productId?`/`reviewId?` → `{ok, url, thumbUrl, key, width, height, bytes}`. 60 an hour per session. `DELETE ?key=` removes one object, `GET` says whether the bucket is configured. See docs/media.md. |
| `PUT /api/admin/settings/` | `{chatbot:false}`, `{hero:{slides:[…],interval}}` or `{hero:null}`, `{flows:{…}}`, `{key, value}` or `{settings:{…}}`. `GET` returns everything. |
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
