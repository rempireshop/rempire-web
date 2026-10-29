-- 225_audit_device.sql — which phone or computer made a journal row
-- (migration range 220–229).
--
-- 28.10.2026, 21:50: the panel's «Показывать в магазине» switches fired at
-- machine speed from an admin session that had been idle for 33 minutes —
-- 75 products in stock hidden in five seconds. The journal knew what changed
-- and when, but not from which device. writeAudit() (src/lib/orders.ts) now
-- stores the request's User-Agent here, cut to 300 characters; a row written
-- before this column existed simply has none.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never
-- runs twice and must never be edited once it has run anywhere. Runs on
-- Postgres 13+ and on PGlite (the test suite).

alter table admin_audit add column if not exists device text;
