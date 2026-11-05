# REMPIRE — runbook

*This file holds the step-by-step procedures for when something breaks on
rempireshop.com. It was written 05.11.2026 against `main` at `f6d2ca70`.*

- What each system is and where its code lives: `docs/SYSTEM-MAP.md`.
- Environment variable names: `README.md`.
- Who owns which account and how to sign in: `docs/accounts.md`.

**Before you start.**

- **Sign-in for almost every dashboard.** Vercel, Railway, GitHub, Cloudflare,
  Resend and the Google tools are all reached through the shop's Google
  account rempireshopinfo@gmail.com. GitHub user `rempireshop` signs into
  Vercel and Railway.
- **Secrets stay out of chats, tickets and commits.** Database URLs, keys, the
  backup passphrase and the admin password never go there. Put a local copy
  in a gitignored `.env*.txt` file, use it, then delete it.
- **Customer data stays off your laptop where possible.** Reading the
  database is sometimes needed. Prefer the panel, or a query that returns
  counts and ids.
- **The owner's own guide is in Russian**, in his Google Doc in the shop
  Drive. When you tell Renat what to press, use the panel's Russian labels as
  this file quotes them.

**Places you will look in almost every case.**

| What | Where |
|---|---|
| Is the live build the one you expect? | Vercel → team «Rempire» → `rempire-web` → Deployments (the Production one is built from branch `production`) |
| Server errors, and Montonio's raw replies | Vercel → `rempire-web` → Logs (runtime logs; filter by route, e.g. `/api/payments/`) |
| CI, promote, smoke, backup runs | GitHub → `rempireshop/rempire-web` → Actions |
| What the owner changed | Panel → «Ещё» → «Настройки» → «Журнал», or `GET /api/admin/audit/?limit=100` from a signed-in admin tab |
| Is the database answering? | `https://rempireshop.com/api/overrides/` answers `200` with JSON; `503 db_unavailable` means it is not |
| A quick read-only check of the whole shop | `npm run smoke -- https://rempireshop.com` |

---

## 1. The site does not open

1. **Check whether it is the site or your network.** Open
   `https://rempireshop.com/` from your phone on mobile data. Then run
   `curl -sI https://rempireshop.com/` and note the status code and the
   `server:` header (`Vercel` is expected).
2. **If DNS does not resolve, or the browser warns about the
   certificate:**
   - Cloudflare → `rempireshop.com` → DNS. `A @` must be `76.76.21.21` and
     `CNAME www` must point at the Vercel value. Both must be **DNS only**
     (grey cloud), not proxied (`docs/launch-runbook.md` §6). Do not touch the
     Resend, Google, MX or `img` records.
   - Zone.ee (my.zone.eu): has the domain expired? It is paid to
     **31.05.2027**. The nameservers must be Cloudflare's.
3. **If Vercel answers with an error page** (`404: NOT_FOUND`,
   `DEPLOYMENT_NOT_FOUND`, a paused-project page, or 5xx on every page):
   - Vercel → `rempire-web` → Deployments. Is the current Production
     deployment *Ready*? If the latest one failed, the site keeps the last
     good one, so a failed build alone never takes the site down.
   - Vercel → Usage, and the team's e-mail (the shop Gmail): was the project
     paused for a usage limit? This is a Hobby risk (§6). On Pro it bills
     instead.
   - Vercel's status page: an outage in `fra1`?
4. **If pages open but something is wrong after a deploy** (blank page,
   console errors, wrong prices):
   - Roll back: Vercel → Deployments → the previous Production deployment →
     «Instant Rollback» (check the wording in today's UI). Vercel then stops
     moving the domain to new builds until you undo the rollback, so
     deploy-hook rebuilds will not go live either. Undo it once the fix is
     on `production`.
   - Then fix forward on `main`, and let CI and promote carry it (§5).
5. **If the product pages work but the cart, account and panel fail with
   `503`:** the database is down.
   - Open `https://rempireshop.com/api/overrides/`. A `503 db_unavailable`
     confirms it.
   - Railway → project → Postgres. Is the service running? Is there a failed
     payment («payment failed» mail, card expired)? Railway stops services on
     an unpaid bill.
   - Vercel logs, filtered by `[db]`, show `SELF_SIGNED_CERT_IN_CHAIN` (a TLS
     setting changed, §9) or authentication failures (a password changed on
     Railway's side, see `tools/rotate-db-password.mjs`).
   - While the database is down, the static pages keep selling nothing:
     checkout needs the database. Fix the database; there is no read-only
     fallback for orders.
6. **If only some addresses are broken** (404 on a product, a redirect
   loop):
   - `curl -sI <url>` and read `X-Rempire-Redirect`, which names why the
     middleware redirected.
   - A hidden product answers 404 on purpose.
   - A redirect loop usually means a `next.config.ts` redirect and the
     middleware disagree. Compare with `tests/legacy-redirects.test.ts` and
     `tests/middleware-matcher.test.ts`.
7. **Confirm the fix** with `npm run smoke -- https://rempireshop.com`.

---

## 2. Checkout or payment fails (Montonio)

1. **Find the error code.** Reproduce the checkout in a private window up to
   the bank step; do not pay. In DevTools → Network:
   - `POST /api/orders/` failing answers `400` with an error code the
     shopper can fix (bad address, `not_digital` …);
   - `POST /api/payments/create/` answers with one of these codes
     (`docs/payments.md` §8):

     | Code | Meaning | Look at |
     |---|---|---|
     | `not_configured` | no Montonio keys and no `PAYMENT_PROVIDER` | Vercel env vars `MONTONIO_ACCESS_KEY`, `MONTONIO_SECRET_KEY`, `MONTONIO_ENV=live` |
     | `provider_unreachable` / `provider_rejected` | Montonio did not answer, or refused | Vercel runtime logs: they hold Montonio's raw 4xx body, which the order journal never records |
     | `db_unavailable` | database down | §1 step 5 |
     | `rate_limited` | more than 20 tries a minute from one address | wait |
     | `already_paid` / `order_closed` | the order is already settled | the order card in the panel |
2. **If Montonio refuses** (`provider_rejected`):
   - Read the raw reply in the Vercel log. Typical causes:
     - a bank or method switched off in Montonio's portal;
     - the store's live keys rotated without updating Vercel;
     - an amount or currency Montonio does not accept.
   - Check from your machine: put the live keys into a temporary
     `.env.montonio-live.txt` (gitignored). Then run
     `node --env-file=.env.montonio-live.txt tools/montonio-live-check.mjs`
     (GET-only), and delete the file afterwards.
   - The panel's view of the same: «Ещё» → «Подключения» → «Приём оплат ·
     Montonio». It is filled by `GET /api/admin/montonio/`, which also
     rewrites `settings.montonio_readiness`.
3. **If the shopper paid but the order stays «new»** (the webhook was lost):
   - Wait one day. The daily cron (`/api/cron/flows/`, 07:00 UTC) asks
     Montonio about unpaid orders aged 45 minutes to two weeks
     (`reconcileUnpaidOrders`).
   - Or settle it at once. Confirm the payment in Montonio's portal, then go
     to the panel → the order → «Изменить статус вручную» → «оплачен». This
     runs the full settlement (stock, letters, points, gift cards) exactly
     once.
   - Check the payment webhook is registered: `POST /api/payments/notify/`
     (`docs/payments.md` §3).
4. **If a payment is «held»** (under-paid, or the wrong currency): the order
   card says so. Settle it by hand only after checking the amount in
   Montonio's portal.
5. **If a refund fails or hangs:**
   - The order card shows Montonio's refusal in its own words
     (`src/lib/montonio-problems.ts`).
   - Pending refunds are re-asked every night (`recheckPendingRefunds`). A
     refund marked expired means Montonio waited 10 days for funds; the
     owner must not transfer the money by hand while it is pending, or it
     goes out twice.
6. **If parcel labels fail:**
   - The order card's label button answers `502 registrationFailed`, and
     the same card offers the repair (`PATCH /api/admin/shipments/`).
   - Orders that never close by themselves mean the shipping webhook is
     missing. Run `node --env-file=.env.montonio-live.txt
     tools/montonio-webhook.mjs list`. It should point at
     `https://rempireshop.com/api/shipping/notify/`. The example line in the
     tool's header still names Dim's host, which works too, because `/api`
     is not redirected there.
7. **Never set `PAYMENT_PROVIDER=mock` on Vercel** to "get checkout working".
   The payment mock has no production guard and would mark orders paid
   without money.

---

## 3. Mails do not arrive (Resend)

1. **Who is missing mail?**
   - **A customer** (order confirmation, code, shipped): Resend dashboard →
     Emails. Search the address. Was it sent, delivered, bounced, or marked
     as spam?
   - **The owner** («новый заказ»): the ping goes by Web Push and Telegram
     first. The e-mail to `RESEND_TO` goes only if no device took the push
     (`pingOwner`, `src/lib/notify.ts`). A missing e-mail is often correct
     behaviour.
   - **The developer** (build, backup and hide alerts): `DEV_ALERT_TO`, whose
     default is `info@diipsolutions.eu`.
2. **If nothing at all is in the Resend dashboard,** the shop did not send.
   Search the Vercel logs for:
   - `[mail] RESEND_API_KEY is not set — skipping` (the key is missing from
     Vercel);
   - `[notify] RESEND_TO is not set` (the owner pings have no address);
   - `[mail] send failed` (Resend refused; the line holds the status);
   - `[mail-budget] Resend refused a … letter for the daily quota` (the free
     tier allows 100 letters a day and 3 000 a month).
3. **The daily budget.**
   - `settings.mail_budget` (default cap 100, reserve 30) counts sends per
     UTC day in `mail_sends_daily`.
   - Transactional mail always goes. Marketing letters (flows, newsletters)
     stop at cap − reserve.
   - A newsletter that does not fit **parks** and the next daily cron
     resumes it.
   - The owner gets a push or Telegram notice when the limit is hit.
4. **The flows (abandoned cart, back in stock, birthday, unpaid order)** are
   all **off by default** (`FLOW_DEFAULTS`).
   - «Маркетинг» → «Письма» shows each switch and «Последний запуск»
     (`settings.flow_runs`). «Почему ничего не ушло» in `docs/flows.md`
     covers the usual reasons.
   - The flows run only from the daily cron. Without `CRON_SECRET` the cron
     answers 503 and nothing goes out.
5. **If mail was sent but lands in spam:** Cloudflare DNS must still hold
   the Resend records `resend._domainkey` (DKIM), `send`, `rsend` and
   `_dmarc`. Resend → Domains → `rempireshop.com` must say *Verified*. Never
   delete the records, and never add an MX for Resend inbound.
6. **If replies to the shop do not arrive** (`info@`, `shop@`): this is
   Cloudflare Email Routing, not Resend. Go to Cloudflare →
   `rempireshop.com` → Email → Email Routing. Both rules must forward to
   rempireshopinfo@gmail.com, and the destination must be verified.
7. **Test the road:** panel → «Маркетинг» → «Письма» → a test letter
   (`POST /api/admin/mail/test/`, 20 an hour). For the owner ping use
   `POST /api/admin/notify` from a signed-in admin tab.

---

## 4. Restoring the database from a backup

There are two kinds of backup.

| Kind | Made by | Where | Format |
|---|---|---|---|
| Automatic | `.github/workflows/backup.yml`, 01:17 and 13:43 UTC | GitHub → Actions → «Database backup» → a run → Artifacts; kept 30 days | `rempire-YYYY-MM-DD.sql.gz.gpg` (plain SQL, gzip, GPG AES-256 with `BACKUP_PASSPHRASE`) |
| Manual | `node --env-file=.env.railway.txt tools/db-backup.mjs` | `%USERPROFILE%\rempire-backups` on the machine that ran it | `pg_dump` custom format |

Railway's Hobby plan makes no backups of its own.

**Decide first:** restore into a **new** database (safe, the default), or
over the live one (only to undo a known bad change, and only with a fresh
manual backup taken first).

**Restore an automatic backup into a new database** (`docs/backup.md`):

1. Download the newest good artifact and unzip it. Each run restores itself
   into a scratch Postgres and compares row counts before it uploads, so a
   green run's file is known to restore.
2. In Railway, create an empty PostgreSQL 18 in the same project (Railway →
   New → Database → PostgreSQL). Copy its public URL into a local
   `.env.restore.txt`; do not paste it anywhere else.
3. Restore. You need `gpg`, `gunzip` and `psql` 18 (Git Bash, or Docker
   `postgres:18`). The command is
   `gpg --batch --passphrase "<BACKUP_PASSPHRASE>" -d rempire-YYYY-MM-DD.sql.gz.gpg | gunzip | psql "<new database URL>"`.
   The passphrase is in the login sheet. Type it at a prompt rather than
   leaving it in shell history where you can.
4. Point the shop at it:
   - Vercel → `rempire-web` → Settings → Environment Variables →
     `DATABASE_URL` (Production).
   - A new Railway database has a **new private CA**. If `DATABASE_SSL_CA` is
     set, export the new one (§9 step 4). Otherwise the shop runs with
     `DATABASE_SSL_NO_VERIFY=1`.
   - Redeploy: Vercel → Deployments → the current Production deployment →
     Redeploy.
5. Point the backup at it: GitHub → Settings → Secrets and variables →
   Actions → `BACKUP_DATABASE_URL`. Then GitHub → Actions → «Database
   backup» → Run workflow, and check it goes green.
6. Check:
   - `https://rempireshop.com/api/overrides/` answers 200;
   - the panel shows the newest orders you expect;
   - `npm run smoke -- https://rempireshop.com` passes.

   Orders paid between the backup and now exist only at Montonio. Find them in
   Montonio's portal and re-enter or settle them by hand.
7. Keep the old database stopped, not deleted, until the owner has checked
   a few days of orders.

**Restore a manual dump** (custom format): see the header of
`tools/db-backup.mjs`. The command is
`pg_restore --clean --if-exists --no-owner --no-privileges` through Docker.
`--clean` overwrites what it restores.

---

## 5. A deploy is blocked by CI

How a commit reaches the site: push to `main` → **CI** (`ci.yml`: typecheck
and vitest in 3 shards) → **Promote to production** (`promote.yml`
fast-forwards branch `production` to the tested commit and waits up to
25 minutes for Vercel) → **Smoke** (`smoke.yml` against the live site).
`main` itself never builds on Vercel.

1. **Find the red step.** Go to GitHub → Actions and find which workflow is
   red for your commit.
   - **CI red:** the commit never reached `production`; the site runs the
     previous one.
   - **Promote red:** Vercel's build of the commit failed, or did not finish
     in 25 minutes. The site still runs the previous build. Read Vercel →
     Deployments → that deployment → Build Logs.
   - **Smoke red after promote:** the commit is live and something on the
     site is wrong. Treat it as §1 step 4.
2. **If CI is red:**
   - Open the failed shard. A failed test names its file. Run it locally:
     `npx vitest run tests/<file>.test.ts`.
   - A generated file is stale. The usual ones are below; each has a test
     that says which command to run.
     - `src/db/migrations.generated.ts`: `npm run pack:migrations`.
     - `src/data/catalogue.feed.json`: `npm run pack:feed`.
     - The `?v=` token in `public/shop2/index.html` after an `app.js` edit:
       `npm run prerender`, then commit only the token change.
     - The white squares after a new photo: `npm run feed:squares`.
   - `fuzz-routes` timing out at 180 s on your machine does not mean it fails
     in CI. The local full suite takes more than 10 minutes; trust the CI
     shard.
   - If a test is flaky, GitHub → the run → «Re-run failed jobs». A re-run
     keeps the `push` event, so a green re-run still promotes.
3. **If promote is red because Vercel's build failed:**
   - The build log names the step. `prebuild` runs the packers and the
     prerender, which **reads the live database**. A panel edit can break
     it; `tools/chaos-build.mjs` exists to catch that.
   - `migrate: failed, continuing the build` in the log does **not** fail the
     build. Apply the migrations by hand:
     `GET|POST /api/admin/migrate/` from a signed-in admin tab.
4. **If promote says `production is not behind <sha> — nothing to do`:** an
   older run finished after a newer one, or someone pushed to `production`
   directly. The newer commit is already live; nothing to fix.
5. **Emergency only, CI skipped on purpose:**
   `git push origin <sha>:production` deploys that commit without CI. Use it
   only for a hotfix while CI itself is broken. Say so in the commit message,
   and get `main` green right after.
6. **Docs-only pushes** (`docs/**`, `*.md`) run no CI and promote nothing.
   They ride with the next code push.
7. **Branch hygiene:**
   - Several agent sessions may share one checkout. Check `git status` and
     `HEAD` before committing.
   - Two branches can add the same migration number without a git conflict.
     After a merge, check `ls db/migrations` for duplicates.

---

## 6. A Vercel CPU or usage warning

Background: in October and November 2026 the shop reached 75 % and then
90 % of Hobby's 4 hours of Fluid Active CPU per 30 days. Past 100 % a Hobby
project is paused. On 03.11.2026 the project moved to **Pro** ($20 a month)
and the load was cut (`docs/SYSTEM-MAP.md` §24).

1. **Read the numbers.** Go to Vercel → team «Rempire» → Usage, select
   `rempire-web` and read Fluid Active CPU, Function Invocations, Edge
   Requests, Data Transfer and Middleware. Note the 30-day total and the
   last few days.
2. **Find the cause.** Use Vercel → `rempire-web` → Observability (or Logs)
   and sort functions or routes by CPU or invocations. Known heavy or
   frequent callers:
   - the middleware;
   - `/api/overrides/`, `/api/bundles/` and `/api/overrides/hidden/` (CDN-cached
     for a day, dropped by tag on every write — 20f9a66f);
   - `/feed/google-*.xml` (3–4 MB each, cached an hour);
   - `/api/search/` (OpenAI calls);
   - the request-time product and blog pages;
   - the OG-card renderer.
3. **If a cached route suddenly costs a lot,** its cache is being bypassed or
   dropped too often:
   - `curl -s -o /dev/null -D - https://rempireshop.com/api/overrides/`
     (a GET: HEAD has its own cache entry and can MISS while GET HITs)
     should show `x-vercel-cache: HIT` on a second request. Vercel strips
     `s-maxage` from what the browser sees; the route sends
     `public, s-maxage=86400, stale-while-revalidate=120`.
   - Every write to `product_overrides`, `settings`, `custom_products`,
     `stock_levels`, `stock_moves` or `bundles` drops the `shop-feed` tag
     (`refreshFeedCache()` from `src/lib/db.ts`). A loop that writes
     constantly (a misbehaving script, the connector in a loop) keeps the
     cache cold. Read the journal (§8).
4. **If the middleware costs a lot:** `src/lib/middleware-matcher.ts` should
   keep it off canonical pages. A new top-level page or a renamed handle can
   fall outside the skip list. `tests/middleware-matcher.test.ts` lists what
   must and must not run it.
5. **If bots cause it:** Vercel → Firewall shows the traffic by user agent.
   `robots.txt` allows AI crawlers (training ones included,
   `tools/lib/robots-policy.mjs`). Any blocking happens in Vercel's Firewall,
   not in the repository. Check its rules before adding more.
6. **Rebuilds cost build minutes, not function CPU.** Still, the deploy hook
   fires at most once per 5 minutes (`MIN_GAP_MS`, `src/lib/rebuild.ts`),
   plus one forced build at night.
7. **Going back to Hobby** is the plan once usage is low. The handover note
   says: when the 30-day total is well under 4 hours and under about
   8 minutes a day, go to Vercel → Settings → Billing → Downgrade. Downgrading
   while over the limit pauses the shop at once. Vercel's terms keep Hobby for
   non-commercial use; that decision belongs to the owner.

---

## 7. Merchant Center: feed errors or product disapprovals

The account is Merchant Center **5819586565**. It holds the shop's own feeds
`https://rempireshop.com/feed/google-en.xml` and `google-ru.xml`; Merchant
Center offers no Estonian. Google fetches them daily.

1. **Check the feed itself:**
   - `curl -s -o /dev/null -w "%{http_code} %{size_download}\n" https://rempireshop.com/feed/google-en.xml`
     should give `200` and about 3.7–4.0 MB.
   - `503` means the database did not answer. The feed refuses on purpose, so
     Google keeps yesterday's items.
   - `413`, or a size near 4.5 MB, means the feed hit Vercel's 4.5 MB response
     cap. `tests/merchant-feed.test.ts` should have caught it.
2. **Read Merchant Center.** Sign in with rempireshopinfo@ and open
   Products → All products, filtered by data source. Then open one
   disapproved item and read the reason.
3. **Common reasons and their fixes:**

   | Reason | Fix |
   |---|---|
   | Health or «prescription drug» claims in the text | The feed sends the product's page description: the owner's own text cut to its first paragraph (≤ 900 characters, `feedIntro()`), or the catalogue file's text. Change the wording in the panel → the product → «Описание», or in the catalogue content files for a catalogue product. |
   | Image too small (enforced from 31.01.2027: main photo ≥ 500 × 500) | Catalogue photos: `npm run feed:squares` after adding or replacing a photo in `public/shop/img/`, then commit. Panel uploads are not squared: the owner should upload at least 1 000 px on the short side. |
   | Missing GTIN / limited performance | The barcode comes only from «Склад» (`stock_levels.ean`). Renat scans the bottle; the next fetch carries it. The brand Rempire is sent as having no barcode, which is correct. |
   | Mismatched price | Every size links to its own `?size=` address. Check that the product page at that address shows the feed's price. If Google «corrects» prices, switch off automatic price updates in Merchant Center. |
   | Item missing from the feed | Hidden products, gift cards and own products with no photo are left out on purpose (`planFeed()`). |
   | Shipping or returns warnings | Shipping comes from the feed's item-level `g:shipping`, built from the live shipping rules. The return policy (24 EU countries, 30 days) is set in Merchant Center itself. |

4. **After a fix,** go to Merchant Center → Settings → Data sources → the
   source → «Fetch now». Then wait for the review, up to three days.
5. **The Shopify-era sources** were removed after the shop's own feeds were
   approved. Any «Shopify App API» source that reappears is a leftover:
   delete it in Merchant Center. Do not add the shop's feed a second time.
6. **Google Ads** reads the same items; its test Shopping campaign runs until
   15.11.2026. A disapproved item stops showing in ads too.

---

## 8. The owner hid or broke something in the panel

Every panel change is journaled in `admin_audit`. Its columns are `id`, `at`,
`actor`, `action`, `payload`, `prev` (what the change replaced) and `device`.
Writes through Claude carry `via: "claude"`. Product changes are
`override.set` (catalogue products) or `product.update` (own `c-…`
products); settings changes are `setting.set`.

1. **Ask what he did,** in plain Russian, and read the journal: panel →
   «Ещё» → «Настройки» → «Журнал». It merges the server journal with that
   phone's own log, and sign-ins are folded under «Входы в админку».
2. **Undo from the journal.** «Вернуть» on the row puts back exactly the
   fields that change replaced, from any device (`src/lib/audit-undo.ts`).
   The undo is itself journaled, and the old row is struck through as
   «вернули».
   - Settings: only the changed paths are restored, so later edits of the
     same setting survive.
   - There is no «Вернуть» for a mark-paid or a refund (by design).
3. **Mass hiding.**
   - The panel refuses more than 10 hides a minute (`429 hide_burst`), so a
     runaway thumb is limited.
   - If 8 or more in-stock products were hidden in a day, the daily cron
     already mailed the shop and Dim a list (`runHideWatch`). Undo them row
     by row in the journal, or ask whether the clear-out was deliberate.
4. **Read the journal from a terminal** when the panel is not enough. From a
   signed-in admin tab, run
   `fetch('/api/admin/audit/?limit=200').then(r=>r.json())`. For the
   database directly, a read-only query that prints no customer fields:

   ```sql
   select id, at, actor, action, payload->>'id' as target, device
     from admin_audit
    where at > now() - interval '2 days'
    order by id desc
    limit 200;
   ```

   Some payloads hold customer e-mails (orders, messages). Do not dump whole
   payloads to a shared screen.
5. **An edit broke the build or the smoke test** (no code push, yet
   «Promote» or «Smoke» is red, or `DEV_ALERT_TO` got a build-watch letter):
   - The prerender reads the database, so an ordinary panel edit can change
     what a build produces. Cases from October: a rename failed the Vercel
     build, and hiding a product line turned the deployed smoke red
     (`tools/chaos-build.mjs` header).
   - Find the edit in the journal (step 1) and «Вернуть» it. The next
     rebuild picks it up (within 5 minutes of the next save, or at night),
     or redeploy from Vercel.
   - To reproduce without touching live data, take a snapshot with
     `node --env-file=.env.railway.txt tools/chaos-build.mjs snapshot <file outside the repo>`,
     then replay it with `node tools/chaos-build.mjs run <file>`. Then fix
     the code so that edit can never break a build again.
6. **If he broke a text** (banner, top strip, page texts, mail texts), the
   same journal applies. Page texts and blog posts also need a rebuild to
   reach the static pages; saving triggers one.
7. **If he broke the price of a size, or a whole product,** check what
   Google got (§7). A wrong price that reached the feed is fixed by the next
   daily fetch after the undo.

---

## 9. Rotating secrets

Not done at the handover: Dim decided on 05.11.2026 that no secret is
swapped (`ho-secrets`), and the panel password stays as it is. Use this when
a secret leaks or another developer takes over: `SESSION_SECRET` and
`CRON_SECRET` first, optionally the Resend and R2 keys, and replace
`DATABASE_SSL_NO_VERIFY` with `DATABASE_SSL_CA`.

**General rules:**

- Change values in Vercel → `rempire-web` → Settings → Environment
  Variables, for **Production** (and Preview where it is set).
- A changed variable reaches the site only after a redeploy: Vercel →
  Deployments → the current Production deployment → Redeploy.
- Do one secret at a time, and check after each one.
- Never paste a value into chat, a ticket or a commit.

Make a random value with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

### Step 1 — `SESSION_SECRET`

It signs many things (`README.md`, environment table). Changing it:

- **signs everyone out:** the panel (`rmp_admin`) and every customer
  (`rmp_cust`);
- **disconnects the Claude connector:** OAuth tokens no longer verify, so
  the owner reconnects «Rempire» in Claude;
- **breaks links in letters already sent:**
  - unsubscribe links answer `bad_token`;
  - cart-resume links fail;
  - **gift-card PDF links (`?t=`) answer 404.**

  The gift-card codes themselves keep working at checkout. The admin order
  card's PDF link is signed fresh, so the owner can download and forward a
  PDF to a customer who asks.
- **does not matter for:** order-status tokens on the receipt page (short
  use), and the reviews' IP-hash salt (only the rate limit resets).

Do it on a quiet hour, after telling Renat he will need to sign in again.
Then sign in to the panel, sign in as a test customer, and reconnect the
connector.

### Step 2 — `CRON_SECRET`

Vercel's cron sends `Authorization: Bearer <CRON_SECRET>` from the variable
itself, so changing it and redeploying is enough. Nothing else holds it: the
GitHub workflows use only `BACKUP_DATABASE_URL` and `BACKUP_PASSPHRASE`.

Check the next morning:

- «Обзор» → «Сделать сегодня» must not warn that the daily job is stale (it
  warns after 26 hours);
- «Маркетинг» → «Письма» → «Последний запуск» shows today.

### Step 3 — `ADMIN_PASSWORD_HASH` (the panel password)

1. Renat types his new password into `node tools/hash-password.mjs` on Dim's
   computer. It prompts, and nothing is echoed. Do not use the
   `echo '…' | node …` form: it leaves the password in shell history.
2. Copy the printed `scrypt$…` line into `ADMIN_PASSWORD_HASH` in Vercel, then
   redeploy.
3. Effects:
   - **existing panel sessions stay signed in** until their 30 days run out.
     The cookie does not depend on the password. To end them, rotate
     `SESSION_SECRET` (step 1).
   - **the Claude connector is signed out:** its tokens carry a fingerprint
     of the hash. Renat then connects his own Claude with his password
     (`ho-claude-connector`), and Dim's connection ends with it.
4. Check: sign out, then sign in with the new password. Wrong tries slow down
   (2 free, then 500 ms doubling to 20 s); they do not lock the account.

### Step 4 — `DATABASE_SSL_NO_VERIFY` → `DATABASE_SSL_CA`

Production connects to Railway over TLS **without checking the certificate**
today. Railway signs with a private CA, so the fix is to give the shop that CA
(`docs/backend.md`, «TLS to the database»).

1. Export the CA with the Railway CLI, signed in as the shop:
   `railway ssh --project <p> --service <s> --environment <e> -- export-ssl-ca > postgres-root.crt`.
   It is a public certificate. Never copy `root.key` or `server.key`.
2. Test it locally before Vercel. Put `DATABASE_URL` and the PEM text into a
   temporary `.env.ca-test.txt` (gitignored), with no `DATABASE_SSL_NO_VERIFY`
   line. Then run
   `node --env-file=.env.ca-test.txt tools/migrate.mjs` **from a checkout of
   `production`**. It uses the same `sslFor()` rule as the site and applies
   any pending migrations. From a checkout of `production` there are none,
   but from a branch with a new migration it would apply that one to the live
   database. It must connect without `SELF_SIGNED_CERT_IN_CHAIN` or a
   host-name error. Delete the file afterwards.
3. In Vercel, **add** `DATABASE_SSL_CA` (paste the whole PEM, including the
   `BEGIN` and `END` lines). Then **delete** `DATABASE_SSL_NO_VERIFY`. As
   long as it says `1` it wins and the CA is ignored (`sslFor()` in
   `src/lib/db.ts`).
4. Redeploy, then check:
   - `https://rempireshop.com/api/overrides/` answers **200**;
   - the Vercel logs show
     `[db] verifying the database certificate against DATABASE_SSL_CA.`;
   - the build log has **no** `migrate: failed`. A failed migrate step does
     not fail the build, so only the log shows it.
5. If it fails, put `DATABASE_SSL_NO_VERIFY=1` back and redeploy. The shop is
   back as before.
6. A new Railway database (§4) has a new CA, so export it again.

### Optional — other keys

Each one: create the new key at the provider, put it in Vercel, redeploy,
check, then delete the old key at the provider.

| Key | New one from | Check after |
|---|---|---|
| `RESEND_API_KEY` | Resend → API Keys (sending access, domain `rempireshop.com`) | a test letter from «Маркетинг» → «Письма» |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Cloudflare → R2 → Manage API tokens (Object Read & Write, bucket `rempire-media` only) | upload one photo in the panel, then delete it |
| `OPENAI_API_KEY` | platform.openai.com on the shop's account (`ho-openai`: delete Dim's old key, set a monthly limit) | `GET https://rempireshop.com/api/search/` says `enabled: true`; ask the panel's assistant one question |
| `TELEGRAM_BOT_TOKEN` | BotFather (the bot is Renat's) | `POST /api/admin/notify` test |
| `VAPID_*` | `npx web-push generate-vapid-keys` | every phone must subscribe again («Настройки» → «Оповещения на телефон»), so rotate only if leaked |
| `BACKUP_PASSPHRASE` (GitHub secret) | a new random value | run «Database backup» by hand. Older artifacts still need the **old** passphrase until they expire (30 days), so keep it in the login sheet until then. |
| Database password | `node tools/rotate-db-password.mjs` with the **old** URL in `DATABASE_URL`. Railway's `POSTGRES_PASSWORD` variable does not change the role. | update `DATABASE_URL` in Vercel and `BACKUP_DATABASE_URL` in GitHub, redeploy, run a backup |
| Montonio keys | Montonio partner portal (Renat's account) | `tools/montonio-live-check.mjs`; one real small payment and its refund |

After the last rotation, update the login sheet and tell Renat what changed.
Then run `npm run smoke -- https://rempireshop.com`.
