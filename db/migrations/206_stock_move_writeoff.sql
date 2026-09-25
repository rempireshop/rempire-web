-- 206_stock_move_writeoff.sql — «Списание» as a ledger reason of its own
--
-- Dim, 25.09.2026 (admin redesign 1a, q41): «Списание» is its own type in
-- «История склада». Until now the scanner's «Списать −N» wrote 'sale_pos',
-- so a broken or expired bottle read «продажа в салоне · сканер» in the
-- history and was counted under «Продажи» — a sale that never happened.
--
-- 'writeoff' rows always carry a negative delta (move() in
-- src/lib/inventory.ts refuses a positive one) and, like a sale, they are
-- skipped on a size nobody has counted yet: writing off an uncounted bottle
-- must not flip it to «нет в наличии». It is NOT one of TRACKING_REASONS.
--
-- Rows written as 'sale_pos' by the scanner before today stay what they
-- are: nothing in the row says which of them were write-offs.
--
-- Same shape as 092_stock_move_edit.sql: the 090 file declares the check
-- inline on the column, which Postgres names `stock_moves_reason_check`.
-- Postgres 13+ and PGlite.

alter table stock_moves drop constraint if exists stock_moves_reason_check;
alter table stock_moves add constraint stock_moves_reason_check
  check (reason in ('sale_web','sale_pos','goods_in','adjust','return','edit','writeoff'));
