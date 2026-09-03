-- 030_shipping_rules.sql — checkout/payments/shipping (migration range 030–039)
--
-- Seeds the delivery price list so the admin has a row to edit rather than an
-- empty settings table. src/lib/shipping.ts reads this key and falls back to
-- the same numbers in code when the row (or the whole database) is missing, so
-- this migration is a convenience, never a dependency.
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
