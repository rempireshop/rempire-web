-- 227_blog_magazine.sql — the blog as a magazine (migration range 220–229).
--
-- Dim approved the design on 02.11.2026 (canvas-banner/project/BlogHome,
-- BlogPhone, Article): a big featured story on top, a grid of covers in their
-- own shape under it, topic chips, and an article page that says what it was
-- written from. Six fields on the article's own row:
--
--   topic         which of the five chips the article sits under. NULL means
--                 «nobody chose»: every reader then fills it in from the
--                 article's own words and products (guessTopic() in
--                 src/lib/blog-magazine.mjs), so the six articles already
--                 published are sorted without a data migration, and the
--                 guess stays in code where a new article gets the same one.
--                 The panel's «Тема» stores a real choice.
--   featured      «На главной блога» — the carousel on top. At most three are
--                 on at a time; src/lib/blog.ts upsertPost() refuses a fourth
--                 (`featured_full`), the panel says so before it asks.
--   cover_w/h     the cover's own size in pixels, so the shop draws it in its
--                 own shape with the box reserved before the picture arrives
--                 (no layout shift). Written by the upload (src/app/api/admin/
--                 upload answers width and height), by the panel when it has
--                 measured an older cover, and once for every older cover by
--                 tools/blog-cover-dims.mjs, which only reads the pictures.
--                 NULL is an older cover nobody has measured: the shop then
--                 frames it 1200×630, the way it always has.
--   show_sources  «Показать в статье, из чего она написана» — off by default.
--   sources       the materials the article was written from, as short lines
--                 of text («Буклет Kevin.Murphy, PDF»). Names only: the shop
--                 never offers the file itself (Dim, 02.11.2026).
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never
-- runs twice and must never be edited once it has run anywhere. Runs on
-- Postgres 13+ and on PGlite (the test suite).

alter table posts add column if not exists topic text;
alter table posts add column if not exists featured boolean not null default false;
alter table posts add column if not exists cover_w integer;
alter table posts add column if not exists cover_h integer;
alter table posts add column if not exists show_sources boolean not null default false;
alter table posts add column if not exists sources text[] not null default '{}';

alter table posts drop constraint if exists posts_topic_check;
alter table posts add constraint posts_topic_check
  check (topic is null or topic in ('hair', 'beard', 'styling', 'skin', 'studio'));

alter table posts drop constraint if exists posts_cover_dims_check;
alter table posts add constraint posts_cover_dims_check
  check ((cover_w is null and cover_h is null) or (cover_w between 1 and 20000 and cover_h between 1 and 20000));
