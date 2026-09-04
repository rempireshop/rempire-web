# Handoff: Rempire admin («Админка») redesign

## Overview
Full UI/UX overhaul of the Rempire admin panel (Rempire Store OÜ, rempireshop.com). One user: Renat, the owner, non-technical, works mostly from an iPhone installed as a PWA. Goal: every task doable with one thumb in under a minute; desktop for sit-down work (blog, descriptions). Scope covers information architecture, a compact design system, and every section + flow from the brief (`00-CLAUDE-DESIGN-BRIEF.md`).

## About the design files
Files in this bundle are **design references built in HTML** — an interactive prototype showing intended look and behavior. They are not production code. Recreate them in the existing **vanilla-JS single-page app** (no React, no new third-party services), keeping the existing login card, RU/ET/EN toggle, confirm-before-apply, change journal with undo, AI assistant (propose-only) and toasts. Must work as an installed PWA on iPhone and Android, WCAG AA, touch targets ≥ 44 px.

## Fidelity
**High-fidelity.** Colors, type, spacing, component sizes and copy are final. Icons are simple 24-px line icons (paths are in the prototype source; any equivalent 1.5-px-stroke line icon set is acceptable). Product photos are placeholders. Blog "visual editor" is a behavioral spec — implement with a small contenteditable block editor, not Markdown.

## Files
- `Admin Prototype.dc.html` — the interactive prototype; every section, every flow, mobile + desktop (switch by resizing under 760 px). Read the logic class at the bottom for exact state transitions and copy.
- `Admin.dc.html` — static system sheet: tokens, components, IA map, phone screens (RU + ET), desktop overview.
- `00-CLAUDE-DESIGN-BRIEF.md` — the original brief with the problem list; every numbered problem maps to a solution below.
- `support.js` — runtime needed only to open the `.dc.html` files locally. Ignore for implementation.

---

## Information architecture (13 sections → 5 tabs)

Phone: sticky bottom bar, 5 items, 64 px tall. Desktop: left sidebar 232 px (collapsible to 68 px, icons only), same items plus the «Ещё» group inline under a rule.

1. **Обзор** — "Сделать сегодня" list, sales today / 7 days, last orders.
2. **Заказы** (badge = paid-not-shipped count) — list with filters; order card with 4-step fulfilment.
3. **Товары** — tabs *Каталог · Склад · Наборы*. Editor with 5 tabs. Sets created here (fix for brief #3).
4. **Салон** — POS (search → cart → cash/terminal → receipt) and the **Scanner** full-screen mode.
5. **Ещё** (phone: bottom sheet; desktop: sidebar group)
   - Клиенты — tabs *Все клиенты · Отзывы* (reviews merged here).
   - Маркетинг — tabs *Промокоды · Подарочные карты · Письма* (gift cards get their home, fix #11; mail editor, fix #5).
   - Блог — list + visual editor (fix #4).
   - Аналитика.
   - Подключения — actionable rows (fix #13).
   - Настройки — index of 6 sub-pages (fix #6): Доставка и оплата · Главная страница · О компании · Цены и баллы · Языки · Журнал изменений.
   - Footer of the sheet/sidebar: RU/ET/EN toggle · «Открыть магазин ↗» · «Выйти».

Removed everywhere: the blue info banner, uppercase letter-spaced sub-headings, grey explanatory paragraphs (fix #10). Assistant leaves the third column and becomes a floating button (fix #8).

---

## Design tokens

Colors
- paper `#ffffff` (page background — the admin is white, not shell)
- shell `#edeae1` (only around device frames in docs; not used inside the app)
- tint `#f6f4ee` (active nav row, user chat bubble, placeholders, «Салон» badge)
- rule `#e5e1d6` (all hairlines, inactive borders)
- ink `#1c1a00` (text, primary buttons, strong rules)
- muted `#6f6b57` (secondary text, inactive icons)
- ok `#2e5b45` (shipped, published, «В наличии», success toast border)
- warn `#8a4b2d` (low stock, cancel/destructive, warnings, stars)
- sidebar badge number text on ink: `#bdb9a8` for de-emphasised step numbers

Typography (Google Fonts: Oswald 400/500, Golos Text 400/500/600, PT Mono)
- Screen title: Oswald 500, 30/34 px (28/32 on phone); Oswald is used **only** for screen titles and big numbers.
- Big number: Oswald 400, 28–48 px, line-height 1–1.1.
- Section label: Golos 600, 15 px.
- Body: Golos 400, 15/22 px. Secondary: Golos 400, 13/18 px muted.
- Codes (order ids, EAN, promo codes): PT Mono 13 px.
- Nav labels: Golos 600 (active) / 400, 15 px sidebar, 11 px bottom bar.
- Wordmark: Oswald 15 px, letter-spacing .18em, «REMPIRE».

Geometry
- Corner radius 0 everywhere. No shadows. 1 px rules; 2 px rule under active tab and as active-row right border in sidebar.
- Spacing scale 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40. Page padding: phone 16 px 20 px; desktop 32 px 48 px. Content max-width 1000 px.
- Heights: primary/secondary button 48 (44 in headers, 40 inline in rows); inputs 48 (44 in dense grids); list row min 56–72; nav row 44; bottom bar 64; toggle 44×26 with 20-px knob; switch knob moves left 2 → 20 px in .15 s.
- Two-column pages: `minmax(0,1fr) 320px` (POS/mail editor: `360px`), collapse to one column when content area < 820 px or on phone.
- Motion: page enter `fadeUp` .25 s (opacity 0→1, translateY 8→0); sheets/cards .2 s; sidebar width .2 s.

---

## Components

- **Button primary**: ink bg, white text, Golos 500 15 px, 48 h, padding 0 20. **Secondary**: white, 1 px ink border. **Tertiary**: text link, underline offset 3 px. **Destructive**: warn text, underlined, no border. **Disabled**: tint bg, muted text, rule border.
- **Input / select / textarea**: 48 h, 1 px rule border, padding 0 14, focus = 2 px ink outline inset. Label above: 13 px muted. Search inputs may use ink border when they are the screen's main action (POS).
- **Filter chips**: 40 h, padding 0 14, 14 px 500; active = ink bg/white; inactive = white, rule border. Horizontal scroll on phone.
- **Tabs**: 15 px, padding 10 px 0, gap 24; active = 600 + 2 px ink underline; strip has `overflow-x:auto; overflow-y:hidden`. Optional warn-coloured count after label («Склад 2»).
- **Status badge**: 24 h, padding 0 8, 12 px 500, nowrap. Оплачен = ink filled; Новый / Ждёт оплаты = ink outline; Отправлен / Опубликован / В наличии = ok outline; Мало = warn outline; Нет = warn filled; Отменён / Скрыт = rule outline muted; Салон = tint filled muted.
- **List row → card**: single pattern on both viewports: `border-top 1px ink` on the list, `border-bottom 1px rule` per row, 12 px vertical padding; thumbnail 44–48 px tint square; right-aligned Oswald 17 px amount.
- **Confirm card**: overlay `rgba(28,26,0,.35)`; card max 440, white, 1 px ink border, padding 20; title 600 17 px; detail 15/22 with `white-space:pre-line`; two 48-h buttons 1fr/1fr: [Применить-style verb] filled (warn filled for destructive) + «Отмена». Phone: sheet at bottom (`align-items:flex-end`, no padding).
- **Toast / undo snackbar**: 56 h ink bar, white 15 px text, optional «Отменить» 600 underlined; bottom 28 desktop / 84 phone (above the bar); max-width 520; auto-hide 6 s. Undo also writes a «Отмена: …» line to the journal.
- **Empty state**: dashed rule border, 28 px padding, centered, 14 px muted, optional link. **Error**: warn border + «Повторить». **Loading**: tint skeleton bars.
- **Bottom sheet** (phone «Ещё», assistant): white, 1 px ink top border, 36×3 px grab handle, rows 56 h.
- **Nav icons**: 24-px viewBox line icons, stroke 1.5 (active 2.2), `stroke-linecap:square`. Paths: see `ICONS` in the prototype logic.
- **Assistant FAB**: 52 h ink, icon + «Помощник» (icon only on phone), bottom-right 20/28 px; hidden while the assistant pane/sheet is open or in scanner mode. Desktop pane: 380 px right column, header 64 h with «›» collapse button; phone: 75 %-height sheet.

---

## Screens

### Обзор
Header: date line (13 muted) + title; right: primary «Отправить N» when N paid orders wait. Two columns (`1fr 320px`):
- **Сделать сегодня** (count on the right): rows 64 h — big Oswald 28 number (warn colour for low stock) · label «заказа ждут отправки / товара заканчиваются / отзыв ждёт проверки» · muted detail (names) · chevron. Rows navigate to Заказы (filter Новые), Товары → Склад, Клиенты → Отзывы. Correct plural forms for 1 vs many. When nothing is pending: dashed empty state «Всё в порядке».
- **Последние заказы** with «Все заказы» link; 4 most recent rows; click opens order.
- **Продажи**: Сегодня (real sum of today's paid+salon orders, «2 заказа · 1 в салоне») and 7 дней (sum, «11 заказов · 44,60 € в день», 7 bars 36 h, today ink). No demo numbers anywhere (fix #1).

### Заказы
Title; chips «Новые N · Отправлены · Ждут оплаты · Салон · Все» + search (id, name, phone). Row (card): name 600 + amount Oswald 17 · `R-xxxxx · time · N товара` / delivery line · badge + inline actions right-aligned: paid → «Наклейка» (secondary, becomes «Наклейка ✓») + «Отправлен» (primary); unpaid → «Написать». Empty: «Таких заказов нет».

### Заказ (card)
«← Заказы»; mono `id · time`; title = customer; badge. **4-step strip** in a 1 px ink box, 4 equal cells: 1 Оплачен · 2 Наклейка · 3 Отправлен · 4 Письмо клиенту; done cells ink/white, current tint/600, future white/muted. Actions row: «Напечатать наклейку» (primary until printed, then secondary «Наклейка ✓») · «Отметить отправленным» (secondary until label printed, then primary) · «Написать клиенту» · destructive «Отменить заказ». Steps/actions hidden for salon and cancelled orders. «Написать клиенту» opens an inline card with the AI-drafted message (prefilled per status), «Отправить»/«Отмена». Then two columns: Состав (lines, delivery price or «бесплатно», Итого Oswald 20) · Покупатель / Доставка (address, tracking in mono when present) / Заметка textarea. Shipping = confirm card → status shipped, tracking generated, toast «R-… отправлен · письмо ушло» with Отменить, journal entry (fix #14).

### Товары
Title with muted count; primary button changes per tab: «+ Товар» / «Приёмка» / «+ Набор». Tabs Каталог · Склад (warn count) · Наборы.
- **Каталог**: search (name, brand, EAN) → rows: 48 thumb · name (muted if hidden) · sizes «40 мл · 150 мл · 18 шт» · price or range «9–24 €» · badge (В наличии / Мало / Нет / Скрыт). Click → editor.
- **Склад**: «Сканировать» primary + hint; rows per product×size sorted by qty asc: name · «size · EAN» (warn «штрихкод не привязан» when empty) · stepper [− qty +] 44-px buttons, qty Oswald 20 (warn ≤ 3). Each tap = immediate change + undo toast + journal (no confirm; undo is the safety net).
- **Наборы**: if sets are switched off, an inline notice «Наборы выключены — в магазине их не видно нигде» + «Включить». Set editor (inline card): name · pick list of visible products with 22-px checkboxes · price + auto «По отдельности X / Скидка Y %» · Сохранить (needs name + ≥ 2 items) / Отмена. List rows: name · «A + B» · price · «Изменить».

### Товар (editor) — fix #2
«← Товары»; kicker «Бренд · Раздел» (or «Новый товар»); title; «Открыть в магазине ↗». Tabs: **Основное · Размеры и цены · Фото и видео · Описание · Google**. **Sticky save bar** at the bottom on every tab: «Сохранить» primary · «Отмена» · destructive «Удалить» (confirm card; undo restores).
- Основное (two columns, max 760): Название, Бренд, Раздел (select), Подраздел · Наличие (select: В наличии / Нет в наличии / Под заказ), «Показывать в магазине» switch row, hint about salon price −20 %.
- Размеры и цены: grid `1.2fr 1fr 1fr .8fr 1.4fr 44px` — Размер · Цена € · Салон € (auto = price×0.8 on price change, editable) · Остаток (warn ≤ 3) · Штрихкод (mono, placeholder «сканер ›») · × remove (min 1 row). «+ Размер» dashed button.
- Фото и видео: photo grid `minmax(120px,1fr)`, first tagged «главное» (ink), others tagged with the size name; × per photo; dashed «+ Фото с телефона». Hint: first photo main, drag to reorder, watermark automatic. Video: chips **YouTube · Instagram · Загрузить** (fix #12); link input (mono) for the first two, dashed 64-h upload button for the third («MP4 до 200 МБ»); attached video row with ▶ thumb and ×.
- Описание: language segmented control Русский/Eesti/English + «Написать черновик» / «Перевести с русского»; textarea 8 rows; hint «Русский — основной…».
- Google: title, description, «Заполнить автоматически».
Validation: save requires a name; new product cancelled with empty name is discarded. New product is created hidden.

### Салон (POS)
Title + «Сканировать» primary. Left: 52-h search (ink border) → result rows: name + one 44-h chip per size «150 мл · 21,60 €» (salon price); out-of-stock chips muted, tap → toast «Нет на складе». Right: «Корзина» card (1 px ink): lines with stepper, Итого Oswald 28, optional customer input, «Наличные» (secondary) / «Терминал» (primary) → confirm card listing lines → receipt state: «Продажа оформлена ✓», mono id, Oswald 40 total, «N поз. · терминал · остатки списаны», «Чек для печати» / «Новая продажа». Sale appears in Заказы with «Салон» badge; stock decremented; journal entry.

### Сканер — fix #7
Full-screen dark mode (`#1c1a00`), header «Сканер» · mode caption («Склад: приёмка и списание» / «Продажа: товар добавится в корзину») · × (44). Idle: 320-px viewfinder square with warn scan line, hint, manual-code input (mono). Found: white card — «Найдено · EAN» (ok), product 600 17, «size · на складе N», giant stepper (64-px buttons, Oswald 48 qty), «Принять +N» primary / «Списать −N» secondary (in POS mode: single action adds to cart and returns), «Сканировать дальше». Unknown code: warn «Код не привязан · code», «К какому товару?», autofocused search, candidate list (product · size, «без кода» marker) — one tap binds EAN to that size, toast, then goes straight to the Found state. Footer note: same screen ships as the standalone admin-only «Rempire Сканер» PWA. Three taps max: scan → (bind) → quantity → Принять.

### Клиенты
Tabs «Все клиенты · Отзывы (warn count)». Clients: chips Все · Заявки Pro N · Партнёры · Розница, «Скачать CSV» link; rows: name · «email · N заказов · sum» · tier badge (Заявка Pro warn outline / Pro ink filled / Розница rule outline) · for pending: «Одобрить Pro» primary + «Отказать». Отзывы: author 600 + warn stars + «· product» · badge Новый/Опубликован/Скрыт; text; for new: «Опубликовать» / «Скрыть» (both with undo toast).

### Маркетинг
Tabs Промокоды · Подарочные карты · Письма; header button «+ Промокод» on the first tab.
- Промокоды: inline form (code mono uppercase · kind chips Процент / Сумма в евро / Бесплатная доставка · value · min order · Создать/Отмена); rows: code (mono, muted when off) · «10 % · от 30 € · бессрочно · использован 14» · switch.
- Подарочные карты: denominations as 48-h Oswald 18 toggles (25/50/75/100 €), hint «продаётся отдельным пунктом в меню магазина, не в «Наборах»»; design thumbnails (dark, light, + Своё); right: «Выпущенные карты» with unspent total; rows code mono · «to · date» · balance / «из amount».
- Письма: rows name · when-sent · «всегда» (ok outline, for order confirmed/shipped) or switch · «Изменить». **Editor**: «← Все письма», name, RU/ET/EN segmented, Тема, Первый абзац (textarea), Подпись, hint that order number/items/tracking are inserted automatically, «Сохранить» + «Отправить мне тест» (toast «Тест отправлен на …»). Right: live preview card on tint — wordmark, subject with `{номер}` replaced by a real id, intro, sample order block, signature.

### Блог — fix #4
List: 72×48 cover thumb · title · «date · excerpt» · badge Опубликована/Черновик; «+ Статья». **Editor**: «← Блог»; language segmented; title input (Oswald 28, only a bottom ink rule); 160-h dashed cover drop zone (state text changes once set); toolbar in a rule box, 40-h buttons: **Заголовок · B · I · • Список · Ссылка · Картинка · Товар** — nothing else; block canvas (min 280 h, 16/24 px text): heading blocks 600 20 px, paragraphs contenteditable, image placeholder 140 h, product card (1 px ink, thumb, name, Oswald price). Right column: «Публикация» card (status text, «Опубликовать» / «Сохранить и обновить» primary, «Сохранить черновик») and «Помощник» card («Написать черновик по теме», «Перевести на ET и EN»). Publish requires a title. Provide 2–3 sample posts in seed data.

### Аналитика
Period chips Сегодня · 7 дней · 30 дней · 90 дней; KPI grid `minmax(150px,1fr)` bordered cells (label 13 muted, Oswald 32 value, delta line ok/warn/muted): Выручка · Заказы · Средний чек · Из корзины в заказ; bars by weekday (today ink, labels below); Топ товаров list; «Искали, но не нашли» list.

### Подключения — fix #13
Rows: 10-px status square (ok / warn) · name · one-line plain-Russian status or what to do next (warn colour when action needed) · action button (primary when action is required, e.g. «Написать Дмитрию»). Footer line with the developer contact. Seed rows: Montonio, Omniva/DPD/SmartPosti, Resend, Google Search Console (warn, domain not verified), Аналитика посещений, ИИ-помощник, Сканер/камера (warn if no camera permission).

### Настройки — fix #6
Index list (max 640): 6 rows 64 h with label + muted description + chevron. Sub-pages have «← Настройки» + title:
- Доставка и оплата: tariff grid Страна · Пакомат € · Курьер € · Бесплатно от € (rows Эстония, Латвия, Литва, Финляндия) · «Сохранить» (goes through confirm card) · «Заполнить по тарифам Montonio»; then Оплата switches (карта/банк-ссылки, Apple/Google Pay, при получении).
- Главная страница: announce bar text, first slide title, switches «Показывать блок подарочной карты на главной», «Показывать наборы» (off = sets hidden everywhere in the shop: lists, categories, «bought together»).
- О компании: legal name, hours, phone, Instagram.
- Цены и баллы: salon discount %, points per €, birthday points, «Pro-цены партнёрам» switch.
- Языки: Эстонский (note: «Blog» instead of «Ajaveeb»), Английский switches.
- Журнал изменений: rows `time (mono) · text · «Вернуть»` for undoable entries; undone rows get « — возвращено». Empty state explains the journal.

### Помощник (assistant)
Chat: assistant messages plain, user messages tint bubble right-aligned; 3 suggestion chips; input 48 h + «→». Answers are grounded in real data (low stock list, weekly revenue, orders waiting). When it suggests a change it renders a **proposal card** (same shape as confirm card) inside the chat; «Применить» performs the change, writes the journal and toasts; the assistant never applies anything by itself.

---

## State (from the prototype; map to the existing SPA store)
`route`, `sidebar` (bool), `assistant` (bool), `moreOpen`; orders (`status: paid|unpaid|shipped|salon|cancelled`, `labeled`, `tracking`), `orderFilter`, `orderQuery`, `curId`, `msgOpen`; products (`sizes[]: size, price, salon, qty, ean`, `hidden`, `avail`, `video`, `photos`), `productTab`, `productQuery`, `curPid`, `editorTab`, `descLang`, `videoKind`; sets, `setEditing`, `setsOn`; `posCart`, `posQuery`, `posDone`; `scan {phase: idle|found|unknown, code, pid, i, qty, query, from}`; customers, reviews, `custTab`, `custFilter`; promos, `promoForm`, giftcards, `giftOff`; mails (`subject/intro/sign` per lang), `curMail`, `mailLang`; posts, `blogEditing {title, blocks[{t:h|p|img|product}], cover}`, `blogLang`; `period`; `settingsPage`, `pay`; `confirm {title, detail, ok, bg, apply}`, `toast {text, undo}`, `journal [{time, text, undo}]`, `chat`, `proposal`.

Rules: any change that affects the shop or money goes through the confirm card (ship, cancel, sale, tariffs, delete); quick reversible edits (stock ±1, review publish, promo toggle) apply immediately with an undo toast; **every applied change writes a journal entry**, with an undo function where reversible.

## Copy
Plain Russian, short labels, no jargon; RU is the source, ET/EN are translations (sample ET screen in `Admin.dc.html`). Use «Blog» in Estonian. Exact strings are in the prototype template and logic.

## Assets
- Fonts: Oswald, Golos Text, PT Mono (Google Fonts).
- Icons: line paths in `ICONS` (prototype logic) — or equivalent set.
- Brand mark: Rempire tower badge from the storefront; product photos: real catalogue images with automatic watermark.
