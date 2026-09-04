-- 080_events.sql — analytics agent (migration range 080–089)
--
-- First-party, privacy-first product analytics. One row per thing that
-- happened in the shop or at the paid transition on the server. No cookies,
-- no third-party script, no PII: `sid` is a random id the storefront keeps in
-- sessionStorage (gone when the tab closes, never synced, never a cookie),
-- and nothing here is a name, an e-mail or an address.
--
-- `type` decides what the other loosely-typed columns mean — this is one
-- table for seven different small events, not seven tables, because the
-- admin's queries (src/lib/analytics.ts) mostly want to slice ONE table by
-- time and by type:
--
--   view         a screen was shown. path = the shop URL (pathFor() in app.js).
--   product      a product page was shown. product_id set; path also set.
--   search       an internal search ran. `path` holds the TRIMMED, LOWER-CASED
--                QUERY TEXT itself, not a URL — the schema has no separate
--                "term" column, and repurposing path here (documented once,
--                here and in docs/analytics.md) keeps the table to one shape.
--                `value` holds the RESULT COUNT, so "0 results" is `value = 0`
--                and the zero-result terms report is `where type='search' and
--                value = 0`, no extra column needed.
--   add_to_cart  product_id set; value = the line's unit price, euro.
--   checkout     the checkout screen opened. value = cart total at that point.
--   purchase     a completed order. value = order total, euro. Written from
--                TWO places (src/lib/analytics.md "which is used where"):
--                 - the client, on the done screen when `s=paid` — a funnel
--                   signal only ("a session got this far"), sid is real, and
--                   it can simply not arrive (ad blockers commonly block a
--                   path literally named /api/track).
--                 - the server, from the one paid transition in
--                   src/lib/payments/apply.ts — authoritative revenue, never
--                   blocked, never duplicated (the transition runs once per
--                   order). These rows use the reserved sid value 'server',
--                   which a real per-tab id can never collide with (real ids
--                   come from crypto.randomUUID()/Math.random(), not the
--                   literal word "server"). src/lib/analytics.ts therefore
--                   computes revenue and per-product/brand breakdowns from
--                   the `orders` table directly (it already has the euro
--                   amounts and the line items, and is never affected by a
--                   blocked beacon) and uses ONLY sid<>'server' purchase rows
--                   for the funnel's last, session-shaped bar.
--   chat         the chat widget was opened (app.js and chat.js).
--
-- Retention is 90 days, enforced by GET/POST /api/cron/events-retention
-- (CRON_SECRET, same shape as /api/cron/flows) and, belt-and-suspenders, by a
-- 1-in-2000 sweep inside POST /api/track itself — so the data ages out even
-- on a hosting plan that never got the cron wired up. See docs/analytics.md.
--
-- Runs on Postgres 13+ and on PGlite (the test suite).

create table if not exists events (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  sid        text,                                 -- sessionStorage id, or 'server' — never a cookie, never PII
  type       text not null
             check (type in ('view','product','search','add_to_cart','checkout','purchase','chat')),
  path       text,                                  -- URL path, EXCEPT type='search' — see above
  product_id text,
  value      numeric(10,2),                         -- meaning depends on type — see above
  lang       text,                                  -- RU/ET/EN, whatever the shop was showing
  ref        text,                                  -- referrer HOST only (e.g. "google.com"), never a full URL
  ua_class   text check (ua_class in ('mobile','desktop')),
  country    text                                   -- two-letter, from the x-vercel-ip-country request header
);

-- Every admin query starts with "in the last N days", so this is the one
-- index every one of them can lean on.
create index if not exists events_at_idx on events (at);
-- Almost every query also fixes `type` first (the funnel, top products,
-- search terms, traffic, chat opens all group inside one type).
create index if not exists events_type_at_idx on events (type, at);
-- Per-product aggregates (top products by views, "смотрят, но не покупают").
create index if not exists events_type_product_idx
  on events (type, product_id, at) where product_id is not null;
-- The funnel and the conversion rate: distinct sessions per stage.
create index if not exists events_type_sid_idx
  on events (type, sid, at) where sid is not null;
-- Top referrer hosts.
create index if not exists events_type_ref_idx
  on events (type, ref, at) where ref is not null;

-- Every money query in src/lib/analytics.ts filters "paid orders in this
-- date range" — orders_status_idx and orders_created_idx (001_core.sql) can
-- satisfy that with a bitmap AND, but a partial index answers it directly.
-- Index-only, no column, no data touched — orders itself stays backend-core's
-- table.
--
-- SUPERSEDED by 081_orders_sales_idx.sql. "Paid" has since become
-- `status in ('paid', 'shipped')` (PAID_STATUSES in src/lib/analytics.ts), a
-- predicate this index does not cover, so 081 drops it and creates one that
-- does. The statement below is left exactly as it was: migrations are tracked
-- by file name (tools/migrate.mjs), so a fresh database still runs it and
-- 081 then removes it, while an existing database only sees 081's drop.
create index if not exists orders_paid_created_idx
  on orders (created_at) where status = 'paid';
