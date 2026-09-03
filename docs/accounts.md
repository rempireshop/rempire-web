# Rempire — accounts & services registry

*Source of truth for "which account is connected to what". Started 03.09.2026.*

**Rules**
- **No passwords in this file — ever.** Passwords, 2FA/TOTP secrets, API keys and recovery codes live only in the shared password-manager vault (Bitwarden org "Rempire", free for 2 users). This file is the map; the vault is the keys.
- Every service is registered on **rempireshopinfo@gmail.com** (the shop's Google account, owned by Rempire Store OÜ). Recovery address of that Google account = blackboxestonia@gmail.com (Renat's personal). Dmitri holds the shop account during the build; at launch every login is in Renat's vault.
- Dmitri's own accounts (dimnovare@ / dim.novare@gmail.com) are added as *members/collaborators* where that is free — never as the owner of anything that is the business.
- Card on file: Dmitri's card temporarily where a service demands one at signup (Railway); switched to the company card at launch.

## Registry

| Service | What it does for the shop | Account / login identity | Owner (final) | Members | Plan / cost | Status | Notes |
|---|---|---|---|---|---|---|---|
| Google account rempireshopinfo@gmail.com | Identity for every service below; shop mailbox | — | Renat | Dmitri (build phase) | free | ✅ exists | set recovery = blackboxestonia@; 2FA via TOTP in vault |
| Zone.ee (my.zone.eu) | Domain rempireshop.com + DNS (nameservers ns.zone.eu) | blackboxestonia@gmail.com | Renat | dim.novare@gmail.com (user, added 03.09) | domain renewal only | ✅ access | registrant still THEFLOW OÜ / Denis Kuznetsov → change to Rempire Store OÜ («domeeni omaniku vahetus»); ASCIO is Zone's upstream, no separate account. 03.09: DNS snapshot taken before changes (5 records: A→Shopify, www CNAME, 3 NS); 5 new records added, nothing existing touched |
| Bitwarden org "Rempire" | Shared vault for all secrets | rempireshopinfo@ | Renat | Dmitri | free (2 users) | ⬜ | create FIRST |
| GitHub user `rempireshop` (no org — name `rempire` is taken) | Source code: rempire-web (shop), rempire-api | rempireshopinfo@ (GitHub user `rempireshop`) | Renat | dimnovare = collaborator (push) on both repos | free | ✅ repos transferred 03.09 | both repos now github.com/rempireshop/…; old dimnovare URLs redirect; local remotes updated |
| Railway | Production hosting: Next.js app + Postgres + volume (uploads) | rempireshopinfo@ (login via GitHub) | Renat | Dmitri via GitHub collaborator | Hobby $5/mo (usage inside credit) | ⬜ | EU region; card: Dmitri's temporarily |
| Vercel | Staging / previews only (Hobby is non-commercial) | rempireshopinfo@ (login via GitHub) | Renat | — | Hobby free | ✅ project `rempire-web` imported 03.09 (team Rempire) | auto-deploys from github.com/rempireshop/rempire-web main; env vars still empty (OPENAI_API_KEY, TELEGRAM_*, RESEND_*, later DATABASE_URL etc.); staging domain rempireshop.diipsolutions.eu still on Diip's project → repoint after env vars; then delete Diip's old project |
| Vercel Blob `rempire-qa` | Questionnaire answers + feedback JSON (a few KB) | currently Diip's Vercel team | — | — | free | ⬜ migrate | export → recreate in the new Vercel account (or move to Railway volume) |
| Resend | Transactional e-mail from @rempireshop.com (5 templates) | rempireshopinfo@ | Renat | Dmitri (member) | free tier (3k mails/mo) | 🟡 domain added 03.09, verify pending | rempireshop.com added 03.09.2026, region Ireland (eu-west-1), tracking off; DKIM/SPF-CNAME/DMARC in Zone, Resend auto-checks; MX «receiving» deliberately NOT added |
| Google Search Console | Search positions, indexing, 301 watch after switch | rempireshopinfo@ (Google) | Renat | dim.novare@ (owner via own TXT) | free | ✅ verified 03.09 (TXT) | domain property sc-domain:rempireshop.com; TXT must stay in Zone; add dim.novare@ as owner |
| Google Merchant Center | Google Shopping feed /feed/google-shopping.xml | rempireshopinfo@ (Google) | Renat | Dmitri | free listings | ⬜ at switch | needs final domain |
| Google Analytics 4 | Visits, conversion | rempireshopinfo@ (Google) | Renat | Dmitri | free | ⬜ at switch | |
| Google Business Profile | Salon on Maps → link to shop | rempireshopinfo@ (Google) | Renat | — | free | ⬜ later | masterplan item |
| Payment provider (Montonio Starter / MakeCommerce) | Bank links + cards + Apple/Google Pay + shipping labels | company onboarding by Renat | Renat (Rempire Store OÜ) | Dmitri (technical contact) | 10–12 €/mo + per txn | ⬜ after pick | KYC: company data, IBAN, Renat's ID |
| OpenAI (API) | AI assistants (shop chat, admin) | Dmitri's account now → rempireshopinfo@ at launch | Renat | Dmitri | usage (cents/day) | ⬜ move at launch | key rotated on move |
| Telegram bot @rempireshop_bot | Pushes questionnaire/feedback to Dmitri | created by Dmitri (BotFather) | Dmitri → transferable | — | free | ✅ | transfer via BotFather at launch if wanted |
| Cloudflare | Global CDN/WAF in front of the shop — "worldwide" phase | rempireshopinfo@ | Renat | Dmitri | free | ⬜ later | needs nameserver move from Zone; not before launch |
| Shopify (legacy) | Old shop, closes 1 month after switch | Renat's | Renat | dim.novare@ (collaborator) | ~46 €/mo now | ✅ live | do NOT touch until switch; Parcely app cancelled with it |

## Creation order (03.09)
1. Shop Google account: get its password from Renat (in person / Telegram secret chat), set recovery = blackboxestonia@, enable 2FA (TOTP secret into the vault).
2. Bitwarden org → invite Dmitri → put the Google login + TOTP in it.
3. GitHub: user for rempireshopinfo@ → org `rempire` → add dimnovare as owner → transfer rempire-web, rempire-api.
4. Railway: sign in with the GitHub account → empty project "rempire" (EU) → card → Dmitri wires services later.
5. Vercel: sign in with GitHub → import rempire-web from the org (Hobby) → env vars → staging domain.
6. ✅ Resend → domain added, records in Zone (03.09) → verification pending (auto).
7. ✅ Google Search Console → domain property verified via TXT (03.09); add dim.novare@ as owner.
8. Later, in this order: payment provider (after pick), Merchant Center + GA4 (at switch), OpenAI move + Vercel→(stays Hobby) / Railway card switch (at launch), Cloudflare (worldwide phase).

## DNS — rempireshop.com (Zone.ee), state after 03.09.2026

Existing (untouched, live Shopify): `A @ → 23.227.38.65`, `CNAME www → shops.myshopify.com`, `NS ×3` (ns.zone.eu / ns2.zone.ee / ns3.zonedata.net). No MX existed.

Added 03.09.2026 (new names only):

| Type | Host | Value | For |
|---|---|---|---|
| TXT | @ | `google-site-verification=KUVTHWQUdqKHip0q8VUKTRnAj9L6isKgUsWE4163wNM` | Search Console ownership — never delete |
| TXT | resend._domainkey | `p=MIGf…IDAQAB` (DKIM public key, full value in Resend → Domains) | Resend DKIM |
| CNAME | rsend | rsend-euw1.forge.rmta.net | Resend SPF / return-path |
| CNAME | send | send.forge.rmta.net | Resend sending subdomain |
| TXT | _dmarc | `v=DMARC1; p=none;` | DMARC monitor-only (tighten to quarantine later) |

Not added on purpose: `MX @ → inbound-smtp.eu-west-1.amazonaws.com` (Resend inbound). Adding it would route all mail for @rempireshop.com to Resend — separate decision. At the shop switch: change `A @` and `CNAME www` to the new host; everything above stays.

## Environment variables (Vercel → rempire-web → Settings → Environment Variables, Production + Preview)

Values are never written here. Names only, grouped by what stops working without them.

| Name | Needed for | Who sets it | Status 03.09 |
|---|---|---|---|
| OPENAI_API_KEY | customer chat + admin assistant | Dmitri (key from platform.openai.com, shop account) | ✅ set |
| OPENAI_MODEL | model choice, default `gpt-4.1-mini` when unset | Dmitri | optional |
| RESEND_API_KEY | all customer e-mails + order pings | Dmitri (Resend → API keys) | ✅ set |
| RESEND_FROM / MAIL_REPLY_TO | sender «Rempire <shop@rempireshop.com>», reply-to = Renat's mailbox | Dmitri | defaults ok; set MAIL_REPLY_TO before launch |
| TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID | «new order» pings to a Telegram chat (optional; e-mail ping works without) | Dmitri, later a bot on the shop account | ⬜ optional |
| DATABASE_URL | orders, admin login, overrides, reviews, gift cards (without it the shop runs in demo/localStorage mode) | Dmitri, from Railway Postgres | ⬜ after Railway upgrade |
| SESSION_SECRET | admin cookie + mock-payment tickets (32+ random chars) | Dmitri | ⬜ |
| ADMIN_PASSWORD_HASH | admin login (`node tools/hash-password.mjs`) | Dmitri | ⬜ |
| PUBLIC_BASE_URL | absolute links in e-mails, payment return URLs, sitemap/robots (staging: https://rempireshop.diipsolutions.eu) | Dmitri | ⬜ |
| PAYMENT_PROVIDER | `mock` (default without keys) / `montonio` | Dmitri | ⬜ |
| MONTONIO_ACCESS_KEY / MONTONIO_SECRET_KEY / MONTONIO_ENV | Montonio sandbox → live (`sandbox` / `live`) | Dmitri (sandbox), Renat's account (live) | ⬜ |

