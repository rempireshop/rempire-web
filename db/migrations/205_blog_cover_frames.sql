-- 205_blog_cover_frames.sql — each cover frame its own point and zoom (migration range 200–209)
--
-- «Рамки связаны: двигаешь одну — двигаются другие. Их надо двигать и
-- настраивать ОТДЕЛЬНО, и чтобы можно было увеличить» — the owner, 23.09.2026,
-- about the blog editor's three cover frames («В списке статей», «В начале
-- статьи», «В соцсетях»). 193_blog_cover_focus.sql stored ONE point for all
-- of them; the frames are two shapes (1200×630 and a square), so on anything
-- but the most ordinary photo that point had to be chosen for one frame and
-- spoiled another, and a small face in a wide photo could not be brought
-- closer at all.
--
-- NO NEW COLUMN. The setting stays one token in `cover_focus`, read and
-- written by src/lib/blog-cover.mjs and nowhere else, because that token
-- already travels through every layer — the row, both public routes,
-- #blogdata/#blogpost, the build's export, the panel's draft and its «не
-- сохранено» yardstick — and a second column is a second thing each of those
-- layers can forget (the way `data-fig` once went missing from every
-- prerendered article). What changes is the vocabulary, so what changes here
-- is the check that states it:
--
--   fill 62 28                                   every frame on one point,
--                                                zoom 1 — every value written
--                                                before today, unchanged
--   fill list 50 30 140 post 50 40 100 og 62.5 50 200
--                                                each frame its own x, y (per
--                                                cent of the photo, one
--                                                decimal) and zoom (per cent,
--                                                100 = just filled, up to 300)
--
-- NOTHING IS REWRITTEN. A row holding the short form reads as all three
-- frames on its point at zoom 1 — exactly what it showed yesterday — and is
-- only rewritten, into the long form, when the owner moves one frame away
-- from the others. The writer goes back to the short form whenever the three
-- agree and none is zoomed, so an untouched article keeps its bytes.
--
-- The positions gain one decimal in both forms: at 3× a whole per cent of
-- the photo is a 15–28 px jump in the article's frame. Every value the old
-- check allowed is still allowed.
--
-- The old check had no name of its own (Postgres called it
-- posts_cover_focus_check); it is dropped by what it says rather than by
-- that name, so a database where it was ever recreated under another one
-- still ends up with exactly one rule. Then the new one, named.
--
-- Recorded by name in _migrations (tools/migrate.mjs), so this file never runs
-- twice and must never be edited once it has run anywhere. Runs on Postgres
-- 13+ and on PGlite (the test suite).

do $$
declare
  c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'posts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%cover_focus%'
  loop
    execute format('alter table posts drop constraint %I', c.conname);
  end loop;
end
$$;

alter table posts add constraint posts_cover_focus_check check (
  cover_focus is null
  or cover_focus ~ '^(fit|fill)( (100|[1-9]?[0-9](\.[0-9])?) (100|[1-9]?[0-9](\.[0-9])?)| list (100|[1-9]?[0-9](\.[0-9])?) (100|[1-9]?[0-9](\.[0-9])?) (1[0-9][0-9]|2[0-9][0-9]|300) post (100|[1-9]?[0-9](\.[0-9])?) (100|[1-9]?[0-9](\.[0-9])?) (1[0-9][0-9]|2[0-9][0-9]|300) og (100|[1-9]?[0-9](\.[0-9])?) (100|[1-9]?[0-9](\.[0-9])?) (1[0-9][0-9]|2[0-9][0-9]|300))$'
);
