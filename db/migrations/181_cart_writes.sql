-- 181_cart_writes.sql — how often an UNPROVEN poster may write a cart snapshot
--
-- POST /api/carts files the abandoned-cart snapshot, and it takes the address
-- as written: `sessionEmail(req) ?? normalizeEmail(body.email)`. It has to.
-- The letter exists for a first-time guest who typed an address at the
-- checkout and then closed the tab — narrowing the door to people who have
-- signed in would leave the flow with no audience at all (Dim, 17.09.2026:
-- keep the feature, bound the exposure).
--
-- What bounded it until now was `rateLimit("carts", clientIp(req), 30, 60_000)`
-- — a Map in the Node process (src/lib/auth.ts). On a serverless deployment
-- that is not a bound: every cold start hands out a fresh empty Map, the
-- instances do not share it, and the counter is keyed on an IP address, which
-- is the one thing an abuser has plenty of. The address, which is the thing
-- actually being exposed, was counted by nothing.
--
-- So the bound moves onto the address and into the database, where a cold
-- start cannot forget it:
--
--   email  the mailbox being written to (lower-cased by the app)
--   day    the Tallinn calendar day the counter belongs to, 'YYYY-MM-DD' —
--          written by the app through shopDay() (src/lib/day.ts) and never
--          derived here, for the reason that file's own doc gives: a day cut
--          at the database's timezone is a different day in Tallinn, and this
--          shop's days are Tallinn's.
--   n      unproven writes to that address on that day
--
-- A signed-in shopper writing their OWN address is proven and never counted:
-- the cookie already says who they are, and a person editing their own basket
-- may do it as often as they like.
--
-- Its own table rather than two more columns on `carts`, for one reason that
-- matters: an empty items list DELETES the cart row (saveCart), so a counter
-- living on that row could be reset through the very door it bounds. This one
-- outlives the cart it is counting.
--
-- Old rows are pruned by the daily flows run (src/lib/flows.ts) — a counter
-- for a day that is weeks past says nothing about today.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never runs
-- twice and must never be edited once it has run anywhere. Runs on Postgres
-- 13+ and on PGlite (the test suite).

create table if not exists cart_writes (
  email text primary key,               -- lower-cased by the app
  day   text not null,                  -- Tallinn calendar day, 'YYYY-MM-DD'
  n     int  not null default 0         -- unproven writes on that day
);

-- The prune's own predicate: everything older than the day it is given.
create index if not exists cart_writes_day_idx on cart_writes (day);
