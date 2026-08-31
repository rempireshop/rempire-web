# Renat feedback — round 2 (31.08.2026)

> **This document lives at `rempire-web/docs/renat-feedback-2.md`** — open it
> in the repo, or ask Claude to send the current version as a file.

Eleven items from Telegram. 1–6 are UI changes, built into a parallel shop at
**`/shop2/`** so old and new can be compared side by side (`/shop/` untouched).
7–11 are research / infrastructure — answered below with next actions.

| # | Item | Status | Where |
|---|------|--------|-------|
| 1 | Safari address-bar gap over navbar | ✅ built | /shop2/ |
| 2 | Subcategories under categories | ✅ built | /shop2/ |
| 3 | Remove hero dots | ✅ built | /shop2/ |
| 4 | Brand strip under hero (D-urban style) | ✅ built, wordmarks only | /shop2/ |
| 5 | Compact collapsible footer | ✅ built, socials bottom-centre | /shop2/ |
| 6 | Hero colour extends into nav, hover → white | ✅ built | /shop2/ |
| 7 | His real DPD flow (manual labels) | 📋 answered | below |
| 8 | DPD / Omniva / SmartPosti APIs | 📋 answered, needs his accounts | below |
| 9 | Domain: Shopify → Cloudflare | 📋 answered, 2 paths | below |
| 10 | Email @rempireshop.com | ✅ decided: Resend + send-as | below |
| 11 | Google Search Console | 📋 exact clicks below | below |
| 12 | Montonio vs Stripe at 5 orders/мес | 📋 stay on Stripe for launch | below |

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

One scrollable line directly under the hero — **wordmarks only, no logos**,
exactly the register of the urban sample: grey Oswald caps that ink up on
hover, every item opening the brand page. The old «Бренды» grid section is **removed from the home page**
(that's the "remove from the bottom" — it sat mid-page). The «Бренды» nav
item and /brands page stay.

## 5. Footer compact (v2)

Seven collapsed sections, exactly his list: **Доставка · Оплата · Самовывоз ·
Реквизиты · Связаться · Покупателю · Правовое.** Closed by default; two
columns on desktop, one on phone. Pay logos moved inside «Оплата»; **socials
sit alone, centred, above the signature line** (out of «Связаться»); the
bottom line keeps only © + «Админка — демо». The duplicate «Магазин в Таллинне»
block on the home page is gone — the footer carries it now.

## 6. Hero colour into the nav, hover whitens (na-kd) (v2)

Over the hero the header is the hero's beige (`--shell`); mouse over it →
white; scroll past the hero (or open any other screen) → white. One
transition, and the Safari bleed from #1 inherits whichever colour is active.

---

## 7. His real DPD flow — confirmed

Parcely.app (17,22 €/мес) does exactly one thing for him: it shows the
**parcel-machine picker in the Shopify checkout**. Labels and orders he does
by hand on DPD's site; DPD invoices the labels monthly at contract rates.

Our checkout already has the machine picker built in (230 real machines), so
the migration removes Parcely's entire job — **−17,22 €/мес** — and the
carrier APIs (#8) later remove the manual label step too.

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

**Ready-to-send message (Estonian).** Renat forwards this to each carrier —
DPD first, since the contract already exists. Addresses: the account manager
on his DPD invoice; otherwise the general lines — DPD `myyk@dpd.ee`, Omniva
`info@omniva.ee`, SmartPosti `info@smartposti.ee` (check the address on the
carrier's own site before sending — these change).

> Tere!
>
> Olen Rempire Store OÜ (klient/lepingu nr: …). Kolime oma e-poe uuele
> platvormile ja soovime pakisildid ja jälgimise otse süsteemist API kaudu
> teha (praegu trükime sildid käsitsi teie lehel).
>
> Palun saatke:
> 1) API dokumentatsioon ja juurdepääsu tingimused,
> 2) API kasutajatunnused meie lepingu jaoks,
> 3) kinnitus, et API kasutamine ei muuda meie lepingu hinnakirja.
>
> Tehniline kontakt: Dmitri (Diip Solutions), dim.novare@gmail.com.
>
> Lugupidamisega, Renat · Rempire Store OÜ · +372 56237237

The APIs themselves are free; label prices stay whatever his contract says.

## 9. Domain: Shopify → Cloudflare — in parallel, without touching the shop

**Yes, all of this runs in parallel.** Nothing here moves the shop: DNS keeps
pointing at Shopify until the day we change two records. The launch switch
later is exactly that — edit A/CNAME, keep everything else.

**Step 0 — find out what kind of domain it is (2 minutes, needs access).**
Shopify admin → **Settings → Domains** → rempireshop.com. Two possibilities:

- It says **"Managed by Shopify"** → the domain was bought through Shopify.
  Shopify-managed domains **do not allow changing nameservers**, but they DO
  allow editing DNS records (Settings → Domains → the domain → *Domain
  settings* → **Edit DNS settings**: A, CNAME, MX, TXT). That's enough for
  everything below (GSC, Resend, mail) — done right inside Shopify, shop
  untouched. Cloudflare then comes via a full **registrar transfer** when we
  are ready: unlock → EPP/auth code → DNSSEC off → start transfer at
  Cloudflare Registrar (~10 €/yr) → 5–7 days. No downtime if DNS records are
  recreated first.
- It says **"Third-party domain"** (bought elsewhere, e.g. zone.ee, just
  connected to Shopify) → the registrar is outside Shopify. Then we can
  change **nameservers to Cloudflare today** at that registrar: add the
  domain in Cloudflare (free plan) → Cloudflare scans and copies existing
  records (verify the Shopify A `23.227.38.65` / CNAME `shops.myshopify.com`
  came across) → set the two Cloudflare nameservers at the registrar → done.
  Shop keeps working; we hold DNS from then on.

**Access to ask from Renat (no passwords):** Shopify → Settings → Users →
*Add collaborator* → dim.novare@gmail.com with the **Domains** permission (or
screen-share and he clicks). With that we do #9, #10, #11 ourselves.

## 10. Email @rempireshop.com — decided: Resend + Gmail «send as»

Same setup as Dmitri's own pages. Runs entirely on DNS records, so it works
in parallel with the old shop (see #9 for where records get edited).

**Outgoing (send as info@rempireshop.com from his Gmail):**
1. Resend → Domains → Add `rempireshop.com` → it gives 3 records
   (SPF TXT + two DKIM). Add them wherever DNS lives (#9). Verify.
2. Gmail (rempireshopinfo@gmail.com) → Settings → Accounts → **Send mail
   as** → Add: `info@rempireshop.com` → SMTP server `smtp.resend.com`,
   port 465 (SSL), username `resend`, password = a Resend API key.
3. Confirm the verification mail, tick "reply from the same address".

**Incoming (mail TO info@rempireshop.com):** needs a forwarder, since Resend
send-as covers only outgoing. Free MX forwarder (ImprovMX or
forward-email) → forwards to the Gmail; or once the domain is on Cloudflare,
its built-in Email Routing does this natively. Either is a 10-minute DNS job.

**Shop emails** (order confirmations, «отправлен» with tracking) go out via
Resend from our side regardless — same domain verification serves both.

Cost: 0 €/мес (Resend free tier covers this volume many times over).

## 11. Google Search Console — exact clicks

Use a **Domain property** verified by DNS TXT: it needs no Shopify theme
edits, covers www/non-www/http/https at once, and survives the migration —
the same property will show the 301s landing later. Steps:

1. https://search.google.com/search-console → property dropdown → **Add
   property** → left card **Domain** → enter `rempireshop.com` → Continue.
2. It shows a TXT value like `google-site-verification=abc123…` → Copy.
3. Where DNS lives (see #9): Shopify admin → Settings → Domains →
   rempireshop.com → Domain settings → **Edit DNS settings** → Add custom
   record → **TXT** → Name `@`, Value = the copied string → Save.
   (After the move to Cloudflare: same record in Cloudflare → DNS.)
4. Back in GSC → **Verify**. DNS can take up to an hour; retry if it fails
   the first time.
5. Then GSC → Settings → **Users and permissions** → Add user →
   `dim.novare@gmail.com` as **Owner**, so we watch it without his login.

With collaborator access from #9 we do all five steps; without it, it's a
10-minute screen-share where Renat clicks.

## 12. Payments math — Montonio's monthly fee vs 5 orders/month

His today: Stripe, no monthly fee, ~1,5 % + 0,25 € per card. Last month:
**5 orders**. Current prices ([Montonio](https://www.montonio.com/pricing),
[MakeCommerce](https://maksekeskus.ee/hinnad/)):

| | Monthly | Bank link | Cards |
|---|---|---|---|
| Stripe (has it) | 0 € | — (no EE bank links) | ~1,5 % + 0,25 € |
| Montonio Standard | **11,99 €** | 0,15 €/шт | 1,49 % + 0,20 € |
| MakeCommerce | 0 € | 2,5 % + 0,30 € (promo 1 % + 0,15 €) | ~similar |

At 5 orders × 40 €: Stripe costs ~4,25 €/мес all-in. Montonio would cost
11,99 € + pennies — **more than double, for nothing**. The bank-link saving
(~0,70 €/order vs a card) only overtakes Montonio's fee at roughly
**17–20 orders/month**; below that the subscription eats the saving.

**Resolved (31.08, from Renat):** the web shop runs **Shopify Payments**,
and the salon "Stripe" is the **same Shopify Payments** — he enters/attaches
the card in Shopify POS and it processes through it. Which means:

- **There is no portable payment account.** Shopify Payments is Shopify's
  own processor (Stripe infrastructure, not his account); both the web
  payments **and the salon till** end the day Shopify closes.
- **The till is therefore part of the migration scope** — new item, nobody
  had it on the list. At the switch the salon needs a replacement for
  taking cards in person. Options, all without monthly fees:
  - **SumUp** — a ~30–40 € reader, ~1,95 %/tx, no subscription; works
    standalone, five-minute setup. The boring safe answer.
  - **MakeCommerce POS app** — card taking on a smartphone, 1,5 % + 0,05 €,
    no fixed cost ([source](https://maksekeskus.ee/hinnad/)); pairs
    naturally if MakeCommerce later takes the web bank links too.
  - **Our own till screen** («продажа на месте», already in the second
    wave) handles the *inventory* side — one stock for salon and web — and
    pairs with either reader above for the card itself.

**Recommendation:**
- **Web: open a fresh Stripe account** — self-service, same-day, zero
  monthly, cards + Apple/Google Pay day one. Our checkout's payment step
  doesn't care which provider sits behind it, so a later move to
  MakeCommerce/Montonio for bank links stays open.
- **Salon: pick the reader before the switch date** (SumUp or MakeCommerce
  app), so the till never has a gap. Cost of the whole answer: one-time
  reader ~30–40 €, no subscriptions.
- **Add bank links when orders justify it**: MakeCommerce first if its promo
  rate applies (no monthly — safe at any volume), Montonio once he's
  steadily past ~20 orders/month.
- Growth is the goal of the new shop, so revisit this line in the first
  monthly report — the checkout is built so the provider can swap without
  the shopper noticing.

Sources: [Montonio pricing](https://www.montonio.com/pricing),
[Maksekeskus hinnad](https://maksekeskus.ee/hinnad/),
[comparison](https://celeht.com/comprehensive-comparison-of-e-commerce-payment-solutions-pricing/).

---

## How we proceed — design first, then the plumbing

**Phase 1 — freeze the design (now).**
1. Renat reviews **/shop2/** against **/shop/** — phone and desktop; comments
   via the 💬 bubble or Telegram.
2. Agreed changes get folded into the main shop; /shop2/ retires. Anything
   rejected reverts — that's what the parallel copy is for.
3. One message from Renat: «дизайн ок» = design frozen. After this, visual
   changes are change requests, not the project.

**Phase 2 — access + parallel groundwork (nothing moves, runs while Phase 1
is still open).**
4. Shopify **collaborator invite** → dim.novare@gmail.com (Settings → Users;
   Domains + Payments permissions). This unblocks everything below.
5. Look at Settings → Domains → is the domain Shopify-managed or
   third-party (#9) → pick the DNS route.
6. GSC Domain property via DNS TXT (#11) + add Dmitri as owner.
7. Resend domain verification + Gmail send-as (#10); free MX forwarder for
   incoming.
8. Renat sends the carrier API email (#8), DPD first.
9. ~~Check what Settings → Payments says~~ — resolved: Shopify Payments on
   both web and POS, nothing portable (#12). Open a fresh Stripe account
   (can happen any time, 1 day) and pick the salon reader before Phase 4.

**Phase 3 — build v1 (after the freeze).**
10. Real orders (DB, numbers, statuses, emails) · checkout wired to Stripe ·
    real content from the Shopify export (texts, INCI, prices, photos) ·
    legal pages · three languages. Timeline per the meeting brief: ~5–8
    weeks full-time equivalent.

**Phase 4 — the switch (one evening, reversible).**
11. Final content sync → repoint the domain's A/CNAME to the new shop →
    301 redirects live → watch GSC. Shopify subscription stays paid one
    more month as the fallback, then closes — Parcely closes with it, and
    the salon switches to its new reader the same day (#12).


---

## Compare

- Current: https://rempireshop.diipsolutions.eu/shop/
- Round-2 variant: https://rempireshop.diipsolutions.eu/shop2/
