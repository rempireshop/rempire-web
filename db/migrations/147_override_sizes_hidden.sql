-- 147_override_sizes_hidden.sql — the product editor's last three dead
-- controls, made real (migration range 140–149).
--
-- Until now a catalogue product's size ladder came only from the generated
-- file public/shop/catalogue2.js, and product_overrides.price patched the
-- first rung of it. So «+ Размер» and «×» were `disabled title="Объёмы
-- заводит Дим"`, and «Показывать в магазине» was a switch permanently on
-- with no column behind it. Dim asked for all three to work.
--
-- Two columns:
--
-- 1. `sizes` — the WHOLE size ladder as the owner last saved it, not a patch:
--    [{"size":"100 мл","price":12.5}, …], one entry per rung, `size` may be ""
--    for the single-volume case. A whole list rather than «added rungs» is
--    what lets the storefront, the cart, the warehouse and the editor agree
--    on one answer to «what sizes does this product have» — a merge of file
--    and override cannot express a rung the owner removed, and a stock key
--    (`<id>::<size>`, src/lib/inventory.ts) that no longer matches any rung
--    would strand the shelf count under a name nothing asks for. `null`
--    hands the ladder back to the catalogue file.
--
--    price stays the source of truth for the FIRST rung either way, so an
--    older client that only knows about `price` keeps working: mapOverride()
--    writes price into sizes[0].price when both exist.
--
-- 2. `hidden` — the product is not for sale and not for showing: it leaves
--    the catalogue, the search, the sets, the sitemap route and the public
--    feed. Not the same thing as stock='out' («нет в наличии» is still a
--    page a customer may land on and wait for); not the same thing as a
--    custom product's active=false, which is that row's own column
--    (131_custom_products.sql) — this one is for the file's products, which
--    have no row to switch off.
--
-- Recorded by name in _migrations (tools/migrate.mjs): never edited once it
-- has run anywhere. Runs on Postgres 13+ and on PGlite.

alter table product_overrides add column if not exists sizes  jsonb;
alter table product_overrides add column if not exists hidden boolean not null default false;

-- The storefront asks «which products are hidden» on every boot through
-- GET /api/overrides; on a shop where nothing is hidden that is the whole
-- table scanned for nothing. A partial index keeps it to the few rows that
-- are actually true.
create index if not exists product_overrides_hidden_idx
  on product_overrides (product_id) where hidden;
