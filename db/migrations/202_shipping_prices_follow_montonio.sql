-- 202_shipping_prices_follow_montonio.sql — the country prices 148 froze
-- follow Montonio again (migration range 200–209)
--
-- Renat measured his carton on 22.09.2026: 25 × 18 × 8 cm, declared at 0.9 kg.
-- Until that day every row of src/data/montonio-tariffs.json was quoted for a
-- 30 × 30 × 30 cm cube at 5 kg — and outside the Baltics Montonio prices a
-- parcel machine by SIZE and a courier by weight. A 30 cm cube fits only DPD's
-- biggest drawer, so every international price was one or more tiers too dear:
-- a Polish customer paid the L-tier price for a parcel that goes through the
-- XS door. The table was re-quoted for the real carton the same day
-- (PARCEL_DEFAULTS in src/lib/shipping/parcel.ts; REFERENCE_PARCEL in
-- ./tariffs is derived from it), and DEFAULT_SHIPPING_RULES in
-- src/lib/shipping.ts follows the table: Germany courier 22.29 → 17.59, Poland
-- courier 20.69 → 15.99, Poland parcel machine 17.89 → 7.49, Croatia parcel
-- machine 59.59 → 29.79, Greece courier 43.19 → 28.89 (priced off SmartPosti
-- now, which became the cheaper of the two). Inside EE/LV/LT/FI/SE Montonio's
-- price does not depend on size, and nothing there moved.
--
-- None of it reached a customer. 148 wrote every per-country cell into
-- settings.shipping_rules as a fixed number — the cube's price list of
-- 07.09.2026 — and the stored row WINS over the code defaults
-- (parseShippingRules() merges the defaults UNDER it). So the live shop, and
-- every fresh database, went on billing the 30 cm cube.
--
-- Since the 14.09.2026 redesign the rate screen rests on one sentence:
-- «пустое поле — цена Montonio». An ABSENT cell follows the code default,
-- which is Montonio's own price for the carton; a PRESENT cell is the owner's
-- decision and deliberately does not move when the tariff moves. 148's cells
-- were neither — nobody chose them, they are a snapshot of one day's table.
-- This file takes them out, so a re-quote reaches the checkout with the deploy
-- that carries it, not with yet another migration.
--
-- Guarded like 031 and 149, one cell at a time:
--
--   · A cell goes only while it still says exactly what 148 wrote — or, for
--     the LV and LT parcel machine, what 149 wrote (5.59): 149 replaced every
--     4.99 148 had left there, so a 4.99 in either cell today is a number
--     somebody typed, and it stays. jsonb compares numbers by value, so 37.29
--     and 37.290 are the same cell. A cell Renat typed a different number
--     into stays. Nothing outside `methods.parcel.XX` / `methods.courier.XX`
--     is touched: not the `default` cells, not pickup, not countriesOff, not
--     freeFrom / freeFromByCountry, not carriers.
--   · The three HOME COURIER cells stay although they still hold 148's number:
--     EE 10.84, LV 9.90, LT 9.90. They are the shop's own price, not
--     Montonio's (DEFAULT_SHIPPING_RULES holds them above cost on purpose),
--     and parseShippingRules() seeds the courier column WITHOUT them, so that
--     «Везде взять цены Montonio» really clears them. Removed here, they would
--     drop Estonia's courier to 6.89 and Latvia's and Lithuania's to 8.09 — a
--     revenue cut nobody asked for. The home PARCEL cells (EE 5.47, LV/LT 5.59)
--     do go: the parcel column is seeded from the full defaults, home prices
--     included, so an absent cell bills the very same number.
--
-- After 030 → 031 → 148 → 149 → 202 a database bills exactly what
-- DEFAULT_SHIPPING_RULES bills — tests/shipping-migration.test.ts and
-- tests/shipping-rate-table.test.ts check it. 148 and 149 are not edited: both
-- have run on production. The statements below were generated from 148's and
-- 149's own literals, not retyped — 22 parcel-machine cells, 22 courier cells.
--
-- Re-running is a no-op: a removed cell makes `#>` yield null, null never
-- equals, and updated_at is left alone. A database without the row is left
-- without one — the code defaults price that shop. Runs on Postgres 13+ and on
-- PGlite (the test suite, tests/shipping-migration.test.ts).

-- «Пакомат» — 22 cells

update settings
   set value      = value #- '{methods,parcel,AT}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,AT}' = '37.29'::jsonb;

update settings
   set value      = value #- '{methods,parcel,BE}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,BE}' = '29.79'::jsonb;

update settings
   set value      = value #- '{methods,parcel,BG}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,BG}' = '52.09'::jsonb;

update settings
   set value      = value #- '{methods,parcel,CZ}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,CZ}' = '28.29'::jsonb;

update settings
   set value      = value #- '{methods,parcel,DE}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,DE}' = '29.79'::jsonb;

update settings
   set value      = value #- '{methods,parcel,DK}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,DK}' = '23.89'::jsonb;

update settings
   set value      = value #- '{methods,parcel,EE}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,EE}' = '5.47'::jsonb;

update settings
   set value      = value #- '{methods,parcel,ES}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,ES}' = '38.69'::jsonb;

update settings
   set value      = value #- '{methods,parcel,FI}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,FI}' = '12.39'::jsonb;

update settings
   set value      = value #- '{methods,parcel,FR}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,FR}' = '44.69'::jsonb;

update settings
   set value      = value #- '{methods,parcel,HR}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,HR}' = '59.59'::jsonb;

update settings
   set value      = value #- '{methods,parcel,IE}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,IE}' = '52.09'::jsonb;

update settings
   set value      = value #- '{methods,parcel,IT}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,IT}' = '34.29'::jsonb;

update settings
   set value      = value #- '{methods,parcel,LT}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,LT}' = '5.59'::jsonb;  -- 149's literal, not 148's 4.99

update settings
   set value      = value #- '{methods,parcel,LU}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,LU}' = '35.79'::jsonb;

update settings
   set value      = value #- '{methods,parcel,LV}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,LV}' = '5.59'::jsonb;  -- 149's literal, not 148's 4.99

update settings
   set value      = value #- '{methods,parcel,NL}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,NL}' = '29.79'::jsonb;

update settings
   set value      = value #- '{methods,parcel,PL}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,PL}' = '17.89'::jsonb;

update settings
   set value      = value #- '{methods,parcel,PT}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,PT}' = '41.69'::jsonb;

update settings
   set value      = value #- '{methods,parcel,SE}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,SE}' = '13.69'::jsonb;

update settings
   set value      = value #- '{methods,parcel,SI}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,SI}' = '40.19'::jsonb;

update settings
   set value      = value #- '{methods,parcel,SK}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,SK}' = '26.79'::jsonb;

-- «Курьер» — 22 cells (EE, LV, LT stay — see above)

update settings
   set value      = value #- '{methods,courier,AT}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,AT}' = '28.49'::jsonb;

update settings
   set value      = value #- '{methods,courier,BE}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,BE}' = '24.39'::jsonb;

update settings
   set value      = value #- '{methods,courier,BG}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,BG}' = '32.59'::jsonb;

update settings
   set value      = value #- '{methods,courier,CZ}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,CZ}' = '23.99'::jsonb;

update settings
   set value      = value #- '{methods,courier,DE}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,DE}' = '22.29'::jsonb;

update settings
   set value      = value #- '{methods,courier,DK}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,DK}' = '24.19'::jsonb;

update settings
   set value      = value #- '{methods,courier,ES}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,ES}' = '34.29'::jsonb;

update settings
   set value      = value #- '{methods,courier,FI}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,FI}' = '15.69'::jsonb;

update settings
   set value      = value #- '{methods,courier,FR}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,FR}' = '24.19'::jsonb;

update settings
   set value      = value #- '{methods,courier,GR}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,GR}' = '43.19'::jsonb;

update settings
   set value      = value #- '{methods,courier,HR}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,HR}' = '28.29'::jsonb;

update settings
   set value      = value #- '{methods,courier,HU}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,HU}' = '27.39'::jsonb;

update settings
   set value      = value #- '{methods,courier,IE}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,IE}' = '38.69'::jsonb;

update settings
   set value      = value #- '{methods,courier,IT}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,IT}' = '30.09'::jsonb;

update settings
   set value      = value #- '{methods,courier,LU}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,LU}' = '26.09'::jsonb;

update settings
   set value      = value #- '{methods,courier,NL}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,NL}' = '25.59'::jsonb;

update settings
   set value      = value #- '{methods,courier,PL}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,PL}' = '20.69'::jsonb;

update settings
   set value      = value #- '{methods,courier,PT}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,PT}' = '38.39'::jsonb;

update settings
   set value      = value #- '{methods,courier,RO}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,RO}' = '36.69'::jsonb;

update settings
   set value      = value #- '{methods,courier,SE}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,SE}' = '21.59'::jsonb;

update settings
   set value      = value #- '{methods,courier,SI}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,SI}' = '32.59'::jsonb;

update settings
   set value      = value #- '{methods,courier,SK}',
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,SK}' = '27.69'::jsonb;
