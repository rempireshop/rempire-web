-- 170_promo_scope.sql — scoped promo codes (migration range 170–179)
--
-- Until now a promo code could only mean «столько-то со всего заказа». Renat
-- wants «−10 % на Davines» and «−5 € на этот шампунь», and he chose what those
-- words mean: **the discount comes off the matching lines only**. A Davines
-- code takes its percent off the Davines lines and leaves the rest of the
-- basket at full price. He picked this over the whole-basket readings on his
-- own arithmetic: a shopper must not take ten per cent off a 200 € order by
-- dropping one 9 € bottle into it.
--
-- Two columns on the code, one on the order.
--
--   scope        'order'   — everything, which is every code that exists today
--                'brand'   — the lines whose `brand` is scope_value
--                'product' — the lines whose product id is scope_value
--   scope_value  the brand name as the catalogue spells it («Davines»,
--                «Kevin.Murphy»), or a catalogue product id. Null for 'order'.
--
-- The rules the constraint below spells out, and src/lib/promos.ts prices:
--
--   · a percent code is arithmetic on the subset: matching total × value %;
--   · a fixed-euro code is **capped at the matching lines' total** — «−20 €
--     на Davines» on 12 € of Davines gives 12 €, never 20. Anything else would
--     let a scoped code spill onto goods it was never meant to touch, which is
--     the whole reason the scope exists;
--   · a FREE-DELIVERY code may not be scoped at all, and the check constraint
--     refuses the combination rather than storing it and ignoring it. There is
--     no matching line to compute: the parcel is one line for the whole
--     basket, and half a delivery for half a basket is not a thing a carrier
--     sells. The other reading — «бесплатная доставка, если в корзине есть
--     Davines» — is a CONDITION, not a scope, and the code already has a
--     condition field (min_subtotal); one form control must not mean two
--     different things depending on the kind above it.
--
-- A gift-card line is never part of any subset, whatever the scope says —
-- src/lib/promos.ts promoLineMatches(). A card's face value is money the shop
-- owes back in full, and «−10 %» on a 100 € card is ten euro of straight loss
-- (audit 14.09.2026, fixed for whole-basket codes in src/lib/orders.ts
-- codeDiscount; a scoped code must not be the way back in).
--
-- Every existing code reads scope = 'order' and keeps behaving exactly as it
-- did — the default is the old meaning, not a new one.
--
-- Runs on Postgres 13+ and on PGlite (the test suite).

alter table promo_codes add column if not exists scope text not null default 'order';
alter table promo_codes add column if not exists scope_value text;

-- Rebuilt rather than added inline, so a re-run of the file (and a column that
-- already existed from an earlier hand-patch) still ends up with the rule.
alter table promo_codes drop constraint if exists promo_codes_scope_ck;
alter table promo_codes add constraint promo_codes_scope_ck check (
  (scope = 'order' and scope_value is null)
  or (
    scope in ('brand', 'product')
    and kind <> 'free_shipping'
    and scope_value is not null
    and length(btrim(scope_value)) > 0
  )
);

-- What the discount actually came off, written once when the order is priced
-- and never recomputed: {kind, value, base, lines}. `base` is the euro the
-- percent (or the cap) was taken on, `lines` the product ids it matched. Null
-- on an order with no code, on a whole-basket code, and on every order placed
-- before this migration — the admin card reads a missing value as «весь
-- заказ», which is what those orders were.
alter table orders add column if not exists discount_scope jsonb;
