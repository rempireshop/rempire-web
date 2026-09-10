-- 151_gift_card_refunds.sql — order flow (migration range 150–159)
--
-- Gift cards and refunds, two directions (Dim, 10.09.2026):
--
--   · an order that BOUGHT gift cards is refunded → the cards it bought are
--     cancelled: balance 0 and `voided_at` stamped, so the code stops working
--     at the checkout the moment the money went back. A card somebody already
--     spent part of blocks the refund (src/app/api/admin/orders/[id]/refund).
--   · an order PAID with a gift card is refunded → the part the card paid
--     goes back onto the card, and only the money part goes to Montonio.
--
-- The ledger explains both. `gift_card_uses` was append-only and positive:
-- one row per spend, «which order took how much and when» (020_gift_cards.sql).
-- A refund is the same fact with the sign turned round — the order GAVE the
-- money back — so it is one more row, negative, with `kind = 'refund'`, and
-- `amount − balance = sum(uses)` keeps holding for every card. Nothing here
-- is ever updated; a balance can still be read off its rows alone.
--
-- Postgres named the inline check `gift_card_uses_amount_check`; it is
-- replaced rather than dropped, because a zero row would explain nothing.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never runs
-- twice and must never be edited once it has run anywhere. Runs on Postgres
-- 13+ and on PGlite.

alter table gift_cards add column if not exists voided_at timestamptz;

alter table gift_card_uses add column if not exists kind text not null default 'redeem';

alter table gift_card_uses drop constraint if exists gift_card_uses_amount_check;
alter table gift_card_uses add constraint gift_card_uses_amount_check check (amount <> 0);

-- «what did this order take off a card, net of what went back» — the refund
-- route's one question, asked per order.
create index if not exists gift_card_uses_order_idx on gift_card_uses (order_id) where order_id is not null;
