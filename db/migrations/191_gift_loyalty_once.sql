-- 191_gift_loyalty_once.sql — «сделать один раз» for money that is not a POST
-- (migration range 190–199)
--
-- 180_idempotency.sql answers the routes a CLIENT can name: the client mints
-- an `Idempotency-Key` per intention and the shop remembers its answer. Three
-- of the twelve September findings cannot be answered that way, because the
-- thing that must happen once is not a request at all — it is a write deep
-- inside one, and the retry that would repeat it does not necessarily come
-- through the same door.
--
--   redeemGiftCard      a card debited twice for one order;
--   creditGiftCard      a refund credited twice onto one card;
--   adjustLoyaltyPoints a manual «+50» granted twice.
--
-- For those the receipt has to live where the money does — in the ledger that
-- explains the balance — so that whoever writes the row second is refused by
-- the database rather than by a helper that happened to look first. Same
-- reasoning, and the same shape, as 101_loyalty_refund_once.sql.
--
-- WHY A `ref` COLUMN AND NOT (code, order_id).
--
-- The obvious index for the redeem is unique on (code, order_id) where
-- kind = 'redeem' — src/lib/giftcards.ts already treats that pair as the
-- identity of a spend, and its select-then-insert guard is exactly that
-- question asked one transaction early. It is not the index written here, for
-- two reasons.
--
--   · A unique index over columns that already carry data can FAIL to be
--     created, and it would fail on precisely the shops this migration is for:
--     one that debited a card twice before the guard existed has two rows for
--     one pair, and neither may be deleted — a gift_card_uses row is what
--     explains the balance, to the customer and to the refund path that reads
--     these rows to put money back. A new column is null on every historical
--     row, so `where ref is not null` cannot trip over the past.
--   · (code, order_id) is the wrong identity for the OTHER half. A refund may
--     legitimately credit the same card for the same order more than once —
--     that is what a partial refund is — so the thing that must be unique
--     there is the refund ATTEMPT, which no pair of existing columns names.
--
-- `ref` names the intention instead, and the caller derives it the way
-- src/lib/payments/refund.ts refundIdempotencyKey() already derives the key it
-- sends to Montonio: from the order and from what has already been refunded,
-- never from a random. A fresh uuid per attempt deduplicates nothing at all,
-- which is the bug this fixes on the gift half of «Вернуть деньги».
--
-- WHO FILLS IT IN, AND WHO DOES NOT.
--
--   redeem   src/lib/giftcards.ts derives one from the order id when the
--            caller does not pass a ref, because (code, order_id) IS what a
--            spend means there and the existing guard already says so — so
--            every caller alive today is covered without touching any of
--            them, and the only thing that changes is that the loser of a
--            race is now refused by the index instead of slipping past a
--            SELECT. A redeem carrying NEITHER an order nor a ref stays
--            unguarded, and honestly so: nothing in such a call distinguishes
--            a retry from a second real spend, and guessing would be the
--            «+1 приход» mistake 180_idempotency.sql argues against at
--            length. The caller names the intention or there is none.
--   credit   never derived: see the partial-refund case above. The refund
--            route passes giftRefundRef(order, seq, amount).
--   adjust   never derived either, and for the opposite reason — there is no
--            column to derive it from. A manual adjustment has no order id
--            (which is why loyalty_ledger_refund_once_idx has never seen one),
--            so the identity has to be invented, and inventing it inside the
--            helper would silently change what every existing caller means.
--            The admin route invents it, out of the customer, the delta, the
--            note and the SHOP'S calendar day (src/lib/day.ts — Tallinn, never
--            UTC, never the machine clock), which is the same shape
--            partner-mail.ts already uses to send one welcome letter a day.
--
-- The cost of that choice is worth saying out loud: two genuinely intended,
-- byte-identical manual adjustments of the same customer on the same day
-- become one. That is the trade every dedupe makes, and here it is the right
-- way round — «Renat typed +50 and pressed Сохранить twice» is overwhelmingly
-- the likelier of the two, and the second one he really wants is one word in
-- the note away from going through.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never runs
-- twice and must never be edited once it has run anywhere. Runs on Postgres
-- 13+ and on PGlite (the test suite).

-- ---------- the card ledger ------------------------------------------------

-- What one write of this ledger was FOR. Null on every row written before
-- this migration and on every call that names no intention; those rows are
-- history and the index below does not look at them.
alter table gift_card_uses add column if not exists ref text;

-- The receipt. A second attempt carrying the same ref is a unique violation,
-- which src/lib/giftcards.ts catches and reads as «already» — the balance is
-- not touched again and the caller is handed what the first attempt took.
create unique index if not exists gift_card_uses_ref_idx
  on gift_card_uses (ref) where ref is not null;

-- ---------- the points ledger ----------------------------------------------

alter table loyalty_ledger add column if not exists ref text;

-- Same again for a manual «Корректировка». The two indexes from
-- 100_tiers_loyalty.sql cover earn and redeem, and 101_loyalty_refund_once.sql
-- covers the refund reversal; all three key on order_id, and a manual
-- adjustment carries none — so until this index there was nothing at all
-- between a double tap and a second credit.
create unique index if not exists loyalty_ledger_ref_idx
  on loyalty_ledger (ref) where ref is not null;
