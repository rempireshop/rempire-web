-- 121_bundles_seed_price_fix.sql — two seeded set prices were the old, wrong
-- ones («Наборы», migration range 120–129).
--
-- 120_bundles.sql was written on 04.09 from the generator's output of that
-- day. On 09.09 the per-volume prices of 34 products were fixed («Цены 34
-- товаров стояли не у своих объёмов»), which moved two sets: styling-duo
-- 24,90 → 33,90 and hair-young-again 39,90 → 78,90. public/shop/bundles.js
-- and src/data/bundles.json were regenerated; the SQL was not, and its
-- `on conflict (id) do nothing` means no redeploy could ever correct a
-- database that had already been seeded. hair-young-again is 90 € of
-- Kevin.Murphy (28 + 28 + 34) and the table sold it for 39,90 €.
--
-- 120_bundles.sql now carries the right numbers for a fresh database; this
-- file is for the one that is already live. Guarded on the wrong price, so a
-- set Renat has since priced himself is left exactly as he priced it.

update bundles set price = 33.90, updated_at = now()
 where id = 'styling-duo' and price = 24.90;

update bundles set price = 78.90, updated_at = now()
 where id = 'hair-young-again' and price = 39.90;
