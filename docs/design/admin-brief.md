# Rempire admin — UI/UX overhaul brief for Claude Design

Paste the block under **PROMPT** into Claude Design together with the screenshots in this folder
(start with the two contact sheets, then add individual screens as needed).
Everything below the prompt is supporting material you can paste in pieces when Claude Design asks.

---

## PROMPT

You are redesigning the admin panel («Админка») of Rempire, a small salon-cosmetics shop in
Tallinn (Rempire Store OÜ, rempireshop.com). Attached are screenshots of every screen and state
of the current admin at desktop (1280 px) and iPhone (375 px) width, plus two contact sheets.
The current panel works and is fully functional, but it is too complicated: long single-column
pages, twelve-section forms, Markdown, grey explanatory paragraphs instead of UI, demo numbers
next to real ones. I need a complete redesign: a design system, mobile-first layouts for every
section, and the flows listed below. Keep the shop's visual language (paper and ink, editorial,
rectangular, thin rules, Oswald display type + Golos Text body — see the storefront at
https://rempireshop.diipsolutions.eu/shop2/) but make the admin calm, obvious and fast.

**Who uses it.** One person: Renat, the owner. Non-technical, reads Russian, runs the shop from
his phone standing in the salon between clients. ~220 products, a few web orders a day at most,
salon sales every day, one warehouse shelf. He installs the admin on his phone as a separate
app («Админка»). Everything must be doable with one thumb in under a minute; the desktop
version is for the rare "sit down and write" tasks (blog, descriptions).

**What must stay (it is the safety net).** Login card; the RU / ET / EN toggle (Russian is the
source language, the panel is translated); the confirm-before-apply pattern (a change is
proposed → «Применить» / «Отмена»); the change journal with one-tap undo; the AI assistant that
answers questions and *proposes* actions (never applies them itself); toasts for feedback.

**Current sections (13):** Обзор · Заказы · Товары · Склад · Продажа в салоне · Клиенты ·
Отзывы · Промокоды · Блог · Аналитика · Письма · Подключения · Настройки. You may regroup them.

**Problems to solve (see the screenshots):**
1. Overview shows demo numbers ("вчера — 5" is random); no "what needs my attention today".
2. Goods editor = 12 sections in two columns (price, salon price, availability, category,
   subcategory, photos, photos per size, SEO, video, description ×3 languages, AI buttons).
   No way to add a product or a size; no tabs; the Save button is at the very bottom.
3. Bundles/sets («Наборы») cannot be created or edited anywhere in the admin; there is only an
   on/off switch buried in Settings.
4. Blog editor is a Markdown textarea with a preview — too technical. Needs a simple visual
   editor: headings, bold, lists, links, images (upload or paste), product cards, cover; nothing
   else. Also: when sets are off, nothing about sets may appear in the shop.
5. Mail («Письма») only has on/off toggles and a preview; the owner cannot edit a letter's
   subject or text. Needs a simple per-language editor: subject, intro paragraph, signature,
   with a live preview and a "send me a test" button.
6. Settings is one endless page of eight unrelated cards (delivery tariffs table, payment,
   languages, mail list, shop switches, hero slides, company content, pricing & loyalty,
   reports, journal). Split it into obvious sub-pages.
7. Warehouse («Склад») and the barcode scanner: the scanner is a button inside the stock tab and
   opens an overlay. Binding a barcode to a product takes several steps. Design the scanner as
   its own full-screen mode (or a separate admin-only mini-app) where the flow is: scan →
   product found → +/− quantity or "bind this code to…" with a one-tap product search. Three
   taps maximum.
8. The AI assistant occupies a fixed third column on desktop and sits below the content on
   mobile. Make it a floating button that opens a drawer / bottom sheet.
9. On the phone only 4 of 13 sections are visible in the top strip; the rest need a hidden
   horizontal scroll. Navigation must be obvious on a phone.
10. Uppercase letter-spaced headings and grey paragraphs everywhere; the info banner "Заказы —
    настоящие, с сервера…" repeats on every screen. Replace explanation with clear UI.
11. Gift cards («Подарочная карта») have no admin place at all (amounts, designs, issued cards,
    balances) and in the shop they live under «Наборы», which is the wrong place.
12. Product videos: today only a YouTube/Vimeo link. Needs upload from the phone and Instagram
    reels as well.
13. Integrations («Подключения») is a static list of what is connected; make it actionable (status,
    what to do next, who to call).
14. Orders: fulfilment should be one flow — new order → print label → mark shipped → customer
    notified — with the message to the customer one tap away.

**Deliverables:**
- A compact design system: tokens (paper/ink palette, spacing, type scale), buttons, inputs,
  selects, chips, status badges, tabs, tables that become cards on mobile, bottom sheets and
  modals, toasts, the confirm card, the undo snackbar, empty states, loading and error states.
- Information architecture proposal (sections and sub-pages) with a phone navigation pattern.
- Mobile + desktop layouts for every section listed above.
- Flows, each as a sequence of screens: (a) add a new product with sizes, prices and photos;
  (b) create a bundle/set from existing products with a set price; (c) add a product video
  (YouTube link, Instagram reel, upload); (d) scan a barcode and bind it to a product / receive
  goods; (e) write and publish a blog post with images and product cards; (f) edit the
  «Заказ отправлен» e-mail in Russian and Estonian and send a test; (g) fulfil an order end to
  end; (h) manage gift cards; (i) the overview when 3 orders wait for shipping, 2 products are
  low and 1 review is pending.
- Copy in plain Russian (short labels, no jargon); Estonian and English are translations.

**Constraints for the build:** it will be implemented in the existing vanilla-JS single-page app
(no React), so prefer straightforward components over exotic interactions; must work as an
installed PWA on iPhone and Android; WCAG AA contrast; touch targets ≥ 44 px; one primary
action per screen; no new third-party services.

---

## Supporting material

### 1. Attached screenshots (this folder)

`00-contact-sheet-desktop.png`, `00-contact-sheet-mobile.png` — all screens at a glance.

Desktop (1280 px): `desktop-01-login-card` · `02-overview` · `03-orders-list` · `04-order-card` ·
`05-goods-list` · `06-goods-editor` · `07-stock-list` · `08-stock-row-edit` · `09-stock-moves-ledger` ·
`10-pos-empty` · `11-pos-with-line` · `12-pos-after-sale` · `13-customers-list` · `14-reviews` ·
`15-promos-list` · `16-promo-form` · `17-blog-list` · `18-blog-editor` · `19-analytics` ·
`20-mail-order-confirmed` · `21-mail-abandoned-cart` · `22-integrations` · `23-settings` ·
`24-settings-hero-editor` · `25-settings-pending-apply-card` · `26-settings-after-apply-journal` ·
`27-settings-content-block-open` · `28-assistant-answer` · `29-assistant-action-proposal` ·
`30-panes-collapsed`.

Mobile (iPhone, 375 px): the same sequence, `mobile-01` … `mobile-29`.

Not captured (needs a real phone camera / storage): the live scanner viewfinder, photo upload
dialogs, the receipt print view.

### 2. Everything the owner and the developer asked for (verbatim list, 04.09.2026)

- In Estonian, «Ajaveeb» is wrong — use «Blog» everywhere (storefront nav and admin).
- The admin needs a great UI/UX overhaul; things look too complicated.
- A better place for the gift card (today it sits under «Наборы» in the shop).
- If «Наборы» (sets) are switched off, sets must not appear anywhere: not in product lists,
  not in the category list, not in "bought together".
- The scanner must be available only to admin people. The app itself can work as is, but the
  scanner would be cool as a separate application. Linking a scanned code to a product must be
  very easy and comfortable.
- The blog needs a big improvement: add images, edit text simply. Markdown is too complicated.
- The overview can show real data already; "orders today" currently shows random data.
- Integrations: things can actually be done there (not just a status list).
- Editing e-mails must be easy and simple.
- In the shop, adding to cart currently adds the smallest size; the product card in the list
  should let the shopper pick the size right there (dropdown in the card, like Florihana).
- A few sample blog posts to see how the blog looks.
- Product videos: Instagram videos and uploaded videos, not only YouTube links.
- There is no place in the admin to create bundles/sets.

### 3. What each section does today (so nothing gets lost)

- **Обзор** — orders today / revenue 7 days / catalogue size / low stock; last orders; low-stock list.
- **Заказы** — list with statuses (новый, оплачен, отправлен, отменён, возврат); order card with
  items, delivery, customer, status buttons, note, shipping label (Montonio: Omniva, DPD,
  SmartPosti, Unisend), messages to the customer (AI-drafted reply).
- **Товары** — search, list; editor: price, salon price, availability, category, subcategory,
  photos (upload, reorder, main), photo per size, SEO title/description (+AI), video URL,
  description in RU/ET/EN (+AI generate/translate), save/cancel.
- **Склад** — real quantities per product × size, «мало» threshold, EAN binding, receiving,
  adjustments, ledger of moves; scanner overlay (phone camera; manual entry fallback).
- **Продажа в салоне** — search → cart → optional customer → payment (cash / terminal) →
  receipt; decrements stock; appears in orders with the «Салон» tag.
- **Клиенты** — search, filters (pending pro requests / partners / retail), card with tier
  (retail / pro), approve/reject partner requests, loyalty points adjust, notes; CSV export.
- **Отзывы** — moderation (new / published / rejected), publish / reject.
- **Промокоды** — list, create (percent / amount / free shipping, min order, dates), toggle.
- **Блог** — list, editor (topic → AI draft, translate, title, excerpt, Markdown body, preview,
  cover, tags, linked products, SEO, slug, author), publish / unpublish / delete.
- **Аналитика** — period chips, revenue / orders / average check / conversion, revenue by day,
  funnel, top products, brands, promo usage, searches with no results, Search Console block.
- **Письма** — automatic letters (order confirmed, shipped, back in stock, abandoned cart,
  birthday, login code) with on/off, preview per language, send a test.
- **Подключения** — status of payments, delivery, mail, Search Console, analytics, AI, POS.
- **Настройки** — delivery tariffs table (+ «Заполнить по тарифам Montonio»), payment methods,
  languages, letters list, shop switches (AI chat, sets), hero slides editor, company content
  (requisites, hours, socials, announce bar, contacts page, mail signature), prices & loyalty
  (salon discount, points), monthly accountant report (CSV / XLSX), change journal with undo.
- **Помощник** (assistant) — right column: question box, suggested questions, answers with
  product cards and "open section" buttons; proposes actions that go through the confirm card.

### 4. Existing design tokens (storefront + admin)

Paper `#ffffff` / shell `#edeae1`, ink `#1c1a00`, muted `#6f6b57`, rule `#e5e1d6`, warn
`#8a4b2d`, ok `#2e5b45`. Display: Oswald (uppercase, tracked) · Body: Golos Text · Mono: PT Mono.
Rectangular corners, 1 px rules, no shadows. The brand mark is the Rempire tower badge.

### 5. Storefront items that belong to the same round (not the admin, listed for completeness)

- Size picker inside product cards in lists (dropdown or chips), so the right size goes to the
  cart from the list.
- «Blog» instead of «Ajaveeb» in Estonian.
- Sets fully hidden when the switch is off.
- Gift card: a better place than «Наборы» (own entry in the footer/header, a small block on the
  home page, the checkout upsell).
- Product page: video block supporting YouTube, Instagram reels and uploaded MP4.
