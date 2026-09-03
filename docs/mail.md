# Customer e-mail — Resend, five templates, three languages

Everything the shop sends to a customer goes through one function
(`sendMail`) and one renderer per letter. No SDK: Resend's REST API over
`fetch`, the same way `src/lib/notify.ts` already forwards to Telegram and to
Dmitri.

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
| `src/emails/*.ts` | the five renderers → `{ subject, html, text }` |
| `src/emails/layout.ts` | shared shell, palette, dark-mode CSS, money/URL helpers |
| `src/emails/common.ts` | customer name, item table, delivery line, totals |
| `src/emails/index.ts` | template registry + demo data for the preview |
| `src/app/api/admin/mail/preview/route.ts` | `GET` — HTML for the admin iframe |
| `src/app/api/admin/mail/test/route.ts` | `POST` — send a sample (admin only) |
| `public/shop/emails/*.html` | **design source of truth**, hand-made, keep |
| `tests/emails.test.ts`, `tests/mail.test.ts`, `tests/mail-hooks.test.ts` | `npm test` |

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

## Creating the Resend API key (Dmitri)

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

Each returns `{ ok, skipped?, reason?, id?, notified? }`. Callers may ignore it.
Sends carry an idempotency key derived from the order number, so a payment
webhook delivered twice does not send the letter twice.

The order shape is `db/migrations/001_core.sql` / `mapOrder()` in
`src/lib/orders.ts`. Both the snake_case row and the camelCase mapped object
are accepted, and every field is optional: a guest checkout with no name, no
variant and a jsonb address still renders a correct letter.

## The five letters

| id | Renderer | Kind |
|---|---|---|
| `order-confirmed` | `renderOrderConfirmed(order, lang)` | service |
| `order-shipped` | `renderOrderShipped(order, lang, tracking)` | service |
| `abandoned-cart` | `renderAbandonedCart(cart, lang, resumeUrl)` | marketing — unsubscribe link |
| `back-in-stock` | `renderBackInStock(product, lang)` | marketing — unsubscribe link |
| `birthday` | `renderBirthday(customer, lang, code)` | marketing — unsubscribe link |
| `login-code` | `renderLoginCode(code, lang, {minutes})` | service — the account sign-in code (docs/flows.md) |

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

## Previewing and test-sending

**In the admin** (`/shop2/admin/` → «Письма»): the card «Письма — предпросмотр
и тест» has a chip per template, a pill per language, a live preview iframe and
an address box. The preview is demo data — a made-up order — so nothing real
ever leaves the browser.

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
npx vitest run tests/emails.test.ts tests/mail.test.ts tests/mail-hooks.test.ts
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
