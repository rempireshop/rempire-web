# Audit brief — what changed since 14 September

For the Fable 5.1 review, 18.09.2026. This document is the whole context; the
run must not depend on any conversation.

## Scope

**Commit range `b6cbe37..9b7f48d` on `main`** — 170 commits, 290 files,
~56 000 lines added, 3 000 removed, between the evening of 14.09 and the evening
of 18.09. Everything in that range is code nobody has reviewed as a whole. Do not
audit the rest of the system: it was audited on 14.09 (below) and what that
audit found has been worked through.

Shop: REMPIRE STORE OÜ, cosmetics, Tallinn. One owner (Renat) on an iPhone 14,
3–5 orders a month, going live next week. Next.js 15 + Postgres (Railway,
Amsterdam) + a vanilla-JS single-page app `public/shop2/app.js` (~39 000 lines,
shop and admin panel in one, stored **CRLF**). Payments and shipping through
Montonio. Three languages: RU default, ET, EN.

## What the previous audit was, and what became of it

- `docs/audit-2026-09-14-unverified.md` — 347 raw findings, 22 subsystems × 2
  lenses.
- `docs/audit-2026-09-14-verified.md` — 276 confirmed after adversarial
  re-check, 4 refuted, 59 duplicates, 8 owner decisions.
- Rounds 19–21 fixed **203** of them. `docs/audit-2026-09-14-deferred.md` lists
  the 73 deliberately left, each with the fixer's reason. **Do not re-report a
  deferred item unless you can show the reason no longer holds.**
- **That audit is measurably stale.** Three separate times on 18.09 an agent
  found it wrong about code that had since moved: the salon till was rated HIGH
  for lacking idempotency it had carried since 07.09 (`pos_ref` + unique index);
  the checkout already had half the idempotency (`pendingOrder` + body
  signature); the 7-day unpaid cancel was already built and merely switched off.
  Treat its findings as places to look, not as facts about the current tree.

## Decisions already taken — do not relitigate

The owner answered twenty audit questions on 17.09 and eight go-live questions on
18.09. A finding that says "this should be the other way" about any of these is
noise unless it shows the implementation does not match the decision.

**17.09 (all implemented):** the funnel counts web orders only against
consenting sessions, and the figure is allowed to drop; «Топ товаров»/«Бренды»
are renamed to the value of goods, not pro-rated; the VAT rate is stamped on the
order at creation with the compile-time constant as the fallback for older rows;
unsubscribe completes itself when a human opens it and stays silent for a
robot, one press kept (a headless-browser scanner is an accepted residual); a
guest order lifts the stop list only for the signed-in address; abandoned-cart
reminders stay for first-time guests, bounded per address in the database;
search phrases are named in the privacy text; unpaid orders cancel after 7 days;
switching the unpaid flow on releases the backlog silently via a floor date; the
back-in-stock letter does not send at a counted zero; the partner welcome letter
goes on the first approval only; a sold-out counted size no longer hides the
whole product («нет в наличии» needs the whole ladder counted); a public
order-status endpoint with an HMAC token restores a held basket only on a
definite "not paid"; a cancelled order does NOT return its promo use; quoted
points are NOT reserved; blog price markers for new articles only; order search
on the server; returns marked answered by an explicit «Обработано»; the login
throttle is a database-backed ladder (a growing delay, never a lockout, falls
back on the in-memory map when the read fails); the rate screen edits the
stored row so an empty cell follows the tariff.

**18.09 (implemented unless noted):** a refused carrier registration is shown
on the order (stored, then reported as 502 `registration_failed`; a second press
repeats the refusal by design); one small default carton, **no weight
modelling** — deliberately, because Montonio bills `max(actual, volumetric)` and
volumetric is dimensions ÷ 5000, so the box is what is paid for; locker size
chosen at label time with an automated default from the last twenty labels;
open every country DPD serves for pickup points (22 countries; HU and RO out on
purpose — their only locker is Nova Post, which has no returns); hold an order
paid short — **NOT yet implemented**; tighten the two webhook checks and ask
Montonio on a mismatch — **NOT yet implemented**; a scheduled sweep for orders
stuck unpaid — **NOT yet implemented**; rebuild the tariff table with live keys
— blocked on keys arriving Sunday 21.09. Also: imported Shopify customers arrive
with **no** marketing consent, which is not the same as opted out.

## What the range contains — where to spend attention

Ordered by how much reviewing it has had. The first group has had none.

1. **Merges.** Roughly thirty branches were merged in four days, several
   touching `public/shop2/app.js` at once. Three times two branches
   independently fixed one bug and **git merged both without a conflict**; once
   it would have taken stock off twice on a cancel, once a `promo_consume_failed`
   guard now runs twice (kept deliberately, both are early returns), and two
   migrations were numbered `191` by two sessions (renumbered to 192). One
   hand-resolved conflict in `src/app/api/orders/route.ts` would have silently
   reverted decision 5 above if either side had been taken whole. **Look for
   the fourth one.** Doubled logic, a guard that runs on both sides of a merge,
   a decision that lost its teeth at resolution time, a comment that describes
   the pre-merge behaviour. `src/app/api/admin/shipments/route.ts` and
   `src/app/api/orders/route.ts` were both resolved by hand.
2. **Test fixtures written to match the code.** The shipping webhook handler was
   broken for months — Montonio nests the payload under `data`, the parser read
   the top level, every notification produced `200 no_status`, no order ever
   auto-closed on delivery — and the test was green because its fixture was flat.
   Since then several tests have been rebuilt from Montonio's own published
   payloads (`tests/montonio-docs-payloads.test.ts`). Find any test in the range
   whose fixture is shaped like our code rather than like the contract.
3. **Two copies of one rule.** A hand-kept twin of the blog sanitizer silently
   stripped the owner's picture presets from every prerendered article for
   months. It has been unified (`src/lib/blog-html.mjs`); so has the hidden-product
   predicate for the article shelf and the storefront grids. `public/shop2/app.js`
   necessarily mirrors several server constants (`SHIP_PICKUP_COUNTRIES`,
   `PARCEL_DEFAULT`, `LOCKER_SIZES`, the translation tables); `tests/shipping-parcel.test.ts`
   guards some. Find a mirror nothing guards.
4. **The Montonio integration**, read against the documentation on 18.09:
   `docs/montonio-shipping-audit.md`, `docs/montonio-payments-audit.md`,
   `docs/montonio-untested.md`. Both audits list recommendations deliberately not
   implemented, marked **[DECIDE]**. Do not re-report those. Do check that what
   *was* implemented matches the docs it cites — the refusal-message module
   `src/lib/montonio-problems.ts`, the readiness probe `GET /api/admin/montonio/`,
   the phone country-code table (it was `372` for 28 of 32 destinations), the
   `data`-nested webhook parser.
5. **Idempotency**, new this range: `db/migrations/180_idempotency.sql`,
   `src/lib/idempotency.ts` (`runOnce`: `ran` / `replayed` / `in_flight` /
   `mismatch`; only success is remembered; a 90 s lease), wired into orders,
   pos-orders, inventory moves, products, blog, reviews; clients mint keys in
   `app.js` and must reuse them on retry. Three routes (products, blog, reviews)
   are server-wired with **no client minting yet** — expected, not a finding.
   Gift-card refund refs are now deterministic; `redeemGiftCard` and
   `adjustLoyaltyPoints` use unique keys rather than the helper, on purpose.
6. **Money paths that cannot run in the sandbox.** Refunds («Refundable bank
   payments» is not activatable in test mode), bank payments themselves, a
   carrier refusing a registration, a real label PDF, address validation.
   `docs/montonio-untested.md` says what stands in for each. Judge the stand-ins.
7. **The rest of the range**, lightly reviewed by the agent that wrote it:
   per-size stock on the storefront (`stockByVariant`, a counted-empty size is
   greyed and unbuyable, an uncounted one still sells); one-rung size ladders for
   29 products and migration `194` folding their duplicate shelf rows; the blog
   cover focal point (`posts.cover_focus`, `src/lib/blog-cover.mjs`); article
   delete via `posts.deleted_at` (migration `195`; slugs are never reused);
   the assistant now told which article is open, with honest refusals; the
   «В пути» chip (it counted nothing and filtered to the wrong set since 07.09);
   the settings write queue (two PUTs in flight settled by whichever committed
   last); `giftAmountsPhrase` (`.map(eur)` passed the index as the language);
   the go-live reset tool `tools/go-live-reset.mjs`; the pricing grid
   `tools/delivery-pricing.mjs`; the go-live page `/golive/` with its Phase-B
   gate; the login ladder (`192_login_ladder_index.sql`); SEO alignment of
   `Offer.availability` with what the page shows.

## Things known to be wrong or open, so you do not spend budget on them

- The Google Shopping feed (`tools/build-merchant-feed.mjs`) points at the
  staging host and is not in the build. Known; go-live decision pending.
- A *pending* refund still sends the customer «Деньги возвращены». Known;
  owner decision pending (D9 in `montonio-untested.md`).
- `public/shop/legal.js` still names Shopify as the data processor. Known;
  unreachable; on the go-live list.
- The three unimplemented 18.09 decisions above.
- A single intermittent unit failure appeared once in four runs on 18.09 and
  did not reproduce. If you can name it, do.
- The browser suite: several specs wait 8 s for the login card where the
  suite's own helper waits 60, so a cold `next dev` produces false failures.
  Known; not a product fault.

## How to read the tree

- `public/shop2/app.js` is CRLF. Anything slicing it by source text and
  searching for `";\n"` silently matches the wrong place.
- `src/lib/og-card.ts` contains 418 NUL bytes of font data: **grep reports no
  lines at all**. Use `grep -a` or read it. A search of that file that finds
  nothing has proved nothing.
- `tools/prerender-shop2.mjs` lifts `trText()` out of `app.js` by source text.
  That lift failing is now a hard error, not a warning.
- `src/data/testplan.json` is the owner's acceptance list (187 checks). It is
  part of the change: behaviour changes there carry `mark` and `markedAt`.
- Days are Tallinn (`src/lib/day.ts`), never UTC. Four test files once passed
  locally and failed on CI at 00:19 for exactly this.
- Comments in this repository record guesses as confidently as facts. Several
  in the range assert things the documentation contradicts; some were corrected
  on 18.09, some were not. A confident comment is not evidence.

## What to produce

`docs/audit-2026-09-18-findings.md`. For every finding: the claim, the evidence
with `file:line` on both sides (ours and the contract or decision it violates),
the consequence for a real order or a real customer, a severity, and one of
four verdicts — **new**, **known-deferred** (cite the line in
`audit-2026-09-14-deferred.md`), **contradicts a decision** (cite which), or
**already fixed** (cite the commit). Order by consequence. Do not fix anything;
do not touch `main`. Where you are not sure, say so; where you have checked,
say how. Where this brief is wrong about the code, say that first — it was
written by the person who wrote the code, on the same day.
