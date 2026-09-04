-- 081_orders_sales_idx.sql — analytics agent (migration range 080–089)
--
-- Replaces orders_paid_created_idx (080_events.sql). Every money query in
-- src/lib/analytics.ts — «Аналитика» and «Обзор» alike — filters
-- `status in ('paid', 'shipped')`: an order is a sale once its money arrived
-- and stayed, and pressing «Отправлен» must not make it vanish from the
-- figures (PAID_STATUSES, top of that file). Postgres uses a partial index
-- only when the query's predicate implies the index's, and `status = 'paid'`
-- says nothing about 'shipped', so the 080 index went unused — dead weight
-- maintained on every order write — while those queries fell back to
-- orders_created_idx / orders_status_idx (001_core.sql). Harmless at this
-- shop's volume; this just puts the index back where the queries are.
--
-- The `where` below MUST stay literally in sync with PAID_STATUSES in
-- src/lib/analytics.ts — the same values, nothing more, nothing less. Change
-- one, change the other in a NEW 08x migration, never by editing this file:
-- migrations are recorded by name in _migrations (tools/migrate.mjs), so an
-- edited file never runs again. tests/analytics.test.ts reads the index back
-- out of pg_indexes and fails the moment the two drift.
--
-- Index-only, no column, no data touched — orders stays backend-core's table.
-- Create first, then drop, so the table is never without a covering index.
-- Runs on Postgres 13+ and on PGlite (the test suite).

create index if not exists orders_sales_created_idx
  on orders (created_at) where status in ('paid', 'shipped');

drop index if exists orders_paid_created_idx;
