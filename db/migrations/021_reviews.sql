-- 021_reviews.sql — features agent (migration range 020–029)
--
-- Customer reviews on a product page. Everything arrives as 'pending' and is
-- only shown after the owner approves it in the admin («Отзывы» tab), so the
-- shop can never be spammed into publishing something by itself.
--
-- The demo review pool in public/shop/reviews-pool.js stays where it is: this
-- table is the real one, and approved rows are rendered above the pool with a
-- «Проверенный отзыв» badge.
--
-- Runs on Postgres 13+ and on PGlite (the test suite).

create table if not exists reviews (
  id         uuid primary key default gen_random_uuid(),
  product_id text not null,
  name       text not null,
  rating     int  not null check (rating between 1 and 5),
  text       text not null,
  lang       text not null default 'RU',
  status     text not null default 'pending'
             check (status in ('pending','approved','rejected')),
  ip_hash    text,                                 -- salted hash, for rate limiting only
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,                         -- when the owner approved/rejected it
  reviewed_by text
);

-- The storefront reads one product's approved reviews, newest first.
create index if not exists reviews_product_idx on reviews (product_id, status, created_at desc);
-- The admin reads the pending queue across all products.
create index if not exists reviews_status_idx on reviews (status, created_at desc);
