-- 145_invoice_dunning.sql — order flow (migration range 140–149)
--
-- «Напоминание и автоотмена» for the company invoices migration 141 added.
-- An unpaid invoice used to hang forever: the admin said «Просрочен на N
-- дней» and nothing else ever happened. Now the daily cron
-- (GET /api/cron/flows → src/lib/invoice-dunning.ts) walks the open invoices
-- once a day and does two things, both on intervals the owner sets in
-- «Настройки → О компании → Счета для компаний»:
--
--   · a reminder letter a few days before the due date (settings.invoice
--     .remindBeforeDays, 2 by default, 0 = off), and
--   · an automatic cancellation once the invoice is N days past its due date
--     (settings.invoice.cancelAfterDays, 7 by default, 0 = off), with a
--     letter telling the company the order was cancelled.
--
-- Nothing new is stored in a column of its own: both stamps live inside the
-- `orders.invoice` blob migration 141 created (`remindedAt`, `cancelledAt`),
-- for the same reason `sentAt` and `paidAt` do — they belong to the invoice,
-- not to the payment record, and jsonb keys need no schema change. What this
-- file adds is the index that makes the daily walk cheap and, more
-- importantly, bounded: without it the cron sequentially scans every order
-- the shop has ever taken to find the handful that carry an open invoice.
--
-- The predicate matches src/lib/invoice-dunning.ts openInvoices() exactly —
-- an invoice that exists, on an order that is neither paid nor closed. A
-- partial index over `invoice->>'dueAt'` also gives the planner the ordering
-- the walk asks for (oldest due date first), so the batch limit is honest.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never
-- runs twice and must never be edited once it has run anywhere. Runs on
-- Postgres 13+ and on PGlite.

create index if not exists orders_invoice_open_idx
  on orders ((invoice->>'dueAt'))
  where invoice is not null and status in ('new', 'failed');
