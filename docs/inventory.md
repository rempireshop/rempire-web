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

## Отдельная иконка «Сканер» на телефоне

Чтобы не заходить каждый раз в админку: откройте на телефоне
**/shop2/scan/** и добавьте страницу на экран «Домой» (в Safari —
«Поделиться» → «На экран “Домой”»; в Chrome — меню ⋮ → «Установить
приложение»). Появится третья иконка, **«Сканер»**, которая открывается
сразу в камере. Пароль спросят один раз, как в админке. Из админки туда
ведёт кнопка «Открыть сканер» на вкладке «Склад».

## Как принять товар (приход)

1. Откройте иконку «Сканер» (или «Склад» → «Сканировать» в админке).
2. Разрешите доступ к камере (см. ниже про iPhone).
3. Наведите камеру на штрихкод (EAN-13, EAN-8 или UPC-A — это почти все
   штрихкоды на упаковках).
4. Как только код распознан, вы услышите/почувствуете сигнал, и на экране
   появится карточка товара с остатком.
5. Число по умолчанию — 1. Нажмите «+» столько раз, сколько нужно (или
   впишите число), потом «+ Приход». Всё, штуки на складе.
6. После этого сканер сразу готов к следующему коду — ничего нажимать не
   надо.
7. Если код ни к чему не привязан («Код не найден») — «Привязать к товару»:
   наберите 2–3 буквы названия, нажмите на товар, при необходимости выберите
   объём. Дальше этот же штрихкод будет находить этот товар всегда.

Если камера не видит код (плохое освещение, помятая упаковка) — впишите цифры
штрихкода вручную в поле под камерой и нажмите «Найти». Если камеры нет
совсем, это поле открывается сразу и никакой ошибки не будет.

Если в магазине есть отдельный сканер-пистолет (Bluetooth или USB) — он тоже
работает: наведите и нажмите на нём кнопку, код сам появится там же, где и от
камеры телефона.

## Как списать продажу без сайта (сканером)

Так же, как приход, только кнопка «− Списание» — для проданных штук без
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

Иконок может быть три, и это три разных приложения: «Rempire» (магазин, со
страницы `/shop2/`), «Админка» (`/shop2/admin/`) и «Сканер» (`/shop2/scan/`,
см. выше). Ставьте те, что нужны.

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
least one *counting* `stock_moves` row — `goods_in`, `adjust` or `return`
(`TRACKING_REASONS` in `src/lib/inventory.ts`). A sale never makes a variant
tracked: `move()` skips a `sale_web`/`sale_pos` on a variant nobody has counted
yet (`MoveResult.skipped`, logged as `[inventory] sale on untracked …`), so the
first paid web order can never flip an uncounted product to «нет в наличии» —
which is also what keeps the e2e suite's fixed products (`e2e/fixtures.ts`)
addable after every mock-paid order.
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
  What counts as a barcode (`normEan()`): a retail code is digits only,
  8–14 of them (EAN-8, UPC-A, EAN-13, GTIN-14 — what the phone scanner
  reads); an internal code the shop prints itself is letters, digits and
  dashes, 4–32 characters, upper-cased. Anything else ("abc", a lone digit)
  is refused as `bad_ean` rather than stored as a barcode nothing will ever
  scan.
- `move({productId, variant?, delta, reason, ref?, actor?})` — the one door
  quantities change through. Atomic (`withTx`): row-if-missing, a locked
  read, then `qty = qty + delta` clamped at 0 (`clampedNegative: true` when
  clamped — callers log it, `move()` itself never throws for this), plus one
  `stock_moves` row, in one transaction. A sale reason on an untracked variant
  is skipped instead (`skipped: true`, nothing written — see "tracked" above).
  Fires the existing back-in-stock
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
  reason `'sale_web'` — tracked variants only; an uncounted one is skipped by
  `move()` (see "tracked" above). When the dep is not injected (production), a local
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
  The shell comes in two shapes — the overlay's floating ✕/torch circles, and
  the standalone app's top bar (`scanTopBarHTML()`, `S.scanApp`) — chosen at
  mount time; see "The scanner as its own app" below.
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
- **The result card**: `scanPanelHTML()` — photo, name, size, remainder, a
  quantity stepper (`data-scanqty`, `[data-scanqtyinput]`) and the two
  confirms `data-scanmove="in"|"out"` (`scanCommitMove()`), or, for a code
  nothing owns, the «Привязать к товару» search. Same markup in both shells.
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

## PWA (`public/shop2/manifest.webmanifest`, `public/shop2/admin.webmanifest`, `public/shop2/scanner.webmanifest`, `public/shop2/icons/`)

Three installable apps from the same page, so a customer is never offered an
app called «Админка» or «Сканер»:

- **Shop** — `manifest.webmanifest`: `id`/`scope`/`start_url` `/shop2/`,
  name «Rempire». Linked from `index.html` (and therefore from every
  prerendered page's `<head>`). Anyone may install it; the owner reaches the
  panel inside it via `/shop2/admin/` + login, like on the web.
- **Admin** — `admin.webmanifest`: `id`/`scope`/`start_url` `/shop2/admin/`,
  name «Rempire — админка», short name «Админка». Not linked in HTML at all:
  `syncAppManifest()` in app.js (called from `renderImpl()`) swaps the
  `<link rel="manifest">` href to it — and the `apple-mobile-web-app-title`
  to «Админка» — whenever the admin screen is on, and back to the shop
  manifest on any other screen. Chromium re-reads the manifest when the
  link changes, so the install prompt on `/shop2/admin/` offers the admin
  app; a different `id`/`start_url` makes it a separate app from the shop.
  The scope `/shop2/admin/` means «В магазин» from the installed admin opens
  in a browser tab — intended.
- **Scanner** — `scanner.webmanifest`: `id`/`scope`/`start_url` `/shop2/scan/`,
  name «Rempire — сканер», short name «Сканер». Same mechanism, same icons,
  never linked in HTML either; `syncAppManifest()` swaps to it (and the apple
  title to «Сканер») on the scan screen. Installed, it is a third icon on the
  owner's phone that opens straight into the viewfinder — see below.

Icons are shared, generated once via `node tools/gen-pwa-icons.mjs` from
`public/brand/rempire-badge-dark.svg` (not part of `prebuild` — regenerate by
hand only if the badge artwork changes). iOS Safari does not read the web
manifest for its own "Add to Home Screen"; the `apple-*` tags in
`index.html` are what it uses, and the title swap above covers the name.

## The scanner as its own app (`/shop2/scan/`)

The «Склад» overlay is the scanner for someone who is already in the panel.
The owner's actual job is neither — he stands at a shelf with a phone and a
box of bottles. So the same scanner also stands on its own route, installs as
its own icon, and opens straight into the camera.

- **Route.** `routeFromPath()` accepts `/shop2/scan/` alongside
  `brands|account|admin`; `pathFor()`'s generic `/shop2/<screen>/` rule already
  produces the path, so `go("scan")` and Back work with no special case. Not
  prerendered, disallowed in `robots.txt` and refused by the sitemap's `NEVER`
  guard (`tools/prerender-shop2.mjs`) exactly like `/shop2/admin/`; the
  `noindex, nofollow` robots meta comes from `index.html`, which is the shell
  every non-prerendered `/shop2/` path rewrites to.
- **Admin-only.** `screenScan()` calls the same `probeAdmin()` and shows the
  same «Проверяем…» / «Вход в админку» cards as `screenAdmin()` — `admHeader()`
  now takes the word in the header as an argument («Сканер» here). Signing in
  happens **in place**: `admLogin()` only flips `SRV.admin`, so the viewfinder
  takes over the screen the moment the password is accepted, with no
  navigation. Strictly `SRV.admin === true` — unlike the panel there is no
  demo mode to fall back to, since every button here writes to the warehouse.
- **One scanner, two shells.** `scanMount()`/`scanRenderPanel()`/the engines
  are untouched and shared. `S.scanApp` (set by `scanRouteSync()` at the top of
  `renderImpl()`) picks the shell: the «Склад» overlay keeps its floating ✕ and
  torch circles; the app grows `scanTopBarHTML()` — «Rempire · Сканер», torch,
  a keyboard button that focuses the manual field, and «В админку». The shell
  is built once per mount, so a mode change is a remount, not a patch — hence
  `SCANEL.dataset.scanapp`, checked by the mount hook.
- **No button to press.** `scanRouteSync()` opens the scanner as soon as the
  session is confirmed and closes it when the route (or the session) goes
  away. It runs inside `renderImpl()` and therefore never calls `render()`
  itself — the mount hook at the bottom of the same pass acts on the flag.
- **The result card.** Photo, name, size, «Остаток: N» (or «не учтено»), a
  stepper defaulting to 1, and two big buttons: «+ Приход» (`goods_in`) and
  «− Списание» (`sale_pos`). One tap is the confirm — `scanCommitMove(sign)`
  POSTs `delta = sign × qty` to `/api/admin/inventory/moves/`. It replaced the
  older `+1 / −1 / Приход по количеству` trio, which needed three different
  buttons to say the same thing. The number is read off the DOM
  (`scanQtyNow()`), so typing into the field and stepping it are the same
  path, and neither costs a repaint per keystroke.
- **Auto-resume.** After a move the card is refreshed rather than dismissed
  (the new remainder is the receipt), the stepper returns to 1, `SCAN.lastCode`
  is cleared so the very same item can be scanned again immediately, and the
  panel says «Готово — сканируйте следующий код.». Nothing to tap to go back
  to scanning.
- **Unknown code.** «Код не найден» → «Привязать к товару» → the live product
  search (`scanAssignResultsHTML()`, `CATALOGUE`) → pick the product → pick the
  size when there is more than one → `scanBindEan()` PUTs
  `/api/admin/inventory/` and re-looks the code up, so the goods-in card takes
  over straight away. Unchanged apart from the two headings.
- **No camera is not an error.** Denied, absent or a desktop browser: the
  existing Russian sentence is shown, the viewfinder shrinks
  (`.scanoverlay.is-nocam`) and the manual field — which is also the
  bluetooth/USB wedge target — gets the screen and the focus.
- **The toast had to be raised.** `.scanoverlay` is `--z-scan: 95`, above the
  toast's 70, so «Приход +3 ✓» used to be painted *underneath* the camera: the
  owner pressed the one button that matters and nothing appeared to happen.
  `body.is-scanning .toast` (the class is set by the same render hook that
  mounts the overlay) lifts it back on top. This affects the «Склад» overlay
  too, where it was equally invisible and equally wrong.
- **Getting there.** «Склад» carries one line — «📷 Сканер как отдельное
  приложение: откройте /shop2/scan/ на телефоне…» — and an «Открыть сканер»
  button (`data-scanapp`).

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
