-- 228_blog_materials.sql — what a blog article is written FROM (migration range 220–229).
--
-- Dim, 02.11.2026 (canvas-banner/project/BlogNew, BlogDraft, Flow): an
-- article can start from materials — a brand's PDF, salon photos, a link, a
-- sample text — and one library holds them for the panel's «Новая статья»,
-- the Помощник and Renat's Claude alike (src/lib/blog-materials.ts).
--
--   kind        pdf | image | link | text
--   name        what the owner calls it — and what «Написано по материалам»
--               names under an article; the file itself is never stored or
--               handed out (a PDF is read in the browser, see below)
--   text        all its words: a PDF's pages joined, a page's text, a paste
--   pages       a PDF page by page: [{n, heading, text}] — the heading labels
--               the photo page after it («HYDRATE-ME.WASH — фото»), and the
--               draft reads only the pages its topic names
--   images      [{id, url, w, h, page, label}] — pictures uploaded to our own
--               bucket (blog/… keys): photos, or PDF pages the owner ticked
--   url         a link's address
--   sample      a text marked «писать так же» — tone and length, not facts
--   page_count  how many pages the PDF had
--
-- A PDF is opened, read and cut into pictures on the owner's phone (pdf.js in
-- the panel), never on the server: the Vercel plan's CPU is near its cap.
-- `deleted_at` hides a material from every list; the row stays so an article
-- that names it keeps making sense.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never
-- runs twice and must never be edited once it has run anywhere. Runs on
-- Postgres 13+ and on PGlite (the test suite).

create table if not exists blog_materials (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('pdf', 'image', 'link', 'text')),
  name        text not null,
  text        text not null default '',
  pages       jsonb not null default '[]'::jsonb,
  images      jsonb not null default '[]'::jsonb,
  url         text,
  sample      boolean not null default false,
  page_count  integer,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists blog_materials_list_idx
  on blog_materials (created_at desc) where deleted_at is null;
