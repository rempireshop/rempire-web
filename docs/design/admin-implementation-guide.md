# Rempire admin redesign — implementation guide for the build agents

Source of truth (read in this order):
1. `README.md` (this folder) — the pixel spec: IA, tokens, components, every screen, state rules, copy rules.
2. `Admin-Prototype.dc.html` — the interactive prototype (lines ~22–636 template, ~636–860 the logic
   class: state shape, view-model functions, exact Russian copy, `ICONS` paths). Treat its copy and
   its state transitions as final. It is a design reference, NOT production code.
3. `Admin.dc.html` — the static system sheet (tokens, components, IA map, phone screens RU + ET).
4. `00-CLAUDE-DESIGN-BRIEF.md` — the original problem list (numbered problems → solutions in README).

Target: the existing vanilla-JS SPA `public/shop2/app.js` (+ `styles.css`, `index.html`) of
C:\Users\Dmitri.MARKIT\source\repos\rempire-web — no React, no new services. The admin lives at
/shop2/admin/ inside the same SPA; the scanner app at /shop2/scan/; both are PWAs (manifests in
public/shop2/*.webmanifest, swapped by syncAppManifest()).

## Non-negotiables
- Keep every existing capability: login card + rate-limited password login; RU/ET/EN toggle
  (dictionary `UI={ET,EN}` keyed by Russian; `node tools/i18n-gaps.mjs` must print 0 untranslated
  and 0 duplicate keys); confirm-before-apply (`pendingAction` → «Применить» / «Отмена»);
  change journal with undo (`demoApply`/undo/`srvPush`); the assistant proposes, never applies;
  toasts; all server APIs as they are (no route or payload changes unless a screen truly needs
  one — then add the route to tests/fuzz-routes.test.ts and keep requireAdmin).
- Keep the `data-*` hooks the e2e suite relies on wherever the same control still exists
  (grep e2e/*.spec.ts for `data-adm`, `data-ed`, `data-stock`, `data-pos`, `data-scan`, `data-hero`,
  `data-content`, `data-promo`, `data-blog`, `data-mail`, `data-bundle`, `data-cust`, `data-rev`,
  `data-pricing`, `data-ship`). When the redesign removes or renames a control, update the spec in the
  same change so the suite stays green; never delete a test to make it pass.
- Phone first: 375 px must be perfect; desktop 1280 second. Touch targets ≥ 44 px; WCAG AA.
- No uppercase letter-spaced headings, no grey explanatory paragraphs, no info banner (README).
- Oswald only for screen titles and big numbers; everything else Golos Text; codes PT Mono.
- Corner radius 0, no shadows, 1 px rules. Tokens exactly as README «Design tokens».

## How the redesign lands in app.js
- New stylesheet block for the admin (either a clearly delimited section at the end of styles.css
  or a new `public/shop2/admin.css` linked from index.html after styles.css — one file, decide in
  phase 1, document it). Admin-only class prefix `adm-` (new) so it never collides with `.adm__*`
  legacy rules; delete legacy admin CSS that is no longer referenced when the screen it styled is
  gone.
- Screens stay functions returning HTML strings; state stays in `S` (+ `DEMO`/`SRV`); events stay
  delegated (extend the `closest()` selector list). Reuse existing data loaders/API helpers
  (`apiJson`, `apiSend`, `loadStockLevels`, `loadAdminPricing`, `loadShipLiveRates`,
  `loadBundles`, mail texts, blog helpers, POS, scanner, overview endpoint `/api/admin/overview/`).
- Navigation per README IA (13 → 5 tabs). Map old tab keys to the new places and keep
  `data-admtab="<key>"` working as deep links from the assistant («Открыть …» buttons) and from
  tests: over→overview, orders→orders, goods/stock/bundles→products (+ product sub-tab),
  pos→salon, people/reviews→customers (+ tab), promos/gift/mail→marketing (+ tab), blog→blog,
  stats→analytics, apps→connections, setup→settings (+ sub-page).
- Phone: sticky bottom bar (5) + «Ещё» bottom sheet; desktop: sidebar 232 px collapsible to 68.
  Assistant: FAB → desktop pane 380 px / phone sheet 75 %. Confirm card: overlay + card (desktop),
  bottom sheet (phone). Toast/undo snackbar per README.

## Phases (sequential on app.js; each phase = one agent run, then integration)
Phase 1 — shell + core screens: tokens/components CSS, nav (bottom bar, sidebar, «Ещё» sheet),
  header/title pattern, assistant FAB + pane/sheet (existing assistant logic behind it), confirm
  card, toast + undo snackbar, journal writing helper; screens: Обзор (uses /api/admin/overview),
  Заказы list + filters + row actions, Заказ card with the 4-step fulfilment strip and
  «Написать клиенту», Товары shell with tabs Каталог · Склад · Наборы (Каталог list; Склад rows
  with ± steppers and undo; Наборы list + inline set editor on top of the bundles API).
Phase 2 — Товар editor (5 tabs, sticky save bar, sizes & prices grid with EAN, photo/video tab
  with YouTube · Instagram · Загрузить, description with language segmented control + AI
  buttons, Google tab), Салон (POS two-column, receipt state) and Сканер restyle (dark
  full-screen, giant stepper, found/unknown states) — the scanner logic exists, restyle only.
Phase 3 — Клиенты (tabs Все клиенты · Отзывы), Маркетинг (Промокоды · Подарочные карты · Письма
  with the mail editor + live preview), Блог list + editor layout (block editor exists — restyle
  and add the right column cards), Аналитика (KPI grid, bars, top lists), Подключения (actionable
  rows), Настройки index + 6 sub-pages (Доставка и оплата, Главная страница, О компании, Цены и
  баллы, Языки, Журнал изменений) on top of the existing settings cards' logic.
Phase 4 — sweep: remove dead legacy admin code/CSS, i18n (ET/EN for every new string), update
  every affected e2e spec, run the full suite, screenshots of every screen (desktop + phone) for
  the owner.

## Testing rules
- `E2E_PORT=<given port> npx playwright test e2e/<spec>.spec.ts --project=desktop` (and mobile);
  never `node tools/e2e-build.mjs`, never `npm run e2e`, never the whole suite; one `next dev` per
  checkout at a time (shared `.next`).
- `npx tsc --noEmit` clean; `node tools/i18n-gaps.mjs` clean; do not commit/push.
