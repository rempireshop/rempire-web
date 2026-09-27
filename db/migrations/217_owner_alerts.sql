-- 217_owner_alerts.sql — the owner's alerts, each sent once
--
-- Readiness pass of 27.09.2026, B11 (golive «webhook-alarm»): until now the
-- one thing that reached Renat's phone was a PAID order. A refund Montonio
-- could not pay, a payment only the nightly check found, a parcel the carrier
-- refused or sent back — each got a journal row and nothing else, so he heard
-- about it from the customer. src/lib/owner-alerts.ts now sends those through
-- the same three channels as the paid-order ping (push, Telegram, the shop's
-- letter as the fallback).
--
-- This table is what makes each of them go ONCE. Montonio retries a webhook
-- up to 15 times over two days and the nightly jobs see the same order every
-- night, so the same news arrives many times. Every alert carries a key built
-- from what it is about (the refund's id, the order number, the shipment id)
-- and is sent only by the request whose INSERT claimed that key — a second
-- delivery finds the row and stays quiet. The row also answers «was Renat
-- told, and did any channel take it» without a log.
--
--   key        what the alert is about, e.g. `refund_stuck:<refund id>:<code>`
--   kind       which alert (refund_stuck, shipment_returned, …)
--   number     the order number, for reading the table by hand
--   at         when the key was claimed
--   delivered  true: a phone, Telegram or the letter took it; false: nothing
--              did (no channel configured, or all refused); null: still
--              being sent, or the send never finished
--   note       why it was not sent (`capped` — the hourly limit)
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never runs
-- twice and must never be edited once it has run anywhere. Runs on Postgres
-- 13+ and on PGlite.

create table if not exists owner_alerts (
  key text primary key,
  kind text not null,
  number text,
  at timestamptz not null default now(),
  delivered boolean,
  note text
);

create index if not exists owner_alerts_at_idx on owner_alerts (at desc);
