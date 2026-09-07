-- 148_shipping_country_prices.sql — checkout/payments/shipping (range 140–149)
--
-- Dim, 07.09.2026: «real per-country prices». Every European destination used
-- to share one cell — parcel 4.99, courier 9.90 — and of the 21 countries
-- Montonio serves out of Estonia that covered exactly one, Poland. Greece costs
-- 43.15 to send, Ireland 38.69, Sweden 21.58, VAT included.
--
-- src/lib/shipping.ts now builds DEFAULT_SHIPPING_RULES per country from
-- Montonio's own contract prices (src/data/montonio-tariffs.json). But the
-- seeded settings row WINS over those defaults in computeShipping(), so a
-- database that has run the migrations would have gone on billing 9.90 while a
-- database without the row billed the real price — the two must agree, which is
-- what tests/shipping-migration.test.ts checks and what caught this.
--
-- Only cells the row does not already carry are written: a price Renat has
-- typed into «Настройки → Доставка», or filled with «Заполнить по тарифам
-- Montonio», is never overwritten. 030 and 031 are not edited — both have run
-- on production. Re-running is a no-op once a cell exists.
--
-- The seven countries Montonio cannot serve at all (it answers
-- contract_prices_no_applicable_tier for every carrier) are switched off in the
-- same row, so the shop stops selling a delivery it cannot post. Renat can
-- switch any of them back on; the decision stays his.
--
-- Runs on Postgres 13+ and on PGlite.

update settings
   set value = jsonb_set(value, '{methods,parcel,default}', '4.99'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,default}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,AT}', '37.29'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,AT}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,BE}', '29.79'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,BE}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,BG}', '52.09'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,BG}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,CZ}', '28.29'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,CZ}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,DE}', '29.79'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,DE}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,DK}', '23.89'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,DK}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,EE}', '5.47'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,EE}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,ES}', '38.69'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,ES}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,FI}', '12.39'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,FI}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,FR}', '44.69'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,FR}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,HR}', '59.59'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,HR}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,IE}', '52.09'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,IE}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,IT}', '34.29'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,IT}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,LT}', '4.99'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,LT}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,LU}', '35.79'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,LU}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,LV}', '4.99'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,LV}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,NL}', '29.79'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,NL}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,PL}', '17.89'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,PL}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,PT}', '41.69'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,PT}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,SE}', '13.69'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,SE}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,SI}', '40.19'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,SI}' is null;

update settings
   set value = jsonb_set(value, '{methods,parcel,SK}', '26.79'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,parcel,SK}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,default}', '9.9'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,default}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,AT}', '28.49'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,AT}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,BE}', '24.39'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,BE}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,BG}', '32.59'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,BG}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,CZ}', '23.99'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,CZ}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,DE}', '22.29'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,DE}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,DK}', '24.19'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,DK}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,EE}', '10.84'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,EE}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,ES}', '34.29'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,ES}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,FI}', '15.69'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,FI}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,FR}', '24.19'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,FR}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,GR}', '43.19'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,GR}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,HR}', '28.29'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,HR}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,HU}', '27.39'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,HU}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,IE}', '38.69'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,IE}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,IT}', '30.09'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,IT}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,LT}', '9.9'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,LT}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,LU}', '26.09'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,LU}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,LV}', '9.9'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,LV}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,NL}', '25.59'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,NL}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,PL}', '20.69'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,PL}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,PT}', '38.39'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,PT}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,RO}', '36.69'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,RO}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,SE}', '21.59'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,SE}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,SI}', '32.59'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,SI}' is null;

update settings
   set value = jsonb_set(value, '{methods,courier,SK}', '27.69'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,courier,SK}' is null;

update settings
   set value = jsonb_set(value, '{methods,pickup,default}', '0'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{methods,pickup,default}' is null;

-- the seven Montonio will not carry
update settings
   set value = jsonb_set(value, '{countriesOff}', '["CH","CY","GB","IS","LI","MT","NO"]'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value #> '{countriesOff}' is null;
