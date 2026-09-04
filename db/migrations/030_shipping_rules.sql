-- 030_shipping_rules.sql — checkout/payments/shipping (migration range 030–039)
--
-- Seeds the delivery price list so the admin has a row to edit rather than an
-- empty settings table. src/lib/shipping.ts reads this key and falls back to
-- its own DEFAULT_SHIPPING_RULES when the row (or the whole database) is
-- missing, so this migration is a convenience, never a dependency.
--
-- The EE numbers below (parcel 3.49, courier 5.99) are the brief's, and the
-- code defaults no longer say them: both sat below every sourced carrier
-- tariff for Estonia (docs/shipping.md § «Тарифы Montonio»), so
-- 031_shipping_rules_ee_tariffs.sql raises them to 5.47 / 10.84 right after
-- this file, wherever the row still carries them. This file stays as it was
-- because it has already run on the production database (2026-09-03) — an
-- applied migration is history, not the place to change a price. LV, LT and
-- the defaults below still match the code on purpose (see shipping.ts).
--
-- Shape (see docs/shipping.md):
--   freeFrom          basket subtotal in EUR at which delivery stops costing
--   freeFromByCountry per-country override of the above
--   methods           price[method][ISO country], "default" catches the rest
--   carriers          optional per-carrier override of the method price
--
-- `do nothing` on conflict: re-running migrations must never overwrite prices
-- the owner has since changed in the admin.

insert into settings (key, value)
values (
  'shipping_rules',
  '{
    "freeFrom": 59,
    "methods": {
      "parcel":  { "default": 4.99, "EE": 3.49, "LV": 4.99, "LT": 4.99 },
      "courier": { "default": 9.90, "EE": 5.99 },
      "pickup":  { "default": 0 }
    }
  }'::jsonb
)
on conflict (key) do nothing;
