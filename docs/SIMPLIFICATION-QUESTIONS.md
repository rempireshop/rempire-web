# Simplification questions for Dim

*57 yes/no questions, written 06.09.2026 from `docs/SYSTEM-MAP.md` (which cites
the evidence) and a walk through the admin on the e2e build at phone width.
Nothing here is a change — every item is a proposal to answer. Line numbers
refer to `public/shop2/app.js` at `1a63cf8` unless another file is named.
Effort: S = under an hour, M = a session, L = a wave.*

**Top five, in my order of importance:** Q3 (the cancel card promises a refund
and a letter that do not exist), Q12 (the three automatic letters: wrong labels
and a default that looks on but is off), Q10 (loyalty and partner pricing are on
by default although Renat said "later"), Q19 + Q34 (the product editor's dead
controls and the one-machine catalogue tools behind them), Q54 (Vercel Hobby or
Railway — several limits and caveats hang on this one decision).

**By theme.** Orders and fulfilment: Q1–Q7, Q23–Q26, Q45 · Goods, stock, salon:
Q19–Q22, Q29, Q41, Q50 · Marketing, mail, loyalty: Q10–Q15, Q17, Q38, Q39, Q46,
Q47 · AI: Q16, Q18, Q22, Q42, Q43 · Settings and content: Q8, Q9, Q27, Q28, Q30,
Q32, Q49 · Analytics: Q51, Q56, Q57 · Storefront: Q4, Q5, Q35–Q37, Q40, Q44, Q48
· Platform and housekeeping: Q31, Q33, Q34, Q52–Q55.

---

## The weekly tasks — taps today and where they could land

| Task | Today | Could be | Questions |
|---|---|---|---|
| New parcel order → label → «Отправлен» | 6 taps + printing | 3–4 | Q2, Q25, Q26 |
| … → «Доставлен» later | +4 | 0 | Q24 |
| Answer a customer | 5 + paste | 3 (or Gmail) | Q6 |
| Change a price | 4 + typing | 3 | — |
| Add an own product with two sizes and a photo | 9 + typing + picker | 7 | Q19 |
| Stock take, known barcode | 1–2 per item | — | Q21 |
| Stock take, unknown barcode | 3 + typing | — | — |
| Salon sale | 4 + typing | 2–3 | Q29 |
| Promo code | 5 + typing | 4 | Q23, Q39 |
| Blog post with AI | 6 + topic + cover | 5 | Q47 |
| Approve a partner | 2–4 | — | Q7 |

(Full paths in `docs/SYSTEM-MAP.md`, Appendix A.)

---

## A. Orders and fulfilment

**Q1. One scanner button instead of three.** — *S*
- Observation: «Товары → Склад» shows a header button «Приёмка» (:10521) and a
  body button «Сканировать» (:14739), both `data-scanopen`; «Салон» has its own
  «Сканировать» (:15398); «Склад» also carries the link «Сканер отдельным
  приложением ↗» (:14755).
- Cost: two names for one thing on one screen; the manual has to explain that
  «Приёмка» is the scanner.
- Proposal: one label everywhere («Сканировать»); the header slot on «Склад»
  stays empty; the standalone-app link lives once (in «Подключения»).
- Removed: the «Приёмка» header button. Hidden: nothing.

**Q2. One primary action per order row.** — *S*
- Observation: a paid parcel order shows «Создать этикетку» **and** a ghost
  «Отправлен» in the row (:10198–10201) and again in the card (:10375–10379);
  only «Отправлен» asks for confirmation.
- Cost: two primaries per row on a phone; Renat's own complaint was a button
  that does more than it says.
- Proposal: the row shows the next step only; «Отправить без этикетки» becomes a
  quiet link inside the card.
- Removed: the ghost «Отправлен» in rows. Merged: nothing.

**Q3. Make «Отменить заказ», «возврат» and manual «оплачен» tell the truth.** — *M*
- Observation: the cancel confirm card says «Деньги вернутся клиенту, письмо
  уйдёт автоматически.» (:10249) — no refund is executed and no cancellation
  letter exists (`src/emails/` has none; `orders.ts:1246` only returns stock).
  «Изменить статус вручную: оплачен · возврат» (:10395): «возврат» is a label
  with no money movement; manual «оплачен» runs the whole payment settlement
  (`src/app/api/admin/orders/[id]/route.ts:142–168`) — an invoice-payment
  feature nobody uses. A refund done in Montonio's portal arrives as `paid`
  (`src/lib/payments/montonio.ts:84`), so the order stays "paid" and in the
  accountant's export.
- Cost: a false promise on the most sensitive card; refunds invisible to the
  books.
- Proposal: (a) rewrite the cancel text to what happens: status «отменён»,
  stock back on the shelf, "money back in Montonio, write to the customer with
  «Написать клиенту»"; (b) hide manual «оплачен» unless bank-transfer invoices
  become a thing (Q4); (c) keep «возврат» as a bookkeeping status with the same
  honest sentence and a link to Montonio's partner portal.
- Removed: the false sentence. Hidden: manual «оплачен».

**Q4. Drop «По счёту — для компаний» from the checkout.** — *S*
- Observation: `PAYS[3]` (:4576) posts `method:"bank"` (:9328); the company
  field is validated (:9314) but never sent; there is no invoice PDF anywhere.
- Cost: a customer who picks it lands on the bank page; "счёт на почту" is a
  promise the shop cannot keep.
- Proposal: remove the option until an invoice flow exists (Renat's q8 wish
  «выставлять счёт автоматически» can be a later feature).
- Removed: one payment option, one field, one validation.

**Q5. Drop «Apple Pay / Google Pay» as a separate option.** — *S*
- Observation: `PAYS[2]` posts `method:"bank"` (:9328); `docs/payments.md` §9
  says wallets live inside Montonio's card form and the option is already a
  static line under «Банковская карта».
- Cost: a radio that leads to the wrong page.
- Proposal: remove the radio; keep the line under the card option.
- Removed: one option.

**Q6. Simplify «Написать клиенту» — or let Gmail do it.** — *M*
- Observation: the panel (:10474) has a paste box for the customer's message,
  a prefilled draft, «Черновик помощника» (an OpenAI call) and «Отправить»,
  which sends at once (:18833) with no confirm and no undo; unpaid rows also
  carry «Написать». Customer mail never arrives in the panel — Renat reads it
  in Gmail or Instagram and pastes it here.
- Cost: 5 taps plus a paste for a reply he could type in Gmail; an outgoing
  letter with fewer guards than a price change.
- Proposal: (a) keep only the prefilled draft and «Отправить» behind a confirm
  card, drop the paste box and the AI button; (b) remove the feature and answer
  from Gmail (the order number is in the subject either way); (c) keep as is.
- Removed (a): two controls; (b): the panel, `POST /api/admin/mail/send/`,
  `order_messages`.

**Q7. Same rule for approving a partner from the row and from the card.** — *S*
- Observation: «Одобрить Pro» in the row applies at once and sends the
  partner letter (:13469); the card's «Розница ↔ Партнёр» goes through a
  confirm card (:13439).
- Cost: two behaviours for one decision; an undo toast cannot unsend a letter.
- Proposal: both confirm (a letter leaves), or both instant.
- Merged: one path.

**Q23. Six order chips → three.** — *S*
- Observation: «Новые · Этикетка готова · Отправлены · Доставлены · Салон ·
  Все» (:10119); at 375 px two and a half fit; «Салон» and «Доставлены» need no
  action; a typed search ignores the chip anyway (:10162).
- Cost: scrolling chips to reach «Все».
- Proposal: «Отправить (N)» · «В пути» · «Все».
- Removed: three chips (search covers them).

**Q24. Is the «Доставлен» step worth its taps?** — *M*
- Observation: manual, no letter, no side effect except the chip and the
  «Доставлены» archive; Renat would have to track each parcel to press it.
- Cost: 4 taps per order for bookkeeping.
- Proposal: (a) drop the step — two steps «Оплачен → Отправлен», «Выдан
  клиенту» stays for pickup; (b) auto-close 14 days after «Отправлен»; (c) keep.
- Removed (a): one status in the UI (the DB keeps `delivered`).

**Q25. Skip the confirm card on «Отправлен» when a label exists.** — *S*
- Observation: `pendingAction` (:18744) raises «Отметить отправленным?» every
  time; «Создать этикетку» and «Доставлен» apply at once with an undo toast.
- Cost: one extra tap on every parcel.
- Proposal: with a label (tracking known, letter predictable) apply at once
  with the undo toast; confirm only when there is no label.
- Removed: one tap per parcel.

**Q26. One label button, matching Renat's printer.** — *S*
- Observation: «Открыть PDF (A4) ↗» and «A6 для термопринтера ↗» (:10356–10357).
- Proposal: ask which printer he has; show one button, keep the other size as a
  hidden default.
- Hidden: one link.

**Q45. The waiting count in three places — keep?** — *S*
- Observation: the «Заказы» badge, «Отправить N» on «Обзор» and the chip
  «Новые N» all show paid-not-shipped; they agree by construction.
- Proposal: keep (no change) — listed only so it is a conscious yes.

## B. Goods, stock, salon

**Q19. The product editor: remove the dead controls, then decide about "two
kinds of product".** — *S now, L later*
- Observation: for catalogue products «+ Размер» is `disabled title="скоро"`
  (:14202), «×» is `disabled title="Объёмы заводит Дим"` (:14197) and the
  «Показывать в магазине» switch is permanently on (:14105–14106); own
  products (`c-…`) get editable name/brand/section/sizes. Adding a size to a
  catalogue product means Dim rebuilding files with tools that only run on his
  machine (Q34).
- Cost: greyed buttons that promise a future; two editors to keep aligned; a
  9-tap "add product" that puts photos after the first save.
- Proposal: (a) remove the three dead controls and the "скоро" now; (b) decide
  whether to import the 220 catalogue products into `custom_products` so every
  product is editable the same way and the build tools retire.
- Removed (a): three controls. Merged (b): two editors → one.

**Q20. One stock truth per product.** — *M*
- Observation: «Основное → Наличие» is the manual in/low/out override;
  «Размеры и цены → Остаток» and «Склад» are counts; once a variant is
  tracked the count wins silently; the «Склад N» tab badge counts manual flags
  until the list loads (:10501).
- Cost: Renat can set «Нет в наличии» while the count says 4.
- Proposal: for tracked variants hide «Наличие» and show the count with one
  sentence; keep the manual badge only for never-counted products.
- Hidden: one select for most products.

**Q21. What does «Списать −N» in the scanner mean?** — *S*
- Observation: it writes a `sale_pos` move with no order (:14880): the ledger
  says "sold", revenue says nothing; real sales have «Салон».
- Proposal: rename to «Списать (брак, утеря)» with reason `adjust`, or remove
  the button and point to «Салон».
- Removed/renamed: one button.

**Q29. Salon sale: fewer fields, fewer taps.** — *S*
- Observation: «Скидка, %», «Почта клиента», «Телефон» (the hint «С почтой
  клиент получит чек письмом.» is false — `pos-orders/route.ts` sends nothing),
  «Наличные» / «Терминал», then a confirm card «Оформить продажу?».
- Cost: 4 taps + typing per sale; a false sentence.
- Proposal: remove the customer fields (or wire the letter); keep the
  discount; remember the last payment method; consider skipping the confirm
  for small sales (undo toast instead).
- Removed: two fields and a sentence; hidden: one tap.

**Q41. Four small truths on screen.** — *S*
- Observation: «Товары N» always shows the catalogue count on every tab
  (:10527); a typed search ignores the chip while the chip stays highlighted
  (:10162); «Ждут письма: N» is fetched once per page load (:11775, also
  :16337); the «Склад N» badge changes meaning after the list loads (:10501).
- Proposal: fix all four in one pass.

**Q50. Move the PWA hint box off the «Склад» screen.** — *S*
- Observation: a six-line paragraph with «Скрыть» sits above the stock list
  (:14724) on a work screen.
- Proposal: one line in «Подключения» («Сканер · камера телефона» row) or a
  one-time toast.
- Removed: the box.

## C. Marketing, mail, loyalty

**Q10. Loyalty points and partner pricing: off by default?** — *M*
- Observation: `settings.pricing` defaults to loyalty **on** (earn 5 %, redeem
  ≤ 30 %) and a 20 % partner discount (`src/lib/loyalty.ts`); the concept
  appears in «Клиенты» (chips, «+ Партнёр», tier switch, points), «Настройки →
  Цены и баллы» (six numbers + a switch), the editor's «Салон, €» column, the
  account's «Стать партнёром» and points block, the checkout's «Использовать
  баллы», the order letters. Renat's round-2 answer: «Нет, но хочу в будущем».
  POS sales earn nothing, so the programme is already inconsistent.
- Cost: five screens carry a concept the owner postponed; a few points a week.
- Proposal: (a) default both off and hide all of it behind one switch
  «Партнёры и баллы» in Settings; (b) keep on.
- Hidden (a): one settings page, one editor column, one account block, one
  checkout row.

**Q11. «Подарочные карты» tab: the issued list and a line of amounts.** — *S*
- Observation: amount toggles, a fixed «Оформление» paragraph that changes
  nothing, the issued list (:10991–11021).
- Proposal: drop the paragraph; amounts as one row above the list.
- Removed: one block.

**Q12. The three automatic letters: fix, keep only one, or drop.** — *M*
- Observation: the row says «за 3 дня до даты» but `runBirthdays` sends on the
  day (`src/lib/flows.ts:477–481`); «через 3 часа» is really "the next daily
  cron" on Hobby; the «Товар снова в наличии» switch shows **on** by default
  (`app.js:15593`, `src/app/api/overrides/route.ts:31`) while the sender's
  default is **off** (`flows.ts:57–62`) — nothing is sent until Renat toggles
  it; birthday and abandoned-cart need accounts with marketing consent, which
  a 3–5 orders/week shop rarely has.
- Cost: three switches whose labels are wrong, one that looks on and is off,
  a cron job and 600 lines of flows for very few letters.
- Proposal: (a) fix the labels and the default, keep all three; (b) keep only
  «Товар снова в наличии» (it fires from the admin's own stock switch) and
  remove birthday, abandoned cart and the cron entry; (c) drop all three.
- Removed (b): two rows, one cron, `carts` snapshots, the birthday promo minting.

**Q13. Make the journal real, or say it is local.** — *M*
- Observation: «Журнал изменений» is `DEMO.log` in `localStorage`
  (:15579–15615, 40 entries) — a second phone or browser sees nothing; the
  server's `admin_audit` (written by ~25 call sites, including the AI token
  costs) has no screen; `GET /api/admin/audit/` is never called.
- Cost: an "audit" that forgets when the browser cache clears; costs nobody
  can see.
- Proposal: (a) show `admin_audit` as the journal (read-only) and keep
  «Вернуть» only for this browser's last actions; (b) label the page «на этом
  телефоне»; either way delete the dead route or use it.
- Merged: two logs → one.

**Q14. Mail editor: one row of placeholder chips.** — *S*
- Observation: seven chips repeat under each of the three fields — 21 chips on
  a phone screen (:11104–11134).
- Proposal: one chip row under the field in focus, or a hint line.
- Removed: 14 chips.

**Q15. Two «Скачать CSV» links.** — *S*
- Observation: customers CSV (:13363) and the accountant report (:16359) share
  a label; the customers file has no stated use.
- Proposal: drop the customers export, or rename both.
- Removed: one link.

**Q17. «✨ Написать заметку» on a promo code's private note.** — *S*
- Observation: an OpenAI call to write a note nobody but Renat reads (:12831).
- Proposal: remove.

**Q38. Gift amounts from one place.** — *S*
- Observation: the gift tile hard-codes «25, 50 или 100 €» (:5780; `GIFT_DESC`
  :17412) while `settings.gift_amounts` decides; the checkout accepts 75 €
  even when it is hidden (`GIFT_AMOUNTS` vs the default in `giftcards.ts:34–38`).
- Proposal: render the tile from the setting; validate the checkout against it.

**Q39. Promo form — keep the fold as is?** — *S*
- Observation: kind chips, «Скидка», «Минимальный заказ» on top; expiry, uses
  and note folded (:12801–12837). On a phone the third chip is cut off.
- Proposal: keep; fix the chip overflow; Q17 removes the spark.

**Q46. Where should the "new paid order" ping go, and is Telegram wanted?** — *S*
- Observation: `src/lib/notify.ts:54–55` defaults `RESEND_TO` to
  `info@diipsolutions.eu` and the sender to `REMPIRE QA <onboarding@resend.dev>`;
  `RESEND_TO` is not in `docs/accounts.md`; `TELEGRAM_*` unset; Renat has not
  answered the Telegram question in `docs/OPEN-QUESTIONS.md`.
- Proposal: set `RESEND_TO=info@rempireshop.com` (already forwarded to the shop
  Gmail), document it, and decide Telegram yes/no.

**Q47. Blog: drop the «Только часть» fold.** — *S*
- Observation: «Только план по теме» and «Перевести на ET и EN» (:11330–11331)
  predate «Написать статью целиком», which does both.
- Proposal: remove the fold and the two tasks' buttons (the route tasks stay
  for the assistant).

## D. AI

**Q16. Six ✨ buttons on settings fields.** — *M*
- Observation: `admSparkHTML` on hero slide texts (:12071), the top strip, the
  contact-page intro, the e-mail signature (:12343–12353), the promo note
  (:12831), the new product's name (:14046) — one route task `copy` with six
  kinds and their prompts.
- Cost: six buttons to explain, six prompts to maintain, for texts written once.
- Proposal: keep «✨ Подобрать название» (product) and the hero spark; remove
  the other four.
- Removed: four buttons, four prompt kinds.

**Q18. Assistant: 22 admin actions — which ones does Renat need?** — *M*
- Observation: `sanitizeAction` (`src/app/api/assistant/actions.ts`) accepts
  `set_price, set_stock, set_seo, toggle_flow, toggle_chatbot, toggle_bundles,
  set_hero, create_promo, toggle_promo, set_shipping_rules, set_content,
  set_pricing, adjust_points, stock_adjust, stock_set, draft_post, publish_post,
  set_post_cover, add_product_photo, create_product, update_product,
  export_report`; each needs a sanitiser, a prompt example, a `demoApply`
  branch, an undo and tests.
- Cost: the largest maintenance surface in the panel; the model can propose a
  tariff or a points change from a misread sentence.
- Proposal: keep price, stock, promo, hero, blog, photo, product; drop
  `set_shipping_rules`, `set_pricing`, `adjust_points`, `set_content`,
  `toggle_flow`, `export_report` (each has a screen).
- Removed: six action types and their plumbing.

**Q22. One AI button per product.** — *M*
- Observation: «Написать черновик» (RU description), «Перевести с русского»,
  «Заполнить автоматически» and «все три языка» (Google pair) across two
  editor tabs; the blog has the same pair; the assistant also does `set_seo`.
- Cost: four buttons and an order to press them in; three ways to get an SEO
  text.
- Proposal: one button «Заполнить тексты автоматически» that writes the
  description, the two translations and the three Google pairs in sequence
  (like «Написать статью целиком»), with «Отменить».
- Merged: four buttons → one.

**Q42. Photo cut-out: enable or delete.** — *S*
- Observation: `PHOTO_CUTOUT=openai` is not set (absent from
  `docs/accounts.md`), so «✂ Убрать фон» never shows; the route, library and
  tests exist; Renat plans to reshoot everything.
- Proposal: enable (cents per photo) or delete route + lib + tests + button.

**Q43. The shop chat widget.** — *S*
- Observation: `chat.js` (rule-based fallback + model, `settings.chatbot`
  switch); it cannot see the cart or look up an order; Renat asked for an
  *admin* helper (q6), not a shop bot.
- Proposal: leave it off by default, or remove `chat.js` and the switch.

## E. Settings and content

**Q8. Drop the «Языки» settings page.** — *S*
- Observation: `admSetLangsHTML` (:11725) shows three links and «Написать
  Диму» — nothing to change.
- Proposal: remove the row; put the three links under «О компании».

**Q9. Drop the read-only «Оплата» list.** — *S*
- Observation: «Настройки → Доставка и оплата» ends with a list that says
  «Способы оплаты включает платёжный провайдер… напишите Диму» (:11675).
- Proposal: remove; «Подключения» already shows Montonio.

**Q27. Shrink the tariff editor.** — *M*
- Observation: 6 rows × (пакомат, курьер, бесплатно от) + «Самовывоз, €», a
  carriers fold (4 carriers × countries), «Наценка, %», «Наценка, €»,
  «Разрешить снижать текущие цены», «Заполнить по тарифам Montonio» (works from
  public price lists, not Montonio's contract rates), «Вернуть значения по
  умолчанию» (:11624–11678).
- Cost: a screen sized for a logistics company, for 3–5 parcels a week.
- Proposal: rows EE/LV/LT/FI only; fold EU/«Остальные», carriers and markup
  under «Ещё»; consider removing markup entirely (he types the customer price).
- Hidden: two rows, the carriers grid, two markup fields, one switch.

**Q28. Per-carrier prices and carrier chips.** — *M*
- Observation: `CARRIERS_BY_COUNTRY` (:4219) shows Omniva/SmartPosti/DPD/Venipak
  chips at checkout; the settings hold per-carrier cells; Montonio decides
  which carriers exist.
- Proposal: one «Пакомат» price per country; the shopper picks a machine, the
  price is the same; remove the carriers fold.
- Removed: the per-carrier price table.

**Q30. Hero banner editor: one slide by default.** — *S*
- Observation: up to five slides × three languages × four texts + link + image
  + «Смена слайдов, секунд» + ✨ (:12052–12123); the assistant can rewrite it.
- Proposal: one slide by default, hide the interval, keep the assistant path.
- Hidden: one field, four slides.

**Q32. Fewer content blocks.** — *S*
- Observation: «О компании» blocks: «Реквизиты», «Часы работы» (7 days + a note
  in three languages), «Соцсети», «Страница „Контакты“» (intro ×3 + ✨),
  «Подпись в письмах» (×3 + ✨), plus «Верхняя полоска» (text + short ×3 + ✨).
- Proposal: keep «Реквизиты», «Часы работы», «Соцсети», «Верхняя полоска»;
  drop the contact intro and the e-mail signature as editable (fixed texts).
- Removed: two blocks, two sparks.

**Q49. Keep `settings.vat_rate` developer-only.** — *S*
- Observation: the accountant report's VAT rate is a settings row with no
  field in the panel (`src/lib/reports.ts:19–33`).
- Proposal: yes — a power feature that stays hidden.

## F. Analytics

**Q51. Accountant report: XLSX only.** — *S*
- Observation: «Скачать CSV» and «Скачать XLSX» (:16359–16360); the CSV needs
  a `;` and a BOM to open right.
- Proposal: keep XLSX (opens in Excel/Numbers without encoding trouble).

**Q56. Which numbers does Renat look at weekly?** — *M*
- Observation: «Аналитика» has four KPIs, bars, «Топ товаров», «Искали, но не
  нашли», then «Воронка», «Бренды», «Смотрят, но не покупают», «Что искали»,
  «Промокоды», «Откуда приходят», «Ещё цифры», «Google: 28 дней» (:11403–11490);
  «Обзор» repeats «Продажи». Renat ticked "all statistics" in the
  questionnaire; the weekly need is sales and what to reorder.
- Proposal: keep KPIs, «Топ товаров», «Искали, но не нашли», low stock; fold
  the rest under «Подробнее» or drop funnel/brands/traffic.
- Hidden: seven blocks.

**Q57. Google Search Console block: finish or drop.** — *S to drop*
- Observation: service account created 05.09, JSON key and two env vars still
  pending; the block shows «Написать Диму»; Search Console is one tap away on
  the phone.
- Proposal: drop the block (`src/lib/gsc.ts`, route, tests, the settings cache)
  or finish the setup.

## G. Storefront

**Q35. Keep «Наборы» at all?** — *S to hide, L to remove*
- Observation: a full set editor, a shop rail, a landing, per-set pages, a
  switch, static copies for the prerender, eight seeded sets from the old shop;
  the audit noted the feature was never agreed with the owner.
- Proposal: ask Renat; if unsure, switch «Показывать наборы» off by default
  (nothing shows) — or remove the feature.

**Q36. SEO extras: merchant feed, redirect map, Cloudflare beacon.** — *M*
- Observation: the Google Shopping feed is a hand-run static file with a
  hard-coded base (`tools/build-merchant-feed.mjs`); the Shopify redirect map
  (`docs/redirect-map.csv`, 1 638 rows) is implemented nowhere; the Cloudflare
  beacon is a placeholder token in `index.html`.
- Proposal: feed — generate at build from the catalogue + overrides, or drop
  until Merchant Center is real; redirects — implement only the ~250 product
  and collection rows in `next.config.ts` at the switch; beacon — remove (the
  shop has `/api/track`).

**Q37. Cookie/consent banner — a lawyer question, not a code one.** — *S*
- Observation: none exists; YouTube/Vimeo are click-to-load, Instagram is a
  lazy iframe, OSM tiles load with the map, the beacon is off, first-party
  analytics use no cookie.
- Proposal: put it on the lawyer's list with the policy texts; build nothing
  until answered.

**Q40. Prerender the brands landing?** — *S*
- Observation: `/shop2/brands/` is the one shell-only landing (`docs/seo.md`).
- Proposal: yes/no.

**Q44. Account: drop «Доставка по умолчанию»?** — *S*
- Observation: the block prices with the old `SHIP` table (:4091, :8574), not
  the live rules; the birthday field only feeds the birthday letter (Q12).
- Proposal: remove the block; keep name/phone/marketing.

**Q48. The three sample blog posts.** — *S*
- Observation: published on the live database as real articles (products
  linked, covers from the catalogue).
- Proposal: keep as content, or unpublish before the switch.

## H. Platform and housekeeping

**Q31. Retire the prototype surfaces before the switch.** — *M*
- Observation: `/` redirects to `/demo/`; `/qa`, `/qa2`, `/demo`,
  `/prototypes/*` (needs `'unsafe-eval'`), `/api/submit/` and `/api/feedback/`
  (Vercel Blob on Diip's team + Telegram + Resend forwards), the old `/shop/`
  SPA with 95 legacy product pages, a README that still describes the
  questionnaire phase.
- Cost: attack surface, a Blob store to migrate, a root URL that lands on a
  review hub.
- Proposal: delete the pages and routes, `/` → `/shop2/`, keep `/shop/p/*` only
  if the old share links matter (Q36), rewrite the README.
- Removed: five pages, two routes, one CSP carve-out, one Blob store.

**Q33. One glossary for names.** — *S*
- Observation: «Сохранить заметку» is the order note (:10439) and the customer
  note (:13319); «Скачать CSV» ×2; docs say «Составить ответ» / «Сгенерировать
  описание» / «Открыть сканер», the UI says «Черновик помощника» / «Написать
  черновик» / «Сканировать»; the design says «Наклейка», the code «Этикетка».
- Proposal: a 30-line glossary in `docs/`, fix the two duplicate labels,
  update the docs.

**Q34. Delete dead code and archive the one-machine tools.** — *S–M*
- Observation: the MakeCommerce stub throws on every call
  (`src/lib/payments/makecommerce.ts`); dead exports (`getMontonioShipment`,
  `fetchMontonioLabelFile`, `todaysMoves`, `dbReady`/`driverKind`,
  `getPostByIdOrSlug`, `resetPaymentMethodsCache`, `suggestShippingRulesFromTariffs`
  — only its browser mirror runs); dead hooks (`[data-admedit]` :19918,
  `[data-admship]`, `[data-admcustdemote]`, `[data-repeat]`, `[data-dot]`,
  `[data-method]`, `[data-machine]`); catalogue/image tools with absolute paths
  to Dim's machine (`tools/build-catalogue-full.mjs`, `build-content*.mjs`,
  `refit-cutouts.mjs`, `cut-new-images.mjs`, `recut-*.py`).
- Proposal: remove the stub and the dead hooks/exports; move the tools' paths
  to arguments or put them under `tools/archive/` with a note.

**Q52. Roles: decide "no" explicitly.** — *decision*
- Observation: Renat named three helpers (`docs/RENAT-ANSWERS.md` round 2) and
  the 23.08 letter promised «каждому своя роль»; the code has one password.
- Proposal: one shared password now (with «Выйти» on shared phones) and a
  written "later" — or plan roles (L).

**Q53. Keep the test suite as it is.** — *S*
- Observation: 74 vitest files, 33 specs, 4 CI shards + a Safari job, ~15 min
  per shard; Windows-only visual baselines.
- Proposal: no simplification; generate the Linux baselines once.

**Q54. Vercel Hobby or Railway?** — *decision, M*
- Observation: `docs/accounts.md` names Railway as production hosting and
  Vercel as staging only ("Hobby is non-commercial"), while the code, the two
  crons, the deploy identity and the docs' caveats assume Vercel. Hobby limits
  shape features: one cron run a day («через 3 часа» is untrue), a ~4.5 MB
  request body (the 12 MB photo and 60 MB video caps cannot pass), function
  time limits, owner-only deploys.
- Proposal: decide now; on Railway the crons, the body limits and the deploy
  identity rule need re-wiring; on Vercel Pro most caveats vanish for a fee.

**Q55. Admin in Russian only?** — *M*
- Observation: ~1 700 admin strings ×2 languages in the UI dictionary
  (`UI` :93–3546, `UI_RX` :3550–3818); Renat reads Russian; the panel opens in
  the *browser* language (an English phone shows «Admin sign-in»).
- Proposal: force the admin to Russian and stop translating admin strings
  (the shop stays trilingual); or keep the toggle.
- Removed: the admin half of the dictionary maintenance.

---

## Power features to keep — hidden behind a plain default

Not questions: these exist, work, and should stay out of Renat's way unless he
asks. Each has a safe default today.

- `settings.vat_rate` (report VAT) — developer-only.
- Markup fields and the per-carrier tariff grid (Q27, Q28) — under «Ещё».
- «Другие страны Европы» / «Остальные страны» rows — under «Ещё».
- «Смена слайдов, секунд» and slides 2–5 of the banner (Q30).
- «Цены и баллы» and everything partner/points (Q10) — one switch.
- The mail texts editor — the defaults are the letters; the tab stays.
- `mail_texts` placeholders — one chip row (Q14).
- Analytics deep blocks (Q56) — «Подробнее».
- The assistant's rarer actions (Q18) — the screens remain.
- Per-language Google pairs on products and posts — folded, filled by AI (Q22).
- `gift_amounts` — the tab stays small (Q11).
- The change journal's «Вернуть» — stays; the server audit becomes the list (Q13).
- `SHIPPING_PROVIDER=mock`, `PAYMENT_PROVIDER=mock`, the e2e doors — test-only,
  never on production.
