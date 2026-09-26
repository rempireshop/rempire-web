-- 215_low_threshold_one.sql — «мало» only on the last unit
--
-- Dim, 26.09.2026: 0 = «нет», 1 = «мало», 2 or more = «в наличии». On go-live
-- day the real per-size counts come over from Shopify and the shelf is thin —
-- 65 sizes hold one bottle, 103 hold two — so with the old default of 2 all
-- 168 of them would have read «мало» on the first morning, and the word would
-- have stopped telling the owner anything.
--
-- The threshold stays his to change per size on «Склад» → «Править»; only the
-- DEFAULT moves, from 2 (090_inventory.sql) to 1. src/lib/inventory.ts
-- (deriveState's fallback, the row move() creates on a first count, the row
-- «Склад» draws for a size with no row yet), public/shop2/app.js and
-- tools/seed-stock.mjs say 1 alongside this file.
--
-- The rows already written: 2 was the only default there ever was, and
-- nobody has chosen another value on purpose yet, so every 2 is a default
-- and becomes 1. Any other value — 0, 3, 5 — is one the owner typed, and
-- stays exactly as it is.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never runs
-- twice and must never be edited once it has run anywhere. Runs on Postgres
-- 13+ and on PGlite.

alter table stock_levels alter column low_threshold set default 1;

update stock_levels set low_threshold = 1 where low_threshold = 2;
