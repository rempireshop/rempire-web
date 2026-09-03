-- 100_tiers_loyalty.sql — wholesale pricing & loyalty agent (migration range 100–109)
--
-- Two features share this file because they share one idea: a customer can be
-- worth pricing differently, and a paid order can hand something back.
--
--   wholesale (salon/pro)  customers.tier flips a shopper into pro pricing —
--     product_overrides.pro_price when the owner set one, else the base price
--     minus settings.pricing.proDiscountPct (src/lib/loyalty.ts). Requested
--     from the account screen, approved by hand in the admin («Клиенты»).
--   loyalty points          every paid order from a signed-in customer earns
--     points; loyalty_ledger is the only source of truth for a balance — it
--     is a sum, never a column that could drift from its own history.
--
-- Runs on Postgres 13+ and on PGlite (the test suite).

-- ---------- wholesale: who gets pro pricing --------------------------------

alter table customers add column if not exists tier text not null default 'retail'
  check (tier in ('retail', 'pro'));
alter table customers add column if not exists company text;
alter table customers add column if not exists reg_code text;
-- Set the moment «Стать партнёром» is submitted; cleared again if the owner
-- declines the request, so the same customer can ask a second time rather
-- than being stuck behind a flag nobody can see from the account screen.
alter table customers add column if not exists pro_requested_at timestamptz;
-- Set the moment the owner approves; tier flips to 'pro' at the same time.
alter table customers add column if not exists pro_approved_at timestamptz;
-- Free text on the admin customer card — not part of the brief's column
-- list, added because the card itself asks for one ("orders count, revenue,
-- points balance, notes"). Renat's own words about a customer, never shown
-- to them.
alter table customers add column if not exists notes text;

create index if not exists customers_tier_idx on customers (tier);
-- The admin's pending-requests queue: asked, not yet decided either way.
create index if not exists customers_pro_pending_idx on customers (pro_requested_at)
  where pro_requested_at is not null and tier = 'retail';

-- One price per product for the pro tier, alongside the retail override this
-- table already carries. Null = no override — the pro price is computed as
-- base price × (1 − proDiscountPct / 100), see src/lib/loyalty.ts proUnitPrice().
alter table product_overrides add column if not exists pro_price numeric(10,2);

-- ---------- wholesale: which price an order was actually charged -----------

alter table orders add column if not exists customer_id uuid references customers(id) on delete set null;
-- 'retail' | 'pro' | null (orders placed before this migration). Set once, at
-- checkout, from the tier the customer held that moment — never recomputed
-- later, so a promotion or a demotion afterwards cannot rewrite history.
alter table orders add column if not exists pricing_tier text
  check (pricing_tier in ('retail', 'pro'));
alter table orders add column if not exists loyalty_discount numeric(10,2) not null default 0;

create index if not exists orders_customer_idx on orders (customer_id) where customer_id is not null;

-- ---------- loyalty: the point ledger ---------------------------------------
--
-- No balance column anywhere — sum(delta) IS the balance, always, so it can
-- never drift from the history that explains it.
--
-- A point is one euro, rounded (src/lib/loyalty.ts eurosToPoints): earning
-- 5 % on a 100 € order credits 5 points, and redeeming 5 points takes 5 €
-- off a later order. Positive delta for earn/adjust, negative for
-- redeem/expire.

create table if not exists loyalty_ledger (
  id          bigserial primary key,
  customer_id uuid not null references customers(id) on delete cascade,
  at          timestamptz not null default now(),
  delta       int not null,
  reason      text not null check (reason in ('earn', 'redeem', 'adjust', 'expire')),
  order_id    uuid,
  note        text
);

create index if not exists loyalty_ledger_customer_idx on loyalty_ledger (customer_id, at desc);

-- Earning and redeeming both happen on the single transition into `paid`
-- (src/lib/payments/apply.ts), which the return route and the webhook race by
-- design — the same race gift_card_uses and promo_code_uses are built to
-- survive (db/migrations/020, 060). src/lib/loyalty.ts guards the common case
-- itself (select-then-insert in one transaction, same shape as consumePromo()
-- in src/lib/promos.ts); these two partial unique indexes are the backstop if
-- two transactions ever raced past that select — the resulting unique-
-- violation is caught and treated as "already posted", not an error.
create unique index if not exists loyalty_ledger_earn_once_idx
  on loyalty_ledger (order_id) where reason = 'earn' and order_id is not null;
create unique index if not exists loyalty_ledger_redeem_once_idx
  on loyalty_ledger (order_id) where reason = 'redeem' and order_id is not null;
