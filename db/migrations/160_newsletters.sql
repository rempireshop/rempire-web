-- 160_newsletters.sql — newsletter (migration range 160–169)
--
-- «Рассылка» — the one letter the owner writes himself, to everybody who
-- ticked «Хочу получать скидки и поздравление ко дню рождения» and has not
-- pressed «Отписаться» since (src/lib/consent.ts — the tick, the stamps and
-- the stop list are all there; nothing here decides who may be written to).
--
-- Two tables. `newsletters` is the letter: an internal title, the subject and
-- the body per language (jsonb keyed RU/ET/EN — the body is the HTML the
-- blog's own allowlist lets through, src/lib/blog.ts sanitizeHtml), the
-- products it shows as cards, and — once it has gone out — when and to how
-- many. `newsletter_sends` is one row per address the letter was addressed
-- to: queued when the send starts, sent or failed as Resend answers. The
-- primary key is what makes a send resumable and a resend impossible — a
-- second batch after a timeout picks up the queued rows and cannot insert a
-- second row for an address that already has one.
--
-- `sending_at` is the lease: set when a batch starts, cleared when it ends,
-- taken over when it is older than the platform's function budget — so two
-- taps on «Продолжить» never run two batches at once, and a batch that died
-- mid-way does not wedge the letter for good.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never runs
-- twice and must never be edited once it has run anywhere. Runs on Postgres
-- 13+ and on PGlite (the test suite).

create table if not exists newsletters (
  id             uuid primary key default gen_random_uuid(),
  status         text not null default 'draft'
                 check (status in ('draft','sending','sent')),
  title          text not null default '',                 -- the owner's own name for it, never sent
  subject        jsonb not null default '{}'::jsonb,       -- {"RU": "...", "ET": "...", "EN": "..."}
  body           jsonb not null default '{}'::jsonb,       -- same keys, allowlisted HTML
  products       jsonb not null default '[]'::jsonb,       -- ["<product id>", ...] — the cards under the text
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  sent_at        timestamptz,                              -- when the last queued row was answered
  sending_at     timestamptz,                              -- the batch lease, see above
  sent_count     int not null default 0,
  failed_count   int not null default 0,
  audience_count int not null default 0                    -- how many addresses were queued at the start
);

create index if not exists newsletters_updated_idx on newsletters (updated_at desc);

create table if not exists newsletter_sends (
  newsletter_id uuid not null references newsletters (id) on delete cascade,
  email         text not null,                             -- lower-cased by the app
  lang          text not null default 'RU',                -- the language the letter went out in
  status        text not null default 'queued'
                check (status in ('queued','sent','failed')),
  message_id    text,                                      -- Resend's id on success
  error         text,                                      -- Resend's word on failure
  sent_at       timestamptz,
  primary key (newsletter_id, email)
);

-- What a batch reads: the addresses still waiting, for one letter.
create index if not exists newsletter_sends_queued_idx
  on newsletter_sends (newsletter_id) where status = 'queued';
