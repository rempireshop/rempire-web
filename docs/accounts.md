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
| Zone.ee (my.zone.eu) | Domain rempireshop.com + DNS (nameservers ns.zone.eu) | blackboxestonia@gmail.com | Renat | dim.novare@gmail.com (user, added 03.09) | domain renewal only | ✅ access | registrant still THEFLOW OÜ / Denis Kuznetsov → change to Rempire Store OÜ («domeeni omaniku vahetus»); ASCIO is Zone's upstream, no separate account |
| Bitwarden org "Rempire" | Shared vault for all secrets | rempireshopinfo@ | Renat | Dmitri | free (2 users) | ⬜ | create FIRST |
| GitHub org `rempire` | Source code: rempire-web (shop), rempire-api | rempireshopinfo@ (GitHub user) → org owner | Renat | dimnovare = org owner/admin | free | ⬜ | transfer both repos from dimnovare |
| Railway | Production hosting: Next.js app + Postgres + volume (uploads) | rempireshopinfo@ (login via GitHub) | Renat | Dmitri via GitHub org | Hobby $5/mo (usage inside credit) | ⬜ | EU region; card: Dmitri's temporarily |
| Vercel | Staging / previews only (Hobby is non-commercial) | rempireshopinfo@ (login via GitHub) | Renat | — | Hobby free | ⬜ | import rempire-web from the org; staging domain rempireshop.diipsolutions.eu → this project; Diip's old project deleted after |
| Vercel Blob `rempire-qa` | Questionnaire answers + feedback JSON (a few KB) | currently Diip's Vercel team | — | — | free | ⬜ migrate | export → recreate in the new Vercel account (or move to Railway volume) |
| Resend | Transactional e-mail from @rempireshop.com (5 templates) | rempireshopinfo@ | Renat | Dmitri (member) | free tier (3k mails/mo) | ⬜ | domain verify: SPF + DKIM records into Zone |
| Google Search Console | Search positions, indexing, 301 watch after switch | rempireshopinfo@ (Google) | Renat | dim.novare@ (owner via own TXT) | free | ⬜ | domain property; TXT into Zone now |
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
6. Resend → add domain → Dmitri puts SPF/DKIM into Zone → verify.
7. Google Search Console → domain property → Dmitri puts TXT into Zone → verify; add dim.novare@ as owner.
8. Later, in this order: payment provider (after pick), Merchant Center + GA4 (at switch), OpenAI move + Vercel→(stays Hobby) / Railway card switch (at launch), Cloudflare (worldwide phase).
