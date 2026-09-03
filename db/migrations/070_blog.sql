-- 070_blog.sql — blog agent (migration range 070–079)
--
-- The shop's own articles — grooming advice, how-tos, product roundups —
-- written by Renat or drafted by the admin assistant, always in three
-- languages. One row is one article in every language at once: title,
-- excerpt and body are jsonb {RU, ET, EN}, exactly like a product's SEO
-- fields elsewhere in this shop. An empty ET or EN string means «show the
-- Russian text» — the storefront and the API both fall back that way,
-- nothing here enforces all three being filled in.
--
-- status is the only publication switch there is: 'draft' is invisible to
-- the public API and the prerendered pages, 'published' is live. There is no
-- hard delete — src/lib/blog.ts deletePost() sets status back to 'draft',
-- the same row, the same slug, nothing lost. A slug is never reused for a
-- different article once it has been public, so an old link never lands on
-- someone else's text.
--
-- products is a plain array of catalogue ids (not a foreign key — the
-- catalogue is a generated JSON file, not a table) for the «featured
-- products» rail under the article.
--
-- Runs on Postgres 13+ and on PGlite (the test suite).

create table if not exists posts (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  status       text not null default 'draft'
               check (status in ('draft', 'published')),
  title        jsonb not null default '{}'::jsonb,   -- {RU, ET, EN}
  excerpt      jsonb not null default '{}'::jsonb,    -- {RU, ET, EN}
  body         jsonb not null default '{}'::jsonb,    -- {RU, ET, EN} — markdown source
  cover_url    text,
  cover_alt    jsonb not null default '{}'::jsonb,    -- {RU, ET, EN}
  tags         text[] not null default '{}',
  products     text[] not null default '{}',          -- catalogue ids, featured on the post page
  seo_title    jsonb not null default '{}'::jsonb,    -- {RU, ET, EN}
  seo_desc     jsonb not null default '{}'::jsonb,    -- {RU, ET, EN}
  author       text not null default 'Rempire',
  published_at timestamptz,                            -- when it first went live; kept through an unpublish
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The public listing and the prerender export both read exactly this shape:
-- published, newest first.
create index if not exists posts_public_idx
  on posts (status, published_at desc) where status = 'published';

-- The admin list — every post, newest first regardless of status.
create index if not exists posts_admin_idx on posts (updated_at desc);
