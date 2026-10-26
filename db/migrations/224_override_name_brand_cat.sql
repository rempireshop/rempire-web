-- 224_override_name_brand_cat.sql — a catalogue product's name, brand and
-- section, the owner's to change (migration range 220–229).
--
-- The ~220 products that came from Shopify live in the committed catalogue
-- (src/data/catalogue*.json); everything the owner edits about them lives
-- here — price, stock, sizes, photos, texts, «Показывать в магазине». The
-- three things that never got a column were the name, the brand and the
-- section, so the product card said «их меняет Дим» and a rename meant a
-- code change and a deploy. Renat, 26.10.2026: «Не могу поменять название»;
-- Dim: he has to run his shop himself after 08.11.
--
-- NULL hands each field back to the catalogue file. The product's id — its
-- page address, the Merchant Center offer id, the stock key — never changes
-- with a rename, so links, Google's index and the feed's identity stay put;
-- an order keeps the name it was bought under (order lines carry their own
-- copy).
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never
-- runs twice and must never be edited once it has run anywhere. Runs on
-- Postgres 13+ and on PGlite (the test suite).

alter table product_overrides add column if not exists name text;
alter table product_overrides add column if not exists brand text;
alter table product_overrides add column if not exists cat text;
