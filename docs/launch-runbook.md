# Launch runbook — Thursday 08.10.2026, 22:00–23:00 Tallinn

One page for the night. The why of every step is in `docs/go-live.md` and on
`/golive/`; this is only what to type and click, what to check, and how to go
back. Commands run in `C:\Users\Dmitri.MARKIT\source\repos\rempire-web`.

**Rule of the night:** rempireshop.com stays on Shopify until step 6. Steps 1–4
touch only the new shop; nobody notices them. Step 6 is the switch.

## Before 22:00 (Thursday daytime)

- [ ] Chrome «Browser 1» signed in to: the staging admin
      (`rempireshop.diipsolutions.eu/shop2/admin/`), Shopify admin, Vercel (team
      «rempire»), Cloudflare, Gmail.
- [ ] Docker Desktop running (the backup needs it).
- [ ] `.env.railway.txt` and `.env.montonio-live.txt` in the repo folder.

## 0. Footer «Админка» link off — Claude, at 22:00

Renat writes a blog post on staging until the launch, so the button stays until
now (Dim, 08.10). `git revert 1d526806`, minify + retoken, push. The build runs
while steps 1–2 happen; check the deployed bundle has no `ftr__admin` before
step 5. The panel is `/admin` from here on.

## 1. Backup — Claude

```
node --env-file=.env.railway.txt tools/db-backup.mjs
```

Check: a `✓` line, ~0.4 MB, «32 tables», read back by pg_restore. **No ✓ → stop.**

## 2. Reset — Claude dry run, Dim runs the real one

```
DATABASE_SSL_NO_VERIFY=1 node --env-file=.env.railway.txt tools/go-live-reset.mjs --stock --test-content --gift-cards-are-test-cards
```

Read the TEST CONTENT list: 8 promo codes, 7 newsletters, 8 own `c-…` products
(hoodie, t-shirt, «Cheap price», «Claude test товар», the €1 product…).
`bundles` and `posts` must say **untouched**. Then Dim pastes the line it prints:

```
DATABASE_SSL_NO_VERIFY=1 node --env-file=.env.railway.txt tools/go-live-reset.mjs --clear --confirm "I HAVE A BACKUP AND I WANT TO DELETE THE TEST DATA" --stock --test-content --gift-cards-are-test-cards
```

Check: dry run again → `0` under CLEAR, STOCK and TEST CONTENT; 8 sets and 3
posts still there. Rollback: restore the step-1 file (`docs/go-live-reset.md`,
«if you do have to roll back»).

## 3. Letters — look only

Admin → «Маркетинг → Письма»: all five on (unpaid, back in stock, abandoned cart,
cart discount 5 % from 100 € after 2 days, birthday 10 %). Nothing to switch.

## 4b. Customers — before the stock

Shopify → Customers → Export → All customers → Plain CSV (arrives by e-mail;
keep the file outside the repo).

```
DATABASE_SSL_NO_VERIFY=1 node --env-file=.env.railway.txt tools/import-shopify-customers.mjs --csv <customers_export.csv>
DATABASE_SSL_NO_VERIFY=1 node --env-file=.env.railway.txt tools/import-shopify-customers.mjs --csv <customers_export.csv> --apply --confirm ИМПОРТ-КЛИЕНТОВ
```

Check: rehearsal 06.10 on the 28.09 file — 391 customers, 304 with a phone, 313
with an address, marketing off for all. Nobody gets a letter.

## 4. Stock — the last thing before the switch

Shopify → Products → Inventory → Export → all variants, CSV (by e-mail).

```
node tools/import-shopify-stock.mjs --csv <inventory_export.csv>
node tools/import-shopify-stock.mjs --csv <inventory_export.csv> --emit-browser-script stock-apply.js
```

Check the dry run: ~322 rows, 0 skipped; the five products Shopify no longer
sells read `0 (нет) ← decided by hand` (Tom Ford Tobacco Vanille, Creed
Vetiver, Crystal.Angel, Expedition Reserve, Gummy mask). Then Claude runs
`stock-apply.js` in the signed-in admin tab and checks the counts in the
database, not on screen. A Shopify order after this export is written off by
hand (step 13).

## 5. PUBLIC_BASE_URL + Redeploy — Dim

Vercel → rempire-web → Settings → Environment Variables → `PUBLIC_BASE_URL`
(Production) = `https://rempireshop.com` → Deployments → current Production →
Redeploy → wait for **READY** (~5–8 min). Go straight on to step 6.

Rollback: `https://rempireshop.diipsolutions.eu` + Redeploy.

## 6. DNS — the switch — Dim

Cloudflare → rempireshop.com → DNS → Records. Exactly two edits, both
«DNS only» (grey cloud):

| Record | From | To |
|---|---|---|
| A `rempireshop.com` | `23.227.38.65` | `76.76.21.21` |
| CNAME `www` | `shops.myshopify.com` | `6eb24d85f874d834.vercel-dns-017.com` |

Touch nothing else (MX, SPF, DKIM, `send`/`rsend`, `img` R2, Google
verification). TTL is 5 minutes.

Rollback: the «From» values back.

Checks (Claude): `https://rempireshop.com/shop2/` 200 without `x-robots-tag`;
`www` → 308 to rempireshop.com; `/robots.txt` and `/sitemap.xml` the production
ones; an old `/products/…` → 301 to `/shop2/p/…`; `/feed/google-en.xml` 200; a
POST to `/api/payments/notify/` → 400 (not 308); Vercel shows the domain «Valid».

## 7. Smoke — Claude

```
npm run smoke -- https://rempireshop.com
```

Baseline 06.10 on staging: 14 passed, 1 skipped.

## 8. Parcel webhook — Claude, with Dim's OK

```
node --env-file=.env.montonio-live.txt tools/montonio-webhook.mjs list
node --env-file=.env.montonio-live.txt tools/montonio-webhook.mjs register https://rempireshop.com/api/shipping/notify/
node --env-file=.env.montonio-live.txt tools/montonio-webhook.mjs delete <the old id from list>
node --env-file=.env.montonio-live.txt tools/montonio-webhook.mjs list
```

Check: one webhook, four events, «Подключения» green.

## After

- 9 — Renat: rempireshop.com/admin in Safari, new Home Screen icon, «Оповещения
  на телефон» → «Включить» → «Отправить проверочное».
- 10 — First real order on rempireshop.com.
- 11–12 — Merchant Center feeds and Search Console sitemap (next day,
  `docs/merchant-feed.md`).
- 13 — Shopify orders at 12:00, 18:00 and next morning for 72 h; delete both
  `.env` files at the end of the day.
