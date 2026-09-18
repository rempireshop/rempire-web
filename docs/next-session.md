# Where we stopped — evening of 18.09.2026

`origin/main` is `78ceb7a`. **180 test files, 4171 tests, 0 failures** on the last
full run. The browser suite was verified clean for the first time: 694 passing,
and all 28 apparent failures proved to be a cold-server race, not the product.

This replaces the 17.09 version of this file; rounds 19–22 are long since merged.

## Tomorrow's first job — three decisions the owner made and nobody built

He answered these on 18.09. They were queued behind the payments hardening and
never started. He was told, and said to finish them on 19.09. They are the only
part of his twenty-eight decisions that is not implemented.

All three are spelled out, with the exact change, in
`docs/montonio-payments-audit.md` and `docs/montonio-untested.md` Part 5 — the
agent that found them deliberately did not implement them, because each changes
what counts as paid, what is refunded, or what is trusted from a webhook.

1. **An order paid short is still marked paid.** Stock comes off, gift cards are
   minted, the receipt letter goes. Montonio's own help centre warns their order
   reuse can let a customer pay less than the total. **His answer: hold the order
   and tell him** — nothing ships and no card is minted until he looks. He was
   explicit that the middle option, mark paid but hold the cards, is the worst of
   the three: it lets the parcel go, which cannot be undone, while holding the
   gift card, which could be reissued in seconds.
2. **Two documented webhook checks we skip.** The signature is verified correctly
   — that part was always right. But the store key is compared only when present,
   and the order id in the notification is never checked against the order we
   started. **His answer: tighten both, and ask Montonio on a mismatch** rather
   than refusing outright. The strict reading trades a small hole for a bigger
   one — a paid customer told they have not paid — and `fetchOrder()` now exists,
   so a mismatch can be a question instead of a verdict. That call did not exist
   when the audit was written.
3. **Nothing asks Montonio when a notification never arrives.** The money is
   taken and the order sits in «ждёт оплаты» for ever. **His answer: a scheduled
   sweep of orders stuck unpaid.** At 3–5 orders a month it costs almost nothing,
   and it is the only one of the two options that works while he is asleep.

Standing rules that apply: the test plan follows the code (187 checks in
`src/data/testplan.json`; mark what changes, and spend a re-test only where
behaviour genuinely changed for the tester), and run `node tools/og-pages.mjs`
afterwards — the link card bakes the check count in and nothing enforces it.

## Running when we stopped

**The Fable 5.1 audit**, started by Dim on the evening of 18.09, scoped to
`b6cbe37..9b7f48d` — everything since 14.09, 170 commits, 290 files. Its brief is
`docs/audit-2026-09-18-brief.md` and is self-contained. It will find the three
decisions above missing; that is expected and correct.

It was asked for `docs/audit-2026-09-18-findings.md`, every finding carrying one
of four verdicts — **new**, **known-deferred**, **contradicts a decision**,
**already fixed** — so the output sorts itself. Read the known-deferred ones
against `docs/audit-2026-09-14-deferred.md` before acting on any of them.

## Waiting on the owner, not on us

- **Sunday 21.09, with Renat:** finish the Montonio account and get **live API
  keys**. That one meeting unlocks the real price table
  (`node tools/delivery-pricing.mjs --units 3`, see `docs/delivery-pricing.md`),
  which produces the break-even figures Renat needs to set his flat prices. The
  locker option currently looks dearer than the courier in most of the new
  countries **because the table was quoted for a 30×30×30 box**, and the box the
  shop now declares is a fraction of that. Rebuilding it is what makes the
  feature worth having.
- **Monday 22.09, Harri at Montonio:** the draft sits in Dim's Gmail, in the
  thread, needing only the time. The first block is the one that matters —
  refunds and bank payments cannot be exercised in the sandbox at all, so how
  does a merchant validate them before a real customer's money is involved?
- **Renat, open since 14.09:** which Kevin.Murphy sprays are pressurised
  aerosols. Decides whether they may ship abroad at all, separately from price.
  (Weighing the products was **cancelled** on 18.09 — see `docs/go-live.md`.)
- **Three open decisions:** whether to list on Google Shopping at all (the feed
  must not be submitted as it stands), whether a *pending* refund should still
  tell the customer their money is back, and whether a hidden catalogue product
  should keep nagging in the low-stock counts.

## Smaller things, none blocking

- Several e2e specs wait 8 s for the login card where the suite's own helper
  waits 60. A cold `next dev` compiles routes on demand, so CI will keep
  producing false failures until those specs use the helper.
- One intermittent unit failure appeared once in four full runs on 18.09 and did
  not reproduce. Not identified.
- `public/shop/legal.js` still names Shopify as the data processor. Unreachable
  today; on the go-live list.

## Traps that cost real time this week

- `public/shop2/app.js` is stored **CRLF**. Anything slicing it by source text
  and searching for `";\n"` silently matches the wrong place — four false
  failures on 18.09.
- `src/lib/og-card.ts` holds 418 NUL bytes: **grep prints no matching lines at
  all**. A search of it that finds nothing has proved nothing. Use `grep -a`.
- Two branches fixing one bug **merge without a conflict** — there is no shared
  line to conflict on and nothing in the tooling notices. It happened three times
  this week; once it would have taken stock off twice on a cancel. Two sessions
  also picked migration `191` independently. Talk before building.
- `git stash` is shared across every worktree in this repository.
- Regenerate the prerender with `PUBLIC_BASE_URL` **unset** — the committed
  `index.html` is that build, and setting the staging base yields 24 lines of
  unrelated diff.
