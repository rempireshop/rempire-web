-- 201_mail_budget.sql — the day's letter allowance (migration range 200–209)
--
-- Dim, 21.09.2026: Resend's free plan gives 100 letters a day and 3 000 a
-- month. Enforcement is soft — he has watched it pass 100 and stop nearer 200
-- — so the cap the shop obeys has to be OUR number, not a guess at theirs, and
-- the only way to obey a number is to count.
--
-- WHAT THIS PROTECTS. Not the newsletter: a slow «Рассылка» costs nobody
-- anything. The letter that must never be the one refused is «Заказ принят» —
-- a customer who has paid and gets nothing back. So the day is split: a cap
-- (100 out of the box) and a reserve inside it (30) that marketing may not
-- touch. Transactional mail never consults any of this and always tries;
-- marketing asks first and stops at cap − reserve. Both numbers live in
-- `settings.mail_budget` and are the owner's to change (src/lib/mail-budget.ts).
--
-- ONE ROW PER DAY PER CLASS, and the class is the point: a single counter
-- could say «96 letters today» without saying whether an order confirmation
-- still fits. `transactional` is everything the shop owes somebody — order
-- letters, gift cards, invoices, the «снова в наличии» alert a shopper asked
-- for by name, the owner's own pings; `marketing` is «Рассылка» and the three
-- letters nobody asked for (abandoned cart, its discounted follow-up,
-- the birthday greeting).
--
--   day         the UTC calendar day, 'YYYY-MM-DD', written by the app
--               (utcDay()) and never derived here. Text rather than `date`
--               because the two drivers disagree about what a date column
--               comes back as — node-postgres builds a JS Date at the
--               server's local midnight, which is a different day either side
--               of it — and this column is compared, never arithmetic.
--
--               UTC, deliberately, where db/migrations/181_cart_writes.sql
--               chose Tallinn: that counter bounds a person and people live in
--               Tallinn, this one bounds a provider and Resend resets its
--               allowance at UTC midnight. A counter that rolled at 00:00
--               Tallinn would hand out three hours of the next day's letters
--               against a quota that had not moved.
--   kind        'transactional' | 'marketing'
--   n           letters of that class Resend ACCEPTED today. A send that was
--               skipped (no key, no address) or refused never counts: the
--               allowance is spent by what actually left.
--   blocked_at  Resend itself refused a send of this class for its own daily
--               quota (a 429 that names the quota, not the per-second rate).
--               The day is over for marketing from that moment, whichever
--               class hit the wall — it is one account and one allowance —
--               and the run stops instead of hammering the same refusal
--               address by address.
--   warned_at   the owner has been told, once, that today's marketing is
--               finished. Claimed atomically on the 'marketing' row (the
--               `where` on the upsert below is what makes «once» true when two
--               batches discover it in the same second), and the notice goes
--               out by Web Push — never by e-mail, which is the thing that has
--               run out.
--
-- Two rows a day, seven hundred a year. Nothing prunes them and nothing needs
-- to: the history is the only answer to «how close did we come last month»,
-- and the month's 3 000 is the next wall after this one.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never runs
-- twice and must never be edited once it has run anywhere. Runs on Postgres
-- 13+ and on PGlite (the test suite).

create table if not exists mail_sends_daily (
  day        text not null,                       -- UTC calendar day, 'YYYY-MM-DD'
  kind       text not null
             check (kind in ('transactional','marketing')),
  n          int not null default 0 check (n >= 0),
  blocked_at timestamptz,                         -- Resend said the day is spent
  warned_at  timestamptz,                         -- the owner has been told, once
  updated_at timestamptz not null default now(),
  primary key (day, kind)
);

-- The only read there is: both rows of one day, by the primary key's own
-- leading column. No second index — the table is two rows wide per day.
