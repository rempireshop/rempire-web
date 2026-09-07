# Счёт, который никто не оплатил — и продажа в салоне, которая теперь считается покупкой

07.09.2026, branch `r2-inv2` (eight commits on top of `448cbd7`). Two pieces of
work, joined by one idea: **the shop must not quietly do nothing.** An unpaid
invoice used to hang for ever with no letter and no ending; a sale rung up at
the till used to look paid and skip everything that makes a payment a payment.

Written for Dim. § 6 is the list of questions; § 7 is the part to forward to
Renat as it stands — what he sees, step by step, in plain Russian, when a
company does not pay.

---

## 1. What was verified, not rebuilt

Dim confirmed the defaults the invoice flow shipped with on 06.09. Each was
checked against the code and against a test that would fail if it changed.

| Confirmed | True in the code? | Where it is held |
|---|---|---|
| Numbering `A-2026-0001` — prefix + year + four digits, restarting every January | **yes.** `formatInvoiceNumber()` builds it; `nextInvoiceNumber()` takes the year from the **Tallinn** calendar and keeps one counter row per year (`invoice_counters`), so 31.12 at 22:30 UTC is already the new year's `0001`. A unique index on `orders.invoice->>'number'` makes a shared number impossible even in theory. | `tests/invoices.test.ts` — «is prefix + year + four digits», «hands out sequential numbers, unique under concurrency, restarting each year» (25 numbers allocated in parallel, all distinct) |
| Payment term — 7 days | **yes.** `INVOICE_DEFAULTS.dueDays = 7`, clamped 1–60, quoted to the shopper from the same setting through `/api/overrides/` so the checkout's «в течение 7 дней» cannot drift from the PDF. | `tests/invoices.test.ts` — «defaults to «A-», 7 days, a reminder on day −2 and auto-cancel on day +7» (now asserts the whole defaults object, so any change to any of the four fails here first) |
| Nothing ships before payment | **yes, and it is not merely a convention.** An invoice order sits in «новый»; `v.paid` is false, so the card offers no «Отправлен» and no label button, and the manual status list drops «Оплачен» in favour of the one door «Отметить оплаченным». The «Заказ принят» letter is on the paid transition only. The card says it in words: «Заказ ждёт оплаты по счёту — отправлять пока нечего». | `e2e/invoice.spec.ts` (`[data-admlabel]` only appears after the order is paid); `tests/invoices.test.ts` — «createOrder … no pending letter» |
| Anyone may choose «По счёту» | **yes.** The method is `PAYS[3]` for every shopper; the only condition on it is the 0 € guard, not a tier, an account or an approval. | `tests/invoices.test.ts` — «offers «По счёту» on a real total and drops it once a gift card covers everything» (runs the storefront's own `invoiceOffered()`/`isInvoice()` sliced out of `app.js`) |
| Invoice language: ET + EN, plus RU on a Russian order | **yes.** `bilingual()` joins «Tarne / Delivery» and appends « / Доставка» only when the order's language starts with `ru`; the PDF headings follow the same rule. | `tests/invoice-pdf.test.ts` — «keeps the Estonian/English headings and adds Russian only on a Russian order» |
| A 0 € order can never be an invoice order | **yes, two doors.** The checkout drops the method the moment `total()` reaches zero and falls back to the bank link; `createOrder()` refuses with `invoice_zero_total`, so a stale tab cannot talk its way past it. | `tests/invoices.test.ts` — «issues no invoice for a 0 € order» (no row, no burnt number, no letter) |

Two things were **checked and found wanting**, and fixed — see § 3 and § 4.

## 2. What was built (commits)

| sha | What |
|---|---|
| `92252ce` | Migration 145, the two new settings, the two letters, `src/lib/invoice-dunning.ts`, one call in `src/lib/flows.ts`, and the blank-IBAN block |
| `a4c98e5` | The salon till through `settlePayment()` |
| `924f471` | The admin's two new fields, the «Заполните IBAN» row on «Сделать сегодня», the honest receipt |
| `4921348` | Tests: `tests/invoice-dunning.test.ts`, the POS settlement suite, `e2e/salon-sale.spec.ts`, the blank-IBAN case |
| `fd1af04` | docs/payments.md § 10, docs/mail.md, docs/inventory.md |
| `521d3aa` | docs/flows.md and this report |
| `83cca54` | one comment: what «чек ушёл на почту» is a claim about |
| `<this>` | the shas above, and the neighbourhood e2e run |

## 3. Напоминание и автоотмена

Dim's words were two sentences: «We need reminders and after seven days we
cancel and inform.» So it is two steps on two intervals, and both intervals are
**settings**, sitting in «Настройки → О компании → Счета для компаний» next to
the prefix and the term:

| Setting | Default | Range | 0 means |
|---|---|---|---|
| Напомнить за, дней до срока | **2** | 0–30 | не напоминать |
| Отменить через, дней после срока | **7** | 0–90 | не отменять |

**Which interval, and why.** The reminder goes out **before** the due date, two
days before it by default — on a seven-day term that is day 5, late enough that
a bookkeeper who intended to pay this week has not been nagged, early enough
that there is still time. The letter is sent **once** per invoice (`remindedAt`
on the invoice record). If the cron was down and catches up after the due date
has already passed, the same letter goes with a different first line — «срок
оплаты … уже прошёл» — rather than telling somebody to pay by a date in the
past. Both dates in the letter are real: it names the due date *and*, when
auto-cancel is on, the date the order will close.

Cancellation is **7 days past the due date**, i.e. day 14 of a 7-day term. It
is not a letter, it is an action, and it is the same action the owner's own
«Отменить заказ» performs: `setOrderStatus(id, "cancelled", "system:invoice")`.
That matters for stock — the return move there only fires for an order that had
been paid, and an unpaid invoice never took stock in the first place, so
auto-cancel moves nothing, exactly like a manual cancel of the same order. Then
the company is told, in a letter that is not a demand: the order is closed,
nothing is owed, the goods are back on sale, and «если перевод всё-таки был —
ответьте на это письмо».

**A paid invoice is never touched.** Three guards, deliberately overlapping:
the selection asks only for orders in `new`/`failed` with no `paidAt` on the
invoice and no `paid` on the payment blob; and every candidate is **re-read
immediately before it is cancelled**, so «Отметить оплаченным» pressed while
the job was walking the list wins. A test winds an already-paid invoice a month
past its due date and runs the job twice: nothing moves, no letter, no stock.

Where it runs: `GET /api/cron/flows` once a day. The invoice-specific selection
and both texts live in `src/lib/invoice-dunning.ts`; the diff in the shared
`src/lib/flows.ts` is one dynamic import inside a `try`, plus the `invoices`
key on the report — the payments agent's own unpaid-order path is untouched.

## 4. IBAN: «later» made safe

Dim left the seller address and the IBAN for later. The address is a
cosmetic gap — an invoice with a wrong-but-present address is still a document.
A blank **IBAN** is not: it turns the invoice into a numbered demand for money
with nowhere to send it, and both sides then wait. Before today the shop sent
it anyway; the PDF printed «— (не указан)» where the account number belongs and
the admin card carried a soft warning on a settings page nobody opens twice.

That is now closed. `invoiceSendBlock()` refuses the send before anything is
rendered, and the refusal is visible in four places:

1. **The order card** — «Счёт не отправлен: в «Реквизитах» нет IBAN. Заполните
   его в «Настройки → О компании» и нажмите «Отправить счёт ещё раз»».
2. **«Сделать сегодня», the first screen of the panel** — a warning row
   «Заполните IBAN — счета не уходят», shown as soon as one invoice is waiting,
   linking straight to the right settings page. This is the «impossible to
   miss» part: everything else lives on a page the owner has to go looking for.
3. **The settings card** — a red block instead of the old soft list.
4. **The shopper's receipt** — «Счёт выписан — пришлём его на …», not «Счёт
   отправлен на …». The screen no longer promises a letter that was never sent.

Nothing else is blocked: the number is still allocated, «Скачать счёт» still
renders the PDF (so the owner can see exactly what is missing), and the moment
the IBAN is filled in, «Отправить счёт ещё раз» sends the very same invoice. A
missing **bank name** is still only a warning — it does not stop a transfer.

## 5. Продажа в салоне

`POST /api/admin/pos-orders/` created the order, wrote `status: paid` by hand
and took the stock — and, because it never went through `applyPaymentResult()`,
skipped everything that hangs off that single transition. A sale in the room
earned **no loyalty points**, wrote **no `purchase` row** (so «Аналитика» was
quietly missing the shop's own takings), and sent the customer **nothing**,
while the e-mail box on the register screen sat next to a line about receipts.

It now settles through `settlePayment()` — the same door a confirmed card
payment goes through. What changed, and what deliberately did not:

- **Points.** A till sale with an e-mail that matches an existing customer card
  credits points at the usual rate. The card is *matched*, never created — an
  address typed at the till is not a sign-up — and it is deliberately **not**
  passed to `createOrder()` as the pricing context: that would switch a partner
  salon's own purchase to pro prices and make the screen and the receipt
  disagree. `pricing_tier` is stamped `retail`, which is what was charged.
- **The purchase event.** Written once, on the paid transition, for every sale
  including a walk-in with no e-mail — it is the shop's revenue, not the
  customer's.
- **The letter.** «Заказ принят» to the address the cashier typed. No address,
  no letter, no complaint — and the receipt screen now says which of the two
  happened: «1 поз. · наличные · остатки списаны · чек ушёл на почту».
- **The shelf reason stays `sale_pos`.** `settlePayment()` would have written
  `sale_web`; the till hands it its own `decrementStock`, so «Склад → Продажа
  в салоне» goes on telling a room sale from a web one.
- **The method survives.** The blob is written before the settlement and merged
  into, so the card still says «наличные» rather than only «pos».
- **Nothing can fail the register.** The settle is wrapped: the money is in the
  drawer and the order row exists, so a mail outage is something to fix on the
  order card, not an error message in front of a customer.

One consequence worth naming: **Renat now gets his usual Telegram/e-mail ping
for a sale he just rang up himself.** That is question 5 below.

## 6. Questions

1. **The reminder is two days before the due date, and there is only one.**
   With a seven-day term that is day 5. Alternatives, each a settings change
   rather than a rebuild: three days (day 4), or a second reminder just after
   the due date. Is one, at −2, right for a salon's bookkeeper?
2. **Cancellation is 7 days after the due date — day 14 of a 7-day term.**
   Dim's «after seven days we cancel» could also have meant «on the due date».
   Fourteen days total was chosen because cancelling a real company's order on
   the day the term runs out is harsh for a shop this size. Confirm, or say 0
   (the due date itself) and it is one field.
3. **The cancellation letter is polite and offers a way back** («если перевод
   всё-таки был — ответьте на это письмо»), but there is **no button to un-cancel**
   an order the shop closed. Restoring one means creating a new order by hand.
   Worth a «Вернуть заказ» action, or is a reply-and-reorder enough at three to
   five orders a month?
4. **A blank IBAN now blocks the letter.** The company still gets its order
   number and the receipt says the invoice is coming — but it gets nothing in
   its inbox until Renat fills the field in. The stricter alternative is to
   drop «По счёту» from the checkout entirely while the IBAN is blank. Should
   it be that strict?
5. **A salon sale now pings the owner** like a web order does («💶 Заказ
   оплачен» on Telegram and e-mail), because it goes through the same door.
   For a till sale Renat rang up himself that is probably noise. Silence it for
   `channel: 'pos'`?
6. **The «Заказ принят» letter is what a till customer gets.** It is the
   existing paid-order letter — correct in substance (what was bought, what it
   cost) but written for a parcel, not for someone walking out of the salon
   with the bottle. A separate «Чек» wording is half a day. Worth it?
7. **`settings.invoice` is public.** It rides on `/api/overrides/`, which the
   storefront reads, so the two new intervals are visible to anyone who looks —
   the checkout already needs `dueDays` from the same key. Harmless as far as I
   can see (it says when an unpaid order is cancelled, which the letter says
   anyway), but say the word and the public copy can be trimmed to `dueDays`
   and `prefix`.
8. **VAT stays at 24 % for everybody** — see § 8. Nothing in the UI implies
   otherwise, and I have **not** added a sentence about it. § 8 proposes one,
   for a decision rather than for merging.

## 7. Что видит Ренат, когда компания не платит

Это часть можно переслать Ренату как есть.

**День 0. Компания оформила заказ по счёту.**
В «Заказах» появляется чип **«По счёту»** со счётчиком. В карточке заказа —
строка «Ожидает оплаты по счёту №A-2026-0001 · до 13.09.2026» и данные фирмы:
название, рег. номер, KMKR, адрес, почта для счёта. Кнопка «Отметить
оплаченным» уже есть, но нажимать её пока не за что. Отправлять тоже нечего —
так и написано: «Заказ ждёт оплаты по счёту — отправлять пока нечего».

*Если в реквизитах магазина не заполнен IBAN,* на главной админки, в «Сделать
сегодня», стоит красная строка **«Заполните IBAN — счета не уходят»**. Нажмите
её, заполните IBAN в «Настройки → О компании → Реквизиты», вернитесь в заказ и
нажмите «Отправить счёт ещё раз» — счёт уйдёт тот же самый, с тем же номером.

**День 5. Магазин напоминает сам.**
Ничего делать не нужно. На почту бухгалтера уходит письмо «Напоминание об
оплате счёта»: номер, сумма, IBAN, пояснение платежа, срок и тот же счёт в PDF
во вложении. В письме прямо сказано, что будет, если не заплатить: «Если оплата
не поступит до 20.09.2026, заказ будет отменён, а товары вернутся в продажу».
Напоминание уходит **один раз** — второго не будет.

**День 7. Срок прошёл.**
В карточке заказа строка становится красной: «Просрочен на 1 день». На главной
админки, в «Сделать сегодня», появляется строка «1 счёт просрочен» — она ведёт
на тот же чип «По счёту». Заказ всё ещё открыт: если деньги придут сегодня,
просто нажмите «Отметить оплаченным», и всё пойдёт как обычно.

**Деньги пришли — в любой из этих дней.**
Нажмите в карточке **«Отметить оплаченным»** и подтвердите. Клиенту уйдёт
письмо «Заказ принят», спишутся остатки, начислятся баллы, заказ встанет в
очередь на отправку. Второе нажатие ничего не сделает — повторов не будет.

**День 14. Магазин закрывает заказ сам.**
Заказ переходит в «Отменён». Товары возвращаются в продажу (точнее — они и не
уходили: со склада списывается только оплаченный заказ, поэтому и возвращать
нечего). Компании уходит письмо «Заказ отменён — счёт не оплачен»: платить
больше нечего, товары снова в продаже, а если перевод всё-таки был отправлен —
пусть ответят на это письмо. В журнале остаётся запись об отмене.

**Если деньги пришли уже после отмены.**
Компания ответит на письмо. Заказ придётся оформить заново — кнопки «вернуть
отменённый заказ» пока нет (вопрос 3 выше). Счёт при этом никуда не девается:
номер остаётся за отменённым заказом, «Скачать счёт» работает по-прежнему.

**Как поменять сроки.**
«Настройки → О компании → Счета для компаний». Четыре поля: префикс номера,
срок оплаты, «напомнить за N дней до срока» и «отменить через N дней после
срока». Ноль в любом из двух последних выключает этот шаг совсем. Оплаченный
счёт магазин не трогает никогда — даже если вы отметили оплату уже после срока.

## 8. НДС: обратного начисления нет, и нигде не обещано

Dim answered «later», so **every invoice charges 24 %**, including one made out
to a VAT-registered company in another EU member state. The reverse charge
(0 % Estonian VAT plus «Pöördmaksustamine / Reverse charge, Art. 196 Directive
2006/112/EC» on the document, the buyer accounting for VAT at home) is **not
implemented**.

Checked, so this is a statement and not an assumption: nothing in the checkout,
in the PDF or in any of the three letters implies otherwise. The KMKR field is
optional and labelled «KMKR / номер НДС», with no promise attached; a filled-in
number changes nothing in the arithmetic; the PDF prints the buyer's VAT number
because § 37 of the VAT Act asks for it, next to a VAT line that always says
24 %. An EU business buyer reading the document sees Estonian VAT charged, in
full, on every line — which is exactly what happened.

**The one sentence I would add, if Dim wants it** (proposed, not merged): a
line under the KMKR field in the checkout, three languages,

> «Счёт всегда выставляется с эстонским НДС 24 %. Обратное начисление
> (pöördmaksustamine) мы пока не применяем.»

It costs three dictionary entries and removes the only wrong expectation a
foreign buyer could form — that typing a VAT number will zero the tax. I did
not add it because it is a customer-facing promise about tax, and that is
Renat's accountant's sentence to approve, not mine.

## 9. Äriregister lookup — the design, not the code

Dim said «yes, later», so nothing was built. This is what building it would
mean, checked against RIK's own documentation on 07.09.2026.

**What we want.** The shopper types a registry code (or the first letters of a
company name) into the checkout's company block, and the name, the legal
address and the KMKR number fill themselves in. Four fields become one, and the
address on the invoice becomes the address in the register rather than whatever
was typed — which is the field § 37 of the VAT Act is fussiest about.

**Three ways in, in increasing order of cost.**

| # | Source | Needs | Gives | Live? |
|---|---|---|---|---|
| A | **Autocomplete service** (avaandmed.ariregister.rik.ee) | **no agreement** — RIK names Autocomplete and the e-invoice-recipient query as the two services that need none | name ↔ registry code as you type | yes |
| B | **`arireg.ettevotjaRekvisiidid_v1`** — «Company requisite information service», the one RIK describes as being *for issuing invoices to companies* | a signed contract with RIK (free for API-only use, ~5 working days) plus a username/password | registry code, business name, **VAT number**, status, address with postal and EHAK codes | yes |
| C | **Bulk open data** — the whole register as JSON/XML downloads | nothing | the same basic fields, as a file | no — a daily snapshot |

Technically: SOAP/XML over `https://ariregxmlv6.rik.ee/` (test:
`https://demo-ariregxmlv6.rik.ee`, WSDL at `?wsdl`), authenticated with the
e-Business Register username and password. Limits are generous for this shop:
50 000 queries a day per contract, one concurrent query.

**And the VAT number, if the contract is not wanted:** the European
Commission's **VIES** service (`checkVatService` under
`ec.europa.eu/taxation_customs/vies`) validates any EU VAT number with no key,
no contract and no cost, and answers with the registered name and address. It
is SOAP today; a REST/JSON version is in the works. It is the natural companion
to B or the fallback for A — and it is the only one of these that also works
for a company outside Estonia.

**What I would build.** Route B with A as the type-ahead: the shopper starts
typing, autocomplete narrows it down, one pick fills name + registry code +
address + KMKR, and every field stays editable — a register lookup that cannot
be corrected is worse than typing. Server-side, behind our own route, so the
credentials never reach a browser, cached per registry code for a day, and
**never blocking**: the register being down must leave the form exactly as it
is today, typed by hand.

**Effort.** The contract and the credentials are the long pole — five working
days at RIK, and a decision by Dim that we want a contract at all. The code is
roughly:

- one server route + a small SOAP client (there is no JSON API): **~1 day**
- the checkout's type-ahead, its "not found" and "register is down" states, and
  the three languages: **~1 day**
- tests (a recorded response, the failure paths, and the guarantee that a
  lookup never blocks an order): **~0.5 day**

Call it **2.5 days of work behind a 5-day wait**, and cheaper — about a day —
if we settle for VIES alone, which fills the name and the address for any
VAT-registered company but cannot help a small Estonian OÜ that is not
VAT-registered.

## 10. Verification

```
npx vitest run                                         80 files · 1703 passed
npx vitest run tests/invoices.test.ts                  23 passed
npx vitest run tests/invoice-dunning.test.ts           11 passed
npx vitest run tests/pos-orders.test.ts                11 passed
npx vitest run tests/emails.test.ts tests/emails-compat.test.ts
                                                      465 passed
npx tsc --noEmit                                       clean
node --check public/shop2/app.js                       clean
node tools/i18n-gaps.mjs        0 untranslated · ET/EN parity ok · no duplicate keys
node tools/e2e-build.mjs
E2E_PORT=3717 npx playwright test e2e/{salon-sale,invoice}.spec.ts
             --project=mobile                                          3 passed
E2E_PORT=3717 npx playwright test e2e/{invoice,salon-sale,checkout,
             sweep-admin-ops}.spec.ts --project=desktop               21 passed
```

The last line is the neighbourhood, not just the new work: the till's own fuzz
sweep and the whole checkout still pass, so nothing about the settlement change
moved a price, a stock count or a receipt.

`e2e/invoice.spec.ts` now sets the shop's IBAN through the admin API before the
shopper checks out — merged into whatever content the run already holds, never
overwriting it — because without one the letter is deliberately never sent. The
bank name is left blank on purpose, so the settings card's softer «не
заполнено» warning is still exercised. The spec also types a new reminder
interval, saves it, reads `settings.invoice` back and puts the default back
again: the whole e2e run shares one database.

## 11. Known gaps

| # | Gap | Why it is acceptable today |
|---|---|---|
| 1 | **The reminder never fires if the cron missed the whole window.** If the job is down from day 5 to day 15, the invoice is cancelled without a reminder ever having gone out. | The cancellation letter still goes, and it explains itself. Vercel Cron on Hobby runs daily; a ten-day outage is a bigger problem than a missing reminder. |
| 2 | **No «Вернуть заказ» after an automatic cancellation.** | Question 3. Rare by construction — it takes a transfer that crossed the letter in the post. |
| 3 | **The register is not consulted**, so a typo in the legal address is printed on the invoice as typed. | § 9; the field is required and shown back to the shopper before the order is placed. |
| 4 | **A salon sale pings the owner.** | Question 5 — one condition, once Dim says which way. |
| 5 | **`invoice.cancelledAt` is written before the status change.** A crash in between leaves an invoice stamped cancelled on an order that is still «новый». | The next run finishes the job rather than skipping it: the letter comes *after* the status write, so a stamp on an open order proves nothing was sent, and a run can never see an order it has already cancelled (the selection asks only for open ones). The stamp keeps its original timestamp. |
| 6 | **Merge boundary.** `src/lib/flows.ts` gained four lines (one key, one initialiser, one guarded call); `public/shop2/app.js` gained the settings fields, the «Сделать сегодня» row and the till's own hint. The payments agent's unpaid-order path in the same cron and the same file was not touched. | Conflicts, if any, are textual and small. |
