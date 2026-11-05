# REMPIRE — accounts and services registry

*This file says which outside account does what for the shop, who owns it,
who pays for it, and how to sign in. It was started 03.09.2026 and
**refreshed 05.11.2026** for the handover to Renat on 08.11.2026. The
handover checklist is `src/data/golive.json` (rows `ho-*`, shown at
`/handover` on Dim's host).*

**Related files.**

- Environment variable names and what each one does: `README.md` (the one
  canonical list; values are never written down).
- What to do when a service fails: `docs/RUNBOOK.md`.
- Renat's own plain-Russian list of the same services:
  `docs/renat-services.md`. It still says Vercel is free; see the Vercel row
  below.

## Rules

- **No passwords, 2FA secrets, API keys or recovery codes in this file or in
  the repository.**
  - They go on the **login sheet**. Dim fills it in by hand on his own
    computer and gives it to Renat in person (`ho-logins-sheet`).
  - There is no shared password manager (Bitwarden was dropped on 25.10).
- **One identity.** Almost every service is registered on, or signed into
  through, the shop's Google account **rempireshopinfo@gmail.com**.
  - The recovery address is blackboxestonia@gmail.com (Renat's personal).
  - Two-step verification has been on since 02.11.2026. Keep it on: Google
    Cloud refuses entry without it.
  - GitHub user `rempireshop` is the sign-in for Vercel and Railway.
- **The business owns everything.**
  - The company is **Rempire Store OÜ** (reg. 12216136, KMKR EE102723858).
  - The domain's registrant is **THEFLOW OÜ**, which is 100 % Renat's
    company.
  - Dim keeps member or collaborator access for paid support only: no
    ownership, no cards (`ho-access-trim`).

## Registry

«Owner» is the account that owns the service. «Pays» is whose card or
account is billed. The card plan is described below the table.

| Service | What it does for the shop | Sign-in | Owner | Pays | Cost | Dim after 08.11 |
|---|---|---|---|---|---|---|
| **Google account** rempireshopinfo@gmail.com | Identity for the services below; the shop's mailbox (info@ and shop@ forward here) | password + 2FA on Renat's phone | Renat | — | free | none; only through the services he is a member of |
| **Zone.ee** (my.zone.eu) | Registrar for `rempireshop.com`; paid to **31.05.2027**, renewed yearly | blackboxestonia@gmail.com (THEFLOW's own Zone account; the Diip Solutions account has shared access) | THEFLOW OÜ (Renat) | Renat, when the yearly bill comes | yearly fee (amount not recorded here) | partner or user for support (`ho-zone-registrant`) |
| **Cloudflare** | DNS for `rempireshop.com` (nameservers `albert` / `april.ns.cloudflare.com`), Email Routing (info@, shop@ → the shop Gmail), R2 bucket `rempire-media` (photos, at `img.rempireshop.com`) | rempireshopinfo@ | the shop | **Dim's card today → company card at the meeting** (R2 needs a card even at 0 €) | 0 € (Free plan; R2 within the free 10 GB) | member |
| **Vercel** team «Rempire», project `rempire-web` | Hosting: the site, 104 API routes, two crons, builds of branch `production`, the deploy hook | GitHub `rempireshop` | the shop | not recorded (Dim moved the team to Pro on 03.11) — open question 1 | **Pro $20 / month since 03.11.2026**; back to Hobby (free) when usage allows (RUNBOOK §6) | see «Dim's access» below |
| **Railway** | The Postgres 18 database, and nothing else (EU West) | GitHub `rempireshop` | the shop | **Dim's card today → company card at the meeting** | Hobby, ~$6 / month (02.10 bill: $6.20) | member if the plan allows; otherwise none. Backups do not need it (GitHub secret) |
| **GitHub** user `rempireshop` | Repositories `rempire-web` (the shop) and `rempire-api` (open question 7); Actions: CI, promote, smoke, backups | rempireshopinfo@ | the shop | — | free; the repo goes **private on 08.11**, and CI fits the free private minutes | `dimnovare` stays a collaborator (push) |
| **Resend** | All e-mail from `@rempireshop.com` (region eu-west-1, Ireland) | rempireshopinfo@ | the shop | — | free tier: 100 / day, 3 000 / month | member |
| **Montonio** | Payments (bank links, cards, wallets), refunds, parcel labels, pickup points; live keys | Renat's own login | Rempire Store OÜ | Renat (contract) | per contract | technical contact, if Renat wants |
| **OpenAI API** (platform.openai.com) | Shop chat, panel assistant, AI texts, AI search, photo cut-out, build-time search cards | rempireshopinfo@ | the shop | the shop's account (funded 08.10); whose card funded it is still to check (`ho-openai`) | cents a day; set a monthly limit of ~$10 | member, if useful |
| **OpenAI Ads** (ads.openai.com, beta) | Test campaign «REMPIRE campaign», serving since 05.11 ~11:30; clicks; 25 countries | rempireshopinfo@ | the shop | **Mastercard …0731: Dim's card today → company card at the meeting** | €65 for the whole campaign (the platform minimum); charged at €3 or on 30.11 | none needed |
| **Google Search Console** `sc-domain:rempireshop.com` | Indexing, search figures in «Аналитика» (via service account `gsc-reader@rempire-shop.iam.gserviceaccount.com`) | rempireshopinfo@ | the shop | — | free | user; Dim's own owner verification should become a «Full user» |
| **Google Merchant Center** 5819586565 | Reads `/feed/google-en.xml` and `/feed/google-ru.xml` daily; free listings; returns policy (24 EU countries, 30 days) | rempireshopinfo@ | the shop | — | free | user |
| **Google Ads** «Rempire Shop» 892-756-4570 | Test campaign «Test Shopping EE», 25.10–15.11.2026, Shopping, 25 countries since 05.11 | rempireshopinfo@ | the shop | **Mastercard …0731: Dim's card today → company card at the meeting**; billed after the ads run | ≤ €20 for the test; after 15.11 Renat decides | user (Standard), if Renat continues |
| **Google Cloud** project «Rempire shop» (`rempire-shop`) | Google Auth Platform for customers' «Продолжить с Google» (live 02.11; web client «REMPIRE shop login»); the GSC service account | rempireshopinfo@ (2SV required) | the shop | — | free | IAM member, if needed; **never delete the project** |
| **Google Business Profile** | The salon on Maps | rempireshopinfo@ | Renat | — | free | none. The shop's local-inventory feed stays off until `settings.gbp_store_code` is set. |
| **Bing Webmaster Tools** | Bing indexing; IndexNow pings from the shop need no account | rempireshopinfo@ | the shop | — | free | user |
| **Telegram bot** @rempireshop_bot | «New order» pings to the owner's chat | Renat (BotFather) | Renat | — | free | none |
| **Claude connector «Rempire»** (`https://rempireshop.com/api/mcp`) | Renat's own Claude edits texts, names, prices, stock and page texts (`docs/claude-connector.md`) | the panel password | the shop | Renat (his own Claude plan) | — | Dim's connection ends when the panel password changes |
| **Web Push** (VAPID) | Order pings to the owner's phone and computer | keys in Vercel only | the shop | — | free | — |
| **Pinterest** | Domain verification tag only (`PINTEREST_DOMAIN_VERIFY`) | — | Renat | — | free | — |
| **Stripe** | Card payments of the old Shopify shop | Renat's | Renat | — | no monthly fee | none. Close around the end of January 2027, after the dispute window (`ho-stripe`). |
| **Shopify** (legacy) | The old shop | Renat's | Renat | — | was ~46 € / month | **closed 29.10.2026**; orders and customers exported first |
| **Vercel Blob** `rempire-qa` (on Diip's team, not the shop's) | Questionnaire answers from the prototype days; unused since 07.09 | Dim | Diip | — | free | Dim deletes it (`ho-blob-cleanup`) |
| **rempireshop.diipsolutions.eu** | Dim's own host on the same Vercel project: `/handover`, the panel and the API; every shop page 301s to rempireshop.com | Dim's DNS (diipsolutions.eu) | Dim | — | — | open question 6 |

### The card plan

- **Moves to Renat's company card at the handover meeting.** Railway,
  Cloudflare, Google Ads and OpenAI Ads are on Dim's card today (Google Ads
  and OpenAI Ads share Mastercard …0731).
  - Railway first: a failed payment stops the database, and with it the
    shop.
  - `golive.json` rows `ho-google-ads` and `ho-openai-ads` still call card
    …0731 Renat's. Correct them.
- **Not recorded yet:** Vercel Pro (open question 1) and the card that funds
  the OpenAI API (`ho-openai`).
- **Renat's already:** Montonio, Stripe and the domain renewal.

### Monthly costs (from the handover notes, 05.11.2026)

| Item | Cost |
|---|---|
| Vercel | $20 / month while on Pro; 0 on Hobby |
| Railway | ~$6 / month |
| OpenAI API | cents a day |
| Montonio | per contract |
| Domain (Zone.ee) | once a year |
| Google Ads | test only, ≤ €20 until 15.11, then Renat's decision |
| OpenAI Ads | €65 once for the test campaign |
| Resend, Cloudflare, GitHub, Google tools, Bing, Telegram | free |
| Shopify | 0 since 29.10 (was ~46 € / month) |

## Dim's access after the handover

The rule (`ho-access-trim`, `ho-members`): the shop's account owns every
service; Dim stays only where support needs him, as a member or
collaborator, with no ownership and no cards on file.

| Where | Dim's access | Note |
|---|---|---|
| GitHub `rempire-web` | collaborator `dimnovare` (push) | He needs it to push fixes. A collaborator on a personal repository cannot change its settings. Visibility changes need the `rempireshop` account, and GitHub asks for a code e-mailed to rempireshopinfo@ (`ho-github-private`). |
| Vercel | to decide | On Pro, every team member is a paid seat (check current pricing). On Hobby a team has one member. Options: Renat signs in when Dim needs the dashboard, or Dim becomes a paid member. Pushes deploy through GitHub either way. |
| Railway | to decide | Only needed for restores and the CA export. A restore needs a new database, so someone signed in as the shop. |
| Cloudflare, Resend, Search Console, Merchant Center, Google Ads, Google Cloud, Bing | member / user | Check each one at the meeting (`ho-members`). Remove Dim as an *owner* wherever he is one (Search Console). |
| Zone.ee | partner or user, for support | `ho-zone-registrant` |
| Panel `/admin` | none of his own | The panel has one password, Renat's. Dim signs in only when Renat gives him the password for a support task. |
| Alerts | `DEV_ALERT_TO` defaults to info@diipsolutions.eu | Build-watch, backup-watch and hide-watch letters and the Monday content report keep reaching Dim. Keep it for paid support or change it (open question 5). |
| Telegram, Montonio, Stripe | none | Renat's |

## DNS — `rempireshop.com` (Cloudflare)

The nameservers moved from Zone.ee to Cloudflare on 03.09.2026. The source of
truth is Cloudflare → `rempireshop.com` → DNS. **Touch nothing here without a
reason.**

| Type | Name | Points at | For |
|---|---|---|---|
| A | `@` | `76.76.21.21` (DNS only) | Vercel |
| CNAME | `www` | the Vercel value shown in the project (DNS only) | Vercel; `www` redirects to the bare domain |
| CNAME / R2 custom domain | `img` | R2 bucket `rempire-media` | photos (`R2_PUBLIC_BASE`, since 21.09) |
| TXT | `@` | `google-site-verification=…` | Search Console ownership; **never delete** |
| TXT | `resend._domainkey` | DKIM public key | Resend |
| CNAME | `send`, `rsend` | Resend's forge hosts | Resend sending and return path |
| TXT | `_dmarc` | `v=DMARC1; p=none;` | DMARC, monitor only |
| MX ×3, TXT (SPF), DKIM | `@` | written by Cloudflare | Email Routing (info@, shop@ → rempireshopinfo@gmail.com) |

There is deliberately **no** MX for Resend inbound. Adding one would send all
`@rempireshop.com` mail to Resend instead of the Gmail.

## Company invoices — data the owner keeps in the panel

Company invoices («По счёту — для компаний», `docs/payments.md` §10) need no
extra service. They need these fields, filled in the panel:

| Setting | Stored as | Needed for |
|---|---|---|
| «Настройки» → «О компании» → «Реквизиты»: legal name, reg. code, KMKR, address | `settings.content.company` | The seller block on every invoice (Rempire Store OÜ · 12216136 · EE102723858 · Mardi 1, 10145 Tallinn) |
| Same page: **IBAN** and **Банк** | `settings.content.company.iban` / `.bankName` | Payment details on the invoice. Company invoices are paid by transfer, not through Montonio, so this is the account the money lands on. Check it is filled. |
| «Настройки» → «О компании» → «Счета для компаний»: prefix, payment term | `settings.invoice` (default `{prefix:"A-", dueDays:7}`) | Numbers like `A-2026-0001` and the payment term |

The business register's address is Pärnu mk, Paikuse alev, Käärasoo tee 43,
86604. Renat chose Mardi 1 for documents (`docs/RENAT-ANSWERS.md`). Have his
accountant confirm it once.

## Renewals, limits and who hears about them

| What | Limit / renewal | If missed | Who is told |
|---|---|---|---|
| Domain `rempireshop.com` | yearly; paid to **31.05.2027** | site and mail stop | Zone.ee mails the account holder |
| Railway | monthly card payment | the database, and with it checkout and the panel, stops | Railway mails the shop account |
| Database backups | `backup.yml` twice a day; artifacts 30 days | no restore point | a failed run mails the workflow's owner; no backup for 36 h → `DEV_ALERT_TO` (`runBackupWatch`) |
| Vercel | Pro: billed monthly. Hobby: 4 h Fluid Active CPU per 30 days, then the project pauses; 10 GB deployment storage; 4.5 MB per request or response | on Hobby: the shop pauses | Vercel mails the account owner (the shop Gmail). A failed build turns «Promote to production» red, and GitHub mails the pusher. A failed deploy-hook build mails `DEV_ALERT_TO` (`runBuildWatch`). |
| GitHub Actions | free while public; 2 000 minutes / month once private | checks stop; the shop keeps running, but nothing new deploys | GitHub mails the account |
| Resend | 100 / day, 3 000 / month | customer letters stop past the cap; marketing stops first (the shop's own budget) | the owner gets a push or Telegram notice at the daily limit |
| OpenAI API | prepaid credit / monthly limit | AI features fail politely; the shop works | OpenAI mails the account |
| Cloudflare R2 | free 10 GB | uploads stop | Cloudflare mails the account |
| Montonio | contract | payments and labels stop | Montonio mails Renat |
| Google Ads | post-paid card | the campaign pauses | Google mails rempireshopinfo@ |
| Merchant Center photos | main photo ≥ 500 × 500 from 31.01.2027 | items limited or refused | Merchant Center (RUNBOOK §7) |

**Drills that prove the alert roads.**

- GitHub → Actions → «Alert drill» → Run workflow. It fails on purpose and
  mails whoever pressed it.
- `POST /api/admin/alert-drill/` from a signed-in admin tab. It sends one
  test letter to `DEV_ALERT_TO`.

## Open questions (for Dim)

1. **Vercel Pro.** Whose card pays the $20, and does it move to the company
   card at the meeting like the others?
2. ~~Card …0731~~ — answered 05.11: Dim's; the handover rows say so.
3. ~~Zone.ee~~ — answered 05.11: THEFLOW OÜ is Renat's company, the sign-in
   is blackboxestonia@, and moving the domain to Rempire Store OÜ is optional.
4. **`RESEND_TO`, `VAPID_*`, `TELEGRAM_*`.** Are they all set in Vercel
   Production? The owner gets no order pings through any road that is
   missing.
5. **`DEV_ALERT_TO`.** Keep info@diipsolutions.eu for paid support, or point
   it elsewhere?
6. **`rempireshop.diipsolutions.eu`.** Keep it on the shop's Vercel project
   after the handover (it serves `/handover`), or remove the domain?
7. **`rempire-api`.** What is this repository, and should it be archived or
   deleted?
