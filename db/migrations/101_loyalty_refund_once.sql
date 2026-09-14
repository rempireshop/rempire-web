-- 101_loyalty_refund_once.sql — wholesale/loyalty (migration range 100–109)
--
-- Points spent on an order that is later refunded go back to the customer
-- (src/lib/loyalty.ts refundLoyaltyPoints, called from setOrderStatus() on the
-- move into `refunded`). Until 14.09.2026 they did not: «Использовать баллы»
-- took the points on the paid transition and no refund path ever touched the
-- ledger again, so a customer who had 30 points taken off a 100 € order got
-- the 100 € back and kept nothing of the 30.
--
-- The credit is one `adjust` row carrying the order id — the same shape the
-- `earn` and `redeem` rows have, and it reads as «Корректировка» with the
-- order number in the note on «Мои баллы». No new `reason` value, so the
-- check constraint from 100_tiers_loyalty.sql stands untouched.
--
-- This index is why it can only happen once. src/lib/loyalty.ts guards the
-- common case itself (select-then-insert in one transaction, exactly like
-- earnLoyaltyPoints); the index is the backstop for two refund doors landing
-- together — «Вернуть деньги» in the admin and Montonio's refund webhook —
-- and the unique violation is caught there and read as "already credited".
-- Manual adjustments (adjustLoyaltyPoints) carry no order id at all, so the
-- partial index never sees them.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never runs
-- twice and must never be edited once it has run anywhere. Runs on Postgres
-- 13+ and on PGlite.

create unique index if not exists loyalty_ledger_refund_once_idx
  on loyalty_ledger (order_id) where reason = 'adjust' and order_id is not null;
