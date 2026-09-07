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
ведёт ссылка «Сканер отдельным приложением ↗» на вкладке «Склад».

Кнопка, которая открывает сканер, называется **«Сканировать»** — и на
«Складе», и в «Салоне». Раньше в шапке «Товаров» была вторая кнопка
«Приёмка», которая делала ровно то же самое; её убрали, чтобы одно действие
называлось одним словом.

## Как принять товар (приход)

1. Откройте иконку «Сканер» (или «Склад» → «Сканировать» в админке).
2. Разрешите доступ к камере (см. ниже про iPhone).
3. Наведите камеру на штрихкод (EAN-13, EAN-8 или UPC-A — это почти все
   штрихкоды на упаковках).
4. Как только код распознан, вы услышите/почувствуете сигнал, и на экране
   появится карточка товара с остатком. Обычный магазинный штрихкод
   (EAN-13, EAN-8, UPC) читается **с первого кадра** — держать флакон
   неподвижно полсекунды больше не нужно; в самом коде есть контрольная
   цифра, по которой сканер проверяет, что прочитал правильно, и цифры вы
   всё равно видите на карточке до того, как что-то сохраните.
5. Число по умолчанию — 1. Нажмите «+» столько раз, сколько нужно (или
   впишите число), потом «Принять +N». Всё, штуки на складе.
6. После этого сканер сразу готов к следующему коду — ничего нажимать не
   надо.
7. Если код ни к чему не привязан — экран спросит «К какому товару?»: наберите
   2–3 буквы названия и нажмите на нужную строку. В списке сразу товар и объём
   («Kevin.Murphy — Un.Tangled Spray · 40 мл»), поэтому привязка — одно
   нажатие. Дальше этот же штрихкод будет находить этот товар всегда.

Если камера не видит код (плохое освещение, помятая упаковка) — впишите цифры
штрихкода вручную в поле под камерой и нажмите «Найти». Если камеры нет
совсем, это поле открывается сразу и никакой ошибки не будет.

Если в магазине есть отдельный сканер-пистолет (Bluetooth или USB) — он тоже
работает: наведите и нажмите на нём кнопку, код сам появится там же, где и от
камеры телефона.

### Приблизить картинку

Маленький код на маленьком флаконе читается лучше, если его приблизить.
**Разведите два пальца прямо на картинке** — камера приблизится, справа внизу
на секунду появится «2,4×». Свести пальцы — отдалит. Если руки заняты
флаконом, **два быстрых касания** по картинке делают то же самое одним
пальцем: приблизить и обратно. Приближение запоминается — в следующий раз
сканер откроется там же, где вы его оставили. На некоторых телефонах камера
приближать не умеет — тогда пальцы ничего не делают и «×» не появляется.

Страница под камерой при этом не двигается: жест работает только на самой
картинке.

### Фонарик

Кнопка 🔦 вверху включает и выключает подсветку (на некоторых Samsung она
появляется через секунду-две после запуска камеры — это нормально).
**В темноте фонарик включается сам**, один раз за сеанс: если в кладовке
темно и код ещё ни разу не прочитался, сканер зажигает подсветку. Выключили
руками — больше сам не включится, пока не закроете и не откроете сканер.

### Сколько штрихкодов уже привязано

На «Складе» под кнопкой «Сканировать» и на самом экране сканера (между
кодами) есть строка **«Штрихкоды: привязано 12 из 322»**. Это вся работа по
первой привязке: в каталоге штрихкодов не было ни одного, поэтому каждый код
— это флакон, который кто-то отсканировал и привязал руками. Делать всё за
один вечер не нужно: строка показывает, где вы остановились.

## Как списать продажу без сайта (сканером)

Так же, как приход, только кнопка «− Списание» — для проданных штук без
оформления полноценного чека. Для настоящей продажи с чеком используйте
«Продажа в салоне» (ниже).

## Как поправить остаток вручную

На вкладке «Склад» у любого товара — кнопка «Править»: там можно вписать
настоящий остаток после пересчёта на полке, порог «мало» и штрихкод, и
написать причину (видно потом в истории).

Штрихкод можно вписать и в «Товаре» → «Размеры и цены», в колонке
«Штрихкод»: это тот же самый склад. «Отвязать» рядом с кодом только очищает
поле — код освободится после «Сохранить», так что случайное нажатие на
телефоне ничего не стоит.

## Весь список склада

Список показывает **все** товары, а не первые несколько десятков: он
подгружает следующие 60 строк сам, как только вы долистали до конца, а кнопка
«Показать ещё» внизу делает то же самое нажатием. Когда список кончился, внизу
написано, сколько всего строк («322 товаров»). Поиск и фильтры («Мало»,
«Нет», «Не учтено») ищут по всему складу, а не по тому, что уже на экране.

**Красное число остатка** значит «не больше порога «мало»» — своего у каждого
объёма, по умолчанию 2. Порог меняется кнопкой «Править» в той же строке.
Такое же правило теперь и в «Товаре» → «Размеры и цены».

## Как продать в салоне

1. «Салон» → впишите название, бренд или штрихкод в верхнее поле.
2. У каждого найденного товара — по кнопке на объём: «40 мл · 8 €». Одно
   нажатие кладёт этот объём в корзину справа. Кнопка серая — этого объёма
   нет на складе, и при нажатии появится «Нет на складе».
3. Можно и сканером: «Сканировать» вверху открывает тот же сканер в режиме
   продажи — «Добавить в продажу» вернёт вас в корзину с уже добавленным
   товаром.
4. В корзине поправьте количество кнопками +/−, при необходимости впишите
   скидку в процентах.
5. При желании впишите почту или телефон покупателя — тогда покупка попадёт
   в его историю заказов в личном кабинете. Необязательно.
6. «Наличные» или «Терминал» — это и есть кнопка оформления. Появится
   карточка с составом продажи и суммой; «Оформить» подтверждает.
7. Дальше — экран чека: номер, сумма, «N поз. · терминал · остатки списаны».
   Заказ сразу отмечен оплаченным, остатки списались, и в «Заказах» он
   появится с меткой «Салон».
8. «Чек для печати» открывает простой чек — распечатайте или сохраните как
   PDF через диалог печати браузера. «Новая продажа» очищает экран.

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
- `listMoves({productId?, reason?, since?, limit?})` — the ledger. (There was
  a `todaysMoves(limit)` wrapper that passed `since` = UTC midnight; nothing
  called it and it was removed 07.09.2026, `docs/audit/2026-09-07-cleanup.md`.)
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

- Since the redesign «Склад» is a **tab inside «Товары»** and the register is
  the **«Салон»** section of its own — `data-admtab="stock"` and `"pos"` still
  address them, which is what keeps the deep links and this suite working
  (`ADM_SECTION_OF` in `app.js`, docs/features.md § «Админка: оболочка»).
- `admStockHTML()` / `stockFiltered()` / `stockRows()` / `stockRowHTML()` /
  `stockEditFormHTML()`
  — the list, filtered/searched **client-side** against `S.stockLevels`
  (fetched once via `loadStockLevels()`, same pattern as `admCatalogRows()`
  against the in-memory `CATALOGUE`). Rows are sorted by quantity ascending —
  what is running out comes first — and carry a ± stepper
  (`data-stockstep="<key>:±1"`) that posts a relative move and offers an undo
  on the toast; «Править» opens the same form as before for the barcode, the
  «мало» threshold and an exact recount.
- **The list reaches every row** (Dim: «We need all»). It is drawn a page at
  a time — `S.stockShown`, `STOCK_PAGE` = 60 — and `stockGrow()` adds the
  next page. Two things trigger it: the `[data-stockmore]` button, and
  `stockScrollMore()` from the shared window `scroll` listener when the
  button comes within 400 px of the viewport. `stockGrow()` **appends**: the
  rows live in their own `[data-stockrows]` container, the count line is
  `[data-stockcount]`, and only those two are touched. That is not a
  micro-optimisation — rebuilding the list took the button out of the DOM in
  the middle of the press that asked for it (caught by
  `e2e/scanner-app.spec.ts`), and would take the scroll position and any open
  «Править» form with it every time. A new search or filter resets
  `S.stockShown`.
- `stockBoundCount()` / `stockBoundLine()` — «Штрихкоды: привязано 12 из 322»,
  drawn on «Склад» (`[data-stockbound]`) and on the scanner's idle panel.
  Counted over the WHOLE warehouse, never over the filtered list: it is a
  total, and a total that moved with the search box would answer a different
  question every time it was read. The first bind pass is ~220 bottles one at
  a time over several evenings, so this is the only thing that says where it
  got to.
- A row's remainder is red when the SERVER says the row is not `in` — its own
  `low_threshold`, default 2 (`deriveState`, `src/lib/inventory.ts`). The
  product editor's grid uses the same rule now (`edStockLow()`); it used to
  redden at a flat «3 or fewer», in the code and in its own hint, which
  disagreed with the «Мало» chip one screen away.
- `admStockMovesHTML()` — the ledger sub-view (`S.stockMovesOpen`).
- `admSalonHTML()` / `posSearchResultsHTML()` / `admPosReceiptHTML()` — the
  register, redesigned in phase 2 into two columns: a 52-h ink-bordered search
  on the left whose result rows carry **one 44-h chip per size** («40 мл ·
  8 €», muted and refused with «Нет на складе» when that shelf is empty —
  `data-posadd="<id>:<sizeIndex>"`, a bare id still meaning the first size),
  and the «Корзина» card on the right with the ± steppers, Итого in Oswald 28,
  the discount, the optional customer and the two buttons that finish the
  sale. «Наличные»/«Терминал» (`data-possend="cash|terminal"`) are the method
  **and** the send: they raise the confirm card (`pendingAction`
  `type:"pos_sale"`, listing what is about to be charged) and `posSend()` runs
  from «Оформить», because money goes through the card by rule. The receipt
  state keeps the print link and adds «N поз. · терминал · остатки списаны».
- The «Товар» editor writes to this module too — see docs/features.md
  § «Товар»: the «Остаток» and «Штрихкод» columns of its «Размеры и цены» grid
  are these rows, saved by the editor's own «Сохранить» (a relative
  `stock_adjust` for the count, `PUT /api/admin/inventory/` for the barcode).
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
  Since phase 2 both doors wear the SAME shell — `scanTopBarHTML()` header,
  viewfinder, panel, manual field, footer — and `S.scanApp` only decides the
  wordmark and where the × leads; see "The scanner as its own app" below.
- **The camera engine.** One stream, two decoders on top of it. Read
  `docs/audit/2026-09-07-scanner.md` before changing any number here: every
  one of them was chosen from `tools/scan-bench.mjs`, and the numbers it
  measured are in that report.

  ```
  startScanEngine()
   ├─ zxing script fetched from the first second (cached; a failed fetch is retried on the next open)
   ├─ BarcodeDetector.getSupportedFormats()   ← an empty list = skip the native path at once
   ├─ scanOpenCamera() → remembered lens, else facingMode:environment → scanPickLens()
   │     └─ enumerateDevices → back lenses → drop wide/ultra/tele/macro → lowest camera2 index
   ├─ scanTuneTrack(): focusMode:continuous · the remembered pinch zoom · torch re-checked at 0/0.5/1.5 s
   └─ startNativeLoop()  ── throws, or six mute seconds ──▶ scanNativeGaveUp() ──▶ startZxingLoop()
          every SCAN_TICK_MS (60), one view per pass — scanViewCanvas():
            ticks 0,1,2,3 → the band, turned back [0, +13, 0, −13]°
            every 9th    → the whole frame, capped at 1280 (insurance, ~1 point)
          every 8th pass also measures the light and may switch the torch on
  ```

  - `scanCropCanvas(tilt)` — the band the decoder reads: `0.92 × 0.60` of the
    short side, cut from the centre of the frame (which is what the square
    viewfinder shows, `object-fit: cover`), **at the sensor's own resolution**
    and optionally rotated. It used to be `0.76 × 0.44` drawn at 2×; the
    upscale added no information and cost the pass ~40 ms, which measured as
    7 expected reads per second of decoding against the current 20.
  - `scanCameraRead(code, format)` — when a read counts. A format that
    carries its own check digit (`SCAN_SELF_CHECKED`: EAN-8/13, UPC-A/E,
    CODE-128, QR) counts on the **first** frame; anything else (ITF, CODE-39)
    still needs two consecutive agreeing passes. Measured: one frame reads
    inside a second 99 % of the time, two frames 46 %.
  - zxing runs with plain hints and switches its **thorough** reader
    (`TRY_HARDER`) in on every other pass after `SCAN_HARD_AFTER_MS` (2.2 s)
    with nothing read. TRY_HARDER buys ~9 points of a single frame and costs
    8–10× the time, which is a losing trade until the owner is visibly stuck.
  - Both paths funnel into `handleScanCode()`, which debounces the **same**
    code for 1.5 s (`SCAN.lastCode`/`SCAN.lastAt`) so a steady camera view
    does not re-fire on every frame, but accepts a **different** code
    immediately.
- **Pinch-to-zoom** (`scanZoomStart/Move/End`, `scanApplyZoom`) — bound to
  `[data-scanzoombox]` (the viewfinder) only, which is `touch-action: none`
  in `admin.css`, so the panel underneath keeps every gesture it had. Two
  fingers scale the track's `zoom` constraint; a double tap toggles between
  `SCAN_ZOOM_START` and the far end, for the hand that is not holding a
  bottle. Clamped to `getCapabilities().zoom`, remembered in `localStorage`
  (`rmp-scan-zoom`), and simply absent on a lens with no zoom capability.
  `[data-scanzoom]` is the «2,4×» readout, shown while it moves.
- **The torch can light itself.** `scanFrameLuma()` measures the band's mean
  luminance off a 32-px thumbnail every eighth pass; below `SCAN_DARK_LUMA`
  (80), with a torch available and nothing read yet, `scanAutoTorch()` fires
  **once** per session. Measured: a lit shelf reads at ~50 % and a dark
  stockroom (dim + sensor-gain noise + longer exposure) at 0–20 %, at mean
  luminance 140 against 62.
- **The fallback is logged, not displayed.** When the native detector gives
  up, `scanNativeGaveUp()` writes `console.info` and sets
  `data-scanfallback="error|silent"` on the overlay. It used to put «Камера
  читает через запасной декодер…» under the viewfinder; Dim asked for that to
  go — it is a fact about the phone's Play Services, not about the bottle in
  the owner's hand. `data-scanengine` still says which decoder is running, and
  both attributes are what the e2e suite asserts on.
- **The result card**: `scanPanelHTML()` — «Найдено · EAN», the name, «объём ·
  на складе N», the giant stepper (`data-scanqty`, `[data-scanqtyinput]`) and
  the confirms `data-scanmove="in"|"out"` (`scanCommitMove()`) — or, in «Салон»
  mode, the single `data-scanmove="cart"` (`scanToCart()`). For a code nothing
  owns it is the «К какому товару?» search instead, whose candidate rows are
  flat product×size (`data-scanbind="<id>|<variant>"`) so one tap binds. A
  camera error is a LINE above whichever of those is on screen, never instead
  of it — returning early on `S.scanErr` hid the card a manually typed code
  brings up, which is the whole interface on a machine without a camera.
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

Icons are shared by all three apps and are the header's own tower mark —
`tower()` in app.js, ink `#1c1a00` on a white square, well padded — not the
old round «est 2018» badge. `node tools/gen-pwa-icons.mjs` reads the path out
of app.js and screenshots it with Playwright's Chromium into
`public/shop2/icons/`: `icon-192.png` / `icon-512.png` (purpose `any`, tower
62 % of the square), `icon-maskable-192.png` / `-512.png` (purpose
`maskable`, tower 58 % so it stays inside the 80 % safe zone a launcher may
mask to), `apple-touch-icon-180.png` for iOS, and the tab icon pair
`favicon.svg` (transparent, white in a dark UI) + `favicon-32.png`. Not part
of `prebuild` — rerun by hand only if the mark itself changes. Every manifest
has `background_color` and `theme_color` `#ffffff`, so the splash and the
status bar are white for the shop, the admin and the scanner alike, and
`index.html` inlines `html{background:#fff}` before its stylesheet so the
first paint is white too (the admin's `.adm2` paints its own paper once
loaded). iOS Safari does not read the web manifest for its own "Add to Home
Screen"; the `apple-*` tags in `index.html` are what it uses, and the title
swap above covers the name.

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
- **One scanner, one screen** (redesign phase 2). `scanMount()`/
  `scanRenderPanel()`/the engines are untouched; what changed is the skin.
  Both doors — the standalone route and the overlay «Склад»/«Салон» raise —
  now show the same full-screen dark screen: `scanTopBarHTML()` header
  («Rempire · Сканер» on the route, «Сканер» in the overlay) · the mode caption
  · torch · a 44-px ×, a 320-px viewfinder with the warn scan line, the white
  card, the manual field and the footer note. `S.scanApp` (set by
  `scanRouteSync()`) decides only the wordmark and where the × leads
  (`data-scanadmin` on the route, `data-scanclose` in the overlay). The shell
  is still built once per mount, so a mode change is a remount, not a patch —
  hence `SCANEL.dataset.scanapp`, checked by the mount hook. The dark CSS moved
  out of `styles.css` into `public/shop2/admin.css`, next to the rest of the
  panel's design system.
- **Two jobs, one screen.** `S.scanFrom` («stock» or «pos», set by
  `openScanner()` from the section that opened it) writes the caption
  («Склад: приёмка и списание» / «Продажа: товар добавится в корзину») and the
  buttons on the found card. In «Салон» mode there is one button, «Добавить в
  продажу · N» — `scanToCart()` puts the line in `S.posCart` and goes straight
  back to the register. It deliberately writes **no** stock move: the sale
  itself decrements the shelf (`POST /api/admin/pos-orders/`), and writing it
  here too would take the bottle off twice.
- **No button to press.** `scanRouteSync()` opens the scanner as soon as the
  session is confirmed and closes it when the route (or the session) goes
  away. It runs inside `renderImpl()` and therefore never calls `render()`
  itself — the mount hook at the bottom of the same pass acts on the flag.
- **The result card.** «Найдено · EAN» in ok green, the name at 600/17, «объём ·
  на складе N» (or «не учтено»), a giant stepper (64-px buttons, the number in
  Oswald 48) defaulting to 1, and two 56-h buttons carrying the number they
  promise: «Принять +N» (`goods_in`) and «Списать −N» (`sale_pos`). The ±
  patches those two labels in place (`scanPaintLabels()`) rather than
  repainting the card, for the same reason the field itself is patched — a
  repaint would fight the finger holding «+». One tap is the confirm —
  `scanCommitMove(sign)`
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
- **Getting there.** «Склад» has ONE button that opens the scanner —
  «Сканировать» (`data-scanopen`), in the body of the screen, the same word
  «Салон» uses in its own header — and ONE link to the standalone route,
  «Сканер отдельным приложением ↗» (`data-scanapp`). The «Приёмка» button
  that used to sit in the «Товары» header opened the same screen under a
  different name and is gone: «one name for the scanner everywhere» (Dim).

### Measuring the camera (`tools/scan-bench.mjs`)

Not a test — CI does not run it. It paints real EAN-13 barcodes (encoded from
the specification, check digit and all) into camera-sized frames across a
sweep of distances, tilts, blurs, light levels and glare, and runs the
**vendored zxing decoder** over each candidate framing, reporting read rate,
cost per pass and — the number that actually matters — `P(read within one
second of aiming)`.

```
node tools/scan-bench.mjs                 # the full sweep, ~11 min, 13 824 decodes
node tools/scan-bench.mjs --quick         # a third of the images
node tools/scan-bench.mjs --focus         # the low-light and rotation questions only
node tools/scan-bench.mjs --json out.json # every cell
```

Run it before changing `SCAN_TICK_MS`, `SCAN_TILTS`, `SCAN_FULL_EVERY`,
`SCAN_SELF_CHECKED`, `SCAN_DARK_LUMA`, `SCAN_HARD_AFTER_MS` or the crop
geometry, and put the numbers in the audit note — that is how the current
values were chosen (`docs/audit/2026-09-07-scanner.md`). It measures the zxing
half only (headless Chromium has no camera and no `BarcodeDetector`), which is
the floor under every phone; the native detector is strictly better where it
works, and both paths share one schedule (`scanViewCanvas()`) so they cannot
drift apart.

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
  Also the sentence the product editor now says out loud: a size nobody has
  set a threshold on warns at 2, so 3 is `in` and 2 is `low`.
- `tests/inventory-bind-route.test.ts` — the bind/lookup HTTP contract: both
  doors' 401, the bind + lookup round-trip, `ean_taken` naming the bottle that
  holds the code, `ean: null` freeing it, `bad_ean`/`bad_threshold`, and
  `state` following the row's own threshold.
- `tests/inventory-scanner.test.ts` — the **browser** half, sliced out of
  `public/shop2/app.js` by source text and run against stubs (the technique
  `tests/checkout-parity.test.ts` established, so this tests the shop's own
  code rather than a retyped copy). What it pins: which formats count on one
  frame and which still need two; the band's geometry (994×648 out of a
  1920×1080 frame, drawn 1:1, cut from the middle) and its rotation; the view
  schedule and why 9 and 4 are coprime; «Склад»'s paging, its search and the
  rows/count/button split that lets a page be appended; «привязано N из M»;
  the editor's red following `state`; the pinch clamp; and that the «запасной
  декодер» sentence is gone from the file while the console line is not.
- `e2e/scanner-app.spec.ts` — ten scenarios end to end on a phone viewport;
  see docs/testing.md § "The scanner app".
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
