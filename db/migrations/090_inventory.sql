-- 090_inventory.sql — inventory agent (migration range 090–099)
--
-- Numeric stock, on top of the manual in/low/out override backend-core
-- already has in product_overrides.stock (001_core.sql). The two coexist on
-- purpose: a product with no row here is in "don't track" mode and keeps
-- reading its stock from the manual override, exactly as before; a product
-- that gets a stock_levels row (goods-in, a scan, or the admin's «Склад» tab)
-- switches to numeric tracking, and its public in/low/out state is derived
-- from qty (see src/lib/orders.ts getOverrides()). Nothing here changes that
-- fallback behaviour for a product nobody has touched.
--
-- `variant` is '' for a product with no sizes, else the size LABEL exactly as
-- orders.ts stores it on an order line (e.g. "75 мл") — never an index, so a
-- stock row and an order line always compare as plain text.
--
-- Runs on Postgres 13+ and on PGlite (the test suite).

create table if not exists stock_levels (
  product_id    text not null,
  variant       text not null default '',
  qty           integer not null default 0 check (qty >= 0),
  low_threshold integer not null default 2 check (low_threshold >= 0),
  ean           text,
  updated_at    timestamptz not null default now(),
  primary key (product_id, variant)
);

-- The scanner's one lookup: barcode → product. Unique so two products can
-- never claim the same EAN by mistake — a real-world barcode identifies one
-- item. Partial: most rows have no EAN yet (see tools/seed-stock.mjs), and a
-- unique index over a lot of nulls is free in Postgres, not free without the
-- `where` (nulls would still have to be visited).
create unique index if not exists stock_levels_ean_idx on stock_levels (ean) where ean is not null;

-- The ledger. Every qty change — приход, продажа (web or in-salon), a manual
-- adjustment, a return — is one row here, and stock_levels.qty is always the
-- sum of every delta ever applied to that (product_id, variant). See
-- src/lib/inventory.ts move(): the two are written together, atomically.
create table if not exists stock_moves (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  product_id text not null,
  variant    text not null default '',
  delta      integer not null,
  reason     text not null check (reason in ('sale_web','sale_pos','goods_in','adjust','return')),
  ref        text,     -- order number, a note typed by the admin, etc. — free text
  actor      text      -- 'admin', 'assistant', or who/what made the move
);

create index if not exists stock_moves_product_idx on stock_moves (product_id, variant, at desc);
create index if not exists stock_moves_at_idx on stock_moves (at desc);
