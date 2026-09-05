-- 140_order_delivered.sql — order flow (migration range 140–149)
--
-- The order card in the admin got its last step: «Доставлен». It is a status
-- of its own — `delivered` — because the owner marks it by hand, after
-- «Отправлен», and the analytics have to keep counting the order as money
-- once it is there (an order that reached the customer is the most paid an
-- order gets). Two things in the schema spell out the list of statuses, and
-- both are widened here, together, so neither can drift:
--
-- 1. orders.status's check constraint (001_core.sql inlined it on the column,
--    so Postgres named it orders_status_check). The list here MUST equal
--    ORDER_STATUSES in src/lib/orders.ts.
--
-- 2. orders_sales_created_idx, the partial index every money query in
--    src/lib/analytics.ts leans on (081_orders_sales_idx.sql). Postgres uses a
--    partial index only when the query's predicate implies the index's, so
--    `status in ('paid', 'shipped', 'delivered')` needs the index to say the
--    same three words. The `where` below MUST stay literally in sync with
--    PAID_STATUSES in src/lib/analytics.ts — tests/analytics.test.ts reads the
--    index back out of pg_indexes and fails the moment the two drift.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never
-- runs twice and must never be edited once it has run anywhere; a further
-- status goes in a new 14x file. Runs on Postgres 13+ and on PGlite.

alter table orders drop constraint if exists orders_status_check;
alter table orders add constraint orders_status_check
  check (status in ('new', 'paid', 'failed', 'shipped', 'delivered', 'cancelled', 'refunded'));

-- Rebuilt rather than altered: a partial index's predicate cannot be changed
-- in place. Drop first, then create under the same name, so the analytics
-- test's "exactly one sales index" check keeps holding — at this shop's
-- volume the moment without it is a few milliseconds of sequential scan.
drop index if exists orders_sales_created_idx;
create index if not exists orders_sales_created_idx
  on orders (created_at) where status in ('paid', 'shipped', 'delivered');
