-- 032_shipping_rules_eu_countries.sql — checkout/payments/shipping (migration range 030–039)
--
-- «Real per-country prices» (Дмитрий, 07.09.2026). 030 seeded a row with one
-- courier price for the whole world — 9.90 € — and settings.shipping_rules
-- wins over DEFAULT_SHIPPING_RULES in computeShipping(), so a shop that has
-- run 030 keeps charging 9.90 € to Greece however the code defaults change.
-- This migration puts the same per-country table into the row.
--
-- The numbers are Montonio's own contract prices, from
-- src/data/montonio-tariffs.json through countryPriceTable() in
-- src/lib/shipping/country-prices.ts: the cheapest carrier the shop can
-- actually put a parcel on (Nova Post is not one — no carrier row, no returns,
-- never named by the storefront), except for a parcel machine in EE/LV/LT/FI,
-- where the shopper picks the carrier himself and the price must cover the
-- dearest he can pick. Every one includes Estonian VAT, like the shelf prices
-- they replace. See docs/shipping.md § «Цены по странам» and
-- docs/audit/2026-09-07-eu-rates.md for the before/after table.
--
-- **A cell the owner has already set is never touched.** `new || existing`
-- merges right-over-left, so a price Renat typed into Настройки → Доставка
-- (or filled with «Заполнить по тарифам Montonio») wins over the value here,
-- and only a country that had no cell at all gets one. That is also why EE, LV
-- and LT appear below with the numbers they already have: the row's own values
-- win, and listing them keeps this table identical to the code's.
--
-- `freeFrom`, `freeFromByCountry`, `carriers` and `markup` are deliberately
-- left alone: how much free delivery to give away is the owner's decision, and
-- 59 € everywhere is exactly what it was (docs/audit/2026-09-07-eu-rates.md,
-- question 5).
--
-- Re-running is a no-op: every cell then exists and the row's own value wins.
-- Runs on Postgres 13+ and on PGlite (tests/shipping-migration.test.ts).

update settings
   set value = jsonb_set(
         value,
         '{methods,parcel}',
         '{
            "AT": 37.29, "BE": 29.79, "BG": 52.09, "CZ": 28.29, "DE": 29.79,
            "DK": 23.89, "EE": 5.47,  "ES": 38.69, "FI": 12.39, "FR": 44.69,
            "HR": 59.59, "IE": 52.09, "IT": 34.29, "LT": 4.99,  "LU": 35.79,
            "LV": 4.99,  "NL": 29.79, "PL": 17.89, "PT": 41.69, "SE": 13.69,
            "SI": 40.19, "SK": 26.79
          }'::jsonb || coalesce(value #> '{methods,parcel}', '{}'::jsonb)
       ),
       updated_at = now()
 where key = 'shipping_rules';

update settings
   set value = jsonb_set(
         value,
         '{methods,courier}',
         '{
            "AT": 28.49, "BE": 24.39, "BG": 32.59, "CZ": 23.99, "DE": 22.29,
            "DK": 24.19, "EE": 10.84, "ES": 34.29, "FI": 15.69, "FR": 24.19,
            "GR": 43.19, "HR": 28.29, "HU": 27.39, "IE": 38.69, "IT": 30.09,
            "LT": 9.90,  "LU": 26.09, "LV": 9.90,  "NL": 25.59, "PL": 20.69,
            "PT": 38.39, "RO": 36.69, "SE": 21.59, "SI": 32.59, "SK": 27.69
          }'::jsonb || coalesce(value #> '{methods,courier}', '{}'::jsonb)
       ),
       updated_at = now()
 where key = 'shipping_rules';

-- The seven European countries Montonio has no route to: Cyprus, Malta,
-- Iceland, Liechtenstein, Norway, Switzerland, the United Kingdom. The checkout
-- offered all of them and an order to any of them could be paid for and then
-- not posted. Switched off here only where the owner has not answered the
-- question himself — an existing key, `[]` included, is his answer and stays.
update settings
   set value      = jsonb_set(value, '{countriesOff}', '["CH","CY","GB","IS","LI","MT","NO"]'::jsonb),
       updated_at = now()
 where key = 'shipping_rules'
   and value -> 'countriesOff' is null;
