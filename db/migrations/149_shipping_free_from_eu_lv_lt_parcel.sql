-- 149_shipping_free_from_eu_lv_lt_parcel.sql — checkout/payments/shipping (range 140–149)
--
-- Dim, 08.09.2026 — the two numbers docs/audit/2026-09-07-eu-rates.md left to
-- the owner, questions 2 and 5. Both are money, so neither was guessed in code:
--
--   1. «Rest of EU — from €200». Free delivery outside the Baltics and Finland
--      starts at 200 € instead of 59 €. A 59 € basket to Greece used to ship
--      free against a 43.15 € courier — 73 % of the basket, and the shop earned
--      less from the bigger order than from a smaller one. Estonia, Latvia,
--      Lithuania and Finland keep their 59 €: at home a parcel costs 3–7 €, and
--      free delivery there is ordinary marketing rather than a subsidy.
--   2. The Latvian and Lithuanian parcel machine, 4.99 → 5.59. Those were the
--      last two cells the shop sold below cost. Under «Пакомат» the *shopper*
--      picks the carrier, so the price has to cover the dearest of them, and
--      the dearest a Latvian locker can be booked with is DPD at 5.58 incl.
--      VAT. 5.59 is the first price ending in nine cents that covers it —
--      Renat was not asked to lose 59 cents an order.
--
-- DEFAULT_SHIPPING_RULES in src/lib/shipping.ts and the storefront's mirror in
-- public/shop2/app.js already carry both numbers, but the seeded settings row
-- wins over those defaults in computeShipping(), so a database that has run the
-- migrations would go on charging 4.99 and giving Greece away. 030, 031 and 148
-- are not edited — all three have run on production.
--
-- Each statement is guarded, so nothing the owner has typed into «Настройки →
-- Доставка» is overwritten:
--
--   · The parcel cells move only while they still say 4.99, exactly as 031
--     raised the Estonian cells only while they still said the brief's numbers.
--     148 has already filled the cell on any row that lacked one, and jsonb
--     compares numbers by value, so 4.99 and 4.990 are the same cell here. A
--     cell that says anything else is a price somebody chose, and it stays.
--   · The 200 € floor is written only where there is no Europe threshold at
--     all. `freeFromByCountry` is a key no migration has ever created — 148
--     deliberately left the whole of free delivery alone — so the first
--     statement makes the empty object the second one writes into. A row that
--     carries something other than an object under that key is left as it is;
--     src/lib/shipping.ts falls back to the code defaults for it anyway.
--
-- Re-running is a no-op: every WHERE stops matching once its cell exists.
-- A database without the row is left without one — the code defaults price
-- that shop. Runs on Postgres 13+ and on PGlite
-- (the test suite, tests/shipping-migration.test.ts).

update settings
   set value      = jsonb_set(value, '{methods,parcel,LV}', '5.59'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,LV}' = '4.99'::jsonb;

update settings
   set value      = jsonb_set(value, '{methods,parcel,LT}', '5.59'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,LT}' = '4.99'::jsonb;

-- jsonb_set cannot create a key two levels down, so the map has to exist first
update settings
   set value      = jsonb_set(value, '{freeFromByCountry}', '{}'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{freeFromByCountry}' is null;

update settings
   set value      = jsonb_set(value, '{freeFromByCountry,EU}', '200'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and jsonb_typeof(value #> '{freeFromByCountry}') = 'object'
   and value #> '{freeFromByCountry,EU}' is null;
