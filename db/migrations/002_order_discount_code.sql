-- 002_order_discount_code.sql — backend-core (migration range 001–009)
--
-- Which code produced the discount on an order. The amount already lives in
-- orders.discount; without the code the owner cannot tell a gift card from a
-- promo campaign when looking at a cheap order in the admin.
alter table orders add column if not exists discount_code text;
