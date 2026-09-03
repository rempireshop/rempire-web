-- 020_gift_cards.sql — features agent (migration range 020–029)
--
-- Gift cards. One row per issued card. A card is created when an order that
-- contains a «gift:<amount>» line is paid (src/lib/giftcards.ts →
-- issueGiftCards), and is spent by applying its code at checkout
-- (applyGiftCard / redeemGiftCard).
--
-- Money lives in two columns on purpose: `amount` is what was bought and never
-- changes, `balance` is what is left. A card can be spent across several
-- orders, so «redeemed_at» is stamped only when the balance reaches zero.
--
-- Runs on Postgres 13+ and on PGlite (the test suite).

create table if not exists gift_cards (
  code        text primary key,                    -- RMP-XXXX-XXXX, unambiguous alphabet
  amount      numeric(10,2) not null check (amount > 0),
  balance     numeric(10,2) not null check (balance >= 0),
  order_id    uuid,                                -- the order that bought it (null = issued by hand)
  recipient   jsonb not null default '{}'::jsonb,  -- {name, email, message, from}
  lang        text not null default 'RU',          -- language the card's e-mail is written in
  created_at  timestamptz not null default now(),
  redeemed_at timestamptz                          -- set when the balance first hits 0
);

create index if not exists gift_cards_order_idx on gift_cards (order_id);

-- Every spend of a card, so a balance can always be explained: which order
-- took how much and when. Append-only; nothing here is ever updated.
create table if not exists gift_card_uses (
  id         bigserial primary key,
  code       text not null references gift_cards (code) on delete cascade,
  order_id   uuid,
  amount     numeric(10,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists gift_card_uses_code_idx on gift_card_uses (code, created_at desc);
