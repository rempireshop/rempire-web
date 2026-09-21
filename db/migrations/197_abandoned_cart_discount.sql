-- 197_abandoned_cart_discount.sql — the second cart letter and the code it
-- carries (migration range 190–199)
--
-- Renat, 20.09.2026, via Dim: «after first one did not work we send out
-- another mail with discount. The discounted e-mail needs possibility to
-- choose for what the discount is (preferably ONLY for the cart) + also
-- timeframe when it goes out.» His earlier framing of the same wish: a basket
-- under 100 € gets the plain reminder it gets today, a basket over it gets
-- five per cent three days later.
--
-- «The first letter did not work» is decided by the one fact the shop can
-- actually know: no order has arrived from that address since. Nothing here
-- counts an open or a click — Apple Mail Privacy Protection fetches every
-- image in every letter from its own proxy, so an «opened» column would say
-- «yes» about letters nobody has read, and a shop that then withholds the
-- discount from those people is worse off than one that never asked.
--
-- TWO COLUMNS ON THE CART.
--
--   discount_at    when the second letter went out. The stamp is written
--                  BEFORE the letter leaves, the rule src/lib/flows.ts has
--                  followed since `reminded_at`: a crash between the two
--                  costs one letter, while the other order costs the customer
--                  a second copy on every run of the cron.
--   discount_code  the code that letter carried. Kept on the row because the
--                  code belongs to this basket and to no other: it is how a
--                  cart and a `promo_codes` row explain each other on the
--                  owner's screen, and how a support question («I have a code
--                  and it does nothing») is answered without guessing.
--
-- ONE SCOPE ON THE CODE.
--
-- db/migrations/170_promo_scope.sql taught a code to mean one brand or one
-- product. Neither of those is «эта корзина», and the whole-basket reading is
-- the one Renat refused when he chose what a scope means: five per cent off
-- whatever the shopper has put in since is not the offer the letter made.
--
--   scope        'cart'   — the lines that basket held, and nothing else
--   scope_value  the cart's id. It is not arithmetic — the ids below are —
--                but it is the answer to «which basket», which is the first
--                thing anybody looking at a REM-CART-… row wants.
--   scope_lines  those product ids, a jsonb array of strings.
--
-- A fourth column rather than a separator inside `scope_value`, because a
-- brand is one name, a product is one id, and a basket is a SET. Packing a
-- set into the column that holds a name would make one field mean two
-- different things depending on the field above it — the very thing 170
-- refused to do with `min_subtotal` and free delivery.
--
-- A gift-card line is still out of reach of all of this: promoLineMatches()
-- in src/lib/promos.ts throws every «gift:…» line out before the scope is
-- even consulted, so a basket that held a 100 € card issues a code that
-- cannot discount it (audit 14.09.2026, and the note in 170).
--
-- A free-delivery code may not be scoped to a cart either, for 170's own
-- reason: the parcel is one line for the whole basket and there is no subset
-- of it to price.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never runs
-- twice and must never be edited once it has run anywhere. Runs on Postgres
-- 13+ and on PGlite (the test suite).

-- ---------- the cart -------------------------------------------------------

alter table carts add column if not exists discount_at   timestamptz;
alter table carts add column if not exists discount_code text;

-- What the second letter's sweep selects: the first letter has gone, the
-- second has not, and nothing was ever ordered from the basket. Keyed on
-- `reminded_at` because that is the clock the wait is counted from — the day
-- the first letter really went out, not the day the basket went quiet, so a
-- cron that missed a week still leaves the full gap between the two letters.
create index if not exists carts_discount_pending_idx on carts (reminded_at)
  where discount_at is null and recovered_at is null;

-- ---------- the code -------------------------------------------------------

alter table promo_codes add column if not exists scope_lines jsonb;

-- Rebuilt rather than extended, exactly as 170 rebuilt it and for the same
-- reason: a re-run of either file, and a column patched in by hand, must
-- still end up with one rule.
alter table promo_codes drop constraint if exists promo_codes_scope_ck;
alter table promo_codes add constraint promo_codes_scope_ck check (
  (scope = 'order' and scope_value is null and scope_lines is null)
  or (
    scope in ('brand', 'product')
    and kind <> 'free_shipping'
    and scope_value is not null
    and length(btrim(scope_value)) > 0
    and scope_lines is null
  )
  or (
    scope = 'cart'
    and kind <> 'free_shipping'
    and scope_value is not null
    and length(btrim(scope_value)) > 0
    and jsonb_typeof(scope_lines) = 'array'
    and jsonb_array_length(scope_lines) > 0
  )
);
