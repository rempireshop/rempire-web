-- 060_promo_codes.sql — checkout-gaps agent (migration range 060–069)
--
-- Real promo codes. Until now the only code in the shop was «REMPIRE10», a
-- string compared in the browser (public/shop2/app.js): the 10 % existed only
-- on the customer's screen, anyone could read the code out of app.js, and the
-- server had no idea the discount had been promised. This table is the one
-- place a code exists, and src/lib/promos.ts is the only thing that prices it.
--
-- Kinds:
--   percent        `value` per cent off the goods subtotal (1–90)
--   fixed          `value` euro off the goods subtotal (never below zero)
--   free_shipping  delivery becomes free, whatever the shipping rules say
--
-- Money is quoted at checkout and SPENT on the paid transition
-- (src/lib/payments/apply.ts), exactly like a gift card: a checkout abandoned
-- on the bank's page must not burn a limited-use code.
--
-- Nothing is seeded. An empty table means «в магазине нет промокодов», which
-- is the truth until Renat makes one in the admin.
--
-- Runs on Postgres 13+ and on PGlite (the test suite).

create table if not exists promo_codes (
  code         text primary key,                   -- A–Z, 0–9 and «-», upper case
  kind         text not null default 'percent'
               check (kind in ('percent', 'fixed', 'free_shipping')),
  value        numeric(10,2) not null default 0 check (value >= 0),
  min_subtotal numeric(10,2) not null default 0 check (min_subtotal >= 0),
  starts_at    timestamptz,                        -- null = active from the start
  ends_at      timestamptz,                        -- null = never expires
  max_uses     int check (max_uses is null or max_uses > 0),  -- null = unlimited
  used         int not null default 0 check (used >= 0),
  active       boolean not null default true,
  note         text,                               -- what it is for, for the owner
  created_at   timestamptz not null default now()
);

-- The admin lists newest first; the storefront looks a single code up by its
-- primary key, so no other index earns its keep.
create index if not exists promo_codes_created_idx on promo_codes (created_at desc);

-- Every redemption, so a `used` counter can always be explained. Append-only.
-- One row per order: a webhook retry that somehow reached the redeem twice
-- cannot count the same order twice.
create table if not exists promo_code_uses (
  id         bigserial primary key,
  code       text not null references promo_codes (code) on delete cascade,
  order_id   uuid,
  amount     numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists promo_code_uses_order_idx
  on promo_code_uses (code, order_id) where order_id is not null;
create index if not exists promo_code_uses_code_idx
  on promo_code_uses (code, created_at desc);
