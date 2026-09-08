-- 149_order_return_request.sql — order flow (migration range 140–149)
--
-- «Хочу вернуть заказ» — the tick a customer puts on a delivered order in
-- «Кабинет → Мои заказы» (POST /api/account/return-request/, src/lib/
-- returns.ts). Montonio has no return endpoint and hands the merchant no
-- return codes at all, so this is the whole of what the shop can honestly
-- record: that a return was asked for, and when.
--
-- Neither the tick nor the delivery mark it is counted from needs a column of
-- its own. Both live in the order's shipping jsonb —
-- `shipping.returnRequest = {"at": "<ISO>"}` and `shipping.deliveredAt` —
-- next to the shipment Montonio registered, which is where this order's other
-- fulfilment facts have always lived (saveShipmentOnOrder in
-- src/lib/shipping/montonio.ts). Nothing looks either of them up by value.
--
-- The one query that reads them across the whole table is «Сделать сегодня»
-- on «Обзор» — qAttention() in src/lib/analytics.ts, which counts the orders
-- still waiting for the owner's answer. This index is that count: partial, so
-- it holds only the handful of orders somebody has actually asked about, and
-- its predicate is spelled exactly as the query spells it, because Postgres
-- uses a partial index only when the query's `where` implies the index's. An
-- order that leaves «доставлен» — the refund moves it to «возврат» — leaves
-- the index with it, which is what makes the queue empty itself.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never runs
-- twice and must never be edited once it has run anywhere. Runs on Postgres
-- 13+ and on PGlite.

create index if not exists orders_return_requested_idx
  on orders (updated_at desc)
  where status = 'delivered' and (shipping -> 'returnRequest') is not null;
