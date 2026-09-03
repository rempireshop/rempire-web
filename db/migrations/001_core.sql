-- 001_core.sql — backend-core (migration range 001–009)
--
-- The four tables the shop cannot run without: shop settings, per-product
-- overrides the owner edits in the admin, orders, and an audit trail of every
-- admin change. Reviews, gift cards and the like belong to other ranges.
--
-- Runs on Postgres 13+ (gen_random_uuid() is in core there) and on PGlite,
-- which the test suite uses in memory.

-- Older servers keep gen_random_uuid() in pgcrypto. Try, ignore if the
-- extension is unavailable — on 13+ and on PGlite the function is built in.
do $$
begin
  execute 'create extension if not exists pgcrypto';
exception when others then
  null;
end
$$;

-- Human-facing order numbers: R-100001, R-100002, … Kept in a sequence so two
-- orders placed in the same millisecond can never collide.
create sequence if not exists order_number_seq start with 100001;

create table if not exists settings (
  key        text primary key,
  value      jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- One row per product the owner has touched. Everything is nullable: a null
-- column means "no override, use the catalogue value".
create table if not exists product_overrides (
  product_id text primary key,
  price      numeric(10,2),
  stock      text check (stock in ('in','low','out')),
  seo_title  text,
  seo_desc   text,
  subcat     text,
  var_img    jsonb,
  video_url  text,
  updated_at timestamptz not null default now()
);

create table if not exists orders (
  id             uuid primary key default gen_random_uuid(),
  number         text unique not null default ('R-' || nextval('order_number_seq')),
  status         text not null default 'new'
                 check (status in ('new','paid','failed','shipped','cancelled','refunded')),
  lang           text not null default 'RU',
  currency       text not null default 'EUR',
  email          text,
  phone          text,
  name           text,
  shipping       jsonb not null default '{}'::jsonb,  -- {method, country, pointId, pointName, address, price}
  items          jsonb not null default '[]'::jsonb,  -- [{id, title, variant, qty, price, sum}]
  subtotal       numeric(10,2) not null default 0,
  shipping_price numeric(10,2) not null default 0,
  discount       numeric(10,2) not null default 0,
  total          numeric(10,2) not null default 0,
  payment        jsonb,                               -- provider payload, set by the payments agent
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists orders_created_idx on orders (created_at desc);
create index if not exists orders_status_idx  on orders (status);
create index if not exists orders_email_idx   on orders (lower(email));

create table if not exists admin_audit (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  actor   text,
  action  text not null,
  payload jsonb
);

create index if not exists admin_audit_at_idx on admin_audit (at desc);
