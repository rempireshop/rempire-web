# Handoff: REMPIRE storefront + admin (7 directions, interactive spec)

## Overview
Full design package for the REMPIRE rebuild (rempireshop.com → own platform, Next.js repo `dimnovare/rempire-web`, staging `rempireshop.diipsolutions.eu`). It contains an interactive comparison of **8 storefront directions** (А–З) with working screens (home, category, product, search, blog, cart, checkout, account) plus a **pixel-spec admin with an AI assistant**, a brand-motion system for the tower logo, and all design docs.

**Decision state:** Renat (owner) picks the direction from `/brand/directions`. Recommendation on record: **Ж — Opus×Fable** (final synthesis). Everything shared (admin, checkout, account, cart, motion) is direction-independent and can be implemented now.

## About the Design Files
The files in `prototypes/`, `archive-v1/` and `motion/` are **design references created in HTML** — interactive prototypes showing intended look and behavior, NOT production code. The task is to **recreate these designs in the target codebase** (`rempire-web`: Next.js 15 App Router, TypeScript, Tailwind 4, tokens in `src/app/globals.css`, self-hosted fonts, bun) using its established patterns. `docs/ADMIN-PIXEL-SPEC.md` is the one exception: its §9 contains verbatim TanStack/Tailwind source approved by the client — port it to Next.js keeping every number.

## Fidelity
**High-fidelity.** Colors, type sizes, spacing, borders, motion timings and copy are final unless marked mock. Recreate pixel-perfectly; Russian copy is verbatim (do not rewrite).

## How to review
Open `prototypes/Directions.dc.html` in a browser. Top shell: direction switcher (А…З), Телефон/Компьютер width toggle (390 / 1280 px frames), ▶ ИНТРО replay, screen tabs (Главная · Категория · Товар · Корзина · Оформление · Поиск · Блог · Кабинет · Админка). `prototypes/Rempire.dc.html` is the single-direction "Opus" study that direction Ж inherits from. `archive-v1/` is the frozen first review round.

## Design tokens (exact)
| Token | Value | Use |
|---|---|---|
| ink | `#1c1a00` | text, rules, fills, inverted bands, admin sidebar |
| paper | `#fdfcf9` | page ground, text on ink |
| shell | `#edeae1` | quiet fills, draft headers, service strips (Е), progress tracks |
| tile | `#ffffff` | product image tiles (packshots `mix-blend-mode:multiply`) |
| rule | `rgba(28,26,0,.15)` | 1px hairlines (storefront also uses .13/.2/.25 variants — keep as authored) |
| error | `#8c1a0f` | validation, «ЖДЁТ ОПЛАТЫ», «ЧЕРНОВИК», low stock. Never decorative |
| muted | `#78745f` | secondary text ≥12px |
| ease | `cubic-bezier(.2,.8,.2,1)` | all motion; draw uses `cubic-bezier(.45,0,.25,1)` |
Radius 0 everywhere. No shadows (exceptions: frame chrome and cross-sell toast `0 12–14px 34–38px rgba(28,26,0,.35)`), no gradients.

## Typography
- **Oswald 400–600** (display; uppercase, tracking .04–.3em) + **Golos Text 400–600** (body 13–14px/1.5). Self-host woff2, cyrillic+latin unicode-range; **no Google Fonts CDN in production** (EU IP disclosure; prototypes use the CDN for preview only).
- **Korolev Bold** (`public/fonts/KorolevBold.otf`, desktop license — web license unconfirmed): brand artwork + the word **REMPIRE** only (Latin). Directions Г and Ж set the header wordmark and hero REMPIRE in Korolev (fallback Oswald).
- Direction Ж/Opus type system: Golos-only for ALL text (headlines weight 500, tracking −.035em), Korolev for REMPIRE, Oswald only in admin.

## The tower mark (never redraw)
`prototypes/uploads/rempire-tower.svg` — single continuous path, viewBox `292.24 171.22 265.18 409.8`. Recolor via CSS mask or `currentColor` `<use>` only. Clip windows for animating parts (path untouched): band `M335,242H502V304H335Z` (2u overlap kills AA seams), rest `evenodd M270,150H580V600H270Z M337,244H500V302H337Z`.

## Motion system (storefront chrome)
- **Intro** (once per session; replayable): tower draws as line — `stroke-width:1.7`, `pathLength:1`, dashoffset 1→0, 1.25–1.3s draw-ease, .12s delay — then fill fades in .6–.65s at 1.2s; wordmark letter-spacing .02em→.3em (.8s) at ~1.55s; overlay fades out .5s at 2.4s; skippable by click; total ≤3.1s.
- **Route loading**: header logo replays the same sequence small — line draw .62s + fill .22s at .6s (total ≈850ms) while `navLoad` state is on.
- **Idle «sentry blink»**: crown band slips −13 viewBox-units and back once every ~8–9s (keyframes 0/91–92/94–95/98/100%).
- **Hover**: logo nudges `translateX(2px)` .16s. Screen enter: fade+`translateY(10–12px)` .42–.5s. Drawers slide .32s; toast lifts .35s.
- `prefers-reduced-motion: reduce` → all animation off (skipped, not shortened).
- Full logo-motion catalog + React reference: `motion/` (`Tower Motion.dc.html`, `TowerAnimated.tsx`, `MOTION.md`).

## Shared storefront components (all directions)
- **Announce bar**: ink, paper text 11px, «Бесплатная доставка: EE, LV, LT, FI — от 50 € · Европа — от 200 €».
- **Header**: logo 42px (Б: 46px) + wordmark; search input (borderless, 1px bottom rule); flags **RU/ET/EN as images** (19×13, 1px rule border, active = 2px ink underline + full opacity, others .42–.45; flagcdn in prototype — self-host in production); account (person icon 20–21px stroke 1.5) and cart (bag icon + ink count badge 14–15px, 9px text). Icon buttons padding 7px. **Mobile (≤390 frame):** cluster gets `order:1;margin-left:auto` onto row 1 beside the logo; search gets `order:2; flex:1 1 100%` → its own full-width row 2. Desktop: DOM order, search `flex:1 1 150px`.
- **Category nav**: horizontal scroll row, 12.5px links, 1px bottom rule.
- **Product card**: white tile 1:1 (border `rgba(28,26,0,.07–.08)`), packshot `contain`+multiply at 78–82%; **tower watermark on every product image**: 12×19px (gallery 16×25) ink mask of the tower, opacity .14–.15, bottom-right 6px (gallery 12px) — production: bake into the image pipeline on upload; brand caps 9.5–10px tracking .14–.16em muted; name 12.5–13px/1.35; price 600; always-visible quiet «+ в корзину» (no hover-only actions). Card click → PDP; add stops propagation.
- **Cross-sell toast** (on any add-to-cart): ink card bottom-center `min(430px,92cqi)`, packshot 46px, «Добавлено ✓ · К шампуню подойдёт: …», Добавить (adds), ×; auto-hide 6s; ONE suggestion, never blocks.
- **Cart drawer** (right, `min(360–370px,88cqi)`, 1px ink left rule): qty stepper, Убрать, free-shipping progress (2px track shell/ink, «До бесплатной доставки … ещё N €» → «порог 50 € достигнут ✓»), Итого, ОФОРМИТЬ ЗАКАЗ, Продолжить покупки. Empty state → «К бестселлерам».
- **PDP**: breadcrumb; **swipe gallery** — scroll-snap strip (`overflow-x:auto; scroll-snap-type:x mandatory`, slides `flex:0 0 100%; scroll-snap-align:start`, scrollbars hidden), thumbs 58px jump via `scrollTo({behavior:'smooth'})` and track active via onScroll (`round(scrollLeft/clientWidth)`), hint «листайте фото свайпом →» on phone / «фото n / 2» on desktop; volume variants (40 мл 7€ / 250 мл 27€) as bordered toggle buttons; qty stepper; solid ink В КОРЗИНУ; delivery line; accordions Описание/Преимущества/Применение/Состав (INCI)/Доставка и возврат (returns: 14 дней, cosmetics only unopened — legal signoff pending); sticky bottom buy bar on phone (price + В КОРЗИНУ); «С ЭТИМ ПОКУПАЮТ» row.
- **Category**: breadcrumb, H1 + indexable intro (verbatim in prototype), Фильтры drawer (left; brand/type/price), sort select, grid `repeat(auto-fill,minmax(min(100%,150px),1fr))` gap 26×14 → 2-up at 390, «ПОКАЗАТЬ ЕЩЁ 12».
- **Search**: big field, suggestion links/chips, results grid, zero-result card («духи» example) with category routes, «напишите нам», and «Запрос сохранён…» (feeds admin missed-demand).
- **Blog**: index rows (numbered in Б) + full article (real long-form, image-slot placeholders for photography).
- **Checkout** (shared, own chrome): guest-first single page. 1·КОНТАКТ (email; typo error in `#8c1a0f`: «Похоже, в адресе опечатка…»; «Аккаунт не нужен…»), 2·ДОСТАВКА (radios: Omniva 3,50 / SmartPosti 3,50 / DPD 3,90 / курьер 5,90 + parcel-machine select), 3·ОПЛАТА (Банковская ссылка + bank chips Swedbank/SEB/LHV/Luminor/Coop, карта, Apple/Google Pay, PayPal, по счёту + company hint), sticky summary card, ОПЛАТИТЬ {total}, consent line.
- **Кабинет** (shared): passwordless login (email → «ПОЛУЧИТЬ КОД»; guest orders stay email-linked). Logged in: МОИ ДАННЫЕ (name/email inputs + СОХРАНИТЬ → «Сохранено ✓»), МОИ ЗАКАЗЫ (status chips, one-tap «Повторить» re-add), МОИ ПРОМОКОДЫ (DR-RENAT10 −10% birthday АКТИВЕН; WELCOME5 ИСПОЛЬЗОВАН muted), ДОСТАВКА ПО УМОЛЧАНИЮ (parcel machine + Изменить), newsletter checkbox, Выйти.
- **Mobile bottom nav** (directions В, Е, Ж; hidden on PDP): sticky bar, 4 equal buttons 10px caps ГЛАВНАЯ · КАТАЛОГ · ПОИСК · КОРЗИНА · n, 1px ink top rule, 44px+ targets.
- **Footer**: service grid (Доставка/Оплата/Магазин Mardi 1), newsletter row, links, © 2026 Rempire Store OÜ; Б uses the full badge at 92px.

## The 8 directions (home-hero + accent deltas; everything else shared)
- **А — Белый зал**: quiet text hero (h1 clamp 19–26px weight 500), hairline rules only, tower as small stamp. Renat's stated baseline.
- **Б — Башня**: own header (2px ink rules, wordmark 17px/.34em); hero = Oswald uppercase clamp(30,7cqi,64) + lettered category rows; tower watermark right side `top:50%/translateY(-50%); height:86%; opacity:.09`; bordered-cell product grids (1px rule, no gaps); one ink editorial band; numbered blog rows.
- **В — Синтез**: А skeleton + stage hero (eyebrow ТАЛЛИНН · EST 2018, Oswald REMPIRE clamp 30–58 tracking .12em, copy, В КАТАЛОГ/ПОИСК, tower watermark right .12 × 90%) + Б's ink band + bottom nav.
- **Г — Редакция /qa**: the project's first shipped design language. Centered tower stamp 64px (with blink), **Korolev** REMPIRE clamp(40,8cqi,74) + «TOWER · EST 2018» 12px/.5em, 44×1px rule, Golos copy, В КАТАЛОГ/ЖУРНАЛ. Header wordmark in Korolev 16px/.24em.
- **Д — Урбан (архив)**: archived pre-answers brief («urban, editorial, a little bold»). Full-bleed campaign photo slot (52cqi max 500px, shell bg) + ink title plate (Oswald clamp 22–42 uppercase), URBAN · EDITORIAL · TALLINN · EST 2018 strip + СМОТРЕТЬ КАТАЛОГ, oversized brand ticker (Oswald 19px, 35% ink, horizontal scroll). Marked as conflicting with Renat's minimalism — shown for completeness.
- **Е — Lovable**: from the Lovable handoff. Oswald hero + tower watermark right .1 × 86%, signature **shell service strip** (ДОСТАВКА 1–3 ДНЯ · ВОЗВРАТ 14 ДНЕЙ · MARDI 1 · БЕСПЛАТНО ОТ 50 €, Oswald 11px/.14em on `#edeae1`).
- **Ж — Opus×Fable ★ (recommended)**: Golos-only type; hero eyebrow ТАЛЛИНН · MARDI 1 · EST 2018, h1 «Уход, которым мы работаем каждый день» clamp(29,5.4cqi,52) w500 −.035em, copy, two CTAs, tower right .11 × 86%; **numbered category tile grid** (`minmax(min(50%,190px),1fr)`, cells 18×16px pad, 1px rules, hover `#f2efe7`, № 10px 40% ink); Korolev wordmark; bottom nav. Fold Fable's own moves in when its export arrives.
- **З — Видео**: owner-video hero (frameforge-style "living page"). Full-bleed `<video>` on ink, height 58cqi max 560px, `object-fit:cover`, `grayscale(1) contrast(1.05)` opacity .88, **autoplay muted + playsinline** (camelCase `autoPlay` in React), 4 clips (`prototypes/media/owner-1…4.mp4`) auto-advancing on `ended` (cycle) with В1–В4 switcher buttons (34px, active 1px paper border, bg `rgba(28,26,0,.55)`) and «ЗВУК: ВЫКЛ/ВКЛ» toggle; programmatic `play()` kick after every src/mute change (autoplay policies). Ink title plate bottom-left (Oswald uppercase clamp 20–38): «Процесс. Результат. Всё, что между ними.» + sub. Below: running ticker — duplicated span, `@keyframes tick{to{transform:translateX(-50%)}}` 22s linear infinite — and a service row noting clips are owner-managed in admin (Маркетинг → Медиа). Bottom nav on phone. Production: videos uploaded via admin media library, compressed server-side, poster frame required, reduced-motion → poster only.

## Admin (direction-independent) — canonical spec
**`docs/ADMIN-PIXEL-SPEC.md` is authoritative** (tokens, 240px ink sidebar w/ 92×80 badge, search bar, panel primitive, Сводка KPI + panels, Заказы chips, Товары packshots + low-stock rule, Тексты textareas w/ draft flip, 360px assistant dock with three-state draft cards, verbatim source in §9). Additions made on top of it in the prototype — implement all:
1. **Badge rendering**: paper-colored **CSS mask** of `rempire-badge-dark.svg` (92×80, centered) — survives any SVG fill.
2. **Sidebar collapse**: « toggle → 56px rail (desktop) with tower glyph + С/З/Т/М/SEO letter buttons (40×40, title tooltips, same active fill); on phone the rail is a full-width horizontal strip (flex `1 0 56px`, children wrap row). Expanded sidebar phone = full-width ink block.
3. **Assistant collapse + mobile**: header » → desktop 44px rail with vertical «АССИСТЕНТ»; expanded desktop `flex:1 1 clamp(280px,28cqi,360px)`, `min-width:min(100%,280px)` (basis clamp keeps it docked at narrow desktops). **Phone**: `position:sticky; bottom:0; z-index:15`, expanded = full-width sheet `max-height:min(70vh,540px)`, 2px ink top rule, log scrolls inside, auto-scroll on new message; collapsed = slim full-width «« Ассистент» bar (flex `1 0 100%`). **Any AskButton auto-opens the dock.**
4. **Attention chips** on Сводка above KPIs: «2 новых заказа — обработать →» «1 заказ ждёт оплаты →» (error border) «1 товар заканчивается →» — 40px, jump straight to the section.
5. **Маркетинг section** (5th nav item, count 3): Промокоды panel (code Oswald .06em w104px, desc, АКТИВЕН/ЧЕРНОВИК chips, usage count, «+ Новый промокод — через ассистента»); Дни рождения (auto letter + personal −10% code 3 days before; upcoming list w/ «Посмотреть» via assistant; «Поздравлять автоматически» toggle); Рассылка (subscriber count, last campaign + open rate, create via assistant); Автоматика toggles (брошенная корзина 3ч, авто-счёт, отзыв через 7 дней, низкий остаток).
6. **Товары note**: «Фото товаров получают водяной знак — башню REMPIRE — автоматически при загрузке.» → implement watermarking server-side on media upload.
7. Global search finds order/product/customer/email/invoice (single field, per UX audit).
UX contract: plain Russian, no jargon, one primary action per screen, every assistant write is a draft (Было/Станет → Опубликовать/Отклонить → Отменить → «НЕ ПРИМЕНЕНО»), max one ink band per screen, 44px targets (34px inline chips).

## State & data
Prototype state to model: cart (count, sum, free-ship threshold 50), cross-sell toast, language (RU/ET/RU strings pending), account (passwordless session, profile, promo codes), gallery index, admin tab, sidebar/assistant collapse, assistant thread w/ draft statuses, content-page draft states, promo/birthday/newsletter data, missed searches, abandoned carts. Real catalog (names/prices/images) in the prototypes' JS — CDN `https://rempireshop.com/cdn/shop/files/…` (migrate media to own storage; brand covers under `/cdn/shop/collections/…`).

## Accessibility & SEO (binding)
Focus-visible 1px ink outline offset 3px; labels on inputs; no hover-only actions; real H1 + indexable category/brand copy; breadcrumbs; alt text everywhere; staging stays noindex (meta + robots.txt + X-Robots-Tag).

## Avoid (client-approved guardrails)
No gold/glow/gradients/rounded cards/shadows, no emoji, no invented products/claims/urgency, no icon-only actions, no technical jargon in UI, no second animated mark on screen, never redraw the tower.

## Assets
- `prototypes/uploads/rempire-tower.svg` — canonical mark (also at repo `public/brand/`)
- `prototypes/public/brand/rempire-badge-dark.svg`, `rempire-badge-white.svg` — full badge
- `prototypes/public/fonts/KorolevBold.otf` — display (artwork/wordmark only; license check before web use)
- Flags: flagcdn.com in prototype — self-host 19×13 PNGs in production
- Owner videos: `prototypes/media/owner-1…4.mp4` (direction З hero; from Instagram — re-export clean masters for production)
- Product/brand photography: live Shopify CDN (temporary)

## Files
- `prototypes/Directions.dc.html` — the interactive 7-direction spec (all screens, admin, motion) + `support.js`, `image-slot.js`, assets
- `prototypes/Rempire.dc.html` — single-direction Opus study (source of Ж)
- `archive-v1/` — frozen first round (А–Д before the pixel-spec admin), self-contained
- `motion/Tower Motion.dc.html`, `motion/TowerAnimated.tsx`, `motion/MOTION.md` — logo motion system
- `docs/ADMIN-PIXEL-SPEC.md` — authoritative admin spec (verbatim source §9)
- `docs/REMPIRE_DESIGN_SYSTEM.md`, `docs/IMPLEMENTATION_INVENTORY.md` (mock-data map + open issues), `docs/LOVABLE_PROMPT.md` (compact brand brief), `docs/github.md` (repo association + screen map)

---

## Delta 23.08 (applied to the hosted prototype by Claude Code from the design session's text spec)

1. Mobile bottom nav on ALL directions (was В/Е/Ж/З): 5 icon items ГЛАВНАЯ ·
   КАТАЛОГ · ПОИСК · КАБИНЕТ · КОРЗИНА (20px stroke icons, 9px labels,
   52px+ targets, active = inset 2px ink top bar + stroke 1.9, cart badge
   top -4/right -7). Hidden on product screen and desktop frame. Б keeps a
   2px ink top rule, others 1px.
2. Mobile header language = one control: active flag + ▾ opens a bordered
   dropdown (44px rows: flag + name + ✓, active row #edeae1); picking or any
   navigation closes it. Desktop keeps three inline flags with underline.
3. Part-2 answers bound in: admin requisites Rempire Store OÜ · Mardi 1,
   Tallinn · 56237237 · rempireshopinfo@gmail.com; roles Владелец / Товары /
   Заказы / Маркетинг; EAN scan-to-find; B2B tiers modeled but hidden;
   image pipeline must survive a full reshoot (bulk re-upload + watermark).
4. Video hero (З): already implemented in the 22.08 build (imperative src +
   play() re-kick) — no change needed.
5. Feedback widget moved to the bottom-right corner (bottom nav now owns the
   bottom-left).

## Delta 23.08 (2) — PDP express payment (applied from the design session's text spec)

Both PDP variants get, below the qty + В КОРЗИНУ row: a black (#000, not
ink) full-width G Pay button («Купить через» + colored G mark, 46px) and a
centered «Другие способы оплаты» underline link. Both add the selected
variant x qty to the cart without a toast and navigate straight to checkout;
the G Pay path preselects the Apple Pay / Google Pay payment radio, the
other-methods path and the regular drawer flow preselect Банковская ссылка.
Production note: render the real Google Pay button via the Payment Request /
Google Pay JS API (buttonColor black, buttonType buy, RU locale) with the
native sheet where supported — the prototype's inline SVG is placeholder
art only.
