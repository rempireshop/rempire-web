-- 052_marketing_consent.sql — account-flows (migration range 050–059)
--
-- What the tick «Хочу получать скидки и поздравление ко дню рождения» really
-- means, and a way out of it that works from the letter itself.
--
-- Until now `customers.marketing` was a bare boolean: nobody could say when it
-- was ticked or where (the checkout, the account form), and «Отписаться» at
-- the bottom of the three marketing letters only opened the account page —
-- nothing for a guest who has no account, and nothing at all for the
-- abandoned-cart reminder, which never looked at the tick. The owner (Dim,
-- 10.09.2026) chose the honest minimum: stamp the consent, make the link
-- real, send the one-click header. No newsletter.
--
-- Three stamps on the customer's row:
--   marketing_at      when consent was last switched ON
--   marketing_source  where — 'checkout' | 'account' | 'admin'
--   marketing_off_at  when it was last switched OFF (the account tick, or the link)
--
-- And one small table. An address in mail_optouts gets no marketing letter
-- (abandoned cart, birthday) whether or not a customers row exists — a guest
-- with a cart has none. `kind` records which letter's link was used
-- ('marketing' | 'backstock' — the latter also cancels that person's pending
-- «снова в наличии» alerts), `source` how ('link' — the page, 'one-click' —
-- the mail client's List-Unsubscribe-Post). A later tick at the checkout or
-- in the account takes the address out again: the latest expression of will
-- wins (src/lib/consent.ts).
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never runs
-- twice and must never be edited once it has run anywhere. Runs on Postgres
-- 13+ and on PGlite.

alter table customers add column if not exists marketing_at timestamptz;
alter table customers add column if not exists marketing_source text;
alter table customers add column if not exists marketing_off_at timestamptz;

create table if not exists mail_optouts (
  email  text primary key,               -- lower-cased by the app
  at     timestamptz not null default now(),
  kind   text not null,                  -- 'marketing' | 'backstock' — which link
  source text not null default 'link'    -- 'link' | 'one-click'
);
