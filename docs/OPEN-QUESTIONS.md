# Open questions after Renat's answers

Status 23.08.2026: **sections A and B item 7 are RESOLVED** by round 2
(answers + implications in `docs/RENAT-ANSWERS.md`). Short version: three
helpers use the admin (roles = v1 scope), the till has no software (no POS
integration — the platform becomes the inventory system with an offline-sale
action), barcodes exist on nearly all packaging (sync key), wholesale
pricing is schema-now/UI-later, he will reshoot all photography, and invoice
data is 56237237 · rempireshopinfo@gmail.com · Mardi 1 Tallinn.

Still open: C (access hand-overs: Shopify admin, DNS, Google/Meta, Montonio
contract), items 8–9 (accountant: VAT OSS; lawyer: returns policy) and D
items 16–17. Original text below kept for the record.

**New, 23.08 — PayPal.** Renat ticked PayPal in q16, but Montonio does not
support it (nor does MakeCommerce). PayPal direct in Estonia is 3.4% + €0.35
— €2.05 on a €50 order, a 4.1% effective rate, roughly triple the card cost.
Ask him how many customers have actually asked for PayPal before we design
around it. If it is genuinely required, SEB/EveryPay (PayPal at €0.10/tx,
cards 1.35%) becomes the stronger single-provider answer; otherwise stay on
Montonio Core. Full analysis: `rempire-api/docs/PAYMENT-PROVIDERS.md`.

## A. Blocks the architecture — ask Renat directly

1. **Who else works in the admin, and what do they do?**
   He said he only edits texts and pages; the business register lists zero
   employees. Someone adds products, checks stock and processes orders.
   Until we know who and what, we cannot design roles, permissions or the
   admin's default screen. *Blocks: admin UX, permissions model.*

2. **Which POS or cash-register system does the physical shop use?**
   He requires shop stock to stay in sync with the site. No integration can
   be scoped without the product name — and some systems have no API at all,
   in which case sync means scheduled imports or manual adjustment instead.
   *Blocks: inventory architecture, integration scope, price.*

3. **Do products have SKUs and barcodes today, and are they consistent?**
   Any stock sync, and any warehouse workflow, hangs off a stable identifier.
   If Shopify has half-filled SKU fields, that is a data-cleanup task to
   price in now rather than discover during migration.
   *Blocks: data model, migration plan.*

4. **Are there salon, wholesale or professional customers who pay different
   prices?** He carries professional brands and the company's registered
   activity is hairdressing, so this is likely. Customer-group pricing is
   cheap to design in from the start and expensive to retrofit.
   *Blocks: pricing model, CRM design.*

5. **Should customers be able to collect orders from the shop?**
   He selected DPD, Omniva, SmartPosti and courier, but not pickup — while
   also confirming a physical location. Probably an oversight; confirm.
   *Blocks: checkout design, shipping configuration.*

6. **Does he want product reviews on the new site?**
   He chose not to migrate reviews, which may mean there are none rather
   than that he does not want them. Reviews affect product-page design and
   are a real organic-search asset, which is his stated goal.
   *Blocks: product page design, data model.*

## B. Blocks invoicing and legal — ask Renat, then his accountant

7. **Which company details are canonical?**
   His answer matches neither the register nor any single value on the site:

   | | He said | Register | Site |
   |---|---|---|---|
   | Phone | 56237237 | +372 53035580 | both appear |
   | Email | rempiretower@gmail.com | renatgayanov@gmail.com | rempireshopinfo@, blackboxestonia@ |
   | Address | — | Paikuse, Pärnu | Mardi 1, Tallinn |

   Invoices, the legal notice and order emails all need one agreed set, and
   the invoice address in particular must be defensible.
   *Blocks: invoice templates, legal pages, transactional email.*

8. **Is the company registered for VAT OSS?** (accountant)
   He wants to sell to all of Europe. Cross-border B2C sales above €10,000
   per year across the EU require OSS registration and destination-country
   VAT rates. This determines whether v1 ships one VAT rate or a rate table.
   *Blocks: tax model, checkout totals, invoices.*

9. **Who signs off the legal pages?**
   The returns policy has to change — a blanket "cosmetics are
   non-returnable" is not permitted under EU distance-selling rules; only
   sealed hygiene goods opened after delivery may be excluded. We can draft,
   but somebody with legal responsibility must approve before launch.
   *Blocks: launch.*

## C. Access we need — requests, not questions

None of these are answerable in a form; they are things Renat has to hand
over or create. Several involve waiting on third parties, so start early.

10. **Shopify admin access** — a staff account or Admin API credentials, to
    audit the real catalogue and build a repeatable migration.
11. **Control of `rempireshop.com` DNS** — who holds the registrar login.
    Required to plan the cutover; nothing changes until launch day.
12. **Google accounts** — Analytics, Search Console and Merchant Center: do
    they exist, and who owns them? His headline goal is "гугл синхронизация",
    which means a Merchant Center product feed, and we cannot protect
    existing search rankings through a migration without Search Console.
13. **Payment provider** — he wants bank links, which the shop does not have
    today, so a new contract (Montonio being the obvious fit for the Baltics)
    has to be signed by him. Onboarding involves identity checks and takes
    real calendar time; start it before it becomes the critical path.
14. **Meta business assets** — Instagram and Facebook are part of the brand;
    catalogue sync and any social content on the site need access.

## D. Affects quality, not feasibility

15. **Product photography.** Does he hold original files, and is he willing
    to reshoot key products? "Expensive-looking" is decided more by
    photography consistency than by layout. Worth an honest conversation
    before he judges either design direction.
16. **Free shipping thresholds.** Keep the current €50 for EE/LV/LT/FI and
    €200 for the rest of the EU, or revisit?
17. **Instagram content on the site.** Useful for the editorial sections and
    cheap to wire up, if he wants it.

## Suggested handling

Items 1–6 are short and concrete: publish them as a second round on the same
`/qa` page (`/qa2`), in Russian, same one-button submission. Ten minutes of
his time.

Items 7 and 10–14 are better handled in a single call or message thread —
they need back-and-forth and, in several cases, him logging into something
while you watch. Items 8, 9 and 15 need other people (accountant, lawyer,
photographer) and should be started now because they run on someone else's
schedule.

## Telegram-уведомления (добавлено 03.09.2026)

**Вопрос Ренату:** нужны ли уведомления в Telegram? Бесплатно. Смысл: мгновенный «пуш» на телефон
о новом заказе, оплате, новом отзыве и о товарах, которые заканчиваются, — без того, чтобы открывать
почту или админку. По e-mail (Resend) те же уведомления уже приходят. Если «да»: Ренат создаёт бота
через @BotFather (2 минуты, инструкция дадим), присылает токен Диму → `TELEGRAM_BOT_TOKEN` +
`TELEGRAM_CHAT_ID` в Vercel. Если «нет» — ничего не делаем.

Готовый текст для Рената:
> Ренат, вопрос: хочешь получать уведомления о новых заказах прямо в Telegram (на телефон, мгновенно)?
> Это бесплатно. На почту они и так будут приходить. Если да — напиши, скажу, как за две минуты
> сделать бота.

## Юрлицо на сайте: две компании и два регистрационных кода (добавлено 03.09.2026)

**РЕШЕНО (03.09, вечер):** Ренат уже ответил в анкете (вопрос 23: «Rempire Store OÜ · 56237237 · rempiretower@gmail.com») и реестр это подтверждает (docs/RENAT-ANSWERS.md: Rempire Store OÜ, рег. 12216136, KMKR EE102723858). THEFLOW OÜ / 16320586 в старых правовых текстах — наследие прежнего сайта; на новом сайте везде Rempire Store OÜ через настройку «Контент». Осталось только переоформить домен в Zone с THEFLOW на Rempire Store OÜ (нужно согласие Дениса). Вопрос Ренату НЕ задавать повторно.


**Что нашли.** Сайт одновременно торгует от имени двух разных фирм:

| Где | Компания | Рег. код |
| --- | --- | --- |
| Подвал сайта, блок «Реквизиты» в админке, письма (`src/emails/layout.ts`) | **Rempire Store OÜ** | 12216136 (KMKR EE102723858) |
| Правовые страницы «Доставка», «Возврат», «Условия», «Конфиденциальность» (`public/shop/legal*.js`, перенесены со старого сайта) | **THEFLOW OÜ** | 16320586 |
| Домен `rempireshop.com` в ASCIO (`docs/accounts.md:16`) | **THEFLOW OÜ** | — |

Плюс на странице «Контакты» стояли адрес `Mardi 1-3, 10113` (не тот) и почта
`blackboxestonia@gmail.com` — адрес вообще другой компании.

**Что сделали, чтобы это можно было починить одним движением.** Все реквизиты
переехали в одну настройку `settings.content` (`src/lib/content.ts`,
«Настройки → Контент» в админке, действие помощника `set_content`). В
правовых текстах вместо вшитого юрлица теперь плейсхолдеры
`{{legalName}}` / `{{regCode}}` / `{{address}}` / `{{email}}` / `{{phone}}`,
которые подставляются при отрисовке. Формулировки договоров не тронуты.

**По умолчанию выбран Rempire Store OÜ · 12216136 · KMKR EE102723858 ·
Mardi 1, 10145 Tallinn · info@rempireshop.com** — это то, что уже стояло в
подвале, в админке и в письмах, то есть в большинстве мест.

**Вопрос Ренату (нужен ответ до запуска — на продающем сайте не может стоять
чужое юрлицо):**

1. От какой фирмы магазин продаёт **сейчас** — Rempire Store OÜ или THEFLOW OÜ?
   От этого зависят договор оферты, чеки, счета и платёжный контракт (Montonio
   заключается на конкретное юрлицо — см. пункт 13 выше).
2. Если Rempire Store OÜ — правовые страницы надо перечитать юристом с новым
   юрлицом (пункт 9), а домен в ASCIO переоформить на ту же фирму.
3. Телефон и почта для покупателей: сейчас по умолчанию
   `+372 5623 7237` и `info@rempireshop.com`. Второй адрес заработает только
   после переноса домена (Cloudflare Email Routing уже настроен, NS не
   переключены) — до этого письма покупателей будут отбиваться.

**Заодно, пока не спросили:** **часы работы салона нигде не указаны** — ни на
старом сайте, ни в документах. Поле есть («Настройки → Контент → Часы
работы»), по умолчанию пустое, и пока оно пустое раздел в подвале и на
«Контактах» просто не показывается. Придумывать часы за Рената нельзя:
попросить его вписать семь строк.

Готовый текст для Рената:
> Ренат, на сайте сейчас два разных юрлица: в подвале Rempire Store OÜ
> (12216136), а в правовых страницах — THEFLOW OÜ (16320586), домен тоже на
> THEFLOW. От какой фирмы магазин продаёт? Поставил везде Rempire Store OÜ —
> скажи, если надо наоборот. И ещё: напиши, пожалуйста, часы работы по дням,
> сейчас их на сайте нет вообще.
