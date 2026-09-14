-- 093_pos_sale_ref.sql — inventory agent (migration range 090–099)
--
-- One salon sale, one order, however many times the register sends it.
--
-- POST /api/admin/pos-orders/ creates the order, marks it paid and settles it
-- (points, the customer's letter, the shelf) in a single request, and the
-- register leaves the basket and both pay buttons exactly as they were when
-- the answer does not come back. A phone that loses the salon's wi-fi
-- mid-request therefore shows «Сервер не отвечает» over a sale that HAS gone
-- through, and the cashier — with a customer standing there — taps «Терминал»
-- again: a second paid order, a second lot of points, the shelf written off
-- twice and two «Заказ принят» letters for one purchase.
--
-- The register now mints an id for the basket in front of it and sends it
-- with the sale; this column is where that id lands, in the same INSERT as the
-- order itself. The route answers a repeat of an id it already has with the
-- order it already wrote, so the second tap is the first sale's receipt rather
-- than a second sale.
--
-- Additive to backend-core's orders table (001_core.sql), the same way
-- 091_pos_channel.sql's `channel` is. Null for every web order and for every
-- sale rung up before this existed — hence the partial index: the uniqueness
-- is only about the ids the till actually sends.

alter table orders add column if not exists pos_ref text;

create unique index if not exists orders_pos_ref_idx on orders (pos_ref)
  where pos_ref is not null;
