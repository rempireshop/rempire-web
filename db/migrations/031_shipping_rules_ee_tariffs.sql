-- 031_shipping_rules_ee_tariffs.sql — checkout/payments/shipping (migration range 030–039)
--
-- Raises the two Estonian prices in settings.shipping_rules from the brief's
-- numbers (parcel machine 3.49, courier 5.99 — what 030 seeded) to the sourced
-- carrier tariffs: 5.47 and 10.84 (docs/shipping.md § «Тарифы Montonio»,
-- src/data/montonio-tariffs.json, researched 03.09.2026). The brief's prices
-- sat below every Omniva/SmartPosti/DPD business-list tariff for Estonia, so a
-- database that ran 030 charged less for a delivery than the delivery cost, in
-- the shop's home market. DEFAULT_SHIPPING_RULES in src/lib/shipping.ts already
-- carries the new numbers; the row wins over those defaults in
-- computeShipping(), so it has to move too. 030 itself is not edited: it has
-- already run on the production database (2026-09-03).
--
-- Each cell is corrected only while it still says the brief's number, so a
-- price the owner has since typed into Настройки → Доставка (or filled with
-- «Заполнить по тарифам Montonio») stays as it is — one cell at a time: an
-- edited parcel price does not shield a still-unedited courier price. Nothing
-- else in the row (LV/LT, default, freeFrom, carriers, markup) is touched, and
-- a database without the row is left without one — the code defaults price
-- that shop. Re-running is a no-op: the WHERE no longer matches anything.
--
-- jsonb compares numbers by value, so 3.49 and 3.490 are the same cell here.
-- A missing cell makes `#>` yield null, and null never equals — no update.
-- Runs on Postgres 13+ and on PGlite (the test suite, tests/shipping-migration.test.ts).

update settings
   set value      = jsonb_set(value, '{methods,parcel,EE}', '5.47'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,EE}' = '3.49'::jsonb;

update settings
   set value      = jsonb_set(value, '{methods,courier,EE}', '10.84'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,EE}' = '5.99'::jsonb;
