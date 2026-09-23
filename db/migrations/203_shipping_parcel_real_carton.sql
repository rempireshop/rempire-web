-- 203_shipping_parcel_real_carton.sql — the stored box follows Renat's carton
-- (migration range 200–209)
--
-- Renat measured his carton on 22.09.2026: 25 × 18 × 8 cm, and PARCEL_DEFAULTS
-- in src/lib/shipping/parcel.ts says so. On 23.09.2026 the panel's «Коробка
-- магазина» still said 25 × 18 × 10 — the code default of the days before,
-- frozen into settings.shipping_parcel. Nobody typed it: noteLockerSize() wrote
-- the WHOLE cleaned object back every time a label was made, defaults included,
-- so the first label ever printed froze the carton of that day. (Fixed in the
-- same commit: it writes `recent` alone now.)
--
-- Those 2 cm are money abroad. DPD's XS and S drawers are 8 cm tall; a 10 cm
-- box is an M, and the checkout prices the 8 cm box: DPD to Austria is 16.80 €
-- ex VAT as XS and 24.00 € as M. Wherever Montonio asks for dimensions the
-- label would have declared the bigger box and been billed for it.
--
-- The same row carries the locker door the label screen offers first. It said
-- M — the seed of the same days. Since 23.09.2026 the seed is S: the carton
-- goes through Unisend's S (8 × 35 × 61) and SmartPosti's S (12 × 34 × 42),
-- and all three carriers that take the field price every door the same.
--
-- Guarded like 202: a value changes only while it still says exactly what the
-- old default said. A carton or a door the owner has set to anything else
-- stays; `recent` — the sizes of labels really printed — is never touched.
-- Re-running is a no-op, and a database without the row is left without one:
-- the code defaults serve that shop. Runs on Postgres 13+ and on PGlite
-- (tests/shipping-parcel-row.test.ts).

update settings
   set value      = jsonb_set(value, '{height}', '8'::jsonb),
       updated_at = now()
 where key = 'shipping_parcel'
   and jsonb_typeof(value) = 'object'
   and value -> 'length' = '25'::jsonb
   and value -> 'width'  = '18'::jsonb
   and value -> 'height' = '10'::jsonb;

update settings
   set value      = jsonb_set(value, '{lockerSize}', '"S"'::jsonb),
       updated_at = now()
 where key = 'shipping_parcel'
   and jsonb_typeof(value) = 'object'
   and value -> 'length'     = '25'::jsonb
   and value -> 'width'      = '18'::jsonb
   and value -> 'height'     = '8'::jsonb
   and value -> 'lockerSize' = '"M"'::jsonb;
