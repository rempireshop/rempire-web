# Where we stopped — 17.09.2026

Rounds 19 to 22 are merged and pushed. `origin/main` is `7dc8d44`: 160 test
files, 3496 tests, 0 failures, `tsc` clean, 814 prerendered pages with 0
failures. Everything described below as done is live on staging.

## What happened on 17.09

**Dim answered all twenty owner-only questions** from the third decision page
(https://claude.ai/artifact/WFi2yVUHHHdkkNncCHWVcn, collection `decisions`, docs
`q1`..`q20`). He took every recommendation, tapping them one at a time over eight
minutes. What each one means in code is in the `rempire-r22-decisions` memory;
the short version is below.

Merged and pushed:

| | |
|---|---|
| The page build now **fails** when the translation lift fails | It used to write 542 ET and EN pages in Russian and exit 0 |
| A repeated tap no longer creates a second order, sale or stock movement | Key minted at commitment, reused on retry, three routes wired |
| One sold-out counted size no longer hides a whole product | «нет в наличии» now needs the whole size ladder counted |
| A guest order no longer lifts a stranger off the marketing stop list | Only a shopper signed in on that mailbox has proved it is theirs |
| Abandoned-cart reminders survive, bounded per address in the database | An in-memory bound gives a fresh budget on every cold start |
| «Снова в наличии» no longer sends when the counted stock is zero | The shop was contradicting itself in writing |
| The partner welcome letter goes on the first approval only | Two doors send it; both are gated now |
| Unsubscribing ignores robots and still costs a human one press | Three test-plan checks reworded to match |
| The VAT rate is stamped on the order | A filed month re-exports byte-identically forever |
| «Из корзины в заказ» is counted honestly | The figure is much lower than it was; the caption is now true |
| Failed logins meet a growing delay instead of a refusal | Still per-instance — see the correction below |
| Search phrases are named in the privacy text | The «Искали, но не нашли» report stays |

## Branches finished but NOT merged

- **`r22-shop`** — the public order-status endpoint and safe basket recovery
  (question 13), and blog price markers for new articles (question 16). Pushed,
  3552 tests green.
- **`r22-blogfig`** — on top of `r22-shop`. Fixes a real regression found while
  in there: `tools/lib/blog-export.mjs`, the sanitizer the prerenderer uses for
  articles, has **no `data-fig` handling at all**, so the picture sizes and
  placement Renat asked for in round 20 are silently stripped from every
  prerendered article page. `src/lib/blog.ts` handles it in six places. Second
  time that hand-kept twin has drifted.

## Branches still building when the session ended

`r22-panel` (rename «Топ товаров»/«Бренды» to the value of goods, server-side
order search, the «Обработано» button for returns, the rate screen editing the
stored row), `r22-idem-rest` (the seven remaining idempotency sites),
`r22-testplan` (all 173 checks brought level with the code). Check whether they
pushed before you assume they did not.

## First job next session

Merge those branches, regenerate (`minify-shop2` → `prerender-shop2` →
`check-prerender`), run the full suite, push. **`public/shop2/app.js` has had
two writers** — `r22-panel` and `r22-shop` both touch it, the second unavoidably
edits one line in the admin half — so expect a conflict there and resolve it by
keeping both sides, not by taking one whole. That mistake nearly reverted
question 5 during this round's merge and nothing would have failed to say so.

## Then: Dim re-tests, then two Fable 5.1 passes

The test plan marks each changed check so he can find them: **re-run** (behaviour
changed), **reworded** (text moved, his answer stands) and **new**. He is not
re-running all 173 — only the marked ones. **The Claude Design hand-off is
cancelled; he says the design is fine.**

Once he reports the re-test is clean, run **two separate Fable 5.1 passes**, in
this order:

1. **A regression review of the diff** since 14.09 — about 250 changes landed
   through heavy parallel merging, and merging is where this project bleeds. On
   17.09 alone: two branches fixed the same bug and git merged both without a
   conflict so both now run; the same pattern earlier in the round would have
   taken stock off twice on a cancel. No subsystem audit looks for this.
2. **A go-live readiness pass.** Not a code audit, and the more important of the
   two. The shop has run as staging and going live flips switches nobody has ever
   exercised. At least: the pages say `noindex, nofollow` and `robots.txt` is the
   staging policy; `PUBLIC_BASE_URL` unset makes the prerender write live URLs
   carrying noindex; Montonio sandbox versus live keys, the webhook URL and the
   shipping contract; `SESSION_SECRET` is now load-bearing for the order-status
   token and fails closed silently if unset, so basket recovery would never work
   and nothing would say so; `flows.unpaid` is still **off**; cron schedules; the
   `fra1` region; Railway backups; whether anything tells Dim when a payment
   webhook fails; the stale `public/shop/legal.js`, which still names Shopify as
   the data processor; DNS at ASCIO.

Do **not** run a fresh 22-subsystem audit. The 14.09 one is measurably stale —
three times on 17.09 an agent found it wrong about current code (the till was
rated HIGH for having no protection it has had since 07.09, the checkout already
had half the idempotency, the 7-day unpaid cancel was already built).

## Corrections worth carrying forward

- **The reason question 19 chose a growing delay over a shared counter was
  wrong.** Dim was told a database counter meant a write per login attempt. It
  does not: `writeAuditSafe(…, "admin.login.failed")` already writes every
  failure to Postgres on the existing path, so a durable ladder that survives a
  cold start costs one SELECT and zero extra writes. Told this, **Dim chose the
  database counter on 17.09** — being built on branch `r22-login`, which also has
  to settle the “Слишком много попыток” string in `app.js` that the delay left
  unreachable.
- **The conversion figure is now reported by the browser**, not read from the
  orders table, so someone loading a receipt URL could add to it. Consent-gated
  and rate-limited, and it is a vanity KPI rather than an accounting figure — but
  it is no longer tied to real orders.
- **The robot-proof unsubscribe does not close the whole class.** A scanner that
  opens links in a real headless browser (Defender for Office 365 does) would run
  the script and complete the unsubscribe. Closing that needs a click, which Dim
  rejected.
- **71 admin screenshots survive** in the session scratchpad under `handoff/shots`
  from 04.09. Irrelevant now that the hand-off is cancelled.

## Still open, nobody blocked on them

Thirty-odd deferred findings from rounds 19 and 21 that nobody has picked up; the
three content routes in `r22-idem-rest` do nothing until `app.js` mints keys for
them; AI-placed blog cards write empty anchors with no words or link, invisible
to a crawler; a custom product in a prerendered article shows its name with no
price, because the build's catalogue holds no owner-created products.
