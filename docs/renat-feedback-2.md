# Renat feedback — round 2 (31.08.2026)

Eleven items from Telegram. 1–6 are UI changes, built into a parallel shop at
**`/shop2/`** so old and new can be compared side by side (`/shop/` untouched).
7–11 are research / infrastructure — answered below with next actions.

| # | Item | Status | Where |
|---|------|--------|-------|
| 1 | Safari address-bar gap over navbar | ✅ built | /shop2/ |
| 2 | Subcategories under categories | ✅ built | /shop2/ |
| 3 | Remove hero dots | ✅ built | /shop2/ |
| 4 | Brand strip under hero (D-urban style) | ✅ built | /shop2/ |
| 5 | Compact collapsible footer | ✅ built | /shop2/ |
| 6 | Hero colour extends into nav, hover → white | ✅ built | /shop2/ |
| 7 | His real DPD flow (manual labels) | 📋 answered | below |
| 8 | DPD / Omniva / SmartPosti APIs | 📋 answered, needs his accounts | below |
| 9 | Domain: Shopify → Cloudflare | 📋 answered, 2 paths | below |
| 10 | Email @rempireshop.com | 📋 answered, needs decision | below |
| 11 | Google Search Console | 📋 answered, 5-min job | below |

---

## 1. Safari address bar leaves a gap over the navbar

**What's happening:** iOS Safari collapses its address bar while you scroll.
During the gesture the bar turns translucent and the strip above our sticky
header shows whatever is behind it — nothing, which reads as a hole. This is
Safari behaviour, not a bug in the page; it can't be removed, only masked.

**Built (v2):** the header now *bleeds* its own background one viewport
upward (`.hdr::before`), so the exposed strip is header-coloured instead of
empty. Combined with #6 the bleed follows the header's colour — beige over
the hero, white everywhere else.

## 2. Subcategories

**Built (v2):** a second scrollable chip row under the category title —
**not a dropdown**: the category bar already scrolls sideways on a phone, and
a dropdown hanging off a moving bar is the awkwardness Renat sensed.
Chips carry live counts and only appear when the data can fill them:

- Уход за волосами → Шампуни (8) · Кондиционеры (3) · Маски и уход · Спреи
- Стайлинг → Пасты и воски · Гели · Пудры
- Борода → Масла (5) · Бальзамы (5) · После бритья · Гели
- Лицо → Тоники (4) · Очищение · Кремы и сыворотки · Масла

Derived from product names for the prototype; on migration these become real
fields Renat can edit in the admin.

## 3. Hero dots — removed (v2)

Arrows, swipe and auto-rotation stay.

## 4. Brand strip like D-urban (v2)

One scrollable line directly under the hero: grey Oswald wordmarks (logos
where the brand has one) that ink up on hover, every item opening the brand
page. The old «Бренды» grid section is **removed from the home page**
(that's the "remove from the bottom" — it sat mid-page). The «Бренды» nav
item and /brands page stay.

## 5. Footer compact (v2)

Seven collapsed sections, exactly his list: **Доставка · Оплата · Самовывоз ·
Реквизиты · Связаться · Покупателю · Правовое.** Closed by default; two
columns on desktop, one on phone. Pay logos moved inside «Оплата»; the bottom
line keeps only © + «Админка — демо». The duplicate «Магазин в Таллинне»
block on the home page is gone — the footer carries it now.

## 6. Hero colour into the nav, hover whitens (na-kd) (v2)

Over the hero the header is the hero's beige (`--shell`); mouse over it →
white; scroll past the hero (or open any other screen) → white. One
transition, and the Safari bleed from #1 inherits whichever colour is active.

---

## 7. His real DPD flow

The app on his bill (17,22 €/мес) is **Parcely.app** — yet he told us he
still creates labels **manually on DPD's site**, and DPD invoices the labels
monthly at contract rates. So today he pays for a label app he doesn't use.

**Next action:** confirm with him what Parcely actually does for him (if
anything). After migration it's cancelled either way — labels are part of our
shipping block. That's −17 €/мес off his bill, on top of the comparison.

## 8. Carrier APIs (labels, tracking) — «Uuri API võimekust»

All three carriers have label + tracking APIs. They are **free**; what's
needed is a business-client contract with each carrier and API credentials
issued on that contract. Label cost = his contract price list (the same one
DPD already invoices monthly) — the API changes workflow, not pricing.

| Carrier | What exists | How to get access |
|---|---|---|
| **DPD EE** | Shipment API: create parcel, get label PDF, manifest, tracking | He already has a DPD contract (they invoice him). Ask his DPD account manager for **API credentials** (username/password for the integration API) |
| **Omniva** | Parcel API (XML/JSON): registration, label PDF, manifest; public tracking endpoint | Business client contract → klienditugi issues partner code + API password |
| **SmartPosti (Itella EE)** | SmartShip / Posti API: shipments, labels, parcel-machine list, tracking | Account manager issues API key on the business account |

**Next action (Renat):** one email/call per carrier — "prošu API-doступ к
моему договору для интеграции интернет-магазина". DPD first (contract
exists). We already ship their real parcel-machine lists and 2025–26 price
lists in the prototype, so the integration slots straight in.

## 9. Domain: Shopify → Cloudflare

Two paths; do the fast one first.

**Fast (recommended now): keep the registrar, move DNS.**
Shopify admin → Settings → Domains → rempireshop.com → change
**nameservers** to Cloudflare (free plan gives DNS + proxy). ~15 minutes of
work, propagation up to a day, the Shopify shop keeps working (we recreate
its A/CNAME records in Cloudflare first). From then on *we* control DNS:
email records, GSC verification, the future switch to the new shop — all
without touching Shopify again.

**Full (later, optional): transfer the registration.**
Shopify domains are registered through their partner (OpenSRS/Tucows).
Sequence: Shopify admin → Domains → **unlock** → get the **EPP/auth code**
→ **disable DNSSEC** (his point — correct) → start the transfer at
Cloudflare Registrar (at-cost, ~10 €/yr) → confirm the email → 5–7 days.
Blocked if the domain was registered/transferred in the last 60 days.
Zone.ee works the same way if he prefers everything beside rempire.ee.

**Next action:** ask Renat for collaborator access to Shopify (Settings →
Users) — the nameserver change is done from there, he types, no passwords.

## 10. Email on the domain instead of @gmail.com

Today mail goes to rempireshopinfo@gmail.com. Once DNS is on Cloudflare (#9),
two options:

- **A. Cloudflare Email Routing — free.** info@rempireshop.com forwards to
  the existing Gmail. Receiving only; replies still leave from @gmail.com
  unless we add a send-as SMTP. Zero cost, 10 minutes.
- **B. Google Workspace, 1 mailbox ≈ 7 €/мес.** Real
  info@rempireshop.com in the Gmail interface he already lives in — send and
  receive. This is the professional answer.

Order confirmations and shop emails are separate either way — they go out
via our transactional sender (e.g. Resend) as zakaz@rempireshop.com once we
hold DNS.

**Next action:** Renat picks A (free, receive-only) or B (7 €/мес, full).
Recommend B.

## 11. Google Search Console

No need to touch Shopify's theme at all. Verify a **Domain property** with a
**DNS TXT record** — works no matter where the site is hosted:

1. GSC → Add property → *Domain* → rempireshop.com → copy the TXT value.
2. Add the TXT record where DNS lives — today Shopify admin → Domains →
   DNS settings; after #9, Cloudflare.
3. Verify. Done — and the property survives the migration to the new shop,
   which is exactly what we want for watching the 301s land.

The HTML-tag method (paste into `theme.liquid`) also works on Shopify, but
the DNS route is cleaner and permanent. **After #9 this is a 5-minute job we
do ourselves.**

---

## Compare

- Current: https://rempireshop.diipsolutions.eu/shop/
- Round-2 variant: https://rempireshop.diipsolutions.eu/shop2/
