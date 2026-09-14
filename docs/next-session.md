# Where we stopped — 14.09.2026

Paused to keep tokens free for urgent fixes. Resume **Thursday 18.09.2026**.

Everything below is merged, pushed, CI-green and live on staging. Nothing in the
repository is half-finished.

## Done and deployed

| Was | Now |
|---|---|
| Customer card opened scrolled to its middle | Opens at the top. One missing line on the row that opens it; the article editor had the same omission |
| Carrier chip went solid black behind black logos | Its own rule, not the bank one fixed earlier. Outline instead of fill |
| Assistant offered «analytics for this week» and could not answer | Knows the week: takings, orders, average order, per-day, change against the previous week |
| Reviews attached to nobody | The moderation queue shows the author, or «без аккаунта». The review form tells a signed-in shopper the review is kept with their account |
| Checkout e-mail filled in a second late | Delivered inside the page itself: 0 ms against 49–2345 ms |
| Every pickup point was called «Пакомат» | «Пакомат» / «Пункт выдачи» / «Почта», from Montonio's own type field |
| Venipak could be posted with no carrier from a stale tab | The order validator accepts it again on arrival while nothing offers it |

### The region move — DONE

The database was always in Amsterdam (Railway, EU West). The **functions** had no
region set, so they ran in Washington, and every query crossed the Atlantic.
They now run in Frankfurt, ten milliseconds from the database.

Set in two places, which agree: `"regions": ["fra1"]` in `vercel.json` (the one
that wins, and the one that survives a rollback) and the Function Region field in
the Vercel dashboard, which Dim set on 14.09.

Measured from Estonia, before against after:

| | Washington | Frankfurt |
|---|---|---|
| Function with one database query | 258 ms | 73–193 ms |
| Function with no query | 392 ms | 110 ms |
| Product page | 305–453 ms | 83 ms |
| Static file | 48 ms | 25 ms |

The legs were: Estonia→Stockholm 47 ms, Stockholm→Washington 135 ms, and
Washington→Amsterdam **86 ms per sequential wave of queries** — three waves on the
overview, about fourteen on the checkout. Reasoning and verification commands in
`docs/region-move.md`.

**Cold starts are now the largest remaining delay and are not fixed.** At three to
five orders a month the functions are asleep most of the time, so the first
request after a quiet spell is still slow. That is why the one-query figure above
is a range rather than a number.

## Stopped mid-run — start here

1. **Full system audit.** All 22 subsystems were swept from two angles and produced
   **347 distinct findings, 31 critical and 115 high**, saved in
   `docs/audit-2026-09-14-unverified.md`. The adversarial verification never ran, so
   **none of them are confirmed**. On the day they were written, skeptics refuted
   several confident findings and two of Claude's own stated facts turned out to be
   wrong. Treat that file as places to look, not as defects. Verify first, fix only
   what survives.
2. **Claude Design hand-off for the admin.** Screenshots of every admin screen at
   375 and 1280, plus four documents: a description per section, the design system,
   the full content inventory with Estonian and English, and the constraints that
   must not be broken. 71 screenshots were captured but lived in a temporary session
   folder and are gone, so capture must be redone. None of the writing was done.

## Waiting on Dim

- **Nova Post pickup points in nine more countries.** Poland 17.89 → 7.85 €,
  Germany 29.79 → 12.56 €, and Hungary and Romania have no pickup option from any
  other carrier. Blocked on one thing: Nova Post supports no returns at all.
- **Size-based pricing.** The catalogue holds no weight and no dimensions for any of
  220 products; 113 carry a volume. Until that exists a basket cannot be turned into
  a parcel.
- Whether to rename the «Пакомат» price column, whether to filter out the Latvian
  and Lithuanian counters, and whether to backfill the point type on old orders.
- The Montonio letter is drafted; the earlier one has been sent and is unanswered.

## Two tests to watch

`admin-assistant.spec.ts:303` (the microphone language button) and
`admin-sections.spec.ts:109` (publishing a review with an undo) failed once on the CI
run for a commit that changed only `vercel.json`. They pass now, but the code around
both changed in the same push, so it is unknown whether they were flakes or were
fixed. Do not write them off as flakes.

## Two corrections Claude had to make to itself

- The inference that the database sat beside the functions came from timing
  `/api/testplan/`, which for an anonymous request returns a constant from a file and
  never queries the database. Measure only routes that actually query.
- Nova Post does have parcel lockers — 979 across Estonia, Latvia and Lithuania. The
  earlier claim came from the contract-price endpoint refusing a parcel-machine
  request, which is about the method Montonio sells the carrier under, not the
  hardware. Of 10,432 points, **1,295 are not machines**: EE 249/3, LV 271/129,
  LT 459/110, FI DPD 1519/1053.
