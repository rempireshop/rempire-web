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

## Two more decisions, answered by Dim at 22:55 on 18.09

**7 — The return window is 30 days everywhere.** It was written as two numbers:
30 in `src/lib/returns.ts`, the legal pages and the returns form; **14** on the
prerendered delivery page (`app.js:7275`, worded as the shop's own offer) and the
product accordion (`:12272-12281`), in all three languages, plus the checkout
trust list (`:16726`). 30 is what the code already enforces and what the legal
text promises, so the three 14-day places are the ones that are wrong. EU law's
14 days is a floor, not our offer. Changing them means re-running the prerender,
and `node tools/i18n-gaps.mjs` must still print `untranslated: 0`.

**8 — The per-unit weight estimate goes; the box is what is declared.**
`src/lib/shipping/montonio.ts:948-953` computes `min(30, max(0.3, 0.4 × units +
0.2))` and `:1172` sends it on every `POST /shipments`, so from three units on
the guess is the chargeable weight rather than the carton (F24). Removing it
restores the decision as written: one small carton, ~1.1 kg volumetric, one
stable price. He accepts the edge case — a genuinely heavy order re-weighed and
surcharged — as the small loss he already said he would take. The panel keeps its
override, so an explicit `opts.weight` must still win.

Still open from before, and none of it blocks tonight: Google Shopping, the
pending-refund letter, hidden products in the low-stock counts, and Renat on the
aerosols.
