# Renat's answers — rounds 1 (21.08) and 2 (23.08)

Source: `/qa` submission, 26/26 answered, received 2026-08-21T11:26:27Z.
Raw JSON lives in the private Blob store `rempire-qa`
(`qa/2026-08-21T11-26-27-254Z-*.json`).

This is the requirements input for Phase 0. Where Renat's answer conflicts
with the live site or the Estonian business register, the conflict is flagged
rather than silently resolved.

## Raw answers

| # | Question | Answer |
|---|---|---|
| 1 | Что делаем с сайтом | Оставить примерно как сейчас, но на новой платформе |
| 2 | Что должно остаться | Минимализм и белый фон |
| 3 | Что мешает в Shopify | «Не умею писать код и сложно менять блоки» |
| 4 | Ощущение нового сайта | Минималистичный · Дорогой · Простой и понятный |
| 5 | Что делает в админке | Тексты и страницы |
| 6 | Без чего нельзя работать | «Чат бот который бы помог что либо исправить и обновлять сео» |
| 7 | Всё из одной админки | Не знаю, покажите |
| 8 | Счета и бухгалтерия | «Не делаю. Но можно выставлять счет автоматически на майл» |
| 9 | Что автоматизировать | Допродажа при добавлении в корзину |
| 10 | Хранить клиентов | Да |
| 11 | Рассылки | Да, прямо из системы |
| 12 | Подписка на товары | Нет |
| 13 | Статистика | **всё** (6 из 6) |
| 14 | Подсказки что продвигать | Да |
| 15 | AI | **всё** (6 из 6): переводы, описания, SEO, соцсети, ответы клиентам, анализ продаж |
| 16 | Оплата | **всё**: банковские ссылки, карта, Apple Pay, Google Pay, PayPal, счёт |
| 17 | Доставка | DPD, Omniva, SmartPosti, курьер (самовывоз **не** выбран) |
| 18 | Страны | Вся Европа |
| 19 | Возвраты | «Нужно исправить и указать что косметика возврату не подлежит. По мерчу — пишут на майл» |
| 20 | Физический магазин | Да — и остатки синхронизировать |
| 21 | Перенести | Товары, фото, клиенты, старые заказы, подписчики (скидки и отзывы — нет) |
| 22 | Блог | Да |
| 23 | Данные фирмы | Rempire Store OÜ · 56237237 · rempiretower@gmail.com |
| 24 | Бюджет | Сначала хочу увидеть варианты |
| 25 | Сроки | Не горит |
| 26 | Главное улучшение | «Органика рост, гугл синхронизация, сео и продажи» |

## What this changes

### The brief is not what we assumed

The rebuild premise was "cheaper than Shopify". Renat never mentions cost.
His stated pain (q3) is that he **cannot edit the site himself** — he can't
write code and finds Shopify's block editor hard. He only touches "тексты и
страницы" in the admin today (q5).

So the product's value is **editability by a non-technical owner**, not
hosting savings. Savings become a secondary argument.

### The centrepiece feature, asked for unprompted

q6: an **admin chatbot that can fix things and update SEO for him**. That is
the direct answer to q3, and it lines up with his success criterion in q26
(organic growth, Google sync, SEO, sales). This should be designed as a
first-class product surface, not a bolt-on — an assistant with real,
permissioned tools over catalog/CMS/SEO, with preview-and-approve rather
than silent writes.

### Design direction conflicts with the Design Master Prompt

Renat: keep it roughly as now (q1), minimalism and white background (q2),
minimal / expensive / simple-and-clear (q4).

`REMPIRE — Claude Design Master Prompt.md` currently asks for urban,
editorial, bold, fashion-aware, "a little bold". **These are different
briefs.** Resolve before any design work: either update the design prompt to
a restrained minimal-premium direction, or show Renat two directions and let
him choose. Do not build against both.

### Scope he selected wholesale

q13 (all statistics), q15 (all AI), q16 (all payment methods) are
select-everything answers. Treat as a wish list to phase, not a v1 scope.
Payment reality: Montonio covers bank links + card + Apple/Google Pay in one
integration; PayPal is a separate integration; "оплата по счёту" is manual
bank transfer plus a generated invoice PDF.

## Open items — must be resolved before Phase 0 closes

1. **Who manages products, stock and orders?** He only edits texts/pages
   (q5), and the register lists 0 employees. Either he does more than he
   said, or someone else has admin access. This decides the whole admin
   design and the roles/permissions model.
2. **Which POS system?** Stock sync with the physical shop is required
   (q20) but the system was never named. No integration can be scoped
   without it.
3. **Pickup from the shop** — physical location exists (q20) but самовывоз
   was not selected as a delivery method (q17). Deliberate or oversight?
4. **Company data** — see the register section below; three of the four
   fields he gave conflict with something.
5. **Budget frame** — "покажи варианты" (q24) means we produce tiered
   options. See the turnover figure below before pricing them.

## Legal flags

### Returns policy (q19) — cannot be implemented as asked

Renat wants the site to state that cosmetics are non-returnable. Under EU
distance-selling rules (Directive 2011/83/EU art. 16(e), Estonian VÕS
§53(4)), the hygiene exception covers **sealed goods that the buyer
unsealed after delivery**. It does not permit a blanket exclusion: unopened,
still-sealed cosmetics remain returnable within the 14-day withdrawal
period.

The current Shopify policy is worse than wrong in the other direction — it
promises 30 days and paid return labels while also excluding all beauty
products, i.e. it contradicts itself. The new policy must say: 14-day
withdrawal, exception only for unsealed hygiene items, merch returnable per
the same 14 days. Needs a lawyer's sign-off before launch, not ours.

### Selling to all of Europe (q18)

Cross-border B2C distance sales above €10,000/year EU-wide require **VAT
OSS** registration and charging destination-country VAT rates. The platform
must therefore support per-country VAT rates and OSS-compatible reporting,
even if v1 ships with a single rate. Confirm with Renat's accountant whether
OSS is already registered.

## Estonian business register — verified 22.08.2026

Registry code **12216136** (`ariregister.rik.ee`):

| Field | Register | Renat (q23) | Live site |
|---|---|---|---|
| Name | **Rempire Store OÜ** | Rempire Store OU | "Rempire Store OÜ" (terms) / "Rempire Shop OÜ" (legal notice) |
| Status | Registrisse kantud (active) | — | — |
| VAT | EE102723858 (since 02.04.2024) | — | EE102723858 ✓ |
| Address | Pärnu mk, Paikuse alev, Käärasoo tee 43, 86604 | — | Mardi 1, 10145 Tallinn |
| Phone | +372 53035580 | 56237237 | both appear |
| Email | renatgayanov@gmail.com | rempiretower@gmail.com | rempireshopinfo@gmail.com, blackboxestonia@gmail.com |
| Board / owner | Renat Gayanov, 100% since 01.09.2023 | — | — |
| Activity | Juuksuriteenindus (EMTAK 96211) | — | e-commerce retail |
| E-invoices | does not accept e-invoices | — | — |
| Former name | T.Cvet OÜ | — | — |

Resolved: the legal name is **Rempire Store OÜ**; the legal notice's
"Rempire Shop OÜ" is wrong. Registry code and VAT on the site are correct.

Still unresolved: which phone and which email are canonical (Renat's answer
matches neither the register nor a single site value — `rempiretower@gmail.com`
is a fourth address), and whether invoices should carry the registered Pärnu
address or the Tallinn shop address. Invoice templates are blocked on this.

Also noted, non-blocking:

- **Taxable turnover Q2 2026: €16,073**, 0 employees, state taxes €751.
  This is the realistic frame for the budget options in q24 — a five-figure
  build is out of proportion to the business's current scale.
- Small VAT debt of €377.63 recorded 21.08.2026. Publicly visible, likely a
  late declaration payment. Not our problem, but worth Renat knowing it is
  visible to anyone checking the company.
- EMTAK activity code is hairdressing, not retail trade. Harmless, but his
  accountant may want it updated now that the shop is the main activity.

---

# Round 2 — 23.08.2026, 6/6 answered

Blob: `qa/round2-2026-08-23T06-26-13-853Z-*.json`.

| # | Question | Answer |
|---|---|---|
| 1 | Кто ещё в админке | Помощник по товарам · сборщик/отправщик заказов · помощник по рекламе и текстам |
| 2 | Касса в магазине | **Обычная касса без программы учёта** |
| 3 | Штрихкоды на упаковке | **Да, почти у всех товаров** |
| 4 | Салоны/опт по другой цене | Нет, но хочу в будущем |
| 5 | Пересъёмка фото | **Готов переснять всё** |
| 6 | Данные для счетов | 56237237 · rempireshopinfo@gmail.com · Mardi 1, Tallinn |

## What this settles

**Multi-user admin is v1 scope, not later.** Renat is not alone: at least
three helpers (catalog, fulfilment, marketing/content). Roles can stay
simple — Владелец / Товары / Заказы / Тексты — but accounts, per-user audit
and basic permission gates go into the first version. This also explains the
register's "0 employees": helpers, not payroll.

**There is no POS to integrate — and that is good news.** The shop till is a
plain cash register with no software. "Stock sync" therefore means: the new
platform IS the inventory system, and offline sales are recorded in the
admin. Design consequence: a fast «Продажа в магазине» action (scan or type
barcode → quantity → done, works on a phone). No third-party integration, no
API risk, and later the same screen can grow into a lightweight POS.

**Barcodes are the master key.** Nearly all packaging carries a scannable
EAN. The importer keys on barcode where present; the ~240 variants missing
Shopify SKUs stop being a blocker. Admin product form gets a barcode field;
the offline-sale action scans it. (Barcode values themselves still need
Shopify Admin API access or a scanning session to capture.)

**Wholesale pricing: schema now, UI later.** "Нет, но хочу в будущем" is the
exact case for a customer-group price mechanism in the data model with no v1
interface beyond a hidden flag.

**Photography: he will reshoot everything.** The single biggest quality
lever is unlocked. Next deliverable when a design direction is chosen: a
one-page shooting spec (white tile, ratio, lighting, per-product shot list)
so the reshoot lands consistent with the design system's packshot treatment.

**Invoice/contact data — decided by Renat:** phone **56237237**, email
**rempireshopinfo@gmail.com**, address **Mardi 1, Tallinn**. Combined with
the register: legal name Rempire Store OÜ, reg 12216136, VAT EE102723858.
The registered (Pärnu) address stays in the registry; business address goes
on documents. To fix on the current site at migration: the legal notice's
wrong "Rempire Shop OÜ", the stale privacy email blackboxestonia@gmail.com,
and the second phone 53035580.

## Nothing left blocking Phase 0

Remaining opens are access/tasks, not questions: Shopify admin credentials
(catalogue barcodes, customers, orders), DNS ownership for launch day,
Google/Meta properties under Renat's accounts, the Montonio contract signed
by Rempire Store OÜ, accountant's word on VAT OSS, legal sign-off on the
rewritten returns policy.
