# Night of 18→19.09 — what is being built, in what order

Written 22:40 on 18.09, after reading `docs/audit-2026-09-18-findings.md` (56
findings: 1 MED-HIGH, 10 MED, the rest lower). The 5-hour budget was at 97 % when
the audit landed, so the work starts when it reopens at 00:00 and this file is
the running order. Dim is asleep; questions for him are at the bottom.

## Order of work

**1 — The three payment decisions.** His instruction, and untouched since 18.09.
One agent for all three, because they share `notify/route.ts`, `settle.ts` and
`fetchOrder()`, and two agents in those files is how this project has produced
duplicate fixes three times this week.

- hold an order paid short instead of marking it paid; nothing ships, no gift
  card is minted, he is told
- the store key compared only when present and the order id never compared —
  tighten both, and on a mismatch **ask Montonio** (`fetchOrder()`) rather than
  refuse, because telling a paid customer they have not paid is the worse hole
- a scheduled sweep for orders stuck unpaid, because a lost notification
  otherwise leaves the money taken and the order in «ждёт оплаты» for ever

**2 — F1, MED-HIGH: «Вернуть деньги» pays twice on a mixed card + bank order.**
The gift half's reference is derived from the card ledger, the money half's from
`orders.payment`; between the credit and the fold they disagree, and a retry
re-splits. 100 € order, 20 € refund, failed fold, second press → customer has
40 €. Same agent takes **F4** (a refund whose answer is lost records nothing and
the retry's refusal names a list the refund is not in) — one file, one head.

**3 — F2, F3, F8, F9, F35: stock.** Sets are sold with a part counted to zero;
«Оплачен» after a cancel never re-takes a set's parts or an old one-size line, so
«остатки не сходятся» for good. F3 is the audit's answer to the brief's «find the
fourth merge» and it is real.

**4 — F12, F13, F14: the readiness screen tells him it is ready when it is not.**
Green «Возвраты включены» from a card order while bank refunds are off; green
«Montonio сообщает о посылках» for a webhook pointing at the staging host; wrong
keys shown as «Проверяем…» for ever. All three land on Sunday's key-setting, so
they are worth more than their severity suggests.

**5 — F15, F16, F37, F38: what the panel says.** The order card still tells him
to re-create a refused label, which the server refuses by design; every
trilingual explanation lives in a 2.6-second toast and the journal prints a code.
All in `app.js`, so **one agent owns `app.js`** for the night.

**6 — F31, F18, F47, F52, and § 9's return window.** Build ignores the stock
override; `/golive/` hands its own safeguards to anyone unauthenticated; the
reset tool deletes real-but-unconsented people without listing them.

Everything else: `docs/audit-2026-09-18-findings.md` is the list, and § 8 says
which of the 73 deferred entries this range already closed.

## Rules for the night

- One agent per file, not one per finding. `public/shop2/app.js`,
  `src/lib/orders.ts` and the refund route each have exactly one owner.
- The test plan follows the code: 187 checks in `src/data/testplan.json`, mark
  what changes, then `node tools/og-pages.mjs`.
- Nothing merges to `main` without the full suite green (180 files, 4 171 tests)
  and `tsc --noEmit` clean.
- `app.js` is CRLF; `og-card.ts` greps as binary; regenerate the prerender with
  `PUBLIC_BASE_URL` unset.

## For Dim, in the morning

1. **The return window is written as two numbers.** 30 days in `returns.ts`, the
   legal pages and the returns form; **14 days** on the prerendered delivery page
   and the product accordion («14 дней на возврат по закону ЕС»), in three
   languages. Which is the shop's actual policy? EU law gives 14 as the floor, so
   30 is a promise the shop may be making by accident — or deliberately, and then
   the delivery page is wrong. This is a promise to customers, so I am not
   choosing for you.
2. **The parcel weight.** Your decision was «one small carton, no weight
   modelling», but the code still computes `0.4 kg × units + 0.2` and sends it on
   every booking, so from three units on, that guess is what Montonio bills, not
   the box. Removing it declares the box (~1.1 kg volumetric); the audit notes
   declaring too little invites a surcharge. Remove the estimate, or keep it and
   amend the decision?
3. Still open from before: Google Shopping, the pending-refund letter, hidden
   products in the low-stock counts, and Renat on the aerosols.
