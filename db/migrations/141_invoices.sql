-- 141_invoices.sql — order flow (migration range 140–149)
--
-- «По счёту — для компаний»: a company checks out, gets a numbered invoice
-- (PDF, by e-mail) and pays by bank transfer within the due days; the owner
-- marks the order paid when the money shows up (docs/payments.md § «Оплата по
-- счёту»). Three things the schema needs for that:
--
-- 1. orders.company — the buyer's company as typed at checkout: {name,
--    regCode, vatNumber, address, email}. Its own column, not a corner of the
--    shipping blob: the address on an invoice is the buyer's legal address,
--    which is not where the parcel goes, and the accountant export reads it.
--
-- 2. orders.invoice — the invoice itself: {number, issuedAt, dueAt, dueDays,
--    email, sentAt, paidAt}. Kept apart from `payment`, which is the payment
--    provider's own record and is rewritten on the paid transition
--    (src/lib/payments/apply.ts) — the invoice number must survive that.
--
-- 3. invoice_counters — one row per year, the last number handed out. The
--    number is allocated with a single `insert … on conflict do update …
--    returning`, which Postgres serialises on the row lock, so two invoices
--    issued in the same instant cannot share a number (VAT Act §37: the
--    serial number has to be unique and sequential). The order number is
--    deliberately NOT reused: order numbers are issued to every basket that
--    reaches the bank's page, most of which are never invoiced.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never
-- runs twice and must never be edited once it has run anywhere. Runs on
-- Postgres 13+ and on PGlite.

alter table orders add column if not exists company jsonb;
alter table orders add column if not exists invoice jsonb;

create table if not exists invoice_counters (
  year int primary key,
  last int not null default 0
);

-- Belt and braces on top of the counter: the database itself refuses a
-- second order carrying the same invoice number.
create unique index if not exists orders_invoice_number_idx
  on orders ((invoice->>'number')) where invoice is not null;
