-- 213_cart_returned_by_letter.sql — «Вернулись по письму» (admin redesign 1a)
--
-- «Аналитика → Ещё цифры → Корзины, подарочные карты и чат» shows how many
-- shoppers came back after the abandoned-cart letter and ordered (the design's
-- row; Dim, 25.09.2026, q41: «build it — a small server count»).
--
-- The fact is known for exactly one moment and then thrown away: an order
-- marks its address's cart recovered (markCartRecovered, src/lib/customers.ts)
-- and, in the same UPDATE, clears `reminded_at` — rightly, so the next basket
-- this person abandons gets its own reminder. After that nothing says a letter
-- had gone out before the order came, and the cart row itself does not last:
-- the basket emptied after checkout deletes it (saveCart).
--
-- So the moment is written down where nothing clears it — one row, one time:
--
--   cart_returns   a row when an order arrives from an address whose cart HAD
--                  been reminded (the first letter, or the discounted second
--                  one, which needs the first). No address, no order, no
--                  basket: the count is all the panel shows, and a table of
--                  bare timestamps is nothing anybody could be found in.
--
-- The count for a period is one index range read.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never runs
-- twice and must never be edited once it has run anywhere. Runs on Postgres
-- 13+ and on PGlite (the test suite).

create table if not exists cart_returns (
  id bigserial primary key,
  at timestamptz not null default now()
);

create index if not exists cart_returns_at_idx on cart_returns (at);
