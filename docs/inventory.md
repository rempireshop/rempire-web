# Склад, сканер штрихкодов и продажа в салоне

## Что это

В админке появилась вкладка **«Склад»** — настоящие остатки: сколько штук товара
на самом деле есть, а не просто «мало» или «много». И вкладка **«Продажа в
салоне»** — быстрая продажа прямо в магазине, без сайта: наличными или по
терминалу, с чеком для печати.

## Что означают цифры

- **Остаток** — сколько единиц товара сейчас на складе. Число, а не слово.
- **Порог «мало»** — при каком остатке товар помечается жёлтым «мало» (по
  умолчанию 2 штуки).
- **«Не учтено»** — товар ещё ни разу не сканировали и не считали. Это не
  значит, что его нет — просто по нему пока нет настоящих цифр, и на сайте
  для него по-прежнему действует старая ручная отметка «в наличии / мало /
  нет» из вкладки «Товары». Как только вы хоть раз примете или спишете этот
  товар через «Склад» или сканер, он переходит на настоящий счёт, и дальше
  бейдж на сайте берётся из него.
- Один раз посчитанный товар **никогда не станет «нет в наличии» сам по
  себе** — только когда его остаток на самом деле дойдёт до нуля через приём,
  продажу или ваше исправление.

## Как принять товар (приход)

1. Откройте «Склад» → «Сканировать».
2. Разрешите доступ к камере (см. ниже про iPhone).
3. Наведите камеру на штрихкод (EAN-13, EAN-8 или UPC-A — это почти все
   штрихкоды на упаковках).
4. Как только код распознан, вы услышите/почувствуете сигнал, и на экране
   появится карточка товара с остатком.
5. Нажмите «+1 приход» для одной штуки, или впишите число и нажмите «Приход по
   количеству» для нескольких сразу.
6. Если код ни к чему не привязан («Код не привязан») — найдите товар в поиске
   под карточкой и нажмите «Привязать». Дальше этот же штрихкод будет находить
   этот товар всегда.

Если камера не видит код (плохое освещение, помятая упаковка) — впишите цифры
штрихкода вручную в поле под камерой и нажмите «Найти».

Если в магазине есть отдельный сканер-пистолет (Bluetooth или USB) — он тоже
работает: наведите и нажмите на нём кнопку, код сам появится там же, где и от
камеры телефона.

## Как списать продажу без сайта (сканером)

Так же, как приход, только кнопка «−1 продажа» — для одной проданной штуки без
оформления полноценного чека. Для настоящей продажи с чеком используйте
«Продажа в салоне» (ниже).

## Как поправить остаток вручную

На вкладке «Склад» у любого товара — кнопка «Править»: там можно вписать
настоящий остаток после пересчёта на полке, порог «мало» и штрихкод, и
написать причину (видно потом в истории).

## Как продать в салоне

1. «Продажа в салоне» → найдите товар (или сначала отсканируйте его на
   «Складе» и вернитесь сюда — оба места работают с одной корзиной).
2. Добавьте нужные товары, поправьте количество кнопками +/−.
3. При желании впишите e-mail или телефон покупателя — тогда покупка попадёт
   в его историю заказов в личном кабинете. Необязательно.
4. Выберите «Наличные» или «Терминал», при необходимости — скидку в
   процентах.
5. «Оформить продажу» — всё, заказ сразу отмечен оплаченным, остатки
   списались, и в «Заказах» он появится с меткой «Салон».
6. «Чек для печати» открывает простой чек — распечатайте или сохраните как
   PDF через диалог печати браузера.

Эта продажа не трогает вашу обычную кассу в зале — это просто ещё один способ
провести продажу и списать товар со склада заодно с сайтом.

## Установка на телефон (чтобы не открывать сайт заново)

На экране «Склад» есть подсказка «Добавить на экран телефона»:

- **iPhone (Safari)**: кнопка «Поделиться» (квадрат со стрелкой) → «На экран
  “Домой”». После этого иконка Rempire появится рядом с другими приложениями.
- **Android (Chrome)**: меню (три точки) → «Установить приложение» или
  «Добавить на главный экран».

### Про камеру на iPhone

- Камера работает только по **защищённому соединению (https)** — на реальном
  домене магазина это всегда так; если что-то не работает, проверьте адрес в
  строке браузера — он должен начинаться с `https://`.
- В первый раз Safari спросит разрешение на камеру — обязательно нажмите
  «Разрешить». Если случайно отказали — на iPhone: Настройки → Safari →
  Камера → «Спрашивать» или «Разрешить», и откройте страницу заново.
- Работает начиная с **Safari 17** (iOS 17 и новее). На более старых iPhone
  сканер покажет об этом честно и предложит поиск/ручной ввод вместо камеры —
  ничего не сломается, просто без камеры.
- На Android (Chrome) камера работает во всех современных версиях без
  ограничений по номеру Safari.

---

# Для разработчиков

## Схема (db/migrations/090_inventory.sql, 091_pos_channel.sql)

```sql
stock_levels(product_id text, variant text default '', qty int not null default 0,
             low_threshold int default 2, ean text, updated_at,
             primary key(product_id, variant))
stock_moves(id bigserial, at, product_id, variant, delta int,
            reason text check in ('sale_web','sale_pos','goods_in','adjust','return'),
            ref text, actor text)
orders.channel text not null default 'web' check (channel in ('web','pos'))
```

`variant` is `''` for a product with no sizes, else the size **label** exactly
as `src/lib/orders.ts` puts it on an order line (`"75 мл"`, from
`src/data/catalogue.variants.json`) — never an index.

### "tracked" — the one concept worth understanding before touching this code

A `stock_levels` row existing is **not** the same as a product being publicly
trusted. A variant only counts for the public in/low/out badge once it has at
least one real `stock_moves` row (a scan, a manual adjust, a sale, a return).
`tools/seed-stock.mjs` creates a `stock_levels` row for every catalogue
variant at qty 0 to hold its EAN — if a bare seeded row counted as tracked,
running the seed script would flip the **entire catalogue** to "нет в
наличии" the moment it ran. Every function that derives a public-facing state
(`productStockStates()`, `getLevels()`'s `tracked` flag) checks for a real
move first. See the module doc at the top of `src/lib/inventory.ts` for the
full reasoning — read it before changing any of the derivation logic.

## `src/lib/inventory.ts`

- `getLevel(productId, variant?)`, `getLevels({q, filter, limit})` — the admin
  table: every catalogue product×variant (from `catalogue.min.json` +
  `catalogue.variants.json`), left-joined onto whatever `stock_levels` rows
  exist, computed in JS (the catalogue is a few hundred rows — not worth a
  query of its own).
- `setLevel(productId, variant, {ean?, lowThreshold?})` — upserts the STATIC
  fields only. Never touches qty, never writes a ledger row. Rejects a
  duplicate EAN (`InventoryError("ean_taken", otherProductId)`).
- `move({productId, variant?, delta, reason, ref?, actor?})` — the one door
  quantities change through. Atomic (`withTx`): row-if-missing, a locked
  read, then `qty = qty + delta` clamped at 0 (`clampedNegative: true` when
  clamped — callers log it, `move()` itself never throws for this), plus one
  `stock_moves` row, in one transaction. Fires the existing back-in-stock
  mailer (`src/lib/flows.ts` `runBackInStock`) when a move takes qty from 0
  to positive — best effort, after the transaction commits.
- `setQty(productId, variant, qty, {reason?, ref?, actor?})` — same atomicity,
  but the delta is computed from the CURRENT qty inside the same locked
  transaction (`target − qtyBefore`), so a concurrent sale cannot make an
  absolute "set to N" stale between the read and the write. `reason` defaults
  to `'adjust'`.
- `deriveState(qty, lowThreshold)` → `'in' | 'low' | 'out'`. `qty <= 0` is
  always `'out'`, regardless of threshold.
- `byEan(code)` — the scanner's one lookup, joined with the catalogue product.
  `null` when the code matches nothing (the caller offers "assign this code"
  via `setLevel`).
- `productStockStates(ids?)` — one state per product id, aggregated across its
  *tracked* variants only: `'out'` only if every tracked variant is out,
  `'low'` if any tracked variant is low, `'in'` otherwise. This is what
  `getOverrides()` (`src/lib/orders.ts`) merges onto the manual override.
- `listMoves({productId?, reason?, since?, limit?})`, `todaysMoves(limit)` —
  the ledger.
- `lowStockSummary(limit)` — tracked and not `'in'`; used by the admin table's
  own low/out counts and the assistant's context (see below).

## Wiring into the shared modules

- **`src/lib/orders.ts` `getOverrides()`** — after building the manual-override
  map, dynamically imports `@/lib/inventory` and merges `productStockStates()`
  on top for every tracked product. Best effort (try/catch): a broken
  inventory module must not take the storefront down, same posture as every
  other optional neighbour in that file.
- **`src/lib/orders.ts` `createOrder()`** — takes `channel?: "web"|"pos"` and,
  for `channel:"pos"`, relaxes the name/e-mail requirement (a walk-in sale
  needs neither) and prices a flat `posDiscountPercent` instead of running
  `codeDiscount()` — the two are mutually exclusive by construction. The
  percent is folded into `discount_code` as `"POS -15%"` so the existing
  admin order screen and the receipt show it with no extra rendering code.
- **`src/lib/orders.ts` `setOrderStatus()`** — when the status was `'paid'` or
  `'shipped'` and moves to `'refunded'` or `'cancelled'`, walks the order's
  `kind:'product'` lines and issues a `'return'` move for each (variant-aware,
  `ref` = the order number). Bundle lines (`id` = `"bundle:<id>"`) and gift
  lines are skipped — a bundle id is not a catalogue product, and its parts
  are not resolved here; that is a deliberate scope boundary, not an
  oversight, matching the same boundary on the decrement below.
- **`src/lib/payments/apply.ts`** — `ApplyDeps.decrementStock` (optional,
  same injection pattern as `recordPurchaseEvent`/`earnLoyaltyPoints`): on the
  single transition into `paid`, decrements every `kind:'product'` line with
  reason `'sale_web'`. When the dep is not injected (production), a local
  `decrementStock()` dynamically imports `@/lib/inventory` and loops the
  lines itself. `move()`'s own negative-clamp means a shortfall can never be
  the reason a confirmed payment fails to save — it clamps at 0 and the
  caller's `console.error` is the only trace.

## Routes (all `requireAdmin`)

- `GET /api/admin/inventory/?q=&filter=all|low|out|untracked` — `getLevels()`.
- `PUT /api/admin/inventory/` — `{productId, variant?, ean?, lowThreshold?}` →
  `setLevel()`.
- `GET /api/admin/inventory/moves/?productId=&reason=&since=&limit=` —
  `listMoves()`.
- `POST /api/admin/inventory/moves/` — `{productId, variant?, delta, reason,
  ref?}` (relative, via `move()`) **or** `{productId, variant?, qty, reason?,
  ref?}` (absolute, via `setQty()`); `actor` is always `"admin"` here.
- `GET /api/admin/inventory/lookup/?ean=<code>` — `byEan()`, the scanner's hit.
- `POST /api/admin/pos-orders/` — `{items, customer?, payment:{method}, discountPercent?}`.
  Creates the order (`channel:'pos'`), marks it paid (`setOrderPayment` +
  `setOrderStatus`), decrements stock per line (`reason:'sale_pos'`, best
  effort — the sale already happened in the room).
- `GET /api/admin/pos-orders/<id>/receipt/?lang=` — a standalone, trilingual,
  print-ready HTML page (own `<style>`, no admin chrome), `window.print()`
  button. `<id>` is the uuid or the order number, same convention as
  `/api/admin/orders/<id>/`.

## `tools/seed-stock.mjs`

Runs the migrations, then upserts a `stock_levels` row (qty 0, `on conflict
… do update set ean = coalesce(stock_levels.ean, excluded.ean)` — never
clobbers an EAN a human has since typed in) for every catalogue product×variant,
reading EANs from `tools/harvest/products/<id>.json` (the Shopify Admin API
dump the catalogue was partly built from). **As of this writing every one of
those 153 harvested variants carries `barcode: "NA"`** — Renat's Shopify
catalogue has no real barcodes on record anywhere the Admin API could see
(confirmed by reading the full dump; see
`../rempire-api/docs/BARCODE-SCANNING.md`, "Barcode VALUES are not in the
public Shopify data"). So a fresh run seeds zero real EANs — that is the
correct, honest result today, not a bug. EANs from here on come from scanning
in the admin ("assign mode": scan an unknown code → search → «Привязать»), or
from re-running the seed after a fresh Admin API harvest if Renat ever fills
barcodes in on the Shopify side (an existing non-null `ean` is never
overwritten either way).

```
npm run seed:stock                   # against DATABASE_URL
DB_DRIVER=pglite npm run seed:stock  # against an in-memory PGlite
```

## Admin UI (`public/shop2/app.js`)

- `ADM_NAV` gained `stock` («Склад», icon `box`) and `pos` («Продажа в
  салоне», icon `till`), between `goods` and `people`.
- `admStockHTML()` / `stockRows()` / `stockRowHTML()` / `stockEditFormHTML()`
  — the table, filtered/searched **client-side** against `S.stockLevels`
  (fetched once via `loadStockLevels()`, same pattern as `goodsRows()`
  against the in-memory `CATALOGUE`).
- `admStockMovesHTML()` — the ledger sub-view (`S.stockMovesOpen`).
- `admPosHTML()` / `admPosReceiptHTML()` — the quick-sale screen and its
  post-sale card.
- **The scanner is not part of the normal render tree.** A `<video>` element
  living inside the `bodySlot.innerHTML` string would be torn down (losing
  its camera stream) on every unrelated `render()` call. `scanMount()`
  appends a persistent `.scanoverlay` `<div>` directly to `document.body`
  the first time `S.scanOpen` becomes true; `render()` itself only calls
  `scanMount()`/`scanRenderPanel()` (mount-if-needed, then patch) or
  `scanUnmount()` — see the hook right after `paintToast()`. Inside the
  overlay, only `#scanpanel`'s `innerHTML` is replaced on updates
  (`scanRenderPanel()`); the shell around it — the `<video>`, the close/torch
  buttons, and critically the manual-entry input — is built once in
  `scannerShellHTML()` and never recreated, which is also why the
  keyboard-wedge `keydown` listener is attached there and not inside
  `scanPanelHTML()` (an element rebuilt on every panel update would silently
  drop it — this was a real bug caught in testing, not a hypothetical one).
- **Engine selection**: `startScanEngine()` feature-detects
  `window.BarcodeDetector` — present, use it natively
  (`startNativeEngine()`, own `getUserMedia` + a ~280 ms poll loop, formats
  `ean_13`/`ean_8`/`upc_a`/`upc_e`); absent (iOS Safari), lazy-load the
  vendored zxing UMD bundle (`startZxingEngine()`,
  `public/vendor/zxing/zxing-browser.min.js`, global `ZXingBrowser`,
  `BrowserMultiFormatOneDReader` — restricted to 1D formats by construction,
  no hints needed). Both paths funnel into `handleScanCode()`, which
  debounces the **same** code for 1.5 s (`SCAN.lastCode`/`SCAN.lastAt`) so a
  steady camera view does not re-fire on every frame, but accepts a
  **different** code immediately.
- **Keyboard-wedge fallback**: the manual-entry input IS the wedge target —
  one small, low-emphasis field serves both a human typing a damaged code and
  a Bluetooth/USB scanner's rapid keystrokes-then-Enter. No separate hidden
  input, no dedicated UI for it.
- `applyStockAction(a)` — mirrors `applyBlogAction()`: `stock_adjust`/
  `stock_set` skip the demo/undo layer entirely (real inventory has no demo
  layer to write into) and go straight to `POST /api/admin/inventory/moves/`.

### Vendoring zxing (`tools/copy-vendor.mjs`)

`/shop2/*` ships `script-src 'self'` (next.config.ts) — no CDN script tag
survives that. `@zxing/browser`'s UMD build
(`node_modules/@zxing/browser/umd/zxing-browser.min.js`, ~430 KB minified,
self-contained — it bundles `@zxing/library` itself) is copied to
`public/vendor/zxing/` in `prebuild`, exactly like leaflet already is for the
parcel-machine map. Lazy-loaded (a `<script>` tag injected on first scanner
open, not on every page load) since most admin visits never open the camera.

### Camera permission (`next.config.ts`)

The site-wide `Permissions-Policy` header denies `camera` everywhere
(`camera=()`) — correct for the storefront, but it also silently blocked the
admin scanner until this was caught in testing (Chrome reports it as a
console "Permissions policy violation", not a `getUserMedia` rejection, so it
is easy to miss). `baseSecurityHeaders()` now takes an optional
`permissionsPolicy` override; the `/shop2` and `/shop2/:path*` header blocks
pass `SHOP2_PERMISSIONS_POLICY` (`camera=(self)`, same-origin only, every
other permission still denied). Every other route keeps the fully locked-down
default. If the scanner ever reports "Нет доступа к камере" in production
where a manual `getUserMedia` test in the browser console works, check this
header first, not the JS.

## PWA (`public/shop2/manifest.webmanifest`, `public/shop2/icons/`)

`start_url: "/shop2/admin/"` — already a valid client-side route
(`routeFromPath()`'s `/shop2\/(brands|account|admin)$/` match), nothing extra
to wire up. Icons generated once via `node tools/gen-pwa-icons.mjs` from
`public/brand/rempire-badge-dark.svg` (not part of `prebuild` — regenerate by
hand only if the badge artwork itself changes). `index.html`'s `<link
rel="manifest">` and Apple-specific tags (`apple-mobile-web-app-capable`,
`apple-touch-icon`, …) sit right after `<link rel="icon">`, inside the range
`tools/prerender-shop2.mjs` copies into every prerendered page's `<head>` — no
changes needed there. iOS Safari does not read the web manifest for its own
"Add to Home Screen"; the `apple-*` tags are what it actually uses.

## Assistant (`src/app/api/assistant/actions.ts`, `route.ts`)

- `stock_adjust {product_id, variant?, delta, reason}` — a relative move.
  `reason` is restricted to `goods_in|adjust|return`
  (`STOCK_ADJUST_REASONS`, duplicated from `inventory.ts`'s `MOVE_REASONS` on
  purpose — `actions.ts` stays free of database imports so the tests can run
  it as a pure function) — never `sale_web`/`sale_pos`, which only a real
  sale should ever write, to avoid a manual chat adjustment double-counting
  as a sale in the ledger.
- `stock_set {product_id, variant?, qty}` — an absolute count.
- Both admin-only, `product_id` must be a known catalogue id. Applied via
  `applyStockAction()` in app.js (see above), not `demoApply()`.
- `adminPrompt()` gets a fresh **STOCK** block on every admin call
  (`stockSummaryForPrompt()`, dynamically imports `@/lib/inventory`,
  best-effort empty string on failure) — tracked products currently reading
  мало/нет, up to 12. Unlike the hero/content/analytics briefs (which the
  panel already has open and posts along), this is read live server-side:
  cheap, and stock changes too often for a client-supplied snapshot to be
  worth the extra request/response plumbing.

## Tests

- `tests/inventory.test.ts` — `move()`/`setQty()` atomicity and the 0 floor,
  `deriveState()` boundaries, `byEan()`, `setLevel()` (including the EAN
  conflict and the qty-untouched guarantee), `productStockStates()`'s
  tracked-aggregation rules, `getLevels()`'s full-universe + filters, the
  `setOrderStatus()` return-move hook (paid→refunded/cancelled puts stock
  back; a never-paid cancel returns nothing), and `applyPaymentResult()`'s
  real (non-injected) paid-transition decrement — including that gift/bundle
  lines never trigger a lookup and a webhook retry never decrements twice.
- `tests/pos-orders.test.ts` — the POS route (admin auth, `channel:'pos'`,
  no-e-mail order, stock decrement, discount-percent-as-discount-code) and
  the receipt route (auth, content, 404 on an unknown order).
- `tests/assistant-actions.test.ts` — `stock_adjust`/`stock_set` sanitizing.
- `tests/helpers.ts`'s shared `truncateAll()` now also wipes
  `stock_levels`/`stock_moves`, and carries `cascade` — needed once
  `111_order_messages.sql` added a foreign key onto `orders` (unrelated to
  inventory, but it broke every test file's own ad-hoc `truncate orders …`
  statement without `cascade`; fixed in passing in the three that still
  construct `applyPaymentResult` order fixtures with real `items`, since the
  paid-transition decrement above now runs for real against their pglite
  database too).

## What is intentionally out of scope

- Bundle components are not decremented/returned individually — a bundle
  line's id is not a catalogue product id. Resolving `bundle:<id>` back into
  its parts would need the same `bundleDefs()`/`bundleParts()` logic
  `src/lib/orders.ts` already has privately; a future pass could export and
  reuse it.
- The scanner's continuous-decode loop does not attempt multi-code batching
  (scan several items in a row without lifting the phone) — each hit shows
  its own card and waits for the next explicit action.
