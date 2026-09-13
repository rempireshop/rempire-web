-- 092_stock_move_edit.sql — inventory agent (migration range 090–099)
--
-- One more `reason` for the ledger: 'edit'.
--
-- «Склад» → «Править» has four boxes — the barcode, the «мало» threshold, the
-- count, and «Причина (видна в истории)» under them. Only a changed COUNT
-- wrote a stock_moves row, so the reason typed beside a corrected threshold
-- (or a barcode stuck on by hand) was read, sent nowhere and lost, under a
-- «Сохранено ✓» — the owner's own words after the acceptance run: «Reason is
-- not stored.» A card change is a correction like any other and belongs in
-- the same history, with the sentence that explains it.
--
-- 'edit' rows always carry delta 0: nothing left or reached the shelf, only
-- the card describing it changed. So stock_levels.qty stays the sum of every
-- delta ever applied (090_inventory.sql), exactly as before.
--
-- Deliberately NOT one of TRACKING_REASONS (src/lib/inventory.ts): binding a
-- barcode or raising a threshold is not counting a shelf, and a variant
-- nobody has counted must stay "don't track" — otherwise the first barcode
-- Renat sticks on a bottle would flip that bottle to «нет в наличии» in the
-- shop. That is the same guard the module doc explains for a sale.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so it applies on a
-- database that already has 160_newsletters.sql. Postgres 13+ and PGlite:
-- the 090 file declares the check inline on the column, which Postgres names
-- `stock_moves_reason_check`.

alter table stock_moves drop constraint if exists stock_moves_reason_check;
alter table stock_moves add constraint stock_moves_reason_check
  check (reason in ('sale_web','sale_pos','goods_in','adjust','return','edit'));
