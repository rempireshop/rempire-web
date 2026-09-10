# Customer e-mail — Resend, ten templates, three languages

Everything the shop sends to a customer goes through one function
(`sendMail`) and one renderer per letter. No SDK: Resend's REST API over
`fetch`, the same way `src/lib/notify.ts` already forwards to Telegram and to
Dim.

The rule the whole module is built around: **a letter must never be able to
break an order**. Every entry point returns a result object and swallows its
failures. If Resend is down, or the key is missing, the order is still paid,
still stored, still shipped — it just has no letter, and the failure is in the
log.

## What is where

| File | What it is |
|---|---|
| `src/lib/mail.ts` | `sendMail()` — Resend REST, one retry on 5xx, never throws |
| `src/lib/mail-hooks.ts` | `onOrderCreated` / `onOrderPaid` / `onOrderShipped` |
| `src/emails/*.ts` | one renderer per letter → `{ subject, html, text }` |
| `src/lib/mail-hooks.ts` | `onOrderCreated` / `onOrderPaid` / `onOrderShipped` / `onOrderClosed` / `onOrderUnpaid` |
| `src/emails/*.ts` | the five renderers → `{ subject, html, text }` |
| `src/emails/layout.ts` | shared shell, palette, dark-mode CSS, money/URL helpers |
| `src/emails/common.ts` | customer name, item table (names with the type tail in the letter's language — `src/lib/product-name.ts`), delivery line, totals |
| `src/emails/texts.ts` | the owner's own subject / intro / closing line — see below |
| `src/lib/mail-texts.ts` | `loadMailTexts()` — `settings.mail_texts` → the renderers |
| `src/emails/index.ts` | template registry + demo data for the preview |
| `src/emails/samples.ts` | the *awkward* sample data — a set line, a parcel machine, a promo, points, a gift card with a message — for the renderer and the compatibility test |
| `tools/render-emails.mjs` | every letter × RU/ET/EN to disk as HTML + text, `--png` for 600 px / 360 px / 360 px dark screenshots |
| `tests/emails-compat.test.ts` | the mail-client rules, held against every one of those renders |
| `src/app/api/admin/mail/preview/route.ts` | `GET` — HTML for the admin iframe, `?format=texts` for the editor |
| `src/app/api/admin/mail/test/route.ts` | `POST` — send a sample (admin only) |
| `public/shop/emails/*.html` | **design source of truth**, hand-made, keep |
| `tests/emails.test.ts`, `tests/mail.test.ts`, `tests/mail-hooks.test.ts`, `tests/mail-texts.test.ts` | `npm test` |

`public/shop/emails/` stays in the repo: it is the human-readable reference the
design was signed off on, and `/shop/emails/` is still the static preview page
linked from the admin. The TypeScript renderers reproduce it; when the design
changes, change both.

## Environment variables

Never commit values. Locally they go in `.env.local` (git-ignored); on Vercel /
Railway, into the project's environment settings.

| Name | Needed for | Notes |
|---|---|---|
| `RESEND_API_KEY` | sending anything | missing ⇒ every send is *skipped*, logged, and reported as `{ ok:false, skipped:true }`. Nothing throws. |
| `RESEND_FROM` | the From: header | default `Rempire <shop@rempireshop.com>`. Must be on a verified Resend domain. |
| `MAIL_REPLY_TO` | where replies land | see "Sender and reply-to" below. Omitted ⇒ `info@rempireshop.com`. |
| `PUBLIC_BASE_URL` | absolute image and link URLs | e.g. `https://rempireshop.com`. Default is that same value; set it on staging or every letter links to production. |
| `MAIL_PENDING_PAYMENT` | `onOrderCreated` | `1`/`true`/`on` turns on the "order received, awaiting payment" letter. **Off by default** — see below. |
| `MAIL_RETRY_DELAY_MS` | the 5xx retry pause | default `400`. Tests set `0`. |
| `RESEND_TO`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | the *shop's own* ping on a paid order | owned by `src/lib/notify.ts`, documented here because `onOrderPaid` uses it. |

## Creating the Resend API key (Dim)

The Resend account is the shop's (`rempireshopinfo@`, see `docs/accounts.md`),
region Ireland / `eu-west-1`, domain `rempireshop.com` added 03.09.2026 with
DKIM, SPF and DMARC in Zone DNS.

1. Resend → **Domains** → `rempireshop.com` must read **Verified**. If it still
   says *Pending*, the DNS records have not propagated — wait, then press
   *Verify DNS Records*. Nothing below works until it is green.
2. Resend → **API keys** → **Create API Key**.
   - Name: `rempire-web`
   - Permission: **Sending access** (not Full access — this key only sends).
   - Domain: `rempireshop.com`.
3. Copy the key **once** — Resend never shows it again.
4. Put it in the Bitwarden vault (org "Rempire") *and* into the hosting
   project's environment as `RESEND_API_KEY`. Redeploy.
5. **Never** paste it into a file in this repo, a commit, a screenshot or a
   chat. If it leaks, revoke it in Resend and create a new one — that is the
   whole recovery procedure.

Separate keys per environment are cheap: make a second one named
`rempire-web-staging` rather than sharing production's.

## Sender and reply-to policy

- **From** = `RESEND_FROM`, default `Rempire <shop@rempireshop.com>`. The
  mailbox does not have to exist — Resend only needs the *domain* verified.
- **Reply-to** = `MAIL_REPLY_TO`, default **`info@rempireshop.com`**. It has to
  be a mailbox somebody actually reads, and that one now is: Cloudflare Email
  Routing forwards `info@` and `shop@` to the shop's Google account
  (`docs/accounts.md`). It is also the address the letter's own footer prints,
  so a customer who replies and a customer who copies the footer reach the same
  inbox. Set `MAIL_REPLY_TO` only to send replies somewhere else.
  - Resend still has **no inbound mail** on the domain — the MX records point at
    Cloudflare's routing, not at Resend. `shop@rempireshop.com` (the From:) is
    forwarded too, but nothing reads a From: address by policy.
- Every letter also says "just reply to this e-mail" in the customer's own
  language, so the reply-to must be right before the shop opens.

## The three hooks

Backend-core and the payments/checkout routes import these lazily by name; the
names are a contract, do not rename them.

```ts
const { onOrderPaid } = await import("@/lib/mail-hooks");
await onOrderPaid(order);           // returns, never throws
```

| Hook | When | What it does |
|---|---|---|
| `onOrderCreated(order, { sendPending? })` | order row written, payment not confirmed | **nothing**, unless `MAIL_PENDING_PAYMENT` is on or the caller passes `sendPending: true`. An unpaid order abandoned two minutes later should not have produced a letter. Turn it on for bank-link flows, where the customer leaves the site to pay. `createOrder` now passes `sendPending` from `settings.flows.pending`; with no such key, `MAIL_PENDING_PAYMENT` decides as before. |
| `onOrderPaid(order)` | payment confirmed | «Заказ принят» to the customer, in the order's own language, plus the shop's own Telegram + e-mail ping through `notify.ts`, plus the gift cards bought in the order (below). |
| `issueOrderGiftCards(order)` | the payment routes see "paid" for an order that is already paid — a webhook retry, the shopper's return after the webhook | the gift-card half of `onOrderPaid` on its own: mint the cards bought in the order (idempotent — existing cards win) and mail each to its recipient, Resend key `gift:<code>`. No customer letter, no ping. Exists so a crash between the status write and the hook cannot leave a paid order without its cards. |
| `onOrderShipped(order, tracking)` | parcel handed to the carrier | «Заказ отправлен» with the tracking code and a carrier link. `tracking` is a bare code string, or `{ code, url?, carrier? }`. |
| `onOrderClosed(order, { kind, amount? })` | the order is cancelled, or money went back | «Заказ отменён» (`kind: "cancelled"`) or «Деньги возвращены» (`kind: "refunded"`, `amount` = what actually left). One renderer, two openings. Called from «Отменить заказ» and «Изменить статус вручную» in the admin (`PATCH /api/admin/orders/<id>`), from «Вернуть деньги» and the refund webhook (`settleRefund()`), and from the cron when an unpaid order runs out of time. Until 07.09.2026 none of those said anything at all to the customer. |
| `onOrderUnpaid(order, { daysLeft, payUrl })` | an unpaid order is a few days old | «Заказ ждёт оплаты», with a button back to that order's own failed receipt — the screen that carries «Оплатить ещё раз» and the choice of another method. Only the daily cron sends it (`runUnpaidOrders()`, docs/flows.md). |

Each returns `{ ok, skipped?, reason?, id?, notified? }`. Callers may ignore it.
Sends carry an idempotency key derived from the order number, so a payment
webhook delivered twice does not send the letter twice.

**A salon sale is one of these too** (07.09.2026). `POST /api/admin/pos-orders/`
used to mark the order paid by hand and therefore never reached `onOrderPaid`;
it now settles through `settlePayment()` like a card payment, so a till sale
with an e-mail in the box gets «Заказ принят» — and the register screen says
«чек ушёл на почту» only when the server really sent it. A walk-in with no
address is `{ skipped: true, reason: "no_customer_email" }`, exactly as it was.
See docs/inventory.md and `tests/pos-orders.test.ts`.

The order shape is `db/migrations/001_core.sql` / `mapOrder()` in
`src/lib/orders.ts`. Both the snake_case row and the camelCase mapped object
are accepted, and every field is optional: a guest checkout with no name, no
variant and a jsonb address still renders a correct letter.

## The letters
## The ten letters

| id | Renderer | Kind |
|---|---|---|
| `order-confirmed` | `renderOrderConfirmed(order, lang)` | service |
| `order-shipped` | `renderOrderShipped(order, lang, tracking)` | service |
| `order-unpaid` | `renderOrderUnpaid(order, lang, {daysLeft, payUrl})` | service — the reminder before an unpaid order is let go |
| `order-cancelled` | `renderOrderCancelled(order, lang, {kind:"cancelled"})` | service |
| `order-refunded` | `renderOrderCancelled(order, lang, {kind:"refunded", amount})` | service — same renderer, the other opening |
| `abandoned-cart` | `renderAbandonedCart(cart, lang, resumeUrl)` | marketing — unsubscribe link |
| `back-in-stock` | `renderBackInStock(product, lang)` | marketing — unsubscribe link |
| `birthday` | `renderBirthday(customer, lang, code)` | marketing — unsubscribe link |
| `login-code` | `renderLoginCode(code, lang, {minutes})` | service — the account sign-in code (docs/flows.md) |
| `partner-welcome` | `renderPartnerWelcome(customer, lang, {percent, company})` | service — «Цены для салонов включены», sent by `src/lib/partner-mail.ts` when the owner makes a customer a partner (docs/loyalty.md) |
| `invoice` | `renderInvoice(order, {invoice, seller, totals}, lang)` | service — «Счёт на оплату» with the PDF attached, sent by `src/lib/invoices.ts` (docs/payments.md § 10) |
| `invoice-reminder` | `renderInvoiceReminder(order, {invoice, seller, totals, cancelAt?, overdue?}, lang)` | service — the one reminder before the due date, the PDF again |
| `invoice-cancelled` | `renderInvoiceCancelled(order, {invoice, totals}, lang)` | service — the order was closed because nobody paid |

### The three invoice letters

They belong to «По счёту — для компаний» and are described end to end in
docs/payments.md § 10. In mail terms:

- They go to the **invoice e-mail** (`orders.invoice.email` — the bookkeeper's
  address the checkout asked for), not to `order.email`, and in the order's own
  language.
- They are **not owner-editable**. `settings.mail_texts` covers the seven
  letters above; an invoice's wording is bound to the numbers printed in it, so
  it is not in `MAIL_TEXT_TEMPLATES` (src/emails/texts.ts) and not in the
  «Письма» list. All three are in `TEMPLATE_IDS`, so the admin preview and the
  «отправить тест» button can render them.
- `invoice` and `invoice-reminder` carry the **same PDF** as an attachment,
  `rempire-invoice-<номер>.pdf` (src/lib/invoice-pdf.ts). The attachment is
  best effort in both: a missing font costs the file, never the letter.
- **A blank IBAN blocks the send.** `invoiceSendBlock()` in `src/lib/invoices.ts`
  refuses before anything is rendered, and `invoice.sendError` is set to
  `no_iban`; the admin order card says so in words and offers «Отправить счёт
  ещё раз», and the shopper's receipt says «Счёт выписан — пришлём его на …»
  instead of claiming it was sent. This is the one condition under which the
  shop deliberately does not write to a customer: an invoice with nowhere to
  pay it is worse than no invoice.
- Idempotency keys: `invoice:<номер>` on the first send, `invoice:<номер>:<ms>`
  on a deliberate resend, `invoice-reminder:<номер>` and
  `invoice-cancelled:<номер>` for the two automatic ones — so the daily cron
  running twice cannot mail a bookkeeper twice, and neither can Resend.

The reminder and the cancellation are sent by `src/lib/invoice-dunning.ts` from
the daily cron, not by a hook; the intervals are settings («Настройки → О
компании → Счета для компаний»).

`lang` accepts anything the row carries — `"RU"`, `"et-EE"`, `"ee"`, `null` —
and normalises to `ru` / `et` / `en`, Russian being the fallback. Subject,
headings, buttons, notes and the footer are translated; the legal line
**Rempire Store OÜ, Tallinn** is the same in all three.

Every letter ships both parts: an inline-CSS table-layout HTML body and a
plain-text alternative. Images and links are absolute, built from
`PUBLIC_BASE_URL`. Colours are declared for light *and* dark
(`prefers-color-scheme` plus Outlook's `[data-ogsc]` hooks), and every element
that sets a text colour also sets its own background, so a client that
force-inverts the letter cannot produce dark-on-dark.

### What every letter is held to (`tests/emails-compat.test.ts`)

Mail clients disagree more than browsers do — Outlook on Windows lays out
with Word, Gmail drops `<style>` on some paths and clips at ~102 KB, dark-mode
clients repaint colours, image blockers show alt text, a phone shows a 360 px
column — so the same rules are checked on every letter × RU/ET/EN, rendered
from `src/emails/samples.ts` (the awkward order: two lines with a set, an
Omniva parcel machine, a promo code, loyalty points, a long title, a gift
card with a message, per-language names so a stray Cyrillic word can only be
template copy):

- one 600 px column of `role="presentation"` tables with `max-width:600px`;
  no flex/grid/position/float, no background images, no script/link/form;
- every styled element carries its style inline; the `<style>` block holds
  only what cannot be inlined — the font `@import`, `:root`, the phone media
  query, the dark-mode rules and their `[data-ogsc]` twins;
- every `<img>` has a non-empty `alt`, a `width` and a `height`; every `src`
  and `href` is absolute `https://` (or `mailto:`);
- under 100 KB; a preheader as the first thing in `<body>`; a plain-text part
  with no markup and the legal line; a subject in every language;
- no Cyrillic anywhere in an ET/EN letter — subject, text or HTML;
- `color-scheme` / `supported-color-schemes` meta, the dark block, and a logo
  that survives a dark card: two transparent PNGs of the tower alone —
  `public/brand/tower-email-ink.png` on the light card and
  `tower-email-white.png` swapped in by the same dark-mode hooks the palette
  uses (`prefers-color-scheme: dark` and `[data-ogsc]`). No tile: the owner
  asked for a logo without a box; a client that darkens the card while
  ignoring both hooks keeps the ink tower;
- buttons are the hybrid kind: `display:block` padding on the `<a>` (46 px of
  clickable face) plus `mso-padding-alt` on the cell for Outlook, and full
  width below 620 px so a long Estonian label stays on one line;
- nothing that must stay on one line wraps at 360 px: prices (`&nbsp;€`),
  «2 шт», the dots between a title and its size.

The rule that is deliberately *not* enforced: an order number inside the
owner's own intro sentence may still break at its hyphen on a narrow phone.
That sentence is his text and reaches the letter verbatim (`texts.ts`), and
the admin's own tests look for it as a plain substring — no markup is woven
into it.

To *see* the letters rather than assert on them:

```bash
node tools/render-emails.mjs --out /tmp/emails --png
```

writes 21 HTML + 21 text files and 63 PNGs (600 px, 360 px, 360 px dark) with
web fonts and every other request blocked, so what you look at is the Arial
fallback a client without web fonts renders — the look the letters have to
be right in. Node 22 runs the TypeScript templates directly
(`tools/lib/ts-resolve.mjs` resolves their extensionless imports); nothing to
build.

## What the owner may rewrite — `settings.mail_texts`

Three strings per letter per language are the owner's, edited in the admin's
«Маркетинг → Письма» tab without touching HTML: **the subject line**, **the
intro paragraph** (the text under the greeting) and **the closing line** at
the bottom of the letter. Everything else — the greeting itself, the order table,
the delivery panel, the buttons, the unsubscribe line, the footer and the legal
line — stays as coded, because those are the parts a wrong edit breaks.

| File | What it is |
|---|---|
| `src/emails/texts.ts` | the defaults, the placeholder list, `cleanMailTexts()`, `mailText()` / `mailTextHtml()` |
| `src/lib/mail-texts.ts` | `loadMailTexts()` — the one door between the setting and the renderers |

Storage is one settings row, written through the ordinary
`PUT /api/admin/settings`:

```json
{ "mail_texts": { "order-confirmed": { "et": { "subject": "…", "intro": "…", "signature": "…" } } } }
```

Ten letters are editable — `order-confirmed`, `order-shipped`,
`order-unpaid`, `order-cancelled`, `order-refunded`, `abandoned-cart`,
`back-in-stock`, `birthday`, `login-code`,
`partner-welcome` — in `ru`, `et`,
`en`. `gift-card` is not: its wording is bound up with the amount and the
giver's name. An absent key means "use the default", so the shop that never
opens the tab is byte-for-byte the shop that existed before the editor did,
and «Вернуть стандартный текст» is a *deletion*, not a copy of the default
into the row.

**Which line is which**, per letter:

| Letter | subject | intro | signature |
|---|---|---|---|
| `order-confirmed` | «Заказ R-1 принят — Rempire» | the paragraph after «Здравствуйте, Имя!» | «Есть вопрос по заказу? …» |
| `order-shipped` | «Заказ R-1 отправлен — Rempire» | same | «Трек-номер начинает отслеживаться…» |
| `order-unpaid` | «Заказ R-1 ждёт оплаты — Rempire» | same | «Что-то пошло не так при оплате? …» |
| `order-cancelled` | «Заказ R-1 отменён — Rempire» | same | «Если это ошибка или вы хотите оформить заказ заново…» |
| `order-refunded` | «Возврат по заказу R-1 — Rempire» | same | «Если деньги не придут в течение пяти рабочих дней…» |
| `abandoned-cart` | «Вы забыли корзину — Rempire» | same | «Товары в корзине не резервируются…» |
| `back-in-stock` | «X снова в наличии — Rempire» | the paragraph after «Здравствуйте!» | «Наличие и цена актуальны…» |
| `birthday` | «С днём рождения! …» | the paragraph after «Имя, поздравляем! 🎂» | «Введите код при оформлении заказа…» |
| `login-code` | «482915 — код для входа в Rempire» | the paragraph after «Здравствуйте!» | «Если вы не запрашивали код…» |
| `partner-welcome` | «Цены для салонов включены — Rempire» | the paragraph after «Здравствуйте, Имя!» (or the salon's name) — carries `{percent}`, the live salon discount | «Вопросы по ассортименту…» |

### Placeholders

Seven, offered as clickable chips next to each field. Anything else in curly
braces is left exactly as typed — a token nobody defined is not silently eaten.

| Token | Fills in | Empty when |
|---|---|---|
| `{name}` | the customer's first name | a guest checkout with no name |
| `{order}` | `R-100042` | not an order letter |
| `{total}` | `95 €` — the order or cart total; in `order-refunded` it is **what actually went back**, which on a partial refund is not the order's total | not an order/cart letter |
| `{track}` | the tracking code | not `order-shipped`, or no code yet |
| `{code}` | the promo code (`birthday`) or the sign-in code (`login-code`) | elsewhere |
| `{product}` | the product's brand + name | not `back-in-stock` |
| `{shop}` | `Rempire` | never |

One more token, `{percent}`, is substituted but deliberately **not** offered as
a chip: the birthday letter's *default* intro carries it, because the discount
is a shop setting (`settings.flows.birthdayPercent`) and has to stay live. An
owner who keeps it in his own wording keeps that; one who types `15` instead
owns the number from then on.

### Escaping and limits

The owner types **text, never markup**. `<b>x</b>` in a subject is `<b>x</b>`
in the inbox, and in the body it is escaped (`&lt;b&gt;`), never rendered. That
is enforced at render time (`mailTextHtml()`), not only on save — the same
"first door, not the only one" rule the other validated settings follow. A
newline in the intro becomes a `<br>` in the HTML part and stays a newline in
the plain-text one.

`cleanMailTexts()` runs on every write through the settings route: unknown
letters, unknown languages and unknown fields are dropped, control characters
stripped, subjects and closing lines collapsed onto one line, and the strings
clamped to **200 / 1500 / 300** characters. An empty string is dropped rather
than stored.

### One function, so the preview cannot lie

Everything that renders a letter loads the setting first, through the same
`loadMailTexts()`:

- `src/lib/mail-hooks.ts` (`order-confirmed`, `order-shipped`) — inside the
  `loadBrand()` it already ran, off the one settings query;
- `src/lib/flows.ts` — at the top of each of the three flow runs;
- `src/app/api/account/code/route.ts` — before the sign-in code goes out;
- `src/app/api/admin/mail/preview/` and `…/test/` — the admin iframe and the
  «отправить тест» sample.

So the preview is not an approximation of the letter, it is the letter. The
editor's own feed is `GET /api/admin/mail/preview/?format=texts` → defaults,
placeholders, caps and whatever is saved, in one call.

Two cosmetic differences from the pre-editor copy, both invisible in a mail
client: the order number in the intro is no longer bold (owner copy is escaped,
so no letter's text may carry markup), and the two `&nbsp;` that held
«№ 100042» and «15 %» together are plain spaces — an invisible character in a
field the owner types into is a trap worth more than the non-breaking space.

## Previewing and test-sending

**In the admin** (`/shop2/admin/` → «Маркетинг» → «Письма»): the tab is a list
of the letters the shop sends by itself — the three account flows carry a
switch, the transactional three say «всегда». Opening one opens its editor:
the three fields on the left, the letter as the customer will see it on the
right (redrawn from the draft as it is typed, placeholders filled in), the
«Язык письма» strip above them, and the full server render in an iframe under
both, with the test-address box beside «Отправить мне тест». The preview is
demo data — a made-up order — so nothing real ever leaves the browser.

**Which language the editor opens on.** The one it was closed in. It is a
property of the letter, never of the panel: an English panel used to put the
English letter under the owner's hands without saying so, which is the trap
`docs/audit/2026-09-07-blog-language.md` is about, and the fix for that made
it always Russian — one language too few for an owner who spends an evening
on the Estonian letters (Dim, 08.09.2026). So `S.mailLang` is remembered per
machine, in the panel's own preferences key (`rempire-admin-panes`,
`admPanesLoad()`/`admPanesSave()` in `public/shop2/app.js` — the same object
that remembers which side panes are folded), and is Russian until there is
one to remember. Each tab of the strip still says what its version holds
(«свой текст» / «стандартный текст»), so the answer is on screen either way.

**By URL** (demo data, no login needed — it is the admin iframe's source):

```
/api/admin/mail/preview/?template=order-confirmed&lang=ET
/api/admin/mail/preview/?template=birthday&lang=EN&format=text
/api/admin/mail/preview/?template=order-shipped&lang=RU&format=json
```

**Test send** — admin cookie required, 20 per IP per hour, subject prefixed
`[test]` so a sample confirmation is never mistaken for a real order:

```bash
curl -X POST https://<host>/api/admin/mail/test/ \
  -H 'content-type: application/json' \
  -b 'rmp_admin=<session cookie>' \
  -d '{"template":"order-confirmed","to":"you@example.com","lang":"RU"}'
```

Answers: `{ ok: true, id }`, or `{ ok:false, error }` — `no_api_key` (503) when
`RESEND_API_KEY` is unset, `bad_email`, `unknown_template`, `rate_limited`,
`unauthorized`.

**Before the shop opens**, send one of each to a Gmail address, an Outlook.com
address and an iPhone, with the phone in dark mode. That is the only way to
catch a client-specific rendering problem, and it takes five minutes.

## Tests

```bash
npm test                      # everything
npx vitest run tests/emails.test.ts tests/emails-compat.test.ts tests/mail.test.ts tests/mail-hooks.test.ts
```

Covered: all five templates × three languages (key strings, per-language
subject, absolute URLs, no `undefined`/`NaN`/`[object Object]` anywhere, HTML
escaping of customer text), real and half-empty order rows, `sendMail` against
a mocked fetch (success, 5xx retry, network retry, no retry on 4xx, missing key
⇒ skipped, no recipient ⇒ skipped, tag sanitising), and the three hooks
including "does not throw on a garbage order".

## Notes and limits

- The free Resend tier is 3 000 mails a month, 100 a day. Five order letters
  per order plus the three flows is nowhere near that at 3–5 orders a month.
- Tags (`template`, `lang`, `stage`, `mode`) are attached to every send, so
  Resend's dashboard can be filtered by letter type.
- **Attachments.** `sendMail({ attachments: [{ filename, content, contentType }] })`
  sends files inline as base64 in the same POST as the HTML — Resend's own
  shape, no signed URL to expire. One letter uses it: «Подарочная карта»
  carries the printable A5 card (`src/lib/giftcard-pdf.ts`, ~25 KB, docs/features.md
  § «Сама карта — PDF»). A file that cannot be produced costs the letter its
  attachment and nothing else — the code is in the body, and the letter also
  links a route that renders the card on demand. Oversized entries are dropped
  with a warning rather than sent. The e2e sink records attachment **names**,
  never the bytes — the same rule as the body.
- No mail is logged to the database. If a delivery log is ever needed, that is
  a `040_*.sql` migration (the mail range is 040–049) and a `mail_log` table —
  deliberately not built yet.
- The three flow letters (`abandoned-cart`, `back-in-stock`, `birthday`) now
  have senders, storage and a scheduler, and the admin toggles drive them for
  real — see **docs/flows.md**. `back-in-stock` fires from the admin's own
  stock switch; the other two from `GET /api/cron/flows` (env `CRON_SECRET`).
  All three are **off** until the owner turns them on.
- A sixth renderer, `login-code`, was added with the customer account
  (docs/flows.md). It is a service letter — no unsubscribe link — and it shows
  up in the admin preview like the rest.
- Three more came with the refund work of 07.09.2026: `order-unpaid`,
  `order-cancelled` and `order-refunded`. The last two are one renderer
  (`src/emails/order-cancelled.ts`) with two openings and two editable
  texts, because to the customer they are two different pieces of news.
  All three are service letters — no unsubscribe link — and all three show
  in «Письма» with their own preview. `order-unpaid` is the only one
  behind a switch (`settings.flows.unpaid`), because it is the only one
  the shop sends on a timer rather than because something happened; the
  same switch also turns on the automatic cancellation that follows it,
  and its two intervals live in «Письма → Неоплаченные заказы»
  (`unpaidRemindDays` / `unpaidCancelDays`, docs/flows.md).
- A seventh, `partner-welcome`, came with «+ Партнёр» in the admin
  (docs/loyalty.md): a service letter too, sent once per customer per day at
  most (the Resend idempotency key is the address plus the date), only when
  the tier really flips retail → pro, in the customer's own language.
