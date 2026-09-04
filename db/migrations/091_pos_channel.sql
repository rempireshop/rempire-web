-- 091_pos_channel.sql — inventory agent (migration range 090–099)
--
-- Tags every order with where it was made. Additive to backend-core's orders
-- table (001_core.sql) the same way analytics' orders_sales_created_idx (081, formerly orders_paid_created_idx)
-- (080_events.sql) is: one column/index added from another range's file,
-- never a rewrite of the table backend-core owns.
--
-- 'web' — the storefront checkout (Montonio or the mock provider).
-- 'pos' — POST /api/admin/pos-orders, the in-salon quick sale (src/lib/orders.ts
--         createOrder({channel:'pos', ...})), paid on the spot with cash or a
--         card terminal, never through Montonio.
--
-- analytics reads `orders` directly (docs/analytics.md), so a 'pos' order
-- counts in revenue/order-count/top-products the moment it is paid — no
-- change needed there, this column is purely descriptive for the admin list.

alter table orders add column if not exists channel text not null default 'web'
  check (channel in ('web','pos'));

create index if not exists orders_channel_idx on orders (channel);
