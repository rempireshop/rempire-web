-- 050_customers.sql — account-flows agent (migration range 050–059)
--
-- Four tables behind the customer account and the three automatic letters:
--
--   customers     one row per shopper who has ever asked for a login code
--   login_codes   the six-digit code in flight, hashed, one per address
--   carts         the last cart snapshot per address — what «Брошенная корзина» reads
--   stock_alerts  «сообщите, когда появится» from a sold-out product page
--
-- There is no password anywhere: the code in login_codes IS the credential and
-- it lives fifteen minutes. It is stored as an HMAC, so a copy of the database
-- does not let anybody sign in as a customer (the same reasoning as
-- ADMIN_PASSWORD_HASH in 001_core.sql).
--
-- E-mail is the key everywhere, always stored lower-cased by the application
-- (src/lib/customers.ts normalizeEmail) — citext would be tidier but it is a
-- contrib extension PGlite does not carry, and the test suite must run.
--
-- Runs on Postgres 13+ and on PGlite (the test suite).

create table if not exists customers (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,              -- lower-cased by the app
  name          text,
  phone         text,
  lang          text not null default 'RU',
  birthday      date,                              -- null = not given, never asked twice
  marketing     boolean not null default false,    -- consent for birthday/marketing letters
  created_at    timestamptz not null default now(),
  last_login_at timestamptz,
  -- The year the birthday letter last went out. The cron may run every hour or
  -- twice a day; this is what stops a second «С днём рождения» in the same year.
  birthday_sent_year int
);

-- The birthday job asks "whose birthday is today", i.e. month+day, so the
-- plain column index earns nothing; the partial index keeps the scan to the
-- handful of rows that carry a date at all.
create index if not exists customers_birthday_idx on customers (birthday) where birthday is not null;

create table if not exists login_codes (
  email      text primary key,                     -- one live code per address
  code_hash  text not null,                        -- HMAC-SHA256(code, SESSION_SECRET)
  expires_at timestamptz not null,
  attempts   int  not null default 0,              -- five wrong guesses and the code dies
  created_at timestamptz not null default now()
);

create table if not exists carts (
  id           uuid primary key default gen_random_uuid(),
  email        text not null unique,               -- one live cart per address
  lang         text not null default 'RU',
  items        jsonb not null default '[]'::jsonb, -- [{id, title, brand, variant, qty, price}]
  total        numeric(10,2) not null default 0,
  updated_at   timestamptz not null default now(),
  recovered_at timestamptz,                        -- an order was placed from it
  reminded_at  timestamptz                         -- the reminder went out — send once
);

-- What the abandoned-cart sweep selects: never reminded, never recovered,
-- last touched a while ago.
create index if not exists carts_pending_idx on carts (updated_at)
  where reminded_at is null and recovered_at is null;

create table if not exists stock_alerts (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  product_id text not null,
  lang       text not null default 'RU',
  created_at timestamptz not null default now(),
  sent_at    timestamptz                           -- set once, never sent twice
);

-- Asking twice for the same product is one subscription, not two letters.
create unique index if not exists stock_alerts_uniq on stock_alerts (email, product_id);
create index if not exists stock_alerts_pending_idx on stock_alerts (product_id) where sent_at is null;
