-- 111_order_messages.sql — assistant-at-work agent (migration range 110–119)
--
-- The customer-reply thread shown under an order in the admin: the message
-- the shopper sent (pasted in by the owner from wherever it actually arrived
-- — there is no inbound-mail webhook yet) and the reply the owner sent back,
-- either hand-written or drafted by the admin assistant's «Составить ответ»
-- and edited before sending. One row per message, oldest first.
--
-- direction: 'in' = from the customer, 'out' = sent to the customer (through
-- POST /api/admin/mail/send, src/lib/mail.ts / Resend).
--
-- meta carries the Resend message id and the subject for an 'out' row, so a
-- support conversation can be cross-referenced with the mail provider without
-- a second table. Nothing here is required — an empty {} is fine.
--
-- No foreign-key ON DELETE behaviour is exercised anywhere in this codebase
-- (orders are never hard-deleted), but "on delete cascade" keeps the thread
-- consistent if that ever changes.
create table if not exists order_messages (
  id         bigserial primary key,
  order_id   uuid not null references orders(id) on delete cascade,
  direction  text not null check (direction in ('in', 'out')),
  body       text not null,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_messages_order_idx
  on order_messages (order_id, created_at, id);
